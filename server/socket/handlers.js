const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { redisClient } = require('../config/redis');
const { logger } = require('../utils/logger');
const { MAX_CHAT_MESSAGE_LENGTH, VALID_ROOM_ACTIONS, REACTION_EMOJIS } = require('../config/constants');
const { buildRoomStatePayload } = require('../services/social/syncService');

const activeUsers = new Map();
const roomHosts = new Map();

// In-memory presence per room: roomId -> Map<userId, { username, joinedAt,
// sockets:Set<socketId> }>. Socket-refcounted so a user with two tabs stays
// present until the LAST connection leaves. Single-instance state; a
// Redis-backed presence set is the multi-instance extraction seam.
const roomPresence = new Map();

// Rooms are fetched with a DB-computed elapsed so sync math never depends on
// app/DB clock or timezone agreement (see services/social/syncService.js).
const ROOM_SELECT = `SELECT *,
  (EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - updated_at)) * 1000)::bigint AS elapsed_ms
  FROM listening_rooms WHERE id = $1`;

function presenceRoster(roomId) {
  const members = roomPresence.get(roomId);
  if (!members) return [];
  return Array.from(members.entries()).map(([userId, info]) => ({
    userId,
    username: info.username,
    joinedAt: info.joinedAt,
  }));
}

function addPresence(roomId, userId, username, socketId) {
  if (!roomPresence.has(roomId)) roomPresence.set(roomId, new Map());
  const members = roomPresence.get(roomId);
  const existing = members.get(userId);
  if (existing) {
    existing.sockets.add(socketId);
    return;
  }
  members.set(userId, { username, joinedAt: Date.now(), sockets: new Set([socketId]) });
}

/** Returns true when this was the user's LAST socket in the room. */
function removePresence(roomId, userId, socketId) {
  const members = roomPresence.get(roomId);
  if (!members) return true;
  const entry = members.get(userId);
  if (!entry) return true;
  entry.sockets.delete(socketId);
  if (entry.sockets.size > 0) return false;
  members.delete(userId);
  if (members.size === 0) roomPresence.delete(roomId);
  return true;
}

