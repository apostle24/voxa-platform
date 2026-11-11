'use client';

import { apiFetch } from '../../../lib/api';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type AccountSession = { id: string; createdAt: string; lastUsedAt?: string | null; expiresAt: string };

type AccountProfile = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  createdAt: string;
  creator?: { handle: string } | null;
};

export default function ProfileSettingsPage() {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [revokingSessionId, setRevokingSessionId] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function loadProfile() {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) {
      setError('Sign in to manage your account profile.');
      setLoading(false);
      return;
    }
    try {
      const response = await apiFetch(API + '/auth/me', { headers: { Authorization: 'Bearer ' + token } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load account profile');
      setProfile(data);
      setDisplayName(data.displayName || '');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load account profile');
    } finally {
      setLoading(false);
    }
  }

  async function loadSessions() {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) { setLoadingSessions(false); return; }
    setLoadingSessions(true);
    try {
      const response = await apiFetch(API + '/auth/sessions', { headers: { Authorization: 'Bearer ' + token } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load active sessions');
      setSessions(Array.isArray(data) ? data : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load active sessions');
    } finally { setLoadingSessions(false); }
  }

  async function revokeSession(sessionId: string) {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setRevokingSessionId(sessionId); setError(''); setMessage('');
    try {
      const response = await apiFetch(API + '/auth/sessions/' + encodeURIComponent(sessionId), {
        method: 'DELETE', headers: { Authorization: 'Bearer ' + token },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to revoke session');
      setSessions(current => current.filter(session => session.id !== sessionId));
      setMessage('The selected session has been signed out.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to revoke session');
    } finally { setRevokingSessionId(''); }
  }

  useEffect(() => { void loadProfile(); }, []);
  useEffect(() => { void loadSessions(); }, []);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const response = await apiFetch(API + '/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ displayName }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to save account profile');
      setProfile(current => current ? { ...current, ...data } : current);
      setDisplayName(data.displayName);
      setMessage('Your account name has been updated.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save account profile');
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) { setError('The new passwords do not match.'); return; }
    if (newPassword.length < 12) { setError('Use at least 12 characters for your new password.'); return; }
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setChangingPassword(true); setError(''); setMessage('');
    try {
      const response = await apiFetch(API + '/auth/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to change password');
      sessionStorage.removeItem('voxa_access_token');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      window.location.assign('/login?passwordChanged=1');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change password');
      setChangingPassword(false);
    }
  }

  async function signOutEverywhere() {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) { window.location.assign('/login'); return; }
    setSigningOut(true);
    setError('');
    try {
      const response = await apiFetch(API + '/auth/logout-all', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Unable to sign out all sessions');
      }
      sessionStorage.removeItem('voxa_access_token');
      window.location.assign('/login');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to sign out all sessions');
      setSigningOut(false);
    }
  }

  return (
    <main className="appShell">
      <nav className="nav">
        <Link className="brand" href="/">VOXA<span>.</span></Link>
        <div className="navLinks"><Link href="/library">Your library</Link><Link href="/discover">Discover</Link></div>
      </nav>
      <section className="communityPage" style={{ maxWidth: 760 }}>
        <div className="eyebrow">ACCOUNT SETTINGS</div>
        <h1 style={{ fontSize: 'clamp(34px,5vw,52px)', letterSpacing: -2, margin: '12px 0' }}>Your profile.</h1>
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>Manage the name and account details shown across VOXA.</p>
        {loading && <p style={{ padding: 24, color: 'var(--muted)' }}>Loading account details…</p>}
        {!loading && error && <p className="errorText">{error}</p>}
        {!loading && !profile && <div className="emptyState"><Link className="button small" href="/login">Sign in</Link></div>}
        {profile && <>
          <form onSubmit={saveProfile} className="membershipCard" style={{ marginTop: 28, display: 'grid', gap: 14 }}>
            <label htmlFor="account-display-name">Display name</label>
            <input id="account-display-name" value={displayName} onChange={event => setDisplayName(event.target.value)} minLength={2} maxLength={80} required />
            <label>Email address</label>
            <input value={profile.email} readOnly aria-readonly="true" />
            <label>Account type</label>
            <input value={profile.role.toLowerCase()} readOnly aria-readonly="true" />
            {profile.creator?.handle && <p>Your creator page: <Link className="textLink" href={'/creator/' + encodeURIComponent(profile.creator.handle)}>@{profile.creator.handle}</Link></p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button className="button small" disabled={saving || displayName.trim().length < 2}>{saving ? 'Saving…' : 'Save changes'}</button>
            </div>
          </form>
          {message && <p role="status" style={{ color: 'var(--success, #23865b)', marginTop: 12 }}>{message}</p>}
          <section className="membershipCard" style={{ marginTop: 22 }}>
            <h2 style={{ marginTop: 0 }}>Active sessions</h2>
            <p style={{ color: 'var(--muted)' }}>Review active sign-ins and revoke sessions you no longer recognize. VOXA currently records session times, not device names or locations.</p>
            {loadingSessions ? <p style={{ color: 'var(--muted)' }}>Loading sessions…</p> : sessions.length === 0 ? <p style={{ color: 'var(--muted)' }}>No active refresh sessions found.</p> : <div style={{ display: 'grid', gap: 10 }}>
              {sessions.map(session => <div key={session.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                <div>
                  <b style={{ fontSize: 13 }}>Sign-in session</b>
                  <small style={{ display: 'block', color: 'var(--muted)', marginTop: 4 }}>Started {new Date(session.createdAt).toLocaleString()}</small>
                  <small style={{ display: 'block', color: 'var(--muted)' }}>Last used {session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleString() : 'Not recorded'} · Expires {new Date(session.expiresAt).toLocaleDateString()}</small>
                </div>
                <button className="ghostButton" disabled={revokingSessionId === session.id} onClick={() => void revokeSession(session.id)}>{revokingSessionId === session.id ? 'Signing out…' : 'Revoke session'}</button>
              </div>)}
            </div>}
            <button className="ghostButton" style={{ marginTop: 12 }} disabled={loadingSessions} onClick={() => void loadSessions()}>Refresh sessions</button>
          </section>
          <section className="membershipCard" style={{ marginTop: 22 }}>
            <h2 style={{ marginTop: 0 }}>Change password</h2>
            <p style={{ color: 'var(--muted)' }}>Confirm your current password and choose a new password with at least 12 characters. Changing it signs out all active sessions.</p>
            <form onSubmit={changePassword} style={{ display: 'grid', gap: 12 }}>
              <label htmlFor="current-password">Current password</label>
              <input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} required maxLength={128} />
              <label htmlFor="new-password">New password</label>
              <input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} required minLength={12} maxLength={128} />
              <label htmlFor="confirm-new-password">Confirm new password</label>
              <input id="confirm-new-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} required minLength={12} maxLength={128} />
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button className="button small" disabled={changingPassword || !currentPassword || newPassword.length < 12 || newPassword !== confirmPassword}>{changingPassword ? 'Changing password…' : 'Change password'}</button>
              </div>
            </form>
          </section>
          <section className="membershipCard" style={{ marginTop: 22 }}>
            <h2 style={{ marginTop: 0 }}>Security</h2>
            <p style={{ color: 'var(--muted)' }}>Sign out this account from all active devices and browsers. You will need to sign in again.</p>
            <button className="ghostButton" disabled={signingOut} onClick={() => void signOutEverywhere()}>{signingOut ? 'Signing out…' : 'Sign out all sessions'}</button>
          </section>
        </>}
      </section>
    </main>
  );
}
