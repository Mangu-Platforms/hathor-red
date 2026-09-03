# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- Playlists, rooms, AI with fallbacks, Olympus flags honesty

## EMERGENCY — PlayerContext truncated this run

- **dose-1.58 intent**: Finite guards on volume / playback-speed setters and media-element effects.
- **What landed**: WHAT_SHIPS notes + an **emergency stub** `PlayerContext.js` so the SPA does not crash on parse.
- **What does NOT ship right now**: full playback (load/play/queue/shuffle/seek/stream recovery). Stub exposes noops; volume/speed setters still reject non-finite.
- **Restore**: re-apply full `client/src/contexts/PlayerContext.js` from commit `a5f53df9` (or blob `ebc0da8c2c8f8d02c819565312313738950096fc`), then re-apply dose-1.58 volume/speed guards. Agent tool argument size truncated the 40KB write.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync
- Server-persisted multi-track queue
- **Working player until PlayerContext is restored from a5f53df9**

## Next item

**CRITICAL**: Restore full PlayerContext from a5f53df9 + dose-1.58 finite volume/speed guards. Then residual Dose 1 / Dose 2. No Dose 6+.
