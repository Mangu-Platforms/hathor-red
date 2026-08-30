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

/** Near end of track: Play after natural stop should restart, not stay stuck at EOF. */
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
  const playGeneration = useRef(0);
  const streamRetryRef = useRef(0);
  const hydratedRef = useRef(false);
  const persistTimerRef = useRef(null);
  const isPlayingRef = useRef(false);
  const durationMetaCleanupRef = useRef(null);

  const audio = audioRef.current;

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

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
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            setDuration(audio.duration);
          }
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
      // No pipeline data yet
    }
  }, []);

  const preloadNext = useCallback(async (songs, currentQueueIndex, opts = {}) => {
    try {
      if (!songs || songs.length < 2) {
        if (preloadRef.current) {
          preloadRef.current.removeAttribute('src');
          preloadRef.current.load();
        }
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
    } catch (err) {
      // Preload is opportunistic only.
    }
  }, []);

  const loadSong = useCallback(async (song) => {
    const gen = ++playGeneration.current;
    streamRetryRef.current = 0;
    if (durationMetaCleanupRef.current) {
      durationMetaCleanupRef.current();
      durationMetaCleanupRef.current = null;
    }
    try {
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
        if (Number.isFinite(d) && d > 0) {
          setDuration(d);
        }
      };
      if (audio.readyState >= 1 && Number.isFinite(audio.duration) && audio.duration > 0) {
        applyMediaDuration();
      } else {
        const onMeta = () => {
          audio.removeEventListener('loadedmetadata', onMeta);
          if (durationMetaCleanupRef.current === cleanup) {
            durationMetaCleanupRef.current = null;
          }
          applyMediaDuration();
        };
        const cleanup = () => audio.removeEventListener('loadedmetadata', onMeta);
        durationMetaCleanupRef.current = cleanup;
        audio.addEventListener('loadedmetadata', onMeta);
      }

      recordEvent('play', song, 0);
      applyLoudness(song);
      await musicService.recordListening(song.id, 0);
    } catch (err) {
      console.error('Failed to load song:', err);
      throw err;
    }
  }, [audio, applyLoudness]);

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

        if (Number.isFinite(state.volume)) {
          setVolume(Math.max(0, Math.min(1, state.volume));
        }
