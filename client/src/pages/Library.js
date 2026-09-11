import React, { useEffect, useState, useCallback } from 'react';
import { commerceService } from '../services/olympus';
import { usePlayer } from '../contexts/PlayerContext';
import { getFeatures } from '../services/api';
import './Olympus.css';

const Library = () => {
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [features, setFeatures] = useState(null);
  const { setQueueAndPlay, formatTime } = usePlayer();

  useEffect(() => {
    let cancelled = false;
    getFeatures()
      .then((f) => {
        if (!cancelled) setFeatures(f);
      })
      .catch(() => {
        if (!cancelled) setFeatures(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const commerceOff = features != null && features.commerce === false;
  const workerLive = features == null ? null : Boolean(features.workerLive);

  const load = useCallback(async () => {
    // dose-1.18: when FEATURE_COMMERCE is known-off, do not hit the API
    // (routes are not mounted). Same honesty pattern as Search/Radar (dose-1.14/1.17).
    if (features != null && features.commerce === false) {
      setLibrary([]);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const data = await commerceService.getLibrary();
      setLibrary(data.library || []);
    } catch (err) {
      setLibrary([]);
      const status = err.response?.status;
      if (status === 404) {
        setError('Library is not available on this server (commerce feature flag off or route missing).');
      } else {
        setError(err.response?.data?.error || 'Could not load library. Try again later.');
      }
    } finally {
      setLoading(false);
    }
  }, [features]);

  useEffect(() => {
    // Wait until features resolve so we can skip the call when commerce is off.
    if (features == null) return;
    load();
  }, [load, features]);

  const download = async (songId) => {
    setMessage(null);
    try {
      const { url } = await commerceService.requestDownloadToken(songId);
      window.open(url, '_blank');
      setMessage({ ok: true, text: 'Download started — the link is single-use.' });
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.error || 'Download failed' });
    }
  };

  const playAll = () => {
    const songs = library.map((item) => ({
      id: item.song_id,
      title: item.title,
      artist: item.artist,
      album: item.album,
      duration: item.duration,
      cover_url: item.cover_url,
    }));
    if (songs.length > 0) setQueueAndPlay(songs, 0);
  };

  const emptyHint = (() => {
    if (commerceOff) {
      return 'Commerce is disabled on this server (FEATURE_COMMERCE). Library routes are not mounted.';
    }
    const parts = [
      'Nothing here yet — visit the Store to own your first track.',
    ];
    if (features?.worker === false) {
      parts.push('Background worker flag is off — subscription expiry jobs will not run.');
    } else if (workerLive === false) {
      parts.push('Background job worker is not running — some commerce jobs may stall.');
    }
    return parts.join(' ');
  })();

  return (
    <div className="oly-page">
      <h1>Your Library</h1>
      <div className="oly-sub">Tracks you own forever — stream anywhere, download the lossless original.</div>
      {message && <div className={`oly-msg ${message.ok ? 'ok' : 'err'}`}>{message.text}</div>}

      {/* dose-1.18: explicit banner when commerce is off (match Search/Radar) */}
      {commerceOff && (
        <div className="oly-empty" style={{ marginBottom: 16 }} role="status">
          Commerce is disabled on this server (FEATURE_COMMERCE). Library routes are not mounted.
        </div>
      )}
      {workerLive === false && !commerceOff && (
        <div className="oly-empty" style={{ marginBottom: 16 }} role="status">
          Background job worker is not running — subscription expiry and some commerce jobs may
          stall until the worker is up (see Settings → Platform status).
        </div>
      )}

      {features == null || (loading && !commerceOff) ? (
        <div className="oly-empty">Loading library…</div>
      ) : commerceOff ? (
        null
      ) : error ? (
        <div className="oly-empty">{error}</div>
      ) : library.length === 0 ? (
        <div className="oly-empty">{emptyHint}</div>
      ) : (
        <>
          <button className="oly-btn" onClick={playAll}>Play all</button>
          <table className="oly-table">
            <thead>
              <tr><th>Title</th><th>Artist</th><th>Length</th><th>Owned since</th><th></th></tr>
            </thead>
            <tbody>
              {library.map((item) => (
                <tr key={item.song_id}>
                  <td>{item.title}</td>
                  <td>{item.artist}</td>
                  <td>{formatTime(item.duration)}</td>
                  <td>{new Date(item.acquired_at).toLocaleDateString()}</td>
                  <td>
                    <button className="oly-btn-ghost" onClick={() => download(item.song_id)}>
                      Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

export default Library;
