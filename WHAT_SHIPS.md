# WHAT_SHIPS — Hathor Red live capability snapshot

Last updated: 2026-09-09 (dose-1.3 playback hydrate unwrap).

## Ships today

- **Auth**: email/password + JWT. No OAuth routes mounted.
- **Playback (Dose 1 core)**: signed stream URLs (`GET /api/songs/:id/stream-url` → `/stream?t=…`) so HTML5 `<audio src>` works without Authorization headers. `streamAuth` + `streamToken` (short-lived, song-scoped). Client resolves absolute origin when `REACT_APP_API_URL` is set.
- **Player**: queue, Fisher-Yates shuffle, repeat (none/one/all), seek with finite-duration guards, play-generation to avoid stale autoplay races, stream URL retry on media error, volume + playback-rate (0.5x–2x). Pitch-shift and stem UI **removed** (not on the audio graph).
- **Playback hydrate**: `getPlaybackState` unwraps `{ state }` to the row; resume uses `current_song_id` / `is_playing` / `position` and restores volume + playback_speed from the saved row.
- **Playlists**: list, detail route, add/remove/reorder, AI generate when OpenAI/Colab available (rule-based fallback otherwise).
- **Rooms**: create/join/leave, socket presence; disconnect path cleans `room_participants`. Listener counts refresh via poll.
- **Olympus shells**: `/api/media`, `/api/commerce`, `/api/discovery`, `/api/social`, `/api/intel`, `/api/privacy` gated by `FEATURE_*` flags. Worker optional (`FEATURE_WORKER`). Client nav/routes gate on `/api/features`.
- **Podcast**: honest coming-soon page; nav label "Podcasts (soon)".
- **Static uploads**: **not** public; audio only via signed stream.

## Does not ship (do not claim in UI)

- HLS adaptive playback in the live player (transcode/HLS code exists behind media flag; progressive stream is what `<audio>` uses).
- OAuth (Google/Spotify).
- WebRTC video in rooms.
- Stem separation / independent pitch shift.
- Multi-device live queue sync beyond basic playback state Redis+DB write (socket path updates Redis; full cross-device queue UI not wired).
- Podcast catalog, RSS, subscribe, or episode playback.

## Dose status

| Dose | Status |
|------|--------|
| 0 Truth (README/flags/nav honesty) | Done — README matches; Podcast coming-soon; flags gate Olympus; WHAT_SHIPS live |
| 1 Playback | Core done (signed streams, seek/shuffle/queue guards). Hydrate fixed (unwrap + volume/speed). Residual: multi-device live queue polish |
| 2 Account basics | Profile in Settings present; soft logout without hard reload |
| 3 Home/playlists | Genre filter + playlist routes present; verify filter actually filters |
| 4 Rooms | Disconnect cleanup + poll; host song picker / honest counts next |
| 5 Olympus shells | Fallbacks + flag gating present; remove any remaining dead nav if found |

## Next item

Dose 1 residual: optional client debounce of `updatePlaybackState` while playing so Redis/DB stay warm for multi-device resume; or Dose 3 verify genre filter against server `genre` param.

See also: [README.md](README.md), [BUGS.md](BUGS.md), [API.md](API.md).
