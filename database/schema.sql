-- Hathor Music Platform - Database Schema

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100),
    avatar_url VARCHAR(255),
    role VARCHAR(20) DEFAULT 'listener',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS songs (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    album VARCHAR(255),
    duration INTEGER NOT NULL,
    file_path VARCHAR(255) NOT NULL,
    cover_url VARCHAR(255),
    genre VARCHAR(50),
    year INTEGER,
    bpm INTEGER,
    key_signature VARCHAR(10),
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    play_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlists (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    is_ai_generated BOOLEAN DEFAULT FALSE,
    prompt TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    cover_url VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS playlist_songs (
    id SERIAL PRIMARY KEY,
    playlist_id INTEGER REFERENCES playlists(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(playlist_id, song_id)
);

CREATE TABLE IF NOT EXISTS listening_rooms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    host_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    current_song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
    current_position INTEGER DEFAULT 0,
    is_playing BOOLEAN DEFAULT FALSE,
    is_public BOOLEAN DEFAULT TRUE,
    max_listeners INTEGER DEFAULT 50,
    description TEXT,
    theme VARCHAR(50) DEFAULT 'default',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS room_participants (
    id SERIAL PRIMARY KEY,
    room_id INTEGER REFERENCES listening_rooms(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(room_id, user_id)
);

CREATE TABLE IF NOT EXISTS playback_states (
    id SERIAL PRIMARY KEY,
    user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    current_song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
    position INTEGER DEFAULT 0,
    is_playing BOOLEAN DEFAULT FALSE,
    volume REAL DEFAULT 1.0,
    playback_speed REAL DEFAULT 1.0,
    pitch_shift REAL DEFAULT 0.0,
    stems_config JSONB DEFAULT '{"vocals": true, "drums": true, "bass": true, "other": true}'::jsonb,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS listening_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    listened_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    duration_played INTEGER,
    completion_rate REAL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    room_id INTEGER REFERENCES listening_rooms(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_follows (
    id SERIAL PRIMARY KEY,
    follower_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    following_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS song_likes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, song_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_songs_genre ON songs(genre);
CREATE INDEX IF NOT EXISTS idx_songs_artist ON songs(artist);
CREATE INDEX IF NOT EXISTS idx_songs_created ON songs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_songs_year ON songs(year) WHERE year IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_playlists_user ON playlists(user_id);
CREATE INDEX IF NOT EXISTS idx_playlists_public ON playlists(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist ON playlist_songs(playlist_id);
CREATE INDEX IF NOT EXISTS idx_playlist_songs_song ON playlist_songs(song_id);
CREATE INDEX IF NOT EXISTS idx_listening_history_user ON listening_history(user_id);
CREATE INDEX IF NOT EXISTS idx_listening_history_song ON listening_history(song_id);
CREATE INDEX IF NOT EXISTS idx_listening_history_listened ON listening_history(listened_at DESC);
CREATE INDEX IF NOT EXISTS idx_room_participants_room ON room_participants(room_id);
CREATE INDEX IF NOT EXISTS idx_room_participants_user ON room_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_rooms_public ON listening_rooms(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_rooms_host ON listening_rooms(host_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_room ON chat_messages(room_id);
CREATE INDEX IF NOT EXISTS idx_song_likes_user ON song_likes(user_id);
CREATE INDEX IF NOT EXISTS idx_song_likes_song ON song_likes(song_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_follower ON user_follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_user_follows_following ON user_follows(following_id);

-- Full-text search
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_songs_trgm ON songs USING gin(
    (COALESCE(title, '') || ' ' || COALESCE(artist, '') || ' ' || COALESCE(album, '')) gin_trgm_ops
);

-- ── Project Olympus M1: media pipeline ──────────────────────────────────────
-- (mirrored in database/migrations/004_add_media_pipeline.sql)

CREATE TABLE IF NOT EXISTS media_assets (
    id SERIAL PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    original_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255),
    mime_type VARCHAR(100),
    file_size_bytes BIGINT,
    sha256 CHAR(64),
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    loudness_lufs REAL,
    true_peak_db REAL,
    waveform_peaks JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(song_id)
);

CREATE TABLE IF NOT EXISTS media_variants (
    id SERIAL PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    variant_key VARCHAR(50) NOT NULL,
    format VARCHAR(20) NOT NULL,
    bitrate_kbps INTEGER,
    file_path VARCHAR(500),
    file_size_bytes BIGINT,
    status VARCHAR(30) NOT NULL DEFAULT 'planned',
    ffmpeg_command TEXT,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(asset_id, variant_key)
);

CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    job_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    priority INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,
    run_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    last_error TEXT,
    result JSONB,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_assets_sha256 ON media_assets(sha256);
CREATE INDEX IF NOT EXISTS idx_media_assets_status ON media_assets(status);
CREATE INDEX IF NOT EXISTS idx_media_variants_asset ON media_variants(asset_id);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, run_at, priority DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);
