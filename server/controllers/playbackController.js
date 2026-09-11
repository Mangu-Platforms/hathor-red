const db = require('../config/database');
const { redisClient } = require('../config/redis');
const { toPositiveInt } = require('../utils/streamToken');

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

/**
 * Coerce a body field to a finite number in [min, max] inclusive.
 * Returns null when the value is present but invalid (caller should 400).
 * Returns undefined when the key is omitted (leave prior DB value).
 */
function toBoundedNumber(body, key, min, max) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  const raw = body[key];
  if (raw == null) return null; // explicit null is invalid for these fields
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/**
 * Strict boolean for isPlaying when the key is present.
 * Accepts true/false only (not "true", 1, 0, null).
 * Returns undefined when omitted (leave prior DB value).
 * Returns null when present but invalid (caller should 400).
 */
function toStrictBoolean(body, key) {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  const raw = body[key];
  if (typeof raw === 'boolean') return raw;
  return null;
}

/**
 * pitchShift: optional finite number in [-24, 24] semitones (defense in depth).
 * Pitch UI does not ship; still reject NaN/Infinity/out-of-range before DB.
 * Omitted key leaves prior value; explicit null clears to null.
 */
function toPitchShift(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'pitchShift')) return undefined;
  const raw = body.pitchShift;
  if (raw === null) return null; // explicit clear
  const n = Number(raw);
  if (!Number.isFinite(n) || n < -24 || n > 24) return null; // invalid -> 400
  return n;
}

/**
 * stemsConfig: optional plain object or null (defense in depth).
 * Stems UI does not ship; reject arrays/primitives/string junk before DB.
 * Omitted key leaves prior value; explicit null clears.
 */
function toStemsConfig(body) {
  if (!Object.prototype.hasOwnProperty.call(body, 'stemsConfig')) return undefined;
  const raw = body.stemsConfig;
  if (raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null; // invalid -> 400
  return raw;
}

const updatePlaybackState = async (req, res) => {
  try {
    const { userId } = req.user;
    const body = req.body || {};

    // Explicit null clears current_song_id (e.g. Clear queue). Omitted key leaves prior value.
    // dose-1.32: when present and non-null, require finite positive integer (same bar as
    // stream/getSong/recordListening; independent of validation middleware order).
    const hasSongId = Object.prototype.hasOwnProperty.call(body, 'currentSongId');
    let currentSongId = hasSongId ? body.currentSongId : undefined;
    if (hasSongId && currentSongId != null) {
      const sid = toPositiveInt(currentSongId);
      if (sid == null) {
        return res.status(400).json({ error: 'Invalid song ID' });
      }
      currentSongId = sid;
    }

    // dose-1.33: same defense-in-depth bar for numeric playback fields so a
    // missing/bypassed express-validator chain cannot write NaN/Infinity/out-of-range
    // into playback_states. Omitted keys still leave prior values (COALESCE).
    // position: seconds, non-negative, generous upper bound (2h tracks + slack).
    const position = toBoundedNumber(body, 'position', 0, 7200);
    if (position === null) {
      return res.status(400).json({ error: 'Invalid position' });
    }
    // volume: HTML5 audio uses 0–1.
    const volume = toBoundedNumber(body, 'volume', 0, 1);
    if (volume === null) {
      return res.status(400).json({ error: 'Invalid volume' });
    }
    // playbackSpeed: common player range (0.25x–4x).
    const playbackSpeed = toBoundedNumber(body, 'playbackSpeed', 0.25, 4);
    if (playbackSpeed === null) {
      return res.status(400).json({ error: 'Invalid playback speed' });
    }

    // dose-1.34: isPlaying must be a real boolean when present (reject "true"/1/null).
    // Omitted key still leaves prior value via COALESCE.
    const isPlaying = toStrictBoolean(body, 'isPlaying');
    if (isPlaying === null) {
      return res.status(400).json({ error: 'Invalid isPlaying' });
    }

    // dose-1.35: pitchShift / stemsConfig defense-in-depth (features do not ship;
    // still reject junk before DB upsert). Explicit null clears; omitted leaves prior.
    const pitchShift = toPitchShift(body);
    if (pitchShift === null && Object.prototype.hasOwnProperty.call(body, 'pitchShift') && body.pitchShift !== null) {
      return res.status(400).json({ error: 'Invalid pitchShift' });
    }
    // toPitchShift returns null for both explicit null (clear) and invalid.
    // Distinguish: only 400 when present and not null and failed the finite/range check.
    const pitchShiftVal = (() => {
      if (!Object.prototype.hasOwnProperty.call(body, 'pitchShift')) return undefined;
      if (body.pitchShift === null) return null;
      const n = Number(body.pitchShift);
      if (!Number.isFinite(n) || n < -24 || n > 24) {
        return 'INVALID';
      }
      return n;
    })();
    if (pitchShiftVal === 'INVALID') {
      return res.status(400).json({ error: 'Invalid pitchShift' });
    }

    const stemsConfigVal = (() => {
      if (!Object.prototype.hasOwnProperty.call(body, 'stemsConfig')) return undefined;
      if (body.stemsConfig === null) return null;
      if (typeof body.stemsConfig !== 'object' || Array.isArray(body.stemsConfig)) {
        return 'INVALID';
      }
      return body.stemsConfig;
    })();
    if (stemsConfigVal === 'INVALID') {
      return res.status(400).json({ error: 'Invalid stemsConfig' });
    }

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
        position !== undefined ? position : null,
        isPlaying !== undefined ? isPlaying : null,
        volume !== undefined ? volume : null,
        playbackSpeed !== undefined ? playbackSpeed : null,
        pitchShiftVal !== undefined ? pitchShiftVal : null,
        stemsConfigVal !== undefined ? stemsConfigVal : null,
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
