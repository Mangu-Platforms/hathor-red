import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';

const PlayerContext = createContext();

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used within a PlayerProvider');
  return context;
};

export const PlayerProvider = ({ children }) => {
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [pitchShift, setPitchShift] = useState(0);
  const [stemsConfig, setStemsConfig] = useState({ vocals: true, drums: true, bass: true, other: true });
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isShuffled, setIsShuffled] = useState(false);
  const [repeatMode, setRepeatMode] = useState('none');
  const [audioSrc, setAudioSrc] = useState(null);

  const audioRef = useRef(new Audio());
  const progressInterval = useRef(null);

  const audio = audioRef.current;

  useEffect(() => {
    audio.volume = volume;
  }, [volume, audio]);

  useEffect(() => {
    audio.playbackRate = playbackSpeed;
  }, [playbackSpeed, audio]);

  useEffect(() => {
    const handleEnded = () => {
      if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play();
      } else if (queueIndex < queue.length - 1 || repeatMode === 'all') {
        playNext();
      } else {
        setIsPlaying(false);
        setProgress(0);
      }
    };
    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, [queue, queueIndex, repeatMode, audio]);

  useEffect(() => {
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        setProgress(audio.currentTime);
        setDuration(audio.duration || 0);
      }, 250);
    } else {
      clearInterval(progressInterval.current);
    }
    return () => clearInterval(progressInterval.current);
  }, [isPlaying, audio]);

  const loadSong = useCallback(async (song) => {
    try {
      const { url } = await musicService.getStreamUrl(song.id);
      setAudioSrc(url);
      audio.src = url;
      setCurrentSong(song);
      setProgress(0);
      setDuration(song.duration || 0);

      await musicService.recordListening(song.id, 0);
    } catch (err) {
      console.error('Failed to load song:', err);
    }
  }, [audio]);

  const play = useCallback(async () => {
    if (!audio.src && currentSong) {
      await loadSong(currentSong);
    }
    try {
      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.error('Play error:', err);
    }
  }, [audio, currentSong, loadSong]);

  const pause = useCallback(() => {
    audio.pause();
    setIsPlaying(false);
  }, [audio]);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const seek = useCallback((time) => {
    audio.currentTime = time;
    setProgress(time);
  }, [audio]);

  const playNext = useCallback(() => {
    if (queue.length === 0) return;
    let nextIndex;
    if (isShuffled) {
      nextIndex = Math.floor(Math.random() * queue.length);
    } else {
      nextIndex = (queueIndex + 1) % queue.length;
    }
    setQueueIndex(nextIndex);
    loadSong(queue[nextIndex]);
    setIsPlaying(true);
    setTimeout(() => audio.play(), 100);
  }, [queue, queueIndex, isShuffled, loadSong, audio]);

  const playPrevious = useCallback(() => {
    if (queue.length === 0) return;
    const prevIndex = queueIndex > 0 ? queueIndex - 1 : queue.length - 1;
    setQueueIndex(prevIndex);
    loadSong(queue[prevIndex]);
    setIsPlaying(true);
    setTimeout(() => audio.play(), 100);
  }, [queue, queueIndex, loadSong, audio]);

  const setQueueAndPlay = useCallback((songs, startIndex = 0) => {
    setQueue(songs);
    setQueueIndex(startIndex);
    loadSong(songs[startIndex]);
    setIsPlaying(true);
    setTimeout(() => audio.play(), 100);
  }, [loadSong, audio]);

  const toggleStem = useCallback((stem) => {
    setStemsConfig(prev => ({ ...prev, [stem]: !prev[stem] }));
  }, []);

  const formatTime = (seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const value = {
    currentSong, isPlaying, volume, playbackSpeed, pitchShift, stemsConfig,
    progress, duration, queue, queueIndex, isShuffled, repeatMode, audioSrc,
    play, pause, togglePlay, seek, playNext, playPrevious,
    setQueueAndPlay, loadSong,
    setVolume, setPlaybackSpeed, setPitchShift,
    toggleStem, toggleShuffle: () => setIsShuffled(!isShuffled),
    cycleRepeat: () => setRepeatMode(prev => prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none'),
    formatTime,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
