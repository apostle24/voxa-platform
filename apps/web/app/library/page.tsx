'use client';

import { apiFetch } from '../../lib/api';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type SavedEpisode = {
  episode: { id: string; title: string; artworkUrl?: string | null; durationSeconds?: number | null; show: { id: string; title: string } };
  savedAt: string;
};
type ProgressItem = {
  episodeId: string; positionSeconds: number; completed: boolean;
  episode: { title: string; artworkUrl?: string | null; durationSeconds?: number | null; show: { id: string; title: string } };
};

function time(seconds: number) {
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}

export default function LibraryPage() {
  const [bookmarks, setBookmarks] = useState<SavedEpisode[]>([]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setSignedIn(!!token);
    if (!token) { setLoading(false); return; }
    const headers = { Authorization: 'Bearer ' + token };
    Promise.all([
      apiFetch(API + '/me/bookmarks', { headers }),
      apiFetch(API + '/me/playback-progress', { headers }),
    ]).then(async ([savedResponse, progressResponse]) => {
      const [savedData, progressData] = await Promise.all([savedResponse.json(), progressResponse.json()]);
      if (!savedResponse.ok) throw new Error(savedData.message || 'Unable to load saved episodes');
      if (!progressResponse.ok) throw new Error(progressData.message || 'Unable to load listening history');
      setBookmarks(savedData || []);
      setProgress((progressData || []).filter((item: ProgressItem) => !item.completed));
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load your library'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="appShell">
      <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/discover">Discover</Link><Link href="/following">Following</Link><Link href="/live">Explore LIVE</Link></div></nav>
      <section className="communityPage" style={{ maxWidth: 1120 }}>
        <div className="eyebrow">YOUR PERSONAL LISTENING SPACE</div>
        <h1 style={{ fontSize: 'clamp(34px,5vw,54px)', letterSpacing: -2, margin: '12px 0' }}>Your library.</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Saved episodes and listening progress, all in one place.</p>
        {!signedIn && !loading && <div className="emptyState" style={{ marginTop: 28 }}><h3>Sign in to access your library</h3><p>Your saved episodes and listening progress are linked to your VOXA account.</p><Link className="button small" href="/login">Sign in</Link></div>}
        {loading && <p style={{ color: 'var(--muted)', padding: 30 }}>Loading your library…</p>}
        {error && <p className="errorText">{error}</p>}
        {signedIn && !loading && <>
          <div className="eyebrow sectionEyebrow">CONTINUE LISTENING</div>
          {progress.length ? <div className="creatorShowGrid">
            {progress.map(item => <Link className="creatorShowCard" href={'/episodes/' + item.episodeId} key={item.episodeId}>
              {item.episode.artworkUrl ? <img src={item.episode.artworkUrl} alt="" /> : <div style={{ height: 110, borderRadius: 7, background: '#29234c', display: 'grid', placeItems: 'center', fontSize: 30 }}>▶</div>}
              <span>RESUME · {time(item.positionSeconds)}</span><h3>{item.episode.title}</h3><small>{item.episode.show.title}</small>
            </Link>)}
          </div> : <div className="emptyState"><p>No unfinished episodes yet. Start listening to a show.</p><Link href="/discover" className="textLink">Discover podcasts ↗</Link></div>}
          <div className="eyebrow sectionEyebrow">SAVED EPISODES</div>
          {bookmarks.length ? <div className="creatorShowGrid">
            {bookmarks.map(item => <Link className="creatorShowCard" href={'/episodes/' + item.episode.id} key={item.episode.id}>
              {item.episode.artworkUrl ? <img src={item.episode.artworkUrl} alt="" /> : <div style={{ height: 110, borderRadius: 7, background: '#29234c', display: 'grid', placeItems: 'center', fontSize: 30 }}>♫</div>}
              <span>SAVED EPISODE</span><h3>{item.episode.title}</h3><small>{item.episode.show.title}</small>
            </Link>)}
          </div> : <div className="emptyState"><p>You have not saved any episodes yet.</p></div>}
        </>}
      </section>
    </main>
  );
}
