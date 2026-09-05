import React, { useState, useRef, useCallback, useEffect } from 'react';
import { usePlayer } from '../contexts/PlayerContext';

const MusicPlayer = () => {
  const {
    currentSong, isPlaying, togglePlay, progress, duration, volume,
    setVolume, toggleMute, playbackSpeed, setPlaybackSpeed, playNext, playPrevious,
    isShuffled, toggleShuffle, repeatMode, cycleRepeat, seek, formatTime,
    queue, queueIndex, playAtIndex, removeFromQueue, moveInQueue, clearQueue,
  } = usePlayer();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const dragFromRef = useRef(null);
  // dose-1.101: touch reorder state (HTML5 drag is mouse-only)
  const touchFromRef = useRef(null);
  const touchOverRef = useRef(null);
  const progressBarRef = useRef(null);
  const seekingRef = useRef(false);

  /** Map clientX to seek time; no-op when duration is not finite / not positive. */
  const seekFromClientX = useCallback(
    (clientX) => {
      if (!Number.isFinite(duration) || duration <= 0) return;
      const el = progressBarRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (!rect.width) return;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      if (!Number.isFinite(pct)) return;
      seek(pct * duration);
    },
    [duration, seek]
  );

  const onProgressPointerDown = useCallback(
    (e) => {
      if (!Number.isFinite(duration) || duration <= 0) return;
      // Only primary button / primary touch
      if (e.button != null && e.button !== 0) return;
      e.preventDefault();
      seekingRef.current = true;
      setIsSeeking(true);
      try {
        e.currentTarget.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      seekFromClientX(e.clientX);
    },
    [duration, seekFromClientX]
  );

  const onProgressPointerMove = useCallback(
    (e) => {
      if (!seekingRef.current) return;
      seekFromClientX(e.clientX);
    },
    [seekFromClientX]
  );

  const endSeek = useCallback((e) => {
    if (!seekingRef.current) return;
    seekingRef.current = false;
    setIsSeeking(false);
    try {
      e?.currentTarget?.releasePointerCapture?.(e.pointerId);
    } catch (_) {}
  }, []);

  // Safety: release seek if pointer is lost outside the bar
  useEffect(() => {
    if (!isSeeking) return undefined;
    const onUp = () => {
      seekingRef.current = false;
      setIsSeeking(false);
    };
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [isSeeking]);

  if (!currentSong) return null;

  const progressPercent = duration && Number.isFinite(duration) ? (progress / duration) * 100 : 0;

  const onQueueDragStart = (e, idx) => {
    dragFromRef.current = idx;
    setDragFrom(idx);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(idx));
    if (e.currentTarget) {
      e.currentTarget.classList.add('dragging');
    }
  };

  const onQueueDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOver !== idx) setDragOver(idx);
  };

  const onQueueDrop = (e, toIndex) => {
    e.preventDefault();
    const from = dragFromRef.current;
    if (from == null || from === toIndex) {
      setDragFrom(null);
      setDragOver(null);
      dragFromRef.current = null;
      return;
    }
    moveInQueue(from, toIndex);
    setDragFrom(null);
    setDragOver(null);
    dragFromRef.current = null;
  };

  const onQueueDragEnd = (e) => {
    if (e.currentTarget) e.currentTarget.classList.remove('dragging');
    setDragFrom(null);
    setDragOver(null);
    dragFromRef.current = null;
  };

  /** Touch reorder: start on grip/row; track over via elementFromPoint; drop on end. */
  const onQueueTouchStart = (e, idx) => {
    if (!e.touches || e.touches.length !== 1) return;
    touchFromRef.current = idx;
    touchOverRef.current = idx;
    setDragFrom(idx);
    setDragOver(idx);
  };

  const onQueueTouchMove = (e) => {
    if (touchFromRef.current == null || !e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    const el = document.elementFromPoint(t.clientX, t.clientY);
    if (!el) return;
    const row = el.closest('.player-queue-row');
    if (!row) return;
    const list = row.parentElement;
    if (!list) return;
    const rows = Array.from(list.querySelectorAll('.player-queue-row'));
    const overIdx = rows.indexOf(row);
    if (overIdx < 0) return;
    if (touchOverRef.current !== overIdx) {
      touchOverRef.current = overIdx;
      setDragOver(overIdx);
    }
    // Prevent page scroll while dragging queue on touch
    if (e.cancelable) e.preventDefault();
  };

  const onQueueTouchEnd = () => {
    const from = touchFromRef.current;
    const to = touchOverRef.current;
    touchFromRef.current = null;
    touchOverRef.current = null;
    setDragFrom(null);
    setDragOver(null);
    if (from == null || to == null || from === to) return;
    moveInQueue(from, to);
  };

  /** Format queue row duration from song.duration (seconds); empty if unknown. */
  const queueDurationLabel = (song) => {
    const d = Number(song?.duration);
    if (!Number.isFinite(d) || d <= 0) return '';
    return formatTime(d);
  };

  /** Sum of known track durations in the full queue (display order). */
  const queueTotalSeconds = queue.reduce((sum, song) => {
    const d = Number(song?.duration);
    if (!Number.isFinite(d) || d <= 0) return sum;
    return sum + d;
  }, 0);
  const queueTotalLabel =
    queue.length > 0 && queueTotalSeconds > 0 ? formatTime(queueTotalSeconds) : '';

  /** Remaining from current position: time left on current track + known durations of tracks after queueIndex. */
  const remainingSeconds = (() => {
    if (!queue.length) return 0;
    let sum = 0;
    const idx = Number.isInteger(queueIndex) ? queueIndex : 0;
    for (let i = idx; i < queue.length; i += 1) {
      if (i === idx) {
        const left = Number.isFinite(duration) && duration > 0
          ? Math.max(0, duration - (Number.isFinite(progress) ? progress : 0))
          : (() => {
              const d = Number(queue[i]?.duration);
              return Number.isFinite(d) && d > 0 ? d : 0;
            })();
        sum += left;
      } else {
        const d = Number(queue[i]?.duration);
        if (Number.isFinite(d) && d > 0) sum += d;
      }
    }
    return sum;
  })();
  const remainingLabel =
    queue.length > 0 && remainingSeconds > 0 ? formatTime(remainingSeconds) : '';

  const canSeek = Number.isFinite(duration) && duration > 0;

  return (
    <div className="music-player">
      <div
        ref={progressBarRef}
        className={`player-progress-bar${isSeeking ? ' is-seeking' : ''}${canSeek ? '' : ' is-disabled'}`}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={canSeek ? Math.floor(duration) : 0}
        aria-valuenow={canSeek && Number.isFinite(progress) ? Math.floor(progress) : 0}
        tabIndex={canSeek ? 0 : -1}
        onPointerDown={onProgressPointerDown}
        onPointerMove={onProgressPointerMove}
        onPointerUp={endSeek}
        onPointerCancel={endSeek}
        onKeyDown={(e) => {
          if (!canSeek) return;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            e.preventDefault();
            seek(Math.min(duration, (Number.isFinite(progress) ? progress : 0) + 5));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            e.preventDefault();
            seek(Math.max(0, (Number.isFinite(progress) ? progress : 0) - 5));
          } else if (e.key === 'Home') {
            e.preventDefault();
            seek(0);
          } else if (e.key === 'End') {
            e.preventDefault();
            seek(duration);
          }
        }}
      >
        <div className="player-progress-fill" style={{ width: `${progressPercent}%` }} />
      </div>

      <div className="player-main">
        <div className="player-song-info">
          <div className="player-cover">
            {currentSong.cover_url ? (
              <img src={currentSong.cover_url} alt={currentSong.title} />
            ) : (
              <div className="player-cover-placeholder">{currentSong.title?.[0]}</div>
            )}
          </div>
          <div className="player-text">
            <div className="player-title">{currentSong.title}</div>
            <div className="player-artist">{currentSong.artist}</div>
          </div>
        </div>

        <div className="player-controls">
          <button className={`player-btn ${isShuffled ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </button>
          <button className="player-btn" onClick={playPrevious}>
            <svg fill="currentColor" viewBox="0 0 24 24"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" /></svg>
          </button>
          <button className="player-btn play-btn" onClick={togglePlay}>
            {isPlaying ? (
              <svg fill="currentColor" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
            ) : (
              <svg fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
            )}
          </button>
          <button className="player-btn" onClick={playNext}>
            <svg fill="currentColor" viewBox="0 0 24 24"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" /></svg>
          </button>
          <button className={`player-btn ${repeatMode !== 'none' ? 'active' : ''}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            {repeatMode === 'one' && <span className="repeat-badge">1</span>}
          </button>
        </div>

        <div className="player-extras">
          <span className="player-time">{formatTime(progress)} / {formatTime(duration)}</span>
          <div className="player-volume">
            <button
              type="button"
              className={`player-btn player-mute-btn${volume === 0 ? ' active' : ''}`}
              onClick={toggleMute}
              title={volume === 0 ? 'Unmute (M)' : 'Mute (M)'}
              aria-label={volume === 0 ? 'Unmute' : 'Mute'}
            >
              {volume === 0 ? (
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                </svg>
              ) : (
                <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              )}
            </button>
            <input type="range" min="0" max="1" step="0.01" value={volume} onChange={e => setVolume(parseFloat(e.target.value))} />
          </div>
          <button
            className={`player-btn ${showQueue ? 'active' : ''}`}
            onClick={() => { setShowQueue((v) => !v); setShowAdvanced(false); }}
            title="Queue"
          >
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
            </svg>
            {queue.length > 0 && <span className="queue-count-badge">{queue.length}</span>}
          </button>
          <button className="player-btn" onClick={() => { setShowAdvanced(!showAdvanced); setShowQueue(false); }} title="Playback speed">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          </button>
        </div>
      </div>

      {showAdvanced && (
        <div className="player-advanced">
          <div className="player-control-group">
            <label>Speed: {playbackSpeed.toFixed(2)}x</label>
            <input type="range" min="0.5" max="2" step="0.05" value={playbackSpeed} onChange={e => setPlaybackSpeed(parseFloat(e.target.value))} />
          </div>
        </div>
      )}

      {showQueue && (
        <div className="player-queue-panel" role="listbox" aria-label="Play queue">
          <div className="player-queue-header">
            <span className="player-queue-header-title">
              {isShuffled ? 'Shuffled · ' : ''}Up next ({queue.length})
              {queueTotalLabel && (
                <span className="player-queue-total" title="Sum of known track durations">
                  {' '}· {queueTotalLabel}
                </span>
              )}
              {remainingLabel && (
                <span className="player-queue-remaining" title="Time left from current position through end of queue">
                  {' '}· {remainingLabel} left
                </span>
              )}
              {isShuffled && queue.length > 1 && (
                <span className="player-queue-shuffle-hint" title="List is display order; next/prev follow Fisher–Yates permutation">
                  {' '}· play order differs
                </span>
              )}
            </span>
            <div className="player-queue-header-actions">
              {queue.length > 0 && (
                <button
                  type="button"
                  className="player-btn player-queue-clear"
                  onClick={() => {
                    clearQueue();
                    setShowQueue(false);
                  }}
                  title="Clear queue"
                >
                  Clear
                </button>
              )}
              <button type="button" className="player-btn" onClick={() => setShowQueue(false)} title="Close queue">
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          {queue.length === 0 ? (
            <div className="player-queue-empty">
              <p>Queue is empty</p>
              <p className="player-queue-empty-hint">
                Play a list from Home or a playlist, or use Add to queue on a song row.
              </p>
            </div>
          ) : (
            <ul className="player-queue-list">
              {queue.map((song, idx) => (
                <li
                  key={`${song.id}-${idx}`}
                  className={
                    `player-queue-row` +
                    (dragFrom === idx ? ' is-dragging' : '') +
                    (dragOver === idx && dragFrom !== idx ? ' drag-over' : '')
                  }
                  draggable
                  onDragStart={(e) => onQueueDragStart(e, idx)}
                  onDragOver={(e) => onQueueDragOver(e, idx)}
                  onDrop={(e) => onQueueDrop(e, idx)}
                  onDragEnd={onQueueDragEnd}
                  onTouchStart={(e) => onQueueTouchStart(e, idx)}
                  onTouchMove={onQueueTouchMove}
                  onTouchEnd={onQueueTouchEnd}
                  onTouchCancel={onQueueTouchEnd}
                >
                  <span className="player-queue-grip" title="Drag to reorder" aria-hidden="true">
                    <svg width="12" height="12" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 6h2v2H8V6zm0 5h2v2H8v-2zm0 5h2v2H8v-2zm5-10h2v2h-2V6zm0 5h2v2h-2v-2zm0 5h2v2h-2v-2z" />
                    </svg>
                  </span>
                  <div className="player-queue-reorder">
                    <button
                      type="button"
                      className="player-queue-move"
                      title="Move up"
                      aria-label={`Move ${song.title} up`}
                      disabled={idx === 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveInQueue(idx, idx - 1);
                      }}
                    >
                      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      className="player-queue-move"
                      title="Move down"
                      aria-label={`Move ${song.title} down`}
                      disabled={idx === queue.length - 1}
                      onClick={(e) => {
                        e.stopPropagation();
                        moveInQueue(idx, idx + 1);
                      }}
                    >
                      <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                  </div>
                  <button
                    type="button"
                    className={`player-queue-item ${idx === queueIndex ? 'active' : ''}`}
                    onClick={() => playAtIndex(idx)}
                  >
                    <span className="player-queue-num">{idx + 1}</span>
                    <span className="player-queue-meta">
                      <span className="player-queue-title">{song.title}</span>
                      <span className="player-queue-artist">{song.artist}</span>
                    </span>
                    {queueDurationLabel(song) && (
                      <span className="player-queue-duration" aria-hidden="true">
                        {queueDurationLabel(song)}
                      </span>
                    )}
                    {idx === queueIndex && (
                      <span
                        className="player-queue-now"
                        aria-label={isPlaying ? 'Now playing' : 'Current track (paused)'}
                        title={isPlaying ? 'Now playing' : 'Current track (paused)'}
                      >
                        {isPlaying ? '▶' : '❚❚'}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="player-queue-remove"
                    title="Remove from queue"
                    aria-label={`Remove ${song.title} from queue`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFromQueue(idx);
                    }}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default MusicPlayer;
