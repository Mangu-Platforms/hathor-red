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
  AI_CACHE_TTL_MS: 5 * 60 * 1000,
  AI_MAX_CACHE_SIZE: 100,

  // Streaming
  STREAM_TOKEN_EXPIRE: '60s',
  STREAM_MAX_FILE_SIZE: 50 * 1024 * 1024,

  // Playback
  PLAYBACK_STATE_CACHE_TTL: 3600,

  // Auth
  BCRYPT_COST_FACTOR: 12,
  JWT_DEFAULT_EXPIRE: '7d',

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: 15 * 60 * 1000,
  RATE_LIMIT_MAX_REQUESTS: 200,
  STREAM_RATE_LIMIT_MAX: 2000,
  AUTH_RATE_LIMIT_WINDOW_MS: 60 * 60 * 1000,
  AUTH_RATE_LIMIT_MAX: 10,
  HEALTH_RATE_LIMIT_WINDOW_MS: 60 * 1000,
  HEALTH_RATE_LIMIT_MAX: 10,

  // Chat
  MAX_CHAT_MESSAGE_LENGTH: 1000,

  // Upload
  ALLOWED_AUDIO_TYPES: /mp3|wav|flac|m4a|ogg/,
  UPLOAD_DIR: process.env.UPLOAD_DIR || './uploads',

  // Allowed genres for validation
  ALLOWED_GENRES: [
    'Rock', 'Pop', 'Jazz', 'Classical', 'Hip Hop', 'Electronic',
    'R&B', 'Country', 'Metal', 'Indie', 'Blues', 'Folk', 'Ambient',
    'Reggae', 'Latin', 'Afrobeats', 'K-Pop', 'J-Pop', 'World',
    'Soul', 'Funk', 'Disco', 'Punk', 'House', 'Techno', 'Trance',
    'Dubstep', 'Trap', 'Drum and Bass', 'Gospel', 'Opera',
    'Soundtrack', 'New Age', 'Lo-Fi', 'Progressive Rock',
    'Alternative', 'Grunge', 'Ska', 'Bluegrass', 'Swing'
  ],

  // Valid room actions
  VALID_ROOM_ACTIONS: ['play', 'pause', 'seek', 'change-song'],

  // Cache TTLs (seconds)
  CACHE_TTL_SONGS: 300,
  CACHE_TTL_PLAYLISTS: 300,
  CACHE_TTL_ROOMS: 60,

  // Media pipeline (Olympus M1)
  WAVEFORM_BUCKETS: 512,
  MEDIA_VARIANT_SPECS: [
    { key: 'opus-160', format: 'opus', bitrateKbps: 160, extension: 'opus' },
    { key: 'aac-256', format: 'aac', bitrateKbps: 256, extension: 'm4a' },
    { key: 'mp3-320', format: 'mp3', bitrateKbps: 320, extension: 'mp3' },
    { key: 'flac', format: 'flac', bitrateKbps: null, extension: 'flac' },
    { key: 'hls-high', format: 'hls', bitrateKbps: 256, extension: 'm3u8' },
    { key: 'hls-standard', format: 'hls', bitrateKbps: 128, extension: 'm3u8' },
  ],

  // Audio quality tiers
  AUDIO_QUALITY: {
    FREE: { bitrate: '160k', format: 'opus', label: 'Standard' },
    STANDARD: { bitrate: '1411k', format: 'flac', label: 'Lossless' },
    HIFI: { bitrate: '4608k', format: 'flac', label: 'Hi-Res' },
    STUDIO: { bitrate: '9216k', format: 'flac', label: 'Studio' },
  },
};
