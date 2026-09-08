# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## CRITICAL — soft logout stops player (dose-2.83)

**Playback clears on sign-out.** `PlayerContext` listens for `auth:logout` (and `isAuthenticated` flipping false) and runs `clearQueue()` plus resets hydration so the next login can restore state. Soft logout already avoided hard reload; the player no longer keeps playing after Sign out.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Soft logout without hard reload; player/queue clear on logout
- Song list, upload, signed progressive stream endpoints (`stream-url` + `stream?t=`)
- Client playback: loadSong via signed stream URL, seek guards, Fisher–Yates shuffle, queue UI (reorder, clear, play-at-index), stream error one-shot retry, Media Session, keyboard (space/n/p/arrows/M mute)
- True insert-next (linear and under shuffle) and boolean queue feedback
- **insertNext on idle player auto-starts** (empty queue + no currentSong → same as first addToQueue)
- removeFromQueue with shuffle-order remap + shuffle-next when removing current
- **removeFromQueue under shuffle: last-in-shuffle stops cleanly** (dose-1.109)
- moveInQueue with shuffle-order remap + shufflePos re-sync
- **Playback hydrate restores last song after login**
- **Hydrate seeds queue with restored song** (dose-1.108)
- **addToQueue on idle player auto-starts**
- **Queue remaining time respects shuffle order** (dose-1.110)
- **MusicPlayer restored** (dose-1.111)
- **Media Session + keyboard wired** (dose-1.112)
- **Queue panel lists shuffle play order** (dose-1.113)
- **Queue “Play next” respects shuffle** (dose-1.114: `makeNext(index)` reorders Fisher–Yates so the track is next after current; linear path still moveInQueue to queueIndex+1; ↑↓ disabled under shuffle)
- Playlists, rooms, AI fallbacks, Olympus flags honesty
- Docs honesty, room host/presence, genre filter, Settings status
- Room host song picker, empty-state honesty, Podcast shell, Sidebar flag gating

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence
- Podcast product (catalog, RSS, episodes) — shell only

## Next item

Dose 1.114 closed (shuffle-aware Play next). Remaining: restore full PlayerContext if PLACEHOLDER regressions, or Dose 2 Settings polish. Do not start Dose 6+.
