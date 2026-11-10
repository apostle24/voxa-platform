'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Room, RoomEvent } from 'livekit-client';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\\/$/, '');
type StageState = {
  isHost: boolean;
  hostId: string;
  requests: { id: string; userId: string; requestedAt: string }[];
  speakers: { userId: string; role: string; joinedAt: string }[];
  ownRequest: { status: string; requestedAt: string } | null;
  status: string;
};

export default function LiveRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState('Not connected');
  const [error, setError] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [stage, setStage] = useState<StageState | null>(null);
  const [busy, setBusy] = useState('');
  const [accessToken, setAccessToken] = useState('');

  const api = useCallback(async (path: string, method = 'GET') => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) throw new Error('Please sign in to VOXA first.');
    const response = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Request failed');
    return data;
  }, []);

  const refreshStage = useCallback(async () => {
    try { const data = await api('/live/rooms/' + roomId + '/stage'); setStage(data); setIsHost(Boolean(data.isHost)); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load stage'); }
  }, [api, roomId]);

  const connect = useCallback(async () => {
    try {
      const data = await api('/live/rooms/' + roomId + '/join-token', 'POST');
      setStatus('Connecting to live media…');
      const old = roomRef.current;
      if (old) await old.disconnect();
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      room.on(RoomEvent.Connected, () => setStatus('Connected · Live'));
      room.on(RoomEvent.Disconnected, () => setStatus('Disconnected'));
      room.on(RoomEvent.TrackSubscribed, (track) => {
        const element = track.attach();
        element.setAttribute('data-voxa-track', 'true');
        const container = document.getElementById('voxa-media');
        if (container) container.appendChild(element);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach(element => element.remove()));
      await room.connect(data.serverUrl, data.token);
      setStatus(data.canPublish ? 'Connected · You are on stage' : 'Connected · Listening');
    } catch (e) { setError(e instanceof Error ? e.message : 'Connection failed'); }
  }, [api, roomId]);

  useEffect(() => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setAccessToken(token);
    if (!token) { setError('Sign in to join this room.'); return; }
    void connect();
    void refreshStage();
    const poll = window.setInterval(() => { void refreshStage(); }, 5000);
    return () => { window.clearInterval(poll); void roomRef.current?.disconnect(); roomRef.current = null; };
  }, [connect, refreshStage]);

  async function action(key: string, path: string, method = 'POST') {
    setBusy(key); setError('');
    try { await api(path, method); await refreshStage(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Action failed'); }
    finally { setBusy(''); }
  }
  async function toggleMic() {
    const room = roomRef.current; if (!room) return;
    try { await room.localParticipant.setMicrophoneEnabled(!mic); setMic(!mic); }
    catch (e) { setError(e instanceof Error ? e.message : 'Microphone unavailable'); }
  }
  async function toggleCamera() {
    const room = roomRef.current; if (!room) return;
    try { await room.localParticipant.setCameraEnabled(!camera); setCamera(!camera); }
    catch (e) { setError(e instanceof Error ? e.message : 'Camera unavailable'); }
  }
  async function removeSpeaker(userId: string) {
    await action('remove-' + userId, '/live/rooms/' + roomId + '/speakers/' + encodeURIComponent(userId) + '/remove');
  }
  async function endRoom() {
    await action('end', '/live/rooms/' + roomId + '/end');
    await roomRef.current?.disconnect(); setStatus('Room ended');
  }

  const approved = stage?.ownRequest?.status === 'APPROVED';
  const pending = stage?.ownRequest?.status === 'PENDING';

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/live" className="navBack">← All live rooms</Link><span className="livePill"><i /> LIVE</span></nav>
    <section className="stagePage">
      <div className="stageTop"><div className="eyebrow">VOXA LIVE ROOM</div><h1>Live conversation</h1><p>{status}</p></div>
      <div className="stageSurface"><div className="stageGlow" /><div id="voxa-media" className="remoteMedia" /><div className="stageMark">V<span>.</span></div><h2>The room is yours.</h2><p>Live participant audio and video will appear here.</p><div className="connectionStatus"><i /> {status}</div></div>
      {error && <p className="errorText">{error}</p>}
      {!accessToken ? <div className="emptyState"><h3>Sign in required</h3><p>Sign in to listen, request the stage, or host.</p><Link className="button" href="/login">Sign in to VOXA ↗</Link></div> : <>
        <div className="stageControls">
          <button className={mic ? 'controlButton on' : 'controlButton'} onClick={()=>void toggleMic()} disabled={!isHost && !approved}>{mic ? 'Mic on' : 'Mic off'}</button>
          <button className={camera ? 'controlButton on' : 'controlButton'} onClick={()=>void toggleCamera()} disabled={!isHost && !approved}>{camera ? 'Camera on' : 'Camera off'}</button>
          {!isHost && !approved && <button className="button" disabled={pending || busy==='request'} onClick={()=>void action('request','/live/rooms/'+roomId+'/stage-requests')}>{pending ? 'Stage request pending' : 'Request to speak'}</button>}
          {!isHost && approved && <button className="button" onClick={()=>void connect()}>Reconnect to speak ↗</button>}
          {isHost && <button className="button danger" disabled={busy==='end'} onClick={()=>void endRoom()}>{busy==='end'?'Ending…':'End room'}</button>}
        </div>
        {isHost && <section className="moderationPanel">
          <div className="sectionTitle"><div><span className="eyebrow">HOST CONTROLS</span><h2>Stage requests <span className="countBadge">{stage?.requests.length ?? 0}</span></h2></div><button className="ghostButton" onClick={()=>void refreshStage()}>↻ Refresh</button></div>
          {!stage?.requests.length ? <p className="helperText">No pending requests. New requests appear automatically.</p> : <div className="moderationList">{stage.requests.map(request=><div className="moderationRow" key={request.id}><div><b>Listener</b><small>{request.userId}</small></div><div className="moderationActions"><button className="approveButton" disabled={!!busy} onClick={()=>void action('approve-'+request.id,'/live/rooms/'+roomId+'/stage-requests/'+request.id+'/approve')}>Approve</button><button className="rejectButton" disabled={!!busy} onClick={()=>void action('reject-'+request.id,'/live/rooms/'+roomId+'/stage-requests/'+request.id+'/reject')}>Reject</button></div></div>)}</div>}
          <div className="sectionTitle speakerHeading"><div><span className="eyebrow">ON AIR</span><h2>Speakers</h2></div></div>
          <div className="moderationList"><div className="moderationRow"><div><b>Host</b><small>{stage?.hostId}</small></div></div>{stage?.speakers.filter(speaker=>speaker.userId!==stage.hostId).map(speaker=><div className="moderationRow" key={speaker.userId}><div><b>Speaker</b><small>{speaker.userId}</small></div><button className="rejectButton" disabled={!!busy} onClick={()=>void removeSpeaker(speaker.userId)}>Remove</button></div>)}</div>
        </section>}
        {!isHost && <p className="helperText">{pending ? 'Your request is waiting for the host.' : approved ? 'The host approved your request. Reconnect to refresh your speaking permissions.' : 'You are listening. Request the stage whenever you are ready to speak.'}</p>}
      </>}
      <div className="stageFoot"><span>Room ID: {roomId}</span><span>Powered by LiveKit WebRTC</span></div>
    </section>
  </main>;
}
