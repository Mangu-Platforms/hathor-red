const { logger } = require('../utils/logger');
const { isAdmin } = require('../utils/roles');
const commentService = require('../services/social/commentService');

/** GET /api/social/songs/:id/comments?fromMs&toMs&limit — timed window. */
const getComments = async (req, res) => {
  try {
    const songId = parseInt(req.params.id, 10);
    const fromMs = req.query.fromMs !== undefined ? parseInt(req.query.fromMs, 10) : 0;
    const toMs = req.query.toMs !== undefined ? parseInt(req.query.toMs, 10) : null;
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);

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
    const comment = await commentService.addComment({
      songId: parseInt(req.params.id, 10),
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
    const commentId = parseInt(req.params.id, 10);
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
