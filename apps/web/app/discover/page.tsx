'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type Show = {
  id: string; title: string; description?: string | null; category?: string | null;
  artworkUrl?: string | null; creator: { handle: string; user: { displayName: string } };
  _count?: { episodes: number };
};
type Episode = {
  id: string; title: string; description?: string | null; artworkUrl?: string | null;
  durationSeconds?: number | null; isExplicit: boolean; isLiveReplay?: boolean;
  show: { id: string; title: string; creator: { handle: string; user: { displayName: string } } };
};

export default function DiscoverPage() {
  const [query, setQuery] = useState('');
  const [shows, setShows] = useState<Show[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  async function load(search = query, selectedCategory = category) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (selectedCategory) params.set('category', selectedCategory);
    const suffix = params.toString() ? '?' + params.toString() : '';
    try {
      const [showResponse, episodeResponse] = await Promise.all([
        fetch(API + '/discovery/shows' + suffix),
        fetch(API + '/discovery/episodes' + suffix),
      ]);
      const [showData, episodeData] = await Promise.all([showResponse.json(), episodeResponse.json()]);
      if (!showResponse.ok) throw new Error(showData.message || 'Unable to discover shows');
      if (!episodeResponse.ok) throw new Error(episodeData.message || 'Unable to discover episodes');
      setShows(showData.items || []);
      setEpisodes(episodeData.items || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Discovery is temporarily unavailable');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetch(API + '/discovery/categories')
      .then(response => response.json())
      .then(data => setCategories(data.items || []))
      .catch(() => setCategories([]));
    void load('', '');
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query, category);
  }

  function chooseCategory(value: string) {
    setCategory(value);
    void load(query, value);
  }

  return (
    <main className="appShell">
      <nav className="nav">
        <Link className="brand" href="/">VOXA<span>.</span></Link>
        <div className="navLinks"><Link href="/moments">Moments</Link><Link href="/live">Explore LIVE</Link><Link href="/creator/setup">Become a creator</Link><Link href="/login">Sign in</Link></div>
      </nav>
      <section className="communityPage" style={{ maxWidth: 1120 }}>
        <header className="communityHeader">
          <div><div className="eyebrow">FIND YOUR NEXT LISTEN</div><h1>Discover VOXA.</h1><p>Explore shows, episodes and voices worth hearing.</p></div>
        </header>
        <form onSubmit={submit} style={{ display: 'flex', gap: 10, margin: '24px 0', flexWrap: 'wrap' }}>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search shows, episodes or creators…" aria-label="Search podcasts" style={{ flex: '1 1 260px', minWidth: 0, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'white', padding: '14px 16px' }} />
          <button className="button" type="submit">Search</button>
        </form>
        {categories.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
          <button className="ghostButton" type="button" onClick={() => chooseCategory('')}>All topics</button>
          {categories.map(item => <button key={item} type="button" className="ghostButton" onClick={() => chooseCategory(item)} style={category === item ? { borderColor: 'var(--purple)', color: 'white' } : undefined}>{item}</button>)}
        </div>}
        {error && <p className="errorText">{error}</p>}
        {loading && <p style={{ color: 'var(--muted)' }}>Finding something worth listening to…</p>}
        {!loading && <>
          <div className="eyebrow sectionEyebrow">SHOWS</div>
          {shows.length ? <div className="creatorShowGrid">
            {shows.map(show => <Link className="creatorShowCard" href={'/shows/' + show.id} key={show.id}>
              {show.artworkUrl ? <img src={show.artworkUrl} alt="" /> : <div style={{ height: 130, borderRadius: 7, background: 'linear-gradient(135deg,#29234c,#8b5cf6)', display: 'grid', placeItems: 'center', fontSize: 36, fontWeight: 800 }}>V</div>}
              <span>{show.category || 'PODCAST'}</span><h3>{show.title}</h3>
              <p>{show.description || 'Explore this podcast.'}</p>
              <small>By {show.creator.user.displayName} · {show._count?.episodes || 0} episodes</small>
            </Link>)}
          </div> : <div className="emptyState"><p>No shows match this search yet.</p></div>}
          <div className="eyebrow sectionEyebrow">LATEST EPISODES</div>
          {episodes.length ? <div className="creatorShowGrid">
            {episodes.map(episode => <Link className="creatorShowCard" href={'/episodes/' + episode.id} key={episode.id}>
              {episode.artworkUrl ? <img src={episode.artworkUrl} alt="" /> : <div style={{ height: 130, borderRadius: 7, background: 'linear-gradient(135deg,#1e3440,#426b76)', display: 'grid', placeItems: 'center', fontSize: 36 }}>▶</div>}
              <span>{episode.isLiveReplay ? 'LIVE REPLAY' : 'EPISODE'}{episode.isExplicit ? ' · EXPLICIT' : ''}</span><h3>{episode.title}</h3>
              <p>{episode.description || 'Listen to this episode.'}</p>
              <small>{episode.show.title} · {episode.show.creator.user.displayName}</small>
            </Link>)}
          </div> : <div className="emptyState"><p>No episodes match this search yet.</p></div>}
        </>}
      </section>
    </main>
  );
}
