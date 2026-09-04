# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- **Full PlayerContext restored (dose-1.79)**: loadSong, queue, real Fisher–Yates shuffle, hydrate/persist, media session, keyboard shortcuts, listening history, clearQueue stops playback, **toggleMute** for MusicPlayer mute button
- **Keyboard M uses toggleMute (dose-2.80)** — same mute/unmute path as the player button (preMuteVolume)
- MusicPlayer mute UI beside volume slider
- Playlists, rooms, AI with fallbacks, Olympus flags honesty
- Docs honesty, auth soft logout, room host controls, live listener counts, Olympus fallback banners
- Home genre filter calls `GET /songs?genre=` and server filters by `genre = $1`
- **Settings platform status refresh (dose-2.81)**: Refresh status button re-fetches `/api/features` (force) + `/api/health` and shows last-checked time
- **Settings member-since + toast clear (dose-2.82)**: Profile shows Member since from `created_at`; profile/password success messages auto-clear after 5s; updateProfile returns `created_at` so it survives a save
- **Settings password visibility toggles (dose-2.83)**: Show/Hide on current, new, and confirm password fields; resets after successful change

## Incident closed

PlayerContext was temporarily stubbed after a bad push. Restored from commit `9c026396` + `toggleMute` (dose-1.79). SPA player API is complete again.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets (single-device hydrate/persist only)
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence (in-process map only)

## Next item

Dose 3 playlist edge cases (empty-state CTA, owner-only actions), or remaining Dose 2 account polish. Genre filter already filters on Home. No Dose 6+.
