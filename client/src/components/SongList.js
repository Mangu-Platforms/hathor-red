import React, { useState } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { musicService } from '../services/music';

const SongList = ({ songs, title, showSearch = false, onRefresh, onRemoveSong }) => {
  const { setQueueAndPlay, addToQueue, insertNext, currentSong, isPlaying } = usePlayer();
  const [search, setSearch] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('');
  const [addingToPlaylist, setAddingToPlaylist] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [removingId, setRemovingId] = useState(null);
  const [addFeedback, setAddFeedback] = useState(null); // { songId, ok, message }

  const filtered = songs.filter(s => {
    const matchesSearch = !search || s.title?.toLowerCase().includes(search.toLowerCase()) || s.artist?.toLowerCase().includes(search.toLowerCase());
    // Case-insensitive genre match so local filter aligns with server LOWER(genre) / ALLOWED_GENRES resolution.
    const matchesGenre = !selectedGenre || (s.genre && s.genre.toLowerCase() === selectedGenre.toLowerCase());
    return matchesSearch && matchesGenre;
  });

  const genres = [...new Set(songs.map(s => s.genre).filter(Boolean))].sort();
  const hasActiveFilter = Boolean(search.trim() || selectedGenre);

  /** Play the visible (filtered) list from the clicked row — index matches what the user sees. */
  const handlePlay = (indexInFiltered) => {
    if (!filtered.length || indexInFiltered < 0 || indexInFiltered >= filtered.length) return;
    setQueueAndPlay(filtered, indexInFiltered);
  };

  const handleAddToQueue = (song) => {
    if (!song) return;
    const added = addToQueue(song);
    setAddFeedback({
      songId: song.id,
      ok: !!added,
      message: added ? 'Added to queue' : 'Already in queue',
    });
    setTimeout(() => setAddFeedback((f) => (f?.songId === song.id ? null : f)), 2000);
  };

  const handlePlayNext = (song) => {
    if (!song) return;
    const added = insertNext(song);
    setAddFeedback({
      songId: song.id,
      ok: !!added,
      message: added ? 'Playing next' : 'Already in queue',
    });
    setTimeout(() => setAddFeedback((f) => (f?.songId === song.id ? null : f)), 2000);
  };

  const handleAddToPlaylist = async (songId) => {
    try {
      const res = await musicService.getPlaylists();
      setPlaylists(res.playlists || []);
      setAddingToPlaylist(songId);
      setAddFeedback(null);
    } catch (err) {
      console.error(err);
      setAddFeedback({ songId, ok: false, message: 'Could not load playlists' });
    }
  };

  const confirmAdd = async (playlistId) => {
    const songId = addingToPlaylist;
    try {
      await musicService.addToPlaylist(playlistId, songId);
      setAddingToPlaylist(null);
      setAddFeedback({ songId, ok: true, message: 'Added to playlist' });
      setTimeout(() => setAddFeedback((f) => (f?.songId === songId ? null : f)), 2000);
    } catch (err) {
      console.error(err);
      setAddFeedback({ songId, ok: false, message: 'Add failed' });
    }
  };

  const handleRemove = async (song) => {
    if (!onRemoveSong || !song) return;
    setRemovingId(song.id);
    try {
      await onRemoveSong(song);
    } catch (err) {
      console.error(err);
    } finally {
      setRemovingId(null);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setSelectedGenre('');
  };

  const emptyMessage = () => {
    if (!songs || songs.length === 0) {
      return (
        <>
          <p style={{ margin: '0 0 6px' }}>No songs in this list yet</p>
          <p style={{ margin: 0, fontSize: '0.9em', opacity: 0.85 }}>
            Upload from Artist Hub, or wait for catalog seeds. Empty here means the API returned no tracks — not a player bug.
          </p>
        </>
      );
    }
    if (hasActiveFilter) {
      return (
        <>
          <p style={{ margin: '0 0 6px' }}>No songs match this search or genre filter</p>
          <p style={{ margin: 0, fontSize: '0.9em', opacity: 0.85 }}>
            {songs.length} track{songs.length === 1 ? '' : 's'} available — clear filters to see them all.
          </p>
          <button
            type="button"
            className="song-action-btn"
            onClick={clearFilters}
            style={{ marginTop: 10, padding: '6px 12px' }}
          >
            Clear filters
          </button>
        </>
      );
    }
    return <p style={{ margin: 0 }}>No songs to show</p>;
  };

  return (
    <div className="song-list-container">
      {title && <h2 className="song-list-title">{title}</h2>}
      {showSearch && (
        <div className="song-list-filters">
          <input
            type="search"
            className="song-search"
            placeholder="Search songs…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search songs"
          />
          {genres.length > 0 && (
            <select
              className="song-genre-filter"
              value={selectedGenre}
              onChange={(e) => setSelectedGenre(e.target.value)}
              aria-label="Filter by genre"
            >
              <option value="">All genres</option>
              {genres.map((g) => (
                <option key={g} value={g}>{g}</option>)
              )}
            </select>
          )}
        </div>
      )}
      <div className="song-list" role="list">
        {filtered.length === 0 ? (
          <div className="song-list-empty" role="status">
            {emptyMessage()}
          </div>
        ) : (
          filtered.map((song, index) => (
            <div
              key={song.id}
              className={`song-row ${currentSong?.id === song.id ? 'playing' : ''}`}
              role="listitem"
            >
              <div
                className="song-info"
                onClick={() => handlePlay(index)}
                style={{ cursor: 'pointer' }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handlePlay(index);
                  }
                }}
                aria-label={`Play ${song.title} by ${song.artist || 'Unknown'}`}
              >
                <div className="song-title">
                  {currentSong?.id === song.id && isPlaying ? '▶ ' : ''}
                  {song.title}
                </div>
                <div className="song-artist">{song.artist} {song.genre && <span className="song-genre">{song.genre}</span>}</div>
              </div>
              <div className="song-meta">
                {song.year && <span className="song-year">{song.year}</span>}
                <span className="song-duration">{formatDuration(song.duration)}</span>
              </div>
              <div className="song-actions">
                <button
                  type="button"
                  className="song-action-btn"
                  onClick={() => handlePlay(index)}
                  title="Play"
                  aria-label={`Play ${song.title}`}
                >
                  <svg fill="currentColor" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                </button>
                <button
                  type="button"
                  className="song-action-btn"
                  onClick={() => handleAddToQueue(song)}
                  title="Add to queue"
                  aria-label={`Add ${song.title} to queue`}
                >
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} width="18" height="18" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="song-action-btn"
                  onClick={() => handlePlayNext(song)}
                  title="Play next"
                  aria-label={`Play ${song.title} next`}
                >
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} width="18" height="18" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 5.25v13.5" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="song-action-btn"
                  onClick={() => handleAddToPlaylist(song.id)}
                  title="Add to playlist"
                  aria-label={`Add ${song.title} to playlist`}
                >
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} width="18" height="18" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
                </button>
                {onRemoveSong && (
                  <button
                    type="button"
                    className="song-action-btn"
                    onClick={() => handleRemove(song)}
                    disabled={removingId === song.id}
                    title="Remove from playlist"
                    aria-label={`Remove ${song.title} from playlist`}
                    style={{ color: removingId === song.id ? '#999' : '#c62828' }}
                  >
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} width="18" height="18" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>

              {addingToPlaylist === song.id && (
                <div className="playlist-popup" role="dialog" aria-label="Add to playlist">
                  <div className="playlist-popup-header">
                    <span>Add to playlist</span>
                    <button type="button" onClick={() => setAddingToPlaylist(null)} aria-label="Close playlist picker">x</button>
                  </div>
                  {(playlists.length === 0) && (
                    <div className="playlist-popup-item" style={{ opacity: 0.7 }}>No playlists yet</div>
                  )}
                  {playlists.map(pl => (
                    <button key={pl.id} type="button" className="playlist-popup-item" onClick={() => confirmAdd(pl.id)}>
                      {pl.name}
                    </button>
                  ))}
                </div>
              )}

              {addFeedback?.songId === song.id && (
                <div
                  className="playlist-add-feedback"
                  role="status"
                  style={{
                    fontSize: '0.75rem',
                    marginTop: 4,
                    color: addFeedback.ok ? '#2e7d32' : '#c62828',
                  }}
                >
                  {addFeedback.message}
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
