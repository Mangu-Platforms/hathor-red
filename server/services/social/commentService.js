/**
 * Time-synced track comments (Pillar 4, FR-401): SoundCloud-style comments
 * anchored to a millisecond offset in a song. The player fetches windows as
 * playback progresses and pops each comment at its moment.
 *
 * Redis sorted sets (comments:<songId>, scored by timestamp_ms) are the hot
 * window cache; Postgres is the source of truth. Every Redis touch is
 * fallback-wrapped per the repo doctrine.
 */

const db = require('../../config/database');
const { redisClient } = require('../../config/redis');
const { logger } = require('../../utils/logger');

const COMMENT_CACHE_TTL = 1800;
const MAX_COMMENT_LENGTH = 500;

function sanitizeCommentBody(body) {
  return String(body || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim()
    .slice(0, MAX_COMMENT_LENGTH);
}

function cacheKey(songId) {
  return `comments:${songId}`;
}

async function cacheComment(songId, comment) {
  try {
    const key = cacheKey(songId);
    await redisClient.zAdd(key, [{ score: comment.timestamp_ms, value: JSON.stringify(comment) }]);
    await redisClient.expire(key, COMMENT_CACHE_TTL);
  } catch (err) {
    logger.warn(`Comment cache write failed (DB is source of truth): ${err.message}`);
  }
}

/** Add a comment at a timestamp. Returns the stored row with username. */
async function addComment({ songId, userId, body, timestampMs }) {
  const sanitized = sanitizeCommentBody(body);
  if (!sanitized) {
    const err = new Error('Comment body is empty after sanitization');
    err.status = 400;
    throw err;
  }

  const songResult = await db.query('SELECT id, duration FROM songs WHERE id = $1', [songId]);
  if (songResult.rows.length === 0) {
    const err = new Error('Song not found');
    err.status = 404;
    throw err;
  }
  const durationMs = (parseInt(songResult.rows[0].duration, 10) || 0) * 1000;
  if (durationMs > 0 && timestampMs > durationMs) {
    const err = new Error('Timestamp is beyond the end of the track');
    err.status = 400;
    throw err;
  }

  const result = await db.query(
    `INSERT INTO track_comments (song_id, user_id, body, timestamp_ms)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [songId, userId, sanitized, timestampMs]
  );
  const comment = result.rows[0];

  const userResult = await db.query('SELECT username, display_name FROM users WHERE id = $1', [userId]);
  const enriched = {
    ...comment,
    username: userResult.rows[0]?.username || null,
    display_name: userResult.rows[0]?.display_name || null,
  };

  await cacheComment(songId, enriched);
  return enriched;
}

/**
 * Fetch comments in a [fromMs, toMs] window. Tries the Redis sorted set
 * first; falls back to (and refills from) Postgres.
 */
async function getCommentsWindow({ songId, fromMs = 0, toMs = null, limit = 100 }) {
  const upper = toMs === null ? Number.MAX_SAFE_INTEGER : toMs;

  try {
    const cached = await redisClient.zRangeByScore(cacheKey(songId), fromMs, upper, { LIMIT: { offset: 0, count: limit } });
    if (cached && cached.length > 0) {
      return { comments: cached.map((c) => JSON.parse(c)), source: 'cache' };
    }
  } catch {
    // fall through to DB
  }

  const params = [songId, fromMs];
  let query = `
    SELECT c.*, u.username, u.display_name
    FROM track_comments c
    JOIN users u ON u.id = c.user_id
    WHERE c.song_id = $1 AND c.timestamp_ms >= $2`;
  if (toMs !== null) {
    params.push(toMs);
    query += ` AND c.timestamp_ms <= $${params.length}`;
  }
  params.push(Math.min(limit, 500));
  query += ` ORDER BY c.timestamp_ms ASC LIMIT $${params.length}`;

  const result = await db.query(query, params);

  // Best-effort refill of the hot window.
  for (const row of result.rows) {
    await cacheComment(songId, row);
  }

  return { comments: result.rows, source: 'db' };
}

/** Delete a comment (author or admin — authorization decided by caller). */
async function deleteComment({ commentId }) {
  const result = await db.query('DELETE FROM track_comments WHERE id = $1 RETURNING song_id', [commentId]);
  if (result.rows.length === 0) return false;

  try {
    // Cheap invalidation: drop the whole song's cached set.
    await redisClient.del(cacheKey(result.rows[0].song_id));
  } catch {
    // cache will expire on its own
  }
  return true;
}

async function getCommentAuthor(commentId) {
  const result = await db.query('SELECT user_id FROM track_comments WHERE id = $1', [commentId]);
  return result.rows.length > 0 ? result.rows[0].user_id : null;
}

module.exports = {
  MAX_COMMENT_LENGTH,
  sanitizeCommentBody,
  addComment,
  getCommentsWindow,
  deleteComment,
  getCommentAuthor,
};
