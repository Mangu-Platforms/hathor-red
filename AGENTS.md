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

The startup update script runs `pnpm install` only. System services (PostgreSQL 16, Redis 7) are pre-installed in the VM snapshot but are NOT auto-started (no systemd). Start them before running the app:

```
sudo pg_ctlcluster 16 main start
sudo redis-server --daemonize yes
redis-cli ping   # expect PONG
```

Services / how to run (see `QUICKSTART.md` and root `package.json` scripts for the canonical commands):
- Backend API (Express + Socket.io) on port 5000. Run dev with `npm run server` (nodemon).
- Frontend (React/CRA) on port 3000, proxies `/api` to 5000. Run dev with `npm run client` (use `BROWSER=none` to avoid launching a browser).
- Prefer running `npm run server` and `npm run client` separately. `npm run dev` (turbo) can recurse into itself; `npm run dev:legacy` (concurrently) is the working combined alternative.

Non-obvious gotchas (these were discovered during setup and are easy to miss):
- The committed `.env` targets Docker (`DB_HOST=postgres`, `REDIS_HOST=redis`, `NODE_ENV=production`). `/etc/hosts` maps `postgres` and `redis` to `127.0.0.1` (persisted in the snapshot) so the committed `.env` works against local services. Local Postgres uses user `postgres` / password `password`, database `hathor_music`.
- Run the backend with `NODE_ENV=development` to get dev CORS (auto-allows `http://localhost:3000`) and real error messages. `dotenv` does not override pre-set env vars, so prefix the command: `NODE_ENV=development npm run server`.
- `UPLOAD_DIR` MUST be an absolute path or audio streaming returns HTTP 500 ("Invalid file path: outside upload directory"). `resolveUploadPath` in `server/controllers/songController.js` compares an absolute resolved path against `UPLOAD_DIR` with `startsWith`, so the committed relative value `./uploads` breaks `/api/songs/:id/stream`. Start the backend with `UPLOAD_DIR=/workspace/uploads` set (e.g. `NODE_ENV=development UPLOAD_DIR=/workspace/uploads npm run server`).
- `GET /api/health` falsely reports the database as `unhealthy` ("getPoolStatus is not a function") because `server/index.js` imports `getPoolStatus`, which `server/config/database.js` does not export. The database is actually fine — verify with an authenticated request or a direct query instead of trusting the health endpoint.
- Sample audio + data: `pnpm run db:setup` generates 5 sample MP3s into `uploads/` (via ffmpeg) and seeds demo users (`demo_user`/`john_doe`/`jane_smith`, password `password123`) plus 5 songs. The generated MP3s are short (~5s) clips and are gitignored, so they persist in the snapshot. Re-run `pnpm run db:setup` to reseed.
