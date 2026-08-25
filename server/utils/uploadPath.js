const path = require('path');
const { UPLOAD_DIR } = require('../config/constants');

/**
 * Resolve a DB-stored file path (e.g. "/uploads/abc.mp3") to an absolute path
 * inside UPLOAD_DIR, rejecting traversal. Shared by streaming, downloads, and
 * the media pipeline.
 */
function resolveUploadPath(dbFilePath) {
  const stripped = String(dbFilePath || '').replace(/^\/?uploads\//, '');
  const resolved = path.resolve(UPLOAD_DIR, stripped);
  const relative = path.relative(path.resolve(UPLOAD_DIR), resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Invalid file path: path traversal detected');
  }
  return resolved;
}

module.exports = { resolveUploadPath };
