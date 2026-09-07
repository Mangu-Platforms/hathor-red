# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## CRITICAL — Queue insertNext fixed (dose-1.122)

**Play next / add-to-queue honesty.** `insertNext` now inserts immediately after the current queue index (true “play next”) instead of aliasing append. `addToQueue` returns a boolean so SongList feedback (“Added” vs “Already in queue”) is accurate. Shuffle index remap on insert is applied when shuffle is on.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream endpoints (`stream-url` + `stream?t=`)
- Client playback: loadSong via signed stream URL, seek guards, Fisher–Yates shuffle, queue UI (reorder, clear, play-at-index), stream error one-shot retry, Media Session, keyboard (space/n/p/arrows/M mute)
- True insert-next and boolean queue feedback
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

Smallest remaining Dose 1 polish (e.g. queue UI edge cases under shuffle+insert) or start Dose 2 account basics only after playback verification. Do not start Dose 6+.
