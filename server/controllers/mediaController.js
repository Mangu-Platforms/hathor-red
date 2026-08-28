const fs = require('fs');
const fsp = require('fs/promises');
const db = require('../config/database');
const { redisClient } = require('../config/redis');
const { logger } = require('../utils/logger');
const { isAdmin } = require('../utils/roles');
const jobQueue = require('../services/jobs/jobQueue');
const features = require('../config/features');
const jobWorker = require('../services/jobs/worker');
const { buildMasterManifest, resolveHlsPath, appendTokenToPlaylist } = require('../services/media/hlsService');

const WAVEFORM_CACHE_TTL = 3600;

async function loadAssetForSong(songId) {
  const result = await db.query(
    'SELECT * FROM media_assets WHERE song_id = $1',
    [songId]
  );
  return result.rows[0] || null;
}

async function loadVariants(assetId) {
  const result = await db.query(
    'SELECT * FROM media_variants WHERE asset_id = $1 ORDER BY variant_key',
    [assetId]
  );
  return result.rows;
}

/** Uploader-or-admin gate for pipeline internals (commands, errors, reprocess). */
async function canManageSong(userId, songId) {
  const result = await db.query('SELECT uploaded_by FROM songs WHERE id = $1', [songId]);
  if (result.rows.length === 0) return { found: false, allowed: false };
  if (result.rows[0].uploaded_by === userId) return { found: true, allowed: true };
  return { found: true, allowed: await isAdmin(userId) };
}

/** Honest worker snapshot for API responses (no secrets). */
function workerSnapshot() {
  const enabled = features.isWorkerEnabled();
  if (!enabled) {
    return { workerEnabled: false, workerLive: false, warning: 'FEATURE_WORKER is off — job will stay queued until a worker is enabled' };
  }
  try {
    const ws = jobWorker.getStatus();
    const live = Boolean(ws && ws.startedOk && ws.running);
    if (!live) {
      return {
        workerEnabled: true,
        workerLive: false,
        warning: 'Background job worker is not running — job is queued but may stall until the worker starts',
      };
    }
    return { workerEnabled: true, workerLive: true };
  } catch {
    return {
      workerEnabled: true,
      workerLive: false,
      warning: 'Could not read worker status — job is queued; confirm the worker is running',
    };
  }
}

/**
 * GET /api/media/songs/:id/pipeline — full pipeline state for a song
 * (asset status, per-variant status, persisted commands). Uploader/admin only.
 */
