import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../contexts/AuthContext';
import { usePlayer } from '../contexts/PlayerContext';
import { musicService } from '../services/music';

const ListeningRoom = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { loadSong, play, pause, isPlaying, currentSong, progress } = usePlayer();

  const [room, setRoom] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [socket, setSocket] = useState(null);
  const [typingUsers, setTypingUsers] = useState([]);
  const [showSongPicker, setShowSongPicker] = useState(false);
  const [pickerSongs, setPickerSongs] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerSearch, setPickerSearch] = useState('');
  const [hostId, setHostId] = useState(null);
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);

  const token = localStorage.getItem('token');
  const API_URL = process.env.REACT_APP_API_URL || '';

  const applyRoster = (roster) => {
    if (!Array.isArray(roster)) return;
    setParticipants(
      roster.map((m) => ({
        id: m.userId,
        username: m.username,
        display_name: m.username,
        joined_at: m.joinedAt ? new Date(m.joinedAt).toISOString() : new Date().toISOString(),
      }))
    );
  };

  useEffect(() => {
    const fetchRoom = async () => {
      try {
        const res = await musicService.getRoom(id);
        setRoom(res.room);
        setHostId(res.room?.host_id ?? null);
        setParticipants(res.participants || []);
      } catch (err) {
        console.error('Failed to fetch room:', err);
      }
    };
    fetchRoom();
    musicService.joinRoom(id).catch(() => {});

    return () => {
      musicService.leaveRoom(id).catch(() => {});
    };
  }, [id]);

  useEffect(() => {
    if (!token) return;

    const newSocket = io(API_URL || window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    newSocket.on('connect', () => {
      newSocket.emit('join-room', parseInt(id, 10));
    });

    newSocket.on('room-state', (state) => {
      if (state.hostId != null) setHostId(state.hostId);
      if (state.roster) applyRoster(state.roster);
      if (state.currentSongId) {
        musicService
          .getSong(state.currentSongId)
          .then((res) => {
            loadSong(res.song);
          })
          .catch(() => {});
      }
    });

    newSocket.on('room-update', (update) => {
      if (update.action === 'play') play();
      if (update.action === 'pause') pause();
      if (update.action === 'change-song' && update.songId) {
        musicService
          .getSong(update.songId)
          .then((res) => {
            loadSong(res.song);
            play();
          })
          .catch(() => {});
      }
    });

    newSocket.on('host-changed', (data) => {
      if (data?.newHostId != null) setHostId(data.newHostId);
      setMessages((prev) => [
        ...prev,
        {
          system: true,
          message: data.newHostUsername
            ? `${data.newHostUsername} is now the host`
            : 'Host changed',
          timestamp: data.timestamp || Date.now(),
        },
      ]);
    });

    newSocket.on('chat-message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    newSocket.on('user-joined', (data) => {
      if (data.roster) {
        applyRoster(data.roster);
      } else {
        setParticipants((prev) => [
          ...prev.filter((p) => p.id !== data.userId),
          {
            id: data.userId,
            username: data.username,
            joined_at: new Date().toISOString(),
          },
        ]);
      }
      setMessages((prev) => [
        ...prev,
        {
          system: true,
          message: `${data.username} joined the room`,
          timestamp: data.timestamp,
        },
      ]);
    });

    newSocket.on('user-left', (data) => {
      if (data.roster) {
        applyRoster(data.roster);
      } else {
        setParticipants((prev) => prev.filter((p) => p.id !== data.userId));
      }
      setMessages((prev) => [
        ...prev,
        {
          system: true,
          message: `${data.username} left the room`,
          timestamp: data.timestamp,
        },
      ]);
    });

    newSocket.on('user-typing', (data) => {
      setTypingUsers((prev) => [...new Set([...prev, data.username])]);
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        setTypingUsers((prev) => prev.filter((u) => u !== data.username));
      }, 2000);
    });

    newSocket.on('error', (err) => {
      console.error('Socket error:', err);
    });

    setSocket(newSocket);

    return () => {
      newSocket.emit('leave-room', parseInt(id, 10));
      newSocket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, token, API_URL]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const openSongPicker = async () => {
    setShowSongPicker(true);
    setPickerSearch('');
    setPickerLoading(true);
    try {
      const res = await musicService.getSongs({ limit: 50 });
      const list = res.songs || res || [];
      setPickerSongs(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error('Failed to load songs for picker:', err);
      setPickerSongs([]);
    } finally {
      setPickerLoading(false);
    }
  };

  const pickSong = (song) => {
    if (!socket || !song?.id) return;
    socket.emit('room-control', {
      roomId: parseInt(id, 10),
      action: 'change-song',
      songId: song.id,
    });
    setShowSongPicker(false);
  };

  const sendMessage = () => {
    if (!chatInput.trim() || !socket) return;
    socket.emit('room-chat', { roomId: parseInt(id, 10), message: chatInput });
    setChatInput('');
  };

  const handleTyping = () => {
    socket?.emit('typing', { roomId: parseInt(id, 10) });
  };

  const sendControl = (action) => {
    if (!socket || !room) return;
    const data = { roomId: parseInt(id, 10), action };
    if (action === 'play' || action === 'pause') {
      const pos = Number.isFinite(progress) ? Math.floor(progress) : 0;
      data.position = Math.max(0, pos);
    }
    socket.emit('room-control', data);
  };

  if (!room) return <div className="loading-screen">Loading room...</div>;

  const isHost = hostId != null ? hostId === user?.id : room.host_id === user?.id;

  return (
    <div className="listening-room">
      <div className="room-header">
        <button className="back-btn" onClick={() => navigate('/rooms')}>
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} width="20" height="20">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="room-info">
          <h2>{room.name}</h2>
          <p>
            Hosted by {room.host_display_name || room.host_username}{' '}
            {room.is_public ? 'Public' : 'Private'} Room
          </p>
        </div>
        <div className="room-listener-count">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5} width="18" height="18">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
            />
          </svg>
          {participants.length} listener{participants.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="room-layout">
        <div className="room-main">
          {currentSong && (
            <div className="room-now-playing">
              <div className="room-cover-large">
                {currentSong.cover_url ? (
                  <img src={currentSong.cover_url} alt="" />
                ) : (
                  <div className="room-cover-placeholder-lg">{currentSong.title?.[0]}</div>
                )}
              </div>
              <div className="room-now-playing-info">
                <div className="room-now-label">Now Playing</div>
                <div className="room-now-title">{currentSong.title}</div>
                <div className="room-now-artist">{currentSong.artist}</div>
              </div>
            </div>
          )}

          {isHost && (
            <div className="room-host-controls">
              <button type="button" onClick={() => sendControl('play')} disabled={isPlaying}>
                Play
              </button>
              <button type="button" onClick={() => sendControl('pause')} disabled={!isPlaying}>
                Pause
              </button>
              <button type="button" onClick={openSongPicker}>
                Change Song
              </button>
            </div>
          )}

          {showSongPicker && (
            <div className="room-song-picker" role="dialog" aria-label="Pick a song">
              <div className="room-song-picker-header">
                <h4>Pick a song</h4>
                <button type="button" className="btn-secondary" onClick={() => setShowSongPicker(false)}>
                  Close
                </button>
              </div>
              {!pickerLoading && pickerSongs.length > 0 && (
                <input
                  type="search"
                  className="room-song-picker-search"
                  placeholder="Search title or artist…"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  aria-label="Filter songs"
                />
              )}
              {pickerLoading ? (
                <p className="room-song-picker-empty">Loading songs…</p>
              ) : pickerSongs.length === 0 ? (
                <p className="room-song-picker-empty">No songs available. Upload tracks first.</p>
              ) : (
                (() => {
                  const q = pickerSearch.trim().toLowerCase();
                  const filtered = q
                    ? pickerSongs.filter(
                        (s) =>
                          (s.title || '').toLowerCase().includes(q) ||
                          (s.artist || '').toLowerCase().includes(q)
                      )
                    : pickerSongs;
                  if (filtered.length === 0) {
                    return <p className="room-song-picker-empty">No matches for “{pickerSearch.trim()}”.</p>;
                  }
                  return (
                    <ul className="room-song-picker-list">
                      {filtered.map((song) => (
                        <li key={song.id}>
                          <button type="button" className="room-song-picker-item" onClick={() => pickSong(song)}>
                            <span className="room-song-picker-title">{song.title}</span>
                            <span className="room-song-picker-artist">{song.artist}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  );
                })()
              )}
            </div>
          )}

          <div className="room-participants">
            <h4>In this room</h4>
            <div className="participants-list">
              {participants.map((p) => (
                <div key={p.id} className="participant">
                  <div className="participant-avatar">
                    {(p.display_name || p.username)?.[0]?.toUpperCase()}
                  </div>
                  <span>{p.display_name || p.username}</span>
                  {p.id === hostId && <span className="host-badge">Host</span>}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="room-chat">
          <div className="chat-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`chat-message ${msg.system ? 'system' : ''}`}>
                {msg.system ? (
                  <span className="system-text">{msg.message}</span>
                ) : (
                  <>
                    <span className="chat-username">{msg.username}</span>
                    <span className="chat-text">{msg.message}</span>
                    <span className="chat-time">
                      {new Date(msg.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </>
                )}
              </div>
            ))}
            {typingUsers.length > 0 && (
              <div className="typing-indicator">{typingUsers.join(', ')} typing...</div>
            )}
            <div ref={messagesEndRef} />
          </div>
          <div className="chat-input-area">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => {
                setChatInput(e.target.value);
                handleTyping();
              }}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type a message..."
            />
            <button type="button" onClick={sendMessage}>
              <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} width="18" height="18">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ListeningRoom;
