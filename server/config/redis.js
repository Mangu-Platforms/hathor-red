const redis = require('redis');
const { toPositiveInt } = require('../utils/streamToken');

// Railway/Render provide REDIS_URL; fallback to individual vars
// dose-1.68: REDIS_PORT uses shared toPositiveInt (reject NaN/0/negative/junk;
// fall back to 6379) instead of raw parseInt that can leave NaN.
const redisPort = toPositiveInt(process.env.REDIS_PORT) ?? 6379;

const redisClient = process.env.REDIS_URL
  ? redis.createClient({ url: process.env.REDIS_URL })
  : redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: redisPort,
        reconnectStrategy: (retries) => Math.min(retries * 50, 500),
      },
      password: process.env.REDIS_PASSWORD || undefined,
    });

redisClient.on('error', (err) => {
  console.error('Redis Client Error', err);
});

redisClient.on('connect', () => {
  console.log('Redis client connected');
});

const connectRedis = async () => {
  try {
    await redisClient.connect();
  } catch (err) {
    console.error('Failed to connect to Redis:', err);
  }
};

const getRedisClient = () => redisClient;

module.exports = { redisClient, connectRedis, getRedisClient };
