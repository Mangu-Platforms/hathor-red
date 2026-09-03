import React, { createContext, useContext, useState, useCallback } from 'react';

const PlayerContext = createContext();

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used within a PlayerProvider');
  return context;
};

/** Emergency stub — full PlayerContext must be restored from commit a5f53df9. */
export const PlayerProvider = ({ children }) => {
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isShuffled, setIsShuffled] = useState(false);
  const [repeatMode, setRepeatMode] = useState('none');
  const [audioSrc, setAudioSrc] = useState(null);
  const [loudnessGain] = useState(1);
  const [waveform] = useState(null);

  const noop = useCallback(() => {}, []);
  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const value = {
    currentSong, isPlaying, volume, playbackSpeed,
    progress, duration, queue, queueIndex, isShuffled, repeatMode, audioSrc,
    loudnessGain, waveform,
    play: noop, pause: noop, togglePlay: noop, seek: noop,
    playNext: noop, playPrevious: noop, playAtIndex: noop,
    removeFromQueue: noop, clearQueue: noop, moveInQueue: noop, addToQueue: noop,
    setQueueAndPlay: noop, loadSong: async () => {},
    setVolume: (v) => {
      const next = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
      setVolume(next);
    },
    setPlaybackSpeed: (s) => {
      const next = Number.isFinite(s) && s > 0 ? Math.max(0.5, Math.min(2, s)) : 1;
      setPlaybackSpeed(next);
    },
    toggleShuffle: () => setIsShuffled((p) => !p),
    cycleRepeat: () => setRepeatMode((prev) => (prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none')),
    formatTime,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
