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
  togglePlayback: () => void;
  playNext: () => void;
  seek: (seconds: number) => void;
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [queueOpen, setQueueOpen] = useState(false);

  const playTrack = useCallback((track: VoxaTrack) => {
    const audio = audioRef.current;
    setCurrentTrack(track);
    setCurrentTime(track.resumeAt || 0);
    if (audio) {
      audio.src = track.url;
      audio.load();
      const start = () => {
        if (track.resumeAt && track.resumeAt > 0) audio.currentTime = track.resumeAt;
        void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        audio.removeEventListener('loadedmetadata', start);
      };
      audio.addEventListener('loadedmetadata', start);
      if (audio.readyState >= 1) start();
    }
  }, []);

  const enqueueTrack = useCallback((track: VoxaTrack) => {
    setQueue(items => items.some(item => item.episodeId === track.episodeId) ? items : [...items, track]);
    setQueueOpen(true);
  }, []);

  const playNext = useCallback(() => {
    setQueue(items => {
      if (!items.length) return items;
      const [next, ...rest] = items;
      window.setTimeout(() => playTrack(next), 0);
      return rest;
    });
  }, [playTrack]);

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (audio.paused) void audio.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    else { audio.pause(); setIsPlaying(false); }
  }, [currentTrack]);

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
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', playNext);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('loadedmetadata', onMetadata);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', playNext);
    };
  }, [currentTrack, playNext]);

  return <PlayerContext.Provider value={{ currentTrack, queue, isPlaying, currentTime, duration, playTrack, enqueueTrack, togglePlayback, playNext, seek }}>
    {children}
    <audio ref={audioRef} preload="metadata" />
    {currentTrack && <aside className="voxaPlayer" aria-label="VOXA audio player">
      <div className="voxaPlayerTrack">
        {currentTrack.artworkUrl ? <img src={currentTrack.artworkUrl} alt="" /> : <div className="voxaPlayerArtwork">V.</div>}
        <div className="voxaPlayerMeta">
          <Link href={'/episodes/' + currentTrack.episodeId}>{currentTrack.title}</Link>
          <span>{currentTrack.creatorName} · {currentTrack.showTitle}</span>
        </div>
      </div>
      <div className="voxaPlayerControls">
        <div className="voxaPlayerButtons">
          <button aria-label="Play or pause" onClick={togglePlayback}>{isPlaying ? 'Ⅱ' : '▶'}</button>
          <button aria-label="Play next" onClick={playNext} disabled={!queue.length}>↠</button>
          <button aria-label="Show queue" onClick={() => setQueueOpen(value => !value)}>Queue ({queue.length})</button>
        </div>
        <div className="voxaPlayerTimeline">
          <span>{clock(currentTime)}</span>
          <input aria-label="Seek audio" type="range" min="0" max={Math.max(duration, 1)} value={Math.min(currentTime, duration || 0)} onChange={event => seek(Number(event.target.value))} />
          <span>{clock(duration)}</span>
        </div>
      </div>
      {queueOpen && <div className="voxaQueue">
        <div className="voxaQueueHeading"><b>Up next</b><button onClick={() => setQueue([])}>Clear</button></div>
        {queue.length ? queue.map((item, index) => <button className="voxaQueueItem" key={item.episodeId} onClick={() => { setQueue(items => items.filter((_, i) => i !== index)); playTrack(item); }}>
          <span>{index + 1}. {item.title}</span><small>{item.creatorName}</small>
        </button>) : <p>Your queue is empty. Add an episode to keep listening.</p>}
      </div>}
    </aside>}
  </PlayerContext.Provider>;
}

export function useVoxaPlayer() {
  const value = useContext(PlayerContext);
  if (!value) throw new Error('useVoxaPlayer must be used inside PlayerProvider');
  return value;
}
