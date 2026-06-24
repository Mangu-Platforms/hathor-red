import React, { useState } from 'react';
import { usePlayer } from '../contexts/PlayerContext';

const MusicPlayer = () => {
  const {
    currentSong, isPlaying, togglePlay, progress, duration, volume,
    setVolume, playbackSpeed, setPlaybackSpeed, playNext, playPrevious,
    isShuffled, toggleShuffle, repeatMode, cycleRepeat, seek, formatTime,
    stemsConfig, toggleStem, pitchShift, setPitchShift,
  } = usePlayer();

  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!currentSong) return null;

  const progressPercent = duration ? (progress / duration) * 100 : 0;

  return (
    <div className="music-player">
      <div className="player-progress-bar" onClick={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        seek(pct * duration);
      }}>
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
          <button className="player-btn" onClick={() => setShowAdvanced(!showAdvanced)} title="Advanced controls">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.43.816 1.035.796 1.727 0 1.071-.684 2.015-1.68 2.362" /></svg>
          </button>
        </div>
      </div>

      {showAdvanced && (
        <div className="player-advanced">
          <div className="player-control-group">
            <label>Speed: {playbackSpeed.toFixed(2)}x</label>
            <input type="range" min="0.5" max="2" step="0.05" value={playbackSpeed} onChange={e => setPlaybackSpeed(parseFloat(e.target.value))} />
          </div>
          <div className="player-control-group">
            <label>Pitch: {pitchShift > 0 ? '+' : ''}{pitchShift}</label>
            <input type="range" min="-12" max="12" step="1" value={pitchShift} onChange={e => setPitchShift(parseInt(e.target.value))} />
          </div>
          <div className="player-stems">
            {Object.entries(stemsConfig).map(([stem, active]) => (
              <button key={stem} className={`stem-btn ${active ? 'active' : ''}`} onClick={() => toggleStem(stem)}>
                {stem.charAt(0).toUpperCase() + stem.slice(1)}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default MusicPlayer;
