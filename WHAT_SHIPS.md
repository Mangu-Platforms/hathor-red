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

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets (single-device hydrate/persist only)
- Server-persisted multi-track queue
- Telemetry/loudness/waveform (stripped in compact restore; non-blocking for Dose 1 playback)

## Next item

Dose 2 soft-logout event closed. Next: Dose 3 home/playlists filters verification under real data, else Dose 4 rooms host song picker UX polish / honest listener counts under multi-tab. No Dose 6+.
