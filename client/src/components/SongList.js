import React, { useState } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { musicService } from '../services/music';

const SongList = ({ songs, title, showSearch = false, onRefresh, onRemoveSong }) => {
  const { setQueueAndPlay, currentSong, isPlaying } = usePlayer();
  const [search, setSearch] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [addingToPlaylist, setAddingToPlaylist] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [removingId, setRemovingId] = useState(null);

  const filtered = songs.filter(s => {
    const matchesSearch = !search || s.title?.toLowerCase().includes(search.toLowerCase()) || s.artist?.toLowerCase().includes(search.toLowerCase());
    const matchesGenre = !selectedGenre || s.genre === selectedGenre;
    return matchesSearch && matchesGenre;
  });

  const genres = [...new Set(songs.map(s => s.genre).filter(Boolean))].sort();

  const handlePlay = (song, index) => {
    setQueueAndPlay(songs, index);
  };

  const handleAddToPlaylist = async (songId) => {
    try {
      const res = await musicService.getPlaylists();
      setPlaylists(res.playlists);
      setAddingToPlaylist(songId);
    } catch (err) {
      console.error(err);
    }
  };

  const confirmAdd = async (playlistId) => {
    try {
      await musicService.addToPlaylist(playlistId, addingToPlaylist);
      setAddingToPlaylist(null);
    } catch (err) {
      console.error(err);
    }
  };

  const handleRemove = async (song) => {
    if (!onRemoveSong || removingId) return;
    const ok = window.confirm(`Remove "${song.title}" from this playlist?`);
    if (!ok) return;
    setRemovingId(song.id);
    try {
      await onRemoveSong(song.id);
    } catch (err) {
      console.error(err);
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="song-list">
      <div className="song-list-header">
        <h2>{title}</h2>
        {onRefresh && <button className="refresh-btn" onClick={onRefresh}>Refresh</button>}
      </div>

      {showSearch && (
        <div className="song-list-filters">
          <input type="text" placeholder="Search songs..." value={search} onChange={e => setSearch(e.target.value)} className="search-input" />
          <select value={selectedGenre} onChange={e => setSelectedGenre(e.target.value)} className="genre-select">
            <option value="">All Genres</option>
            {genres.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
      )}

      <div className="songs">
        {filtered.length === 0 ? (
          <div className="empty-state">No songs found</div>
        ) : (
          filtered.map((song, index) => (
            <div key={song.id} className={`song-row ${currentSong?.id === song.id ? 'active' : ''}`}>
              <div className="song-number">
                {currentSong?.id === song.id && isPlaying ? (
                  <div className="playing-indicator">
                    <span /><span /><span />
                  </div>
                ) : (
                  <span>{index + 1}</span>
                )}
              </div>
              <div className="song-cover">
                {song.cover_url ? <img src={song.cover_url} alt="" /> : <div className="song-cover-placeholder">{song.title?.[0]}</div>}
              </div>
              <div className="song-info" onClick={() => handlePlay(song, index)}>
                <div className="song-title">{song.title}</div>
                <div className="song-artist">{song.artist} {song.genre && <span className="song-genre">{song.genre}</span>}</div>
              </div>
              <div className="song-meta">
                {song.year && <span className="song-year">{song.year}</span>}
                <span className="song-duration">{formatDuration(song.duration)}</span>
              </div>
              <div className="song-actions">
                <button className="song-action-btn" onClick={() => handlePlay(song, index)} title="Play">
                  <svg fill="currentColor" viewBox="0 0 24 24" width="18" height="18"><path d="M8 5v14l11-7z" /></svg>
                </button>
                <button className="song-action-btn" onClick={() => handleAddToPlaylist(song.id)} title="Add to playlist">
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} width="18" height="18"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                </button>
                {onRemoveSong && (
                  <button
                    className="song-action-btn"
                    onClick={() => handleRemove(song)}
                    disabled={removingId === song.id}
                    title="Remove from playlist"
                    style={{ color: removingId === song.id ? '#999' : '#c62828' }}
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} width="18" height="18">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {addingToPlaylist === song.id && (
                <div className="playlist-popup">
                  <div className="playlist-popup-header">
                    <span>Add to playlist</span>
                    <button onClick={() => setAddingToPlaylist(null)}>x</button>
                  </div>
                  {playlists.map(pl => (
                    <button key={pl.id} className="playlist-popup-item" onClick={() => confirmAdd(pl.id)}>
                      {pl.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

function formatDuration(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default SongList;
