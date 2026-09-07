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
- **Stream token retry (dose-1.118)**: on `<audio>` error, one automatic re-fetch of signed stream URL for the current song (same playGeneration), resume position + play state; second error does not loop
- MusicPlayer a11y through dose-1.110
- Playlists, rooms, AI fallbacks, Olympus flags honesty
- Docs honesty, soft logout, room host/presence, genre filter, Settings status
- **Room host song picker (dose-4.2)**: host Change Song UI loads catalog, filters by title/artist, emits `room-control` change-song; server sets `current_song_id`, position 0, and `is_playing = true` so late joiners and room-state see the track active
- **AI recommendations fallback banner (dose-5.1)**: AIRecommendations shows status label + amber banner when `/ai/status` reports fallbackMode or not initialized (rule-based library match; results still play)
- **Search worker honesty (dose-5.2)**: Semantic Search shows a status banner when `workerLive` is false (embeddings may be missing/stale); empty results also note stalled worker as a possible cause
- **Store empty-state honesty (dose-5.3)**: Store empty copy uses `/api/features` — distinguishes commerce flag off, empty catalog (list via Artist Hub), and worker off/not-live notes for commerce jobs
- **Library empty-state honesty (dose-5.4)**: Library empty copy uses `/api/features` — commerce flag off vs empty owned list + worker off/not-live notes (parity with Store)
- **Artist Hub empty-state honesty (dose-5.5)**: Top tracks / geo / revenue-by-track empties explain intel/commerce flag-off vs no plays yet (upload + listen path) vs no sales; worker-not-live note on revenue empty when commerce is on
- **SongList empty-state honesty (dose-5.6)**: distinguishes empty catalog (API returned no tracks; upload/seed path) vs active search/genre filter with a clear-filters control; no longer a one-line “No songs match”
- **Home Daily Mix + Rooms load honesty (dose-5.7)**: Home always surfaces a Daily Mix section — ready list with Play All, or empty (listen more to personalize) / error (service unavailable) copy instead of silent omission; Rooms shows a load-error panel with Retry when the rooms API fails (poll still runs every 15s)
- **AIChat fallback banner (dose-5.8)**: AI Music Assistant overlay shows an amber status strip when `/ai/status` reports fallbackMode or not initialized (rule-based library match; replies still work, not LLM-generated) — parity with AIRecommendations and AIPlaylistGenerator
- **Settings privacy pillar honesty (dose-5.9)**: when `/api/features` reports `privacy === false`, Settings replaces GDPR export + account-deletion controls with an amber note that FEATURE_PRIVACY is off and routes are not mounted; skips export-status polling
- **TrackComments social gate (dose-5.10)**: comments toggle above the player only renders when FEATURE_SOCIAL is on (`/api/features` social !== false); when the pillar is off, `/api/social` is unmounted and the UI stays hidden instead of silently failing loads
- **AIPlaylistGenerator /ai/status parity (dose-5.11)**: generator fallback banner now reads `/ai/status` (fallbackMode / initialized) like AIRecommendations and AIChat instead of `features.aiLive`, so the amber strip stays honest when the live model is offline

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence

## Next item

Dose 5 Olympus shells: remaining thin-copy / dead-nav checks if any (e.g. media pipeline empty states). No Dose 6+.
