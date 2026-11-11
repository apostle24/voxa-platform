'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { apiFetch } from '../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

export type VoxaTrack = {
  episodeId: string;
  title: string;
  showTitle: string;
  creatorName: string;
  artworkUrl?: string | null;
  url: string;
  contentType: string;
  durationSeconds?: number | null;
  resumeAt?: number;
};

type PlayerContextValue = {
  currentTrack: VoxaTrack | null;
  queue: VoxaTrack[];
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playTrack: (track: VoxaTrack) => void;
  enqueueTrack: (track: VoxaTrack) => void;
  playTrackNext: (track: VoxaTrack) => void;
  togglePlayback: () => void;
  playNext: () => void;
  playPrevious: () => void;
  removeFromQueue: (episodeId: string) => void;
  moveInQueue: (episodeId: string, direction: -1 | 1) => void;
  seek: (seconds: number) => void;
  playerError: string | null;
  retryPlayback: () => void;
};

const PlayerContext = createContext<PlayerContextValue | null>(null);

function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSavedAt = useRef(0);
  const [currentTrack, setCurrentTrack] = useState<VoxaTrack | null>(null);
  const [queue, setQueue] = useState<VoxaTrack[]>([]);
  const [history, setHistory] = useState<VoxaTrack[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);
  const restored = useRef(false);

  const refreshTrack = useCallback(async (saved: VoxaTrack): Promise<VoxaTrack> => {
    const episodeResponse = await apiFetch(API + '/episodes/' + encodeURIComponent(saved.episodeId));
    const episode = await episodeResponse.json();
    if (!episodeResponse.ok) throw new Error(episode.message || 'This episode is no longer available');
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (episode.membershipRequired && !token) throw new Error('Sign in and join the creator membership to continue this episode');
    const playbackResponse = await apiFetch(API + '/episodes/' + encodeURIComponent(saved.episodeId) + (episode.membershipRequired ? '/member-playback-url' : '/playback-url'), {
      headers: episode.membershipRequired ? { Authorization: 'Bearer ' + token } : undefined,
    });
    const playback = await playbackResponse.json();
    if (!playbackResponse.ok) throw new Error(playback.message || 'Unable to refresh the playback link');
    return { ...saved, title: episode.title, showTitle: episode.show.title, creatorName: episode.show.creator.user.displayName, artworkUrl: episode.artworkUrl, durationSeconds: episode.durationSeconds, contentType: playback.contentType || 'audio/mpeg', url: playback.url };
  }, []);

  useEffect(() => {
    let active = true;
    async function restore() {
      try {
        const raw = sessionStorage.getItem('voxa_player_state');
        if (!raw) return;
        const saved = JSON.parse(raw) as { currentTrack?: VoxaTrack | null; queue?: VoxaTrack[]; history?: VoxaTrack[]; currentTime?: number };
        const queued = Array.isArray(saved.queue) ? saved.queue : [];
        const restoredQueue = await Promise.all(queued.slice(0, 50).map(async track => {
          try { return await refreshTrack(track); } catch { return null; }
        }));
        if (!active) return;
        setQueue(restoredQueue.filter((track): track is VoxaTrack => track !== null));
        const restoredHistory = await Promise.all((Array.isArray(saved.history) ? saved.history.slice(0, 30) : []).map(async track => { try { return await refreshTrack(track); } catch { return null; } }));
        if (!active) return;
        setHistory(restoredHistory.filter((track): track is VoxaTrack => track !== null));
        if (saved.currentTrack) {
          try {
            const track = await refreshTrack({ ...saved.currentTrack, resumeAt: Math.max(0, Number(saved.currentTime) || saved.currentTrack.resumeAt || 0) });
            if (!active) return;
            setCurrentTrack(track);
            setCurrentTime(track.resumeAt || 0);
            const audio = audioRef.current;
            if (audio) {
              audio.src = track.url;
              audio.load();
              if (track.resumeAt && track.resumeAt > 0) {
                const restorePosition = () => { audio.currentTime = track.resumeAt || 0; audio.removeEventListener('loadedmetadata', restorePosition); };
                audio.addEventListener('loadedmetadata', restorePosition);
              }
            }
          } catch {
            sessionStorage.removeItem('voxa_player_state');
          }
        }
      } catch {
        sessionStorage.removeItem('voxa_player_state');
      } finally {
        restored.current = true;
      }
    }
    void restore();
    return () => { active = false; };
  }, [refreshTrack]);

  useEffect(() => {
    if (!restored.current) return;
    const safeTrack = currentTrack ? { ...currentTrack, url: '' } : null;
    const safeQueue = queue.map(({ url: _url, ...track }) => track);
    sessionStorage.setItem('voxa_player_state', JSON.stringify({ currentTrack: safeTrack, queue: safeQueue, history: history.map(({ url: _url, ...track }) => track), currentTime }));
  }, [currentTrack, queue, history, currentTime]);

  const playTrack = useCallback((track: VoxaTrack) => {
    if (currentTrack && currentTrack.episodeId !== track.episodeId) {
      setHistory(items => [currentTrack, ...items.filter(item => item.episodeId !== currentTrack.episodeId)].slice(0, 30));
    }
    setCurrentTrack(track);
    const audio = audioRef.current;
    setPlayerError(null);
    setCurrentTime(track.resumeAt || 0);
    if (audio) {
      audio.src = track.url;
      audio.load();
      const setResumePosition = () => {
        if (track.resumeAt && track.resumeAt > 0) audio.currentTime = track.resumeAt;
        audio.removeEventListener('loadedmetadata', setResumePosition);
      };
      if (track.resumeAt && track.resumeAt > 0) audio.addEventListener('loadedmetadata', setResumePosition);
      // Call play in the original click gesture; playback begins when media data arrives.
      void audio.play().then(() => { setIsPlaying(true); setPlayerError(null); }).catch(() => { setIsPlaying(false); setPlayerError('Playback could not start. Check your connection and try again.'); });
    }
  }, [currentTrack]);

  const enqueueTrack = useCallback((track: VoxaTrack) => {
    if (track.episodeId === currentTrack?.episodeId) return;
    setQueue(items => items.some(item => item.episodeId === track.episodeId) ? items : [...items, track]);
    setQueueOpen(true);
  }, [currentTrack]);

  const playTrackNext = useCallback((track: VoxaTrack) => {
    if (track.episodeId === currentTrack?.episodeId) return;
    setQueue(items => [track, ...items.filter(item => item.episodeId !== track.episodeId)]);
    setQueueOpen(true);
  }, [currentTrack]);

  const playNext = useCallback(() => {
    if (!queue.length) return;
    const [next, ...rest] = queue;
    setQueue(rest);
    void refreshTrack(next).then(playTrack).catch(error => {
      setIsPlaying(false);
      setPlayerError(error instanceof Error ? error.message : 'Unable to load the next episode');
    });
  }, [queue, playTrack, refreshTrack]);

  const removeFromQueue = useCallback((episodeId: string) => setQueue(items => items.filter(item => item.episodeId !== episodeId)), []);

  const moveInQueue = useCallback((episodeId: string, direction: -1 | 1) => setQueue(items => {
    const index = items.findIndex(item => item.episodeId === episodeId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return items;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  }), []);

  const playPrevious = useCallback(() => {
    if (!history.length) return;
    const [previous, ...rest] = history;
    setHistory(rest);
    if (currentTrack) setQueue(items => [currentTrack, ...items.filter(item => item.episodeId !== currentTrack.episodeId)]);
    void refreshTrack(previous).then(playTrack).catch(error => setPlayerError(error instanceof Error ? error.message : 'Unable to load the previous episode'));
  }, [history, currentTrack, refreshTrack, playTrack]);

  const retryPlayback = useCallback(() => {
    if (!currentTrack) return;
    setPlayerError(null);
    void refreshTrack(currentTrack).then(track => playTrack(track)).catch(error => {
      setIsPlaying(false);
      setPlayerError(error instanceof Error ? error.message : 'Unable to reload this episode.');
    });
  }, [currentTrack, refreshTrack, playTrack]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (audio.paused) void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    else { audio.pause(); setIsPlaying(false); }
  }, [currentTrack]);

  const changePlaybackRate = useCallback((rate: number) => {
    const safeRate = Math.min(2, Math.max(0.5, rate));
    if (audioRef.current) audioRef.current.playbackRate = safeRate;
    setPlaybackRate(safeRate);
  }, []);

  const seek = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onTime = () => {
      setCurrentTime(audio.currentTime);
      if (currentTrack && Date.now() - lastSavedAt.current > 15000) {
        const token = sessionStorage.getItem('voxa_access_token');
        if (token) {
          lastSavedAt.current = Date.now();
          void apiFetch(API + '/episodes/' + encodeURIComponent(currentTrack.episodeId) + '/progress', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify({ positionSeconds: Math.floor(audio.currentTime) }),
          }).catch(() => undefined);
        }
      }
    };
    const onMetadata = () => setDuration(audio.duration || 0);
    const onError = () => { setIsPlaying(false); setPlayerError('Audio could not be loaded. Your playback link may have expired.'); };
    const onPlaying = () => setPlayerError(null);
    const onPlay = () => setIsPlaying(true);
    const onPause = () => {
      setIsPlaying(false);
      if (currentTrack) {
        const token = sessionStorage.getItem('voxa_access_token');
        if (token) void apiFetch(API + '/episodes/' + encodeURIComponent(currentTrack.episodeId) + '/progress', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ positionSeconds: Math.floor(audio.currentTime) }),
        }).catch(() => undefined);
      }
    };
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('loadedmetadata', onMetadata);
    audio.addEventListener('error', onError);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', playNext);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('error', onError);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', playNext);
    };
  }, [currentTrack, playNext]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || !currentTrack) return;
    const session = navigator.mediaSession;
    if ('MediaMetadata' in window) {
      session.metadata = new MediaMetadata({
        title: currentTrack.title,
        artist: currentTrack.creatorName,
        album: currentTrack.showTitle,
        artwork: currentTrack.artworkUrl ? [
          { src: currentTrack.artworkUrl, sizes: '96x96' },
          { src: currentTrack.artworkUrl, sizes: '256x256' },
          { src: currentTrack.artworkUrl, sizes: '512x512' },
        ] : [],
      });
    }
    session.playbackState = isPlaying ? 'playing' : 'paused';
    const setAction = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try { session.setActionHandler(action, handler); } catch { /* Unsupported action on this browser */ }
    };
    setAction('play', () => togglePlayback());
    setAction('pause', () => togglePlayback());
    setAction('nexttrack', () => playNext());
    setAction('previoustrack', () => playPrevious());
    setAction('seekbackward', details => seek(Math.max(0, currentTime - (details.seekOffset || 15))));
    setAction('seekforward', details => seek(Math.min(duration || currentTime + 15, currentTime + (details.seekOffset || 15))));
    setAction('seekto', details => { if (typeof details.seekTime === 'number') seek(details.seekTime); });
    if (duration > 0 && Number.isFinite(currentTime)) {
      try { session.setPositionState({ duration, playbackRate: 1, position: Math.min(currentTime, duration) }); } catch { /* Position state is optional */ }
    }
    return () => {
      for (const action of ['play', 'pause', 'nexttrack', 'previoustrack', 'seekbackward', 'seekforward', 'seekto'] as MediaSessionAction[]) {
        setAction(action, null);
      }
    };
  }, [currentTrack, isPlaying, currentTime, duration, togglePlayback, playNext, playPrevious, seek]);

  return <PlayerContext.Provider value={{ currentTrack, queue, isPlaying, currentTime, duration, playTrack, enqueueTrack, playTrackNext, togglePlayback, playNext, playPrevious, removeFromQueue, moveInQueue, seek, playerError, retryPlayback }}>
    {children}
    <audio ref={audioRef} preload="metadata" aria-hidden="true" style={{ display: 'none' }} />
    {currentTrack && <aside className="voxaPlayer" aria-label="VOXA audio player">
      <div className="voxaPlayerTrack">
        {currentTrack.artworkUrl ? <img src={currentTrack.artworkUrl} alt="" /> : <div className="voxaPlayerArtwork">V.</div>}
        <div className="voxaPlayerMeta">
          <Link href={'/episodes/' + currentTrack.episodeId}>{currentTrack.title}</Link>
          <span>{currentTrack.creatorName} · {currentTrack.showTitle}</span>
        </div>
      </div>
      {playerError && <div role="alert" className="voxaPlayerError"><span>{playerError}</span><button onClick={retryPlayback}>Retry</button></div>}
      <div className="voxaPlayerControls">
        <div className="voxaPlayerButtons">
          <button aria-label="Back 15 seconds" onClick={() => seek(Math.max(0, currentTime - 15))}>−15</button>
          <button aria-label="Play previous episode" onClick={playPrevious} disabled={!history.length}>↶</button>
          <button aria-label="Play or pause" onClick={togglePlayback}>{isPlaying ? 'Ⅱ' : '▶'}</button>
          <button aria-label="Play next" onClick={playNext} disabled={!queue.length}>↠</button>
          <button aria-label="Forward 15 seconds" onClick={() => seek(Math.min(duration || currentTime + 15, currentTime + 15))}>+15</button>
          <button aria-label="Show queue" onClick={() => setQueueOpen(value => !value)}>Queue ({queue.length})</button>
        </div>
        <label className="voxaPlayerSpeed" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
          Speed <select aria-label="Playback speed" value={playbackRate} onChange={event => changePlaybackRate(Number(event.target.value))}>
            {[0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
          </select>
        </label>
        <div className="voxaPlayerTimeline">
          <span>{clock(currentTime)}</span>
          <input aria-label="Seek audio" type="range" min="0" max={Math.max(duration, 1)} value={Math.min(currentTime, duration || 0)} onChange={event => seek(Number(event.target.value))} />
          <span>{clock(duration)}</span>
        </div>
      </div>
      {queueOpen && <div className="voxaQueue">
        <div className="voxaQueueHeading"><b>Up next</b><button onClick={() => setQueue([])}>Clear</button></div>
        {queue.length ? queue.map((item, index) => <div className="voxaQueueItem" key={item.episodeId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button style={{ flex: 1, textAlign: 'left' }} onClick={() => { setQueue(items => items.filter(track => track.episodeId !== item.episodeId)); void refreshTrack(item).then(playTrack).catch(() => setIsPlaying(false)); }}><span>{index + 1}. {item.title}</span><small>{item.creatorName}</small></button>
          <button aria-label={'Move ' + item.title + ' up'} disabled={index === 0} onClick={() => moveInQueue(item.episodeId, -1)}>↑</button>
          <button aria-label={'Move ' + item.title + ' down'} disabled={index === queue.length - 1} onClick={() => moveInQueue(item.episodeId, 1)}>↓</button>
          <button aria-label={'Remove ' + item.title + ' from queue'} onClick={() => removeFromQueue(item.episodeId)}>×</button>
        </div>) : <p>Your queue is empty. Add an episode to keep listening.</p>}
      </div>}
    </aside>}
  </PlayerContext.Provider>;
}

export function useVoxaPlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('useVoxaPlayer must be used inside PlayerProvider');
  return value;
}
