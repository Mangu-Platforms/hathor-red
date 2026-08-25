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
    early_access_until TIMESTAMP,
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

-- ── Project Olympus M2: creator commerce ────────────────────────────────────
-- (mirrored in database/migrations/005_add_commerce.sql)


-- A sellable item. song products link to a song; merch/bundle products may
-- carry external fulfillment metadata instead.
CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY,
    artist_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    product_type VARCHAR(20) NOT NULL DEFAULT 'track',  -- track | album | merch
    title VARCHAR(255) NOT NULL,
    description TEXT,
    -- Fixed price in cents. For name-your-price, price_cents is the suggested
    -- price and min_price_cents the floor (0 allowed = free/pay-what-you-want).
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    min_price_cents INTEGER CHECK (min_price_cents >= 0),
    name_your_price BOOLEAN NOT NULL DEFAULT FALSE,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_products_artist ON products(artist_user_id);
CREATE INDEX IF NOT EXISTS idx_products_song ON products(song_id);
CREATE INDEX IF NOT EXISTS idx_products_active ON products(active) WHERE active = TRUE;

-- One row per checkout. Idempotency: a client-supplied idempotency_key is
-- unique per buyer, so double-submits return the original purchase instead of
-- charging twice (named mechanism, NFR-07).
CREATE TABLE IF NOT EXISTS purchases (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    buyer_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    -- pending | completed | failed | refunded
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    provider VARCHAR(20) NOT NULL DEFAULT 'mock',       -- mock | stripe
    provider_ref VARCHAR(255),
    idempotency_key VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(buyer_user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON purchases(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id);

-- Permanent entitlements ("Owned-It"). One row per user+song.
CREATE TABLE IF NOT EXISTS user_library (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_user_library_user ON user_library(user_id);

-- One-time tokens for lossless original downloads. Single use is enforced by
-- the atomic conditional UPDATE ... WHERE consumed_at IS NULL (named
-- mechanism, NFR-07); expiry via expires_at.
CREATE TABLE IF NOT EXISTS download_tokens (
    id SERIAL PRIMARY KEY,
    token CHAR(64) NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    expires_at TIMESTAMP NOT NULL,
    consumed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_download_tokens_user ON download_tokens(user_id);

-- Fan-club tiers an artist offers (e.g. "Inner Circle" $9.99/mo).
CREATE TABLE IF NOT EXISTS artist_subscription_tiers (
    id SERIAL PRIMARY KEY,
    artist_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    price_cents INTEGER NOT NULL CHECK (price_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    perks JSONB NOT NULL DEFAULT '{}',   -- { earlyAccess: true, merchDiscountPct: 10, ... }
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(artist_user_id, name)
);

-- A fan's membership in one artist's tier. One active membership per
-- (fan, artist) enforced by partial unique index below.
CREATE TABLE IF NOT EXISTS artist_subscriptions (
    id SERIAL PRIMARY KEY,
    tier_id INTEGER NOT NULL REFERENCES artist_subscription_tiers(id) ON DELETE CASCADE,
    fan_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    artist_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- active | canceled | past_due
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    provider VARCHAR(20) NOT NULL DEFAULT 'mock',
    provider_ref VARCHAR(255),
    current_period_start TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    current_period_end TIMESTAMP,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_artist_subscriptions_one_active
    ON artist_subscriptions(fan_user_id, artist_user_id)
    WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_artist_subscriptions_artist ON artist_subscriptions(artist_user_id);

-- Double-entry-lite revenue ledger. Every completed purchase / subscription
-- period writes one artist credit and one platform credit (sum = gross).
CREATE TABLE IF NOT EXISTS revenue_ledger (
    id SERIAL PRIMARY KEY,
    purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
    subscription_id INTEGER REFERENCES artist_subscriptions(id) ON DELETE SET NULL,
    artist_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- artist_share | platform_share
    entry_type VARCHAR(20) NOT NULL,
    amount_cents INTEGER NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_revenue_ledger_artist ON revenue_ledger(artist_user_id, created_at DESC);


-- ── Project Olympus M3: cognitive discovery ─────────────────────────────────
-- (mirrored in database/migrations/006_add_discovery.sql)


CREATE TABLE IF NOT EXISTS song_embeddings_local (
    id SERIAL PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    embedding JSONB NOT NULL,            -- array of 256 floats, L2-normalized
    model VARCHAR(50) NOT NULL DEFAULT 'mangu-feature-hash-v1',
    dims INTEGER NOT NULL DEFAULT 256,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(song_id)
);

-- Durable fallback for the per-user Mangu Radar mix (Redis is the hot cache).
CREATE TABLE IF NOT EXISTS user_radar (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tracks JSONB NOT NULL,               -- [{songId, score, reasons:[...]}, ...]
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id)
);


-- ── Project Olympus M4: social listening ────────────────────────────────────
-- (mirrored in database/migrations/007_add_social.sql)


CREATE TABLE IF NOT EXISTS track_comments (
    id SERIAL PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body TEXT NOT NULL,
    timestamp_ms INTEGER NOT NULL CHECK (timestamp_ms >= 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- The player fetches comments by time window as playback progresses.
CREATE INDEX IF NOT EXISTS idx_track_comments_song_time
    ON track_comments(song_id, timestamp_ms);


-- ── Project Olympus M5: artist intelligence ─────────────────────────────────
-- (mirrored in database/migrations/008_add_intel.sql)


CREATE TABLE IF NOT EXISTS listening_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    -- play | pause | seek | skip | complete | segment
    event_type VARCHAR(20) NOT NULL,
    position_ms INTEGER CHECK (position_ms >= 0),
    duration_ms INTEGER CHECK (duration_ms >= 0),
    -- Client-generated id: batch retries dedupe via the unique constraint
    -- below (named mechanism, NFR-07).
    client_event_id VARCHAR(64),
    country CHAR(2),
    source VARCHAR(20) NOT NULL DEFAULT 'web',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_listening_events_dedup
    ON listening_events(user_id, client_event_id)
    WHERE client_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_listening_events_song_time ON listening_events(song_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_listening_events_user_time ON listening_events(user_id, created_at DESC);

-- Daily per-song rollups written by the intel-rollup job; dashboards read
-- these first and fall back to raw events for today.
CREATE TABLE IF NOT EXISTS song_daily_stats (
    id SERIAL PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    day DATE NOT NULL,
    plays INTEGER NOT NULL DEFAULT 0,
    completes INTEGER NOT NULL DEFAULT 0,
    skips INTEGER NOT NULL DEFAULT 0,
    unique_listeners INTEGER NOT NULL DEFAULT 0,
    total_listen_ms BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(song_id, day)
);

CREATE INDEX IF NOT EXISTS idx_song_daily_stats_day ON song_daily_stats(day DESC);


-- ── Project Olympus M6: security & compliance ───────────────────────────────
-- (mirrored in database/migrations/009_add_privacy.sql)


-- Append-only audit trail for sensitive actions (logins, purchases, catalog
-- changes, privacy requests, admin operations).
CREATE TABLE IF NOT EXISTS audit_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(60) NOT NULL,
    target_type VARCHAR(40),
    target_id INTEGER,
    detail JSONB NOT NULL DEFAULT '{}',
    ip VARCHAR(45),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);

-- GDPR data export requests (72h SLA). The export job writes a JSON artifact
-- and mints a download token valid until expires_at.
CREATE TABLE IF NOT EXISTS data_export_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- pending | processing | ready | failed | expired
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    file_path VARCHAR(500),
    download_token CHAR(64) UNIQUE,
    expires_at TIMESTAMP,
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_data_export_requests_user ON data_export_requests(user_id, created_at DESC);

-- Account deletion requests. Purge execution is a policy decision (financial
-- records must be retained) — the request/cancel flow is implemented; the
-- purge worker is the documented follow-up (see docs/olympus).
CREATE TABLE IF NOT EXISTS deletion_requests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- pending | canceled | completed
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    reason TEXT,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    resolved_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deletion_requests_one_pending
    ON deletion_requests(user_id)
    WHERE status = 'pending';

