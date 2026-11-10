'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type Episode = {
  id: string;
  title: string;
  description?: string | null;
  mediaKey: string;
  artworkUrl?: string | null;
  durationSeconds?: number | null;
  isExplicit: boolean;
  membershipRequired: boolean;
  show: { id: string; title: string; creator: { handle: string; user: { displayName: string } } };
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}

export default function EpisodePage() {
  const { episodeId } = useParams<{ episodeId: string }>();
  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedAt = useRef(0);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [mediaType, setMediaType] = useState('audio/mpeg');
  const [bookmarked, setBookmarked] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resumeAt, setResumeAt] = useState(0);
  const [token, setToken] = useState('');

  const saveProgress = useCallback(async (positionSeconds: number, force = false) => {
    if (!token || !episodeId || (!force && Date.now() - lastSavedAt.current < 15000)) return;
    lastSavedAt.current = Date.now();
    setSaving(true);
    try {
      await fetch(API + '/episodes/' + encodeURIComponent(episodeId) + '/progress', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ positionSeconds: Math.floor(positionSeconds) }),
      });
    } catch {
      // Playback should continue if progress synchronization is temporarily unavailable.
    } finally {
      setSaving(false);
    }
  }, [episodeId, token]);

  useEffect(() => {
    let active = true;
    const accessToken = sessionStorage.getItem('voxa_access_token') || '';
    setToken(accessToken);
    async function load() {
      try {
        const response = await fetch(API + '/episodes/' + encodeURIComponent(episodeId));
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Episode not found');
        const item = data as Episode;
        if (!active) return;
        setEpisode(item);

        if (item.membershipRequired && !accessToken) {
          throw new Error('This is a members-only episode. Sign in and join the creator membership to listen.');
        }
        const playbackResponse = await fetch(
          API + '/episodes/' + encodeURIComponent(episodeId) + (item.membershipRequired ? '/member-playback-url' : '/playback-url'),
          { headers: item.membershipRequired ? { Authorization: 'Bearer ' + accessToken } : undefined },
        );
        const playback = await playbackResponse.json();
        if (!playbackResponse.ok) throw new Error(playback.message || 'Unable to prepare audio playback');
        if (active) {
          setAudioUrl(playback.url);
          setMediaType(playback.contentType || 'audio/mpeg');
        }

        if (accessToken) {
          const progressResponse = await fetch(API + '/me/playback-progress', { headers: { Authorization: 'Bearer ' + accessToken } });
          if (progressResponse.ok) {
            const progress = await progressResponse.json();
            const saved = (progress as Array<{ episodeId: string; positionSeconds: number; completed: boolean }>).find(row => row.episodeId === episodeId);
            if (active && saved && !saved.completed) setResumeAt(saved.positionSeconds);
          }
          const bookmarkResponse = await fetch(API + '/me/bookmarks', { headers: { Authorization: 'Bearer ' + accessToken } });
          if (bookmarkResponse.ok) {
            const bookmarks = await bookmarkResponse.json();
            if (active) setBookmarked((bookmarks as Array<{ episode: { id: string } }>).some(row => row.episode.id === episodeId));
          }
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Unable to load episode');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [episodeId]);

  async function toggleBookmark() {
    if (!token) { setError('Sign in to save episodes to your library.'); return; }
    try {
      const response = await fetch(API + '/episodes/' + encodeURIComponent(episodeId) + '/bookmark', {
        method: bookmarked ? 'DELETE' : 'PUT',
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to update bookmark');
      setBookmarked(!bookmarked);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update bookmark');
    }
  }

  return (
    <main className="appShell">
      <nav className="nav">
        <Link className="brand" href="/">VOXA<span>.</span></Link>
        <div className="navLinks"><Link href="/live">Explore LIVE →</Link><Link href="/login">Sign in</Link></div>
      </nav>
      <section className="communityPage" style={{ maxWidth: 900, margin: '0 auto' }}>
        {loading && <p style={{ padding: '3rem 0' }}>Preparing your episode…</p>}
        {error && <p className="errorText">{error}</p>}
        {episode && <>
          <Link href={'/shows/' + episode.show.id} style={{ color: 'var(--muted, #a1a1aa)', textDecoration: 'none' }}>← {episode.show.title}</Link>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 220px) 1fr', gap: 28, alignItems: 'center', margin: '2rem 0' }}>
            {episode.artworkUrl
              ? <img src={episode.artworkUrl} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 18 }} />
              : <div style={{ width: '100%', aspectRatio: '1', borderRadius: 18, background: 'linear-gradient(135deg,#29234c,#8b5cf6)', display: 'grid', placeItems: 'center', color: 'white', fontSize: 64, fontWeight: 800 }}>▶</div>}
            <div>
              <p className="eyebrow">VOXA EPISODE{episode.membershipRequired ? ' · MEMBERS ONLY' : ''}</p>
              <h1 style={{ fontSize: 'clamp(2rem,5vw,3.25rem)', margin: '0.4rem 0' }}>{episode.title}</h1>
              <p style={{ color: 'var(--muted, #a1a1aa)' }}>From <Link href={'/creator/' + encodeURIComponent(episode.show.creator.handle)}>{episode.show.creator.user.displayName}</Link></p>
              <p style={{ lineHeight: 1.7 }}>{episode.description || 'Press play to listen to this episode.'}</p>
              <button className="button small" onClick={() => void toggleBookmark()}>{bookmarked ? 'Saved ✓' : '＋ Save episode'}</button>
            </div>
          </div>
          {audioUrl && <section style={{ border: '1px solid var(--border, #30303a)', background: 'var(--surface, #15151c)', borderRadius: 18, padding: 22 }}>
            {mediaType.startsWith('video/')
              ? <video
                  ref={videoRef}
                  controls
                  playsInline
                  preload="metadata"
                  src={audioUrl}
                  style={{ width: '100%', maxHeight: 560, borderRadius: 12, background: '#000' }}
                  onLoadedMetadata={() => {
                    if (resumeAt > 0 && videoRef.current) videoRef.current.currentTime = resumeAt;
                  }}
                  onTimeUpdate={() => {
                    if (videoRef.current) void saveProgress(videoRef.current.currentTime);
                  }}
                  onPause={() => {
                    if (videoRef.current) void saveProgress(videoRef.current.currentTime, true);
                  }}
                  onEnded={() => void saveProgress(videoRef.current?.duration || 0, true)}
                />
              : <audio
                  ref={audioRef}
                  controls
                  preload="metadata"
                  src={audioUrl}
                  style={{ width: '100%' }}
                  onLoadedMetadata={() => {
                    if (resumeAt > 0 && audioRef.current) audioRef.current.currentTime = resumeAt;
                  }}
                  onTimeUpdate={() => {
                    if (audioRef.current) void saveProgress(audioRef.current.currentTime);
                  }}
                  onPause={() => {
                    if (audioRef.current) void saveProgress(audioRef.current.currentTime, true);
                  }}
                  onEnded={() => void saveProgress(audioRef.current?.duration || 0, true)}
                />}
            <p style={{ color: 'var(--muted, #a1a1aa)', fontSize: 13, marginBottom: 0 }}>
              {resumeAt > 0 ? 'Resume position: ' + formatTime(resumeAt) : 'Your playback progress is saved when you sign in.'}
              {saving ? ' · Saving progress…' : ''}
            </p>
          </section>}
        </>}
      </section>
    </main>
  );
}
