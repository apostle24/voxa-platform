'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/[/]$/, '');
type Post = { id: string; content: string; createdAt: string; author: { id: string; displayName: string } };
type Community = { id: string; name: string; slug: string; description?: string | null; category?: string | null; owner: { displayName: string }; _count: { members: number; posts: number }; posts: Post[] };

export default function CommunityDetailPage() {
  const params = useParams<{ slug: string }>();
  const [community, setCommunity] = useState<Community | null>(null);
  const [content, setContent] = useState('');
  const [joined, setJoined] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    const response = await fetch(API + '/communities/' + encodeURIComponent(params.slug));
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Community not found');
    setCommunity(data);
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (token) {
      const membershipResponse = await apiFetch(API + '/communities/' + data.id + '/membership', { headers: { Authorization: 'Bearer ' + token } });
      if (membershipResponse.ok) {
        const membershipData = await membershipResponse.json();
        setJoined(Boolean(membershipData.joined));
      }
    }
  }
  useEffect(() => { void load().catch(e => setError(e.message)); }, [params.slug]);

  async function membership() {
    if (!community) return;
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) { setError('Sign in to join this community.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await apiFetch(API + '/communities/' + community.id + '/join', { method: joined ? 'DELETE' : 'POST', headers: { Authorization: 'Bearer ' + token } });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to update membership');
      setJoined(!joined); setNotice(joined ? 'You left this community.' : 'You joined this community.');
      await load();
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to update membership'); }
    finally { setBusy(false); }
  }

  async function post(event: FormEvent) {
    event.preventDefault();
    if (!community) return;
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) { setError('Sign in to post.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await apiFetch(API + '/communities/' + community.id + '/posts', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ content }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to publish post');
      setContent(''); setNotice('Your post has been published.'); await load();
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to publish post'); }
    finally { setBusy(false); }
  }

  return <main className="appShell"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/communities">All communities</Link><Link href="/discover">Discover</Link></div></nav>
    <section className="communityPage" style={{ maxWidth: 900 }}>
      <Link href="/communities" className="textLink">← All communities</Link>
      {!community && !error && <p>Loading community…</p>}
      {error && <p className="errorText" role="alert">{error}</p>}{notice && <p className="successText">{notice}</p>}
      {community && <>
        <div className="eyebrow" style={{ marginTop: 24 }}>{community.category || 'VOXA COMMUNITY'}</div>
        <h1 style={{ fontSize: 'clamp(36px,5vw,56px)', letterSpacing: -2, margin: '12px 0' }}>{community.name}</h1>
        <p style={{ color: 'var(--muted)' }}>{community.description || 'A place to connect around shared interests.'}</p>
        <small>{community._count.members} members · {community._count.posts} posts · Created by {community.owner.displayName}</small>
        <div style={{ margin: '20px 0' }}><button className="button" disabled={busy} onClick={() => void membership()}>{busy ? 'Please wait…' : joined ? 'Leave community' : 'Join community'}</button></div>
        <form onSubmit={post} style={{ display: 'grid', gap: 10, margin: '28px 0' }}>
          <h2>Start a conversation</h2><textarea value={content} onChange={e => setContent(e.target.value)} maxLength={5000} rows={4} placeholder="Share an idea with the community…" />
          <button className="button" disabled={busy || !content.trim()}>Publish post</button>
        </form>
        <div className="eyebrow">COMMUNITY CONVERSATION</div>
        {community.posts.map(item => <article key={item.id} className="creatorShowCard" style={{ marginTop: 14 }}>
          <strong>{item.author.displayName}</strong><small style={{ marginLeft: 10 }}>{new Date(item.createdAt).toLocaleString()}</small><p style={{ whiteSpace: 'pre-wrap' }}>{item.content}</p>
        </article>)}
        {!community.posts.length && <div className="emptyState"><p>No posts yet. Be the first to start a conversation.</p></div>}
      </>}
    </section>
  </main>;
}