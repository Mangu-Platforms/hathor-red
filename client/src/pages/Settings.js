import React, { useEffect, useState, useCallback } from 'react';
import { privacyService } from '../services/olympus';
import { authService } from '../services/auth';
import { useAuth } from '../contexts/AuthContext';
import { getFeatures } from '../services/api';
import './Olympus.css';

const Settings = () => {
  const { user, updateProfile, logout } = useAuth();
  const [exportInfo, setExportInfo] = useState(null);
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMsg, setProfileMsg] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);
  const [features, setFeatures] = useState(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || user.displayName || '');
      setAvatarUrl(user.avatar_url || user.avatarUrl || '');
    }
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    getFeatures().then((f) => {
      if (!cancelled) setFeatures(f);
    });
    return () => { cancelled = true; };
  }, []);

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
    const trimmedAvatar = (avatarUrl || '').trim();
    if (trimmedAvatar) {
      try {
        const u = new URL(trimmedAvatar);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          setProfileMsg({ ok: false, text: 'Avatar URL must be http or https' });
          return;
        }
      } catch {
        setProfileMsg({ ok: false, text: 'Avatar URL is not a valid URL' });
        return;
      }
    }
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      await updateProfile({
        displayName: trimmed,
        // empty string clears avatar on server (null alone was ignored by old COALESCE)
        avatarUrl: trimmedAvatar || '',
      });
      setProfileMsg({ ok: true, text: 'Profile updated' });
    } catch (err) {
      setProfileMsg({ ok: false, text: err.response?.data?.error || 'Update failed' });
    } finally {
      setProfileBusy(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (!currentPassword || !newPassword) {
      setPwMsg({ ok: false, text: 'Enter current and new password' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg({ ok: false, text: 'New password and confirmation do not match' });
      return;
    }
    if (newPassword.length < 8) {
      setPwMsg({ ok: false, text: 'New password must be at least 8 characters' });
      return;
    }
    setPwBusy(true);
    try {
      await authService.changePassword(currentPassword, newPassword);
      setPwMsg({ ok: true, text: 'Password updated' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      const details = err.response?.data?.details;
      const detailMsg = Array.isArray(details) && details[0]?.message ? details[0].message : null;
      setPwMsg({
        ok: false,
        text: detailMsg || err.response?.data?.error || 'Password change failed',
      });
    } finally {
      setPwBusy(false);
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

  const currentAvatar = user?.avatar_url || user?.avatarUrl || avatarUrl;

  const workerLabel = (() => {
    if (!features) return null;
    if (features.worker === false) return 'Background jobs off (FEATURE_WORKER)';
    if (features.workerLive) return 'Background job worker running';
    return 'Background job worker not running (queued jobs may stall)';
  })();

  const aiLabel = (() => {
    if (!features) return null;
    if (features.aiLive) return 'AI: live model';
    return 'AI: rule-based fallback';
  })();

  return (
    <div className="oly-page">
      <h1>Settings</h1>
      <div className="oly-sub">Account, privacy, and data controls.</div>

      {features && (
        <div className="oly-section" style={{ marginTop: 0 }}>
          <h2>Platform status</h2>
          <p className="muted" style={{ marginBottom: 8 }}>
            Honest runtime signals from the API (no secrets). GDPR export and media pipeline
            jobs need a live worker when those pillars are enabled.
          </p>
          <div>
            {workerLabel && <span className="oly-reason">{workerLabel}</span>}
            {aiLabel && <span className="oly-reason">{aiLabel}</span>}
            {features.privacy === false && <span className="oly-reason">Privacy pillar off</span>}
            {features.media === false && <span className="oly-reason">Media pipeline off</span>}
          </div>
        </div>
      )}

      <div className="oly-section">
        <h2>Profile</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Username and email are fixed after registration. You can change your display name
          and set an avatar image URL (no file upload yet).
        </p>
        {user && (
          <div style={{ marginBottom: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
            <div
              className="user-avatar"
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                overflow: 'hidden',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'var(--surface-2, #2a2a2a)',
                fontSize: '1.25rem',
              }}
            >
              {currentAvatar ? (
                <img
                  src={currentAvatar}
                  alt=""
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              ) : (
                (user.display_name || user.displayName || user.username)?.[0]?.toUpperCase()
              )}
            </div>
            <div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>Username</div>
              <div style={{ marginBottom: 8 }}>{user.username}</div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>Email</div>
              <div>{user.email}</div>
            </div>
          </div>
        )}
        <form onSubmit={saveProfile}>
          <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: 4 }}>
            Display name
          </label>
          <div className="oly-row" style={{ maxWidth: 420, marginBottom: 12 }}>
            <input
              className="oly-input"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
              disabled={profileBusy}
              placeholder="How you appear to others"
            />
          </div>
          <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: 4 }}>
            Avatar URL
          </label>
          <div className="oly-row" style={{ maxWidth: 420 }}>
            <input
              className="oly-input"
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              maxLength={500}
              disabled={profileBusy}
              placeholder="https://… (optional; leave blank to clear)"
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

      <div className="oly-section">
        <h2>Change password</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Use your current password, then a new one (8+ characters with upper, lower, and a number).
          OAuth is not available yet.
        </p>
        <form onSubmit={savePassword} style={{ maxWidth: 420 }}>
          <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: 4 }}>
            Current password
          </label>
          <input
            className="oly-input"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            disabled={pwBusy}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: 4 }}>
            New password
          </label>
          <input
            className="oly-input"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            disabled={pwBusy}
            style={{ width: '100%', marginBottom: 12 }}
          />
          <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: 4 }}>
            Confirm new password
          </label>
          <div className="oly-row">
            <input
              className="oly-input"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={pwBusy}
            />
            <button className="oly-btn" type="submit" disabled={pwBusy}>
              {pwBusy ? 'Updating…' : 'Update password'}
            </button>
          </div>
        </form>
        {pwMsg && (
          <div className={`oly-msg ${pwMsg.ok ? 'ok' : 'err'}`} style={{ marginTop: 12 }}>
            {pwMsg.text}
          </div>
        )}
      </div>

      {message && <div className={`oly-msg ${message.ok ? 'ok' : 'err'}`}>{message.text}</div>}

      <div className="oly-section">
        <h2>Export my data (GDPR)</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          One JSON file with your profile, playlists, uploads, listening history, purchases,
          subscriptions, comments, and audit trail.
          {features && features.worker !== false && features.workerLive === false && (
            <> Export jobs need the background worker; status above shows it is not running.</>
          )}
          {features && features.worker === false && (
            <> Background worker flag is off — exports may not process until it is enabled.</>
          )}
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
