# Olympus Execution State

> Volatile brain of the Project Olympus build. Updated after every checkpoint.
> Cold-start protocol: read `CLAUDE.md` (Olympus section at bottom) → this file →
> `docs/olympus/program-plan.md` → last checkpoint below. Then resume the next action.

## Mission (one line)

Build Project Olympus — the Big 5 pillars (audio engine, discovery, commerce, social,
artist intelligence) — inside the existing hathor-red Express/React/Postgres/Redis
modular monolith, on branch `claude/project-olympus-mangu-lt4ejb`, tests + lint green
at every commit, draft PR at the end. User (Max, @redinc23 repo) returns ~14h after
2026-08-25 ~23:00 UTC.

## Hard constraints (from CLAUDE.md + environment)

- Branch: `claude/project-olympus-mangu-lt4ejb` only. Never push elsewhere. Never merge.
- Before EVERY commit: `./node_modules/.bin/jest` (all green) AND
  `./node_modules/.bin/eslint . --max-warnings=0` (exit 0).
- Parameterized SQL only. `parseInt` any COUNT(*)/bigint before comparing.
- Every Redis read/write in its own try/catch, DB fallback (see playbackController.js).
- Every POST/PUT route: authMiddleware → validation chain → `validate` → controller.
- Socket user sync: `socket.to('user-${userId}')`, never `socket.broadcast.emit`.
- Room-control host check stays.
- Services degrade gracefully without external backends (colabAIService pattern):
  no ffmpeg binary in this container, no live Postgres/Redis/Stripe — everything
  needs a fallback mode and hermetic tests (mock db/redis modules).
- Never commit .env. (It WAS tracked — removed in M0; owner must rotate + purge history.)
- The real runtime is the CommonJS JS monolith wired in server/index.js. The .ts files
  in server/ are NOT wired (type-checked only). Build new code as CommonJS .js.

## Milestone queue (Task tool ledger mirrors this)

- [x] M0 Sprint-0 stabilization (untrack .env, plan files, charter)  — Task #1
- [x] M1 Pillar 1 Immersive Audio Engine — Task #2 (commit d68f2ca)
- [x] M2 Pillar 3 Creator Commerce Suite — Task #3 (commit 5cf6d0d)
- [x] M3 Pillar 2 Cognitive Discovery — Task #4 (644db1f)
- [x] M4 Pillar 4 Social Listening — Task #5 (1257dae)
- [x] M5 Pillar 5 Artist Intelligence Hub — Task #6 (fc99208)
- [x] M6 Security & compliance — Task #7 (29d75b2)
- [x] M7 Client integration — Task #8 (a529acb)
- [x] M8 Docs, OpenAPI, PR, adversarial review, questions — Task #9 (55b9bbc)

Pace budget: ~1 milestone per 1–1.5h of active work. If M1–M5 are not done by the
time M8 must start (leave ≥1.5h for review+PR+docs), descope in this order:
M7 client work shrinks to player+library only → M6 keeps GDPR export, drops audit
polish → M5 drops geo heatmap detail. Record any descope as a DEC entry in the ledger.

## Checkpoint ledger

### C-000 (baseline)
- Branch at 7980a23 (== origin/main). `pnpm install` done (node 22, pnpm 8.9).
- Evidence: 22/22 jest tests pass, eslint exit 0 (see .plan/evidence/C-000-baseline.log).
- Remote branch does not exist yet; first push creates it. No PR yet.
- ffmpeg NOT present. Postgres/Redis NOT running here — tests must stay hermetic.
- .env was git-tracked with JWT_SECRET=launch_day_secret_key_999 and NODE_ENV=production.

### C-001 (M0 in progress)
- Untracked .env (git rm --cached), .gitignore now covers .env and .plan/evidence/.
- Created .plan/execution-state.md, .plan/research-ledger.md, docs/olympus/program-plan.md,
  appended Olympus charter to CLAUDE.md.
- Survey workflow (olympus-survey, run wf_fcfcf242-592) launched over client/server/db/ops.
- Next action: commit M0 slice, read survey results, start M1 (media pipeline).

### C-002 (M1 done)
- Commit d68f2ca: media_assets/media_variants/jobs tables (migration 004), jobQueue
  (SKIP LOCKED claim, backoff, dead-letter), worker (poll + Redis wake), transcode
  service (ffmpeg detect, plan-only fallback, loudnorm, waveform approx), HLS
  master/segment serving (token auth, path-safe), /api/media routes, upload wiring,
  feature flags. 55/55 tests green, eslint clean (evidence C-001-tests.log pattern).
- Key APIs for later milestones: jobQueue.enqueue/claimNext/complete/fail;
  worker.register(type, fn); features.is*Enabled(); roles.isAdmin.
- Naming decision: avoid schema_v2 reserved names (subscriptions, transcoded_tracks);
  commerce uses artist_subscriptions etc.
- Next action: M2 commerce (migration 005: products, purchases, user_library,
  artist_subscription_tiers, artist_subscriptions, download_tokens, revenue_ledger).

### C-003 (M2 done)
- Commit 5cf6d0d pushed. Commerce: products/purchases/user_library/download_tokens/
  artist_subscription_tiers/artist_subscriptions/revenue_ledger (migration 005),
  paymentProvider (mock default, Stripe REST via STRIPE_SECRET_KEY), checkout with
  idempotency + 80/20 ledger + library grant + one-time download tokens (atomic
  conditional UPDATE), fan clubs + early-access gate in getStreamUrl,
  resolveUploadPath shared util. 80/80 tests, eslint clean.
- Property sweep caught real bug: split() truncated fractional cents via parseInt —
  fixed with Number() + isInteger guard.
