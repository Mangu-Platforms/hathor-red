/**
 * Artist analytics queries (Pillar 5, FR-502). Every COUNT/SUM comes back
 * from pg as a string — parseInt at the boundary, always.
 *
 * Rollups: the intel-rollup job compacts yesterday's events into
 * song_daily_stats; on-demand queries here read raw events so numbers are
 * live — at catalog scale the WHERE created_at window keeps them indexed.
 */

const db = require('../../config/database');

const RETENTION_BUCKET_MS = 10000; // 10s segments for the skip/retention curve

/** Totals across an artist's catalog for the trailing window. */
async function overview(artistUserId, { days = 30 } = {}) {
  const result = await db.query(
    `SELECT
       COUNT(*) FILTER (WHERE e.event_type = 'play') AS plays,
       COUNT(*) FILTER (WHERE e.event_type = 'complete') AS completes,
       COUNT(*) FILTER (WHERE e.event_type = 'skip') AS skips,
       COUNT(DISTINCT e.user_id) AS unique_listeners,
       -- segments alone: each heartbeat covers 10s of real listening; adding
       -- 'complete' (which carries the full track duration) double-counts
       COALESCE(SUM(e.duration_ms) FILTER (WHERE e.event_type = 'segment'), 0) AS total_listen_ms
     FROM listening_events e
     JOIN songs s ON s.id = e.song_id
     WHERE s.uploaded_by = $1
       AND e.created_at > CURRENT_TIMESTAMP - ($2 || ' days')::interval`,
    [artistUserId, String(days)]
  );

  const row = result.rows[0] || {};
  const plays = parseInt(row.plays, 10) || 0;
  const completes = parseInt(row.completes, 10) || 0;
  const skips = parseInt(row.skips, 10) || 0;
  return {
    days,
    plays,
    completes,
    skips,
    uniqueListeners: parseInt(row.unique_listeners, 10) || 0,
    totalListenMs: parseInt(row.total_listen_ms, 10) || 0,
    completionRate: plays > 0 ? Math.round((completes / plays) * 1000) / 1000 : 0,
    skipRate: plays > 0 ? Math.round((skips / plays) * 1000) / 1000 : 0,
  };
}

/** Top tracks by plays for the trailing window. */
async function topTracks(artistUserId, { days = 30, limit = 10 } = {}) {
  const result = await db.query(
    `SELECT s.id, s.title, s.genre,
            COUNT(*) FILTER (WHERE e.event_type = 'play') AS plays,
            COUNT(*) FILTER (WHERE e.event_type = 'complete') AS completes,
            COUNT(*) FILTER (WHERE e.event_type = 'skip') AS skips,
            COUNT(DISTINCT e.user_id) AS unique_listeners
     FROM listening_events e
     JOIN songs s ON s.id = e.song_id
     WHERE s.uploaded_by = $1
       AND e.created_at > CURRENT_TIMESTAMP - ($2 || ' days')::interval
     GROUP BY s.id, s.title, s.genre
     ORDER BY plays DESC
     LIMIT $3`,
    [artistUserId, String(days), Math.min(limit, 50)]
  );

  return result.rows.map((row) => {
    const plays = parseInt(row.plays, 10) || 0;
    const skips = parseInt(row.skips, 10) || 0;
    return {
      songId: row.id,
      title: row.title,
      genre: row.genre,
      plays,
      completes: parseInt(row.completes, 10) || 0,
      skips,
      uniqueListeners: parseInt(row.unique_listeners, 10) || 0,
      skipRate: plays > 0 ? Math.round((skips / plays) * 1000) / 1000 : 0,
    };
  });
}

/**
 * Build the retention curve from bucketed segment heartbeats. Pure — unit
 * tested. rows: [{bucket, listeners}] with string counts; plays = total play
 * starts. Returns 0..1 retention per 10s bucket plus the peak segment.
 */
function buildRetentionCurve(rows, plays, durationMs) {
  const bucketCount = Math.max(1, Math.ceil((durationMs || 0) / RETENTION_BUCKET_MS)) || 1;
  const curve = new Array(bucketCount).fill(0);

  for (const row of rows) {
    const bucket = parseInt(row.bucket, 10);
    const listeners = parseInt(row.listeners, 10) || 0;
    if (bucket >= 0 && bucket < bucketCount) {
      curve[bucket] = plays > 0 ? Math.min(1, listeners / plays) : 0;
    }
  }

  let peakBucket = 0;
  for (let i = 1; i < curve.length; i += 1) {
    if (curve[i] > curve[peakBucket]) peakBucket = i;
  }

  return {
    bucketMs: RETENTION_BUCKET_MS,
    curve: curve.map((v) => Math.round(v * 1000) / 1000),
    peak: {
      bucket: peakBucket,
      startMs: peakBucket * RETENTION_BUCKET_MS,
      retention: Math.round(curve[peakBucket] * 1000) / 1000,
    },
  };
}

