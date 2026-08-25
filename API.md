# Hathor Music Platform - API Documentation

## Base URL
```
http://localhost:5000/api
```

## Authentication
All protected endpoints require a JWT token in the Authorization header:
```
Authorization: Bearer <token>
```

---

## Authentication Endpoints

### Register User
**POST** `/auth/register`

**Body:**
```json
{
  "username": "string (required)",
  "email": "string (required)",
  "password": "string (required)",
  "displayName": "string (optional)"
}
```

**Response:**
```json
{
  "message": "User registered successfully",
  "token": "jwt_token",
  "user": {
    "id": 1,
    "username": "user123",
    "email": "user@example.com",
    "displayName": "User Name"
  }
}
```

### Login
**POST** `/auth/login`

**Body:**
```json
{
  "username": "string (required)",
  "password": "string (required)"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "jwt_token",
  "user": { /* user object */ }
}
```

### Get Profile
**GET** `/auth/profile` (Protected)

**Response:**
```json
{
  "user": {
    "id": 1,
    "username": "user123",
    "email": "user@example.com",
    "display_name": "User Name",
    "avatar_url": "https://...",
    "created_at": "2023-01-01T00:00:00.000Z"
  }
}
```

### Update Profile
**PUT** `/auth/profile` (Protected)

**Body:**
```json
{
  "displayName": "string (optional)",
  "avatarUrl": "string (optional)"
}
```

---

## Song Endpoints

### Get Songs
**GET** `/songs` (Protected)

**Query Parameters:**
- `search` - Search by title, artist, or album
- `genre` - Filter by genre
- `limit` - Number of results (default: 50)
- `offset` - Pagination offset (default: 0)

**Response:**
```json
{
  "songs": [
    {
      "id": 1,
      "title": "Song Title",
      "artist": "Artist Name",
      "album": "Album Name",
      "duration": 180,
      "file_path": "/uploads/song.mp3",
      "cover_url": "https://...",
      "genre": "Rock",
      "year": 2023,
      "uploaded_by": 1,
      "created_at": "2023-01-01T00:00:00.000Z"
    }
  ]
}
```

### Get Song by ID
**GET** `/songs/:id` (Protected)

### Upload Song
**POST** `/songs/upload` (Protected)

**Content-Type:** `multipart/form-data`

**Form Data:**
- `audio` - Audio file (required)
- `title` - Song title (required)
- `artist` - Artist name (required)
- `album` - Album name (optional)
- `duration` - Duration in seconds (required)
- `genre` - Genre (optional)
- `year` - Release year (optional)

### Stream Song
**GET** `/songs/:id/stream` (Protected)

Returns the audio file for streaming.

### Record Listening
**POST** `/songs/record-listening` (Protected)

**Body:**
```json
{
  "songId": 1,
  "duration": 180
}
```

---

## Playlist Endpoints

### Get Playlists
**GET** `/playlists` (Protected)

Returns user's playlists and public playlists.

### Get Playlist by ID
**GET** `/playlists/:id` (Protected)

**Response:**
```json
{
  "playlist": {
    "id": 1,
    "user_id": 1,
    "name": "My Playlist",
    "description": "Description",
    "is_ai_generated": false,
    "is_public": true,
    "created_at": "2023-01-01T00:00:00.000Z"
  },
  "songs": [/* array of songs */]
}
```

### Create Playlist
**POST** `/playlists` (Protected)

**Body:**
```json
{
  "name": "string (required)",
  "description": "string (optional)",
  "isPublic": "boolean (default: false)"
}
```

### Add Song to Playlist
**POST** `/playlists/add-song` (Protected)

**Body:**
```json
{
  "playlistId": 1,
  "songId": 1
}
```

### Generate AI Playlist
**POST** `/playlists/generate-ai` (Protected)

**Body:**
```json
{
  "prompt": "string (required) - Description of desired playlist",
  "name": "string (optional) - Custom playlist name"
}
```

**Response:**
```json
{
  "message": "AI playlist generated successfully",
  "playlist": {/* playlist object */},
  "songs": [/* array of selected songs */]
}
```

### Delete Playlist
**DELETE** `/playlists/:id` (Protected)

---

## Playback State Endpoints

### Get Playback State
**GET** `/playback/state` (Protected)

Returns current playback state for cross-device sync.

