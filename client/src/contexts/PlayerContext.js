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

  useEffect(() => {
    if (isAuthenticated) return undefined;
    hydratedRef.current = false;
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
    clearTimeout(persistTimer.current);
    try {
      if (typeof navigator !== 'undefined' && navigator.mediaSession) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
      }
    } catch (_) {}
    return undefined;
  }, [isAuthenticated, audio]);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
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
    return () => { cancelled = true; };
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
      musicService.updatePlaybackState(payload).catch(() => {});
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
    if (!audio.src) return;
    const d = audio.duration;
    const clamped = Number.isFinite(d) && d > 0 ? Math.max(0, Math.min(d, time)) : Math.max(0, time);
    safeSetCurrentTime(audio, clamped);
    setProgress(clamped);
    persistPlayback();
  }, [audio, persistPlayback]);

  const recordListeningIfNeeded = useCallback((song, seconds) => {
    if (!isAuthenticated || !song?.id) return;
    const dur = Math.floor(Number.isFinite(seconds) ? seconds : 0);
    if (dur < 5) return;
    musicService.recordListening(song.id, dur).catch(() => {});
  }, [isAuthenticated]);

  const playAtIndex = useCallback(
    async (index) => {
      const q = queueRef.current;
      if (!q.length || index < 0 || index >= q.length) return;
      const prev = currentSongRef.current;
      const nextSong = q[index];
      if (prev?.id != null && nextSong?.id !== prev.id) {
        const played = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        recordListeningIfNeeded(prev, played);
      }
      setQueueIndex(index);
      if (isShuffledRef.current) {
        const order = shuffleOrderRef.current;
        const pos = order.indexOf(index);
        if (pos >= 0) setShufflePos(pos);
      }
      await loadSong(q[index], { autoplay: true });
    },
    [audio, loadSong, recordListeningIfNeeded]
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
      const song = currentSongRef.current;
      const played =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : Number.isFinite(audio.currentTime)
            ? audio.currentTime
            : 0;
      recordListeningIfNeeded(song, played);
      playNext();
    };
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [audio, playNext, recordListeningIfNeeded]);

  const setQueueAndPlay = useCallback(
    async (songs, startIndex = 0) => {
      const list = Array.isArray(songs) ? songs.filter(Boolean) : [];
      const prev = currentSongRef.current;
      const nextSong = list[startIndex];
      if (prev?.id != null && nextSong?.id !== prev.id) {
        const played = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        recordListeningIfNeeded(prev, played);
      }
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
    [audio, loadSong, recordListeningIfNeeded]
  );

  // dose-1.99: skip if song.id already in queue (duplicate guard).
  const addToQueue = useCallback((song) => {
    if (!song || song.id == null) return;
    setQueue((prev) => {
      if (prev.some((s) => s && s.id === song.id)) return prev;
      return [...prev, song];
    });
  }, []);

  // dose-1.98: insert immediately after current queueIndex (and shuffle pos).
  const insertNext = useCallback((song) => {
    if (!song || song.id == null) return;
    setQueue((prev) => {
      if (prev.some((s) => s && s.id === song.id)) return prev;
      if (!prev.length) return [song];
      const idx = Number.isInteger(queueIndexRef.current) ? queueIndexRef.current : 0;
      const insertAt = Math.min(idx + 1, prev.length);
      const next = [...prev];
      next.splice(insertAt, 0, song);
      if (isShuffledRef.current) {
        setShuffleOrder((so) => {
          const mapped = so.map((i) => (i >= insertAt ? i + 1 : i));
          const pos = shufflePosRef.current;
          mapped.splice(pos + 1, 0, insertAt);
          return mapped;
        });
      }
      return next;
    });
  }, []);

  const removeFromQueue = useCallback((index) => {
    setQueue((prev) => {
      if (index < 0 || index >= prev.length) return prev;
      const removingCurrent = index === queueIndexRef.current;
      const wasPlaying = isPlayingRef.current;
      if (removingCurrent) {
        const cur = currentSongRef.current;
        const played = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        recordListeningIfNeeded(cur, played);
      }
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
          } catch (_) {}
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
  }, [audio, loadSong, recordListeningIfNeeded]);

  const clearQueue = useCallback(() => {
    const prev = currentSongRef.current;
    const played = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    recordListeningIfNeeded(prev, played);
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
    playGeneration.current += 1;
    streamRetryGen.current = -1;
    persistPlayback();
  }, [audio, recordListeningIfNeeded, persistPlayback]);

  const moveInQueue = useCallback((from, to) => {
    setQueue((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length || from === to) {
        return prev;
      }
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      setQueueIndex((qi) => remapIndexAfterMove(qi, from, to));
      setShuffleOrder((so) => remapShuffleAfterMove(so, from, to));
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
      const restore = Number.isFinite(preMuteVolumeRef.current) && preMuteVolumeRef.current > 0
        ? preMuteVolumeRef.current
        : 1;
      setVolumeState(restore);
    }
  }, []);

  const setPlaybackSpeed = useCallback((s) => {
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0) return;
    setPlaybackSpeedState(Math.max(0.5, Math.min(2, n)));
  }, []);

  const toggleShuffle = useCallback(() => {
    setIsShuffled((prev) => {
      const next = !prev;
      if (next) {
        const q = queueRef.current;
        if (q.length) {
          const order = fisherYatesShuffle(q.length);
          setShuffleOrder(order);
          const pos = order.indexOf(queueIndexRef.current);
          setShufflePos(pos >= 0 ? pos : 0);
        }
      } else {
        setShuffleOrder([]);
        setShufflePos(0);
      }
      return next;
    });
  }, []);

  const formatTime = useCallback((sec) => {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const s = Math.floor(sec);
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${r.toString().padStart(2, '0')}`;
  }, []);

  useEffect(() => {
    if (!isAuthenticated) return undefined;
    const onKey = (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek((Number.isFinite(audio.currentTime) ? audio.currentTime : 0) + KEYBOARD_SEEK_SEC);
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek((Number.isFinite(audio.currentTime) ? audio.currentTime : 0) - KEYBOARD_SEEK_SEC);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setVolume(Math.min(1, (volumeRef.current || 0) + KEYBOARD_VOLUME_STEP));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setVolume(Math.max(0, (volumeRef.current || 0) - KEYBOARD_VOLUME_STEP));
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        toggleMute();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        playNext();
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        playPrevious();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isAuthenticated, audio, togglePlay, seek, setVolume, toggleMute, playNext, playPrevious]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    try {
      if (!currentSong) {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.playbackState = 'none';
        return;
      }
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentSong.title || 'Unknown',
        artist: currentSong.artist || 'Unknown',
        album: currentSong.album || '',
        artwork: currentSong.cover_url
          ? [{ src: currentSong.cover_url, sizes: '512x512', type: 'image/jpeg' }]
          : [],
      });
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      navigator.mediaSession.setActionHandler('play', () => play());
      navigator.mediaSession.setActionHandler('pause', () => pause());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevious());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
      navigator.mediaSession.setActionHandler('seekbackward', (d) => {
        const off = (d && d.seekOffset) || MEDIA_SESSION_SEEK_SEC;
        seek((Number.isFinite(audio.currentTime) ? audio.currentTime : 0) - off);
      });
      navigator.mediaSession.setActionHandler('seekforward', (d) => {
        const off = (d && d.seekOffset) || MEDIA_SESSION_SEEK_SEC;
        seek((Number.isFinite(audio.currentTime) ? audio.currentTime : 0) + off);
      });
      navigator.mediaSession.setActionHandler('seekto', (d) => {
        if (d && Number.isFinite(d.seekTime)) seek(d.seekTime);
      });
    } catch (_) {}
  }, [currentSong, isPlaying, play, pause, playNext, playPrevious, seek, audio]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaSession) return;
    if (!currentSong || !Number.isFinite(duration) || duration <= 0) return;
    try {
      if (typeof navigator.mediaSession.setPositionState === 'function') {
        navigator.mediaSession.setPositionState({
          duration,
          playbackRate: Number.isFinite(playbackSpeed) && playbackSpeed > 0 ? playbackSpeed : 1,
          position: Math.min(duration, Math.max(0, Number.isFinite(progress) ? progress : 0)),
        });
      }
    } catch (_) {}
  }, [currentSong, duration, progress, playbackSpeed, isPlaying]);

  const value = {
    currentSong, isPlaying, volume, playbackSpeed, progress, duration, queue, queueIndex,
    isShuffled, repeatMode, audioSrc, loudnessGain: 1, waveform: null,
    play, pause, togglePlay, seek, playNext, playPrevious, playAtIndex,
    removeFromQueue, clearQueue, moveInQueue, addToQueue, insertNext, setQueueAndPlay, loadSong,
    setVolume, setPlaybackSpeed, toggleMute, toggleShuffle,
    cycleRepeat: () => setRepeatMode((prev) => (prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none')),
    formatTime,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
