const jwt = require('jsonwebtoken');
const { STREAM_TOKEN_EXPIRE } = require('../config/constants');

function signStreamToken({ userId, songId }) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  return jwt.sign(
    { typ: 'stream', userId, songId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.STREAM_TOKEN_EXPIRE || STREAM_TOKEN_EXPIRE, issuer: 'hathor-music' }
  );
}

function verifyStreamToken(token) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  const decoded = jwt.verify(token, process.env.JWT_SECRET, {
    issuer: 'hathor-music',
    clockTolerance: 10,
  });
  if (!decoded || decoded.typ !== 'stream') {
    throw new Error('Invalid stream token');
  }
  return decoded;
}

module.exports = { signStreamToken, verifyStreamToken };
