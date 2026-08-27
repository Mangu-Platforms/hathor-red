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
- **Home genre filter** passes `genre` query to `getSongs` and shows active filter + clear
- Soft logout: `auth:logout` / Sign Out clear user state without `window.location` hard reload (PrivateRoute navigates)
- Podcasts nav: honest coming-soon page
- Rooms / playlists / AI endpoints present; behavior depends on DB seed + API keys
- Olympus modules mount when feature flags are on; degrade when OpenAI/worker missing
- Socket `sync-state` writes DB **and** Redis `playback:${userId}` (matches HTTP update path)
- **Settings profile**: display name form via existing `PUT /auth/profile`; shows username/email read-only; Sign out button

## This run changed

- **dose-2.0**: Settings page profile section — edit display name through `updateProfile`, read-only username/email, soft Sign out

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Drag-reorder / remove-from-queue in the panel (list + jump only)
- Avatar upload / email change from Settings (API supports avatarUrl only; no file picker yet)
- `/playlists` route still renders Home shell (no dedicated playlist detail page)

## Next item

Dose 3: dedicated `/playlists` list + playlist detail route if missing.
