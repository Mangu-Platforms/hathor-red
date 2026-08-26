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
const analyticsService = require('../services/intel/analyticsService');
const { buildRetentionCurve, RETENTION_BUCKET_MS } = analyticsService;

describe('buildRetentionCurve', () => {
  it('normalizes bucketed listener counts (string bigints) against plays', () => {
    const rows = [
      { bucket: '0', listeners: '10' },
      { bucket: '1', listeners: '8' },
      { bucket: '2', listeners: '9' },
      { bucket: '5', listeners: '4' },
    ];
    const result = buildRetentionCurve(rows, 10, 60000); // 6 buckets

    expect(result.curve).toHaveLength(6);
    expect(result.curve[0]).toBe(1);
    expect(result.curve[1]).toBe(0.8);
    expect(result.curve[3]).toBe(0); // gap = nobody listening
    expect(result.bucketMs).toBe(RETENTION_BUCKET_MS);
  });

  it('finds the peak-retention segment for waveform highlighting', () => {
    const rows = [
      { bucket: '0', listeners: '5' },
      { bucket: '3', listeners: '9' },
    ];
    const result = buildRetentionCurve(rows, 10, 60000);
    expect(result.peak).toEqual({ bucket: 3, startMs: 30000, retention: 0.9 });
  });

  it('caps retention at 1 and survives zero plays', () => {
    const spike = buildRetentionCurve([{ bucket: '0', listeners: '50' }], 10, 20000);
    expect(spike.curve[0]).toBe(1);

    const empty = buildRetentionCurve([], 0, 20000);
    expect(empty.curve.every((v) => v === 0)).toBe(true);
  });
});

describe('overview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('parses every aggregate and derives completion/skip rates', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ plays: '200', completes: '120', skips: '30', unique_listeners: '85', total_listen_ms: '5400000' }],
    });

    const result = await analyticsService.overview(7, { days: 30 });

    expect(result).toEqual({
      days: 30,
      plays: 200,
      completes: 120,
      skips: 30,
      uniqueListeners: 85,
      totalListenMs: 5400000,
      completionRate: 0.6,
      skipRate: 0.15,
    });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('s.uploaded_by = $1');
    expect(params[0]).toBe(7);
  });
});

describe('topTracks and geography', () => {
  beforeEach(() => jest.clearAllMocks());

  it('maps top tracks with per-track skip rates', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 1, title: 'Pulse', genre: 'Techno', plays: '100', completes: '60', skips: '25', unique_listeners: '40' }],
    });

    const tracks = await analyticsService.topTracks(7);
    expect(tracks[0]).toMatchObject({ songId: 1, plays: 100, skipRate: 0.25 });
  });

  it('aggregates geography with parseInt on counts', async () => {
    db.query.mockResolvedValueOnce({
      rows: [
        { country: 'DE', plays: '500', unique_listeners: '120' },
        { country: '??', plays: '20', unique_listeners: '9' },
      ],
    });

    const countries = await analyticsService.geography(7);
    expect(countries[0]).toEqual({ country: 'DE', plays: 500, uniqueListeners: 120 });
  });
});

describe('revenueByTrack', () => {
  beforeEach(() => jest.clearAllMocks());

  it('joins the ledger through purchases to songs (artist share only)', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ id: 3, title: 'Pulse', artist_cents: '2400', sales: '3' }],
    });

    const tracks = await analyticsService.revenueByTrack(7);
    expect(tracks[0]).toEqual({ songId: 3, title: 'Pulse', artistCents: 2400, sales: 3 });
    expect(db.query.mock.calls[0][0]).toContain(`entry_type = 'artist_share'`);
  });
});

describe('processRollupJob', () => {
  beforeEach(() => jest.clearAllMocks());

  it('upserts song_daily_stats for the requested day', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ song_id: 1 }, { song_id: 2 }] });

    const result = await analyticsService.processRollupJob({ day: '2026-08-24' });

    expect(result).toEqual({ day: '2026-08-24', songsRolledUp: 2 });
    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('INSERT INTO song_daily_stats');
    expect(sql).toContain('ON CONFLICT (song_id, day) DO UPDATE');
    expect(params).toEqual(['2026-08-24']);
  });

  it('defaults to yesterday (UTC)', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const result = await analyticsService.processRollupJob({});
    expect(result.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
