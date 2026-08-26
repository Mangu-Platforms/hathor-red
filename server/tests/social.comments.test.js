jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../config/redis', () => ({
  redisClient: {
    isReady: false,
    get: jest.fn(),
    setEx: jest.fn(),
    incr: jest.fn(),
  },
  getRedisClient: jest.fn(() => null),
  connectRedis: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

const db = require('../config/database');
const { redisClient } = require('../config/redis');
const commentService = require('../services/social/commentService');

describe('commentService', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('sanitizeCommentBody', () => {
    it('escapes HTML and enforces the length cap', () => {
      expect(commentService.sanitizeCommentBody('<script>alert(1)</script>')).toBe(
        '&lt;script&gt;alert(1)&lt;/script&gt;'
      );
      expect(commentService.sanitizeCommentBody('x'.repeat(600))).toHaveLength(500);
      expect(commentService.sanitizeCommentBody('   ')).toBe('');
    });
  });

  describe('addComment', () => {
    it('stores a sanitized comment and bumps the song cache version', async () => {
      redisClient.incr.mockRejectedValue(new Error('redis down')); // bump must be optional
      db.query
        .mockResolvedValueOnce({ rows: [{ id: 5, duration: 200 }] }) // song lookup
        .mockResolvedValueOnce({ rows: [{ id: 31, song_id: 5, user_id: 2, body: 'fire drop &lt;3', timestamp_ms: 165000 }] })
        .mockResolvedValueOnce({ rows: [{ username: 'max', display_name: 'Max' }] });

      const comment = await commentService.addComment({
        songId: 5,
        userId: 2,
        body: 'fire drop <3',
        timestampMs: 165000,
      });

      expect(comment.username).toBe('max');
      const insert = db.query.mock.calls[1];
      expect(insert[0]).toContain('INSERT INTO track_comments');
      expect(insert[1][2]).toBe('fire drop &lt;3');
      expect(redisClient.incr).toHaveBeenCalledWith('comments:5:ver');
    });

    it('rejects timestamps beyond the end of the track', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: 5, duration: 100 }] });
      await expect(
        commentService.addComment({ songId: 5, userId: 2, body: 'late', timestampMs: 150000 })
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects comments that sanitize to nothing and missing songs', async () => {
      await expect(
        commentService.addComment({ songId: 5, userId: 2, body: '   ', timestampMs: 0 })
      ).rejects.toMatchObject({ status: 400 });

      db.query.mockResolvedValueOnce({ rows: [] });
      await expect(
        commentService.addComment({ songId: 999, userId: 2, body: 'hi', timestampMs: 0 })
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('getCommentsWindow', () => {
    it('serves a version-stamped cached window when present', async () => {
      redisClient.get
        .mockResolvedValueOnce('3') // version key
        .mockResolvedValueOnce(JSON.stringify([{ id: 1, timestamp_ms: 1000 }]));

      const result = await commentService.getCommentsWindow({ songId: 5, fromMs: 0, toMs: 5000 });

      expect(result.source).toBe('cache');
      expect(result.comments[0].id).toBe(1);
      expect(redisClient.get.mock.calls[1][0]).toBe('comments:5:v3:0:5000:100');
      expect(db.query).not.toHaveBeenCalled();
    });

    it('a write bumps the version so stale windows can never serve (completeness)', async () => {
      // version moved from 3 to 4 → the v3 window key is never consulted
      redisClient.get
        .mockResolvedValueOnce('4')
        .mockResolvedValueOnce(null);
      redisClient.setEx.mockResolvedValueOnce('OK');
      db.query.mockResolvedValueOnce({ rows: [{ id: 2, timestamp_ms: 2000 }] });

      const result = await commentService.getCommentsWindow({ songId: 5, fromMs: 0, toMs: 5000 });

      expect(result.source).toBe('db');
      expect(redisClient.setEx.mock.calls[0][0]).toBe('comments:5:v4:0:5000:100');
    });

    it('falls back to a windowed parameterized DB query when Redis fails', async () => {
      redisClient.get.mockRejectedValueOnce(new Error('redis down'));
      db.query.mockResolvedValueOnce({ rows: [{ id: 2, timestamp_ms: 2000, username: 'ana' }] });

      const result = await commentService.getCommentsWindow({ songId: 5, fromMs: 1000, toMs: 3000, limit: 10 });

      expect(result.source).toBe('db');
      const [sql, params] = db.query.mock.calls[0];
      expect(sql).toContain('timestamp_ms >= $2');
      expect(sql).toContain('timestamp_ms <= $3');
      expect(params).toEqual([5, 1000, 3000, 10]);
      // no cache write without a usable cache key
      expect(redisClient.setEx).not.toHaveBeenCalled();
    });
  });

  describe('deleteComment', () => {
    it('deletes and bumps the song cache version', async () => {
      db.query.mockResolvedValueOnce({ rows: [{ song_id: 5 }] });
      redisClient.incr.mockResolvedValueOnce(4);

      expect(await commentService.deleteComment({ commentId: 9 })).toBe(true);
      expect(redisClient.incr).toHaveBeenCalledWith('comments:5:ver');
    });

    it('returns false for a missing comment', async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      expect(await commentService.deleteComment({ commentId: 9 })).toBe(false);
    });
  });
});
