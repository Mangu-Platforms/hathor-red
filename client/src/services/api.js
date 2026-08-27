import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      window.dispatchEvent(new CustomEvent('auth:logout', { detail: { reason: 'token_expired' } }));
    }
    return Promise.reject(error);
  }
);

/** Public Olympus feature flags (no auth). Cached for the session. */
let featuresCache = null;
let featuresPromise = null;

export async function getFeatures() {
  if (featuresCache) return featuresCache;
  if (featuresPromise) return featuresPromise;
  featuresPromise = api.get('/features')
    .then((r) => {
      featuresCache = r.data || {};
      return featuresCache;
    })
    .catch(() => {
      // Assume enabled so nav stays usable if health path fails; pages already
      // distinguish 404 (flag off) from empty data.
      featuresCache = {
        media: true,
        commerce: true,
        discovery: true,
        social: true,
        intel: true,
        privacy: true,
        worker: true,
      };
      return featuresCache;
    })
    .finally(() => {
      featuresPromise = null;
    });
  return featuresPromise;
}

export default api;
