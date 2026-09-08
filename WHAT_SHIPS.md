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
- **removeFromQueue under shuffle: last-in-shuffle stops cleanly** (dose-1.109: do not jump backward when the current track was the final shuffle entry; repeat-all reshuffles)
- moveInQueue with shuffle-order remap + shufflePos re-sync
- **Playback hydrate restores last song after login** (`musicService.getSong` unwraps `{ song }` so `loadSong` receives a real row with `id`)
- **Hydrate seeds queue with restored song** (dose-1.108: queue was empty after login restore; now `[song]` + index 0 so Up-next / next-prev stay usable)
- **addToQueue on idle player auto-starts** (empty queue + no currentSong → first add loads and plays; later adds only append)
- **Queue remaining time respects shuffle order** (dose-1.110: when shuffled, “X left” walks Fisher–Yates from shufflePos; linear path unchanged)
- **MusicPlayer restored** (dose-1.111 / dose-1.114: full player UI + shuffle-aware remaining; ⤵ Play next calls `makeNext`)
- **Media Session + keyboard wired** (dose-1.112: MediaMetadata + play/pause/next/prev/seek handlers; Space/N/P/←/→/M when not typing)
- **Queue panel lists shuffle play order** (dose-1.113: when shuffled, Up next rows follow Fisher–Yates from shufflePos so the list matches what playNext will play; remove/move/play-at still use original queue indices)
- **Queue “Play next” respects shuffle** (dose-1.114: `makeNext(index)` reorders Fisher–Yates so the track is next after current; linear path still moveInQueue to queueIndex+1; ↑↓ disabled under shuffle so linear reorder cannot fight the play-order panel)
- **setPlaybackSpeed syntax fixed** (dose-1.115: missing `)` on `Math.min` call broke parse; playback-rate control works again)
- **Queue drag-reorder disabled under shuffle** (dose-1.116: panel shows play-order; drag/touch moveInQueue would fight makeNext/displayRows — same honesty as ↑↓; handle shows · when locked)
- Playlists, rooms, AI fallbacks, Olympus flags honesty
- Docs honesty, room host/presence, genre filter, Settings status
- Room host song picker, AI/Search/Store/Library/Artist Hub/SongList/Home empty-state honesty, privacy/social gates, Podcast shell, Sidebar flag gating
- **Settings toasts auto-clear errors too** (dose-2.84: profile and password messages — success and failure — clear after 5s; success-only clear was dose-2.82)
- **Privacy/export toast auto-clears** (dose-2.85: GDPR export / deletion request messages clear after 5s like profile and password toasts)
- **Settings Save/Update disabled when no-op** (dose-2.86: profile Save disabled until display name or avatar URL differs from loaded user; password Update disabled until current + new (8+) + matching confirm are filled; toasts use role=status aria-live=polite)
- **Settings password live hints** (dose-2.87: while typing, show mismatch / short-password / match status under confirm so users see issues before submit; Update still gated by passwordReady)
- **Settings password same-as-current blocked** (dose-2.88: live hint + disabled Update when new password equals current; submit handler also rejects; editing profile/password fields clears stale toasts immediately)
- **Settings password complexity matches server** (dose-2.89: client live hint + passwordReady + submit guard require upper + lower + digit, same regex as `changePasswordValidation`; avoids server-only 400 after a “ready” button)

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence
- Podcast product (catalog, RSS, episodes) — shell only
- Shuffle play-order drag-reorder (panel is read-order + makeNext only while shuffled)

## Next item

Dose 2.89 closed (password complexity parity with server). Remaining: further Dose 2 Settings polish if needed, or optional future shuffle-order drag. Do not start Dose 6+.
