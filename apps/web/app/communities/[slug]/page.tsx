'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch } from '../../../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/[/]$/, '');
type Reply = { id: string; content: string; createdAt: string; author: { id: string; displayName: string } };
type Post = { id: string; content: string; createdAt: string; author: { id: string; displayName: string }; comments: Reply[] };
type Community = { id: string; name: string; slug: string; description?: string | null; category?: string | null; artworkUrl?: string | null; owner: { id: string; displayName: string }; _count: { members: number; posts: number } };
type BlockedUser = { blockedUserId: string; blockedUser: { displayName: string; creator?: { handle: string } | null } };

export default function CommunityDetailPage() {
  const params = useParams<{ slug: string }>();
  const [community, setCommunity] = useState<Community | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [content, setContent] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [joined, setJoined] = useState(false);
  const [role, setRole] = useState('');
  const [userId, setUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyPost, setBusyPost] = useState('');
  const [reportReason, setReportReason] = useState<Record<string, string>>({});
  const [reporting, setReporting] = useState('');
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const [blocking, setBlocking] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function request(path: string, init: RequestInit = {}) {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) throw new Error('Sign in to continue.');
    const response = await apiFetch(API + path, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + token, ...init.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'VOXA could not complete that action');
    return data;
  }

  async function load() {
    const response = await fetch(API + '/communities/' + encodeURIComponent(params.slug));
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Community not found');
    setCommunity(data);
    const token = sessionStorage.getItem('voxa_access_token') || '';
    let isJoined = false;
    if (token) {
      try {
        const blocked = await request('/users/me/blocked');
        setBlockedUsers(Array.isArray(blocked) ? blocked : []);
      } catch { setBlockedUsers([]); }
      try {
        const membership = await request('/communities/' + data.id + '/membership');
        isJoined = Boolean(membership.joined);
        setJoined(isJoined);
        setRole(membership.role || '');
        const user = JSON.parse(sessionStorage.getItem('voxa_user') || 'null');
        setUserId(user?.id || '');
      } catch { setJoined(false); setRole(''); }
    } else { setJoined(false); setRole(''); }
    if (isJoined) {
      const discussion = await request('/communities/' + data.id + '/posts');
      setPosts(Array.isArray(discussion) ? discussion : []);
    } else setPosts([]);
  }

  useEffect(() => {
    void load().catch(e => setError(e instanceof Error ? e.message : 'Unable to load community'));
  }, [params.slug]);

  async function membership() {
    if (!community) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/communities/' + community.id + '/join', { method: joined ? 'DELETE' : 'POST' });
      setNotice(joined ? 'You left this community.' : 'You joined this community.');
      await load();
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to update membership'); }
    finally { setBusy(false); }
  }

  async function post(event: FormEvent) {
    event.preventDefault();
    if (!community) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request('/communities/' + community.id + '/posts', { method: 'POST', body: JSON.stringify({ content }) });
      setContent(''); setNotice('Your post has been published.');
      await load();
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to publish post'); }
    finally { setBusy(false); }
  }

  async function reply(event: FormEvent, postId: string) {
    event.preventDefault();
    if (!community) return;
    const value = (replyDrafts[postId] || '').trim();
    if (!value) return;
    setBusyPost(postId); setError(''); setNotice('');
    try {
      await request('/communities/' + community.id + '/posts/' + postId + '/comments', { method: 'POST', body: JSON.stringify({ content: value }) });
      setReplyDrafts(current => ({ ...current, [postId]: '' }));
      const discussion = await request('/communities/' + community.id + '/posts');
      setPosts(discussion || []);
      setNotice('Your reply has been added.');
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to add reply'); }
    finally { setBusyPost(''); }
  }

  async function blockUser(targetUserId: string) {
    setBlocking(targetUserId); setError(''); setNotice('');
    try {
      await request('/users/' + encodeURIComponent(targetUserId) + '/block', { method: 'POST' });
      setNotice('Account blocked. Their posts and replies will no longer appear in your community feed.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to block account'); }
    finally { setBlocking(''); }
  }

  async function unblockUser(targetUserId: string) {
    setBlocking(targetUserId); setError(''); setNotice('');
    try {
      await request('/users/' + encodeURIComponent(targetUserId) + '/block', { method: 'DELETE' });
      setNotice('Account unblocked.');
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to unblock account'); }
    finally { setBlocking(''); }
  }

  async function reportUser(targetUserId: string) {
    setReporting(targetUserId); setError(''); setNotice('');
    try {
      const result = await request('/reports', { method: 'POST', body: JSON.stringify({ targetType: 'USER', targetId: targetUserId, reason: 'OTHER' }) });
      setNotice(result.duplicate ? 'You have already reported this account recently.' : 'Account submitted for review.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to report account'); }
    finally { setReporting(''); }
  }

  async function reportPost(postId: string) {
    setReporting(postId); setError(''); setNotice('');
    try {
      const result = await request('/reports', { method: 'POST', body: JSON.stringify({ targetType: 'COMMUNITY_POST', targetId: postId, reason: reportReason[postId] || 'OTHER' }) });
      setNotice(result.duplicate ? 'You have already reported this post recently.' : 'Thank you. This post has been submitted for review.');
    } catch(e) { setError(e instanceof Error ? e.message : 'Unable to report post'); }
    finally { setReporting(''); }
  }

  return <main className="appShell"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/communities">All communities</Link><Link href="/discover">Discover</Link><Link href="/creator/studio">Creator Studio</Link></div></nav>
    <section className="communityPage" style={{ maxWidth: 900 }}>
      <Link href="/communities" className="textLink">← All communities</Link>
      {!community && !error && <p>Loading community…</p>}
      {error && <p className="errorText" role="alert">{error}</p>}{notice && <p className="successText" role="status">{notice}</p>}
      {community && <>
        {community.artworkUrl && <img src={community.artworkUrl} alt="" style={{ width: '100%', maxHeight: 250, objectFit: 'cover', borderRadius: 12, marginTop: 20 }} />}
        <div className="eyebrow" style={{ marginTop: 24 }}>{community.category || 'VOXA COMMUNITY'}</div>
        <h1 style={{ fontSize: 'clamp(36px,5vw,56px)', letterSpacing: -2, margin: '12px 0' }}>{community.name}</h1>
        <p style={{ color: 'var(--muted)' }}>{community.description || 'A place to connect around shared interests.'}</p>
        <small>{community._count.members} members · {community._count.posts} posts · Created by {community.owner.displayName}</small>
        <div style={{ margin: '20px 0' }}>
          <button className="button" disabled={busy || role === 'OWNER'} onClick={() => void membership()}>{busy ? 'Please wait…' : joined ? (role === 'OWNER' ? 'You own this community' : 'Leave community') : 'Join community'}</button>
          {role === 'OWNER' && <Link className="ghostButton" href="/creator/audience" style={{ marginLeft: 10 }}>Manage members ↗</Link>}
        </div>
        {!joined ? <div className="emptyState"><h3>Join the conversation</h3><p>Become a member to read discussions, publish posts and reply to other members.</p></div> : <>
          {blockedUsers.length > 0 && <section style={{ margin: '20px 0', padding: 16, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--panel)' }}><strong>Blocked accounts ({blockedUsers.length})</strong><p style={{ color: 'var(--muted)', fontSize: 12 }}>Manage accounts hidden from your community conversations.</p>{blockedUsers.map(item => <div key={item.blockedUserId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '8px 0' }}><span>{item.blockedUser.displayName}</span><button className="ghostButton" disabled={blocking === item.blockedUserId} onClick={() => void unblockUser(item.blockedUserId)}>{blocking === item.blockedUserId ? 'Working…' : 'Unblock'}</button></div>)}</section>}
          <form onSubmit={post} style={{ display: 'grid', gap: 10, margin: '28px 0' }}>
            <h2>Start a conversation</h2><textarea value={content} onChange={e => setContent(e.target.value)} maxLength={5000} rows={4} placeholder="Share an idea with the community…" required />
            <button className="button" disabled={busy || !content.trim()}>{busy ? 'Publishing…' : 'Publish post'}</button>
          </form>
          <div className="eyebrow">COMMUNITY CONVERSATION</div>
          {posts.map(item => <article key={item.id} className="creatorShowCard" style={{ marginTop: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><strong>{item.author.displayName}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></div>
            <p style={{ whiteSpace: 'pre-wrap' }}>{item.content}</p>
            <div style={{ borderTop: '1px solid var(--line)', marginTop: 14, paddingTop: 12 }}>
              <strong>Replies ({item.comments?.length || 0})</strong>
              {(item.comments || []).map(comment => <div key={comment.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
                <strong>{comment.author.displayName}</strong><small style={{ marginLeft: 10 }}>{new Date(comment.createdAt).toLocaleString()}</small>
                <p style={{ margin: '6px 0', whiteSpace: 'pre-wrap' }}>{comment.content}</p>
              </div>)}
              <form onSubmit={event => void reply(event, item.id)} style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <input aria-label="Write a reply" value={replyDrafts[item.id] || ''} onChange={event => setReplyDrafts(current => ({ ...current, [item.id]: event.target.value }))} placeholder="Write a reply…" maxLength={5000} style={{ flex: 1, minWidth: 180 }} />
                <button className="button small" disabled={busyPost === item.id || !(replyDrafts[item.id] || '').trim()}>{busyPost === item.id ? 'Sending…' : 'Reply'}</button>
              </form>
            </div>
            {item.author.id !== userId && <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
              <label><span className="srOnly">Report reason</span><select aria-label="Report reason" value={reportReason[item.id] || 'OTHER'} onChange={event => setReportReason(current => ({ ...current, [item.id]: event.target.value }))}>
                <option value="OTHER">Other</option><option value="HARASSMENT">Harassment</option><option value="HATE">Hate</option><option value="VIOLENCE">Violence</option><option value="SEXUAL_CONTENT">Sexual content</option><option value="SPAM">Spam</option><option value="COPYRIGHT">Copyright</option><option value="SELF_HARM">Self-harm</option>
              </select></label>
              <button className="ghostButton" disabled={reporting === item.id} onClick={() => void reportPost(item.id)}>{reporting === item.id ? 'Submitting…' : 'Report post'}</button>
              <button className="ghostButton" disabled={blocking === item.author.id || blockedUsers.some(user => user.blockedUserId === item.author.id)} onClick={() => void blockUser(item.author.id)}>{blocking === item.author.id ? 'Blocking…' : blockedUsers.some(user => user.blockedUserId === item.author.id) ? 'Blocked' : 'Block author'}</button>
              <button className="ghostButton" disabled={reporting === item.author.id} onClick={() => void reportUser(item.author.id)}>{reporting === item.author.id ? 'Submitting…' : 'Report account'}</button>
            </div>}
          </article>)}
          {!posts.length && <div className="emptyState"><p>No posts yet. Be the first to start a conversation.</p></div>}
        </>}
      </>}
    </section>
  </main>;
}
