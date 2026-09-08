import React, { useEffect, useState, useCallback, useRef } from 'react';
import { privacyService } from '../services/olympus';
import { authService } from '../services/auth';
import { useAuth } from '../contexts/AuthContext';
import { getFeatures, getHealth } from '../services/api';
import './Olympus.css';

const TOAST_CLEAR_MS = 5000;

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
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState(null);
  const [features, setFeatures] = useState(null);
  const [health, setHealth] = useState(null);
  const [healthErr, setHealthErr] = useState(null);
  const [stats, setStats] = useState(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const [statusCheckedAt, setStatusCheckedAt] = useState(null);
  const profileToastTimer = useRef(null);
  const pwToastTimer = useRef(null);
  const messageToastTimer = useRef(null);

  useEffect(() => {
    if (user) {
      setDisplayName(user.display_name || user.displayName || '');
      setAvatarUrl(user.avatar_url || user.avatarUrl || '');
    }
  }, [user]);

  // dose-2.82 / dose-2.84: auto-clear profile & password toasts (success and error)
  // so Settings does not stay on "Profile updated" or a stale failure forever.
  useEffect(() => {
    clearTimeout(profileToastTimer.current);
    if (profileMsg) {
      profileToastTimer.current = setTimeout(() => setProfileMsg(null), TOAST_CLEAR_MS);
    }
    return () => clearTimeout(profileToastTimer.current);
  }, [profileMsg]);

  useEffect(() => {
    clearTimeout(pwToastTimer.current);
    if (pwMsg) {
      pwToastTimer.current = setTimeout(() => setPwMsg(null), TOAST_CLEAR_MS);
    }
    return () => clearTimeout(pwToastTimer.current);
  }, [pwMsg]);

  // dose-2.85: auto-clear privacy/export toast (success and error) like profile/password
  useEffect(() => {
    clearTimeout(messageToastTimer.current);
    if (message) {
      messageToastTimer.current = setTimeout(() => setMessage(null), TOAST_CLEAR_MS);
    }
    return () => clearTimeout(messageToastTimer.current);
  }, [message]);

  // dose-2.76: load listening stats for profile honesty (plays + time)
  useEffect(() => {
    if (!user) {
      setStats(null);
      return undefined;
    }
    let cancelled = false;
    authService.getStats()
      .then((data) => {
        if (!cancelled) setStats(data || null);
      })
      .catch(() => {
        if (!cancelled) setStats(null);
      });
    return () => { cancelled = true; };
  }, [user]);

  // dose-2.81: refreshable platform status (features + health) with timestamp
  const loadStatus = useCallback(async () => {
    setStatusBusy(true);
    setHealthErr(null);
    try {
      const [f, h] = await Promise.all([
        getFeatures(true).catch(() => null),
        getHealth().catch((err) => {
          setHealthErr(err.response?.data?.error || err.message || 'Health check failed');
          return null;
        }),
      ]);
      if (f) setFeatures(f);
      if (h) {
        setHealth(h);
        setHealthErr(null);
      }
      setStatusCheckedAt(new Date());
    } finally {
      setStatusBusy(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const refresh = useCallback(() => {
    if (features && features.privacy === false) {
      setExportInfo(null);
      return;
    }
    privacyService.exportStatus()
      .then((data) => setExportInfo(data.export))
      .catch(() => setExportInfo(null));
  }, [features]);

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
    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword)) {
      setPwMsg({ ok: false, text: 'New password must contain uppercase, lowercase, and a number' });
      return;
    }
    if (newPassword === currentPassword) {
      setPwMsg({ ok: false, text: 'New password must differ from current password' });
      return;
    }
    setPwBusy(true);
    try {
      await authService.changePassword(currentPassword, newPassword);
      setPwMsg({ ok: true, text: 'Password updated' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setShowCurrentPw(false);
      setShowNewPw(false);
      setShowConfirmPw(false);
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
  const memberSinceRaw = user?.created_at || user?.createdAt || null;
  let memberSinceLabel = null;
  if (memberSinceRaw) {
    const d = new Date(memberSinceRaw);
    if (!Number.isNaN(d.getTime())) {
      memberSinceLabel = d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    }
  }

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

  const healthOverall = health?.status === 'ok' ? 'API healthy' : health ? `API ${health.status}` : null;
  const dbStatus = health?.checks?.database?.status;
  const redisStatus = health?.checks?.redis?.status;
  const workerHealthStatus = health?.checks?.worker?.status;

  // dose-2.86: disable Save when profile fields match the loaded user (no-op submit)
  // dose-2.90: also block Save when trimmed display name is empty (server rejects)
  const userDisplay = (user?.display_name || user?.displayName || '').trim();
  const userAvatar = (user?.avatar_url || user?.avatarUrl || '').trim();
  const profileNameTrimmed = (displayName || '').trim();
  const profileDirty =
    profileNameTrimmed !== userDisplay ||
    (avatarUrl || '').trim() !== userAvatar;
  const profileReady = profileDirty && profileNameTrimmed.length > 0;
  // Disable password submit until required fields are present (client-side honesty)
  // dose-2.88: also block when new password equals current (pointless change)
  // dose-2.89: match server complexity (upper + lower + digit) before submit
  const pwSameAsCurrent =
    Boolean(currentPassword) &&
    Boolean(newPassword) &&
    newPassword === currentPassword;
  const pwHasComplexity =
    Boolean(newPassword) && /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(newPassword);
  const passwordReady =
    Boolean(currentPassword) &&
    Boolean(newPassword) &&
    Boolean(confirmPassword) &&
    newPassword === confirmPassword &&
    newPassword.length >= 8 &&
    pwHasComplexity &&
    !pwSameAsCurrent;

  // dose-2.87 / dose-2.88 / dose-2.89: live client hints so mismatch / short /
  // complexity / same-as-current password is visible before submit
  const pwConfirmTyped = confirmPassword.length > 0;
  const pwMismatch = pwConfirmTyped && newPassword !== confirmPassword;
  const pwTooShort = newPassword.length > 0 && newPassword.length < 8;
  const pwWeakComplexity =
    newPassword.length >= 8 && !pwHasComplexity;
  const pwLiveHint = (() => {
    if (pwMismatch) return 'Passwords do not match';
    if (pwTooShort) return 'New password needs at least 8 characters';
    if (pwWeakComplexity) return 'Needs uppercase, lowercase, and a number';
    if (pwSameAsCurrent) return 'New password must differ from current password';
    if (
      pwConfirmTyped &&
      newPassword === confirmPassword &&
      newPassword.length >= 8 &&
      pwHasComplexity
    ) {
      return 'Passwords match';
    }
    return null;
  })();

  return (
    <div className="oly-page">
      <h1>Settings</h1>
      <div className="oly-sub">Account, privacy, and data controls.</div>

      {(features || health || healthErr || statusBusy) && (
        <div className="oly-section" style={{ marginTop: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Platform status</h2>
            <button
              type="button"
              className="oly-btn-ghost"
              onClick={() => loadStatus()}
              disabled={statusBusy}
              title="Re-fetch /api/features and /api/health"
            >
              {statusBusy ? 'Refreshing…' : 'Refresh status'}
            </button>
          </div>
          <p className="muted" style={{ marginBottom: 8 }}>
            Honest runtime signals from the API (no secrets). GDPR export and media pipeline
            jobs need a live worker when those pillars are enabled.
            {statusCheckedAt && (
              <> Last checked {statusCheckedAt.toLocaleTimeString()}.</>
            )}
          </p>
          <div>
            {healthOverall && <span className="oly-reason">{healthOverall}</span>}
            {dbStatus && <span className="oly-reason">DB: {dbStatus}</span>}
            {redisStatus && <span className="oly-reason">Redis: {redisStatus}</span>}
            {workerHealthStatus && (
              <span className="oly-reason">Worker check: {workerHealthStatus}</span>
            )}
            {workerLabel && <span className="oly-reason">{workerLabel}</span>}
            {aiLabel && <span className="oly-reason">{aiLabel}</span>}
            {features?.privacy === false && <span className="oly-reason">Privacy pillar off</span>}
            {features?.media === false && <span className="oly-reason">Media pipeline off</span>}
            {healthErr && <span className="oly-reason">Health: unreachable ({healthErr})</span>}
          </div>
        </div>
      )}

      <div className="oly-section">
        <h2>Profile</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          Username and email are fixed after registration. Change your display name and optional
          avatar image URL (no file upload yet). Saves apply immediately in the sidebar.
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
              {memberSinceLabel && (
                <>
                  <div className="muted" style={{ fontSize: '0.85rem', marginTop: 8 }}>Member since</div>
                  <div>{memberSinceLabel}</div>
                </>
              )}
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
              onChange={(e) => {
                setDisplayName(e.target.value);
                if (profileMsg) setProfileMsg(null);
              }}
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
              onChange={(e) => {
                setAvatarUrl(e.target.value);
                if (profileMsg) setProfileMsg(null);
              }}
              maxLength={500}
              disabled={profileBusy}
              placeholder="https://… (optional; leave blank to clear)"
            />
            <button
              className="oly-btn"
              type="submit"
              disabled={profileBusy || !profileReady}
              title={
                !profileDirty
                  ? 'No changes to save'
                  : !profileNameTrimmed
                    ? 'Display name cannot be empty'
                    : undefined
              }
            >
              {profileBusy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
        {profileMsg && (
          <div
            className={`oly-msg ${profileMsg.ok ? 'ok' : 'err'}`}
            style={{ marginTop: 12 }}
            role="status"
            aria-live="polite"
          >
            {profileMsg.text}
          </div>
        )}
        {stats && (
          <div style={{ marginTop: 16 }}>
            <div className="muted" style={{ fontSize: '0.85rem', marginBottom: 6 }}>Your listening</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <span className="oly-reason">
                {Number(stats.totalPlays) || 0} play{(Number(stats.totalPlays) || 0) === 1 ? '' : 's'}
              </span>
              <span className="oly-reason">
                {(() => {
                  const sec = Number(stats.totalListeningTimeSeconds) || 0;
                  if (sec < 60) return `${sec}s listened`;
                  const m = Math.floor(sec / 60);
                  if (m < 60) return `${m} min listened`;
                  const h = Math.floor(m / 60);
                  const rm = m % 60;
                  return rm ? `${h}h ${rm}m listened` : `${h}h listened`;
                })()}
              </span>
              {Array.isArray(stats.topArtists) && stats.topArtists[0]?.artist && (
                <span className="oly-reason">Top: {stats.topArtists[0].artist}</span>
              )}
            </div>
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
          <div className="oly-row" style={{ marginBottom: 12 }}>
            <input
              className="oly-input"
              type={showCurrentPw ? 'text' : 'password'}
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                if (pwMsg) setPwMsg(null);
              }}
              disabled={pwBusy}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="oly-btn-ghost"
              onClick={() => setShowCurrentPw((v) => !v)}
              disabled={pwBusy}
              aria-label={showCurrentPw ? 'Hide current password' : 'Show current password'}
              title={showCurrentPw ? 'Hide' : 'Show'}
            >
              {showCurrentPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: 4 }}>
            New password
          </label>
          <div className="oly-row" style={{ marginBottom: 12 }}>
            <input
              className="oly-input"
              type={showNewPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value);
                if (pwMsg) setPwMsg(null);
              }}
              disabled={pwBusy}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="oly-btn-ghost"
              onClick={() => setShowNewPw((v) => !v)}
              disabled={pwBusy}
              aria-label={showNewPw ? 'Hide new password' : 'Show new password'}
              title={showNewPw ? 'Hide' : 'Show'}
            >
              {showNewPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <label className="muted" style={{ fontSize: '0.85rem', display: 'block', marginBottom: 4 }}>
            Confirm new password
          </label>
          <div className="oly-row" style={{ marginBottom: 12 }}>
            <input
              className="oly-input"
              type={showConfirmPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value);
                if (pwMsg) setPwMsg(null);
              }}
              disabled={pwBusy}
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="oly-btn-ghost"
              onClick={() => setShowConfirmPw((v) => !v)}
              disabled={pwBusy}
              aria-label={showConfirmPw ? 'Hide confirm password' : 'Show confirm password'}
              title={showConfirmPw ? 'Hide' : 'Show'}
            >
              {showConfirmPw ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="oly-row">
            <button
              className="oly-btn"
              type="submit"
              disabled={pwBusy || !passwordReady}
              title={
                !passwordReady
                  ? pwMismatch
                    ? 'Passwords do not match'
                    : pwTooShort
                      ? 'New password needs at least 8 characters'
                      : pwSameAsCurrent
                        ? 'New password must differ from current password'
                        : pwWeakComplexity
                          ? 'Needs uppercase, lowercase, and a number'
                          : 'Fill current, new (8+ chars with upper/lower/digit), and matching confirm'
                  : undefined
              }
            >
              {pwBusy ? 'Updating…' : 'Update password'}
            </button>
          </div>
          {pwLiveHint && (
            <div
              className={`oly-msg ${pwMismatch || pwTooShort || pwWeakComplexity || pwSameAsCurrent ? 'err' : 'ok'}`}
              style={{ marginTop: 8 }}
              role="status"
              aria-live="polite"
            >
              {pwLiveHint}
            </div>
          )}
        </form>
        {pwMsg && (
          <div
            className={`oly-msg ${pwMsg.ok ? 'ok' : 'err'}`}
            style={{ marginTop: 12 }}
            role="status"
            aria-live="polite"
          >
            {pwMsg.text}
          </div>
        )}
      </div>

      {features?.privacy !== false && (
        <div className="oly-section">
          <h2>Privacy & data</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            Request a GDPR export or account deletion. Export jobs need the background worker
            when FEATURE_WORKER is on.
          </p>
          {message && (
            <div
              className={`oly-msg ${message.ok ? 'ok' : 'err'}`}
              style={{ marginBottom: 12 }}
              role="status"
              aria-live="polite"
            >
              {message.text}
            </div>
          )}
          <div className="oly-row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <button className="oly-btn" type="button" onClick={requestExport} disabled={busy}>
              Request data export
            </button>
            <button className="oly-btn-ghost" type="button" onClick={requestDeletion} disabled={busy}>
              Request account deletion
            </button>
            <button className="oly-btn-ghost" type="button" onClick={cancelDeletion} disabled={busy}>
              Cancel deletion request
            </button>
          </div>
          {exportInfo && (
            <div style={{ marginTop: 12 }} className="muted">
              Export status: {exportInfo.status || 'unknown'}
              {exportInfo.readyAt && <> · ready {new Date(exportInfo.readyAt).toLocaleString()}</>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Settings;
