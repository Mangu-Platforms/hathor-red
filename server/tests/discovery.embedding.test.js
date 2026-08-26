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
const embeddingService = require('../services/discovery/embeddingService');
const { DIMS, embedSong, embedQuery, cosineSimilarity, songText } = embeddingService;

describe('embeddingService (mangu-feature-hash-v1)', () => {
  const techno = { id: 1, title: 'Warehouse Pulse', artist: 'DJ Volt', genre: 'Techno', bpm: 128 };
  const technoTwin = { id: 2, title: 'Factory Pulse', artist: 'DJ Amp', genre: 'Techno', bpm: 126 };
  const folk = { id: 3, title: 'Mountain Morning', artist: 'Willow Creek', genre: 'Folk', bpm: 82 };

  it('produces deterministic, L2-normalized vectors of the configured dims', () => {
    const a = embedSong(techno);
    const b = embedSong(techno);
    expect(a).toEqual(b);
    expect(a).toHaveLength(DIMS);
    const norm = Math.sqrt(a.reduce((acc, v) => acc + v * v, 0));
    expect(norm).toBeCloseTo(1, 6);
  });

  it('places same-genre same-tempo songs closer than cross-genre songs', () => {
    const simTwin = cosineSimilarity(embedSong(techno), embedSong(technoTwin));
    const simCross = cosineSimilarity(embedSong(techno), embedSong(folk));
    expect(simTwin).toBeGreaterThan(simCross);
  });

  it('query embeddings live in the same space as song embeddings', () => {
    const query = embedQuery('driving techno 128 warehouse');
    const simTechno = cosineSimilarity(query, embedSong(techno));
    const simFolk = cosineSimilarity(query, embedSong(folk));
    expect(simTechno).toBeGreaterThan(simFolk);
  });

  it('cosine of a vector with itself is 1; empty input embeds to zero vector', () => {
    const v = embedQuery('anything at all');
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 6);
    expect(embedQuery('')).toEqual(new Array(DIMS).fill(0));
  });

  it('songText folds in genre (double weight), bpm bucket, era, and key', () => {
    const text = songText({ title: 'T', artist: 'A', genre: 'Jazz', bpm: 93, year: 1987, key_signature: 'Am' });
    expect(text).toContain('Jazz Jazz');
    expect(text).toContain('bpm100'); // 93 rounds to the 100 bucket
    expect(text).toContain('era1980s');
    expect(text).toContain('keyam');
  });

  describe('upsertSongEmbedding', () => {
    it('writes a parameterized upsert with the serialized vector', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      await embeddingService.upsertSongEmbedding(techno);

      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('INSERT INTO song_embeddings_local');
      expect(sql).toContain('ON CONFLICT (song_id) DO UPDATE');
      expect(params[0]).toBe(1);
      expect(JSON.parse(params[1])).toHaveLength(DIMS);
      expect(params[2]).toBe('mangu-feature-hash-v1');
    });
  });

  describe('processEmbedJob', () => {
    beforeEach(() => jest.clearAllMocks());

    it('embeds a single song when songId is given', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [techno] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await embeddingService.processEmbedJob({ songId: 1 });
      expect(result).toEqual({ embedded: 1 });
    });

    it('backfills songs missing embeddings in batches', async () => {
      db.query
        .mockResolvedValueOnce({ rows: [techno, folk] })
        .mockResolvedValue({ rows: [] });

      const result = await embeddingService.processEmbedJob({});
      expect(result.embedded).toBe(2);
      expect(result.remainingBatch).toBe(false);
    });
  });
});
