/**
 * HLS Streaming Service
 * Hathor Red v2.0 - FFmpeg transcoding and HLS manifest generation
 */

import { spawn, ChildProcess } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import db from '../config/database';
import { QualityTier, TranscodeJob, HLSManifest } from '../types';

const OUTPUT_DIR = process.env.HLS_OUTPUT_DIR || './uploads/hls';
const SEGMENT_DURATION = parseInt(process.env.HLS_SEGMENT_DURATION || '6', 10);
const MAX_CONCURRENT_JOBS = 3;

let activeJobs = 0;
const jobQueue: Array<() => void> = [];

// Quality tier configurations
const QUALITY_CONFIGS: Record<QualityTier, { bitrate: string; codec: string; ext: string }> = {
  '64k': { bitrate: '64k', codec: 'aac', ext: 'aac' },
  '128k': { bitrate: '128k', codec: 'aac', ext: 'aac' },
  '192k': { bitrate: '192k', codec: 'aac', ext: 'aac' },
  '256k': { bitrate: '256k', codec: 'aac', ext: 'aac' },
  '320k': { bitrate: '320k', codec: 'libmp3lame', ext: 'mp3' },
  'lossless': { bitrate: '1411k', codec: 'flac', ext: 'flac' },
};

/**
 * Transcode a song to HLS format for a specific quality tier
 */
export async function transcodeSong(
  songId: number,
  filePath: string,
  qualityTier: QualityTier
): Promise<TranscodeJob> {
  const config = QUALITY_CONFIGS[qualityTier];
  const outputDir = path.join(OUTPUT_DIR, String(songId), qualityTier);
  const manifestPath = path.join(outputDir, 'playlist.m3u8');

  // Check if already transcoded
  const existing = await getTranscodeStatus(songId, qualityTier);
  if (existing && existing.status === 'complete') {
    return existing;
  }

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // Update status to processing
  await upsertTranscodeRecord(songId, qualityTier, 'processing', manifestPath);

  // Run FFmpeg
  return new Promise((resolve, reject) => {
    const runJob = async () => {
      if (activeJobs >= MAX_CONCURRENT_JOBS) {
        jobQueue.push(runJob);
        return;
      }

      activeJobs++;
      const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

      const args = [
        '-i', filePath,
        '-c:a', config.codec,
        '-b:a', config.bitrate,
        '-f', 'hls',
        '-hls_time', String(SEGMENT_DURATION),
        '-hls_playlist_type', 'vod',
        '-hls_segment_filename', path.join(outputDir, 'segment_%03d.ts'),
        manifestPath,
      ];

      const startTime = Date.now();
      const proc = spawn(ffmpegPath, args, { stdio: 'pipe' });

      let stderr = '';
      proc.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', async (code) => {
        activeJobs--;
        processNextJob();

        if (code === 0) {
          const segmentCount = await countSegments(outputDir);
          await upsertTranscodeRecord(songId, qualityTier, 'complete', manifestPath, segmentCount);
          resolve({
            id: 0, songId, qualityTier, status: 'complete', progress: 100,
            manifestPath, segmentCount,
            createdAt: new Date(), completedAt: new Date(),
          });
        } else {
          await upsertTranscodeRecord(songId, qualityTier, 'failed', manifestPath, 0, `FFmpeg exited with code ${code}`);
          reject(new Error(`FFmpeg failed: ${stderr}`));
        }
      });

      proc.on('error', async (err) => {
        activeJobs--;
        processNextJob();
        await upsertTranscodeRecord(songId, qualityTier, 'failed', manifestPath, 0, err.message);
        reject(err);
      });
    };

    runJob();
  });
}

/**
 * Get HLS manifest for a song at a specific quality
 */
export async function getManifest(songId: number, qualityTier: QualityTier): Promise<string | null> {
  const manifestPath = path.join(OUTPUT_DIR, String(songId), qualityTier, 'playlist.m3u8');
  try {
    return await fs.readFile(manifestPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Get a segment file path
 */
export async function getSegment(
  songId: number,
  qualityTier: QualityTier,
  segmentIndex: number
): Promise<string | null> {
  const segmentPath = path.join(OUTPUT_DIR, String(songId), qualityTier, `segment_${String(segmentIndex).padStart(3, '0')}.ts`);
  try {
    await fs.access(segmentPath);
    return segmentPath;
  } catch {
    return null;
  }
}

/**
 * Generate master manifest with all quality variants
 */
export async function generateMasterManifest(songId: number): Promise<string | null> {
  const variants: string[] = ['#EXTM3U'];

  for (const [tier, config] of Object.entries(QUALITY_CONFIGS)) {
    const manifestExists = await getManifest(songId, tier as QualityTier);
    if (manifestExists) {
      const bandwidth = parseBitrate(config.bitrate);
      variants.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},CODECS="mp4a.40.2"`);
      variants.push(`/api/v1/songs/${songId}/manifest.m3u8?quality=${tier}`);
    }
  }

  if (variants.length === 1) return null;
  return variants.join('\n') + '\n';
}

/**
 * Get transcode status from database
 */
export async function getTranscodeStatus(songId: number, qualityTier?: QualityTier): Promise<TranscodeJob | null> {
  try {
    let query = 'SELECT * FROM transcoded_tracks WHERE song_id = $1';
    const params: any[] = [songId];
    
    if (qualityTier) {
      query += ' AND quality_tier = $2';
      params.push(qualityTier);
    }
    
    const result = await db.query(query, params);
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      id: row.id,
      songId: row.song_id,
      qualityTier: row.quality_tier,
      status: row.status,
      progress: row.status === 'complete' ? 100 : row.status === 'processing' ? 50 : 0,
      manifestPath: row.manifest_path,
      segmentCount: row.segment_count,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    };
  } catch {
    return null;
  }
}

/**
 * Clean up transcoded files for a song
 */
export async function cleanupTranscode(songId: number): Promise<void> {
  const songDir = path.join(OUTPUT_DIR, String(songId));
  try {
    await fs.rm(songDir, { recursive: true, force: true });
    await db.query('DELETE FROM transcoded_tracks WHERE song_id = $1', [songId]);
  } catch {
    // Ignore cleanup errors
  }
}

// Private helpers
function processNextJob(): void {
  const next = jobQueue.shift();
  if (next) next();
}

async function upsertTranscodeRecord(
  songId: number,
  qualityTier: QualityTier,
  status: string,
  manifestPath: string,
  segmentCount: number = 0,
  errorMessage?: string
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO transcoded_tracks (song_id, quality_tier, manifest_path, segment_count, status, error_message)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (song_id, quality_tier) DO UPDATE SET
         status = $5, segment_count = $4, error_message = $6,
         completed_at = CASE WHEN $5 = 'complete' THEN CURRENT_TIMESTAMP ELSE NULL END`,
      [songId, qualityTier, manifestPath, segmentCount, status, errorMessage || null]
    );
  } catch (err) {
    console.error('[HLS] DB upsert error:', err);
  }
}

async function countSegments(dir: string): Promise<number> {
  try {
    const files = await fs.readdir(dir);
    return files.filter(f => f.endsWith('.ts')).length;
  } catch {
    return 0;
  }
}

function parseBitrate(bitrate: string): number {
  const match = bitrate.match(/(\d+)/);
  return match ? parseInt(match[1], 10) * 1000 : 128000;
}