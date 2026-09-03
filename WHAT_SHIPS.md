# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- **PlayerContext restored (dose-1.58f)**: real loadSong via signed stream-url, play/pause/seek, queue, Fisher-Yates shuffle, repeat modes, finite volume/speed guards
- **Playback hydrate/persist (dose-1.59)**: on auth, PlayerContext loads `/api/playback/state` (Redis then DB), restores song + position + volume/speed; debounced POST on song/play/volume/speed changes
- Playlists, rooms, AI with fallbacks, Olympus flags honesty

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets (single-device hydrate/persist only)
- Server-persisted multi-track queue
- Telemetry/loudness/waveform (stripped in compact restore; non-blocking for Dose 1 playback)

## Next item

Dose 1 residual closed for basic Redis/HTTP playback state. Next: Dose 2 account basics polish if any gap remains, else Dose 3 home/playlists filters. No Dose 6+.
