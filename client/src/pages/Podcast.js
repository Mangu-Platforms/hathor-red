import React from 'react';

const Podcast = () => {
  return (
    <div className="podcast-page">
      <div className="podcast-hero">
        <h1>Podcasts</h1>
        <p>Coming soon to Hathor</p>
      </div>
      <div className="podcast-coming-soon">
        <div className="coming-soon-icon">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1} width="64" height="64">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </div>
        <h2>Podcasts are on the way</h2>
        <p>We're building the ultimate podcast experience into Hathor.</p>
        <p>Discover, subscribe, and listen to your favorite shows alongside your music.</p>
        <div className="coming-soon-features">
          <div className="feature-card">
            <h4>Discover</h4>
            <p>Find podcasts based on your music taste and listening habits</p>
          </div>
          <div className="feature-card">
            <h4>Create</h4>
            <p>Upload and distribute your own podcast directly from Hathor</p>
          </div>
          <div className="feature-card">
            <h4>Integrate</h4>
            <p>Seamlessly switch between music and podcasts in one app</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Podcast;
