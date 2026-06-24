/**
 * CORS configuration for the Hathor Music Platform.
 * Provides restricted origin access based on environment.
 */

const corsOptions = {
  origin: (origin, callback) => {
    // Get allowed origins from environment variable
    const clientUrl = process.env.CLIENT_URL;
    const allowedOrigins = clientUrl ? clientUrl.split(',').map(o => o.trim()) : [];

    // In non-production environments, allow localhost:3000 as a default fallback
    if (process.env.NODE_ENV !== 'production') {
      if (!allowedOrigins.includes('http://localhost:3000')) {
        allowedOrigins.push('http://localhost:3000');
      }
    }

    // Block requests with null origin in production (prevents file:// and sandboxed iframe attacks)
    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        return callback(new Error('Origin header required in production'), false);
      }
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // In production, deny without error exposure
      if (process.env.NODE_ENV === 'production') {
        callback(null, false);
      } else {
        callback(new Error(`Not allowed by CORS: ${origin}`), false);
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

module.exports = corsOptions;
