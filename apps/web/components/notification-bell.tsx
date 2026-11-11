'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type StreamNotice = { id: string; readAt?: string | null };
type StreamPayload = { notification?: StreamNotice | null; refresh?: boolean };

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const streamRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const token = sessionStorage.getItem('voxa_access_token');
    if (!token) { setUnread(0); return; }
    try {
      const response = await apiFetch(API + '/notifications?unreadOnly=true');
      if (response.ok) {
        const data = await response.json();
        setUnread(Number(data.unreadCount) || 0);
      }
    } catch { /* Keep the last known count while offline. */ }
  }, []);

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 1000;

    async function connect() {
      if (!active || !sessionStorage.getItem('voxa_access_token')) return;
      const controller = new AbortController();
      streamRef.current = controller;
      try {
        let token = sessionStorage.getItem('voxa_access_token') || '';
        let response = await fetch(API + '/notifications/stream', {
          headers: { Authorization: 'Bearer ' + token },
          credentials: 'include',
          signal: controller.signal,
        });
        if (response.status === 401) {
          await apiFetch(API + '/notifications?unreadOnly=true');
          token = sessionStorage.getItem('voxa_access_token') || '';
          response = await fetch(API + '/notifications/stream', {
            headers: { Authorization: 'Bearer ' + token },
            credentials: 'include',
            signal: controller.signal,
          });
        }
        if (!response.ok || !response.body) throw new Error('Notification stream unavailable');
        retryDelay = 1000;
        void refresh();
        window.dispatchEvent(new CustomEvent('voxa:notification-refresh'));
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (active && !controller.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          buffer = buffer.replace(/\\r\\n/g, '\\n');
          let boundary = buffer.indexOf('\n\n');
          while (boundary >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const eventName = frame.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
            const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
            if (eventName === 'notification.created' && data) {
              try {
                const payload = JSON.parse(data) as StreamPayload;
                if (payload.notification) {
                  window.dispatchEvent(new CustomEvent('voxa:notification', { detail: payload.notification }));
                  if (!payload.notification.readAt) setUnread(value => value + 1);
                } else {
                  window.dispatchEvent(new CustomEvent('voxa:notification-refresh'));
                  void refresh();
                }
              } catch { /* Ignore malformed event frames and keep the stream alive. */ }
            }
            boundary = buffer.indexOf('\n\n');
          }
        }
        if (active && !controller.signal.aborted) throw new Error('Notification stream closed');
      } catch {
        if (active && !controller.signal.aborted) {
          retryTimer = setTimeout(() => void connect(), retryDelay);
          retryDelay = Math.min(retryDelay * 2, 30000);
        }
      }
    }

    void refresh();
    void connect();
    const onFocus = () => {
      void refresh();
      if (!streamRef.current || streamRef.current.signal.aborted) void connect();
    };
    const onRead = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener('voxa:notification-read', onRead);
    return () => {
      active = false;
      streamRef.current?.abort();
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('voxa:notification-read', onRead);
    };
  }, [refresh]);

  return <Link href="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    style={{position:'fixed',right:22,top:96,zIndex:80,width:42,height:42,display:'grid',placeItems:'center',border:'1px solid var(--line)',borderRadius:12,background:'var(--panel)',color:'var(--text)',boxShadow:'0 8px 28px #0005'}}>
    <span aria-hidden="true" style={{fontSize:19}}>♢</span>
    {unread > 0 && <span style={{position:'absolute',right:-5,top:-5,minWidth:18,height:18,padding:'0 4px',display:'grid',placeItems:'center',borderRadius:99,background:'#9b7bff',color:'#090a10',fontSize:10,fontWeight:800}}>{unread > 99 ? '99+' : unread}</span>}
  </Link>;
}
