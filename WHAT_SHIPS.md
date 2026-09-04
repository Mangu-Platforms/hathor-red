# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- **Full PlayerContext restored (dose-1.79)**: loadSong, queue, real Fisher–Yates shuffle, hydrate/persist, media session, keyboard shortcuts, listening history, clearQueue stops playback, **toggleMute** for MusicPlayer mute button
- MusicPlayer mute UI beside volume slider
- Playlists, rooms, AI with fallbacks, Olympus flags honesty
- Docs honesty, auth soft logout, room host controls, live listener counts, Olympus fallback banners

## Incident closed

PlayerContext was temporarily stubbed after a bad push. Restored from commit `9c026396` + `toggleMute` (dose-1.79). SPA player API is complete again.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets (single-device hydrate/persist only)
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence (in-process map only)

## Next item

Dose 2 polish (profile/Settings edge cases) or Dose 3 genre filter actually filters on Home. No Dose 6+.
