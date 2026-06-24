# Hathor Red Music Platform v2.0

## Next-Generation Music Streaming with AI, Social Rooms & Professional Audio Tools

[![CI](https://github.com/redinc23/hathor-red/actions/workflows/ci-v2.yml/badge.svg)](https://github.com/redinc23/hathor-red/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-red.svg)](https://opensource.org/licenses/MIT)
[![Tests](https://img.shields.io/badge/tests-200%2B-brightgreen.svg)](https://github.com/redinc23/hathor-red/tree/main/server/tests)

### What's New in v2.0

Hathor Red has been transformed from a functional prototype into a **production-grade music streaming platform**:

- 🤖 **AI-Powered** — OpenAI GPT-4o for natural language playlists, semantic search with pgvector embeddings
- 🎵 **HLS Streaming** — Adaptive bitrate from 64k to lossless with FFmpeg transcoding
- 🔐 **OAuth2** — Google & Spotify login with JWT refresh token rotation
- 📹 **Video Chat** — WebRTC video calls inside listening rooms
- 📈 **Observability** — OpenTelemetry, Prometheus metrics, Grafana dashboards
- ☸️ **Kubernetes** — Helm chart with HPA, PDB, NetworkPolicy
- 🧪 **200+ Tests** — Comprehensive test suite with 80% coverage

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                  Hathor Red v2.0                     │
├──────────┬──────────┬──────────┬─────────────────────┤
│  Auth    │  Songs   │  Rooms   │  AI Services        │
│  JWT+OA  │  HLS+St  │  Video   │  GPT-4o+Vecto       │
├──────────┴──────────┴──────────┴─────────────────────┤
│              API Layer (/api/v1/)                     │
├──────────────────────────────────────────────────────┤
│  OpenTelemetry  │  Feature Flags  │  Error Handler    │
├──────────────────────────────────────────────────────┤
│  PostgreSQL 15  │  pgvector  │  Redis 7  │  Socket.io │
└──────────────────────────────────────────────────────┘
```

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 15+ with pgvector extension
- Redis 7+
- FFmpeg (optional, for HLS streaming)
- Demucs (optional, for stem separation)

### Installation

```bash
# Clone
git clone https://github.com/redinc23/hathor-red.git
cd hathor-red

# Install dependencies
pnpm install

# Set up environment
cp .env.example .env
# Edit .env with your credentials

# Run migrations
npm run db:migrate

# Seed the database
npm run db:setup

# Start development
npm run dev
```

### Run Tests

```bash
# Run all tests
npm test

# With coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

## API Documentation

- **Swagger UI**: http://localhost:5000/api/docs
- **ReDoc**: http://localhost:5000/api/docs/redoc
- **OpenAPI Spec**: http://localhost:5000/api/docs/openapi.yaml

## Deployment

### Docker
```bash
docker build -f Dockerfile.v2 -t hathor-music .
docker-compose -f docker-compose.prod.yml up -d
```

### Kubernetes
```bash
helm install hathor ./k8s/hathor-chart -f k8s/hathor-chart/values-prod.yaml
```

### Railway/Render
See `DEPLOY.md` for platform-specific instructions.

## Environment Variables

Key variables (see `.env.example` for full list):

| Variable | Description | Required |
|----------|-------------|----------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `REDIS_URL` | Redis connection string | Yes |
| `JWT_SECRET` | JWT signing secret | Yes |
| `OPENAI_API_KEY` | OpenAI API key | For AI features |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | For OAuth |
| `FFMPEG_PATH` | FFmpeg binary path | For HLS |

## Feature Flags

| Flag | Description | Default |
|------|-------------|---------|
| `FEATURE_HLS_STREAMING` | HLS adaptive streaming | `true` |
| `FEATURE_LLM_PLAYLIST` | AI playlist generation | `true` |
| `FEATURE_VECTOR_SEARCH` | Semantic search | `true` |
| `FEATURE_WEBRTC_VIDEO` | Video chat in rooms | `true` |
| `FEATURE_OAUTH` | Social login | `true` |
| `FEATURE_ANALYTICS` | Event tracking | `true` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file.

---

Built with passion for the future of music. 🎵