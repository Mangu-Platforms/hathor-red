import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { login, error } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try { await login(username, password); }
    catch { /* error handled by context */ }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">HATHOR</div>
        <h2>Welcome back</h2>
        <p>Sign in to your music universe</p>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Username or email"
            value={username}
            onChange={e => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <button type="submit" className="auth-btn">Sign In</button>
        </form>
        <p className="auth-footer">Don't have an account? <Link to="/register">Get Started</Link></p>
      </div>
    </div>
  );
};

export default Login;
