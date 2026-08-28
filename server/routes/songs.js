const express = require('express');
const router = express.Router();
const songController = require('../controllers/songController');
const authMiddleware = require('../middleware/auth');
const streamAuth = require('../middleware/streamAuth');
const upload = require('../middleware/upload');
const { songUploadValidation, recordListeningValidation, idParamValidation, validate } = require('../middleware/validation');

router.get('/', authMiddleware, songController.getSongs);
// Static paths before /:id so names are not captured as ids
router.get('/genres', authMiddleware, songController.getGenres);
router.get('/mine', authMiddleware, songController.getMySongs);
router.get('/:id', authMiddleware, idParamValidation, validate, songController.getSongById);
router.post('/upload', authMiddleware, upload.single('audio'), songUploadValidation, validate, songController.uploadSong);
router.get('/:id/stream-url', authMiddleware, idParamValidation, validate, songController.getStreamUrl);
router.get('/:id/stream', streamAuth, idParamValidation, validate, songController.streamSong);
router.post('/record-listening', authMiddleware, recordListeningValidation, validate, songController.recordListening);

module.exports = router;
