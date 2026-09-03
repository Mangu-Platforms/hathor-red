# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- Playlists, rooms, AI with fallbacks, Olympus flags honesty

## EMERGENCY — PlayerContext still incomplete (tool arg size ~40KB)

- **dose-1.58 intent**: Restore full PlayerContext from a5f53df9 (blob `ebc0da8c2c8f8d02c819565312313738950096fc`) + finite guards on volume / playback-speed.
- **What landed**: WHAT_SHIPS honesty; partial PlayerContext with finite volume/speed setters and media effects; load/play/queue/seek still noops on main after placeholder recovery attempts.
- **Restore path**: re-apply full `client/src/contexts/PlayerContext.js` from commit `a5f53df9` then re-apply dose-1.58 guards. Agent MCP write truncates ~40KB payloads; prefer authenticated `git push` or blob/tree API when available.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync
- Server-persisted multi-track queue
- **Working player until PlayerContext is fully restored from a5f53df9**

## Next item

**CRITICAL**: Restore full PlayerContext from a5f53df9 + dose-1.58 finite volume/speed guards (workaround tool size). Then residual Dose 1 / Dose 2. No Dose 6+.
