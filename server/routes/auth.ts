/**
 * Authentication Routes v2
 * Hathor Red - OAuth2, JWT Refresh, Token Management
 */

import { Router } from 'express';
import passport from 'passport';
import { body } from 'express-validator';
import {
  register,
  login,
  refresh,
  logout,
  getProfile,
  updateProfile,
  oauthCallback,
  linkOAuth,
  unlinkOAuth,
} from '../controllers/authController';
import { authenticate, requireRole } from '../middleware/auth';
import { asyncHandler } from '../middleware/errorHandler';

const router = Router();

// Validation middleware
const registerValidation = [
  body('username').isLength({ min: 3, max: 50 }).trim(),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('displayName').optional().trim(),
];

const loginValidation = [
  body('username').notEmpty().trim(),
  body('password').notEmpty(),
];

// Local auth routes
router.post('/register', registerValidation, asyncHandler(register));
router.post('/login', loginValidation, asyncHandler(login));
router.post('/refresh', asyncHandler(refresh));
router.post('/logout', asyncHandler(logout));

// OAuth routes
router.get('/oauth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
router.get('/oauth/google/callback', passport.authenticate('google', { session: false }), asyncHandler(oauthCallback));

router.get('/oauth/spotify', passport.authenticate('spotify', { scope: ['user-read-email', 'user-read-private'] }));
router.get('/oauth/spotify/callback', passport.authenticate('spotify', { session: false }), asyncHandler(oauthCallback));

// OAuth account management
router.post('/oauth/link', authenticate, asyncHandler(linkOAuth));
router.post('/oauth/unlink', authenticate, asyncHandler(unlinkOAuth));

// Profile routes
router.get('/me', authenticate, asyncHandler(getProfile));
router.put('/profile', authenticate, asyncHandler(updateProfile));

export default router;
