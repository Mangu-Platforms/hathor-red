const express = require('express');
const router = express.Router();
const intelController = require('../controllers/intelController');
const authMiddleware = require('../middleware/auth');
const { validate, idParamValidation, eventsBatchValidation } = require('../middleware/validation');

router.post('/events', authMiddleware, eventsBatchValidation, validate, intelController.ingestEvents);
router.get('/overview', authMiddleware, intelController.getOverview);
router.get('/top-tracks', authMiddleware, intelController.getTopTracks);
router.get('/songs/:id/retention', authMiddleware, idParamValidation, validate, intelController.getSongRetention);
router.get('/geography', authMiddleware, intelController.getGeography);
router.get('/revenue-by-track', authMiddleware, intelController.getRevenueByTrack);

module.exports = router;
