# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- Song list, upload, **signed progressive stream** for `<audio>` (`stream-url` + `streamAuth` query token)
- Player: load/play/pause, volume, speed, progress, queue next/prev, repeat modes
- Shuffle uses a Fisher-Yates permutation (not random-jump each skip)
- Seek rejects invalid duration / non-finite times
- Play after load awaits `audio.play()` (no fixed 100ms race)
- Pitch/stem UI **hidden** (not implemented on the audio graph); dead legacy `Player.js` re-exports `MusicPlayer`
- **Queue panel** on the player bar (list + jump via `playAtIndex` + **remove via `removeFromQueue`** + **reorder via up/down `moveInQueue` and native HTML5 drag-and-drop**; CSS styled)
- `GET /api/songs/genres` wired (controller was present; route was missing)
- **Home genre filter** passes `genre` query to `getSongs` and shows active filter + clear
- Soft logout: `auth:logout` / Sign Out clear user state without `window.location` hard reload (PrivateRoute navigates)
- Podcasts nav: honest coming-soon page; sidebar label **Podcasts (soon)**
- Rooms / playlists / AI endpoints present; behavior depends on DB seed + API keys
- Olympus modules mount when feature flags are on; degrade when OpenAI/worker missing
- Socket `sync-state` writes DB **and** Redis `playback:${userId}` (matches HTTP update path)
- **Settings profile**: display name form via existing `PUT /auth/profile`; shows username/email read-only; Sign out button
- **`/playlists`**: dedicated list page (not Home shell); cards link to `/playlists/:id`
- **Playlist detail**: loads `GET /playlists/:id`, shows tracks via SongList, Play All queues songs
- **Home My Playlists tab**: playlist cards are `Link`s to `/playlists/:id` (same detail route as sidebar entry)
- **Create playlist on `/playlists`**: New playlist form (name, optional description, public flag) via `POST /playlists`; navigates to detail on success
- **Delete playlist**: owner-only Delete on list cards and detail page; confirms then `DELETE /playlists/:id`; list removes card; detail navigates back to `/playlists`
- **Remove track from playlist**: owner-only on detail (`DELETE /playlists/:id/songs/:songId`); SongList remove button; local list updates
- **Rooms**: disconnect/leave cleans `room_participants` (refcounted multi-tab); host handoff; **host song picker** (lists catalog, emits `change-song`); listener count prefers live socket roster when present
- **Rooms list**: polls `GET /rooms` every 15s so DB `listener_count` stays fresher on the list page
- Sidebar **Settings** label (was mislabeled Privacy)
- **AI Chat / Recommendations**: play uses `setQueueAndPlay` (not a missing `playSong`); header shows live vs rule-based fallback from `GET /ai/status`
- **Radar**: distinguishes API/feature failure from empty listening history
- **Store / Library**: distinguish commerce 404 (flag off) from empty catalog / empty owned tracks
- **Semantic Search**: 404 when discovery flag off is explicit (not a generic "search failed")
- **Home Daily Mix**: reads `dailyMix.songs` from `GET /ai/daily-mix` (also tolerates flat `songs`)
- **Artist Hub**: distinguishes intel/commerce 404 (feature flag off) from empty plays/sales; full-page message when both pillars off
- **`GET /api/features`**: public snapshot of Olympus flags (media, commerce, discovery, social, intel, privacy, worker) for honest client labels
- **Sidebar nav honesty**: Search / Radar / Store / Library / Artist Hub are **omitted from the sidebar** when the matching FEATURE_* flag is off (routes remain for deep links; pages keep empty-state honesty). While `/api/features` is loading, items stay visible to avoid nav flash.

## This run changed

- **dose-1.3**: Queue panel supports **native HTML5 drag-and-drop** reorder (grip + row drag) in addition to existing up/down buttons; uses existing `moveInQueue`.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Avatar upload / email change from Settings (API supports avatarUrl only; no file picker yet)
- Rooms list still uses DB participant count (not in-memory socket roster); live roster only inside the room view
- Live LLM responses when Colab/OpenAI is not configured (rule-based fallback only)
- Commerce/discovery/store UX when `FEATURE_COMMERCE` / `FEATURE_DISCOVERY` are off (nav items hidden; deep-link pages still explain empty/404)

## Next item

Settings avatar file picker if product wants it; optional deep-link redirects when flags off.
