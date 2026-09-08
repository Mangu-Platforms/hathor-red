import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { usePlayer } from '../contexts/PlayerContext';

const VOLUME_STEP = 0.05;

const MusicPlayer = () => {
  const {
    currentSong, isPlaying, togglePlay, progress, duration, volume,
    setVolume, toggleMute, playbackSpeed, setPlaybackSpeed, playNext, playPrevious,
    isShuffled, toggleShuffle, repeatMode, cycleRepeat, seek, formatTime,
    queue, queueIndex, shuffleOrder, shufflePos, playAtIndex, removeFromQueue, moveInQueue, clearQueue, makeNext,
  } = usePlayer();

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showQueue, setShowQueue] = useState(false);
  const [dragFrom, setDragFrom] = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [isSeeking, setIsSeeking] = useState(false);
  const dragFromRef = useRef(null);
  const touchFromRef = useRef(null);
  const touchOverRef = useRef(null);
  const progressBarRef = useRef(null);
  const seekingRef = useRef(false);

  const seekFromClientX = useCallback((clientX) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    const el = progressBarRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (!rect.width) return;
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    seek(pct * duration);
  }, [duration, seek]);

  useEffect(() => {
    if (!isSeeking) return undefined;
    const onMove = (e) => {
      const clientX = e.touches ? e.touches[0]?.clientX : e.clientX;
      if (clientX != null) seekFromClientX(clientX);
    };
    const onUp = () => {
      seekingRef.current = false;
      setIsSeeking(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [isSeeking, seekFromClientX]);

  const onVolumeKeyDown = (e) => {
    const cur = Number.isFinite(volume) ? volume : 1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setVolume(Math.min(1, cur + VOLUME_STEP)); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setVolume(Math.max(0, cur - VOLUME_STEP)); }
  };

  const onSpeedKeyDown = (e) => {
    if (e.key === 'Home') { e.preventDefault(); setPlaybackSpeed(0.5); }
    else if (e.key === 'End') { e.preventDefault(); setPlaybackSpeed(2); }
  };

  const displayRows = useMemo(() => {
    if (!queue.length) return [];
    if (
      isShuffled
      && Array.isArray(shuffleOrder)
      && shuffleOrder.length === queue.length
    ) {
      const pos = Number.isInteger(shufflePos)
        ? Math.max(0, Math.min(shufflePos, shuffleOrder.length - 1))
        : 0;
      const rows = [];
      for (let p = pos; p < shuffleOrder.length; p += 1) {
        const idx = shuffleOrder[p];
        if (idx == null || idx < 0 || idx >= queue.length || !queue[idx]) continue;
        rows.push({ song: queue[idx], idx, shuffleStep: p - pos });
      }
      return rows;
    }
    return queue.map((song, idx) => (song ? { song, idx, shuffleStep: null } : null)).filter(Boolean);
  }, [queue, isShuffled, shuffleOrder, shufflePos]);

  const onQueueDragStart = (e, idx) => {
    dragFromRef.current = idx;
    setDragFrom(idx);
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(idx)); } catch (_) {}
  };
  const onQueueDragOver = (e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOver(idx);
  };
  const onQueueDrop = (e, toIndex) => {
    e.preventDefault();
    const from = dragFromRef.current;
    if (!Number.isInteger(from) || from === toIndex) return;
    moveInQueue(from, toIndex);
    setDragFrom(null); setDragOver(null); dragFromRef.current = null;
  };
  const onQueueDragEnd = () => {
    setDragFrom(null); setDragOver(null); dragFromRef.current = null;
  };

  const onQueueTouchStart = (e, idx) => {
    touchFromRef.current = idx;
    touchOverRef.current = idx;
    setDragFrom(idx);
  };
  const onQueueTouchMove = (e) => {
    if (touchFromRef.current == null) return;
    const t = e.touches[0];
    if (!t) return;
    const el = document.elementFromPoint(t.clientX, t.clientY);
    const row = el?.closest?.('.player-queue-row');
    if (!row) return;
    const list = row.parentElement;
    if (!list) return;
    const rows = Array.from(list.querySelectorAll('.player-queue-row'));
    const rowIdx = rows.indexOf(row);
    if (rowIdx < 0) return;
    const dataIdx = row.getAttribute('data-queue-index');
    const parsed = dataIdx != null ? parseInt(dataIdx, 10) : NaN;
    if (Number.isInteger(parsed)) {
      touchOverRef.current = parsed;
      setDragOver(parsed);
    }
  };
  const onQueueTouchEnd = () => {
    const from = touchFromRef.current;
    const to = touchOverRef.current;
    touchFromRef.current = null;
    touchOverRef.current = null;
    setDragFrom(null); setDragOver(null);
    if (Number.isInteger(from) && Number.isInteger(to) && from !== to) {
      moveInQueue(from, to);
    }
  };

  const queueDurationLabel = (song) => {
    const d = Number(song?.duration);
    if (!Number.isFinite(d) || d <= 0) return '';
    return formatTime(d);
  };
  const queueTotalSeconds = queue.reduce((sum, song) => {
    const d = Number(song?.duration);
    if (!Number.isFinite(d) || d <= 0) return sum;
    return sum + d;
  }, 0);
  const queueTotalLabel = queue.length > 0 && queueTotalSeconds > 0 ? formatTime(queueTotalSeconds) : '';
  const remainingSeconds = (() => {
    if (!queue.length) return 0;
    const songLeft = (i, isCurrent) => {
      if (isCurrent) {
        if (Number.isFinite(duration) && duration > 0) {
          return Math.max(0, duration - (Number.isFinite(progress) ? progress : 0));
        }
      }
      const d = Number(queue[i]?.duration);
      return Number.isFinite(d) && d > 0 ? d : 0;
    };
    if (isShuffled && Array.isArray(shuffleOrder) && shuffleOrder.length === queue.length) {
      let sum = 0;
      const pos = Number.isInteger(shufflePos) ? Math.max(0, Math.min(shufflePos, shuffleOrder.length - 1)) : 0;
      for (let p = pos; p < shuffleOrder.length; p += 1) {
        const i = shuffleOrder[p];
        if (i == null || i < 0 || i >= queue.length) continue;
        sum += songLeft(i, p === pos);
      }
      return sum;
    }
    let sum = 0;
    const idx = Number.isInteger(queueIndex) ? queueIndex : 0;
    for (let i = idx; i < queue.length; i += 1) {
      sum += songLeft(i, i === idx);
    }
    return sum;
  })();
  const remainingLabel = queue.length > 0 && remainingSeconds > 0 ? formatTime(remainingSeconds) : '';
  const canSeek = Number.isFinite(duration) && duration > 0;

  const onVolumeChange = (e) => {
    const v = parseFloat(e.target.value);
    if (!Number.isFinite(v)) return;
    const clamped = Math.max(0, Math.min(1, v));
    setVolume(clamped);
  };

  return (
    <div className="music-player">
      <div className="player-main">
        <div className="player-track">
          {currentSong ? (
            <>
              <div className="player-art" aria-hidden="true">{(currentSong.title || '?')[0]}</div>
              <div className="player-meta">
                <div className="player-title">{currentSong.title || 'Unknown'}</div>
                <div className="player-artist">{currentSong.artist || currentSong.uploader_name || ''}</div>
              </div>
            </>
          ) : (
            <div className="player-meta player-meta-empty">Nothing playing</div>
          )}
        </div>

        <div className="player-transport">
          <div className="player-controls">
            <button type="button" className={`player-btn ${isShuffled ? 'active' : ''}`} onClick={toggleShuffle} title="Shuffle" aria-label={isShuffled ? 'Disable shuffle' : 'Enable shuffle'} aria-pressed={isShuffled}>
              🔀
            </button>
            <button type="button" className="player-btn" onClick={playPrevious} title="Previous" aria-label="Previous track" disabled={!queue.length}>
              ⏮
            </button>
            <button type="button" className="player-btn player-btn-play" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'} aria-label={isPlaying ? 'Pause' : 'Play'} disabled={!currentSong}>
              {isPlaying ? '⏸' : '▶'}
            </button>
            <button type="button" className="player-btn" onClick={playNext} title="Next" aria-label="Next track" disabled={!queue.length}>
              ⏭
            </button>
            <button type="button" className={`player-btn ${repeatMode !== 'none' ? 'active' : ''}`} onClick={cycleRepeat} title={`Repeat: ${repeatMode}`} aria-label={`Repeat mode: ${repeatMode}`} aria-pressed={repeatMode !== 'none'}>
              {repeatMode === 'one' ? '🔂' : '🔁'}
            </button>
          </div>
          <div className="player-progress-row">
            <span className="player-time">{formatTime(progress)}</span>
            <div
              ref={progressBarRef}
              className={`player-progress-bar ${canSeek ? 'seekable' : ''}`}
              role="slider"
              aria-label="Seek"
              aria-valuemin={0}
              aria-valuemax={canSeek ? Math.floor(duration) : 0}
              aria-valuenow={canSeek ? Math.floor(progress) : 0}
              onMouseDown={(e) => { if (!canSeek) return; seekingRef.current = true; setIsSeeking(true); seekFromClientX(e.clientX); }}
              onTouchStart={(e) => { if (!canSeek) return; seekingRef.current = true; setIsSeeking(true); const t = e.touches[0]; if (t) seekFromClientX(t.clientX); }}
            >
              <div className="player-progress-fill" style={{ width: canSeek ? `${Math.min(100, (progress / duration) * 100)}%` : '0%' }} />
            </div>
            <span className="player-time">{formatTime(duration)}</span>
          </div>
        </div>

        <div className="player-side">
          <div className="player-volume">
            <button type="button" className="player-btn" onClick={toggleMute} title={volume > 0 ? 'Mute' : 'Unmute'} aria-label={volume > 0 ? 'Mute' : 'Unmute'}>
              {volume === 0 ? '🔇' : volume < 0.5 ? '🔉' : '🔊'}
            </button>
            <input
              type="range"
              className="player-volume-slider"
              min={0}
              max={1}
              step={0.01}
              value={Number.isFinite(volume) ? volume : 1}
              onChange={onVolumeChange}
              onKeyDown={onVolumeKeyDown}
              aria-label="Volume"
            />
          </div>
          <button type="button" className={`player-btn ${showQueue ? 'active' : ''}`} onClick={() => { setShowQueue(!showQueue); setShowAdvanced(false); }} title="Queue" aria-label="Queue" aria-expanded={showQueue} aria-controls="player-queue-panel">
            ☰
            {queue.length > 0 && <span className="queue-count-badge" aria-hidden="true">{queue.length}</span>}
          </button>
          <button type="button" className="player-btn" onClick={() => { setShowAdvanced(!showAdvanced); setShowQueue(false); }} title="Playback speed" aria-label="Playback speed" aria-expanded={showAdvanced}>
            {Number.isFinite(playbackSpeed) ? `${playbackSpeed.toFixed(2)}×` : '1×'}
          </button>
        </div>
      </div>

      {showAdvanced && (
        <div className="player-advanced">
          <label className="player-speed-label">
            Speed
            <input
              type="range"
              className="player-speed-slider"
              min={0.5}
              max={2}
              step={0.05}
              value={Number.isFinite(playbackSpeed) ? playbackSpeed : 1}
              onChange={(e) => setPlaybackSpeed(parseFloat(e.target.value))}
              onKeyDown={onSpeedKeyDown}
              aria-label="Playback speed"
              aria-valuetext={`${(Number.isFinite(playbackSpeed) ? playbackSpeed : 1).toFixed(2)} times`}
            />
          </label>
        </div>
      )}

      {showQueue && (
        <div id="player-queue-panel" className="player-queue-panel" role="listbox" aria-label="Up next">
          <div className="player-queue-header">
            <span>Up next {queue.length > 0 ? `(${queue.length})` : ''}</span>
            <span className="player-queue-totals">
              {remainingLabel ? `${remainingLabel} left` : ''}
              {queueTotalLabel ? ` · ${queueTotalLabel} total` : ''}
            </span>
            {queue.length > 0 && (
              <button type="button" className="player-queue-clear" onClick={clearQueue} aria-label="Clear queue">Clear</button>
            )}
          </div>
          {queue.length === 0 ? (
            <div className="player-queue-empty">Queue is empty</div>
          ) : (
            <ul className="player-queue-list">
              {displayRows.map(({ song, idx, shuffleStep }) => {
                const isCurrent = idx === queueIndex;
                const rowLabel = `${song.title || 'Unknown'}${song.artist ? ` — ${song.artist}` : ''}`;
                const positionLabel = shuffleStep === 0 || (shuffleStep == null && isCurrent)
                  ? (isPlaying ? '▶' : '•')
                  : (shuffleStep != null ? shuffleStep + 1 : idx + 1);
                return (
                  <li
                    key={`${song.id}-${idx}`}
                    data-queue-index={idx}
                    className={`player-queue-row ${isCurrent ? 'current' : ''} ${dragFrom === idx ? 'dragging' : ''} ${dragOver === idx ? 'drag-over' : ''}`}
                    role="option"
                    aria-selected={isCurrent}
                    aria-label={rowLabel}
                    draggable
                    onDragStart={(e) => onQueueDragStart(e, idx)}
                    onDragOver={(e) => onQueueDragOver(e, idx)}
                    onDrop={(e) => onQueueDrop(e, idx)}
                    onDragEnd={onQueueDragEnd}
                    onTouchStart={(e) => onQueueTouchStart(e, idx)}
                    onTouchMove={onQueueTouchMove}
                    onTouchEnd={onQueueTouchEnd}
                  >
                    <span className="player-queue-handle" aria-hidden="true">⋮⋮</span>
                    <button
                      type="button"
                      className="player-queue-play-at"
                      onClick={() => playAtIndex(idx)}
                      aria-label={`Play ${song.title || 'track'}`}
                    >
                      {positionLabel}
                    </button>
                    <div className="player-queue-row-meta" onClick={() => playAtIndex(idx)} role="presentation">
                      <div className="player-queue-row-title">{song.title || 'Unknown'}</div>
                      <div className="player-queue-row-artist">{song.artist || song.uploader_name || ''}</div>
                    </div>
                    <span className="player-queue-row-dur">{queueDurationLabel(song)}</span>
                    <div className="player-queue-row-actions">
                      <button type="button" className="player-queue-move" disabled={isShuffled || idx === 0} aria-label="Move up" onClick={(e) => { e.stopPropagation(); if (!isShuffled) moveInQueue(idx, idx - 1); }}>↑</button>
                      <button type="button" className="player-queue-move" disabled={isShuffled || idx === queue.length - 1} aria-label="Move down" onClick={(e) => { e.stopPropagation(); if (!isShuffled) moveInQueue(idx, idx + 1); }}>↓</button>
                      <button type="button" className="player-queue-remove player-queue-play-next" title="Play next" aria-label={`Play ${song.title} next`} disabled={isCurrent} onClick={(e) => { e.stopPropagation(); makeNext(idx); }}>⤵</button>
                      <button type="button" className="player-queue-remove" aria-label={`Remove ${song.title} from queue`} onClick={(e) => { e.stopPropagation(); removeFromQueue(idx); }}>×</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default MusicPlayer;
