# Project Olympus — Operations Runbook

How to run, operate, and progressively activate the Olympus build.

## Boot sequence

1. **Migrations** — run in order against Postgres 15:
   `database/migrations/001 → 003 → 004 → 005 → 006 → 007 → 008 → 009`
   (002 never existed; 001 needs the `vector` extension that 003 creates — on a
   **fresh** database run `database/schema.sql` instead, which is the complete
   mirror and needs only `pg_trgm`. Migrations 004+ are pure-Postgres: no
   pgvector required.)
2. `pnpm install`
3. `npm start` (or `npm run dev`). The server boots even with Redis down,
   ffmpeg missing, and no external credentials — every Olympus service has a
   fallback mode.

## Feature flags (env)

| Flag | Default | Gates |
|------|---------|-------|
| `FEATURE_MEDIA_PIPELINE` | on | `/api/media`, transcode worker handler |
| `FEATURE_COMMERCE` | on | `/api/commerce` |
| `FEATURE_DISCOVERY` | on | `/api/discovery`, embed/radar handlers |
| `FEATURE_SOCIAL` | on | `/api/social` |
| `FEATURE_INTEL` | on | `/api/intel`, rollup handler |
| `FEATURE_PRIVACY` | on | `/api/privacy`, gdpr-export handler |
| `FEATURE_WORKER` | on | the in-process job worker |

Set any to `false` to disable that pillar without a deploy. Route mounting is
evaluated at boot — a flag change needs a restart.

## The job system

- **Source of truth:** the `jobs` table. Claiming uses `FOR UPDATE SKIP LOCKED`
  (safe to run many workers). Redis channel `olympus:jobs:wake` only shortens
  pickup latency.
- **Job types:** `transcode`, `embed-songs`, `radar-refresh`, `intel-rollup`,
  `gdpr-export`.
- **Retries:** exponential backoff 30s → 2m → 8m (cap 30m), then `status='dead'`.
- **Inspect:** `SELECT id, job_type, status, attempts, last_error FROM jobs ORDER BY id DESC LIMIT 50;`
- **Revive a dead job:** `UPDATE jobs SET status='queued', attempts=0, run_at=now() WHERE id=<id>;`
- **Scale-out seam:** run the same codebase in a worker-only dyno by disabling
  route traffic to it; handlers poll the shared table. (BullMQ/EKS migration
  keeps the jobs-table contract.)
- **Periodic jobs:** `radar-refresh` and `intel-rollup` are enqueued on demand
  today. For scheduled runs, add a cron that inserts one row, e.g. nightly:
  `INSERT INTO jobs (job_type, payload) VALUES ('intel-rollup', '{}');`

## Progressive activation

| Capability | Activate by | Behavior until then |
|------------|------------|---------------------|
| Real transcoding + HLS + loudness | installing `ffmpeg` on the worker host | variants recorded `skipped_no_ffmpeg` with the exact command persisted; replay with `POST /api/media/songs/:id/reprocess` after install; playback uses the original file via byte-range streaming |
| Real payments | `STRIPE_SECRET_KEY` | deterministic `mock` provider (refs `mock_*`); purchases/ledger fully functional but simulated |
| Remote embeddings + pgvector ANN | pgvector + a hosted model (migration 003 table is the target) | deterministic local 256-dim feature-hash embeddings, ranked in app code |
| Faster job pickup | `REDIS_URL` | 15s poll interval (`JOB_POLL_INTERVAL_MS`) |

## Health & degradation signals

- `GET /api/health` — db/redis checks (existing).
- Logs: `Payment provider: mock…`, `ffmpeg not found…`, `Job worker started…`
  at boot tell you exactly which mode each pillar is in.
- Redis down: caches and wake channel silently disable; watch for
  `…(poll loop continues)` / `…(DB copy persisted)` warnings.

## GDPR SLA

Export requests are queued jobs; with the worker healthy they complete in
seconds. The 72-hour SLA is a policy bound, not a system one. Artifacts live
under `uploads/exports/` and are superseded (file deleted) by the next export.
Deletion requests are recorded and audited; purge execution deliberately
requires an owner decision on retention policy (see questions doc).

## Copyright review queue

Byte-identical uploads of another user's file are flagged:
`SELECT * FROM media_assets WHERE status='copyright_review';`
Clearing one: set `status='pending'` and `POST /api/media/songs/:id/reprocess`
(as admin), or leave flagged and handle per legal policy. AcoustID perceptual
fingerprinting is the planned upgrade for near-duplicate detection.

## Rollback

All Olympus DDL is additive; roll back by turning `FEATURE_*` flags off.
No destructive migration exists. The `.env` untracking (M0) is permanent —
never re-commit it; rotate `JWT_SECRET` (see questions doc).
