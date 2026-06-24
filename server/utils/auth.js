const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { BCRYPT_COST_FACTOR, JWT_DEFAULT_EXPIRE } = require('../config/constants');

const generateToken = (userId, username) => {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return jwt.sign(
    { userId, username },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || JWT_DEFAULT_EXPIRE, issuer: 'hathor-music' }
  );
};

const hashPassword = async (password) => {
  return await bcrypt.hash(password, BCRYPT_COST_FACTOR);
};

const comparePassword = async (password, hash) => {
  return await bcrypt.compare(password, hash);
};

module.exports = {
  generateToken,
  hashPassword,
  comparePassword,
};
