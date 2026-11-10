'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type Notice = { id: string; type: string; title: string; body?: string | null; resourceType?: string | null; resourceId?: string | null; readAt?: string | null; createdAt: string };

export default function NotificationsPage() {
  const [items, setItems] = useState<Notice[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    const token = sessionStorage.getItem('voxa_access_token');
    if (!token) { setError('Sign in to view your notifications.'); return; }
    try {
      const response = await fetch(API + '/notifications', { headers: { Authorization: 'Bearer ' + token } });
      const data = await response.json(); if (!response.ok) throw new Error(data.message || 'Could not load notifications');
      setItems(data.items); setUnread(data.unreadCount);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load notifications'); }
  }
  async function markRead(id: string) {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    const response = await fetch(API + '/notifications/' + id + '/read', { method: 'PATCH', headers: { Authorization: 'Bearer ' + token } });
    if (response.ok) { setItems(current => current.map(item => item.id === id ? { ...item, readAt: new Date().toISOString() } : item)); setUnread(value => Math.max(0, value - 1)); }
  }
  async function markAll() {
    setBusy(true); const token = sessionStorage.getItem('voxa_access_token') || '';
    const response = await fetch(API + '/notifications/read-all', { method: 'PATCH', headers: { Authorization: 'Bearer ' + token } });
    if (response.ok) { setItems(current => current.map(item => ({ ...item, readAt: item.readAt || new Date().toISOString() }))); setUnread(0); }
    setBusy(false);
  }
  useEffect(() => { void load(); }, []);
  return <main className="appShell"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/live" className="navBack">← Explore LIVE</Link></nav><section className="communityPage"><div className="communityHeader"><div><div className="eyebrow">YOUR COMMUNITY</div><h1>Notifications</h1><p>{unread} unread updates</p></div><button className="ghostButton" disabled={!unread || busy} onClick={()=>void markAll()}>Mark all read</button></div>{error && <p className="errorText">{error}</p>}{items.length ? <div className="noticeList">{items.map(item=><article className={item.readAt?'noticeItem':'noticeItem unread'} key={item.id}><div className="noticeDot" /><div className="noticeContent"><b>{item.title}</b>{item.body && <p>{item.body}</p>}<small>{new Date(item.createdAt).toLocaleString()}</small>{item.resourceType==='live_room' && item.resourceId && <Link href={'/live/'+item.resourceId}>Open live room ↗</Link>}</div>{!item.readAt && <button className="ghostButton" onClick={()=>void markRead(item.id)}>Mark read</button>}</article>)}</div> : !error && <div className="emptyState"><h3>You're all caught up.</h3><p>New followers and live creator updates will appear here.</p></div>}</section></main>;
}