- Next action: M3 discovery (migration 006: song_embeddings_local, user_radar;
  embeddingService deterministic feature-hash 256-dim; searchService blend
  cosine+trigram+freshness; radarService co-listen CF + content + freshness;
  /api/discovery routes; worker handlers embed-songs + radar-refresh).

### C-004 (M3-M6 done, all server pillars complete)
- 153/153 tests, eslint clean, all pushed. Migrations 004-009 + schema.sql mirror.
- Server API surface now: /api/media, /api/commerce, /api/discovery, /api/social,
  /api/intel, /api/privacy + upgraded sockets (sync-ping, reactions, rtc relay,
  host handoff, presence) + early-access gate in getStreamUrl.
- Worker handlers: transcode, embed-songs, radar-refresh, intel-rollup, gdpr-export.
- Next action: M7 client (CRA in client/, NOT covered by root eslint/jest — verify
  via `cd client && npm run build`). Survey: .plan/evidence/survey-client.md.
  Planned: services (commerce/discovery/social/intel/privacy), PlayerContext
  telemetry + loudness + preload, pages Store/Library/Radar/Search/Dashboard/
  Settings, comment overlay in MusicPlayer, Sidebar+App routes.

### C-005 (M7 done, M8 in progress)
- Client integrated (commit a529acb): telemetry + loudness + preload in
  PlayerContext, pages Store/Library/Radar/Search/ArtistDashboard/Settings,
  TrackComments overlay, sidebar/routes. CRA build compiles with ZERO warnings.
- M8 running: adversarial review workflow wf_a4e5760e-e2b (6 lenses + verify)
  in background; docs written (runbook.md, questions-for-max.md, API.md
  Olympus section). Repo has 0 open issues (manifesto's '35' is stale).
- Next action: when review lands → fix confirmed findings → gates → push →
  finalize PR #96 body → send_later check-in loop.

### C-006 (BUILD COMPLETE — PR #96 merged by Max, hardening PR #97 open)
- PR #96 (full Olympus build, M0-M8) was taken out of draft and MERGED by
  @redinc23 at 2026-08-26T03:05Z. Branch fast-forwarded to merged main.
- Adversarial review (wf_a4e5760e-e2b, 6 lenses + independent verification)
  confirmed 31 findings; ALL fixed in commit 55b9bbc → PR #97 (draft).
  Findings ledger: .plan/evidence/review-confirmed.md.
- CI: both red checks were PRE-EXISTING on main and are fixed in #97:
  Type Check (unwired TS shadowing JS in tsc resolution → server/_reference/)
  and scan (trivy-action 0.28.0 tag orphaned by v-prefix re-tag → SHA pin).
  Build went green earlier via the M7 warning fixes.
- Gates at 55b9bbc: 173/173 jest, eslint clean, tsc --noEmit clean, client
  CI=true build clean.
- Watching PR #97 (subscribed). Next: drive #97 to green/merge; check-in
  scheduled via send_later.

### C-007 (dependency remediation, PR #97 driving to green)
- Scan check ran for the FIRST time on 55b9bbc (SHA pin worked) and reported
  the pre-existing backlog: 84 CVEs (2 CRIT websocket-driver + shell-quote,
  39 HIGH incl. ws/engine.io/socket.io-parser/multer). Commit 4d09cef fixes
  all 84 via direct bumps + pnpm.overrides (each within consumer major line),
  lockfile regenerated. Gates green: 173/173 jest, eslint, tsc, require graph
  under uuid11/multer2.2, client CI=true build.
- PR #97 body updated with the full story. Awaiting CI on 4d09cef; check-in
  trig_01YGzz8BdVjBATT4St5Pwoyt fires 04:22Z to verify green + re-arm.

### C-008 (Node 20 migration)
- docker-image `build` failed on 4d09cef: serialize-javascript@7 (RCE-patched,
  no 6.x backport) needs global WebCrypto = Node >= 19; image was node:18
  (EOL). Commit 1c085dd migrates Dockerfile/.devcontainer/workflow pins/
  engines/volta/.nvmrc to Node 20 LTS. All local gates green on the new tree.
- Stale-head scan failures (55b9bbc/4fec408) superseded by 4d09cef — no action.
- Awaiting CI on 1c085dd (scan + docker build + quality-gate on Node 20).
  Check-in trig_01YGzz8BdVjBATT4St5Pwoyt at 04:22Z verifies + re-arms.

### C-009 (stale npm lockfiles removed)
- scan on 4d09cef was still red because Trivy also scans package-lock.json +
  client/package-lock.json — stale npm lockfiles pinning the whole pre-fix
  CRA tree (nth-check/svgo/node-forge/rollup/underscore...). Nothing consumes
  them (no npm ci anywhere; pnpm everywhere). Removed in 9ca127f.
- Head now: 55b9bbc hardening + 4d09cef dep remediation + 1c085dd Node 20 +
  9ca127f lockfile cleanup. Expected all-green: Lint/Tests/Type Check/Build
  verified locally under CI conditions; scan surface = remediated pnpm-lock
  only; docker build = Node 20.
- Check-in trig_01YGzz8BdVjBATT4St5Pwoyt (04:22Z) verifies CI on 9ca127f.

## Open blockers

(none)

## Questions for Max (compile into docs/olympus/questions-for-max.md before PR)

1. Tracked .env with production-looking JWT secret: rotate JWT_SECRET everywhere and
   purge .env from git history (needs a force-push to main — owner action).
2. The manifesto's Sprint 0 says "merge or close 35 existing issues" — closing issues
   is externally visible; recommendations will be compiled instead, owner decides.
3. Microservices/Kafka/ClickHouse/Istio: built as in-process seams (event bus, job
   queue, provider abstractions) that can be extracted later; confirm this staging.