**Response:**
```json
{
  "state": {
    "user_id": 1,
    "current_song_id": 1,
    "position": 45,
    "is_playing": true,
    "volume": 0.8,
    "playback_speed": 1.0,
    "pitch_shift": 0,
    "stems_config": {
      "vocals": true,
      "drums": true,
      "bass": true,
      "other": true
    },
    "updated_at": "2023-01-01T00:00:00.000Z"
  }
}
```

### Update Playback State
**POST** `/playback/state` (Protected)

**Body:**
```json
{
  "currentSongId": 1,
  "position": 45,
  "isPlaying": true,
  "volume": 0.8,
  "playbackSpeed": 1.0,
  "pitchShift": 0,
  "stemsConfig": {
    "vocals": true,
    "drums": true,
    "bass": true,
    "other": true
  }
}
```

---

## Listening Room Endpoints

### Get Rooms
**GET** `/rooms` (Protected)

Returns all public listening rooms.

### Get Room by ID
**GET** `/rooms/:id` (Protected)

**Response:**
```json
{
  "room": {
    "id": 1,
    "name": "Room Name",
    "host_id": 1,
    "current_song_id": 1,
    "current_position": 45,
    "is_playing": true,
    "is_public": true,
    "max_listeners": 50,
    "created_at": "2023-01-01T00:00:00.000Z"
  },
  "participants": [
    {
      "id": 1,
      "username": "user123",
      "display_name": "User Name",
      "joined_at": "2023-01-01T00:00:00.000Z"
    }
  ]
}
```

### Create Room
**POST** `/rooms` (Protected)

**Body:**
```json
{
  "name": "string (required)",
  "isPublic": "boolean (default: true)",
  "maxListeners": "number (default: 50)"
}
```

### Join Room
**POST** `/rooms/:id/join` (Protected)

### Leave Room
**POST** `/rooms/:id/leave` (Protected)

### Delete Room
**DELETE** `/rooms/:id` (Protected)

Only the room host can delete a room.

---

## WebSocket Events (Socket.io)

### Connection
Connect with authentication token:
```javascript
const socket = io('http://localhost:5000', {
  auth: { token: 'jwt_token' }
});
```

### Events to Emit

#### join-room
Join a listening room
```javascript
socket.emit('join-room', roomId);
```

#### leave-room
Leave a listening room
```javascript
socket.emit('leave-room', roomId);
```

#### room-control (Host only)
Control playback in a room
```javascript
socket.emit('room-control', {
  roomId: 1,
  action: 'play' | 'pause' | 'seek' | 'change-song',
  songId: 1,  // for change-song action
  position: 45  // for play, pause, seek actions
});
```

#### room-chat
Send a chat message
```javascript
socket.emit('room-chat', {
  roomId: 1,
  message: 'Hello!'
});
```

#### sync-state
Sync playback state across devices
```javascript
socket.emit('sync-state', {
  currentSongId: 1,
  position: 45,
  isPlaying: true,
  volume: 0.8,
  playbackSpeed: 1.0,
  pitchShift: 0,
  stemsConfig: { /* ... */ }
});
```

### Events to Listen

#### room-state
Receive initial room state
```javascript
socket.on('room-state', (state) => {
  console.log(state);
});
```

#### room-update
Receive playback updates
```javascript
socket.on('room-update', (update) => {
  console.log(update);
});
```

#### user-joined
User joined the room
```javascript
socket.on('user-joined', (data) => {
  console.log(data.username, 'joined');
});
```

#### user-left
User left the room
```javascript
socket.on('user-left', (data) => {
  console.log(data.username, 'left');
});
```

#### chat-message
Receive chat messages
```javascript
socket.on('chat-message', (data) => {
  console.log(data.username, ':', data.message);
});
```

#### sync-{userId}
Receive sync updates for your other devices
```javascript
socket.on(`sync-${userId}`, (state) => {
  console.log('State synced from another device');
});
```

#### error
Receive error messages
```javascript
socket.on('error', (error) => {
  console.error(error.message);
});
```

---

## Error Responses

All endpoints return errors in this format:
```json
{
  "error": "Error message description"
}
```

Common HTTP status codes:
- `400` - Bad Request (missing or invalid parameters)
- `401` - Unauthorized (invalid or missing token)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `409` - Conflict (duplicate entry)
- `500` - Internal Server Error

---

# Project Olympus API (v3)

All routes below require `Authorization: Bearer <token>` unless noted. Each
group is feature-flagged (see `docs/olympus/runbook.md`).

