/**
 * Search Routes v2
 * Hathor Red - Semantic search, hybrid search, autocomplete
 */

import { Router } from 'express';
import { body, query } from 'express-validator';
import { semanticSearch, hybridSearch, findSimilar, autocomplete } from '../controllers/searchController';
import { authenticate, optionalAuth } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// POST /api/v1/search/semantic - Semantic vector search
router.post('/semantic', [
  body('query').notEmpty().trim().isLength({ min: 1, max: 200 }),
  body('limit').optional().isInt({ min: 1, max: 50 }),
  body('threshold').optional().isFloat({ min: 0, max: 1 }),
], optionalAuth, asyncHandler(semanticSearch));

// GET /api/v1/search/hybrid - Hybrid vector + text search
router.get('/hybrid', [
  query('q').notEmpty().trim(),
  query('genres').optional(),
  query('yearFrom').optional().isInt(),
  query('yearTo').optional().isInt(),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  query('vectorWeight').optional().isFloat({ min: 0, max: 1 }),
  query('textWeight').optional().isFloat({ min: 0, max: 1 }),
], optionalAuth, asyncHandler(hybridSearch));

// GET /api/v1/search/similar/:songId - Find similar songs
router.get('/similar/:songId', [
  query('limit').optional().isInt({ min: 1, max: 30 }),
], optionalAuth, asyncHandler(findSimilar));

// GET /api/v1/search/autocomplete - Autocomplete suggestions
router.get('/autocomplete', [
  query('q').notEmpty().trim().isLength({ min: 1, max: 100 }),
  query('limit').optional().isInt({ min: 1, max: 10 }),
], asyncHandler(autocomplete));

export default router;
