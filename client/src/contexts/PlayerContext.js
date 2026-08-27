import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';
import { mediaService } from '../services/olympus';
import { recordEvent, flushEvents } from '../services/telemetry';

const PlayerContext = createContext();

// ITU-R BS.1770 loudness normalization target (Spotify/YouTube ballpark).
const TARGET_LUFS = -14;

function fisherYatesShuffle(length) {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = order[i];
    order[i] = order[j];
    order[j] = tmp;
  }
  return order;
}

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
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shuffleOrder, setShuffleOrder] = useState([]);
  const [shufflePos, setShufflePos] = useState(0);
  const [isShuffled, setIsShuffled] = useState(false);
  const [repeatMode, setRepeatMode] = useState('none');
  const [audioSrc, setAudioSrc] = useState(null);
  const [loudnessGain, setLoudnessGain] = useState(1);
  const [waveform, setWaveform] = useState(null);

  const audioRef = useRef(new Audio());
  const preloadRef = useRef(null);
  const progressInterval = useRef(null);
  const lastSegmentRef = useRef(-1);
  // Avoid overlapping play() calls while a load is in flight
  const playGeneration = useRef(0);

  const audio = audioRef.current;

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
    const gen = ++playGeneration.current;
    try {
      const { url } = await musicService.getStreamUrl(song.id);
      if (gen !== playGeneration.current) return; // superseded
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
      throw err;
    }
  }, [audio, applyLoudness]);

  const play = useCallback(async () => {
    try {
      if (!audio.src && currentSong) {
        await loadSong(currentSong);
      }
      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      // Autoplay policy or aborted load — leave paused
      console.error('Play error:', err);
      setIsPlaying(false);
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
    const d = audio.duration;
    if (!Number.isFinite(time) || time < 0) return;
    if (!Number.isFinite(d) || d <= 0) return;
    const clamped = Math.min(time, d);
    audio.currentTime = clamped;
    setProgress(clamped);
    if (currentSong) recordEvent('seek', currentSong, clamped);
  }, [audio, currentSong]);

  const resolveNextIndex = useCallback(() => {
    if (queue.length === 0) return null;
    if (isShuffled && shuffleOrder.length === queue.length) {
      const nextPos = (shufflePos + 1) % shuffleOrder.length;
      return { index: shuffleOrder[nextPos], shufflePos: nextPos };
    }
    return { index: (queueIndex + 1) % queue.length, shufflePos };
  }, [queue, queueIndex, isShuffled, shuffleOrder, shufflePos]);

  const playNext = useCallback(async () => {
    if (queue.length === 0) return;
    if (currentSong && audio.currentTime > 0 && audio.currentTime < (audio.duration || Infinity) - 1) {
      recordEvent('skip', currentSong, audio.currentTime);
    }
    const next = resolveNextIndex();
    if (next == null) return;
    setQueueIndex(next.index);
    if (isShuffled) setShufflePos(next.shufflePos);
    try {
      await loadSong(queue[next.index]);
      await audio.play();
      setIsPlaying(true);
      preloadNext(queue, next.index);
    } catch (err) {
      setIsPlaying(false);
    }
  }, [queue, resolveNextIndex, isShuffled, loadSong, audio, currentSong, preloadNext]);

  const playPrevious = useCallback(async () => {
    if (queue.length === 0) return;
    let prevIndex;
    let nextShufflePos = shufflePos;
    if (isShuffled && shuffleOrder.length === queue.length) {
      nextShufflePos = shufflePos > 0 ? shufflePos - 1 : shuffleOrder.length - 1;
      prevIndex = shuffleOrder[nextShufflePos];
      setShufflePos(nextShufflePos);
    } else {
      prevIndex = queueIndex > 0 ? queueIndex - 1 : queue.length - 1;
    }
    setQueueIndex(prevIndex);
    try {
      await loadSong(queue[prevIndex]);
      await audio.play();
      setIsPlaying(true);
      preloadNext(queue, prevIndex);
    } catch (err) {
      setIsPlaying(false);
    }
  }, [queue, queueIndex, isShuffled, shuffleOrder, shufflePos, loadSong, audio, preloadNext]);

  useEffect(() => {
    const handleEnded = () => {
      if (currentSong) {
        recordEvent('complete', currentSong, audio.duration || duration, {
          durationMs: Math.round((audio.duration || duration || 0) * 1000),
        });
      }
      if (repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
      } else if (queueIndex < queue.length - 1 || repeatMode === 'all' || isShuffled) {
        playNext();
      } else {
        setIsPlaying(false);
        setProgress(0);
        flushEvents();
      }
    };
    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, [queue, queueIndex, repeatMode, audio, currentSong, duration, playNext, isShuffled]);

  const setQueueAndPlay = useCallback(async (songs, startIndex = 0) => {
    if (!songs || songs.length === 0) return;
    const safeStart = Math.max(0, Math.min(startIndex, songs.length - 1));
    setQueue(songs);
    setQueueIndex(safeStart);
    const order = fisherYatesShuffle(songs.length);
    // Put start index first in shuffle path when user enables shuffle later
    setShuffleOrder(order);
    const posInOrder = order.indexOf(safeStart);
    setShufflePos(posInOrder >= 0 ? posInOrder : 0);
    try {
      await loadSong(songs[safeStart]);
      await audio.play();
      setIsPlaying(true);
      preloadNext(songs, safeStart);
    } catch (err) {
      setIsPlaying(false);
    }
  }, [loadSong, audio, preloadNext]);

  const toggleShuffle = useCallback(() => {
    setIsShuffled((prev) => {
      const next = !prev;
      if (next && queue.length > 0) {
        const order = fisherYatesShuffle(queue.length);
        // Keep current track as current position in the permutation
        const at = order.indexOf(queueIndex);
        if (at > 0) {
          const tmp = order[0];
          order[0] = order[at];
          order[at] = tmp;
        } else if (at < 0) {
          order[0] = queueIndex;
        }
        setShuffleOrder(order);
        setShufflePos(0);
      }
      return next;
    });
  }, [queue, queueIndex]);

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
    play, pause, togglePlay, seek, playNext, playPrevious,
    setQueueAndPlay, loadSong,
    setVolume, setPlaybackSpeed,
    toggleShuffle,
    cycleRepeat: () => setRepeatMode(prev => prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none'),
    formatTime,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
