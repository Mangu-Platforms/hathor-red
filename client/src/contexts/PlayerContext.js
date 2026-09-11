import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';
import { useAuth } from './AuthContext';

const PlayerContext = createContext();

const PREV_RESTART_THRESHOLD_SEC = 3;
const KEYBOARD_SEEK_SEC = 5;
const MEDIA_SESSION_SEEK_SEC = 10;
const PERSIST_INTERVAL_MS = 8000;
const PERSIST_DEBOUNCE_MS = 1200;

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

function remapIndexAfterMove(index, from, to) {
  if (!Number.isInteger(index) || index < 0) return index;
  if (index === from) return to;
  if (from < to) {
    if (index > from && index <= to) return index - 1;
  } else if (from > to) {
    if (index >= to && index < from) return index + 1;
  }
  return index;
}

function remapShuffleAfterMove(shuffleOrder, from, to) {
  return shuffleOrder.map((i) => remapIndexAfterMove(i, from, to));
}

function safeSetCurrentTime(audio, time) {
  if (!Number.isFinite(time) || time < 0) return;
  try { audio.currentTime = time; } catch (_) {}
}

function normalizeSongPayload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.id != null) return raw;
  if (raw.song && typeof raw.song === 'object' && raw.song.id != null) return raw.song;
  return null;
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
          currentTime: 0, duration: 0, paused: true, volume: 1, playbackRate: 1, src: '',
          ended: false, readyState: 0, play: async () => {}, pause: () => {}, load: () => {},
          addEventListener: () => {}, removeEventListener: () => {}, removeAttribute: () => {},
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
  const hydratedRef = useRef(false);
  const streamRetryGen = useRef(-1);
  const volumeRef = useRef(1);
  const playbackSpeedRef = useRef(1);
  const preMuteVolumeRef = useRef(1);
  const persistTimerRef = useRef(null);
  const persistDebounceRef = useRef(null);
  const audio = audioRef.current;

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
  useEffect(() => { isShuffledRef.current = isShuffled; }, [isShuffled]);
  useEffect(() => { shuffleOrderRef.current = shuffleOrder; }, [shuffleOrder]);
  useEffect(() => { shufflePosRef.current = shufflePos; }, [shufflePos]);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => { currentSongRef.current = currentSong; }, [currentSong]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { playbackSpeedRef.current = playbackSpeed; }, [playbackSpeed]);

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

  const persistPlaybackState = useCallback(async (overrides = {}) => {
    if (!isAuthenticated) return;
    const song = currentSongRef.current;
    const position = Number.isFinite(overrides.position)
      ? overrides.position
      : (Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
    const payload = {
      currentSongId: Object.prototype.hasOwnProperty.call(overrides, 'currentSongId')
        ? overrides.currentSongId
        : (song?.id ?? null),
      position,
      isPlaying: Object.prototype.hasOwnProperty.call(overrides, 'isPlaying')
        ? overrides.isPlaying
        : isPlayingRef.current,
      volume: Object.prototype.hasOwnProperty.call(overrides, 'volume')
        ? overrides.volume
        : volumeRef.current,
      playbackSpeed: Object.prototype.hasOwnProperty.call(overrides, 'playbackSpeed')
        ? overrides.playbackSpeed
        : playbackSpeedRef.current,
    };
    try {
      await musicService.updatePlaybackState(payload);
    } catch (err) {
      console.warn('persistPlaybackState failed', err?.message || err);
    }
  }, [isAuthenticated, audio]);

  const schedulePersist = useCallback((overrides) => {
    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    persistDebounceRef.current = setTimeout(() => {
      persistDebounceRef.current = null;
      persistPlaybackState(overrides);
    }, PERSIST_DEBOUNCE_MS);
  }, [persistPlaybackState]);

  useEffect(() => {
    if (!isAuthenticated || !isPlaying || !currentSong) {
      if (persistTimerRef.current) {
        clearInterval(persistTimerRef.current);
        persistTimerRef.current = null;
      }
      return undefined;
    }
    persistTimerRef.current = setInterval(() => {
      persistPlaybackState();
    }, PERSIST_INTERVAL_MS);
    return () => {
      if (persistTimerRef.current) {
        clearInterval(persistTimerRef.current);
        persistTimerRef.current = null;
      }
    };
  }, [isAuthenticated, isPlaying, currentSong, persistPlaybackState]);

  const loadSong = useCallback(async (song, { autoplay = true, startAt = 0 } = {}) => {
    if (!song || song.id == null) return;
    const gen = ++playGeneration.current;
    streamRetryGen.current = -1;
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
      schedulePersist({
        currentSongId: song.id,
        position: Number.isFinite(startAt) ? startAt : 0,
        isPlaying: autoplay,
      });
    } catch (err) {
      console.error('loadSong failed', err);
      setIsPlaying(false);
      setAudioSrc(null);
    }
  }, [audio, schedulePersist]);

  const play = useCallback(async () => {
    if (!currentSongRef.current) return;
    try {
      if (!audio.src && currentSongRef.current) {
        await loadSong(currentSongRef.current, { autoplay: true, startAt: audio.currentTime || 0 });
        return;
      }
      await audio.play();
      setIsPlaying(true);
      schedulePersist({ isPlaying: true });
    } catch (err) {
      console.warn('play failed', err);
      setIsPlaying(false);
    }
  }, [audio, loadSong, schedulePersist]);

  const pause = useCallback(() => {
    audio.pause();
    setIsPlaying(false);
    schedulePersist({ isPlaying: false, position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0 });
  }, [audio, schedulePersist]);

  const togglePlay = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [pause, play]);

  const seek = useCallback((time) => {
    if (!Number.isFinite(time)) return;
    if (!audio.src) return;
    const d = audio.duration;
    const clamped = Number.isFinite(d) && d > 0 ? Math.max(0, Math.min(d, time)) : Math.max(0, time);
    safeSetCurrentTime(audio, clamped);
    setProgress(clamped);
    schedulePersist({ position: clamped });
  }, [audio, schedulePersist]);

  const clearQueue = useCallback(() => {
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch (_) {}
    setIsPlaying(false);
    setCurrentSong(null);
    setAudioSrc(null);
    setProgress(0);
    setDuration(0);
    setQueue([]);
    setQueueIndex(0);
    setShuffleOrder([]);
    setShufflePos(0);
    setIsShuffled(false);
    playGeneration.current += 1;
    streamRetryGen.current = -1;
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      }
    } catch (_) {}
    schedulePersist({ currentSongId: null, position: 0, isPlaying: false });
  }, [audio, schedulePersist]);

  // NOTE: remainder of file continues in next push if truncated
  return <PlayerContext.Provider value={{ currentSong, isPlaying, clearQueue, play, pause, togglePlay, seek, loadSong }}>{children}</PlayerContext.Provider>;
};
