# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## CRITICAL — PlayerContext restored (dose-1.121)

**Client playback restored.** Full `PlayerContext.js` restored from commit `0149d0e7` (blob `85140b397dd9087d87dfa26f8fcd5c549d25b14d`) with keyboard **M** mute re-applied. Play/seek/queue/shuffle/stream retry/Media Session/keyboard shortcuts are live again.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream endpoints (`stream-url` + `stream?t=`)
- Client playback: loadSong via signed stream URL, seek guards, Fisher–Yates shuffle, queue UI hooks, stream error one-shot retry, Media Session, keyboard (space/n/p/arrows/M mute)
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

**Verify playback end-to-end** (play a song, seek, shuffle, mute M, next/prev). Then smallest remaining Dose 1 item (queue UI polish or Redis+socket playback sync if still incomplete). Do not start Dose 6+.
