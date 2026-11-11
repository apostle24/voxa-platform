'use client';

import { apiFetch } from '../../../lib/api';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoxaPlayer } from '../../../components/player-provider';
import { ReportContent } from '../../../components/report-content';

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
  isLiveReplay?: boolean;
  show: { id: string; title: string; creator: { handle: string; user: { displayName: string } } };
};

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}


function EpisodeCommunity({ episodeId, token }: { episodeId: string; token: string }) {
  const [data, setData] = useState<{ likeCount: number; commentCount: number; likedByMe: boolean; comments: any[] } | null>(null);
  const [message, setMessage] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!token) return;
    try {
      const response = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + '/community', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Community is unavailable');
      setData(result);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to load community');
    }
  }, [episodeId, token]);

  useEffect(() => { void load(); }, [load]);

  async function toggleLike() {
    if (!token) return;
    setBusy(true);
    try {
      const response = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + '/like', {
        method: data?.likedByMe ? 'DELETE' : 'PUT',
        headers: { Authorization: 'Bearer ' + token },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to update like');
      setData(current => current ? { ...current, likedByMe: result.likedByMe, likeCount: result.likeCount } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to update like');
    } finally {
      setBusy(false);
    }
  }

  async function submitComment() {
    if (!draft.trim() || !token) return;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ content: draft.trim(), ...(replyTo ? { parentId: replyTo } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to post comment');
      setDraft('');
      setReplyTo(null);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to post comment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section style={{ marginTop: 42, padding: 24, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--panel)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><p className="eyebrow">THE CONVERSATION</p><h2 style={{ margin: '5px 0', fontSize: 23 }}>Episode community</h2></div>
        {data && <button className="ghostButton" disabled={busy} onClick={() => void toggleLike()}>{data.likedByMe ? '♥ Liked' : '♡ Like'} · {data.likeCount}</button>}
      </div>
      {!token ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sign in to join the conversation and support this episode.</p> : <>
        {error && <p className="errorText" role="alert">{error}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
          <textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={2000} rows={3} placeholder={replyTo ? 'Write a reply…' : 'Share your thoughts about this episode…'} style={{ width: '100%', resize: 'vertical', padding: 13, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit', font: 'inherit' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="button small" disabled={busy || !draft.trim()} onClick={() => void submitComment()}>{busy ? 'Posting…' : replyTo ? 'Post reply' : 'Post comment'}</button>
            {replyTo && <button className="ghostButton" onClick={() => setReplyTo(null)}>Cancel reply</button>}
            <small style={{ color: 'var(--muted)' }}>{draft.length}/2000</small>
          </div>
        </div>
        <div style={{ marginTop: 26 }}>
          <p className="eyebrow">{data?.commentCount ?? '—'} COMMENTS</p>
          {data?.comments?.length ? data.comments.map((comment: any) => <article key={comment.id} style={{ padding: '16px 0', borderBottom: '1px solid var(--line)' }}>
            <b style={{ fontSize: 13 }}>{comment.author.displayName}</b><small style={{ color: 'var(--muted)', marginLeft: 9 }}>{new Date(comment.createdAt).toLocaleDateString()}</small>
            <p style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{comment.content}</p>
            {comment.content !== '[deleted]' && <button className="ghostButton" onClick={() => { setReplyTo(comment.id); setDraft(''); }}>Reply</button>}
            {comment.replies?.map((reply: any) => <div key={reply.id} style={{ margin: '14px 0 0 22px', paddingLeft: 14, borderLeft: '2px solid var(--line)' }}>
              <b style={{ fontSize: 12 }}>{reply.author.displayName}</b><small style={{ color: 'var(--muted)', marginLeft: 9 }}>{new Date(reply.createdAt).toLocaleDateString()}</small>
              <p style={{ fontSize: 12, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{reply.content}</p>
            </div>)}
          </article>) : <p style={{ color: 'var(--muted)', fontSize: 13 }}>No comments yet. Start the conversation.</p>}
        </div>
      </>}
    </section>
  );
}

export default function EpisodePage() {
  const { episodeId } = useParams<{ episodeId: string }>();
  const { playTrack, enqueueTrack } = useVoxaPlayer();
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
      await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + '/progress', {
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
        const response = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId));
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Episode not found');
        const item = data as Episode;
        if (!active) return;
        setEpisode(item);

        if (item.membershipRequired && !accessToken) {
          throw new Error('This is a members-only episode. Sign in and join the creator membership to listen.');
        }
        const playbackResponse = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + (item.membershipRequired ? '/member-playback-url' : '/playback-url'),
          { headers: item.membershipRequired ? { Authorization: 'Bearer ' + accessToken } : undefined },
        );
        const playback = await playbackResponse.json();
        if (!playbackResponse.ok) throw new Error(playback.message || 'Unable to prepare audio playback');
        if (active) {
          setAudioUrl(playback.url);
          setMediaType(playback.contentType || 'audio/mpeg');
        }

        if (accessToken) {
          const progressResponse = await apiFetch(API + '/me/playback-progress', { headers: { Authorization: 'Bearer ' + accessToken } });
          if (progressResponse.ok) {
            const progress = await progressResponse.json();
            const saved = (progress as Array<{ episodeId: string; positionSeconds: number; completed: boolean }>).find(row => row.episodeId === episodeId);
            if (active && saved && !saved.completed) setResumeAt(saved.positionSeconds);
          }
          const bookmarkResponse = await apiFetch(API + '/me/bookmarks', { headers: { Authorization: 'Bearer ' + accessToken } });
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
      const response = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + '/bookmark', {
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
        <div className="navLinks"><Link href="/replays">Live replays</Link><Link href="/live">Explore LIVE →</Link><Link href="/login">Sign in</Link></div>
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
              <p className="eyebrow">{episode.isLiveReplay ? 'VOXA LIVE REPLAY' : 'VOXA EPISODE'}{episode.membershipRequired ? ' · MEMBERS ONLY' : ''}</p>
              <h1 style={{ fontSize: 'clamp(2rem,5vw,3.25rem)', margin: '0.4rem 0' }}>{episode.title}</h1>
              <p style={{ color: 'var(--muted, #a1a1aa)' }}>From <Link href={'/creator/' + encodeURIComponent(episode.show.creator.handle)}>{episode.show.creator.user.displayName}</Link></p>
              <p style={{ lineHeight: 1.7 }}>{episode.description || 'Press play to listen to this episode.'}</p>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><button className="button small" onClick={() => void toggleBookmark()}>{bookmarked ? 'Saved ✓' : '＋ Save episode'}</button><ReportContent targetType="EPISODE" targetId={episode.id} /></div>
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
              : <div className="episodePlayerActions">
                  <button className="button" onClick={() => playTrack({ episodeId: episode.id, title: episode.title, showTitle: episode.show.title, creatorName: episode.show.creator.user.displayName, artworkUrl: episode.artworkUrl, url: audioUrl, contentType: mediaType, durationSeconds: episode.durationSeconds, resumeAt })}>▶ Play episode</button>
                  <button className="ghostButton" onClick={() => enqueueTrack({ episodeId: episode.id, title: episode.title, showTitle: episode.show.title, creatorName: episode.show.creator.user.displayName, artworkUrl: episode.artworkUrl, url: audioUrl, contentType: mediaType, durationSeconds: episode.durationSeconds, resumeAt })}>＋ Add to queue</button>
                </div>}
            <p style={{ color: 'var(--muted, #a1a1aa)', fontSize: 13, marginBottom: 0 }}>
              {resumeAt > 0 ? 'Resume position: ' + formatTime(resumeAt) : 'Your playback progress is saved when you sign in.'}
              {saving ? ' · Saving progress…' : ''}
            </p>
          </section>}
          <EpisodeCommunity episodeId={episode.id} token={token} />
        </>}
      </section>
    </main>
  );
}
