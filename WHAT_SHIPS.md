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
- **Stream error recovery play-reject** (dose-1.45): on `<audio>` error, one re-fetch of signed URL + `safeSetCurrentTime` resume; if `play()` rejects after reload, pause element, sync progress UI to resume position, leave `currentSong` (same contract as other play-reject paths)
- **Terminal stream recovery persist** (dose-1.46): when stream retry is exhausted, stream-url re-fetch fails, or play() rejects after a successful re-fetch, call `updatePlaybackState` with `isPlaying: false` and the last known position so server/hydrate state matches the paused UI
- **Repeat-one play-reject forces 0** (dose-1.47): on natural `ended` with repeat-one, if `audio.play()` rejects after restart-to-0, force `safeSetCurrentTime(0)` + progress UI 0 again (same partial-start contract as dose-1.43/1.44)
- **Stream recovery success persist** (dose-1.48): when stream re-fetch + `play()` succeeds, call `updatePlaybackState` with `isPlaying: true` and resume position so server/hydrate matches the live playing UI (mirrors the play-reject persist path)
- **Stream recovery clears loadSong metadata listener** (dose-1.49): on `<audio>` error recovery, drop any pending `loadedmetadata` cleanup from `loadSong` so a stale listener cannot overwrite duration after src re-bind
- **Stream recovery resets retry + tracks recovery metadata** (dose-1.50): after successful re-fetch + play, reset `streamRetryRef` so a later media error can retry once more; recovery `loadedmetadata` handler is registered via `durationMetaCleanupRef` so concurrent loadSong can clear it
- **Hydrate resume metadata via durationMetaCleanupRef** (dose-1.51): playback-state hydrate registers its resume `loadedmetadata` on the shared cleanup ref so concurrent `loadSong` / stream recovery cannot leave a stale seek listener
- **Stream recovery readyState fast path** (dose-1.52): after re-binding signed stream URL on media error, if `readyState >= 1` and duration is already finite, apply resume seek + play immediately (do not only wait for `loadedmetadata`) — same contract as hydrate / loadSong
- **Explicit play restores stream retry budget** (dose-1.53): `play()` sets `streamRetryRef = 0` so a prior terminal media-error recovery does not permanently block a later re-fetch when the user presses Play again on the same track
- **Pause syncs progress UI** (dose-1.54): explicit `pause()` reads finite `audio.currentTime`, sets progress UI to that position, and persists the same value — closes up-to-~250ms lag from the progress interval only running while playing
- **Play success syncs progress UI** (dose-1.55): explicit `play()` after `audio.play()` resolves sets progress UI + persist to finite `audio.currentTime` (0 when restarted from end) — mirrors pause so resume does not leave the bar one tick behind the element
- **Advance play-success syncs progress UI** (dose-1.56): after `loadSong` + successful `audio.play()` on Next / Previous / playAtIndex / setQueueAndPlay, set progress UI + persist to finite `audio.currentTime` (not hard-coded 0 only) — same contract as dose-1.55 so the bar matches the element before the 250ms interval starts
- **Progress interval finite guards** (dose-1.57): while playing, the 250ms tick only writes finite `currentTime` / positive finite `duration` into React state (and segment telemetry) so load/seek/error edges cannot push NaN into the progress bar or duration display
- **Volume / speed finite guards** (dose-1.58): `setVolume` / `setPlaybackSpeed` reject non-finite (and clamp ranges); media-element effects never assign non-finite `volume` or `playbackRate`
- Queue panel, stream error recovery, logout clears player, playback hydrate
- Playlists, rooms, AI with fallbacks, Olympus flags honesty

## This run changed

- **dose-1.58**: Finite guards on volume and playback-speed setters and on the media-element effects so non-finite values cannot poison `<audio>.volume` / `.playbackRate` or persisted playback state.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync
- Server-persisted multi-track queue (hydrate still restores current song only)

## Next item

Residual Dose 1 only for new concrete playback bugs; Dose 2 largely shipped. Optional: persist full multi-track queue server-side. No Dose 6+.
