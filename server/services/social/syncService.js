/**
 * Room playback synchronization math (Pillar 4, FR-402).
 *
 * The room row stores current_position (seconds) at updated_at. The live
 * position is derived, never polled: clients receive { positionMs,
 * serverTimeMs } and correct for their own clock offset, measured with the
 * sync-ping/sync-pong exchange below.
 *
 * Client-side recipe (documented for the web player):
 *   t0 = Date.now(); emit('sync-ping', { clientTime: t0 })
 *   on('sync-pong', ({ clientTime, serverTime })):
 *     t1 = Date.now()
 *     offset = estimateClockOffset(clientTime, serverTime, t1)
 *   truePosition = positionMs + (Date.now() + offset - serverTimeMs)  [if playing]
 *
 * All functions are pure and unit tested.
 */

/**
 * Estimated playback position of a room in milliseconds at `nowMs`.
 * Paused rooms sit exactly at current_position; playing rooms advance by the
 * wall-clock time since the row was last updated.
 */
function estimatePositionMs(room, nowMs = Date.now()) {
  const baseMs = Math.max(0, (parseInt(room.current_position, 10) || 0) * 1000);
  if (!room.is_playing) return baseMs;

  const updatedAtMs = new Date(room.updated_at).getTime();
  if (Number.isNaN(updatedAtMs)) return baseMs;

  const elapsed = Math.max(0, nowMs - updatedAtMs);
  return baseMs + elapsed;
}

/**
 * NTP-style clock offset from one ping/pong round trip:
 * offset ≈ serverTime - (send + receive) / 2.
 * Positive offset means the server clock is ahead of the client clock.
 */
function estimateClockOffset(clientSendMs, serverTimeMs, clientReceiveMs) {
  const midpoint = (clientSendMs + clientReceiveMs) / 2;
  return serverTimeMs - midpoint;
}

/** Half the round-trip time — the uncertainty of one offset sample. */
function offsetUncertaintyMs(clientSendMs, clientReceiveMs) {
  return Math.max(0, (clientReceiveMs - clientSendMs) / 2);
}

/** The room-state payload sent on join and on demand. */
function buildRoomStatePayload(room, nowMs = Date.now()) {
  return {
    currentSongId: room.current_song_id,
    position: parseInt(room.current_position, 10) || 0,
    positionMs: estimatePositionMs(room, nowMs),
    isPlaying: Boolean(room.is_playing),
    serverTimeMs: nowMs,
  };
}

module.exports = {
  estimatePositionMs,
  estimateClockOffset,
  offsetUncertaintyMs,
  buildRoomStatePayload,
};
