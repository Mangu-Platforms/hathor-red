import React, { useEffect, useState, useCallback } from 'react';
import { discoveryService } from '../services/olympus';
import { musicService } from '../services/music';
import { usePlayer } from '../contexts/PlayerContext';
import './Olympus.css';

const Radar = () => {
  const [radar, setRadar] = useState(null);
  const [loading, setLoading] = useState(true);
  const { setQueueAndPlay } = usePlayer();

  const load = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      setRadar(await discoveryService.getRadar(refresh));
    } catch (err) {
      setRadar(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const playAll = async () => {
    if (!radar?.tracks?.length) return;
    // Radar rows carry ids + display fields; hydrate full song rows for the queue.
    const songs = await Promise.all(
      radar.tracks.map((t) =>
        musicService.getSong(t.songId).then((d) => d.song).catch(() => null)
      )
    );
    const playable = songs.filter(Boolean);
    if (playable.length > 0) setQueueAndPlay(playable, 0);
  };

  return (
    <div className="oly-page">
      <h1>Mangu Radar</h1>
      <div className="oly-sub">
        Your personal mix — listeners like you, the sound of your recent plays, and what's fresh.
        {radar?.generatedAt && ` Updated ${new Date(radar.generatedAt).toLocaleString()}.`}
      </div>

      <div className="oly-row" style={{ marginBottom: 20 }}>
        <button className="oly-btn" onClick={playAll} disabled={!radar?.tracks?.length}>Play the mix</button>
        <button className="oly-btn-ghost" onClick={() => load(true)}>Refresh</button>
      </div>

      {loading ? (
        <div className="oly-empty">Tuning your radar…</div>
      ) : !radar?.tracks?.length ? (
        <div className="oly-empty">
          Not enough listening history yet — play a few tracks and check back.
        </div>
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
