'use client';

import { FormEvent, useState } from 'react';
import { apiFetch } from '../../../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type Props = {
  showId: string;
  episode: { id: string; title: string; description?: string | null; artworkUrl?: string | null; durationSeconds?: number | null };
  onSaved: () => void;
};

export default function EpisodeDraftEditor({ showId, episode, onSaved }: Props) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(episode.title);
  const [description, setDescription] = useState(episode.description || '');
  const [artworkUrl, setArtworkUrl] = useState(episode.artworkUrl || '');
  const [duration, setDuration] = useState(episode.durationSeconds ? String(episode.durationSeconds) : '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setSaving(true); setError('');
    try {
      const response = await apiFetch(API + '/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episode.id), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({
          title, description, artworkUrl: artworkUrl || undefined,
          durationSeconds: duration ? Number(duration) : undefined,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to save episode details');
      setOpen(false);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to save episode details');
    } finally { setSaving(false); }
  }

  return <div style={{ flexBasis: '100%' }}>
    <button type="button" className="ghostButton" onClick={() => setOpen(value => !value)}>{open ? 'Close editor' : 'Edit draft details'}</button>
    {open && <form className="createPanel" onSubmit={save} style={{ marginTop: 12 }}>
      <h3>Edit episode draft</h3>
      <label>Episode title<input required minLength={2} maxLength={160} value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Description<textarea rows={3} maxLength={8000} value={description} onChange={event => setDescription(event.target.value)} /></label>
      <label>Artwork URL<input type="url" maxLength={2048} value={artworkUrl} onChange={event => setArtworkUrl(event.target.value)} placeholder="https://…" /></label>
      <label>Duration in seconds<input type="number" min={1} max={43200} value={duration} onChange={event => setDuration(event.target.value)} /></label>
      {error && <p className="errorText">{error}</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="button small" disabled={saving || title.trim().length < 2}>{saving ? 'Saving…' : 'Save episode details'}</button>
      </div>
      <small>Published episodes are locked from editing in this release.</small>
    </form>}
  </div>;
}
