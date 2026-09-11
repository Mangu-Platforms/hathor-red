# WHAT_SHIPS — Hathor Red live capability snapshot

Last updated: 2026-09-10 (dose-1.23 streamAuth harden + WHAT_SHIPS honesty).

## Ships today

- **Auth**: email/password + JWT. No OAuth routes mounted.
- **Playback (Dose 1 core)**: signed stream URLs (`GET /api/songs/:id/stream-url` → `/stream?t=…`) so HTML5 `<audio src>` works without Authorization headers. `streamAuth` + `streamToken` (short-lived, song-scoped). streamAuth normalizes `req.user` to `{ userId, username }`, rejects stream-typed tokens on the Bearer path, and requires `songId`/`userId` on query tokens.
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
| 1 Playback | Core done; streamAuth hardened (dose-1.23) |
| 2 Account | Soft logout + profile path present |
| 3–5 | Routes/flags/rooms as prior |

## Next item

Optional multi-device live queue list (not claimed). Residual Dose 2 profile polish if regressions appear.

See also: [README.md](README.md), [BUGS.md](BUGS.md), [API.md](API.md).
