# WHAT_SHIPS — Hathor Red live capability snapshot

Last updated: 2026-09-11 (dose-1.31 recordListening positive-int songId).

## Ships today

- **Auth**: email/password + JWT. No OAuth routes mounted. `authMiddleware` normalizes `req.user` to `{ userId, username }` (same shape as `streamAuth`) and rejects stream-typed tokens on the Bearer path. **dose-1.27**: `authMiddleware` requires finite positive integer `userId` (reject NaN/0/negative/non-integer before `req.user` is set), matching the stream-token bar from dose-1.26.
- **Playback (Dose 1 core)**: signed stream URLs (`GET /api/songs/:id/stream-url` → `/stream?t=…`) so HTML5 `<audio src>` works without Authorization headers. `streamAuth` + `streamToken` (short-lived, song-scoped). streamAuth normalizes `req.user` to `{ userId, username }`, rejects stream-typed tokens on the Bearer path, and requires `songId`/`userId` on query tokens. **dose-1.24**: stream tokens optionally carry `username` from the minting session so `req.user.username` is populated on the query-token path without a DB lookup. **dose-1.26**: `signStreamToken` / `verifyStreamToken` require finite positive integer `userId` and `songId` (reject NaN/0/negative/string junk before `req.user` is set). **dose-1.28**: when `?t=` is present and the route has `:id`, `streamAuth` rejects the request if `token.songId` does not match the path param (defense in depth; `streamSong` still re-checks). **dose-1.29**: `getStreamUrl` and `streamSong` call `toPositiveInt` on path `:id` before DB or token mint and return 400 on invalid ids (same bar as tokens; independent of validation middleware order). **dose-1.30**: `getSongById` also applies `toPositiveInt` on path `:id` and returns 400 on invalid ids (same bar as stream endpoints). **dose-1.31**: `recordListening` applies `toPositiveInt` on body `songId` (and non-negative integer duration) before DB insert (same bar; independent of validation middleware).
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
| 1 Playback | Core done; streamAuth hardened (dose-1.23); stream token username (dose-1.24); authMiddleware normalize (dose-1.25); stream token positive-int ids (dose-1.26); authMiddleware positive-int userId (dose-1.27); streamAuth path songId match (dose-1.28); stream controller positive-int songId (dose-1.29); getSongById positive-int songId (dose-1.30); recordListening positive-int songId (dose-1.31) |
| 2 Account | Soft logout + profile path present |
| 3–5 | Routes/flags/rooms as prior |

## Next item

Optional multi-device live queue list (not claimed). Residual Dose 2 profile polish if regressions appear.

See also: [README.md](README.md), [BUGS.md](BUGS.md), [API.md](API.md).