// Lightweight per-socket event throttle: `max` events per rolling second.
// Protects fan-out (chat/reactions to up to 100 clients) and per-event DB
// writes from a hostile or broken client; REST routes have express-rate-limit,
// sockets get this.
function allowEvent(socket, eventKey, max) {
  if (!socket._eventBuckets) socket._eventBuckets = new Map();
  const now = Date.now();
  const bucket = socket._eventBuckets.get(eventKey);
  if (!bucket || now - bucket.windowStart >= 1000) {
    socket._eventBuckets.set(eventKey, { windowStart: now, count: 1 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}

/**
 * When the host leaves, promote the longest-present remaining member so the
 * room keeps working. Falls back to the DB participant list when presence is
 * empty (e.g. after a restart).
 */
async function handleHostHandoff(io, roomId, leavingUserId) {
  const hostId = roomHosts.get(roomId);
  if (hostId !== undefined && hostId !== leavingUserId) return;

  if (hostId === undefined) {
    const roomResult = await db.query('SELECT host_id FROM listening_rooms WHERE id = $1', [roomId]);
    if (roomResult.rows.length === 0 || roomResult.rows[0].host_id !== leavingUserId) return;
  }

  const pickCandidate = () => {
    const roster = presenceRoster(roomId)
      .filter((m) => m.userId !== leavingUserId)
      .sort((a, b) => a.joinedAt - b.joinedAt);
    return roster.length > 0 ? roster[0].userId : null;
  };

  let newHostId = pickCandidate();
  if (newHostId === null) {
    const participants = await db.query(
      `SELECT user_id FROM room_participants
       WHERE room_id = $1 AND user_id <> $2
       ORDER BY joined_at ASC LIMIT 1`,
      [roomId, leavingUserId]
    );
    newHostId = participants.rows.length > 0 ? participants.rows[0].user_id : null;
  } else {
    // The candidate may itself have left during our awaits — re-pick from the
    // live presence map (synchronous read) right before committing.
    const recheck = pickCandidate();
    if (recheck !== null) newHostId = recheck;
  }

  if (newHostId === null) {
    // Room is empty; keep the host as-is so a returning host resumes control.
    return;
  }

  await db.query(
    'UPDATE listening_rooms SET host_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
    [newHostId, roomId]
  );
  roomHosts.set(roomId, newHostId);

  const newHost = presenceRoster(roomId).find((m) => m.userId === newHostId);
  io.to(`room-${roomId}`).emit('host-changed', {
    roomId,
    newHostId,
    newHostUsername: newHost ? newHost.username : null,
    timestamp: Date.now(),
  });
  logger.info({ action: 'host_handoff', roomId, from: leavingUserId, to: newHostId });
}

async function departRoom(io, socket, roomId, { announce = true } = {}) {
  const lastSocket = removePresence(roomId, socket.userId, socket.id);
  if (!lastSocket) {
    // Another tab of the same user is still in the room — nothing to announce.
    return;
  }
  try {
    await db.query('DELETE FROM room_participants WHERE room_id = $1 AND user_id = $2', [roomId, socket.userId]);
  } catch (err) {
    logger.warn(`Participant cleanup failed for room ${roomId}: ${err.message}`);
  }
  if (announce) {
    socket.to(`room-${roomId}`).emit('user-left', {
      userId: socket.userId,
      username: socket.username,
      roster: presenceRoster(roomId),
      timestamp: Date.now(),
    });
  }
  await handleHostHandoff(io, roomId, socket.userId);
}

function sanitizeChatMessage(message) {
  return String(message || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .trim()
    .slice(0, MAX_CHAT_MESSAGE_LENGTH);
}

const setupSocketHandlers = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      if (!process.env.JWT_SECRET) {
        return next(new Error('Server misconfigured'));
      }
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: 'hathor-music',
        clockTolerance: 60,
      });
      socket.userId = decoded.userId;
      socket.username = decoded.username;
      next();
    } catch (err) {
      next(new Error('Authentication failed'));
    }
  });

  io.on('connection', (socket) => {
    activeUsers.set(socket.userId, { socketId: socket.id, username: socket.username, joinedAt: Date.now() });
    socket.join(`user-${socket.userId}`);

    socket.on('join-room', async (roomId) => {
      try {
        const roomIdNum = parseInt(roomId, 10);
        if (isNaN(roomIdNum) || roomIdNum < 1) {
          return socket.emit('error', { message: 'Invalid room ID' });
        }

        // A socket lives in at most one room: joining a new one departs the
        // old one first, so no presence/subscription ghost is left behind.
        if (socket.currentRoom && socket.currentRoom !== roomIdNum) {
          const previousRoom = socket.currentRoom;
          socket.leave(`room-${previousRoom}`);
          socket.currentRoom = null;
          await departRoom(io, socket, previousRoom);
        }

        const roomResult = await db.query(ROOM_SELECT, [roomIdNum]);
        if (roomResult.rows.length === 0) {
          return socket.emit('error', { message: 'Room not found' });
        }

        const room = roomResult.rows[0];

        const countResult = await db.query(
          'SELECT COUNT(*) as count FROM room_participants WHERE room_id = $1',
          [roomIdNum]
        );
        if (parseInt(countResult.rows[0].count, 10) >= room.max_listeners) {
          return socket.emit('error', { message: 'Room is full' });
        }

        await db.query(
          'INSERT INTO room_participants (room_id, user_id) VALUES ($1, $2) ON CONFLICT (room_id, user_id) DO NOTHING',
          [roomIdNum, socket.userId]
        );

        socket.join(`room-${roomIdNum}`);
        socket.currentRoom = roomIdNum;
        // Seed the host cache only when cold: a concurrent handoff may have
        // updated it while our reads above were in flight, and the handoff's
        // value is fresher than our row snapshot.
        if (!roomHosts.has(roomIdNum)) {
          roomHosts.set(roomIdNum, room.host_id);
        }
        addPresence(roomIdNum, socket.userId, socket.username, socket.id);

        socket.to(`room-${roomIdNum}`).emit('user-joined', {
          userId: socket.userId,
          username: socket.username,
          roster: presenceRoster(roomIdNum),
          timestamp: Date.now(),
        });

        // Drift-corrected sync payload: position is derived from the room row
        // plus elapsed wall-clock; clients correct with their sync-ping offset.
        socket.emit('room-state', {
          ...buildRoomStatePayload(room),
          hostId: room.host_id,
          roster: presenceRoster(roomIdNum),
        });
      } catch (error) {
        logger.error('Join room socket error:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    socket.on('leave-room', async (roomId) => {
      try {
        const roomIdNum = parseInt(roomId, 10);
        if (isNaN(roomIdNum) || roomIdNum < 1) return;
        // Only a room this socket actually joined can be left — otherwise any
        // client could fabricate user-left announcements and trigger handoffs
        // in rooms it never entered.
        if (socket.currentRoom !== roomIdNum) return;
        socket.leave(`room-${roomIdNum}`);
        socket.currentRoom = null;
        await departRoom(io, socket, roomIdNum);
      } catch (error) {
        logger.error('Leave room socket error:', error);
      }
    });

    // NTP-style clock sync: reply instantly with both timestamps so the
    // client can estimate its offset (see services/social/syncService.js).
    socket.on('sync-ping', (data) => {
      if (!allowEvent(socket, 'sync-ping', 4)) return;
      socket.emit('sync-pong', {
        clientTime: data?.clientTime ?? null,
        serverTime: Date.now(),
      });
    });

    // Fresh sync snapshot on demand (e.g. after tab refocus). Members only —
    // room state, hostId, and the roster are for people in the room.
    socket.on('request-room-state', async (roomId) => {
      try {
        const roomIdNum = parseInt(roomId, 10);
        if (isNaN(roomIdNum) || roomIdNum < 1) return;
        if (socket.currentRoom !== roomIdNum) return;
        if (!allowEvent(socket, 'room-state', 4)) return;
        const roomResult = await db.query(ROOM_SELECT, [roomIdNum]);
        if (roomResult.rows.length === 0) return;
        socket.emit('room-state', {
          ...buildRoomStatePayload(roomResult.rows[0]),
          hostId: roomResult.rows[0].host_id,
          roster: presenceRoster(roomIdNum),
        });
      } catch (error) {
        logger.error('Request room state error:', error);
      }
    });

    // Live reactions: whitelisted emoji fan out to the room, ephemeral by design.
    socket.on('room-reaction', (data) => {
      try {
        const { roomId, emoji } = data || {};
        const roomIdNum = parseInt(roomId, 10);
        if (isNaN(roomIdNum) || roomIdNum < 1) return;
        if (!REACTION_EMOJIS.includes(emoji)) {
          return socket.emit('error', { message: 'Unsupported reaction' });
        }
        if (socket.currentRoom !== roomIdNum) return;
        if (!allowEvent(socket, 'reaction', 6)) return;
        io.to(`room-${roomIdNum}`).emit('room-reaction', {
          userId: socket.userId,
          username: socket.username,
          emoji,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error('Room reaction error:', error);
      }
    });

    // WebRTC signaling relay for in-room voice chat: offers/answers/ICE are
    // relayed peer-to-peer through the user room, never broadcast. Both ends
    // must be present in the same listening room. The SFU for larger rooms is
    // a documented upgrade seam.
    const relayRtc = (eventName) => (data) => {
      try {
        const { roomId, targetUserId, payload } = data || {};
        const roomIdNum = parseInt(roomId, 10);
        const targetId = parseInt(targetUserId, 10);
        if (isNaN(roomIdNum) || isNaN(targetId)) return;
        if (socket.currentRoom !== roomIdNum) return;
        if (!allowEvent(socket, 'rtc', 30)) return;
        const members = roomPresence.get(roomIdNum);
        if (!members || !members.has(targetId)) return;
        socket.to(`user-${targetId}`).emit(eventName, {
          roomId: roomIdNum,
          fromUserId: socket.userId,
          fromUsername: socket.username,
          payload,
        });
      } catch (error) {
        logger.error(`${eventName} relay error:`, error);
      }
    };
    socket.on('rtc-offer', relayRtc('rtc-offer'));
    socket.on('rtc-answer', relayRtc('rtc-answer'));
    socket.on('rtc-ice', relayRtc('rtc-ice'));

    socket.on('room-control', async (data) => {
      try {
        const { roomId, action, songId, position } = data;

        if (!VALID_ROOM_ACTIONS.includes(action)) {
          return socket.emit('error', { message: `Invalid action. Allowed: ${VALID_ROOM_ACTIONS.join(', ')}` });
        }

        const roomIdNum = parseInt(roomId, 10);
        if (isNaN(roomIdNum) || roomIdNum < 1) {
          return socket.emit('error', { message: 'Invalid room ID' });
        }

        const cachedHost = roomHosts.get(roomIdNum);
        let hostId = cachedHost;

        if (hostId === undefined) {
          const roomResult = await db.query('SELECT host_id FROM listening_rooms WHERE id = $1', [roomIdNum]);
          if (roomResult.rows.length === 0) {
            return socket.emit('error', { message: 'Room not found' });
          }
          hostId = roomResult.rows[0].host_id;
          roomHosts.set(roomIdNum, hostId);
        }

        if (hostId !== socket.userId) {
          return socket.emit('error', { message: 'Only the host can control playback' });
        }

        let updateQuery = '';
        let params = [];

        switch (action) {
          case 'play':
            updateQuery = 'UPDATE listening_rooms SET is_playing = true, current_position = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
            params = [Math.max(0, parseInt(position) || 0), roomIdNum];
            break;
          case 'pause':
            updateQuery = 'UPDATE listening_rooms SET is_playing = false, current_position = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
            params = [Math.max(0, parseInt(position) || 0), roomIdNum];
            break;
          case 'seek':
            updateQuery = 'UPDATE listening_rooms SET current_position = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
            params = [Math.max(0, parseInt(position) || 0), roomIdNum];
            break;
          case 'change-song':
            const songIdNum = parseInt(songId, 10);
            if (isNaN(songIdNum) || songIdNum < 1) {
              return socket.emit('error', { message: 'Invalid song ID' });
            }
            updateQuery = 'UPDATE listening_rooms SET current_song_id = $1, current_position = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
            params = [songIdNum, roomIdNum];
            break;
        }

        if (updateQuery) {
          await db.query(updateQuery, params);
          io.to(`room-${roomIdNum}`).emit('room-update', {
            action,
            songId: songId ? parseInt(songId, 10) : null,
            position: parseInt(position) || 0,
            positionMs: (Math.max(0, parseInt(position) || 0)) * 1000,
            serverTimeMs: Date.now(),
            timestamp: Date.now(),
            controlledBy: socket.username,
          });
        }
      } catch (error) {
        logger.error('Room control socket error:', error);
        socket.emit('error', { message: 'Failed to control playback' });
      }
    });

    socket.on('room-chat', async (data) => {
      try {
        const { roomId, message } = data;
        const roomIdNum = parseInt(roomId, 10);
        if (isNaN(roomIdNum) || roomIdNum < 1) return;
        // Members only — same guard the reaction and RTC handlers enforce.
        if (socket.currentRoom !== roomIdNum) return;
        if (!allowEvent(socket, 'chat', 3)) {
          return socket.emit('error', { message: 'Slow down' });
        }
        const sanitizedMessage = sanitizeChatMessage(message);
        if (!sanitizedMessage) return;

        io.to(`room-${roomIdNum}`).emit('chat-message', {
          userId: socket.userId,
          username: socket.username,
          message: sanitizedMessage,
          timestamp: Date.now(),
        });

        // Persist best-effort so room history survives reconnects; delivery
        // above must not depend on the write.
        try {
          await db.query(
            'INSERT INTO chat_messages (room_id, user_id, message) VALUES ($1, $2, $3)',
            [roomIdNum, socket.userId, sanitizedMessage]
          );
        } catch (persistErr) {
          logger.warn(`Chat persistence failed (message still delivered): ${persistErr.message}`);
        }
      } catch (error) {
        logger.error('Room chat socket error:', error);
      }
    });

    socket.on('sync-state', async (state) => {
      try {
        const result = await db.query(
          `INSERT INTO playback_states (user_id, current_song_id, position, is_playing, volume, playback_speed, pitch_shift, stems_config)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id) DO UPDATE SET
             current_song_id = $2, position = $3, is_playing = $4,
             volume = $5, playback_speed = $6, pitch_shift = $7, stems_config = $8,
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [
            socket.userId,
            state.currentSongId,
            state.position,
            state.isPlaying,
            state.volume,
            state.playbackSpeed,
            state.pitchShift,
            state.stemsConfig,
          ]
        );

        // Keep Redis in sync with DB so getPlaybackState does not serve stale cache
        const row = result.rows[0];
        if (row) {
          const cacheKey = `playback:${socket.userId}`;
          try {
            await redisClient.setEx(cacheKey, 3600, JSON.stringify(row));
          } catch (redisErr) {
            logger.warn(`Redis setEx after sync-state failed (DB updated): ${redisErr.message}`);
          }
        }

        socket.to(`user-${socket.userId}`).emit('sync-state', state);
      } catch (error) {
        logger.error('Sync state socket error:', error);
      }
    });

    socket.on('typing', (data) => {
      const roomIdNum = parseInt(data?.roomId, 10);
      if (isNaN(roomIdNum) || socket.currentRoom !== roomIdNum) return;
      if (!allowEvent(socket, 'typing', 5)) return;
      socket.to(`room-${roomIdNum}`).emit('user-typing', {
        userId: socket.userId,
        username: socket.username,
      });
    });

    socket.on('disconnect', async () => {
      activeUsers.delete(socket.userId);

      if (socket.currentRoom) {
        try {
          await departRoom(io, socket, socket.currentRoom);
        } catch (error) {
          logger.error('Disconnect room cleanup error:', error);
        }
      }
    });
  });
};

/** Test hook: clear module-level presence/host/user state between suites. */
setupSocketHandlers.resetStateForTests = () => {
  activeUsers.clear();
  roomHosts.clear();
  roomPresence.clear();
};

module.exports = setupSocketHandlers;
