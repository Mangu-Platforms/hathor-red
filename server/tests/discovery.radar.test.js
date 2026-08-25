jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../config/redis', () => ({
  redisClient: { isReady: false, get: jest.fn(), setEx: jest.fn() },
  getRedisClient: jest.fn(() => null),
  connectRedis: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

const db = require('../config/database');
const { redisClient } = require('../config/redis');
const radarService = require('../services/discovery/radarService');
const { embedSong } = require('../services/discovery/embeddingService');
const { centroid, blendRadar } = radarService;

describe('centroid', () => {
  it('averages vectors and ignores invalid entries', () => {
    expect(centroid([[1, 0], [0, 1], null, []])).toEqual([0.5, 0.5]);
    expect(centroid([])).toBeNull();
    expect(centroid([null])).toBeNull();
  });
});

describe('blendRadar', () => {
  const technoA = { id: 1, title: 'Pulse', artist: 'Volt', genre: 'Techno', bpm: 128, created_at: new Date().toISOString() };
  const technoB = { id: 2, title: 'Surge', artist: 'Amp', genre: 'Techno', bpm: 126, created_at: new Date().toISOString() };
  const folk = { id: 3, title: 'Porch', artist: 'Creek', genre: 'Folk', bpm: 80, created_at: new Date(Date.now() - 120 * 86400000).toISOString() };

  const candidates = [technoA, technoB, folk].map((s) => ({ ...s, embedding: embedSong(s) }));

  it('weights collaborative co-listen counts (bigint strings) correctly', () => {
    const tracks = blendRadar({
      coListen: [
        { song_id: 3, weight: '40' },
        { song_id: 2, weight: '10' },
      ],
      candidates,
      tasteCentroid: null,
    });
    // Folk has the dominant CF weight, so it must outrank techno B here.
    const ids = tracks.map((t) => t.songId);
    expect(ids.indexOf(3)).toBeLessThan(ids.indexOf(2));
    expect(tracks[0].reasons.length).toBeGreaterThan(0);
  });

  it('content similarity pulls taste-adjacent songs up when CF is silent', () => {
    const tracks = blendRadar({
      coListen: [],
      candidates,
      tasteCentroid: embedSong(technoA),
    });
    const first = tracks[0];
    expect([1, 2]).toContain(first.songId);
  });

  it('caps the mix at the requested size and dedupes by construction', () => {
    const tracks = blendRadar({
      coListen: [],
      candidates,
      tasteCentroid: embedSong(technoA),
      size: 2,
    });
    expect(tracks.length).toBeLessThanOrEqual(2);
    expect(new Set(tracks.map((t) => t.songId)).size).toBe(tracks.length);
  });
});

describe('getRadar fallbacks', () => {
  beforeEach(() => jest.clearAllMocks());

  it('serves from Redis when the hot cache hits', async () => {
    redisClient.get.mockResolvedValueOnce(JSON.stringify({ userId: 5, tracks: [{ songId: 1 }] }));

    const radar = await radarService.getRadar(5);
    expect(radar.source).toBe('cache');
    expect(db.query).not.toHaveBeenCalled();
  });

  it('falls back to the user_radar table when Redis throws', async () => {
    redisClient.get.mockRejectedValueOnce(new Error('redis down'));
    db.query.mockResolvedValueOnce({
      rows: [{ tracks: JSON.stringify([{ songId: 2 }]), generated_at: '2026-08-25T00:00:00Z' }],
    });

    const radar = await radarService.getRadar(5);
    expect(radar.source).toBe('store');
    expect(radar.tracks).toEqual([{ songId: 2 }]);
  });

  it('generates (and persists) when neither cache layer has a copy', async () => {
    redisClient.get.mockResolvedValueOnce(null);
    redisClient.setEx.mockRejectedValueOnce(new Error('redis down'));
    // store miss, then generateRadar's queries: coListen, recent embeddings,
    // candidates, upsert
    db.query
      .mockResolvedValueOnce({ rows: [] }) // user_radar store miss
      .mockResolvedValueOnce({ rows: [{ song_id: 1, weight: '3' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 1, title: 'Pulse', artist: 'Volt', genre: 'Techno', created_at: new Date().toISOString(), embedding: null }] })
      .mockResolvedValueOnce({ rows: [] }); // upsert

    const radar = await radarService.getRadar(5);
    expect(radar.source).toBe('generated');
    expect(radar.tracks.length).toBeGreaterThan(0);

    const upsert = db.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO user_radar'));
    expect(upsert).toBeTruthy();
  });
});
