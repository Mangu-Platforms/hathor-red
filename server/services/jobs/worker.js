/**
 * In-process job worker — polls the durable queue and runs registered
 * handlers. This is the extraction seam for dedicated worker dynos/pods:
 * the same handlers can later run in a separate process against the same
 * jobs table without any queue-contract change.
 *
 * Redis (when reachable) shortens pickup latency via the wake channel; the
 * poll loop alone is fully sufficient when Redis is down.
 */

const jobQueue = require('./jobQueue');
const { getRedisClient } = require('../../config/redis');
const { logger } = require('../../utils/logger');

const handlers = new Map();

let pollTimer = null;
let running = false;
let draining = false;
let wakeSubscriber = null;

/** Register a handler: async (payload, job) => result */
function register(jobType, handlerFn) {
  handlers.set(jobType, handlerFn);
}

function registeredTypes() {
  return Array.from(handlers.keys());
}

/**
 * Claim and run at most one job. Returns true when a job was processed
 * (success or failure), false when the queue was empty. Exposed for tests
 * and for wake-triggered immediate drains.
 */
async function tick() {
  const types = registeredTypes();
  if (types.length === 0) return false;

  const job = await jobQueue.claimNext(types);
  if (!job) return false;

  const handler = handlers.get(job.job_type);
  if (!handler) {
    // Claimed a type we no longer handle (rolling deploy window): park it.
    await jobQueue.fail(job, `No handler registered for ${job.job_type}`);
    return true;
  }

  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) : (job.payload || {});
  try {
    const result = await handler(payload, job);
    await jobQueue.complete(job.id, result === undefined ? null : result);
    logger.info({ action: 'job_completed', jobId: job.id, jobType: job.job_type });
  } catch (err) {
    const outcome = await jobQueue.fail(job, err.message);
    logger.error({ action: 'job_failed', jobId: job.id, jobType: job.job_type, error: err.message, outcome });
  }
  return true;
}

/** Drain the queue until empty (bounded by maxJobs to avoid starving the loop). */
async function drain(maxJobs = 25) {
  if (draining) return 0;
  draining = true;
  let processed = 0;
  try {
    while (processed < maxJobs && (await tick())) {
      processed += 1;
    }
  } finally {
    draining = false;
  }
  return processed;
}

async function subscribeWake() {
  try {
    const base = getRedisClient();
    if (!base || !base.isReady) return;
    wakeSubscriber = base.duplicate();
    wakeSubscriber.on('error', (err) => {
      logger.warn(`Job wake subscriber error (poll loop continues): ${err.message}`);
    });
    await wakeSubscriber.connect();
    await wakeSubscriber.subscribe(jobQueue.WAKE_CHANNEL, () => {
      drain().catch((err) => logger.error('Wake drain error:', err));
    });
    logger.info('Job worker subscribed to Redis wake channel');
  } catch (err) {
    // Redis wake is purely an optimization; keep polling.
    logger.warn(`Job wake subscribe failed (poll loop continues): ${err.message}`);
    wakeSubscriber = null;
  }
}

/** Start the poll loop. Safe to call once at server startup. */
async function start({ intervalMs = 15000 } = {}) {
  if (running) return;
  running = true;

  await subscribeWake();

  const loop = async () => {
    if (!running) return;
    try {
      await drain();
    } catch (err) {
      // DB unavailable — degrade quietly, the next tick retries.
      logger.warn(`Job poll error (will retry): ${err.message}`);
    }
    if (running) {
      pollTimer = setTimeout(loop, intervalMs);
      if (pollTimer.unref) pollTimer.unref();
    }
  };

  pollTimer = setTimeout(loop, intervalMs);
  if (pollTimer.unref) pollTimer.unref();
  logger.info(`Job worker started (poll every ${intervalMs}ms; handlers: ${registeredTypes().join(', ') || 'none'})`);
}

async function stop() {
  running = false;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (wakeSubscriber) {
    try {
      await wakeSubscriber.quit();
    } catch {
      // best effort
    }
    wakeSubscriber = null;
  }
}

/** Test hook: clear registered handlers. */
function resetHandlers() {
  handlers.clear();
}

module.exports = {
  register,
  registeredTypes,
  tick,
  drain,
  start,
  stop,
  resetHandlers,
};
