import React, { useEffect, useState } from 'react';
import { intelService, commerceService } from '../services/olympus';
import './Olympus.css';

const centsToUsd = (cents) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);

/** Classify a settled promise: feature-off (404), error, or data. */
function classifySettled(result) {
  if (result.status === 'fulfilled') {
    return { kind: 'ok', value: result.value };
  }
  const status = result.reason?.response?.status;
  if (status === 404) {
    return { kind: 'feature_off' };
  }
  return {
    kind: 'error',
    message: result.reason?.response?.data?.error || result.reason?.message || 'Request failed',
  };
}

const RetentionChart = ({ retention }) => {
  if (!retention?.curve?.length) return <div className="muted">No listening segments yet.</div>;
  return (
    <div className="oly-retention-bar">
      {retention.curve.map((value, i) => (
        <div
          key={i}
          className={`bar ${i === retention.peak?.bucket ? 'peak' : ''}`}
          style={{ height: `${Math.max(2, value * 100)}%` }}
          title={`${i * 10}s — ${(value * 100).toFixed(0)}% retained`}
        />
      ))}
    </div>
  );
};

const ArtistDashboard = () => {
  const [overview, setOverview] = useState(null);
  const [topTracks, setTopTracks] = useState([]);
  const [geo, setGeo] = useState([]);
  const [revenue, setRevenue] = useState(null);
  const [revenueByTrack, setRevenueByTrack] = useState([]);
  const [retention, setRetention] = useState(null);
  const [retentionSong, setRetentionSong] = useState(null);
  const [loading, setLoading] = useState(true);
  // null = unknown, true = 404/flag off, false = routes present
  const [intelOff, setIntelOff] = useState(null);
  const [commerceOff, setCommerceOff] = useState(null);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    Promise.allSettled([
      intelService.getOverview(30),
      intelService.getTopTracks(30, 10),
      intelService.getGeography(30),
      commerceService.getRevenue(),
      intelService.getRevenueByTrack(),
    ]).then(([ov, tt, ge, re, rt]) => {
      const cOv = classifySettled(ov);
      const cTt = classifySettled(tt);
      const cGe = classifySettled(ge);
      const cRe = classifySettled(re);
      const cRt = classifySettled(rt);

      const intelResults = [cOv, cTt, cGe, cRt];
      const intelAll404 = intelResults.every((c) => c.kind === 'feature_off');
      const intelAnyOk = intelResults.some((c) => c.kind === 'ok');
      setIntelOff(intelAll404 ? true : intelAnyOk ? false : null);

      if (cRe.kind === 'feature_off') setCommerceOff(true);
      else if (cRe.kind === 'ok') setCommerceOff(false);
      else setCommerceOff(null);

      if (cOv.kind === 'ok') setOverview(cOv.value);
      if (cTt.kind === 'ok') setTopTracks(cTt.value.tracks || []);
      if (cGe.kind === 'ok') setGeo(cGe.value.countries || []);
      if (cRe.kind === 'ok') setRevenue(cRe.value);
      if (cRt.kind === 'ok') setRevenueByTrack(cRt.value.tracks || []);

      const firstErr = [cOv, cTt, cGe, cRe, cRt].find((c) => c.kind === 'error');
      if (firstErr && !intelAnyOk && cRe.kind !== 'ok') {
        setLoadError(firstErr.message);
      }

      setLoading(false);
    });
  }, []);

  const loadRetention = async (track) => {
    setRetentionSong(track);
    setRetention(null);
    try {
      setRetention(await intelService.getRetention(track.songId));
    } catch (err) {
      const status = err.response?.status;
      if (status === 404) {
        setRetention({ error: 'Retention API not available (intel feature flag off or route missing).' });
      } else {
        setRetention({ error: err.response?.data?.error || 'Failed to load retention' });
      }
    }
  };

  const totalEarned = (revenue?.summary || []).reduce((acc, row) => acc + row.totalCents, 0);

  if (loading) return <div className="oly-page"><div className="oly-empty">Crunching your numbers…</div></div>;

  if (intelOff === true && commerceOff === true) {
    return (
      <div className="oly-page">
        <h1>Artist Intelligence</h1>
        <div className="oly-empty">
          Artist Hub is not available on this server (intel and commerce feature flags off or routes missing).
        </div>
      </div>
    );
  }

  if (loadError && !overview && topTracks.length === 0 && !revenue) {
    return (
      <div className="oly-page">
        <h1>Artist Intelligence</h1>
        <div className="oly-empty">{loadError}</div>
      </div>
    );
  }

  return (
    <div className="oly-page">
      <h1>Artist Intelligence</h1>
      <div className="oly-sub">Last 30 days across everything you've uploaded.</div>

      {intelOff === true && (
        <div className="oly-msg err" style={{ marginBottom: 16 }}>
          Listening analytics are not available (FEATURE_INTEL off or route missing).
        </div>
      )}
      {commerceOff === true && (
        <div className="oly-msg err" style={{ marginBottom: 16 }}>
          Revenue data is not available (FEATURE_COMMERCE off or route missing).
        </div>
      )}

      <div className="oly-stat-row">
        <div className="oly-stat"><div className="value">{overview?.plays ?? 0}</div><div className="label">Plays</div></div>
        <div className="oly-stat"><div className="value">{overview?.uniqueListeners ?? 0}</div><div className="label">Unique listeners</div></div>
        <div className="oly-stat"><div className="value">{Math.round((overview?.completionRate ?? 0) * 100)}%</div><div className="label">Completion rate</div></div>
        <div className="oly-stat"><div className="value">{Math.round((overview?.skipRate ?? 0) * 100)}%</div><div className="label">Skip rate</div></div>
        <div className="oly-stat"><div className="value">{centsToUsd(totalEarned)}</div><div className="label">Earned (your 80%)</div></div>
      </div>

      <div className="oly-section">
        <h2>Top tracks</h2>
        {intelOff === true ? (
          <div className="oly-empty">Intel analytics disabled on this server.</div>
        ) : topTracks.length === 0 ? (
          <div className="oly-empty">No plays recorded yet.</div>
        ) : (
          <table className="oly-table">
            <thead>
              <tr><th>Track</th><th>Plays</th><th>Listeners</th><th>Skip rate</th><th></th></tr>
            </thead>
            <tbody>
              {topTracks.map((track) => (
                <tr key={track.songId}>
                  <td>{track.title}</td>
                  <td>{track.plays}</td>
                  <td>{track.uniqueListeners}</td>
                  <td>{Math.round(track.skipRate * 100)}%</td>
                  <td>
                    <button className="oly-btn-ghost" onClick={() => loadRetention(track)}>
                      Retention
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {retentionSong && (
        <div className="oly-section">
          <h2>Retention — {retentionSong.title}</h2>
          {!retention ? (
            <div className="muted">Loading…</div>
          ) : retention.error ? (
            <div className="oly-msg err">{retention.error}</div>
          ) : (
            <>
              <div className="muted">
                {retention.plays} listeners · peak engagement at {Math.round((retention.retention?.peak?.startMs || 0) / 1000)}s
                (green bar). Each bar is 10 seconds.
              </div>
              <RetentionChart retention={retention.retention} />
              {retention.skipHotspots?.length > 0 && (
                <div className="muted" style={{ marginTop: 8 }}>
                  Most skips at: {retention.skipHotspots.slice(0, 3).map((h) => `${Math.round(h.startMs / 1000)}s`).join(', ')}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="oly-section">
        <h2>Where your listeners are</h2>
        {intelOff === true ? (
          <div className="oly-empty">Intel analytics disabled on this server.</div>
        ) : geo.length === 0 ? (
          <div className="oly-empty">No geo data yet.</div>
        ) : (
          <table className="oly-table">
            <thead><tr><th>Country</th><th>Plays</th><th>Listeners</th></tr></thead>
            <tbody>
              {geo.slice(0, 12).map((row) => (
                <tr key={row.country}>
                  <td>{row.country === '??' ? 'Unknown' : row.country}</td>
                  <td>{row.plays}</td>
                  <td>{row.uniqueListeners}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="oly-section">
        <h2>Revenue by track</h2>
        {commerceOff === true && intelOff !== false && revenueByTrack.length === 0 ? (
          <div className="oly-empty">Commerce is not available on this server (feature flag off or route missing).</div>
        ) : revenueByTrack.length === 0 ? (
          <div className="oly-empty">No sales yet — list a track in the Store.</div>
        ) : (
          <table className="oly-table">
            <thead><tr><th>Track</th><th>Sales</th><th>Your share</th></tr></thead>
            <tbody>
              {revenueByTrack.map((row) => (
                <tr key={row.songId}>
                  <td>{row.title}</td>
                  <td>{row.sales}</td>
                  <td>{centsToUsd(row.artistCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default ArtistDashboard;
