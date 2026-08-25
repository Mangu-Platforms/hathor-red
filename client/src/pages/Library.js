import React, { useEffect, useState } from 'react';
import { commerceService } from '../services/olympus';
import { usePlayer } from '../contexts/PlayerContext';
import './Olympus.css';

const Library = () => {
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState(null);
  const { setQueueAndPlay, formatTime } = usePlayer();

  useEffect(() => {
    commerceService.getLibrary()
      .then((data) => setLibrary(data.library || []))
      .catch(() => setLibrary([]))
      .finally(() => setLoading(false));
  }, []);

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

  return (
    <div className="oly-page">
      <h1>Your Library</h1>
      <div className="oly-sub">Tracks you own forever — stream anywhere, download the lossless original.</div>
      {message && <div className={`oly-msg ${message.ok ? 'ok' : 'err'}`}>{message.text}</div>}
      {loading ? (
        <div className="oly-empty">Loading library…</div>
      ) : library.length === 0 ? (
        <div className="oly-empty">Nothing here yet — visit the Store to own your first track.</div>
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
