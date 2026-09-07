import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';
import { useAuth } from './AuthContext';

const PlayerContext = createContext();

const PREV_RESTART_THRESHOLD_SEC = 3;
const PERSIST_DEBOUNCE_MS = 1500;
const KEYBOARD_SEEK_SEC = 5;
const KEYBOARD_VOLUME_STEP = 0.05;
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
  try {
    audio.currentTime = time;
  } catch (_) {}
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
  const persistTimer = useRef(null);
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
    return true;
  }, []);

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
      try {
        await audio.play();
        setIsPlaying(true);
      } catch (_) {
        setIsPlaying(false);
      }
      return;
    }

    if (isShuffledRef.current && shuffleOrderRef.current.length === q.length) {
      let nextPos = shufflePosRef.current + 1;
      if (nextPos >= shuffleOrderRef.current.length) {
        if (repeatModeRef.current === 'all') {
          const order = fisherYatesShuffle(q.length);
          const cur = queueIndexRef.current;
          const pos = order.indexOf(cur);
          if (pos > 0) {
            order.splice(pos, 1);
            order.unshift(cur);
          }
          setShuffleOrder(order);
          setShufflePos(0);
          nextPos = 1;
          if (order.length <= 1) {
            safeSetCurrentTime(audio, 0);
            setProgress(0);
            try {
              await audio.play();
              setIsPlaying(true);
            } catch (_) {
              setIsPlaying(false);
            }
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
    const onEnded = () => {
      playNext();
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [audio, playNext]);

  // Dose 1: one automatic re-fetch of signed stream URL when <audio> errors
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
          } catch (_) {
            setIsPlaying(false);
          }
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
        if (pos > 0) {
          order.splice(pos, 1);
          order.unshift(cur);
        }
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

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    try {
      if (!currentSong) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        return;
      }
      const artwork = [];
      if (currentSong.cover_url || currentSong.artwork_url || currentSong.coverUrl) {
        const src = currentSong.cover_url || currentSong.artwork_url || currentSong.coverUrl;
        artwork.push({ src, sizes: '512x512', type: 'image/jpeg' });
      }
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title || 'Unknown',
        artist: currentSong.artist || currentSong.uploader || 'Hathor',
        album: currentSong.album || '',
        artwork,
      });
    } catch (_) {}
  }, [currentSong]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    try {
      if (!currentSong) {
        navigator.mediaSession.playbackState = 'none';
      } else {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      }
    } catch (_) {}
  }, [isPlaying, currentSong]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return undefined;

    const handlers = {
      play: () => { play(); },
      pause: () => { pause(); },
      previoustrack: () => { playPrevious(); },
      nexttrack: () => { playNext(); },
      seekbackward: (details) => {
        const offset = (details && Number.isFinite(details.seekOffset) ? details.seekOffset : MEDIA_SESSION_SEEK_SEC);
        const t = (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) - offset;
        seek(Math.max(0, t));
      },
      seekforward: (details) => {
        const offset = (details && Number.isFinite(details.seekOffset) ? details.seekOffset : MEDIA_SESSION_SEEK_SEC);
        const t = (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) + offset;
        seek(t);
      },
      seekto: (details) => {
        if (details && Number.isFinite(details.seekTime)) seek(details.seekTime);
      },
    };

    try {
      Object.entries(handlers).forEach(([action, handler]) => {
        try {
          navigator.mediaSession.setActionHandler(action, handler);
        } catch (_) {}
      });
    } catch (_) {}

    return () => {
      try {
        Object.keys(handlers).forEach((action) => {
          try {
            navigator.mediaSession.setActionHandler(action, null);
          } catch (_) {}
        });
      } catch (_) {}
    };
  }, [play, pause, playNext, playPrevious, seek, audio]);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || (e.target && e.target.isContentEditable)) return;
      const key = e.key;
      if (key === 'n' || key === 'N') {
        e.preventDefault();
        playNext();
      } else if (key === 'p' || key === 'P') {
        e.preventDefault();
        playPrevious();
      } else if (key === ' ' || key === 'Spacebar') {
        e.preventDefault();
        if (isPlayingRef.current) pause();
        else play();
      } else if (key === 'ArrowLeft') {
        e.preventDefault();
        const t = (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) - KEYBOARD_SEEK_SEC;
        seek(Math.max(0, t));
      } else if (key === 'ArrowRight') {
        e.preventDefault();
        const t = (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) + KEYBOARD_SEEK_SEC;
        seek(t);
      } else if (key === 'ArrowUp') {
        e.preventDefault();
        const v = Math.min(1, (volumeRef.current || 0) + KEYBOARD_VOLUME_STEP);
        if (v > 0) preMuteVolumeRef.current = v;
        setVolumeState(v);
      } else if (key === 'ArrowDown') {
        e.preventDefault();
        const v = Math.max(0, (volumeRef.current || 0) - KEYBOARD_VOLUME_STEP);
        if (v > 0) preMuteVolumeRef.current = v;
        setVolumeState(v);
      } else if (key === 'm' || key === 'M') {
        e.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playNext, playPrevious, play, pause, seek, audio, toggleMute]);

  const removeFromQueue = useCallback((index) => {
    if (!Number.isInteger(index) || index < 0) return;
    const q = queueRef.current;
    if (index >= q.length) return;
    const wasCurrent = index === queueIndexRef.current;
    const newQueue = q.filter((_, i) => i !== index);
    setQueue(newQueue);
    if (isShuffledRef.current && shuffleOrderRef.current.length) {
      setShuffleOrder((order) => remapShuffleAfterRemove(order, index));
      setShufflePos((pos) => {
        const order = shuffleOrderRef.current;
        if (pos >= order.length - 1) return Math.max(0, order.length - 2);
        return pos;
      });
    }
    if (wasCurrent) {
      if (newQueue.length === 0) {
        clearQueue();
      } else {
        const nextIdx = Math.min(index, newQueue.length - 1);
        setQueueIndex(nextIdx);
        loadSong(newQueue[nextIdx], { autoplay: isPlayingRef.current });
      }
    } else if (index < queueIndexRef.current) {
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
      setShuffleOrder((order) => remapShuffleAfterMove(order, from, to));
    }
  }, []);

  // Hydrate playback state once when authenticated
  useEffect(() => {
    if (!isAuthenticated || hydratedRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const state = await musicService.getPlaybackState();
        if (cancelled || !state) return;
        hydratedRef.current = true;
        if (state.volume != null && Number.isFinite(Number(state.volume))) {
          setVolumeState(Math.max(0, Math.min(1, Number(state.volume))));
        }
        if (state.playbackSpeed != null && Number.isFinite(Number(state.playbackSpeed))) {
          setPlaybackSpeedState(Math.max(0.5, Math.min(2, Number(state.playbackSpeed))));
        }
        if (state.songId && state.song) {
          const song = state.song;
          setQueue([song]);
          setQueueIndex(0);
          const startAt = Number.isFinite(Number(state.position)) ? Number(state.position) : 0;
          await loadSong(song, { autoplay: Boolean(state.isPlaying), startAt });
        }
      } catch (_) {
        hydratedRef.current = true;
      }
    })();
    return () => { cancelled = true; };
  }, [isAuthenticated, loadSong]);

  // Debounced persist of playback state
  useEffect(() => {
    if (!isAuthenticated || !currentSong) return;
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const payload = {
        songId: currentSongRef.current?.id,
        position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        isPlaying: isPlayingRef.current,
        volume: volumeRef.current,
        playbackSpeed: audio.playbackRate || 1,
      };
      try {
        musicService.updatePlaybackState(payload).catch(() => {});
      } catch (_) {}
    }, PERSIST_DEBOUNCE_MS);
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    };
  }, [isAuthenticated, currentSong, isPlaying, progress, volume, playbackSpeed, audio]);

  // Flush on hide
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const onHide = () => {
      if (!currentSongRef.current) return;
      const payload = {
        songId: currentSongRef.current?.id,
        position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        isPlaying: isPlayingRef.current,
        volume: volumeRef.current,
        playbackSpeed: audio.playbackRate || 1,
      };
      try {
        musicService.updatePlaybackState(payload).catch(() => {});
      } catch (_) {}
    };
    const onVis = () => {
      if (document.visibilityState === 'hidden') onHide();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', onHide);
    };
  }, [isAuthenticated, audio]);

  const value = {
    currentSong, isPlaying, volume, playbackSpeed, progress, duration, queue, queueIndex,
    isShuffled, repeatMode, audioSrc, loudnessGain: 1, waveform: null,
    play, pause, togglePlay, seek, playNext, playPrevious, loadSong,
    clearQueue, addToQueue, setQueueAndPlay,
    setVolume, setPlaybackSpeed, toggleMute,
    toggleShuffle,
    cycleRepeat: () => setRepeatMode((prev) => (prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none')),
    formatTime,
    removeFromQueue,
    moveInQueue,
    insertNext: (song) => {
      if (!song || song.id == null) return false;
      const q = queueRef.current;
      if (q.some((s) => s && s.id === song.id)) return false;
      const insertAt = Math.min((Number.isInteger(queueIndexRef.current) ? queueIndexRef.current : 0) + 1, q.length);
      const next = [...q.slice(0, insertAt), song, ...q.slice(insertAt)];
      setQueue(next);
      if (isShuffledRef.current) {
        setShuffleOrder((order) => {
          if (!order.length) return order;
          // Remap indices >= insertAt, then insert new index immediately after current shuffle position
          // so play-next under shuffle actually plays next (not at end of cycle).
          const remapped = order.map((i) => (i >= insertAt ? i + 1 : i));
          const pos = Math.max(0, Math.min(shufflePosRef.current, remapped.length));
          const withNext = [...remapped.slice(0, pos + 1), insertAt, ...remapped.slice(pos + 1)];
          return withNext;
        });
      }
      return true;
    },
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
