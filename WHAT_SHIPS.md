# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- **PlayerContext restored (dose-1.58f)**: real loadSong via signed stream-url, play/pause/seek, queue, Fisher-Yates shuffle, repeat modes, finite volume/speed guards
- Playlists, rooms, AI with fallbacks, Olympus flags honesty

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync / Redis playback hydrate (trimmed for size; can re-add)
- Server-persisted multi-track queue
- Telemetry/loudness/waveform (stripped in compact restore; non-blocking for Dose 1 playback)

## Next item

Residual Dose 1: Redis+socket playback state hydrate/persist if needed; then Dose 2 account basics. No Dose 6+.
