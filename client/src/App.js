import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PlayerProvider } from './contexts/PlayerContext';
import Sidebar from './components/Sidebar';
import MusicPlayer from './components/MusicPlayer';
import Login from './components/Login';
import Register from './components/Register';
import Home from './pages/Home';
import Playlists from './pages/Playlists';
import PlaylistDetail from './pages/PlaylistDetail';
import Rooms from './pages/Rooms';
import Podcast from './pages/Podcast';
import ListeningRoom from './components/ListeningRoom';
import TrackComments from './components/TrackComments';
import Store from './pages/Store';
import Library from './pages/Library';
import Radar from './pages/Radar';
import Search from './pages/Search';
import ArtistDashboard from './pages/ArtistDashboard';
import Settings from './pages/Settings';
import { getFeatures } from './services/api';
import './App.css';

const PrivateRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  return isAuthenticated ? children : <Navigate to="/login" />;
};

const PublicRoute = ({ children }) => {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="loading-screen">Loading...</div>;
  return !isAuthenticated ? children : <Navigate to="/" />;
};

/**
 * Gate a route by Olympus feature flag. While flags load, render children
 * (same as sidebar: avoid flash). When flag is explicitly false, redirect Home.
 * Artist Hub needs intel OR commerce.
 */
const FeatureRoute = ({ flag, anyOf, children }) => {
  const [features, setFeatures] = useState(null);

  useEffect(() => {
    let cancelled = false;
    getFeatures().then((f) => {
      if (!cancelled) setFeatures(f);
    });
    return () => { cancelled = true; };
  }, []);

  if (features == null) return children;

  if (anyOf && Array.isArray(anyOf)) {
    const ok = anyOf.some((k) => features[k] !== false);
    if (!ok) return <Navigate to="/" replace />;
    return children;
  }

  if (flag && features[flag] === false) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const AppLayout = ({ children }) => (
  <div className="app-layout">
    <Sidebar />
    <main className="main-content">
      {children}
    </main>
    <TrackComments />
    <MusicPlayer />
  </div>
);

function App() {
  return (
    <Router>
      <AuthProvider>
        <PlayerProvider>
          <Routes>
            <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
            <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
            <Route path="/" element={<PrivateRoute><AppLayout><Home /></AppLayout></PrivateRoute>} />
            <Route path="/playlists" element={<PrivateRoute><AppLayout><Playlists /></AppLayout></PrivateRoute>} />
            <Route path="/playlists/:id" element={<PrivateRoute><AppLayout><PlaylistDetail /></AppLayout></PrivateRoute>} />
            <Route path="/rooms" element={<PrivateRoute><AppLayout><Rooms /></AppLayout></PrivateRoute>} />
            <Route path="/room/:id" element={<PrivateRoute><AppLayout><ListeningRoom /></AppLayout></PrivateRoute>} />
            <Route path="/podcast" element={<PrivateRoute><AppLayout><Podcast /></AppLayout></PrivateRoute>} />
            <Route
              path="/search"
              element={
                <PrivateRoute>
                  <FeatureRoute flag="discovery">
                    <AppLayout><Search /></AppLayout>
                  </FeatureRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/radar"
              element={
                <PrivateRoute>
                  <FeatureRoute flag="discovery">
                    <AppLayout><Radar /></AppLayout>
                  </FeatureRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/store"
              element={
                <PrivateRoute>
                  <FeatureRoute flag="commerce">
                    <AppLayout><Store /></AppLayout>
                  </FeatureRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/library"
              element={
                <PrivateRoute>
                  <FeatureRoute flag="commerce">
                    <AppLayout><Library /></AppLayout>
                  </FeatureRoute>
                </PrivateRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <PrivateRoute>
                  <FeatureRoute anyOf={["intel", "commerce"]}>
                    <AppLayout><ArtistDashboard /></AppLayout>
                  </FeatureRoute>
                </PrivateRoute>
              }
            />
            <Route path="/settings" element={<PrivateRoute><AppLayout><Settings /></AppLayout></PrivateRoute>} />
          </Routes>
        </PlayerProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
