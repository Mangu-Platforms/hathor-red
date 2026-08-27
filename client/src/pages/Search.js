import React, { useState } from 'react';
import { discoveryService } from '../services/olympus';
import { musicService } from '../services/music';
import { usePlayer } from '../contexts/PlayerContext';
import './Olympus.css';

const Search = () => {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const { setQueueAndPlay } = usePlayer();

  const run = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    try {
      setResult(await discoveryService.search(query.trim(), 20));
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        setResult({
          results: [],
          error: 'Semantic search is not available on this server (discovery feature flag off or route missing).',
        });
      } else {
        setResult({ results: [], error: err.response?.data?.error || 'Search failed' });
      }
    } finally {
      setLoading(false);
    }
  };

  const playOne = async (songId) => {
    try {
      const { song } = await musicService.getSong(songId);
      if (song) setQueueAndPlay([song], 0);
    } catch (err) {
      // song may have been removed
    }
  };

  return (
    <div className="oly-page">
      <h1>Semantic Search</h1>
      <div className="oly-sub">Describe a feeling, a scene, a tempo — “sad rainy night synthwave”, “bass-heavy techno 128 bpm”.</div>

      <form onSubmit={run} className="oly-row" style={{ marginBottom: 20 }}>
        <input
          className="oly-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What do you want to hear?"
          maxLength={200}
        />
        <button className="oly-btn" type="submit" disabled={loading}>
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {result?.intent && (result.intent.genres.length > 0 || result.intent.moods.length > 0 || result.intent.bpm) && (
        <div style={{ marginBottom: 16 }}>
          {result.intent.genres.map((g) => <span className="oly-reason" key={g}>genre: {g}</span>)}
          {result.intent.moods.map((m) => <span className="oly-reason" key={m}>mood: {m}</span>)}
          {result.intent.bpm && <span className="oly-reason">~{result.intent.bpm} BPM</span>}
        </div>
      )}

      {result?.error && <div className="oly-msg err">{result.error}</div>}

      {result && !result.error && (
        result.results.length === 0 ? (
          <div className="oly-empty">Nothing close enough — try different words.</div>
        ) : (
          <div className="oly-grid">
            {result.results.map(({ song, score, reasons }) => (
              <div className="oly-card" key={song.id}>
                <h3>{song.title}</h3>
                <div className="muted">
                  {song.artist}{song.genre ? ` · ${song.genre}` : ''}{song.bpm ? ` · ${song.bpm} BPM` : ''}
                </div>
                <div>
                  {(reasons || []).map((reason) => (
                    <span className="oly-reason" key={reason}>{reason}</span>
                  ))}
                </div>
                <button className="oly-btn-ghost" onClick={() => playOne(song.id)}>Play</button>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default Search;
