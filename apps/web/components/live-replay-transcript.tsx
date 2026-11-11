'use client';

import { useMemo, useState } from 'react';

type Segment = { startSeconds: number; endSeconds: number; text: string; speaker: string };

function timestamp(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
}

export default function LiveReplayTranscript({
  language, content, segments, currentTime, onSeek,
}: {
  language: string;
  content: string;
  segments?: Segment[] | null;
  currentTime: number;
  onSeek: (seconds: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [speaker, setSpeaker] = useState('all');
  const speakers = useMemo(() => Array.from(new Set((segments || []).map(item => item.speaker?.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b)), [segments]);
  const visible = useMemo(() => (segments || []).filter(item =>
    (!query.trim() || item.text.toLowerCase().includes(query.toLowerCase())) &&
    (speaker === 'all' || item.speaker === speaker)
  ), [segments, query, speaker]);
  const activeIndex = visible.findIndex((item, index) =>
    currentTime >= item.startSeconds &&
    currentTime < (visible[index + 1]?.startSeconds ?? item.endSeconds ?? item.startSeconds + 8)
  );

  return <section aria-label="LIVE replay transcript" style={{ marginTop: 32, padding: 22, border: '1px solid var(--line)', borderRadius: 14, background: 'var(--panel)' }}>
    <div className="eyebrow">VOXA LIVE REPLAY TRANSCRIPT · {language.toUpperCase()}</div>
    <h2 style={{ margin: '8px 0 6px' }}>Follow the conversation.</h2>
    <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 14px' }}>Search the transcript, filter by speaker, or select a timestamp to jump to that moment in the replay.</p>
    <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a word or phrase…" aria-label="Search LIVE replay transcript" style={{ width: '100%', padding: 12, borderRadius: 8, border: '1px solid var(--line)', background: 'var(--surface)', color: 'inherit', marginBottom: 14 }} />
    {speakers.length > 0 && <div aria-label="Filter transcript by speaker" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
      <button type="button" className={speaker === 'all' ? 'button small' : 'ghostButton'} aria-pressed={speaker === 'all'} onClick={() => setSpeaker('all')}>All speakers</button>
      {speakers.map(name => <button type="button" key={name} className={speaker === name ? 'button small' : 'ghostButton'} aria-pressed={speaker === name} onClick={() => setSpeaker(name)}>{name}</button>)}
    </div>}
    {segments?.length ? <div style={{ maxHeight: 620, overflowY: 'auto', display: 'grid', gap: 4, paddingRight: 4 }}>
      {visible.map((item, index) => {
        const active = index === activeIndex;
        return <article key={item.startSeconds + '-' + item.speaker + '-' + index} aria-current={active ? 'true' : undefined} style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 14, alignItems: 'start', padding: '12px 10px', borderBottom: '1px solid var(--line)', borderRadius: 9, background: active ? 'var(--surface)' : 'transparent', borderLeft: active ? '3px solid var(--accent, #8b5cf6)' : '3px solid transparent' }}>
          <button type="button" className="ghostButton" aria-label={'Jump to ' + timestamp(item.startSeconds)} onClick={() => onSeek(item.startSeconds)} style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>{timestamp(item.startSeconds)}</button>
          <div><small style={{ color: 'var(--muted)', display: 'block', marginBottom: 4, fontWeight: 700 }}>{item.speaker || 'Speaker'}</small><span style={{ lineHeight: 1.8, fontSize: 14 }}>{item.text}</span></div>
        </article>;
      })}
      {visible.length === 0 && <p>No matching transcript segments.</p>}
    </div> : <div style={{ maxHeight: 420, overflowY: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.85, fontSize: 14 }}>{query.trim() ? (content.split(/\n+/).filter(line => line.toLowerCase().includes(query.toLowerCase())).join('\n') || 'No matching transcript lines.') : content}</div>}
  </section>;
}
