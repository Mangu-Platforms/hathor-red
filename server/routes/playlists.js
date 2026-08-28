const express = require('express');
const router = express.Router();
const playlistController = require('../controllers/playlistController');
const authMiddleware = require('../middleware/auth');
const { playlistValidation, aiPlaylistValidation, addSongToPlaylistValidation, idParamValidation, validate } = require('../middleware/validation');
const { param, body } = require('express-validator');

const playlistSongParamsValidation = [
  param('id').isInt({ min: 1 }).withMessage('Invalid playlist ID'),
  param('songId').isInt({ min: 1 }).withMessage('Invalid song ID'),
];

const reorderPlaylistValidation = [
  param('id').isInt({ min: 1 }).withMessage('Invalid playlist ID'),
  body('songIds').isArray({ min: 1 }).withMessage('songIds must be a non-empty array'),
  body('songIds.*').isInt({ min: 1 }).withMessage('Each songId must be a positive integer'),
];

router.get('/', authMiddleware, playlistController.getPlaylists);
router.get('/:id', authMiddleware, idParamValidation, validate, playlistController.getPlaylistById);
router.post('/', authMiddleware, playlistValidation, validate, playlistController.createPlaylist);
router.post('/add-song', authMiddleware, addSongToPlaylistValidation, validate, playlistController.addSongToPlaylist);
router.post('/generate-ai', authMiddleware, aiPlaylistValidation, validate, playlistController.generateAIPlaylist);
router.put('/:id/reorder', authMiddleware, reorderPlaylistValidation, validate, playlistController.reorderPlaylistSongs);
router.delete('/:id/songs/:songId', authMiddleware, playlistSongParamsValidation, validate, playlistController.removeSongFromPlaylist);
router.delete('/:id', authMiddleware, idParamValidation, validate, playlistController.deletePlaylist);

module.exports = router;
