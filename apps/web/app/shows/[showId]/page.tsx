'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type Episode = {
  id: string;
  title: string;
  description?: string | null;
  artworkUrl?: string | null;
  durationSeconds?: number | null;
  isExplicit: boolean;
  membershipRequired: boolean;
  publishedAt?: string | null;
};
type Show = {
  id: string;
  title: string;
  description?: string | null;
  language: string;
  category?: string | null;
  artworkUrl?: string | null;
  creator: { handle: string; user: { displayName: string } };
  episodes: Episode[];
};

function duration(seconds?: number | null) {
  if (!seconds || seconds < 0) return 'Duration unavailable';
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return minutes + ' min' + (remaining ? ' ' + remaining + ' sec' : '');
}

export default function ShowPage() {
  const { showId } = useParams<{ showId: string }>();
  const [show, setShow] = useState<Show | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(API + '/shows/' + encodeURIComponent(showId))
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'This show could not be found');
        return data as Show;
      })
      .then(data => { if (active) setShow(data); })
      .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'Unable to load show'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [showId]);

  return (
    <main className="appShell">
      <nav className="nav">
        <Link className="brand" href="/">VOXA<span>.</span></Link>
        <div className="navLinks"><Link href="/live">Explore LIVE →</Link><Link href="/login">Sign in</Link></div>
      </nav>
      <section className="communityPage" style={{ maxWidth: 1040, margin: '0 auto' }}>
        <Link href="/" style={{ color: 'var(--muted, #9ca3af)', textDecoration: 'none' }}>← Discover</Link>
        {loading && <p style={{ padding: '3rem 0' }}>Loading show…</p>}
        {error && <p className="errorText">{error}</p>}
        {show && <>
          <header style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr', gap: 28, alignItems: 'center', margin: '2rem 0 3rem' }}>
            {show.artworkUrl
              ? <img src={show.artworkUrl} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 18 }} />
              : <div style={{ width: '100%', aspectRatio: '1', borderRadius: 18, background: 'linear-gradient(135deg,#29234c,#8b5cf6)', display: 'grid', placeItems: 'center', color: 'white', fontSize: 64, fontWeight: 800 }}>V</div>}
            <div>
              <p className="eyebrow">{(show.category || 'PODCAST').toUpperCase()} · {show.language.toUpperCase()}</p>
              <h1 style={{ fontSize: 'clamp(2rem,5vw,3.5rem)', margin: '0.4rem 0' }}>{show.title}</h1>
              <p style={{ color: 'var(--muted, #a1a1aa)' }}>By <Link href={'/creator/' + encodeURIComponent(show.creator.handle)}>{show.creator.user.displayName}</Link></p>
              <p style={{ maxWidth: 680, lineHeight: 1.7 }}>{show.description || 'Explore the latest episodes from this show.'}</p>
              <strong>{show.episodes.length} published episodes</strong>
            </div>
          </header>
          <div className="eyebrow sectionEyebrow">EPISODES</div>
          {show.episodes.length ? <div style={{ display: 'grid', gap: 12 }}>
            {show.episodes.map((episode, index) => <article key={episode.id} style={{ display: 'grid', gridTemplateColumns: '52px minmax(0,1fr) auto', alignItems: 'center', gap: 16, padding: 18, border: '1px solid var(--border, #30303a)', borderRadius: 16, background: 'var(--surface, #15151c)' }}>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: '#28233f', color: '#c4b5fd', display: 'grid', placeItems: 'center', fontWeight: 800 }}>{String(index + 1).padStart(2, '0')}</div>
              <div>
                <h3 style={{ margin: '0 0 5px' }}>{episode.title}</h3>
                <p style={{ margin: 0, color: 'var(--muted, #a1a1aa)', fontSize: 14 }}>{episode.description || 'Listen to this episode'} · {duration(episode.durationSeconds)}{episode.isExplicit ? ' · Explicit' : ''}{episode.membershipRequired ? ' · Members' : ''}</p>
              </div>
              <Link className="button small" href={'/episodes/' + episode.id}>Listen ↗</Link>
            </article>)}
          </div> : <div className="emptyState"><p>No published episodes yet.</p></div>}
        </>}
      </section>
    </main>
  );
}
