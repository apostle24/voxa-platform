'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { useVoxaPlayer, type VoxaTrack } from '../../components/player-provider';

const API = (process.env.NEXT_PUBLIC_VOXA_API_URL || 'http://localhost:3000/v1').replace(/\/$/, '');

type Show = {
  id: string; title: string; description?: string | null; category?: string | null;
  artworkUrl?: string | null; creator: { handle: string; user: { displayName: string } };
  _count?: { episodes: number };
};
type CreatorResult = { id: string; handle: string; bio?: string | null; verifiedAt?: string | null; user: { displayName: string }; _count: { followers: number; shows: number } };
type CommunityResult = { id: string; name: string; slug: string; description?: string | null; category?: string | null; artworkUrl?: string | null; _count: { members: number; posts: number } };
type MomentResult = { id: string; caption: string; startSeconds: number; endSeconds: number; creator: { handle: string; user: { displayName: string } }; episode: { id: string; title: string; artworkUrl?: string | null } };
type LiveRoomResult = { id: string; title: string; description?: string; isAudioOnly: boolean; status: string; host?: { displayName?: string; creator?: { handle?: string } }; _count?: { stage: number } };
type Episode = {
  id: string; title: string; description?: string | null; artworkUrl?: string | null;
  durationSeconds?: number | null; isExplicit: boolean; isLiveReplay?: boolean;
  membershipRequired: boolean;
  matchingMoments?: Array<{ startSeconds: number; endSeconds: number; text: string; speaker: string }>;
  show: { id: string; title: string; creator: { handle: string; user: { displayName: string } } };
};

