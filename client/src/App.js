import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { PlayerProvider } from './contexts/PlayerContext';
import Sidebar from './components/Sidebar';
import MusicPlayer from './components/MusicPlayer';
import Login from './components/Login';
import Register from './components/Register';
import Home from './pages/Home';
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
            <Route path="/playlists" element={<PrivateRoute><AppLayout><Home /></AppLayout></PrivateRoute>} />
            <Route path="/rooms" element={<PrivateRoute><AppLayout><Rooms /></AppLayout></PrivateRoute>} />
            <Route path="/room/:id" element={<PrivateRoute><AppLayout><ListeningRoom /></AppLayout></PrivateRoute>} />
            <Route path="/podcast" element={<PrivateRoute><AppLayout><Podcast /></AppLayout></PrivateRoute>} />
            <Route path="/search" element={<PrivateRoute><AppLayout><Search /></AppLayout></PrivateRoute>} />
            <Route path="/radar" element={<PrivateRoute><AppLayout><Radar /></AppLayout></PrivateRoute>} />
            <Route path="/store" element={<PrivateRoute><AppLayout><Store /></AppLayout></PrivateRoute>} />
            <Route path="/library" element={<PrivateRoute><AppLayout><Library /></AppLayout></PrivateRoute>} />
            <Route path="/dashboard" element={<PrivateRoute><AppLayout><ArtistDashboard /></AppLayout></PrivateRoute>} />
            <Route path="/settings" element={<PrivateRoute><AppLayout><Settings /></AppLayout></PrivateRoute>} />
          </Routes>
        </PlayerProvider>
      </AuthProvider>
    </Router>
  );
}

export default App;
