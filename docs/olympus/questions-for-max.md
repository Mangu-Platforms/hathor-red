# Project Olympus — Questions & Decisions for Max (@redinc23)

Compiled during the autonomous build session (2026-08-25/26). Everything below
either needs your action or your sign-off. Nothing here blocks the PR from
being reviewed.

## 🔴 Needs your action (security)

1. **Rotate `JWT_SECRET` and purge `.env` from git history.**
   `.env` was committed to the repo (CLAUDE.md claimed it was gitignored — it
   wasn't) with `JWT_SECRET=launch_day_secret_key_999` and
   `NODE_ENV=production`. This PR untracks it and gitignores it going forward,
   but the value lives in git history on `main`, which only you can rewrite
   (`git filter-repo` + force-push) — and rotation matters more than the purge:
   anyone with repo access can mint valid JWTs (including stream tokens) until
   the secret changes in every deployment.
2. **Set real secrets in the deployment platform only**: `JWT_SECRET`,
   `DATABASE_URL`, `REDIS_URL`, and later `STRIPE_SECRET_KEY`. The manifesto's
   Vault/rotation story is a good target; platform env config is the honest
   first step.

## 🟡 Decisions I made that you should ratify (or reverse)

3. **Modular monolith with extraction seams, not microservices** (DEC-001).
   The manifesto's Kafka/ClickHouse/Istio/GraphQL-federation topology can't be
   stood up from this environment, and the repo's own CLAUDE.md defines a
   monolith. I built domain modules (`server/services/<domain>/`), a durable
   Postgres job queue (BullMQ-compatible contract), and provider abstractions
   (payments, embeddings, transcode) so each pillar can be extracted later
   without rewrites. Ratify or tell me the first service to split out.
4. **Who may sell:** any user can sell a song **they uploaded** (plus admin).
   The manifesto says "Label Approved only for Enterprise Beta" — if you want
   that, the gate is one check in `commerceController.createProduct` (e.g.
   `users.role IN ('artist','label')` + an approval flow). Say the word.
5. **Revenue split rounding:** artist gets `floor(80%)`, remainder cent to the
   platform, all integer cents. Confirm this matches the artist agreements.
6. **Account deletion purge is not automated.** Requests are recorded,
   audited, cancelable — but actual purging needs your retention policy
   (financial records must survive; what about uploads other users bought?).
   Tell me the policy and I'll build the purge worker.
7. **Download tokens:** single-use, 7-day expiry, minted freely by owners from
   the Library. GDPR export links: multi-use within 72h. Confirm both.
8. **Mock payment provider is the default** — every purchase works end-to-end
   but no money moves until `STRIPE_SECRET_KEY` is set (provider refs are
   prefixed `mock_` so simulated revenue is excludable). Stripe Connect
   payouts (real artist bank transfers) are the next commerce milestone.

## 🟢 Informational

9. **The "35 existing issues" from the manifesto don't exist** — the repo has
   zero open issues as of this session. Nothing to triage or close.
10. **Spotify OAuth** (social login / taste import): not built — needs app
    credentials and your data-rights call. The discovery layer works without
    it; co-listening CF + local embeddings replace the cold-start import.
11. **The unwired TypeScript files** under `server/` (routes/*.ts,
    hlsService.ts, llmService.ts, vectorSearchService.ts) remain untouched and
    unwired; the live runtime is the CommonJS monolith. Recommend deleting or
    migrating them deliberately in a follow-up to avoid confusing agents.
12. **Test coverage gate:** the manifesto demands 80% coverage. This PR takes
    the suite from 22 to 153 hermetic tests covering every new service's core
    logic. A coverage *ratchet* in CI (fail if coverage drops) would be the
    next honest step; a flat 80% bar on the legacy code would fail today.
13. **WebRTC voice** ships as signaling relay (offer/answer/ICE through the
    server, presence-authorized). Peer-to-peer audio works for small rooms;
    an SFU (LiveKit/mediasoup) is the >6-participant upgrade.
14. **Loudness normalization** applies measured LUFS when ffmpeg has analyzed
    a track; until then unity gain. Waveforms without ffmpeg are labeled
    `approximation` and styled accordingly.

## Suggested next milestones (in value order)

1. Stripe Connect onboarding + payouts (turns the ledger into money).
2. Deploy a worker dyno with ffmpeg (activates real HLS/loudness/waveforms).
3. Account-purge worker once you set retention policy (#6).
4. Coverage ratchet + supertest integration suite against a CI Postgres.
5. Extract the transcode worker as the first standalone service (DEC-001 seam).
