'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/[/]$/, '');

type FollowedCreator = {
  id: string;
  handle: string;
  bio?: string | null;
  verifiedAt?: string | null;
  displayName: string;
  followedAt: string;
  liveRoom: { id: string; title: string } | null;
  followerCount: number;
  showCount: number;
};

export default function FollowingPage() {
  const [creators, setCreators] = useState<FollowedCreator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setSignedIn(Boolean(token));
    if (!token) {
      setLoading(false);
      return;
    }
    apiFetch(API + '/creators/me/following', { headers: { Authorization: 'Bearer ' + token } })
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to load followed creators');
        setCreators(Array.isArray(data) ? data : []);
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load followed creators'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main className="appShell">
      <nav className="nav">
        <Link className="brand" href="/">VOXA<span>.</span></Link>
        <div className="navLinks"><Link href="/discover">Discover</Link><Link href="/library">Your library</Link><Link href="/live">Explore LIVE</Link></div>
      </nav>
      <section className="communityPage" style={{ maxWidth: 1120 }}>
        <div className="eyebrow">YOUR VOXA COMMUNITY</div>
        <h1 style={{ fontSize: 'clamp(34px,5vw,54px)', letterSpacing: -2, margin: '12px 0' }}>Creators you follow.</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Keep up with the voices, shows and live conversations you care about.</p>
        {!signedIn && !loading && <div className="emptyState" style={{ marginTop: 28 }}><h3>Sign in to see your creators</h3><p>Your followed creators will appear here.</p><Link className="button small" href="/login">Sign in</Link></div>}
        {loading && <p style={{ color: 'var(--muted)', padding: 28 }}>Loading your followed creators…</p>}
        {error && <p className="errorText" role="alert">{error}</p>}
        {signedIn && !loading && !error && (creators.length ? <div className="creatorShowGrid" style={{ marginTop: 28 }}>
          {creators.map(creator => <article className="creatorShowCard" key={creator.id}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="creatorAvatar" style={{ width: 48, height: 48, fontSize: 19 }}>{creator.displayName.slice(0, 1).toUpperCase()}</div>
              <div><h3 style={{ margin: 0 }}>{creator.displayName}{creator.verifiedAt ? ' ✓' : ''}</h3><small>@{creator.handle}</small></div>
            </div>
            <p>{creator.bio || 'Creator on VOXA.'}</p>
            <small>{creator.followerCount} followers · {creator.showCount} shows</small>
            {creator.liveRoom && <Link className="livePill" href={'/live/' + creator.liveRoom.id}>LIVE NOW · {creator.liveRoom.title}</Link>}
            <Link href={'/creator/' + encodeURIComponent(creator.handle)} className="textLink">View creator profile ↗</Link>
          </article>)}
        </div> : <div className="emptyState" style={{ marginTop: 28 }}><h3>Your creator feed starts here</h3><p>Follow creators to keep their latest shows and live rooms close.</p><Link className="button small" href="/discover">Discover creators</Link></div>)}
      </section>
    </main>
  );
}
