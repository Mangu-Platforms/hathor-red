# Hathor-Red — Requirements & Action Plan

> **Status:** Living document. Derived from the Deep Audit (June 2026).
> **Purpose:** Turn the audit findings into an executable plan that clearly separates
> **what a human must do** from **what an AI agent can automate**.
> **Source of truth precedence:** This file supersedes the aspirational `.md` files
> (`IMPLEMENTATION_SUMMARY.md`, `PRODUCTION_READY.md`, `BEST_IN_WORLD_FEATURES.md`, etc.)
> for *planning*. The audit (`docs/deep-dives/CURRENT-REPO-AUDIT.md` + the Deep Audit)
> remains the source of truth for *current state*.

---

## 0. How to read this document

Every work item is tagged with an **Owner** so it is unambiguous who acts:

| Tag | Meaning | Examples |
|-----|---------|----------|
| 👤 **YOU** | A human must do this. Cannot be automated (requires money, legal authority, account ownership, a real-world decision, or a credential). | Open a Stripe account, sign a label deal, choose a pricing model, provision an S3 bucket, approve CODEOWNERS PRs |
| 🤖 **AGENT** | Fully automatable. An AI coding agent can complete it end-to-end given the repo + secrets. | Fix bugs, add validation, write migrations, build UI pages, write tests |
| 🤝 **BOTH** | Agent does the code; you must supply an input first (a secret, a decision, an asset) or verify after. | Wire Stripe SDK (agent) after you create the account + keys (you) |

Each item also carries:

- **Risk** — `Low` / `Med` / `High` (blast radius if it goes wrong)
- **Blocks** — what cannot start until this is done
- **Files** — concrete paths the work touches
- **Done when** — acceptance criteria

> ⚠️ **Repo guardrails that constrain the agent** (from `CLAUDE.md` / `AGENTS.md`):
> - Agent works on `claude/<task-slug>` or `cursor/<slug>` branches, **never pushes to `main`**.
> - `./node_modules/.bin/jest` (14-test floor) and `./node_modules/.bin/eslint . --max-warnings=0` must pass before commit.
> - Paths in `.github/CODEOWNERS` (`database/`, `server/index.js`, `server/config/`, `server/middleware/auth.js`,
>   `server/middleware/validation.js`, `server/utils/auth.js`, `server/socket/`, `server/routes/`, `.github/`,
>   `Dockerfile`, `docker-compose.yml`) **require @redinc23 human approval** even when the agent writes the code.
>   → Any item touching those paths is **🤝 BOTH** at minimum (agent codes, you approve the PR).

---

## 1. TL;DR — The split

### 👤 Things only YOU can do (no agent can do these for you)

These are blockers for whole categories of work. Nothing in the dependent phases ships until you act.

| # | Action | Unblocks | Cost |
|---|--------|----------|------|
| Y1 | **Product decision: kill or keep placebo features** (pitch-shift, stem separation, vibe sliders). | Phase 0 honesty fix; audio engine scope | Decision only |
| Y2 | **Provision object storage** (AWS S3 / GCS bucket) + IAM keys. | Uploads at scale, transcoding, CDN | ~$ low, account needed |
| Y3 | **Create Stripe account**, define plans/prices, get API keys + webhook secret. | All billing/subscriptions | Account + business entity |
| Y4 | **Create OAuth apps** (Google/Apple/Spotify) → client IDs/secrets. | Social login | Developer accounts |
| Y5 | **Decide pricing & tier model** (what FREE/HIFI/STUDIO actually include). | Billing schema, paywall gating | Decision only |
| Y6 | **Secure music licensing / content rights** (labels, distributors, or original-only). | Legal catalog ingest, royalties, regional windows | Legal + $$$ |
| Y7 | **Stand up managed Postgres + Redis** (prod) and put credentials in deploy platform secrets. | Any production deploy | Account + $ |
| Y8 | **Provision email/SMS provider** (Postmark/SendGrid/SES) keys. | Password reset, email verification, notifications | Account |
| Y9 | **Approve CODEOWNERS-gated PRs** (@redinc23). | Every change under `database/`, `server/config/`, `server/middleware/auth.js`, etc. | Review time |
| Y10 | **Set monitoring/error budget** — create Sentry/APM project, supply DSN. | Production observability | Account (free tier ok) |
| Y11 | **Choose target market reality** (README claims "East Asia niche MVP"). Confirm or change so i18n/regional schema is scoped correctly. | i18n, regional availability | Decision only |
| Y12 | **Domain + DNS + TLS + CDN account** (Cloudflare/Fastly). | Public launch, edge delivery | Account + $ |

