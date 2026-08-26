const { logger } = require('../utils/logger');
const { isAdmin } = require('../utils/roles');
const searchService = require('../services/discovery/searchService');
const radarService = require('../services/discovery/radarService');
const jobQueue = require('../services/jobs/jobQueue');

/** GET /api/discovery/search?q=…&limit=… — semantic catalog search. */
const search = async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
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
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    const result = await searchService.similarSongs(parseInt(req.params.id, 10), { limit });
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
