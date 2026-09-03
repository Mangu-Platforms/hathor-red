# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- Playlists, rooms, AI with fallbacks, Olympus flags honesty
- **PlayerContext restored** (full load/play/queue/seek/shuffle from a5f53df9 + dose-1.58 finite volume/playback-speed guards)

## Closed this run

- **dose-1.58**: Restored full `client/src/contexts/PlayerContext.js` from a5f53df9 and applied finite guards on volume / playback-speed setters and media effects (tool-size truncation fixed by re-push of complete file).

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync
- Server-persisted multi-track queue

## Next item

Residual Dose 1 polish (queue UI honesty / Redis+socket playback sync verification) then Dose 2 account basics. No Dose 6+.
