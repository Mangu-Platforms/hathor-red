const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const mime = require('mime-types');
const db = require('../config/database');
const { redisClient } = require('../config/redis');
const { signStreamToken } = require('../utils/streamToken');
const { logger } = require('../utils/logger');
const { ALLOWED_GENRES } = require('../config/constants');

const UPLOAD_DIR = path.resolve(__dirname, '..', '..', 'uploads');

/**
 * Resolve and validate upload file path
 * Prevents path traversal attacks
 */
function resolveUploadPath(dbFilePath) {
  const stripped = String(dbFilePath || '').replace(/^\/?uploads\//, '');
  const resolved = path.resolve(UPLOAD_DIR, stripped);
  const relative = path.relative(UPLOAD_DIR, resolved);
  if (relative.startsWith('..') || relative.startsWith('/') || path.isAbsolute(relative)) {
    throw new Error('Invalid file path: path traversal detected');
  }
  if (!resolved.startsWith(UPLOAD_DIR)) {
    throw new Error('Invalid file path: outside upload directory');
  }
  return resolved;
}

/**
 * Get songs with optional filtering and Redis caching
 */
const getSongs = async (req, res) => {
  try {
    const { genre, search, limit = 50, offset = 0 } = req.query;
    const pageLimit = Math.min(parseInt(limit, 10) || 50, 200);
    const pageOffset = Math.max(parseInt(offset, 10) || 0, 0);

    // Validate genre against allowlist
    if (genre && !ALLOWED_GENRES.includes(genre)) {
      return res.status(400).json({ error: 'Invalid genre', allowed: ALLOWED_GENRES });
    }

    // Build cache key
    const cacheKey = `songs:${genre || 'all'}:${search || ''}:${pageLimit}:${pageOffset}`;

    // Try Redis cache
    try {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        return res.json({ songs: JSON.parse(cached), cached: true });
      }
    } catch (cacheErr) {
      logger.warn('Redis cache miss (proceeding to DB):', cacheErr.message);
    }

    let query = 'SELECT * FROM songs WHERE 1=1';
    const params = [];

    if (genre) {
      params.push(genre);
      query += ` AND genre = $${params.length}`;
    }

    if (search) {
      const sanitizedSearch = search.replace(/[%_]/g, '\\$&');
      params.push(`%${sanitizedSearch}%`);
      query += ` AND (title ILIKE $${params.length} OR artist ILIKE $${params.length} OR album ILIKE $${params.length})`;
    }

    query += ' ORDER BY created_at DESC';
    params.push(pageLimit, pageOffset);
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await db.query(query, params);

    // Cache result for 5 minutes
    try {
      await redisClient.setEx(cacheKey, 300, JSON.stringify(result.rows));
    } catch (cacheErr) {
      logger.warn('Failed to cache songs:', cacheErr.message);
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
    console.error('Get song error:', error);
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

    res.status(201).json({
      message: 'Song uploaded successfully',
      song: result.rows[0]
    });
  } catch (error) {
    console.error('Upload song error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getStreamUrl = async (req, res) => {
  try {
    const { id } = req.params;

    const songCheck = await db.query('SELECT id FROM songs WHERE id = $1', [id]);
    if (songCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const token = signStreamToken({
      userId: req.user.userId,
      songId: Number(id)
    });

    return res.json({
      url: `/api/songs/${id}/stream?t=${encodeURIComponent(token)}`
    });
  } catch (error) {
    console.error('Get stream URL error:', error);
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
    } catch (error) {
      return res.status(404).json({ error: 'Audio file missing' });
    }

    const fileSize = stat.size;
    const range = req.headers.range;
    const contentType = mime.lookup(filePath) || 'application/octet-stream';

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
      const chunkSize = (end - start) + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunkSize);

      const stream = fs.createReadStream(filePath, { start, end });
      stream.on('error', () => {
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy();
        }
      });

      return stream.pipe(res);
    }

    res.status(200);
    res.setHeader('Content-Length', fileSize);

    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).end();
      } else {
        res.destroy();
      }
    });

    return stream.pipe(res);
  } catch (error) {
    console.error('Stream song error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    return undefined;
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
    console.error('Record listening error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getSongs,
  getSongById,
  uploadSong,
  getStreamUrl,
  streamSong,
  recordListening
};
