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
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return hours
    ? hours + ':' + String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0')
    : minutes + ':' + String(remainder).padStart(2, '0');
}

function progressPercent(positionSeconds: number, durationSeconds?: number | null) {
  if (!durationSeconds || durationSeconds <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((positionSeconds / durationSeconds) * 100)));
}

export default function LibraryPage() {
  const [bookmarks, setBookmarks] = useState<SavedEpisode[]>([]);
  const [progress, setProgress] = useState<ProgressItem[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [signedIn, setSignedIn] = useState(false);
  const [removingBookmark, setRemovingBookmark] = useState<string | null>(null);

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

  async function removeBookmark(episodeId: string) {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setRemovingBookmark(episodeId);
    setError('');
    try {
      const response = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + '/bookmark', { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) { const data = await response.json(); throw new Error(data.message || 'Unable to remove saved episode'); }
      setBookmarks(current => current.filter(item => item.episode.id !== episodeId));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to remove saved episode');
    } finally { setRemovingBookmark(null); }
  }

  return (
    <main className="appShell">
      <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/discover">Discover</Link><Link href="/history">History</Link><Link href="/following">Following</Link><Link href="/settings/profile">Settings</Link><Link href="/live">Explore LIVE</Link></div></nav>
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
            {progress.map(item => {
              const percent = progressPercent(item.positionSeconds, item.episode.durationSeconds);
              const remaining = item.episode.durationSeconds && item.episode.durationSeconds > item.positionSeconds
                ? item.episode.durationSeconds - item.positionSeconds
                : null;
              return <Link className="creatorShowCard" href={'/episodes/' + item.episodeId} key={item.episodeId}>
                {item.episode.artworkUrl ? <img src={item.episode.artworkUrl} alt="" /> : <div style={{ height: 110, borderRadius: 7, background: '#29234c', display: 'grid', placeItems: 'center', fontSize: 30 }}>▶</div>}
                <span>CONTINUE · {time(item.positionSeconds)}{percent > 0 ? ' · ' + percent + '%' : ''}</span>
                <h3>{item.episode.title}</h3><small>{item.episode.show.title}</small>
                <div
                  role="progressbar"
                  aria-label={'Listening progress for ' + item.episode.title}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent}
                  style={{ height: 5, borderRadius: 999, overflow: 'hidden', background: 'var(--line)', marginTop: 13 }}
                >
                  <div style={{ width: percent + '%', height: '100%', borderRadius: 999, background: 'var(--purple, #8b5cf6)' }} />
                </div>
                <small style={{ display: 'block', marginTop: 7, color: 'var(--muted)' }}>
                  {remaining === null ? 'Resume playback' : time(remaining) + ' left'}
                </small>
              </Link>;
            })}
          </div> : <div className="emptyState"><p>No unfinished episodes yet. Start listening to a show.</p><Link href="/discover" className="textLink">Discover podcasts ↗</Link></div>}
          <div className="eyebrow sectionEyebrow">SAVED EPISODES</div>
          {bookmarks.length ? <div className="creatorShowGrid">
            {bookmarks.map(item => <article className="creatorShowCard" key={item.episode.id}>
              {item.episode.artworkUrl ? <img src={item.episode.artworkUrl} alt="" /> : <div style={{ height: 110, borderRadius: 7, background: '#29234c', display: 'grid', placeItems: 'center', fontSize: 30 }}>♫</div>}
              <span>SAVED EPISODE</span><h3><Link href={'/episodes/' + item.episode.id}>{item.episode.title}</Link></h3><small>{item.episode.show.title}</small>
              <button className="ghostButton" style={{ marginTop: 12 }} disabled={removingBookmark !== null} onClick={() => void removeBookmark(item.episode.id)}>{removingBookmark === item.episode.id ? 'Removing…' : 'Remove from library'}</button>
            </article>)}
          </div> : <div className="emptyState"><p>You have not saved any episodes yet.</p></div>}
        </>}
      </section>
    </main>
  );
}
