/**
 * Application constants for Hathor Music Platform
 * Centralizes magic numbers and configuration values
 */
module.exports = {
  // Pagination
  DEFAULT_PAGE_LIMIT: 50,
  MAX_PAGE_LIMIT: 200,

  // Room settings
  DEFAULT_ROOM_MAX_LISTENERS: 50,
  MAX_ROOM_MAX_LISTENERS: 100,

  // AI / Playlist
  DEFAULT_AI_PLAYLIST_SIZE: 10,
  MAX_AI_PLAYLIST_SIZE: 50,
  AI_CACHE_TTL_MS: 5 * 60 * 1000, // 5 minutes
  AI_MAX_CACHE_SIZE: 100,

  // Streaming
  STREAM_TOKEN_EXPIRE: '60s',
  STREAM_MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB

  // Playback
  PLAYBACK_STATE_CACHE_TTL: 3600, // 1 hour in seconds

  // Auth
  BCRYPT_COST_FACTOR: 12,
  JWT_DEFAULT_EXPIRE: '7d',

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: 200,
  STREAM_RATE_LIMIT_MAX: 2000,
  AUTH_RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  AUTH_RATE_LIMIT_MAX: 10,

  // Chat
  MAX_CHAT_MESSAGE_LENGTH: 1000,

  // Upload
  ALLOWED_AUDIO_TYPES: /mp3|wav|flac|m4a|ogg/,
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',

  // Allowed genres for validation
  ALLOWED_GENRES: [
    'Rock', 'Pop', 'Jazz', 'Classical', 'Hip Hop', 'Electronic',
    'R&B', 'Country', 'Metal', 'Indie', 'Blues', 'Folk', 'Ambient'
  ],
};
