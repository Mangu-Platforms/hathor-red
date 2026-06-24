/**
 * API Route Aggregator v1
 * Hathor Red v2.0 - All routes mounted under /api/v1/
 */

import { Router } from 'express';
import authRoutes from './auth';
import songRoutes from './songs';
import playlistRoutes from './playlists';
import playbackRoutes from './playback';
import roomRoutes from './rooms';
import aiRoutes from './ai';
import searchRoutes from './search';
import analyticsRoutes from './analytics';
import docsRoutes from './docs';

const router = Router();

// API v1 routes
router.use('/auth', authRoutes);
router.use('/songs', songRoutes);
router.use('/playlists', playlistRoutes);
router.use('/playback', playbackRoutes);
router.use('/rooms', roomRoutes);
router.use('/ai', aiRoutes);
router.use('/search', searchRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/docs', docsRoutes);

export default router;
