import React, { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { musicService } from '../services/music';

const Playlists = () => {
  const navigate = useNavigate();
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

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
            <Link
              key={pl.id}
              to={`/playlists/${pl.id}`}
              className="playlist-card"
              style={{ textDecoration: 'none', color: 'inherit' }}
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
                {pl.is_public && <span className="public-badge">Public</span>}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default Playlists;
