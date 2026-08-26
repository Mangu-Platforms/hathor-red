# Project Olympus — Program Plan

**Mission:** evolve hathor-red into the Mangu Music Ecosystem: a direct-to-fan
commerce + streaming platform built on five pillars, implemented as a modular
monolith with clean extraction seams (DEC-001, `.plan/research-ledger.md`).

Everything here traces manifesto epics → requirements (FR/NFR) → tasks (TASK) →
verification (TEST). IDs are stable; the traceability matrix is at the bottom.

## Objectives

- OBJ-1 Artists sell directly to fans (downloads, name-your-price, fan clubs) with an 80/20 artist-favoring split.
- OBJ-2 Listeners get high-quality, resilient playback (quality tiers, HLS-ready pipeline, loudness data, gapless-capable client).
- OBJ-3 Discovery works without external AI credentials and gets better with them (semantic search, Mangu Radar).
- OBJ-4 Social listening is synchronized and low-drift, with time-anchored commentary.
- OBJ-5 Artists see intelligence competitors don't give them (skip/retention analytics, geography, revenue attribution).
- OBJ-6 The platform is compliance-ready (GDPR export/deletion, audit trail, no secrets in git).

Non-goals for this phase: real Kafka/ClickHouse/Istio deployments, live Stripe
charges, WebRTC SFU media servers, mobile apps. Each has a documented seam.

## Architecture (DEC-001)

```
server/
  services/
    events/     in-process domain event bus + Redis pub/sub adapter (extraction seam)
    jobs/       durable job queue: Postgres table + optional Redis wake channel;
                in-process worker pool; the future BullMQ/EKS seam
    media/      transcode planner/executor (ffmpeg when present — DEC-004),
                loudness analysis, waveform peaks, artwork variants, HLS manifests
    commerce/   payment provider abstraction (mock | stripe — DEC-003), checkout,
                library entitlements, subscriptions, payout ledger (80/20)
    discovery/  embedding provider (local deterministic | remote — DEC-005),
                semantic search blend, Mangu Radar generator
    social/     timed comments, room sync/presence domain logic
    intel/      listening-event ingestion, rollups, artist analytics queries
    privacy/    GDPR export/delete jobs, audit log
```

Controllers stay thin; routes keep the `auth → validation → validate → controller`
contract; every Redis touch is fallback-wrapped; all SQL parameterized. New tables
land in `database/schema.sql` + numbered migrations 004+ (DEC-006).

## Functional requirements (abbreviated register)

