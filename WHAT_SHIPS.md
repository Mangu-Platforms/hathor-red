# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## CRITICAL — removeFromQueue advances via shuffle order (dose-1.125)

**Shuffle next after removing current.** When the removed track is current and shuffle is on, `removeFromQueue` remaps the order then plays `remappedOrder[clampedShufflePos]` (the former next in the permutation) instead of the linear index that slid into the hole. Linear fallback remains when shuffle is off. playNext/playPrevious stay aligned after mid-queue deletes under shuffle.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream endpoints (`stream-url` + `stream?t=`)
- Client playback: loadSong via signed stream URL, seek guards, Fisher–Yates shuffle, queue UI (reorder, clear, play-at-index), stream error one-shot retry, Media Session, keyboard (space/n/p/arrows/M mute)
- True insert-next (linear and under shuffle) and boolean queue feedback
- removeFromQueue with shuffle-order remap + shuffle-next when removing current
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

Smallest remaining Dose 1 polish (e.g. moveInQueue shufflePos edge cases) or start Dose 2 account basics only after playback verification. Do not start Dose 6+.
