const fs = require('fs');
const fsp = require('fs/promises');
const mime = require('mime-types');
const db = require('../config/database');
const { redisClient } = require('../config/redis');
const { signStreamToken } = require('../utils/streamToken');
const { logger } = require('../utils/logger');
const {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  CACHE_TTL_SONGS,
  ALLOWED_GENRES,
} = require('../config/constants');
const { resolveUploadPath } = require('../utils/uploadPath');

const getSongs = async (req, res) => {
  try {
    const { genre, search, limit, offset } = req.query;
    const pageLimit = Math.min(parseInt(limit) || DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const pageOffset = Math.max(parseInt(offset) || 0, 0);

    if (genre && !ALLOWED_GENRES.includes(genre)) {
      return res.status(400).json({ error: 'Invalid genre', allowed: ALLOWED_GENRES });
    }

    const cacheKey = `songs:${genre || 'all'}:${search || ''}:${pageLimit}:${pageOffset}`;

    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json({ songs: JSON.parse(cached), cached: true });
      }
    } catch (cacheErr) {
      // Proceed without cache
    }

    let query = 'SELECT * FROM songs WHERE 1=1';
    const params = [];

    if (genre) {
      params.push(genre);
      query += ` AND genre = $${params.length}`;
    }

    if (search) {
      const sanitizedSearch = search.replace(/[%_\\]/g, '\\$&');
      params.push(`%${sanitizedSearch}%`);
      query += ` AND (title ILIKE $${params.length} OR artist ILIKE $${params.length} OR album ILIKE $${params.length})`;
    }

    query += ' ORDER BY created_at DESC';
    params.push(pageLimit, pageOffset);
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await db.query(query, params);

    try {
      await redisClient.setEx(cacheKey, CACHE_TTL_SONGS, JSON.stringify(result.rows));
    } catch (cacheErr) {
      // Ignore cache write errors
    }

    res.json({ songs: result.rows });
  } catch (error) {
    logger.error('Get songs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getSongById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM songs WHERE id = $1', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    res.json({ song: result.rows[0] });
  } catch (error) {
    logger.error('Get song error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const uploadSong = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const { title, artist, album, duration, genre, year } = req.body;

    if (!title || !artist || !duration) {
      return res.status(400).json({ error: 'Title, artist, and duration are required' });
    }

    const filePath = `/uploads/${req.file.filename}`;

    const result = await db.query(
      'INSERT INTO songs (title, artist, album, duration, file_path, genre, year, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [title, artist, album || null, parseInt(duration, 10), filePath, genre || null, year ? parseInt(year, 10) : null, req.user.userId]
    );

    const song = result.rows[0];
    logger.info({ action: 'song_uploaded', songId: song.id, userId: req.user.userId });

    // Olympus media pipeline: create the asset and queue transcoding.
    // Pipeline failure must never fail the upload (degradation doctrine) —
    // the original file still direct-streams.
    let pipeline = null;
    try {
      const assetResult = await db.query(
        `INSERT INTO media_assets (song_id, uploaded_by, original_path, original_filename, mime_type, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         ON CONFLICT (song_id) DO NOTHING
         RETURNING id`,
        [song.id, req.user.userId, filePath, req.file.originalname || null, req.file.mimetype || null]
      );
      if (assetResult.rows.length > 0) {
        const jobQueue = require('../services/jobs/jobQueue');
        const job = await jobQueue.enqueue(
          'transcode',
          { assetId: assetResult.rows[0].id },
          { createdBy: req.user.userId }
        );
        // Embed the new song so discovery picks it up on the next tick.
        await jobQueue.enqueue('embed-songs', { songId: song.id }, { createdBy: req.user.userId });
        pipeline = { assetId: assetResult.rows[0].id, jobId: job.id, status: 'queued' };
      }
    } catch (pipelineErr) {
      logger.warn(`Media pipeline enqueue failed (upload still succeeded): ${pipelineErr.message}`);
      pipeline = { status: 'unavailable' };
    }

    res.status(201).json({
      message: 'Song uploaded successfully',
      song,
      pipeline,
    });
  } catch (error) {
    logger.error('Upload song error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getStreamUrl = async (req, res) => {
  try {
    const { id } = req.params;

    const songCheck = await db.query('SELECT * FROM songs WHERE id = $1', [id]);
    if (songCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    // Early-access gate (Olympus M2): songs in an early-access window stream
    // only for the uploader, buyers, and active fan-club members.
    const song = songCheck.rows[0];
    if (song.early_access_until) {
      const commerceService = require('../services/commerce/commerceService');
      const allowed = await commerceService.canAccessSong(req.user.userId, song);
      if (!allowed) {
        return res.status(403).json({
          error: 'This track is in early access for fan-club members',
          earlyAccessUntil: song.early_access_until,
        });
      }
    }

    const token = signStreamToken({
      userId: req.user.userId,
      songId: Number(id),
    });

    return res.json({
      url: `/api/songs/${id}/stream?t=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    logger.error('Get stream URL error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
};

const streamSong = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.streamToken?.songId != null && Number(req.streamToken.songId) !== Number(id)) {
      return res.status(401).json({ error: 'Invalid stream token for song' });
    }

    const result = await db.query('SELECT file_path FROM songs WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const filePath = resolveUploadPath(result.rows[0].file_path);

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return res.status(404).json({ error: 'Audio file missing' });
    }

    const fileSize = stat.size;
    const range = req.headers.range;
    const contentType = mime.lookup(filePath) || 'audio/mpeg';

    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('Last-Modified', stat.mtime.toUTCString());
    res.setHeader('ETag', `"${fileSize}-${Math.round(stat.mtimeMs)}"`);

    if (range) {
      const match = String(range).match(/^bytes=(\d*)-(\d*)$/);
      if (!match) {
        return res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      }

      let start = match[1] === '' ? null : parseInt(match[1], 10);
      let end = match[2] === '' ? null : parseInt(match[2], 10);

      if (start === null && end !== null) {
        const suffix = end;
        if (Number.isNaN(suffix) || suffix <= 0) {
          return res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        }
        start = Math.max(fileSize - suffix, 0);
        end = fileSize - 1;
      } else {
        if (start === null) start = 0;
        if (end === null) end = fileSize - 1;
      }

      if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || end < start || start >= fileSize) {
        return res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      }

      end = Math.min(end, fileSize - 1);
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize);

      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => {
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
      });
      return stream.pipe(res);
    }

    res.status(200);
    res.setHeader('Content-Length', fileSize);

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end();
      else res.destroy();
    });
    return stream.pipe(res);
  } catch (error) {
    logger.error('Stream song error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
};

const recordListening = async (req, res) => {
  try {
    const { songId, duration } = req.body;

    await db.query(
      'INSERT INTO listening_history (user_id, song_id, duration_played) VALUES ($1, $2, $3)',
      [req.user.userId, songId, duration || 0]
    );

    res.json({ message: 'Listening recorded' });
  } catch (error) {
    logger.error('Record listening error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getGenres = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT DISTINCT genre, COUNT(*) as count FROM songs WHERE genre IS NOT NULL GROUP BY genre ORDER BY count DESC'
    );
    res.json({ genres: result.rows });
  } catch (error) {
    logger.error('Get genres error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getSongs,
  getSongById,
  uploadSong,
  getStreamUrl,
  streamSong,
  recordListening,
  getGenres,
};
