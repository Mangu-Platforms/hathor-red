const path = require('path');
const { buildMasterManifest, resolveHlsPath, appendTokenToPlaylist } = require('../services/media/hlsService');
const { UPLOAD_DIR } = require('../config/constants');

describe('hlsService', () => {
  describe('buildMasterManifest', () => {
    const variants = [
      { variant_key: 'hls-standard', format: 'hls', status: 'ready', bitrate_kbps: 128 },
      { variant_key: 'hls-high', format: 'hls', status: 'ready', bitrate_kbps: 256 },
      { variant_key: 'mp3-320', format: 'mp3', status: 'ready', bitrate_kbps: 320 },
      { variant_key: 'hls-broken', format: 'hls', status: 'failed', bitrate_kbps: 64 },
    ];

    it('lists only ready HLS variants, highest bitrate first', () => {
      const manifest = buildMasterManifest(variants, '/api/media/songs/42/hls');
      const lines = manifest.trim().split('\n');

      expect(lines[0]).toBe('#EXTM3U');
      expect(manifest).not.toContain('mp3-320');
      expect(manifest).not.toContain('hls-broken');
      expect(lines.filter((l) => l.startsWith('#EXT-X-STREAM-INF'))).toHaveLength(2);
      expect(manifest.indexOf('hls-high')).toBeLessThan(manifest.indexOf('hls-standard'));
      expect(manifest).toContain('BANDWIDTH=281600'); // 256k * 1.1
      expect(manifest).toContain('/api/media/songs/42/hls/hls-high/index.m3u8');
    });

    it('appends the stream token query to every variant URI', () => {
      const manifest = buildMasterManifest(variants, '/api/media/songs/42/hls', '?t=abc');
      expect(manifest).toContain('/api/media/songs/42/hls/hls-high/index.m3u8?t=abc');
    });

    it('returns null when no HLS variant is ready', () => {
      expect(buildMasterManifest([variants[2]], '/x')).toBeNull();
      expect(buildMasterManifest([], '/x')).toBeNull();
    });
  });

  describe('resolveHlsPath', () => {
    it('resolves whitelisted files inside the variant directory', () => {
      const resolved = resolveHlsPath(7, 'hls-high', 'segment_0004.ts');
      const expectedRoot = path.resolve(UPLOAD_DIR, 'transcoded', '7', 'hls', 'hls-high');
      expect(resolved).toBe(path.join(expectedRoot, 'segment_0004.ts'));
      expect(resolveHlsPath(7, 'hls-high', 'index.m3u8')).toContain('index.m3u8');
    });

    it('rejects non-whitelisted file names', () => {
      expect(() => resolveHlsPath(7, 'hls-high', '../../../etc/passwd')).toThrow();
      expect(() => resolveHlsPath(7, 'hls-high', 'segment_1.ts')).toThrow();
      expect(() => resolveHlsPath(7, 'hls-high', 'evil.m3u8')).toThrow();
      expect(() => resolveHlsPath(7, 'hls-high', '')).toThrow();
    });

    it('rejects malicious variant keys', () => {
      expect(() => resolveHlsPath(7, '../7/hls/x', 'index.m3u8')).toThrow();
      expect(() => resolveHlsPath(7, 'a/b', 'index.m3u8')).toThrow();
    });
  });

  describe('appendTokenToPlaylist', () => {
    const playlist = [
      '#EXTM3U',
      '#EXT-X-TARGETDURATION:6',
      '#EXTINF:6.0,',
      'segment_0000.ts',
      '#EXTINF:6.0,',
      'segment_0001.ts',
      '#EXT-X-ENDLIST',
    ].join('\n');

    it('appends the stream token to every segment URI so playback completes', () => {
      const rewritten = appendTokenToPlaylist(playlist, 'tok en');
      expect(rewritten).toContain('segment_0000.ts?t=tok%20en');
      expect(rewritten).toContain('segment_0001.ts?t=tok%20en');
      // directives untouched
      expect(rewritten).toContain('#EXT-X-TARGETDURATION:6');
      expect(rewritten).not.toContain('#EXTM3U?t=');
    });

    it('is a no-op without a token (Bearer-authenticated clients)', () => {
      expect(appendTokenToPlaylist(playlist, undefined)).toBe(playlist);
    });
  });
});
