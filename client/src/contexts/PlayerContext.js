import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';
import { mediaService } from '../services/olympus';
import { recordEvent, flushEvents } from '../services/telemetry';
import { useAuth } from './AuthContext';

const PlayerContext = createContext();

const TARGET_LUFS = -14;
const PREV_RESTART_THRESHOLD_SEC = 3;
const END_RESTART_EPSILON_SEC = 0.35;

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

function normalizePlaybackState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const songId = raw.current_song_id ?? raw.currentSongId ?? null;
  if (songId == null) return null;
  return {
    currentSongId: Number(songId),
    position: Number(raw.position) || 0,
    isPlaying: Boolean(raw.is_playing ?? raw.isPlaying),
    volume: typeof raw.volume === 'number' ? raw.volume : 1,
    playbackSpeed: typeof (raw.playback_speed ?? raw.playbackSpeed) === 'number'
      ? (raw.playback_speed ?? raw.playbackSpeed)
      : 1,
  };
}

/** Safe seek — HTMLMediaElement can throw on unloaded/empty media. */
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
  const { user, isAuthenticated } = useAuth();
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

  const audioRef = useRef(typeof Audio !== 'undefined' ? new Audio() : { currentTime: 0, duration: 0, paused: true, volume: 1, playbackRate: 1, src: '', ended: false, readyState: 0, play: async () => {}, pause: () => {}, load: () => {}, addEventListener: () => {}, removeEventListener: () => {}, removeAttribute: () => {} });
  const preloadRef = useRef(null);
  const progressInterval = useRef(null);
  const lastSegmentRef = useRef(-1);
  const playGeneration = useRef(0);
  const streamRetryRef = useRef(0);
  const hydratedRef = useRef(false);
  const persistTimerRef = useRef(null);
  const isPlayingRef = useRef(false);
  const durationMetaCleanupRef = useRef(null);
  const audio = audioRef.current;

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { audio.volume = Math.max(0, Math.min(1, volume * loudnessGain)); }, [volume, loudnessGain, audio]);
  useEffect(() => { audio.playbackRate = playbackSpeed; }, [playbackSpeed, audio]);

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

  useEffect(() => {
    const handleError = async () => {
      const song = currentSong;
      if (!song) return;
      if (streamRetryRef.current >= 1) { setIsPlaying(false); return; }
      streamRetryRef.current += 1;
      const gen = playGeneration.current;
      const resumeAt = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      try {
        const { url } = await musicService.getStreamUrl(song.id);
        if (gen !== playGeneration.current) return;
        setAudioSrc(url);
        audio.src = url;
        const onMeta = () => {
          audio.removeEventListener('loadedmetadata', onMeta);
          if (gen !== playGeneration.current) return;
          if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
          if (resumeAt > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
            safeSetCurrentTime(audio, Math.min(resumeAt, audio.duration));
          }
          audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        };
        audio.addEventListener('loadedmetadata', onMeta);
        audio.load();
      } catch (err) {
        setIsPlaying(false);
      }
    };
    audio.addEventListener('error', handleError);
    return () => audio.removeEventListener('error', handleError);
  }, [audio, currentSong]);

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
    } catch (err) {}
  }, []);

  const preloadNext = useCallback(async (songs, currentQueueIndex, opts = {}) => {
    try {
      if (!songs || songs.length < 2) {
        if (preloadRef.current) { preloadRef.current.removeAttribute('src'); preloadRef.current.load(); }
        return;
      }
      const { shuffled, order, pos } = opts;
      let nextIndex;
      if (shuffled && Array.isArray(order) && order.length === songs.length) {
        const nextPos = ((typeof pos === 'number' ? pos : 0) + 1) % order.length;
        nextIndex = order[nextPos];
      } else {
        nextIndex = (currentQueueIndex + 1) % songs.length;
      }
      if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= songs.length) return;
      const next = songs[nextIndex];
      if (!next || next.id === songs[currentQueueIndex]?.id) return;
      const { url } = await musicService.getStreamUrl(next.id);
      if (!preloadRef.current) preloadRef.current = new Audio();
      preloadRef.current.preload = 'auto';
      preloadRef.current.src = url;
    } catch (err) {}
  }, []);

  const loadSong = useCallback(async (song) => {
    const gen = ++playGeneration.current;
    streamRetryRef.current = 0;
    if (durationMetaCleanupRef.current) { durationMetaCleanupRef.current(); durationMetaCleanupRef.current = null; }
    try {
      // Fail before mutating player state so callers (playNext/playPrevious/playAtIndex)
      // can roll back queue indices without currentSong diverging from the highlight.
      const { url } = await musicService.getStreamUrl(song.id);
      if (gen !== playGeneration.current) return;
      setAudioSrc(url);
      audio.src = url;
      setCurrentSong(song);
      setProgress(0);
      const catalogDuration = Number(song.duration);
      setDuration(Number.isFinite(catalogDuration) && catalogDuration > 0 ? catalogDuration : 0);
      lastSegmentRef.current = -1;
      const applyMediaDuration = () => {
        if (gen !== playGeneration.current) return;
        const d = audio.duration;
        if (Number.isFinite(d) && d > 0) setDuration(d);
      };
      if (audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0) {
        applyMediaDuration();
      } else {
        const onMeta = () => {
          audio.removeEventListener('loadedmetadata', onMeta);
          if (durationMetaCleanupRef.current === cleanup) durationMetaCleanupRef.current = null;
          applyMediaDuration();
        };
        const cleanup = () => audio.removeEventListener('loadedmetadata', onMeta);
        durationMetaCleanupRef.current = cleanup;
        audio.addEventListener('loadedmetadata', onMeta);
      }
      recordEvent('play', song, 0);
      applyLoudness(song);
      // Dose-1.41: history write must not fail the load. A throw here would leave
      // currentSong already set while playNext/playPrevious roll indices back.
      musicService.recordListening(song.id, 0).catch(() => {});
    } catch (err) {
      console.error('Failed to load song:', err);
      throw err;
    }
  }, [audio, applyLoudness]);

  useEffect(() => {
    if (!isAuthenticated || !user) { hydratedRef.current = false; return; }
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const data = await musicService.getPlaybackState();
        const state = normalizePlaybackState(data?.state);
        if (!state || cancelled) return;
        if (Number.isFinite(state.volume)) setVolume(Math.max(0, Math.min(1, state.volume)));
        if (Number.isFinite(state.playbackSpeed) && state.playbackSpeed > 0) setPlaybackSpeed(state.playbackSpeed);
        let songPayload;
        try { songPayload = await musicService.getSong(state.currentSongId); } catch { return; }
        if (cancelled) return;
        const song = songPayload?.song || songPayload;
        if (!song?.id) return;
        if (currentSong) return;
        await loadSong(song);
        if (cancelled) return;
        setQueue([song]);
        setQueueIndex(0);
        setShuffleOrder([0]);
        setShufflePos(0);
        const resumeAt = Math.max(0, state.position || 0);
        const onMeta = () => {
          audio.removeEventListener('loadedmetadata', onMeta);
          if (cancelled || playGeneration.current === 0) return;
          if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
          if (Number.isFinite(audio.duration) && audio.duration > 0 && resumeAt > 0) {
            const clamped = Math.min(resumeAt, audio.duration);
            safeSetCurrentTime(audio, clamped);
            setProgress(clamped);
          }
          setIsPlaying(false);
          audio.pause();
        };
        if (audio.readyState >= 1) onMeta();
        else audio.addEventListener('loadedmetadata', onMeta);
      } catch (err) {
        console.warn('Playback state hydrate skipped:', err?.message || err);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user]);

  useEffect(() => {
    if (isAuthenticated) return;
    playGeneration.current += 1;
    streamRetryRef.current = 0;
    hydratedRef.current = false;
    if (durationMetaCleanupRef.current) { durationMetaCleanupRef.current(); durationMetaCleanupRef.current = null; }
    if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    audio.pause();
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
    setWaveform(null);
    setLoudnessGain(1);
    audio.removeAttribute('src');
    audio.load();
    if (preloadRef.current) { preloadRef.current.removeAttribute('src'); preloadRef.current.load(); }
  }, [isAuthenticated, audio]);

  const persistPlaybackState = useCallback((overrides = {}) => {
    if (!isAuthenticated) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const song = overrides.currentSongId !== undefined ? null : currentSong;
      const songId = overrides.currentSongId !== undefined ? overrides.currentSongId : song?.id;
      if (songId == null && overrides.currentSongId === undefined) return;
      musicService.updatePlaybackState({
        currentSongId: songId ?? null,
        position: overrides.position ?? (Number.isFinite(audio.currentTime) ? audio.currentTime : 0),
        isPlaying: overrides.isPlaying ?? isPlaying,
        volume: overrides.volume ?? volume,
        playbackSpeed: overrides.playbackSpeed ?? playbackSpeed,
      }).catch(() => {});
    }, 800);
  }, [isAuthenticated, currentSong, isPlaying, volume, playbackSpeed, audio]);

  const flushPlaybackStateNow = useCallback(() => {
    if (!isAuthenticated) return;
    if (persistTimerRef.current) { clearTimeout(persistTimerRef.current); persistTimerRef.current = null; }
    const songId = currentSong?.id;
    if (songId == null) return;
    musicService.updatePlaybackState({
      currentSongId: songId,
      position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
      isPlaying,
      volume,
      playbackSpeed,
    }).catch(() => {});
  }, [isAuthenticated, currentSong, isPlaying, volume, playbackSpeed, audio]);

  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushPlaybackStateNow(); };
    const onPageHide = () => flushPlaybackStateNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flushPlaybackStateNow]);

  useEffect(() => () => {
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    if (durationMetaCleanupRef.current) { durationMetaCleanupRef.current(); durationMetaCleanupRef.current = null; }
  }, []);

  const play = useCallback(async () => {
    try {
      if (!audio.src && currentSong) await loadSong(currentSong);
      const d = audio.duration;
      const t = audio.currentTime;
      const atEnd = audio.ended || (Number.isFinite(d) && d > 0 && Number.isFinite(t) && t >= d - END_RESTART_EPSILON_SEC);
      if (atEnd) {
        // Dose-1.36: safe seek when restarting from natural end
        safeSetCurrentTime(audio, 0);
        setProgress(0);
      }
      await audio.play();
      setIsPlaying(true);
      persistPlaybackState({ isPlaying: true, position: atEnd ? 0 : (Number.isFinite(audio.currentTime) ? audio.currentTime : 0) });
    } catch (err) {
      console.error('Play error:', err);
      setIsPlaying(false);
    }
  }, [audio, currentSong, loadSong, persistPlaybackState]);

  const pause = useCallback(() => {
    audio.pause();
    setIsPlaying(false);
    if (currentSong) recordEvent('pause', currentSong, audio.currentTime);
    persistPlaybackState({ isPlaying: false, position: audio.currentTime });
  }, [audio, currentSong, persistPlaybackState]);

  const togglePlay = useCallback(() => { if (isPlaying) pause(); else play(); }, [isPlaying, pause, play]);

  const seek = useCallback((time) => {
    const d = audio.duration;
    if (!Number.isFinite(time) || time < 0) return;
    if (!Number.isFinite(d) || d <= 0) return;
    const clamped = Math.min(time, d);
    safeSetCurrentTime(audio, clamped);
    setProgress(clamped);
    if (currentSong) recordEvent('seek', currentSong, clamped);
    persistPlaybackState({ position: clamped });
  }, [audio, currentSong, persistPlaybackState]);

  const resolveNextIndex = useCallback((wrap = true) => {
    if (queue.length === 0) return null;
    if (isShuffled && shuffleOrder.length === queue.length) {
      if (!wrap && shufflePos >= shuffleOrder.length - 1) return null;
      const nextPos = (shufflePos + 1) % shuffleOrder.length;
      return { index: shuffleOrder[nextPos], shufflePos: nextPos };
    }
    if (!wrap && queueIndex >= queue.length - 1) return null;
    return { index: (queueIndex + 1) % queue.length, shufflePos };
  }, [queue, queueIndex, isShuffled, shuffleOrder, shufflePos]);

  const resolvePrevIndex = useCallback((wrap = true) => {
    if (queue.length === 0) return null;
    if (isShuffled && shuffleOrder.length === queue.length) {
      if (!wrap && shufflePos <= 0) return null;
      const prevPos = shufflePos > 0 ? shufflePos - 1 : shuffleOrder.length - 1;
      return { index: shuffleOrder[prevPos], shufflePos: prevPos };
    }
    if (!wrap && queueIndex <= 0) return null;
    const prevIndex = queueIndex > 0 ? queueIndex - 1 : queue.length - 1;
    return { index: prevIndex, shufflePos };
  }, [queue, queueIndex, isShuffled, shuffleOrder, shufflePos]);

  const playNext = useCallback(async () => {
    if (queue.length === 0) return;
    if (currentSong && audio.currentTime > 0 && audio.currentTime < (audio.duration || Infinity) - 1) {
      recordEvent('skip', currentSong, audio.currentTime);
    }
    const wrap = repeatMode !== 'none';
    const next = resolveNextIndex(wrap);
    if (next == null) {
      // Dose-1.34: under repeat-none at queue end, force audio element to end position
      // so progress UI and <audio> stay in sync (symmetric with Prev-at-start → 0).
      setIsPlaying(false);
      audio.pause();
      const endPos = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
      if (Number.isFinite(endPos) && endPos >= 0) {
        safeSetCurrentTime(audio, endPos);
      }
      setProgress(endPos);
      persistPlaybackState({ isPlaying: false, position: endPos });
      return;
    }
    // Dose-1.37: snapshot indices before advance so a failed loadSong can roll back
    // (otherwise queue highlight advances while currentSong stays on the previous track).
    const prevQueueIndex = queueIndex;
    const prevShufflePos = shufflePos;
    setQueueIndex(next.index);
    if (isShuffled) setShufflePos(next.shufflePos);
    // Dose-1.40: only roll back indices when loadSong fails. If load succeeds but
    // play() rejects (autoplay policy, etc.), keep advanced track + paused state.
    try {
      await loadSong(queue[next.index]);
    } catch (err) {
      setQueueIndex(prevQueueIndex);
      if (isShuffled) setShufflePos(prevShufflePos);
      setIsPlaying(false);
      return;
    }
    try {
      await audio.play();
      setIsPlaying(true);
      preloadNext(queue, next.index, { shuffled: isShuffled, order: shuffleOrder, pos: next.shufflePos });
      persistPlaybackState({ currentSongId: queue[next.index]?.id, position: 0, isPlaying: true });
    } catch (err) {
      setIsPlaying(false);
      preloadNext(queue, next.index, { shuffled: isShuffled, order: shuffleOrder, pos: next.shufflePos });
      persistPlaybackState({ currentSongId: queue[next.index]?.id, position: 0, isPlaying: false });
    }
  }, [queue, queueIndex, shufflePos, resolveNextIndex, isShuffled, shuffleOrder, loadSong, audio, currentSong, preloadNext, persistPlaybackState, repeatMode]);

  const playPrevious = useCallback(async () => {
    if (queue.length === 0) return;
    const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (t > PREV_RESTART_THRESHOLD_SEC) {
      if (currentSong) recordEvent('seek', currentSong, 0);
      // Dose-1.36: safe seek when restarting current track (>3s threshold)
      safeSetCurrentTime(audio, 0);
      setProgress(0);
      persistPlaybackState({ position: 0 });
      if (!isPlaying) {
        try { await audio.play(); setIsPlaying(true); persistPlaybackState({ position: 0, isPlaying: true }); }
        catch { setIsPlaying(false); }
      }
      return;
    }
    const wrap = repeatMode !== 'none';
    const prev = resolvePrevIndex(wrap);
    if (prev == null) {
      // Dose-1.33/1.36: under repeat-none at queue start, stop at position 0
      // with try/catch (symmetric with Next-at-end / natural ended).
      setIsPlaying(false);
      audio.pause();
      safeSetCurrentTime(audio, 0);
      setProgress(0);
      persistPlaybackState({ isPlaying: false, position: 0 });
      return;
    }
    // Dose-1.37: snapshot before advance; roll back if loadSong fails
    const prevQueueIndex = queueIndex;
    const prevShufflePos = shufflePos;
    setQueueIndex(prev.index);
    if (isShuffled) setShufflePos(prev.shufflePos);
    // Dose-1.40: only roll back on loadSong failure
    try {
      await loadSong(queue[prev.index]);
    } catch (err) {
      setQueueIndex(prevQueueIndex);
      if (isShuffled) setShufflePos(prevShufflePos);
      setIsPlaying(false);
      return;
    }
    try {
      await audio.play();
      setIsPlaying(true);
      preloadNext(queue, prev.index, { shuffled: isShuffled, order: shuffleOrder, pos: prev.shufflePos });
      persistPlaybackState({ currentSongId: queue[prev.index]?.id, position: 0, isPlaying: true });
    } catch (err) {
      setIsPlaying(false);
      preloadNext(queue, prev.index, { shuffled: isShuffled, order: shuffleOrder, pos: prev.shufflePos });
      persistPlaybackState({ currentSongId: queue[prev.index]?.id, position: 0, isPlaying: false });
    }
  }, [queue, queueIndex, shufflePos, resolvePrevIndex, isShuffled, shuffleOrder, loadSong, audio, preloadNext, persistPlaybackState, currentSong, isPlaying, repeatMode]);

  const playAtIndex = useCallback(async (index) => {
    if (!queue.length || index < 0 || index >= queue.length) return;
    const prevQueueIndex = queueIndex;
    const prevShufflePos = shufflePos;
    setQueueIndex(index);
    let pos = shufflePos;
    if (isShuffled && shuffleOrder.length === queue.length) {
      const found = shuffleOrder.indexOf(index);
      if (found >= 0) { pos = found; setShufflePos(found); }
    }
    // Dose-1.40: only roll back on loadSong failure
    try {
      await loadSong(queue[index]);
    } catch (err) {
      setQueueIndex(prevQueueIndex);
      if (isShuffled) setShufflePos(prevShufflePos);
      setIsPlaying(false);
      return;
    }
    try {
      await audio.play();
      setIsPlaying(true);
      preloadNext(queue, index, { shuffled: isShuffled, order: shuffleOrder, pos });
      persistPlaybackState({ currentSongId: queue[index]?.id, position: 0, isPlaying: true });
    } catch (err) {
      setIsPlaying(false);
      preloadNext(queue, index, { shuffled: isShuffled, order: shuffleOrder, pos });
      persistPlaybackState({ currentSongId: queue[index]?.id, position: 0, isPlaying: false });
    }
  }, [queue, queueIndex, isShuffled, shuffleOrder, shufflePos, loadSong, audio, preloadNext, persistPlaybackState]);

  const removeFromQueue = useCallback((index) => {
    if (index < 0 || index >= queue.length) return;
    const newQueue = queue.filter((_, i) => i !== index);
    const newShuffle = remapShuffleAfterRemove(shuffleOrder, index);
    const wasPlaying = isPlayingRef.current;
    if (newQueue.length === 0) {
      setQueue([]); setQueueIndex(0); setShuffleOrder([]); setShufflePos(0);
      audio.pause(); setIsPlaying(false); setCurrentSong(null); setAudioSrc(null); setProgress(0); setDuration(0);
      audio.removeAttribute('src'); audio.load();
      if (preloadRef.current) { preloadRef.current.removeAttribute('src'); preloadRef.current.load(); }
      persistPlaybackState({ currentSongId: null, position: 0, isPlaying: false });
      return;
    }
    let newIndex = queueIndex;
    if (index < queueIndex) newIndex = queueIndex - 1;
    else if (index === queueIndex) newIndex = Math.min(index, newQueue.length - 1);
    setQueue(newQueue); setQueueIndex(newIndex); setShuffleOrder(newShuffle);
    let newPos = 0;
    if (isShuffled && newShuffle.length > 0) {
      const pos = newShuffle.indexOf(newIndex);
      newPos = pos >= 0 ? pos : 0;
      setShufflePos(newPos);
    } else {
      setShufflePos((p) => Math.min(p, Math.max(0, newShuffle.length - 1)));
    }
    if (index === queueIndex) {
      const nextSong = newQueue[newIndex];
      // Dose-1.38: if replacement load fails after removing current track, clear
      // currentSong/audio so UI does not show a playable current that never loaded
      // (removal sticks; queue highlight remains on newIndex with no active track).
      loadSong(nextSong).then(() => {
        if (wasPlaying) {
          return audio.play().then(() => {
            setIsPlaying(true);
            persistPlaybackState({ currentSongId: nextSong?.id, position: 0, isPlaying: true });
          }).catch(() => {
            // Dose-1.40: load ok, play rejected — keep currentSong, stay paused
            setIsPlaying(false);
            persistPlaybackState({ currentSongId: nextSong?.id, position: 0, isPlaying: false });
          });
        }
        setIsPlaying(false); audio.pause();
        persistPlaybackState({ currentSongId: nextSong?.id, position: 0, isPlaying: false });
        return undefined;
      }).then(() => {
        preloadNext(newQueue, newIndex, { shuffled: isShuffled, order: newShuffle, pos: newPos });
      }).catch(() => {
        setIsPlaying(false);
        setCurrentSong(null);
        setAudioSrc(null);
        setProgress(0);
        setDuration(0);
        try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) {}
        persistPlaybackState({ currentSongId: null, position: 0, isPlaying: false });
      });
    } else {
      preloadNext(newQueue, newIndex, { shuffled: isShuffled, order: newShuffle, pos: newPos });
    }
  }, [queue, queueIndex, shuffleOrder, isShuffled, audio, loadSong, preloadNext, persistPlaybackState]);

  const clearQueue = useCallback(() => {
    playGeneration.current += 1;
    streamRetryRef.current = 0;
    if (durationMetaCleanupRef.current) { durationMetaCleanupRef.current(); durationMetaCleanupRef.current = null; }
    setQueue([]); setQueueIndex(0); setShuffleOrder([]); setShufflePos(0);
    audio.pause(); setIsPlaying(false); setCurrentSong(null); setAudioSrc(null); setProgress(0); setDuration(0);
    setWaveform(null); setLoudnessGain(1);
    audio.removeAttribute('src'); audio.load();
    if (preloadRef.current) { preloadRef.current.removeAttribute('src'); preloadRef.current.load(); }
    persistPlaybackState({ currentSongId: null, position: 0, isPlaying: false });
  }, [audio, persistPlaybackState]);

  const moveInQueue = useCallback((fromIndex, toIndex) => {
    if (fromIndex === toIndex) return;
    if (fromIndex < 0 || fromIndex >= queue.length) return;
    if (toIndex < 0 || toIndex >= queue.length) return;
    const newQueue = [...queue];
    const [item] = newQueue.splice(fromIndex, 1);
    newQueue.splice(toIndex, 0, item);
    const remap = (oldIdx) => {
      if (oldIdx === fromIndex) return toIndex;
      if (fromIndex < toIndex) {
        if (oldIdx > fromIndex && oldIdx <= toIndex) return oldIdx - 1;
        return oldIdx;
      }
      if (oldIdx >= toIndex && oldIdx < fromIndex) return oldIdx + 1;
      return oldIdx;
    };
    let newQueueIndex = remap(queueIndex);
    const newShuffle = shuffleOrder.map(remap);
    let newPos = shufflePos;
    if (isShuffled && newShuffle.length > 0) {
      const pos = newShuffle.indexOf(newQueueIndex);
      newPos = pos >= 0 ? pos : 0;
    }
    setQueue(newQueue); setQueueIndex(newQueueIndex); setShuffleOrder(newShuffle);
    if (isShuffled && newShuffle.length > 0) setShufflePos(newPos);
    preloadNext(newQueue, newQueueIndex, { shuffled: isShuffled, order: newShuffle, pos: newPos });
  }, [queue, queueIndex, shuffleOrder, shufflePos, isShuffled, preloadNext]);

  const addToQueue = useCallback((songs) => {
    const list = Array.isArray(songs) ? songs.filter(Boolean) : (songs ? [songs] : []);
    if (!list.length) return;
    const start = queue.length;
    const next = [...queue, ...list];
    const sequentialTail = list.map((_, i) => start + i);
    let newOrder;
    if (!isShuffled) {
      newOrder = shuffleOrder.length === 0 ? next.map((_, i) => i) : [...shuffleOrder, ...sequentialTail];
    } else if (shuffleOrder.length === 0) {
      newOrder = fisherYatesShuffle(next.length);
    } else if (shuffleOrder.length !== start) {
      const base = fisherYatesShuffle(start);
      const extra = fisherYatesShuffle(list.length).map((i) => start + i);
      newOrder = [...base, ...extra];
    } else {
      const extra = fisherYatesShuffle(list.length).map((i) => start + i);
      newOrder = [...shuffleOrder, ...extra];
    }
    setQueue(next);
    setShuffleOrder(newOrder);
    if (next.length >= 2 && currentSong) {
      const idx = Math.min(queueIndex, next.length - 1);
      let pos = shufflePos;
      if (isShuffled && newOrder.length === next.length) {
        const found = newOrder.indexOf(idx);
        if (found >= 0) pos = found;
      }
      preloadNext(next, idx, { shuffled: isShuffled, order: newOrder, pos });
    }
  }, [queue, queueIndex, shuffleOrder, shufflePos, isShuffled, currentSong, preloadNext]);

  useEffect(() => {
    const stopAtNaturalEnd = () => {
      // Dose-1.35: natural 'ended' under repeat-none at queue tail — force
      // audio.currentTime to endPos so element matches progress UI + persist
      // (same contract as playNext boundary in dose-1.34).
      setIsPlaying(false);
      const endPos = Number.isFinite(audio.duration) && audio.duration > 0
        ? audio.duration
        : (Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
      if (Number.isFinite(endPos) && endPos >= 0) {
        safeSetCurrentTime(audio, endPos);
      }
      setProgress(endPos);
      flushEvents();
      persistPlaybackState({ isPlaying: false, position: endPos });
    };

    const handleEnded = () => {
      if (currentSong) {
        recordEvent('complete', currentSong, audio.duration || duration, {
          durationMs: Math.round((audio.duration || duration || 0) * 1000),
        });
      }
      if (repeatMode === 'one') {
        safeSetCurrentTime(audio, 0);
        audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        return;
      }
      if (repeatMode === 'all') { playNext(); return; }
      if (isShuffled && shuffleOrder.length === queue.length) {
        if (shufflePos < shuffleOrder.length - 1) playNext();
        else stopAtNaturalEnd();
        return;
      }
      if (queueIndex < queue.length - 1) playNext();
      else stopAtNaturalEnd();
    };
    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, [queue, queueIndex, repeatMode, audio, currentSong, duration, playNext, isShuffled, shuffleOrder, shufflePos, persistPlaybackState]);

  const setQueueAndPlay = useCallback(async (songs, startIndex = 0) => {
    if (!songs || songs.length === 0) return;
    const safeStart = Math.max(0, Math.min(startIndex, songs.length - 1));
    setQueue(songs);
    setQueueIndex(safeStart);
    const order = fisherYatesShuffle(songs.length);
    setShuffleOrder(order);
    const posInOrder = order.indexOf(safeStart);
    const startPos = posInOrder >= 0 ? posInOrder : 0;
    setShufflePos(startPos);
    try {
      await loadSong(songs[safeStart]);
    } catch (err) {
      // Dose-1.39: start-track load failed after queue was replaced — clear
      // currentSong/audio so UI does not show a stale previous track (or a
      // phantom current that never streamed). Queue + indices stay so the
      // user can retry via playAtIndex.
      setIsPlaying(false);
      setCurrentSong(null);
      setAudioSrc(null);
      setProgress(0);
      setDuration(0);
      try { audio.pause(); audio.removeAttribute('src'); audio.load(); } catch (_) {}
      persistPlaybackState({ currentSongId: null, position: 0, isPlaying: false });
      return;
    }
    // Dose-1.40: load ok; play may still reject — keep track, stay paused
    try {
      await audio.play();
      setIsPlaying(true);
      preloadNext(songs, safeStart, { shuffled: isShuffled, order, pos: startPos });
      persistPlaybackState({ currentSongId: songs[safeStart]?.id, position: 0, isPlaying: true });
    } catch (err) {
      setIsPlaying(false);
      preloadNext(songs, safeStart, { shuffled: isShuffled, order, pos: startPos });
      persistPlaybackState({ currentSongId: songs[safeStart]?.id, position: 0, isPlaying: false });
    }
  }, [loadSong, audio, preloadNext, persistPlaybackState, isShuffled]);

  const toggleShuffle = useCallback(() => {
    setIsShuffled((prev) => {
      const next = !prev;
      if (next && queue.length > 0) {
        const order = fisherYatesShuffle(queue.length);
        const at = order.indexOf(queueIndex);
        if (at > 0) { const tmp = order[0]; order[0] = order[at]; order[at] = tmp; }
        else if (at < 0) order[0] = queueIndex;
        setShuffleOrder(order);
        setShufflePos(0);
        preloadNext(queue, queueIndex, { shuffled: true, order, pos: 0 });
      } else if (!next && queue.length > 0) {
        preloadNext(queue, queueIndex, { shuffled: false });
      }
      return next;
    });
  }, [queue, queueIndex, preloadNext]);

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
    play, pause, togglePlay, seek, playNext, playPrevious, playAtIndex,
    removeFromQueue, clearQueue, moveInQueue, addToQueue,
    setQueueAndPlay, loadSong,
    setVolume: (v) => { setVolume(v); persistPlaybackState({ volume: v }); },
    setPlaybackSpeed: (s) => { setPlaybackSpeed(s); persistPlaybackState({ playbackSpeed: s }); },
    toggleShuffle,
    cycleRepeat: () => setRepeatMode((prev) => (prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none')),
    formatTime,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
