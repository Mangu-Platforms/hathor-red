const express = require('express');
const router = express.Router();
const socialController = require('../controllers/socialController');
const authMiddleware = require('../middleware/auth');
const { validate, idParamValidation, trackCommentValidation, commentWindowValidation } = require('../middleware/validation');

router.get('/songs/:id/comments', authMiddleware, commentWindowValidation, validate, socialController.getComments);
router.post('/songs/:id/comments', authMiddleware, trackCommentValidation, validate, socialController.addComment);
router.delete('/comments/:id', authMiddleware, idParamValidation, validate, socialController.deleteComment);

module.exports = router;
