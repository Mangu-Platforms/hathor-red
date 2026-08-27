# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Song list, upload, **signed progressive stream** for `<audio>` (`stream-url` + `streamAuth` query token)
- Player: load/play/pause, volume, speed, progress, queue next/prev, repeat modes
- Shuffle uses a Fisher-Yates permutation (not random-jump each skip)
- Seek rejects invalid duration / non-finite times
- Play after load awaits `audio.play()` (no fixed 100ms race)
- Pitch/stem UI **hidden** (not implemented on the audio graph)
- **Queue panel** on the player bar (list + jump via `playAtIndex`)
- `GET /api/songs/genres` wired (controller was present; route was missing)
- Podcasts nav: honest coming-soon page
- Rooms / playlists / AI endpoints present; behavior depends on DB seed + API keys
- Olympus modules mount when feature flags are on; degrade when OpenAI/worker missing
- Socket `sync-state` writes DB **and** Redis `playback:${userId}` (matches HTTP update path)

## This run changed

- **dose-1.3**: MusicPlayer queue panel + PlayerContext `playAtIndex`; route `GET /songs/genres` before `/:id`

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Genre **filter UI** on Home still needs verification that it passes `genre` query to `getSongs`
- Drag-reorder / remove-from-queue in the panel (list + jump only)

## Next item

Dose 1 closed for core playback + queue surface.
Dose 2: Settings profile polish, logout without hard reload.
Dose 3: confirm Home genre filter actually filters; playlist detail route if missing.
