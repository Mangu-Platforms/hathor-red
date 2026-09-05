# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Change password from Settings
- Song list, upload, signed progressive stream for `<audio>` (server + musicService intact)
- **Full PlayerContext restored (dose-1.79)**: loadSong, queue, real Fisher–Yates shuffle, hydrate/persist, media session, keyboard shortcuts, listening history, clearQueue stops playback, **toggleMute** for MusicPlayer mute button
- **Keyboard M uses toggleMute (dose-2.80)** — same mute/unmute path as the player button (preMuteVolume)
- MusicPlayer mute UI beside volume slider
- Playlists, rooms, AI with fallbacks, Olympus flags honesty
- Docs honesty, auth soft logout, room host controls, live listener counts, Olympus fallback banners
- Home genre filter calls `GET /songs?genre=` and server filters by `genre = $1`
- **Settings platform status refresh (dose-2.81)**: Refresh status button re-fetches `/api/features` (force) + `/api/health` and shows last-checked time
- **Settings member-since + toast clear (dose-2.82)**: Profile shows Member since from `created_at`; profile/password success messages auto-clear after 5s; updateProfile returns `created_at` so it survives a save
- **Settings password visibility toggles (dose-2.83)**: Show/Hide on current, new, and confirm password fields; resets after successful change
- **Empty playlist CTA (dose-3.84)**: Playlist detail empty state tells owners how to add songs (Home → song menu → Add to playlist) with a Browse Home link; non-owners see a neutral “owner has not added tracks” message. Delete/reorder/remove remain owner-only.
- **Owner badge on playlist cards (dose-3.85)**: Playlists list shows a “Yours” badge on cards the current user owns, next to the Public badge when present.
- **Song count on playlist cards (dose-3.86)**: `GET /playlists` returns `song_count` (LEFT JOIN aggregate); Playlists page shows “N songs” on each card.
- **Host badge on room cards (dose-4.87)**: Rooms list shows a “Host” badge on cards the current user hosts (matches host_id to user.id / userId).
- **Public/Private badge on room cards (dose-4.88)**: Rooms list shows a Public or Private badge from `room.is_public` beside Host/listener meta.
- **Empty now-playing in room detail (dose-4.89)**: When no track is loaded, room detail shows “Nothing playing” with host vs listener copy; host Play is disabled until a song is chosen; ListeningRoom.css is imported.
- **Room detail host check (dose-4.90)**: ListeningRoom `isHost` matches Rooms list — compares host_id to both `user.id` and `user.userId` (string-safe) so host controls and empty-state copy appear when the JWT payload uses either shape.
- **Room participants Host badge (dose-4.91)**: Single Host badge on roster rows when `p.id === hostId` (string-safe); removes accidental duplicate badge from 4.90.
- **Queue panel shuffle honesty (dose-1.92)**: When shuffle is on, queue header reads “Shuffled · Up next (N)” and a muted “play order differs” hint so the list is clearly display order, not the Fisher–Yates next/prev order.
- **Queue current-track badge when paused (dose-1.93)**: Queue row for `queueIndex` always shows a marker — ▶ while playing, ❚❚ while paused — so the active track stays visible after pause (previously only when `isPlaying`).
- **Empty queue how-to CTA (dose-1.94)**: Queue panel empty state no longer says only “Queue is empty”; it adds a hint to play a list from Home/playlist or use Add to queue on a song row.
- **Queue row duration (dose-1.95)**: Each queue row shows `song.duration` via `formatTime` when present (tabular muted label before the now-playing marker).
- **Queue total duration (dose-1.96)**: Queue header shows sum of known track durations (e.g. “Up next (12) · 48:32”) when any songs report duration; omitted if none known.
- **Queue remaining duration (dose-1.97)**: Queue header also shows time left from the current playhead through the end of the queue (current track remainder + known durations of later rows), e.g. “· 12:04 left”; updates as progress advances.
- **Play next insert (dose-1.98)**: `insertNext(song)` places a track immediately after the current `queueIndex` (and after the current shuffle position when shuffled). SongList has a Play next action with brief feedback; does not autoplay — only queues for the next advance.
- **PlayerContext re-restored (dose-1.100)**: full SPA player after accidental PLACEHOLDER overwrite on main
- **Duplicate-in-queue guard (dose-1.99)**: `addToQueue` and `insertNext` skip when `song.id` is already in the queue; SongList feedback shows “Already in queue” (not an error for UX, but not a success append).
- **Queue touch reorder (dose-1.101)**: Queue panel rows support touch drag-and-drop reorder (touchstart/move/end + elementFromPoint) in addition to HTML5 mouse drag and up/down buttons; prevents scroll while dragging.
- **Keyboard next/prev (dose-1.102)**: N advances with `playNext` (shuffle/repeat aware); P runs `playPrevious` (restart-if-past-3s threshold). Same handlers as media session / player buttons; ignored when focus is in inputs.

## Incident closed

PlayerContext was temporarily stubbed after a bad push. Restored from commit `9c026396` + `toggleMute` (dose-1.79). SPA player API is complete again.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video product, Demucs stems, pitch-shift DSP
- Full multi-device live queue sync over sockets (single-device hydrate/persist only)
- Server-persisted multi-track queue
- Telemetry/loudness/waveform
- Redis-backed multi-instance room presence (in-process map only)

## Incident note (dose-1.100)

PlayerContext was again replaced by `PLACEHOLDER_WILL_FAIL` on main (`1be3b46`). Restored full file from `4e5a6da` (duplicate-in-queue guard + insertNext + toggleMute + full queue API).

## Incident note (dose-1.102)

Brief PLACEHOLDER overwrite on main (`1752a0e`) during agent push; this commit restores docs; PlayerContext restored in same/follow-up commit.

## Next item

Dose 1 keyboard next/prev (N/P) shipped. Remaining: any seek-guard/race edge cases, Dose 2/4 leftovers. No Dose 6+.
