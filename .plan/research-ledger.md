# Olympus Research Ledger

Evidence base for the Project Olympus build. Claims are labeled FACT / INFERENCE /
ASSUMPTION / CONFLICT / UNKNOWN with source IDs.

## Sources

- SRC-001: User's Project Olympus manifesto (task prompt, 2026-08-25).
- SRC-002: CLAUDE.md (repo instruction file, checked in).
- SRC-003: Repository code at 7980a23 (server/, client/, database/, package.json).
- SRC-004: Toolchain runs in this container (jest, eslint, pnpm, `which ffmpeg`).
- SRC-005: olympus-survey workflow reports (client, server-detail, database, ops-docs).

## Claims register

| ID | Label | Claim | Source |
|----|-------|-------|--------|
| CL-01 | FACT | Runtime is a CommonJS Express monolith wired in server/index.js (auth, songs, playlists, playback, rooms, ai routes). TS files in server/ are unwired. | SRC-003 |
| CL-02 | FACT | Baseline: 22/22 jest tests pass; eslint --max-warnings=0 exits 0. | SRC-004 |
| CL-03 | FACT | No ffmpeg/ffprobe binary in this container. | SRC-004 |
| CL-04 | FACT | .env was tracked in git with JWT_SECRET=launch_day_secret_key_999, NODE_ENV=production; CLAUDE.md claims .env is gitignored. | SRC-002, SRC-003 |
| CL-05 | CONFLICT→DEC-001 | SRC-001 demands microservices, Kafka, ClickHouse, GraphQL federation, Istio, EKS. SRC-002 + SRC-003 define a pnpm monolith with strict in-repo rules; no infra credentials exist here. | SRC-001 vs SRC-002/003 |
| CL-06 | FACT | colabAIService implements a fallback-mode pattern (works without COLAB_* creds); CLAUDE.md mandates keeping fallbacks. | SRC-002, SRC-003 |
| CL-07 | FACT | schema.sql is the canonical schema used by live controllers (users, songs, playlists, playlist_songs, listening_rooms, room_participants, playback_states, listening_history, chat_messages, user_follows, song_likes). schema_v2 + migrations 001/003 add artists/albums/pgvector but controllers don't use them yet. | SRC-003, SRC-005 |
| CL-08 | FACT | Redis fallback doctrine: every Redis op in own try/catch, DB is source of truth (playbackController.js is the reference). | SRC-002, SRC-003 |
| CL-09 | FACT | Auth: JWT issuer 'hathor-music', authMiddleware sets req.user={userId,username,...}; streamAuth accepts short-lived stream tokens via ?t=. bcryptjs cost 12. | SRC-003 |
| CL-10 | ASSUMPTION | No live Postgres/Redis in container → all new tests must mock ../config/database and ../config/redis. Existing tests already run without either. | SRC-004 |
| CL-11 | FACT | Client is CRA-style React 18 in client/ (build via `cd client && npm run build`); pnpm workspace includes '.' and 'client'. | SRC-003 |
| CL-12 | FACT | jest testMatch is `**/?(*.)+(spec|test).js` — only .js tests run; .ts tests (auth.test.ts) are inert. | SRC-003 |
| CL-13 | FACT | CODEOWNERS: database/, server/routes/, server/socket/, validation.js, auth files, index.js, config/ all require @redinc23 approval — expected for this PR; no self-merge. | SRC-003 |
| CL-14 | UNKNOWN | Whether GitHub repo has 35 open issues to triage (manifesto claim). Check via GitHub MCP during M8. | SRC-001 |

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| DEC-001 | Build Olympus as a **modular monolith with extraction seams**: domain service modules under server/services/<domain>/, an in-process event bus with Redis adapter, a job queue with Redis/DB fallback, provider abstractions (payments, embeddings, transcode). No Kafka/ClickHouse/Istio here. | CLAUDE.md is authoritative for this repo; no infra creds; seams preserve the manifesto's target architecture as a migration path. Resolves CL-05. |
| DEC-002 | All new server code is CommonJS .js wired into server/index.js; the unwired .ts files stay untouched (documented as aspirational). | CL-01, CL-12; runtime has no TS build step. |
| DEC-003 | Payments: provider abstraction with `mock` provider default (deterministic, marks purchases provider='mock') and `stripe` provider activated by STRIPE_SECRET_KEY. No live charges from this environment. | CL-06 pattern; no credentials; manifesto wants Stripe Connect — seam provided. |
| DEC-004 | Transcode: ffmpeg detected at runtime; absent → planned-variant records marked status='skipped_no_ffmpeg' with the exact command persisted, direct-stream fallback continues to work. | CL-03; keeps pipeline honest, testable, and production-activatable. |
| DEC-005 | Embeddings: deterministic local feature-hash embedding (256-dim) as fallback provider; pgvector used when available, JSONB + JS cosine fallback otherwise (song_embeddings_local table). | CL-03/CL-10; migration 003's 1536-dim OpenAI path stays as the remote-provider seam. |
| DEC-006 | Schema changes: append new tables to database/schema.sql AND ship numbered migrations (004+). Never edit migrations 001/003. | SRC-002 database rules. |
| DEC-007 | .env untracked on this branch; rotation + history purge left to owner (needs main history rewrite). | CL-04; agent must not rewrite main. |
| DEC-008 | GDPR export runs through the same job queue as transcodes; artifacts under uploads/exports/<uuid>.json with expiring signed download token. | Manifesto P0 privacy story; reuses M1 infrastructure. |
