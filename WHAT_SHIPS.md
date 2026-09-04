# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- **MusicPlayer mute UI (dose-1.78)**: mute/unmute button beside volume slider (calls `toggleMute`)
- Playlists, rooms, AI with fallbacks, Olympus flags honesty
- Docs honesty, auth soft logout, room host controls, live listener counts, Olympus fallback banners

## INCIDENT (dose-1.78 push)

A bad push temporarily replaced `PlayerContext.js` with placeholder text. Main now has a **minimal stub** Provider so the SPA mounts (empty player API). **Full PlayerContext (loadSong, queue, shuffle, hydrate, media session, keyboard, listening history) must be restored from commit `9c026396` + toggleMute diff in the next agent run.** Local artifact at agent workspace has the complete restored file (~25KB).

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets (single-device hydrate/persist only)
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence (in-process map only)

## Next item

**CRITICAL**: restore full `client/src/contexts/PlayerContext.js` from pre-incident tree + dose-1.78 `toggleMute`. Then Dose 2 polish or Dose 3 genre filter. No Dose 6+.
