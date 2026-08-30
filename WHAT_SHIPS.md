# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>`
- Player: load/play/pause, volume, speed, progress, queue next/prev, repeat modes
- Shuffle Fisher-Yates; Next under repeat-none stops at end (dose-1.31)
- **Prev under repeat-none**: at first track under 3s threshold, Previous **stops** (does not wrap) — dose-1.32; restart current when `currentTime > 3s`
- Queue panel, stream error recovery, logout clears player, playback hydrate
- Playlists, rooms, AI with fallbacks, Olympus flags honesty

## This run changed

- **dose-1.32**: Manual Previous under `repeatMode === 'none'` stops at the **start** of sequential/shuffle order when under the 3s restart threshold (symmetric with Next-at-end). `resolvePrevIndex(wrap)` gates both paths; `repeat all` still wraps on Prev.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync

## Next item

Residual Dose 1 only for new concrete playback bugs; Dose 2 largely shipped. Optional: persist full multi-track queue. No Dose 6+.
