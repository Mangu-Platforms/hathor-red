const jwt = require('jsonwebtoken');
const { verifyStreamToken } = require('../utils/streamToken');

/**
 * Auth for progressive stream responses.
 * Prefer short-lived signed query token (`?t=`) so <audio src> works without
 * Authorization headers. Fall back to Bearer JWT for non-media callers.
 * Always normalize req.user to { userId, username } so controllers can rely on it.
 * Stream tokens must carry finite positive integer userId + songId (dose-1.26).
 * dose-1.28: when a stream token is present and the route has :id, reject if
 * token.songId does not match the path param (defense in depth; controller
 * still re-checks).
 */
function streamAuth(req, res, next) {
  try {
    const streamToken = req.query?.t;

    if (streamToken) {
      const decoded = verifyStreamToken(streamToken);
      // verifyStreamToken already requires positive integer userId/songId
      const pathId = req.params?.id;
      if (pathId != null) {
        const routeSongId = Number(pathId);
        if (
          !Number.isFinite(routeSongId) ||
          !Number.isInteger(routeSongId) ||
          routeSongId <= 0 ||
          routeSongId !== decoded.songId
        ) {
          return res.status(401).json({ error: 'Invalid stream token for song' });
        }
      }
      req.user = {
        userId: decoded.userId,
        username: decoded.username || null,
      };
      req.streamToken = decoded;
      return next();
    }

    const authHeader = req.header('Authorization');
    if (!authHeader) {
      return res.status(401).json({ error: 'No authentication token provided' });
    }

    const match = authHeader.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      return res.status(401).json({ error: 'Invalid Authorization header format' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: 'Server authentication misconfigured' });
    }

    const decoded = jwt.verify(match[1], process.env.JWT_SECRET, {
      issuer: 'hathor-music',
      clockTolerance: 60,
    });

    // Reject stream-typed tokens on the Bearer path (must use ?t=).
    if (decoded.typ === 'stream') {
      return res.status(401).json({ error: 'Stream tokens must use the query parameter' });
    }

    const userId = decoded.userId ?? decoded.id;
    const uid = Number(userId);
    if (userId == null || !Number.isFinite(uid) || !Number.isInteger(uid) || uid <= 0) {
      return res.status(401).json({ error: 'Invalid authentication token' });
    }

    req.user = {
      userId: uid,
      username: decoded.username || null,
    };
    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid authentication token' });
  }
}

module.exports = streamAuth;
