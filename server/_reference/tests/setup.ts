/**
 * Test Setup
 * Hathor Red v2.0 - Test environment configuration
 */

import db from '../config/database';

// Set test environment
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-that-is-long-enough-for-hmac-256';
process.env.JWT_EXPIRE = '15m';
process.env.JWT_REFRESH_EXPIRE = '7d';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:test@localhost:5432/hathor_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/9';
process.env.OPENAI_API_KEY = '';

// Global test timeout
jest.setTimeout(10000);

// Clean up database after all tests
afterAll(async () => {
  await db.end();
});

// Clean up tables before each test
beforeEach(async () => {
  // Truncate all test tables
  const tables = [
    'refresh_tokens',
    'oauth_accounts',
    'song_embeddings',
    'transcoded_tracks',
    'room_messages',
    'song_stems',
    'chat_messages',
    'room_participants',
    'listening_rooms',
    'playback_states',
    'playlist_songs',
    'playlists',
    'listening_history',
    'song_likes',
    'user_follows',
    'songs',
    'users',
  ];

  for (const table of tables) {
    try {
      await db.query(`TRUNCATE TABLE ${table} CASCADE`);
    } catch {
      // Table might not exist
    }
  }
});
