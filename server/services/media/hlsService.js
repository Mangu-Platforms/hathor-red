/**
 * HLS packaging/serving helpers (Pillar 1).
 *
 * Master manifests are generated on the fly from ready `media_variants` rows;
 * media playlists and segments are the files ffmpeg wrote under
 * uploads/transcoded/<assetId>/hls/<variantKey>/. When no HLS variant exists
 * (e.g. transcode ran in plan-only mode without ffmpeg), callers fall back to
 * the direct byte-range stream at /api/songs/:id/stream.
 */

const path = require('path');
const { UPLOAD_DIR } = require('../../config/constants');

// AAC-LC in MPEG-TS — what the transcode service produces for HLS tiers.
const HLS_CODECS = 'mp4a.40.2';

// Only files ffmpeg produces in an HLS output dir may ever be served.
const HLS_FILE_PATTERN = /^(index\.m3u8|segment_\d{4}\.ts)$/;

/**
 * Build an HLS master playlist for a song's ready HLS variants. Pure.
 * urlBase example: /api/media/songs/42/hls (token query appended by caller).
 */
function buildMasterManifest(variants, urlBase, tokenQuery = '') {
  const ready = (variants || [])
    .filter((v) => v.format === 'hls' && v.status === 'ready')
    .sort((a, b) => (b.bitrate_kbps || 0) - (a.bitrate_kbps || 0));

  if (ready.length === 0) return null;

  const lines = ['#EXTM3U', '#EXT-X-VERSION:3'];
  for (const variant of ready) {
    const bandwidth = Math.round((variant.bitrate_kbps || 128) * 1000 * 1.1);
    lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="${HLS_CODECS}"`);
    lines.push(`${urlBase}/${variant.variant_key}/index.m3u8${tokenQuery}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Resolve an HLS resource path safely. Throws on traversal or an unexpected
 * file name. Pure with respect to the filesystem (no I/O).
 */
function resolveHlsPath(assetId, variantKey, fileName) {
  if (!HLS_FILE_PATTERN.test(String(fileName || ''))) {
    throw new Error('Invalid HLS resource name');
  }
  if (!/^[a-z0-9-]+$/i.test(String(variantKey || ''))) {
    throw new Error('Invalid HLS variant key');
  }

  const root = path.resolve(UPLOAD_DIR, 'transcoded', String(parseInt(assetId, 10)), 'hls', variantKey);
  const resolved = path.resolve(root, fileName);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error('Invalid HLS path: traversal detected');
  }
  return resolved;
}

/**
 * Rewrite a media playlist so every segment URI carries the stream token —
 * standard HLS clients authenticate the playlist via ?t= and then fetch
 * segments with the exact URIs listed, so the token must ride along. Pure.
 */
function appendTokenToPlaylist(playlistText, token) {
  if (!token) return playlistText;
  const suffix = `?t=${encodeURIComponent(token)}`;
  return String(playlistText)
    .split('\n')
    .map((line) => (line.trim() !== '' && !line.startsWith('#') ? `${line.trim()}${suffix}` : line))
    .join('\n');
}

module.exports = {
  HLS_CODECS,
  HLS_FILE_PATTERN,
  buildMasterManifest,
  resolveHlsPath,
  appendTokenToPlaylist,
};
