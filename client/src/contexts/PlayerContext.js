import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';
import { useAuth } from './AuthContext';

const PlayerContext = createContext();

const PREV_RESTART_THRESHOLD_SEC = 3;
const PERSIST_DEBOUNCE_MS = 1500;
/** dose-1.71: keyboard seek step (seconds) */
const KEYBOARD_SEEK_SEC = 5;
const KEYBOARD_VOLUME_STEP = 0.05;
/** dose-1.72: Media Session seek offset (seconds) */
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

/** Remap queue indices after moving item from `from` to `to` (same semantics as array move). */
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
  const hydratedRef = useRef(false);
  const persistTimer = useRef(null);
  /** dose-1.62: one automatic stream-url refresh per loadSong gen after media error */
  const streamRetryGen = useRef(-1);
  /** dose-1.73: restore volume after mute */
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

  // Dose 1.62: if <audio> errors (expired signed token, transient 4xx), mint a fresh
  // stream-url once for the same playGeneration and resume near the last position.
  useEffect(() => {
    const onError = () => {
      const song = currentSongRef.current;
      const gen = playGeneration.current;
      if (!song || song.id == null) return;
      if (streamRetryGen.current === gen) return;
      streamRetryGen.current = gen;
      const resumeAt = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      const wantPlay = isPlayingRef.current;
      (async () => {
        try {
          const data = await musicService.getStreamUrl(song.id);
          if (gen !== playGeneration.current) return;
          const url = data?.url;
          if (!url) return;
          setAudioSrc(url);
          audio.src = url;
          audio.load();
          const onMeta = () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
            if (resumeAt > 0) safeSetCurrentTime(audio, resumeAt);
          };
          audio.addEventListener('loadedmetadata', onMeta, { once: true });
          if (wantPlay) {
            try {
              await audio.play();
              if (gen === playGeneration.current) setIsPlaying(true);
            } catch (_) {
              setIsPlaying(false);
            }
          }
        } catch (err) {
          console.warn('stream URL refresh after media error failed', err);
          setIsPlaying(false);
        }
      })();
    };
    audio.addEventListener('error', onError);
    return () => audio.removeEventListener('error', onError);
  }, [audio]);

  // Dose 1.61: on logout (isAuthenticated -> false), stop audio and clear local player
  // so soft logout does not leave music playing under the login screen.
  useEffect(() => {
    if (isAuthenticated) return undefined;
    hydratedRef.current = false;
    try {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    } catch (_) {
      /* ignore */
    }
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
    clearTimeout(persistTimer.current);
    // dose-1.72: clear Media Session metadata on logout
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      }
    } catch (_) {
      /* ignore */
    }
    return undefined;
  }, [isAuthenticated, audio]);

  // Dose 1.59: hydrate from Redis-backed /api/playback/state once after login
  useEffect(() => {
    if (!isAuthenticated) {
      return undefined;
    }
    if (hydratedRef.current) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await musicService.getPlaybackState();
        if (cancelled) return;
        const st = data?.state;
        if (!st) {
          hydratedRef.current = true;
          return;
        }
        const songId = st.current_song_id ?? st.currentSongId;
        const pos = Number(st.position);
        const startAt = Number.isFinite(pos) && pos > 0 ? pos : 0;
        const vol = Number(st.volume);
        if (Number.isFinite(vol)) setVolumeState(Math.max(0, Math.min(1, vol)));
        const speedRaw = st.playback_speed ?? st.playbackSpeed;
        const speed = Number(speedRaw);
        if (Number.isFinite(speed) && speed > 0) {
          setPlaybackSpeedState(Math.max(0.5, Math.min(2, speed)));
        }
        const wantPlay = Boolean(st.is_playing ?? st.isPlaying);
        if (songId != null) {
          try {
            const songRes = await musicService.getSong(songId);
            const song = songRes?.song || songRes;
            if (song && !cancelled) {
              await loadSong(song, { autoplay: wantPlay, startAt });
            }
          } catch (songErr) {
            console.warn('playback hydrate: song load failed', songErr);
          }
        }
      } catch (err) {
        console.warn('playback hydrate failed', err);
      } finally {
        if (!cancelled) hydratedRef.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, loadSong]);

  const persistPlayback = useCallback(() => {
    if (!isAuthenticated || !hydratedRef.current) return;
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      const song = currentSongRef.current;
      const payload = {
        currentSongId: song?.id ?? null,
        position: Math.floor(Number.isFinite(audio.currentTime) ? audio.currentTime : 0),
        isPlaying: isPlayingRef.current,
        volume: Number.isFinite(audio.volume) ? audio.volume : 1,
        playbackSpeed: Number.isFinite(audio.playbackRate) ? audio.playbackRate : 1,
      };
      musicService.updatePlaybackState(payload).catch(() => {
        /* non-blocking */
      });
    }, PERSIST_DEBOUNCE_MS);
  }, [isAuthenticated, audio]);

  useEffect(() => {
    if (!hydratedRef.current) return undefined;
    persistPlayback();
    return () => clearTimeout(persistTimer.current);
  }, [currentSong, isPlaying, volume, playbackSpeed, persistPlayback]);

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
    // dose-1.70: skip seek when media has no src (cleared queue / pre-load)
    if (!audio.src) return;
    const d = audio.duration;
    const clamped = Number.isFinite(d) && d > 0 ? Math.max(0, Math.min(d, time)) : Math.max(0, time);
    safeSetCurrentTime(audio, clamped);
    setProgress(clamped);
    persistPlayback();
  }, [audio, persistPlayback]);

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

  // dose-1.63: if the removed row is now-playing, load the song that lands at
  // the adjusted index (or stop cleanly when the queue becomes empty).
  const removeFromQueue = useCallback((index) => {
    setQueue((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const removingCurrent = index === queueIndexRef.current;
      const wasPlaying = isPlayingRef.current;
      const next = prev.filter((_, i) => i !== index);
      setShuffleOrder((so) => remapShuffleAfterRemove(so, index));
      let newIndex = queueIndexRef.current;
      if (index < newIndex) newIndex -= 1;
      else if (index === newIndex) newIndex = Math.min(newIndex, Math.max(0, next.length - 1));
      setQueueIndex(next.length === 0 ? 0 : newIndex);
      if (removingCurrent) {
        if (next.length === 0) {
          try {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
          } catch (_) {
            /* ignore */
          }
          setIsPlaying(false);
          setCurrentSong(null);
          setAudioSrc(null);
          setProgress(0);
          setDuration(0);
          playGeneration.current += 1;
          streamRetryGen.current = -1;
        } else {
          const song = next[newIndex];
          queueMicrotask(() => {
            if (song) loadSong(song, { autoplay: wasPlaying });
          });
        }
      }
      return next;
    });
  }, [audio, loadSong]);

  const clearQueue = useCallback(() => {
    setQueue([]);
    setQueueIndex(0);
    setShuffleOrder([]);
    setShufflePos(0);
  }, []);

  const moveInQueue = useCallback((from, to) => {
    setQueue((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length || from === to) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      setShuffleOrder((so) => (so.length ? remapShuffleAfterMove(so, from, to) : so));
      setQueueIndex((qi) => remapIndexAfterMove(qi, from, to));
      setShufflePos((sp) => sp);
      return next;
    });
  }, []);

  const toggleShuffle = useCallback(() => {
    setIsShuffled((prev) => {
      const next = !prev;
      if (next) {
        const q = queueRef.current;
        if (q.length) {
          const order = fisherYatesShuffle(q.length);
          setShuffleOrder(order);
          const qi = queueIndexRef.current;
          const pos = order.indexOf(qi);
          setShufflePos(pos >= 0 ? pos : 0);
        }
      }
      return next;
    });
  }, []);

  const setVolume = useCallback((v) => {
    const next = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
    if (next > 0) preMuteVolumeRef.current = next;
    setVolumeState(next);
  }, []);

  const setPlaybackSpeed = useCallback((s) => {
    const next = Number.isFinite(s) && s > 0 ? Math.max(0.5, Math.min(2, s)) : 1;
    setPlaybackSpeedState(next);
  }, []);

  const formatTime = useCallback((seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }, []);

  // dose-1.71: media keyboard shortcuts when not typing in an input/textarea/contenteditable
  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const isTypingTarget = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const tag = el.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (el.isContentEditable) return true;
      return Boolean(el.closest && el.closest('[contenteditable="true"]'));
    };
    const onKeyDown = (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (!currentSongRef.current) return;
      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          if (isPlayingRef.current) {
            audio.pause();
            setIsPlaying(false);
          } else {
            (async () => {
              try {
                if (!audio.src && currentSongRef.current) {
                  await loadSong(currentSongRef.current, {
                    autoplay: true,
                    startAt: audio.currentTime || 0,
                  });
                  return;
                }
                await audio.play();
                setIsPlaying(true);
              } catch (_) {
                setIsPlaying(false);
              }
            })();
          }
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J': {
          e.preventDefault();
          if (!audio.src) return;
          const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
          const next = Math.max(0, t - KEYBOARD_SEEK_SEC);
          safeSetCurrentTime(audio, next);
          setProgress(next);
          persistPlayback();
          break;
        }
        case 'ArrowRight':
        case 'l':
        case 'L': {
          e.preventDefault();
          if (!audio.src) return;
          const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
          const d = audio.duration;
          const next =
            Number.isFinite(d) && d > 0
              ? Math.min(d, t + KEYBOARD_SEEK_SEC)
              : t + KEYBOARD_SEEK_SEC;
          safeSetCurrentTime(audio, next);
          setProgress(next);
          persistPlayback();
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          setVolumeState((v) => {
            const base = Number.isFinite(v) ? v : 1;
            return Math.min(1, base + KEYBOARD_VOLUME_STEP);
          });
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          setVolumeState((v) => {
            const base = Number.isFinite(v) ? v : 1;
            return Math.max(0, base - KEYBOARD_VOLUME_STEP);
          });
          break;
        }
        case 'm':
        case 'M': {
          // dose-1.73: toggle mute; restore last non-zero volume
          e.preventDefault();
          const cur = Number.isFinite(volumeRef.current) ? volumeRef.current : 1;
          if (cur > 0) {
            preMuteVolumeRef.current = cur;
            setVolumeState(0);
          } else {
            const restore = Number.isFinite(preMuteVolumeRef.current) && preMuteVolumeRef.current > 0
              ? preMuteVolumeRef.current
              : 1;
            setVolumeState(Math.min(1, restore));
          }
          break;
        }
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isAuthenticated, audio, loadSong, persistPlayback]);

  // dose-1.72: Media Session action handlers
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return undefined;
    const ms = navigator.mediaSession;
    const handlers = {
      play: () => {
        play();
      },
      pause: () => {
        pause();
      },
      previoustrack: () => {
        playPrevious();
      },
      nexttrack: () => {
        playNext();
      },
      seekbackward: (details) => {
        const off = details?.seekOffset ?? MEDIA_SESSION_SEEK_SEC;
        if (!audio.src) return;
        const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const next = Math.max(0, t - off);
        safeSetCurrentTime(audio, next);
        setProgress(next);
        persistPlayback();
      },
      seekforward: (details) => {
        const off = details?.seekOffset ?? MEDIA_SESSION_SEEK_SEC;
        if (!audio.src) return;
        const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        const d = audio.duration;
        const next =
          Number.isFinite(d) && d > 0 ? Math.min(d, t + off) : t + off;
        safeSetCurrentTime(audio, next);
        setProgress(next);
        persistPlayback();
      },
      seekto: (details) => {
        if (details?.seekTime == null || !Number.isFinite(details.seekTime)) return;
        if (!audio.src) return;
        const d = audio.duration;
        const next =
          Number.isFinite(d) && d > 0
            ? Math.max(0, Math.min(d, details.seekTime))
            : Math.max(0, details.seekTime);
        safeSetCurrentTime(audio, next);
        setProgress(next);
        persistPlayback();
      },
    };
    Object.entries(handlers).forEach(([action, handler]) => {
      try {
        ms.setActionHandler(action, handler);
      } catch (_) {
        /* ignore unsupported action */
      }
    });
    return () => {
      Object.keys(handlers).forEach((action) => {
        try {
          ms.setActionHandler(action, null);
        } catch (_) {
          /* ignore */
        }
      });
    };
  }, [audio, loadSong, playNext, playPrevious, persistPlayback, play, pause]);

  // Keep Media Session metadata + playbackState in sync with current song / play state
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    const ms = navigator.mediaSession;
    try {
      if (!currentSong) {
        ms.metadata = null;
        ms.playbackState = 'none';
        return;
      }
      const artwork = [];
      if (currentSong.cover_url) {
        artwork.push({ src: currentSong.cover_url, sizes: '512x512', type: 'image/jpeg' });
      }
      ms.metadata = new MediaMetadata({
        title: currentSong.title || 'Unknown',
        artist: currentSong.artist || 'Unknown',
        album: currentSong.album || '',
        artwork,
      });
      ms.playbackState = isPlaying ? 'playing' : 'paused';
    } catch (_) {
      /* ignore */
    }
  }, [currentSong, isPlaying]);

  // Optional: report position state for scrubbing UIs that support it
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    if (!currentSong || !Number.isFinite(duration) || duration <= 0) return;
    try {
      if (typeof navigator.mediaSession.setPositionState === 'function') {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: Number.isFinite(playbackSpeed) && playbackSpeed > 0 ? playbackSpeed : 1,
          position: Math.min(
            duration,
            Math.max(0, Number.isFinite(progress) ? progress : 0)
          ),
        });
      }
    } catch (_) {
      /* ignore invalid position state */
    }
  }, [currentSong, duration, progress, playbackSpeed, isPlaying]);

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
