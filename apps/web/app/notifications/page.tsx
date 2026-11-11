'use client';

import { apiFetch } from '../../lib/api';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type Notice = { id: string; type: string; title: string; body?: string | null; resourceType?: string | null; resourceId?: string | null; readAt?: string | null; createdAt: string };
type Preferences = { follows: boolean; comments: boolean; community: boolean; liveInvitations: boolean };
const defaults: Preferences = { follows: true, comments: true, community: true, liveInvitations: true };

function destination(item: Notice) {
  if (!item.resourceId) return null;
  if (item.resourceType === 'live_room') return '/live/' + item.resourceId;
  if (item.resourceType === 'episode') return '/episodes/' + item.resourceId;
  if (item.resourceType === 'moment') return '/moments';
  if (item.resourceType === 'creator') return '/creator/audience';
  if (item.resourceType === 'community') return '/communities';
  return null;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>(defaults);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [savingPreference, setSavingPreference] = useState(false);

  const load = useCallback(async () => {
    const token = sessionStorage.getItem('voxa_access_token');
    if (!token) { setError('Sign in to view your notifications.'); return; }
    setError('');
    try {
      const headers = { Authorization: 'Bearer ' + token };
      const [notificationResponse, preferenceResponse] = await Promise.all([
        apiFetch(API + '/notifications', { headers }),
        apiFetch(API + '/notifications/preferences', { headers }),
      ]);
      const data = await notificationResponse.json();
      const preferenceData = await preferenceResponse.json();
      if (!notificationResponse.ok) throw new Error(data.message || 'Could not load notifications');
      if (!preferenceResponse.ok) throw new Error(preferenceData.message || 'Could not load notification preferences');
      setItems(data.items ?? []);
      setUnread(data.unreadCount ?? 0);
      setPreferences({ ...defaults, ...preferenceData });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load notifications'); }
  }, []);

  async function markRead(id: string) {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    const response = await apiFetch(API + '/notifications/' + id + '/read', { method: 'PATCH', headers: { Authorization: 'Bearer ' + token } });
    if (response.ok) {
      setItems(current => current.map(item => item.id === id ? { ...item, readAt: new Date().toISOString() } : item));
      setUnread(value => Math.max(0, value - 1));
    }
  }

  async function markAll() {
    setBusy(true);
    const token = sessionStorage.getItem('voxa_access_token') || '';
    try {
      const response = await apiFetch(API + '/notifications/read-all', { method: 'PATCH', headers: { Authorization: 'Bearer ' + token } });
      if (!response.ok) throw new Error('Could not mark notifications as read');
      setItems(current => current.map(item => ({ ...item, readAt: item.readAt || new Date().toISOString() })));
      setUnread(0);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update notifications'); }
    finally { setBusy(false); }
  }

  async function updatePreference(key: keyof Preferences, value: boolean) {
    const next = { ...preferences, [key]: value };
    setPreferences(next);
    setSavingPreference(true);
    const token = sessionStorage.getItem('voxa_access_token') || '';
    try {
      const response = await apiFetch(API + '/notifications/preferences', {
        method: 'PATCH',
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not save preference');
      setPreferences({ ...defaults, ...data });
    } catch (e) {
      setPreferences(preferences);
      setError(e instanceof Error ? e.message : 'Could not save preference');
    } finally { setSavingPreference(false); }
  }

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { setRefreshing(true); void load().finally(() => setRefreshing(false)); }, 30000);
    return () => window.clearInterval(interval);
  }, [load]);

  const settings = [
    ['follows', 'New followers', 'When someone follows your creator profile.'],
    ['comments', 'Comments and replies', 'When someone comments on your episodes or Moments, or replies to your thread.'],
    ['community', 'Community discussions', 'When a member shares a new post in a community you joined.'],
    ['liveInvitations', 'Live stage invitations', 'When a live host approves your request to speak.'],
  ] as const;

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/discover" className="navBack">← Explore VOXA</Link></nav>
    <section className="communityPage">
      <div className="communityHeader">
        <div><div className="eyebrow">YOUR COMMUNITY</div><h1>Notifications</h1><p>{unread} unread updates</p></div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button className="ghostButton" onClick={()=>setSettingsOpen(value=>!value)}>{settingsOpen?'Close settings':'Preferences'}</button>
          <button className="ghostButton" disabled={refreshing} onClick={()=>{setRefreshing(true);void load().finally(()=>setRefreshing(false));}}>{refreshing?'Refreshing…':'Refresh'}</button>
          <button className="ghostButton" disabled={!unread || busy} onClick={()=>void markAll()}>{busy?'Updating…':'Mark all read'}</button>
        </div>
      </div>
      {error && <p className="errorText">{error}</p>}
      {settingsOpen && <section style={{margin:'18px 0 26px',padding:22,border:'1px solid var(--line)',borderRadius:12,background:'var(--panel)'}}>
        <h2 style={{fontFamily:'Space Grotesk',marginTop:0}}>Notification preferences</h2>
        <p style={{color:'var(--muted)',fontSize:13}}>Choose the updates you want to receive in your VOXA inbox.</p>
        {settings.map(([key,title,description])=><label key={key} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:18,padding:'14px 0',borderTop:'1px solid var(--line)',cursor:'pointer'}}>
          <span><strong style={{display:'block',fontSize:14}}>{title}</strong><small style={{color:'var(--muted)'}}>{description}</small></span>
          <input type="checkbox" checked={preferences[key]} disabled={savingPreference} onChange={event=>void updatePreference(key,event.target.checked)} />
        </label>)}
        {savingPreference && <small style={{color:'var(--muted)'}}>Saving…</small>}
      </section>}
      {items.length ? <div className="noticeList">{items.map(item=>{
        const href=destination(item);
        return <article className={item.readAt?'noticeItem':'noticeItem unread'} key={item.id}>
          <div className="noticeDot" />
          <div className="noticeContent"><b>{item.title}</b>{item.body && <p>{item.body}</p>}<small>{new Date(item.createdAt).toLocaleString()}</small>
            {href && <Link href={href} onClick={()=>{if(!item.readAt)void markRead(item.id);}}>Open update ↗</Link>}
          </div>
          {!item.readAt && <button className="ghostButton" onClick={()=>void markRead(item.id)}>Mark read</button>}
        </article>;
      })}</div> : !error && <div className="emptyState"><h3>You're all caught up.</h3><p>New followers, comments, community discussions and live invitations will appear here.</p></div>}
    </section>
  </main>;
}
