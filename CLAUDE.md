# CLAUDE.md — Agent Instructions for hathor-red

This file is read automatically by Claude Code at session start.
It is the authoritative instruction set for all AI agents working in this repo.
Do not delete or summarise it. Append; do not overwrite.

---

## Project identity

**hathor-red** is an AI-powered music streaming platform.
Stack: Node.js 18 + Express, React 18, PostgreSQL, Redis, Socket.io, Docker.
Package manager: pnpm 8. Monorepo orchestration: Turbo.
Primary repo owner and required human reviewer: **@redinc23**.

---

## Non-negotiable rules for every agent session

1. **Never push to `main` directly.** Always work on a `claude/<task-slug>` branch.
2. **Run `./node_modules/.bin/jest` before committing** — 14 tests must pass.
3. **Run `./node_modules/.bin/eslint . --max-warnings=0` before committing** — zero warnings.
   Use the binary directly; `npm run lint` may resolve to ESLint v10 which rejects the `.eslintrc.cjs` format.
4. **CODEOWNERS is enforced.** Paths listed in `.github/CODEOWNERS` require @redinc23 approval.
   Do not attempt to self-merge PRs that touch those paths.
5. **Never commit `.env` files.** Secrets belong in the deployment platform's environment config.

---

## Architecture rules — violations have caused bugs before

### Database
- All queries use parameterized statements (`$1, $2, ...`). Never interpolate user input into SQL strings.
- The `pg` driver returns PostgreSQL `bigint` columns (including `COUNT(*)`) as **JavaScript strings**.
  Always `parseInt(value, 10)` before arithmetic or numeric comparison.
- Schema lives in `database/schema.sql`. Any new table or column change must be reflected there.

### Redis
- Redis is a **cache layer only**. Every Redis read or write must be wrapped in its own `try/catch`
  so that a Redis failure falls back to the database rather than returning HTTP 500.
  See `server/controllers/playbackController.js` for the correct pattern.

### Socket.io
- Cross-device sync events must target `socket.to(`user-${socket.userId}`)` — the user-specific
  room each socket joins on connection. **Never use `socket.broadcast.emit`** for user-specific
  state; it sends to every connected client.
- Only the room host may emit `room-control` events. The handler enforces this via a DB check;
  do not remove it.

### Validation
- Every `POST` and `PUT` route must include a validation middleware array from
  `server/middleware/validation.js` before the controller function.
  Pattern: `router.post('/path', authMiddleware, xyzValidation, validate, controller.method)`.
- Do not add routes without validation. The missing-validation bug has been fixed for
  `/playlists/add-song` and `/songs/record-listening`; don't regress it.

---

## Bugs fixed — do not re-introduce

| Fixed in | File | What was wrong |
|----------|------|----------------|
| `ca71b78` | `database/schema.sql` | `listening_rooms` was missing `updated_at`; all room-control SQL updates require it |
| `ca71b78` | `server/socket/handlers.js` | `socket.broadcast.emit` was used for user sync, leaking state to all clients |
| `ca71b78` | `server/controllers/playbackController.js` | Redis failure crashed the endpoint instead of falling back to DB |
| `ca71b78` | `server/controllers/roomController.js` | `COUNT(*)` returned as string compared to integer without `parseInt` |
| `ca71b78` | `server/controllers/playlistController.js` | Inner `paramIndex` shadowed outer `paramIndex` |
| `ca71b78` | `server/middleware/validation.js` | No validation on `/playlists/add-song` or `/songs/record-listening` |

---

## Workflow for implementing any change

```
1. git checkout -b claude/<task-slug>
2. Make changes
3. ./node_modules/.bin/jest                          # must be green
4. ./node_modules/.bin/eslint . --max-warnings=0     # must be clean
5. git add <specific files>  # never git add -A
6. git commit -m "<type>: <description>"
7. git push -u origin claude/<task-slug>
```

Commit message types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`.

---

## Code ownership map

Defined in `.github/CODEOWNERS`. Summary:

| Path | Owner | Why |
|------|-------|-----|
| `*` (default) | @redinc23 | Catch-all |
| `database/` | @redinc23 | Schema changes affect all services |
| `server/index.js` | @redinc23 | Core server bootstrap |
| `server/config/` | @redinc23 | DB, Redis, AI config |
| `server/middleware/auth.js` | @redinc23 | Auth security boundary |
| `server/middleware/validation.js` | @redinc23 | All input validation rules |
| `server/utils/auth.js` | @redinc23 | JWT + bcrypt utilities |
| `server/socket/` | @redinc23 | Real-time security-sensitive code |
| `server/routes/` | @redinc23 | API contract definitions |
| `.github/` | @redinc23 | CI/CD and agent config |
| `Dockerfile`, `docker-compose.yml` | @redinc23 | Deployment config |

Agents may freely modify controllers, services, client code, tests, and documentation
**without** a blocking human review, as long as tests and lint pass.

---

## Testing

- **Framework:** Jest 29
- **Test files:** `server/tests/*.test.js`
- **Run:** `./node_modules/.bin/jest`
- **Current suite:** auth utils, AI service (mocked), AI service cache
- When adding a controller, add at minimum a test for the happy path and the primary error case.

---

## Environment variables

Template: `.env.example`. Never commit actual values.
The `.env` file in this repo contains development defaults only and is excluded from git via `.gitignore`.
Production secrets are injected by the deployment platform (Railway / Render / Cloud Run).

---

## AI service

`server/services/colabAIService.js` wraps Google Colab Enterprise.
It runs in **fallback mode** when `COLAB_API_KEY` and `COLAB_PROJECT_ID` are not set.
Fallback mode returns structured mock responses; it does not throw.
Never remove the fallback — the platform must work without a live AI backend.

---

## Project Olympus (appended 2026-08-25)

The Olympus build (branch `claude/project-olympus-mangu-lt4ejb`) grows this repo into
the Mangu Music Ecosystem: five pillars (audio engine, discovery, commerce, social,
artist intelligence) implemented as a **modular monolith with extraction seams** —
domain modules under `server/services/<domain>/`, a Postgres-backed job queue with
optional Redis wake channel, and provider abstractions (payments, embeddings,
transcode) that run in deterministic fallback mode without external credentials,
following the `colabAIService` pattern.

Charter and state for agents:

- Program plan / requirements / traceability: `docs/olympus/program-plan.md`
- Execution state (resume here mid-build): `.plan/execution-state.md`
- Evidence & decisions ledger: `.plan/research-ledger.md`

Olympus-specific rules (in addition to everything above):

1. New server code is CommonJS `.js` wired into `server/index.js`. The pre-existing
   `.ts` files under `server/` are unwired reference material — do not import them.
2. Money is integer cents everywhere. Revenue split: artist 80 / platform 20,
   remainder cent goes to the platform.
3. New tables: append to `database/schema.sql` AND add a numbered migration
   (`database/migrations/004+`). Additive DDL only.
4. Every external integration needs a fallback mode and hermetic tests
   (mock `../config/database` and `../config/redis`; never require live services).
5. Pillar routes are gated by `FEATURE_*` env flags (see `server/config/features.js`).
