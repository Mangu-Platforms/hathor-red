# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## CRITICAL — soft logout stops player (dose-2.83)

**Playback clears on sign-out.** `PlayerContext` listens for `auth:logout` (and `isAuthenticated` flipping false) and runs `clearQueue()` plus resets hydration so the next login can restore state. Soft logout already avoided hard reload; the player no longer keeps playing after Sign out.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Soft logout without hard reload; player/queue clear on logout
- Song list, upload, signed progressive stream endpoints (`stream-url` + `stream?t=`)
- Client playback: loadSong via signed stream URL, seek guards, Fisher–Yates shuffle, queue UI (reorder, clear, play-at-index), stream error one-shot retry
- True insert-next (linear and under shuffle) and boolean queue feedback
- **insertNext on idle player auto-starts** (empty queue + no currentSong → same as first addToQueue)
- removeFromQueue with shuffle-order remap + shuffle-next when removing current
- **removeFromQueue under shuffle: last-in-shuffle stops cleanly** (dose-1.109)
- moveInQueue with shuffle-order remap + shufflePos re-sync
- **Playback hydrate restores last song after login** (`musicService.getSong` unwraps `{ song }`)
- **Hydrate seeds queue with restored song** (dose-1.108)
- **addToQueue on idle player auto-starts**
- **Queue remaining time respects shuffle order** (dose-1.110: when shuffled, “X left” walks Fisher–Yates from shufflePos; linear path unchanged). `shuffleOrder`/`shufflePos` exported from PlayerContext.
- Playlists, rooms, AI fallbacks, Olympus flags honesty
- Docs honesty, room host/presence, genre filter, Settings status
- Room host song picker, AI/Search/Store/Library/Artist Hub/SongList/Home empty-state honesty, privacy/social gates, Podcast shell, Sidebar flag gating

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence
- Podcast product (catalog, RSS, episodes) — shell only

## Next item

Dose 1.110 closed (shuffle-aware queue remaining). Next: re-verify Media Session + keyboard shortcuts on PlayerContext after restore, or Dose 2 Settings polish. Do not start Dose 6+.