/** Skip-position histogram + retention curve for one song (FR-502 / ANA-02). */
async function songRetention(songId) {
  const songResult = await db.query('SELECT id, title, duration, uploaded_by FROM songs WHERE id = $1', [songId]);
  const song = songResult.rows[0];
  if (!song) return null;
  const durationMs = (parseInt(song.duration, 10) || 0) * 1000;

  const playsResult = await db.query(
    `SELECT COUNT(DISTINCT user_id) AS plays FROM listening_events
     WHERE song_id = $1 AND event_type = 'play'`,
    [songId]
  );
  const plays = parseInt(playsResult.rows[0].plays, 10) || 0;

  const segments = await db.query(
    `SELECT FLOOR(position_ms / ${RETENTION_BUCKET_MS})::int AS bucket,
            COUNT(DISTINCT user_id) AS listeners
     FROM listening_events
     WHERE song_id = $1 AND event_type = 'segment' AND position_ms IS NOT NULL
     GROUP BY bucket
     ORDER BY bucket`,
    [songId]
  );

  const skips = await db.query(
    `SELECT FLOOR(position_ms / ${RETENTION_BUCKET_MS})::int AS bucket,
            COUNT(*) AS skips
     FROM listening_events
     WHERE song_id = $1 AND event_type = 'skip' AND position_ms IS NOT NULL
     GROUP BY bucket
     ORDER BY skips DESC
     LIMIT 20`,
    [songId]
  );

  return {
    songId: song.id,
    title: song.title,
    uploadedBy: song.uploaded_by,
    plays,
    retention: buildRetentionCurve(segments.rows, plays, durationMs),
    skipHotspots: skips.rows.map((row) => ({
      bucket: parseInt(row.bucket, 10),
      startMs: parseInt(row.bucket, 10) * RETENTION_BUCKET_MS,
      skips: parseInt(row.skips, 10),
    })),
  };
}

/** Streams by country for the artist's catalog (ANA-01, tour planning). */
async function geography(artistUserId, { days = 30 } = {}) {
  const result = await db.query(
    `SELECT COALESCE(e.country, '??') AS country,
            COUNT(*) FILTER (WHERE e.event_type = 'play') AS plays,
            COUNT(DISTINCT e.user_id) AS unique_listeners
     FROM listening_events e
     JOIN songs s ON s.id = e.song_id
     WHERE s.uploaded_by = $1
       AND e.created_at > CURRENT_TIMESTAMP - ($2 || ' days')::interval
     GROUP BY e.country
     ORDER BY plays DESC
     LIMIT 100`,
    [artistUserId, String(days)]
  );
  return result.rows.map((row) => ({
    country: row.country,
    plays: parseInt(row.plays, 10) || 0,
    uniqueListeners: parseInt(row.unique_listeners, 10) || 0,
  }));
}

/** Revenue attribution: artist-share cents per song (streams meet sales). */
async function revenueByTrack(artistUserId) {
  const result = await db.query(
    `SELECT s.id, s.title,
            COALESCE(SUM(r.amount_cents), 0) AS artist_cents,
            COUNT(DISTINCT pu.id) AS sales
     FROM revenue_ledger r
     JOIN purchases pu ON pu.id = r.purchase_id
     JOIN products pr ON pr.id = pu.product_id
     JOIN songs s ON s.id = pr.song_id
     WHERE r.artist_user_id = $1 AND r.entry_type = 'artist_share'
     GROUP BY s.id, s.title
     ORDER BY artist_cents DESC
     LIMIT 100`,
    [artistUserId]
  );
  return result.rows.map((row) => ({
    songId: row.id,
    title: row.title,
    artistCents: parseInt(row.artist_cents, 10) || 0,
    sales: parseInt(row.sales, 10) || 0,
  }));
}

/**
 * Job handler 'intel-rollup'. Payload: { day } (YYYY-MM-DD, default
 * yesterday UTC). Upserts song_daily_stats for every song with events.
 */
async function processRollupJob(payload = {}) {
  const day = payload.day || new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const result = await db.query(
    `INSERT INTO song_daily_stats (song_id, day, plays, completes, skips, unique_listeners, total_listen_ms)
     SELECT e.song_id, $1::date,
            COUNT(*) FILTER (WHERE e.event_type = 'play'),
            COUNT(*) FILTER (WHERE e.event_type = 'complete'),
            COUNT(*) FILTER (WHERE e.event_type = 'skip'),
            COUNT(DISTINCT e.user_id),
            COALESCE(SUM(e.duration_ms) FILTER (WHERE e.event_type = 'segment'), 0)
     FROM listening_events e
     WHERE e.created_at >= $1::date AND e.created_at < $1::date + INTERVAL '1 day'
     GROUP BY e.song_id
     ON CONFLICT (song_id, day) DO UPDATE SET
       plays = EXCLUDED.plays,
       completes = EXCLUDED.completes,
       skips = EXCLUDED.skips,
       unique_listeners = EXCLUDED.unique_listeners,
       total_listen_ms = EXCLUDED.total_listen_ms,
       updated_at = CURRENT_TIMESTAMP
     RETURNING song_id`,
    [day]
  );

  return { day, songsRolledUp: result.rows.length };
}

module.exports = {
  RETENTION_BUCKET_MS,
  overview,
  topTracks,
  buildRetentionCurve,
  songRetention,
  geography,
  revenueByTrack,
  processRollupJob,
};
