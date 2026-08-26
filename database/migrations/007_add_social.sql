-- Migration 007: Social Listening — time-synced track comments
-- Project Olympus M4 (Pillar 4). Additive only.
--
-- Room chat already persists to chat_messages (v1 table); reactions and
-- presence are ephemeral socket state by design.

BEGIN;

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

COMMIT;
