-- Migration 004: Media pipeline — assets, variants, durable job queue
-- Project Olympus M1 (Pillar 1: Immersive Audio Engine)
-- Additive only. Safe to run repeatedly (IF NOT EXISTS guards).

BEGIN;

-- One row per uploaded original audio file. songs.file_path remains the
-- direct-stream fallback; media_assets adds pipeline state on top.
CREATE TABLE IF NOT EXISTS media_assets (
    id SERIAL PRIMARY KEY,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    original_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255),
    mime_type VARCHAR(100),
    file_size_bytes BIGINT,
    sha256 CHAR(64),
    -- pending | processing | ready | failed | copyright_review
    status VARCHAR(30) NOT NULL DEFAULT 'pending',
    loudness_lufs REAL,
    true_peak_db REAL,
    -- { version, source: 'ffmpeg'|'approximation', peaks: [0..1 floats] }
    waveform_peaks JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(song_id)
);

CREATE INDEX IF NOT EXISTS idx_media_assets_sha256 ON media_assets(sha256);
CREATE INDEX IF NOT EXISTS idx_media_assets_status ON media_assets(status);

-- Transcoded renditions of an asset (one per quality tier / packaging).
CREATE TABLE IF NOT EXISTS media_variants (
    id SERIAL PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
    variant_key VARCHAR(50) NOT NULL,   -- e.g. opus-160, aac-256, mp3-320, flac, hls-high
    format VARCHAR(20) NOT NULL,        -- opus | aac | mp3 | flac | hls
    bitrate_kbps INTEGER,
    file_path VARCHAR(500),
    file_size_bytes BIGINT,
    -- planned | processing | ready | failed | skipped_no_ffmpeg
    status VARCHAR(30) NOT NULL DEFAULT 'planned',
    ffmpeg_command TEXT,                -- exact command, persisted for audit/replay
    error TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(asset_id, variant_key)
);

CREATE INDEX IF NOT EXISTS idx_media_variants_asset ON media_variants(asset_id);

-- Durable job queue. Postgres is the source of truth; Redis (when reachable)
-- is only a wake-up channel. Claiming uses
-- UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) so concurrent
-- workers never double-claim (named mechanism, NFR-07).
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    job_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    -- queued | running | completed | failed | dead
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

CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(status, run_at, priority DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(job_type);

COMMIT;
