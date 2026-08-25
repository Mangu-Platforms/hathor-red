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
const searchService = require('../services/discovery/searchService');
const { embedSong } = require('../services/discovery/embeddingService');
const { parseIntent, rankCandidates } = searchService;

const catalog = [
  { id: 1, title: 'Bassline Reactor', artist: 'Subsonic', genre: 'Techno', bpm: 130, created_at: new Date().toISOString() },
  { id: 2, title: 'Neon Rain', artist: 'Nightdrive', genre: 'Electronic', bpm: 100, created_at: new Date(Date.now() - 30 * 86400000).toISOString() },
  { id: 3, title: 'Front Porch Song', artist: 'Willow Creek', genre: 'Folk', bpm: 78, created_at: new Date(Date.now() - 200 * 86400000).toISOString() },
  { id: 4, title: 'Moonlit Sonata Reimagined', artist: 'Ivory Keys', genre: 'Classical', bpm: 60, created_at: new Date(Date.now() - 100 * 86400000).toISOString() },
].map((song) => ({ ...song, embedding: embedSong(song) }));

describe('parseIntent', () => {
  it('extracts explicit genres, hint genres, bpm, and moods', () => {
    expect(parseIntent('sad rainy night synthwave')).toEqual({
      genres: ['Electronic'],
      bpm: null,
      moods: expect.arrayContaining(['sad', 'dark']),
    });

    const intent = parseIntent('bass-heavy techno around 128 bpm for a workout');
    expect(intent.genres).toContain('Techno');
    expect(intent.bpm).toBe(128);
    expect(intent.moods).toContain('energetic');
  });

  it('returns empty intent for plain queries', () => {
    expect(parseIntent('greetings friend')).toEqual({ genres: [], bpm: null, moods: [] });
  });

  it('matches genres on word boundaries, not substrings', () => {
    // "popcorn" must not trigger Pop; "seoul" must not trigger Soul.
    expect(parseIntent('popcorn seoul playlist').genres).toEqual([]);
    expect(parseIntent('some pop music').genres).toContain('Pop');
    expect(parseIntent('hip hop classics').genres).toContain('Hip Hop');
  });
});

describe('rankCandidates', () => {
  it('ranks bass-heavy techno above folk for a techno query (FR-201 AC)', () => {
    const { results } = rankCandidates('bass-heavy techno 130 bpm', catalog, { limit: 4 });
    const ids = results.map((r) => r.song.id);
    expect(ids[0]).toBe(1);
    expect(ids.indexOf(1)).toBeLessThan(ids.indexOf(3));
  });

  it('ranks the classical piece top for a classical piano query', () => {
    const { results } = rankCandidates('classical piano sonata', catalog, { limit: 4 });
    expect(results[0].song.id).toBe(4);
  });

  it('every result carries at least one human-readable reason', () => {
    const { results } = rankCandidates('sad rainy night synthwave', catalog, { limit: 4 });
    for (const r of results) {
      expect(r.reasons.length).toBeGreaterThan(0);
      expect(typeof r.reasons[0]).toBe('string');
    }
  });

  it('respects the limit', () => {
    const { results } = rankCandidates('music', catalog, { limit: 2 });
    expect(results).toHaveLength(2);
  });
});

describe('semanticSearch (end to end over mocked DB)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('fetches candidates with escaped ILIKE and returns trimmed song shapes', async () => {
    db.query.mockResolvedValueOnce({
      rows: catalog.map((c) => ({ ...c, embedding: JSON.stringify(c.embedding) })),
    });

    const result = await searchService.semanticSearch('techno 100% _bass_', { limit: 3 });

    const [sql, params] = db.query.mock.calls[0];
    expect(sql).toContain('song_embeddings_local');
    expect(params[0]).toContain('\\%');
    expect(params[0]).toContain('\\_');
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].song).not.toHaveProperty('file_path');
    expect(result.results[0].song).not.toHaveProperty('embedding');
  });
});

describe('similarSongs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns embedding neighbors sorted by similarity', async () => {
    db.query
      .mockResolvedValueOnce({ rows: [{ ...catalog[0], embedding: JSON.stringify(catalog[0].embedding) }] })
      .mockResolvedValueOnce({
        rows: catalog.slice(1).map((c) => ({ ...c, embedding: JSON.stringify(c.embedding) })),
      });

    const result = await searchService.similarSongs(1, { limit: 2 });
    expect(result.similar).toHaveLength(2);
    expect(result.similar[0].score).toBeGreaterThanOrEqual(result.similar[1].score);
  });

  it('returns null for a missing song', async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    expect(await searchService.similarSongs(999)).toBeNull();
  });
});
