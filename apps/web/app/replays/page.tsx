'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\\/$/, '');

type Replay = {
  id: string;
  title: string;
  description?: string | null;
  artworkUrl?: string | null;
  durationSeconds?: number | null;
  publishedAt?: string | null;
  isExplicit?: boolean;
  membershipRequired?: boolean;
  isLiveReplay?: boolean;
  show: {
    id: string;
    title: string;
    creator: { handle: string; user: { displayName: string } };
  };
};

function duration(seconds?: number | null) {
  if (!seconds || seconds < 1) return 'Replay';
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? hours + ' hr ' + (minutes % 60) + ' min' : minutes + ' min';
}

export default function ReplaysPage() {
  const [items, setItems] = useState<Replay[]>([]);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function load(search = '') {
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ limit: '50' });
    if (search.trim()) params.set('q', search.trim());
    try {
      const response = await fetch(API + '/discovery/episodes?' + params.toString());
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to load live replays');
      const episodes = Array.isArray(data.items) ? data.items as Replay[] : [];
      setItems(episodes.filter(item => item.isLiveReplay === true));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Live replays are temporarily unavailable');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedQuery(query.trim());
    void load(query);
  }

  return (
    <main className="appShell">
      <nav className="nav">
        <Link className="brand" href="/">VOXA<span>.</span></Link>
        <div className="navLinks">
          <Link href="/discover">Discover</Link>
          <Link href="/moments">Moments</Link>
          <Link href="/live">Explore LIVE</Link>
          <Link href="/login">Sign in</Link>
        </div>
      </nav>
      <section className="communityPage" style={{ maxWidth: 1120 }}>
        <header className="communityHeader">
          <div>
            <div className="eyebrow">THE VOXA LIVE ARCHIVE</div>
            <h1>Live replays.</h1>
            <p>Catch the conversations, interviews and live sessions you missed. Every replay opens as an episode, so you can listen or watch at your own pace.</p>
          </div>
        </header>
        <form onSubmit={submit} style={{ display: 'flex', gap: 10, margin: '24px 0 30px', flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search live replays…"
            aria-label="Search live replays"
            style={{ flex: '1 1 260px', minWidth: 0, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'white', padding: '14px 16px' }}
          />
          <button className="button" type="submit">Search replays</button>
          {submittedQuery && <button className="ghostButton" type="button" onClick={() => { setQuery(''); setSubmittedQuery(''); void load(''); }}>Clear</button>}
        </form>
        {error && <p className="errorText" role="alert">{error}</p>}
        {loading ? <p style={{ color: 'var(--muted)' }}>Loading the live archive…</p> : items.length ? (
          <>
            <div className="eyebrow sectionEyebrow">{items.length} {items.length === 1 ? 'REPLAY' : 'REPLAYS'}</div>
            <div className="creatorShowGrid">
              {items.map(replay => (
                <Link className="creatorShowCard" href={'/episodes/' + encodeURIComponent(replay.id)} key={replay.id}>
                  {replay.artworkUrl
                    ? <img src={replay.artworkUrl} alt="" />
                    : <div style={{ height: 150, borderRadius: 7, background: 'linear-gradient(135deg,#1e3440,#426b76)', display: 'grid', placeItems: 'center', color: 'white', fontSize: 42 }}>◉</div>}
                  <span>VOXA LIVE REPLAY{replay.isExplicit ? ' · EXPLICIT' : ''}{replay.membershipRequired ? ' · MEMBERS' : ''}</span>
                  <h3>{replay.title}</h3>
                  <p>{replay.description || 'A recorded VOXA LIVE session. Press play and catch up.'}</p>
                  <small>{replay.show.title} · {replay.show.creator.user.displayName} · {duration(replay.durationSeconds)}</small>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="emptyState">
            <h2>No live replays found</h2>
            <p>{submittedQuery ? 'Try another search, or clear your search to browse the archive.' : 'Completed live recordings will appear here after their creators review and publish them.'}</p>
            <Link className="button small" href="/live">Explore live rooms</Link>
          </div>
        )}
      </section>
    </main>
  );
}
