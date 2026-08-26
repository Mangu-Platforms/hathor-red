jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../config/redis', () => ({
  redisClient: { isReady: false },
  getRedisClient: jest.fn(() => null),
  connectRedis: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

const db = require('../config/database');
const { logger } = require('../utils/logger');
const auditService = require('../services/privacy/auditService');

describe('auditService', () => {
  const originalStrict = process.env.AUDIT_STRICT;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AUDIT_STRICT;
  });

  afterAll(() => {
    if (originalStrict === undefined) delete process.env.AUDIT_STRICT;
    else process.env.AUDIT_STRICT = originalStrict;
  });

  it('writes a parameterized audit row', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });

    const ok = await auditService.record({
      userId: 4,
      action: 'purchase_completed',
      targetType: 'purchase',
      targetId: 77,
      detail: { amountCents: 500 },
      ip: '10.0.0.1',
    });

    expect(ok).toBe(true);
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO audit_log');
    expect(params).toEqual([4, 'purchase_completed', 'purchase', 77, '{"amountCents":500}', '10.0.0.1']);
  });

  it('never throws by default when the write fails (availability doctrine)', async () => {
    db.query.mockRejectedValueOnce(new Error('db down'));

    const ok = await auditService.record({ userId: 4, action: 'login_succeeded' });

    expect(ok).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('throws in AUDIT_STRICT mode so unauditable actions fail closed', async () => {
    process.env.AUDIT_STRICT = 'true';
    db.query.mockRejectedValueOnce(new Error('db down'));

    await expect(auditService.record({ userId: 4, action: 'login_succeeded' })).rejects.toThrow('db down');
  });

  it('fetches a bounded per-user trail', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ action: 'login_succeeded' }] });
    const rows = await auditService.forUser(4, { limit: 9999 });
    expect(rows).toHaveLength(1);
    expect(db.query.mock.calls[0][1]).toEqual([4, 500]); // limit capped
  });
});
