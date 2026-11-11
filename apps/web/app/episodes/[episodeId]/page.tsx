'use client';

import { apiFetch } from '../../../lib/api';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useVoxaPlayer } from '../../../components/player-provider';
import LiveReplayTranscript from '../../../components/live-replay-transcript';

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


function EpisodeCommunity({ episodeId, token, replayContextSeconds, onReplayContextConsumed }: { episodeId: string; token: string; replayContextSeconds?: number | null; onReplayContextConsumed?: () => void }) {
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
      const contextualDraft = !replyTo && replayContextSeconds !== null && replayContextSeconds !== undefined
        ? '[Replay @ ' + replayContextSeconds + 's] ' + draft.trim()
        : draft.trim();
      const response = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + '/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ content: contextualDraft, ...(replyTo ? { parentId: replyTo } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Unable to post comment');
      setDraft('');
      setReplyTo(null);
      onReplayContextConsumed?.();
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to post comment');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="episode-discussion" style={{ marginTop: 42, padding: 24, border: '1px solid var(--line)', borderRadius: 16, background: 'var(--panel)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div><p className="eyebrow">THE CONVERSATION</p><h2 style={{ margin: '5px 0', fontSize: 23 }}>Episode community</h2></div>
        {data && <button className="ghostButton" disabled={busy} onClick={() => void toggleLike()}>{data.likedByMe ? '♥ Liked' : '♡ Like'} · {data.likeCount}</button>}
      </div>
      {!token ? <p style={{ color: 'var(--muted)', fontSize: 13 }}>Sign in to join the conversation and support this episode.</p> : <>
        {error && <p className="errorText" role="alert">{error}</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 18 }}>
          {replayContextSeconds !== null && replayContextSeconds !== undefined && !replyTo && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 12px', borderRadius: 9, background: 'var(--surface)', border: '1px solid var(--line)' }}><small style={{ color: 'var(--muted)' }}>Comment linked to replay moment <b style={{ color: 'inherit' }}>{formatTime(replayContextSeconds)}</b></small><button type="button" className="ghostButton" onClick={onReplayContextConsumed}>Remove moment</button></div>}
          <textarea value={draft} onChange={event => setDraft(event.target.value)} maxLength={replayContextSeconds !== null && replayContextSeconds !== undefined && !replyTo ? 1980 : 2000} rows={3} placeholder={replyTo ? 'Write a reply…' : replayContextSeconds !== null && replayContextSeconds !== undefined ? 'What would you like to say about this moment?' : 'Share your thoughts about this episode…'} style={{ width: '100%', resize: 'vertical', padding: 13, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit', font: 'inherit' }} />
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
            {(() => {
              const context = /^\[Replay @ (\d+)s\]\s*/.exec(comment.content || '');
              const body = context ? comment.content.slice(context[0].length) : comment.content;
              return <><p style={{ fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{body}</p>{context && <Link href={'/episodes/' + encodeURIComponent(episodeId) + '?t=' + context[1]} style={{ display: 'inline-flex', marginBottom: 8, color: 'var(--accent, #a78bfa)', fontSize: 12, fontWeight: 700, textDecoration: 'none' }}>▶ At {formatTime(Number(context[1]))}</Link>}</>;
            })()}
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
  const { playTrack, enqueueTrack, playTrackNext, seek, currentTrack, currentTime, playbackRate, changePlaybackRate, isPlaying, togglePlayback } = useVoxaPlayer();
  const videoRef = useRef<HTMLVideoElement>(null);
  const lastSavedAt = useRef(0);
  const latestVideoTime = useRef(0);
  const videoHasStarted = useRef(false);
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [audioUrl, setAudioUrl] = useState('');
  const [mediaType, setMediaType] = useState('audio/mpeg');
  const [bookmarked, setBookmarked] = useState(false);
  const [shareStatus, setShareStatus] = useState('');
  const [replayContextSeconds, setReplayContextSeconds] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resumeAt, setResumeAt] = useState(0);
  const [timestampLinkRequested, setTimestampLinkRequested] = useState(false);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoPlaybackRate, setVideoPlaybackRate] = useState(1);
  const [token, setToken] = useState('');
  const [transcript, setTranscript] = useState<{ content: string; language: string; segments?: Array<{ startSeconds: number; endSeconds: number; text: string; speaker: string }> | null } | null>(null);
  const [intelligence, setIntelligence] = useState<{ summary: string; topics: string[]; generatedAt: string } | null>(null);
  const [transcriptError, setTranscriptError] = useState('');
  const [chapters, setChapters] = useState<Array<{ id: string; title: string; startSeconds: number }>>([]);

  const replayPlaybackTime = mediaType.startsWith('video/')
    ? videoCurrentTime
    : currentTrack?.episodeId === episode?.id ? currentTime : -1;

  useEffect(() => {
    if (!episode?.isLiveReplay || replayPlaybackTime < 0) {
      setSelectedChapterId(null);
      return;
    }
    if (chapters.length === 0) return;
    const activeChapter = [...chapters]
      .filter(chapter => Number.isFinite(chapter.startSeconds) && chapter.startSeconds <= replayPlaybackTime)
      .sort((a, b) => b.startSeconds - a.startSeconds)[0];
    setSelectedChapterId(activeChapter?.id ?? null);
  }, [episode?.id, episode?.isLiveReplay, replayPlaybackTime, chapters]);

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
        const queryParams = new URLSearchParams(window.location.search);
        const requestedChapterId = queryParams.get('chapter');
        if (requestedChapterId) setSelectedChapterId(requestedChapterId);
        const requestedTimeValue = queryParams.get('t');
        const requestedTime = requestedTimeValue === null ? NaN : Number(requestedTimeValue);
        const hasRequestedTime = Number.isFinite(requestedTime) && requestedTime >= 0;
        if (hasRequestedTime) {
          const boundedTime = item.durationSeconds ? Math.min(requestedTime, item.durationSeconds) : requestedTime;
          setResumeAt(boundedTime);
          setTimestampLinkRequested(true);
        }
        try {
          const chapterResponse = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + (item.membershipRequired ? '/member-chapters' : '/chapters'),
            { headers: item.membershipRequired && accessToken ? { Authorization: 'Bearer ' + accessToken } : undefined });
          if (chapterResponse.ok) {
            const chapterData = await chapterResponse.json();
            if (active && Array.isArray(chapterData)) setChapters(chapterData);
          }
        } catch { /* Chapter navigation is optional when unavailable. */ }
        try {
          const intelligenceResponse = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + (item.membershipRequired ? '/member-intelligence' : '/intelligence'),
            { headers: item.membershipRequired && accessToken ? { Authorization: 'Bearer ' + accessToken } : undefined });
          if (intelligenceResponse.ok) {
            const intelligenceData = await intelligenceResponse.json();
            if (active && intelligenceData?.summary) setIntelligence(intelligenceData);
          }
        } catch { /* Episode intelligence is optional while being generated. */ }
        try {
          const transcriptResponse = await apiFetch(API + '/episodes/' + encodeURIComponent(episodeId) + (item.membershipRequired ? '/member-transcript' : '/transcript'),
            { headers: item.membershipRequired && accessToken ? { Authorization: 'Bearer ' + accessToken } : undefined });
          if (transcriptResponse.ok) {
            const transcriptData = await transcriptResponse.json();
            if (active && transcriptData?.content) setTranscript(transcriptData);
          } else if (transcriptResponse.status !== 404) {
            const transcriptData = await transcriptResponse.json().catch(() => ({}));
            if (active) setTranscriptError(transcriptData.message || 'Transcript unavailable');
          }
        } catch { if (active) setTranscriptError('Transcript unavailable'); }

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
            if (active && saved && !saved.completed && !hasRequestedTime) setResumeAt(saved.positionSeconds);
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

  useEffect(() => {
    if (!timestampLinkRequested || !episode || !audioUrl) return;
    if (currentTrack?.episodeId === episode.id && !mediaType.startsWith('video/')) {
      seek(resumeAt);
    }
    window.setTimeout(() => document.getElementById('replay-player')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    setTimestampLinkRequested(false);
  }, [timestampLinkRequested, episode, resumeAt, currentTrack?.episodeId, mediaType, audioUrl, seek]);

  useEffect(() => {
    videoHasStarted.current = false;
    latestVideoTime.current = 0;
  }, [episodeId]);

  useEffect(() => {
    if (!audioUrl || !mediaType.startsWith('video/')) return;
    const video = videoRef.current;
    if (!video) return;
    const applyResume = () => {
      if (!videoHasStarted.current && resumeAt > 0 && Number.isFinite(video.duration)) {
        const position = Math.min(resumeAt, Math.max(0, video.duration - 0.25));
        video.currentTime = position;
        latestVideoTime.current = position;
        setVideoCurrentTime(position);
      }
      setVideoDuration(Number.isFinite(video.duration) ? video.duration : 0);
    };
    if (video.readyState >= 1) applyResume();
    else video.addEventListener('loadedmetadata', applyResume, { once: true });
    return () => video.removeEventListener('loadedmetadata', applyResume);
  }, [audioUrl, mediaType, resumeAt]);

  useEffect(() => {
    const persistPosition = () => {
      if (mediaType.startsWith('video/')) void saveProgress(latestVideoTime.current, true);
    };
    window.addEventListener('pagehide', persistPosition);
    return () => {
      window.removeEventListener('pagehide', persistPosition);
      if (mediaType.startsWith('video/')) void saveProgress(latestVideoTime.current, true);
    };
  }, [mediaType, saveProgress]);

  function seekReplay(seconds: number, shouldPlay = true) {
    const maximum = mediaType.startsWith('video/') ? (videoDuration || episode?.durationSeconds || Number.MAX_SAFE_INTEGER) : (episode?.durationSeconds || Number.MAX_SAFE_INTEGER);
    const safeSeconds = Math.max(0, Math.min(seconds, maximum));
    if (mediaType.startsWith('video/') && videoRef.current) {
      videoRef.current.currentTime = safeSeconds;
      latestVideoTime.current = safeSeconds;
      setVideoCurrentTime(safeSeconds);
      if (shouldPlay) void videoRef.current.play().catch(() => undefined);
      return;
    }
    if (currentTrack?.episodeId === episode?.id) {
      seek(safeSeconds);
      if (shouldPlay && !isPlaying) togglePlayback();
      return;
    }
    if (episode && audioUrl) {
      playTrack({ episodeId: episode.id, title: episode.title, showTitle: episode.show.title, creatorName: episode.show.creator.user.displayName, artworkUrl: episode.artworkUrl, url: audioUrl, contentType: mediaType, durationSeconds: episode.durationSeconds, resumeAt: safeSeconds });
    }
  }

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

  async function shareEpisode() {
    if (!episode) return;
    await shareUrl(window.location.href, episode.isLiveReplay ? 'Watch or listen to this VOXA live replay.' : 'Listen to this episode on VOXA.', 'Episode link copied.');
  }

  async function shareReplayMoment(seconds: number) {
    if (!episode || !episode.isLiveReplay || !Number.isFinite(seconds) || seconds < 0) return;
    const url = new URL(window.location.href);
    url.searchParams.set('t', String(Math.floor(seconds)));
    url.searchParams.delete('chapter');
    url.hash = 'replay-player';
    await shareUrl(url.toString(), 'Join this VOXA LIVE replay at ' + formatTime(seconds) + '.', 'Replay moment link copied.');
  }

  async function shareReplayChapter(chapter: { id: string; title: string; startSeconds: number }) {
    if (!episode?.isLiveReplay || !Number.isFinite(chapter.startSeconds) || chapter.startSeconds < 0) return;
    const url = new URL(window.location.href);
    url.searchParams.set('chapter', chapter.id);
    url.searchParams.set('t', String(Math.floor(chapter.startSeconds)));
    url.hash = 'replay-player';
    await shareUrl(url.toString(), 'Watch or listen to "' + chapter.title + '" at ' + formatTime(chapter.startSeconds) + ' in this VOXA LIVE replay.', 'Chapter link copied.');
  }

  async function shareUrl(url: string, text: string, copiedMessage: string) {
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: episode?.title || 'VOXA', text, url });
        setShareStatus('Share sheet opened.');
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setShareStatus(copiedMessage);
      } else {
        setShareStatus('Sharing is unavailable here. Copy this link: ' + url);
      }
    } catch (reason) {
      if (reason instanceof Error && reason.name === 'AbortError') return;
      setShareStatus('Unable to share right now. Copy the page address instead.');
    }
    window.setTimeout(() => setShareStatus(''), 5000);
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
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))', gap: 24, alignItems: 'center', margin: '2rem 0' }}>
            {episode.artworkUrl
              ? <img src={episode.artworkUrl} alt="" style={{ width: '100%', aspectRatio: '1', objectFit: 'cover', borderRadius: 18 }} />
              : <div style={{ width: '100%', aspectRatio: '1', borderRadius: 18, background: 'linear-gradient(135deg,#29234c,#8b5cf6)', display: 'grid', placeItems: 'center', color: 'white', fontSize: 64, fontWeight: 800 }}>▶</div>}
            <div>
              <p className="eyebrow">{episode.isLiveReplay ? 'VOXA LIVE REPLAY' : 'VOXA EPISODE'}{episode.membershipRequired ? ' · MEMBERS ONLY' : ''}</p>
              <h1 style={{ fontSize: 'clamp(2rem,5vw,3.25rem)', margin: '0.4rem 0' }}>{episode.title}</h1>
              <p style={{ color: 'var(--muted, #a1a1aa)' }}>From <Link href={'/creator/' + encodeURIComponent(episode.show.creator.handle)}>{episode.show.creator.user.displayName}</Link></p>
              <p style={{ lineHeight: 1.7 }}>{episode.description || 'Press play to listen to this episode.'}</p>
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', flexWrap: 'wrap' }}>
                <button className="button small" onClick={() => void toggleBookmark()}>{bookmarked ? 'Saved ✓' : '＋ Save episode'}</button>
                <button className="ghostButton" type="button" onClick={() => void shareEpisode()}>↗ Share {episode.isLiveReplay ? 'replay' : 'episode'}</button>
                {shareStatus && <small role="status" aria-live="polite" style={{ color: 'var(--muted)' }}>{shareStatus}</small>}
              </div>
            </div>
          </div>
          {episode.isLiveReplay && <>
            <nav aria-label="Replay sections" style={{ position: 'sticky', top: 8, zIndex: 5, display: 'flex', gap: 8, overflowX: 'auto', padding: '10px 12px', margin: '0 0 18px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--panel)', scrollbarWidth: 'thin' }}>
              {[['replay-player', 'Replay'], ['replay-chapters', 'Chapters'], ['replay-transcript', 'Transcript'], ['episode-discussion', 'Discussion']].filter(([id]) => id === 'replay-player' ? Boolean(audioUrl) : id === 'replay-chapters' ? chapters.length > 0 : id === 'replay-transcript' ? Boolean(transcript) : true).map(([id, label]) => <a key={id} href={'#' + id} style={{ flex: '0 0 auto', padding: '7px 11px', borderRadius: 8, color: 'inherit', textDecoration: 'none', fontSize: 13, background: 'var(--surface)' }}>{label}</a>)}
            </nav>
            <section aria-label="Live session details" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10, margin: '0 0 24px' }}>
              {[
                { label: 'SESSION TYPE', value: mediaType.startsWith('video/') ? 'Video replay' : 'Audio replay' },
                { label: 'HOST', value: episode.show.creator.user.displayName },
                { label: 'LENGTH', value: episode.durationSeconds ? formatTime(episode.durationSeconds) : 'Duration unavailable' },
                { label: 'CHAPTERS', value: String(chapters.length) },
                { label: 'TRANSCRIPT', value: transcript ? transcript.language.toUpperCase() : 'Not available' },
                { label: 'ACCESS', value: episode.membershipRequired ? 'Members only' : 'Public replay' },
              ].map(item => <div key={item.label} style={{ minWidth: 0, padding: '13px 14px', border: '1px solid var(--line)', borderRadius: 12, background: 'var(--panel)' }}><small className="eyebrow">{item.label}</small><div style={{ marginTop: 7, fontSize: 14, fontWeight: 650, overflowWrap: 'anywhere' }}>{item.value}</div></div>)}
            </section>
          </>}
          {chapters.length > 0 && <section id={episode.isLiveReplay ? 'replay-chapters' : undefined} style={{ scrollMarginTop: 90, marginTop: 26, padding: 22, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--panel)' }}>
            <div className="eyebrow">EPISODE GUIDE</div>
            <h2 style={{ margin: '8px 0 14px' }}>Jump to a chapter.</h2>
            <div style={{ display: 'grid', gap: 8 }}>
              {chapters.map(chapter => <div key={chapter.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', border: '1px solid ' + (selectedChapterId === chapter.id ? 'var(--accent, #8b5cf6)' : 'var(--line)'), borderRadius: 10, background: selectedChapterId === chapter.id ? 'var(--surface)' : 'transparent' }}>
                <button type="button" className="ghostButton" aria-current={selectedChapterId === chapter.id ? 'true' : undefined} onClick={() => { setSelectedChapterId(chapter.id); seekReplay(chapter.startSeconds); }} style={{ display: 'flex', flex: 1, minWidth: 0, alignItems: 'center', justifyContent: 'space-between', textAlign: 'left', padding: '5px 4px' }}>
                  <span><small style={{ color: 'var(--muted)', marginRight: 12, fontVariantNumeric: 'tabular-nums' }}>{String(Math.floor(chapter.startSeconds / 60)).padStart(2, '0')}:{String(chapter.startSeconds % 60).padStart(2, '0')}</small><b>{chapter.title}</b></span><span style={{ color: 'var(--muted)' }}>▶</span>
                </button>
                {episode.isLiveReplay && <button type="button" className="ghostButton" onClick={() => void shareReplayChapter(chapter)} aria-label={'Share chapter ' + chapter.title} style={{ flex: '0 0 auto', padding: '6px 9px', fontSize: 12 }}>↗ Share</button>}
              </div>)}
            </div>
          </section>}
          {intelligence && <section id={episode.isLiveReplay ? 'replay-highlights' : undefined} style={{ scrollMarginTop: 90, marginTop: 30, padding: 22, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--panel)' }}>
            <div className="eyebrow">VOXA EPISODE INTELLIGENCE</div>
            <h2 style={{ margin: '8px 0 12px' }}>The episode, at a glance</h2>
            <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: 14 }}>{intelligence.summary}</p>
            {!!intelligence.topics?.length && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
              {intelligence.topics.map(topic => <span key={topic} style={{ padding: '6px 10px', borderRadius: 999, border: '1px solid var(--line)', fontSize: 12 }}>{topic}</span>)}
            </div>}
            <small style={{ color: 'var(--muted)', display: 'block', marginTop: 14 }}>AI-generated from this episode's transcript.</small>
          </section>}
          {transcript && (episode.isLiveReplay ? <LiveReplayTranscript
            language={transcript.language}
            content={transcript.content}
            segments={transcript.segments}
            currentTime={replayPlaybackTime}
            onSeek={seconds => seekReplay(seconds)}
            onShare={seconds => void shareReplayMoment(seconds)}
            onDiscuss={seconds => {
              setReplayContextSeconds(seconds);
              window.setTimeout(() => document.getElementById('episode-discussion')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
            }}
          /> : <section style={{ marginTop: 32, padding: 22, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--panel)' }}>
            <div className="eyebrow">EPISODE TRANSCRIPT · {transcript.language.toUpperCase()}</div>
            <h2 style={{ margin: '8px 0 14px' }}>Read along.</h2>
            <div style={{ maxHeight: 420, overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.85, fontSize: 14 }}>{transcript.content}</div>
          </section>)}
          {transcriptError && <p style={{ color: 'var(--muted)', fontSize: 12 }}>{transcriptError}</p>}
          {audioUrl && <section id={episode.isLiveReplay ? 'replay-player' : undefined} style={{ scrollMarginTop: 90, border: '1px solid var(--border, #30303a)', background: 'var(--surface, #15151c)', borderRadius: 18, padding: 22 }}>
            {mediaType.startsWith('video/')
              ? <><video
                  ref={videoRef}
                  controls
                  playsInline
                  preload="metadata"
                  src={audioUrl}
                  style={{ width: '100%', maxHeight: 560, borderRadius: 12, background: '#000' }}
                  onLoadedMetadata={() => {
                    if (videoRef.current) { setVideoDuration(Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : 0); videoRef.current.playbackRate = videoPlaybackRate; }
                  }}
                  onPlay={() => { videoHasStarted.current = true; }}
                  onTimeUpdate={() => {
                    if (videoRef.current) { latestVideoTime.current = videoRef.current.currentTime; setVideoCurrentTime(videoRef.current.currentTime); void saveProgress(videoRef.current.currentTime); }
                  }}
                  onPause={() => {
                    if (videoRef.current) void saveProgress(videoRef.current.currentTime, true);
                  }}
                  onEnded={() => { const end = videoRef.current?.duration || 0; latestVideoTime.current = end; void saveProgress(end, true); }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginTop: 12 }}>
                  <button type="button" className="ghostButton" aria-label="Rewind 15 seconds" onClick={() => seekReplay(videoCurrentTime - 15, false)}>−15 sec</button>
                  <button type="button" className="ghostButton" aria-label="Forward 15 seconds" onClick={() => seekReplay(videoCurrentTime + 15, false)}>+15 sec</button>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    Speed
                    <select aria-label="Video playback speed" value={videoPlaybackRate} onChange={event => {
                      const rate = Number(event.target.value);
                      setVideoPlaybackRate(rate);
                      if (videoRef.current) videoRef.current.playbackRate = rate;
                    }} style={{ background: 'var(--panel)', color: 'inherit', border: '1px solid var(--line)', borderRadius: 7, padding: '6px 8px' }}>
                      {[0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
                    </select>
                  </label>
                  <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{formatTime(videoCurrentTime)} / {formatTime(videoDuration)}</span>
                </div>
                <input aria-label="Replay video position" type="range" min="0" max={Math.max(videoDuration, 1)} step="1" value={Math.min(videoCurrentTime, videoDuration || 0)} onChange={event => seekReplay(Number(event.target.value), false)} style={{ width: '100%', marginTop: 10, accentColor: 'var(--accent, #8b5cf6)' }} />
              </>
              : <div style={{ display: 'grid', gap: 12 }}>
                  <div className="episodePlayerActions">
                    <button className="button" onClick={() => playTrack({ episodeId: episode.id, title: episode.title, showTitle: episode.show.title, creatorName: episode.show.creator.user.displayName, artworkUrl: episode.artworkUrl, url: audioUrl, contentType: mediaType, durationSeconds: episode.durationSeconds, resumeAt })}>▶ Play episode</button>
                    <button className="ghostButton" onClick={() => playTrackNext({ episodeId: episode.id, title: episode.title, showTitle: episode.show.title, creatorName: episode.show.creator.user.displayName, artworkUrl: episode.artworkUrl, url: audioUrl, contentType: mediaType, durationSeconds: episode.durationSeconds, resumeAt })}>⇥ Play next</button>
                    <button className="ghostButton" onClick={() => enqueueTrack({ episodeId: episode.id, title: episode.title, showTitle: episode.show.title, creatorName: episode.show.creator.user.displayName, artworkUrl: episode.artworkUrl, url: audioUrl, contentType: mediaType, durationSeconds: episode.durationSeconds, resumeAt })}>＋ Add to queue</button>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="ghostButton" onClick={() => seekReplay((currentTrack?.episodeId === episode.id ? currentTime : resumeAt) - 15, false)}>−15 sec</button>
                    <button type="button" className="ghostButton" onClick={() => seekReplay((currentTrack?.episodeId === episode.id ? currentTime : resumeAt) + 15, false)}>+15 sec</button>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>Speed
                      <select aria-label="Audio playback speed" value={playbackRate} onChange={event => changePlaybackRate(Number(event.target.value))} style={{ background: 'var(--panel)', color: 'inherit', border: '1px solid var(--line)', borderRadius: 7, padding: '6px 8px' }}>
                        {[0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
                      </select>
                    </label>
                  </div>
                </div>}
            <p style={{ color: 'var(--muted, #a1a1aa)', fontSize: 13, marginBottom: 0 }}>
              {mediaType.startsWith('video/') ? 'Replay position: ' + formatTime(videoCurrentTime) : currentTrack?.episodeId === episode.id ? 'Replay position: ' + formatTime(currentTime) : resumeAt > 0 ? 'Resume position: ' + formatTime(resumeAt) : 'Your playback progress is saved when you sign in.'}
              {saving ? ' · Saving progress…' : ''}
            </p>
          </section>}
          <EpisodeCommunity episodeId={episode.id} token={token} replayContextSeconds={episode.isLiveReplay ? replayContextSeconds : null} onReplayContextConsumed={() => setReplayContextSeconds(null)} />
        </>}
      </section>
    </main>
  );
}
