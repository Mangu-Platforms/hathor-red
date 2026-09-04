# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- **PlayerContext restored (dose-1.58f)**: real loadSong via signed stream-url, play/pause/seek, queue, Fisher-Yates shuffle, repeat modes, finite volume/speed guards
- **Playback hydrate/persist (dose-1.59)**: on auth, PlayerContext loads `/api/playback/state` (Redis then DB), restores song + position + volume/speed; debounced POST on song/play/volume/speed changes
- **Queue reorder (dose-1.60)**: `moveInQueue` remaps `queueIndex` and shuffle permutation so drag/reorder does not desync now-playing or shuffle order
- **Logout clears player (dose-1.61)**: soft logout pauses audio, clears src/queue/shuffle, bumps playGeneration so in-flight loadSong cannot resume under the login screen
- **Stream URL refresh on media error (dose-1.62)**: one automatic re-mint of `/stream-url` per playGeneration when `<audio>` fires `error` (expired token / transient fail), resume near last position
- **Remove now-playing from queue (dose-1.63)**: removing the active queue row loads the next track (or stops cleanly if queue empties) instead of leaving a stale currentSong
- Playlists, rooms, AI with fallbacks, Olympus flags honesty
- **Docs honesty (dose-0.64)**: DEEP_DIVE no longer claims Web Audio stems/pitch as shipping features
- **authService soft logout event (dose-2.65)**: `authService.logout` dispatches `auth:logout` (same path as 401 interceptor) so token clear always notifies AuthContext without hard reload
- **Room host controls (dose-4.66)**: host play/pause sends real player `progress` (seconds) instead of always 0; song picker has client-side title/artist search filter; picker CSS for list + search
- **Rooms list listener counts (dose-4.67)**: `GET /api/rooms` prefers live unique-user socket presence counts when this process has members for a room, otherwise falls back to `room_participants` COUNT — multi-tab refcounted, recent disconnects reflected on the 15s poll without sticky ghosts
- **Olympus fallback empty states (dose-5.68)**: AI Playlist Generator shows a clear banner when `aiLive` is false (rule-based library match, not LLM); Radar notes when `workerLive` is false so empty/stale mixes are not mysterious; CSS import fixed in 5.68b
- **Room detail live roster (dose-4.69)**: `GET /api/rooms/:id` prefers live socket presence roster (same in-process map as 4.67) when non-empty, mapping to participant shape; falls back to `room_participants` when this process has no sockets for the room
- **Seek edge guards (dose-1.70)**: `seek` no-ops when `<audio>` has no `src` (cleared queue / pre-load); `formatTime` uses `Number.isFinite` so 0 still formats and NaN/Infinity/negative map to `0:00`
- **Keyboard media controls (dose-1.71)**: Space/K toggle play-pause; J/Left and L/Right seek ±5s; Up/Down volume ±0.05 — ignored while focus is in input/textarea/select/contenteditable
- **Media Session API (dose-1.72)**: lock-screen / OS media keys get title/artist/album/artwork metadata; play, pause, previoustrack, nexttrack, seekbackward/forward (±10s), seekto; playbackState + positionState synced; cleared on logout
- **Keyboard mute (dose-1.73)**: M toggles mute; restores last non-zero volume (also remembered when the volume slider/API sets a positive level)
- **Record listening on track end (dose-1.74)**: PlayerContext calls `musicService.recordListening` on natural `ended` (duration ≥ 5s) so `listening_history` is populated for recommendations/history
- **Record listening on skip/track-change (dose-1.75)**: same ≥5s threshold when `playAtIndex` / `setQueueAndPlay` / remove-now-playing leaves the prior track (next/prev/skip/queue replace), not only on natural end
- **Settings listening stats (dose-2.76)**: Profile section loads `/api/auth/stats` and shows total plays, listened time, and top artist; copy notes that display name/avatar saves apply immediately in the sidebar
- **Clear queue stops playback (dose-1.77)**: `clearQueue` pauses audio, clears src/currentSong, records listen if ≥5s, bumps playGeneration, and persists stopped state — queue panel Clear no longer leaves a ghost now-playing track

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets (single-device hydrate/persist only)
- Server-persisted multi-track queue
- Telemetry/loudness/waveform (stripped in compact restore; non-blocking for Dose 1 playback)
- Redis-backed multi-instance room presence (in-process map only)

## Next item

Dose 1.77 clearQueue stop closed. Next: remaining Dose 2 (account) polish or Dose 3 home/playlists genre filter honesty (client SongList select vs server Home filter). No Dose 6+.
