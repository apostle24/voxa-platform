'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/[/]$/, '');

export default function EpisodeTranscriptEditor({ showId, episodeId }: { showId: string; episodeId: string }) {
  const [content, setContent] = useState('');
  const [language, setLanguage] = useState('en');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) return;
    apiFetch(API + '/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/transcript', { headers: { Authorization: 'Bearer ' + token } })
      .then(async response => { if (!response.ok) return; const data = await response.json(); setContent(data.content || ''); setLanguage(data.language || 'en'); })
      .catch(() => undefined);
  }, [episodeId]);

  async function save() {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) { setError('Sign in to edit transcripts.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await apiFetch(API + '/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/transcript', {
        method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, language }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to save transcript');
      setNotice(content.trim() ? 'Transcript saved.' : 'Transcript removed.');
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to save transcript'); }
    finally { setBusy(false); }
  }

  return <details style={{ width: '100%', marginTop: 10 }}>
    <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 12 }}>Add or edit transcript</summary>
    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
      <label style={{ fontSize: 12 }}>Transcript language <input value={language} onChange={e => setLanguage(e.target.value)} maxLength={12} placeholder="en" /></label>
      <textarea value={content} onChange={e => setContent(e.target.value)} maxLength={200000} rows={8} placeholder="Paste or type the episode transcript here. Keep speaker labels and paragraph breaks for readability." style={{ width: '100%', padding: 12, borderRadius: 8, background: 'var(--surface)', color: 'inherit', border: '1px solid var(--line)', font: 'inherit' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><button className="button small" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save transcript'}</button><small>{content.length.toLocaleString()} / 200,000 characters</small></div>
      {notice && <small>{notice}</small>}{error && <small className="errorText">{error}</small>}
    </div>
  </details>;
}