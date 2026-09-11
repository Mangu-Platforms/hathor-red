const jwt = require('jsonwebtoken');
const { STREAM_TOKEN_EXPIRE } = require('../config/constants');

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function signStreamToken({ userId, songId, username }) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET environment variable is not set');
  }
  const uid = toPositiveInt(userId);
  const sid = toPositiveInt(songId);
  if (uid == null || sid == null) {
    throw new Error('stream token requires positive integer userId and songId');
  }
  const payload = {
    typ: 'stream',
    userId: uid,
    songId: sid,
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
  const uid = toPositiveInt(decoded.userId);
  const sid = toPositiveInt(decoded.songId);
  if (uid == null || sid == null) {
    throw new Error('Invalid stream token payload');
  }
  decoded.userId = uid;
  decoded.songId = sid;
  return decoded;
}

module.exports = { signStreamToken, verifyStreamToken, toPositiveInt };
