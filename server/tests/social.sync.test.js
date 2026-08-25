const {
  estimatePositionMs,
  estimateClockOffset,
  offsetUncertaintyMs,
  buildRoomStatePayload,
} = require('../services/social/syncService');

describe('syncService', () => {
  const now = 1700000000000;

  describe('estimatePositionMs', () => {
    it('holds paused rooms exactly at current_position', () => {
      const room = { current_position: 90, is_playing: false, updated_at: new Date(now - 60000).toISOString() };
      expect(estimatePositionMs(room, now)).toBe(90000);
    });

    it('advances playing rooms by elapsed wall-clock since the last update', () => {
      const room = { current_position: 90, is_playing: true, updated_at: new Date(now - 5000).toISOString() };
      expect(estimatePositionMs(room, now)).toBe(95000);
    });

    it('never goes negative and survives bad rows', () => {
      expect(estimatePositionMs({ current_position: -5, is_playing: false }, now)).toBe(0);
      expect(estimatePositionMs({ current_position: 10, is_playing: true, updated_at: 'garbage' }, now)).toBe(10000);
      // clock skew: updated_at in the future must not rewind the position
      const room = { current_position: 30, is_playing: true, updated_at: new Date(now + 60000).toISOString() };
      expect(estimatePositionMs(room, now)).toBe(30000);
    });

    it('handles string positions from pg', () => {
      const room = { current_position: '45', is_playing: false };
      expect(estimatePositionMs(room, now)).toBe(45000);
    });
  });

  describe('estimateClockOffset', () => {
    it('computes the NTP midpoint offset', () => {
      // client sends at 1000, server stamps 1500, client receives at 1200
      // → midpoint 1100, offset +400 (server ahead)
      expect(estimateClockOffset(1000, 1500, 1200)).toBe(400);
    });

    it('is zero for perfectly aligned clocks with symmetric latency', () => {
      expect(estimateClockOffset(1000, 1100, 1200)).toBe(0);
    });

    it('reports uncertainty as half the round trip', () => {
      expect(offsetUncertaintyMs(1000, 1200)).toBe(100);
      expect(offsetUncertaintyMs(1200, 1000)).toBe(0);
    });
  });

  describe('buildRoomStatePayload', () => {
    it('carries song, live position, and the server timestamp', () => {
      const room = {
        current_song_id: 7,
        current_position: 30,
        is_playing: true,
        updated_at: new Date(now - 2000).toISOString(),
      };
      expect(buildRoomStatePayload(room, now)).toEqual({
        currentSongId: 7,
        position: 30,
        positionMs: 32000,
        isPlaying: true,
        serverTimeMs: now,
      });
    });
  });
});
