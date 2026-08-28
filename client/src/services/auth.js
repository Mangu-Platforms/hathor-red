import api from './api';

const decodeToken = (token) => {
  try {
    return JSON.parse(atob(token.split('.')[1]));
  } catch { return null; }
};

export const authService = {
  register: async (username, email, password, displayName) => {
    const response = await api.post('/auth/register', { username, email, password, displayName });
    if (response.data.token) localStorage.setItem('token', response.data.token);
    return response.data;
  },
  login: async (username, password) => {
    const response = await api.post('/auth/login', { username, password });
    if (response.data.token) localStorage.setItem('token', response.data.token);
    return response.data;
  },
  logout: () => {
    localStorage.removeItem('token');
  },
  getProfile: async () => {
    const response = await api.get('/auth/profile');
    return response.data;
  },
  updateProfile: async (data) => {
    const response = await api.put('/auth/profile', data);
    return response.data;
  },
  changePassword: async (currentPassword, newPassword) => {
    const response = await api.post('/auth/change-password', { currentPassword, newPassword });
    return response.data;
  },
  getStats: async () => {
    const response = await api.get('/auth/stats');
    return response.data;
  },
  isAuthenticated: () => {
    const token = localStorage.getItem('token');
    if (!token) return false;
    const payload = decodeToken(token);
    if (!payload?.exp) return false;
    return (payload.exp * 1000) > (Date.now() - 60000);
  },
};
