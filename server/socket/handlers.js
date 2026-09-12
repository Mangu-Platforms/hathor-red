const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { redisClient } = require('../config/redis');
const { logger } = require('../utils/logger');
const { MAX_CHAT_MESSAGE_LENGTH, VALID_ROOM_ACTIONS, REACTION_EMOJIS } = require('../config/constants');
const { buildRoomStatePayload } = require('../services/social/syncService');
const { toPositiveInt } = require('../utils/streamToken');
const { toNonNegInt } = require('../services/commerce/commerceService');

const activeUsers = new Map();
const roomHosts = new Map();
const roomPresence = new Map();

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

function getRoomPresenceCounts() {
  const out = {};
  for (const [roomId, members] of roomPresence.entries()) {
    out[roomId] = members.size;
  }
  return out;
}

function getRoomPresenceRoster(roomId) {
  const id = toPositiveInt(roomId);
  if (id == null) return [];
  return presenceRoster(id);
}

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
      `SELECT user_id FROM room_participants WHERE room_id = $1 AND user_id <> $2 ORDER BY joined_at ASC LIMIT 1`,
      [roomId, leavingUserId]
    );
    newHostId = participants.rows.length > 0 ? participants.rows[0].user_id : null;
  } else {
    const recheck = pickCandidate();
    if (recheck !== null) newHostId = recheck;
  }
  if (newHostId === null) return;
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
  if (!lastSocket) return;
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
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"')
    .replace(/'/g, '&#39;')
    .trim()
    .slice(0, MAX_CHAT_MESSAGE_LENGTH);
}

