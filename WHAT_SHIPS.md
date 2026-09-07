# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## CRITICAL — moveInQueue re-syncs shufflePos (dose-1.126)

**Shuffle cursor after reorder.** `moveInQueue` remaps queue indices and the shuffle-order array, then re-finds `shufflePos` via `indexOf(newQueueIndex)` so playNext/playPrevious stay on the same logical sequence slot after a drag-reorder under shuffle. Without this, the cursor could drift relative to the current track.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream endpoints (`stream-url` + `stream?t=`)
- Client playback: loadSong via signed stream URL, seek guards, Fisher–Yates shuffle, queue UI (reorder, clear, play-at-index), stream error one-shot retry, Media Session, keyboard (space/n/p/arrows/M mute)
- True insert-next (linear and under shuffle) and boolean queue feedback
- removeFromQueue with shuffle-order remap + shuffle-next when removing current
- moveInQueue with shuffle-order remap + shufflePos re-sync
- Playlists, rooms, AI fallbacks, Olympus flags honesty
- Docs honesty, soft logout, room host/presence, genre filter, Settings status
- Room host song picker, AI/Search/Store/Library/Artist Hub/SongList/Home empty-state honesty, privacy/social gates, Podcast shell, Sidebar flag gating

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence
- Podcast product (catalog, RSS, episodes) — shell only

## Next item

Dose 1 playback verification complete enough; start Dose 2 account basics (profile in Settings polish, logout without hard reload) or any remaining queue edge case. Do not start Dose 6+.
