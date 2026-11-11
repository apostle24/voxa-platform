'use client';

import { apiFetch } from '../../lib/api';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type LiveRoom = { id: string; title: string; description?: string; isAudioOnly: boolean; status: string; scheduledAt?: string | null; host?: { displayName?: string; creator?: { handle?: string } }; _count?: { stage: number } };
const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

export default function LivePage() {
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [title, setTitle] = useState('');
  const [audioOnly, setAudioOnly] = useState(true);
  const [scheduledAt, setScheduledAt] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [displayName, setDisplayName] = useState('');

  async function loadRooms() {
    try {
      const response = await apiFetch(API + '/live/rooms', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load live rooms');
      setRooms(await response.json());
    } catch (error) { setNotice(error instanceof Error ? error.message : 'API unavailable. Check your API URL.'); }
  }
  useEffect(() => {
    const token = sessionStorage.getItem('voxa_access_token');
    setSignedIn(Boolean(token));
    try { const user = JSON.parse(sessionStorage.getItem('voxa_user') || 'null'); setDisplayName(user?.displayName || ''); } catch {}
    void loadRooms();
  }, []);

  async function createRoom(event: React.FormEvent) {
    event.preventDefault();
    const token = sessionStorage.getItem('voxa_access_token');
    if (!token) { window.location.href = '/login'; return; }
    setLoading(true); setNotice('');
    try {
      const response = await apiFetch(API + '/live/rooms', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ title, isAudioOnly: audioOnly, visibility: 'PUBLIC', ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not create room');
      window.location.href = '/live/' + data.id;
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not create room'); }
    finally { setLoading(false); }
  }

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/">Home</Link><span className="activeNav">LIVE</span></div>{signedIn ? <span className="livePill">{displayName ? 'HI, '+displayName.toUpperCase() : 'SIGNED IN'}</span> : <Link className="button small" href="/login">Sign in ↗</Link>}</nav>
    <section className="pageHead"><div className="eyebrow">THE CONVERSATION IS OPEN</div><h1>VOXA <em>LIVE.</em></h1><p>Step into the room. Listen in, meet new voices, or take the stage.</p></section>
    <section className="liveLayout">
      <div className="roomColumn"><div className="sectionTitle"><div><span className="eyebrow">HAPPENING NOW</span><h2>Live rooms</h2></div><button className="ghostButton" onClick={() => void loadRooms()}>↻ Refresh</button></div>
        {rooms.length === 0 ? <div className="emptyState"><div className="emptyIcon">◉</div><h3>No public rooms just yet</h3><p>Be the first to open a conversation and invite the world in.</p></div> : <div className="roomList">{rooms.map(room=><article className="roomCard" key={room.id}><div className="roomIcon">{room.isAudioOnly ? '♫' : '◉'}</div><div className="roomInfo"><div className="roomMeta"><span className="livePill"><i /> {room.status === 'LIVE' ? 'LIVE NOW' : 'SCHEDULED'}</span><span>{room.isAudioOnly ? 'AUDIO ROOM' : 'VIDEO ROOM'}</span></div><h3>{room.title}</h3><p>Hosted by {room.host?.displayName || room.host?.creator?.handle || 'VOXA creator'} · {room._count?.stage ?? 0} on stage</p>{room.scheduledAt && <p>Starts {new Date(room.scheduledAt).toLocaleString()}</p>}</div><Link className="button small" href={'/live/' + room.id}>{room.status === 'LIVE' ? 'Join room ↗' : 'Room details ↗'}</Link></article>)}</div>}
      </div>
      <aside className="createPanel"><div className="eyebrow">YOUR VOICE MATTERS</div><h2>Start a<br /><em>conversation.</em></h2><p>Create a public room and bring your community together.</p>
        {signedIn ? <form onSubmit={createRoom}><label>Room title</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="What do you want to talk about?" required maxLength={120} /><label className="checkLabel"><input type="checkbox" checked={audioOnly} onChange={e=>setAudioOnly(e.target.checked)} /> Audio-only room</label><label>Start time (optional)<input type="datetime-local" value={scheduledAt} min={new Date(Date.now() + 60000).toISOString().slice(0,16)} onChange={e=>setScheduledAt(e.target.value)} /></label><small>Leave blank to go live immediately. Scheduled rooms become joinable when you start them at the selected time.</small><button className="button full" disabled={loading}>{loading ? 'Creating…' : 'Create your live room ↗'}</button></form> : <Link className="button full" href="/login">Sign in to host a room ↗</Link>}
        <small>{signedIn ? 'Your session is active in this browser tab.' : 'A VOXA account is required to create a live room.'}</small></aside>
    </section>
    {notice && <p className="notice">{notice}</p>}<footer><Link className="brand" href="/">VOXA<span>.</span></Link><small>Listen. Speak. Connect.</small></footer>
  </main>;
}
