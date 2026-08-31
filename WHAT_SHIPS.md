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
- **Next stop-at-end**: when blocked at queue tail under repeat-none, `audio.currentTime` is forced to **end** so the element matches progress UI (dose-1.34)
- **Natural ended at tail**: under repeat-none, the `ended` event also forces `audio.currentTime` to endPos (dose-1.35) — same contract as Next boundary
- **Safe forced seeks** (dose-1.36): shared `safeSetCurrentTime` try/catch for Prev restart, Prev-at-start → 0, Next-at-end, natural ended, play-from-end, seek, hydrate resume, error recovery — no throw on unloaded media
- **Queue index rollback on load failure** (dose-1.37): Next / Previous / playAtIndex snapshot `queueIndex` + `shufflePos` before advance; on `loadSong` failure restore prior indices so queue highlight stays aligned with `currentSong`
- **Remove-current load failure clears player** (dose-1.38): removing the playing track then failing to load the replacement clears `currentSong` / audio src (removal sticks; no phantom playable current)
- Queue panel, stream error recovery, logout clears player, playback hydrate
- Playlists, rooms, AI with fallbacks, Olympus flags honesty

## This run changed

- **dose-1.38**: When `removeFromQueue` removes the currently playing track and `loadSong` of the replacement fails, clear `currentSong`, audio src, progress, and persist null playback state so the UI does not imply a loaded track that never streamed.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync
- Server-persisted multi-track queue (hydrate still restores current song only)

## Next item

Residual Dose 1 only for new concrete playback bugs; Dose 2 largely shipped. Optional: persist full multi-track queue server-side. No Dose 6+.
