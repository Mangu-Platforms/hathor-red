const jwt = require('jsonwebtoken');
const db = require('../config/database');
const { logger } = require('../utils/logger');
const { MAX_CHAT_MESSAGE_LENGTH, VALID_ROOM_ACTIONS } = require('../config/constants');

const activeUsers = new Map();
const roomHosts = new Map();

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

        const roomResult = await db.query('SELECT * FROM listening_rooms WHERE id = $1', [roomIdNum]);
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
        roomHosts.set(roomIdNum, room.host_id);

        socket.to(`room-${roomIdNum}`).emit('user-joined', {
          userId: socket.userId,
          username: socket.username,
          timestamp: Date.now(),
        });

        socket.emit('room-state', {
          currentSongId: room.current_song_id,
          position: room.current_position,
          isPlaying: room.is_playing,
        });
      } catch (error) {
        logger.error('Join room socket error:', error);
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    socket.on('leave-room', async (roomId) => {
      try {
        const roomIdNum = parseInt(roomId, 10);
        socket.leave(`room-${roomIdNum}`);
        socket.to(`room-${roomIdNum}`).emit('user-left', {
          userId: socket.userId,
          username: socket.username,
          timestamp: Date.now(),
        });
        socket.currentRoom = null;
      } catch (error) {
        logger.error('Leave room socket error:', error);
      }
    });

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
            timestamp: Date.now(),
            controlledBy: socket.username,
          });
        }
      } catch (error) {
        logger.error('Room control socket error:', error);
        socket.emit('error', { message: 'Failed to control playback' });
      }
    });

    socket.on('room-chat', (data) => {
      try {
        const { roomId, message } = data;
        const sanitizedMessage = sanitizeChatMessage(message);
        if (!sanitizedMessage) return;

        io.to(`room-${roomId}`).emit('chat-message', {
          userId: socket.userId,
          username: socket.username,
          message: sanitizedMessage,
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error('Room chat socket error:', error);
      }
    });

    socket.on('sync-state', async (state) => {
      try {
        await db.query(
          `INSERT INTO playback_states (user_id, current_song_id, position, is_playing, volume, playback_speed, pitch_shift, stems_config)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (user_id) DO UPDATE SET
             current_song_id = $2, position = $3, is_playing = $4,
             volume = $5, playback_speed = $6, pitch_shift = $7, stems_config = $8,
             updated_at = CURRENT_TIMESTAMP`,
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

        socket.to(`user-${socket.userId}`).emit('sync-state', state);
      } catch (error) {
        logger.error('Sync state socket error:', error);
      }
    });

    socket.on('typing', (data) => {
      const { roomId } = data;
      socket.to(`room-${roomId}`).emit('user-typing', {
        userId: socket.userId,
        username: socket.username,
      });
    });

    socket.on('disconnect', async () => {
      activeUsers.delete(socket.userId);

      if (socket.currentRoom) {
        socket.to(`room-${socket.currentRoom}`).emit('user-left', {
          userId: socket.userId,
          username: socket.username,
          timestamp: Date.now(),
        });
      }
    });
  });
};

module.exports = setupSocketHandlers;
