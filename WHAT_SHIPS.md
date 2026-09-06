# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- **PlayerContext restored (dose-1.113b)**: loadSong with playGeneration race guard, signed stream URLs, play/pause/seek, queue add/setQueueAndPlay, playNext/Previous, clearQueue clears Media Session metadata + playbackState none, toggleMute, seek clamps
- **Real Fisher–Yates shuffle (dose-1.114)**: toggleShuffle builds permutation (current track first), playNext/Previous and `ended` follow shuffleOrder; repeat-one restarts current; repeat-all reshuffles at end of permutation; linear path still used when shuffle off
- **Media Session + keyboard N/P (dose-1.115)**: metadata + playbackState for lock-screen/OS keys; action handlers play/pause/previoustrack/nexttrack/seekbackward/seekforward/seekto; keyboard N=next, P=previous (ignored in inputs)
- **Queue remove/move (dose-1.116)**: removeFromQueue remaps shuffle order and advances if current removed; moveInQueue reorders with index/shuffle remap; MusicPlayer drag/touch and buttons now functional
- **Hydrate + persist playback (dose-1.117)**: on auth, once, GET `/playback/state` and loadSong at saved position (no autoplay); debounced POST of currentSongId/position/isPlaying/volume/playbackSpeed; flush on visibility hidden / pagehide. Single-track only — multi-track queue not persisted
- MusicPlayer a11y through dose-1.110
- Playlists, rooms, AI fallbacks, Olympus flags honesty
- Docs honesty, soft logout, room host/presence, genre filter, Settings status

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence

## Next item

Dose 4 room host song picker. No Dose 6+.
