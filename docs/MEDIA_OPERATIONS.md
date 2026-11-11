# VOXA Media Operations

## Current upload and playback flow

1. A signed-in creator creates a show and an episode draft in Creator Studio.
2. The browser requests a signed PUT URL from `POST /v1/shows/:showId/episodes/:episodeId/upload-url`.
3. The browser uploads the original file directly to the configured S3-compatible bucket.
4. The browser calls `POST /v1/shows/:showId/episodes/:episodeId/complete-upload`; the API checks object metadata, expected owner/episode metadata, supported declared MIME type, and configured byte limit, then records a `MediaAsset` in `QUEUED` state. The original object is retained as an untrusted source and is not directly served.
5. Episode publication is rejected until processing succeeds and the media asset is `READY`.
6. Listeners use the public or authenticated member playback endpoint. The API returns a short-lived signed URL for the processed object.
7. A separate worker claims queued assets, downloads the private source, runs ClamAV, inspects streams and duration with `ffprobe`, transcodes with `ffmpeg`, and writes output under the `processed/` prefix. It marks an asset `READY` only after the output upload succeeds.

## Worker container

The worker has a dedicated container definition and is not started by the NestJS API.

Build from the repository root:

```sh
docker build -f apps/api/Dockerfile.media-worker -t voxa-media-worker:local .
```

Run the standalone Compose service:

```sh
docker compose -f infra/media-worker.compose.yml up -d --build
docker compose -f infra/media-worker.compose.yml logs -f voxa-media-worker
```

The Compose file expects a root-level `.env` file (or equivalent deployment environment) containing the worker's database and private S3 configuration. Do not commit that file. The repository `.dockerignore` excludes environment files, Git metadata, dependency folders and local build outputs from the image build context.

The image includes Node.js 20, FFmpeg/FFprobe, ClamAV and its signature updater. On startup, the entrypoint performs a foreground signature update and refuses to start the worker if that update fails. It then runs scheduled signature updates while the worker operates as the unprivileged `voxa` user. A ClamAV scan failure blocks the asset; it must never be interpreted as a clean scan.

The Compose example applies a 4 GiB memory limit, 2 CPU limit, PID limit, restart policy and graceful-stop window. These are starter values, not universal production sizing. Tune them against representative long-form files and your hosting provider's resource model. Use a private network path to PostgreSQL and object storage; do not expose database or storage credentials to the browser.

## Required configuration

Set these on the API and worker as applicable:

- `DATABASE_URL`
- `S3_BUCKET`
- `S3_REGION`
- `S3_ENDPOINT` when using a non-AWS S3-compatible provider
- `S3_ACCESS_KEY_ID`
- `S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE` where required by the provider
- `MEDIA_WORKER_INTERVAL_MS` (default 5000)
- `MEDIA_WORKER_STALE_MS` (default 3600000)
- `MEDIA_WORKER_MAX_ATTEMPTS` (default 3)

The API additionally needs its signed upload/playback URL settings and media byte limits. Configure bucket CORS only for the deployed VOXA web origins and required PUT headers. Keep the bucket private.

## Operational checks before launch

- Confirm the container can reach PostgreSQL and the private S3 endpoint.
- Confirm ClamAV signature update succeeds at startup and scheduled updates continue. Monitor updater logs and database freshness; a scanner without current signatures is not an acceptable launch condition.
- Upload representative audio and video fixtures, verify the worker claims them, inspect normalized output, and test signed playback through the API.
- Verify malformed, unsupported, overlong, malware-test and corrupt media fail closed and never become publishable.
- Exercise worker restart during a transcode, stale lease recovery, retry exhaustion and disk-full behavior.
- Alert on queue age, queued/processing/failed counts, repeated scan/transcode failures, worker restarts, low disk space, database connectivity and ClamAV update failures.
- Define retention and lifecycle policies for original uploads, processed renditions, abandoned multipart uploads and orphaned processed outputs.
- Keep the worker isolated from public ingress, apply least-privilege S3 permissions, restrict egress where practical, and maintain host/container patching.

## Current release limitations

- Malware scanning and stream inspection do not constitute human content moderation, copyright review, or a complete malicious-file guarantee.
- The worker currently produces one normalized MP3 or MP4 rendition. Adaptive HLS/DASH packaging, thumbnails, waveform extraction, loudness normalization, captions/transcripts and CDN delivery are not implemented.
- The browser currently uses native audio/video controls. Background playback, casting, offline downloads, chapters, transcripts, captions and a global persistent player are not implemented.
- A successful upload only means initial metadata, size, ownership and signature checks passed. The asset remains `QUEUED`; it is not publishable or playable until a trusted worker marks it `READY`.

## Production gate

The container and Compose definition are deployment packaging, not evidence of a live deployment. Before public launch, deploy into isolated resource-limited infrastructure, test with real media and production-like storage, configure monitoring and operator replay tooling, add moderation/copyright review, cleanup and retention jobs, CDN delivery, playback telemetry, and end-to-end tests for public and membership-gated playback.
