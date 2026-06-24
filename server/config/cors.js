const corsOptions = {
  origin: (origin, callback) => {
    const clientUrl = process.env.CLIENT_URL;
    const allowedOrigins = clientUrl ? clientUrl.split(',').map(o => o.trim()) : [];

    if (process.env.NODE_ENV !== 'production') {
      if (!allowedOrigins.includes('http://localhost:3000')) {
        allowedOrigins.push('http://localhost:3000');
      }
    }

    if (!origin) {
      if (process.env.NODE_ENV === 'production') {
        return callback(new Error('Origin header required in production'), false);
      }
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      if (process.env.NODE_ENV === 'production') {
        callback(null, false);
      } else {
        callback(new Error(`Not allowed by CORS: ${origin}`), false);
      }
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
};

module.exports = corsOptions;
