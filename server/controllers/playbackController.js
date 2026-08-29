const db = require('../config/database');
const { redisClient } = require('../config/redis');

const getPlaybackState = async (req, res) => {
  try {
    const { userId } = req.user;

    // Try Redis first for speed; fall through to DB on failure
    const cacheKey = `playback:${userId}`;
    let cached = null;
    try {
      cached = await redisClient.get(cacheKey);
    } catch (redisErr) {
      console.error('Redis get error (falling back to DB):', redisErr.message);
    }

    if (cached) {
      return res.json({ state: JSON.parse(cached) });
    }

    // Fallback to database
    const result = await db.query(
      'SELECT * FROM playback_states WHERE user_id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.json({ state: null });
    }

    const state = result.rows[0];
    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(state));
    } catch (redisErr) {
      console.error('Redis setEx error (cache miss, state still returned):', redisErr.message);
    }

    res.json({ state });
  } catch (error) {
    console.error('Get playback state error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updatePlaybackState = async (req, res) => {
  try {
    const { userId } = req.user;
    const body = req.body || {};
    const {
      position,
      isPlaying,
      volume,
      playbackSpeed,
      pitchShift,
      stemsConfig
    } = body;

    // Explicit null clears current_song_id (e.g. Clear queue). Omitted key leaves prior value.
    const hasSongId = Object.prototype.hasOwnProperty.call(body, 'currentSongId');
    const currentSongId = hasSongId ? body.currentSongId : undefined;

    const result = await db.query(
      `INSERT INTO playback_states (user_id, current_song_id, position, is_playing, volume, playback_speed, pitch_shift, stems_config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE SET
         current_song_id = CASE WHEN $9::boolean THEN $2 ELSE playback_states.current_song_id END,
         position = COALESCE($3, playback_states.position),
         is_playing = COALESCE($4, playback_states.is_playing),
         volume = COALESCE($5, playback_states.volume),
         playback_speed = COALESCE($6, playback_states.playback_speed),
         pitch_shift = COALESCE($7, playback_states.pitch_shift),
         stems_config = COALESCE($8, playback_states.stems_config),
         updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [
        userId,
        hasSongId ? currentSongId : null,
        position,
        isPlaying,
        volume,
        playbackSpeed,
        pitchShift,
        stemsConfig,
        hasSongId,
      ]
    );

    const state = result.rows[0];

    // Update Redis cache; DB write already succeeded so don't fail the request on cache error
    const cacheKey = `playback:${userId}`;
    try {
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(state));
    } catch (redisErr) {
      console.error('Redis setEx error (DB update succeeded):', redisErr.message);
    }

    res.json({
      message: 'Playback state updated',
      state
    });
  } catch (error) {
    console.error('Update playback state error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getPlaybackState,
  updatePlaybackState
};
