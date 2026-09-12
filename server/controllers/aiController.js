/**
 * AI Controller
 *
 * Handles all AI-powered endpoints for the Hathor Music Platform.
 * Uses the Colab Enterprise AI service for intelligent features.
 */

const colabAIService = require('../services/colabAIService');
const db = require('../config/database');
const { toPositiveInt } = require('../utils/streamToken');

/**
 * Get AI service status
 */
const getStatus = async (req, res) => {
  try {
    const status = colabAIService.getStatus();
    res.json({ status });
  } catch (error) {
    console.error('AI status error:', error);
    res.status(500).json({ error: 'Failed to get AI status' });
  }
};

/**
 * Generate intelligent playlist using AI
 */
const generatePlaylist = async (req, res) => {
  try {
    const { prompt, name, songCount = 10 } = req.body;
    const { userId } = req.user;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Get user's listening history for context
    const historyResult = await db.query(
      `SELECT s.genre, s.artist, COUNT(*) as play_count
       FROM listening_history lh
       JOIN songs s ON lh.song_id = s.id
       WHERE lh.user_id = $1
       GROUP BY s.genre, s.artist
       ORDER BY play_count DESC
       LIMIT 20`,
      [userId]
    );

    const context = {
      history: historyResult.rows,
      favoriteGenres: [...new Set(historyResult.rows.map(r => r.genre).filter(Boolean))]
    };

    // Analyze the prompt using AI
    const analysis = await colabAIService.analyzePlaylistPrompt(prompt, context);

    // Build query based on AI analysis
    let query = 'SELECT * FROM songs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    // Filter by genres
    if (analysis.genres && analysis.genres.length > 0) {
      const genrePlaceholders = analysis.genres.map(() => `$${paramIndex++}`).join(',');
      query += ` AND genre IN (${genrePlaceholders})`;
      params.push(...analysis.genres);
    }

    // Filter by year/era
    if (analysis.era && analysis.era.start && analysis.era.end) {
      query += ` AND year >= $${paramIndex++} AND year <= $${paramIndex++}`;
      params.push(analysis.era.start, analysis.era.end);
    }

    // Add keyword search if available
    if (analysis.keywords && analysis.keywords.length > 0) {
      const keywordSearch = analysis.keywords.slice(0, 3).join(' | ');
      query += ` AND (title ILIKE $${paramIndex} OR artist ILIKE $${paramIndex} OR album ILIKE $${paramIndex})`;
      params.push(`%${keywordSearch}%`);
      paramIndex++;
    }

    // Order by energy level match and randomness
    query += ' ORDER BY RANDOM()';
    query += ` LIMIT $${paramIndex}`;
    params.push(Math.min(songCount, 50));

    const songsResult = await db.query(query, params);

    // Create the playlist
    const playlistName = name || `AI: ${prompt.slice(0, 40)}`;
    const description = analysis.description || `AI-generated playlist for: ${prompt}`;

    const playlistResult = await db.query(
      `INSERT INTO playlists (user_id, name, description, is_ai_generated, prompt)
       VALUES ($1, $2, $3, true, $4)
       RETURNING *`,
      [userId, playlistName, description, prompt]
    );

    const playlist = playlistResult.rows[0];

    // Add songs to playlist
    for (let i = 0; i < songsResult.rows.length; i++) {
      await db.query(
        'INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1, $2, $3)',
        [playlist.id, songsResult.rows[i].id, i + 1]
      );
    }

    res.status(201).json({
      message: 'AI playlist generated successfully',
      playlist,
      songs: songsResult.rows,
      analysis: {
        mood: analysis.mood,
        genres: analysis.genres,
        description: analysis.description
      }
    });
  } catch (error) {
    console.error('AI playlist generation error:', error);
    res.status(500).json({ error: 'Failed to generate AI playlist' });
  }
};

/**
 * Get personalized recommendations
 */
