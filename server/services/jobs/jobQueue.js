/**
 * Durable job queue — Project Olympus extraction seam for BullMQ/EKS workers.
 *
 * Postgres is the source of truth (jobs table). Redis, when reachable, is used
 * only as a wake-up channel so workers pick up new jobs faster than the poll
 * interval; every Redis touch is wrapped in its own try/catch per the repo's
 * cache-only doctrine.
 *
 * Concurrency safety (named mechanisms, NFR-07):
 * - claimNext uses UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED)
 *   so two workers can never claim the same job.
 * - retry backoff reschedules via run_at; after max_attempts the job goes to
 *   status 'dead' and stays inspectable.
 */

const db = require('../../config/database');
const { redisClient } = require('../../config/redis');
const { logger } = require('../../utils/logger');

const WAKE_CHANNEL = 'olympus:jobs:wake';

/** Exponential backoff in seconds: 30s, 2m, 8m, capped at 30m. */
function backoffSeconds(attempts) {
  return Math.min(30 * Math.pow(4, Math.max(0, attempts - 1)), 1800);
}

async function publishWake(jobType) {
  try {
    if (redisClient && redisClient.isReady) {
      await redisClient.publish(WAKE_CHANNEL, jobType);
    }
  } catch (err) {
    // Redis is only an optimization; the poll loop will find the job.
    logger.warn(`Job wake publish failed (poll loop will pick up): ${err.message}`);
  }
}

/**
 * Enqueue a job. Returns the inserted job row.
 */
async function enqueue(jobType, payload = {}, options = {}) {
  const {
    priority = 0,
    maxAttempts = 3,
    runAt = null,
    createdBy = null,
  } = options;

  const result = await db.query(
    `INSERT INTO jobs (job_type, payload, priority, max_attempts, run_at, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_TIMESTAMP), $6)
     RETURNING *`,
    [jobType, JSON.stringify(payload), priority, maxAttempts, runAt, createdBy]
  );

  await publishWake(jobType);
  return result.rows[0];
}

/**
 * Atomically claim the next runnable job of the given types (or any type when
 * omitted). Returns the claimed row or null.
 */
async function claimNext(jobTypes = null) {
  const params = [];
  let typeFilter = '';
  if (Array.isArray(jobTypes) && jobTypes.length > 0) {
    params.push(jobTypes);
    typeFilter = `AND job_type = ANY($${params.length})`;
  }

  const result = await db.query(
    `UPDATE jobs SET
       status = 'running',
       attempts = attempts + 1,
       started_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     WHERE id IN (
       SELECT id FROM jobs
       WHERE status = 'queued' AND run_at <= CURRENT_TIMESTAMP ${typeFilter}
       ORDER BY priority DESC, run_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING *`,
    params
  );

  return result.rows[0] || null;
}

/** Mark a running job completed with an optional result payload. */
async function complete(jobId, result = null) {
  await db.query(
    `UPDATE jobs SET status = 'completed', result = $2,
       finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [jobId, result === null ? null : JSON.stringify(result)]
  );
}

/**
 * Record a failure. Requeues with exponential backoff until attempts reach
 * max_attempts, then parks the job as 'dead'.
 */
async function fail(job, errorMessage) {
  const attempts = parseInt(job.attempts, 10) || 0;
  const maxAttempts = parseInt(job.max_attempts, 10) || 3;
  const message = String(errorMessage || 'Unknown error').slice(0, 2000);

  if (attempts >= maxAttempts) {
    await db.query(
      `UPDATE jobs SET status = 'dead', last_error = $2,
         finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [job.id, message]
    );
    return { status: 'dead' };
  }

  const delay = backoffSeconds(attempts);
  await db.query(
    `UPDATE jobs SET status = 'queued', last_error = $2,
       run_at = CURRENT_TIMESTAMP + ($3 || ' seconds')::interval,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [job.id, message, String(delay)]
  );
  return { status: 'queued', retryInSeconds: delay };
}

/** Fetch one job by id. */
async function getJob(jobId) {
  const result = await db.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  return result.rows[0] || null;
}

module.exports = {
  WAKE_CHANNEL,
  backoffSeconds,
  enqueue,
  claimNext,
  complete,
  fail,
  getJob,
};
