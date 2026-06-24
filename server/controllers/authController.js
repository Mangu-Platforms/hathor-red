const db = require('../config/database');
const { hashPassword, comparePassword, generateToken } = require('../utils/auth');
const { logger } = require('../utils/logger');

const sanitizeInput = (str) => {
  if (!str) return '';
  return String(str).trim();
};

const register = async (req, res) => {
  try {
    const { username, email, password, displayName } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Username, email, and password are required' });
    }

    const existingUser = await db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2',
      [sanitizeInput(username), email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      const existing = existingUser.rows[0];
      const field = existing.username === sanitizeInput(username) ? 'Username' : 'Email';
      return res.status(409).json({ error: `${field} already exists` });
    }

    const passwordHash = await hashPassword(password);

    const result = await db.query(
      'INSERT INTO users (username, email, password_hash, display_name) VALUES ($1, $2, $3, $4) RETURNING id, username, email, display_name, created_at',
      [sanitizeInput(username), email.toLowerCase(), passwordHash, sanitizeInput(displayName) || sanitizeInput(username)]
    );

    const user = result.rows[0];
    const token = generateToken(user.id, user.username);

    logger.info({ action: 'user_registered', userId: user.id, username: user.username });

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
      },
    });
  } catch (error) {
    logger.error('Registration error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const login = async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const result = await db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1',
      [sanitizeInput(username)]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const isValidPassword = await comparePassword(password, user.password_hash);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = generateToken(user.id, user.username);

    logger.info({ action: 'user_login', userId: user.id, username: user.username });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        displayName: user.display_name,
        avatarUrl: user.avatar_url,
      },
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getProfile = async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, username, email, display_name, avatar_url, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    logger.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const updateProfile = async (req, res) => {
  try {
    const { displayName, avatarUrl } = req.body;

    const result = await db.query(
      'UPDATE users SET display_name = COALESCE($1, display_name), avatar_url = COALESCE($2, avatar_url), updated_at = CURRENT_TIMESTAMP WHERE id = $3 RETURNING id, username, email, display_name, avatar_url',
      [displayName ? sanitizeInput(displayName) : null, avatarUrl || null, req.user.userId]
    );

    res.json({
      message: 'Profile updated successfully',
      user: result.rows[0],
    });
  } catch (error) {
    logger.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getListeningStats = async (req, res) => {
  try {
    const { userId } = req.user;

    const totalPlays = await db.query(
      'SELECT COUNT(*) as count FROM listening_history WHERE user_id = $1',
      [userId]
    );

    const topGenres = await db.query(
      `SELECT s.genre, COUNT(*) as play_count
       FROM listening_history lh
       JOIN songs s ON lh.song_id = s.id
       WHERE lh.user_id = $1 AND s.genre IS NOT NULL
       GROUP BY s.genre
       ORDER BY play_count DESC
       LIMIT 10`,
      [userId]
    );

    const topArtists = await db.query(
      `SELECT s.artist, COUNT(*) as play_count
       FROM listening_history lh
       JOIN songs s ON lh.song_id = s.id
       WHERE lh.user_id = $1
       GROUP BY s.artist
       ORDER BY play_count DESC
       LIMIT 10`,
      [userId]
    );

    const totalTime = await db.query(
      'SELECT COALESCE(SUM(duration_played), 0) as total_seconds FROM listening_history WHERE user_id = $1',
      [userId]
    );

    res.json({
      totalPlays: parseInt(totalPlays.rows[0].count, 10),
      totalListeningTimeSeconds: parseInt(totalTime.rows[0].total_seconds, 10),
      topGenres: topGenres.rows,
      topArtists: topArtists.rows,
    });
  } catch (error) {
    logger.error('Get listening stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  register,
  login,
  getProfile,
  updateProfile,
  getListeningStats,
};
