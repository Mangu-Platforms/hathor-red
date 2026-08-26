/**
 * Transcode service — plans and executes quality-tier renditions of uploaded
 * audio (Pillar 1: Immersive Audio Engine).
 *
 * ffmpeg presence is detected at runtime (DEC-004):
 * - present  → variants are actually rendered, loudness measured (ITU-R
 *              BS.1770 via loudnorm), waveform peaks computed from decoded PCM.
 * - absent   → each variant row is recorded as 'skipped_no_ffmpeg' with the
 *              exact command persisted for later replay on a worker that has
 *              ffmpeg; playback continues via the original-file direct stream.
 *
 * Nothing in here throws for a missing binary — the pipeline degrades, the
 * platform keeps working (repo fallback doctrine).
 */

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { execFile, spawn } = require('child_process');

const db = require('../../config/database');
const { logger } = require('../../utils/logger');
const { UPLOAD_DIR, MEDIA_VARIANT_SPECS, WAVEFORM_BUCKETS } = require('../../config/constants');

let ffmpegAvailability = null; // cached: null = unknown, true/false once probed

function transcodeRoot() {
  return path.join(UPLOAD_DIR, 'transcoded');
}

/** Probe for ffmpeg once per process. */
function detectFfmpeg() {
  if (ffmpegAvailability !== null) return Promise.resolve(ffmpegAvailability);
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 5000 }, (err) => {
      ffmpegAvailability = !err;
      if (!ffmpegAvailability) {
        logger.warn('ffmpeg not found — transcode pipeline runs in plan-only mode');
      }
      resolve(ffmpegAvailability);
    });
  });
}

/** Test hook: override/clear the cached probe result. */
function setFfmpegAvailabilityForTests(value) {
  ffmpegAvailability = value;
}

/**
 * Build the ffmpeg argument vector for a variant spec. Pure — unit tested.
 * Returns { args, outputPath } where args excludes the leading 'ffmpeg'.
 */
function buildFfmpegArgs(spec, inputPath, outputDir) {
  const args = ['-y', '-hide_banner', '-i', inputPath, '-vn', '-map_metadata', '0'];

  if (spec.format === 'hls') {
    const outDir = path.join(outputDir, 'hls', spec.key);
    const outputPath = path.join(outDir, 'index.m3u8');
    args.push(
      '-c:a', 'aac', '-b:a', `${spec.bitrateKbps}k`,
      '-f', 'hls',
      '-hls_time', '6',
      '-hls_playlist_type', 'vod',
      '-hls_segment_filename', path.join(outDir, 'segment_%04d.ts'),
      outputPath
    );
    return { args, outputPath };
  }

  const outputPath = path.join(outputDir, `${spec.key}.${spec.extension}`);
  switch (spec.format) {
    case 'opus':
      args.push('-c:a', 'libopus', '-b:a', `${spec.bitrateKbps}k`);
      break;
    case 'aac':
      args.push('-c:a', 'aac', '-b:a', `${spec.bitrateKbps}k`);
      break;
    case 'mp3':
      args.push('-c:a', 'libmp3lame', '-b:a', `${spec.bitrateKbps}k`);
      break;
    case 'flac':
      args.push('-c:a', 'flac', '-compression_level', '8');
      break;
    default:
      throw new Error(`Unknown variant format: ${spec.format}`);
  }
  args.push(outputPath);
  return { args, outputPath };
}

/** Render args as a shell-ish string for persistence/audit (not for execution). */
function commandString(args) {
  return ['ffmpeg', ...args].map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(' ');
}

/** Streaming sha256 of a file. */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function runFfmpeg(args, { timeoutMs = 10 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('ffmpeg timed out'));
    }, timeoutMs);
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 65536) stderr = stderr.slice(-32768);
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stderr });
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

/**
 * Parse the JSON block that `-af loudnorm=print_format=json` prints to stderr.
 * Pure — unit tested. Returns { inputI, inputTp } numbers or null.
 */
function parseLoudnormOutput(stderr) {
  const match = String(stderr || '').match(/\{[^{}]*"input_i"[\s\S]*?\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    const inputI = parseFloat(parsed.input_i);
    const inputTp = parseFloat(parsed.input_tp);
    if (Number.isNaN(inputI)) return null;
    return { inputI, inputTp: Number.isNaN(inputTp) ? null : inputTp };
  } catch {
    return null;
  }
}

/** Measure integrated loudness + true peak with ffmpeg (null when unavailable). */
async function analyzeLoudness(inputPath) {
  const hasFfmpeg = await detectFfmpeg();
  if (!hasFfmpeg) return null;
  return new Promise((resolve) => {
    const proc = spawn(
      'ffmpeg',
      ['-hide_banner', '-i', inputPath, '-af', 'loudnorm=print_format=json', '-f', 'null', '-'],
      { stdio: ['ignore', 'ignore', 'pipe'] }
    );
    let stderr = '';
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      if (stderr.length > 131072) stderr = stderr.slice(-65536);
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => resolve(parseLoudnormOutput(stderr)));
  });
}

