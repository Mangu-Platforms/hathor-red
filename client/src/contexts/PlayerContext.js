import React, { createContext, useContext } from 'react';

const PlayerContext = createContext(null);

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used within a PlayerProvider');
  return context;
};

/** Emergency stub after accidental truncate. Restore full PlayerContext from commit 0149d0e7d4f720ad3eaaa2bfcc65ab21bd251465 then re-apply dose-1.120 (keyboard M mute). */
export const PlayerProvider = ({ children }) => {
  const noop = () => {};
  const value = {
    currentSong: null,
    isPlaying: false,
    volume: 1,
    playbackSpeed: 1,
    progress: 0,
    duration: 0,
    queue: [],
    queueIndex: 0,
    isShuffled: false,
    repeatMode: 'none',
    audioSrc: null,
    loudnessGain: 1,
    waveform: null,
    play: noop,
    pause: noop,
    togglePlay: noop,
    seek: noop,
    playNext: noop,
    playPrevious: noop,
    loadSong: async () => {},
    clearQueue: noop,
    addToQueue: noop,
    setQueueAndPlay: async () => {},
    setVolume: noop,
    setPlaybackSpeed: noop,
    toggleMute: noop,
    toggleShuffle: noop,
    cycleRepeat: noop,
    formatTime: (sec) => {
      if (!Number.isFinite(sec) || sec < 0) return '0:00';
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
    },
    removeFromQueue: noop,
    moveInQueue: noop,
    insertNext: noop,
    playAtIndex: async () => {},
  };
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
