import React from 'react';
import './Olympus.css';

/**
 * Podcast product does not ship. This route is an intentional coming-soon shell
 * so nav stays honest (label: "Podcasts (soon)") without implying catalog, RSS,
 * subscribe, or episode playback APIs exist.
 */
const Podcast = () => {
  return (
    <div className="oly-page">
      <h1>Podcasts</h1>
      <div className="oly-sub">Coming soon — not available on this build.</div>

      <div className="oly-empty" role="status">
        <p style={{ marginBottom: 8 }}>
          There is no podcast catalog, subscribe flow, or episode stream route in this app yet.
        </p>
        <p style={{ opacity: 0.85, fontSize: 14, maxWidth: 520, margin: '0 auto' }}>
          Music playback, playlists, and listening rooms work today. When podcasts ship, this page
          will load real shows instead of this shell — until then the sidebar label stays marked
          &quot;(soon)&quot; so it is not mistaken for a live product.
        </p>
      </div>

      <div className="oly-section">
        <h2>Planned (not implemented)</h2>
        <div className="oly-grid">
          <div className="oly-card">
            <h3>Discover</h3>
            <div className="muted">Find shows from listening taste — no discovery API wired.</div>
          </div>
          <div className="oly-card">
            <h3>Create / publish</h3>
            <div className="muted">Upload and distribute episodes — no podcast upload path.</div>
          </div>
          <div className="oly-card">
            <h3>Integrated queue</h3>
            <div className="muted">Switch music ↔ episodes in one player — episodes are not a media type yet.</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Podcast;
