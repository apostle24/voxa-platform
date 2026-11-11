'use client';

import Link from 'next/link';
import { useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

export default function LoginPage() {
  const [mode, setMode] = useState<'login'|'register'>('login');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(API + '/auth/' + mode, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'register' ? { displayName, email, password } : { email, password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Authentication failed');
      if (mode === 'register' && data.verificationRequired) {
        setNotice('Your account has been created. Check your email for a verification link before signing in. If it does not arrive, use the Verify email link below to request another.');
        setMode('login');
        setPassword('');
        return;
      }
      sessionStorage.setItem('voxa_access_token', data.accessToken);
      sessionStorage.setItem('voxa_user', JSON.stringify(data.user));
      window.location.href = '/live';
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to sign in'); }
    finally { setBusy(false); }
  }

  return <main className="appShell authPage">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/live" className="navBack">Explore LIVE →</Link></nav>
    <section className="authCard">
      <div className="eyebrow">YOUR VOICE HAS A PLACE</div>
      <h1>{mode === 'login' ? 'Welcome back.' : 'Join the conversation.'}</h1>
      <p>Sign in to listen, host, and connect with the VOXA community.</p>
      <div className="authTabs"><button className={mode==='login'?'selected':''} onClick={()=>setMode('login')}>Sign in</button><button className={mode==='register'?'selected':''} onClick={()=>setMode('register')}>Create account</button></div>
      <form onSubmit={submit}>
        {mode==='register' && <><label>Your name</label><input value={displayName} onChange={e=>setDisplayName(e.target.value)} minLength={2} maxLength={60} required placeholder="How should we call you?" /></>}
        <label>Email address</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@example.com" />
        <label>Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={mode==='register'?10:1} maxLength={72} placeholder={mode==='register'?'At least 10 characters':'Your password'} />
        {mode==='register' && <small>Use at least 10 characters, including uppercase, lowercase, and a number.</small>}
        {mode === 'login' && <p><Link href="/forgot-password">Forgot password?</Link> · <Link href="/verify-email">Verify email</Link></p>}
        {notice && <p>{notice}</p>}{error && <p className="errorText">{error}</p>}
        <button className="button full" disabled={busy}>{busy?'Please wait…':mode==='login'?'Sign in to VOXA ↗':'Create my account ↗'}</button>
      </form>
      <small>Your access token stays in this browser tab. Your refresh session is protected in an HttpOnly cookie and rotates automatically when needed.</small>
    </section>
  </main>;
}
