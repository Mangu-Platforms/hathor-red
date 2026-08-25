const { logger } = require('../utils/logger');
const { isAdmin } = require('../utils/roles');
const db = require('../config/database');
const eventService = require('../services/intel/eventService');
const analyticsService = require('../services/intel/analyticsService');

/** Resolve which artist's analytics the caller may see (self, or any via admin). */
async function resolveArtistScope(req) {
  if (req.query.artistId && (await isAdmin(req.user.userId))) {
    return parseInt(req.query.artistId, 10);
  }
  return req.user.userId;
}

function windowDays(req) {
  return Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
}

/** POST /api/intel/events — batched player telemetry ingestion. */
const ingestEvents = async (req, res) => {
  try {
    const result = await eventService.ingestBatch({
      userId: req.user.userId,
      events: req.body.events,
      country: eventService.countryFromHeaders(req.headers),
      source: req.body.source || 'web',
    });
    res.status(202).json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    logger.error('Ingest events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** GET /api/intel/overview — catalog-wide stats for the artist. */
const getOverview = async (req, res) => {
  try {
    const artistUserId = await resolveArtistScope(req);
    res.json({ artistUserId, ...(await analyticsService.overview(artistUserId, { days: windowDays(req) })) });
  } catch (error) {
    logger.error('Intel overview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** GET /api/intel/top-tracks */
const getTopTracks = async (req, res) => {
  try {
    const artistUserId = await resolveArtistScope(req);
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
    res.json({
      artistUserId,
      tracks: await analyticsService.topTracks(artistUserId, { days: windowDays(req), limit }),
    });
  } catch (error) {
    logger.error('Intel top tracks error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** GET /api/intel/songs/:id/retention — uploader/admin only (ANA-02). */
const getSongRetention = async (req, res) => {
  try {
    const songId = parseInt(req.params.id, 10);
    const songResult = await db.query('SELECT uploaded_by FROM songs WHERE id = $1', [songId]);
    if (songResult.rows.length === 0) return res.status(404).json({ error: 'Song not found' });
    if (songResult.rows[0].uploaded_by !== req.user.userId && !(await isAdmin(req.user.userId))) {
      return res.status(403).json({ error: 'Only the uploader or an admin can view retention analytics' });
    }

    const retention = await analyticsService.songRetention(songId);
    res.json(retention);
  } catch (error) {
    logger.error('Song retention error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** GET /api/intel/geography — streams by country (ANA-01). */
const getGeography = async (req, res) => {
  try {
    const artistUserId = await resolveArtistScope(req);
    res.json({
      artistUserId,
      days: windowDays(req),
      countries: await analyticsService.geography(artistUserId, { days: windowDays(req) }),
    });
  } catch (error) {
    logger.error('Intel geography error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** GET /api/intel/revenue-by-track — artist-share cents per song. */
const getRevenueByTrack = async (req, res) => {
  try {
    const artistUserId = await resolveArtistScope(req);
    res.json({ artistUserId, tracks: await analyticsService.revenueByTrack(artistUserId) });
  } catch (error) {
    logger.error('Intel revenue error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  ingestEvents,
  getOverview,
  getTopTracks,
  getSongRetention,
  getGeography,
  getRevenueByTrack,
};
