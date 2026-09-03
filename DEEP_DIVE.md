# 🔍 Hathor Music Platform - Deep Dive & Launch Guide

Welcome to the Hathor Music Platform! This document provides a comprehensive overview of the system architecture, the production-ready improvements implemented, and the final steps to launch the application.

---

## 🏗️ System Architecture

The Hathor Music Platform is a modern, full-stack application built with scalability and real-time interaction in mind.

### 1. Frontend (React 18)
- **State Management**: Uses React Context (`AuthContext`, `PlayerContext`) for global state.
- **Real-time**: Leverages `socket.io-client` for synchronized playback in listening rooms.
- **Audio**: Progressive HTML5 `<audio>` with signed stream URLs, queue, Fisher-Yates shuffle, repeat modes, volume, and playback-rate (0.5x–2x). **Stem separation and independent pitch shift do not ship** — UI controls were removed; no Web Audio graph for those features is mounted in `PlayerContext`.

### 2. Backend (Node.js & Express)
- **API**: RESTful endpoints for user management, music library, playlists, and listening rooms.
- **Authentication**: Secure JWT-based auth with password hashing via `bcryptjs`. Signed query tokens (`streamAuth` + `streamToken`) for `<audio src>` without Authorization headers.
- **Real-time**: `socket.io` server handles multi-user room sync and chat.
- **File Handling**: `multer` manages audio uploads; files are **not** served via public static `/uploads` — only the authenticated/signed stream route.

### 3. Data Layer
- **PostgreSQL**: Primary relational database for user data, song metadata, and relationships.
- **Redis**: Caching for song lists and playback hydrate/persist (`playback:{userId}`).

---

## 🚀 Production-Ready Improvements

We have implemented several critical enhancements to move the project from MVP toward production readiness:

### 🛡️ Security Hardening
- **Helmet.js**: Configured secure HTTP headers to protect against XSS, clickjacking, and other web vulnerabilities.
- **Rate Limiting**: Implemented `express-rate-limit` on API endpoints, with stricter limits on auth routes.
- **Input Validation**: `express-validator` on user inputs.
- **Media**: Path-safe upload resolution; stream only via signed token or Bearer JWT.

### 📈 Observability & Reliability
- **Structured Logging**: Winston with leveled logging.
- **Health Checks**: `/api/health` monitors PostgreSQL and Redis (and worker when enabled).
- **Response Compression**: `compression` middleware.

### 📦 Infrastructure
- **pnpm**: Package manager for the monorepo-style client/server layout.
- **Docker**: `Dockerfile` and compose for App, PostgreSQL, Redis (see repo root).
- **CI**: GitHub Actions workflows for quality and deploy paths.

---

## 🏁 Final Launch Steps

### 1. Environment Configuration
Create a `.env` file based on `.env.example`. For production, generate strong secrets:
```bash
openssl rand -base64 32
```

### 2. Deployment via Docker
```bash
docker-compose up -d
```

### 3. Verification
```bash
curl http://localhost/api/health
```

### 4. Honest non-goals (see WHAT_SHIPS.md)
- No HLS in the React player UI (progressive stream only)
- No OAuth until password path stays solid
- No WebRTC video product surface; RTC signaling exists for experimental room voice only
- No Demucs/stems or pitch DSP in the live player

---

**Align product claims with WHAT_SHIPS.md and README.md.**
