'use client';

import { apiFetch } from '../../../lib/api';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type PaymentStatus = { reference: string; amountMinor: number; currency: string; status: string; paidAt?: string | null; creator: { handle: string }; plan: { name: string } };

export default function PaymentCompletePage() {
  const [payment, setPayment] = useState<PaymentStatus | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reference, setReference] = useState('');

  async function checkStatus(ref: string) {
    const token = sessionStorage.getItem('voxa_access_token');
    if (!token) { setError('Sign in again to check the membership status.'); setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const response = await apiFetch(API + '/me/payments/' + encodeURIComponent(ref), { headers: { Authorization: 'Bearer ' + token } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to verify payment status');
      setPayment(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to verify payment status');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('reference') || new URLSearchParams(window.location.search).get('trxref') || '';
    setReference(ref);
    if (!ref) { setError('No payment reference was returned.'); setLoading(false); return; }
    void checkStatus(ref);
  }, []);

  const paid = payment?.status === 'PAID';
  return <main className="appShell"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/live" className="navBack">Explore LIVE →</Link></nav>
    <section className="communityPage"><div className="paymentResult">
      <div className="eyebrow">VOXA MEMBERSHIP CHECKOUT</div>
      <h1>{loading ? 'Checking your payment…' : paid ? 'You’re a member.' : 'Payment confirmation pending'}</h1>
      {error && <p className="errorText">{error}</p>}
      {payment && <><p>{payment.plan.name} · @{payment.creator.handle}</p><h2>{new Intl.NumberFormat(undefined,{style:'currency',currency:payment.currency}).format(payment.amountMinor/100)}</h2><p className="helperText">{paid ? 'Your membership is active. You can return to the creator profile and open members-only episodes.' : 'VOXA has not yet received a verified successful payment event. If you completed checkout, wait a moment and check again.'}</p></>}
      {reference && <small className="paymentReference">Reference: {reference}</small>}
      <div className="heroActions">{!paid && reference && <button className="button" disabled={loading} onClick={()=>void checkStatus(reference)}>Check status again</button>}{payment && <Link className="ghostButton" href={'/creator/'+encodeURIComponent(payment.creator.handle)}>Return to creator</Link>}<Link className="ghostButton" href="/">VOXA home</Link></div>
    </div></section>
  </main>;
}
