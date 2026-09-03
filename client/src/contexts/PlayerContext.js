import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';
import { useAuth } from './AuthContext';

const PlayerContext = createContext();

const PREV_RESTART_THRESHOLD_SEC = 3;

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

function remapShuffleAfterRemove(shuffleOrder, removed) {
  return shuffleOrder.filter((i) => i !== removed).map((i) => (i > removed ? i - 1 : i));
}

function safeSetCurrentTime(audio, time) {
  if (!Number.isFinite(time) || time < 0) return;
  try {
    audio.currentTime = time;
  } catch (_) {
    /* ignore seek on unloaded media */
  }
}

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (!context) throw new Error('usePlayer must be used within a PlayerProvider');
  return context;
};

export const PlayerProvider = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const [currentSong, setCurrentSong] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [shuffleOrder, setShuffleOrder] = useState([]);
  const [shufflePos, setShufflePos] = useState(0);
  const [isShuffled, setIsShuffled] = useState(false);
  const [repeatMode, setRepeatMode] = useState('none');
  const [audioSrc, setAudioSrc] = useState(null);

  const audioRef = useRef(
    typeof Audio !== 'undefined'
      ? new Audio()
      : {
          currentTime: 0,
          duration: 0,
          paused: true,
          volume: 1,
          playbackRate: 1,
          src: '',
          ended: false,
          readyState: 0,
          play: async () => {},
          pause: () => {},
          load: () => {},
          addEventListener: () => {},
          removeEventListener: () => {},
          removeAttribute: () => {},
        }
  );
  const progressInterval = useRef(null);
  const playGeneration = useRef(0);
  const isPlayingRef = useRef(false);
  const queueRef = useRef(queue);
  const queueIndexRef = useRef(queueIndex);
  const isShuffledRef = useRef(isShuffled);
  const shuffleOrderRef = useRef(shuffleOrder);
  const shufflePosRef = useRef(shufflePos);
  const repeatModeRef = useRef(repeatMode);
  const currentSongRef = useRef(currentSong);
  const audio = audioRef.current;

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
  useEffect(() => { isShuffledRef.current = isShuffled; }, [isShuffled]);
  useEffect(() => { shuffleOrderRef.current = shuffleOrder; }, [shuffleOrder]);
  useEffect(() => { shufflePosRef.current = shufflePos; }, [shufflePos]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { currentSongRef.current = currentSong; }, [currentSong]);

  useEffect(() => {
    const v = Number.isFinite(volume) ? volume : 1;
    audio.volume = Math.max(0, Math.min(1, v));
  }, [volume, audio]);

  useEffect(() => {
    const s = Number.isFinite(playbackSpeed) && playbackSpeed > 0 ? playbackSpeed : 1;
    audio.playbackRate = Math.max(0.5, Math.min(2, s));
  }, [playbackSpeed, audio]);

  useEffect(() => {
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        const t = audio.currentTime;
        const d = audio.duration;
        setProgress(Number.isFinite(t) ? t : 0);
        setDuration(Number.isFinite(d) && d > 0 ? d : 0);
      }, 250);
    } else {
      clearInterval(progressInterval.current);
    }
    return () => clearInterval(progressInterval.current);
  }, [isPlaying, audio]);

  const loadSong = useCallback(async (song, { autoplay = true, startAt = 0 } = {}) => {
    if (!song || song.id == null) return;
    const gen = ++playGeneration.current;
    setCurrentSong(song);
    setProgress(Number.isFinite(startAt) ? startAt : 0);
    setDuration(Number.isFinite(song.duration) ? Number(song.duration) : 0);
    try {
      const data = await musicService.getStreamUrl(song.id);
      if (gen !== playGeneration.current) return;
      const url = data?.url;
      if (!url) throw new Error('No stream URL');
      setAudioSrc(url);
      audio.src = url;
      audio.load();
      const onMeta = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
        if (Number.isFinite(startAt) && startAt > 0) safeSetCurrentTime(audio, startAt);
      };
      audio.addEventListener('loadedmetadata', onMeta, { once: true });
      if (autoplay) {
        try {
          await audio.play();
          if (gen === playGeneration.current) setIsPlaying(true);
        } catch (err) {
          console.warn('autoplay blocked or failed', err);
          setIsPlaying(false);
        }
      } else {
        setIsPlaying(false);
      }
    } catch (err) {
      console.error('loadSong failed', err);
      setIsPlaying(false);
      setAudioSrc(null);
    }
  }, [audio]);

  const play = useCallback(async () => {
    if (!currentSongRef.current) return;
    try {
      if (!audio.src && currentSongRef.current) {
        await loadSong(currentSongRef.current, { autoplay: true, startAt: audio.currentTime || 0 });
        return;
      }
      await audio.play();
      setIsPlaying(true);
    } catch (err) {
      console.warn('play failed', err);
      setIsPlaying(false);
    }
  }, [audio, loadSong]);

  const pause = useCallback(() => {
    audio.pause();
    setIsPlaying(false);
  }, [audio]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [pause, play]);

  const seek = useCallback((time) => {
    if (!Number.isFinite(time)) return;
    const d = audio.duration;
    const clamped = Number.isFinite(d) && d > 0 ? Math.max(0, Math.min(d, time)) : Math.max(0, time);
    safeSetCurrentTime(audio, clamped);
    setProgress(clamped);
  }, [audio]);

  const playAtIndex = useCallback(
    async (index) => {
      const q = queueRef.current;
      if (!q.length || index < 0 || index >= q.length) return;
      setQueueIndex(index);
      if (isShuffledRef.current) {
        const order = shuffleOrderRef.current;
        const pos = order.indexOf(index);
        if (pos >= 0) setShufflePos(pos);
      }
      await loadSong(q[index], { autoplay: true });
    },
    [loadSong]
  );

  const playNext = useCallback(async () => {
    const q = queueRef.current;
    if (!q.length) return;
    const mode = repeatModeRef.current;
    if (mode === 'one' && currentSongRef.current) {
      safeSetCurrentTime(audio, 0);
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (_) {
        setIsPlaying(false);
      }
      return;
    }
    if (isShuffledRef.current) {
      const order = shuffleOrderRef.current;
      let pos = shufflePosRef.current + 1;
      if (pos >= order.length) {
        if (mode === 'all') {
          const nextOrder = fisherYatesShuffle(q.length);
          setShuffleOrder(nextOrder);
          setShufflePos(0);
          await playAtIndex(nextOrder[0]);
        }
        return;
      }
      setShufflePos(pos);
      await playAtIndex(order[pos]);
      return;
    }
    const next = queueIndexRef.current + 1;
    if (next < q.length) {
      await playAtIndex(next);
    } else if (mode === 'all') {
      await playAtIndex(0);
    }
  }, [audio, playAtIndex]);

  const playPrevious = useCallback(async () => {
    const t = audio.currentTime;
    if (Number.isFinite(t) && t > PREV_RESTART_THRESHOLD_SEC) {
      safeSetCurrentTime(audio, 0);
      setProgress(0);
      return;
    }
    const q = queueRef.current;
    if (!q.length) return;
    if (isShuffledRef.current) {
      const order = shuffleOrderRef.current;
      let pos = shufflePosRef.current - 1;
      if (pos < 0) pos = 0;
      setShufflePos(pos);
      await playAtIndex(order[pos]);
      return;
    }
    const prev = Math.max(0, queueIndexRef.current - 1);
    await playAtIndex(prev);
  }, [audio, playAtIndex]);

  useEffect(() => {
    const onEnded = () => {
      playNext();
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [audio, playNext]);

  const setQueueAndPlay = useCallback(
    async (songs, startIndex = 0) => {
      const list = Array.isArray(songs) ? songs.filter(Boolean) : [];
      setQueue(list);
      setQueueIndex(startIndex);
      if (isShuffledRef.current && list.length) {
        const order = fisherYatesShuffle(list.length);
        setShuffleOrder(order);
        const pos = order.indexOf(startIndex);
        setShufflePos(pos >= 0 ? pos : 0);
        await loadSong(list[startIndex], { autoplay: true });
      } else if (list[startIndex]) {
        await loadSong(list[startIndex], { autoplay: true });
      }
    },
    [loadSong]
  );

  const addToQueue = useCallback((song) => {
    if (!song) return;
    setQueue((prev) => [...prev, song]);
  }, []);

  const removeFromQueue = useCallback((index) => {
    setQueue((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const next = prev.filter((_, i) => i !== index);
      setShuffleOrder((so) => remapShuffleAfterRemove(so, index));
      setQueueIndex((qi) => {
        if (index < qi) return qi - 1;
        if (index === qi) return Math.min(qi, Math.max(0, next.length - 1));
        return qi;
      });
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setQueueIndex(0);
    setShuffleOrder([]);
    setShufflePos(0);
  }, []);

  const moveInQueue = useCallback((from, to) => {
    setQueue((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    setIsShuffled((prev) => {
      const next = !prev;
      if (next) {
        const q = queueRef.current;
        const order = fisherYatesShuffle(q.length);
        setShuffleOrder(order);
        const qi = queueIndexRef.current;
        const pos = order.indexOf(qi);
        setShufflePos(pos >= 0 ? pos : 0);
      }
      return next;
    });
  }, []);

  const setVolume = useCallback((v) => {
    const next = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    setVolumeState(next);
  }, []);

  const setPlaybackSpeed = useCallback((s) => {
    const next = Number.isFinite(s) && s > 0 ? Math.max(0.5, Math.min(2, s)) : 1;
    setPlaybackSpeedState(next);
  }, []);

  const formatTime = useCallback((seconds) => {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  const value = {
    currentSong,
    isPlaying,
    volume,
    playbackSpeed,
    progress,
    duration,
    queue,
    queueIndex,
    isShuffled,
    repeatMode,
    audioSrc,
    loudnessGain: 1,
    waveform: null,
    play,
    pause,
    togglePlay,
    seek,
    playNext,
    playPrevious,
    playAtIndex,
    removeFromQueue,
    clearQueue,
    moveInQueue,
    addToQueue,
    setQueueAndPlay,
    loadSong,
    setVolume,
    setPlaybackSpeed,
    toggleShuffle,
    cycleRepeat: () =>
      setRepeatMode((prev) => (prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none')),
    formatTime,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
