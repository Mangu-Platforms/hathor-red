# WHAT_SHIPS — Hathor Red live capability snapshot

Last updated: 2026-09-13 (dose-1.70 Range header bounds toNonNegInt).

## Ships today

- **Auth**: email/password + JWT. No OAuth routes mounted. `authMiddleware` normalizes `req.user` to `{ userId, username }` (same shape as `streamAuth`) and rejects stream-typed tokens on the Bearer path. **dose-1.64**: `getListeningStats` uses shared `toNonNegInt` for totalPlays and totalListeningTimeSeconds.
- **Playback (Dose 1 core)**: signed stream URLs; streamAuth + streamToken; positive-int / bounded bars through dose-1.63. **dose-1.65**: syncService `current_position` / `elapsed_ms` use shared `toNonNegInt`. **dose-1.66**: `getRecommendations` userProfile.totalPlays uses shared `toNonNegInt` on COUNT(*) play_count (reject NaN from raw parseInt). **dose-1.67**: radarService co-listen weight uses shared `toNonNegInt` (reject NaN from raw parseInt). **dose-1.68**: REDIS_PORT, PORT, and JOB_POLL_INTERVAL_MS use shared `toPositiveInt` (reject NaN/0/negative/junk; fall back to 6379 / 5000 / 15000) instead of raw parseInt. **dose-1.69**: COLAB_TIMEOUT / COLAB_MAX_RETRIES / COLAB_RATE_LIMIT / COLAB_TOKEN_LIMIT and MAX_FILE_SIZE use shared `toPositiveInt` (fall back to 30000 / 3 / 60 / 100000 / 50MB). **dose-1.70**: streamSong Range header start/end use shared `toNonNegInt` (reject NaN/negative/non-integer instead of raw parseInt).
- **Player**: full PlayerContext (queue, shuffle, seek guards, hydrate, logout clear).
- **Queue UI / Playlists / Home genre / Rooms / Olympus flags / Podcasts (soon)** as prior.
- **Pitch/stems**: not implemented; UI hidden.

## Does not ship

- HLS in the live player, OAuth, WebRTC rooms, stem/pitch, cross-device live queue list, podcast catalog.

## Dose status

| Dose | Status |
|------|--------|
| 0 Truth | Done |
| 1 Playback | Core done through dose-1.70 (Range header bounds toNonNegInt) |
| 2 Account | Soft logout + profile path present |
| 3–5 | Routes/flags/rooms as prior |

## Next item

Optional multi-device live queue list (not claimed); remaining raw parseInt on discovery BPM/year buckets (embeddingService, searchService).

See also: [README.md](README.md), [BUGS.md](BUGS.md), [API.md](API.md).