const setupSocketHandlers = (io) => {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      if (!process.env.JWT_SECRET) return next(new Error('Server misconfigured'));
      const decoded = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: 'hathor-music',
        clockTolerance: 60,
      });
      if (decoded.typ === 'stream') return next(new Error('Stream tokens cannot authenticate sockets'));
      const uid = toPositiveInt(decoded.userId ?? decoded.id);
      if (uid == null) return next(new Error('Authentication failed'));
      socket.userId = uid;
      socket.username = decoded.username || null;
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
        const roomIdNum = toPositiveInt(roomId);
        if (roomIdNum == null) return socket.emit('error', { message: 'Invalid room ID' });
        if (socket.currentRoom && socket.currentRoom !== roomIdNum) {
          const previousRoom = socket.currentRoom;
          socket.leave(`room-${previousRoom}`);
          socket.currentRoom = null;
          await departRoom(io, socket, previousRoom);
        }
        const roomResult = await db.query(ROOM_SELECT, [roomIdNum]);
        if (roomResult.rows.length === 0) return socket.emit('error', { message: 'Room not found' });
        const room = roomResult.rows[0];
        const countResult = await db.query(
          'SELECT COUNT(*) as count FROM room_participants WHERE room_id = $1',
          [roomIdNum]
        );
        // dose-1.64: participant count uses shared toNonNegInt (finite non-negative
        // integer; allow 0; reject NaN/negative/non-integer instead of raw parseInt).
        const participantCount = toNonNegInt(countResult.rows[0].count) ?? 0;
        if (participantCount >= room.max_listeners) {
          return socket.emit('error', { message: 'Room is full' });
        }
        await db.query(
          'INSERT INTO room_participants (room_id, user_id) VALUES ($1, $2) ON CONFLICT (room_id, user_id) DO NOTHING',
          [roomIdNum, socket.userId]
        );
        socket.join(`room-${roomIdNum}`);
        socket.currentRoom = roomIdNum;
        if (!roomHosts.has(roomIdNum)) roomHosts.set(roomIdNum, room.host_id);
        addPresence(roomIdNum, socket.userId, socket.username, socket.id);
        socket.to(`room-${roomIdNum}`).emit('user-joined', {
          userId: socket.userId,
          username: socket.username,
          roster: presenceRoster(roomIdNum),
          timestamp: Date.now(),
        });
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
        const roomIdNum = toPositiveInt(roomId);
        if (roomIdNum == null) return;
        if (socket.currentRoom !== roomIdNum) return;
        socket.leave(`room-${roomIdNum}`);
        socket.currentRoom = null;
        await departRoom(io, socket, roomIdNum);
      } catch (error) {
        logger.error('Leave room socket error:', error);
      }
    });

    socket.on('sync-ping', (data) => {
      if (!allowEvent(socket, 'sync-ping', 4)) return;
      socket.emit('sync-pong', {
        clientTime: data?.clientTime ?? null,
        serverTime: Date.now(),
      });
    });

    socket.on('request-room-state', async (roomId) => {
      try {
        const roomIdNum = toPositiveInt(roomId);
        if (roomIdNum == null) return;
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

    socket.on('room-reaction', (data) => {
      try {
        const { roomId, emoji } = data || {};
        const roomIdNum = toPositiveInt(roomId);
        if (roomIdNum == null) return;
        if (!REACTION_EMOJIS.includes(emoji)) return socket.emit('error', { message: 'Unsupported reaction' });
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

    const relayRtc = (eventName) => (data) => {
      try {
        const { roomId, targetUserId, payload } = data || {};
        const roomIdNum = toPositiveInt(roomId);
        const targetId = toPositiveInt(targetUserId);
        if (roomIdNum == null || targetId == null) return;
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
        const { roomId, action, songId, position } = data || {};
        if (!VALID_ROOM_ACTIONS.includes(action)) {
          return socket.emit('error', { message: `Invalid action. Allowed: ${VALID_ROOM_ACTIONS.join(', ')}` });
        }
        const roomIdNum = toPositiveInt(roomId);
        if (roomIdNum == null) return socket.emit('error', { message: 'Invalid room ID' });
        const cachedHost = roomHosts.get(roomIdNum);
        let hostId = cachedHost;
        if (hostId === undefined) {
          const roomResult = await db.query('SELECT host_id FROM listening_rooms WHERE id = $1', [roomIdNum]);
          if (roomResult.rows.length === 0) return socket.emit('error', { message: 'Room not found' });
          hostId = roomResult.rows[0].host_id;
          roomHosts.set(roomIdNum, hostId);
        }
        if (hostId !== socket.userId) return socket.emit('error', { message: 'Only the host can control playback' });
        const toBoundPos = (v) => {
          if (v == null) return 0;
          const n = Number(v);
          if (!Number.isFinite(n) || n < 0 || n > 7200) return null;
          return n;
        };
        let updateQuery = '';
        let params = [];
        let emitPosition = 0;
        let emitSongId = null;
        switch (action) {
          case 'play':
          case 'pause':
          case 'seek': {
            const pos = toBoundPos(position);
            if (pos === null) return socket.emit('error', { message: 'Invalid position' });
            emitPosition = pos;
            if (action === 'play') {
              updateQuery = 'UPDATE listening_rooms SET is_playing = true, current_position = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
            } else if (action === 'pause') {
              updateQuery = 'UPDATE listening_rooms SET is_playing = false, current_position = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
            } else {
              updateQuery = 'UPDATE listening_rooms SET current_position = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
            }
            params = [pos, roomIdNum];
            break;
          }
          case 'change-song': {
            const songIdNum = toPositiveInt(songId);
            if (songIdNum == null) return socket.emit('error', { message: 'Invalid song ID' });
            emitSongId = songIdNum;
            updateQuery = 'UPDATE listening_rooms SET current_song_id = $1, current_position = 0, is_playing = true, updated_at = CURRENT_TIMESTAMP WHERE id = $2';
            params = [songIdNum, roomIdNum];
            break;
          }
        }
        if (updateQuery) {
          await db.query(updateQuery, params);
          io.to(`room-${roomIdNum}`).emit('room-update', {
            action,
            songId: emitSongId,
            position: emitPosition,
            positionMs: emitPosition * 1000,
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
        const roomIdNum = toPositiveInt(roomId);
        if (roomIdNum == null) return;
        if (socket.currentRoom !== roomIdNum) return;
        if (!allowEvent(socket, 'chat', 3)) return socket.emit('error', { message: 'Slow down' });
        const sanitizedMessage = sanitizeChatMessage(message);
        if (!sanitizedMessage) return;
        io.to(`room-${roomIdNum}`).emit('room-chat', {
          userId: socket.userId,
          username: socket.username,
          message: sanitizedMessage,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error('Room chat error:', error);
      }
    });

    socket.on('sync-state', async (data) => {
      try {
        if (!allowEvent(socket, 'sync-state', 4)) return;
        const userId = socket.userId;
        if (!data || typeof data !== 'object') return;
        const currentSongId = data.currentSongId == null ? null : toPositiveInt(data.currentSongId);
        if (data.currentSongId != null && currentSongId == null) return;
        let position = null;
        if (data.position !== undefined) {
          const n = Number(data.position);
          if (!Number.isFinite(n) || n < 0 || n > 7200) return;
          position = n;
        }
        let volume = null;
        if (data.volume !== undefined) {
          const n = Number(data.volume);
          if (!Number.isFinite(n) || n < 0 || n > 1) return;
          volume = n;
        }
        let playbackSpeed = null;
        if (data.playbackSpeed !== undefined) {
          const n = Number(data.playbackSpeed);
          if (!Number.isFinite(n) || n < 0.25 || n > 4) return;
          playbackSpeed = n;
        }
        let isPlaying = null;
        if (data.isPlaying !== undefined) {
          if (typeof data.isPlaying !== 'boolean') return;
          isPlaying = data.isPlaying;
        }
        const result = await db.query(
          `INSERT INTO playback_state (user_id, current_song_id, position, is_playing, volume, playback_speed, updated_at)
           VALUES ($1, $2, COALESCE($3, 0), COALESCE($4, false), COALESCE($5, 1), COALESCE($6, 1), CURRENT_TIMESTAMP)
           ON CONFLICT (user_id) DO UPDATE SET
             current_song_id = COALESCE($2, playback_state.current_song_id),
             position = COALESCE($3, playback_state.position),
             is_playing = COALESCE($4, playback_state.is_playing),
             volume = COALESCE($5, playback_state.volume),
             playback_speed = COALESCE($6, playback_state.playback_speed),
             updated_at = CURRENT_TIMESTAMP
           RETURNING *`,
          [userId, currentSongId, position, isPlaying, volume, playbackSpeed]
        );
        const row = result.rows[0];
        if (redisClient?.isOpen) {
          await redisClient.setEx(`playback:${userId}`, 3600, JSON.stringify(row));
        }
      } catch (error) {
        logger.error('Sync state socket error:', error);
      }
    });

    socket.on('disconnect', async () => {
      activeUsers.delete(socket.userId);
      if (socket.currentRoom) {
        await departRoom(io, socket, socket.currentRoom, { announce: true });
        socket.currentRoom = null;
      }
    });
  });
};

module.exports = setupSocketHandlers;
module.exports.getRoomPresenceCounts = getRoomPresenceCounts;
module.exports.getRoomPresenceRoster = getRoomPresenceRoster;
