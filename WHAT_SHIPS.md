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
- **setQueueAndPlay load failure clears player** (dose-1.39): replacing the queue and failing to load the start track clears `currentSong` / audio src (queue + indices remain for retry via playAtIndex)
- **Play-fail keeps advanced track** (dose-1.40): if `loadSong` succeeds but `audio.play()` rejects, queue indices and `currentSong` stay on the new track (paused); only `loadSong` failure rolls indices back — avoids highlight vs currentSong divergence
- **loadSong throws only on stream failure** (dose-1.41): `recordListening` is fire-and-forget; a history POST error must not throw after `currentSong`/src were set (would desync index rollback)
- **Repeat-one restart sync** (dose-1.42): on natural `ended` with repeat-one, set progress UI to 0 and persist position 0 / isPlaying after play() resolves or rejects — same boundary contract as other forced seeks
- **Play-reject forces position 0** (dose-1.43): when `loadSong` succeeds but `audio.play()` rejects (autoplay, etc.), force `safeSetCurrentTime(0)` + progress UI 0 on the advanced track so a partial start cannot leave the bar mid-track while paused
- **At-end play() reject forces 0** (dose-1.44): when `play()` restarts from natural end (`ended` or near duration) and `audio.play()` then rejects, always force element + progress UI + persist to 0 (not gated on partial currentTime)
- Queue panel, stream error recovery, logout clears player, playback hydrate
- Playlists, rooms, AI with fallbacks, Olympus flags honesty

## This run changed

- **dose-1.44**: In `play()`, track whether the call is an at-end restart; on `audio.play()` reject after that restart, always `safeSetCurrentTime(0)` + progress 0 + persist position 0 (closes gap where reject left bar off-zero when currentTime was outside (0, 0.5)).

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync
- Server-persisted multi-track queue (hydrate still restores current song only)

## Next item

Residual Dose 1 only for new concrete playback bugs; Dose 2 largely shipped. Optional: persist full multi-track queue server-side. No Dose 6+.
