const { logger } = require('../utils/logger');
const { isAdmin } = require('../utils/roles');
const commentService = require('../services/social/commentService');
const { toPositiveInt } = require('../utils/streamToken');

const COMMENTS_DEFAULT_LIMIT = 100;
const COMMENTS_MAX_LIMIT = 500;

/**
 * Parse comments limit: finite positive integer when present, else default.
 * Rejects NaN / non-integer / <=0 / Infinity with null (caller returns 400).
 * Caps at COMMENTS_MAX_LIMIT.
 * dose-1.54: same bar as discovery search/similar and getSongs / privacy audit.
 */
function parseCommentsLimit(raw) {
  if (raw == null || raw === '') return COMMENTS_DEFAULT_LIMIT;
  const n = toPositiveInt(raw);
  if (n == null) return null;
  return Math.min(n, COMMENTS_MAX_LIMIT);
}

/**
 * Non-negative finite integer for timestamp window bounds (fromMs/toMs).
 * Allows 0; rejects NaN / negative / non-integer / Infinity.
 */
function toNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return null;
  return n;
}

/** GET /api/social/songs/:id/comments?fromMs&toMs&limit — timed window. */
const getComments = async (req, res) => {
  try {
    // dose-1.44: same positive-int bar as song/playlist/room controllers
    const songId = toPositiveInt(req.params.id);
    if (songId == null) {
      return res.status(400).json({ error: 'Invalid song ID' });
    }

    // dose-1.54: finite-int bar on fromMs / toMs / limit (no more raw parseInt
    // that coerced junk to defaults).
    let fromMs = 0;
    if (req.query.fromMs !== undefined && req.query.fromMs !== '') {
      fromMs = toNonNegativeInt(req.query.fromMs);
      if (fromMs == null) {
        return res.status(400).json({ error: 'Invalid fromMs' });
      }
    }

    let toMs = null;
    if (req.query.toMs !== undefined && req.query.toMs !== '') {
      toMs = toNonNegativeInt(req.query.toMs);
      if (toMs == null) {
        return res.status(400).json({ error: 'Invalid toMs' });
      }
    }

    const limit = parseCommentsLimit(req.query.limit);
    if (limit == null) {
      return res.status(400).json({ error: 'Invalid limit' });
    }

    const result = await commentService.getCommentsWindow({ songId, fromMs, toMs, limit });
    res.json(result);
  } catch (error) {
    logger.error('Get comments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** POST /api/social/songs/:id/comments — drop a comment at a timestamp. */
const addComment = async (req, res) => {
  try {
    // dose-1.44: same positive-int bar as getComments
    const songId = toPositiveInt(req.params.id);
    if (songId == null) {
      return res.status(400).json({ error: 'Invalid song ID' });
    }
    const comment = await commentService.addComment({
      songId,
      userId: req.user.userId,
      body: req.body.body,
      timestampMs: req.body.timestampMs,
    });
    res.status(201).json({ comment });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    logger.error('Add comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/** DELETE /api/social/comments/:id — author or admin. */
const deleteComment = async (req, res) => {
  try {
    // dose-1.44: same positive-int bar as other controllers
    const commentId = toPositiveInt(req.params.id);
    if (commentId == null) {
      return res.status(400).json({ error: 'Invalid comment ID' });
    }
    const authorId = await commentService.getCommentAuthor(commentId);
    if (authorId === null) return res.status(404).json({ error: 'Comment not found' });
    if (authorId !== req.user.userId && !(await isAdmin(req.user.userId))) {
      return res.status(403).json({ error: 'Not your comment' });
    }

    await commentService.deleteComment({ commentId });
    res.json({ message: 'Comment deleted' });
  } catch (error) {
    logger.error('Delete comment error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { getComments, addComment, deleteComment };
