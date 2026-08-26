const express = require('express');
const router = express.Router();
const mediaController = require('../controllers/mediaController');
const authMiddleware = require('../middleware/auth');
const streamAuth = require('../middleware/streamAuth');
const { idParamValidation, hlsResourceValidation, validate } = require('../middleware/validation');

router.get('/songs/:id/pipeline', authMiddleware, idParamValidation, validate, mediaController.getPipeline);
router.get('/songs/:id/waveform', authMiddleware, idParamValidation, validate, mediaController.getWaveform);
router.get('/songs/:id/hls/master.m3u8', streamAuth, idParamValidation, validate, mediaController.getHlsMaster);
router.get('/songs/:id/hls/:variantKey/:file', streamAuth, hlsResourceValidation, validate, mediaController.getHlsResource);
router.post('/songs/:id/reprocess', authMiddleware, idParamValidation, validate, mediaController.reprocessSong);
router.get('/jobs/:id', authMiddleware, idParamValidation, validate, mediaController.getJobStatus);

module.exports = router;
