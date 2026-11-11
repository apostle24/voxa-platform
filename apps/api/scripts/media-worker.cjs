#!/usr/bin/env node
'use strict';

// Run as a separate, isolated worker process. Requires ffmpeg, ffprobe and clamscan.
const { PrismaClient } = require('@prisma/client');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { pipeline } = require('node:stream/promises');
const { createWriteStream, createReadStream } = require('node:fs');
const { mkdtemp, stat, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const run = promisify(execFile);
const prisma = new PrismaClient();

const bucket = process.env.S3_BUCKET;
if (!bucket) throw new Error('S3_BUCKET is required');
const s3 = new S3Client({
  region: process.env.S3_REGION || 'auto',
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials: process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
    : undefined,
});
const intervalMs = Math.max(2000, Number(process.env.MEDIA_WORKER_INTERVAL_MS || 5000));
const staleMs = Math.max(60000, Number(process.env.MEDIA_WORKER_STALE_MS || 3600000));
const maxAttempts = Math.max(1, Number(process.env.MEDIA_WORKER_MAX_ATTEMPTS || 3));
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function claimOne() {
  const staleBefore = new Date(Date.now() - staleMs);
  await prisma.mediaAsset.updateMany({
    where: { status: 'PROCESSING', processingStartedAt: { lt: staleBefore }, processingAttempts: { lt: maxAttempts } },
    data: { status: 'QUEUED', processingStartedAt: null, failureReason: 'Recovered stale worker lease' },
  });
  await prisma.mediaAsset.updateMany({
    where: { status: 'PROCESSING', processingStartedAt: { lt: staleBefore }, processingAttempts: { gte: maxAttempts } },
    data: { status: 'FAILED', processingStartedAt: null, failureReason: 'Worker lease expired too many times' },
  });
  const candidate = await prisma.mediaAsset.findFirst({
    where: { status: 'QUEUED', processingAttempts: { lt: maxAttempts } },
    orderBy: { createdAt: 'asc' }, select: { id: true },
  });
  if (!candidate) return null;
  const claimed = await prisma.mediaAsset.updateMany({
    where: { id: candidate.id, status: 'QUEUED' },
    data: { status: 'PROCESSING', processingAttempts: { increment: 1 }, processingStartedAt: new Date(), failureReason: null },
  });
  if (!claimed.count) return null;
  return prisma.mediaAsset.findUnique({ where: { id: candidate.id } });
}


async function generateTranscript(playbackFile, episodeId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: 'SKIPPED', reason: 'OPENAI_API_KEY is not configured' };

  // OpenAI's transcription upload limit is 25 MB. Produce a compact mono
  // derivative so ordinary podcast episodes fit without changing playback media.
  const transcriptFile = playbackFile.replace(/\.[^.]+$/, '-transcription.mp3');
  try {
    await run('ffmpeg', [
      '-nostdin', '-y', '-i', playbackFile, '-vn', '-ac', '1', '-ar', '16000',
      '-c:a', 'libmp3lame', '-b:a', '32k', transcriptFile,
    ], { timeout: 7200000, maxBuffer: 2 * 1024 * 1024 });
    const file = await stat(transcriptFile);
    if (!file.size || file.size > 24 * 1024 * 1024) {
      return { status: 'SKIPPED', reason: 'Compressed audio exceeds the supported single-upload size' };
    }

    // Preserve a creator's manually written transcript; automatic generation
    // only fills an episode that does not already have one.
    const existing = await prisma.episodeTranscript.findUnique({ where: { episodeId }, select: { episodeId: true } });
    if (existing) return { status: 'SKIPPED', reason: 'A transcript already exists' };

    const audio = await require('node:fs/promises').readFile(transcriptFile);
    const form = new FormData();
    form.append('file', new Blob([audio], { type: 'audio/mpeg' }), 'episode.mp3');
    // Diarized output supplies segment timestamps and speaker turns.
    form.append('model', process.env.OPENAI_DIARIZATION_MODEL || 'gpt-4o-transcribe-diarize');
    form.append('response_format', 'diarized_json');
    form.append('chunking_strategy', 'auto');
    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + apiKey },
      body: form,
      signal: AbortSignal.timeout(7200000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error('Transcription provider returned ' + response.status + ': ' + detail);
    }
    const result = await response.json();
    const transcript = String(result.text || '').trim();
    if (!transcript) throw new Error('Transcription provider returned an empty transcript');
    const language = String(result.language || 'en').slice(0, 12);
    const segments = Array.isArray(result.segments) ? result.segments.map(segment => ({
      startSeconds: Math.max(0, Number(segment.start) || 0),
      endSeconds: Math.max(0, Number(segment.end) || 0),
      text: String(segment.text || '').trim(),
      speaker: String(segment.speaker || 'Speaker').slice(0, 40),
    })).filter(segment => segment.text && segment.endSeconds >= segment.startSeconds) : [];
    await prisma.episodeTranscript.create({
      data: { episodeId, content: transcript, language, ...(segments.length ? { segments } : {}) },
    });
    return { status: 'READY', language, characters: transcript.length, segments: segments.length, speakers: [...new Set(segments.map(segment => segment.speaker))].length };
  } finally {
    await rm(transcriptFile, { force: true });
  }
}


