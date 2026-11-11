# VOXA Media Operations

## Current upload and playback flow

1. A signed-in creator creates a show and an episode draft in Creator Studio.
2. The browser requests a signed PUT URL from `POST /v1/shows/:showId/episodes/:episodeId/upload-url`.
3. The browser uploads the original file directly to the configured S3-compatible bucket.
4. The browser calls `POST /v1/shows/:showId/episodes/:episodeId/complete-upload`; the API checks object metadata, expected owner/episode metadata, supported declared MIME type, and configured byte limit, then records a `MediaAsset` in `QUEUED` state. The original object is retained as an untrusted source and is not directly served.
5. The creator may prepare the show, but episode publication is rejected until processing succeeds and the media asset is `READY`.
6. Listeners use `GET /v1/episodes/:episodeId/playback-url` for public episodes or the authenticated member playback endpoint for membership-restricted episodes. The API returns a short-lived signed URL and the recorded MIME type.
7. The separately deployed worker (`pnpm --filter @voxa/api media:worker`) claims queued assets, downloads the private source, runs ClamAV, inspects streams and duration with `ffprobe`, transcodes audio to MP3 or video to H.264/AAC MP4 with `ffmpeg`, and writes output under the `processed/` prefix. It marks an asset `READY` only after the output upload succeeds. The API only issues playback URLs for that processed object. Signed-in users can bookmark episodes and save playback position.

## Required configuration

Set these on the API server only:
- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT` when using a non-AWS S3-compatible provider
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE` where required by the provider
- `S3_UPLOAD_URL_TTL_SECONDS`
- `S3_PLAYBACK_URL_TTL_SECONDS` (default 3600 seconds; maximum 21600 seconds so long-form playback URLs do not expire too quickly)
- `MEDIA_MAX_AUDIO_BYTES`
- `MEDIA_MAX_VIDEO_BYTES`

Configure the bucket CORS policy to allow the deployed VOXA web origin to issue browser PUT requests with the signed `Content-Type` header. Allow only the required web origins and methods; do not use a wildcard origin for credentialed application traffic. Keep the bucket private and serve playback through short-lived signed URLs.

## Current release limitations

- The API performs an initial magic-signature check. The worker then uses ClamAV and ffprobe for malware and stream/duration checks. This does not constitute human content moderation, copyright review, or a complete malicious-file guarantee.
- The worker currently produces a single normalized MP3 or MP4 rendition. Adaptive HLS/DASH packaging, thumbnail generation, waveform extraction, loudness normalization, captions/transcripts, and CDN delivery are not implemented.
- The browser currently uses native audio/video controls. Background playback, casting, offline downloads, chapters, transcripts, captions and a global persistent player are not implemented.
- A successful upload only means metadata, size, ownership, and a small file-signature sample passed. The asset remains `QUEUED`; it is not publishable or playable until a trusted worker has completed all required checks and marked it `READY`.

## Production gate

Before public launch, deploy and operationally test the worker in isolated resource-limited infrastructure; provision and regularly update ClamAV signatures; configure CPU, memory, disk and job time limits; add dead-letter/operator replay tooling, content moderation, cleanup of abandoned uploads, CDN delivery, playback telemetry, storage lifecycle policies, and end-to-end tests for public and membership-gated playback.


## Media validation increment

The API performs a bounded range read (bytes=0-31) from the private object after upload completion and checks a supported container/magic signature before creating the MediaAsset record. This is an early anti-spoofing check only. It is not a substitute for a maintained media parser, ffprobe/codec inspection, malware scanner such as ClamAV, or content moderation. The worker implementation is present but is not deployed by the API automatically. Run it as a separate isolated service with ffmpeg, ffprobe, ClamAV and a current virus database. Configure the same private S3 and database credentials as the API. It retries failed processing up to MEDIA_WORKER_MAX_ATTEMPTS, recovers stale leases, and renews leases while long transcodes run. Confirm operational monitoring and ClamAV signature updates before enabling creator uploads in production.
