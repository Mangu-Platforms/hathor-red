# WHAT_SHIPS — Hathor Red live capability snapshot

Last updated: 2026-09-10 (dose-1.19 stream error retry preserves seek position).

## Ships today

- **Auth**: email/password + JWT. No OAuth routes mounted.
- **Playback (Dose 1 core)**: signed stream URLs (`GET /api/songs/:id/stream-url` → `/stream?t=…`) so HTML5 `<audio src>` works without Authorization headers. `streamAuth` + `streamToken` (short-lived, song-scoped). Client resolves absolute origin when `REACT_APP_API_URL` is set.
- **Player**: queue, Fisher-Yates shuffle, repeat (none/one/all), seek with finite-duration guards, play-generation to avoid stale autoplay races, stream URL retry on media error (**dose-1.19**: resume at prior `currentTime` after fresh signed URL so token expiry mid-track does not snap to 0:00), volume + playback-rate (0.5x–2x). Pitch-shift and stem UI **removed** (not on the audio graph). **Queue dedupe** (dose-1.7): `addToQueue` skips if song id already present and returns false so SongList “Already in queue” feedback is accurate. **insertNext move** (dose-1.12 / restored dose-1.16): if the song is already in the queue, move that row to the play-next slot (honest “Play next”) instead of a silent no-op; skip when already current or already next. **Shuffle-aware play-next** (dose-1.13 / restored dose-1.16): under shuffle, `makeNext` and `insertNext` reorder `shuffleOrder` so the chosen track is next after the current shuffle position (linear ↑↓ remain disabled under shuffle; play-next is honest in play-order). **Context honesty** (dose-1.8): no dead `loudnessGain` / `waveform` stubs on `PlayerContext` value. **PlayerContext restored** (dose-1.16): full ~27KB implementation on main again (was placeholder after push truncation).
- **Playback hydrate**: `getPlaybackState` unwraps `{ state }` to the row; resume uses `current_song_id` / `is_playing` / `position` and restores volume + playback_speed from the saved row.
- **Playback persist**: while playing, client debounces and interval-posts `updatePlaybackState` (position, isPlaying, volume, playbackSpeed, currentSongId) so Redis/DB stay warm for multi-device resume. Also persists on pause, seek, volume/speed, loadSong, clearQueue.
- **Queue UI**: Up-next panel with drag/touch reorder (linear order only; disabled under shuffle), move up/down, play-next, remove, totals/remaining. **Clear** asks for confirm before wiping the queue (dose-1.3). Drag source row uses `is-dragging` so App.css opacity feedback applies (dose-1.4). **CSS aliases** for live MusicPlayer class names (`player-queue-handle`, `player-queue-row-meta` / `-title` / `-artist` / `-dur`, `player-queue-clear`, `player-queue-totals`, `player-queue-row-actions`, plus transport layout `player-track` / `player-art` / `player-side`) so the panel is not unstyled (dose-1.5).
- **Playlists**: list, detail route, add/remove/reorder, AI generate when OpenAI/Colab available (rule-based fallback otherwise).
- **Home genre filter**: Home passes `{ genre }` to `GET /api/songs`; `songController.getSongs` resolves against `ALLOWED_GENRES` case-insensitively and filters with `LOWER(genre)`.
- **SongList local genre filter** (dose-1.10): client-side genre select matches case-insensitively (`s.genre.toLowerCase() === selectedGenre.toLowerCase()`) so mixed-case catalog rows are not silently dropped. **Genre options** (dose-1.11): dropdown values deduped by lower-case key (first-seen casing kept) so "Rock"/"rock" do not both appear.
- **Rooms**: create/join/leave, socket presence; disconnect path cleans `room_participants`. Listener counts refresh via poll. Host song picker (Change Song) + play/pause controls. Room `room-state` / `change-song` load the track via `musicService.getSong` (already unwrapped) then `loadSong`. List and detail prefer live socket presence for `listener_count` / roster; counts are numeric. **ListeningRoom fetchRoom** wrapped in `useCallback` (dose-1.9) so effect deps stay stable (BUGS #8).
- **Olympus shells**: `/api/media`, `/api/commerce`, `/api/discovery`, `/api/social`, `/api/intel`, `/api/privacy` gated by `FEATURE_*` flags. Worker optional (`FEATURE_WORKER`). Client nav/routes gate on `/api/features`.
- **Radar play-all**: uses unwrapped `musicService.getSong` rows (no double `.song`); empty state honest when discovery flag off or worker not live.
- **Radar discovery-off honesty** (dose-1.17): when `FEATURE_DISCOVERY` is false, Radar shows an explicit status banner, disables Play/Refresh, skips the Radar API call after features resolve (same pattern as Search dose-1.14). Worker-stale note remains only when discovery is on.
- **Search play**: `Search` Play button uses unwrapped `musicService.getSong` row (dose-1.6; was destructuring `{ song }` after service already unwrapped).
- **Search discovery-off honesty** (dose-1.14): when `FEATURE_DISCOVERY` is false, Search shows an explicit status banner, disables the query input and submit button, and skips the API call. Worker-stale note remains only when discovery is on.
- **Store/Library commerce-off honesty** (dose-1.18): when `FEATURE_COMMERCE` is false, Store and Library show an explicit status banner, skip the commerce API call after features resolve (same pattern as Search/Radar), and avoid a 404 flash on first paint. Worker-stale note remains only when commerce is on.
- **Settings platform status** (dose-2.95): single worker line prefers `/api/health` worker check over features snapshot; Olympus pillar badges always list Media/Commerce/Discovery/Social/Intel/Privacy as on/off (not only privacy/media when off).
- **Podcast**: honest coming-soon page; nav label "Podcasts (soon)".
- **Static uploads**: **not** public; audio only via signed stream.
- **Env honesty**: `.env.example` documents only the Olympus flags that `server/config/features.js` reads; legacy `FEATURE_HLS_STREAMING` / `FEATURE_OAUTH` / stems / WebRTC names are commented so they cannot be mistaken for live toggles.

## Does not ship (do not claim in UI)

- HLS adaptive playback in the live player (transcode/HLS code exists behind media flag; progressive stream is what `<audio>` uses).
- OAuth (Google/Spotify).
- WebRTC video in rooms.
- Stem separation / independent pitch shift.
- Loudness normalization / waveform visualization in the player context.
- Full cross-device live queue UI (state row is shared; queue list itself is local to the tab).
- Podcast catalog, RSS, subscribe, or episode playback.

## Dose status

| Dose | Status |
|------|--------|
| 0 Truth (README/flags/nav honesty) | Done — README matches; Podcast coming-soon; flags gate Olympus; WHAT_SHIPS live |
| 1 Playback | Core done (signed streams, seek/shuffle/queue guards). Hydrate + persist debounce done. Radar playAll unwrap fixed (dose-1.2). Clear-queue confirm (dose-1.3). Drag visual feedback class wired to CSS (dose-1.4). Queue CSS class aliases for live MusicPlayer DOM (dose-1.5). Search playOne unwrap fixed (dose-1.6). Queue add/insertNext dedupe by song id (dose-1.7). Dead loudnessGain/waveform stubs removed from PlayerContext value (dose-1.8). ListeningRoom fetchRoom useCallback (dose-1.9 / BUGS #8). SongList local genre filter case-insensitive (dose-1.10). Genre select options deduped case-insensitively (dose-1.11). insertNext moves existing queue row to play-next (dose-1.12). Shuffle-aware makeNext/insertNext (dose-1.13). Search discovery-off empty/banner honesty (dose-1.14). **PlayerContext restored on main** (dose-1.16) with full implementation + insertNext move + shuffle-aware play-next. **Radar discovery-off skip + banner** (dose-1.17). **Store/Library commerce-off skip + banner** (dose-1.18). **Stream error retry preserves seek** (dose-1.19). |
| 2 Account basics | Profile in Settings present; soft logout without hard reload. **Platform status polish** (dose-2.95): de-duped worker line + all six Olympus pillar badges. |
| 3 Home/playlists | Genre filter verified + case-insensitive server match; playlist routes present |
| 4 Rooms | Disconnect cleanup + poll; host song picker wired; room track load fixed; listener_count numeric + detail attach (dose-4.3) |
| 5 Olympus shells | Fallbacks + flag gating present; dead-nav gated; .env.example legacy flags clarified (dose-5.1); Radar/Store empty states honest |

## Next item

Optional multi-device queue list (not claimed); residual account polish only if regressions appear.

See also: [README.md](README.md), [BUGS.md](BUGS.md), [API.md](API.md).
