-- Migration 006: Cognitive Discovery — portable embeddings + radar cache
-- Project Olympus M3 (Pillar 2). Additive only.
--
-- song_embeddings (migration 003) stores 1536-dim pgvector rows for the
-- remote-model path and requires the vector extension. This migration adds a
-- portable layer that works on ANY Postgres: deterministic 256-dim local
-- embeddings in JSONB, ranked in application code. When a remote embedding
-- provider + pgvector are enabled, the two coexist (dual-write seam, DEC-005).

BEGIN;

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

COMMIT;