> Put all keys/secrets in **Cursor Dashboard → Cloud Agents → Secrets** (or your deploy platform's
> env config) so the agent can wire integrations without ever seeing raw values in code.
> **Never commit `.env`.**

### 🤖 Things the AGENT can do fully autonomously (once unblocked)

Everything that is pure code + tests + docs: bug fixes, validation, migrations, dead-code removal,
new API routes/controllers, new React pages, the Vite/TS migration, the real audio engine,
search/library/playlist-detail UIs, test coverage, OpenAPI docs, socket.io-redis adapter, etc.
The only caveat: CODEOWNERS-gated paths still need your PR approval (🤝).

---

## 2. PHASE 0 — Blockers (do first, mostly 🤖)

> Goal: stop the bleeding. These are verified bugs and honesty problems. None require money.
> Most are agent-automatable; a few touch CODEOWNERS paths (your approval needed).

| ID | Owner | Risk | Item | Files | Done when |
|----|-------|------|------|-------|-----------|
| **P0-1** | 🤝 (agent + approve) | High | Export `getPoolStatus` from DB config (or remove the import) so `/api/health` stops returning 503. | `server/config/database.js`, `server/index.js` | `GET /api/health` returns 200 with DB status; LB probe passes. |
| **P0-2** | 🤝 | High | Add validation middleware to the 4 unvalidated POST routes: `/api/ai/playlist/generate`, `/api/ai/mood/detect`, `/api/ai/chat`, `/api/playback/state`. (CLAUDE.md rule.) | `server/routes/ai.js`, `server/routes/playback.js`, `server/middleware/validation.js` | Each route has `validate` array; invalid bodies return 400; tests cover happy + error path. |
| **P0-3** | 🤝 | Med | Add `issuer:'hathor-music'` to the stream-token verify path. | `server/middleware/streamAuth.js` | Verify call matches `auth.js`; token from a different issuer is rejected. |
| **P0-4** | 🤝 | Med | Fix Redis cache invalidation in socket `sync-state` (write Redis after DB so reads aren't stale). BUGS.md #2. | `server/socket/handlers.js` | After sync, `getPlaybackState` returns fresh value; test asserts Redis updated. |
| **P0-5** | 🤝 | Med | Delete `room_participants` rows on `disconnect` and `leave-room` so listener counts don't inflate. BUGS.md #3. | `server/socket/handlers.js` | Leaving/disconnecting decrements count; integration test confirms row removed. |
| **P0-6** | 🤖 | Low | Delete orphan client files: `AIChat.js/.css`, `AIRecommendations.js/.css`, `Player.js/.css`, `Auth.css`, `services/ai.js`. | `client/src/components/`, `client/src/services/ai.js` | Files removed; build still passes; no remaining imports reference them. |
| **P0-7** | 🤖 | Med | Fix `recordListening(song.id, 0)` — stop logging zero-duration rows; record real elapsed/progress. | `client/src/contexts/PlayerContext.js`, `server/controllers/songController.js` | `listening_history` gets real durations; stats endpoint returns sane numbers. |
| **P0-8** | 👤→🤖 | Med | **Decide (Y1)** then act on placebo pitch/stem UI: either (A) agent implements real Web Audio (see P2-9) or (B) agent removes the UI + updates `README.md`/`FEATURES.md`. | `client/src/contexts/PlayerContext.js`, `README.md`, `FEATURES.md` | UI matches reality; docs no longer claim unimplemented features. |
| **P0-9** | 🤖 | Low | Add a `*` catch-all 404 route and a route so playlists are openable (links to P2-4). | `client/src/App.js` | Unknown URLs render a 404 page, not a blank screen. |
| **P0-10** | 🤝 | Low | Don't `process.exit(-1)` on a single idle-client pool error; log + recover. | `server/config/database.js` | One bad pool tick logs an error; server stays up. |
| **P0-11** | 🤖 | Low | Mount the orphan exported handlers or delete them: `songController.getGenres`, `playlistController.removeSongFromPlaylist`. | `server/routes/songs.js`, `server/routes/playlists.js` | Either routed + tested, or removed; no dead exports. |
| **P0-12** | 🤝 | Med | Make playlist-position and room-capacity writes atomic (race fix B9). | `server/controllers/playlistController.js`, `server/controllers/roomController.js` | Concurrent inserts don't collide; uses single SQL or transaction. |
| **P0-13** | 🤝 | Med | Persist socket chat to `chat_messages` and load history on join. BUGS.md/B6. | `server/socket/handlers.js`, new `server/controllers/chatController.js` (or route) | Chat survives reload; history endpoint returns prior messages. |
| **P0-14** | 🤖 | Low | Reconcile the two competing AI-playlist code paths into one. B8. | `server/controllers/playlistController.js`, `server/controllers/aiController.js` | Single code path; the other is removed; tests pass. |

**Phase 0 exit criteria:** `/api/health` green · all POST routes validated · no stale Redis reads · room counts accurate · no dead client files · honest feature surface · jest + eslint green.

---

## 3. PHASE 1 — Foundation (nothing scales without these)

> Goal: make the platform changeable and multi-instance-safe. Heavy CODEOWNERS overlap → most are 🤝.
> A couple require **you** to provision infrastructure first.

| ID | Owner | Risk | Item | Depends on | Done when |
|----|-------|------|------|-----------|-----------|
| **P1-1** | 🤝 | High | **Adopt a migration tool** (`node-pg-migrate` or Knex). Convert `database/schema.sql` into a baseline migration; wire `migrate` into CI + deploy. | — | `npm run migrate` applies versioned migrations; schema.sql is no longer the live mechanism. |
| **P1-2** | 🤝 | High | **Normalize `artists`, `albums`, `genres`** into real tables + FKs; backfill from `songs.artist/album/genre` strings; add `songs.updated_at`. | P1-1 | New tables populated; `songs` references them; old string columns deprecated. |
| **P1-3** | 🤝 | High | Drop `playback_states UNIQUE(user_id)`; add `devices` table; key playback state per device. | P1-1 | Two devices hold independent state; sync still works. |
| **P1-4** | 🤝 | High | Add `refresh_tokens` + password-reset + email-verification flows. | P1-1, Y8 (email keys) | Refresh/rotate works; reset + verify emails send; logout-everywhere possible. |
| **P1-5** | 🤝 | Med | Add CHECK constraints (volume, playback_speed, pitch_shift, completion_rate, users.role), widen URL columns to `TEXT`, `BIGSERIAL` for high-churn tables, missing indexes (D5–D10). | P1-1 | Bad values rejected at DB; long signed URLs fit; hot queries indexed. |
| **P1-6** | 👤→🤝 | High | **Move uploads to S3/GCS**; serve signed URLs directly (stop proxying bytes through Node). | **Y2** (bucket + keys) | New uploads land in object storage; stream URLs are object-storage signed URLs. |
| **P1-7** | 🤝 | Med | Add a **background-job runner** (BullMQ on existing Redis). Scaffold queues for audio-analysis, transcoding, embeddings, notifications, chart aggregation. | P0 done | A worker process runs; a sample job (e.g., play-count reconcile) executes async. |
| **P1-8** | 🤝 | Med | Add **socket.io-redis adapter** so rooms work multi-instance; move `activeUsers`/`roomHosts` off process-local Maps. B13. | — | Two server instances share room state in a local 2-node test. |
| **P1-9** | 🤖 | Med | **Replace CRA with Vite + TypeScript**; add an error boundary, React Query, a UI lib (Radix/shadcn), and a toast system. | P0-6 | `client` builds with Vite; TS compiles; one route migrated as proof; error boundary catches a thrown render. |
| **P1-10** | 🤝 | Med | Add `song_likes` (like/unlike) and `user_follows` (follow/unfollow) endpoints — tables already exist. | P1-1 | API can like/unlike a song and follow/unfollow a user; tests cover both. |
| **P1-11** | 🤝 | Low | Add denormalization integrity: trigger (or job) keeping `songs.play_count` in sync with `listening_history`. D5. | P1-7 | play_count matches aggregate within job interval. |

**Phase 1 exit criteria:** versioned migrations · normalized core entities · per-device playback · refresh/reset/verify auth · object-storage streaming · job runner · multi-instance sockets · Vite/TS client.

---

## 4. PHASE 2 — The Heart of the App (user-visible wins)

> Goal: build the daily-driver UX every music app has and this one lacks.
> These are almost entirely **🤖 AGENT** — pure code on top of Phase 1 foundations.
> The audit's recommended highest-ROI trio is **P2-1 + P2-4 + P2-5** ("unlock 80% of missing UX with no new infra").

| ID | Owner | Risk | Item | Depends on | Done when |
|----|-------|------|------|-----------|-----------|
| **P2-1** | 🤖 | Low | **Search**: header search bar + `/search` page + results, backed by existing `pg_trgm` index and `semanticSearch` endpoint. | — | Typing a query returns songs/artists/albums; keyboard accessible. |
| **P2-2** | 🤖 | Med | **Artist page** `/artist/:id` (image, top tracks, "more by", follow). | P1-2, P1-10 | Visiting an artist shows their catalog; follow button works. |
| **P2-3** | 🤖 | Med | **Album page** `/album/:id` (cover, tracklist, play album, release date). | P1-2 | Album view plays in order; metadata shown. |
| **P2-4** | 🤖 | Med | **Playlist detail page** `/playlist/:id` — view tracks, reorder, edit name/cover/description, remove track (wire `removeSongFromPlaylist`), share, follow. | P0-11, P1-1 | Clicking a playlist opens it; reorder + remove persist. |
| **P2-5** | 🤖 | Med | **Library / "My Music"** `/library` — liked songs, recently played, saved albums/artists. | P1-10 | Liked songs and history render; saves persist. |
| **P2-6** | 🤖 | Med | **Queue / Up Next** drawer in the player ("add to queue", "play next", drag-reorder). | P1-9 | Queue visible + reorderable; next/prev respect it. |
| **P2-7** | 🤝 | Med | **Lyrics**: `lyrics` table + LRC parser + scroll-synced view. | P1-1 | Time-synced lyrics scroll with playback when present. |
| **P2-8** | 🤖 | Med | **Settings page** — audio quality, theme toggle, language, EQ presets, device list, explicit filter, account deletion. | P1-3, P1-9 | Settings persist per user; theme toggles live. |
| **P2-9** | 🤖 | High | **Real audio engine** (Howler.js or a Web Audio graph) so EQ / pitch / stems / crossfade / gapless / visualizer are real (replaces placebo). | P0-8=A, P3 stems storage for stems | Pitch slider actually shifts pitch; EQ nodes audibly change output. |
| **P2-10** | 🤖 | Med | **Profile page** `/profile` + public `/user/:id`. | P1-4 | Own profile editable; public profile viewable. |
| **P2-11** | 🤝 | Med | **Notifications** — `notifications` table + bell + inbox + preferences; fanout via job runner. | P1-1, P1-7 | Follow/new-release events create notifications; bell shows unread. |
| **P2-12** | 🤝 | High | **Real recommendations** — embedding store + basic collaborative filtering on `listening_history` ("Daily Mix", "Discover Weekly"). Replaces hardcoded keyword matching. | P1-1, P1-7 | Recs reflect listening history, not static keywords. |
| **P2-13** | 🤝 | Med | **Trending / charts** — materialized Top 50 / New Releases / Trending, aggregated by job. | P1-7 | Charts page shows time-windowed rankings. |
| **P2-14** | 🤝 | Med | **Radio / endless mix** — "start radio from this song/artist", station persistence. | P2-12 | Radio generates an endless, themed queue. |

**Phase 2 exit criteria:** search · artist/album/playlist/library/profile pages · real queue · real audio engine · working recs/charts.

---

## 5. PHASE 3 — Business, Legal & Monetization (🤝 / 👤-heavy)

> Goal: make it legal and able to take money. **This phase is gated on human/legal/financial action.**
> The audit estimates this as a substantial separate build before you can take payments.

| ID | Owner | Risk | Item | Human prerequisite | Done when |
|----|-------|------|------|--------------------|-----------|
| **P3-1** | 👤→🤝 | High | **Subscriptions + Stripe** — `subscriptions`, `plans`, `invoices`, `payment_methods`, `stripe_customers`; checkout + webhooks; gate HIFI/STUDIO tiers. | **Y3, Y5** (Stripe acct, keys, pricing) | A test-mode checkout creates a subscription; webhook updates entitlement. |
| **P3-2** | 👤→🤝 | High | **Content rights / licensing** — `labels`, `licenses`, `rights_holders`, `territories`, `availability_windows`. | **Y6** (licensing deals/strategy) | Catalog ingest respects rights + windows; ineligible tracks hidden. |
| **P3-3** | 👤→🤝 | High | **Royalties / payouts** — `royalty_splits`, `streams_attribution`, `payouts`. | **Y6** + payout provider | Streams attribute to rights-holders; payout report generates. |
| **P3-4** | 👤→🤝 | Med | **OAuth providers** (Google/Apple/Spotify/Facebook) + `oauth_accounts`. | **Y4** (OAuth client IDs/secrets) | User can sign in with a provider; account links. |
| **P3-5** | 🤝 | Med | **Geographic / regional content** — `users.country`, `songs.regions_available`; enforce regional windows. | **Y11** (target-market decision) | Region-restricted track is blocked outside its territory. |
| **P3-6** | 🤝 | High | **Content moderation** — `reports`, `moderation_actions`, `dmca_notices`, takedowns, `is_flagged`. | Policy decision (you) | A report can be filed + actioned; takedown hides content. |
| **P3-7** | 🤝 | Med | **Audit log** — `audit_log` for admin/security events. | — | Privileged actions write immutable audit rows. |

**Phase 3 exit criteria:** can legally ingest catalog, pay rights-holders, take payments, and moderate.

---

## 6. PHASE 4 — Production Readiness & Quality (mostly 🤖)

> Goal: ops maturity, test coverage, accessibility, polish. Largely agent-automatable.

| ID | Owner | Risk | Item | Done when |
|----|-------|------|------|-----------|
| **P4-1** | 🤖 | Low | **Controller test coverage 6/6** (currently 0/6 dedicated): auth, song, playlist, playback, room, ai. | Each controller has happy + primary error tests; suite > 14 floor. |
| **P4-2** | 🤖 | Low | **Client tests** (RTL + Vitest) for key flows; zero today. | Login, search, player, playlist-detail have tests. |
| **P4-3** | 🤖 | Med | **E2E tests** (Cypress/Playwright) — populate the empty `cypress` scaffolding. | Login → play → create playlist passes in CI. |
| **P4-4** | 🤖 | Med | **Load tests** (k6/Artillery) — populate empty `load-tests` scaffolding. | Stream + room endpoints have a baseline load profile. |
| **P4-5** | 👤→🤝 | Med | **Error tracking / APM** — wire Sentry (DSN from you). | Errors appear in Sentry; releases tagged. |
| **P4-6** | 🤖 | Low | **OpenAPI / Swagger** docs generated from routes. | `/api/docs` serves an accurate spec. |
| **P4-7** | 🤖 | Med | **Accessibility** — skip-nav, ARIA on the custom player, focus management, keyboard shortcuts (space=play, arrows=seek). | axe shows no critical violations on core pages. |
| **P4-8** | 🤖 | Med | **i18n** framework + extract English strings (scope per **Y11**). | Locale switch changes UI strings. |
| **P4-9** | 🤖 | Med | **Responsive / mobile-first** — beyond the single 768px breakpoint. | Player + nav usable at 360px width. |
| **P4-10** | 🤖 | Low | **PWA / offline** — manifest.json, service worker, IndexedDB cache, install prompt; fix the 16-line `index.html` (favicon, OG/Twitter cards, robots.txt, drop unused Font Awesome). | Lighthouse PWA passes; shareable links show OG card. |
| **P4-11** | 🤝 | Med | **Transcoding pipeline** (HLS/DASH, adaptive bitrate, per-tier variants) via job runner. | Uploaded audio produces multiple bitrate variants. |
| **P4-12** | 👤→🤝 | Med | **CDN edge** in front of object storage. | Y2, Y12 → bytes served from edge, not origin. |
| **P4-13** | 🤖 | Low | **Clean the "scaffolding theater"** — either populate or delete empty `packages/{backend,frontend,ops,shared}`, `tools/{codegen,migration-generator,release-automation}`, `environments/{dev,staging,prod}`; fix `pnpm-workspace.yaml`. | Monorepo layout matches reality; no `.gitkeep`-only theater. |
| **P4-14** | 🤖 | Low | **Doc reconciliation** — mark/merge stale docs (`PRODUCTION_READY.md` is stale; `DEEP_DIVE.md` is current). Keep `QUICKSTART.md`/`FEATURES.md`/`DEPLOYMENT.md` truthful per repo rule. | Docs no longer contradict code; contradiction table in audit resolved. |
| **P4-15** | 🤖 | Low | **Storybook** for UI components (empty scaffold today). | Core components render in Storybook. |

---

## 7. Decision Register — open questions only YOU can answer

The agent will pick reasonable defaults if you don't answer, but these are real product forks:

| # | Decision | Default the agent will assume if unanswered |
|---|----------|---------------------------------------------|
| DR-1 | Keep or kill placebo audio features (pitch/stems)? | **Remove UI + fix docs** (honesty over scope) until P2-9 is scheduled. |
| DR-2 | Pricing/tiers — what's in FREE vs HIFI vs STUDIO? | Mirror common defaults (FREE=ads/limited, HIFI=lossless, STUDIO=hi-res+stems); wire after you confirm. |
| DR-3 | Catalog source — original-artist-only platform, or licensed commercial catalog? | **Original-only** (avoids licensing blocker) until Y6 is resolved. |
| DR-4 | Target market — is "East Asia niche MVP" real? | Treat as **English-first, i18n-ready**; defer regional schema to P3-5. |
| DR-5 | Migration tool — `node-pg-migrate` vs Knex? | **node-pg-migrate** (lighter, SQL-first). |
| DR-6 | Audio engine — Howler.js (simple) vs raw Web Audio (full control for EQ/stems)? | **Web Audio graph** (required for real EQ/pitch/stems). |
| DR-7 | Object storage — AWS S3 vs GCS? (deploy is Cloud Run-friendly) | **GCS** to match Cloud Run, unless you prefer S3. |
| DR-8 | Build target — keep CRA or migrate to Vite/TS now? | **Migrate to Vite + TS** (CRA sunset Feb 2025). |

---

## 8. Recommended execution order (dispatch plan for agents)

The agent work can be parallelized across branches. Suggested waves:

1. **Wave A (no prerequisites, ship immediately):** P0-1 … P0-14, P4-14 (doc fixes), P4-13 (scaffolding cleanup).
   → All agent-codeable; CODEOWNERS items need your PR approval.
2. **Wave B (foundation):** P1-1 → P1-2/P1-3/P1-5/P1-10 (migrations first), P1-8, P1-9, P1-7.
   → P1-6 waits on **Y2**; P1-4 waits on **Y8**.
3. **Wave C (heart of app, high ROI first):** P2-1 + P2-4 + P2-5, then P2-2/P2-3/P2-6/P2-8/P2-10, then P2-7/P2-9/P2-11/P2-12/P2-13/P2-14.
4. **Wave D (business/legal):** P3-* — each gated on its 👤 prerequisite (Y3/Y4/Y5/Y6/Y11).
5. **Wave E (hardening):** P4-* — coverage, a11y, i18n, PWA, transcoding, CDN, observability.

> **Your critical path:** Y1 (decision) → unblocks P0-8. Y2 → P1-6 → P4-11/P4-12. Y3+Y5 → P3-1.
> Y6 → P3-2/P3-3/P3-5. Y8 → P1-4 + P2-11. Y9 (approvals) gates *every* foundation item.

---

## 9. What is explicitly OUT of scope (treat as strategy, not backlog)

Per the audit, `BEST_IN_WORLD_FEATURES.md` (NFT, BCI, DAW, MusicLM, virtual concerts, etc.) is a
multi-year **vision document with zero implementation**. Do not schedule it as engineering work.
Podcasts, live concerts, and the social feed are noted as missing but are **post-foundation** and
should not displace the Phase 0–2 daily-driver work.

---

## 10. Traceability — audit ID → plan ID

| Audit IDs | Plan IDs |
|-----------|----------|
| B1 | P0-1 |
| B2, B3 | P0-2 |
| B4 | P0-3 |
| B5 | P0-5 |
| B6 | P0-13 |
| B7 | P0-4 |
| B8 | P0-14 |
| B9 | P0-12 |
| B10 | P0-10 |
| B11, B12 | P0-11 |
| B13 | P1-8 |
| C1 | P0-8 / P2-9 |
| C2 | P0-7 |
| C3 | P0-9 / P2-4 |
| C4 | P0-9 |
| C5, C6, C7 | P0-6 |
| C8 | (out of scope / P4) |
| C10 | P0-7 area (Home genre filter) |
| C11 | P4-10 |
| C12 | P1-9 |
| C13, C14 | P1-9 |
| D1 | P1-1 |
| D2 | P1-3 |
| D3 | P2-9 / P3 stems storage |
| D4 | P1-2 |
| D5, D7, D8, D9, D10, D6 | P1-5 / P1-11 |
| Tier-0 missing | Phase 2 |
| Tier-1 missing | Phase 1 + Phase 3 |
| Tier-2 missing | Phase 1 + Phase 4 |
