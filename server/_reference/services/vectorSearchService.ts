/**
 * Vector Search Service
 * Hathor Red v2.0 - pgvector semantic search engine
 */

import db from '../config/database';
import { generateEmbedding } from './llmService';
import { Song, HybridSearchResponse, SearchResultItem } from '../types';

let isInitialized = false;

export async function initialize(): Promise<boolean> {
  try {
    // Check if pgvector extension is available
    const result = await db.query("SELECT * FROM pg_extension WHERE extname = 'vector'");
    if (result.rows.length === 0) {
      console.warn('[VectorSearch] pgvector extension not found');
      return false;
    }
    isInitialized = true;
    console.log('[VectorSearch] Service initialized');
    return true;
  } catch (error) {
    console.error('[VectorSearch] Initialization error:', error);
    return false;
  }
}

/**
 * Index a song by generating and storing its embedding
 */
export async function indexSong(
  songId: number,
  title: string,
  artist: string,
  album?: string,
  genre?: string
): Promise<boolean> {
  if (!isInitialized) return false;

  try {
    const text = `${title} by ${artist} ${album || ''} ${genre || ''}`.trim();
    const embedding = await generateEmbedding(text);

    await db.query(
      `INSERT INTO song_embeddings (song_id, embedding, model)
       VALUES ($1, $2, $3)
       ON CONFLICT (song_id) DO UPDATE SET
         embedding = $2,
         model = $3,
         created_at = CURRENT_TIMESTAMP`,
      [songId, formatVector(embedding), 'text-embedding-3-small']
    );

    return true;
  } catch (error) {
    console.error('[VectorSearch] Index error:', error);
    return false;
  }
}

/**
 * Search songs by semantic similarity
 */
export async function semanticSearch(
  query: string,
  limit: number = 20
): Promise<SearchResultItem[]> {
  if (!isInitialized) return fallbackTextSearch(query, limit);

  try {
    const embedding = await generateEmbedding(query);

    const result = await db.query(
      `SELECT s.*, 1 - (se.embedding <=> $1::vector) as similarity
       FROM songs s
       JOIN song_embeddings se ON s.id = se.song_id
       ORDER BY se.embedding <=> $1::vector
       LIMIT $2`,
      [formatVector(embedding), limit]
    );

    return result.rows.map(row => ({
      song: mapSong(row),
      similarity: parseFloat(row.similarity),
    }));
  } catch (error) {
    console.error('[VectorSearch] Semantic search error:', error);
    return fallbackTextSearch(query, limit);
  }
}

/**
 * Hybrid search combining vector similarity, text search, and metadata filters
 */
export async function hybridSearch(
  query: string,
  options: {
    genres?: string[];
    yearFrom?: number;
    yearTo?: number;
    vectorWeight?: number;
    textWeight?: number;
    limit?: number;
  } = {}
): Promise<HybridSearchResponse> {
  const startTime = Date.now();
  const limit = options.limit || 20;

  if (!isInitialized) {
    const results = await fallbackTextSearch(query, limit);
    return {
      results: results.map(r => ({ ...r, combinedScore: r.textScore })),
      totalResults: results.length,
      query,
      timing: { totalMs: Date.now() - startTime },
    };
  }

  try {
    const embedding = await generateEmbedding(query);
    const vectorW = options.vectorWeight ?? 0.5;
    const textW = options.textWeight ?? 0.5;

    let sql = `SELECT s.*, 
      ${vectorW} * (1 - (se.embedding <=> $1::vector)) +
      ${textW} * (
        CASE WHEN s.title ILIKE $2 THEN 0.3
             WHEN s.artist ILIKE $2 THEN 0.2
             WHEN s.album ILIKE $2 THEN 0.1
             ELSE 0 END
      ) as combined_score,
      1 - (se.embedding <=> $1::vector) as similarity
      FROM songs s
      LEFT JOIN song_embeddings se ON s.id = se.song_id`;

    const params: any[] = [formatVector(embedding), `%${query}%`];
    let paramIdx = 3;

    const conditions: string[] = [];

    if (options.genres && options.genres.length > 0) {
      conditions.push(`s.genre = ANY($${paramIdx})`);
      params.push(options.genres);
      paramIdx++;
    }

    if (options.yearFrom) {
      conditions.push(`s.year >= $${paramIdx}`);
      params.push(options.yearFrom);
      paramIdx++;
    }

    if (options.yearTo) {
      conditions.push(`s.year <= $${paramIdx}`);
      params.push(options.yearTo);
      paramIdx++;
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ` ORDER BY combined_score DESC LIMIT $${paramIdx}`;
    params.push(limit);

    const result = await db.query(sql, params);
    const embeddingMs = Date.now() - startTime;

    return {
      results: result.rows.map(row => ({
        song: mapSong(row),
        similarity: parseFloat(row.similarity),
        combinedScore: parseFloat(row.combined_score),
      })),
      totalResults: result.rows.length,
      query,
      timing: {
        embeddingMs,
        totalMs: Date.now() - startTime,
      },
    };
  } catch (error) {
    console.error('[VectorSearch] Hybrid search error:', error);
    const results = await fallbackTextSearch(query, limit);
    return {
      results: results.map(r => ({ ...r, combinedScore: r.textScore })),
      totalResults: results.length,
      query,
      timing: { totalMs: Date.now() - startTime },
    };
  }
}

/**
 * Find similar songs to a given song
 */
export async function findSimilarSongs(
  songId: number,
  limit: number = 10
): Promise<SearchResultItem[]> {
  if (!isInitialized) return [];

  try {
    const result = await db.query(
      `SELECT s.*, 1 - (se2.embedding <=> se1.embedding) as similarity
       FROM song_embeddings se1
       JOIN song_embeddings se2 ON se1.song_id != se2.song_id
       JOIN songs s ON se2.song_id = s.id
       WHERE se1.song_id = $1
       ORDER BY se1.embedding <=> se2.embedding
       LIMIT $2`,
      [songId, limit]
    );

    return result.rows.map(row => ({
      song: mapSong(row),
      similarity: parseFloat(row.similarity),
    }));
  } catch (error) {
    console.error('[VectorSearch] Similar songs error:', error);
    return [];
  }
}

/**
 * Delete a song's embedding
 */
export async function deleteSongEmbedding(songId: number): Promise<void> {
  try {
    await db.query('DELETE FROM song_embeddings WHERE song_id = $1', [songId]);
  } catch (error) {
    console.error('[VectorSearch] Delete error:', error);
  }
}

// Helpers
function formatVector(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

function mapSong(row: any): Song {
  return {
    id: row.id,
    title: row.title,
    artist: row.artist,
    artistId: row.artist_id,
    album: row.album,
    albumId: row.album_id,
    duration: row.duration,
    filePath: row.file_path,
    coverUrl: row.cover_url,
    genre: row.genre,
    year: row.year,
    bpm: row.bpm,
    keySignature: row.key_signature,
    energy: row.energy,
    valence: row.valence,
    playCount: row.play_count,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

async function fallbackTextSearch(query: string, limit: number): Promise<SearchResultItem[]> {
  try {
    const result = await db.query(
      `SELECT * FROM songs 
       WHERE title ILIKE $1 OR artist ILIKE $1 OR album ILIKE $1
       ORDER BY play_count DESC
       LIMIT $2`,
      [`%${query}%`, limit]
    );
    return result.rows.map(row => ({
      song: mapSong(row),
      textScore: 0.5,
    }));
  } catch {
    return [];
  }
}