import React, { useState, useEffect } from 'react';
import { getRecommendations, getDailyMix, getSimilarSongs, getAIStatus } from '../services/ai';
import { usePlayer } from '../contexts/PlayerContext';
import './AIRecommendations.css';

const AIRecommendations = ({ currentSongId = null }) => {
  const [recommendations, setRecommendations] = useState(null);
  const [dailyMix, setDailyMix] = useState(null);
  const [similarSongs, setSimilarSongs] = useState(null);
  const [activeTab, setActiveTab] = useState('forYou');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [aiStatus, setAiStatus] = useState(null);
  const { setQueueAndPlay } = usePlayer();

  useEffect(() => {
    loadRecommendations();
  }, []);

  useEffect(() => {
    let cancelled = false;
    getAIStatus()
      .then((data) => {
        if (!cancelled) setAiStatus(data?.status || data || null);
      })
      .catch(() => {
        if (!cancelled) setAiStatus({ fallbackMode: true, initialized: false });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (currentSongId && activeTab === 'similar') {
      loadSimilarSongs(currentSongId);
    }
  }, [currentSongId, activeTab]);

  const loadRecommendations = async () => {
    try {
      setLoading(true);
      setError(null);
      const [recsData, mixData] = await Promise.all([
        getRecommendations(15),
        getDailyMix()
      ]);
      setRecommendations(recsData);
      setDailyMix(mixData.dailyMix);
    } catch (err) {
      console.error('Failed to load recommendations:', err);
      setError('Failed to load recommendations');
    } finally {
      setLoading(false);
    }
  };

  const loadSimilarSongs = async (songId) => {
    try {
      setLoading(true);
      const data = await getSimilarSongs(songId);
      setSimilarSongs(data);
    } catch (err) {
      console.error('Failed to load similar songs:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePlaySong = (song) => {
    if (song) setQueueAndPlay([song], 0);
  };

  const statusLabel = () => {
    if (!aiStatus) return 'Checking AI…';
    if (aiStatus.fallbackMode || !aiStatus.initialized) {
      return 'Rule-based fallback (no live model)';
    }
    return 'Live AI connected';
  };

  const renderSongList = (songs) => {
    if (!songs || songs.length === 0) {
      return <p className="no-songs">No songs available</p>;
    }

    return (
      <div className="song-list">
        {songs.map((song) => (
          <div key={song.id} className="song-item" onClick={() => handlePlaySong(song)}>
            <div className="song-cover">
              {song.cover_url ? (
                <img src={song.cover_url} alt={song.title} />
              ) : (
                <div className="song-cover-placeholder">
                  <span>{song.title?.charAt(0) || '?'}</span>
                </div>
              )}
            </div>
            <div className="song-info">
              <h4 className="song-title">{song.title}</h4>
              <p className="song-artist">{song.artist}</p>
              {song.genre && <span className="song-genre">{song.genre}</span>}
            </div>
            <button className="play-btn" aria-label="Play song">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    );
  };

  if (loading && !recommendations && !dailyMix) {
    return (
      <div className="ai-recommendations loading">
        <div className="loading-spinner"></div>
        <p>Loading your personalized recommendations...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ai-recommendations error">
        <p>{error}</p>
        <button onClick={loadRecommendations}>Try Again</button>
      </div>
    );
  }

  return (
    <div className="ai-recommendations">
      <div className="recommendations-header">
        <div>
          <h2>AI Music Discovery</h2>
          <span className="status" style={{ fontSize: '0.85rem', opacity: 0.85 }}>
            {statusLabel()}
          </span>
        </div>
        <div className="tab-buttons">
          <button
            className={activeTab === 'forYou' ? 'active' : ''}
            onClick={() => setActiveTab('forYou')}
          >
            For You
          </button>
          <button
            className={activeTab === 'dailyMix' ? 'active' : ''}
            onClick={() => setActiveTab('dailyMix')}
          >
            Daily Mix
          </button>
          {currentSongId && (
            <button
              className={activeTab === 'similar' ? 'active' : ''}
              onClick={() => setActiveTab('similar')}
            >
              Similar Songs
            </button>
          )}
        </div>
      </div>

      <div className="recommendations-content">
        {activeTab === 'forYou' && recommendations && (
          <div className="for-you-section">
            {recommendations.userProfile && (
              <div className="user-profile-summary">
                <p>
                  Based on your love for{' '}
                  <strong>{recommendations.userProfile.favoriteGenres?.slice(0, 3).join(', ') || 'music'}</strong>
                </p>
                {recommendations.recommendations?.mood && (
                  <span className="mood-badge">
                    Current vibe: {recommendations.recommendations.mood}
                  </span>
                )}
              </div>
            )}
            {renderSongList(recommendations.recommendations?.songs)}
          </div>
        )}

        {activeTab === 'dailyMix' && dailyMix && (
          <div className="daily-mix-section">
            <div className="daily-mix-header">
              <h3>{dailyMix.name}</h3>
              {dailyMix.basedOn && (
                <p className="based-on">
                  Featuring {dailyMix.basedOn.genres?.slice(0, 3).join(', ')}
                </p>
              )}
            </div>
            {renderSongList(dailyMix.songs)}
          </div>
        )}

        {activeTab === 'similar' && similarSongs && (
          <div className="similar-section">
            {similarSongs.referenceSong && (
              <div className="reference-song">
                <p>Songs similar to:</p>
                <strong>{similarSongs.referenceSong.title}</strong>
                <span> by {similarSongs.referenceSong.artist}</span>
              </div>
            )}
            {renderSongList(similarSongs.similarSongs)}
          </div>
        )}
      </div>

      <button className="refresh-btn" onClick={loadRecommendations} disabled={loading}>
        {loading ? 'Refreshing...' : 'Refresh Recommendations'}
      </button>
    </div>
  );
};

export default AIRecommendations;
