import api from './api';

/**
 * stream-url returns a path like `/api/songs/:id/stream?t=…`.
 * When REACT_APP_API_URL is an absolute origin (dev without proxy),
 * resolve against that host so <audio src> hits the Express server.
 */
function resolveStreamUrl(url) {
  if (!url || typeof url !== 'string') return url;
  if (!url.startsWith('/')) return url;
  const base = process.env.REACT_APP_API_URL || '';
  if (!base.startsWith('http')) return url;
  try {
    const origin = new URL(base).origin;
    return `${origin}${url}`;
  } catch {
    return url;
  }
}

export const musicService = {
  getSongs: (params) => api.get('/songs', { params }).then(r => r.data),
  getSong: (id) => api.get(`/songs/${id}`).then(r => r.data),
  getGenres: () => api.get('/songs/genres').then(r => r.data),
  getStreamUrl: (id) =>
    api.get(`/songs/${id}/stream-url`).then((r) => {
      const data = r.data || {};
      return { ...data, url: resolveStreamUrl(data.url) };
    }),
  uploadSong: (formData) => api.post('/songs/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data),
  recordListening: (songId, duration) => api.post('/songs/record-listening', { songId, duration }).then(r => r.data),

  getPlaylists: () => api.get('/playlists').then(r => r.data),
  getPlaylist: (id) => api.get(`/playlists/${id}`).then(r => r.data),
  createPlaylist: (data) => api.post('/playlists', data).then(r => r.data),
  addToPlaylist: (playlistId, songId) => api.post('/playlists/add-song', { playlistId, songId }).then(r => r.data),
  removeFromPlaylist: (playlistId, songId) => api.delete(`/playlists/${playlistId}/songs/${songId}`).then(r => r.data),
  deletePlaylist: (id) => api.delete(`/playlists/${id}`).then(r => r.data),
  generateAIPlaylist: (prompt, name, songCount) => api.post('/playlists/generate-ai', { prompt, name, songCount }).then(r => r.data),

  getPlaybackState: () => api.get('/playback/state').then(r => r.data),
  updatePlaybackState: (state) => api.post('/playback/state', state).then(r => r.data),

  getRooms: () => api.get('/rooms').then(r => r.data),
  getRoom: (id) => api.get(`/rooms/${id}`).then(r => r.data),
  createRoom: (data) => api.post('/rooms', data).then(r => r.data),
  joinRoom: (id) => api.post(`/rooms/${id}/join`).then(r => r.data),
  leaveRoom: (id) => api.post(`/rooms/${id}/leave`).then(r => r.data),
  deleteRoom: (id) => api.delete(`/rooms/${id}`).then(r => r.data),

  getAIStatus: () => api.get('/ai/status').then(r => r.data),
  getRecommendations: (params) => api.get('/ai/recommendations', { params }).then(r => r.data),
  getDailyMix: () => api.get('/ai/daily-mix').then(r => r.data),
  getSimilarSongs: (songId) => api.get(`/ai/similar/${songId}`).then(r => r.data),
  detectMood: (input) => api.post('/ai/mood/detect', { input }).then(r => r.data),
  search: (q) => api.get('/ai/search', { params: { q } }).then(r => r.data),
  chat: (message, history, context) => api.post('/ai/chat', { message, conversationHistory: history, context }).then(r => r.data),
};
