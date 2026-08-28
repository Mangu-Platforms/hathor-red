import React, { useEffect, useState, useCallback } from 'react';
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
  const [reorderError, setReorderError] = useState(null);
  const [reordering, setReordering] = useState(false);
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

  const handleRemoveSong = useCallback(
    async (songId) => {
      if (!playlist?.id) return;
      await musicService.removeFromPlaylist(playlist.id, songId);
      setSongs((prev) => prev.filter((s) => String(s.id) !== String(songId)));
    },
    [playlist?.id]
  );

  const moveSong = useCallback(
    async (index, direction) => {
      if (!playlist?.id || reordering) return;
      const next = index + direction;
      if (next < 0 || next >= songs.length) return;

      const reordered = [...songs];
      const [item] = reordered.splice(index, 1);
      reordered.splice(next, 0, item);
      const songIds = reordered.map((s) => s.id);

      setReorderError(null);
      setReordering(true);
      setSongs(reordered);
      try {
        await musicService.reorderPlaylist(playlist.id, songIds);
      } catch (err) {
        setReorderError(err.response?.data?.error || 'Failed to reorder');
        // reload authoritative order
        try {
          const res = await musicService.getPlaylist(playlist.id);
          setSongs(res.songs || []);
        } catch {
          /* keep optimistic list */
        }
      } finally {
        setReordering(false);
      }
    },
    [playlist?.id, songs, reordering]
  );

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
          {reorderError && (
            <div className="ai-error" style={{ marginTop: 8 }}>
              {reorderError}
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
        <>
          {isOwner && songs.length > 1 && (
            <div
              style={{
                marginBottom: 12,
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}
            >
              Reorder with ▲ / ▼ on each row{reordering ? ' (saving…)' : ''}
            </div>
          )}
          <div className="playlist-tracks">
            {songs.map((song, index) => (
              <div
                key={song.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                {isOwner && songs.length > 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <button
                      type="button"
                      aria-label="Move up"
                      disabled={reordering || index === 0}
                      onClick={() => moveSong(index, -1)}
                      style={{
                        padding: '2px 6px',
                        fontSize: 11,
                        cursor: index === 0 || reordering ? 'not-allowed' : 'pointer',
                        opacity: index === 0 ? 0.4 : 1,
                      }}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label="Move down"
                      disabled={reordering || index === songs.length - 1}
                      onClick={() => moveSong(index, 1)}
                      style={{
                        padding: '2px 6px',
                        fontSize: 11,
                        cursor:
                          index === songs.length - 1 || reordering ? 'not-allowed' : 'pointer',
                        opacity: index === songs.length - 1 ? 0.4 : 1,
                      }}
                    >
                      ▼
                    </button>
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <SongList
                    songs={[song]}
                    title={null}
                    showSearch={false}
                    onRemoveSong={isOwner ? handleRemoveSong : undefined}
                  />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default PlaylistDetail;
