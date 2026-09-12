const { logger } = require('../utils/logger');
const { isAdmin } = require('../utils/roles');
const searchService = require('../services/discovery/searchService');
const radarService = require('../services/discovery/radarService');
const jobQueue = require('../services/jobs/jobQueue');
const { toPositiveInt } = require('../utils/streamToken');

const SEARCH_DEFAULT_LIMIT = 20;
const SIMILAR_DEFAULT_LIMIT = 10;
const DISCOVERY_MAX_LIMIT = 50;

/**
 * Parse discovery limit: finite positive integer when present, else default.
 * Rejects NaN / non-integer / <=0 / Infinity with null (caller returns 400).
 * Caps at DISCOVERY_MAX_LIMIT.
 */
function parseDiscoveryLimit(raw, defaultLimit) {
  if (raw == null || raw === '') return defaultLimit;
  const n = toPositiveInt(raw);
  if (n == null) return null;
  return Math.min(n, DISCOVERY_MAX_LIMIT);
}

/** GET /api/discovery/search?q=…&limit=… — semantic catalog search. */
const search = async (req, res) => {
  try {
    // dose-1.53: same finite positive-int limit bar as getSongs / privacy audit
    // (reject NaN/0/negative/non-integer when limit is present).
    const limit = parseDiscoveryLimit(req.query.limit, SEARCH_DEFAULT_LIMIT);
    if (limit == null) {
      return res.status(400).json({ error: 'Invalid limit' });
    }
    const result = await searchService.semanticSearch(req.query.q, { limit });
    res.json(result);
  } catch (error) {
    logger.error('Discovery search error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** GET /api/discovery/radar — the caller's Mangu Radar mix. */
const getRadar = async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '') === 'true';
    const radar = await radarService.getRadar(req.user.userId, { forceRefresh });
    res.json(radar);
  } catch (error) {
    logger.error('Get radar error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** GET /api/discovery/similar/:id — embedding neighbors of a song. */
const similar = async (req, res) => {
  try {
    // dose-1.45: same positive-int bar as song/playlist/room/social controllers
    const songId = toPositiveInt(req.params.id);
    if (songId == null) {
      return res.status(400).json({ error: 'Invalid song ID' });
    }
    // dose-1.53: same finite positive-int limit bar as search / getSongs
    const limit = parseDiscoveryLimit(req.query.limit, SIMILAR_DEFAULT_LIMIT);
    if (limit == null) {
      return res.status(400).json({ error: 'Invalid limit' });
    }
    const result = await searchService.similarSongs(songId, { limit });
    if (!result) return res.status(404).json({ error: 'Song not found' });
    res.json(result);
  } catch (error) {
    logger.error('Similar songs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** POST /api/discovery/reindex — admin: queue the embedding backfill. */
const reindex = async (req, res) => {
  try {
    if (!(await isAdmin(req.user.userId))) {
      return res.status(403).json({ error: 'Admin only' });
    }
    const job = await jobQueue.enqueue('embed-songs', {}, { createdBy: req.user.userId });
    res.status(202).json({ message: 'Embedding backfill queued', jobId: job.id });
  } catch (error) {
    logger.error('Reindex error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { search, getRadar, similar, reindex };
