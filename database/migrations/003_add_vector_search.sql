-- Migration 003: Add pgvector extension and song embeddings
-- Hathor Red v2.0

BEGIN;

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create song embeddings table
CREATE TABLE IF NOT EXISTS song_embeddings (
    id SERIAL PRIMARY KEY,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    embedding vector(1536),
    model VARCHAR(50) DEFAULT 'text-embedding-3-small',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(song_id)
);

-- Create vector similarity index using ivfflat
CREATE INDEX IF NOT EXISTS idx_song_embeddings_vector 
ON song_embeddings 
USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);

-- Create function for semantic search
CREATE OR REPLACE FUNCTION search_songs_by_embedding(
    query_embedding vector(1536),
    match_threshold FLOAT,
    match_count INT
)
RETURNS TABLE(
    song_id INT,
    similarity FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        se.song_id,
        1 - (se.embedding <=> query_embedding) AS similarity
    FROM song_embeddings se
    WHERE 1 - (se.embedding <=> query_embedding) > match_threshold
    ORDER BY se.embedding <=> query_embedding
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

-- Create function for hybrid search
CREATE OR REPLACE FUNCTION hybrid_search_songs(
    query_text TEXT,
    query_embedding vector(1536),
    vector_weight FLOAT DEFAULT 0.5,
    text_weight FLOAT DEFAULT 0.5,
    match_count INT DEFAULT 20
)
RETURNS TABLE(
    song_id INT,
    title VARCHAR,
    artist VARCHAR,
    combined_score FLOAT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.id,
        s.title,
        s.artist,
        (
            vector_weight * (1 - (se.embedding <=> query_embedding)) +
            text_weight * (
                CASE 
                    WHEN s.title ILIKE '%' || query_text || '%' THEN 0.3
                    WHEN s.artist ILIKE '%' || query_text || '%' THEN 0.2
                    WHEN s.album ILIKE '%' || query_text || '%' THEN 0.1
                    ELSE 0.0
                END
            )
        ) as combined_score
    FROM songs s
    LEFT JOIN song_embeddings se ON s.id = se.song_id
    ORDER BY combined_score DESC
    LIMIT match_count;
END;
$$ LANGUAGE plpgsql;

COMMIT;