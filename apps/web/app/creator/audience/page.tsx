'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\\/$/, '');

type Follower = { id: string; displayName: string; createdAt: string; followedAt: string };
type Community = { id: string; name: string; slug: string; description?: string | null; category?: string | null; _count: { members: number; posts: number } };
type Member = { id: string; displayName: string; createdAt: string; role: string; joinedAt: string };

export default function CreatorAudiencePage() {
  const [token, setToken] = useState('');
  const [followers, setFollowers] = useState<Follower[]>([]);
  const [followerTotal, setFollowerTotal] = useState(0);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [selected, setSelected] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [memberTotal, setMemberTotal] = useState(0);
  const [followerQuery, setFollowerQuery] = useState('');
  const [memberQuery, setMemberQuery] = useState('');
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function request(path: string, init: RequestInit = {}) {
    const response = await apiFetch(API + path, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), Authorization: 'Bearer ' + token, ...init.headers },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || 'VOXA could not complete that action');
    return data;
  }

  async function loadAudience(query = followerQuery) {
    const data = await request('/creators/me/audience' + (query.trim() ? '?q=' + encodeURIComponent(query.trim()) : ''));
    setFollowers(data.followers || []);
    setFollowerTotal(data.total || 0);
  }

  async function loadCommunities() {
    const data = await request('/communities/me/owned');
    setCommunities(data || []);
    if (!selected && data?.[0]?.id) setSelected(data[0].id);
  }

  async function loadMembers(communityId = selected, query = memberQuery) {
    if (!communityId) { setMembers([]); setMemberTotal(0); return; }
    const data = await request('/communities/' + encodeURIComponent(communityId) + '/members' + (query.trim() ? '?q=' + encodeURIComponent(query.trim()) : ''));
    setMembers(data.members || []);
    setMemberTotal(data.total || 0);
  }

  async function refresh() {
    await Promise.all([loadAudience(''), loadCommunities()]);
  }

  useEffect(() => {
    setToken(sessionStorage.getItem('voxa_access_token') || '');
  }, []);

  useEffect(() => {
    if (!token) return;
    void refresh().catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load audience workspace'));
  }, [token]);

  useEffect(() => {
    if (!token || !selected) return;
    void loadMembers(selected, '').catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load community members'));
  }, [token, selected]);

  async function removeMember(member: Member) {
    if (!selected || member.role === 'OWNER') return;
    if (!window.confirm('Remove ' + member.displayName + ' from this community?')) return;
    setBusyId(member.id); setError(''); setNotice('');
    try {
      await request('/communities/' + encodeURIComponent(selected) + '/members/' + encodeURIComponent(member.id), { method: 'DELETE' });
      await Promise.all([loadMembers(selected), loadCommunities()]);
      setNotice(member.displayName + ' was removed from the community.');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to remove community member'); }
    finally { setBusyId(''); }
  }

  async function searchFollowers(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try { await loadAudience(followerQuery); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to search followers'); }
  }

  async function searchMembers(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    try { await loadMembers(selected, memberQuery); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to search members'); }
  }

  return <main className="pageShell">
    <div className="pageHeader">
      <div><div className="eyebrow">CREATOR WORKSPACE</div><h1>Audience & communities</h1><p>See who follows your creator profile and manage membership in communities you own.</p></div>
      <Link className="ghostButton" href="/creator/studio">Back to Creator Studio</Link>
    </div>
    {error && <p className="errorText" role="alert">{error}</p>}
    {notice && <p className="successText" role="status">{notice}</p>}
    <section className="contentPanel">
      <div className="sectionHeading"><div><div className="eyebrow">YOUR AUDIENCE</div><h2>Followers <span className="mutedText">({followerTotal})</span></h2></div></div>
      <form className="inlineForm" onSubmit={searchFollowers}>
        <input aria-label="Search followers" value={followerQuery} onChange={event => setFollowerQuery(event.target.value)} placeholder="Search by display name" />
        <button className="button small">Search</button>
      </form>
      {followers.length === 0 ? <p className="mutedText">No followers match this search yet.</p> : <div className="listStack">
        {followers.map(follower => <article className="listRow" key={follower.id}>
          <div><strong>{follower.displayName}</strong><small>Following since {new Date(follower.followedAt).toLocaleDateString()}</small></div>
          <span className="mutedText">VOXA member</span>
        </article>)}
      </div>}
      {followerTotal > followers.length && <p className="mutedText">Showing {followers.length} of {followerTotal}. Refine your search to find other followers.</p>}
    </section>
    <section className="contentPanel">
      <div className="sectionHeading"><div><div className="eyebrow">YOUR COMMUNITIES</div><h2>Community members</h2></div></div>
      {communities.length === 0 ? <p className="mutedText">You do not own a community yet. Create one from the Communities area to manage its members here.</p> : <>
        <label className="fieldLabel">Choose a community
          <select value={selected} onChange={event => setSelected(event.target.value)}>
            {communities.map(community => <option key={community.id} value={community.id}>{community.name} · {community._count.members} members</option>)}
          </select>
        </label>
        {communities.filter(community => community.id === selected).map(community => <p className="mutedText" key={community.id}>{community.description || community.category || 'Community'} · {community._count.posts} discussions</p>)}
        <form className="inlineForm" onSubmit={searchMembers}>
          <input aria-label="Search community members" value={memberQuery} onChange={event => setMemberQuery(event.target.value)} placeholder="Search members by display name" />
          <button className="button small">Search</button>
        </form>
        <div className="listStack">
          {members.map(member => <article className="listRow" key={member.id}>
            <div><strong>{member.displayName}</strong><small>{member.role} · Joined {new Date(member.joinedAt).toLocaleDateString()}</small></div>
            {member.role === 'OWNER' ? <span className="mutedText">Community owner</span> : <button className="ghostButton" disabled={busyId === member.id} onClick={() => void removeMember(member)}>{busyId === member.id ? 'Removing…' : 'Remove member'}</button>}
          </article>)}
          {members.length === 0 && <p className="mutedText">No members match this search.</p>}
        </div>
        {memberTotal > members.length && <p className="mutedText">Showing {members.length} of {memberTotal}. Refine your search to find other members.</p>}
      </>}
    </section>
  </main>;
}
