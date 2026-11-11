'use client';

import { apiFetch } from '../../../lib/api';
import Link from 'next/link';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Room, RoomEvent } from 'livekit-client';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type StageState = {
  isHost: boolean;
  isCoHost: boolean;
  isModerator: boolean;
  hostId: string;
  moderators: { userId: string; assignedAt: string }[];
  coHosts: { userId: string; assignedAt: string; user?: { displayName: string } }[];
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
  const [isCoHost, setIsCoHost] = useState(false);
  const [isModerator, setIsModerator] = useState(false);
  const [moderatorUserId, setModeratorUserId] = useState('');
  const [coHostUserId, setCoHostUserId] = useState('');
  const [newHostUserId, setNewHostUserId] = useState('');
  const [mic, setMic] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
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
  const [reactions, setReactions] = useState<{ id: number; emoji: string; userId: string }[]>([]);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [interactions, setInteractions] = useState<any>({ polls: [], questions: [], isModerator: false });
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState('');
  const [questionDraft, setQuestionDraft] = useState('');
  const [questionAnswers, setQuestionAnswers] = useState<Record<string, string>>({});
  const [interactionBusy, setInteractionBusy] = useState('');
  const [sessionPlan, setSessionPlan] = useState<any>({ agenda: [], speakers: [], activeTurn: null });
  const [agendaTitle, setAgendaTitle] = useState('');
  const [agendaDescription, setAgendaDescription] = useState('');
  const [agendaDuration, setAgendaDuration] = useState('600');
  const [editingAgendaId, setEditingAgendaId] = useState('');
  const [agendaEditTitle, setAgendaEditTitle] = useState('');
  const [agendaEditDescription, setAgendaEditDescription] = useState('');
  const [agendaEditDuration, setAgendaEditDuration] = useState('600');
  const [handoffSpeakerId, setHandoffSpeakerId] = useState('');

  const api = useCallback(async (path: string, method = 'GET', body?: unknown) => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (!token) throw new Error('Please sign in to VOXA first.');
    const response = await apiFetch(API + path, { method, headers: { Authorization: 'Bearer ' + token, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Request failed');
    return data;
  }, []);

  const refreshStage = useCallback(async () => {
    try { const data = await api('/live/rooms/' + roomId + '/stage'); setStage(data); setIsHost(Boolean(data.isHost)); setIsCoHost(Boolean(data.isCoHost)); setIsModerator(Boolean(data.isModerator)); if (data.isHost) setAnalytics(await api('/live/rooms/' + roomId + '/analytics')); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to load stage'); }
  }, [api, roomId]);

  const refreshChat = useCallback(async () => {
    try {
      const data = await api('/live/rooms/' + roomId + '/chat');
      setChatMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load live chat'); }
  }, [api, roomId]);


  const refreshInteractions = useCallback(async () => {
    try {
      const data = await api('/live/rooms/' + roomId + '/interactions');
      setInteractions(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load live audience interactions'); }
  }, [api, roomId]);


  const refreshSessionPlan = useCallback(async () => {
    try {
      const data = await api('/live/rooms/' + roomId + '/session-plan');
      setSessionPlan(data);
      setHandoffSpeakerId(current => current && data.speakers.some((speaker: any) => speaker.userId === current) ? current : (data.speakers[0]?.userId || ''));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load session agenda'); }
  }, [api, roomId]);

  const connect = useCallback(async () => {
    try {
      const roomState = await api('/live/rooms/' + roomId + '/stage');
      setStage(roomState);
      setIsHost(Boolean(roomState.isHost));
      setIsCoHost(Boolean(roomState.isCoHost));
      setIsModerator(Boolean(roomState.isModerator));
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
      canPublishRef.current = Boolean(data.canPublish); setCanPublish(Boolean(data.canPublish));
      const isStageSpeaker = roomState.speakers.some((speaker: any) => speaker.userId === room.localParticipant.identity);
      room.on(RoomEvent.Connected, () => setStatus(canPublishRef.current ? (roomState.isHost ? 'Connected · Hosting' : 'Connected · You have the floor') : isStageSpeaker ? 'Connected · Waiting for speaking turn' : 'Connected · Listening'));
      room.on(RoomEvent.Reconnecting, () => setStatus('Reconnecting to live media…'));
      room.on(RoomEvent.DataReceived, (payload, participant) => {
        try {
          const packet = JSON.parse(new TextDecoder().decode(payload));
          if (packet?.type === 'VOXA_INTERACTION_UPDATED') { void refreshInteractions(); }
          if (packet?.type === 'VOXA_SESSION_PLAN_UPDATED') {
            const hasFloor = Boolean(roomState.isHost || (packet.speakerId && packet.speakerId === room.localParticipant.identity));
            canPublishRef.current = hasFloor; setCanPublish(hasFloor);
            if (!hasFloor) { setMic(false); setCamera(false); }
            setStatus(hasFloor ? (roomState.isHost ? 'Connected · Hosting' : 'Connected · You have the floor') : roomState.speakers.some((speaker: any) => speaker.userId === room.localParticipant.identity) ? 'Connected · Waiting for speaking turn' : 'Connected · Listening');
            void refreshSessionPlan();
          }
          if (packet?.type === 'VOXA_REACTION' && ['👏', '❤️', '🔥', '😂', '🎉', '🙌'].includes(packet.emoji)) {
            setReactions(current => [...current.slice(-19), { id: Date.now() + Math.random(), emoji: packet.emoji, userId: participant?.identity || 'listener' }]);
          }
        } catch { /* Ignore unrelated or malformed room data packets. */ }
      });
      room.on(RoomEvent.Reconnected, () => {
        setError('');
        setStatus(canPublishRef.current ? (roomState.isHost ? 'Connected · Hosting' : 'Connected · You have the floor') : isStageSpeaker ? 'Connected · Waiting for speaking turn' : 'Connected · Listening');
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
      setStatus(data.canPublish ? (roomState.isHost ? 'Connected · Hosting' : 'Connected · You have the floor') : isStageSpeaker ? 'Connected · Waiting for speaking turn' : 'Connected · Listening');
    } catch (e) {
      setStatus('Disconnected');
      setError(e instanceof Error ? e.message : 'Connection failed');
      const failedRoom = roomRef.current;
      roomRef.current = null;
      await failedRoom?.disconnect().catch(() => undefined);
    }
  }, [api, roomId, refreshInteractions, refreshSessionPlan]);

  useEffect(() => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    setAccessToken(token);
    if (!viewerSessionId.current) viewerSessionId.current = crypto.randomUUID().replace(/-/g, '');
    if (!token) { setError('Sign in to join this room.'); return; }
    void connect();
    void refreshStage();
    void refreshChat();
    void refreshInteractions();
    void refreshSessionPlan();
    const poll = window.setInterval(() => { void refreshStage(); void refreshChat(); void refreshInteractions(); void refreshSessionPlan(); }, 5000);
    return () => { window.clearInterval(poll); void roomRef.current?.disconnect(); roomRef.current = null; };
  }, [connect, refreshStage, refreshChat, refreshInteractions, refreshSessionPlan]);


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

  async function sendReaction(emoji: string) {
    const room = roomRef.current;
    if (!room || !room.localParticipant) { setError('Join the live room before reacting.'); return; }
    try {
      const payload = new TextEncoder().encode(JSON.stringify({ type: 'VOXA_REACTION', emoji }));
      await room.localParticipant.publishData(payload, { reliable: true, topic: 'voxa-reactions' });
      setReactions(current => [...current.slice(-19), { id: Date.now() + Math.random(), emoji, userId: 'You' }]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to send reaction'); }
  }


  async function publishInteractionUpdate() {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'VOXA_INTERACTION_UPDATED' })), { reliable: true, topic: 'voxa-interactions' });
    } catch { /* Persisted interaction data remains available through refresh. */ }
  }

  async function createPoll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const options = pollOptions.split('\n').map(value => value.trim()).filter(Boolean);
    setInteractionBusy('poll-create'); setError('');
    try {
      await api('/live/rooms/' + roomId + '/polls', 'POST', { question: pollQuestion, options });
      setPollQuestion(''); setPollOptions('');
      await refreshInteractions(); await publishInteractionUpdate();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to create poll'); }
    finally { setInteractionBusy(''); }
  }

  async function votePoll(pollId: string, optionId: string) {
    setInteractionBusy('vote-' + pollId); setError('');
    try {
      await api('/live/rooms/' + roomId + '/polls/' + pollId + '/vote', 'POST', { optionId });
      await refreshInteractions(); await publishInteractionUpdate();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to record vote'); }
    finally { setInteractionBusy(''); }
  }

  async function closePoll(pollId: string) {
    setInteractionBusy('close-poll-' + pollId); setError('');
    try {
      await api('/live/rooms/' + roomId + '/polls/' + pollId + '/close', 'POST');
      await refreshInteractions(); await publishInteractionUpdate();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to close poll'); }
    finally { setInteractionBusy(''); }
  }

  async function submitQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!questionDraft.trim()) return;
    setInteractionBusy('question-submit'); setError('');
    try {
      await api('/live/rooms/' + roomId + '/questions', 'POST', { question: questionDraft });
      setQuestionDraft(''); await refreshInteractions(); await publishInteractionUpdate();
      setError(''); 
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to submit question'); }
    finally { setInteractionBusy(''); }
  }

  async function moderateQuestion(questionId: string, update: { status?: string; pinned?: boolean; answer?: string }) {
    setInteractionBusy('question-' + questionId); setError('');
    try {
      await api('/live/rooms/' + roomId + '/questions/' + questionId + '/moderate', 'POST', update);
      await refreshInteractions(); await publishInteractionUpdate();
      if (update.answer !== undefined) setQuestionAnswers(current => ({ ...current, [questionId]: '' }));
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update audience question'); }
    finally { setInteractionBusy(''); }
  }


  async function publishSessionPlanUpdate(speakerId?: string | null) {
    const room = roomRef.current;
    if (!room) return;
    try {
      await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ type: 'VOXA_SESSION_PLAN_UPDATED', speakerId: speakerId === undefined ? (sessionPlan.activeTurn?.speakerId || null) : speakerId })), { reliable: true, topic: 'voxa-session-plan' });
    } catch { /* The periodic session-plan refresh remains the fallback. */ }
  }

  async function createAgendaItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('agenda-create'); setError('');
    try {
      await api('/live/rooms/' + roomId + '/agenda', 'POST', { title: agendaTitle, description: agendaDescription, durationSeconds: Number(agendaDuration) });
      setAgendaTitle(''); setAgendaDescription('');
      await refreshSessionPlan(); await publishSessionPlanUpdate();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to add agenda item'); }
    finally { setBusy(''); }
  }


  function beginAgendaEdit(item: any) {
    setEditingAgendaId(item.id);
    setAgendaEditTitle(item.title);
    setAgendaEditDescription(item.description || '');
    setAgendaEditDuration(String(item.durationSeconds));
  }

  async function saveAgendaEdit(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault();
    setBusy('agenda-edit-' + itemId); setError('');
    try {
      await api('/live/rooms/' + roomId + '/agenda/' + itemId + '/update', 'POST', {
        title: agendaEditTitle,
        description: agendaEditDescription,
        durationSeconds: Number(agendaEditDuration),
      });
      setEditingAgendaId('');
      await refreshSessionPlan(); await publishSessionPlanUpdate();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to edit agenda segment'); }
    finally { setBusy(''); }
  }

  async function agendaAction(itemId: string, actionName: 'start' | 'complete' | 'delete') {
    setBusy('agenda-' + actionName + '-' + itemId); setError('');
    try {
      await api('/live/rooms/' + roomId + '/agenda/' + itemId + '/' + actionName, 'POST');
      await refreshSessionPlan(); await publishSessionPlanUpdate();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to update agenda'); }
    finally { setBusy(''); }
  }

  async function handoffSpeaker() {
    if (!handoffSpeakerId) return;
    setBusy('speaker-handoff'); setError('');
    try {
      await api('/live/rooms/' + roomId + '/speaker-handoff', 'POST', {
        speakerId: handoffSpeakerId,
        ...(sessionPlan.agenda?.find((item: any) => item.status === 'ACTIVE') ? { agendaItemId: sessionPlan.agenda.find((item: any) => item.status === 'ACTIVE').id } : {}),
      });
      await refreshSessionPlan(); await publishSessionPlanUpdate(handoffSpeakerId);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to hand off the speaking turn'); }
    finally { setBusy(''); }
  }

  async function endSpeakerTurn() {
    setBusy('speaker-turn-end'); setError('');
    try {
      await api('/live/rooms/' + roomId + '/speaker-turn/end', 'POST');
      await refreshSessionPlan(); await publishSessionPlanUpdate(null);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to end the speaker turn'); }
    finally { setBusy(''); }
  }

  async function reportRoom() {
    if (reported || reporting) return;
    setReporting(true); setError('');
    try {
      const token = sessionStorage.getItem('voxa_access_token') || '';
      const response = await apiFetch(API + '/reports', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ targetType: 'LIVE_ROOM', targetId: roomId, reason: 'OTHER' }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to report live room');
      setReported(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to report live room'); }
    finally { setReporting(false); }
  }

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

  async function addCoHost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userId = coHostUserId.trim();
    if (!userId) return;
    setBusy('cohost-add'); setError('');
    try {
      await api('/live/rooms/' + roomId + '/cohosts', 'POST', { userId });
      setCoHostUserId('');
      await refreshStage();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to appoint co-host'); }
    finally { setBusy(''); }
  }

  async function removeCoHost(userId: string) {
    await action('cohost-remove-' + userId, '/live/rooms/' + roomId + '/cohosts/' + encodeURIComponent(userId) + '/remove');
  }

  async function transferHost() {
    if (!newHostUserId) return;
    const selected = stage?.coHosts?.find(item => item.userId === newHostUserId);
    if (!window.confirm('Transfer primary host ownership to ' + (selected?.user?.displayName || newHostUserId) + '? You will become a co-host and cannot reverse the transfer unless the new host transfers ownership back.')) return;
    setBusy('host-transfer'); setError('');
    try {
      await api('/live/rooms/' + roomId + '/transfer-host', 'POST', { userId: newHostUserId });
      setNewHostUserId('');
      await refreshStage();
      await refreshSessionPlan();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to transfer room ownership'); }
    finally { setBusy(''); }
  }

  async function addModerator(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const userId = moderatorUserId.trim();
    if (!userId) return;
    setBusy('moderator-add'); setError('');
    try { await api('/live/rooms/' + roomId + '/moderators', 'POST', { userId }); setModeratorUserId(''); await refreshStage(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to add moderator'); }
    finally { setBusy(''); }
  }
  async function deleteRoomChatMessage(messageId: string) {
    setBusy('chat-delete-' + messageId); setError('');
    try { await api('/live/rooms/' + roomId + '/chat/' + encodeURIComponent(messageId) + '/delete', 'POST'); await refreshChat(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Unable to remove chat message'); }
    finally { setBusy(''); }
  }
  async function removeModerator(userId: string) {
    await action('moderator-remove-' + userId, '/live/rooms/' + roomId + '/moderators/' + encodeURIComponent(userId) + '/remove');
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

  const canManageLiveSession = isHost || isCoHost;
  const canModerateRoom = isHost || isCoHost || isModerator;
  const approved = stage?.ownRequest?.status === 'APPROVED';
  const pending = stage?.ownRequest?.status === 'PENDING';
  const displayedStatus = stage?.status === 'CANCELLED' ? 'This scheduled room was cancelled' : stage?.status === 'LIVE' && status.startsWith('Scheduled') ? 'Room is live · join when ready' : status;

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/live" className="navBack">← All live rooms</Link><span className="livePill"><i /> {stage?.status === 'SCHEDULED' ? 'SCHEDULED' : stage?.status === 'LIVE' ? 'LIVE' : 'ROOM'}</span></nav>
    <section className="stagePage">
      <div className="stageTop"><div className="eyebrow">VOXA LIVE ROOM</div><h1>Live conversation</h1><p>{displayedStatus}</p>{stage?.status === 'SCHEDULED' && stage.scheduledAt && <p className="helperText">Scheduled for {new Date(stage.scheduledAt).toLocaleString()}</p>}</div>
      <div className="stageSurface"><div className="stageGlow" /><div id="voxa-media" className="remoteMedia" />
        {reactions.length > 0 && <div aria-live="polite" aria-label="Live audience reactions" style={{ position: 'absolute', top: 16, right: 16, display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', maxWidth: '45%' }}>{reactions.slice(-8).map(reaction => <span key={reaction.id} style={{ fontSize: 26, padding: '5px 9px', borderRadius: 20, background: 'rgba(0,0,0,.55)' }}>{reaction.emoji}</span>)}</div>}{stage?.status === 'CANCELLED' && <><div className="stageMark">V<span>.</span></div><h2>Room cancelled</h2><p>This live session will not take place.</p></>}{stage?.status === 'SCHEDULED' && status.startsWith('Scheduled') && <><div className="stageMark">V<span>.</span></div><h2>{stage?.isHost ? 'Your room is ready.' : 'Coming up on VOXA LIVE.'}</h2><p>{stage?.isHost ? 'Return at the scheduled time and start the conversation.' : 'The host will open this room at the scheduled time.'}</p></>}<div className="connectionStatus"><i /> {displayedStatus}</div></div>
      {error && <p className="errorText">{error}</p>}
      {!accessToken ? <div className="emptyState"><h3>Sign in required</h3><p>Sign in to listen, request the stage, or host.</p><Link className="button" href="/login">Sign in to VOXA ↗</Link></div> : <>
        <div className="stageControls">
          <button className={mic ? 'controlButton on' : 'controlButton'} onClick={()=>void toggleMic()} disabled={!isHost && !canPublish}>{mic ? 'Mic on' : 'Mic off'}</button>
          <button className={camera ? 'controlButton on' : 'controlButton'} onClick={()=>void toggleCamera()} disabled={!isHost && !isCoHost && !approved}>{camera ? 'Camera on' : 'Camera off'}</button>
          {!isHost && !isCoHost && !approved && <button className="button" disabled={pending || busy==='request'} onClick={()=>void action('request','/live/rooms/'+roomId+'/stage-requests')}>{pending ? 'Stage request pending' : 'Request to speak'}</button>}
          {!isHost && !isCoHost && approved && <button className="button" onClick={()=>void connect()}>Reconnect to speak ↗</button>}
          {stage?.isHost && stage.status === 'SCHEDULED' && <button className="button danger" disabled={!!busy} onClick={() => void action('cancel-scheduled', '/live/rooms/' + roomId + '/cancel')}>Cancel scheduled room</button>}
          {stage?.isHost && stage.status === 'SCHEDULED' && <button className="button" disabled={!!busy || (!!stage.scheduledAt && new Date(stage.scheduledAt).getTime() > Date.now())} onClick={()=>void connect()}>{stage.scheduledAt && new Date(stage.scheduledAt).getTime() > Date.now() ? 'Starts at scheduled time' : 'Start live room ↗'}</button>}
          {!stage?.isHost && stage?.status === 'LIVE' && status !== 'Connected · Listening' && status !== 'Connecting to live media…' && <button className="button" onClick={()=>void connect()}>Join live room ↗</button>}
          {status === 'Disconnected' && <button className="button" onClick={()=>void connect()}>Reconnect to live room ↻</button>}
          {isHost && <button className="button danger" disabled={busy==='end'} onClick={()=>void endRoom()}>{busy==='end'?'Ending…':'End room'}</button>}
        </div>
        {canModerateRoom && <section className="moderationPanel">
          <div className="sectionTitle"><div><span className="eyebrow">HOST CONTROLS</span><h2>Stage requests <span className="countBadge">{stage?.requests.length ?? 0}</span></h2></div><button className="ghostButton" onClick={()=>void refreshStage()}>↻ Refresh</button></div>
          {!stage?.requests.length ? <p className="helperText">No pending requests. New requests appear automatically.</p> : <div className="moderationList">{stage.requests.map(request=><div className="moderationRow" key={request.id}><div><b>Listener</b><small>{request.userId}</small></div><div className="moderationActions"><button className="approveButton" disabled={!!busy} onClick={()=>void action('approve-'+request.id,'/live/rooms/'+roomId+'/stage-requests/'+request.id+'/approve')}>Approve</button><button className="rejectButton" disabled={!!busy} onClick={()=>void action('reject-'+request.id,'/live/rooms/'+roomId+'/stage-requests/'+request.id+'/reject')}>Reject</button></div></div>)}</div>}
          <div className="sectionTitle speakerHeading"><div><span className="eyebrow">ON AIR</span><h2>Speakers</h2></div></div>
          <div className="moderationList"><div className="moderationRow"><div><b>Host</b><small>{stage?.hostId}</small></div></div>{stage?.speakers.filter(speaker=>speaker.userId!==stage.hostId).map(speaker=><div className="moderationRow" key={speaker.userId}><div><b>Speaker</b><small>{speaker.userId}</small></div><button className="rejectButton" disabled={!!busy} onClick={()=>void removeSpeaker(speaker.userId)}>Remove</button></div>)}</div>
        </section>}
        {!isHost && <p className="helperText">{pending ? 'Your request is waiting for the host.' : approved ? 'You are on stage. Wait for the host to hand you the speaking turn before enabling your microphone or camera.' : 'You are listening. Request the stage whenever you are ready to speak.'}</p>}
      </>}
        
        <section className="moderationPanel" style={{ marginTop: 24 }}>
          <div className="sectionTitle"><div><span className="eyebrow">SESSION PROGRAMME</span><h2>Live agenda</h2></div><button type="button" className="ghostButton" onClick={() => void refreshSessionPlan()}>↻ Refresh</button></div>
          {sessionPlan.activeTurn && <div style={{ padding: 14, margin: '12px 0', borderRadius: 12, background: 'var(--surface)' }}><span className="eyebrow">CURRENT SPEAKER</span><h3 style={{ margin: '5px 0' }}>{sessionPlan.activeTurn.speaker?.displayName || sessionPlan.activeTurn.speakerId}</h3><p className="helperText">Speaking turn started {new Date(sessionPlan.activeTurn.startedAt).toLocaleTimeString()}</p></div>}
          {!sessionPlan.activeTurn && <p className="helperText">No speaker currently has the floor.</p>}
          {sessionPlan.agenda?.length ? <div className="moderationList">{sessionPlan.agenda.map((item: any, index: number) => <div className="moderationRow" key={item.id} style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1 }}>
              {editingAgendaId === item.id ? <form onSubmit={event => void saveAgendaEdit(event, item.id)} style={{ display: 'grid', gap: 8 }}>
                <input value={agendaEditTitle} onChange={event => setAgendaEditTitle(event.target.value)} minLength={2} maxLength={120} required aria-label="Edit agenda title" style={{ padding: 9, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
                <textarea value={agendaEditDescription} onChange={event => setAgendaEditDescription(event.target.value)} maxLength={500} rows={2} aria-label="Edit agenda description" style={{ padding: 9, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
                <input type="number" min={1} max={14400} required value={agendaEditDuration} onChange={event => setAgendaEditDuration(event.target.value)} aria-label="Edit planned duration in seconds" style={{ padding: 9, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
                <div className="moderationActions"><button className="approveButton" disabled={!!busy}>Save</button><button type="button" className="rejectButton" onClick={() => setEditingAgendaId('')}>Cancel</button></div>
              </form> : <><b>{index + 1}. {item.title}</b><small>{item.durationSeconds >= 3600 ? Math.floor(item.durationSeconds / 3600) + 'h ' : ''}{Math.floor(item.durationSeconds % 3600 / 60)}m planned · {item.status}</small>{item.description && <p className="helperText" style={{ marginTop: 5 }}>{item.description}</p>}</>}
            </div>
            {canModerateRoom && editingAgendaId !== item.id && <div className="moderationActions" style={{ flexWrap: 'wrap' }}>
              {item.status === 'PENDING' && <><button type="button" className="controlButton" disabled={!!busy} onClick={() => beginAgendaEdit(item)}>Edit</button><button type="button" className="approveButton" disabled={!!busy} onClick={() => void agendaAction(item.id, 'start')}>Start</button><button type="button" className="rejectButton" disabled={!!busy} onClick={() => void agendaAction(item.id, 'delete')}>Remove</button></>}
              {item.status === 'ACTIVE' && <button type="button" className="approveButton" disabled={!!busy} onClick={() => void agendaAction(item.id, 'complete')}>Complete</button>}
              {item.status === 'COMPLETED' && <span className="countBadge">Done</span>}
            </div>}
          </div>)}</div> : <p className="helperText">The host has not added any agenda segments yet.</p>}
          {canModerateRoom && <form onSubmit={createAgendaItem} style={{ display: 'grid', gap: 10, marginTop: 16 }}>
            <h3 style={{ margin: 0 }}>Add agenda segment</h3>
            <input value={agendaTitle} onChange={event => setAgendaTitle(event.target.value)} minLength={2} maxLength={120} required placeholder="Segment title" aria-label="Agenda segment title" style={{ padding: 12, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
            <textarea value={agendaDescription} onChange={event => setAgendaDescription(event.target.value)} maxLength={500} rows={2} placeholder="What will this segment cover? (optional)" aria-label="Agenda segment description" style={{ padding: 12, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
            <label className="helperText">Planned duration (seconds)<input type="number" min={1} max={14400} required value={agendaDuration} onChange={event => setAgendaDuration(event.target.value)} style={{ display: 'block', width: '100%', marginTop: 6, padding: 10, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} /></label>
            <button className="button small" disabled={!!busy || !agendaTitle.trim()}>{busy === 'agenda-create' ? 'Adding…' : 'Add to agenda'}</button>
          </form>}
        </section>
        {canManageLiveSession && <section className="moderationPanel" style={{ marginTop: 24 }}>
          <div className="sectionTitle"><div><span className="eyebrow">HOST FLOOR CONTROL</span><h2>Speaker handoff</h2></div><span className="countBadge">{sessionPlan.speakers?.length || 0} on stage</span></div>
          <p className="helperText">Pass the speaking turn to a participant who has already been admitted to the stage. This does not admit listeners or change their publishing permissions.</p>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <select value={handoffSpeakerId} onChange={event => setHandoffSpeakerId(event.target.value)} aria-label="Select next speaker" style={{ flex: 1, minWidth: 180, padding: 12, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }}>
              <option value="">Choose an on-stage speaker</option>
              {sessionPlan.speakers?.map((speaker: any) => <option key={speaker.userId} value={speaker.userId}>{speaker.userId}</option>)}
            </select>
            <button type="button" className="button small" disabled={!!busy || !handoffSpeakerId || handoffSpeakerId === sessionPlan.activeTurn?.speakerId} onClick={() => void handoffSpeaker()}>{busy === 'speaker-handoff' ? 'Handing off…' : 'Hand off turn'}</button>
            {sessionPlan.activeTurn && <button type="button" className="rejectButton" disabled={!!busy} onClick={() => void endSpeakerTurn()}>{busy === 'speaker-turn-end' ? 'Ending…' : 'End turn'}</button>}
          </div>
        </section>}

        {(isHost || isCoHost) && <section className="moderationPanel" style={{ marginTop: 24 }}>
          <div className="sectionTitle"><div><span className="eyebrow">ROOM LEADERSHIP</span><h2>{isHost ? 'Primary host & co-hosts' : 'Room leadership'}</h2></div><span className="countBadge">{stage?.coHosts?.length || 0} co-hosts</span></div>
          <p className="helperText">Co-hosts can manage stage requests, audience moderation, the session agenda and speaker handoffs. Only the primary host can end the room, control recording, appoint leaders or transfer ownership.</p>
          <div className="moderationList">
            <div className="moderationRow"><div><b>Primary host</b><small>{stage?.hostId}</small></div><span className="countBadge">Owner</span></div>
            {stage?.coHosts?.map(coHost => <div className="moderationRow" key={coHost.userId}><div><b>{coHost.user?.displayName || 'Co-host'}</b><small>{coHost.userId}</small></div><div className="moderationActions">{isHost && <><button type="button" className="controlButton" onClick={() => setNewHostUserId(coHost.userId)}>Transfer ownership</button><button type="button" className="rejectButton" disabled={!!busy} onClick={() => void removeCoHost(coHost.userId)}>Remove</button></>}</div></div>)}
          </div>
          {isHost && <form onSubmit={addCoHost} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
            <input value={coHostUserId} onChange={event => setCoHostUserId(event.target.value)} placeholder="VOXA user ID" aria-label="Co-host VOXA user ID" required style={{ flex: 1, minWidth: 190, padding: 12, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
            <button className="button" disabled={!!busy || !coHostUserId.trim()}>{busy === 'cohost-add' ? 'Appointing…' : 'Appoint co-host'}</button>
          </form>}
          {isHost && newHostUserId && <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 14 }}>
            <p className="helperText" style={{ margin: 0 }}>Selected: {stage?.coHosts?.find(item => item.userId === newHostUserId)?.user?.displayName || newHostUserId}</p>
            <button type="button" className="button danger" disabled={!!busy} onClick={() => void transferHost()}>{busy === 'host-transfer' ? 'Transferring…' : 'Confirm host transfer'}</button>
            <button type="button" className="controlButton" onClick={() => setNewHostUserId('')}>Cancel</button>
          </div>}
        </section>}
        {isHost && <section className="moderationPanel" style={{ marginTop: 24 }}>
          <div className="sectionTitle"><div><span className="eyebrow">ROOM TEAM</span><h2>Moderators</h2></div><span className="countBadge">{stage?.moderators?.length || 0}</span></div>
          <p className="helperText">Assign trusted VOXA members to approve stage requests, remove speakers and moderate room chat. Moderators cannot end the room, manage recording, or appoint other moderators.</p>
          <form onSubmit={addModerator} style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input value={moderatorUserId} onChange={event => setModeratorUserId(event.target.value)} placeholder="VOXA user ID" aria-label="Moderator VOXA user ID" style={{ flex: 1, minWidth: 180, padding: 12, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
            <button className="button small" disabled={!!busy || !moderatorUserId.trim()}>{busy === 'moderator-add' ? 'Adding…' : 'Add moderator'}</button>
          </form>
          <div className="moderationList" style={{ marginTop: 14 }}>
            {stage?.moderators?.length ? stage.moderators.map(moderator => <div className="moderationRow" key={moderator.userId}><div><b>Room moderator</b><small>{moderator.userId}</small></div><button type="button" className="rejectButton" disabled={!!busy} onClick={() => void removeModerator(moderator.userId)}>Remove</button></div>) : <p className="helperText">No moderators assigned yet.</p>}
          </div>
        </section>}
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
        <div className="sectionTitle"><div><span className="eyebrow">AUDIENCE PARTICIPATION</span><h2>Live polls</h2></div><button type="button" className="ghostButton" onClick={() => void refreshInteractions()}>↻ Refresh</button></div>
        {(isHost || isModerator) && stage?.status === 'LIVE' && <form onSubmit={createPoll} style={{ display: 'grid', gap: 10, margin: '12px 0 18px' }}>
          <input value={pollQuestion} onChange={event => setPollQuestion(event.target.value)} minLength={5} maxLength={240} required placeholder="Ask the audience a question…" aria-label="Poll question" style={{ padding: 12, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
          <textarea value={pollOptions} onChange={event => setPollOptions(event.target.value)} required rows={3} placeholder={'One option per line\nAt least two options, up to six'} aria-label="Poll options" style={{ padding: 12, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
          <button className="button small" disabled={!!interactionBusy || !pollQuestion.trim() || pollOptions.split('\n').filter(value => value.trim()).length < 2}>{interactionBusy === 'poll-create' ? 'Creating…' : 'Create live poll'}</button>
        </form>}
        {interactions.polls?.length ? interactions.polls.map((poll: any) => {
          const total = poll.options.reduce((sum: number, option: any) => sum + option.voteCount, 0);
          return <div key={poll.id} style={{ padding: 14, borderRadius: 12, background: 'var(--surface)', marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><b>{poll.question}</b><span className="countBadge">{poll.status}</span></div>
            <p className="helperText">{total} vote{total === 1 ? '' : 's'} · {poll.myVote ? 'Your vote is recorded' : 'Choose one option'}</p>
            <div style={{ display: 'grid', gap: 8 }}>
              {poll.options.map((option: any) => <button type="button" key={option.id} className={poll.myVote === option.id ? 'approveButton' : 'controlButton'} disabled={poll.status !== 'OPEN' || !!interactionBusy} onClick={() => void votePoll(poll.id, option.id)} style={{ display: 'flex', justifyContent: 'space-between', textAlign: 'left' }}><span>{option.text}</span><b>{option.voteCount}{total ? ' · ' + Math.round(option.voteCount / total * 100) + '%' : ''}</b></button>)}
            </div>
            {(isHost || isModerator) && poll.status === 'OPEN' && <button type="button" className="rejectButton" style={{ marginTop: 10 }} disabled={!!interactionBusy} onClick={() => void closePoll(poll.id)}>Close poll</button>}
          </div>;
        }) : <p className="helperText">No polls have been created in this room yet.</p>}
      </section>}
      {accessToken && <section className="moderationPanel" style={{ marginTop: 24 }}>
        <div className="sectionTitle"><div><span className="eyebrow">ASK THE HOST</span><h2>Audience Q&A <span className="countBadge">{interactions.questions?.filter((item: any) => ['APPROVED', 'ANSWERED'].includes(item.status)).length || 0}</span></h2></div><button type="button" className="ghostButton" onClick={() => void refreshInteractions()}>↻ Refresh</button></div>
        {stage?.status === 'LIVE' && <form onSubmit={submitQuestion} style={{ display: 'flex', gap: 10, margin: '12px 0 18px' }}>
          <input value={questionDraft} onChange={event => setQuestionDraft(event.target.value)} minLength={5} maxLength={500} required placeholder="Submit a question for the host…" aria-label="Your question" style={{ flex: 1, minWidth: 0, padding: 12, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
          <button className="button small" disabled={!!interactionBusy || !questionDraft.trim()}>{interactionBusy === 'question-submit' ? 'Sending…' : 'Submit'}</button>
        </form>}
        <div style={{ display: 'grid', gap: 12 }}>
          {interactions.questions?.length ? interactions.questions.map((item: any) => <div key={item.id} style={{ padding: 14, borderRadius: 12, background: 'var(--surface)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}><b>{item.author?.displayName || 'VOXA member'}</b><span className="countBadge">{item.status}{item.isPinned ? ' · PINNED' : ''}</span></div>
            <p style={{ margin: '8px 0', whiteSpace: 'pre-wrap' }}>{item.question}</p>
            {item.answer && <div className="helperText"><b>Host answer</b><p>{item.answer}</p></div>}
            {(isHost || isModerator) && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              {item.status === 'PENDING' && <><button type="button" className="approveButton" disabled={!!interactionBusy} onClick={() => void moderateQuestion(item.id, { status: 'APPROVED' })}>Approve</button><button type="button" className="rejectButton" disabled={!!interactionBusy} onClick={() => void moderateQuestion(item.id, { status: 'REJECTED' })}>Reject</button></>}
              {['APPROVED', 'ANSWERED'].includes(item.status) && <button type="button" className="controlButton" disabled={!!interactionBusy} onClick={() => void moderateQuestion(item.id, { pinned: !item.isPinned })}>{item.isPinned ? 'Unpin' : 'Pin question'}</button>}
              {!['REJECTED', 'CLOSED'].includes(item.status) && <button type="button" className="rejectButton" disabled={!!interactionBusy} onClick={() => void moderateQuestion(item.id, { status: 'CLOSED' })}>Close</button>}
            </div>}
            {(isHost || isModerator) && ['APPROVED', 'ANSWERED'].includes(item.status) && <form onSubmit={event => { event.preventDefault(); void moderateQuestion(item.id, { answer: questionAnswers[item.id] || '' }); }} style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input value={questionAnswers[item.id] || ''} onChange={event => setQuestionAnswers(current => ({ ...current, [item.id]: event.target.value }))} maxLength={1000} placeholder="Write an answer…" aria-label="Answer this question" style={{ flex: 1, minWidth: 0, padding: 10, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
              <button className="button small" disabled={!!interactionBusy || !(questionAnswers[item.id] || '').trim()}>Answer</button>
            </form>}
          </div>) : <p className="helperText">No questions yet. Ask the host something to get started.</p>}
        </div>
        {interactions.questions?.some((item: any) => item.status === 'PENDING' && (isHost || isModerator)) && <p className="helperText">Pending questions are visible only to the host and assigned moderators until approved.</p>}
      </section>}
      {accessToken && <section className="moderationPanel" style={{ marginTop: 24 }}>
        <div className="sectionTitle"><div><span className="eyebrow">LIVE COMMUNITY</span><h2>Room chat</h2></div><button className="ghostButton" onClick={() => void refreshChat()}>↻ Refresh</button></div>
        <div aria-label="Send a live reaction" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0 16px' }}>{['👏', '❤️', '🔥', '😂', '🎉', '🙌'].map(emoji => <button key={emoji} type="button" className="controlButton" onClick={() => void sendReaction(emoji)} disabled={!status.startsWith('Connected')}>{emoji}</button>)}</div>
        <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 0' }}>
          {chatMessages.length ? chatMessages.map(message => <div key={message.id} style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--surface)' }}>
            <b style={{ fontSize: 12 }}>{message.author?.displayName || 'VOXA member'}</b><small style={{ marginLeft: 8, color: 'var(--muted)' }}>{new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
            <p style={{ margin: '5px 0 0', fontSize: 13, whiteSpace: 'pre-wrap' }}>{message.deletedAt ? '[deleted]' : message.content}</p>
            {(isHost || isModerator) && !message.deletedAt && <button type="button" className="rejectButton" style={{ marginTop: 8 }} disabled={!!busy} onClick={() => void deleteRoomChatMessage(message.id)}>Remove message</button>}
          </div>) : <p className="helperText">No messages yet. Start the conversation.</p>}
        </div>
        {status !== 'Room ended' && <form onSubmit={event => { event.preventDefault(); void sendChatMessage(); }} style={{ display: 'flex', gap: 10 }}>
          <input value={chatDraft} onChange={event => setChatDraft(event.target.value)} maxLength={1000} placeholder="Message everyone in the room…" style={{ flex: 1, minWidth: 0, padding: 12, borderRadius: 9, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit' }} />
          <button className="button small" disabled={chatBusy || !chatDraft.trim()}>{chatBusy ? 'Sending…' : 'Send'}</button>
        </form>}
      </section>}
      <div className="stageFoot"><span>Room ID: {roomId}</span><span>Powered by LiveKit WebRTC</span></div>
      {accessToken && stage?.status === 'LIVE' && !stage.isHost && <button type="button" className="ghostButton" style={{ marginTop: 18 }} disabled={reporting || reported} onClick={() => void reportRoom()}>{reporting ? 'Submitting report…' : reported ? 'Room reported' : 'Report this live room'}</button>}
    </section>
  </main>;
}
