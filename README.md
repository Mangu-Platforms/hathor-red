# Hathor Red

Music streaming SPA with listening rooms, AI helpers, and Project Olympus pillars.

[![CI](https://github.com/Mangu-Platforms/hathor-red/actions/workflows/main.yml/badge.svg)](https://github.com/Mangu-Platforms/hathor-red/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](https://opensource.org/licenses/MIT)

**Repo:** [Mangu-Platforms/hathor-red](https://github.com/Mangu-Platforms/hathor-red)

## What ships today

- React 18 SPA (`client/`) + Node 20 Express (`server/`)
- PostgreSQL + Redis + Socket.io
- Email/password auth (JWT). **No OAuth in the live routes.**
- Signed stream URLs (`/api/songs/:id/stream-url` → `/stream?t=…`) for HTML5 `<audio>`
- Playlists, rooms (basic), AI chat/recommendations when OpenAI is configured (fallback otherwise)
- Project Olympus route modules behind env flags (media, commerce, discovery, social, intel, privacy, worker)

## What does **not** ship yet (do not expect in UI)

- HLS adaptive playback in the player (transcode/HLS code exists; player uses progressive stream)
- OAuth (Google/Spotify) — only password auth is mounted
- WebRTC video in rooms
- Stem separation / pitch shift (UI controls removed until implemented)
- Podcast product (nav page is an honest coming-soon shell)

## Stack

| Layer | Choice |
|-------|--------|
| Client | React 18 SPA |
| Server | Express on Node 20 |
| DB | PostgreSQL (+ pgvector when discovery is on) |
| Cache | Redis |
| Realtime | Socket.io |
| Package manager | pnpm |

No Next.js. No Python app as the product backend. `server/_reference` is reference-only.

## Quick start

```bash
git clone https://github.com/Mangu-Platforms/hathor-red.git
cd hathor-red
pnpm install
cp .env.example .env
# set DATABASE_URL, REDIS_URL, JWT_SECRET

# schema + seed (see database/)
psql "$DATABASE_URL" -f database/schema.sql
node database/seed.js

pnpm dev   # or npm run dev if scripts use npm
```

Client talks to the API; stream playback uses short-lived signed query tokens so `<audio src>` works without Authorization headers.

## Feature flags (server)

Olympus pillars (default ON; set `false` to disable mounting):

| Flag | Gates |
|------|--------|
| `FEATURE_MEDIA_PIPELINE` | `/api/media` |
| `FEATURE_COMMERCE` | `/api/commerce` |
| `FEATURE_DISCOVERY` | `/api/discovery` |
| `FEATURE_SOCIAL` | `/api/social` |
| `FEATURE_INTEL` | `/api/intel` |
| `FEATURE_PRIVACY` | `/api/privacy` |
| `FEATURE_WORKER` | in-process job worker |

Legacy names in `.env.example` (`FEATURE_OAUTH`, `FEATURE_HLS_STREAMING`, etc.) are **not** wired to route mounting in `server/index.js`.

## Docs

- [API.md](API.md)
- [WHAT_SHIPS.md](WHAT_SHIPS.md) — live capability snapshot
- [BUGS.md](BUGS.md) — known issues (may lag code)
- Olympus: [docs/olympus/program-plan.md](docs/olympus/program-plan.md)

## License

MIT
