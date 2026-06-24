import api from './api';

/**
 * Decode JWT payload without verification (client-side)
 */
const decodeToken = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload;
  } catch {
    return null;
  }
};

export const authService = {
  register: async (username, email, password, displayName) => {
    const response = await api.post('/auth/register', {
      username,
      email,
      password,
      displayName,
    });
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
    }
    return response.data;
  },

  login: async (username, password) => {
    const response = await api.post('/auth/login', { username, password });
    if (response.data.token) {
      localStorage.setItem('token', response.data.token);
    }
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

  /**
   * Check if user is authenticated with a valid (non-expired) token
   */
  isAuthenticated: () => {
    const token = localStorage.getItem('token');
    if (!token) return false;
    const payload = decodeToken(token);
    if (!payload || !payload.exp) return false;
    // Add 60-second buffer for clock skew
    return (payload.exp * 1000) > (Date.now() - 60000);
  },

  /**
   * Get token expiry time in milliseconds
   */
  getTokenExpiry: () => {
    const token = localStorage.getItem('token');
    if (!token) return null;
    const payload = decodeToken(token);
    return payload?.exp ? payload.exp * 1000 : null;
  },
};
