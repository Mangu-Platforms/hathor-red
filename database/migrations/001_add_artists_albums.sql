-- Migration 001: Add Artists, Albums tables and extend Songs
-- Hathor Red v2.0

BEGIN;

-- Create artists table
CREATE TABLE IF NOT EXISTS artists (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    bio TEXT,
    image_url VARCHAR(500),
    genres TEXT[],
    spotify_id VARCHAR(50),
    social_links JSONB DEFAULT '{}',
    verified BOOLEAN DEFAULT FALSE,
    follower_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create albums table
CREATE TABLE IF NOT EXISTS albums (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    artist_id INTEGER REFERENCES artists(id) ON DELETE CASCADE,
    cover_url VARCHAR(500),
    release_date DATE,
    total_tracks INTEGER DEFAULT 0,
    album_type VARCHAR(20) DEFAULT 'album',
    genres TEXT[],
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add new columns to songs table
ALTER TABLE songs 
    ADD COLUMN IF NOT EXISTS artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS album_id INTEGER REFERENCES albums(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS energy DECIMAL(3,2), -- 0.00 to 1.00
    ADD COLUMN IF NOT EXISTS valence DECIMAL(3,2), -- 0.00 to 1.00
    ADD COLUMN IF NOT EXISTS embeddings vector(1536);

-- Migrate existing data: create artists from song.artist field
INSERT INTO artists (name, created_at, updated_at)
SELECT DISTINCT 
    s.artist as name,
    CURRENT_TIMESTAMP as created_at,
    CURRENT_TIMESTAMP as updated_at
FROM songs s
WHERE s.artist IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM artists a WHERE a.name = s.artist
    );

-- Link songs to their artists
UPDATE songs s
SET artist_id = a.id
FROM artists a
WHERE s.artist = a.name
    AND s.artist_id IS NULL;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_songs_artist_id ON songs(artist_id);
CREATE INDEX IF NOT EXISTS idx_songs_album_id ON songs(album_id);
CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name);
CREATE INDEX IF NOT EXISTS idx_albums_artist_id ON albums(artist_id);

-- Create trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_artists_updated_at
    BEFORE UPDATE ON artists
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_albums_updated_at
    BEFORE UPDATE ON albums
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMIT;