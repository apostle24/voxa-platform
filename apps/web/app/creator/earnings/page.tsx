'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type Balance = { type: 'CREATOR_PENDING' | 'CREATOR_AVAILABLE'; currency: string; balanceMinor: number };
type Transaction = { id: string; type: string; currency: string; amountMinor: number; creatorAmountMinor: number; reference?: string | null; createdAt: string; entries: { direction: string; amountMinor: number }[] };
type Earnings = { balances: Balance[]; transactions: Transaction[] };
type PayoutRequest = { id: string; reference: string; amountMinor: number; currency: string; status: string; requestedAt: string; paidAt?: string | null; destination: { accountName: string; maskedAccountNumber: string; channel: string } };

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amountMinor / 100);
}

export default function CreatorEarningsPage() {
  const [data, setData] = useState<Earnings>({ balances: [], transactions: [] });
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = sessionStorage.getItem('voxa_access_token');
      if (!token) { setError('Sign in to view creator earnings.'); setLoading(false); return; }
      try {
        const response = await fetch(API + '/creators/me/earnings', { headers: { Authorization: 'Bearer ' + token } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Unable to load earnings');
        setData(result);
        const payoutResponse = await fetch(API + '/creators/me/payout-requests', { headers: { Authorization: 'Bearer ' + token } });
        if (payoutResponse.ok) setPayouts(await payoutResponse.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unable to load earnings');
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/live" className="navBack">Explore LIVE →</Link></nav>
    <section className="communityPage">
      <div className="eyebrow">CREATOR STUDIO</div>
      <div className="communityHeader"><div><h1>Earnings</h1><p>Membership income recorded in your VOXA ledger.</p></div><Link href="/" className="ghostButton">Back to VOXA</Link></div>
      {error && <p className="errorText">{error}</p>}
      {loading ? <div className="emptyState">Loading your earnings…</div> : <>
        <div className="earningsGrid">
          {data.balances.map((balance, index) => <article className="earningCard" key={balance.type + balance.currency + index}>
            <span>{balance.type === 'CREATOR_PENDING' ? 'PENDING EARNINGS' : 'AVAILABLE EARNINGS'} · {balance.currency}</span>
            <strong>{money(balance.balanceMinor, balance.currency)}</strong>
          </article>)}
          {!data.balances.length && <div className="emptyState"><h3>No earnings recorded yet</h3><p>When a listener completes a verified membership payment, your pending earnings will appear here.</p></div>}
        </div>
        <div className="sectionTitle"><div><div className="eyebrow">LEDGER</div><h2>Recent transactions</h2></div></div>
        {data.transactions.length ? <div className="earningList">{data.transactions.map(transaction => <article className="earningRow" key={transaction.id}>
          <div><b>{transaction.type.replaceAll('_', ' ')}</b><small>{new Date(transaction.createdAt).toLocaleString()} · {transaction.reference || transaction.id}</small></div>
          <div className="earningAmount">{money(transaction.creatorAmountMinor, transaction.currency)}</div>
        </article>)}</div> : <div className="emptyState"><p>Your verified payment ledger is currently empty.</p></div>}
        <div className="sectionTitle"><div><div className="eyebrow">PAYOUTS</div><h2>Withdrawal requests</h2></div></div>
        {payouts.length ? <div className="earningList">{payouts.map(payout => <article className="earningRow" key={payout.id}>
          <div><b>{payout.status.replaceAll('_', ' ')}</b><small>{payout.destination.channel.replaceAll('_', ' ')} · {payout.destination.accountName} · {payout.destination.maskedAccountNumber} · {new Date(payout.requestedAt).toLocaleString()}</small></div>
          <div className="earningAmount">{money(payout.amountMinor, payout.currency)}</div>
        </article>)}</div> : <div className="emptyState"><p>No payout requests yet. Withdrawals will become available after payout destination verification and operational approval.</p></div>}
        <p className="helperText">Membership earnings shown here are your share after VOXA's 15% platform commission. Provider processing fees are tracked separately and are not deducted from creator earnings. A seven-day settlement hold applies after successful payment. Only matured funds move to available earnings. Payout requests reserve available funds and remain subject to verification and review; automatic transfers are not enabled.</p>
      </>}
    </section>
  </main>;
}
