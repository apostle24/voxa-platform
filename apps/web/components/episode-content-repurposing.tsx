'use client';

import { useState } from 'react';
import { apiFetch } from '../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\\/$/, '');

type SocialPost = { platform: string; text: string };
type ContentPack = {
  episodeId: string;
  socialPosts: SocialPost[];
  keyTakeaways: string[];
  quoteCandidates: { quote: string; context: string }[];
  newsletter: { subject: string; preview: string; body: string };
  blogDraft: { title: string; excerpt: string; body: string };
  sourceNote: string;
};

type Props = { showId: string; episodeId: string };

export default function EpisodeContentRepurposing({ showId, episodeId }: Props) {
  const [pack, setPack] = useState<ContentPack | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function generate() {
    setLoading(true); setError(''); setNotice('');
    try {
      const token = sessionStorage.getItem('voxa_access_token') || '';
      const response = await apiFetch(API + '/shows/' + encodeURIComponent(showId) + '/episodes/' + encodeURIComponent(episodeId) + '/content-pack', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || 'Unable to create content pack');
      setPack(data);
      setNotice('Content pack generated. Edit any draft below before copying it.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create content pack'); }
    finally { setLoading(false); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); }
    catch { setError('Clipboard access was blocked by this browser. Select and copy the text manually.'); }
  }

  function updateSocial(index: number, text: string) {
    if (!pack) return;
    setPack({ ...pack, socialPosts: pack.socialPosts.map((post, i) => i === index ? { ...post, text } : post) });
  }

  return <section style={{ flexBasis: '100%', padding: 14, border: '1px solid var(--line)', borderRadius: 9, background: 'rgba(65,160,145,.055)' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
      <div><span className="eyebrow">VOXA CREATOR · CONTENT STUDIO</span><h3 style={{ margin: '5px 0' }}>Repurpose this episode</h3><small style={{ color: 'var(--muted)' }}>Create editable social posts, takeaways, quote candidates, a newsletter and a blog draft.</small></div>
      <button type="button" className="button small" disabled={loading} onClick={() => void generate()}>{loading ? 'Creating…' : pack ? 'Regenerate pack' : 'Create content pack'}</button>
    </div>
    {error && <p className="errorText">{error}</p>}
    {notice && <p style={{ color: '#8ee6b7', fontSize: 12 }}>{notice}</p>}
    {pack && <div style={{ display: 'grid', gap: 16, marginTop: 14 }}>
      <small style={{ color: 'var(--muted)' }}>{pack.sourceNote}</small>
      <div><b style={{ fontSize: 12 }}>Social posts</b>{pack.socialPosts.map((post, index) => <article key={index} style={{ marginTop: 9, padding: 10, border: '1px solid var(--line)', borderRadius: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><b style={{ fontSize: 12 }}>{post.platform}</b><button type="button" className="ghostButton" onClick={() => void copy(post.text)}>Copy</button></div>
        <textarea rows={4} value={post.text} onChange={event => updateSocial(index, event.target.value)} style={{ width: '100%', marginTop: 8, resize: 'vertical' }} />
      </article>)}</div>
      <div><b style={{ fontSize: 12 }}>Key takeaways</b><ul style={{ paddingLeft: 18, fontSize: 13, lineHeight: 1.7 }}>{pack.keyTakeaways.map((item, i) => <li key={i}>{item}</li>)}</ul><button type="button" className="ghostButton" onClick={() => void copy(pack.keyTakeaways.map((v, i) => (i + 1) + '. ' + v).join('\n'))}>Copy takeaways</button></div>
      <div><b style={{ fontSize: 12 }}>Quote candidates</b>{pack.quoteCandidates.length ? pack.quoteCandidates.map((item, i) => <article key={i} style={{ marginTop: 8, padding: 10, borderLeft: '2px solid var(--accent)', background: 'var(--panel)' }}><p style={{ fontSize: 13, margin: '0 0 6px' }}>“{item.quote}”</p><small style={{ color: 'var(--muted)' }}>{item.context}</small><div><button type="button" className="ghostButton" style={{ marginTop: 6 }} onClick={() => void copy(item.quote)}>Copy quote</button></div></article>) : <small style={{ color: 'var(--muted)' }}>No direct quotes generated because a transcript was unavailable.</small>}</div>
      <div><b style={{ fontSize: 12 }}>Newsletter draft</b><label style={{ display: 'block', fontSize: 11, marginTop: 8 }}>Subject<input value={pack.newsletter.subject} onChange={event => setPack({ ...pack, newsletter: { ...pack.newsletter, subject: event.target.value } })} /></label><label style={{ display: 'block', fontSize: 11, marginTop: 8 }}>Preview<input value={pack.newsletter.preview} onChange={event => setPack({ ...pack, newsletter: { ...pack.newsletter, preview: event.target.value } })} /></label><label style={{ display: 'block', fontSize: 11, marginTop: 8 }}>Body<textarea rows={7} value={pack.newsletter.body} onChange={event => setPack({ ...pack, newsletter: { ...pack.newsletter, body: event.target.value } })} style={{ width: '100%' }} /></label><button type="button" className="ghostButton" onClick={() => void copy(pack.newsletter.subject + '\n\n' + pack.newsletter.preview + '\n\n' + pack.newsletter.body)}>Copy newsletter</button></div>
      <div><b style={{ fontSize: 12 }}>Blog draft</b><label style={{ display: 'block', fontSize: 11, marginTop: 8 }}>Title<input value={pack.blogDraft.title} onChange={event => setPack({ ...pack, blogDraft: { ...pack.blogDraft, title: event.target.value } })} /></label><label style={{ display: 'block', fontSize: 11, marginTop: 8 }}>Excerpt<textarea rows={2} value={pack.blogDraft.excerpt} onChange={event => setPack({ ...pack, blogDraft: { ...pack.blogDraft, excerpt: event.target.value } })} style={{ width: '100%' }} /></label><label style={{ display: 'block', fontSize: 11, marginTop: 8 }}>Article<textarea rows={10} value={pack.blogDraft.body} onChange={event => setPack({ ...pack, blogDraft: { ...pack.blogDraft, body: event.target.value } })} style={{ width: '100%' }} /></label><button type="button" className="ghostButton" onClick={() => void copy(pack.blogDraft.title + '\n\n' + pack.blogDraft.excerpt + '\n\n' + pack.blogDraft.body)}>Copy blog draft</button></div>
      <small style={{ color: 'var(--muted)' }}>Drafts remain in this editor session until you copy them. Review factual accuracy, direct quotes and platform requirements before publishing. VOXA does not post or email on your behalf.</small>
    </div>}
  </section>;
}
