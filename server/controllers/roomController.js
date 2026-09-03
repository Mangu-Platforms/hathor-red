const db = require('../config/database');
const setupSocketHandlers = require('../socket/handlers');

const getRooms = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT lr.*, u.username as host_username, u.display_name as host_display_name,
              COUNT(DISTINCT rp.user_id) as listener_count,
              s.title as current_song_title, s.artist as current_song_artist
       FROM listening_rooms lr
       LEFT JOIN users u ON lr.host_id = u.id
       LEFT JOIN room_participants rp ON lr.id = rp.room_id
       LEFT JOIN songs s ON lr.current_song_id = s.id
       WHERE lr.is_public = true
       GROUP BY lr.id, u.username, u.display_name, s.title, s.artist
       ORDER BY lr.created_at DESC`
    );

    // dose-4.67: when this process has live socket presence for a room, prefer
    // unique connected users over room_participants (handles multi-tab refcount
    // and recent disconnects before the next DB cleanup lands on the list poll).
    let presenceCounts = {};
    try {
      if (typeof setupSocketHandlers.getRoomPresenceCounts === 'function') {
        presenceCounts = setupSocketHandlers.getRoomPresenceCounts() || {};
      }
    } catch {
      presenceCounts = {};
    }

    const rooms = result.rows.map((row) => {
      const id = row.id;
      const live = presenceCounts[id];
      if (live != null && Number.isFinite(Number(live))) {
        return { ...row, listener_count: String(Number(live)) };
      }
      return row;
    });

    res.json({ rooms });
  } catch (error) {
    console.error('Get rooms error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const getRoomById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT lr.*, u.username as host_username, u.display_name as host_display_name,
              s.title as current_song_title, s.artist as current_song_artist
       FROM listening_rooms lr
       LEFT JOIN users u ON lr.host_id = u.id
       LEFT JOIN songs s ON lr.current_song_id = s.id
       WHERE lr.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const participantsResult = await db.query(
      `SELECT u.id, u.username, u.display_name, u.avatar_url, rp.joined_at
       FROM room_participants rp
       JOIN users u ON rp.user_id = u.id
       WHERE rp.room_id = $1
       ORDER BY rp.joined_at`,
      [id]
    );

    let participants = participantsResult.rows;

    // dose-4.69: when this process has live socket presence for the room,
    // prefer that unique-user roster over room_participants so the detail
    // page matches list counts (4.67) and does not show sticky ghosts after
    // disconnect before DB cleanup. Fall back to DB when presence is empty
    // (cold process / no sockets yet).
    try {
      if (typeof setupSocketHandlers.getRoomPresenceRoster === 'function') {
        const live = setupSocketHandlers.getRoomPresenceRoster(id);
        if (Array.isArray(live) && live.length > 0) {
          participants = live.map((m) => ({
            id: m.userId,
            username: m.username,
            display_name: m.username,
            avatar_url: null,
            joined_at: m.joinedAt
              ? new Date(m.joinedAt).toISOString()
              : new Date().toISOString(),
          }));
        }
      }
    } catch {
      // keep DB participants
    }

    res.json({
      room: result.rows[0],
      participants,
    });
  } catch (error) {
    console.error('Get room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const createRoom = async (req, res) => {
  try {
    const { name, isPublic, maxListeners } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Room name is required' });
    }

    const result = await db.query(
      'INSERT INTO listening_rooms (name, host_id, is_public, max_listeners) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, req.user.userId, isPublic !== false, maxListeners || 50]
    );

    // Auto-join host to room
    await db.query(
      'INSERT INTO room_participants (room_id, user_id) VALUES ($1, $2)',
      [result.rows[0].id, req.user.userId]
    );

    res.status(201).json({
      message: 'Room created successfully',
      room: result.rows[0]
    });
  } catch (error) {
    console.error('Create room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const joinRoom = async (req, res) => {
  try {
    const { id } = req.params;

    const roomResult = await db.query(
      'SELECT * FROM listening_rooms WHERE id = $1',
      [id]
    );

    if (roomResult.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found' });
    }

    const room = roomResult.rows[0];

    // Capacity-gated insert: only join when under max_listeners (avoids race past the limit)
    const insertResult = await db.query(
      `INSERT INTO room_participants (room_id, user_id)
       SELECT $1, $2
       WHERE (
         SELECT COUNT(*) FROM room_participants WHERE room_id = $1
       ) < $3
       ON CONFLICT (room_id, user_id) DO NOTHING
       RETURNING room_id`,
      [id, req.user.userId, room.max_listeners]
    );

    if (insertResult.rows.length === 0) {
      // Either already a participant, or room is full
      const existing = await db.query(
        'SELECT 1 FROM room_participants WHERE room_id = $1 AND user_id = $2',
        [id, req.user.userId]
      );
      if (existing.rows.length > 0) {
        return res.json({ message: 'Joined room successfully' });
      }
      return res.status(403).json({ error: 'Room is full' });
    }

    res.json({ message: 'Joined room successfully' });
  } catch (error) {
    console.error('Join room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const leaveRoom = async (req, res) => {
  try {
    const { id } = req.params;

    await db.query(
      'DELETE FROM room_participants WHERE room_id = $1 AND user_id = $2',
      [id, req.user.userId]
    );

    res.json({ message: 'Left room successfully' });
  } catch (error) {
    console.error('Leave room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const deleteRoom = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      'DELETE FROM listening_rooms WHERE id = $1 AND host_id = $2 RETURNING *',
      [id, req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Room not found or access denied' });
    }

    res.json({ message: 'Room deleted successfully' });
  } catch (error) {
    console.error('Delete room error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getRooms,
  getRoomById,
  createRoom,
  joinRoom,
  leaveRoom,
  deleteRoom
};
