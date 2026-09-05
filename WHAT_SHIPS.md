# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- **Full PlayerContext restored (dose-1.103)**: loadSong with playGeneration race guard, queue, real Fisher–Yates shuffle, hydrate/persist, media session, keyboard shortcuts (space/k, arrows, M mute, **N next / P previous**), listening history, clearQueue stops playback, toggleMute, insertNext, duplicate-in-queue guard, seek clamps to finite duration
- MusicPlayer mute UI beside volume slider
- **Progress bar pointer drag-to-seek (dose-1.104)**: pointer capture, finite-duration guards, keyboard arrows/Home/End on the bar, no seek when duration unknown
- **Volume slider a11y (dose-1.105)**: aria-valuemin/max/now, labelled control, ArrowLeft/Right/Home/End adjust volume without relying on native range quirks alone
- Playlists, rooms, AI with fallbacks, Olympus flags honesty
- Docs honesty, auth soft logout, room host controls, live listener counts, Olympus fallback banners
- Home genre filter calls `GET /songs?genre=` and server filters by `genre = $1`
- Settings platform status refresh, member-since, password visibility toggles
- Empty playlist CTA, owner badge, song count on playlist cards
- Host/Public-Private badges on room cards; empty now-playing; host check; participants Host badge
- Queue panel: shuffle honesty, paused current-track marker, empty how-to CTA, row + total + remaining duration, Play next, touch reorder

## Incident closed

PlayerContext on main was truncated to stubs after prior agent pushes. Restored complete implementation from `4e5a6da` with keyboard N/P (dose-1.103). Commit `f800869`.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets (single-device hydrate/persist only)
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence (in-process map only)

## Next item

Dose 1 volume a11y closed (1.105). Remaining Dose 1 polish if any; then Dose 2/4 leftovers. No Dose 6+.
