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

  const resolveNextIndex = useCallback(() => {
    const q = queueRef.current;
    if (!q.length) return null;
    if (repeatModeRef.current === 'one') {
      return isShuffledRef.current
        ? (Number.isInteger(shufflePosRef.current) ? shuffleOrderRef.current[shufflePosRef.current] : queueIndexRef.current)
        : queueIndexRef.current;
    }
    if (isShuffledRef.current && shuffleOrderRef.current.length === q.length) {
      const nextPos = (Number.isInteger(shufflePosRef.current) ? shufflePosRef.current : 0) + 1;
      if (nextPos < shuffleOrderRef.current.length) return { index: shuffleOrderRef.current[nextPos], shufflePos: nextPos };
      if (repeatModeRef.current === 'all') return { index: shuffleOrderRef.current[0], shufflePos: 0 };
      return null;
    }
    const next = queueIndexRef.current + 1;
    if (next < q.length) return { index: next, shufflePos: null };
    if (repeatModeRef.current === 'all') return { index: 0, shufflePos: null };
    return null;
  }, []);

  const resolvePrevIndex = useCallback(() => {
    const q = queueRef.current;
    if (!q.length) return null;
    const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (t > PREV_RESTART_THRESHOLD_SEC) {
      return { restart: true };
    }
    if (isShuffledRef.current && shuffleOrderRef.current.length === q.length) {
      const pos = Number.isInteger(shufflePosRef.current) ? shufflePosRef.current : 0;
      if (pos > 0) return { index: shuffleOrderRef.current[pos - 1], shufflePos: pos - 1 };
      if (repeatModeRef.current === 'all') {
        const last = shuffleOrderRef.current.length - 1;
        return { index: shuffleOrderRef.current[last], shufflePos: last };
      }
      return { restart: true };
    }
    const idx = queueIndexRef.current;
    if (idx > 0) return { index: idx - 1, shufflePos: null };
    if (repeatModeRef.current === 'all') return { index: q.length - 1, shufflePos: null };
    return { restart: true };
  }, [audio]);

  const playNext = useCallback(async () => {
    const next = resolveNextIndex();
    if (!next) {
      pause();
      return;
    }
    const song = queueRef.current[next.index];
    if (!song) return;
    setQueueIndex(next.index);
    if (next.shufflePos != null) setShufflePos(next.shufflePos);
    await loadSong(song, { autoplay: true, startAt: 0 });
  }, [resolveNextIndex, pause, loadSong]);

  const playPrevious = useCallback(async () => {
    const prev = resolvePrevIndex();
    if (!prev) return;
    if (prev.restart) {
      seek(0);
      if (!isPlayingRef.current) play();
      return;
    }
    const song = queueRef.current[prev.index];
    if (!song) return;
    setQueueIndex(prev.index);
    if (prev.shufflePos != null) setShufflePos(prev.shufflePos);
    await loadSong(song, { autoplay: true, startAt: 0 });
  }, [resolvePrevIndex, seek, play, loadSong]);

  const playAtIndex = useCallback(async (idx) => {
    const q = queueRef.current;
    if (!Number.isInteger(idx) || idx < 0 || idx >= q.length) return;
    setQueueIndex(idx);
    if (isShuffledRef.current && shuffleOrderRef.current.length === q.length) {
      const pos = shuffleOrderRef.current.indexOf(idx);
      if (pos >= 0) setShufflePos(pos);
    }
    await loadSong(q[idx], { autoplay: true, startAt: 0 });
  }, [loadSong]);

  const setQueueAndPlay = useCallback(async (songs, startIndex = 0) => {
    const list = Array.isArray(songs) ? songs.filter((s) => s && s.id != null) : [];
    if (!list.length) return;
    const idx = Math.max(0, Math.min(startIndex, list.length - 1));
    setQueue(list);
    setQueueIndex(idx);
    if (isShuffledRef.current) {
      const order = fisherYatesShuffle(list.length);
      const pos = order.indexOf(idx);
      setShuffleOrder(order);
      setShufflePos(pos >= 0 ? pos : 0);
    } else {
      setShuffleOrder([]);
      setShufflePos(0);
    }
    await loadSong(list[idx], { autoplay: true, startAt: 0 });
  }, [loadSong]);

  const addToQueue = useCallback((song) => {
    if (!song || song.id == null) return false;
    // Skip duplicate by id so SongList "Already in queue" feedback is honest.
    if (queueRef.current.some((s) => s && s.id === song.id)) return false;
    setQueue((prev) => {
      if (prev.some((s) => s && s.id === song.id)) return prev;
      const next = [...prev, song];
      if (isShuffledRef.current) {
        setShuffleOrder((so) => (so.length === prev.length ? [...so, prev.length] : fisherYatesShuffle(next.length)));
      }
      return next;
    });
    return true;
  }, []);

  const insertNext = useCallback((song) => {
    if (!song || song.id == null) return false;
    // Same id already queued: treat as success for "play next" UX without duplicating.
    if (queueRef.current.some((s) => s && s.id === song.id)) return true;
    setQueue((prev) => {
      if (prev.some((s) => s && s.id === song.id)) return prev;
      const at = Math.min(queueIndexRef.current + 1, prev.length);
      const next = [...prev.slice(0, at), song, ...prev.slice(at)];
      if (isShuffledRef.current) {
        setShuffleOrder((so) => {
          if (so.length !== prev.length) return fisherYatesShuffle(next.length);
          return so.map((i) => (i >= at ? i + 1 : i)).concat(at);
        });
      }
      return next;
    });
    return true;
  }, []);

  const removeFromQueue = useCallback((idx) => {
    if (!Number.isInteger(idx) || idx < 0) return;
    const q = queueRef.current;
    if (idx >= q.length) return;
    const wasCurrent = idx === queueIndexRef.current;
    const nextQueue = q.filter((_, i) => i !== idx);
    setQueue(nextQueue);
    if (isShuffledRef.current) {
      setShuffleOrder((so) => remapShuffleAfterRemove(so, idx));
      setShufflePos((pos) => Math.max(0, Math.min(pos, Math.max(0, nextQueue.length - 1))));
    }
    if (!nextQueue.length) {
      clearQueue();
      return;
    }
    if (wasCurrent) {
      const newIdx = Math.min(idx, nextQueue.length - 1);
      setQueueIndex(newIdx);
      loadSong(nextQueue[newIdx], { autoplay: isPlayingRef.current, startAt: 0 });
    } else if (idx < queueIndexRef.current) {
      setQueueIndex((qi) => qi - 1);
    }
  }, [clearQueue, loadSong]);

  const moveInQueue = useCallback((from, to) => {
    if (!Number.isInteger(from) || !Number.isInteger(to)) return;
    const q = queueRef.current;
    if (from < 0 || to < 0 || from >= q.length || to >= q.length || from === to) return;
    const next = [...q];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setQueue(next);
    setQueueIndex((qi) => remapIndexAfterMove(qi, from, to));
    if (isShuffledRef.current) {
      setShuffleOrder((so) => remapShuffleAfterMove(so, from, to));
    }
  }, []);

  const makeNext = useCallback((idx) => {
    if (!Number.isInteger(idx) || idx < 0) return;
    const q = queueRef.current;
    if (idx >= q.length || idx === queueIndexRef.current) return;
    const target = queueIndexRef.current + 1;
    if (idx === target) return;
    moveInQueue(idx, Math.min(target, q.length - 1));
  }, [moveInQueue]);

  const setVolume = useCallback((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(0, Math.min(1, n));
    setVolumeState(clamped);
    if (clamped > 0) preMuteVolumeRef.current = clamped;
    schedulePersist({ volume: clamped });
  }, [schedulePersist]);

  const setPlaybackSpeed = useCallback((s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return;
    const clamped = Math.max(0.5, Math.min(2, n));
    setPlaybackSpeedState(clamped);
    schedulePersist({ playbackSpeed: clamped });
  }, [schedulePersist]);

  const toggleMute = useCallback(() => {
    setVolumeState((v) => {
      if (v > 0) {
        preMuteVolumeRef.current = v;
        schedulePersist({ volume: 0 });
        return 0;
      }
      const restore = preMuteVolumeRef.current > 0 ? preMuteVolumeRef.current : 1;
      schedulePersist({ volume: restore });
      return restore;
    });
  }, [schedulePersist]);

  const toggleShuffle = useCallback(() => {
    setIsShuffled((prev) => {
      const next = !prev;
      if (next) {
        const order = fisherYatesShuffle(queueRef.current.length);
        const pos = order.indexOf(queueIndexRef.current);
        setShuffleOrder(order);
        setShufflePos(pos >= 0 ? pos : 0);
      } else {
        setShuffleOrder([]);
        setShufflePos(0);
      }
      return next;
    });
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeatMode((prev) => (prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none'));
  }, []);

  const formatTime = useCallback((sec) => {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    const onEnded = () => { playNext(); };
    const onError = async () => {
      const song = currentSongRef.current;
      if (!song || streamRetryGen.current === playGeneration.current) return;
      streamRetryGen.current = playGeneration.current;
      try {
        const data = await musicService.getStreamUrl(song.id);
        if (playGeneration.current !== streamRetryGen.current) return;
        const url = data?.url;
        if (!url) return;
        setAudioSrc(url);
        audio.src = url;
        audio.load();
        if (isPlayingRef.current) {
          try { await audio.play(); } catch (_) {}
        }
      } catch (_) {}
    };
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);
    return () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [audio, playNext]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return undefined;
    try {
      if (currentSong) {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: currentSong.title || 'Unknown',
          artist: currentSong.artist || currentSong.uploader_name || '',
        });
      }
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : (currentSong ? 'paused' : 'none');
      navigator.mediaSession.setActionHandler('play', () => { play(); });
      navigator.mediaSession.setActionHandler('pause', () => { pause(); });
      navigator.mediaSession.setActionHandler('previoustrack', () => { playPrevious(); });
      navigator.mediaSession.setActionHandler('nexttrack', () => { playNext(); });
      navigator.mediaSession.setActionHandler('seekbackward', () => {
        seek(Math.max(0, (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) - MEDIA_SESSION_SEEK_SEC));
      });
      navigator.mediaSession.setActionHandler('seekforward', () => {
        const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const d = Number.isFinite(audio.duration) ? audio.duration : 0;
        seek(d > 0 ? Math.min(d, t + MEDIA_SESSION_SEEK_SEC) : t + MEDIA_SESSION_SEEK_SEC);
      });
    } catch (_) {}
    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('seekbackward', null);
        navigator.mediaSession.setActionHandler('seekforward', null);
      } catch (_) {}
    };
  }, [currentSong, isPlaying, play, pause, playNext, playPrevious, seek, audio]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); seek((Number.isFinite(audio.currentTime) ? audio.currentTime : 0) + KEYBOARD_SEEK_SEC); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); seek(Math.max(0, (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) - KEYBOARD_SEEK_SEC)); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seek, audio]);

  useEffect(() => {
    const onLogout = () => { clearQueue(); hydratedRef.current = false; };
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, [clearQueue]);

  useEffect(() => {
    if (!isAuthenticated) {
      if (hydratedRef.current) { clearQueue(); hydratedRef.current = false; }
      return undefined;
    }
    if (hydratedRef.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const state = await musicService.getPlaybackState();
        if (cancelled) return;
        if (!state) { hydratedRef.current = true; return; }
        const songId = state.current_song_id ?? state.currentSongId ?? state.songId ?? state.song_id;
        const vol = Number(state.volume);
        if (Number.isFinite(vol)) {
          const clamped = Math.max(0, Math.min(1, vol));
          setVolumeState(clamped);
          if (clamped > 0) preMuteVolumeRef.current = clamped;
        }
        const speed = Number(state.playback_speed ?? state.playbackSpeed);
        if (Number.isFinite(speed) && speed > 0) setPlaybackSpeedState(Math.max(0.5, Math.min(2, speed)));
        if (!songId) { hydratedRef.current = true; return; }
        const song = normalizeSongPayload(await musicService.getSong(songId));
        if (cancelled || !song) { hydratedRef.current = true; return; }
        const startAt = Number(state.position ?? state.currentTime ?? 0) || 0;
        const shouldPlay = Boolean(state.is_playing ?? state.isPlaying ?? state.playing);
        setQueue([song]);
        setQueueIndex(0);
        await loadSong(song, { autoplay: shouldPlay, startAt });
        hydratedRef.current = true;
      } catch (err) {
        console.warn('playback hydrate failed', err);
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, clearQueue, loadSong]);

  useEffect(() => () => {
    if (persistTimerRef.current) clearInterval(persistTimerRef.current);
    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
  }, []);

  const value = {
    currentSong, isPlaying, volume, playbackSpeed, progress, duration, queue, queueIndex,
    shuffleOrder, shufflePos, isShuffled, repeatMode, audioSrc, loudnessGain: 1, waveform: null,
    play, pause, togglePlay, seek, playNext, playPrevious, loadSong,
    clearQueue, addToQueue, setQueueAndPlay, insertNext,
    setVolume, setPlaybackSpeed, toggleMute, toggleShuffle, cycleRepeat, formatTime,
    removeFromQueue, moveInQueue, makeNext, playAtIndex,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