async function generateEpisodeIntelligence(episodeId) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { status: 'SKIPPED', reason: 'OPENAI_API_KEY is not configured' };
  const transcript = await prisma.episodeTranscript.findUnique({
    where: { episodeId }, select: { content: true, language: true },
  });
  if (!transcript?.content?.trim()) return { status: 'SKIPPED', reason: 'No transcript is available' };
  const existing = await prisma.episodeIntelligence.findUnique({ where: { episodeId }, select: { id: true } });
  if (existing) return { status: 'SKIPPED', reason: 'Episode intelligence already exists' };

  const model = process.env.OPENAI_INTELLIGENCE_MODEL || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You create accurate podcast episode intelligence from transcripts. Do not invent facts. Return JSON with summary (a clear 2-3 paragraph summary) and topics (an array of 4-8 concise topic labels). If the transcript is incomplete or unclear, reflect that uncertainty.' },
        { role: 'user', content: 'Transcript language: ' + transcript.language + '\\n\\nCreate the episode summary and topics from this transcript:\\n' + transcript.content.slice(0, 90000) },
      ],
    }),
    signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error('Episode intelligence provider returned ' + response.status + ': ' + (await response.text()).slice(0, 500));
  const payload = await response.json();
  const raw = payload.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') throw new Error('Episode intelligence provider returned no content');
  const parsed = JSON.parse(raw);
  const summary = String(parsed.summary || '').trim();
  const topics = Array.isArray(parsed.topics)
    ? [...new Set(parsed.topics.map(value => String(value).trim()).filter(Boolean))].slice(0, 10)
    : [];
  if (!summary || summary.length > 12000 || !topics.length) throw new Error('Episode intelligence response did not meet content requirements');
  await prisma.episodeIntelligence.create({
    data: { episodeId, summary, topics, model },
  });
  return { status: 'READY', topicCount: topics.length };
}

