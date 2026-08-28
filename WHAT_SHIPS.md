# WHAT_SHIPS

Snapshot of what the **main** branch actually does. Update every agent run.

## Works today

- Password register/login, JWT, profile GET/PUT
- **Change password** (`POST /api/auth/change-password`) from Settings: current + new (same strength rules as register); audit on success/fail
- Song list, upload, **signed progressive stream** for `<audio>` (`stream-url` + `streamAuth` query token)
- **Stream URL resolution**: when `REACT_APP_API_URL` is absolute, client rewrites relative `/api/songs/…/stream?t=` to the API origin so `<audio>` does not hit the SPA host
- **CSP `mediaSrc`**: allows `'self'` + `blob:` always; in non-production (or `CSP_RELAX_MEDIA=1`) also `http:`/`https:` plus localhost API/client origins so split-origin dev playback is not blocked by Helmet; production same-origin still tight
- **`GET /api/songs/mine`**: current user’s uploads (id, title, artist, …) for Artist Hub pipeline list when intel/commerce analytics are empty
- Player: load/play/pause, volume, speed, progress, queue next/prev, repeat modes
- Shuffle uses a Fisher-Yates permutation (not random-jump each skip)
- **Shuffle + repeat none**: natural end of the last track in the permutation **stops** (does not wrap forever); `repeat all` still loops; manual Next still advances/wraps
- **Preload next**: opportunistic stream-url fetch uses the **next index in the shuffle permutation** when shuffle is on (not `queue[i+1]` sequential); sequential when shuffle is off; re-warm on shuffle toggle
- Seek rejects invalid duration / non-finite times
- Play after load awaits `audio.play()` (no fixed 100ms race)
- Pitch/stem UI **hidden** (not implemented on the audio graph); dead legacy `Player.js` re-exports `MusicPlayer`
- **Queue panel** on the player bar (list + jump via `playAtIndex` + **remove via `removeFromQueue`** + **reorder via up/down `moveInQueue` and native HTML5 drag-and-drop**; CSS styled)
- **`addToQueue`**: append one or more songs to the end of the queue without stopping current playback; SongList has “Add to queue” action
- `GET /api/songs/genres` wired (controller was present; route was missing)
- **Home genre filter** passes `genre` query to `getSongs` and shows active filter + clear
- Soft logout: `auth:logout` / Sign Out clear user state without `window.location` hard reload (PrivateRoute navigates)
- Podcasts nav: honest coming-soon page; sidebar label **Podcasts (soon)**
- Rooms / playlists / AI endpoints present; behavior depends on DB seed + API keys
- Olympus modules mount when feature flags are on; degrade when OpenAI/worker missing
- Socket `sync-state` writes DB **and** Redis `playback:${userId}` (matches HTTP update path)
- **Settings profile**: display name form via existing `PUT /auth/profile`; shows username/email read-only; Sign out button; **avatar URL** field (http/https) via same PUT (`avatarUrl`); **empty avatar URL clears** `avatar_url` (no longer stuck via COALESCE); preview in Settings
- **Sidebar avatar**: when `avatar_url` / `avatarUrl` is set, footer shows the image (object-fit cover); on load error falls back to initial letter
- **`/playlists`**: dedicated list page (not Home shell); cards link to `/playlists/:id`
- **Playlist detail**: loads `GET /playlists/:id`, shows tracks via SongList, Play All queues songs
- **Home My Playlists tab**: playlist cards are `Link`s to `/playlists/:id` (same detail route as sidebar entry)
- **Create playlist on `/playlists`**: New playlist form (name, optional description, public flag) via `POST /playlists`; navigates to detail on success
- **Delete playlist**: owner-only Delete on list cards and detail page; confirms then `DELETE /playlists/:id`; list removes card; detail navigates back to `/playlists`
- **Remove track from playlist**: owner-only on detail (`DELETE /playlists/:id/songs/:songId`); SongList remove button; local list updates; **positions renumbered 1..N after remove**
- **Reorder playlist tracks**: owner-only `PUT /playlists/:id/reorder` with full `songIds` order; PlaylistDetail ▲/▼ controls **and native HTML5 drag-and-drop** (grip + drop target outline); validates membership set equality
- **Add song to playlist**: position assigned in one SQL statement (`MAX(position)+1` subquery) so concurrent adds do not collide on position
- **Rooms join**: capacity check is part of the insert (`WHERE count < max_listeners`) so concurrent joins cannot overrun `max_listeners`
- **Rooms**: disconnect/leave cleans `room_participants` (refcounted multi-tab); host handoff; **host song picker** (lists catalog, emits `change-song`); listener count prefers live socket roster when present
- **Rooms list**: polls `GET /rooms` every 15s so DB `listener_count` stays fresher on the list page
- Sidebar **Settings** label (was mislabeled Privacy)
- **AI Chat / Recommendations**: play uses `setQueueAndPlay` (not a missing `playSong`); header shows live vs rule-based fallback from `GET /ai/status`
- **Radar**: distinguishes API/feature failure from empty listening history
- **Store / Library**: distinguish commerce 404 (flag off) from empty catalog / empty owned tracks
- **Semantic Search**: 404 when discovery flag off is explicit (not a generic "search failed")
- **Home Daily Mix**: reads `dailyMix.songs` from `GET /ai/daily-mix` (also tolerates flat `songs`)
- **Artist Hub**: distinguishes intel/commerce 404 (feature flag off) from empty plays/sales; full-page message when both pillars off; **media/worker honesty banner** from `getFeatures()` when media off, worker flag off, or `workerLive` false (transcode/reprocess may stall)
- **Artist Hub upload**: form posts multipart to existing `POST /api/songs/upload`; shows pipeline queue status and warns when worker is off or not live; **client validation** (required title/artist, max 50 MB, audio-ish MIME/extension, title/artist length)
- **Artist Hub media pipeline panel**: lists owned tracks from **`GET /api/songs/mine`** first, then merges top-tracks / revenue-by-track / recent job-tracked uploads; **Refresh** calls `GET /api/media/songs/:id/pipeline`; **Reprocess** calls `POST .../reprocess`; **job status poll** via `GET /api/media/jobs/:id` every 4s after upload/reprocess (or manual Poll job) until completed/failed/dead or ~3 min; then refreshes pipeline
- **`GET /api/features`**: public snapshot of Olympus flags (media, commerce, discovery, social, intel, privacy, worker) **plus `aiLive`** (true only when Colab/OpenAI initialized; false = rule-based fallback) **and `workerLive`** (true only when FEATURE_WORKER on **and** in-process job worker `startedOk`)
- **`GET /api/health`**: DB + Redis checks; **`checks.worker`** reports `disabled` | `healthy` | `not_running` (enabled flag, startedOk, running, handler names). Worker not running does **not** force overall 503 (API still serves).
- **Settings Platform status**: shows worker / AI / privacy / media honesty chips from `getFeatures()`; **plus API health badge** from `GET /api/health` (overall status, DB, Redis, worker check); GDPR export copy notes when worker is off or not running
- **Media pipeline API honesty**: `POST .../reprocess`, `GET .../pipeline`, `GET .../jobs/:id`, and waveform-not-ready responses include `workerEnabled` / `workerLive` (and `warning` when the worker will not process the queue)
- **Sidebar nav honesty**: Search / Radar / Store / Library / Artist Hub are **omitted from the sidebar** when the matching FEATURE_* flag is off (routes remain for deep links; pages keep empty-state honesty). While `/api/features` is loading, items stay visible to avoid nav flash.
- **Deep-link feature gates**: `/search` and `/radar` require discovery; `/store` and `/library` require commerce; `/dashboard` requires intel **or** commerce. When the flag is explicitly off, `FeatureRoute` redirects to `/` (Home). While flags are loading, the page still renders (no flash).
- **SongList play under filter**: playing a row queues the **visible (filtered) list** from that index (no longer maps filtered index onto the full unfiltered array). Add-to-playlist shows brief success/error feedback.
- **AI Recommendations UI**: same live vs rule-based status label as AI Chat (`GET /ai/status`)

## This run changed

- **dose-1.11**: Player preload of the next stream URL follows the Fisher-Yates shuffle permutation when shuffle is on (previously always preloaded `queue[i+1]`). Re-warm on shuffle toggle.

## Does not ship (honest)

- OAuth, HLS in the React player, WebRTC video, Demucs stems, pitch-shift DSP
- Avatar **file** upload from Settings (URL-only; no multipart avatar route)
- Email change from Settings
- Rooms list still uses DB participant count (not in-memory socket roster); live roster only inside the room view
- Live LLM responses when Colab/OpenAI is not configured (rule-based fallback only)
- Commerce/discovery/store UX when `FEATURE_COMMERCE` / `FEATURE_DISCOVERY` are off (nav items hidden; deep links now redirect Home)
- Background job processing when `FEATURE_WORKER=false` or worker fails to start (`workerLive` false)
- Dedicated upload **page** (upload lives on Artist Hub only; no separate route)

## Next item

Residual Dose 1 polish only if a concrete gap appears; otherwise Dose 2 account basics already largely shipped — verify any remaining Settings/profile gaps (no Dose 6+).
