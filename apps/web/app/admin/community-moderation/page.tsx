'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type Report = { id: string; targetType: string; targetId: string; reason: string; details?: string | null; status: string; moderatorNote?: string | null; createdAt: string; targetLabel?: string | null; reporter: { displayName: string } };

export default function CommunityModerationPage() {
  const [token, setToken] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('NEW');
  const [reports, setReports] = useState<Report[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function request(path: string, init: RequestInit = {}) {
    const response = await apiFetch(API + path, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + token, ...init.headers } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'Moderation action failed');
    return data;
  }
  async function load(nextStatus = status) {
    const data = await request('/admin/reports?status=' + nextStatus);
    setReports((data || []).filter((item: Report) => item.targetType === 'COMMUNITY_POST'));
  }
  useEffect(() => {
    const access = sessionStorage.getItem('voxa_access_token') || '';
    let account: any = null;
    try { account = JSON.parse(sessionStorage.getItem('voxa_user') || 'null'); } catch {}
    setToken(access); setRole(account?.role || '');
  }, []);
  useEffect(() => {
    if (!token || !['ADMIN', 'MODERATOR'].includes(role)) return;
    void load().catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load moderation queue'));
  }, [token, role, status]);

  async function act(report: Report, action: 'HIDE_COMMUNITY_POST' | 'RESTORE_COMMUNITY_POST' | 'DISMISS') {
    const note = (notes[report.id] || '').trim();
    if (!note) { setError('Add a moderator note before taking action.'); return; }
    setBusy(report.id); setError(''); setNotice('');
    try {
      if (action === 'DISMISS') {
        await request('/admin/reports/' + report.id, { method: 'PATCH', body: JSON.stringify({ status: 'DISMISSED', moderatorNote: note }) });
      } else {
        if (report.status === 'NEW') await request('/admin/reports/' + report.id, { method: 'PATCH', body: JSON.stringify({ status: 'REVIEWING', moderatorNote: note }) });
        await request('/admin/reports/' + report.id + '/actions', { method: 'POST', body: JSON.stringify({ action, moderatorNote: note }) });
      }
      setNotice(action === 'HIDE_COMMUNITY_POST' ? 'Reported post hidden.' : action === 'RESTORE_COMMUNITY_POST' ? 'Post restored.' : 'Report dismissed.');
      await load();
    } catch(reason) { setError(reason instanceof Error ? reason.message : 'Unable to apply moderation action'); }
    finally { setBusy(''); }
  }

  if (!token || !['ADMIN', 'MODERATOR'].includes(role)) return <main className="appShell"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link></nav><section className="communityPage"><div className="emptyState"><h2>Moderator access required</h2><p>This workspace is available only to authorized VOXA moderators and administrators.</p><Link className="button small" href="/login">Sign in</Link></div></section></main>;

  return <main className="appShell"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/communities">Communities</Link><Link href="/creator/studio">Creator Studio</Link></div></nav>
    <section className="communityPage" style={{ maxWidth: 1000 }}>
      <div className="eyebrow">TRUST & SAFETY</div><h1>Community moderation</h1><p style={{ color: 'var(--muted)' }}>Review reported community posts, hide harmful content, dismiss reports or restore previously hidden posts.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '20px 0' }}>
        {['NEW', 'REVIEWING', 'ACTIONED'].map(value => <button key={value} className={status === value ? 'button small' : 'ghostButton'} onClick={() => setStatus(value)}>{value}</button>)}
      </div>
      {error && <p className="errorText" role="alert">{error}</p>}{notice && <p className="successText" role="status">{notice}</p>}
      {!reports.length ? <div className="emptyState"><p>No community-post reports in this queue.</p></div> : reports.map(report => <article className="creatorShowCard" key={report.id} style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><strong>{report.targetLabel || 'Community post'}</strong><small>{report.status} · {new Date(report.createdAt).toLocaleString()}</small></div>
        <p>Reason: {report.reason} · Reported by {report.reporter?.displayName || 'VOXA member'}</p>
        {report.details && <p>{report.details}</p>}
        <textarea rows={2} maxLength={1000} value={notes[report.id] ?? report.moderatorNote ?? ''} onChange={event => setNotes(current => ({ ...current, [report.id]: event.target.value }))} placeholder="Moderator note (required)" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          {status !== 'ACTIONED' && <><button className="button small" disabled={busy === report.id} onClick={() => void act(report, 'HIDE_COMMUNITY_POST')}>{busy === report.id ? 'Working…' : 'Hide post'}</button><button className="ghostButton" disabled={busy === report.id} onClick={() => void act(report, 'DISMISS')}>Dismiss report</button></>}
          {status === 'ACTIONED' && <button className="button small" disabled={busy === report.id} onClick={() => void act(report, 'RESTORE_COMMUNITY_POST')}>{busy === report.id ? 'Working…' : 'Restore post'}</button>}
        </div>
      </article>)}
    </section>
  </main>;
}
