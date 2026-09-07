# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## CRITICAL — PlayerContext status (dose-1.120)

**Client playback is temporarily an emergency stub.** Accidental truncate during agent push replaced full `PlayerContext.js` with a no-op Provider (SPA still mounts; play/seek/queue/stream do not run).

**Restore path:** copy `client/src/contexts/PlayerContext.js` from commit `0149d0e7d4f720ad3eaaa2bfcc65ab21bd251465` (blob `85140b397dd9087d87dfa26f8fcd5c549d25b14d`), then re-apply the three-line keyboard M mute patch (dose-1.120 intent). Local good file was prepared in the agent sandbox but could not be uploaded intact via MCP argument size limits.

## Works today (server / non-player)

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream endpoints (`stream-url` + `stream?t=`) still on server
- Playlists, rooms, AI fallbacks, Olympus flags honesty
- Docs honesty, soft logout, room host/presence, genre filter, Settings status
- Room host song picker, AI/Search/Store/Library/Artist Hub/SongList/Home empty-state honesty, privacy/social gates, Podcast shell, Sidebar flag gating

## Does not ship (honest)

- Live client playback features until PlayerContext is restored (see CRITICAL)
- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence
- Podcast product (catalog, RSS, episodes) — shell only

## Next item

**Restore full PlayerContext.js from 0149d0e7** (then optional M-key mute). Do not start Dose 6+.
