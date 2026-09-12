# WHAT_SHIPS — Hathor Red live capability snapshot

Last updated: 2026-09-12 (dose-1.64 socket join-room participant count + authController listening stats toNonNegInt bar).

## Ships today

- **Auth**: email/password + JWT. No OAuth routes mounted. `authMiddleware` normalizes `req.user` to `{ userId, username }` (same shape as `streamAuth`) and rejects stream-typed tokens on the Bearer path. **dose-1.64**: `getListeningStats` uses shared `toNonNegInt` for totalPlays and totalListeningTimeSeconds.
- **Playback (Dose 1 core)**: signed stream URLs; streamAuth + streamToken; positive-int / bounded bars through dose-1.63. **dose-1.64**: socket `join-room` participant COUNT uses shared `toNonNegInt` before comparing to `max_listeners`.
- **Player**: full PlayerContext (queue, shuffle, seek guards, hydrate, logout clear).
- **Queue UI / Playlists / Home genre / Rooms / Olympus flags / Podcasts (soon)** as prior.
- **Pitch/stems**: not implemented; UI hidden.

## Does not ship

- HLS in the live player, OAuth, WebRTC rooms, stem/pitch, cross-device live queue list, podcast catalog.

## Dose status

| Dose | Status |
|------|--------|
| 0 Truth | Done |
| 1 Playback | Core done through dose-1.64 (socket join-room count + auth stats toNonNegInt) |
| 2 Account | Soft logout + profile path present |
| 3–5 | Routes/flags/rooms as prior |

## Next item

Optional multi-device live queue list (not claimed). Remaining: syncService position parseInt.

See also: [README.md](README.md), [BUGS.md](BUGS.md), [API.md](API.md).
