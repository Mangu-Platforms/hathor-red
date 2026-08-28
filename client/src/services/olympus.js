import api from './api';

// Project Olympus API surface: commerce, discovery, social, intel, privacy.

export const commerceService = {
  listProducts: (params) => api.get('/commerce/products', { params }).then(r => r.data),
  createProduct: (data) => api.post('/commerce/products', data).then(r => r.data),
  updateProduct: (id, data) => api.put(`/commerce/products/${id}`, data).then(r => r.data),
  checkout: (productId, amountCents, idempotencyKey) =>
    api.post('/commerce/checkout', { productId, amountCents, idempotencyKey }).then(r => r.data),
  getLibrary: () => api.get('/commerce/library').then(r => r.data),
  requestDownloadToken: (songId) => api.post('/commerce/download-token', { songId }).then(r => r.data),
  listTiers: (artistId) => api.get(`/commerce/artists/${artistId}/tiers`).then(r => r.data),
  createTier: (data) => api.post('/commerce/tiers', data).then(r => r.data),
  subscribe: (tierId) => api.post('/commerce/subscribe', { tierId }).then(r => r.data),
  cancelSubscription: (id) => api.post(`/commerce/subscriptions/${id}/cancel`).then(r => r.data),
  mySubscriptions: () => api.get('/commerce/subscriptions').then(r => r.data),
  getRevenue: () => api.get('/commerce/revenue').then(r => r.data),
  setEarlyAccess: (songId, until) => api.put(`/commerce/songs/${songId}/early-access`, { until }).then(r => r.data),
};

export const discoveryService = {
  search: (q, limit) => api.get('/discovery/search', { params: { q, limit } }).then(r => r.data),
  getRadar: (refresh) => api.get('/discovery/radar', { params: refresh ? { refresh: 'true' } : {} }).then(r => r.data),
  getSimilar: (songId, limit) => api.get(`/discovery/similar/${songId}`, { params: { limit } }).then(r => r.data),
};

export const socialService = {
  getComments: (songId, params) => api.get(`/social/songs/${songId}/comments`, { params }).then(r => r.data),
  addComment: (songId, body, timestampMs) =>
    api.post(`/social/songs/${songId}/comments`, { body, timestampMs }).then(r => r.data),
  deleteComment: (commentId) => api.delete(`/social/comments/${commentId}`).then(r => r.data),
};

export const intelService = {
  sendEvents: (events, source = 'web') => api.post('/intel/events', { events, source }).then(r => r.data),
  getOverview: (days) => api.get('/intel/overview', { params: { days } }).then(r => r.data),
  getTopTracks: (days, limit) => api.get('/intel/top-tracks', { params: { days, limit } }).then(r => r.data),
  getRetention: (songId) => api.get(`/intel/songs/${songId}/retention`).then(r => r.data),
  getGeography: (days) => api.get('/intel/geography', { params: { days } }).then(r => r.data),
  getRevenueByTrack: () => api.get('/intel/revenue-by-track').then(r => r.data),
};

export const mediaService = {
  getWaveform: (songId) => api.get(`/media/songs/${songId}/waveform`).then(r => r.data),
  getPipeline: (songId) => api.get(`/media/songs/${songId}/pipeline`).then(r => r.data),
  reprocess: (songId) => api.post(`/media/songs/${songId}/reprocess`).then(r => r.data),
  getJob: (jobId) => api.get(`/media/jobs/${jobId}`).then(r => r.data),
};

export const privacyService = {
  requestExport: () => api.post('/privacy/export', {}).then(r => r.data),
  exportStatus: () => api.get('/privacy/export').then(r => r.data),
  requestDeletion: (reason) => api.post('/privacy/deletion-request', { reason }).then(r => r.data),
  cancelDeletion: () => api.delete('/privacy/deletion-request').then(r => r.data),
  getAudit: (limit) => api.get('/privacy/audit', { params: { limit } }).then(r => r.data),
};

/** Random idempotency key for checkouts (client-side, retry-safe). */
export function newIdempotencyKey() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `idk-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
