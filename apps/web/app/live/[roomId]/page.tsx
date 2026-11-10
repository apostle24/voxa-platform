'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

export default function LiveRoomPage({ params }: { params: { roomId: string } }) {
  const roomRef = useRef<Room | null>(null);
  const [status, setStatus] = useState('Not connected');
  const [error, setError] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [roomTitle, setRoomTitle] = useState('VOXA LIVE room');

  useEffect(() => {
    const roomId = params.roomId;
    let active = true;
    async function connect() {
      const accessToken = sessionStorage.getItem('voxa_access_token');
      if (!accessToken) { setError('No access token found. Return to LIVE and paste your VOXA access token.'); return; }
      try {
        const response = await fetch(API + '/live/rooms/' + roomId + '/join-token', { method: 'POST', headers: { Authorization: 'Bearer ' + accessToken } });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Unable to join this room');
        if (!active) return;
        setIsHost(Boolean(data.canPublish));
        setStatus('Connecting to live media…');
        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;
        room.on(RoomEvent.Connected, () => active && setStatus('Connected · Live'));
        room.on(RoomEvent.Disconnected, () => active && setStatus('Disconnected'));
        room.on(RoomEvent.ParticipantConnected, () => active && setStatus('Connected · Live'));
        await room.connect(data.serverUrl, data.token);
        if (!active) { await room.disconnect(); return; }
        if (data.canPublish && !room.localParticipant.isCameraEnabled && !room.localParticipant.isMicrophoneEnabled) {
          setStatus('Connected · Enable your microphone or camera when ready');
        }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Connection failed'); }
    }
    void connect();
    return () => { active = false; void roomRef.current?.disconnect(); roomRef.current = null; };
  }, [params.roomId]);

  async function toggleMic() {
    const room = roomRef.current; if (!room) return;
    try { await room.localParticipant.setMicrophoneEnabled(!mic); setMic(!mic); } catch(e) { setError(e instanceof Error ? e.message : 'Microphone unavailable'); }
  }
  async function toggleCamera() {
    const room = roomRef.current; if (!room) return;
    try { await room.localParticipant.setCameraEnabled(!camera); setCamera(!camera); } catch(e) { setError(e instanceof Error ? e.message : 'Camera unavailable'); }
  }
  async function endRoom() {
    const token = sessionStorage.getItem('voxa_access_token');
    if (!token) return;
    const response = await fetch(API + '/live/rooms/' + params.roomId + '/end', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json();
    if (!response.ok) { setError(data.message || 'Could not end room'); return; }
    await roomRef.current?.disconnect(); setStatus('Room ended');
  }

  return <main className="appShell"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/live" className="navBack">← All live rooms</Link><span className="livePill"><i /> LIVE</span></nav>
    <section className="stagePage"><div className="stageTop"><div className="eyebrow">VOXA LIVE ROOM</div><h1>{roomTitle}</h1><p>{status}</p></div>
      <div className="stageSurface"><div className="stageGlow" /><div className="stageMark">V<span>.</span></div><h2>The room is yours.</h2><p>When people join, their live audio and video tracks connect here.</p><div className="connectionStatus"><i /> {status}</div></div>
      {error && <p className="errorText">{error}</p>}
      <div className="stageControls"><button className={mic ? 'controlButton on' : 'controlButton'} onClick={()=>void toggleMic()} disabled={!isHost}> {mic ? 'Mic on' : 'Mic off'} </button><button className={camera ? 'controlButton on' : 'controlButton'} onClick={()=>void toggleCamera()} disabled={!isHost}> {camera ? 'Camera on' : 'Camera off'} </button>{isHost && <button className="button danger" onClick={()=>void endRoom()}>End room</button>}</div>
      {!isHost && <p className="helperText">You joined as a listener. The host must approve your stage request before you can speak.</p>}
      <div className="stageFoot"><span>Room ID: {params.roomId}</span><span>Powered by LiveKit WebRTC</span></div>
    </section>
  </main>;
}
