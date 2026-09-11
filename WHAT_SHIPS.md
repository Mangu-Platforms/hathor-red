# WHAT_SHIPS — Hathor Red live capability snapshot

Last updated: 2026-09-10 (dose-1.20 logout clears player + resets hydrate).

## Ships today

- **Auth**: email/password + JWT. No OAuth routes mounted.
- **Playback (Dose 1 core)**: signed stream URLs (`GET /api/songs/:id/stream-url` → `/stream?t=…`) so HTML5 `<audio src>` works without Authorization headers. `streamAuth` + `streamToken` (short-lived, song-scoped). Client resolves absolute origin when `REACT_APP_API_URL` is set.
- **Player**: queue, Fisher-Yates shuffle, repeat (none/one/all), seek with finite-duration guards, play-generation to avoid stale autoplay races, stream URL retry on media error (**dose-1.19**: resume at prior `currentTime` after fresh signed URL so token expiry mid-track does not snap to 0:00), volume + playback-rate (0.5x–2x). Pitch-shift and stem UI **removed** (not on the audio graph). **Queue dedupe** (dose-1.7): `addToQueue` skips if song id already present and returns false so SongList “Already in queue” feedback is accurate. **insertNext move** (dose-1.12 / restored dose-1.16): if the song is already in the queue, move that row to the play-next slot (honest “Play next”) instead of a silent no-op; skip when already current or already next. **Shuffle-aware play-next** (dose-1.13 / restored dose-1.16): under shuffle, `makeNext` and `insertNext` reorder `shuffleOrder` so the chosen track is next after the current shuffle position (linear ↑↓ remain disabled under shuffle; play-next is honest in play-order). **Context honesty** (dose-1.8): no dead `loudnessGain` / `waveform` stubs on `PlayerContext` value. **PlayerContext restored** (dose-1.16): full ~27KB implementation on main again (was placeholder after push truncation). **Logout clears player** (dose-1.20): when `isAuthenticated` becomes false, stop media, clear queue, drop persist timers, and reset `hydratedRef` so a later login can hydrate again (signed-stream URLs must not keep playing while unauthenticated).
- **Playback hydrate**: `getPlaybackState` unwraps `{ state }` to the row; resume uses `current_song_id` / `is_playing` / `position` and restores volume + playback_speed from the saved row.
- **Playback persist**: while playing, client debounces and interval-posts `updatePlaybackState` (position, isPlaying, volume, playbackSpeed, currentSongId) so Redis/DB stay warm for multi-device resume. Also persists on pause, seek, volume/speed, loadSong, clearQueue.
- **Queue UI**: Up-next panel with drag/touch reorder (linear order only; disabled under shuffle), move up/down, play-next, remove, totals/remaining. **Clear** asks for confirm before wiping the queue (dose-1.3). Drag source row uses `is-dragging` so App.css opacity feedback applies (dose-1.4). **CSS aliases** for live MusicPlayer class names so the panel is not unstyled (dose-1.5).
- **Playlists**: list, detail route, add/remove/reorder, AI generate when OpenAI/Colab available (rule-based fallback otherwise).
- **Home genre filter**: Home passes `{ genre }` to `GET /api/songs`; case-insensitive server match.
- **SongList local genre filter** (dose-1.10/1.11): case-insensitive + deduped options.
- **Rooms**: disconnect cleans participants; host song picker; honest listener counts.
- **Olympus shells**: flag-gated; client nav/routes gate on `/api/features`.
- **Radar/Search discovery-off honesty** (dose-1.14/1.17); **Store/Library commerce-off honesty** (dose-1.18).
- **Settings platform status** (dose-2.95).
- **Podcast**: honest coming-soon page; nav label "Podcasts (soon)".
- **Static uploads**: **not** public; audio only via signed stream.

## Does not ship (do not claim in UI)

- HLS adaptive playback in the live player.
- OAuth (Google/Spotify).
- WebRTC video in rooms.
- Stem separation / independent pitch shift.
- Loudness normalization / waveform visualization in the player context.
- Full cross-device live queue UI.
- Podcast catalog, RSS, subscribe, or episode playback.

## Dose status

| Dose | Status |
|------|--------|
| 0 Truth | Done |
| 1 Playback | Core done. **Logout clears player + resets hydrate** (dose-1.20). |
| 2 Account basics | Profile + soft logout; platform status polish (dose-2.95). |
| 3 Home/playlists | Done |
| 4 Rooms | Done |
| 5 Olympus shells | Done |

## Next item

Optional multi-device queue list (not claimed); residual account polish only if regressions appear.

See also: [README.md](README.md), [BUGS.md](BUGS.md), [API.md](API.md).
