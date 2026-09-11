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

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const h = Math.floor(sec / 3600);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
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

  const setVolume = useCallback((v) => {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(v) ? v : 1));
    setVolumeState(clamped);
    if (clamped > 0) preMuteVolumeRef.current = clamped;
    schedulePersist({ volume: clamped });
  }, [schedulePersist]);

  const toggleMute = useCallback(() => {
    if (volumeRef.current > 0) {
      preMuteVolumeRef.current = volumeRef.current;
      setVolume(0);
    } else {
      setVolume(preMuteVolumeRef.current > 0 ? preMuteVolumeRef.current : 1);
    }
  }, [setVolume]);

  const setPlaybackSpeed = useCallback((s) => {
    const clamped = Math.max(0.5, Math.min(2, Number.isFinite(s) && s > 0 ? s : 1));
    setPlaybackSpeedState(clamped);
    schedulePersist({ playbackSpeed: clamped });
  }, [schedulePersist]);

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

  const playAtIndex = useCallback(async (index, { autoplay = true } = {}) => {
    const q = queueRef.current;
    if (!q.length || index < 0 || index >= q.length) return;
    const song = q[index];
    if (!song) return;
    setQueueIndex(index);
    if (isShuffledRef.current && Array.isArray(shuffleOrderRef.current) && shuffleOrderRef.current.length === q.length) {
      const pos = shuffleOrderRef.current.indexOf(index);
      if (pos >= 0) setShufflePos(pos);
    }
    await loadSong(song, { autoplay, startAt: 0 });
  }, [loadSong]);

  const resolveNextIndex = useCallback(() => {
    const q = queueRef.current;
    if (!q.length) return -1;
    const mode = repeatModeRef.current;
    if (mode === 'one') return queueIndexRef.current;

    if (isShuffledRef.current && Array.isArray(shuffleOrderRef.current) && shuffleOrderRef.current.length === q.length) {
      let nextPos = shufflePosRef.current + 1;
      if (nextPos >= shuffleOrderRef.current.length) {
        if (mode === 'all') nextPos = 0;
        else return -1;
      }
      return shuffleOrderRef.current[nextPos];
    }

    let next = queueIndexRef.current + 1;
    if (next >= q.length) {
      if (mode === 'all') next = 0;
      else return -1;
    }
    return next;
  }, []);

  const resolvePrevIndex = useCallback(() => {
    const q = queueRef.current;
    if (!q.length) return -1;
    if (isShuffledRef.current && Array.isArray(shuffleOrderRef.current) && shuffleOrderRef.current.length === q.length) {
      let prevPos = shufflePosRef.current - 1;
      if (prevPos < 0) {
        if (repeatModeRef.current === 'all') prevPos = shuffleOrderRef.current.length - 1;
        else return -1;
      }
      return shuffleOrderRef.current[prevPos];
    }
    let prev = queueIndexRef.current - 1;
    if (prev < 0) {
      if (repeatModeRef.current === 'all') prev = q.length - 1;
      else return -1;
    }
    return prev;
  }, []);

  const playNext = useCallback(async () => {
    const next = resolveNextIndex();
    if (next < 0) {
      pause();
      return;
    }
    if (isShuffledRef.current && Array.isArray(shuffleOrderRef.current)) {
      const pos = shuffleOrderRef.current.indexOf(next);
      if (pos >= 0) setShufflePos(pos);
    }
    setQueueIndex(next);
    const song = queueRef.current[next];
    if (song) await loadSong(song, { autoplay: true, startAt: 0 });
  }, [resolveNextIndex, pause, loadSong]);

  const playPrevious = useCallback(async () => {
    const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (t > PREV_RESTART_THRESHOLD_SEC) {
      seek(0);
      return;
    }
    const prev = resolvePrevIndex();
    if (prev < 0) {
      seek(0);
      return;
    }
    if (isShuffledRef.current && Array.isArray(shuffleOrderRef.current)) {
      const pos = shuffleOrderRef.current.indexOf(prev);
      if (pos >= 0) setShufflePos(pos);
    }
    setQueueIndex(prev);
    const song = queueRef.current[prev];
    if (song) await loadSong(song, { autoplay: true, startAt: 0 });
  }, [audio, resolvePrevIndex, seek, loadSong]);

  const setQueueAndPlay = useCallback(async (songs, startIndex = 0) => {
    const list = (Array.isArray(songs) ? songs : []).map(normalizeSongPayload).filter(Boolean);
    if (!list.length) return;
    const idx = Math.max(0, Math.min(startIndex, list.length - 1));
    setQueue(list);
    setQueueIndex(idx);
    setIsShuffled(false);
    setShuffleOrder([]);
    setShufflePos(0);
    await loadSong(list[idx], { autoplay: true, startAt: 0 });
  }, [loadSong]);

  const addToQueue = useCallback((song) => {
    const s = normalizeSongPayload(song);
    if (!s || s.id == null) return false;
    const q = queueRef.current;
    if (q.some((x) => x && x.id === s.id)) return false;
    const next = [...q, s];
    setQueue(next);
    if (isShuffledRef.current) {
      setShuffleOrder((prev) => [...prev, next.length - 1]);
    }
    if (!currentSongRef.current) {
      setQueueIndex(0);
      loadSong(s, { autoplay: true, startAt: 0 });
    }
    return true;
  }, [loadSong]);

  const insertNext = useCallback((song) => {
    const s = normalizeSongPayload(song);
    if (!s || s.id == null) return false;
    const q = [...queueRef.current];
    const existing = q.findIndex((x) => x && x.id === s.id);
    const cur = queueIndexRef.current;

    if (existing >= 0) {
      if (existing === cur) return false;
      // already next?
      if (isShuffledRef.current && Array.isArray(shuffleOrderRef.current) && shuffleOrderRef.current.length === q.length) {
        const pos = shufflePosRef.current;
        const nextSlot = pos + 1;
        if (nextSlot < shuffleOrderRef.current.length && shuffleOrderRef.current[nextSlot] === existing) return false;
        // move to play-next in shuffle order
        const order = [...shuffleOrderRef.current];
        const fromPos = order.indexOf(existing);
        if (fromPos >= 0) {
          order.splice(fromPos, 1);
          const insertAt = Math.min(pos + 1, order.length);
          order.splice(insertAt, 0, existing);
          setShuffleOrder(order);
        }
        return true;
      }
      // linear: move to cur+1
      if (existing === cur + 1) return false;
      const [row] = q.splice(existing, 1);
      const insertAt = existing < cur ? cur : cur + 1;
      q.splice(insertAt, 0, row);
      setQueue(q);
      let newIdx = cur;
      if (existing < cur) newIdx = cur - 1;
      setQueueIndex(newIdx);
      return true;
    }

    // not in queue — insert after current
    const insertAt = Math.min(cur + 1, q.length);
    q.splice(insertAt, 0, s);
    setQueue(q);
    if (isShuffledRef.current) {
      setShuffleOrder((prev) => {
        const order = prev.map((i) => (i >= insertAt ? i + 1 : i));
        const pos = shufflePosRef.current;
        order.splice(Math.min(pos + 1, order.length), 0, insertAt);
        return order;
      });
    } else if (insertAt <= cur) {
      setQueueIndex(cur + 1);
    }
    if (!currentSongRef.current) {
      setQueueIndex(0);
      loadSong(s, { autoplay: true, startAt: 0 });
    }
    return true;
  }, [loadSong]);

  const makeNext = useCallback((index) => {
    const q = queueRef.current;
    if (!Number.isInteger(index) || index < 0 || index >= q.length) return;
    if (index === queueIndexRef.current) return;

    if (isShuffledRef.current && Array.isArray(shuffleOrderRef.current) && shuffleOrderRef.current.length === q.length) {
      const order = [...shuffleOrderRef.current];
      const fromPos = order.indexOf(index);
      if (fromPos < 0) return;
      order.splice(fromPos, 1);
      const pos = shufflePosRef.current;
      order.splice(Math.min(pos + 1, order.length), 0, index);
      setShuffleOrder(order);
      return;
    }

    const cur = queueIndexRef.current;
    if (index === cur + 1) return;
    const next = [...q];
    const [row] = next.splice(index, 1);
    const insertAt = index < cur ? cur : cur + 1;
    next.splice(insertAt, 0, row);
    setQueue(next);
    let newIdx = cur;
    if (index < cur) newIdx = cur - 1;
    setQueueIndex(newIdx);
  }, []);

  const removeFromQueue = useCallback((index) => {
    const q = [...queueRef.current];
    if (!Number.isInteger(index) || index < 0 || index >= q.length) return;
    const wasCurrent = index === queueIndexRef.current;
    q.splice(index, 1);
    setQueue(q);

    if (isShuffledRef.current) {
      const newOrder = remapShuffleAfterRemove(shuffleOrderRef.current, index);
      setShuffleOrder(newOrder);
      let newPos = shufflePosRef.current;
      if (wasCurrent) {
        if (q.length === 0) {
          clearQueue();
          return;
        }
        newPos = Math.min(newPos, newOrder.length - 1);
        setShufflePos(Math.max(0, newPos));
        const nextIdx = newOrder[newPos];
        setQueueIndex(nextIdx);
        loadSong(q[nextIdx], { autoplay: isPlayingRef.current, startAt: 0 });
        return;
      }
      if (index < queueIndexRef.current) setQueueIndex(queueIndexRef.current - 1);
      if (newPos > 0 && shuffleOrderRef.current[newPos] === index) {
        // adjusted by remap
      }
      setShufflePos(Math.min(newPos, Math.max(0, newOrder.length - 1)));
      return;
    }

    if (wasCurrent) {
      if (q.length === 0) {
        clearQueue();
        return;
      }
      const nextIdx = Math.min(index, q.length - 1);
      setQueueIndex(nextIdx);
      loadSong(q[nextIdx], { autoplay: isPlayingRef.current, startAt: 0 });
    } else if (index < queueIndexRef.current) {
      setQueueIndex(queueIndexRef.current - 1);
    }
  }, [clearQueue, loadSong]);

  const moveInQueue = useCallback((from, to) => {
    if (!Number.isInteger(from) || !Number.isInteger(to)) return;
    const q = [...queueRef.current];
    if (from < 0 || from >= q.length || to < 0 || to >= q.length || from === to) return;
    if (isShuffledRef.current) return; // linear move disabled under shuffle
    const [row] = q.splice(from, 1);
    q.splice(to, 0, row);
    setQueue(q);
    setQueueIndex(remapIndexAfterMove(queueIndexRef.current, from, to));
  }, []);

  const toggleShuffle = useCallback(() => {
    const q = queueRef.current;
    if (!isShuffledRef.current) {
      if (q.length < 2) {
        setIsShuffled(true);
        setShuffleOrder(q.map((_, i) => i));
        setShufflePos(queueIndexRef.current);
        return;
      }
      const order = fisherYatesShuffle(q.length);
      // keep current song first in play order
      const cur = queueIndexRef.current;
      const curPos = order.indexOf(cur);
      if (curPos > 0) {
        order.splice(curPos, 1);
        order.unshift(cur);
      }
      setShuffleOrder(order);
      setShufflePos(0);
      setIsShuffled(true);
    } else {
      setIsShuffled(false);
      setShuffleOrder([]);
      setShufflePos(0);
    }
  }, []);

  const cycleRepeat = useCallback(() => {
    setRepeatMode((m) => (m === 'none' ? 'all' : m === 'all' ? 'one' : 'none'));
  }, []);

  // ended handler
  useEffect(() => {
    const onEnded = () => {
      if (repeatModeRef.current === 'one') {
        safeSetCurrentTime(audio, 0);
        audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        return;
      }
      playNext();
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [audio, playNext]);

  // stream error → one retry with fresh signed URL, resume position
  useEffect(() => {
    const onError = async () => {
      const song = currentSongRef.current;
      if (!song || song.id == null) return;
      const gen = playGeneration.current;
      if (streamRetryGen.current === gen) return; // already retried this generation
      streamRetryGen.current = gen;
      const resumeAt = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      try {
        const data = await musicService.getStreamUrl(song.id);
        if (gen !== playGeneration.current) return;
        const url = data?.url;
        if (!url) return;
        setAudioSrc(url);
        audio.src = url;
        audio.load();
        const onMeta = () => {
          if (Number.isFinite(resumeAt) && resumeAt > 0) safeSetCurrentTime(audio, resumeAt);
          if (isPlayingRef.current) {
            audio.play().catch(() => setIsPlaying(false));
          }
        };
        audio.addEventListener('loadedmetadata', onMeta, { once: true });
      } catch (err) {
        console.warn('stream retry failed', err?.message || err);
      }
    };
    audio.addEventListener('error', onError);
    return () => audio.removeEventListener('error', onError);
  }, [audio]);

  // Media Session
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return undefined;
    try {
      if (currentSong) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: currentSong.title || 'Unknown',
          artist: currentSong.artist || currentSong.uploader_name || '',
          album: currentSong.album || '',
        });
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      } else {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      }
      navigator.mediaSession.setActionHandler('play', () => play());
      navigator.mediaSession.setActionHandler('pause', () => pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevious());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
      navigator.mediaSession.setActionHandler('seekbackward', (d) => {
        const off = d?.seekOffset ?? MEDIA_SESSION_SEEK_SEC;
        seek(Math.max(0, (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) - off));
      });
      navigator.mediaSession.setActionHandler('seekforward', (d) => {
        const off = d?.seekOffset ?? MEDIA_SESSION_SEEK_SEC;
        const dmax = Number.isFinite(audio.duration) ? audio.duration : Infinity;
        seek(Math.min(dmax, (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) + off));
      });
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if (d?.seekTime != null) seek(d.seekTime);
      });
    } catch (_) {}
    return undefined;
  }, [currentSong, isPlaying, play, pause, playNext, playPrevious, seek, audio]);

  // Keyboard shortcuts when focused on body
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowRight') {
        seek((Number.isFinite(audio.currentTime) ? audio.currentTime : 0) + KEYBOARD_SEEK_SEC);
      } else if (e.code === 'ArrowLeft') {
        seek(Math.max(0, (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) - KEYBOARD_SEEK_SEC));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, seek, audio]);

  // Hydrate on auth
  useEffect(() => {
    if (!isAuthenticated) {
      hydratedRef.current = false;
      return undefined;
    }
    if (hydratedRef.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const state = await musicService.getPlaybackState();
        if (cancelled || !state) return;
        hydratedRef.current = true;
        if (state.volume != null && Number.isFinite(Number(state.volume))) {
          setVolumeState(Math.max(0, Math.min(1, Number(state.volume))));
        }
        if (state.playback_speed != null && Number.isFinite(Number(state.playback_speed))) {
          setPlaybackSpeedState(Math.max(0.5, Math.min(2, Number(state.playback_speed))));
        }
        const songId = state.current_song_id ?? state.currentSongId;
        if (songId == null) return;
        try {
          const song = await musicService.getSong(songId);
          if (cancelled || !song) return;
          const pos = Number(state.position) || 0;
          const shouldPlay = Boolean(state.is_playing ?? state.isPlaying);
          setQueue([song]);
          setQueueIndex(0);
          await loadSong(song, { autoplay: shouldPlay, startAt: pos });
        } catch (err) {
          console.warn('hydrate song load failed', err?.message || err);
        }
      } catch (err) {
        console.warn('hydrate failed', err?.message || err);
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, loadSong]);

  // Logout clears player + resets hydrate flag
  useEffect(() => {
    if (isAuthenticated) return undefined;
    clearQueue();
    hydratedRef.current = false;
    return undefined;
  }, [isAuthenticated, clearQueue]);

  const value = {
    currentSong,
    isPlaying,
    volume,
    playbackSpeed,
    progress,
    duration,
    queue,
    queueIndex,
    shuffleOrder,
    shufflePos,
    isShuffled,
    repeatMode,
    audioSrc,
    play,
    pause,
    togglePlay,
    seek,
    setVolume,
    toggleMute,
    setPlaybackSpeed,
    clearQueue,
    loadSong,
    setQueueAndPlay,
    addToQueue,
    insertNext,
    makeNext,
    removeFromQueue,
    moveInQueue,
    playAtIndex,
    playNext,
    playPrevious,
    toggleShuffle,
    cycleRepeat,
    formatTime,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
