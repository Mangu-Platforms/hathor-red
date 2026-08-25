jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../config/redis', () => ({
  redisClient: { isReady: false, publish: jest.fn() },
  getRedisClient: jest.fn(() => null),
  connectRedis: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

const db = require('../config/database');
const { redisClient } = require('../config/redis');
const { logger } = require('../utils/logger');
const jobQueue = require('../services/jobs/jobQueue');

describe('jobQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisClient.isReady = false;
  });

  describe('backoffSeconds', () => {
    it('grows exponentially and caps at 30 minutes', () => {
      expect(jobQueue.backoffSeconds(1)).toBe(30);
      expect(jobQueue.backoffSeconds(2)).toBe(120);
      expect(jobQueue.backoffSeconds(3)).toBe(480);
      expect(jobQueue.backoffSeconds(10)).toBe(1800);
    });
  });

  describe('enqueue', () => {
    it('inserts a parameterized job row and returns it', async () => {
      const row = { id: 7, job_type: 'transcode', status: 'queued' };
      db.query.mockResolvedValueOnce({ rows: [row] });

      const job = await jobQueue.enqueue('transcode', { assetId: 3 }, { createdBy: 12 });

      expect(job).toEqual(row);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO jobs');
      expect(params[0]).toBe('transcode');
      expect(JSON.parse(params[1])).toEqual({ assetId: 3 });
      expect(params[5]).toBe(12);
    });

    it('tolerates a Redis wake publish failure (queue is DB-backed)', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
      redisClient.isReady = true;
      redisClient.publish.mockRejectedValueOnce(new Error('redis down'));

      await expect(jobQueue.enqueue('transcode', {})).resolves.toEqual({ id: 1 });
      expect(logger.warn).toHaveBeenCalled();
    });

    it('skips the wake publish entirely when Redis is not ready', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 2 }] });

      await jobQueue.enqueue('transcode', {});
      expect(redisClient.publish).not.toHaveBeenCalled();
    });
  });

  describe('claimNext', () => {
    it('claims atomically with FOR UPDATE SKIP LOCKED', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 5, job_type: 'transcode' }] });

      const job = await jobQueue.claimNext(['transcode']);

      expect(job.id).toBe(5);
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toContain(`status = 'queued'`);
      expect(sql).toContain('job_type = ANY($1)');
      expect(params[0]).toEqual(['transcode']);
    });

    it('returns null when the queue is empty', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      expect(await jobQueue.claimNext()).toBeNull();
    });
  });

  describe('fail', () => {
    it('requeues with backoff below max_attempts', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const outcome = await jobQueue.fail({ id: 9, attempts: 1, max_attempts: 3 }, 'boom');

      expect(outcome).toEqual({ status: 'queued', retryInSeconds: 30 });
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain(`status = 'queued'`);
      expect(params).toEqual([9, 'boom', '30']);
    });

    it('parks the job as dead at max_attempts', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });

      const outcome = await jobQueue.fail({ id: 9, attempts: 3, max_attempts: 3 }, 'boom');

      expect(outcome).toEqual({ status: 'dead' });
      expect(db.query.mock.calls[0][0]).toContain(`status = 'dead'`);
    });
  });
});
