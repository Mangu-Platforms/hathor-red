const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { toPositiveInt } = require('../utils/streamToken');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, process.env.UPLOAD_DIR || './uploads');
  },
  filename: (req, file, cb) => {
    const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /mp3|wav|flac|m4a|ogg/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype) || file.mimetype.startsWith('audio/');

  if (mimetype && extname) {
    return cb(null, true);
  } else {
    cb(new Error('Only audio files are allowed'));
  }
};

// dose-1.69: MAX_FILE_SIZE uses shared toPositiveInt (reject NaN/0/negative/junk;
// fall back to 50MB) instead of raw parseInt that can leave NaN.
const maxFileSize = toPositiveInt(process.env.MAX_FILE_SIZE) ?? 50 * 1024 * 1024;

const upload = multer({
  storage,
  limits: {
    fileSize: maxFileSize
  },
  fileFilter
});

module.exports = upload;