async function processAsset(asset) {
  const heartbeat = setInterval(() => {
    prisma.mediaAsset.updateMany({ where: { id: asset.id, status: 'PROCESSING' }, data: { processingStartedAt: new Date() } })
      .catch(error => console.error(JSON.stringify({ event: 'media_heartbeat_error', assetId: asset.id, reason: String(error.message || error) })));
  }, 30000);
  const work = await mkdtemp(join(tmpdir(), 'voxa-media-'));
  const source = join(work, 'source');
  const output = join(work, asset.contentType.startsWith('video/') ? 'playback.mp4' : 'playback.mp3');
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: asset.objectKey }));
    if (!object.Body || typeof object.Body.pipe !== 'function') throw new Error('Storage returned no readable media stream');
    await pipeline(object.Body, createWriteStream(source));

    // Fail closed: a missing scanner or a positive malware result blocks publication.
    await run('clamscan', ['--no-summary', source], { timeout: 120000, maxBuffer: 1024 * 1024 });
    const probe = await run('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration:stream=codec_type,codec_name,width,height',
      '-of', 'json', source,
    ], { timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    const metadata = JSON.parse(probe.stdout);
    const duration = Math.floor(Number(metadata.format && metadata.format.duration));
    if (!Number.isFinite(duration) || duration < 1 || duration > 86400) throw new Error('Media duration is invalid or exceeds 24 hours');
    const streams = metadata.streams || [];
    const hasExpectedStream = asset.contentType.startsWith('video/')
      ? streams.some(stream => stream.codec_type === 'video')
      : streams.some(stream => stream.codec_type === 'audio');
    if (!hasExpectedStream) throw new Error('Uploaded file does not contain the expected media stream');

    if (asset.contentType.startsWith('video/')) {
      await run('ffmpeg', ['-nostdin', '-y', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-t', '86400', output], { timeout: 7200000, maxBuffer: 4 * 1024 * 1024 });
    } else {
      await run('ffmpeg', ['-nostdin', '-y', '-i', source, '-map', '0:a:0', '-vn', '-c:a', 'libmp3lame', '-b:a', '192k', '-t', '86400', output], { timeout: 7200000, maxBuffer: 4 * 1024 * 1024 });
    }

    const file = await stat(output);
    if (!file.size) throw new Error('Transcoder produced an empty output');
    const playbackKey = 'processed/' + asset.episodeId + '/' + asset.id + (asset.contentType.startsWith('video/') ? '.mp4' : '.mp3');
    const contentType = asset.contentType.startsWith('video/') ? 'video/mp4' : 'audio/mpeg';
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: playbackKey, Body: createReadStream(output), ContentLength: file.size,
      ContentType: contentType, Metadata: { mediaassetid: asset.id, episodeid: asset.episodeId },
    }));
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: 'READY', playbackKey, contentType, sizeBytes: BigInt(file.size), durationSeconds: duration, processedAt: new Date(), processingStartedAt: null, failureReason: null },
    });
    await prisma.episode.update({ where: { id: asset.episodeId }, data: { durationSeconds: duration } });

    // Transcription is an optional enhancement: a provider outage must never
    // turn successfully processed media into a failed upload.
    try {
      const transcriptResult = await generateTranscript(output, asset.episodeId);
      console.log(JSON.stringify({ event: 'episode_transcription', episodeId: asset.episodeId, ...transcriptResult }));
      const intelligenceResult = await generateEpisodeIntelligence(asset.episodeId);
      console.log(JSON.stringify({ event: 'episode_intelligence', episodeId: asset.episodeId, ...intelligenceResult }));
    } catch (transcriptionError) {
      console.error(JSON.stringify({ event: 'episode_transcription_error', episodeId: asset.episodeId, reason: String(transcriptionError.message || transcriptionError).slice(0, 500) }));
    }
    console.log(JSON.stringify({ event: 'media_ready', assetId: asset.id, episodeId: asset.episodeId }));
  } catch (error) {
    const reason = String(error && error.message || error).slice(0, 1000);
    await prisma.mediaAsset.update({
      where: { id: asset.id },
      data: { status: asset.processingAttempts >= maxAttempts ? 'FAILED' : 'QUEUED', processingStartedAt: null, failureReason: reason },
    });
    console.error(JSON.stringify({ event: 'media_processing_error', assetId: asset.id, attempt: asset.processingAttempts, reason }));
  } finally {
    clearInterval(heartbeat);
    await rm(work, { recursive: true, force: true });
  }
}


async function claimMomentRender() {
  const staleBefore = new Date(Date.now() - staleMs);
  await prisma.momentRender.updateMany({
    where: { status: 'PROCESSING', startedAt: { lt: staleBefore }, attempts: { lt: maxAttempts } },
    data: { status: 'QUEUED', startedAt: null, failureReason: 'Recovered stale render worker lease' },
  });
  await prisma.momentRender.updateMany({
    where: { status: 'PROCESSING', startedAt: { lt: staleBefore }, attempts: { gte: maxAttempts } },
    data: { status: 'FAILED', startedAt: null, failureReason: 'Render worker lease expired too many times' },
  });
  const candidate = await prisma.momentRender.findFirst({
    where: { status: 'QUEUED', attempts: { lt: maxAttempts } },
    orderBy: { createdAt: 'asc' }, select: { id: true },
  });
  if (!candidate) return null;
  const claimed = await prisma.momentRender.updateMany({
    where: { id: candidate.id, status: 'QUEUED' },
    data: { status: 'PROCESSING', attempts: { increment: 1 }, startedAt: new Date(), failureReason: null },
  });
  if (!claimed.count) return null;
  return prisma.momentRender.findUnique({
    where: { id: candidate.id },
    include: { moment: { include: { episode: { include: { mediaAssets: { where: { status: 'READY' }, orderBy: { createdAt: 'desc' }, take: 1 } } } } } },
  });
}

