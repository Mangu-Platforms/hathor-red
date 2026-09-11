const jwt = require('jsonwebtoken');

/**
 * Standard Bearer JWT auth. Normalizes req.user to { userId, username }
 * so controllers can rely on the same shape as streamAuth.
 * Rejects stream-typed tokens (those must use ?t= on the stream path).
 * Requires finite positive integer userId (same bar as stream tokens, dose-1.27).
 */
const authMiddleware = (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    if (!authHeader) {
      return res.status(401).json({ error: 'No authentication token provided' });
    }

    const match = authHeader.match(/^Bearer\s+(\S+)$/i);
    if (!match) {
      return res.status(401).json({ error: 'Invalid Authorization header format' });
    }

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not configured');
      return res.status(500).json({ error: 'Server authentication misconfigured' });
    }

    const decoded = jwt.verify(match[1], process.env.JWT_SECRET, {
      issuer: 'hathor-music',
      clockTolerance: 60,
    });

    // Stream tokens must use the query-parameter path, not Authorization.
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
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    return res.status(401).json({ error: 'Authentication failed' });
  }
};

module.exports = authMiddleware;
