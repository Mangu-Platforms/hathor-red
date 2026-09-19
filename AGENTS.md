# AGENTS.md — Hathor-Red Agent Doctrine

This repository uses Cursor rules to enforce disciplined, predictable changes.

## Core principle: handle all requested tasks in scope
If a request contains more than one task, the agent should complete all requested tasks in a single scoped plan unless the user asks to defer or split them.

## Workflow (always)
1. Plan
   - Task (1 sentence)
   - Files to be modified (exact paths)
   - Success criteria
   - Verification steps
2. Implement (scoped)
   - Only touch files declared in the plan
   - No "while I'm here" additions
   - No dependency changes unless explicitly requested
3. Verify
   - Run relevant tests/lint/build when available
   - If no tooling exists, explain what verification would be used
4. Stop
   - Summarize changes, verification, and confidence
   - Confirm all requested tasks are completed or clearly list what remains

## Documentation is code
If changes affect behavior, setup, features, or deployment:
- QUICKSTART.md
- FEATURES.md
- DEPLOYMENT.md
must be updated in the same change.

## Architecture rules
- Respect existing modular boundaries
- Avoid cross-layer coupling
- Prefer extension over modification

## Expected agent output (in hathor-red)
Before the required footer, the agent must include:
- What changed
- Verification performed
- Confidence rating (High/Medium/Low)

The final response must end with the required "🎯 Next Steps for Users" footer.

## Cursor Cloud specific instructions

This section is for future cloud agents. The dependency-refresh update script (`pnpm install`) runs automatically on startup; the notes below cover non-obvious startup/run caveats that the update script intentionally does not handle.

### Services (all needed for end-to-end use)
- Backend: Express + Socket.io API, port `5000`. Dev run: `npm run server` (nodemon). Serves `/api/*`, `/socket.io`, and (in prod) the built client.
- Frontend: Create React App SPA, dev server port `3000`, proxies API/socket to `:5000` (`client/package.json` `"proxy"`). Dev run: `cd client && npm start` (use `BROWSER=none` in headless VMs). Both dev servers together: `npm run dev`.
- PostgreSQL (`hathor_music` db) and Redis are required datastores. They are installed in the VM but are NOT auto-started by the update script.

### Starting datastores (systemd is unavailable in this container — start manually)
- Postgres: `sudo pg_ctlcluster 16 main start`
- Redis: `sudo redis-server /etc/redis/redis.conf --daemonize yes`
- Verify: `pg_isready` and `redis-cli ping` (expect `PONG`).

### `.env` caveat (important)
- The committed `.env` uses Docker-network hostnames (`DB_HOST=postgres`, `REDIS_HOST=redis`) and `NODE_ENV=production`, which do NOT work for local (non-Docker) dev in the VM.
- Local dev uses an uncommitted `.env` derived from `.env.example` (localhost hosts) plus two required additions. This working `.env` is kept in the VM (not committed, per repo policy) and is preserved by the VM snapshot. If it is ever missing, recreate it:
  ```
  cp .env.example .env
  printf '\nDATABASE_SSL=false\nCLIENT_URL=http://localhost:3000,http://localhost:5000\nUPLOAD_DIR=/workspace/uploads\n' >> .env
  ```
- `DATABASE_SSL=false` is required because `config/database.js` enables SSL whenever `DATABASE_URL` is set (local Postgres has no SSL).
- `CLIENT_URL` must include `http://localhost:5000` (in addition to `:3000`). The CRA dev proxy forwards API calls to the backend with `Origin: http://localhost:5000`, and `config/cors.js` rejects any origin not in `CLIENT_URL`; without it, browser login/register fails with a CORS error even though the API works via curl.
- `UPLOAD_DIR` must be an ABSOLUTE path (e.g. `/workspace/uploads`). `songController.resolveUploadPath` validates streamed files with `resolved.startsWith(UPLOAD_DIR)`, so a relative `./uploads` makes every audio stream fail with HTTP 500 ("Invalid file path: outside upload directory") even though song listing works. With an absolute path, `GET /api/songs/:id/stream` serves audio correctly.
- After editing `.env`, restart the backend (nodemon watches `.js`/`.json`, not `.env`): send `rs` to the nodemon process or restart `npm run server`.

### First-time DB data (only if the DB is empty/reset)
- Apply schema: `PGPASSWORD=password psql -h localhost -U postgres -d hathor_music -f database/schema.sql`
- Seed sample data + audio: `npm run db:setup` (creates 3 users incl. `demo_user`/`password123`, 5 songs, 3 playlists, and placeholder MP3s in `uploads/`). The DB and its data persist in the VM snapshot, so this is not needed every run.

### Known pre-existing bug (do not be misled)
- `GET /api/health` reports `database: unhealthy` with `getPoolStatus is not a function`. This is a code bug (`getPoolStatus` is not exported from `server/config/database.js`), NOT an environment problem — the DB is actually connected. Verify real DB connectivity via `/api/auth/register`, `/api/auth/login`, or `GET /api/songs` (with a Bearer token) instead.
- Note: `/api/auth/login` expects `username` (not email).

### Lint / test / build (standard commands; see `package.json`)
- Lint: `./node_modules/.bin/eslint . --max-warnings=0` (root eslint 8). Avoid `npm run lint` if a newer global eslint is present, per CLAUDE.md.
- Backend tests: `./node_modules/.bin/jest`
- Prod build (client): `npm run build`
- The Husky `pre-commit` hook runs eslint + jest.
