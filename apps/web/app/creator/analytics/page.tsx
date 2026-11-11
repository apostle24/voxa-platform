'use client';

import { apiFetch } from '../../../lib/api';
import Link from 'next/link';
import { useEffect, useState } from 'react';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\\/$/, '');
type Analytics = {
  creator: { handle: string };
  period: { since: string; until: string; days: number };
  audience: { followers: number; activeMembers: number };
  publishing: { publishedShows: number; publishedEpisodes: number; publishedMoments: number };
  listening: { recordedEpisodeProgressEntries: number; progressEntriesUpdatedLast30Days: number; completedEpisodeProgressEntries: number; metricNote: string };
  moments: { likes: number; comments: number };
};

function Metric({ label, value, note }: { label: string; value: number; note?: string }) {
  return <article className="earningCard"><span>{label}</span><strong>{value.toLocaleString()}</strong>{note && <small>{note}</small>}</article>;
}

export default function CreatorAnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const token = sessionStorage.getItem('voxa_access_token');
      if (!token) { setError('Sign in to view creator analytics.'); setLoading(false); return; }
      try {
        const response = await apiFetch(API + '/creators/me/analytics', { headers: { Authorization: 'Bearer ' + token } });
        const result = await response.json();
        if (!response.ok) throw new Error(result.message || 'Unable to load analytics');
        setData(result);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Unable to load analytics');
      } finally { setLoading(false); }
    }
    void load();
  }, []);

  return <main className="appShell">
    <nav className="nav"><Link className="brand" href="/">VOXA<span>.</span></Link><Link href="/creator/earnings" className="navBack">Creator earnings →</Link></nav>
    <section className="communityPage">
      <div className="eyebrow">CREATOR STUDIO · INSIGHTS</div>
      <div className="communityHeader"><div><h1>Analytics</h1><p>Understand your audience, publishing activity and recorded engagement.</p></div><Link href="/creator/studio" className="ghostButton">Creator Studio</Link></div>
      {error && <p className="errorText" role="alert">{error}</p>}
      {loading ? <div className="emptyState">Loading your analytics…</div> : data && <>
        <p className="helperText">Showing activity for @{data.creator.handle}. Recent activity covers {new Date(data.period.since).toLocaleDateString()} – {new Date(data.period.until).toLocaleDateString()}.</p>
        <div className="sectionTitle"><div><div className="eyebrow">AUDIENCE</div><h2>Your community</h2></div></div>
        <div className="earningsGrid">
          <Metric label="Followers" value={data.audience.followers} />
          <Metric label="Active members" value={data.audience.activeMembers} />
        </div>
        <div className="sectionTitle"><div><div className="eyebrow">PUBLISHING</div><h2>Your content</h2></div></div>
        <div className="earningsGrid">
          <Metric label="Published shows" value={data.publishing.publishedShows} />
          <Metric label="Published episodes" value={data.publishing.publishedEpisodes} />
          <Metric label="Published Moments" value={data.publishing.publishedMoments} />
        </div>
        <div className="sectionTitle"><div><div className="eyebrow">LISTENING</div><h2>Recorded playback activity</h2></div></div>
        <div className="earningsGrid">
          <Metric label="Progress entries" value={data.listening.recordedEpisodeProgressEntries} />
          <Metric label="Updated in last 30 days" value={data.listening.progressEntriesUpdatedLast30Days} />
          <Metric label="Completed progress entries" value={data.listening.completedEpisodeProgressEntries} />
        </div>
        <p className="helperText">{data.listening.metricNote} These are not raw play counts, unique listeners, or total listening minutes.</p>
        <div className="sectionTitle"><div><div className="eyebrow">MOMENTS</div><h2>Short-form engagement</h2></div></div>
        <div className="earningsGrid">
          <Metric label="Moment likes" value={data.moments.likes} />
          <Metric label="Moment comments" value={data.moments.comments} />
        </div>
      </>}
    </section>
  </main>;
}
