'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

export default function ResetPasswordPage() {
  const [token, setToken] = useState(''); const [password, setPassword] = useState('');
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') || ''); }, []);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { const response = await fetch(API + '/auth/password/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, password }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Reset link is invalid or expired'); setNotice('Your password has been changed. Sign in with your new password.'); }
    catch(e) { setError(e instanceof Error ? e.message : 'Unable to reset password'); } finally { setBusy(false); }
  }
  return <main className="appShell authPage"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/login" className="navBack">Back to sign in</Link></nav><section className="authCard"><div className="eyebrow">ACCOUNT RECOVERY</div><h1>Choose a new password.</h1><p>Reset links expire after 30 minutes and can only be used once.</p><form onSubmit={submit}><label>New password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={10} maxLength={72} required placeholder="At least 10 characters" /><small>Include uppercase, lowercase, and a number.</small>{notice && <p>{notice}</p>}{error && <p className="errorText">{error}</p>}<button className="button full" disabled={busy || !token}>{busy?'Updating…':'Update password ↗'}</button></form></section></main>;
}