## Media Pipeline — `/api/media`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/media/songs/:id/pipeline` | Asset + variant status, persisted ffmpeg commands (uploader/admin) |
| GET | `/media/songs/:id/waveform` | Waveform peaks + loudness (LUFS, true peak) for the player |
| GET | `/media/songs/:id/hls/master.m3u8` | HLS master playlist (stream token via `?t=` or Bearer); 404 body names the direct-stream fallback |
| GET | `/media/songs/:id/hls/:variantKey/:file` | HLS media playlist / segment (whitelisted names only) |
| POST | `/media/songs/:id/reprocess` | Re-queue transcoding (uploader/admin) → `202 {jobId}` |
| GET | `/media/jobs/:id` | Job status (creator/admin) |

## Commerce — `/api/commerce`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/commerce/products?songId&artistId` | Browse active products |
| POST | `/commerce/products` | Create product (own uploads only). Fixed or name-your-price with `minPriceCents` (0 allowed) |
| PUT | `/commerce/products/:id` | Update price/copy/active (owner/admin) |
| POST | `/commerce/checkout` | `{productId, amountCents?, idempotencyKey}` → charge, library grant, one-time download token. Replays return the original purchase |
| GET | `/commerce/library` | Owned tracks |
| POST | `/commerce/download-token` | Mint a fresh one-time download token for an owned song |
| GET | `/commerce/download/:token` | Redeem token (single-use, 7-day expiry) → original file. No JWT — the token is the credential |
| POST | `/commerce/tiers` | Create a fan-club tier (`perks` JSON, e.g. `{"earlyAccess": true}`) |
| GET | `/commerce/artists/:id/tiers` | An artist's active tiers |
| POST | `/commerce/subscribe` | `{tierId}` → charge first period, activate membership (one active per fan+artist) |
| POST | `/commerce/subscriptions/:id/cancel` | Cancel at period end |
| GET | `/commerce/subscriptions` | My memberships |
| GET | `/commerce/revenue` | My artist-share summary + recent entries (`?artistId` for admin) |
| PUT | `/commerce/songs/:id/early-access` | `{until}` ISO timestamp or null — gate streaming to fan-club members until then |

Money is integer cents everywhere; split is artist 80 / platform 20.

## Discovery — `/api/discovery`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/discovery/search?q=&limit=` | Semantic search: intent (genres/bpm/moods) + embedding + text + freshness blend, with per-result reasons |
| GET | `/discovery/radar?refresh=` | Mangu Radar personal mix (co-listening CF + taste centroid + freshness), cached |
| GET | `/discovery/similar/:id` | Embedding neighbors of a song |
| POST | `/discovery/reindex` | Admin: queue the embedding backfill |

## Social — `/api/social`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/social/songs/:id/comments?fromMs&toMs&limit` | Time-synced comments in a window |
| POST | `/social/songs/:id/comments` | `{body, timestampMs}` — drop a comment at a moment |
| DELETE | `/social/comments/:id` | Author/admin |

### Socket events added (Olympus M4)

`sync-ping`/`sync-pong` (clock offset), `request-room-state`, `room-reaction`
(whitelisted emoji), `rtc-offer`/`rtc-answer`/`rtc-ice` (co-presence-checked
signaling relay), `host-changed` (automatic host handoff). `room-state` and
`room-update` now carry `positionMs` + `serverTimeMs` for drift correction;
`user-joined`/`user-left` carry the presence roster.

## Artist Intelligence — `/api/intel`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/intel/events` | Batched player telemetry (≤100; types play/pause/seek/skip/complete/segment; `clientEventId` dedup) → `202 {accepted, rejected, deduplicated}` |
| GET | `/intel/overview?days=` | Plays, completes, skips, unique listeners, listen time, rates |
| GET | `/intel/top-tracks?days=&limit=` | Top tracks with skip rates |
| GET | `/intel/songs/:id/retention` | 10s-bucket retention curve, peak segment, skip hotspots (uploader/admin) |
| GET | `/intel/geography?days=` | Streams by country (CDN header attribution) |
| GET | `/intel/revenue-by-track` | Artist-share cents per song |

## Privacy — `/api/privacy`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/privacy/export` | Queue a GDPR export (72h SLA) → `202` |
| GET | `/privacy/export` | Latest export status + download URL when ready |
| GET | `/privacy/export/download/:token` | Download the JSON artifact (token is the credential, 72h validity) |
| POST | `/privacy/deletion-request` | Record an account deletion request |
| DELETE | `/privacy/deletion-request` | Cancel a pending request |
| GET | `/privacy/audit` | Your own audit trail |
