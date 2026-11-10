'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type Destination = {
  id: string; provider: string; currency: string; country: string; channel: string;
  accountName: string; maskedAccountNumber: string; createdAt: string;
  creator: { handle: string; user: { id: string; email: string; displayName: string } };
};
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
  const [methods, setMethods] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async (accessToken: string) => {
    const headers = { Authorization: 'Bearer ' + accessToken };
    const [destinationResponse, payoutResponse] = await Promise.all([
      fetch(API + '/admin/finance/payout-destinations/pending', { headers }),
      fetch(API + '/admin/finance/payout-requests', { headers }),
    ]);
    const destinationData = await destinationResponse.json();
    const payoutData = await payoutResponse.json();
    if (!destinationResponse.ok) throw new Error(destinationData.message || 'Unable to load payout destinations');
    if (!payoutResponse.ok) throw new Error(payoutData.message || 'Unable to load payout requests');
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

  async function runAction(key: string, url: string, body?: unknown) {
    setBusy(key); setError(''); setNotice('');
    try {
      const response = await fetch(API + url, {
        method: 'PATCH',
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
        <p>Verification actions require documented evidence and are recorded in the audit log. This console does not send money, approve transfers, or mark payouts as paid.</p>
      </div>
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
          </div>
        </article>)}</div> : <div className="emptyState"><p>No payout requests are awaiting review.</p></div>}
      </>}
    </section>
  </main>;
}
