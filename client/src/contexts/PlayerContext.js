import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';
import { mediaService } from '../services/olympus';
import { recordEvent, flushEvents } from '../services/telemetry';

const PlayerContext = createContext();

// ITU-R BS.1770 loudness normalization target (Spotify/YouTube ballpark).
const TARGET_LUFS = -14;

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
  const [loudnessGain, setLoudnessGain] = useState(1);
  const [waveform, setWaveform] = useState(null);

  const audioRef = useRef(new Audio());
  const preloadRef = useRef(null);
  const progressInterval = useRef(null);
  const lastSegmentRef = useRef(-1);

  const audio = audioRef.current;

  // Effective volume = user volume × loudness-normalization gain, so quiet
  // masters come up and hot masters come down toward the same target.
  useEffect(() => {
    audio.volume = Math.max(0, Math.min(1, volume * loudnessGain));
  }, [volume, loudnessGain, audio]);

  useEffect(() => {
    audio.playbackRate = playbackSpeed;
  }, [playbackSpeed, audio]);

  useEffect(() => {
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        setProgress(audio.currentTime);
        setDuration(audio.duration || 0);

        // 10-second listening heartbeats feed the retention curve (ANA-02).
        const segment = Math.floor(audio.currentTime / 10);
        if (segment !== lastSegmentRef.current && currentSong) {
          lastSegmentRef.current = segment;
          recordEvent('segment', currentSong, audio.currentTime, { durationMs: 10000 });
        }
      }, 250);
    } else {
      clearInterval(progressInterval.current);
    }
    return () => clearInterval(progressInterval.current);
  }, [isPlaying, audio, currentSong]);

  const applyLoudness = useCallback(async (song) => {
    setWaveform(null);
    setLoudnessGain(1);
    try {
      const data = await mediaService.getWaveform(song.id);
      if (data?.waveform) setWaveform(data.waveform);
      if (typeof data?.loudnessLufs === 'number') {
        const gain = Math.pow(10, (TARGET_LUFS - data.loudnessLufs) / 20);
        setLoudnessGain(Math.max(0.3, Math.min(1, gain)));
      }
    } catch (err) {
      // No pipeline data yet — play at unity gain.
    }
  }, []);

  // Prefetch the next queue entry so track changes start from a warm buffer
  // (gapless-adjacent; true crossfade needs Web Audio and is a next step).
  const preloadNext = useCallback(async (songs, index) => {
    try {
      if (!songs || songs.length < 2) return;
      const next = songs[(index + 1) % songs.length];
      if (!next || next.id === songs[index]?.id) return;
      const { url } = await musicService.getStreamUrl(next.id);
      if (!preloadRef.current) preloadRef.current = new Audio();
      preloadRef.current.preload = 'auto';
      preloadRef.current.src = url;
    } catch (err) {
      // Preload is opportunistic only.
    }
  }, []);

  const loadSong = useCallback(async (song) => {
    try {
      const { url } = await musicService.getStreamUrl(song.id);
      setAudioSrc(url);
      audio.src = url;
      setCurrentSong(song);
      setProgress(0);
      setDuration(song.duration || 0);
      lastSegmentRef.current = -1;

      recordEvent('play', song, 0);
      applyLoudness(song);
      await musicService.recordListening(song.id, 0);
    } catch (err) {
      console.error('Failed to load song:', err);
    }
  }, [audio, applyLoudness]);

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
    if (currentSong) recordEvent('pause', currentSong, audio.currentTime);
  }, [audio, currentSong]);

  const togglePlay = useCallback(() => {
    if (isPlaying) pause();
    else play();
  }, [isPlaying, pause, play]);

  const seek = useCallback((time) => {
    audio.currentTime = time;
    setProgress(time);
    if (currentSong) recordEvent('seek', currentSong, time);
  }, [audio, currentSong]);

  const playNext = useCallback(() => {
    if (queue.length === 0) return;
    if (currentSong && audio.currentTime > 0 && audio.currentTime < (audio.duration || Infinity) - 1) {
      recordEvent('skip', currentSong, audio.currentTime);
    }
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
    preloadNext(queue, nextIndex);
  }, [queue, queueIndex, isShuffled, loadSong, audio, currentSong, preloadNext]);

  const playPrevious = useCallback(() => {
    if (queue.length === 0) return;
    const prevIndex = queueIndex > 0 ? queueIndex - 1 : queue.length - 1;
    setQueueIndex(prevIndex);
    loadSong(queue[prevIndex]);
    setIsPlaying(true);
    setTimeout(() => audio.play(), 100);
    preloadNext(queue, prevIndex);
  }, [queue, queueIndex, loadSong, audio, preloadNext]);

  useEffect(() => {
    const handleEnded = () => {
      if (currentSong) {
        recordEvent('complete', currentSong, audio.duration || duration, {
          durationMs: Math.round((audio.duration || duration || 0) * 1000),
        });
      }
      if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play();
      } else if (queueIndex < queue.length - 1 || repeatMode === 'all') {
        playNext();
      } else {
        setIsPlaying(false);
        setProgress(0);
        flushEvents();
      }
    };
    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, [queue, queueIndex, repeatMode, audio, currentSong, duration, playNext]);

  const setQueueAndPlay = useCallback((songs, startIndex = 0) => {
    setQueue(songs);
    setQueueIndex(startIndex);
    loadSong(songs[startIndex]);
    setIsPlaying(true);
    setTimeout(() => audio.play(), 100);
    preloadNext(songs, startIndex);
  }, [loadSong, audio, preloadNext]);

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
    loudnessGain, waveform,
    play, pause, togglePlay, seek, playNext, playPrevious,
    setQueueAndPlay, loadSong,
    setVolume, setPlaybackSpeed, setPitchShift,
    toggleStem, toggleShuffle: () => setIsShuffled(!isShuffled),
    cycleRepeat: () => setRepeatMode(prev => prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none'),
    formatTime,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