export default function DiscoverPage() {
  const [query, setQuery] = useState('');
  const [shows, setShows] = useState<Show[]>([]);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [creators, setCreators] = useState<CreatorResult[]>([]);
  const [communities, setCommunities] = useState<CommunityResult[]>([]);
  const [moments, setMoments] = useState<MomentResult[]>([]);
  const [liveRooms, setLiveRooms] = useState<LiveRoomResult[]>([]);
  const [recommended, setRecommended] = useState<Array<Episode & { reason: string }>>([]);
  const [recommendationsPersonalized, setRecommendationsPersonalized] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [aiTopics, setAiTopics] = useState<Array<{ topic: string; count: number }>>([]);
  const [activeAiTopic, setActiveAiTopic] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [preparingEpisode, setPreparingEpisode] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState('');
  const { playTrack, enqueueTrack } = useVoxaPlayer();

  async function load(search = query, selectedCategory = category) {
    setLoading(true);
    setError('');
    const params = new URLSearchParams();
    if (search.trim()) params.set('q', search.trim());
    if (selectedCategory) params.set('category', selectedCategory);
    const suffix = params.toString() ? '?' + params.toString() : '';
    try {
      const [showResponse, episodeResponse, creatorResponse, communityResponse, momentResponse, liveResponse] = await Promise.all([
        fetch(API + '/discovery/shows' + suffix),
        fetch(API + '/discovery/episodes' + suffix),
        fetch(API + '/discovery/creators' + (search.trim() ? '?q=' + encodeURIComponent(search.trim()) : '')),
        fetch(API + '/communities' + (search.trim() ? '?q=' + encodeURIComponent(search.trim()) : '')),
        fetch(API + '/discovery/moments?limit=6'),
        apiFetch(API + '/live/rooms', { cache: 'no-store' }),
      ]);
      const [showData, episodeData, creatorData, communityData, momentData, liveData] = await Promise.all([
        showResponse.json(), episodeResponse.json(), creatorResponse.json(), communityResponse.json(), momentResponse.json(), liveResponse.ok ? liveResponse.json() : Promise.resolve([]),
      ]);
      if (!showResponse.ok) throw new Error(showData.message || 'Unable to discover shows');
      if (!episodeResponse.ok) throw new Error(episodeData.message || 'Unable to discover episodes');
      if (!creatorResponse.ok || !communityResponse.ok || !momentResponse.ok) throw new Error('Some discovery sections could not be loaded');
      setShows(showData.items || []);
      setEpisodes(episodeData.items || []);
      setCreators(creatorData.items || []);
      setCommunities(communityData || []);
      setMoments(momentData.items || []);
      setLiveRooms(Array.isArray(liveData) ? liveData : []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Discovery is temporarily unavailable');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const token = sessionStorage.getItem('voxa_access_token') || '';
    if (token) {
      apiFetch(API + '/discovery/recommended?limit=8')
        .then(response => response.ok ? response.json() : null)
        .then(data => {
          if (data) { setRecommended(data.items || []); setRecommendationsPersonalized(Boolean(data.personalized)); }
        })
        .catch(() => setRecommended([]));
    }
    fetch(API + '/discovery/topics')
      .then(response => response.ok ? response.json() : null)
      .then(data => setAiTopics(data?.items || []))
      .catch(() => setAiTopics([]));
    fetch(API + '/discovery/categories')
      .then(response => response.json())
      .then(data => setCategories(data.items || []))
      .catch(() => setCategories([]));
    void load('', '');
  }, []);

  async function prepareEpisode(episode: Episode, enqueue = false) {
    if (preparingEpisode) return;
    setPreparingEpisode(episode.id);
    setPlaybackError('');
    try {
      const token = sessionStorage.getItem('voxa_access_token') || '';
      if (episode.membershipRequired && !token) {
        throw new Error('Sign in and join this creator’s membership to listen to this episode.');
      }
      const endpoint = episode.membershipRequired ? '/member-playback-url' : '/playback-url';
      const response = await apiFetch(API + '/episodes/' + encodeURIComponent(episode.id) + endpoint);
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to prepare this episode');
      const track: VoxaTrack = {
        episodeId: episode.id,
        title: episode.title,
        showTitle: episode.show.title,
        creatorName: episode.show.creator.user.displayName,
        artworkUrl: episode.artworkUrl,
        url: data.url,
        contentType: data.contentType || 'audio/mpeg',
        durationSeconds: episode.durationSeconds,
      };
      if (enqueue) enqueueTrack(track);
      else playTrack(track);
    } catch (reason) {
      setPlaybackError(reason instanceof Error ? reason.message : 'Unable to prepare playback');
    } finally {
      setPreparingEpisode(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void load(query, category);
  }

  async function chooseAiTopic(topic: string) {
    setActiveAiTopic(topic);
    setCategory('');
    setQuery(topic);
    setLoading(true);
    setError('');
    try {
      const response = await fetch(API + '/discovery/topic-episodes?topic=' + encodeURIComponent(topic));
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Unable to explore this topic');
      setEpisodes(data.items || []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to explore this topic');
    } finally {
      setLoading(false);
    }
  }

  function chooseCategory(value: string) {
    setActiveAiTopic('');
    setCategory(value);
    void load(query, value);
  }

  return (
    <main className="appShell">
      <nav className="nav">
        <Link className="brand" href="/">VOXA<span>.</span></Link>
        <div className="navLinks"><Link href="/replays">Live replays</Link><Link href="/communities">Communities</Link><Link href="/moments">Moments</Link><Link href="/live">Explore LIVE</Link><Link href="/creator/setup">Become a creator</Link><Link href="/login">Sign in</Link></div>
      </nav>
      <section className="communityPage" style={{ maxWidth: 1120 }}>
        <header className="communityHeader">
          <div><div className="eyebrow">FIND YOUR NEXT LISTEN</div><h1>Discover VOXA.</h1><p>Explore shows, episodes and voices worth hearing.</p></div>
        </header>
        <form onSubmit={event => { setActiveAiTopic(''); submit(event); }} style={{ display: 'flex', gap: 10, margin: '24px 0', flexWrap: 'wrap' }}>
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Try a question: stories about faith, leadership or personal growth…" aria-label="Search podcasts" style={{ flex: '1 1 260px', minWidth: 0, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, color: 'white', padding: '14px 16px' }} />
          <button className="button" type="submit">Search</button>
        </form>
        {aiTopics.length > 0 && <section aria-label="Explore AI-generated episode topics" style={{ marginBottom: 24 }}>
          <div className="eyebrow sectionEyebrow">EXPLORE BY AI-GENERATED TOPIC</div>
          <p style={{ color: 'var(--muted)', marginTop: -8, marginBottom: 12, fontSize: 13 }}>Topics extracted from published episode intelligence. Choose one to find related episodes.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {aiTopics.map(item => <button key={item.topic} type="button" className="ghostButton" aria-pressed={activeAiTopic === item.topic} onClick={() => void chooseAiTopic(item.topic)} style={activeAiTopic === item.topic ? { borderColor: 'var(--purple)', color: 'white' } : undefined}>{item.topic} <small>({item.count})</small></button>)}
          </div>
        </section>}
        {categories.length > 0 && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 28 }}>
          <button className="ghostButton" type="button" onClick={() => chooseCategory('')}>All topics</button>
          {categories.map(item => <button key={item} type="button" className="ghostButton" onClick={() => chooseCategory(item)} style={category === item ? { borderColor: 'var(--purple)', color: 'white' } : undefined}>{item}</button>)}
        </div>}
        {error && <p className="errorText">{error}</p>}
        {loading && <p style={{ color: 'var(--muted)' }}>Finding something worth listening to…</p>}
        {!loading && <>
          {recommended.length > 0 && <>
            <div className="eyebrow sectionEyebrow">{recommendationsPersonalized ? 'RECOMMENDED FOR YOU' : 'PICKED FOR YOU'}</div>
            <p style={{ color: 'var(--muted)', marginTop: -8, marginBottom: 16, fontSize: 13 }}>
              {recommendationsPersonalized ? 'Suggestions shaped by your listening, saved episodes and followed creators.' : 'Fresh public episodes to help you find your next favourite.'}
            </p>
            <div className="creatorShowGrid">
              {recommended.map(episode => <article className="creatorShowCard" key={'recommended-' + episode.id}>
                <Link href={'/episodes/' + episode.id} style={{ color: 'inherit', textDecoration: 'none' }}>
                  {episode.artworkUrl ? <img src={episode.artworkUrl} alt="" /> : <div style={{ height: 130, borderRadius: 7, background: 'linear-gradient(135deg,#29234c,#8b5cf6)', display: 'grid', placeItems: 'center', fontSize: 36 }}>V</div>}
                  <span>{episode.show.category || 'PODCAST'}</span><h3>{episode.title}</h3>
                  <p>{episode.description || 'Listen to this episode.'}</p>
                  <small>{episode.show.title} · {episode.show.creator.user.displayName}</small>
                </Link>
                <small style={{ display: 'block', marginTop: 8, color: 'var(--purple)' }}>{episode.reason}</small>
                <button className="button small" type="button" disabled={preparingEpisode !== null} onClick={() => void prepareEpisode(episode)}>{preparingEpisode === episode.id ? 'Preparing…' : '▶ Play'}</button>
              </article>)}
            </div>
          </>}
          <div className="eyebrow sectionEyebrow">CREATORS TO DISCOVER</div>
          {creators.length ? <div className="creatorShowGrid">
            {creators.map(creator => <Link className="creatorShowCard" href={'/creator/' + creator.handle} key={creator.id}>
              <div style={{ height: 92, borderRadius: 8, background: 'linear-gradient(135deg,#252044,#7655bd)', display: 'grid', placeItems: 'center', fontSize: 32, fontWeight: 800 }}>{creator.user.displayName.slice(0,1).toUpperCase()}</div>
              <h3>{creator.user.displayName}{creator.verifiedAt ? ' ✓' : ''}</h3>
              <p>{creator.bio || 'Discover this VOXA creator and their shows.'}</p>
              <small>@{creator.handle} · {creator._count.followers} followers · {creator._count.shows} shows</small>
            </Link>)}
          </div> : <div className="emptyState"><p>No creators match this search.</p></div>}
          <div className="eyebrow sectionEyebrow">COMMUNITIES</div>
          {communities.length ? <div className="creatorShowGrid">
            {communities.slice(0,8).map(community => <Link className="creatorShowCard" href={'/communities/' + community.slug} key={community.id}>
              {community.artworkUrl ? <img src={community.artworkUrl} alt="" /> : <div style={{ height: 110, borderRadius: 8, background: 'linear-gradient(135deg,#243b53,#5b7c99)', display: 'grid', placeItems: 'center', fontSize: 30 }}>✦</div>}
              <span>{community.category || 'COMMUNITY'}</span><h3>{community.name}</h3>
              <p>{community.description || 'Join the conversation with this community.'}</p>
              <small>{community._count.members} members · {community._count.posts} posts</small>
            </Link>)}
          </div> : <div className="emptyState"><p>No communities match this search.</p></div>}
          <div className="eyebrow sectionEyebrow">LIVE RIGHT NOW</div>
          {liveRooms.length ? <div className="creatorShowGrid">
            {liveRooms.slice(0,6).map(room => <article className="creatorShowCard" key={room.id}>
              <span style={{ color: 'var(--purple)' }}>● LIVE · {room.status === 'LIVE' ? 'LIVE NOW' : 'UPCOMING'} · {room.isAudioOnly ? 'AUDIO' : 'VIDEO'}</span>
              <h3>{room.title}</h3>
              <p>{room.description || 'Join the conversation and meet the people behind the voices.'}</p>
              <small>Hosted by {room.host?.displayName || room.host?.creator?.handle || 'VOXA creator'} · {room._count?.stage ?? 0} on stage</small>
              <Link className="button small" href={'/live/' + room.id} style={{ display: 'inline-flex', marginTop: 12 }}>{room.status === 'LIVE' ? 'Join live room' : 'View room'} ↗</Link>
            </article>)}
          </div> : <div className="emptyState"><p>No public live rooms are open right now.</p><Link className="textLink" href="/live">Explore VOXA LIVE ↗</Link></div>}
          <div className="eyebrow sectionEyebrow">VOXA MOMENTS</div>
          {moments.length ? <div className="creatorShowGrid">
            {moments.map(moment => <Link className="creatorShowCard" href={'/moments'} key={moment.id}>
              {moment.episode.artworkUrl ? <img src={moment.episode.artworkUrl} alt="" /> : <div style={{ height: 110, borderRadius: 8, background: 'linear-gradient(135deg,#4b245e,#b45f87)', display: 'grid', placeItems: 'center', fontSize: 30 }}>▶</div>}
              <span>SHORT-FORM CLIP</span><h3>{moment.caption}</h3>
              <p>{moment.episode.title}</p><small>{moment.creator.user.displayName} · {Math.max(1,moment.endSeconds-moment.startSeconds)} sec</small>
            </Link>)}
          </div> : <div className="emptyState"><p>New Moments will appear here as creators publish clips.</p></div>}
          <div className="eyebrow sectionEyebrow">SHOWS</div>
          {shows.length ? <div className="creatorShowGrid">
            {shows.map(show => <Link className="creatorShowCard" href={'/shows/' + show.id} key={show.id}>
              {show.artworkUrl ? <img src={show.artworkUrl} alt="" /> : <div style={{ height: 130, borderRadius: 7, background: 'linear-gradient(135deg,#29234c,#8b5cf6)', display: 'grid', placeItems: 'center', fontSize: 36, fontWeight: 800 }}>V</div>}
              <span>{show.category || 'PODCAST'}</span><h3>{show.title}</h3>
              <p>{show.description || 'Explore this podcast.'}</p>
              <small>By {show.creator.user.displayName} · {show._count?.episodes || 0} episodes</small>
            </Link>)}
          </div> : <div className="emptyState"><p>No shows match this search yet.</p></div>}
          <div className="eyebrow sectionEyebrow">LATEST EPISODES</div>
          {playbackError && <p className="errorText" role="alert">{playbackError}</p>}
          {episodes.length ? <div className="creatorShowGrid">
            {episodes.map(episode => <article className="creatorShowCard" key={episode.id}>
              <Link href={'/episodes/' + episode.id} style={{ color: 'inherit', textDecoration: 'none' }}>
                {episode.artworkUrl ? <img src={episode.artworkUrl} alt="" /> : <div style={{ height: 130, borderRadius: 7, background: 'linear-gradient(135deg,#1e3440,#426b76)', display: 'grid', placeItems: 'center', fontSize: 36 }}>▶</div>}
                <span>{episode.isLiveReplay ? 'LIVE REPLAY' : 'EPISODE'}{episode.isExplicit ? ' · EXPLICIT' : ''}{episode.membershipRequired ? ' · MEMBERS' : ''}</span><h3>{episode.title}</h3>
                <p>{episode.description || 'Listen to this episode.'}</p>
                <small>{episode.show.title} · {episode.show.creator.user.displayName}</small>
              </Link>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
                <button className="button small" type="button" disabled={preparingEpisode !== null} onClick={() => void prepareEpisode(episode)}>{preparingEpisode === episode.id ? 'Preparing…' : '▶ Play'}</button>
                <button className="ghostButton" type="button" disabled={preparingEpisode !== null} onClick={() => void prepareEpisode(episode, true)}>＋ Queue</button>
              </div>
              {!activeAiTopic && query.trim() && episode.matchingMoments?.length ? <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                <small style={{ color: 'var(--muted)', letterSpacing: '.06em' }}>MATCHING MOMENTS</small>
                {episode.matchingMoments.map((moment, index) => <Link key={index} href={'/episodes/' + episode.id + '?t=' + Math.floor(moment.startSeconds)} style={{ display: 'block', marginTop: 9, color: 'inherit', textDecoration: 'none', fontSize: 13 }}>
                  <b style={{ color: 'var(--purple)' }}>{Math.floor(moment.startSeconds / 60)}:{String(Math.floor(moment.startSeconds % 60)).padStart(2, '0')}</b> · {moment.speaker}<br/><span style={{ color: 'var(--muted)' }}>{moment.text}</span>
                </Link>)}
              </div> : null}
            </article>)}
          </div> : <div className="emptyState"><p>No episodes match this search yet.</p></div>}
        </>}
      </section>
    </main>
  );
}
