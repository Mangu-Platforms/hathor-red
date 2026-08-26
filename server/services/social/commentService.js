/**
 * Time-synced track comments (Pillar 4, FR-401): SoundCloud-style comments
 * anchored to a millisecond offset in a song. The player fetches windows as
 * playback progresses and pops each comment at its moment.
 *
 * Caching: whole window results are cached under a per-song VERSION-stamped
 * key (comments:<songId>:v<N>:<window>), and every write bumps the version —
 * so a cached window is always complete for its version, never a partial
 * shard. Postgres is the source of truth; every Redis touch is
 * fallback-wrapped per the repo doctrine.
 */

const db = require('../../config/database');
const { redisClient } = require('../../config/redis');
const { logger } = require('../../utils/logger');

const WINDOW_CACHE_TTL = 300;
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

function versionKey(songId) {
  return `comments:${songId}:ver`;
}

async function currentVersion(songId) {
  const raw = await redisClient.get(versionKey(songId));
  return parseInt(raw, 10) || 0;
}

async function bumpVersion(songId) {
  try {
    await redisClient.incr(versionKey(songId));
  } catch (err) {
    logger.warn(`Comment cache version bump failed (windows expire by TTL): ${err.message}`);
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

  await bumpVersion(songId);
  return enriched;
}

/**
 * Fetch comments in a [fromMs, toMs] window. Serves a version-stamped cached
 * window when present; otherwise reads Postgres and caches the full result.
 */
async function getCommentsWindow({ songId, fromMs = 0, toMs = null, limit = 100 }) {
  const boundedLimit = Math.min(limit, 500);
  let cacheKey = null;

  try {
    const version = await currentVersion(songId);
    cacheKey = `comments:${songId}:v${version}:${fromMs}:${toMs === null ? 'end' : toMs}:${boundedLimit}`;
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      return { comments: JSON.parse(cached), source: 'cache' };
    }
  } catch {
    cacheKey = null; // Redis down — serve from DB, skip the cache write
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
  params.push(boundedLimit);
  query += ` ORDER BY c.timestamp_ms ASC LIMIT $${params.length}`;

  const result = await db.query(query, params);

  if (cacheKey) {
    try {
      await redisClient.setEx(cacheKey, WINDOW_CACHE_TTL, JSON.stringify(result.rows));
    } catch {
      // cache write is best-effort
    }
  }

  return { comments: result.rows, source: 'db' };
}

/** Delete a comment (author or admin — authorization decided by caller). */
async function deleteComment({ commentId }) {
  const result = await db.query('DELETE FROM track_comments WHERE id = $1 RETURNING song_id', [commentId]);
  if (result.rows.length === 0) return false;

  await bumpVersion(result.rows[0].song_id);
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
