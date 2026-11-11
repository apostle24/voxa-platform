'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/[/]$/, '');

type Chapter = { title: string; startSeconds: number };
function formatTime(seconds: number) {
  return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
}
function parseTime(value: string) {
  const parts = value.trim().split(':').map(Number);
  if (parts.length === 2 && parts.every(Number.isInteger) && parts[0] >= 0 && parts[1] >= 0 && parts[1] < 60) return parts[0] * 60 + parts[1];
  if (parts.length === 3 && parts.every(Number.isInteger) && parts.every(part => part >= 0) && parts[1] < 60 && parts[2] < 60) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

export default function EpisodeChaptersEditor({ showId, episodeId, durationSeconds }: { showId: string; episodeId: string; durationSeconds?: number | null }) {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) return;
    apiFetch(API + '/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/chapters', { headers: { Authorization: 'Bearer ' + token } })
      .then(async response => { if (response.ok) setChapters(await response.json()); })
      .catch(() => undefined);
  }, [showId, episodeId]);

  function update(index: number, field: keyof Chapter, value: string) {
    setChapters(items => items.map((item, i) => i === index ? { ...item, [field]: field === 'title' ? value : (parseTime(value) ?? -1) } : item));
  }

  async function save() {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) { setError('Sign in to edit episode chapters.'); return; }
    if (chapters.some(chapter => !chapter.title.trim() || chapter.startSeconds < 0 || (durationSeconds && chapter.startSeconds >= durationSeconds))) {
      setError('Check each chapter title and timestamp. Times must be within the episode duration.'); return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await apiFetch(API + '/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/chapters', {
        method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ chapters }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to save chapters');
      setChapters(data); setNotice('Chapter guide saved.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save chapters'); }
    finally { setBusy(false); }
  }

  return <details style={{ width: '100%', marginTop: 10 }}>
    <summary style={{ cursor: 'pointer', color: 'var(--muted)', fontSize: 12 }}>Add or edit chapter guide</summary>
    <div style={{ display: 'grid', gap: 9, marginTop: 10 }}>
      <small>Set each chapter's start time (MM:SS) and title. Chapters appear as jump points on the published episode.</small>
      {chapters.map((chapter, index) => <div key={index} style={{ display: 'grid', gridTemplateColumns: '110px 1fr auto', gap: 8 }}>
        <input aria-label={'Chapter ' + (index + 1) + ' start time'} value={chapter.startSeconds < 0 ? '' : formatTime(chapter.startSeconds)} placeholder="00:00" onChange={event => update(index, 'startSeconds', event.target.value)} />
        <input aria-label={'Chapter ' + (index + 1) + ' title'} value={chapter.title} maxLength={100} placeholder="Chapter title" onChange={event => update(index, 'title', event.target.value)} />
        <button type="button" className="ghostButton" onClick={() => setChapters(items => items.filter((_, i) => i !== index))}>Remove</button>
      </div>)}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="ghostButton" disabled={chapters.length >= 100} onClick={() => setChapters(items => [...items, { title: '', startSeconds: 0 }])}>＋ Add chapter</button>
        <button type="button" className="button small" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save chapters'}</button>
      </div>
      {notice && <small>{notice}</small>}{error && <small className="errorText">{error}</small>}
    </div>
  </details>;
}