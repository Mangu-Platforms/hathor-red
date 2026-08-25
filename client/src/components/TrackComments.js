import React, { useEffect, useState, useRef, useCallback } from 'react';
import { usePlayer } from '../contexts/PlayerContext';
import { socialService } from '../services/olympus';
import '../pages/Olympus.css';

// Bodies arrive HTML-escaped from the server; decode entities and render as
// plain text (never innerHTML) so nothing can ever execute.
const decodeEntities = (text) => {
  const el = document.createElement('textarea');
  el.innerHTML = String(text || '');
  return el.value;
};

/**
 * SoundCloud-style time-synced comments (Olympus M4). Floats above the player
 * bar; shows the comments landing in the current playback window and lets the
 * listener drop one at the current position.
 */
const TrackComments = () => {
  const { currentSong, progress, formatTime } = usePlayer();
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const loadedForSong = useRef(null);

  const load = useCallback(async (songId) => {
    try {
      const data = await socialService.getComments(songId, { limit: 200 });
      setComments(data.comments || []);
    } catch (err) {
      setComments([]);
    }
  }, []);

  useEffect(() => {
    if (currentSong && loadedForSong.current !== currentSong.id) {
      loadedForSong.current = currentSong.id;
      load(currentSong.id);
    }
  }, [currentSong, load]);

  if (!currentSong) return null;

  const nowMs = progress * 1000;
  // Comments "pop" during a 15s trailing window around the playhead.
  const active = comments.filter((c) => c.timestamp_ms <= nowMs && c.timestamp_ms > nowMs - 15000);
  const upcoming = comments.length;

  const post = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    setPosting(true);
    try {
      const { comment } = await socialService.addComment(currentSong.id, draft.trim(), Math.round(nowMs));
      setComments((prev) => [...prev, comment].sort((a, b) => a.timestamp_ms - b.timestamp_ms));
      setDraft('');
    } catch (err) {
      // validation errors surface silently here; the form keeps the draft
    } finally {
      setPosting(false);
    }
  };

  if (!open) {
    return (
      <div className="oly-comments-toggle">
        <button className="oly-btn-ghost" onClick={() => setOpen(true)}>
          💬 {upcoming > 0 ? `${upcoming} comments` : 'Comments'}
        </button>
      </div>
    );
  }

  return (
    <div className="oly-comments">
      <div className="oly-row" style={{ justifyContent: 'space-between' }}>
        <strong>Comments</strong>
        <button className="oly-btn-ghost" onClick={() => setOpen(false)}>×</button>
      </div>

      <div className="oly-comments-list">
        {comments.length === 0 && <div className="muted">Be the first to mark a moment.</div>}
        {(active.length > 0 ? active : comments.slice(0, 30)).map((c) => (
          <div className="oly-comment" key={c.id}>
            <span className="at">{formatTime(c.timestamp_ms / 1000)}</span>
            <span className="who">{c.display_name || c.username}:</span>
            <span>{decodeEntities(c.body)}</span>
          </div>
        ))}
      </div>

      <form onSubmit={post} className="oly-row">
        <input
          className="oly-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={`Comment at ${formatTime(progress)}`}
          maxLength={500}
        />
        <button className="oly-btn" type="submit" disabled={posting}>Post</button>
      </form>
    </div>
  );
};

export default TrackComments;
