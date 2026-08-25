-- Migration 008: Artist Intelligence Hub — event ingestion + daily rollups
-- Project Olympus M5 (Pillar 5). Additive only.
--
-- listening_events is the append-only telemetry stream (the ClickHouse/Kafka
-- extraction seam: same rows, different sink). listening_history (v1) stays
-- untouched as the user-facing "recently played" record.

BEGIN;

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

COMMIT;
