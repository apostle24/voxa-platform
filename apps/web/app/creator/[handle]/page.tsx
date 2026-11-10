'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');
type MembershipPlan = { id: string; name: string; description?: string | null; priceMinor: number; currency: string; interval: string };
type Profile = { id: string; handle: string; bio?: string | null; verifiedAt?: string | null; user: { displayName: string; liveRooms: { id: string; title: string; description?: string }[] }; shows: { id: string; title: string; description?: string; artworkUrl?: string; category?: string; _count: { episodes: number } }[]; followerCount: number; showCount: number };

export default function CreatorPage() {
  const { handle } = useParams<{handle:string}>();
  const [profile,setProfile]=useState<Profile|null>(null);
  const [plans,setPlans]=useState<MembershipPlan[]>([]);
  const [purchasing,setPurchasing]=useState<string|null>(null);
  const [following,setFollowing]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  async function load() {
    try { const response=await fetch(API+'/creators/'+encodeURIComponent(handle)); const data=await response.json(); if(!response.ok) throw new Error(data.message||'Creator not found'); setProfile(data); const plansResponse=await fetch(API+'/creators/'+encodeURIComponent(handle)+'/membership-plans'); const plansData=await plansResponse.json(); if(plansResponse.ok)setPlans(plansData.plans||[]); }
    catch(e){setError(e instanceof Error?e.message:'Unable to load creator');}
  }

  async function purchaseMembership(planId: string) {
    const token=sessionStorage.getItem('voxa_access_token');
    if(!token){setError('Sign in before purchasing a membership.');return;}
    setPurchasing(planId);setError('');
    try {
      const response=await fetch(API+'/memberships/checkout',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({planId})});
      const data=await response.json();if(!response.ok)throw new Error(data.message||'Unable to start checkout');
      if(!data.checkoutUrl)throw new Error('The payment provider did not return a checkout link');
      window.location.assign(data.checkoutUrl);
    } catch(e){setError(e instanceof Error?e.message:'Unable to start checkout');setPurchasing(null);}
  }
  async function toggleFollow() {
    const token=sessionStorage.getItem('voxa_access_token'); if(!token){setError('Sign in to follow creators.');return;}
    setBusy(true);setError('');
    try {
      const response=await fetch(API+'/creators/'+encodeURIComponent(handle)+'/follow',{method:following?'DELETE':'POST',headers:{Authorization:'Bearer '+token}});
      const data=await response.json();if(!response.ok)throw new Error(data.message||'Unable to update follow');
      setFollowing(!following);setProfile(current=>current?{...current,followerCount:Math.max(0,current.followerCount+(following?-1:1))}:current);
    } catch(e){setError(e instanceof Error?e.message:'Unable to follow');} finally{setBusy(false);}
  }
  useEffect(()=>{void load();},[handle]);
  return <main className="appShell"><nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/live" className="navBack">Explore LIVE →</Link></nav><section className="communityPage">{error&&<p className="errorText">{error}</p>}{profile&&<><div className="creatorHero"><div className="creatorAvatar">{profile.user.displayName.slice(0,1).toUpperCase()}</div><div><div className="eyebrow">VOXA CREATOR {profile.verifiedAt?'· VERIFIED':''}</div><h1>{profile.user.displayName}</h1><p>@{profile.handle}</p></div><button className="button" disabled={busy} onClick={()=>void toggleFollow()}>{busy?'Please wait…':following?'Following ✓':'Follow creator +'}</button></div><p className="creatorBio">{profile.bio||'This creator has not added a bio yet.'}</p><div className="creatorStats"><span><b>{profile.followerCount}</b> followers</span><span><b>{profile.showCount}</b> shows</span></div>{plans.length>0&&<><div className="eyebrow sectionEyebrow">SUPPORT THIS CREATOR</div><div className="membershipGrid">{plans.map(plan=><article className="membershipCard" key={plan.id}><span>VOXA MEMBERSHIP</span><h3>{plan.name}</h3><p>{plan.description||'Get access to this creator’s members-only episodes.'}</p><strong>{new Intl.NumberFormat(undefined,{style:'currency',currency:plan.currency}).format(plan.priceMinor/100)} <small>/ month</small></strong><button className="button small" disabled={purchasing!==null} onClick={()=>void purchaseMembership(plan.id)}>{purchasing===plan.id?'Opening checkout…':'Become a member'}</button></article>)}</div></>}{profile.user.liveRooms.length>0&&<><div className="eyebrow sectionEyebrow">LIVE NOW</div><div className="creatorShowGrid">{profile.user.liveRooms.map(room=><Link className="creatorShowCard liveCard" href={'/live/'+room.id} key={room.id}><span className="livePill"><i/> LIVE</span><h3>{room.title}</h3><p>{room.description}</p><b>Join room ↗</b></Link>)}</div></>}<div className="eyebrow sectionEyebrow">PUBLISHED SHOWS</div>{profile.shows.length?<div className="creatorShowGrid">{profile.shows.map(show=><article className="creatorShowCard" key={show.id}>{show.artworkUrl&&<img src={show.artworkUrl} alt="" />}<span>{show.category||'PODCAST'}</span><h3>{show.title}</h3><p>{show.description}</p><small>{show._count.episodes} episodes</small><Link href={'/shows/'+show.id}>Explore show ↗</Link></article>)}</div>:<div className="emptyState"><p>No published shows yet.</p></div>}</>}</section></main>;
}