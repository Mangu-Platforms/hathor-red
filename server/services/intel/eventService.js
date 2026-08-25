/**
 * Listening-event ingestion (Pillar 5, FR-501).
 *
 * The client batches player telemetry (play/pause/seek/skip/complete plus
 * periodic `segment` heartbeats) and posts it here. Retried batches dedupe
 * via the (user_id, client_event_id) partial unique index — inserts use
 * ON CONFLICT DO NOTHING so replays are free.
 */

const db = require('../../config/database');

const EVENT_TYPES = ['play', 'pause', 'seek', 'skip', 'complete', 'segment'];
const MAX_BATCH = 100;

/**
 * Country attribution from proxy/CDN headers. First match wins; 'XX'
 * (Cloudflare's "unknown") is treated as absent. Pure — unit tested.
 */
function countryFromHeaders(headers = {}) {
  const candidates = [
    headers['cf-ipcountry'],
    headers['x-vercel-ip-country'],
    headers['x-country-code'],
    headers['x-appengine-country'],
  ];
  for (const value of candidates) {
    const country = String(value || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(country) && country !== 'XX') return country;
  }
  return null;
}

/**
 * Insert a batch of events for one user. Returns { accepted, rejected }.
 * Individual malformed events are rejected without failing the batch.
 */
async function ingestBatch({ userId, events, country = null, source = 'web' }) {
  if (!Array.isArray(events) || events.length === 0) {
    const err = new Error('events must be a non-empty array');
    err.status = 400;
    throw err;
  }
  if (events.length > MAX_BATCH) {
    const err = new Error(`Batch too large (max ${MAX_BATCH})`);
    err.status = 400;
    throw err;
  }

  let accepted = 0;
  const rejected = [];

  for (let i = 0; i < events.length; i += 1) {
    const event = events[i] || {};
    const songId = parseInt(event.songId, 10);
    const type = String(event.type || '');

    if (!songId || songId < 1 || !EVENT_TYPES.includes(type)) {
      rejected.push({ index: i, reason: 'invalid songId or type' });
      continue;
    }

    const positionMs = event.positionMs !== undefined ? parseInt(event.positionMs, 10) : null;
    const durationMs = event.durationMs !== undefined ? parseInt(event.durationMs, 10) : null;
    if ((positionMs !== null && (Number.isNaN(positionMs) || positionMs < 0))
      || (durationMs !== null && (Number.isNaN(durationMs) || durationMs < 0))) {
      rejected.push({ index: i, reason: 'invalid positionMs/durationMs' });
      continue;
    }

    const clientEventId = event.clientEventId ? String(event.clientEventId).slice(0, 64) : null;

    const result = await db.query(
      `INSERT INTO listening_events
         (user_id, song_id, event_type, position_ms, duration_ms, client_event_id, country, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id, client_event_id) WHERE client_event_id IS NOT NULL
       DO NOTHING
       RETURNING id`,
      [userId, songId, type, positionMs, durationMs, clientEventId, country, source]
    );
    if (result.rows.length > 0) accepted += 1;
    // A conflict (already-ingested retry) counts as neither accepted nor rejected.
  }

  return { accepted, rejected, deduplicated: events.length - accepted - rejected.length };
}

module.exports = { EVENT_TYPES, MAX_BATCH, countryFromHeaders, ingestBatch };
