'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\\/$/, '');

export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let active = true;
    async function refresh() {
      const token = sessionStorage.getItem('voxa_access_token');
      if (!token) { if (active) setUnread(0); return; }
      try {
        const response = await apiFetch(API + '/notifications?unreadOnly=true', { headers: { Authorization: 'Bearer ' + token } });
        if (!response.ok) return;
        const data = await response.json();
        if (active) setUnread(Number(data.unreadCount) || 0);
      } catch { /* Keep the last known unread count when temporarily offline. */ }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, []);
  return <Link href="/notifications" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
    style={{position:'fixed',right:22,top:96,zIndex:80,width:42,height:42,display:'grid',placeItems:'center',border:'1px solid var(--line)',borderRadius:12,background:'var(--panel)',color:'var(--text)',boxShadow:'0 8px 28px #0005'}}>
    <span aria-hidden="true" style={{fontSize:19}}>♢</span>
    {unread > 0 && <span style={{position:'absolute',right:-5,top:-5,minWidth:18,height:18,padding:'0 4px',display:'grid',placeItems:'center',borderRadius:99,background:'#9b7bff',color:'#090a10',fontSize:10,fontWeight:800}}>{unread > 99 ? '99+' : unread}</span>}
  </Link>;
}
