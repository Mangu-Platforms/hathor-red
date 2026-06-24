import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const Register = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const { register, error } = useAuth();

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password.length < 8) return alert('Password must be at least 8 characters');
    try { await register(username, email, password, displayName); }
    catch { /* error handled by context */ }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-logo">HATHOR</div>
        <h2>Create your account</h2>
        <p>Join the greatest music platform on Earth</p>
        {error && <div className="auth-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <input type="text" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} maxLength={50} />
          <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input type="text" placeholder="Display Name (optional)" value={displayName} onChange={e => setDisplayName(e.target.value)} maxLength={100} />
          <input type="password" placeholder="Password (8+ chars, uppercase, lowercase, number)" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} />
          <button type="submit" className="auth-btn">Get Started</button>
        </form>
        <p className="auth-footer">Already have an account? <Link to="/login">Sign In</Link></p>
      </div>
    </div>
  );
};

export default Register;
