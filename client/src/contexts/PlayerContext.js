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
  useEffect(() => {
    // Dose-1.58: never assign non-finite volume to the media element
    const v = Number.isFinite(volume) ? volume : 1;
    const g = Number.isFinite(loudnessGain) ? loudnessGain : 1;
    audio.volume = Math.max(0, Math.min(1, v * g));
  }, [volume, loudnessGain, audio]);
  useEffect(() => {
    // Dose-1.58: never assign non-finite playbackRate
    const rate = Number.isFinite(playbackSpeed) && playbackSpeed > 0 ? playbackSpeed : 1;
    audio.playbackRate = rate;
  }, [playbackSpeed, audio]);

  useEffect(() => {
    if (isPlaying) {
      progressInterval.current = setInterval(() => {
        // Dose-1.57: never push non-finite values into progress/duration state
        // (HTMLMediaElement can report NaN during load/seek/error edges).
        const t = audio.currentTime;
        const d = audio.duration;
        setProgress(Number.isFinite(t) ? t : 0);
        setDuration(Number.isFinite(d) && d > 0 ? d : 0);
        const segment = Math.floor((Number.isFinite(t) ? t : 0) / 10);
        if (segment !== lastSegmentRef.current && currentSong) {
          lastSegmentRef.current = segment;
          recordEvent('segment', currentSong, Number.isFinite(t) ? t : 0, { durationMs: 10000 });
        }
      }, 250);
    } else {
      clearInterval(progressInterval.current);
    }
    return () => clearInterval(progressInterval.current);
  }, [isPlaying, audio, currentSong]);
