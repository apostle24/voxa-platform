'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

export default function SecuritySettingsPage() {
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function request(path: string, body?: unknown) {
    const token = sessionStorage.getItem('voxa_access_token');
    if (!token) throw new Error('Please sign in again to manage account security.');
    const response = await fetch(API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Security request failed');
    return data;
  }

  async function begin() {
    setBusy(true); setError(''); setNotice('');
    try { const data = await request('/auth/mfa/setup'); setSetup(data); setNotice('Add this account to your authenticator app, then enter the current six-digit code to enable MFA.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to begin MFA setup'); }
    finally { setBusy(false); }
  }

  async function enable(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { const data = await request('/auth/mfa/enable', { token: code }); setBackupCodes(data.backupCodes || []); setSetup(null); setCode(''); setNotice('MFA is enabled. Save each backup code somewhere secure; each code works once.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to enable MFA'); }
    finally { setBusy(false); }
  }

  async function disable(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('');
    try { await request('/auth/mfa/disable', { token: code }); setCode(''); setBackupCodes([]); setNotice('MFA has been disabled.'); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to disable MFA'); }
    finally { setBusy(false); }
  }

  return <main className="appShell authPage">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/live" className="navBack">Back to VOXA</Link></nav>
    <section className="authCard">
      <div className="eyebrow">ACCOUNT SECURITY</div><h1>Two-step verification.</h1>
      <p>Use an authenticator app to protect sign-ins. Your secret is encrypted before it is stored.</p>
      {!setup && <button className="button full" disabled={busy} onClick={begin}>Set up authenticator app ↗</button>}
      {setup && <><label>Manual setup key</label><p>{setup.secret}</p><p>Or open this authenticator URI in a compatible app:</p><p className="smallText">{setup.otpauthUrl}</p><form onSubmit={enable}><label>Authenticator code</label><input value={code} onChange={e=>setCode(e.target.value)} minLength={6} maxLength={6} required inputMode="numeric" autoComplete="one-time-code" /><button className="button full" disabled={busy}>Verify and enable MFA</button></form></>}
      {backupCodes.length > 0 && <><h2>Backup codes</h2><p>Each code can be used once. They will not be shown again.</p><ul>{backupCodes.map(item=><li key={item}><code>{item}</code></li>)}</ul><button className="button" onClick={()=>navigator.clipboard.writeText(backupCodes.join('\n'))}>Copy backup codes</button></>}
      <form onSubmit={disable}><label>Disable MFA with authenticator or backup code</label><input value={code} onChange={e=>setCode(e.target.value)} minLength={6} maxLength={20} placeholder="Enter current code" /><button className="button full" disabled={busy || !code}>Disable MFA</button></form>
      {notice && <p>{notice}</p>}{error && <p className="errorText">{error}</p>}
    </section>
  </main>;
}
