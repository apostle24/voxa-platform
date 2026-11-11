'use client';

import { apiFetch } from '../../../lib/api';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Room, RoomEvent } from 'livekit-client';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type StageState = {
  isHost: boolean;
  hostId: string;
  requests: { id: string; userId: string; requestedAt: string }[];
  speakers: { userId: string; role: string; joinedAt: string }[];
  ownRequest: { status: string; requestedAt: string } | null;
  status: string;
  scheduledAt?: string | null;
};

export default function LiveRoomPage() {
  const params = useParams<{ roomId: string }>();
  const roomId = params.roomId;
  const roomRef = useRef<Room | null>(null);
  const viewerSessionId = useRef('');
  const canPublishRef = useRef(false);
  const [status, setStatus] = useState('Not connected');
  const [error, setError] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [mic, setMic] = useState(false);
  const [camera, setCamera] = useState(false);
  const [stage, setStage] = useState<StageState | null>(null);
  const [busy, setBusy] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [chatMessages, setChatMessages] = useState<any[]>([]);
  const [chatDraft, setChatDraft] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const [analytics, setAnalytics] = useState<any>(null);
  const [recordingConsent, setRecordingConsent] = useState(false);
  const [replayDraft, setReplayDraft] = useState<{ episodeId: string; processingStatus: string } | null>(null);

  const api = useCallback(async (path: string, method = 'GET') => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) throw new Error('Please sign in to VOXA first.');
    const response = await apiFetch(API + path, { method, headers: { Authorization: 'Bearer ' + token } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Request failed');
    return data;
  }, []);

  const refreshStage = useCallback(async () => {
    try { const data = await api('/live/rooms/' + roomId + '/stage'); setStage(data); setIsHost(Boolean(data.isHost)); if (data.status === 'LIVE' && status.startsWith('Scheduled')) setStatus('Room is live · join when ready'); if (data.isHost) setAnalytics(await api('/live/rooms/' + roomId + '/analytics')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load stage'); }
  }, [api, roomId, status]);

  const refreshChat = useCallback(async () => {
    try {
      const data = await api('/live/rooms/' + roomId + '/chat');
      setChatMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load live chat'); }
  }, [api, roomId]);

  const connect = useCallback(async () => {
    try {
      const roomState = await api('/live/rooms/' + roomId + '/stage');
      setStage(roomState);
      setIsHost(Boolean(roomState.isHost));
      if (roomState.status === 'SCHEDULED' && (!roomState.isHost || (roomState.scheduledAt && new Date(roomState.scheduledAt).getTime() > Date.now()))) {
        setStatus(roomState.scheduledAt ? 'Scheduled · starts ' + new Date(roomState.scheduledAt).toLocaleString() : 'Scheduled · waiting for the host');
        setError('');
        return;
      }
      const data = await api('/live/rooms/' + roomId + '/join-token', 'POST');
      setError('');
      setStatus('Connecting to live media…');
      const old = roomRef.current;
      roomRef.current = null;
      if (old) await old.disconnect();
      const room = new Room({ adaptiveStream: true, dynacast: true });
      roomRef.current = room;
      canPublishRef.current = Boolean(data.canPublish);
      room.on(RoomEvent.Connected, () => setStatus(canPublishRef.current ? 'Connected · You are on stage' : 'Connected · Listening'));
      room.on(RoomEvent.Reconnecting, () => setStatus('Reconnecting to live media…'));
      room.on(RoomEvent.Reconnected, () => {
        setError('');
        setStatus(canPublishRef.current ? 'Connected · You are on stage' : 'Connected · Listening');
      });
      room.on(RoomEvent.Disconnected, () => {
        setStatus('Disconnected');
        setMic(false);
        setCamera(false);
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        const element = track.attach();
        element.setAttribute('data-voxa-track', 'true');
        const container = document.getElementById('voxa-media');
        if (container) container.appendChild(element);
      });
      room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach(element => element.remove()));
      await room.connect(data.serverUrl, data.token);
      setStatus(data.canPublish ? 'Connected · You are on stage' : 'Connected · Listening');
    } catch (e) {
      setStatus('Disconnected');
      setError(e instanceof Error ? e.message : 'Connection failed');
      const failedRoom = roomRef.current;
      roomRef.current = null;
      await failedRoom?.disconnect().catch(() => undefined);
    }
  }, [api, roomId]);

  useEffect(() => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setAccessToken(token);
    if (!viewerSessionId.current) viewerSessionId.current = crypto.randomUUID().replace(/-/g, '');
    if (!token) { setError('Sign in to join this room.'); return; }
    void connect();
    void refreshStage();
    void refreshChat();
    const poll = window.setInterval(() => { void refreshStage(); void refreshChat(); }, 5000);
    return () => { window.clearInterval(poll); void roomRef.current?.disconnect(); roomRef.current = null; };
  }, [connect, refreshStage, refreshChat]);


  useEffect(() => {
    if (status !== 'Connected · Listening' || !viewerSessionId.current) return;
    let active = true;
    const heartbeat = async () => {
      if (!active) return;
      try {
        const token = sessionStorage.getItem('voxa_access_token') || '';
        await apiFetch(API + '/live/rooms/' + roomId + '/presence/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ sessionId: viewerSessionId.current }),
        });
      } catch { /* A later heartbeat recovers transient connectivity failures. */ }
    };
    void heartbeat();
    const timer = window.setInterval(() => void heartbeat(), 15_000);
    return () => {
      active = false;
      window.clearInterval(timer);
      const token = sessionStorage.getItem('voxa_access_token') || '';
      void apiFetch(API + '/live/rooms/' + roomId + '/presence/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ sessionId: viewerSessionId.current }),
      }).catch(() => undefined);
    };
  }, [status, roomId]);

  async function sendChatMessage() {
    if (!chatDraft.trim() || chatBusy) return;
    setChatBusy(true);
    try {
      const token = sessionStorage.getItem('voxa_access_token') || '';
      const response = await apiFetch(API + '/live/rooms/' + roomId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ content: chatDraft.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to send message');
      setChatDraft('');
      await refreshChat();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to send message'); }
    finally { setChatBusy(false); }
  }

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

  async function startRecording() {
    if (!recordingConsent) { setError('Confirm speaker consent before starting a recording.'); return; }
    setBusy('recording-start'); setError('');
    try {
      const token = sessionStorage.getItem('voxa_access_token') || '';
      const response = await apiFetch(API + '/live/rooms/' + roomId + '/recording/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ consentConfirmed: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to start recording');
      setRecordingConsent(false);
      await refreshStage();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to start recording'); }
    finally { setBusy(''); }
  }

  async function createReplayDraft() {
    setBusy('replay-draft'); setError('');
    try {
      const data = await api('/live/rooms/' + roomId + '/recording/create-replay-draft', 'POST');
      setReplayDraft({ episodeId: data.episodeId, processingStatus: data.processingStatus });
      await refreshStage();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create replay draft'); }
    finally { setBusy(''); }
  }
  async function stopRecording() {
    setBusy('recording-stop'); setError('');
    try {
      const token = sessionStorage.getItem('voxa_access_token') || '';
      const response = await apiFetch(API + '/live/rooms/' + roomId + '/recording/stop', {
        method: 'POST', headers: { Authorization: 'Bearer ' + token },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to stop recording');
      await refreshStage();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to stop recording'); }
    finally { setBusy(''); }
  }

  const approved = stage?.ownRequest?.status === 'APPROVED';
  const pending = stage?.ownRequest?.status === 'PENDING';

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/live" className="navBack">← All live rooms</Link><span className="livePill"><i /> {stage?.status === 'SCHEDULED' ? 'SCHEDULED' : stage?.status === 'LIVE' ? 'LIVE' : 'ROOM'}</span></nav>
    <section className="stagePage">
      <div className="stageTop"><div className="eyebrow">VOXA LIVE ROOM</div><h1>Live conversation</h1><p>{status}</p>{stage?.status === 'SCHEDULED' && stage.scheduledAt && <p className="helperText">Scheduled for {new Date(stage.scheduledAt).toLocaleString()}</p>}</div>
      <div className="stageSurface"><div className="stageGlow" /><div id="voxa-media" className="remoteMedia" />{status.startsWith('Scheduled') && <><div className="stageMark">V<span>.</span></div><h2>{stage?.isHost ? 'Your room is ready.' : 'Coming up on VOXA LIVE.'}</h2><p>{stage?.isHost ? 'Return at the scheduled time and start the conversation.' : 'The host will open this room at the scheduled time.'}</p></>}<div className="connectionStatus"><i /> {status}</div></div>
      {error && <p className="errorText">{error}</p>}
      {!accessToken ? <div className="emptyState"><h3>Sign in required</h3><p>Sign in to listen, request the stage, or host.</p><Link className="button" href="/login">Sign in to VOXA ↗</Link></div> : <>
        <div className="stageControls">
          <button className={mic ? 'controlButton on' : 'controlButton'} onClick={()=>void toggleMic()} disabled={!isHost && !approved}>{mic ? 'Mic on' : 'Mic off'}</button>
          <button className={camera ? 'controlButton on' : 'controlButton'} onClick={()=>void toggleCamera()} disabled={!isHost && !approved}>{camera ? 'Camera on' : 'Camera off'}</button>
          {!isHost && !approved && <button className="button" disabled={pending || busy==='request'} onClick={()=>void action('request','/live/rooms/'+roomId+'/stage-requests')}>{pending ? 'Stage request pending' : 'Request to speak'}</button>}
          {!isHost && approved && <button className="button" onClick={()=>void connect()}>Reconnect to speak ↗</button>}
          {stage?.isHost && stage.status === 'SCHEDULED' && <button className="button" disabled={!!busy || (!!stage.scheduledAt && new Date(stage.scheduledAt).getTime() > Date.now())} onClick={()=>void connect()}>{stage.scheduledAt && new Date(stage.scheduledAt).getTime() > Date.now() ? 'Starts at scheduled time' : 'Start live room ↗'}</button>}
          {!stage?.isHost && stage?.status === 'LIVE' && status !== 'Connected · Listening' && status !== 'Connecting to live media…' && <button className="button" onClick={()=>void connect()}>Join live room ↗</button>}
          {status === 'Disconnected' && <button className="button" onClick={()=>void connect()}>Reconnect to live room ↻</button>}
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
      {isHost && <section className="moderationPanel" style={{ marginTop: 24 }}>
        <div className="sectionTitle"><div><span className="eyebrow">LIVE RECORDING</span><h2>Room recording</h2></div><span className="countBadge">{analytics?.room?.recordingStatus || 'NOT_STARTED'}</span></div>
        <p className="helperText">Recording is optional. Only start after every person speaking on stage has clearly agreed. Make sure listeners are informed too.</p>
        {(!analytics?.room?.recordingStatus || ['NOT_STARTED', 'FAILED'].includes(analytics.room.recordingStatus)) && <>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '14px 0', fontSize: 13 }}>
            <input type="checkbox" checked={recordingConsent} onChange={event => setRecordingConsent(event.target.checked)} />
            I confirm that everyone currently speaking has agreed to be recorded and participants have been notified.
          </label>
          <button className="button" disabled={!recordingConsent || !!busy} onClick={() => void startRecording()}>{busy === 'recording-start' ? 'Starting recording…' : 'Start recording'}</button>
        </>}
        {analytics?.room?.recordingStatus === 'RECORDING' && <button className="button danger" disabled={!!busy} onClick={() => void stopRecording()}>{busy === 'recording-stop' ? 'Stopping…' : 'Stop recording'}</button>}
        {['STARTING', 'STOPPING'].includes(analytics?.room?.recordingStatus) && <p className="helperText">Recording service is processing your request. Refresh the room insights in a moment.</p>}
        {analytics?.room?.recordingStatus === 'COMPLETED' && <><p className="helperText">Recording completed. Create a private draft episode to send it through VOXA's malware scan and media processing.</p><button className="button" disabled={!!busy} onClick={() => void createReplayDraft()}>{busy === 'replay-draft' ? 'Creating replay draft…' : 'Create replay draft'}</button>{replayDraft && <div className="helperText"><p>Replay draft created. Media processing: {replayDraft.processingStatus}. Open the draft in Creator Studio to preview it, add details, and publish it when it is ready.</p><Link className="button" href={'/creator/studio#episode-' + replayDraft.episodeId}>Review this replay draft ↗</Link></div>}</>}
        {analytics?.room?.recordingStatus === 'FAILED' && <p className="helperText">The recording failed. Check LiveKit Egress and storage configuration before trying again.</p>}
      </section>}
      {isHost && analytics && <section className="moderationPanel" style={{ marginTop: 24 }}>
        <div className="sectionTitle"><div><span className="eyebrow">HOST INSIGHTS</span><h2>Live room activity</h2></div><button className="ghostButton" onClick={() => void refreshStage()}>↻ Refresh</button></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
          <div className="metricCard"><small>Room duration</small><strong>{Math.floor(analytics.room.durationSeconds / 60)}m</strong></div>
          <div className="metricCard"><small>Active speakers</small><strong>{analytics.stage.activeSpeakers}</strong></div>
          <div className="metricCard"><small>Stage sessions</small><strong>{analytics.stage.totalSpeakerSessions}</strong></div>
          <div className="metricCard"><small>Chat messages</small><strong>{analytics.chat.visibleMessages}</strong></div>
          <div className="metricCard"><small>Pending requests</small><strong>{analytics.requests.pending}</strong></div>
          <div className="metricCard"><small>Live audience</small><strong>{analytics.audience.concurrentViewers}</strong></div>
          <div className="metricCard"><small>Peak audience</small><strong>{analytics.audience.peakConcurrentViewers}</strong></div>
        </div>
        <p className="helperText">{analytics.measurementNote}</p>
      </section>}
      {accessToken && <section className="moderationPanel" style={{ marginTop: 24 }}>
        <div className="sectionTitle"><div><span className="eyebrow">LIVE COMMUNITY</span><h2>Room chat</h2></div><button className="ghostButton" onClick={() => void refreshChat()}>↻ Refresh</button></div>
        <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' }}>
          {chatMessages.length ? chatMessages.map(message => <div key={message.id} style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--surface)' }}>
            <b style={{ fontSize: 12 }}>{message.author?.displayName || 'VOXA member'}</b><small style={{ marginLeft: 8, color: 'var(--muted)' }}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
            <p style={{ margin: '5px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>{message.deletedAt ? '[deleted]' : message.content}</p>
          </div>) : <p className="helperText">No messages yet. Start the conversation.</p>}
        </div>
        {status !== 'Room ended' && <form onSubmit={event => { event.preventDefault(); void sendChatMessage(); }} style={{ display: 'flex', gap: 10 }}>
          <input value={chatDraft} onChange={event => setChatDraft(event.target.value)} maxLength={1000} placeholder="Message everyone in the room…" style={{ flex: 1, minWidth: 0, padding: 12, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
          <button className="button small" disabled={chatBusy || !chatDraft.trim()}>{chatBusy ? 'Sending…' : 'Send'}</button>
        </form>}
      </section>}
      <div className="stageFoot"><span>Room ID: {roomId}</span><span>Powered by LiveKit WebRTC</span></div>
    </section>
  </main>;
}
