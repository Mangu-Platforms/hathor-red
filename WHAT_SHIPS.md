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

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets (single-device hydrate/persist only)
- Server-persisted multi-track queue
- Telemetry/loudness/waveform (stripped in compact restore; non-blocking for Dose 1 playback)
- Redis-backed multi-instance room presence (in-process map only)

## Next item

Dose 4.67 Rooms list presence-backed listener counts closed. Next: Dose 5 dead-nav / Olympus fallback polish (empty states when aiLive/workerLive false), or tighten room detail participant list the same way. No Dose 6+.
