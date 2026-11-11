'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/[/]$/, '');

type HistoryItem = {
  episodeId: string;
  positionSeconds: number;
  completed: boolean;
  updatedAt?: string;
  episode: {
    id: string;
    title: string;
    artworkUrl?: string | null;
    durationSeconds?: number | null;
    show: { id: string; title: string };
  };
};

function clock(seconds: number) {
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}

export default function ListeningHistoryPage() {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(false);
  const [filter, setFilter] = useState<'all' | 'in-progress' | 'completed'>('all');

  useEffect(() => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setSignedIn(Boolean(token));
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch(API + '/me/playback-progress', { headers: { Authorization: 'Bearer ' + token } })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load listening history');
        setItems(Array.isArray(data) ? data : []);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load listening history'))
      .finally(() => setLoading(false));
  }, []);

  const visibleItems = useMemo(() => items.filter(item =>
    filter === 'all' || (filter === 'completed' ? item.completed : !item.completed)
  ), [items, filter]);

  return (
    <main className="appShell">
      <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/discover">Discover</Link><Link href="/library">Your library</Link><Link href="/following">Following</Link></div></nav>
      <section className="communityPage" style={{ maxWidth: 1120 }}>
        <div className="eyebrow">YOUR LISTENING ACTIVITY</div>
        <h1 style={{ fontSize: 'clamp(34px,5vw,54px)', letterSpacing: -2, margin: '12px 0' }}>Listening history.</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Pick up where you stopped or revisit an episode you have finished.</p>
        {!signedIn && !loading && <div className="emptyState" style={{ marginTop: 28 }}><h3>Sign in to view your history</h3><p>Your listening activity is saved to your VOXA account.</p><Link className="button small" href="/login">Sign in</Link></div>}
        {loading && <p style={{ color: 'var(--muted)', padding: 28 }}>Loading your listening history…</p>}
        {error && <p className="errorText" role="alert">{error}</p>}
        {signedIn && !loading && !error && <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '26px 0 18px' }}>
            {(['all', 'in-progress', 'completed'] as const).map(value => <button key={value} className="ghostButton" type="button" onClick={() => setFilter(value)} aria-pressed={filter === value} style={filter === value ? { borderColor: 'var(--purple)', color: 'white' } : undefined}>{value === 'all' ? 'All activity' : value === 'in-progress' ? 'In progress' : 'Completed'}</button>)}
          </div>
          {visibleItems.length ? <div className="creatorShowGrid">
            {visibleItems.map(item => <Link className="creatorShowCard" href={'/episodes/' + item.episodeId} key={item.episodeId}>
              {item.episode.artworkUrl ? <img src={item.episode.artworkUrl} alt="" /> : <div style={{ height: 110, borderRadius: 7, background: '#29234c', display: 'grid', placeItems: 'center', fontSize: 30 }}>♫</div>}
              <span>{item.completed ? 'COMPLETED' : 'CONTINUE · ' + clock(item.positionSeconds)}</span>
              <h3>{item.episode.title}</h3>
              <small>{item.episode.show.title}</small>
              <small>{item.completed ? 'Listen again ↗' : 'Resume episode ↗'}</small>
            </Link>)}
          </div> : <div className="emptyState"><p>{filter === 'completed' ? 'You have not completed any episodes yet.' : filter === 'in-progress' ? 'You have no unfinished episodes.' : 'Your listening history will appear here as you listen.'}</p><Link className="textLink" href="/discover">Explore podcasts ↗</Link></div>}
        </>}
      </section>
    </main>
  );
}
