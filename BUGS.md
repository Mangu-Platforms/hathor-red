# Identified Bugs and Issues - Hathor Music Platform

This document lists identified bugs, security vulnerabilities, and architectural inconsistencies in the Hathor Music Platform.

## 🔴 Critical Severity

### 1. Playback Streaming Broken (Auth Mismatch)
*   **Description**: The `/api/songs/:id/stream` route uses `authMiddleware` which expects a JWT in the `Authorization` header. However, the frontend `PlayerContext.js` sets this URL directly to the `src` attribute of an HTML5 `<audio>` tag.
*   **Impact**: Browsers do not send custom headers (like `Authorization`) for `<audio>` tag source requests. This results in all streaming requests failing with a 401 Unauthorized error.
*   **Root Cause**: Mismatch between authentication requirements and browser media loading behavior.
*   **Suggested Fix**: Use a short-lived token in a query parameter for streaming, or use session cookies for the streaming endpoint.
*   **Status**: Mitigated on main via signed query-token stream URLs (`stream-url` + `streamAuth`). Re-verify if any client still points `<audio>` at a header-only route.

### 2. Playback State Sync Inconsistency
*   **Description**: The WebSocket `sync-state` handler in `server/socket/handlers.js` updates the PostgreSQL database but fails to update the Redis cache.
*   **Impact**: The `getPlaybackState` endpoint in `playbackController.js` prioritizes Redis data. If a user syncs state via one device (socket) and then requests state via another (HTTP), they will receive stale data from Redis.
*   **Root Cause**: Missing Redis cache invalidation/update in the socket handler.
*   **Suggested Fix**: Update the Redis key `playback:${userId}` whenever the state is synced via WebSockets.
*   **Status**: Fixed in dose-1.2 — socket handler upserts DB with `RETURNING *` and `setEx` Redis for 3600s (same key/TTL as HTTP path).

## 🟡 High Severity

### 3. Database Participant Leak
*   **Description**: When a user disconnects from a WebSocket (e.g., closing the tab), they are not removed from the `room_participants` table in the database.
*   **Impact**: The `listener_count` for rooms becomes inaccurate over time, showing users as "present" when they are no longer connected.
*   **Root Cause**: Disconnect handler in `server/socket/handlers.js` only emits a message but doesn't perform database cleanup.
*   **Suggested Fix**: Add a database query to the `disconnect` handler to remove the user from any active rooms they were in.
*   **Status**: Disconnect path calls `departRoom` which deletes from `room_participants` (verify under multi-tab).

### 4. Security Bypass on Audio Files
*   **Description**: The `/uploads` directory is served as static files via `express.static` in `server/index.js` without any authentication.
*   **Impact**: Although filenames are UUIDs, any user who knows or guesses a filename can access and download the raw audio files without being logged in, bypassing the intended protection on the `/api/songs/:id/stream` route.
*   **Root Cause**: Static file serving is not protected by middleware.
*   **Suggested Fix**: Remove the public static route for `/uploads` and exclusively use the authenticated stream endpoint (after fixing the auth mismatch).

## 🔵 Medium Severity

### 5. Unimplemented "Core" Features
*   **Description**: "Native Stem Separation" and "Pitch Shift" are listed as core features in `README.md`, but they are not actually implemented in the `PlayerContext.js`. The code contains comments stating these would require more complex implementation.
*   **Impact**: Misleading documentation and broken feature promises for users.
*   **Root Cause**: Placeholder code used for features that require significant implementation.
*   **Suggested Fix**: Implement the Web Audio API nodes for pitch shifting and use a library or pre-separated stems for the stem feature.
*   **Status**: UI controls hidden on main; do not re-list as shipping features.

### 6. Race Conditions in Resource Management
*   **Description**: Both `addSongToPlaylist` and `joinRoom` use a "check then act" pattern (counting existing items then inserting) which is not atomic.
*   **Impact**: Playlists can end up with duplicate positions, and rooms can exceed their `max_listeners` limit under concurrent load.
*   **Root Cause**: Non-atomic database operations.
*   **Suggested Fix**: Use SQL subqueries or transactions with appropriate isolation levels to ensure atomicity.

### 7. Inconsistent AI Playlist Generation Logic
*   **Description**: `playlistController.js` and `aiController.js` both contain logic for generating AI playlists, but they use different implementation patterns (batch insert vs. individual inserts in a loop).
*   **Impact**: Performance issues and maintenance difficulty due to code duplication.
*   **Root Cause**: Duplicated logic across different controllers.
*   **Suggested Fix**: Consolidate AI playlist generation into a single service or shared controller.

## ⚪ Low Severity / Code Quality

### 8. Frontend Hook Dependencies
*   **Description**: In `ListeningRoom.js` and `SongList.js`, asynchronous data-fetching functions are used inside `useEffect` but are not wrapped in `useCallback`.
*   **Impact**: Potential for unnecessary re-renders or infinite loops if dependencies are not managed correctly.
*   **Root Cause**: Deviation from React best practices for hook dependencies.
*   **Suggested Fix**: Wrap data-fetching functions in `useCallback`.

### 9. Potential NaN in Player Seek
*   **Description**: `Player.js` calculates seek position using `duration * percent`. If `duration` is not yet loaded (0 or NaN), this can pass invalid values to the `seek` function.
*   **Impact**: Console errors or unexpected playback behavior.
*   **Suggested Fix**: Add a check for `duration` before calling `seek`.
*   **Status**: MusicPlayer seek path guards finite duration; legacy Player.js still has pitch/stem placeholders.
