require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');

const { connectRedis, getRedisClient } = require('./config/redis');
const { getPoolStatus } = require('./config/database');
const db = require('./config/database');
const setupSocketHandlers = require('./socket/handlers');
const { logger, requestLogger } = require('./utils/logger');
const corsOptions = require('./config/cors');

const authRoutes = require('./routes/auth');
const songRoutes = require('./routes/songs');
const playlistRoutes = require('./routes/playlists');
const playbackRoutes = require('./routes/playback');
const roomRoutes = require('./routes/rooms');
const aiRoutes = require('./routes/ai');
const mediaRoutes = require('./routes/media');
const commerceRoutes = require('./routes/commerce');
const discoveryRoutes = require('./routes/discovery');
const socialRoutes = require('./routes/social');
const intelRoutes = require('./routes/intel');

const colabAIService = require('./services/colabAIService');
const features = require('./config/features');
const jobWorker = require('./services/jobs/worker');
const transcodeService = require('./services/media/transcodeService');

const app = express();
app.set('trust proxy', 1);

const server = http.createServer(app);
const io = socketIo(server, { cors: corsOptions });

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "wss:", "ws:"],
    },
  },
}));

app.use(compression());

// Request ID
app.use((req, res, next) => {
  req.id = req.get('X-Request-ID') || uuidv4();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// Rate limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const streamLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many streaming requests, please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Too many authentication attempts.' },
});

const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many health checks.' },
});

app.use('/api/songs', (req, res, next) => {
  if (/^\/\d+\/stream(?:$|\/)/.test(req.path) || /^\/\d+\/stream-url$/.test(req.path)) {
    return streamLimiter(req, res, next);
  }
  return apiLimiter(req, res, next);
});

app.use('/api/', (req, res, next) => {
  if (req.path.startsWith('/songs/')) return next();
  return apiLimiter(req, res, next);
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// CORS + Body parsing
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(requestLogger);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/songs', songRoutes);
app.use('/api/playlists', playlistRoutes);
app.use('/api/playback', playbackRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/ai', aiRoutes);
if (features.isMediaPipelineEnabled()) {
  app.use('/api/media', mediaRoutes);
}
if (features.isCommerceEnabled()) {
  app.use('/api/commerce', commerceRoutes);
}
if (features.isDiscoveryEnabled()) {
  app.use('/api/discovery', discoveryRoutes);
}
if (features.isSocialEnabled()) {
  app.use('/api/social', socialRoutes);
}
if (features.isIntelEnabled()) {
  app.use('/api/intel', intelRoutes);
}

// Health check
app.get('/api/health', healthLimiter, async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    requestId: req.id,
    checks: {},
  };

  try {
    await db.query('SELECT 1');
    health.checks.database = { status: 'healthy', ...getPoolStatus() };
  } catch (err) {
    health.status = 'degraded';
    health.checks.database = { status: 'unhealthy', error: err.message };
  }

  try {
    const redis = getRedisClient();
    if (redis && redis.isReady) {
      await redis.ping();
      health.checks.redis = { status: 'healthy' };
    } else {
      health.checks.redis = { status: 'not_connected' };
    }
  } catch (err) {
    health.status = 'degraded';
    health.checks.redis = { status: 'unhealthy', error: err.message };
  }

  res.status(health.status === 'ok' ? 200 : 503).json(health);
});

// Static files
const clientBuildPath = path.join(__dirname, '../client/build');
app.use(express.static(clientBuildPath));

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.url.startsWith('/api')) return next();
  res.sendFile(path.join(clientBuildPath, 'index.html'));
});

// Socket.io
setupSocketHandlers(io);

// Error handling
app.use((err, req, res, next) => {
  logger.error({ requestId: req.id, error: err.message, stack: err.stack, method: req.method, url: req.originalUrl });
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    requestId: req.id,
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found', requestId: req.id });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectRedis();
    logger.info('Connected to Redis');

    const aiInitialized = await colabAIService.initialize();
    logger.info(aiInitialized ? 'Colab AI Service initialized' : 'Colab AI Service running in fallback mode');

    if (features.isWorkerEnabled()) {
      try {
        if (features.isMediaPipelineEnabled()) {
          jobWorker.register('transcode', transcodeService.processTranscodeJob);
        }
        if (features.isDiscoveryEnabled()) {
          const embeddingService = require('./services/discovery/embeddingService');
          const radarService = require('./services/discovery/radarService');
          jobWorker.register('embed-songs', embeddingService.processEmbedJob);
          jobWorker.register('radar-refresh', radarService.processRadarRefreshJob);
        }
        if (features.isIntelEnabled()) {
          const analyticsService = require('./services/intel/analyticsService');
          jobWorker.register('intel-rollup', analyticsService.processRollupJob);
        }
        await jobWorker.start({ intervalMs: parseInt(process.env.JOB_POLL_INTERVAL_MS, 10) || 15000 });
      } catch (workerErr) {
        logger.warn(`Job worker failed to start (API still serving): ${workerErr.message}`);
      }
    }

    server.listen(PORT, () => {
      logger.info(`Hathor server running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received: closing HTTP server');
  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
});
