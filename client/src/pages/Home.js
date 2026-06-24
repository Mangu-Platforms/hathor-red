import React, { useEffect, useState } from 'react';
import SongList from '../components/SongList';
import AIPlaylistGenerator from '../components/AIPlaylistGenerator';
import { musicService } from '../services/music';
import { usePlayer } from '../contexts/PlayerContext';

const Home = () => {
  const [songs, setSongs] = useState([]);
  const [playlists, setPlaylists] = useState([]);
  const [genres, setGenres] = useState([]);
  const [dailyMix, setDailyMix] = useState([]);
  const [activeTab, setActiveTab] = useState('discover');
  const [loading, setLoading] = useState(true);
  const { setQueueAndPlay } = usePlayer();

  const fetchSongs = async () => {
    try { const res = await musicService.getSongs(); setSongs(res.songs); }
    catch (err) { console.error(err); }
  };

  const fetchPlaylists = async () => {
    try { const res = await musicService.getPlaylists(); setPlaylists(res.playlists); }
    catch (err) { console.error(err); }
  };

  const fetchGenres = async () => {
    try { const res = await musicService.getGenres(); setGenres(res.genres); }
    catch (err) { console.error(err); }
  };

  const fetchDailyMix = async () => {
    try { const res = await musicService.getDailyMix(); setDailyMix(res.songs || []); }
    catch (err) { console.error(err); }
  };

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchSongs(), fetchPlaylists(), fetchGenres(), fetchDailyMix()]).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading-screen">Loading your music universe...</div>;

  return (
    <div className="home-page">
      <div className="hero-section">
        <h1>Welcome to Hathor</h1>
        <p>The greatest music platform on Earth</p>
      </div>

      <div className="tabs">
        {['discover', 'ai-playlist', 'playlists'].map(tab => (
          <button key={tab} className={`tab ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            {tab === 'discover' && 'Discover'}
            {tab === 'ai-playlist' && 'AI Playlist'}
            {tab === 'playlists' && 'My Playlists'}
          </button>
        ))}
      </div>

      {activeTab === 'discover' && (
        <>
          {dailyMix.length > 0 && (
            <section className="section">
              <div className="section-header">
                <h2>Your Daily Mix</h2>
                <button className="play-all-btn" onClick={() => setQueueAndPlay(dailyMix)}>
                  <svg fill="currentColor" viewBox="0 0 24 24" width="14" height="14"><path d="M8 5v14l11-7z" /></svg>
                  Play All
                </button>
              </div>
              <SongList songs={dailyMix.slice(0, 8)} title="" showSearch={false} />
            </section>
          )}

          {genres.length > 0 && (
            <section className="section">
              <h2>Browse by Genre</h2>
              <div className="genre-grid">
                {genres.map(g => (
                  <button key={g.genre} className="genre-card" onClick={() => fetchSongs({ genre: g.genre })}>
                    <div className="genre-card-bg">{g.genre?.[0]}</div>
                    <span className="genre-card-name">{g.genre}</span>
                    <span className="genre-card-count">{g.count} songs</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <SongList songs={songs} title="All Songs" showSearch={true} onRefresh={fetchSongs} />
        </>
      )}

      {activeTab === 'ai-playlist' && <AIPlaylistGenerator />}

      {activeTab === 'playlists' && (
        <div className="playlists-section">
          <h2>My Playlists</h2>
          {playlists.length === 0 ? (
            <div className="empty-state">
              <p>No playlists yet</p>
              <p>Create your first playlist using the AI Playlist tab!</p>
            </div>
          ) : (
            <div className="playlist-grid">
              {playlists.map(pl => (
                <div key={pl.id} className="playlist-card">
                  <div className="playlist-card-cover">
                    {pl.cover_url ? <img src={pl.cover_url} alt="" /> : <div className="playlist-cover-placeholder">{pl.name?.[0]}</div>}
                  </div>
                  <div className="playlist-card-info">
                    <h4>{pl.name}</h4>
                    <p>{pl.description || (pl.is_ai_generated ? 'AI Generated' : 'Custom Playlist')}</p>
                    {pl.is_public && <span className="public-badge">Public</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Home;
