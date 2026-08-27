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
- Podcasts nav: honest coming-soon page
- Rooms / playlists / AI endpoints present; behavior depends on DB seed + API keys
- Olympus modules mount when feature flags are on; degrade when OpenAI/worker missing
- Socket `sync-state` writes DB **and** Redis `playback:${userId}` (matches HTTP update path)

## This run changed

- **dose-0.1**: README badges → `Mangu-Platforms/hathor-red`; removed claims that OAuth/HLS/WebRTC/stems ship in the live SPA
- **dose-1.1**: PlayerContext play race + seek guards + real shuffle order; MusicPlayer hides pitch/stems; stream token TTL 4h (was 60s)
- **dose-1.2**: Socket `sync-state` now `setEx` Redis after DB upsert so `getPlaybackState` does not return stale cache

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Genre route was controller-only historically — confirm wiring before claiming genre filter
- Queue panel UI (queue exists in context; dedicated drawer TBD)

## Next item

Dose 1 remaining: queue UI surface; confirm genres route if still missing.
Then Dose 2: Settings profile polish, logout without hard reload.
