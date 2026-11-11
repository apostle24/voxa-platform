'use client';

import { apiFetch } from '../../../lib/api';
import EpisodeDraftEditor from '../../../components/episode-draft-editor';
import EpisodeTranscriptEditor from '../../../components/episode-transcript-editor';
import EpisodeChaptersEditor from '../../../components/episode-chapters-editor';
import Link from 'next/link';
import { ChangeEvent, FormEvent, useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type Episode = {
  id: string; title: string; description?: string | null; artworkUrl?: string | null; status: string;
  durationSeconds?: number | null; mediaKey?: string | null; membershipRequired: boolean; isLiveReplay?: boolean;
  mediaAssets: { id: string; status: string; contentType: string }[];
};
type MembershipPlan = { id: string; name: string; description?: string | null; priceMinor: number; currency: string; isActive: boolean };
type Show = {
  id: string; title: string; description?: string | null; status: string;
  category?: string | null; artworkUrl?: string | null; episodes: Episode[];
};

export default function CreatorStudioPage() {
  const [token, setToken] = useState('');
  const [shows, setShows] = useState<Show[]>([]);
  const [plans, setPlans] = useState<MembershipPlan[]>([]);
  const [planName, setPlanName] = useState('');
  const [planDescription, setPlanDescription] = useState('');
  const [planPrice, setPlanPrice] = useState('');
  const [momentEpisodeId, setMomentEpisodeId] = useState('');
  const [momentCaption, setMomentCaption] = useState('');
  const [momentStart, setMomentStart] = useState('0');
  const [momentEnd, setMomentEnd] = useState('30');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [episodeShowId, setEpisodeShowId] = useState('');
  const [episodeTitle, setEpisodeTitle] = useState('');
  const [episodeDescription, setEpisodeDescription] = useState('');
  const [duration, setDuration] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploadingId, setUploadingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [publishedEpisodeId, setPublishedEpisodeId] = useState('');
  const [draftPreview, setDraftPreview] = useState<{ episodeId: string; url: string; contentType: string } | null>(null);
  const [editingShowId, setEditingShowId] = useState('');
  const [editShowTitle, setEditShowTitle] = useState('');
  const [editShowDescription, setEditShowDescription] = useState('');
  const [editShowCategory, setEditShowCategory] = useState('');
  const [editShowArtwork, setEditShowArtwork] = useState('');

  async function request(path: string, init: RequestInit = {}) {
    const response = await apiFetch(API + path, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + token, ...init.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'VOXA could not complete that action');
    return data;
  }

  async function loadShows() {
    if (!token) return;
    const data = await request('/creators/me/shows');
    setShows(data || []);
    const eligible = (data || []).flatMap((show: Show) => show.episodes
      .filter(episode => show.status === 'PUBLISHED' && episode.status === 'PUBLISHED' && !episode.membershipRequired
        && episode.mediaAssets?.[0]?.status === 'READY' && episode.mediaAssets?.[0]?.contentType?.startsWith('video/'))
      .map(episode => ({ id: episode.id })));
    if (!momentEpisodeId && eligible[0]?.id) setMomentEpisodeId(eligible[0].id);
    if (!episodeShowId && data?.[0]?.id) setEpisodeShowId(data[0].id);
  }

  async function loadPlans() {
    if (!token) return;
    const data = await request('/creators/me/membership-plans');
    setPlans(data || []);
  }

  async function loadWorkspace() {
    await Promise.all([loadShows(), loadPlans()]);
  }

  useEffect(() => {
    const savedToken = sessionStorage.getItem('voxa_access_token') || '';
    setToken(savedToken);
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadWorkspace().catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load creator studio'));
  }, [token]);

  useEffect(() => {
    const hasProcessingMedia = shows.some(show => show.episodes.some(episode =>
      ['QUEUED', 'PROCESSING'].includes(episode.mediaAssets?.[0]?.status || ''),
    ));
    if (!token || !hasProcessingMedia) return;
    const timer = window.setInterval(() => {
      void loadShows().catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to refresh media processing status'));
    }, 10000);
    return () => window.clearInterval(timer);
  }, [token, shows]);

  async function previewDraft(episodeId: string) {
    setError('');
    try {
      const data = await request('/episodes/' + episodeId + '/draft-preview-url');
      setDraftPreview({ episodeId, url: data.url, contentType: data.contentType || 'audio/mpeg' });
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to preview this replay'); }
  }

  async function createShow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/shows', { method: 'POST', body: JSON.stringify({ title, description, category, language: 'en' }) });
      setTitle(''); setDescription(''); setCategory('');
      await loadShows();
      setNotice('Your show draft has been created.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create show'); }
    finally { setBusy(false); }
  }

  async function createMoment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await request('/episodes/' + encodeURIComponent(momentEpisodeId) + '/moments', {
        method: 'POST',
        body: JSON.stringify({ caption: momentCaption, startSeconds: Number(momentStart), endSeconds: Number(momentEnd) }),
      });
      await request('/moments/' + encodeURIComponent(created.id) + '/publish', { method: 'POST' });
      setMomentCaption('');
      setNotice('Your VOXA Moment is now published. It is available in the Moments feed.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to publish Moment'); }
    finally { setBusy(false); }
  }

  async function createPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/creators/me/membership-plans', {
        method: 'POST',
        body: JSON.stringify({
          name: planName,
          description: planDescription,
          priceMinor: Math.round(Number(planPrice) * 100),
          currency: 'GHS',
        }),
      });
      setPlanName(''); setPlanDescription(''); setPlanPrice('');
      await loadPlans();
      setNotice('Your GHS monthly membership plan is active.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create membership plan'); }
    finally { setBusy(false); }
  }

  async function toggleEpisodeMembership(showId: string, episodeId: string, membershipRequired: boolean) {
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/membership', {
        method: 'PATCH',
        body: JSON.stringify({ membershipRequired: !membershipRequired }),
      });
      await loadShows();
      setNotice(!membershipRequired ? 'Episode access is now limited to active members.' : 'Episode is now publicly accessible.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to change episode access'); }
    finally { setBusy(false); }
  }

  async function createEpisode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!episodeShowId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/shows/' + encodeURIComponent(episodeShowId) + '/episodes', {
        method: 'POST',
        body: JSON.stringify({ title: episodeTitle, description: episodeDescription, durationSeconds: duration ? Number(duration) : undefined }),
      });
      setEpisodeTitle(''); setEpisodeDescription(''); setDuration('');
      await loadShows();
      setNotice('Your episode draft has been created. Upload its audio or video before publishing.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create episode'); }
    finally { setBusy(false); }
  }

  async function uploadMedia(showId: string, episodeId: string, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!['audio/mpeg','audio/mp4','audio/aac','audio/wav','audio/ogg','audio/webm','video/mp4','video/webm','video/quicktime'].includes(file.type)) {
      setError('Choose a supported MP3, M4A, AAC, WAV, OGG, WebM, MP4 or MOV file.');
      return;
    }
    setUploadingId(episodeId); setError(''); setNotice('');
    try {
      const signed = await request('/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/upload-url', {
        method: 'POST', body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
      });
      const upload = await fetch(signed.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!upload.ok) throw new Error('The storage provider rejected the upload. Check the bucket CORS and upload configuration.');
      await request('/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/complete-upload', {
        method: 'POST', body: JSON.stringify({ objectKey: signed.objectKey }),
      });
      await loadShows();
      setNotice('Media uploaded and submitted to the processing queue. This page will refresh its status automatically while processing is underway.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Upload failed'); }
    finally { setUploadingId(''); }
  }

  function beginEditShow(show: Show) {
    setEditingShowId(show.id);
    setEditShowTitle(show.title);
    setEditShowDescription(show.description || '');
    setEditShowCategory(show.category || '');
    setEditShowArtwork(show.artworkUrl || '');
    setError('');
    setNotice('');
  }

  async function saveShowDetails(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingShowId) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/shows/' + encodeURIComponent(editingShowId), {
        method: 'PATCH',
        body: JSON.stringify({
          title: editShowTitle,
          description: editShowDescription,
          category: editShowCategory,
          artworkUrl: editShowArtwork || undefined,
        }),
      });
      setEditingShowId('');
      await loadShows();
      setNotice('Show details saved.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save show details'); }
    finally { setBusy(false); }
  }

  async function publishShow(showId: string) {
    setBusy(true); setError(''); setNotice('');
    try { await request('/shows/' + encodeURIComponent(showId) + '/publish', { method: 'POST' }); await loadShows(); setNotice('Show published.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to publish show'); }
    finally { setBusy(false); }
  }

  async function retryMediaProcessing(showId: string, episodeId: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/retry-processing', { method: 'POST' });
      await loadShows();
      setNotice('Media processing has been queued again. VOXA will refresh its status automatically.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to retry media processing'); }
    finally { setBusy(false); }
  }

  async function unpublishEpisode(showId: string, episodeId: string) {
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/unpublish', { method: 'POST' });
      await loadShows();
      setPublishedEpisodeId('');
      setNotice('Episode unpublished. It is now a private draft and can be edited before publishing again.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to unpublish episode'); }
    finally { setBusy(false); }
  }
  async function publishEpisode(showId: string, episodeId: string) {
    setBusy(true); setError(''); setNotice('');
    try { await request('/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/publish', { method: 'POST' }); await loadShows(); setPublishedEpisodeId(episodeId); setNotice('Episode published and available to listeners.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to publish episode'); }
    finally { setBusy(false); }
  }

  if (!token) return <main className="appShell"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link></nav><section className="communityPage"><div className="emptyState"><h2>Sign in to open Creator Studio</h2><p>Manage your shows, episodes and media uploads from one place.</p><Link className="button small" href="/login">Sign in</Link></div></section></main>;

  return (
    <main className="appShell">
      <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/discover">Discover</Link><Link href="/library">My library</Link><Link href="/creator/earnings">Earnings</Link></div></nav>
      <section className="communityPage" style={{ maxWidth: 1120 }}>
        <div className="eyebrow">CREATOR WORKSPACE</div>
        <h1 style={{ fontSize: 'clamp(34px,5vw,54px)', letterSpacing: -2, margin: '12px 0' }}>Creator Studio.</h1>
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>Create a show, publish episodes and manage your audio or video uploads.</p>
        {error && <p className="errorText">{error}</p>}
        {notice && <div style={{ color: '#8ee6b7', fontSize: 12, margin: '12px 0' }}><p>{notice}</p>{publishedEpisodeId && <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}><Link className="textLink" href={'/episodes/' + publishedEpisodeId}>Open published episode ↗</Link><Link className="textLink" href="/discover">View in Discover ↗</Link></div>}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16, margin: '28px 0 40px' }}>
          <form className="createPanel" onSubmit={createShow}>
            <div className="eyebrow">01 · NEW SHOW</div><h2>Create a <em>show.</em></h2>
            <label>Show title<input required minLength={2} maxLength={100} value={title} onChange={event => setTitle(event.target.value)} placeholder="The conversations that matter" /></label>
            <label>Description<textarea rows={3} maxLength={2000} value={description} onChange={event => setDescription(event.target.value)} placeholder="What is this show about?" /></label>
            <label>Category<input value={category} maxLength={60} onChange={event => setCategory(event.target.value)} placeholder="Faith, business, culture…" /></label>
            <button className="button full" disabled={busy}>{busy ? 'Please wait…' : 'Create show draft'}</button>
          </form>
          <form className="createPanel" onSubmit={createEpisode}>
            <div className="eyebrow">02 · NEW EPISODE</div><h2>Add an <em>episode.</em></h2>
            <label>Choose show<select required value={episodeShowId} onChange={event => setEpisodeShowId(event.target.value)} style={{ background: '#090a10', border: '1px solid #303244', borderRadius: 7, color: 'white', padding: 12 }}><option value="">Select a show</option>{shows.map(show => <option key={show.id} value={show.id}>{show.title}</option>)}</select></label>
            <label>Episode title<input required minLength={2} maxLength={120} value={episodeTitle} onChange={event => setEpisodeTitle(event.target.value)} placeholder="Episode one" /></label>
            <label>Description<textarea rows={3} maxLength={3000} value={episodeDescription} onChange={event => setEpisodeDescription(event.target.value)} placeholder="What will listeners learn?" /></label>
            <label>Duration in seconds<input type="number" min={1} max={86400} value={duration} onChange={event => setDuration(event.target.value)} placeholder="Example: 1800" /></label>
            <button className="button full" disabled={busy || !shows.length}>{busy ? 'Please wait…' : 'Create episode draft'}</button>
          </form>
          <form className="createPanel" onSubmit={createPlan}>
            <div className="eyebrow">03 · CREATOR MEMBERSHIP</div><h2>Offer <em>membership.</em></h2>
            <label>Plan name<input required minLength={2} maxLength={40} value={planName} onChange={event => setPlanName(event.target.value)} placeholder="Supporter" /></label>
            <label>Description<textarea rows={3} maxLength={300} value={planDescription} onChange={event => setPlanDescription(event.target.value)} placeholder="What members receive" /></label>
            <label>Monthly price (GHS)<input required type="number" min="0.01" step="0.01" max="1000000" value={planPrice} onChange={event => setPlanPrice(event.target.value)} placeholder="25.00" /></label>
            <small>Creator membership checkout currently supports GHS only. VOXA's 15% commission is calculated server-side; provider fees are accounted separately.</small>
            <button className="button full" disabled={busy}>{busy ? 'Please wait…' : 'Create membership plan'}</button>
          </form>
        </div>
        {plans.length > 0 && <><div className="eyebrow sectionEyebrow">YOUR MEMBERSHIP PLANS</div><div className="membershipGrid">{plans.map(plan => <article className="membershipCard" key={plan.id}><span>{plan.isActive ? 'ACTIVE PLAN' : 'INACTIVE PLAN'}</span><h3>{plan.name}</h3><p>{plan.description || 'Monthly creator membership'}</p><strong>{new Intl.NumberFormat(undefined, { style: 'currency', currency: plan.currency }).format(plan.priceMinor / 100)} <small>/ month</small></strong></article>)}</div></>}
        <div className="eyebrow sectionEyebrow">CREATE A VOXA MOMENT</div>
        <form className="createPanel" onSubmit={createMoment} style={{ maxWidth: 720, marginBottom: 28 }}>
          <h2>Turn a highlight into a <em>Moment.</em></h2>
          <label>Published public video episode
            <select required value={momentEpisodeId} onChange={event => setMomentEpisodeId(event.target.value)}>
              <option value="">Select a ready video episode</option>
              {shows.flatMap(show => show.episodes
                .filter(episode => show.status === 'PUBLISHED' && episode.status === 'PUBLISHED' && !episode.membershipRequired
                  && episode.mediaAssets?.[0]?.status === 'READY' && episode.mediaAssets?.[0]?.contentType?.startsWith('video/'))
                .map(episode => <option key={episode.id} value={episode.id}>{show.title} — {episode.title}</option>))}
            </select>
          </label>
          <label>Caption<input required minLength={1} maxLength={500} value={momentCaption} onChange={event => setMomentCaption(event.target.value)} placeholder="The key insight from this conversation…" /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label>Start (seconds)<input required type="number" min={0} value={momentStart} onChange={event => setMomentStart(event.target.value)} /></label>
            <label>End (seconds)<input required type="number" min={1} value={momentEnd} onChange={event => setMomentEnd(event.target.value)} /></label>
          </div>
          <small>Moments are limited to 90 seconds and can only use fully processed public video episodes. Members-only source episodes are excluded.</small>
          <button className="button full" disabled={busy || !momentEpisodeId || !momentCaption.trim() || Number(momentEnd) <= Number(momentStart) || Number(momentEnd) - Number(momentStart) > 90}>{busy ? 'Publishing…' : 'Publish Moment'}</button>
          <p><Link className="textLink" href="/moments">View the Moments feed ↗</Link></p>
        </form>
        <div className="eyebrow sectionEyebrow">YOUR SHOWS AND EPISODES</div>
        {shows.length ? <div style={{ display: 'grid', gap: 18 }}>
          {shows.map(show => <article key={show.id} style={{ padding: 22, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div><span className="eyebrow">{show.status}</span><h2 style={{ font: '600 22px Space Grotesk', margin: '7px 0' }}>{show.title}</h2><p style={{ color: 'var(--muted)', fontSize: 12 }}>{show.description || 'No show description yet.'}</p></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="ghostButton" disabled={busy} onClick={() => editingShowId === show.id ? setEditingShowId('') : beginEditShow(show)}>{editingShowId === show.id ? 'Close editor' : 'Edit show details'}</button>
                {show.status !== 'PUBLISHED' && <button className="button small" disabled={busy} onClick={() => void publishShow(show.id)}>Publish show</button>}
                {show.status === 'PUBLISHED' && <Link className="button small" href={'/shows/' + show.id}>View show ↗</Link>}
              </div>
            </div>
            {editingShowId === show.id && <form className="createPanel" onSubmit={saveShowDetails} style={{ marginTop: 18 }}>
              <h3>Edit show details</h3>
              <label>Title<input required minLength={2} maxLength={120} value={editShowTitle} onChange={event => setEditShowTitle(event.target.value)} /></label>
              <label>Description<textarea rows={3} maxLength={4000} value={editShowDescription} onChange={event => setEditShowDescription(event.target.value)} /></label>
              <label>Category<input maxLength={80} value={editShowCategory} onChange={event => setEditShowCategory(event.target.value)} /></label>
              <label>Artwork URL<input type="url" maxLength={2048} value={editShowArtwork} onChange={event => setEditShowArtwork(event.target.value)} placeholder="https://…" /></label>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button type="button" className="ghostButton" onClick={() => setEditingShowId('')}>Cancel</button>
                <button className="button small" disabled={busy || editShowTitle.trim().length < 2}>{busy ? 'Saving…' : 'Save show details'}</button>
              </div>
            </form>}
            <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
              {show.episodes.map(episode => <div id={'episode-' + episode.id} key={episode.id} style={{ padding: 14, borderRadius: 9, border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div><b style={{ fontSize: 13 }}>{episode.title}</b>{episode.isLiveReplay && <span style={{ display: 'inline-flex', marginLeft: 8, padding: '3px 7px', borderRadius: 5, background: 'rgba(143,105,255,.14)', color: '#b9a5ff', fontSize: 9, fontWeight: 700, letterSpacing: '.08em' }}>LIVE REPLAY</span>}<small style={{ display: 'block', color: 'var(--muted)', fontSize: 10, marginTop: 5 }}>{episode.status} · {episode.durationSeconds ? Math.floor(episode.durationSeconds / 60) + ' min' : 'Duration not set'} · {episode.mediaAssets?.[0]?.status ? 'Media ' + episode.mediaAssets[0].status.toLowerCase() : episode.mediaKey ? 'Media processing status unavailable' : 'Media required'}</small>{episode.isLiveReplay && episode.status !== 'PUBLISHED' && <small style={{ display: 'block', color: 'var(--muted)', fontSize: 11, marginTop: 7 }}>This recording is private until you review its details and publish it. Preview the processed replay before publishing.</small>}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {episode.status !== 'PUBLISHED' && <label className="ghostButton" style={{ cursor: 'pointer' }}>{uploadingId === episode.id ? 'Uploading…' : 'Upload media'}<input type="file" accept="audio/*,video/mp4,video/webm,video/quicktime" disabled={uploadingId === episode.id} onChange={event => void uploadMedia(show.id, episode.id, event)} style={{ display: 'none' }} /></label>}
                  <button className="ghostButton" disabled={busy || plans.length === 0 || episode.status === 'PUBLISHED'} onClick={() => void toggleEpisodeMembership(show.id, episode.id, episode.membershipRequired)}>{episode.membershipRequired ? 'Members only ✓' : 'Make members only'}</button>
                  {episode.status !== 'PUBLISHED' && episode.mediaAssets?.[0]?.status === 'FAILED' && <button className="button small" disabled={busy} onClick={() => void retryMediaProcessing(show.id, episode.id)}>Retry processing</button>}
                  {episode.status !== 'PUBLISHED' && <button className="button small" disabled={busy || show.status !== 'PUBLISHED' || !episode.mediaKey || !episode.durationSeconds || episode.mediaAssets?.[0]?.status !== 'READY'} onClick={() => void publishEpisode(show.id, episode.id)}>{episode.mediaAssets?.[0]?.status === 'READY' ? 'Publish episode' : 'Media processing…'}</button>}
                  {episode.status === 'PUBLISHED' && <><Link className="ghostButton" href={'/episodes/' + episode.id}>Open episode ↗</Link><button className="ghostButton" disabled={busy} onClick={() => void unpublishEpisode(show.id, episode.id)}>Unpublish</button></>}
                  {episode.status !== 'PUBLISHED' && episode.mediaAssets?.[0]?.status === 'READY' && <button className="ghostButton" onClick={() => void previewDraft(episode.id)}>Preview replay</button>}
                  {draftPreview?.episodeId === episode.id && (draftPreview.contentType.startsWith('video/') ? <video controls playsInline preload="metadata" src={draftPreview.url} style={{ width: '100%', maxHeight: 420, borderRadius: 10, background: '#000' }} /> : <audio controls preload="metadata" src={draftPreview.url} style={{ width: '100%' }} />)}
                </div>
                {episode.status !== 'PUBLISHED' && <EpisodeDraftEditor showId={show.id} episode={episode} onSaved={() => { void loadShows(); setNotice('Episode draft details saved.'); }} />}
                <EpisodeTranscriptEditor showId={show.id} episodeId={episode.id} />
                <EpisodeChaptersEditor showId={show.id} episodeId={episode.id} durationSeconds={episode.durationSeconds} />
              </div>)}
              {!show.episodes.length && <p style={{ color: 'var(--muted)', fontSize: 12 }}>No episodes yet. Use the episode form above to add your first one.</p>}
            </div>
          </article>)}
        </div> : <div className="emptyState"><h3>Your studio is ready</h3><p>Create your first show draft above to begin publishing on VOXA.</p></div>}
      </section>
    </main>
  );
}
