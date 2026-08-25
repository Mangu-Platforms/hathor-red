const { body, param, validationResult } = require('express-validator');
const { ALLOWED_GENRES } = require('../config/constants');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors.array().map(e => ({ field: e.path, message: e.msg })),
    });
  }
  next();
};

const sanitizeString = (str) => {
  if (!str) return '';
  return String(str).trim().replace(/[<>"']/g, '');
};

const registerValidation = [
  body('username')
    .trim()
    .isLength({ min: 3, max: 50 })
    .withMessage('Username must be 3-50 characters')
    .matches(/^[a-zA-Z0-9_]+$/)
    .withMessage('Username can only contain letters, numbers, and underscores')
    .customSanitizer(sanitizeString),
  body('email')
    .isEmail()
    .withMessage('Invalid email address')
    .normalizeEmail()
    .isLength({ max: 100 }),
  body('password')
    .isLength({ min: 8, max: 128 })
    .withMessage('Password must be 8-128 characters')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain uppercase, lowercase, and a number'),
  body('displayName')
    .optional()
    .trim()
    .isLength({ min: 1, max: 100 })
    .customSanitizer(sanitizeString),
];

const loginValidation = [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const songUploadValidation = [
  body('title').trim().notEmpty().isLength({ max: 255 }).withMessage('Title is required (max 255 chars)'),
  body('artist').trim().notEmpty().isLength({ max: 255 }).withMessage('Artist is required (max 255 chars)'),
  body('album').optional().trim().isLength({ max: 255 }),
  body('duration').isInt({ min: 1, max: 7200 }).withMessage('Duration must be 1-7200 seconds'),
  body('genre').optional().trim().custom((value) => {
    if (value && !ALLOWED_GENRES.includes(value)) {
      throw new Error(`Invalid genre. Allowed: ${ALLOWED_GENRES.join(', ')}`);
    }
    return true;
  }),
  body('year').optional().isInt({ min: 1900, max: new Date().getFullYear() + 1 }),
];

const playlistValidation = [
  body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Playlist name is required'),
  body('description').optional().trim().isLength({ max: 500 }),
  body('isPublic').optional().isBoolean(),
];

const aiPlaylistValidation = [
  body('prompt').trim().notEmpty().isLength({ max: 500 }).withMessage('Prompt is required (max 500 chars)'),
  body('name').optional().trim().isLength({ max: 100 }),
  body('songCount').optional().isInt({ min: 1, max: 50 }).withMessage('Song count must be 1-50'),
];

const addSongToPlaylistValidation = [
  body('playlistId').isInt({ min: 1 }).withMessage('Invalid playlist ID'),
  body('songId').isInt({ min: 1 }).withMessage('Invalid song ID'),
];

const recordListeningValidation = [
  body('songId').isInt({ min: 1 }).withMessage('Invalid song ID'),
  body('duration').optional().isInt({ min: 0 }).withMessage('Duration must be non-negative'),
];

const roomValidation = [
  body('name').trim().notEmpty().isLength({ max: 100 }).withMessage('Room name is required'),
  body('isPublic').optional().isBoolean(),
  body('maxListeners').optional().isInt({ min: 2, max: 100 }).withMessage('Max listeners must be 2-100'),
];

const idParamValidation = [
  param('id').isInt({ min: 1 }).withMessage('Invalid ID parameter'),
];

const hlsResourceValidation = [
  param('id').isInt({ min: 1 }).withMessage('Invalid ID parameter'),
  param('variantKey')
    .matches(/^[a-z0-9-]+$/i)
    .withMessage('Invalid variant key'),
  param('file')
    .matches(/^(index\.m3u8|segment_\d{4}\.ts)$/)
    .withMessage('Invalid HLS resource name'),
];

const updateProfileValidation = [
  body('displayName').optional().trim().isLength({ min: 1, max: 100 }),
  body('avatarUrl').optional().trim().isURL().withMessage('Invalid avatar URL'),
];

module.exports = {
  validate,
  registerValidation,
  loginValidation,
  songUploadValidation,
  playlistValidation,
  aiPlaylistValidation,
  addSongToPlaylistValidation,
  recordListeningValidation,
  roomValidation,
  idParamValidation,
  hlsResourceValidation,
  updateProfileValidation,
};
