'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

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

export default function MomentsPage() {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
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
            <p style={{ marginBottom: 0 }}><Link className="textLink" href={'/episodes/' + moment.episodeId}>From: {moment.episode.title} ↗</Link></p>
          </article>)}
        </div>
      </section>
    </main>
  );
}
