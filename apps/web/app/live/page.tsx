'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type LiveRoom = { id: string; title: string; description?: string; isAudioOnly: boolean; status: string; host?: { displayName?: string; creator?: { handle?: string } }; _count?: { stage: number } };
const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

export default function LivePage() {
  const [rooms, setRooms] = useState<LiveRoom[]>([]);
  const [token, setToken] = useState('');
  const [title, setTitle] = useState('');
  const [audioOnly, setAudioOnly] = useState(true);
  const [notice, setNotice] = useState('Connect your VOXA account to host or join a live room.');
  const [loading, setLoading] = useState(false);

  async function loadRooms() {
    try {
      const response = await fetch(API + '/live/rooms', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not load live rooms');
      setRooms(await response.json());
    } catch (error) { setNotice(error instanceof Error ? error.message : 'API unavailable. Check your API URL.'); }
  }
  useEffect(() => { void loadRooms(); }, []);

  async function createRoom(event: React.FormEvent) {
    event.preventDefault();
    if (!token.trim()) { setNotice('Enter your access token first.'); return; }
    setLoading(true);
    try {
      const response = await fetch(API + '/live/rooms', { method: 'POST', headers: { Authorization: 'Bearer ' + token.trim(), 'Content-Type': 'application/json' }, body: JSON.stringify({ title, isAudioOnly: audioOnly, visibility: 'PUBLIC' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Could not create room');
      sessionStorage.setItem('voxa_access_token', token.trim());
      window.location.href = '/live/' + data.id;
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Could not create room'); }
    finally { setLoading(false); }
  }

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><div className="navLinks"><Link href="/">Home</Link><span className="activeNav">LIVE</span></div><span className="livePill"><i /> LIVE STAGE</span></nav>
    <section className="pageHead"><div className="eyebrow">THE CONVERSATION IS OPEN</div><h1>VOXA <em>LIVE.</em></h1><p>Step into the room. Listen in, meet new voices, or take the stage.</p></section>
    <section className="liveLayout">
      <div className="roomColumn"><div className="sectionTitle"><div><span className="eyebrow">HAPPENING NOW</span><h2>Live rooms</h2></div><button className="ghostButton" onClick={() => void loadRooms()}>↻ Refresh</button></div>
        {rooms.length === 0 ? <div className="emptyState"><div className="emptyIcon">◉</div><h3>No public rooms just yet</h3><p>Be the first to open a conversation and invite the world in.</p></div> : <div className="roomList">{rooms.map(room=><article className="roomCard" key={room.id}><div className="roomIcon">{room.isAudioOnly ? '♫' : '◉'}</div><div className="roomInfo"><div className="roomMeta"><span className="livePill"><i /> {room.status}</span><span>{room.isAudioOnly ? 'AUDIO ROOM' : 'VIDEO ROOM'}</span></div><h3>{room.title}</h3><p>Hosted by {room.host?.displayName || room.host?.creator?.handle || 'VOXA creator'} · {room._count?.stage ?? 0} on stage</p></div><Link className="button small" href={'/live/' + room.id}>Join room ↗</Link></article>)}</div>}
      </div>
      <aside className="createPanel"><div className="eyebrow">YOUR VOICE MATTERS</div><h2>Start a<br /><em>conversation.</em></h2><p>Create a public room and bring your community together.</p><form onSubmit={createRoom}><label>Room title</label><input value={title} onChange={e=>setTitle(e.target.value)} placeholder="What do you want to talk about?" required maxLength={120} /><label>VOXA access token</label><textarea value={token} onChange={e=>setToken(e.target.value)} placeholder="Paste the JWT access token from /v1/auth/login" rows={3} required /><label className="checkLabel"><input type="checkbox" checked={audioOnly} onChange={e=>setAudioOnly(e.target.checked)} /> Audio-only room</label><button className="button full" disabled={loading}>{loading ? 'Creating…' : 'Create your live room ↗'}</button></form><small>Access token is held in this browser tab session for this MVP. Do not use a production account token on an untrusted device.</small></aside>
    </section>
    <p className="notice">{notice}</p><footer><Link className="brand" href="/">VOXA<span>.</span></Link><small>Listen. Speak. Connect.</small></footer>
  </main>;
}
