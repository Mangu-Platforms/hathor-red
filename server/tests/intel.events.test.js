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
const eventService = require('../services/intel/eventService');
const { countryFromHeaders, ingestBatch, MAX_BATCH } = eventService;

describe('countryFromHeaders', () => {
  it('prefers CDN country headers in order and normalizes case', () => {
    expect(countryFromHeaders({ 'cf-ipcountry': 'de' })).toBe('DE');
    expect(countryFromHeaders({ 'x-vercel-ip-country': 'BR' })).toBe('BR');
    expect(countryFromHeaders({ 'cf-ipcountry': 'XX', 'x-vercel-ip-country': 'JP' })).toBe('JP');
  });

  it('returns null for absent or malformed values', () => {
    expect(countryFromHeaders({})).toBeNull();
    expect(countryFromHeaders({ 'cf-ipcountry': 'USA' })).toBeNull();
    expect(countryFromHeaders({ 'cf-ipcountry': '<script>' })).toBeNull();
  });
});

describe('ingestBatch', () => {
  beforeEach(() => jest.clearAllMocks());

  it('inserts valid events with dedup ON CONFLICT and counts replays separately', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // accepted
      .mockResolvedValueOnce({ rows: [] });         // deduplicated replay

    const result = await ingestBatch({
      userId: 9,
      country: 'DE',
      events: [
        { songId: 5, type: 'play', positionMs: 0, clientEventId: 'evt-1' },
        { songId: 5, type: 'play', positionMs: 0, clientEventId: 'evt-1' },
      ],
    });

    expect(result).toEqual({ accepted: 1, rejected: [], deduplicated: 1 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (user_id, client_event_id)');
    expect(sql).toContain('DO NOTHING');
    expect(params).toEqual([9, 5, 'play', 0, null, 'evt-1', 'DE', 'web']);
  });

  it('rejects malformed events individually without failing the batch', async () => {
    db.query.mockResolvedValue({ rows: [{ id: 1 }] });

    const result = await ingestBatch({
      userId: 9,
      events: [
        { songId: 5, type: 'play' },
        { songId: 0, type: 'play' },
        { songId: 5, type: 'invented' },
        { songId: 5, type: 'seek', positionMs: -4 },
      ],
    });

    expect(result.accepted).toBe(1);
    expect(result.rejected).toHaveLength(3);
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it('enforces batch bounds', async () => {
    await expect(ingestBatch({ userId: 9, events: [] })).rejects.toMatchObject({ status: 400 });
    await expect(
      ingestBatch({ userId: 9, events: new Array(MAX_BATCH + 1).fill({ songId: 1, type: 'play' }) })
    ).rejects.toMatchObject({ status: 400 });
  });
});
