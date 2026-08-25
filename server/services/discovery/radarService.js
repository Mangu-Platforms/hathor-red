/**
 * Mangu Radar (Pillar 2, FR-202): a personalized mix blending
 *  1. co-listening collaborative filtering — songs played by listeners who
 *     share your history (ALS-style signal computed with plain SQL counts),
 *  2. content similarity — embedding cosine against the centroid of your
 *     recent listening,
 *  3. freshness — new catalog additions get a boost so the mix never stales.
 *
 * Redis holds the hot copy (radar:<userId>); the user_radar table is the
 * durable fallback so a Redis flush never blanks anyone's mix.
 */

const db = require('../../config/database');
const { redisClient } = require('../../config/redis');
const { logger } = require('../../utils/logger');
const { cosineSimilarity } = require('./embeddingService');

const RADAR_SIZE = 30;
const RADAR_CACHE_TTL = 3600;

function parseEmbedding(value) {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

/** Centroid of a list of vectors (all same dims). Pure. */
function centroid(vectors) {
  const valid = vectors.filter((v) => Array.isArray(v) && v.length > 0);
  if (valid.length === 0) return null;
  const dims = valid[0].length;
  const sum = new Array(dims).fill(0);
  for (const vector of valid) {
    for (let i = 0; i < dims; i += 1) sum[i] += vector[i];
  }
  return sum.map((v) => v / valid.length);
}

/**
 * Blend the three signals into a ranked track list. Pure — unit tested.
 * Inputs:
 *  - coListen: [{song_id, weight}] collaborative counts (already excludes own history)
 *  - candidates: [{...song, embedding}] catalog candidates (excludes own history)
 *  - tasteCentroid: vector | null
 */
function blendRadar({ coListen, candidates, tasteCentroid, size = RADAR_SIZE }) {
  const coListenMap = new Map();
  const maxWeight = coListen.reduce((max, row) => Math.max(max, parseInt(row.weight, 10)), 0);
  for (const row of coListen) {
    coListenMap.set(row.song_id, maxWeight > 0 ? parseInt(row.weight, 10) / maxWeight : 0);
  }

  const scored = [];
  for (const song of candidates) {
    const cf = coListenMap.get(song.id) || 0;
    const embedding = parseEmbedding(song.embedding);
    const content = tasteCentroid && embedding ? Math.max(0, cosineSimilarity(tasteCentroid, embedding)) : 0;
    const ageDays = song.created_at ? (Date.now() - new Date(song.created_at).getTime()) / 86400000 : 999;
    const freshness = Math.max(0, 1 - ageDays / 30);

    const score = 0.45 * cf + 0.35 * content + 0.2 * freshness;
    if (score <= 0) continue;

    const reasons = [];
    if (cf > 0.3) reasons.push('listeners like you have this on repeat');
    else if (cf > 0) reasons.push('picked up by listeners who share your taste');
    if (content > 0.3) reasons.push('close to the sound of your recent plays');
    if (freshness > 0.5) reasons.push('fresh this month');
    if (reasons.length === 0) reasons.push('a wildcard to stretch your rotation');

    scored.push({
      songId: song.id,
      title: song.title,
      artist: song.artist,
      genre: song.genre,
      coverUrl: song.cover_url,
      score: Math.round(score * 1000) / 1000,
      reasons,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, size);
}

/** Regenerate a user's radar from the database and persist it. */
async function generateRadar(userId, { size = RADAR_SIZE } = {}) {
  // 1. Collaborative signal: what do listeners with overlapping history play
  //    that this user hasn't heard yet? COUNT comes back as a string (bigint).
  const coListen = await db.query(
    `SELECT lh2.song_id, COUNT(*) AS weight
     FROM listening_history lh1
     JOIN listening_history lh2
       ON lh2.user_id = lh1.user_id AND lh2.song_id <> lh1.song_id
     WHERE lh1.song_id IN (
             SELECT song_id FROM listening_history WHERE user_id = $1
             ORDER BY listened_at DESC LIMIT 50
           )
       AND lh2.user_id <> $1
       AND lh2.song_id NOT IN (SELECT song_id FROM listening_history WHERE user_id = $1)
     GROUP BY lh2.song_id
     ORDER BY weight DESC
     LIMIT 200`,
    [userId]
  );

  // 2. Taste centroid from the user's recent listening embeddings.
  const recent = await db.query(
    `SELECT e.embedding
     FROM listening_history lh
     JOIN song_embeddings_local e ON e.song_id = lh.song_id
     WHERE lh.user_id = $1
     ORDER BY lh.listened_at DESC
     LIMIT 30`,
    [userId]
  );
  const tasteCentroid = centroid(recent.rows.map((row) => parseEmbedding(row.embedding)));

  // 3. Candidates: embedded or recent songs the user hasn't heard.
  const candidates = await db.query(
    `SELECT s.*, e.embedding
     FROM songs s
     LEFT JOIN song_embeddings_local e ON e.song_id = s.id
     WHERE s.id NOT IN (SELECT song_id FROM listening_history WHERE user_id = $1)
     ORDER BY s.created_at DESC
     LIMIT 500`,
    [userId]
  );

  const tracks = blendRadar({
    coListen: coListen.rows,
    candidates: candidates.rows,
    tasteCentroid,
    size,
  });

  const payload = { userId, tracks, generatedAt: new Date().toISOString() };

  await db.query(
    `INSERT INTO user_radar (user_id, tracks, generated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (user_id) DO UPDATE SET tracks = $2, generated_at = CURRENT_TIMESTAMP`,
    [userId, JSON.stringify(tracks)]
  );

  try {
    await redisClient.setEx(`radar:${userId}`, RADAR_CACHE_TTL, JSON.stringify(payload));
  } catch (err) {
    logger.warn(`Radar cache write failed (DB copy persisted): ${err.message}`);
  }

  return payload;
}

/** Read the radar: Redis → user_radar table → generate on miss. */
async function getRadar(userId, { forceRefresh = false } = {}) {
  if (!forceRefresh) {
    try {
      const cached = await redisClient.get(`radar:${userId}`);
      if (cached) return { ...JSON.parse(cached), source: 'cache' };
    } catch {
      // fall through to DB
    }

    const stored = await db.query('SELECT tracks, generated_at FROM user_radar WHERE user_id = $1', [userId]);
    if (stored.rows.length > 0) {
      const row = stored.rows[0];
      return {
        userId,
        tracks: typeof row.tracks === 'string' ? JSON.parse(row.tracks) : row.tracks,
        generatedAt: row.generated_at,
        source: 'store',
      };
    }
  }

  const generated = await generateRadar(userId);
  return { ...generated, source: 'generated' };
}

/**
 * Job handler 'radar-refresh'. Payload: { userId } for one user, or {} to
 * refresh everyone active in the last 7 days.
 */
async function processRadarRefreshJob(payload = {}) {
  if (payload.userId) {
    await generateRadar(payload.userId);
    return { refreshed: 1 };
  }

  const active = await db.query(
    `SELECT DISTINCT user_id FROM listening_history
     WHERE listened_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
     LIMIT 1000`
  );
  for (const row of active.rows) {
    await generateRadar(row.user_id);
  }
  return { refreshed: active.rows.length };
}

module.exports = {
  RADAR_SIZE,
  centroid,
  blendRadar,
  generateRadar,
  getRadar,
  processRadarRefreshJob,
};
