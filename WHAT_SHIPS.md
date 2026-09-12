# WHAT_SHIPS — Hathor Red live capability snapshot

Last updated: 2026-09-12 (dose-1.64 socket join-room participant count + authController listening stats toNonNegInt bar).

## Ships today

- **Auth**: email/password + JWT. No OAuth routes mounted. `authMiddleware` normalizes `req.user` to `{ userId, username }` (same shape as `streamAuth`) and rejects stream-typed tokens on the Bearer path. **dose-1.27**: `authMiddleware` requires finite positive integer `userId` (reject NaN/0/negative/non-integer before `req.user` is set), matching the stream-token bar from dose-1.26. **dose-1.38**: `authMiddleware` uses shared `toPositiveInt` from `streamToken` (DRY with streamAuth path/Bearer checks). **dose-1.39**: Socket.IO handshake uses the same bar (reject `typ === 'stream'`, require positive-int `userId` before `socket.userId` is set). **dose-1.64**: `getListeningStats` uses shared `toNonNegInt` for totalPlays and totalListeningTimeSeconds (finite non-negative integer; allow 0; reject NaN/negative/non-integer instead of raw parseInt).
- **Playback (Dose 1 core)**: signed stream URLs (`GET /api/songs/:id/stream-url` → `/stream?t=…`) so HTML5 `<audio src>` works without Authorization headers. `streamAuth` + `streamToken` (short-lived, song-scoped). streamAuth normalizes `req.user` to `{ userId, username }`, rejects stream-typed tokens on the Bearer path, and requires `songId`/`userId` on query tokens. Prior doses 1.24–1.63 as documented in prior commits. **dose-1.64**: socket `join-room` participant COUNT uses shared `toNonNegInt` (finite non-negative integer; allow 0; reject NaN/negative/non-integer instead of raw parseInt) before comparing to `max_listeners`.
- **Player**: full `PlayerContext` on main (queue, Fisher-Yates shuffle, repeat, seek guards, play-generation, stream error retry preserves seek, volume/speed, hydrate from `/playback/state`, persist debounce). **Logout clear** (dose-1.20/1.21): when `isAuthenticated` becomes false, `clearQueue()` runs and `hydratedRef` resets so signed streams stop and a later login can hydrate again.
- **Queue UI**: up-next panel, drag reorder (linear only), play-next / makeNext / insertNext (shuffle-aware), dedupe on add.
- **Playlists / Home genre filter / Rooms / Olympus flag gates / Podcasts (soon)** as prior doses.
- **Pitch/stems**: not implemented; UI controls remain hidden.

## Does not ship

- HLS in the live player, OAuth, WebRTC rooms, stem/pitch, cross-device live queue list, podcast catalog.

## Dose status

| Dose | Status |
|------|--------|
| 0 Truth | Done |
| 1 Playback | Core done through dose-1.64 (socket join-room participant count + authController getListeningStats toNonNegInt bar) |
| 2 Account | Soft logout + profile path present |
| 3–5 | Routes/flags/rooms as prior |

## Next item

Optional multi-device live queue list (not claimed). Residual Dose 2 profile polish if regressions appear. Remaining candidates: syncService position parseInt — lower priority than request-path / response-boundary ids.

See also: [README.md](README.md), [BUGS.md](BUGS.md), [API.md](API.md).
