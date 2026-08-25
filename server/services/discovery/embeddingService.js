/**
 * Embedding provider (Pillar 2, DEC-005).
 *
 * Local model `mangu-feature-hash-v1`: deterministic 256-dim feature-hash
 * embeddings built from a song's text metadata (title, artist, album, genre,
 * mood-ish tokens, coarse bpm bucket). No credentials, no network, identical
 * output on every machine — which makes ranking testable and CI-safe.
 *
 * The remote seam: migration 003's pgvector table (1536-dim) is the target
 * for a hosted embedding model; this module's public API (embedSong,
 * embedQuery, cosineSimilarity) is what a remote provider would re-implement.
 */

const crypto = require('crypto');
const db = require('../../config/database');

const DIMS = 256;
const MODEL = 'mangu-feature-hash-v1';

/** Lowercase, split on non-alphanumerics, drop empties and 1-char noise. */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

/** Deterministic token → (index, sign) via md5 (fast, stable, non-crypto use). */
function tokenSlot(token) {
  const digest = crypto.createHash('md5').update(token).digest();
  const index = digest.readUInt32BE(0) % DIMS;
  const sign = digest[4] % 2 === 0 ? 1 : -1;
  return { index, sign };
}

/**
 * Feature-hash a token list into an L2-normalized DIMS-dim vector.
 * Bigrams add local word-order context so "night drive" != "drive night".
 */
function embedTokens(tokens) {
  const vector = new Array(DIMS).fill(0);
  const emit = (token, weight) => {
    const { index, sign } = tokenSlot(token);
    vector[index] += sign * weight;
  };

  for (const token of tokens) emit(token, 1);
  for (let i = 0; i < tokens.length - 1; i += 1) {
    emit(`${tokens[i]}_${tokens[i + 1]}`, 0.5);
  }

  const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/** Coarse bpm bucket so 118 and 122 land together but 80 and 160 don't. */
function bpmBucket(bpm) {
  const value = parseInt(bpm, 10);
  if (!value || value <= 0) return null;
  return `bpm${Math.round(value / 20) * 20}`;
}

/** Compose the text a song is embedded from. Pure. */
function songText(song) {
  const parts = [
    song.title,
    song.artist,
    song.album,
    song.genre,
    song.genre, // genre twice: it is the strongest similarity signal we store
    bpmBucket(song.bpm),
    song.key_signature ? `key${String(song.key_signature).toLowerCase()}` : null,
    song.year ? `era${Math.floor(parseInt(song.year, 10) / 10) * 10}s` : null,
  ];
  return parts.filter(Boolean).join(' ');
}

function embedSong(song) {
  return embedTokens(tokenize(songText(song)));
}

function embedQuery(text) {
  return embedTokens(tokenize(text));
}

/** Cosine similarity for normalized vectors = dot product; guard anyway. */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Upsert the local embedding row for one song. */
async function upsertSongEmbedding(song) {
  const embedding = embedSong(song);
  await db.query(
    `INSERT INTO song_embeddings_local (song_id, embedding, model, dims, updated_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
     ON CONFLICT (song_id) DO UPDATE SET
       embedding = $2, model = $3, dims = $4, updated_at = CURRENT_TIMESTAMP`,
    [song.id, JSON.stringify(embedding), MODEL, DIMS]
  );
  return embedding;
}

/**
 * Job handler 'embed-songs'. Payload: { songId } for one song, or {} to
 * backfill every song missing a current-model embedding.
 */
async function processEmbedJob(payload = {}) {
  if (payload.songId) {
    const result = await db.query('SELECT * FROM songs WHERE id = $1', [payload.songId]);
    if (result.rows.length === 0) return { embedded: 0, reason: 'song missing' };
    await upsertSongEmbedding(result.rows[0]);
    return { embedded: 1 };
  }

  const missing = await db.query(
    `SELECT s.* FROM songs s
     LEFT JOIN song_embeddings_local e ON e.song_id = s.id AND e.model = $1
     WHERE e.id IS NULL
     ORDER BY s.id
     LIMIT 500`,
    [MODEL]
  );
  for (const song of missing.rows) {
    await upsertSongEmbedding(song);
  }
  return { embedded: missing.rows.length, remainingBatch: missing.rows.length === 500 };
}

module.exports = {
  DIMS,
  MODEL,
  tokenize,
  embedTokens,
  songText,
  embedSong,
  embedQuery,
  cosineSimilarity,
  upsertSongEmbedding,
  processEmbedJob,
};
