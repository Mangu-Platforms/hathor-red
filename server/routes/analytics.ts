/**
 * Analytics Routes
 * Hathor Red v2.0 - Event tracking and analytics
 */

import { Router } from 'express';
import { body, query } from 'express-validator';
import { trackEvent, getOverview, getListeningStats } from '../controllers/analyticsController';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// POST /api/v1/analytics/track - Track an event
router.post('/track', [
  body('eventType').notEmpty().isIn([
    'song_play', 'song_skip', 'song_complete', 'song_like',
    'playlist_create', 'room_join', 'room_leave',
    'search_query', 'ai_request',
  ]),
  body('eventData').optional().isObject(),
  body('sessionId').optional().isString(),
], optionalAuth, asyncHandler(trackEvent));

// GET /api/v1/analytics/overview - Admin analytics dashboard
router.get('/overview', authenticate, requireRole(['admin']), asyncHandler(getOverview));

// GET /api/v1/analytics/listening - Listening statistics
router.get('/listening', authenticate, asyncHandler(getListeningStats));

export default router;