| ID | Pillar | Requirement | AC (observable) |
|----|--------|-------------|-----------------|
| FR-101 | P1 | Upload creates a media asset with sha256 fingerprint and enqueues a transcode job planning quality variants (Opus 160k, AAC 256k, MP3 320k, FLAC, HLS segments). | TEST-101: enqueue on upload; variants planned; duplicate sha256 flagged (FR-604). |
| FR-102 | P1 | Job queue survives Redis loss (DB is source of truth), retries with backoff, exposes job status API. | TEST-102: queue works with redis mock throwing; retry/backoff unit tests. |
| FR-103 | P1 | Transcode executor runs ffmpeg when present; otherwise records planned commands with status `skipped_no_ffmpeg`; stream endpoint falls back to the original file. | TEST-103: executor fallback path unit-tested. |
| FR-104 | P1 | Loudness metadata (integrated LUFS, true peak) stored per asset when analyzable; exposed to client for volume normalization. | TEST-104: analysis parse + API shape. |
| FR-105 | P1 | HLS master manifest served per song from generated variants; 404→direct-stream fallback contract documented. | TEST-105: manifest generation from variant rows. |
| FR-201 | P2 | Semantic search endpoint blends trigram, metadata and embedding cosine similarity; works with zero external credentials. | TEST-201: deterministic local embeddings rank a bass-heavy techno query above folk. |
| FR-202 | P2 | Mangu Radar: personalized mix from co-listening + content similarity + freshness boost; cached; explicit "why picked" reasons. | TEST-202: generator unit tests over seeded mock rows. |
| FR-301 | P3 | Artist creates a product for a song: fixed price or name-your-price with minimum (including 0). | TEST-301: pricing rule validation matrix. |
| FR-302 | P3 | Checkout via provider abstraction; success grants permanent library entitlement + one-time expiring download token for the original file. | TEST-302: mock-provider checkout grants entitlement; token single-use enforced by atomic UPDATE … WHERE consumed_at IS NULL. |
| FR-303 | P3 | Revenue ledger records 80/20 artist/platform split in integer cents; artist payout summary endpoint. | TEST-303: split math property tests (no float drift, rounding to platform). |
| FR-304 | P3 | Fan-club subscription tiers per artist; entitlement middleware gates early-access content. | TEST-304: tier gate unit tests. |
| FR-401 | P4 | Time-synced comments: POST at timestamp_ms, listed by window, fanned out to song listeners via socket rooms. | TEST-401: window query + validation. |
| FR-402 | P4 | Room sync protocol: client clock-offset ping (`sync-ping`→`sync-pong` with server time), room state carries server timestamp so clients compute drift-corrected position. | TEST-402: offset math unit tests. |
| FR-403 | P4 | Live reactions + presence roster per room; host handoff when host leaves; chat persisted to chat_messages. | TEST-403: handler logic with mocked io/db. |
| FR-501 | P5 | Batch listening-event ingestion (play/pause/seek/skip/complete/segment) with server-side country attribution. | TEST-501: batch validation + insert shape. |
| FR-502 | P5 | Artist dashboard API: overview, top tracks, skip-rate curve (10s segments), geography, revenue attribution. | TEST-502: aggregation SQL result mapping (parseInt on counts). |
| FR-601 | P0 | .env untracked; gitignored. | Done in M0 (owner must rotate secret + purge history — see questions doc). |
| FR-602 | P0 | GDPR export: user requests export → background job writes JSON artifact → expiring download link. 72h SLA documented. | TEST-602: export job assembles all user tables via mocks. |
| FR-603 | P0 | Account deletion request flow (soft-mark + purge job seam) and audit_log for sensitive actions. | TEST-603: audit helper writes parameterized rows. |
| FR-604 | P0 | Upload fingerprinting: exact sha256 duplicate of another user's asset is flagged `copyright_review`; AcoustID seam documented. | TEST-604: duplicate detection unit test. |

## Non-functional requirements

- NFR-01 Tests hermetic: no live Postgres/Redis/ffmpeg/Stripe needed; CI-safe (CL-10).
- NFR-02 Every commit: jest green + eslint --max-warnings=0 (repo law).
- NFR-03 Graceful degradation: any external dependency loss degrades features, never 500s the core listen path (CL-06/08 doctrine).
- NFR-04 All money amounts are integer cents; bigint/COUNT values parseInt'd before math.
- NFR-05 New POST/PUT surface fully validated via express-validator chains.
- NFR-06 No breaking changes to existing API routes or socket events (client compatibility).
- NFR-07 Idempotency named mechanisms: checkout idempotency key (unique constraint on purchases.idempotency_key), download token single-use (atomic conditional UPDATE), job claim (UPDATE … WHERE status='queued' … RETURNING), event batch dedup (client_event_id unique).

## Milestones

M0 stabilization → M1 audio engine → M2 commerce → M3 discovery → M4 social →
M5 intelligence → M6 privacy/security → M7 client → M8 docs/PR/review.
(Ordering: commerce before discovery because revenue is the differentiator and
discovery consumes listening data that commerce/telemetry begin producing.)

Each milestone ships: migration + schema.sql append (when schema changes), service
module, controller+validation+routes, socket wiring (where relevant), hermetic tests,
doc updates. Verification evidence lands in `.plan/evidence/`.

## Traceability

| FR | TASK (commit slice) | TEST file |
|----|--------------------|-----------|
| FR-101..105 | M1 commits | server/tests/media.*.test.js |
| FR-201..202 | M3 commits | server/tests/discovery.*.test.js |
| FR-301..304 | M2 commits | server/tests/commerce.*.test.js |
| FR-401..403 | M4 commits | server/tests/social.*.test.js |
| FR-501..502 | M5 commits | server/tests/intel.*.test.js |
| FR-602..604 | M6 commits | server/tests/privacy.*.test.js |

## Rollout & operations

- Feature flags via env (FEATURE_COMMERCE, FEATURE_DISCOVERY, …) default ON in dev, documented in .env.example — flags gate route mounting, so ops can disable a pillar without redeploy of code changes.
- Migrations are additive-only; rollback = don't mount routes (no destructive DDL).
- Runbook: docs/olympus/runbook.md (written in M8).
- Residual risks + open questions: docs/olympus/questions-for-max.md (M8).
