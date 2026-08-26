/**
 * Semantic search (Pillar 2, FR-201): blends embedding cosine similarity,
 * metadata text matching, intent-extracted filters, and freshness into one
 * ranked result list with human-readable "why we picked this" reasons.
 *
 * Runs with zero external credentials. When pgvector + a remote model are
 * enabled, the candidate-fetch step is the swap point (SQL ANN query instead
 * of the JS ranking below).
 */

const db = require('../../config/database');
const { ALLOWED_GENRES } = require('../../config/constants');
const { embedQuery, cosineSimilarity } = require('./embeddingService');

const MOOD_LEXICON = {
  sad: ['sad', 'melancholy', 'melancholic', 'heartbreak', 'blue', 'crying', 'lonely'],
  chill: ['chill', 'relax', 'relaxing', 'calm', 'mellow', 'lofi', 'lo-fi', 'ambient'],
  energetic: ['energetic', 'hype', 'workout', 'pump', 'party', 'banger', 'upbeat'],
  dark: ['dark', 'night', 'midnight', 'rainy', 'moody', 'noir', 'brooding'],
  romantic: ['romantic', 'love', 'valentine', 'slow', 'intimate'],
  focus: ['focus', 'study', 'concentration', 'coding', 'work', 'deep'],
};

const GENRE_HINTS = {
  synthwave: 'Electronic',
  synth: 'Electronic',
  edm: 'Electronic',
  'bass-heavy': 'Techno',
  bass: 'Techno',
  beats: 'Hip Hop',
  rap: 'Hip Hop',
  orchestral: 'Classical',
  symphony: 'Classical',
  acoustic: 'Folk',
};

/**
 * Deterministic intent extraction: genres (exact + hint words), bpm, moods.
 * Pure — unit tested.
 */
function parseIntent(query) {
  const lower = String(query || '').toLowerCase();
  const tokens = lower.split(/[^a-z0-9-]+/).filter(Boolean);

  const genres = new Set();
  const tokenSet = new Set(tokens);
  for (const genre of ALLOWED_GENRES) {
    // Word-boundary matching, not substring: "popcorn" must not trigger Pop,
    // nor "seoul" trigger Soul. Multi-word genres match as token sequences.
    const genreTokens = genre.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean);
    const matches = genreTokens.length === 1
      ? tokenSet.has(genreTokens[0])
      : genreTokens.every((t) => tokenSet.has(t));
    if (matches) genres.add(genre);
  }
  for (const token of tokens) {
    if (GENRE_HINTS[token]) genres.add(GENRE_HINTS[token]);
  }

  const bpmMatch = lower.match(/(\d{2,3})\s*bpm/);
  const bpm = bpmMatch ? parseInt(bpmMatch[1], 10) : null;

  const moods = [];
  for (const [mood, words] of Object.entries(MOOD_LEXICON)) {
    if (words.some((w) => lower.includes(w))) moods.push(mood);
  }

  return { genres: Array.from(genres), bpm, moods };
}

function textMatchScore(song, tokens) {
  if (tokens.length === 0) return 0;
  const haystack = `${song.title} ${song.artist} ${song.album || ''} ${song.genre || ''}`.toLowerCase();
  const hits = tokens.filter((t) => haystack.includes(t)).length;
  return hits / tokens.length;
}

function freshnessScore(createdAt) {
  if (!createdAt) return 0;
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;
  if (ageDays <= 0) return 1;
  return Math.max(0, 1 - ageDays / 90); // linear decay over ~3 months
}

function buildReasons(song, intent, scores) {
  const reasons = [];
  if (intent.genres.length > 0 && song.genre && intent.genres.includes(song.genre)) {
    reasons.push(`matches the ${song.genre} vibe you asked for`);
  }
  if (intent.bpm && song.bpm && Math.abs(song.bpm - intent.bpm) <= 10) {
    reasons.push(`tempo sits right at ${song.bpm} BPM`);
  }
  if (intent.moods.length > 0 && scores.cosine > 0.15) {
    reasons.push(`feels ${intent.moods.join(' and ')} like your search`);
  }
  if (scores.text >= 0.5) {
    reasons.push('closely matches your words');
  } else if (scores.cosine > 0.25) {
    reasons.push('semantically close to what you described');
  }
  if (scores.freshness > 0.7) {
    reasons.push('fresh on Mangu this month');
  }
  if (reasons.length === 0) {
    reasons.push('a nearby pick from the catalog');
  }
  return reasons;
}

