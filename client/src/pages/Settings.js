import React, { useEffect, useState, useCallback } from 'react';
import { privacyService } from '../services/olympus';
import { useAuth } from '../contexts/AuthContext';
import './Olympus.css';

const Settings = () => {
  const { user, updateProfile, logout } = useAuth();
  const [exportInfo, setExportInfo] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || user.displayName || '');
    }
  }, [user]);

  const refresh = useCallback(() => {
    privacyService.exportStatus()
      .then((data) => setExportInfo(data.export))
      .catch(() => setExportInfo(null));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveProfile = async (e) => {
    e.preventDefault();
    const trimmed = (displayName || '').trim();
    if (!trimmed) {
      setProfileMsg({ ok: false, text: 'Display name cannot be empty' });
      return;
    }
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      await updateProfile({ displayName: trimmed });
      setProfileMsg({ ok: true, text: 'Profile updated' });
    } catch (err) {
      setProfileMsg({ ok: false, text: err.response?.data?.error || 'Update failed' });
    } finally {
      setProfileBusy(false);
    }
  };

  const requestExport = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await privacyService.requestExport();
      setMessage({ ok: true, text: 'Export queued — it will be ready within 72 hours (usually minutes).' });
      refresh();
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.error || 'Export request failed' });
    } finally {
      setBusy(false);
    }
  };

  const requestDeletion = async () => {
    if (!window.confirm('Request account deletion? You can cancel while it is pending.')) return;
    setBusy(true);
    setMessage(null);
    try {
      await privacyService.requestDeletion();
      setMessage({ ok: true, text: 'Deletion request recorded. You can cancel it below until it is processed.' });
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.error || 'Deletion request failed' });
    } finally {
      setBusy(false);
    }
  };

  const cancelDeletion = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await privacyService.cancelDeletion();
      setMessage({ ok: true, text: 'Deletion request canceled.' });
    } catch (err) {
      setMessage({ ok: false, text: err.response?.data?.error || 'Nothing to cancel' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="oly-page">
      <h1>Settings</h1>
      <div className="oly-sub">Account, privacy, and data controls.</div>

      <div className="oly-section">
        <h2>Profile</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Username and email are fixed after registration. You can change your display name.
        </p>
        {user && (
          <div style={{ marginBottom: 12 }}>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Username</div>
            <div style={{ marginBottom: 8 }}>{user.username}</div>
            <div className="muted" style={{ fontSize: '0.85rem' }}>Email</div>
            <div style={{ marginBottom: 12 }}>{user.email}</div>
          </div>
        )}
        <form onSubmit={saveProfile}>
          <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: 4 }}>
            Display name
          </label>
          <div className="oly-row" style={{ maxWidth: 420 }}>
            <input
              className="oly-input"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
              disabled={profileBusy}
              placeholder="How you appear to others"
            />
            <button className="oly-btn" type="submit" disabled={profileBusy}>
              {profileBusy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
        {profileMsg && (
          <div className={`oly-msg ${profileMsg.ok ? 'ok' : 'err'}`} style={{ marginTop: 12 }}>
            {profileMsg.text}
          </div>
        )}
        <div className="oly-row" style={{ marginTop: 16 }}>
          <button className="oly-btn-ghost" type="button" onClick={() => logout()}>
            Sign out
          </button>
        </div>
      </div>

      {message && <div className={`oly-msg ${message.ok ? 'ok' : 'err'}`}>{message.text}</div>}

      <div className="oly-section">
        <h2>Export my data (GDPR)</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          One JSON file with your profile, playlists, uploads, listening history, purchases,
          subscriptions, comments, and audit trail.
        </p>
        <div className="oly-row">
          <button className="oly-btn" onClick={requestExport} disabled={busy}>Request export</button>
          <button className="oly-btn-ghost" onClick={refresh}>Check status</button>
        </div>
        {exportInfo && (
          <div style={{ marginTop: 12 }}>
            <span className="oly-reason">status: {exportInfo.status}</span>
            {exportInfo.status === 'ready' && exportInfo.downloadUrl && (
              <a
                className="oly-btn-ghost"
                style={{ marginLeft: 8, textDecoration: 'none', display: 'inline-block' }}
                href={`${process.env.REACT_APP_API_URL || '/api'}${exportInfo.downloadUrl.replace(/^\/api/, '')}`}
                target="_blank"
                rel="noreferrer"
              >
                Download (valid until {new Date(exportInfo.expiresAt).toLocaleString()})
              </a>
            )}
            {exportInfo.status === 'failed' && <span className="oly-msg err">{exportInfo.error}</span>}
          </div>
        )}
      </div>

      <div className="oly-section">
        <h2>Delete my account</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Requests are processed under the platform retention policy — records we are legally
          required to keep (e.g. purchase history) are retained.
        </p>
        <div className="oly-row">
          <button className="oly-btn" style={{ background: 'var(--error)' }} onClick={requestDeletion} disabled={busy}>
            Request deletion
          </button>
          <button className="oly-btn-ghost" onClick={cancelDeletion} disabled={busy}>
            Cancel pending request
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;