/**
 * Deterministic approximate waveform peaks from raw file bytes — the fallback
 * when PCM decoding is unavailable. Buckets byte-delta energy over the file,
 * normalized to 0..1. Clearly labeled source:'approximation' so clients can
 * style it differently. Pure — unit tested.
 */
function approximatePeaksFromBytes(buffer, buckets = WAVEFORM_BUCKETS) {
  const len = buffer.length;
  if (len === 0) return new Array(buckets).fill(0);
  const bucketSize = Math.max(1, Math.floor(len / buckets));
  const peaks = [];
  for (let b = 0; b < buckets; b += 1) {
    const start = b * bucketSize;
    const end = Math.min(start + bucketSize, len);
    if (start >= len) {
      peaks.push(0);
      continue;
    }
    let acc = 0;
    let count = 0;
    // Stride so huge files stay cheap; deltas approximate signal energy.
    const stride = Math.max(1, Math.floor((end - start) / 256));
    for (let i = start + stride; i < end; i += stride) {
      acc += Math.abs(buffer[i] - buffer[i - stride]);
      count += 1;
    }
    peaks.push(count === 0 ? 0 : acc / count / 255);
  }
  const max = Math.max(...peaks, 0.0001);
  return peaks.map((p) => Math.round((p / max) * 1000) / 1000);
}

