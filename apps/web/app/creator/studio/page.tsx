'use client';

import Link from 'next/link';
import { ChangeEvent, FormEvent, useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type Episode = {
  id: string; title: string; description?: string | null; status: string;
  durationSeconds?: number | null; mediaKey?: string | null;
  mediaAssets: { id: string; status: string; contentType: string }[];
};
type Show = {
  id: string; title: string; description?: string | null; status: string;
  category?: string | null; artworkUrl?: string | null; episodes: Episode[];
};

export default function CreatorStudioPage() {
  const [token, setToken] = useState('');
  const [shows, setShows] = useState<Show[]>([]);
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

  async function request(path: string, init: RequestInit = {}) {
    const response = await fetch(API + path, {
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
    if (!episodeShowId && data?.[0]?.id) setEpisodeShowId(data[0].id);
  }

  useEffect(() => {
    const savedToken = sessionStorage.getItem('voxa_access_token') || '';
    setToken(savedToken);
  }, []);

  useEffect(() => {
    if (!token) return;
    void loadShows().catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load creator studio'));
  }, [token]);

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
      setNotice('Media uploaded. The current release stores the original file; transcoding and adaptive streaming are not yet enabled.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Upload failed'); }
    finally { setUploadingId(''); }
  }

  async function publishShow(showId: string) {
    setBusy(true); setError(''); setNotice('');
    try { await request('/shows/' + encodeURIComponent(showId) + '/publish', { method: 'POST' }); await loadShows(); setNotice('Show published.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to publish show'); }
    finally { setBusy(false); }
  }

  async function publishEpisode(showId: string, episodeId: string) {
    setBusy(true); setError(''); setNotice('');
    try { await request('/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/publish', { method: 'POST' }); await loadShows(); setNotice('Episode published and available to listeners.'); }
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
        {notice && <p style={{ color: '#8ee6b7', fontSize: 12 }}>{notice}</p>}
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
        </div>
        <div className="eyebrow sectionEyebrow">YOUR SHOWS AND EPISODES</div>
        {shows.length ? <div style={{ display: 'grid', gap: 18 }}>
          {shows.map(show => <article key={show.id} style={{ padding: 22, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
              <div><span className="eyebrow">{show.status}</span><h2 style={{ font: '600 22px Space Grotesk', margin: '7px 0' }}>{show.title}</h2><p style={{ color: 'var(--muted)', fontSize: 12 }}>{show.description || 'No show description yet.'}</p></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {show.status !== 'PUBLISHED' && <button className="button small" disabled={busy} onClick={() => void publishShow(show.id)}>Publish show</button>}
                {show.status === 'PUBLISHED' && <Link className="button small" href={'/shows/' + show.id}>View show ↗</Link>}
              </div>
            </div>
            <div style={{ display: 'grid', gap: 10, marginTop: 16 }}>
              {show.episodes.map(episode => <div key={episode.id} style={{ padding: 14, borderRadius: 9, border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div><b style={{ fontSize: 13 }}>{episode.title}</b><small style={{ display: 'block', color: 'var(--muted)', fontSize: 10, marginTop: 5 }}>{episode.status} · {episode.durationSeconds ? Math.floor(episode.durationSeconds / 60) + ' min' : 'Duration not set'} · {episode.mediaKey ? 'Media attached' : 'Media required'}</small></div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {episode.status !== 'PUBLISHED' && <label className="ghostButton" style={{ cursor: 'pointer' }}>{uploadingId === episode.id ? 'Uploading…' : 'Upload media'}<input type="file" accept="audio/*,video/mp4,video/webm,video/quicktime" disabled={uploadingId === episode.id} onChange={event => void uploadMedia(show.id, episode.id, event)} style={{ display: 'none' }} /></label>}
                  {episode.status !== 'PUBLISHED' && <button className="button small" disabled={busy || show.status !== 'PUBLISHED' || !episode.mediaKey || !episode.durationSeconds} onClick={() => void publishEpisode(show.id, episode.id)}>Publish episode</button>}
                  {episode.status === 'PUBLISHED' && <Link className="ghostButton" href={'/episodes/' + episode.id}>Open episode ↗</Link>}
                </div>
              </div>)}
              {!show.episodes.length && <p style={{ color: 'var(--muted)', fontSize: 12 }}>No episodes yet. Use the episode form above to add your first one.</p>}
            </div>
          </article>)}
        </div> : <div className="emptyState"><h3>Your studio is ready</h3><p>Create your first show draft above to begin publishing on VOXA.</p></div>}
      </section>
    </main>
  );
}