const getPipeline = async (req, res) => {
  try {
    const songId = parseInt(req.params.id, 10);
    const access = await canManageSong(req.user.userId, songId);
    if (!access.found) return res.status(404).json({ error: 'Song not found' });
    if (!access.allowed) return res.status(403).json({ error: 'Only the uploader or an admin can view the pipeline' });

    const asset = await loadAssetForSong(songId);
    if (!asset) {
      return res.json({
        pipeline: null,
        message: 'No media asset — song predates the pipeline or processing has not started',
        ...workerSnapshot(),
      });
    }

    const variants = await loadVariants(asset.id);
    res.json({
      pipeline: {
        asset: {
          id: asset.id,
          status: asset.status,
          sha256: asset.sha256,
          fileSizeBytes: asset.file_size_bytes !== null ? parseInt(asset.file_size_bytes, 10) : null,
          loudnessLufs: asset.loudness_lufs,
          truePeakDb: asset.true_peak_db,
          hasWaveform: asset.waveform_peaks !== null,
          createdAt: asset.created_at,
          updatedAt: asset.updated_at,
        },
        variants: variants.map((v) => ({
          key: v.variant_key,
          format: v.format,
          bitrateKbps: v.bitrate_kbps,
          status: v.status,
          filePath: v.file_path,
          error: v.error,
          ffmpegCommand: v.ffmpeg_command,
        })),
      },
      ...workerSnapshot(),
    });
  } catch (error) {
    logger.error('Get pipeline error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/media/songs/:id/waveform — waveform peaks + loudness for player UI.
 * Any authenticated listener. Redis-cached with DB fallback.
 */
const getWaveform = async (req, res) => {
  try {
    const songId = parseInt(req.params.id, 10);
    const cacheKey = `waveform:${songId}`;

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) return res.json(JSON.parse(cached));
    } catch {
      // cache miss path
    }

    const asset = await loadAssetForSong(songId);
    if (!asset) return res.status(404).json({ error: 'No waveform available for this song' });

    const payload = {
      songId,
      waveform: asset.waveform_peaks,
      loudnessLufs: asset.loudness_lufs,
      truePeakDb: asset.true_peak_db,
    };

    if (!payload.waveform) {
      return res.status(404).json({
        error: 'Waveform not generated yet',
        status: asset.status,
        ...workerSnapshot(),
      });
    }

    try {
      await redisClient.setEx(cacheKey, WAVEFORM_CACHE_TTL, JSON.stringify(payload));
    } catch {
      // cache write is best-effort
    }

    res.json(payload);
  } catch (error) {
    logger.error('Get waveform error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

function streamTokenMatchesSong(req, songId) {
  return !(req.streamToken?.songId != null && Number(req.streamToken.songId) !== Number(songId));
}

/**
 * Early-access gate for HLS serving (mirrors songController.streamSong):
 * checked on every request — Bearer JWTs reach these routes without a stream
 * token, so token-mint-time gating alone is bypassable. Returns true when the
 * response has been sent (denied / not found).
 */
async function deniedByEarlyAccess(req, res, songId) {
  const songResult = await db.query('SELECT * FROM songs WHERE id = $1', [songId]);
  if (songResult.rows.length === 0) {
    res.status(404).json({ error: 'Song not found' });
    return true;
  }
  const song = songResult.rows[0];
  if (!song.early_access_until) return false;

  const commerceService = require('../services/commerce/commerceService');
  const allowed = await commerceService.canAccessSong(req.user.userId, song);
  if (!allowed) {
    res.status(403).json({
      error: 'This track is in early access for fan-club members',
      earlyAccessUntil: song.early_access_until,
    });
    return true;
  }
  return false;
}

/**
 * GET /api/media/songs/:id/hls/master.m3u8 — master playlist over ready HLS
 * variants. streamAuth (short-lived token in ?t= or Bearer). 404 body names
 * the direct-stream fallback so clients degrade in one hop.
 */
const getHlsMaster = async (req, res) => {
  try {
    const songId = parseInt(req.params.id, 10);
    if (!streamTokenMatchesSong(req, songId)) {
      return res.status(401).json({ error: 'Invalid stream token for song' });
    }
    if (await deniedByEarlyAccess(req, res, songId)) return;

    const asset = await loadAssetForSong(songId);
    const variants = asset ? await loadVariants(asset.id) : [];
    const tokenQuery = req.query?.t ? `?t=${encodeURIComponent(req.query.t)}` : '';
    const manifest = buildMasterManifest(variants, `/api/media/songs/${songId}/hls`, tokenQuery);

    if (!manifest) {
      return res.status(404).json({
        error: 'HLS not available for this song',
        fallback: `/api/songs/${songId}/stream`,
      });
    }

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(manifest);
  } catch (error) {
    logger.error('Get HLS master error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/media/songs/:id/hls/:variantKey/:file — media playlist or segment.
 * Path safety is enforced by resolveHlsPath (whitelisted names only).
 */
const getHlsResource = async (req, res) => {
  try {
    const songId = parseInt(req.params.id, 10);
    const { variantKey, file } = req.params;

    if (!streamTokenMatchesSong(req, songId)) {
      return res.status(401).json({ error: 'Invalid stream token for song' });
    }
    if (await deniedByEarlyAccess(req, res, songId)) return;

    const asset = await loadAssetForSong(songId);
    if (!asset) return res.status(404).json({ error: 'HLS not available' });

    const variantResult = await db.query(
      `SELECT * FROM media_variants WHERE asset_id = $1 AND variant_key = $2 AND status = 'ready'`,
      [asset.id, variantKey]
    );
    if (variantResult.rows.length === 0) {
      return res.status(404).json({ error: 'HLS variant not available' });
    }

    let resolved;
    try {
      resolved = resolveHlsPath(asset.id, variantKey, file);
    } catch {
      return res.status(400).json({ error: 'Invalid HLS resource path' });
    }

    // Media playlists are rewritten so segment URIs carry the ?t= token —
    // otherwise a standard HLS client that authenticated via ?t= would fetch
    // segments bare and 401. Segments themselves stream from disk untouched.
    if (file.endsWith('.m3u8')) {
      let playlistText;
      try {
        playlistText = await fsp.readFile(resolved, 'utf8');
      } catch {
        return res.status(404).json({ error: 'HLS resource missing' });
      }
      playlistText = appendTokenToPlaylist(playlistText, req.query?.t);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Cache-Control', 'private, max-age=60');
      return res.send(playlistText);
    }

    let stat;
    try {
      stat = await fsp.stat(resolved);
    } catch {
      return res.status(404).json({ error: 'HLS resource missing' });
    }

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'private, max-age=3600');

    const stream = fs.createReadStream(resolved);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    stream.pipe(res);
  } catch (error) {
    logger.error('Get HLS resource error:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * POST /api/media/songs/:id/reprocess — re-enqueue the transcode pipeline.
 * Uploader/admin. Creates the media_asset row when the song predates M1.
 * Response always includes workerEnabled / workerLive (and warning when not live).
 */
const reprocessSong = async (req, res) => {
  try {
    const songId = parseInt(req.params.id, 10);
    const access = await canManageSong(req.user.userId, songId);
    if (!access.found) return res.status(404).json({ error: 'Song not found' });
    if (!access.allowed) return res.status(403).json({ error: 'Only the uploader or an admin can reprocess' });

    let asset = await loadAssetForSong(songId);
    if (!asset) {
      const songResult = await db.query('SELECT file_path, uploaded_by FROM songs WHERE id = $1', [songId]);
      const song = songResult.rows[0];
      const created = await db.query(
        `INSERT INTO media_assets (song_id, uploaded_by, original_path, status)
         VALUES ($1, $2, $3, 'pending')
         ON CONFLICT (song_id) DO UPDATE SET status = 'pending', updated_at = CURRENT_TIMESTAMP
         RETURNING *`,
        [songId, song.uploaded_by, song.file_path]
      );
      asset = created.rows[0];
    } else {
      await db.query(
        `UPDATE media_assets SET status = 'pending', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [asset.id]
      );
    }

    const job = await jobQueue.enqueue('transcode', { assetId: asset.id }, { createdBy: req.user.userId });
    const snap = workerSnapshot();
    logger.info({
      action: 'transcode_requeued',
      songId,
      assetId: asset.id,
      jobId: job.id,
      workerLive: snap.workerLive,
    });
    res.status(202).json({
      message: snap.workerLive ? 'Reprocess queued' : 'Reprocess queued (worker not live)',
      jobId: job.id,
      assetId: asset.id,
      ...snap,
    });
  } catch (error) {
    logger.error('Reprocess song error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * GET /api/media/jobs/:id — job status for polling. Creator or admin.
 */
const getJobStatus = async (req, res) => {
  try {
    const jobId = parseInt(req.params.id, 10);
    const job = await jobQueue.getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.created_by !== req.user.userId && !(await isAdmin(req.user.userId))) {
      return res.status(403).json({ error: 'Not your job' });
    }

    res.json({
      job: {
        id: job.id,
        type: job.job_type,
        status: job.status,
        attempts: parseInt(job.attempts, 10),
        maxAttempts: parseInt(job.max_attempts, 10),
        lastError: job.last_error,
        result: job.result,
        createdAt: job.created_at,
        finishedAt: job.finished_at,
      },
      ...workerSnapshot(),
    });
  } catch (error) {
    logger.error('Get job status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getPipeline,
  getWaveform,
  getHlsMaster,
  getHlsResource,
  reprocessSong,
  getJobStatus,
};
