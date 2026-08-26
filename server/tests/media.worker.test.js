jest.mock('../services/jobs/jobQueue', () => ({
  WAKE_CHANNEL: 'olympus:jobs:wake',
  claimNext: jest.fn(),
  complete: jest.fn(),
  fail: jest.fn(),
}));
jest.mock('../config/redis', () => ({
  redisClient: { isReady: false },
  getRedisClient: jest.fn(() => null),
  connectRedis: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

const jobQueue = require('../services/jobs/jobQueue');
const worker = require('../services/jobs/worker');

describe('job worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    worker.resetHandlers();
  });

  it('does nothing when no handlers are registered', async () => {
    expect(await worker.tick()).toBe(false);
    expect(jobQueue.claimNext).not.toHaveBeenCalled();
  });

  it('runs the matching handler and completes the job', async () => {
    const handler = jest.fn().mockResolvedValue({ ok: true });
    worker.register('transcode', handler);
    jobQueue.claimNext.mockResolvedValueOnce({ id: 1, job_type: 'transcode', payload: { assetId: 5 } });

    expect(await worker.tick()).toBe(true);
    expect(handler).toHaveBeenCalledWith({ assetId: 5 }, expect.objectContaining({ id: 1 }));
    expect(jobQueue.complete).toHaveBeenCalledWith(1, { ok: true });
    expect(jobQueue.fail).not.toHaveBeenCalled();
  });

  it('parses string payloads (pg json passthrough)', async () => {
    const handler = jest.fn().mockResolvedValue(null);
    worker.register('transcode', handler);
    jobQueue.claimNext.mockResolvedValueOnce({ id: 2, job_type: 'transcode', payload: '{"assetId":9}' });

    await worker.tick();
    expect(handler).toHaveBeenCalledWith({ assetId: 9 }, expect.anything());
  });

  it('records handler failures through jobQueue.fail', async () => {
    worker.register('transcode', jest.fn().mockRejectedValue(new Error('encode blew up')));
    jobQueue.claimNext.mockResolvedValueOnce({ id: 3, job_type: 'transcode', payload: {} });
    jobQueue.fail.mockResolvedValueOnce({ status: 'queued', retryInSeconds: 30 });

    expect(await worker.tick()).toBe(true);
    expect(jobQueue.fail).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }), 'encode blew up');
    expect(jobQueue.complete).not.toHaveBeenCalled();
  });

  it('returns false when the queue is empty', async () => {
    worker.register('transcode', jest.fn());
    jobQueue.claimNext.mockResolvedValueOnce(null);
    expect(await worker.tick()).toBe(false);
  });

  it('drain processes jobs until the queue is empty', async () => {
    worker.register('transcode', jest.fn().mockResolvedValue(null));
    jobQueue.claimNext
      .mockResolvedValueOnce({ id: 1, job_type: 'transcode', payload: {} })
      .mockResolvedValueOnce({ id: 2, job_type: 'transcode', payload: {} })
      .mockResolvedValueOnce(null);

    expect(await worker.drain()).toBe(2);
    expect(jobQueue.complete).toHaveBeenCalledTimes(2);
  });
});
