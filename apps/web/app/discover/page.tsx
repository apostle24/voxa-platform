'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useVoxaPlayer, type VoxaTrack } from '../../components/player-provider';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type Show = {
  id: string; title: string; description?: string | null; category?: string | null;
  artworkUrl?: string | null; creator: { handle: string; user: { displayName: string } };
  _count?: { episodes: number };
};
type Episode = {
  id: string; title: string; description?: string | null; artworkUrl?: string | null;
  durationSeconds?: number | null; isExplicit: boolean; isLiveReplay?: boolean;
  membershipRequired: boolean;
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
  const [preparingEpisode, setPreparingEpisode] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState('');
  const { playTrack, enqueueTrack } = useVoxaPlayer();

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

  async function prepareEpisode(episode: Episode, enqueue = false) {
    if (preparingEpisode) return;
    setPreparingEpisode(episode.id);
    setPlaybackError('');
    try {
      const token = sessionStorage.getItem('voxa_access_token') || '';
      if (episode.membershipRequired && !token) {
        throw new Error('Sign in and join this creator’s membership to listen to this episode.');
      }
      const endpoint = episode.membershipRequired ? '/member-playback-url' : '/playback-url';
      const response = await apiFetch(API + '/episodes/' + encodeURIComponent(episode.id) + endpoint);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to prepare this episode');
      const track: VoxaTrack = {
        episodeId: episode.id,
        title: episode.title,
        showTitle: episode.show.title,
        creatorName: episode.show.creator.user.displayName,
        artworkUrl: episode.artworkUrl,
        url: data.url,
        contentType: data.contentType || 'audio/mpeg',
        durationSeconds: episode.durationSeconds,
      };
      if (enqueue) enqueueTrack(track);
      else playTrack(track);
    } catch (reason) {
      setPlaybackError(reason instanceof Error ? reason.message : 'Unable to prepare playback');
    } finally {
      setPreparingEpisode(null);
    }
  }

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
        <div className="navLinks"><Link href="/replays">Live replays</Link><Link href="/communities">Communities</Link><Link href="/moments">Moments</Link><Link href="/live">Explore LIVE</Link><Link href="/creator/setup">Become a creator</Link><Link href="/login">Sign in</Link></div>
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
          {playbackError && <p className="errorText" role="alert">{playbackError}</p>}
          {episodes.length ? <div className="creatorShowGrid">
            {episodes.map(episode => <article className="creatorShowCard" key={episode.id}>
              <Link href={'/episodes/' + episode.id} style={{ color: 'inherit', textDecoration: 'none' }}>
                {episode.artworkUrl ? <img src={episode.artworkUrl} alt="" /> : <div style={{ height: 130, borderRadius: 7, background: 'linear-gradient(135deg,#1e3440,#426b76)', display: 'grid', placeItems: 'center', fontSize: 36 }}>▶</div>}
                <span>{episode.isLiveReplay ? 'LIVE REPLAY' : 'EPISODE'}{episode.isExplicit ? ' · EXPLICIT' : ''}{episode.membershipRequired ? ' · MEMBERS' : ''}</span><h3>{episode.title}</h3>
                <p>{episode.description || 'Listen to this episode.'}</p>
                <small>{episode.show.title} · {episode.show.creator.user.displayName}</small>
              </Link>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
                <button className="button small" type="button" disabled={preparingEpisode !== null} onClick={() => void prepareEpisode(episode)}>{preparingEpisode === episode.id ? 'Preparing…' : '▶ Play'}</button>
                <button className="ghostButton" type="button" disabled={preparingEpisode !== null} onClick={() => void prepareEpisode(episode, true)}>＋ Queue</button>
              </div>
            </article>)}
          </div> : <div className="emptyState"><p>No episodes match this search yet.</p></div>}
        </>}
      </section>
    </main>
  );
}
