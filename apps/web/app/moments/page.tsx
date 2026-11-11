'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/[/]$/, '');

type Moment = {
  id: string;
  episodeId: string;
  caption: string;
  startSeconds: number;
  endSeconds: number;
  publishedAt: string | null;
  playbackUrl?: string;
  creator: { handle: string; user: { displayName: string } };
  episode: { id: string; title: string; artworkUrl: string | null; durationSeconds: number | null };
};


function MomentCommunity({ momentId, token }: { momentId: string; token: string }) {
  const [community, setCommunity] = useState<{ likeCount: number; commentCount: number; comments: any[] } | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const response = await apiFetch(API + '/moments/' + encodeURIComponent(momentId) + '/community');
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load Moment conversation');
      setCommunity(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load conversation');
    }
  }

  useEffect(() => { void load(); }, [momentId]);

  async function like() {
    if (!token) { setError('Sign in to like or comment on Moments.'); return; }
    setBusy(true);
    try {
      const response = await apiFetch(API + '/moments/' + encodeURIComponent(momentId) + '/like', {
        method: 'PUT', headers: { Authorization: 'Bearer ' + token },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to like Moment');
      setCommunity(current => current ? { ...current, likeCount: result.likeCount } : current);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to like Moment'); }
    finally { setBusy(false); }
  }

  async function comment() {
    if (!token) { setError('Sign in to join the conversation.'); return; }
    if (!draft.trim()) return;
    setBusy(true); setError('');
    try {
      const response = await apiFetch(API + '/moments/' + encodeURIComponent(momentId) + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ content: draft.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to post comment');
      setDraft('');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to post comment'); }
    finally { setBusy(false); }
  }

  return <section style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <button className="ghostButton" disabled={busy} onClick={() => void like()}>♡ Like · {community?.likeCount ?? 0}</button>
      <small style={{ color: 'var(--muted)' }}>{community?.commentCount ?? 0} comments</small>
    </div>
    {token && <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
      <input value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} placeholder="Add a comment…" style={{ minWidth: 0, flex: 1, padding: 9, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
      <button className="button small" disabled={busy || !draft.trim()} onClick={() => void comment()}>Post</button>
    </div>}
    {error && <p className="errorText" role="alert">{error}</p>}
    {community?.comments?.slice(0, 3).map(item => <p key={item.id} style={{ fontSize: 12, lineHeight: 1.5 }}><b>{item.author.displayName}:</b> {item.content}</p>)}
  </section>;
}

export default function MomentsPage() {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    let active = true;
    setToken(sessionStorage.getItem('voxa_access_token') || '');
    async function load() {
      try {
        const response = await fetch(API + '/discovery/moments');
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load VOXA Moments');
        const entries = await Promise.all((data.items || []).map(async (item: Moment) => {
          const playbackResponse = await fetch(API + '/episodes/' + encodeURIComponent(item.episodeId) + '/playback-url');
          const playback = await playbackResponse.json();
          if (!playbackResponse.ok) return item;
          return { ...item, playbackUrl: playback.url };
        }));
        if (active) setMoments(entries);
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'VOXA Moments is temporarily unavailable');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  return (
    <main className="appShell">
      <nav className="nav">
        <Link className="brand" href="/">VOXA<span>.</span></Link>
        <div className="navLinks"><Link href="/discover">Discover</Link><Link href="/live">Explore LIVE</Link><Link href="/creator/studio">Creator Studio</Link></div>
      </nav>
      <section className="communityPage" style={{ maxWidth: 980 }}>
        <div className="eyebrow">SHORT VIDEO FROM VOXA CREATORS</div>
        <h1 style={{ fontSize: 'clamp(34px,5vw,54px)', letterSpacing: -2, margin: '12px 0' }}>VOXA Moments.</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Discover the best 90-second highlights from podcasts and conversations.</p>
        {loading && <p style={{ color: 'var(--muted)', padding: 24 }}>Loading Moments…</p>}
        {error && <p className="errorText" role="alert">{error}</p>}
        {!loading && !error && !moments.length && <div className="emptyState" style={{ marginTop: 24 }}><h3>No Moments published yet</h3><p>Creator clips will appear here as they are published.</p><Link className="button small" href="/discover">Explore podcasts</Link></div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,300px),1fr))', gap: 22, marginTop: 24 }}>
          {moments.map(moment => <article key={moment.id} className="creatorShowCard" style={{ padding: 14 }}>
            {moment.playbackUrl ? <video controls playsInline preload="metadata" src={moment.playbackUrl} onLoadedMetadata={event => { event.currentTarget.currentTime = moment.startSeconds; }} onTimeUpdate={event => { if (event.currentTarget.currentTime >= moment.endSeconds) event.currentTarget.pause(); }} style={{ width: '100%', aspectRatio: '9 / 16', maxHeight: 520, objectFit: 'cover', borderRadius: 10, background: '#09090b' }} /> : <div style={{ aspectRatio: '9 / 16', maxHeight: 520, display: 'grid', placeItems: 'center', background: 'var(--surface)', borderRadius: 10 }}>Video unavailable</div>}
            <p style={{ fontSize: 14, lineHeight: 1.6 }}>{moment.caption}</p>
            <small>By {moment.creator.user.displayName} · @{moment.creator.handle}</small>
            <p style={{ marginBottom: 0 }}><Link className="textLink" href={'/episodes/' + moment.episodeId + '?t=' + Math.floor(moment.startSeconds)}>Open full episode at this moment ↗</Link></p>
            <MomentCommunity momentId={moment.id} token={token} />
          </article>)}
        </div>
      </section>
    </main>
  );
}
