import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';
import { useAuth } from './AuthContext';

const PlayerContext = createContext();

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used within a PlayerProvider');
  return context;
};

/** Temporary stub after accidental truncate — full restore required. */
export const PlayerProvider = ({ children }) => {
  const audioRef = useRef(typeof Audio !== 'undefined' ? new Audio() : { play: async () => {}, pause: () => {}, addEventListener: () => {}, removeEventListener: () => {}, removeAttribute: () => {}, load: () => {}, currentTime: 0, volume: 1, playbackRate: 1, src: '' });
  const value = {
    currentSong: null, isPlaying: false, volume: 1, playbackSpeed: 1, progress: 0, duration: 0,
    queue: [], queueIndex: 0, isShuffled: false, repeatMode: 'none', audioSrc: null,
    loudnessGain: 1, waveform: null,
    play: async () => {}, pause: () => {}, togglePlay: () => {}, seek: () => {},
    playNext: async () => {}, playPrevious: async () => {}, playAtIndex: async () => {},
    removeFromQueue: () => {}, clearQueue: () => {}, moveInQueue: () => {}, addToQueue: () => {},
    setQueueAndPlay: async () => {}, loadSong: async () => {},
    setVolume: () => {}, setPlaybackSpeed: () => {}, toggleMute: () => {}, toggleShuffle: () => {},
    cycleRepeat: () => {}, formatTime: (sec) => {
      if (!Number.isFinite(sec) || sec < 0) return '0:00';
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
    },
  };
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
