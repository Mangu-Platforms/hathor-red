# Identified Bugs and Issues - Hathor Music Platform

This document lists identified bugs, security vulnerabilities, and architectural inconsistencies in the Hathor Music Platform.

## 🔴 Critical Severity

### 1. Playback Streaming Broken (Auth Mismatch)
*   **Description**: The `/api/songs/:id/stream` route uses `authMiddleware` which expects a JWT in the `Authorization` header. However, the frontend `PlayerContext.js` sets this URL directly to the `src` attribute of an HTML5 `<audio>` tag.
*   **Impact**: Browsers do not send custom headers (like `Authorization`) for `<audio>` tag source requests. This results in all streaming requests failing with a 401 Unauthorized error.
*   **Root Cause**: Mismatch between authentication requirements and browser media loading behavior.
*   **Suggested Fix**: Use a short-lived token in a query parameter for streaming, or use session cookies for the streaming endpoint.
*   **Status**: Mitigated on main via signed query-token stream URLs (`stream-url` + `streamAuth`). Client `musicService.getStreamUrl` resolves absolute API origin when needed. Re-verify only if a client regresses to header-only stream paths.

### 2. Playback State Sync Inconsistency
*   **Description**: The WebSocket `sync-state` handler in `server/socket/handlers.js` updates the PostgreSQL database but fails to update the Redis cache.
*   **Impact**: The `getPlaybackState` endpoint in `playbackController.js` prioritizes Redis data. If a user syncs state via one device (socket) and then requests state via another (HTTP), they will receive stale data from Redis.
*   **Root Cause**: Missing Redis cache invalidation/update in the socket handler.
*   **Suggested Fix**: Update the Redis key `playback:${userId}` whenever the state is synced via WebSockets.
*   **Status**: Fixed in dose-1.2 — socket handler upserts DB with `RETURNING *` and `setEx` Redis for 3600s (same key/TTL as HTTP path). Multi-device live queue still does not ship (see WHAT_SHIPS).

## 🟡 High Severity

### 3. Database Participant Leak
*   **Description**: When a user disconnects from a WebSocket (e.g., closing the tab), they are not removed from the `room_participants` table in the database.
*   **Impact**: The `listener_count` for rooms becomes inaccurate over time, showing users as "present" when they are no longer connected.
*   **Root Cause**: Disconnect handler in `server/socket/handlers.js` only emits a message but doesn't perform database cleanup.
*   **Suggested Fix**: Add a database query to the `disconnect` handler to remove the user from any active rooms they were in.
*   **Status**: Disconnect path calls `departRoom` which deletes from `room_participants` (verify under multi-tab). Rooms list page polls every 15s (dose-4.1) so counts refresh without a full reload.

### 4. Security Bypass on Audio Files
*   **Description**: The `/uploads` directory is served as static files via `express.static` in `server/index.js` without any authentication.
*   **Impact**: Although filenames are UUIDs, any user who knows or guesses a filename can access and download the raw audio files without being logged in, bypassing the intended protection on the `/api/songs/:id/stream` route.
*   **Root Cause**: Static file serving is not protected by middleware.
*   **Suggested Fix**: Remove the public static route for `/uploads` and exclusively use the authenticated stream endpoint (after fixing the auth mismatch).
*   **Status**: Fixed — `server/index.js` no longer mounts `express.static` on `/uploads`; audio is served only via signed `stream` route + `resolveUploadPath`.

## 🔵 Medium Severity

### 5. Unimplemented "Core" Features
*   **Description**: "Native Stem Separation" and "Pitch Shift" are listed as core features in `README.md`, but they are not actually implemented in the `PlayerContext.js`. The code contains comments stating these would require more complex implementation.
*   **Impact**: Misleading documentation and broken feature promises for users.
*   **Root Cause**: Placeholder code used for features that require significant implementation.
*   **Suggested Fix**: Implement the Web Audio API nodes for pitch shifting and use a library or pre-separated stems for the stem feature.
*   **Status**: UI controls hidden on main; README and WHAT_SHIPS honest about non-shipping; do not re-list as shipping features.

### 6. Race Conditions in Resource Management
*   **Description**: Both `addSongToPlaylist` and `joinRoom` use a "check then act" pattern (counting existing items then inserting) which is not atomic.
*   **Impact**: Playlists can end up with duplicate positions, and rooms can exceed their `max_listeners` limit under concurrent load.
*   **Root Cause**: Non-atomic database operations.
*   **Suggested Fix**: Use SQL subqueries or transactions with appropriate isolation levels to ensure atomicity.
*   **Status**: Fixed in dose-3.1 — `addSongToPlaylist` uses a single INSERT with `MAX(position)+1` subquery; `joinRoom` inserts only when `COUNT(*) < max_listeners` in the same statement.

### 7. Inconsistent AI Playlist Generation Logic
*   **Description**: `playlistController.js` and `aiController.js` both contain logic for generating AI playlists, but they use different implementation patterns (batch insert vs. individual inserts in a loop).
*   **Impact**: Performance issues and maintenance difficulty due to code duplication.
*   **Root Cause**: Duplicated logic across different controllers.
*   **Suggested Fix**: Consolidate AI playlist generation into a single service or shared controller.
*   **Status**: Open — consolidation is non-blocking; both paths remain functional with fallbacks.

## ⚪ Low Severity / Code Quality

### 8. Frontend Hook Dependencies
*   **Description**: In `ListeningRoom.js` and `SongList.js`, asynchronous data-fetching functions are used inside `useEffect` but are not wrapped in `useCallback`.
*   **Impact**: Potential for unnecessary re-renders or infinite loops if dependencies are not managed correctly.
*   **Root Cause**: Deviation from React best practices for hook dependencies.
*   **Suggested Fix**: Wrap data-fetching functions in `useCallback`.
*   **Status**: Rooms.js fetch path now uses `useCallback` (dose-4.1). SongList / ListeningRoom may still lag — low priority.

### 9. Potential NaN in Player Seek
*   **Description**: Legacy seek paths calculated seek position using `duration * percent` without guarding finite duration.
*   **Impact**: Console errors or unexpected playback behavior when metadata has not loaded.
*   **Suggested Fix**: Guard finite duration before seek.
*   **Status**: Closed on main — MusicPlayer progress bar and PlayerContext `seek` clamp to finite duration (dose-1.104+). No separate `Player.js` in the SPA tree.
