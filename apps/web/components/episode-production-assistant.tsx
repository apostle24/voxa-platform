'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\\/$/, '');

type Review = {
  episodeId: string;
  titleOptions: string[];
  description: string;
  strengths: string[];
  improvements: string[];
  readiness: 'READY_TO_REVIEW' | 'NEEDS_WORK' | 'INSUFFICIENT_SOURCE';
  sourceNote: string;
};

type Props = { showId: string; episodeId: string; onSaved: () => void };

export default function EpisodeProductionAssistant({ showId, episodeId, onSaved }: Props) {
  const [review, setReview] = useState<Review | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function request(path: string, init: RequestInit = {}) {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    const response = await apiFetch(API + path, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + token, ...init.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'VOXA could not complete that action');
    return data;
  }

  async function generate() {
    setLoading(true); setError(''); setNotice('');
    try {
      const result = await request('/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/production-assist', { method: 'POST' });
      setReview(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to review this episode'); }
    finally { setLoading(false); }
  }

  async function apply(patch: { title?: string; description?: string }, key: string) {
    setApplying(key); setError(''); setNotice('');
    try {
      await request('/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId), {
        method: 'PATCH', body: JSON.stringify(patch),
      });
      setNotice(key === 'description' ? 'Suggested description saved to the draft.' : 'Suggested title saved to the draft.');
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to apply this suggestion'); }
    finally { setApplying(''); }
  }

  return <section style={{ flexBasis: '100%', padding: 14, border: '1px solid var(--line)', borderRadius: 9, background: 'rgba(139,110,255,.045)' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div><span className="eyebrow">VOXA AI · PRODUCTION DESK</span><h3 style={{ margin: '5px 0' }}>Improve this episode</h3><small style={{ color: 'var(--muted)' }}>Review the draft and get title, description and editorial suggestions. Nothing is changed automatically.</small></div>
      <button type="button" className="button small" disabled={loading || !!applying} onClick={() => void generate()}>{loading ? 'Reviewing…' : review ? 'Run review again' : 'Review episode'}</button>
    </div>
    {error && <p className="errorText">{error}</p>}
    {notice && <p style={{ color: '#8ee6b7', fontSize: 12 }}>{notice}</p>}
    {review && <div style={{ display: 'grid', gap: 13, marginTop: 14 }}>
      <div><span className="eyebrow">EDITORIAL READINESS</span><p style={{ margin: '5px 0', fontSize: 13 }}>{review.readiness.replaceAll('_', ' ')}</p><small style={{ color: 'var(--muted)' }}>{review.sourceNote}</small></div>
      <div><b style={{ fontSize: 12 }}>Title ideas</b>{review.titleOptions.map((title, index) => <div key={title + index} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}><span style={{ fontSize: 13 }}>{title}</span><button type="button" className="ghostButton" disabled={!!applying} onClick={() => void apply({ title }, 'title-' + index)}>{applying === 'title-' + index ? 'Saving…' : 'Use title'}</button></div>)}</div>
      {review.description && <div><b style={{ fontSize: 12 }}>Suggested description</b><p style={{ fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{review.description}</p><button type="button" className="ghostButton" disabled={!!applying} onClick={() => void apply({ description: review.description }, 'description')}>{applying === 'description' ? 'Saving…' : 'Use description'}</button></div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 14 }}>
        <div><b style={{ fontSize: 12 }}>What is working</b><ul style={{ paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>{review.strengths.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
        <div><b style={{ fontSize: 12 }}>Suggested improvements</b><ul style={{ paddingLeft: 18, fontSize: 12, lineHeight: 1.7 }}>{review.improvements.map((item, i) => <li key={i}>{item}</li>)}</ul></div>
      </div>
      <small style={{ color: 'var(--muted)' }}>AI suggestions are editorial guidance. Check accuracy and retain your own voice before publishing.</small>
    </div>}
  </section>;
}
