const jwt = require('jsonwebtoken');
const { STREAM_TOKEN_EXPIRE } = require('../config/constants');

function signStreamToken({ userId, songId, username }) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  const payload = {
    typ: 'stream',
    userId,
    songId,
  };
  // Optional username so streamAuth can populate req.user.username without
  // a second lookup when the token was minted under a Bearer session.
  if (username != null && username !== '') {
    payload.username = String(username);
  }
  return jwt.sign(
    payload,
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
