# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Signed progressive stream for audio
- Player load/play/pause, volume, speed, progress, queue, shuffle, repeat
- **dose-1.32 WIP**: restoring PlayerContext after partial write; Prev-at-start under repeat-none

## This run changed

- **dose-1.32**: Restoring PlayerContext.js after accidental truncation; implementing stop Previous at start under repeat-none (symmetric with dose-1.31).

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC, Demucs stems, pitch-shift DSP

## Next item

Finish dose-1.32 PlayerContext restore if still truncated; residual Dose 1 playback bugs only. No Dose 6+.
