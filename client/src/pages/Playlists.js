import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { musicService } from '../services/music';

const Playlists = () => {
  const [playlists, setPlaylists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  if (loading) return <div className="loading-screen">Loading playlists...</div>;

  return (
    <div className="playlists-page">
      <div className="hero-section">
        <h1>Playlists</h1>
        <p>Your collections and public playlists</p>
      </div>

      {error && (
        <div className="ai-error" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      {playlists.length === 0 ? (
        <div className="empty-state">
          <p>No playlists yet</p>
          <p>Create one from Home → AI Playlist, or add songs to a new list later.</p>
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
