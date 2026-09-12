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
 *
 * dose-1.59: jobId / attempts / maxAttempts / enqueue options use shared
 * toPositiveInt (same bar as stream/playback/controller ids; no raw parseInt
 * coercion of junk).
 */

const db = require('../../config/database');
const { redisClient } = require('../../config/redis');
const { logger } = require('../../utils/logger');
const { toPositiveInt } = require('../../utils/streamToken');

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
 * priority: non-negative integer (default 0); maxAttempts: positive int (default 3).
 */
async function enqueue(jobType, payload = {}, options = {}) {
  let priority = 0;
  if (options.priority != null && options.priority !== '') {
    const p = Number(options.priority);
    if (!Number.isFinite(p) || !Number.isInteger(p) || p < 0) {
      throw new Error('enqueue priority must be a non-negative integer');
    }
    priority = p;
  }

  let maxAttempts = 3;
  if (options.maxAttempts != null && options.maxAttempts !== '') {
    const m = toPositiveInt(options.maxAttempts);
    if (m == null) {
      throw new Error('enqueue maxAttempts must be a positive integer');
    }
    maxAttempts = m;
  }

  let createdBy = null;
  if (options.createdBy != null && options.createdBy !== '') {
    const uid = toPositiveInt(options.createdBy);
    if (uid == null) {
      throw new Error('enqueue createdBy must be a positive integer');
    }
    createdBy = uid;
  }

  const runAt = options.runAt ?? null;

  const result = await db.query(
    `INSERT INTO jobs (job_type, payload, priority, max_attempts, run_at, created_by)
     VALUES ($1, $2, $3, $4, COALESCE($5, CURRENT_TIMESTAMP), $6)
     RETURNING *`,
    [jobType, JSON.stringify(payload), priority, maxAttempts, runAt, createdBy]
  );

  await publishWake(jobType);
  return result.rows[0];
}

// A job stuck in 'running' longer than this is presumed orphaned by a worker
// crash and becomes reclaimable (visibility timeout).
const STALE_RUNNING_MINUTES = 15;

/**
 * Atomically claim the next runnable job of the given types (or any type when
 * omitted). Also reclaims jobs orphaned in 'running' by a crashed worker once
 * the visibility timeout passes; orphans that already burned max_attempts are
 * parked as 'dead'. Returns the claimed row or null.
 */
async function claimNext(jobTypes = null) {
  // Park crash-orphans that have no attempts left, so they surface for ops
  // instead of being reclaimed forever.
  await db.query(
    `UPDATE jobs SET status = 'dead',
       last_error = COALESCE(last_error, 'worker lost (stale running, attempts exhausted)'),
       finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE status = 'running'
       AND started_at < CURRENT_TIMESTAMP - INTERVAL '${STALE_RUNNING_MINUTES} minutes'
       AND attempts >= max_attempts`
  );

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
       WHERE ((status = 'queued' AND run_at <= CURRENT_TIMESTAMP)
           OR (status = 'running' AND started_at < CURRENT_TIMESTAMP - INTERVAL '${STALE_RUNNING_MINUTES} minutes'))
         AND attempts < max_attempts ${typeFilter}
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
  const id = toPositiveInt(jobId);
  if (id == null) {
    throw new Error('complete requires a positive integer jobId');
  }
  await db.query(
    `UPDATE jobs SET status = 'completed', result = $2,
       finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, result === null ? null : JSON.stringify(result)]
  );
}

/**
 * Record a failure. Requeues with exponential backoff until attempts reach
 * max_attempts, then parks the job as 'dead'.
 */
async function fail(job, errorMessage) {
  if (!job || job.id == null) {
    throw new Error('fail requires a job row with id');
  }
  const id = toPositiveInt(job.id);
  if (id == null) {
    throw new Error('fail requires a positive integer job.id');
  }

  // DB rows can arrive as strings; prefer toPositiveInt, fall back to 0/3.
  const attempts = toPositiveInt(job.attempts) ?? 0;
  const maxAttempts = toPositiveInt(job.max_attempts) ?? 3;
  const message = String(errorMessage || 'Unknown error').slice(0, 2000);

  if (attempts >= maxAttempts) {
    await db.query(
      `UPDATE jobs SET status = 'dead', last_error = $2,
         finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [id, message]
    );
    return { status: 'dead' };
  }

  const delay = backoffSeconds(attempts);
  await db.query(
    `UPDATE jobs SET status = 'queued', last_error = $2,
       run_at = CURRENT_TIMESTAMP + ($3 || ' seconds')::interval,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [id, message, String(delay)]
  );
  return { status: 'queued', retryInSeconds: delay };
}

/** Fetch one job by id. */
async function getJob(jobId) {
  const id = toPositiveInt(jobId);
  if (id == null) return null;
  const result = await db.query('SELECT * FROM jobs WHERE id = $1', [id]);
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
