jest.mock('../config/database', () => ({ query: jest.fn() }));
jest.mock('../config/redis', () => ({
  redisClient: { isReady: false, publish: jest.fn() },
  getRedisClient: jest.fn(() => null),
  connectRedis: jest.fn(),
}));
jest.mock('../utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  requestLogger: (req, res, next) => next(),
}));

const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../config/database');
const transcodeService = require('../services/media/transcodeService');
const { MEDIA_VARIANT_SPECS, WAVEFORM_BUCKETS, UPLOAD_DIR } = require('../config/constants');

describe('transcodeService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('buildFfmpegArgs', () => {
    it('builds encoder args for every configured variant spec', () => {
      for (const spec of MEDIA_VARIANT_SPECS) {
        const { args, outputPath } = transcodeService.buildFfmpegArgs(spec, '/in/file.wav', '/out/1');
        expect(args).toContain('/in/file.wav');
        expect(args).toContain('-vn');
        expect(outputPath.startsWith(path.join('/out/1'))).toBe(true);
      }
    });

    it('produces HLS segmented output for hls specs', () => {
      const spec = MEDIA_VARIANT_SPECS.find((s) => s.format === 'hls');
      const { args, outputPath } = transcodeService.buildFfmpegArgs(spec, '/in/a.flac', '/out/9');
      expect(args).toContain('-hls_time');
      expect(args).toContain('-hls_segment_filename');
      expect(outputPath).toBe(path.join('/out/9', 'hls', spec.key, 'index.m3u8'));
    });

    it('uses lossless flac encoding without a bitrate', () => {
      const spec = MEDIA_VARIANT_SPECS.find((s) => s.format === 'flac');
      const { args } = transcodeService.buildFfmpegArgs(spec, '/in/a.wav', '/out/2');
      expect(args).toContain('flac');
      expect(args.join(' ')).not.toContain('-b:a');
    });

    it('rejects unknown formats', () => {
      expect(() => transcodeService.buildFfmpegArgs({ format: 'wat', key: 'x' }, '/i', '/o')).toThrow();
    });
  });

  describe('parseLoudnormOutput', () => {
    it('extracts integrated loudness and true peak from ffmpeg stderr', () => {
      const stderr = `noise...\n{\n"input_i" : "-14.20",\n"input_tp" : "-0.30",\n"input_lra" : "6.0"\n}\ntrailing`;
      expect(transcodeService.parseLoudnormOutput(stderr)).toEqual({ inputI: -14.2, inputTp: -0.3 });
    });

    it('returns null for garbage', () => {
      expect(transcodeService.parseLoudnormOutput('no json here')).toBeNull();
      expect(transcodeService.parseLoudnormOutput('')).toBeNull();
    });
  });

  describe('approximatePeaksFromBytes', () => {
    it('is deterministic, normalized to 0..1, and bucket-sized', () => {
      const buffer = Buffer.from(Array.from({ length: 10000 }, (_, i) => (i * 37) % 256));
      const a = transcodeService.approximatePeaksFromBytes(buffer);
      const b = transcodeService.approximatePeaksFromBytes(buffer);
      expect(a).toEqual(b);
      expect(a).toHaveLength(WAVEFORM_BUCKETS);
      expect(Math.max(...a)).toBeLessThanOrEqual(1);
      expect(Math.min(...a)).toBeGreaterThanOrEqual(0);
    });

    it('handles empty input', () => {
      expect(transcodeService.approximatePeaksFromBytes(Buffer.alloc(0))).toHaveLength(WAVEFORM_BUCKETS);
    });
  });

  describe('processTranscodeJob without ffmpeg', () => {
    let tmpFile;
    let storedName;

    beforeAll(() => {
      // The service resolves originals relative to UPLOAD_DIR.
      storedName = `test-transcode-${process.pid}.mp3`;
      tmpFile = path.resolve(UPLOAD_DIR, storedName);
      fs.mkdirSync(path.dirname(tmpFile), { recursive: true });
      fs.writeFileSync(tmpFile, Buffer.from('ID3 fake audio content for hashing '.repeat(100)));
    });

    afterAll(() => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // already gone
      }
    });

    function mockDbFor({ asset, duplicateRows = [] }) {
      db.query.mockImplementation((sql, params) => {
        if (sql.includes('SELECT * FROM media_assets')) return Promise.resolve({ rows: [asset] });
        if (sql.includes('FROM media_assets ma')) return Promise.resolve({ rows: duplicateRows });
        return Promise.resolve({ rows: [] });
      });
    }

    it('records every variant as skipped_no_ffmpeg with the command persisted', async () => {
      transcodeService.setFfmpegAvailabilityForTests(false);
      mockDbFor({
        asset: { id: 3, song_id: 8, uploaded_by: 2, original_path: `/uploads/${storedName}` },
      });

      const result = await transcodeService.processTranscodeJob({ assetId: 3 });

      expect(result.rendered).toEqual([]);
      expect(result.skipped).toEqual(MEDIA_VARIANT_SPECS.map((s) => s.key));
      expect(result.waveform).toBe('approximation');

      const variantUpdates = db.query.mock.calls.filter(([sql, params]) =>
        sql.includes('UPDATE media_variants') && params.includes('skipped_no_ffmpeg'));
      expect(variantUpdates).toHaveLength(MEDIA_VARIANT_SPECS.length);
      // The exact ffmpeg command is persisted for replay on a real worker.
      for (const [, params] of variantUpdates) {
        expect(params.find((p) => typeof p === 'string' && p.startsWith('ffmpeg '))).toBeTruthy();
      }

      const finalUpdate = db.query.mock.calls.find(([sql]) => sql.includes(`status = 'ready'`) && sql.includes('waveform_peaks'));
      expect(finalUpdate).toBeTruthy();
    });

    it('flags byte-identical uploads from another user for copyright review', async () => {
      transcodeService.setFfmpegAvailabilityForTests(false);
      mockDbFor({
        asset: { id: 4, song_id: 9, uploaded_by: 2, original_path: `/uploads/${storedName}` },
        duplicateRows: [{ id: 1, uploaded_by: 99 }],
      });

      const result = await transcodeService.processTranscodeJob({ assetId: 4 });

      expect(result.flagged).toBe('copyright_review');
      const flagUpdate = db.query.mock.calls.find(([sql]) => sql.includes(`'copyright_review'`));
      expect(flagUpdate).toBeTruthy();
    });

    it('does not flag a re-upload by the same user', async () => {
      transcodeService.setFfmpegAvailabilityForTests(false);
      mockDbFor({
        asset: { id: 5, song_id: 10, uploaded_by: 2, original_path: `/uploads/${storedName}` },
        duplicateRows: [{ id: 1, uploaded_by: 2 }],
      });

      const result = await transcodeService.processTranscodeJob({ assetId: 5 });
      expect(result.flagged).toBeUndefined();
      expect(result.skipped.length).toBeGreaterThan(0);
    });

    it('fails the asset when the original file is missing', async () => {
      transcodeService.setFfmpegAvailabilityForTests(false);
      mockDbFor({
        asset: { id: 6, song_id: 11, uploaded_by: 2, original_path: '/uploads/does-not-exist.mp3' },
      });

      await expect(transcodeService.processTranscodeJob({ assetId: 6 })).rejects.toThrow('original file missing');
      const failUpdate = db.query.mock.calls.find(([sql]) => sql.includes(`status = 'failed'`));
      expect(failUpdate).toBeTruthy();
    });
  });

  describe('sha256File', () => {
    it('hashes file contents deterministically', async () => {
      const p = path.join(os.tmpdir(), `sha-test-${process.pid}`);
      fs.writeFileSync(p, 'hello olympus');
      const h1 = await transcodeService.sha256File(p);
      const h2 = await transcodeService.sha256File(p);
      expect(h1).toBe(h2);
      expect(h1).toMatch(/^[0-9a-f]{64}$/);
      fs.unlinkSync(p);
    });
  });
});
