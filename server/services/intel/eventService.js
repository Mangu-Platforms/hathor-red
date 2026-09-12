/**
 * Listening-event ingestion (Pillar 5, FR-501).
 *
 * The client batches player telemetry (play/pause/seek/skip/complete plus
 * periodic `segment` heartbeats) and posts it here. Retried batches dedupe
 * via the (user_id, client_event_id) partial unique index — inserts use
 * ON CONFLICT DO NOTHING so replays are free.
 *
 * dose-1.56: songId uses shared toPositiveInt (same bar as stream/playback
 * controllers); positionMs/durationMs require finite non-negative integers
 * capped at 7_200_000 ms (2h, matching position/duration second ceiling).
 * Rejects NaN/0/negative/string junk instead of raw parseInt coercion.
 */

const db = require('../../config/database');
const { toPositiveInt } = require('../../utils/streamToken');

const EVENT_TYPES = ['play', 'pause', 'seek', 'skip', 'complete', 'segment'];
const MAX_BATCH = 100;
/** Max position/duration in milliseconds (2 hours). */
const MAX_MS = 7_200_000;

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
 * Finite non-negative integer in [0, MAX_MS], or null if absent.
 * Rejects NaN / negative / non-integer / Infinity / out-of-range.
 */
function parseNonNegMs(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_MS) {
    return undefined; // signal invalid (distinct from absent)
  }
  return n;
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
    // dose-1.56: same positive-int bar as stream tokens / song controllers
    const songId = toPositiveInt(event.songId);
    const type = String(event.type || '');

    if (songId == null || !EVENT_TYPES.includes(type)) {
      rejected.push({ index: i, reason: 'invalid songId or type' });
      continue;
    }

    const positionMs = parseNonNegMs(event.positionMs);
    const durationMs = parseNonNegMs(event.durationMs);
    if (positionMs === undefined || durationMs === undefined) {
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

module.exports = { EVENT_TYPES, MAX_BATCH, MAX_MS, countryFromHeaders, ingestBatch };
