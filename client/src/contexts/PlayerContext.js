import React, { createContext, useState, useContext, useRef, useEffect, useCallback } from 'react';
import { musicService } from '../services/music';
import { mediaService } from '../services/olympus';
import { recordEvent, flushEvents } from '../services/telemetry';
import { useAuth } from './AuthContext';

const PlayerContext = createContext();

// ITU-R BS.1770 loudness normalization target (Spotify/YouTube ballpark).
const TARGET_LUFS = -14;

/** Seconds into a track after which Prev restarts the current song (standard player UX). */
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

/** After removing index `removed`, map old shuffle indices into the new queue. */
function remapShuffleAfterRemove(shuffleOrder, removed) {
  return shuffleOrder
    .filter((i) => i !== removed)
    .map((i) => (i > removed ? i - 1 : i));
}

/** Normalize playback_states row (snake or camel) into a plain object. */
function normalizePlaybackState(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const songId = raw.current_song_id ?? raw.currentSongId ?? null;
  if (songId == null) return null;
  return {
    currentSongId: Number(songId),
    position: Number(raw.position) || 0,
    isPlaying: Boolean(raw.is_playing ?? raw.isPlaying),
    volume: typeof (raw.volume) === 'number' ? raw.volume : 1,
    playbackSpeed: typeof (raw.playback_speed ?? raw.playbackSpeed) === 'number'
      ? (raw.playback_speed ?? raw.playbackSpeed)
      : 1,
  };
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

  const audioRef = useRef(new Audio());
  const preloadRef = useRef(null);
  const progressInterval = useRef(null);
  const lastSegmentRef = useRef(-1);
  // Avoid overlapping play() calls while a load is in flight
  const playGeneration = useRef(0);
  // One automatic stream-url refresh per load generation (expired token / network blip)
  const streamRetryRef = useRef(0);
  // Hydrate GET /playback/state only once per authenticated session
  const hydratedRef = useRef(false);
  const persistTimerRef = useRef(null);

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

  // Recover from media errors (expired signed stream token, transient network).
  // At most one re-fetch of stream-url per loadSong generation; preserve seek position.
  useEffect(() => {
    const handleError = async () => {
      const song = currentSong;
      if (!song) return;
      if (streamRetryRef.current >= 1) {
        console.error('Stream failed after retry; leaving paused');
        setIsPlaying(false);
        return;
      }
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
          if (resumeAt > 0 && Number.isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime = Math.min(resumeAt, audio.duration);
          }
          audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        };
        audio.addEventListener('loadedmetadata', onMeta);
        audio.load();
      } catch (err) {
        console.error('Stream URL refresh failed:', err);
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
    } catch (err) {
      // No pipeline data yet — play at unity gain.
    }
  }, []);

  /**
   * Opportunistically preload the track that will actually play next.
   * When shuffle is on, that is the next index in the Fisher-Yates permutation,
   * not songs[queueIndex + 1].
   */
  const preloadNext = useCallback(async (songs, currentQueueIndex, opts = {}) => {
    try {
      if (!songs || songs.length < 2) return;
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
    } catch (err) {
      // Preload is opportunistic only.
    }
  }, []);

  const loadSong = useCallback(async (song) => {
    const gen = ++playGeneration.current;
    streamRetryRef.current = 0;
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

  /**
   * Dose 1.15: restore last song + position from server (Redis/DB) after login.
   * Does not autoplay (browser policy); user must press play.
   * Dose 1.19: seed a one-item queue so Next/Prev and the queue panel work after hydrate
   * (server only stores current_song_id, not the full queue).
   */
  useEffect(() => {
    if (!isAuthenticated || !user) {
      hydratedRef.current = false;
      return;
    }
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const data = await musicService.getPlaybackState();
        const state = normalizePlaybackState(data?.state);
        if (!state || cancelled) return;

        // Apply volume / speed even if song fetch fails
        if (Number.isFinite(state.volume)) {
          setVolume(Math.max(0, Math.min(1, state.volume)));
        }
        if (Number.isFinite(state.playbackSpeed) && state.playbackSpeed > 0) {
          setPlaybackSpeed(state.playbackSpeed);
        }

        let songPayload;
        try {
          songPayload = await musicService.getSong(state.currentSongId);
        } catch {
          return;
        }
        if (cancelled) return;

        const song = songPayload?.song || songPayload;
        if (!song?.id) return;

        // Do not clobber a track the user already started this session
        if (currentSong) return;

        await loadSong(song);
        if (cancelled) return;

        // Server hydrate has no queue list — seed current track so controls work
        setQueue([song]);
        setQueueIndex(0);
        setShuffleOrder([0]);
        setShufflePos(0);

        const resumeAt = Math.max(0, state.position || 0);
        const onMeta = () => {
          audio.removeEventListener('loadedmetadata', onMeta);
          if (cancelled || playGeneration.current === 0) return;
          if (Number.isFinite(audio.duration) && audio.duration > 0 && resumeAt > 0) {
            const clamped = Math.min(resumeAt, audio.duration);
            audio.currentTime = clamped;
            setProgress(clamped);
          }
          // Always leave paused after hydrate — user gesture required to play
          setIsPlaying(false);
          audio.pause();
        };
        if (audio.readyState >= 1) {
          onMeta();
        } else {
          audio.addEventListener('loadedmetadata', onMeta);
        }
      } catch (err) {
        // Hydrate is best-effort; empty/missing state is normal for new users
        console.warn('Playback state hydrate skipped:', err?.message || err);
      }
    })();

    return () => {
      cancelled = true;
    };
    // Intentionally omit currentSong / loadSong from deps: one-shot per auth session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, user]);

  /** Debounced persist of position / volume / speed for multi-device resume. */
  const persistPlaybackState = useCallback((overrides = {}) => {
    if (!isAuthenticated) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      const song = overrides.currentSongId !== undefined ? null : currentSong;
      const songId = overrides.currentSongId !== undefined
        ? overrides.currentSongId
        : song?.id;
      // Allow explicit null (clear) — only skip when neither override nor current song
      if (songId == null && overrides.currentSongId === undefined) return;
      musicService
        .updatePlaybackState({
          currentSongId: songId ?? null,
          position: overrides.position ?? (Number.isFinite(audio.currentTime) ? audio.currentTime : 0),
          isPlaying: overrides.isPlaying ?? isPlaying,
          volume: overrides.volume ?? volume,
          playbackSpeed: overrides.playbackSpeed ?? playbackSpeed,
        })
        .catch(() => {
          // Best-effort; do not surface to UI
        });
    }, 800);
  }, [isAuthenticated, currentSong, isPlaying, volume, playbackSpeed, audio]);

  /**
   * Immediate flush (no debounce) for pagehide / visibility hidden so the last
   * position is not lost when the tab closes before the 800ms timer fires.
   */
  const flushPlaybackStateNow = useCallback(() => {
    if (!isAuthenticated) return;
    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    const songId = currentSong?.id;
    if (songId == null) return;
    musicService
      .updatePlaybackState({
        currentSongId: songId,
        position: Number.isFinite(audio.currentTime) ? audio.currentTime : 0,
        isPlaying,
        volume,
        playbackSpeed,
      })
      .catch(() => {
        // Best-effort on unload
      });
  }, [isAuthenticated, currentSong, isPlaying, volume, playbackSpeed, audio]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flushPlaybackStateNow();
    };
    const onPageHide = () => flushPlaybackStateNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [flushPlaybackStateNow]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, []);

  const play = useCallback(async () => {
    try {
      if (!audio.src && currentSong) {
        await loadSong(currentSong);
      }
      await audio.play();
      setIsPlaying(true);
      persistPlaybackState({ isPlaying: true });
    } catch (err) {
      // Autoplay policy or aborted load — leave paused
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
    persistPlaybackState({ position: clamped });
  }, [audio, currentSong, persistPlaybackState]);

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
      preloadNext(queue, next.index, {
        shuffled: isShuffled,
        order: shuffleOrder,
        pos: next.shufflePos,
      });
      persistPlaybackState({
        currentSongId: queue[next.index]?.id,
        position: 0,
        isPlaying: true,
      });
    } catch (err) {
      setIsPlaying(false);
    }
  }, [queue, resolveNextIndex, isShuffled, shuffleOrder, loadSong, audio, currentSong, preloadNext, persistPlaybackState]);

  const playPrevious = useCallback(async () => {
    if (queue.length === 0) return;

    // Standard player UX: if more than ~3s into the track, Prev restarts current
    // instead of jumping to the previous queue item.
    const t = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    if (t > PREV_RESTART_THRESHOLD_SEC) {
      if (currentSong) recordEvent('seek', currentSong, 0);
      audio.currentTime = 0;
      setProgress(0);
      persistPlaybackState({ position: 0 });
      if (!isPlaying) {
        try {
          await audio.play();
          setIsPlaying(true);
          persistPlaybackState({ position: 0, isPlaying: true });
        } catch {
          setIsPlaying(false);
        }
      }
      return;
    }

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
      preloadNext(queue, prevIndex, {
        shuffled: isShuffled,
        order: shuffleOrder,
        pos: nextShufflePos,
      });
      persistPlaybackState({
        currentSongId: queue[prevIndex]?.id,
        position: 0,
        isPlaying: true,
      });
    } catch (err) {
      setIsPlaying(false);
    }
  }, [queue, queueIndex, isShuffled, shuffleOrder, shufflePos, loadSong, audio, preloadNext, persistPlaybackState, currentSong, isPlaying]);

  /** Jump to a specific queue index (used by queue panel). */
  const playAtIndex = useCallback(async (index) => {
    if (!queue.length || index < 0 || index >= queue.length) return;
    setQueueIndex(index);
    let pos = shufflePos;
    if (isShuffled && shuffleOrder.length === queue.length) {
      const found = shuffleOrder.indexOf(index);
      if (found >= 0) {
        pos = found;
        setShufflePos(found);
      }
    }
    try {
      await loadSong(queue[index]);
      await audio.play();
      setIsPlaying(true);
      preloadNext(queue, index, {
        shuffled: isShuffled,
        order: shuffleOrder,
        pos,
      });
      persistPlaybackState({
        currentSongId: queue[index]?.id,
        position: 0,
        isPlaying: true,
      });
    } catch (err) {
      setIsPlaying(false);
    }
  }, [queue, isShuffled, shuffleOrder, shufflePos, loadSong, audio, preloadNext, persistPlaybackState]);

  /** Remove a track from the queue by index; keeps playback if current is not removed. */
  const removeFromQueue = useCallback((index) => {
    if (index < 0 || index >= queue.length) return;

    const newQueue = queue.filter((_, i) => i !== index);
    const newShuffle = remapShuffleAfterRemove(shuffleOrder, index);

    if (newQueue.length === 0) {
      setQueue([]);
      setQueueIndex(0);
      setShuffleOrder([]);
      setShufflePos(0);
      audio.pause();
      setIsPlaying(false);
      setCurrentSong(null);
      setAudioSrc(null);
      setProgress(0);
      setDuration(0);
      audio.removeAttribute('src');
      audio.load();
      // Persist cleared song so hydrate does not restore a removed track
      persistPlaybackState({
        currentSongId: null,
        position: 0,
        isPlaying: false,
      });
      return;
    }

    let newIndex = queueIndex;
    if (index < queueIndex) {
      newIndex = queueIndex - 1;
    } else if (index === queueIndex) {
      // Current track removed — advance to the same slot (next song) or wrap
      newIndex = Math.min(index, newQueue.length - 1);
    }

    setQueue(newQueue);
    setQueueIndex(newIndex);
    setShuffleOrder(newShuffle);
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
      loadSong(nextSong)
        .then(() => audio.play())
        .then(() => {
          setIsPlaying(true);
          preloadNext(newQueue, newIndex, {
            shuffled: isShuffled,
            order: newShuffle,
            pos: newPos,
          });
          persistPlaybackState({
            currentSongId: nextSong?.id,
            position: 0,
            isPlaying: true,
          });
        })
        .catch(() => setIsPlaying(false));
    }
  }, [queue, queueIndex, shuffleOrder, isShuffled, audio, loadSong, preloadNext, persistPlaybackState]);

  /**
   * Clear the entire queue and stop playback (Dose 1 queue UI).
   * Bumps playGeneration so in-flight loadSong / stream retries are abandoned.
   * Persists current_song_id = null so the next hydrate does not restore a cleared track.
   */
  const clearQueue = useCallback(() => {
    playGeneration.current += 1;
    streamRetryRef.current = 0;
    setQueue([]);
    setQueueIndex(0);
    setShuffleOrder([]);
    setShufflePos(0);
    audio.pause();
    setIsPlaying(false);
    setCurrentSong(null);
    setAudioSrc(null);
    setProgress(0);
    setDuration(0);
    setWaveform(null);
    setLoudnessGain(1);
    audio.removeAttribute('src');
    audio.load();
    if (preloadRef.current) {
      preloadRef.current.removeAttribute('src');
      preloadRef.current.load();
    }
    persistPlaybackState({
      currentSongId: null,
      position: 0,
      isPlaying: false,
    });
  }, [audio, persistPlaybackState]);

  /** Move queue item fromIndex -> toIndex; keeps current song playing if still present. */
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

    setQueue(newQueue);
    setQueueIndex(newQueueIndex);
    setShuffleOrder(newShuffle);
    if (isShuffled && newShuffle.length > 0) {
      const pos = newShuffle.indexOf(newQueueIndex);
      setShufflePos(pos >= 0 ? pos : 0);
    }
  }, [queue, queueIndex, shuffleOrder, isShuffled]);

  /** Append song(s) to the end of the queue without interrupting current playback. */
  const addToQueue = useCallback((songs) => {
    const list = Array.isArray(songs) ? songs.filter(Boolean) : (songs ? [songs] : []);
    if (!list.length) return;

    setQueue((prev) => {
      const start = prev.length;
      const next = [...prev, ...list];

      setShuffleOrder((ord) => {
        if (!isShuffled || ord.length === 0) {
          // Keep order in sync for when shuffle is toggled later
          return ord.length === 0 ? ord : [...ord, ...list.map((_, i) => start + i)];
        }
        const extra = fisherYatesShuffle(list.length).map((i) => start + i);
        return [...ord, ...extra];
      });

      return next;
    });
  }, [isShuffled]);

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
        return;
      }
      if (repeatMode === 'all') {
        playNext();
        return;
      }
      // repeatMode === 'none': advance only while tracks remain in the current order
      if (isShuffled && shuffleOrder.length === queue.length) {
        if (shufflePos < shuffleOrder.length - 1) {
          playNext();
        } else {
          // Last track in shuffle permutation ended — stop and persist paused so
          // multi-device hydrate does not think playback is still running.
          setIsPlaying(false);
          setProgress(0);
          flushEvents();
          persistPlaybackState({
            isPlaying: false,
            position: Number.isFinite(audio.duration) ? audio.duration : 0,
          });
        }
        return;
      }
      if (queueIndex < queue.length - 1) {
        playNext();
      } else {
        // Last sequential track ended — same persist for server state honesty.
        setIsPlaying(false);
        setProgress(0);
        flushEvents();
        persistPlaybackState({
          isPlaying: false,
          position: Number.isFinite(audio.duration) ? audio.duration : 0,
        });
      }
    };
    audio.addEventListener('ended', handleEnded);
    return () => audio.removeEventListener('ended', handleEnded);
  }, [
    queue,
    queueIndex,
    repeatMode,
    audio,
    currentSong,
    duration,
    playNext,
    isShuffled,
    shuffleOrder,
    shufflePos,
    persistPlaybackState,
  ]);

  const setQueueAndPlay = useCallback(async (songs, startIndex = 0) => {
    if (!songs || songs.length === 0) return;
    const safeStart = Math.max(0, Math.min(startIndex, songs.length - 1));
    setQueue(songs);
    setQueueIndex(safeStart);
    const order = fisherYatesShuffle(songs.length);
    // Put start index first in shuffle path when user enables shuffle later
    setShuffleOrder(order);
    const posInOrder = order.indexOf(safeStart);
    const startPos = posInOrder >= 0 ? posInOrder : 0;
    setShufflePos(startPos);
    try {
      await loadSong(songs[safeStart]);
      await audio.play();
      setIsPlaying(true);
      // Shuffle may still be off; preload sequential until user toggles shuffle
      preloadNext(songs, safeStart, {
        shuffled: false,
        order,
        pos: startPos,
      });
      persistPlaybackState({
        currentSongId: songs[safeStart]?.id,
        position: 0,
        isPlaying: true,
      });
    } catch (err) {
      setIsPlaying(false);
    }
  }, [loadSong, audio, preloadNext, persistPlaybackState]);

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
        // Warm the true next track in the new permutation
        preloadNext(queue, queueIndex, { shuffled: true, order, pos: 0 });
      } else if (!next && queue.length > 0) {
        // Shuffle off: warm sequential next (queueIndex + 1), not the old permutation next
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
    setVolume: (v) => {
      setVolume(v);
      persistPlaybackState({ volume: v });
    },
    setPlaybackSpeed: (s) => {
      setPlaybackSpeed(s);
      persistPlaybackState({ playbackSpeed: s });
    },
    toggleShuffle,
    cycleRepeat: () => setRepeatMode(prev => prev === 'none' ? 'all' : prev === 'all' ? 'one' : 'none'),
    formatTime,
  };

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
