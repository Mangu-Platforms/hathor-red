# Hathor Music Platform - Feature Overview

## 🎯 Core Features

### 1. User Authentication & Profiles
**Description:** Secure user management with JWT-based authentication

**Features:**
- User registration with email validation
- Secure login with bcrypt password hashing
- JWT tokens with configurable expiration
- User profiles with display name and avatar
- Protected routes and API endpoints

**Technical Implementation:**
- Backend: `server/controllers/authController.js`
- Frontend: `client/src/contexts/AuthContext.js`
- Middleware: `server/middleware/auth.js`

**Usage:**
```javascript
// Register
POST /api/auth/register
{ username, email, password, displayName }

// Login
POST /api/auth/login
{ username, password }

// Get Profile
GET /api/auth/profile
Authorization: Bearer <token>
```

---

### 2. On-Demand Playback
**Description:** Stream music files with full playback controls

**Features:**
- Browse music library with search and genre filters
- Play, pause, resume controls
- Progress bar with seek functionality
- Volume control
- Current song display with metadata
- Listening history tracking
- Queue with shuffle (Fisher-Yates), repeat modes, reorder

**Technical Implementation:**
- Backend: `server/controllers/songController.js`
- Frontend: `client/src/components/MusicPlayer.js` + `client/src/contexts/PlayerContext.js`
- Service: `client/src/services/music.js`

**Supported Formats:**
- MP3, WAV, FLAC, M4A, OGG

**Usage:**
```javascript
// Get songs
GET /api/songs?search=rock&genre=Rock

// Mint signed stream URL then play in <audio>
GET /api/songs/:id/stream-url
GET /api/songs/:id/stream?t=<token>
```

---

### 3. Cross-Device Sync (hydrate / persist)
**Description:** Resume playback position and basic controls after re-login or refresh

**Features:**
- Playback state stored in Redis (hot) with Postgres fallback
- Client hydrates once after auth; debounced HTTP persist on song/play/volume/speed
- Socket `sync-state` path also writes Redis (same key/TTL as HTTP)

**What is NOT synced live today:** multi-device simultaneous control, full queue, pitch, or stems.

**Technical Implementation:**
- Backend: `server/controllers/playbackController.js`
- Redis: `server/config/redis.js`
- Frontend: `client/src/contexts/PlayerContext.js`
- Socket: `server/socket/handlers.js`

**Synced State (HTTP):**
- Current song id
- Playback position
- Play/pause state
- Volume level
- Playback speed

**Usage:**
```javascript
// Get state
GET /api/playback/state

// Update state
POST /api/playback/state
{ currentSongId, position, isPlaying, volume, playbackSpeed }
```

---

### 4. AI Playlist Generator
**Description:** Create personalized playlists from natural language prompts

**Features:**
- Natural language understanding when OpenAI/Colab is configured
- Rule-based fallback when AI is offline (`aiLive: false` on `/api/features`)
- Mood and genre heuristics
- Save and share playlists

**Technical Implementation:**
- Backend: `server/controllers/playlistController.js`
- Frontend: `client/src/components/AIPlaylistGenerator.js`

**Example Prompts:**
- "Upbeat workout songs with high energy"
- "Chill relaxing music for studying"

**Usage:**
```javascript
POST /api/playlists/generate-ai
{
  prompt: "Relaxing jazz for Sunday morning",
  name: "Sunday Jazz" // optional
}
```

---

### 5. Stem Separation — **does not ship**
**Status:** Not implemented in the live player audio graph.

UI controls for stems were removed. Do not document or demo as a shipping feature.
Production stem separation would require server-side models (e.g. Demucs) and pre-separated assets — none of that is wired to `<audio>` today.

---

### 6. Playback speed (ships); pitch shift — **does not ship**
**Description:** Adjust playback rate in real time via HTMLAudioElement.playbackRate

**Ships:**
- **Speed Control:** 0.5x to 2.0x

**Does not ship:**
- **Pitch Shift** independent of speed (no Web Audio pitch node in PlayerContext)

