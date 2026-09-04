import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { musicService } from '../services/music';
import { useAuth } from '../contexts/AuthContext';

const ROOMS_POLL_MS = 15000;

const Rooms = () => {
  const [rooms, setRooms] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomPublic, setNewRoomPublic] = useState(true);
  const [newRoomMaxListeners, setNewRoomMaxListeners] = useState(50);
  const navigate = useNavigate();
  const { user } = useAuth();

  const isHost = (room) =>
    user &&
    (String(room.host_id) === String(user.id) || String(room.host_id) === String(user.userId));

  const fetchRooms = useCallback(async () => {
    try {
      const res = await musicService.getRooms();
      setRooms(res.rooms || []);
    } catch (err) {
      console.error(err);
    }
  }, []);

  useEffect(() => {
    fetchRooms();
    const id = setInterval(fetchRooms, ROOMS_POLL_MS);
    return () => clearInterval(id);
  }, [fetchRooms]);

  const handleCreate = async () => {
    if (!newRoomName.trim()) return;
    try {
      const res = await musicService.createRoom({
        name: newRoomName,
        isPublic: newRoomPublic,
        maxListeners: newRoomMaxListeners,
      });
      setShowCreate(false);
      setNewRoomName('');
      navigate(`/room/${res.room.id}`);
    } catch (err) {
      console.error(err);
    }
  };

  const handleJoin = async (roomId) => {
    try {
      await musicService.joinRoom(roomId);
      navigate(`/room/${roomId}`);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="rooms-page">
      <div className="rooms-header">
        <h1>Listening Rooms</h1>
        <button className="create-room-btn" onClick={() => setShowCreate(!showCreate)}>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} width="18" height="18"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
          Create Room
        </button>
      </div>

      {showCreate && (
        <div className="create-room-form">
          <input type="text" placeholder="Room name" value={newRoomName} onChange={e => setNewRoomName(e.target.value)} />
          <label><input type="checkbox" checked={newRoomPublic} onChange={e => setNewRoomPublic(e.target.checked)} /> Public room</label>
          <input type="number" min="2" max="100" value={newRoomMaxListeners} onChange={e => setNewRoomMaxListeners(parseInt(e.target.value) || 50)} placeholder="Max listeners" />
          <div className="create-room-actions">
            <button className="btn-primary" onClick={handleCreate}>Create</button>
            <button className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="rooms-grid">
        {rooms.length === 0 ? (
          <div className="empty-state">
            <p>No active listening rooms</p>
            <p>Be the first to create one and invite your friends!</p>
          </div>
        ) : (
          rooms.map(room => (
            <div key={room.id} className="room-card" onClick={() => handleJoin(room.id)}>
              <div className="room-card-cover">
                {room.current_song_id ? (
                  <div className="room-playing-indicator">
                    <span /><span /><span />
                  </div>
                ) : (
                  <div className="room-card-icon">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                  </div>
                )}
              </div>
              <div className="room-card-info">
                <h3>{room.name}</h3>
                <p>Host: {room.host_display_name || room.host_username}</p>
                <div className="room-card-meta">
                  <span>
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} width="14" height="14"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    {room.listener_count || 0} / {room.max_listeners}
                  </span>
                  {isHost(room) && (
                    <span
                      className="host-badge"
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: 'rgba(102, 126, 234, 0.15)',
                        color: '#5a67d8',
                      }}
                    >
                      Host
                    </span>
                  )}
                  <span
                    className={room.is_public ? 'public-badge' : 'private-badge'}
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: room.is_public
                        ? 'rgba(72, 187, 120, 0.15)'
                        : 'rgba(160, 174, 192, 0.2)',
                      color: room.is_public ? '#2f855a' : '#4a5568',
                    }}
                  >
                    {room.is_public ? 'Public' : 'Private'}
                  </span>
                  {room.current_song_title && (
                    <span className="room-now-playing-text">
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} width="12" height="12"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" /></svg>
                      {room.current_song_title} - {room.current_song_artist}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Rooms;
