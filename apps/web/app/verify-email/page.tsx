'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\\/$/, '');

export default function VerifyEmailPage() {
  const [token, setToken] = useState(''); const [email, setEmail] = useState('');
  const [notice, setNotice] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { const value = new URLSearchParams(window.location.search).get('token') || ''; setToken(value); if (value) { fetch(API + '/auth/verification/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: value }) }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Verification link is invalid or expired'); setNotice('Your email address is verified.'); }).catch(e => setError(e instanceof Error ? e.message : 'Unable to verify email')); } }, []);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); setNotice(''); try { const response = await fetch(API + '/auth/verification/request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) }); const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Unable to send verification link'); setNotice('If the address belongs to an unverified VOXA account, a verification link will be sent.'); } catch(e) { setError(e instanceof Error ? e.message : 'Unable to send verification link'); } finally { setBusy(false); } }
  return <main className="appShell authPage"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/login" className="navBack">Back to sign in</Link></nav><section className="authCard"><div className="eyebrow">EMAIL VERIFICATION</div><h1>Verify your email.</h1><p>Confirm your email address to help secure your VOXA account.</p>{!token && <form onSubmit={submit}><label>Email address</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@example.com" /><button className="button full" disabled={busy}>{busy?'Sending…':'Send verification link ↗'}</button></form>}{notice && <p>{notice}</p>}{error && <p className="errorText">{error}</p>}</section></main>;
}
