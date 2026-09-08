import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';
import { useAuth } from './AuthContext';

const PlayerContext = createContext();

const PREV_RESTART_THRESHOLD_SEC = 3;
const KEYBOARD_SEEK_SEC = 5;
const MEDIA_SESSION_SEEK_SEC = 10;

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
  const preMuteVolumeRef = useRef(1);
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
    if (!audio.src) return;
    const d = audio.duration;
    const clamped = Number.isFinite(d) && d > 0 ? Math.max(0, Math.min(d, time)) : Math.max(0, time);
    safeSetCurrentTime(audio, clamped);
    setProgress(clamped);
  }, [audio]);

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
  }, [audio]);

  const addToQueue = useCallback((song) => {
    if (!song || song.id == null) return false;
    const q = queueRef.current;
    if (q.some((s) => s && s.id === song.id)) return false;
    const wasIdle = !currentSongRef.current && q.length === 0;
    setQueue((prev) => {
      if (prev.some((s) => s && s.id === song.id)) return prev;
      const next = [...prev, song];
      if (isShuffledRef.current) {
        setShuffleOrder((order) => {
          if (!order.length) return order;
          return [...order, prev.length];
        });
      }
      return next;
    });
    if (wasIdle) {
      setQueueIndex(0);
      if (isShuffledRef.current) {
        setShuffleOrder([0]);
        setShufflePos(0);
      }
      loadSong(song, { autoplay: true });
    }
    return true;
  }, [loadSong]);

  const setQueueAndPlay = useCallback(async (songs, startIndex = 0) => {
    const list = Array.isArray(songs) ? songs.filter(Boolean) : [];
    setQueue(list);
    setQueueIndex(startIndex);
    setIsShuffled(false);
    setShuffleOrder([]);
    setShufflePos(0);
    if (list[startIndex]) await loadSong(list[startIndex], { autoplay: true });
  }, [loadSong]);

  const playNext = useCallback(async () => {
    const q = queueRef.current;
    if (!q.length) return;
    if (repeatModeRef.current === 'one' && currentSongRef.current) {
      safeSetCurrentTime(audio, 0);
      setProgress(0);
      try { await audio.play(); setIsPlaying(true); } catch (_) { setIsPlaying(false); }
      return;
    }
    if (isShuffledRef.current && shuffleOrderRef.current.length === q.length) {
      let nextPos = shufflePosRef.current + 1;
      if (nextPos >= shuffleOrderRef.current.length) {
        if (repeatModeRef.current === 'all') {
          const order = fisherYatesShuffle(q.length);
          const cur = queueIndexRef.current;
          const pos = order.indexOf(cur);
          if (pos > 0) { order.splice(pos, 1); order.unshift(cur); }
          setShuffleOrder(order);
          setShufflePos(0);
          nextPos = 1;
          if (order.length <= 1) {
            safeSetCurrentTime(audio, 0);
            setProgress(0);
            try { await audio.play(); setIsPlaying(true); } catch (_) { setIsPlaying(false); }
            return;
          }
        } else {
          return;
        }
      }
      const idx = shuffleOrderRef.current[nextPos] ?? shuffleOrderRef.current[0];
      if (idx == null || !q[idx]) return;
      setShufflePos(nextPos);
      setQueueIndex(idx);
      await loadSong(q[idx], { autoplay: true });
      return;
    }
    const next = queueIndexRef.current + 1;
    if (next < q.length) {
      setQueueIndex(next);
      await loadSong(q[next], { autoplay: true });
    } else if (repeatModeRef.current === 'all' && q.length) {
      setQueueIndex(0);
      await loadSong(q[0], { autoplay: true });
    }
  }, [audio, loadSong]);

  const playPrevious = useCallback(async () => {
    const q = queueRef.current;
    if (!q.length) return;
    if (Number.isFinite(audio.currentTime) && audio.currentTime > PREV_RESTART_THRESHOLD_SEC) {
      safeSetCurrentTime(audio, 0);
      setProgress(0);
      return;
    }
    if (isShuffledRef.current && shuffleOrderRef.current.length === q.length) {
      const prevPos = shufflePosRef.current - 1;
      if (prevPos >= 0) {
        const idx = shuffleOrderRef.current[prevPos];
        if (idx == null || !q[idx]) return;
        setShufflePos(prevPos);
        setQueueIndex(idx);
        await loadSong(q[idx], { autoplay: true });
      }
      return;
    }
    const prev = queueIndexRef.current - 1;
    if (prev >= 0) {
      setQueueIndex(prev);
      await loadSong(q[prev], { autoplay: true });
    } else if (repeatModeRef.current === 'all' && q.length) {
      const last = q.length - 1;
      setQueueIndex(last);
      await loadSong(q[last], { autoplay: true });
    }
  }, [audio, loadSong]);

  useEffect(() => {
    const onEnded = () => { playNext(); };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [audio, playNext]);

  useEffect(() => {
    const onError = async () => {
      const song = currentSongRef.current;
      if (!song || song.id == null) return;
      const gen = playGeneration.current;
      if (streamRetryGen.current === gen) return;
      streamRetryGen.current = gen;
      const resumeAt = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const shouldPlay = isPlayingRef.current;
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
          if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
        };
        audio.addEventListener('loadedmetadata', onMeta, { once: true });
        if (shouldPlay) {
          try {
            await audio.play();
            if (gen === playGeneration.current) setIsPlaying(true);
          } catch (_) { setIsPlaying(false); }
        }
      } catch (err) {
        console.warn('stream URL retry failed', err);
        setIsPlaying(false);
      }
    };
    audio.addEventListener('error', onError);
    return () => audio.removeEventListener('error', onError);
  }, [audio]);

  const toggleShuffle = useCallback(() => {
    setIsShuffled((prev) => {
      const next = !prev;
      const q = queueRef.current;
      if (next && q.length > 0) {
        const order = fisherYatesShuffle(q.length);
        const cur = queueIndexRef.current;
        const pos = order.indexOf(cur);
        if (pos > 0) { order.splice(pos, 1); order.unshift(cur); }
        setShuffleOrder(order);
        setShufflePos(0);
      } else {
        setShuffleOrder([]);
        setShufflePos(0);
      }
      return next;
    });
  }, []);

  const setVolume = useCallback((v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    const clamped = Math.max(0, Math.min(1, n));
    if (clamped > 0) preMuteVolumeRef.current = clamped;
    setVolumeState(clamped);
  }, []);

  const toggleMute = useCallback(() => {
    if (volumeRef.current > 0) {
      preMuteVolumeRef.current = volumeRef.current;
      setVolumeState(0);
    } else {
      const restore = preMuteVolumeRef.current > 0 ? preMuteVolumeRef.current : 1;
      setVolumeState(restore);
    }
  }, []);

  const setPlaybackSpeed = useCallback((s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return;
    setPlaybackSpeedState(Math.max(0.5, Math.min(2, n)));
  }, []);

  const formatTime = useCallback((sec) => {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  }, []);

  const removeFromQueue = useCallback((index) => {
    if (!Number.isInteger(index) || index < 0) return;
    const q = queueRef.current;
    if (index >= q.length) return;
    const wasCurrent = index === queueIndexRef.current;
    const oldShufflePos = shufflePosRef.current;
    const oldShuffleLen = shuffleOrderRef.current.length;
    const newQueue = q.filter((_, i) => i !== index);
    setQueue(newQueue);
    let remappedOrder = null;
    if (isShuffledRef.current && shuffleOrderRef.current.length) {
      remappedOrder = remapShuffleAfterRemove(shuffleOrderRef.current, index);
      setShuffleOrder(remappedOrder);
    }
    if (wasCurrent) {
      if (newQueue.length === 0) {
        clearQueue();
      } else if (remappedOrder && remappedOrder.length) {
        const wasLastInShuffle = oldShuffleLen > 0 && oldShufflePos >= oldShuffleLen - 1;
        if (wasLastInShuffle) {
          if (repeatModeRef.current === 'all') {
            const order = fisherYatesShuffle(newQueue.length);
            setShuffleOrder(order);
            setShufflePos(0);
            setQueueIndex(order[0]);
            if (newQueue[order[0]]) loadSong(newQueue[order[0]], { autoplay: isPlayingRef.current });
          } else {
            setShufflePos(Math.max(0, remappedOrder.length - 1));
            setQueueIndex(remappedOrder[remappedOrder.length - 1] ?? 0);
            try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) {}
            setIsPlaying(false);
            setCurrentSong(null);
            setAudioSrc(null);
            setProgress(0);
            setDuration(0);
            playGeneration.current += 1;
          }
        } else {
          const pos = Math.min(Math.max(0, oldShufflePos), remappedOrder.length - 1);
          const nextIdx = remappedOrder[pos];
          setShufflePos(pos);
          setQueueIndex(nextIdx);
          if (newQueue[nextIdx]) loadSong(newQueue[nextIdx], { autoplay: isPlayingRef.current });
        }
      } else {
        const nextIdx = Math.min(index, newQueue.length - 1);
        setQueueIndex(nextIdx);
        loadSong(newQueue[nextIdx], { autoplay: isPlayingRef.current });
      }
    } else {
      const qi = queueIndexRef.current;
      if (index < qi) setQueueIndex(qi - 1);
      if (remappedOrder && remappedOrder.length) {
        const pos = remappedOrder.indexOf(qi > index ? qi - 1 : qi);
        if (pos >= 0) setShufflePos(pos);
      }
    }
  }, [clearQueue, loadSong, audio]);

  const moveInQueue = useCallback((from, to) => {
    if (!Number.isInteger(from) || !Number.isInteger(to)) return;
    const q = queueRef.current;
    if (from < 0 || to < 0 || from >= q.length || to >= q.length || from === to) return;
    const next = [...q];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setQueue(next);
    const newQi = remapIndexAfterMove(queueIndexRef.current, from, to);
    setQueueIndex(newQi);
    if (isShuffledRef.current && shuffleOrderRef.current.length) {
      const remapped = remapShuffleAfterMove(shuffleOrderRef.current, from, to);
      setShuffleOrder(remapped);
      const pos = remapped.indexOf(newQi);
      if (pos >= 0) setShufflePos(pos);
      else setShufflePos((p) => Math.min(p, Math.max(0, remapped.length - 1)));
    }
  }, []);

  const insertNext = useCallback((song) => {
    if (!song || song.id == null) return false;
    const q = queueRef.current;
    if (q.some((s) => s && s.id === song.id)) return false;
    const wasIdle = !currentSongRef.current && q.length === 0;
    if (wasIdle) {
      setQueue([song]);
      setQueueIndex(0);
      if (isShuffledRef.current) { setShuffleOrder([0]); setShufflePos(0); }
      loadSong(song, { autoplay: true });
      return true;
    }
    const insertAt = Math.min((Number.isInteger(queueIndexRef.current) ? queueIndexRef.current : 0) + 1, q.length);
    const next = [...q.slice(0, insertAt), song, ...q.slice(insertAt)];
    setQueue(next);
    if (isShuffledRef.current) {
      setShuffleOrder((order) => {
        if (!order.length) return order;
        const remapped = order.map((i) => (i >= insertAt ? i + 1 : i));
        const pos = Math.max(0, Math.min(shufflePosRef.current, remapped.length));
        return [...remapped.slice(0, pos + 1), insertAt, ...remapped.slice(pos + 1)];
      });
    }
    return true;
  }, [loadSong]);

  useEffect(() => {
    const onLogout = () => { clearQueue(); hydratedRef.current = false; };
    window.addEventListener('auth:logout', onLogout);
    return () => window.removeEventListener('auth:logout', onLogout);
  }, [clearQueue]);

  useEffect(() => {
    if (!isAuthenticated) {
      hydratedRef.current = false;
      if (currentSongRef.current || queueRef.current.length) clearQueue();
    }
  }, [isAuthenticated, clearQueue]);

  useEffect(() => {
    if (!isAuthenticated || hydratedRef.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const state = await musicService.getPlaybackState();
        if (cancelled || !state) return;
        const songId = state.songId || state.song_id;
        if (!songId) { hydratedRef.current = true; return; }
        const raw = await musicService.getSong(songId);
        const song = normalizeSongPayload(raw);
        if (!song || cancelled) { hydratedRef.current = true; return; }
        const startAt = Number(state.position) || 0;
        setQueue([song]);
        setQueueIndex(0);
        await loadSong(song, { autoplay: false, startAt });
        hydratedRef.current = true;
      } catch (_) {
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, loadSong]);

  // Media Session: metadata + transport actions for lock-screen / OS media keys.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return undefined;
    const ms = navigator.mediaSession;
    try {
      if (currentSong) {
        ms.metadata = new MediaMetadata({
          title: currentSong.title || 'Unknown',
          artist: currentSong.artist || currentSong.uploader_name || '',
          album: currentSong.album || '',
        });
        ms.playbackState = isPlaying ? 'playing' : 'paused';
      } else {
        ms.metadata = null;
        ms.playbackState = 'none';
      }
    } catch (_) {}
    return undefined;
  }, [currentSong, isPlaying]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return undefined;
    const ms = navigator.mediaSession;
    const safe = (fn) => () => { try { fn(); } catch (_) {} };
    try {
      ms.setActionHandler('play', safe(() => { play(); }));
      ms.setActionHandler('pause', safe(() => { pause(); }));
      ms.setActionHandler('previoustrack', safe(() => { playPrevious(); }));
      ms.setActionHandler('nexttrack', safe(() => { playNext(); }));
      ms.setActionHandler('seekbackward', safe((details) => {
        const offset = (details && Number.isFinite(details.seekOffset) ? details.seekOffset : MEDIA_SESSION_SEEK_SEC);
        const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        seek(Math.max(0, t - offset));
      }));
      ms.setActionHandler('seekforward', safe((details) => {
        const offset = (details && Number.isFinite(details.seekOffset) ? details.seekOffset : MEDIA_SESSION_SEEK_SEC);
        const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : t + offset;
        seek(Math.min(d, t + offset));
      }));
      ms.setActionHandler('seekto', safe((details) => {
        if (details && Number.isFinite(details.seekTime)) seek(details.seekTime);
      }));
    } catch (_) {}
    return () => {
      try {
        ['play', 'pause', 'previoustrack', 'nexttrack', 'seekbackward', 'seekforward', 'seekto'].forEach((a) => {
          try { ms.setActionHandler(a, null); } catch (_) {}
        });
      } catch (_) {}
    };
  }, [audio, play, pause, playNext, playPrevious, seek]);

  // Keyboard: Space play/pause, N next, P previous, arrows seek, M mute.
  // Ignore when focus is in input/textarea/select/contenteditable.
  useEffect(() => {
    const isTypingTarget = (el) => {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable) return true;
      return false;
    };
    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const key = e.key;
      if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        togglePlay();
        return;
      }
      if (key === 'n' || key === 'N') {
        e.preventDefault();
        playNext();
        return;
      }
      if (key === 'p' || key === 'P') {
        e.preventDefault();
        playPrevious();
        return;
      }
      if (key === 'm' || key === 'M') {
        e.preventDefault();
        toggleMute();
        return;
      }
      if (key === 'ArrowRight') {
        e.preventDefault();
        const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const d = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : t + KEYBOARD_SEEK_SEC;
        seek(Math.min(d, t + KEYBOARD_SEEK_SEC));
        return;
      }
      if (key === 'ArrowLeft') {
        e.preventDefault();
        const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        seek(Math.max(0, t - KEYBOARD_SEEK_SEC));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [audio, togglePlay, playNext, playPrevious, toggleMute, seek]);

  const value = {
    currentSong, isPlaying, volume, playbackSpeed, progress, duration, queue, queueIndex,
    shuffleOrder, shufflePos,
    isShuffled, repeatMode, audioSrc, loudnessGain: 1, waveform: null,
    play, pause, togglePlay, seek, playNext, playPrevious, loadSong,
    clearQueue, addToQueue, setQueueAndPlay,
    setVolume, setPlaybackSpeed, toggleMute,
    toggleShuffle,
    cycleRepeat: () => setRepeatMode((prev) => (prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none')),
    formatTime,
    removeFromQueue,
    moveInQueue,
    insertNext,
    playAtIndex: async (i) => {
      const q = queueRef.current;
      if (q[i]) {
        setQueueIndex(i);
        if (isShuffledRef.current && shuffleOrderRef.current.length) {
          const pos = shuffleOrderRef.current.indexOf(i);
          if (pos >= 0) setShufflePos(pos);
        }
        await loadSong(q[i], { autoplay: true });
      }
    },
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
