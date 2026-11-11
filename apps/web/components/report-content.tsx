'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/[/]$/, '');
const REASONS = [
  ['HARASSMENT', 'Harassment or bullying'],
  ['HATE', 'Hateful content'],
  ['VIOLENCE', 'Violence or threats'],
  ['SEXUAL_CONTENT', 'Sexual content'],
  ['SPAM', 'Spam or misleading content'],
  ['COPYRIGHT', 'Copyright concern'],
  ['SELF_HARM', 'Self-harm concern'],
  ['OTHER', 'Something else'],
] as const;

export function ReportContent({ targetType, targetId }: { targetType: 'EPISODE' | 'MOMENT' | 'LIVE_ROOM'; targetId: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>('OTHER');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit() {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('voxa_access_token') : null;
    if (!token) { setMessage('Sign in before submitting a report.'); return; }
    setBusy(true); setMessage('');
    try {
      const response = await apiFetch(API + '/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ targetType, targetId, reason, ...(details.trim() ? { details: details.trim() } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to submit report');
      setMessage('Thank you. Your report has been sent to the moderation team.');
      setDetails('');
      setOpen(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to submit report');
    } finally { setBusy(false); }
  }

  return <div style={{ marginTop: 12 }}>
    <button type="button" className="ghostButton" onClick={() => { setOpen(value => !value); setMessage(''); }} aria-expanded={open}>⚑ Report</button>
    {open && <div style={{ display: 'grid', gap: 9, marginTop: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 10 }}>
      <label style={{ fontSize: 12 }}>Why are you reporting this?</label>
      <select value={reason} onChange={event => setReason(event.target.value as typeof reason)} style={{ padding: 10, borderRadius: 8, background: 'var(--surface)', color: 'inherit', border: '1px solid var(--line)' }}>
        {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <textarea value={details} onChange={event => setDetails(event.target.value)} maxLength={1000} rows={3} placeholder="Add details (optional)" style={{ width: '100%', padding: 10, borderRadius: 8, resize: 'vertical', background: 'var(--surface)', color: 'inherit', border: '1px solid var(--line)', font: 'inherit' }} />
      <button type="button" className="button small" disabled={busy} onClick={() => void submit()}>{busy ? 'Sending…' : 'Submit report'}</button>
    </div>}
    {message && <p role="status" style={{ color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>{message}</p>}
  </div>;
}
