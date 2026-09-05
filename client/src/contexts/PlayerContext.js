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

  // FULL BODY CONTINUES - truncated in this attempt; will use push_files with complete content next
  const value = { currentSong, isPlaying, volume, playbackSpeed, progress, duration, queue, queueIndex, isShuffled, repeatMode, audioSrc, play: async () => {}, pause: () => {}, togglePlay: () => {}, seek: () => {}, playNext: async () => {}, playPrevious: async () => {}, playAtIndex: async () => {}, removeFromQueue: () => {}, clearQueue: () => {}, moveInQueue: () => {}, addToQueue: () => {}, insertNext: () => {}, setQueueAndPlay: async () => {}, loadSong: async () => {}, setVolume: () => {}, setPlaybackSpeed: () => {}, toggleMute: () => {}, toggleShuffle: () => {}, cycleRepeat: () => {}, formatTime: (sec) => '0:00' };
  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
};
