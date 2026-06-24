import React, { useState } from 'react';
import { musicService } from '../services/music';
import { usePlayer } from '../contexts/PlayerContext';

const AIPlaylistGenerator = () => {
  const [prompt, setPrompt] = useState('');
  const [name, setName] = useState('');
  const [songCount, setSongCount] = useState(10);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const { setQueueAndPlay } = usePlayer();

  const quickPrompts = [
    'Upbeat workout songs with high energy',
    'Chill relaxing music for studying',
    'Party dance tracks for the weekend',
    'Late night jazz vibes',
    'Energetic morning motivation',
    'Sad acoustic songs for rainy days',
    'Afrobeats party mix',
    'K-pop summer hits',
  ];

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const data = await musicService.generateAIPlaylist(prompt, name || undefined, songCount);
      setResult(data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate playlist');
    }
    setLoading(false);
  };

  const handlePlayAll = () => {
    if (result?.songs?.length) {
      setQueueAndPlay(result.songs);
    }
  };

  return (
    <div className="ai-playlist-generator">
      <div className="ai-header">
        <h2>AI Playlist Generator</h2>
        <p>Describe the vibe and let Hathor create the perfect playlist</p>
      </div>

      <div className="ai-input-area">
        <textarea
          className="ai-prompt-input"
          placeholder="Describe your perfect playlist... e.g., 'Upbeat Afrobeats for a beach barbecue at sunset'"
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={3}
        />
        <div className="ai-options">
          <input
            type="text"
            placeholder="Playlist name (optional)"
            value={name}
            onChange={e => setName(e.target.value)}
            className="ai-name-input"
          />
          <select value={songCount} onChange={e => setSongCount(parseInt(e.target.value))} className="ai-count-select">
            {[5, 10, 15, 20, 30, 50].map(n => <option key={n} value={n}>{n} songs</option>)}
          </select>
        </div>
        <button className="ai-generate-btn" onClick={handleGenerate} disabled={loading || !prompt.trim()}>
          {loading ? 'Generating...' : 'Generate Playlist'}
        </button>
      </div>

      <div className="ai-quick-prompts">
        <span className="quick-label">Quick prompts:</span>
        {quickPrompts.map((p, i) => (
          <button key={i} className="quick-prompt-btn" onClick={() => setPrompt(p)}>{p}</button>
        ))}
      </div>

      {error && <div className="ai-error">{error}</div>}

      {result && (
        <div className="ai-result">
          <div className="ai-result-header">
            <div>
              <h3>{result.playlist?.name}</h3>
              <p className="ai-result-desc">{result.playlist?.description}</p>
              {result.analysis && (
                <div className="ai-analysis">
                  {result.analysis.mood?.name && <span className="ai-tag">Mood: {result.analysis.mood.name}</span>}
                  {result.analysis.genres?.length > 0 && <span className="ai-tag">Genres: {result.analysis.genres.join(', ')}</span>}
                </div>
              )}
            </div>
            <button className="play-all-btn" onClick={handlePlayAll}>
              <svg fill="currentColor" viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z" /></svg>
              Play All
            </button>
          </div>

          <div className="ai-songs">
            {result.songs?.map((song, i) => (
              <div key={song.id} className="ai-song-row" onClick={() => setQueueAndPlay(result.songs, i)}>
                <span className="ai-song-num">{i + 1}</span>
                <div className="ai-song-cover-placeholder">{song.title?.[0]}</div>
                <div className="ai-song-info">
                  <div className="ai-song-title">{song.title}</div>
                  <div className="ai-song-artist">{song.artist} {song.genre && <span className="ai-song-genre">{song.genre}</span>}</div>
                </div>
                <span className="ai-song-duration">{formatTime(song.duration)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

function formatTime(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default AIPlaylistGenerator;
