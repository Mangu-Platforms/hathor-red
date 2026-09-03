# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- **Full PlayerContext restored** (load/play/queue/shuffle/seek/stream recovery) with dose-1.58 finite guards on volume / playback-speed setters and media-element effects
- Playlists, rooms, AI with fallbacks, Olympus flags honesty

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync
- Server-persisted multi-track queue

## Next item

Residual Dose 1 polish (queue UI edge cases, Redis+socket playback sync verification) then Dose 2 account basics. No Dose 6+.
