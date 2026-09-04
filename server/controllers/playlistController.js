const db = require('../config/database');
const colabAIService = require('../services/colabAIService');
const { logger } = require('../utils/logger');
const { DEFAULT_AI_PLAYLIST_SIZE, MAX_AI_PLAYLIST_SIZE } = require('../config/constants');

const getPlaylists = async (req, res) => {
  try {
    const { userId } = req.user;

    // Include song_count so list cards can show track totals without N+1 detail fetches.
    const result = await db.query(
      `SELECT p.*,
              COALESCE(c.cnt, 0)::int AS song_count
       FROM playlists p
       LEFT JOIN (
         SELECT playlist_id, COUNT(*)::int AS cnt
         FROM playlist_songs
         GROUP BY playlist_id
       ) c ON c.playlist_id = p.id
       WHERE p.user_id = $1 OR p.is_public = true
       ORDER BY p.created_at DESC`,
      [userId]
    );

    res.json({ playlists: result.rows });
  } catch (error) {
    logger.error('Get playlists error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getPlaylistById = async (req, res) => {
  try {
    const { id } = req.params;

    const playlistResult = await db.query('SELECT * FROM playlists WHERE id = $1', [id]);
    if (playlistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    const playlist = playlistResult.rows[0];
    if (!playlist.is_public && playlist.user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const songsResult = await db.query(
      `SELECT s.*, ps.position 
       FROM songs s 
       JOIN playlist_songs ps ON s.id = ps.song_id 
       WHERE ps.playlist_id = $1 
       ORDER BY ps.position`,
      [id]
    );

    res.json({ playlist, songs: songsResult.rows });
  } catch (error) {
    logger.error('Get playlist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createPlaylist = async (req, res) => {
  try {
    const { name, description, isPublic } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Playlist name is required' });
    }

    const result = await db.query(
      'INSERT INTO playlists (user_id, name, description, is_public) VALUES ($1, $2, $3, $4) RETURNING *',
      [req.user.userId, name, description || null, isPublic !== false]
    );

    res.status(201).json({
      message: 'Playlist created successfully',
      playlist: result.rows[0],
    });
  } catch (error) {
    logger.error('Create playlist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const addSongToPlaylist = async (req, res) => {
  try {
    const { playlistId, songId } = req.body;

    const playlistResult = await db.query(
      'SELECT user_id FROM playlists WHERE id = $1',
      [playlistId]
    );

    if (playlistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (playlistResult.rows[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Atomic position assignment: avoid check-then-act race under concurrent adds
    await db.query(
      `INSERT INTO playlist_songs (playlist_id, song_id, position)
       VALUES (
         $1,
         $2,
         (SELECT COALESCE(MAX(position), 0) + 1 FROM playlist_songs WHERE playlist_id = $1)
       )`,
      [playlistId, songId]
    );

    res.json({ message: 'Song added to playlist' });
  } catch (error) {
    if (error.constraint === 'playlist_songs_playlist_id_song_id_key') {
      return res.status(409).json({ error: 'Song already in playlist' });
    }
    logger.error('Add song to playlist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const generateAIPlaylist = async (req, res) => {
  try {
    const { prompt, name, songCount = DEFAULT_AI_PLAYLIST_SIZE } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const count = Math.min(parseInt(songCount) || DEFAULT_AI_PLAYLIST_SIZE, MAX_AI_PLAYLIST_SIZE);

    const historyResult = await db.query(
      `SELECT s.genre, s.artist, COUNT(*) as play_count
       FROM listening_history lh
       JOIN songs s ON lh.song_id = s.id
       WHERE lh.user_id = $1
       GROUP BY s.genre, s.artist
       ORDER BY play_count DESC
       LIMIT 20`,
      [req.user.userId]
    );

    const context = {
      history: historyResult.rows,
      favoriteGenres: [...new Set(historyResult.rows.map(r => r.genre).filter(Boolean))],
    };

    const analysis = await colabAIService.analyzePlaylistPrompt(prompt, context);
    let genres = analysis.genres || [];

    if (genres.length === 0) {
      const keywords = prompt.toLowerCase().split(/\s+/);
      const moodMap = {
        chill: ['Jazz', 'Classical', 'Electronic', 'Ambient'],
        relax: ['Jazz', 'Classical', 'Ambient', 'Lo-Fi'],
        calm: ['Classical', 'Ambient', 'New Age'],
        workout: ['Rock', 'Hip Hop', 'Electronic', 'Trap'],
        energy: ['Rock', 'Electronic', 'Hip Hop', 'Metal'],
        pump: ['Electronic', 'Hip Hop', 'Rock'],
        gym: ['Electronic', 'Hip Hop', 'Rock'],
        run: ['Electronic', 'Hip Hop', 'Rock'],
        party: ['Electronic', 'Hip Hop', 'Pop', 'Disco'],
        dance: ['Electronic', 'Hip Hop', 'Pop', 'Disco'],
        club: ['Electronic', 'Hip Hop', 'House'],
        study: ['Classical', 'Jazz', 'Lo-Fi', 'Ambient'],
        focus: ['Classical', 'Ambient', 'Electronic'],
        work: ['Classical', 'Jazz', 'Lo-Fi'],
        sleep: ['Ambient', 'Classical', 'New Age'],
        sad: ['R&B', 'Indie', 'Blues', 'Soul'],
        happy: ['Pop', 'Disco', 'Funk', 'Soul'],
        romantic: ['R&B', 'Jazz', 'Soul'],
      };

      for (const [key, vals] of Object.entries(moodMap)) {
        if (keywords.some(k => key.includes(k) || k.includes(key))) {
          genres.push(...vals);
        }
      }

      if (genres.length === 0) {
        genres = ['Rock', 'Hip Hop', 'Electronic', 'Jazz', 'Pop'];
      }
    }

    genres = [...new Set(genres)];

    let query = 'SELECT * FROM songs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (genres.length > 0) {
      const placeholders = genres.map(() => `$${paramIndex++}`).join(',');
      query += ` AND genre IN (${placeholders})`;
      params.push(...genres);
    }

    if (analysis.era?.start && analysis.era?.end) {
      query += ` AND year >= $${paramIndex++} AND year <= $${paramIndex++}`;
      params.push(analysis.era.start, analysis.era.end);
    }

    query += ' ORDER BY RANDOM()';
    query += ` LIMIT $${paramIndex}`;
    params.push(count);

    const songsResult = await db.query(query, params);

    const playlistName = name || `AI: ${prompt.slice(0, 40)}`;
    const description = analysis.description || `Generated from: ${prompt}`;

    const playlistResult = await db.query(
      'INSERT INTO playlists (user_id, name, description, is_ai_generated, prompt, is_public) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [req.user.userId, playlistName, description, true, prompt, false]
    );

    const playlist = playlistResult.rows[0];

    if (songsResult.rows.length > 0) {
      const values = [];
      const placeholders = [];
      let batchParamIndex = 1;

      songsResult.rows.forEach((song, index) => {
        placeholders.push(`($${batchParamIndex++}, $${batchParamIndex++}, $${batchParamIndex++})`);
        values.push(playlist.id, song.id, index + 1);
      });

      const insertQuery = `INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ${placeholders.join(', ')}`;
      await db.query(insertQuery, values);
    }

    logger.info({ action: 'ai_playlist_generated', userId: req.user.userId, playlistId: playlist.id });

    res.status(201).json({
      message: 'AI playlist generated successfully',
      playlist,
      songs: songsResult.rows,
      analysis: {
        mood: analysis.mood,
        genres,
        description,
      },
    });
  } catch (error) {
    logger.error('Generate AI playlist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deletePlaylist = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM playlists WHERE id = $1 AND user_id = $2 RETURNING *',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found or access denied' });
    }

    res.json({ message: 'Playlist deleted successfully' });
  } catch (error) {
    logger.error('Delete playlist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** Compact positions to 1..N after a delete so gaps do not accumulate. */
const renumberPlaylistPositions = async (playlistId, client = db) => {
  await client.query(
    `WITH ordered AS (
       SELECT song_id, ROW_NUMBER() OVER (ORDER BY position, song_id) AS new_pos
       FROM playlist_songs
       WHERE playlist_id = $1
     )
     UPDATE playlist_songs ps
     SET position = ordered.new_pos
     FROM ordered
     WHERE ps.playlist_id = $1 AND ps.song_id = ordered.song_id`,
    [playlistId]
  );
};

const removeSongFromPlaylist = async (req, res) => {
  try {
    const { id, songId } = req.params;

    const playlistResult = await db.query(
      'SELECT user_id FROM playlists WHERE id = $1',
      [id]
    );

    if (playlistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (playlistResult.rows[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const del = await db.query(
      'DELETE FROM playlist_songs WHERE playlist_id = $1 AND song_id = $2 RETURNING song_id',
      [id, songId]
    );

    if (del.rows.length === 0) {
      return res.status(404).json({ error: 'Song not in playlist' });
    }

    await renumberPlaylistPositions(id);

    res.json({ message: 'Song removed from playlist' });
  } catch (error) {
    logger.error('Remove song from playlist error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Reorder tracks: body.songIds is the full ordered list of song IDs for this playlist.
 * Owner-only. Validates set equality with current membership, then assigns positions 1..N.
 */
const reorderPlaylistSongs = async (req, res) => {
  try {
    const { id } = req.params;
    const { songIds } = req.body;

    if (!Array.isArray(songIds) || songIds.length === 0) {
      return res.status(400).json({ error: 'songIds must be a non-empty array' });
    }

    const normalized = songIds.map((x) => parseInt(x, 10));
    if (normalized.some((n) => !Number.isFinite(n) || n < 1)) {
      return res.status(400).json({ error: 'Invalid song ID in songIds' });
    }
    if (new Set(normalized).size !== normalized.length) {
      return res.status(400).json({ error: 'songIds must be unique' });
    }

    const playlistResult = await db.query(
      'SELECT user_id FROM playlists WHERE id = $1',
      [id]
    );

    if (playlistResult.rows.length === 0) {
      return res.status(404).json({ error: 'Playlist not found' });
    }

    if (playlistResult.rows[0].user_id !== req.user.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const existing = await db.query(
      'SELECT song_id FROM playlist_songs WHERE playlist_id = $1',
      [id]
    );
    const existingIds = existing.rows.map((r) => r.song_id).sort((a, b) => a - b);
    const incomingSorted = [...normalized].sort((a, b) => a - b);

    if (
      existingIds.length !== incomingSorted.length ||
      existingIds.some((v, i) => v !== incomingSorted[i])
    ) {
      return res.status(400).json({
        error: 'songIds must list exactly the songs currently in the playlist',
      });
    }

    // Offset positions temporarily so unique(position) constraints (if any) never collide mid-update
    await db.query(
      'UPDATE playlist_songs SET position = position + 1000000 WHERE playlist_id = $1',
      [id]
    );

    for (let i = 0; i < normalized.length; i++) {
      await db.query(
        'UPDATE playlist_songs SET position = $1 WHERE playlist_id = $2 AND song_id = $3',
        [i + 1, id, normalized[i]]
      );
    }

    res.json({ message: 'Playlist order updated', songIds: normalized });
  } catch (error) {
    logger.error('Reorder playlist songs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getPlaylists,
  getPlaylistById,
  createPlaylist,
  addSongToPlaylist,
  generateAIPlaylist,
  deletePlaylist,
  removeSongFromPlaylist,
  reorderPlaylistSongs,
};
