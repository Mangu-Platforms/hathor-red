import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { musicService } from '../services/music';
import { useAuth } from '../contexts/AuthContext';

const Playlists = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  const loadPlaylists = useCallback(() => {
    setLoading(true);
    setError(null);
    return musicService
      .getPlaylists()
      .then((res) => {
        setPlaylists(res.playlists || []);
      })
      .catch((err) => {
        setError(err.response?.data?.error || 'Failed to load playlists');
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    musicService
      .getPlaylists()
      .then((res) => {
        if (!cancelled) setPlaylists(res.playlists || []);
      })
      .catch((err) => {
        if (!cancelled) setError(err.response?.data?.error || 'Failed to load playlists');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isOwner = (pl) =>
    user &&
    (String(pl.user_id) === String(user.id) || String(pl.user_id) === String(user.userId));

  const handleDelete = async (e, pl) => {
    e.preventDefault();
    e.stopPropagation();
    if (!pl?.id || deletingId) return;
    const ok = window.confirm(`Delete playlist "${pl.name}"? This cannot be undone.`);
    if (!ok) return;
    setDeletingId(pl.id);
    try {
      await musicService.deletePlaylist(pl.id);
      setPlaylists((prev) => prev.filter((p) => p.id !== pl.id));
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to delete playlist');
    } finally {
      setDeletingId(null);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setCreateError('Name is required');
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await musicService.createPlaylist({
        name: trimmed,
        description: description.trim() || undefined,
        isPublic,
      });
      const pl = res.playlist;
      setName('');
      setDescription('');
      setIsPublic(true);
      setShowForm(false);
      if (pl?.id) {
        navigate(`/playlists/${pl.id}`);
        return;
      }
      await loadPlaylists();
    } catch (err) {
      setCreateError(err.response?.data?.error || 'Failed to create playlist');
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="loading-screen">Loading playlists...</div>;

  return (
    <div className="playlists-page">
      <div className="hero-section" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1>Playlists</h1>
          <p>Your collections and public playlists</p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setShowForm((v) => !v);
            setCreateError(null);
          }}
          style={{
            padding: '10px 18px',
            borderRadius: 8,
            border: 'none',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: '#fff',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {showForm ? 'Cancel' : 'New playlist'}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="create-playlist-form"
          style={{
            marginBottom: 24,
            padding: 20,
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
            maxWidth: 480,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Create playlist</h3>
          {createError && (
            <div className="ai-error" style={{ marginBottom: 12 }}>
              {createError}
            </div>
          )}
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My playlist"
              maxLength={100}
              required
              disabled={creating}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd' }}
            />
          </label>
          <label style={{ display: 'block', marginBottom: 12 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Description (optional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this list for?"
              rows={2}
              disabled={creating}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', resize: 'vertical' }}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontSize: 14 }}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              disabled={creating}
            />
            Public (visible to others)
          </label>
          <button
            type="submit"
            disabled={creating || !name.trim()}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: creating ? '#999' : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              color: '#fff',
              fontWeight: 600,
              cursor: creating ? 'not-allowed' : 'pointer',
            }}
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {error && (
        <div className="ai-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {playlists.length === 0 ? (
        <div className="empty-state">
          <p>No playlists yet</p>
          <p>Use <strong>New playlist</strong> above, or create one from Home → AI Playlist.</p>
        </div>
      ) : (
        <div className="playlist-grid">
          {playlists.map((pl) => (
            <div key={pl.id} className="playlist-card" style={{ position: 'relative' }}>
              <Link
                to={`/playlists/${pl.id}`}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <div className="playlist-card-cover">
                  {pl.cover_url ? (
                    <img src={pl.cover_url} alt="" />
                  ) : (
                    <div className="playlist-cover-placeholder">{pl.name?.[0] || '?'}</div>
                  )}
                </div>
                <div className="playlist-card-info">
                  <h4>{pl.name}</h4>
                  <p>
                    {pl.description ||
                      (pl.is_ai_generated ? 'AI Generated' : 'Custom Playlist')}
                  </p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                    {isOwner(pl) && (
                      <span
                        className="owner-badge"
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: 'rgba(102, 126, 234, 0.15)',
                          color: '#5a67d8',
                        }}
                      >
                        Yours
                      </span>
                    )}
                    {pl.is_public && <span className="public-badge">Public</span>}
                  </div>
                </div>
              </Link>
              {isOwner(pl) && (
                <button
                  type="button"
                  title="Delete playlist"
                  onClick={(e) => handleDelete(e, pl)}
                  disabled={deletingId === pl.id}
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    padding: '4px 8px',
                    borderRadius: 6,
                    border: '1px solid #c62828',
                    background: 'rgba(255,255,255,0.95)',
                    color: '#c62828',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: deletingId === pl.id ? 'not-allowed' : 'pointer',
                    zIndex: 2,
                  }}
                >
                  {deletingId === pl.id ? '…' : 'Delete'}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Playlists;