const getRecommendations = async (req, res) => {
  try {
    const { userId } = req.user;
    const { limit = 20 } = req.query;

    // Get user's listening history
    const historyResult = await db.query(
      `SELECT s.id, s.title, s.artist, s.genre, s.album,
              COUNT(*) as play_count,
              MAX(lh.listened_at) as last_played
       FROM listening_history lh
       JOIN songs s ON lh.song_id = s.id
       WHERE lh.user_id = $1
       GROUP BY s.id, s.title, s.artist, s.genre, s.album
       ORDER BY play_count DESC, last_played DESC
       LIMIT 50`,
      [userId]
    );

    // Get favorite artists and genres
    const favoriteArtists = [...new Set(historyResult.rows.map(r => r.artist))].slice(0, 10);
    const favoriteGenres = [...new Set(historyResult.rows.map(r => r.genre).filter(Boolean))];

    const userContext = {
      recentPlays: historyResult.rows.slice(0, 10),
      favoriteArtists,
      favoriteGenres
    };

    const options = {
      timeOfDay: new Date().getHours(),
      dayOfWeek: new Date().toLocaleDateString('en-US', { weekday: 'long' })
    };

    // Get AI recommendations
    const recommendations = await colabAIService.getRecommendations(userContext, options);

    // Fetch recommended songs based on AI analysis
    let query = 'SELECT * FROM songs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (recommendations.genres && recommendations.genres.length > 0) {
      const genrePlaceholders = recommendations.genres.map(() => `$${paramIndex++}`).join(',');
      query += ` AND genre IN (${genrePlaceholders})`;
      params.push(...recommendations.genres);
    }

    // Exclude recently played songs
    const recentSongIds = historyResult.rows.slice(0, 20).map(r => r.id);
    if (recentSongIds.length > 0) {
      const excludePlaceholders = recentSongIds.map(() => `$${paramIndex++}`).join(',');
      query += ` AND id NOT IN (${excludePlaceholders})`;
      params.push(...recentSongIds);
    }

    query += ' ORDER BY RANDOM()';
    query += ` LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const songsResult = await db.query(query, params);

    res.json({
      recommendations: {
        songs: songsResult.rows,
        mood: recommendations.mood,
        energyLevel: recommendations.energyLevel,
        reasons: recommendations.recommendations || []
      },
      userProfile: {
        favoriteGenres: favoriteGenres.slice(0, 5),
        favoriteArtists: favoriteArtists.slice(0, 5),
        totalPlays: historyResult.rows.reduce((sum, r) => sum + parseInt(r.play_count), 0)
      }
    });
  } catch (error) {
    console.error('Get recommendations error:', error);
    res.status(500).json({ error: 'Failed to get recommendations' });
  }
};

/**
 * Detect mood from user input
 */
const detectMood = async (req, res) => {
  try {
    const { input, context = {} } = req.body;

    if (!input) {
      return res.status(400).json({ error: 'Input is required' });
    }

    const moodAnalysis = await colabAIService.detectMood(input, context);

    // Get songs matching the detected mood
    const genreQuery = moodAnalysis.suggestedGenres && moodAnalysis.suggestedGenres.length > 0
      ? `genre IN (${moodAnalysis.suggestedGenres.map((_, i) => `$${i + 1}`).join(',')})`
      : '1=1';

    const songsResult = await db.query(
      `SELECT * FROM songs WHERE ${genreQuery} ORDER BY RANDOM() LIMIT 10`,
      moodAnalysis.suggestedGenres || []
    );

    res.json({
      mood: moodAnalysis,
      suggestedSongs: songsResult.rows
    });
  } catch (error) {
    console.error('Mood detection error:', error);
    res.status(500).json({ error: 'Failed to detect mood' });
  }
};

/**
 * Semantic search for music
 */
const semanticSearch = async (req, res) => {
  try {
    const { query: searchQuery, limit = 20 } = req.query;

    if (!searchQuery) {
      return res.status(400).json({ error: 'Search query is required' });
    }

    // Get AI-enhanced search parameters
    const searchParams = await colabAIService.semanticSearch(searchQuery);

    // Build database query
    let query = 'SELECT * FROM songs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    // Search by terms
    if (searchParams.searchTerms && searchParams.searchTerms.length > 0) {
      const searchConditions = searchParams.searchTerms.map(() => {
        const idx = paramIndex++;
        return `(title ILIKE $${idx} OR artist ILIKE $${idx} OR album ILIKE $${idx})`;
      }).join(' OR ');
      query += ` AND (${searchConditions})`;
      params.push(...searchParams.searchTerms.map(t => `%${t}%`));
    }

    // Filter by genres
    if (searchParams.genres && searchParams.genres.length > 0) {
      const genrePlaceholders = searchParams.genres.map(() => `$${paramIndex++}`).join(',');
      query += ` AND genre IN (${genrePlaceholders})`;
      params.push(...searchParams.genres);
    }

    query += ' ORDER BY title';
    query += ` LIMIT $${paramIndex}`;
    params.push(parseInt(limit));

    const songsResult = await db.query(query, params);

    res.json({
      results: songsResult.rows,
      searchParams,
      totalResults: songsResult.rows.length
    });
  } catch (error) {
    console.error('Semantic search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
};

/**
 * AI chat assistant
 */
const chat = async (req, res) => {
  try {
    const { message, conversationHistory = [] } = req.body;
    const { userId } = req.user;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Get user context
    const historyResult = await db.query(
      `SELECT s.genre
       FROM listening_history lh
       JOIN songs s ON lh.song_id = s.id
       WHERE lh.user_id = $1
       GROUP BY s.genre
       ORDER BY COUNT(*) DESC
       LIMIT 5`,
      [userId]
    );

    const context = {
      favoriteGenres: historyResult.rows.map(r => r.genre).filter(Boolean),
      currentPage: req.body.currentPage || 'home'
    };

    const response = await colabAIService.chat(message, conversationHistory, context);

    // Process any actions
    let actionResults = null;
    if (response.actions && response.actions.length > 0) {
      actionResults = [];
      for (const action of response.actions) {
        if (action.type === 'search' && action.params?.query) {
          const searchResult = await db.query(
            `SELECT id, title, artist, album FROM songs
             WHERE title ILIKE $1 OR artist ILIKE $1
             ORDER BY title LIMIT 5`,
            [`%${action.params.query}%`]
          );
          actionResults.push({
            type: 'search',
            results: searchResult.rows
          });
        }
      }
    }

    res.json({
      response: response.message,
      actions: response.actions || [],
      actionResults
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Chat failed' });
  }
};

/**
 * Get song similarity suggestions
 * dose-1.48: apply shared toPositiveInt on path :songId (same bar as discovery/social/song controllers)
 */
const getSimilarSongs = async (req, res) => {
  try {
    const songId = toPositiveInt(req.params.songId);
    if (songId == null) {
      return res.status(400).json({ error: 'Invalid song ID' });
    }
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

    // Get the reference song
    const songResult = await db.query(
      'SELECT * FROM songs WHERE id = $1',
      [songId]
    );

    if (songResult.rows.length === 0) {
      return res.status(404).json({ error: 'Song not found' });
    }

    const song = songResult.rows[0];

    // Find similar songs by genre and artist
    const similarResult = await db.query(
      `SELECT * FROM songs
       WHERE id != $1
       AND (genre = $2 OR artist = $3)
       ORDER BY
         CASE WHEN artist = $3 THEN 0 ELSE 1 END,
         RANDOM()
       LIMIT $4`,
      [songId, song.genre, song.artist, limit]
    );

    res.json({
      referenceSong: song,
      similarSongs: similarResult.rows
    });
  } catch (error) {
    console.error('Similar songs error:', error);
    res.status(500).json({ error: 'Failed to get similar songs' });
  }
};

/**
 * Generate daily mix playlist
 */
const getDailyMix = async (req, res) => {
  try {
    const { userId } = req.user;

    // Get user's listening patterns
    const historyResult = await db.query(
      `SELECT s.genre, s.artist, COUNT(*) as plays
       FROM listening_history lh
       JOIN songs s ON lh.song_id = s.id
       WHERE lh.user_id = $1
       AND lh.listened_at > NOW() - INTERVAL '30 days'
       GROUP BY s.genre, s.artist
       ORDER BY plays DESC`,
      [userId]
    );

    const topGenres = [...new Set(historyResult.rows.map(r => r.genre).filter(Boolean))].slice(0, 3);
    const topArtists = [...new Set(historyResult.rows.map(r => r.artist))].slice(0, 5);

    // Build a personalized mix
    let query = 'SELECT * FROM songs WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (topGenres.length > 0) {
      const genrePlaceholders = topGenres.map(() => `$${paramIndex++}`).join(',');
      query += ` AND genre IN (${genrePlaceholders})`;
      params.push(...topGenres);
    }

    query += ' ORDER BY RANDOM() LIMIT 25';

    const songsResult = await db.query(query, params);

    res.json({
      dailyMix: {
        name: `Your Daily Mix - ${new Date().toLocaleDateString()}`,
        songs: songsResult.rows,
        basedOn: {
          genres: topGenres,
          artists: topArtists.slice(0, 3)
        }
      }
    });
  } catch (error) {
    console.error('Daily mix error:', error);
    res.status(500).json({ error: 'Failed to generate daily mix' });
  }
};

module.exports = {
  getStatus,
  generatePlaylist,
  getRecommendations,
  detectMood,
  semanticSearch,
  chat,
  getSimilarSongs,
  getDailyMix
};