async function processMomentRender(job) {
  const work = await mkdtemp(join(tmpdir(), 'voxa-moment-'));
  const source = join(work, 'source.mp4');
  const output = join(work, 'moment.mp4');
  const srt = join(work, 'captions.srt');
  try {
    const asset = job.moment.episode.mediaAssets[0];
    if (!asset?.playbackKey) throw new Error('Processed source video is unavailable');
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: asset.playbackKey }));
    if (!object.Body || typeof object.Body.pipe !== 'function') throw new Error('Storage returned no readable source video');
    await pipeline(object.Body, createWriteStream(source));
    const duration = job.moment.endSeconds - job.moment.startSeconds;
    if (duration < 1 || duration > 90) throw new Error('Moment duration must be between 1 and 90 seconds');
    const ratio = job.aspectRatio === '16:9' ? '16:9' : '9:16';
    const scaleCrop = ratio === '9:16'
      ? 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920'
      : 'scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080';
    const subtitleText = typeof job.subtitles?.text === 'string' ? job.subtitles.text.trim() : '';
    let videoFilter = scaleCrop;
    if (subtitleText) {
      const safe = subtitleText.replace(/[\r\n]+/g, ' ').replace(/[<>]/g, '').slice(0, 5000);
      const timestamp = value => {
        const centiseconds = Math.max(0, Math.floor(value * 100));
        const hours = Math.floor(centiseconds / 360000);
        const minutes = Math.floor((centiseconds % 360000) / 6000);
        const seconds = Math.floor((centiseconds % 6000) / 100);
        const fraction = centiseconds % 100;
        return String(hours).padStart(2, '0') + ':' + String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0') + ',' + String(fraction).padStart(2, '0');
      };
      await require('node:fs/promises').writeFile(srt, '1\n' + timestamp(0) + ' --> ' + timestamp(duration) + '\n' + safe + '\n', 'utf8');
      videoFilter += ',subtitles=' + srt;
    }
    await run('ffmpeg', [
      '-nostdin', '-y', '-ss', String(job.moment.startSeconds), '-i', source, '-t', String(duration),
      '-vf', videoFilter, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output,
    ], { timeout: 900000, maxBuffer: 4 * 1024 * 1024 });
    const file = await stat(output);
    if (!file.size) throw new Error('Clip export produced an empty file');
    const playbackKey = 'moments/' + job.momentId + '/' + job.id + '.mp4';
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: playbackKey, Body: createReadStream(output), ContentLength: file.size,
      ContentType: 'video/mp4', Metadata: { momentid: job.momentId, renderid: job.id },
    }));
    await prisma.momentRender.update({
      where: { id: job.id },
      data: { status: 'READY', playbackKey, contentType: 'video/mp4', sizeBytes: BigInt(file.size), completedAt: new Date(), startedAt: null, failureReason: null },
    });
    console.log(JSON.stringify({ event: 'moment_render_ready', renderId: job.id, momentId: job.momentId }));
  } catch (error) {
    const reason = String(error && error.message || error).slice(0, 1000);
    await prisma.momentRender.update({
      where: { id: job.id },
      data: { status: job.attempts >= maxAttempts ? 'FAILED' : 'QUEUED', startedAt: null, failureReason: reason },
    });
    console.error(JSON.stringify({ event: 'moment_render_error', renderId: job.id, reason }));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function main() {
  console.log('VOXA media worker started');
  try {
    while (!stopping) {
      const asset = await claimOne();
      if (asset) await processAsset(asset);
      else {
        const render = await claimMomentRender();
        if (render) await processMomentRender(render);
        else await sleep(intervalMs);
      }
    }
  } finally {
    await prisma.$disconnect();
    s3.destroy();
  }
}
main().catch(async error => {
  console.error(error);
  await prisma.$disconnect();
  process.exitCode = 1;
});