/** Compute peaks from decoded PCM (s16le mono 8kHz) when ffmpeg exists. */
async function computeWaveformPeaks(inputPath) {
  const hasFfmpeg = await detectFfmpeg();
  if (!hasFfmpeg) {
    try {
      // Cap the approximation read at 8MB — plenty for bucketed deltas.
      const fh = await fsp.open(inputPath, 'r');
      try {
        const { size } = await fh.stat();
        const readLen = Math.min(size, 8 * 1024 * 1024);
        const buffer = Buffer.alloc(readLen);
        await fh.read(buffer, 0, readLen, 0);
        return { version: 1, source: 'approximation', peaks: approximatePeaksFromBytes(buffer) };
      } finally {
        await fh.close();
      }
    } catch (err) {
      logger.warn(`Waveform approximation failed: ${err.message}`);
      return null;
    }
  }

  return new Promise((resolve) => {
    const proc = spawn(
      'ffmpeg',
      ['-hide_banner', '-i', inputPath, '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const chunks = [];
    let total = 0;
    proc.stdout.on('data', (d) => {
      if (total < 64 * 1024 * 1024) {
        chunks.push(d);
        total += d.length;
      }
    });
    proc.on('error', () => resolve(null));
    proc.on('close', () => {
      const pcm = Buffer.concat(chunks);
      const samples = Math.floor(pcm.length / 2);
      if (samples === 0) return resolve(null);
      const buckets = WAVEFORM_BUCKETS;
      const bucketSize = Math.max(1, Math.floor(samples / buckets));
      const peaks = [];
      for (let b = 0; b < buckets; b += 1) {
        const start = b * bucketSize;
        const end = Math.min(start + bucketSize, samples);
        let peak = 0;
        for (let i = start; i < end; i += 1) {
          const v = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
          if (v > peak) peak = v;
        }
        peaks.push(Math.round(peak * 1000) / 1000);
      }
      resolve({ version: 1, source: 'ffmpeg', peaks });
    });
  });
}

/**
 * Ensure planned variant rows exist for an asset (idempotent on retries via
 * the (asset_id, variant_key) unique constraint).
 */
async function planVariants(assetId) {
  for (const spec of MEDIA_VARIANT_SPECS) {
    await db.query(
      `INSERT INTO media_variants (asset_id, variant_key, format, bitrate_kbps, status)
       VALUES ($1, $2, $3, $4, 'planned')
       ON CONFLICT (asset_id, variant_key) DO NOTHING`,
      [assetId, spec.key, spec.format, spec.bitrateKbps || null]
    );
  }
}

async function markVariant(assetId, variantKey, fields) {
  const sets = ['updated_at = CURRENT_TIMESTAMP'];
  const params = [assetId, variantKey];
  for (const [column, value] of Object.entries(fields)) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }
  await db.query(
    `UPDATE media_variants SET ${sets.join(', ')} WHERE asset_id = $1 AND variant_key = $2`,
    params
  );
}

/** Relative (uploads-rooted) representation for DB storage. */
function toStoredPath(absolutePath) {
  return `/uploads/${path.relative(path.resolve(UPLOAD_DIR), path.resolve(absolutePath)).split(path.sep).join('/')}`;
}

/**
 * Job handler for 'transcode' jobs. Payload: { assetId }.
 * Fingerprints the original, flags exact duplicates for copyright review
 * (FR-604), then renders or plan-records every variant.
 */
async function processTranscodeJob(payload) {
  const assetId = parseInt(payload.assetId, 10);
  if (!assetId) throw new Error('transcode job missing assetId');

  const assetResult = await db.query('SELECT * FROM media_assets WHERE id = $1', [assetId]);
  const asset = assetResult.rows[0];
  if (!asset) throw new Error(`media asset ${assetId} not found`);

  const inputPath = path.resolve(
    UPLOAD_DIR,
    String(asset.original_path || '').replace(/^\/?uploads\//, '')
  );

  let stat;
  try {
    stat = await fsp.stat(inputPath);
  } catch {
    await db.query(
      `UPDATE media_assets SET status = 'failed', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [assetId]
    );
    throw new Error(`original file missing for asset ${assetId}`);
  }

  await db.query(
    `UPDATE media_assets SET status = 'processing', file_size_bytes = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [assetId, stat.size]
  );

  // Fingerprint + exact-duplicate check (AcoustID perceptual matching is the
  // production upgrade seam; sha256 catches byte-identical re-uploads now).
  const digest = await sha256File(inputPath);
  const dupe = await db.query(
    `SELECT ma.id, ma.uploaded_by FROM media_assets ma
     WHERE ma.sha256 = $1 AND ma.id <> $2
     ORDER BY ma.id ASC LIMIT 1`,
    [digest, assetId]
  );
  await db.query(
    `UPDATE media_assets SET sha256 = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [assetId, digest]
  );

  if (dupe.rows.length > 0 && dupe.rows[0].uploaded_by !== asset.uploaded_by) {
    await db.query(
      `UPDATE media_assets SET status = 'copyright_review', updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [assetId]
    );
    logger.warn({
      action: 'copyright_review_flagged',
      assetId,
      duplicateOfAssetId: dupe.rows[0].id,
    });
    return { flagged: 'copyright_review', duplicateOfAssetId: dupe.rows[0].id };
  }

  await planVariants(assetId);

  const hasFfmpeg = await detectFfmpeg();
  const outputDir = path.join(transcodeRoot(), String(assetId));
  const rendered = [];
  const skipped = [];

  for (const spec of MEDIA_VARIANT_SPECS) {
    const { args, outputPath } = buildFfmpegArgs(spec, inputPath, outputDir);
    const command = commandString(args);

    if (!hasFfmpeg) {
      await markVariant(assetId, spec.key, { status: 'skipped_no_ffmpeg', ffmpeg_command: command });
      skipped.push(spec.key);
      continue;
    }

    try {
      await fsp.mkdir(path.dirname(outputPath), { recursive: true });
      await markVariant(assetId, spec.key, { status: 'processing', ffmpeg_command: command });
      await runFfmpeg(args);
      const outStat = await fsp.stat(outputPath);
      await markVariant(assetId, spec.key, {
        status: 'ready',
        file_path: toStoredPath(outputPath),
        file_size_bytes: outStat.size,
        error: null,
      });
      rendered.push(spec.key);
    } catch (err) {
      await markVariant(assetId, spec.key, { status: 'failed', error: String(err.message).slice(0, 1000) });
      logger.error({ action: 'variant_failed', assetId, variant: spec.key, error: err.message });
    }
  }

  const loudness = await analyzeLoudness(inputPath);
  const waveform = await computeWaveformPeaks(inputPath);

  await db.query(
    `UPDATE media_assets SET
       status = 'ready',
       loudness_lufs = $2,
       true_peak_db = $3,
       waveform_peaks = $4,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [
      assetId,
      loudness ? loudness.inputI : null,
      loudness ? loudness.inputTp : null,
      waveform ? JSON.stringify(waveform) : null,
    ]
  );

  return { rendered, skipped, loudness: loudness || null, waveform: waveform ? waveform.source : null };
}

module.exports = {
  detectFfmpeg,
  setFfmpegAvailabilityForTests,
  buildFfmpegArgs,
  commandString,
  sha256File,
  parseLoudnormOutput,
  approximatePeaksFromBytes,
  computeWaveformPeaks,
  analyzeLoudness,
  planVariants,
  processTranscodeJob,
  toStoredPath,
};
