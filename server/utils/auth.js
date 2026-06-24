const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

/**
 * Generate JWT token for user
 * @param {number} userId - User ID
 * @param {string} username - Username
 * @returns {string} JWT token
 */
const generateToken = (userId, username) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return jwt.sign(
    { userId, username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || '7d', issuer: 'hathor-music' }
  );
};

/**
 * Hash password with bcrypt (cost factor 12)
 * @param {string} password - Plain text password
 * @returns {Promise<string>} Hashed password
 */
const hashPassword = async (password) => {
  return await bcrypt.hash(password, 12);
};

/**
 * Compare password with hash
 * @param {string} password - Plain text password
 * @param {string} hash - Stored hash
 * @returns {Promise<boolean>} Match result
 */
const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

module.exports = {
  generateToken,
  hashPassword,
  comparePassword
};
