'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch(API + '/auth/password/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to process request');
      setNotice('If an account exists for that address, a password reset link will be sent.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to process request'); }
    finally { setBusy(false); }
  }
  return <main className="appShell authPage"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/login" className="navBack">Back to sign in</Link></nav><section className="authCard"><div className="eyebrow">ACCOUNT RECOVERY</div><h1>Reset your password.</h1><p>Enter the email address connected to your VOXA account.</p><form onSubmit={submit}><label>Email address</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@example.com" />{notice && <p>{notice}</p>}{error && <p className="errorText">{error}</p>}<button className="button full" disabled={busy}>{busy?'Sending…':'Send reset link ↗'}</button></form></section></main>;
}