/**
 * Rank candidate songs (each carrying an `embedding` array or null) against a
 * query. Pure — unit tested. Returns [{song, score, reasons}] sorted desc.
 */
function rankCandidates(query, candidates, { limit = 20 } = {}) {
  const intent = parseIntent(query);
  const queryVector = embedQuery(query);
  const tokens = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);

  const scored = [];
  for (const song of candidates) {
    const cosine = song.embedding ? cosineSimilarity(queryVector, song.embedding) : 0;
    const text = textMatchScore(song, tokens);
    const freshness = freshnessScore(song.created_at);

    let genreBoost = 0;
    if (intent.genres.length > 0) {
      genreBoost = song.genre && intent.genres.includes(song.genre) ? 0.25 : -0.1;
    }
    let bpmBoost = 0;
    if (intent.bpm && song.bpm) {
      bpmBoost = Math.abs(song.bpm - intent.bpm) <= 10 ? 0.15 : 0;
    }

    const score = 0.5 * cosine + 0.25 * text + 0.1 * freshness + genreBoost + bpmBoost;
    scored.push({
      song,
      score: Math.round(score * 1000) / 1000,
      reasons: buildReasons(song, intent, { cosine, text, freshness }),
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return { intent, results: scored.slice(0, limit) };
}

/** Fetch candidates: embedded songs plus text-matched songs (union, capped). */
async function fetchCandidates(query, cap = 400) {
  const sanitized = String(query || '').replace(/[%_\\]/g, '\\$&');
  const result = await db.query(
    `SELECT s.*, e.embedding
     FROM songs s
     LEFT JOIN song_embeddings_local e ON e.song_id = s.id
     WHERE e.id IS NOT NULL
        OR s.title ILIKE $1 OR s.artist ILIKE $1 OR s.album ILIKE $1 OR s.genre ILIKE $1
     ORDER BY s.play_count DESC NULLS LAST, s.created_at DESC
     LIMIT $2`,
    [`%${sanitized}%`, cap]
  );
  return result.rows.map((row) => ({
    ...row,
    embedding: typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding,
  }));
}

/** End-to-end semantic search over the catalog. */
async function semanticSearch(query, { limit = 20 } = {}) {
  const candidates = await fetchCandidates(query);
  const { intent, results } = rankCandidates(query, candidates, { limit });
  return {
    query,
    intent,
    results: results.map(({ song, score, reasons }) => ({
      song: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        album: song.album,
        genre: song.genre,
        bpm: song.bpm,
        year: song.year,
        duration: song.duration,
        cover_url: song.cover_url,
      },
      score,
      reasons,
    })),
  };
}

/** Songs most similar to a given song (embedding neighborhood). */
async function similarSongs(songId, { limit = 10 } = {}) {
  const baseResult = await db.query(
    `SELECT s.*, e.embedding FROM songs s
     LEFT JOIN song_embeddings_local e ON e.song_id = s.id
     WHERE s.id = $1`,
    [songId]
  );
  const base = baseResult.rows[0];
  if (!base) return null;
  const baseEmbedding = typeof base.embedding === 'string' ? JSON.parse(base.embedding) : base.embedding;
  if (!baseEmbedding) return { song: base, similar: [] };

  const candidates = await db.query(
    `SELECT s.*, e.embedding FROM songs s
     JOIN song_embeddings_local e ON e.song_id = s.id
     WHERE s.id <> $1
     LIMIT 1000`,
    [songId]
  );

  const scored = candidates.rows
    .map((row) => {
      const embedding = typeof row.embedding === 'string' ? JSON.parse(row.embedding) : row.embedding;
      return { song: row, score: cosineSimilarity(baseEmbedding, embedding) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ song, score }) => ({
      song: {
        id: song.id,
        title: song.title,
        artist: song.artist,
        genre: song.genre,
        bpm: song.bpm,
        cover_url: song.cover_url,
      },
      score: Math.round(score * 1000) / 1000,
    }));

  return { songId: base.id, similar: scored };
}

module.exports = {
  MOOD_LEXICON,
  parseIntent,
  textMatchScore,
  freshnessScore,
  rankCandidates,
  fetchCandidates,
  semanticSearch,
  similarSongs,
};