**Technical Implementation:**
- `client/src/contexts/PlayerContext.js` + speed slider in `MusicPlayer.js`

---

### 7. Digital Listening Rooms
**Description:** Listen to music together in real-time with friends

**Features:**
- Create public or private rooms
- Host controls (play, pause, seek, change song)
- Real-time playback synchronization via Socket.io
- Live chat functionality
- Participant list; disconnect cleans `room_participants`
- Listener counts refreshed on rooms list (poll)

**Technical Implementation:**
- Backend: `server/controllers/roomController.js`
- WebSocket: `server/socket/handlers.js`
- Frontend: `client/src/components/ListeningRoom.js`

---

## 🗄️ Database Schema

### Tables
- **users** - User accounts and profiles
- **songs** - Music library with metadata
- **playlists** - User-created and AI-generated playlists
- **playlist_songs** - Many-to-many relationship
- **listening_rooms** - Active listening rooms
- **room_participants** - Room membership
- **playback_states** - Cross-device sync state
- **listening_history** - User listening analytics

---

## 🔧 Technical Architecture

### Backend (Node.js + Express)
- RESTful API design
- JWT authentication + signed stream tokens for media
- PostgreSQL for data persistence
- Redis for caching and sessions
- Socket.io for real-time features
- Multer for file uploads

### Frontend (React 18 SPA)
- Context API for state management
- React Router for navigation
- Progressive `<audio>` streams (not HLS in the player UI)
- Socket.io client for rooms

---

## 🔒 Security Features

### Authentication
- Bcrypt password hashing
- JWT with expiration
- Short-lived stream tokens for `<audio src>`

### Media
- No public `/uploads` static mount; audio only via signed stream route
- Range requests for seek

---

## 🚀 Future Enhancement Ideas

- Server-side stem separation / pitch DSP if product prioritizes them
- HLS adaptive playback in the React player (transcode path exists; player uses progressive)
- OAuth providers after password path remains solid
- Multi-device live queue sync over sockets

---

## 📝 API Summary

### Authentication
- POST `/api/auth/register` - Create account
- POST `/api/auth/login` - User login
- GET `/api/auth/profile` - Get user profile
- PUT `/api/auth/profile` - Update profile

### Songs
- GET `/api/songs` - List songs
- GET `/api/songs/:id` - Get song details
- POST `/api/songs/upload` - Upload song
- GET `/api/songs/:id/stream-url` - Mint signed URL
- GET `/api/songs/:id/stream` - Stream audio (`?t=` or Bearer)
- POST `/api/songs/record-listening` - Track play

### Playlists
- GET `/api/playlists` - List playlists
- GET `/api/playlists/:id` - Get playlist
- POST `/api/playlists` - Create playlist
- POST `/api/playlists/add-song` - Add song
- POST `/api/playlists/generate-ai` - AI generate
- DELETE `/api/playlists/:id` - Delete playlist

### Playback
- GET `/api/playback/state` - Get state
- POST `/api/playback/state` - Update state

### Rooms
- GET `/api/rooms` - List rooms
- GET `/api/rooms/:id` - Get room
- POST `/api/rooms` - Create room
- POST `/api/rooms/:id/join` - Join room
- POST `/api/rooms/:id/leave` - Leave room
- DELETE `/api/rooms/:id` - Delete room

---

### Hardened Authenticated Media Streaming
**Description:** Playback uses short-lived signed stream URLs plus HTTP byte-range semantics.

**Features:**
- Short-lived stream tokens for `<audio src>` clients
- Stream endpoint supports either query token (`?t=`) or `Authorization: Bearer <jwt>`
- RFC-compatible `Range` support with `206 Partial Content`
- Safe file-path resolution to prevent path traversal
- Authenticated-only streaming (no public `/uploads` bypass)
- Stream-aware rate limiting

**Technical Implementation:**
- Token utility: `server/utils/streamToken.js`
- Stream auth middleware: `server/middleware/streamAuth.js`
- Range streaming controller: `server/controllers/songController.js`
- Frontend stream URL acquisition: `client/src/services/music.js`
