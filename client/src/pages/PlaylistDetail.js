import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { musicService } from '../services/music';
import { usePlayer } from '../contexts/PlayerContext';
import { useAuth } from '../contexts/AuthContext';
import SongList from '../components/SongList';

const PlaylistDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [playlist, setPlaylist] = useState(null);
  const [songs, setSongs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const { setQueueAndPlay } = usePlayer();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    musicService
      .getPlaylist(id)
      .then((res) => {
        if (cancelled) return;
        setPlaylist(res.playlist);
        setSongs(res.songs || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.response?.data?.error || 'Failed to load playlist');
        setPlaylist(null);
        setSongs([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const isOwner =
    user &&
    playlist &&
    (String(playlist.user_id) === String(user.id) ||
      String(playlist.user_id) === String(user.userId));

  const handleDelete = async () => {
    if (!playlist?.id || deleting) return;
    const ok = window.confirm(
      `Delete playlist "${playlist.name}"? This cannot be undone.`
    );
    if (!ok) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await musicService.deletePlaylist(playlist.id);
      navigate('/playlists');
    } catch (err) {
      setDeleteError(err.response?.data?.error || 'Failed to delete playlist');
      setDeleting(false);
    }
  };

  if (loading) return <div className="loading-screen">Loading playlist...</div>;

  if (error || !playlist) {
    return (
      <div className="playlists-page">
        <Link to="/playlists" className="back-btn" style={{ display: 'inline-flex', marginBottom: 16 }}>
          ← Back to Playlists
        </Link>
        <div className="empty-state">
          <p>{error || 'Playlist not found'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="playlists-page">
      <Link to="/playlists" className="back-btn" style={{ display: 'inline-flex', marginBottom: 16 }}>
        ← Back to Playlists
      </Link>

      <div className="section-header" style={{ marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 28, marginBottom: 4 }}>{playlist.name}</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>
            {playlist.description ||
              (playlist.is_ai_generated ? 'AI Generated' : 'Custom Playlist')}
            {playlist.is_public ? ' · Public' : ' · Private'}
            {songs.length > 0 ? ` · ${songs.length} track${songs.length === 1 ? '' : 's'}` : ''}
          </p>
          {deleteError && (
            <div className="ai-error" style={{ marginTop: 8 }}>
              {deleteError}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {songs.length > 0 && (
            <button className="play-all-btn" type="button" onClick={() => setQueueAndPlay(songs, 0)}>
              <svg fill="currentColor" viewBox="0 0 24 24" width="14" height="14">
                <path d="M8 5v14l11-7z" />
              </svg>
              Play All
            </button>
          )}
          {isOwner && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: '1px solid #c62828',
                background: deleting ? '#eee' : 'transparent',
                color: '#c62828',
                fontWeight: 600,
                cursor: deleting ? 'not-allowed' : 'pointer',
                fontSize: 13,
              }}
            >
              {deleting ? 'Deleting…' : 'Delete playlist'}
            </button>
          )}
        </div>
      </div>

      {songs.length === 0 ? (
        <div className="empty-state">
          <p>This playlist has no songs yet</p>
        </div>
      ) : (
        <SongList songs={songs} title="Tracks" showSearch={false} />
      )}
    </div>
  );
};

export default PlaylistDetail;
