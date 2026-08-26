/**
 * GDPR data export (Olympus M6, FR-602).
 *
 * Flow: user requests an export → gdpr-export job assembles every table that
 * references them into one JSON artifact under uploads/exports/ → the request
 * row flips to 'ready' with a download token valid 72 hours. The token is the
 * credential (long random hex), matching the manifesto's secure-link AC; the
 * artifact is deleted when a fresh export supersedes it.
 */

const crypto = require('crypto');
const fsp = require('fs/promises');
const path = require('path');

const db = require('../../config/database');
const { logger } = require('../../utils/logger');
const { UPLOAD_DIR } = require('../../config/constants');
const jobQueue = require('../jobs/jobQueue');

const EXPORT_TTL_HOURS = 72;

function exportDir() {
  return path.join(UPLOAD_DIR, 'exports');
}

/** Create a request and queue the job. One in-flight request per user. */
async function requestExport(userId) {
  const inFlight = await db.query(
    `SELECT id FROM data_export_requests
     WHERE user_id = $1 AND status IN ('pending', 'processing')`,
    [userId]
  );
  if (inFlight.rows.length > 0) {
    const err = new Error('An export is already being prepared');
    err.status = 409;
    throw err;
  }

  const inserted = await db.query(
    `INSERT INTO data_export_requests (user_id, status) VALUES ($1, 'pending') RETURNING *`,
    [userId]
  );
  const request = inserted.rows[0];
  await jobQueue.enqueue('gdpr-export', { requestId: request.id }, { createdBy: userId });
  return request;
}

async function collect(query, params) {
  const result = await db.query(query, params);
  return result.rows;
}

/** Assemble every table that references the user. */
async function assembleUserData(userId) {
  const [profile] = await collect(
    `SELECT id, username, email, display_name, avatar_url, role, created_at, updated_at
     FROM users WHERE id = $1`,
    [userId]
  );

  return {
    exportVersion: 1,
    generatedAt: new Date().toISOString(),
    profile: profile || null,
    playlists: await collect(
      `SELECT p.*, COALESCE(json_agg(json_build_object('songId', ps.song_id, 'position', ps.position))
              FILTER (WHERE ps.id IS NOT NULL), '[]') AS songs
       FROM playlists p LEFT JOIN playlist_songs ps ON ps.playlist_id = p.id
       WHERE p.user_id = $1 GROUP BY p.id`,
      [userId]
    ),
    uploadedSongs: await collect('SELECT id, title, artist, album, genre, year, created_at FROM songs WHERE uploaded_by = $1', [userId]),
    listeningHistory: await collect('SELECT song_id, listened_at, duration_played, completion_rate FROM listening_history WHERE user_id = $1', [userId]),
    listeningEvents: await collect('SELECT song_id, event_type, position_ms, duration_ms, country, source, created_at FROM listening_events WHERE user_id = $1', [userId]),
    playbackState: await collect('SELECT current_song_id, position, is_playing, volume, playback_speed, updated_at FROM playback_states WHERE user_id = $1', [userId]),
    purchases: await collect('SELECT id, product_id, amount_cents, currency, status, created_at FROM purchases WHERE buyer_user_id = $1', [userId]),
    library: await collect('SELECT song_id, acquired_at FROM user_library WHERE user_id = $1', [userId]),
    subscriptions: await collect('SELECT tier_id, artist_user_id, status, current_period_start, current_period_end, created_at FROM artist_subscriptions WHERE fan_user_id = $1', [userId]),
    productsSold: await collect('SELECT id, title, product_type, price_cents, active, created_at FROM products WHERE artist_user_id = $1', [userId]),
    revenue: await collect(`SELECT entry_type, amount_cents, currency, created_at FROM revenue_ledger WHERE artist_user_id = $1 AND entry_type = 'artist_share'`, [userId]),
    trackComments: await collect('SELECT song_id, body, timestamp_ms, created_at FROM track_comments WHERE user_id = $1', [userId]),
    chatMessages: await collect('SELECT room_id, message, created_at FROM chat_messages WHERE user_id = $1', [userId]),
    roomsHosted: await collect('SELECT id, name, is_public, created_at FROM listening_rooms WHERE host_id = $1', [userId]),
    follows: await collect('SELECT following_id, created_at FROM user_follows WHERE follower_id = $1', [userId]),
    likes: await collect('SELECT song_id, created_at FROM song_likes WHERE user_id = $1', [userId]),
    auditTrail: await collect('SELECT action, target_type, target_id, created_at FROM audit_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000', [userId]),
  };
}

/** Job handler 'gdpr-export'. Payload: { requestId }. */
async function processExportJob(payload) {
  const requestId = parseInt(payload.requestId, 10);
  if (!requestId) throw new Error('gdpr-export job missing requestId');

  const requestResult = await db.query('SELECT * FROM data_export_requests WHERE id = $1', [requestId]);
  const request = requestResult.rows[0];
  if (!request) throw new Error(`export request ${requestId} not found`);

  await db.query(
    `UPDATE data_export_requests SET status = 'processing' WHERE id = $1`,
    [requestId]
  );

  try {
    const data = await assembleUserData(request.user_id);

    await fsp.mkdir(exportDir(), { recursive: true });
    const fileName = `export-${request.user_id}-${crypto.randomBytes(8).toString('hex')}.json`;
    const filePath = path.join(exportDir(), fileName);
    await fsp.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');

    // Supersede any previous ready export (one live artifact per user).
    const previous = await db.query(
      `UPDATE data_export_requests SET status = 'expired'
       WHERE user_id = $1 AND status = 'ready' AND id <> $2
       RETURNING file_path`,
      [request.user_id, requestId]
    );
    for (const row of previous.rows) {
      if (row.file_path) {
        try {
          await fsp.unlink(path.resolve(row.file_path));
        } catch {
          // already gone
        }
      }
    }

    const token = crypto.randomBytes(32).toString('hex');
    await db.query(
      `UPDATE data_export_requests SET
         status = 'ready', file_path = $2, download_token = $3,
         expires_at = CURRENT_TIMESTAMP + ($4 || ' hours')::interval,
         completed_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [requestId, filePath, token, String(EXPORT_TTL_HOURS)]
    );

    logger.info({ action: 'gdpr_export_ready', requestId, userId: request.user_id });
    return { requestId, sections: Object.keys(data).length };
  } catch (err) {
    await db.query(
      `UPDATE data_export_requests SET status = 'failed', error = $2 WHERE id = $1`,
      [requestId, String(err.message).slice(0, 1000)]
    );
    throw err;
  }
}

/** Latest export request for a user. */
async function latestExport(userId) {
  const result = await db.query(
    `SELECT id, status, download_token, expires_at, error, created_at, completed_at
     FROM data_export_requests WHERE user_id = $1
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

/** Resolve a download token to a servable file (valid + not expired). */
async function resolveDownload(token) {
  const result = await db.query(
    `SELECT * FROM data_export_requests
     WHERE download_token = $1 AND status = 'ready' AND expires_at > CURRENT_TIMESTAMP`,
    [token]
  );
  return result.rows[0] || null;
}

module.exports = {
  EXPORT_TTL_HOURS,
  requestExport,
  assembleUserData,
  processExportJob,
  latestExport,
  resolveDownload,
};
