'use client';

import { apiFetch } from '../../../lib/api';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

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

  useEffect(() => { void loadProfile(); }, []);

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
            <h2 style={{ marginTop: 0 }}>Security</h2>
            <p style={{ color: 'var(--muted)' }}>Sign out this account from all active devices and browsers. You will need to sign in again.</p>
            <button className="ghostButton" disabled={signingOut} onClick={() => void signOutEverywhere()}>{signingOut ? 'Signing out…' : 'Sign out all sessions'}</button>
          </section>
        </>}
      </section>
    </main>
  );
}
