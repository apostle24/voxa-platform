'use client';

import { apiFetch } from '../../../lib/api';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type Destination = {
  id: string; provider: string; currency: string; country: string; channel: string;
  accountName: string; maskedAccountNumber: string; createdAt: string;
  creator: { handle: string; user: { id: string; email: string; displayName: string } };
};
type FinanceCurrency = { currency: string; collectionsGrossMinor: number; platformCommissionMinor: number; creatorPendingMinor: number; creatorAvailableMinor: number; payoutHoldsMinor: number; creatorLiabilitiesMinor: number; providerFeeExpenseMinor: number; platformClearingBalanceMinor: number; paidMembershipCount: number; payouts: { status: string; amountMinor: number; count: number }[] };
type FinanceOverview = { generatedAt: string; balances: FinanceCurrency[]; recentLedgerTransactions: { id: string; type: string; currency: string; amountMinor: number; reference: string | null; createdAt: string; entries: { direction: string; amountMinor: number; account: { type: string } }[] }[]; recentAuditEvents: { id: string; actorUserId: string; action: string; entityType: string; entityId: string; createdAt: string }[] };
type Payout = {
  id: string; reference: string; amountMinor: number; currency: string; status: string; requestedAt: string;
  creator: { handle: string; user: { email: string; displayName: string } };
  destination: { id: string; provider: string; channel: string; accountName: string; maskedAccountNumber: string; isVerified: boolean };
};

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountMinor / 100);
}

