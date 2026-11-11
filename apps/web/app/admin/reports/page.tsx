'use client';

import { apiFetch } from '../../../lib/api';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type Report = {
  id: string; targetType: string; targetId: string; targetLabel?: string | null; targetSuspendedUntil?: string | null; reason: string; details?: string | null;
  status: string; moderatorNote?: string | null; createdAt: string;
  reporter: { id: string; displayName: string };
  reviewer?: { id: string; displayName: string } | null;
};

export default function AdminReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('NEW');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [suspensionDays, setSuspensionDays] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const response = await apiFetch(API + '/admin/reports?status=' + encodeURIComponent(status));
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to load moderation queue');
    setReports(result);
  }, [status]);

  useEffect(() => {
    setLoading(true);
    load().catch(e => setError(e instanceof Error ? e.message : 'Unable to load moderation queue'))
      .finally(() => setLoading(false));
  }, [load]);


  async function applyAction(report: Report, action: 'HIDE_EPISODE' | 'HIDE_MOMENT' | 'RESTORE_EPISODE' | 'RESTORE_MOMENT') {
    const reason = notes[report.id]?.trim();
    if (!reason) { setError('Enter a moderator note explaining this action first.'); return; }
    if (!window.confirm(action.startsWith('HIDE_') ? 'Hide this reported content?' : 'Restore this content to public availability?')) return;
    setBusy(report.id); setError(''); setNotice('');
    try {
      const response = await apiFetch(API + '/admin/reports/' + report.id + '/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, moderatorNote: reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to apply moderation action');
      setNotice(action.startsWith('HIDE_') ? 'Content hidden and moderation audit record saved.' : 'Content restored and moderation audit record saved.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to apply moderation action');
    } finally { setBusy(''); }
  }

  async function applyAccountAction(report: Report, action: 'WARN_USER' | 'SUSPEND_USER' | 'REINSTATE_USER') {
    const reason = notes[report.id]?.trim();
    if (!reason) { setError('Enter a moderator note explaining this account action first.'); return; }
    const duration = suspensionDays[report.id] ?? 7;
    if (!window.confirm(action === 'WARN_USER' ? 'Issue a formal warning to this account?' : action === 'SUSPEND_USER' ? 'Temporarily suspend this account and revoke its active sessions?' : 'Reinstate this account?')) return;
    setBusy(report.id); setError(''); setNotice('');
    try {
      const response = await apiFetch(API + '/admin/reports/' + report.id + '/actions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, moderatorNote: reason, ...(action === 'SUSPEND_USER' ? { suspensionDays: duration } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to apply account action');
      setNotice(action === 'WARN_USER' ? 'Account warning recorded.' : action === 'SUSPEND_USER' ? (result.liveRoomEnforcement?.failedRoomIds?.length ? `Account suspended and sessions revoked, but LiveKit could not disconnect the account from ${result.liveRoomEnforcement.failedRoomIds.length} live room(s). Check LiveKit connectivity and retry enforcement.` : `Account suspended, active sessions revoked${result.liveRoomEnforcement?.attempted ? `, and disconnected from ${result.liveRoomEnforcement.disconnected} live room(s)` : ''}.`) : 'Account reinstated.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to apply account action');
    } finally { setBusy(''); }
  }

  async function review(report: Report, nextStatus: 'REVIEWING' | 'ACTIONED' | 'DISMISSED') {
    setBusy(report.id); setError(''); setNotice('');
    try {
      const response = await apiFetch(API + '/admin/reports/' + report.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, moderatorNote: notes[report.id]?.trim() || undefined }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to update report');
      setNotice('Report updated and reviewer activity recorded.');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to update report');
    } finally {
      setBusy('');
    }
  }

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/" className="navBack">Back to platform →</Link></nav>
    <section className="communityPage">
      <div className="eyebrow">VOXA TRUST & SAFETY</div>
      <div className="communityHeader"><div><h1>Moderation queue</h1><p>Review user reports, document decisions and keep a clear moderation record.</p></div></div>
      <div className="emptyState" style={{ marginBottom: 20 }}>
        <strong>Review carefully</strong>
        <p>Reports are allegations, not findings. Review the underlying content and relevant context before taking action. Reports never trigger automatic punishment. Authorized moderators can hide reported episodes and Moments after review; each action is recorded.</p>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="NEW">New reports</option>
          <option value="REVIEWING">Under review</option>
          <option value="ACTIONED">Actioned</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
        <button className="ghostButton" onClick={() => { setLoading(true); load().catch(e => setError(e instanceof Error ? e.message : 'Refresh failed')).finally(() => setLoading(false)); }}>Refresh queue</button>
      </div>
      {error && <p className="errorText">{error}</p>}
      {notice && <p className="helperText">{notice}</p>}
      {loading ? <div className="emptyState">Loading reports…</div> : reports.length ? <div className="earningList">
        {reports.map(report => <article className="earningRow" key={report.id} style={{ alignItems: 'flex-start', gap: 18 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <b>{report.targetType.replaceAll('_', ' ')} · {report.reason.replaceAll('_', ' ')}</b>
            <small>Target: {report.targetLabel || report.targetId}</small>{report.targetType === 'USER' && <small>Account ID: {report.targetId}</small>}
            <small>Reported by {report.reporter.displayName} · {new Date(report.createdAt).toLocaleString()}</small>
            {report.details && <p style={{ whiteSpace: 'pre-wrap', marginTop: 10 }}>{report.details}</p>}
            {report.moderatorNote && <small>Previous note: {report.moderatorNote}</small>}
          </div>
          <div style={{ display: 'grid', gap: 8, minWidth: 240, flex: 1 }}>
            <textarea value={notes[report.id] ?? report.moderatorNote ?? ''} onChange={e => setNotes(v => ({ ...v, [report.id]: e.target.value }))} placeholder="Moderator notes (optional)" rows={3} />
            {report.status === 'ACTIONED' && (report.targetType === 'EPISODE' || report.targetType === 'MOMENT') && <button className="ghostButton" disabled={busy === report.id} onClick={() => applyAction(report, report.targetType === 'EPISODE' ? 'RESTORE_EPISODE' : 'RESTORE_MOMENT')}>Restore content</button>}
            {report.targetType === 'USER' && report.status === 'ACTIONED' && report.targetSuspendedUntil && <button className="ghostButton" disabled={busy === report.id} onClick={() => void applyAccountAction(report, 'REINSTATE_USER')}>Reinstate account</button>}
            {report.targetType === 'USER' && report.status !== 'ACTIONED' && report.status !== 'DISMISSED' && <>
              <button className="ghostButton" disabled={busy === report.id} onClick={() => void applyAccountAction(report, 'WARN_USER')}>Issue account warning</button>
              <label style={{fontSize:12}}>Temporary suspension duration</label>
              <select value={suspensionDays[report.id] ?? 7} onChange={e => setSuspensionDays(v => ({...v,[report.id]:Number(e.target.value)}))}>
                <option value={1}>1 day</option><option value={7}>7 days</option><option value={30}>30 days</option>
              </select>
              <button className="primaryButton" disabled={busy === report.id} onClick={() => void applyAccountAction(report, 'SUSPEND_USER')}>Suspend account</button>
            </>}
            {report.status !== 'ACTIONED' && report.status !== 'DISMISSED' && <>
              {report.status === 'NEW' && <button className="ghostButton" disabled={busy === report.id} onClick={() => review(report, 'REVIEWING')}>Mark under review</button>}
              {(report.targetType === 'EPISODE' || report.targetType === 'MOMENT') && <button className="primaryButton" disabled={busy === report.id} onClick={() => applyAction(report, report.targetType === 'EPISODE' ? 'HIDE_EPISODE' : 'HIDE_MOMENT')}>Hide reported content</button>}
              <button className="primaryButton" disabled={busy === report.id} onClick={() => review(report, 'ACTIONED')}>{busy === report.id ? 'Saving…' : 'Mark actioned'}</button>
              <button className="ghostButton" disabled={busy === report.id} onClick={() => review(report, 'DISMISSED')}>Dismiss report</button>
            </>}
            {(report.status === 'ACTIONED' || report.status === 'DISMISSED') && <small>Closed by {report.reviewer?.displayName || 'moderator'} · {report.status}</small>}
          </div>
        </article>)}
      </div> : <div className="emptyState"><h3>No reports in this view</h3><p>New reports will appear here when users flag content or accounts.</p></div>}
    </section>
  </main>;
}
