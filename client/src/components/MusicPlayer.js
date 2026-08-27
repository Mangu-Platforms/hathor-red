import React, { useState } from 'react';
import { usePlayer } from '../contexts/PlayerContext';

const MusicPlayer = () => {
  const {
    currentSong, isPlaying, togglePlay, progress, duration, volume,
    setVolume, playbackSpeed, setPlaybackSpeed, playNext, playPrevious,
    isShuffled, toggleShuffle, repeatMode, cycleRepeat, seek, formatTime,
    queue, queueIndex, playAtIndex,
  } = usePlayer();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showQueue, setShowQueue] = useState(false);

  if (!currentSong) return null;

  const progressPercent = duration && Number.isFinite(duration) ? (progress / duration) * 100 : 0;

  const handleSeekBar = (e) => {
    if (!duration || !Number.isFinite(duration) || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    if (!Number.isFinite(pct)) return;
    seek(pct * duration);
  };

  return (
    <div className="music-player">
      <div className="player-progress-bar" onClick={handleSeekBar}>
        <div className="player-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="player-main">
        <div className="player-song-info">
          <div className="player-cover">
            {currentSong.cover_url ? (
              <img src={currentSong.cover_url} alt={currentSong.title} />
            ) : (
              <div className="player-cover-placeholder">{currentSong.title?.[0]}</div>
            )}
          </div>
          <div className="player-text">
            <div className="player-title">{currentSong.title}</div>
            <div className="player-artist">{currentSong.artist}</div>
          </div>
        </div>

        <div className="player-controls">
          <button className={`player-btn ${isShuffled ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" /></svg>
          </button>
          <button className="player-btn" onClick={playPrevious}>
            <svg fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
          </button>
          <button className="player-btn play-btn" onClick={togglePlay}>
            {isPlaying ? (
              <svg fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            ) : (
              <svg fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <button className="player-btn" onClick={playNext}>
            <svg fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
          </button>
          <button className={`player-btn ${repeatMode !== 'none' ? 'active' : ''}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3" /></svg>
            {repeatMode === 'one' && <span className="repeat-badge">1</span>}
          </button>
        </div>

        <div className="player-extras">
          <span className="player-time">{formatTime(progress)} / {formatTime(duration)}</span>
          <div className="player-volume">
            <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" /></svg>
            <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(parseFloat(e.target.value))} />
          </div>
          <button
            className={`player-btn ${showQueue ? 'active' : ''}`}
            onClick={() => { setShowQueue((v) => !v); setShowAdvanced(false); }}
            title="Queue"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
            </svg>
            {queue.length > 0 && <span className="queue-count-badge">{queue.length}</span>}
          </button>
          <button className="player-btn" onClick={() => { setShowAdvanced(!showAdvanced); setShowQueue(false); }} title="Playback speed">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
        </div>
      </div>

      {showAdvanced && (
        <div className="player-advanced">
          <div className="player-control-group">
            <label>Speed: {playbackSpeed.toFixed(2)}x</label>
            <input type="range" min="0.5" max="2" step="0.05" value={playbackSpeed} onChange={e => setPlaybackSpeed(parseFloat(e.target.value))} />
          </div>
          {/* Pitch shift and stem toggles intentionally omitted — not implemented on the audio graph */}
        </div>
      )}

      {showQueue && (
        <div className="player-queue-panel" role="listbox" aria-label="Play queue">
          <div className="player-queue-header">
            <span>Up next ({queue.length})</span>
            <button type="button" className="player-btn" onClick={() => setShowQueue(false)} title="Close queue">
              <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {queue.length === 0 ? (
            <div className="player-queue-empty">Queue is empty</div>
          ) : (
            <ul className="player-queue-list">
              {queue.map((song, idx) => (
                <li key={`${song.id}-${idx}`}>
                  <button
                    type="button"
                    className={`player-queue-item ${idx === queueIndex ? 'active' : ''}`}
                    onClick={() => playAtIndex(idx)}
                  >
                    <span className="player-queue-num">{idx + 1}</span>
                    <span className="player-queue-meta">
                      <span className="player-queue-title">{song.title}</span>
                      <span className="player-queue-artist">{song.artist}</span>
                    </span>
                    {idx === queueIndex && isPlaying && (
                      <span className="player-queue-now" aria-label="Now playing">▶</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default MusicPlayer;