export default function AdminFinancePage() {
  const [token, setToken] = useState('');
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [overview, setOverview] = useState<FinanceOverview | null>(null);
  const [methods, setMethods] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [approvalReasons, setApprovalReasons] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async (accessToken: string) => {
    const headers = { Authorization: 'Bearer ' + accessToken };
    const [overviewResponse, destinationResponse, payoutResponse] = await Promise.all([
      apiFetch(API + '/admin/finance/overview', { headers }),
      apiFetch(API + '/admin/finance/payout-destinations/pending', { headers }),
      apiFetch(API + '/admin/finance/payout-requests', { headers }),
    ]);
    const overviewData = await overviewResponse.json();
    const destinationData = await destinationResponse.json();
    const payoutData = await payoutResponse.json();
    if (!overviewResponse.ok) throw new Error(overviewData.message || 'Unable to load financial overview');
    if (!destinationResponse.ok) throw new Error(destinationData.message || 'Unable to load payout destinations');
    if (!payoutResponse.ok) throw new Error(payoutData.message || 'Unable to load payout requests');
    setOverview(overviewData);
    setDestinations(destinationData);
    setPayouts(payoutData);
  }, []);

  useEffect(() => {
    const accessToken = sessionStorage.getItem('voxa_access_token') || '';
    setToken(accessToken);
    if (!accessToken) {
      setError('Sign in with an administrator account to access financial operations.');
      setLoading(false);
      return;
    }
    load(accessToken).catch(e => setError(e instanceof Error ? e.message : 'Unable to load finance queue'))
      .finally(() => setLoading(false));
  }, [load]);

  async function runAction(key: string, url: string, body?: unknown, method = 'PATCH') {
    setBusy(key); setError(''); setNotice('');
    try {
      const response = await apiFetch(API + url, {
        method,
        headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Action could not be completed');
      setNotice('Action recorded. Financial audit log updated.');
      await load(token);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action could not be completed');
    } finally {
      setBusy('');
    }
  }

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/" className="navBack">Back to platform →</Link></nav>
    <section className="communityPage">
      <div className="eyebrow">VOXA ADMINISTRATION</div>
      <div className="communityHeader"><div><h1>Financial operations</h1><p>Review payout destinations and creator withdrawal requests.</p></div></div>
      <div className="emptyState" style={{ marginBottom: 24 }}>
        <strong>Safety boundary</strong>
        <p>Verification actions require documented evidence and are recorded in the audit log. Approval is audited. Transfer submission is separately gated by server flags. Only independently verified Paystack webhook results can mark a payout paid.</p>
      </div>
      {overview && <section style={{ marginBottom: 32 }}>
        <div className="sectionTitle"><div><div className="eyebrow">LEDGER-BASED CONTROL ROOM</div><h2>Financial overview</h2><p>Live figures calculated from posted ledger entries and verified payment records. Updated {new Date(overview.generatedAt).toLocaleString()}.</p></div></div>
        {overview.balances.length ? overview.balances.map(item => <div key={item.currency} style={{ marginBottom: 24 }}>
          <h3 style={{ marginBottom: 12 }}>{item.currency} position</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            {[
              ['Gross collections', money(item.collectionsGrossMinor, item.currency)],
              ['VOXA commission', money(item.platformCommissionMinor, item.currency)],
              ['Creator pending', money(item.creatorPendingMinor, item.currency)],
              ['Creator available', money(item.creatorAvailableMinor, item.currency)],
              ['Payout holds', money(item.payoutHoldsMinor, item.currency)],
              ['Total creator liabilities', money(item.creatorLiabilitiesMinor, item.currency)],
              ['Provider fee expense', money(item.providerFeeExpenseMinor, item.currency)],
              ['Platform clearing balance', money(item.platformClearingBalanceMinor, item.currency)],
            ].map(([label, value]) => <article key={label} className="emptyState" style={{ padding: 16, margin: 0 }}>
              <small style={{ display: 'block', opacity: .75 }}>{label}</small><strong style={{ display: 'block', fontSize: 21, marginTop: 8 }}>{value}</strong>
            </article>)}
          </div>
          <p className="helperText" style={{ marginTop: 10 }}>{item.paidMembershipCount} successful membership payments recorded. Creator liabilities include pending earnings, available earnings and funds reserved for payout. Provider fees are tracked as VOXA expenses and are not deducted from creator earnings.</p>
          <div className="earningList">{item.payouts.length ? item.payouts.map(p => <div className="earningRow" key={p.status}><div><b>{p.status.replaceAll('_', ' ')}</b><small>{p.count} payout request(s)</small></div><strong>{money(p.amountMinor, item.currency)}</strong></div>) : <div className="emptyState">No payout activity recorded in {item.currency}.</div>}</div>
        </div>) : <div className="emptyState">No ledger activity yet. Financial totals will appear after the first posted transaction.</div>}
        <div className="sectionTitle"><div><div className="eyebrow">ACCOUNTING TRAIL</div><h2>Recent ledger activity</h2></div></div>
        {overview.recentLedgerTransactions.length ? <div className="earningList">{overview.recentLedgerTransactions.map(tx => <article className="earningRow" key={tx.id}>
          <div style={{ flex: 1 }}><b>{tx.type.replaceAll('_', ' ')}</b><small>{tx.reference || tx.id} · {new Date(tx.createdAt).toLocaleString()}</small><small>{tx.entries.map(e => e.direction + ' ' + money(e.amountMinor, tx.currency) + ' · ' + e.account.type.replaceAll('_', ' ')).join(' | ')}</small></div>
          <strong>{money(tx.amountMinor, tx.currency)}</strong>
        </article>)}</div> : <div className="emptyState">No ledger transactions yet.</div>}
        <div className="sectionTitle"><div><div className="eyebrow">ADMIN AUDIT</div><h2>Recent financial actions</h2></div></div>
        {overview.recentAuditEvents.length ? <div className="earningList">{overview.recentAuditEvents.map(event => <article className="earningRow" key={event.id}>
          <div><b>{event.action.replaceAll('_', ' ')}</b><small>{event.entityType} · {event.entityId}</small></div><small>{new Date(event.createdAt).toLocaleString()}</small>
        </article>)}</div> : <div className="emptyState">No financial audit events recorded yet.</div>}
      </section>}
      {error && <p className="errorText">{error}</p>}
      {notice && <p className="helperText">{notice}</p>}
      {loading ? <div className="emptyState">Loading finance queues…</div> : <>
        <div className="sectionTitle"><div><div className="eyebrow">IDENTITY / DESTINATION REVIEW</div><h2>Unverified payout destinations</h2></div></div>
        {destinations.length ? <div className="earningList">{destinations.map(item => <article className="earningRow" key={item.id} style={{ alignItems: 'flex-start', gap: 20 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <b>{item.creator.user.displayName} · @{item.creator.handle}</b>
            <small>{item.creator.user.email}</small>
            <small>{item.provider} · {item.country} · {item.currency} · {item.channel.replaceAll('_', ' ')}</small>
            <small>{item.accountName} · {item.maskedAccountNumber}</small>
            <small>Submitted {new Date(item.createdAt).toLocaleString()}</small>
          </div>
          <div style={{ display: 'grid', gap: 8, minWidth: 260, flex: 1 }}>
            <select value={methods[item.id] || 'PROVIDER_CONFIRMATION'} onChange={e => setMethods(v => ({ ...v, [item.id]: e.target.value }))}>
              <option value="PROVIDER_CONFIRMATION">Provider confirmation</option>
              <option value="MICRO_DEPOSIT">Micro-deposit check</option>
              <option value="MANUAL_DOCUMENT_REVIEW">Manual document review</option>
              <option value="CALLBACK_VERIFICATION">Callback verification</option>
            </select>
            <input value={references[item.id] || ''} onChange={e => setReferences(v => ({ ...v, [item.id]: e.target.value }))} placeholder="Evidence reference (required)" />
            <input value={notes[item.id] || ''} onChange={e => setNotes(v => ({ ...v, [item.id]: e.target.value }))} placeholder="Review notes (optional)" />
            <button className="primaryButton" disabled={busy === item.id || (references[item.id] || '').trim().length < 6} onClick={() => runAction(item.id, '/admin/finance/payout-destinations/' + item.id + '/verify', { verificationMethod: methods[item.id] || 'PROVIDER_CONFIRMATION', verificationReference: references[item.id].trim(), notes: notes[item.id]?.trim() || undefined })}>
              {busy === item.id ? 'Saving…' : 'Verify destination'}
            </button>
          </div>
        </article>)}</div> : <div className="emptyState"><p>No unverified payout destinations in the queue.</p></div>}

        <div className="sectionTitle"><div><div className="eyebrow">CREATOR PAYOUTS</div><h2>Requests awaiting review</h2></div></div>
        {payouts.length ? <div className="earningList">{payouts.map(item => <article className="earningRow" key={item.id}>
          <div style={{ flex: 1 }}>
            <b>{item.creator.user.displayName} · @{item.creator.handle}</b>
            <small>{item.creator.user.email} · {item.reference}</small>
            <small>{item.destination.channel.replaceAll('_', ' ')} · {item.destination.accountName} · {item.destination.maskedAccountNumber} · {item.destination.isVerified ? 'Verified destination' : 'Not verified'}</small>
            <small>Requested {new Date(item.requestedAt).toLocaleString()}</small>
          </div>
          <div style={{ textAlign: 'right' }}>
            <b>{money(item.amountMinor, item.currency)}</b>
            <small>{item.status.replaceAll('_', ' ')}</small>
            {item.status === 'REQUESTED' && <button className="ghostButton" disabled={busy === item.id || !item.destination.isVerified} onClick={() => runAction(item.id, '/admin/finance/payout-requests/' + item.id + '/review')}>
              {busy === item.id ? 'Saving…' : 'Move to review'}
            </button>}
            {item.status === 'UNDER_REVIEW' && <div style={{ display: 'grid', gap: 8, minWidth: 230 }}>
              <input value={approvalReasons[item.id] || ''} onChange={e => setApprovalReasons(v => ({ ...v, [item.id]: e.target.value }))} placeholder="Approval reason (required)" />
              <button className="primaryButton" disabled={busy === item.id || (approvalReasons[item.id] || '').trim().length < 6} onClick={() => runAction(item.id, '/admin/finance/payout-requests/' + item.id + '/approve', { reason: approvalReasons[item.id].trim() })}>Approve payout</button>
            </div>}
            {item.status === 'APPROVED' && <button className="ghostButton" disabled={busy === item.id} onClick={() => runAction(item.id, '/admin/finance/payout-requests/' + item.id + '/submit', undefined, 'POST')}>Submit transfer (feature-gated)</button>}
            {(item.status === 'SUBMITTED' || item.status === 'PROCESSING') && <div style={{ display: 'grid', gap: 6 }}><small>Awaiting Paystack confirmation. Do not resubmit.</small><button className="ghostButton" disabled={busy === item.id} onClick={() => runAction(item.id, '/admin/finance/payout-requests/' + item.id + '/reconcile', undefined, 'POST')}>Check provider status</button></div>}
          </div>
        </article>)}</div> : <div className="emptyState"><p>No payout requests are awaiting review.</p></div>}
      </>}
    </section>
  </main>;
}
