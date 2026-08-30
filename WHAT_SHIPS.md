# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>`
- Player: load/play/pause, volume, speed, progress, queue next/prev, repeat modes
- Shuffle Fisher-Yates; Next under repeat-none stops at end (dose-1.31)
- **Prev under repeat-none**: at first track under 3s threshold, Previous **stops** (does not wrap) — dose-1.32; restart current when `currentTime > 3s`
- **Prev stop-at-start**: when blocked at queue head, position is forced to **0** and progress UI matches (dose-1.33)
- Queue panel, stream error recovery, logout clears player, playback hydrate
- Playlists, rooms, AI with fallbacks, Olympus flags honesty

## This run changed

- **dose-1.33**: When `playPrevious` hits the no-wrap boundary under `repeatMode === 'none'`, reset `audio.currentTime` and progress to **0** (and persist position 0) instead of leaving a partial scrub position. Symmetric with Next-at-end stopping at the last track end.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync
- Server-persisted multi-track queue (hydrate still restores current song only)

## Next item

Residual Dose 1 only for new concrete playback bugs; Dose 2 largely shipped. Optional: persist full multi-track queue server-side. No Dose 6+.
