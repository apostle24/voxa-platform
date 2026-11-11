'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/[/]$/, '');
type Community = { id: string; name: string; slug: string; description?: string | null; category?: string | null; artworkUrl?: string | null; owner: { displayName: string }; _count: { members: number; posts: number } };

export default function CommunitiesPage() {
  const [items, setItems] = useState<Community[]>([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [artworkUrl, setArtworkUrl] = useState('');
  const [moderator, setModerator] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function load(search = '') {
    const response = await fetch(API + '/communities' + (search.trim() ? '?q=' + encodeURIComponent(search.trim()) : ''));
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load communities');
    setItems(data);
  }
  useEffect(() => {
    void load().catch(e => setError(e.message));
    try { const user = JSON.parse(sessionStorage.getItem('voxa_user') || 'null'); setModerator(['ADMIN', 'MODERATOR'].includes(user?.role)); } catch {}
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) { setError('Sign in before creating a community.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await apiFetch(API + '/communities', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description, category, artworkUrl }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to create community');
      setName(''); setDescription(''); setCategory(''); setArtworkUrl('');
      setNotice('Your community has been created.');
      await load(query);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create community'); }
    finally { setBusy(false); }
  }

  async function search(event: FormEvent) { event.preventDefault(); setError(''); try { await load(query); } catch(e) { setError(e instanceof Error ? e.message : 'Search failed'); } }

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/discover">Discover</Link><Link href="/following">Following</Link><Link href="/live">Explore LIVE</Link>{moderator && <Link href="/admin/community-moderation">Moderation</Link>}</div></nav>
    <section className="communityPage" style={{ maxWidth: 1120 }}>
      <div className="eyebrow">VOXA PEOPLE & INTERESTS</div>
      <h1 style={{ fontSize: 'clamp(36px,5vw,56px)', letterSpacing: -2, margin: '12px 0' }}>Find your community.</h1>
      <p style={{ color: 'var(--muted)' }}>Join conversations around the podcasts, ideas and interests you care about.</p>
      <form onSubmit={search} style={{ display: 'flex', gap: 10, margin: '24px 0' }}>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search communities…" aria-label="Search communities" style={{ flex: 1, minWidth: 0, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'white', padding: '14px 16px' }} />
        <button className="button">Search</button>
      </form>
      {error && <p className="errorText" role="alert">{error}</p>}{notice && <p className="successText">{notice}</p>}
      <div className="creatorShowGrid">
        {items.map(item => <Link className="creatorShowCard" href={'/communities/' + encodeURIComponent(item.slug)} key={item.id}>
          {item.artworkUrl ? <img src={item.artworkUrl} alt="" /> : <div style={{ height: 130, borderRadius: 7, background: 'linear-gradient(135deg,#29234c,#8b5cf6)', display: 'grid', placeItems: 'center', fontSize: 36, fontWeight: 800 }}>V</div>}
          <span>{item.category || 'COMMUNITY'}</span><h3>{item.name}</h3><p>{item.description || 'A place to connect and share ideas.'}</p>
          <small>By {item.owner.displayName} · {item._count.members} members · {item._count.posts} posts</small>
        </Link>)}
      </div>
      {!items.length && <div className="emptyState"><p>No communities found. Start one below.</p></div>}
      <section style={{ marginTop: 44, maxWidth: 650 }}>
        <div className="eyebrow">START SOMETHING</div><h2>Create a community</h2>
        <form onSubmit={create} style={{ display: 'grid', gap: 12 }}>
          <input required minLength={3} maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Community name" />
          <input maxLength={60} value={category} onChange={e => setCategory(e.target.value)} placeholder="Category (optional)" />
          <input type="url" maxLength={2048} value={artworkUrl} onChange={e => setArtworkUrl(e.target.value)} placeholder="Community artwork URL (optional)" />
          <textarea maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} placeholder="What brings this community together?" rows={4} />
          <button className="button" disabled={busy}>{busy ? 'Creating…' : 'Create community'}</button>
        </form>
      </section>
    </section>
  </main>;
}