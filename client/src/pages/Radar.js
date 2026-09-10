import React, { useEffect, useState, useCallback } from 'react';
import { discoveryService } from '../services/olympus';
import { musicService } from '../services/music';
import { usePlayer } from '../contexts/PlayerContext';
import { getFeatures } from '../services/api';
import './Olympus.css';

const Radar = () => {
  const [radar, setRadar] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [features, setFeatures] = useState(null);
  const { setQueueAndPlay } = usePlayer();

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

  const workerLive = features == null ? null : Boolean(features.workerLive);
  const discoveryOff = features != null && features.discovery === false;

  const load = useCallback(async (refresh = false) => {
    // dose-1.17: when FEATURE_DISCOVERY is known-off, do not hit the API
    // (routes are not mounted). Same honesty pattern as Search (dose-1.14).
    if (features != null && features.discovery === false) {
      setRadar(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setRadar(await discoveryService.getRadar(refresh));
    } catch (err) {
      setRadar(null);
      const status = err.response?.status;
      if (status === 404) {
        setError('Discovery is not available on this server (feature flag off or route missing).');
      } else {
        setError(err.response?.data?.error || 'Could not load Radar. Try again later.');
      }
    } finally {
      setLoading(false);
    }
  }, [features]);

  useEffect(() => {
    // Wait until features resolve so we can skip the call when discovery is off.
    if (features == null) return;
    load();
  }, [load, features]);

  // musicService.getSong already unwraps { song } → row; do not read .song again.
  const playAll = async () => {
    if (!radar?.tracks?.length) return;
    const songs = await Promise.all(
      radar.tracks.map((t) =>
        musicService.getSong(t.songId).catch(() => null)
      )
    );
    const playable = songs.filter(Boolean);
    if (playable.length > 0) setQueueAndPlay(playable, 0);
  };

  const emptyHint = (() => {
    if (discoveryOff) {
      return 'Discovery is disabled on this server (FEATURE_DISCOVERY). Radar routes are not mounted.';
    }
    const parts = [
      'Not enough listening history yet — play a few tracks and check back.',
    ];
    if (workerLive === false) {
      parts.push('If you already have history, a stalled worker may also leave this list empty.');
    }
    return parts.join(' ');
  })();

  return (
    <div className="oly-page">
      <h1>Mangu Radar</h1>
      <div className="oly-sub">
        Your personal mix — listeners like you, the sound of your recent plays, and what's fresh.
        {radar?.generatedAt && ` Updated ${new Date(radar.generatedAt).toLocaleString()}.`}
      </div>

      {/* dose-1.17: explicit banner when discovery is off (match Search dose-1.14) */}
      {discoveryOff && (
        <div className="oly-empty" style={{ marginBottom: 16 }} role="status">
          Discovery is disabled on this server (FEATURE_DISCOVERY). Radar routes are not mounted.
        </div>
      )}
      {workerLive === false && !discoveryOff && (
        <div className="oly-empty" style={{ marginBottom: 16 }} role="status">
          Background job worker is not running — Radar refresh may serve a cached or empty
          mix until the worker is up (see Settings → Platform status).
        </div>
      )}

      <div className="oly-row" style={{ marginBottom: 20 }}>
        <button className="oly-btn" onClick={playAll} disabled={!radar?.tracks?.length || discoveryOff}>
          Play the mix
        </button>
        <button className="oly-btn-ghost" onClick={() => load(true)} disabled={discoveryOff || features == null}>
          Refresh
        </button>
      </div>

      {features == null || (loading && !discoveryOff) ? (
        <div className="oly-empty">Tuning your radar…</div>
      ) : discoveryOff ? (
        null
      ) : error ? (
        <div className="oly-empty">{error}</div>
      ) : !radar?.tracks?.length ? (
        <div className="oly-empty">{emptyHint}</div>
      ) : (
        <div className="oly-grid">
          {radar.tracks.map((track) => (
            <div className="oly-card" key={track.songId}>
              <h3>{track.title}</h3>
              <div className="muted">{track.artist}{track.genre ? ` · ${track.genre}` : ''}</div>
              <div>
                {(track.reasons || []).map((reason) => (
                  <span className="oly-reason" key={reason}>{reason}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Radar;
