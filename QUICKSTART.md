# Quick Setup Guide

This guide will help you get the Hathor Music Platform running on your local machine in minutes.

## TL;DR - See the Dev Environment Fast

```bash
# Install dependencies
npm run install-all

# Configure environment
cp .env.example .env

# Create DB + apply schema (PostgreSQL service running; ensure your user has createdb privileges)
createdb hathor_music
# Replace 'postgres' with your PostgreSQL username if different.
psql -U postgres -d hathor_music -f database/schema.sql

# Start Redis in a separate terminal (blocking process)
redis-server

# Run dev servers
npm run dev
```

Visit http://localhost:3000 after the servers start.

## Prerequisites Check

Before starting, ensure you have:
- ✅ Node.js 18+ installed: `node --version`
- ✅ PostgreSQL 13+ installed: `psql --version`
- ✅ Redis 6+ installed: `redis-cli --version`

## Step-by-Step Setup

### 0. Get the Code Locally (1 minute)

```bash
git clone https://github.com/redinc23/hathor-red.git
cd hathor-red
```

Already cloned? Pull the latest changes:
```bash
git pull
```

### 1. Install Dependencies (2 minutes)

```bash
# Install backend dependencies
npm install

# Install frontend dependencies
cd client
npm install
cd ..
```

### 2. Setup PostgreSQL (3 minutes)

```bash
# Create database
createdb hathor_music

# Or using psql:
psql -U postgres
CREATE DATABASE hathor_music;
\q

# Apply schema
psql -U postgres -d hathor_music -f database/schema.sql

# (Optional) Load sample data
psql -U postgres -d hathor_music -f database/seed.sql
```

### 3. Start Redis (1 minute)

```bash
# Start Redis server
redis-server

# Or on macOS with Homebrew:
brew services start redis

# Or on Ubuntu/Debian:
sudo systemctl start redis
```

### 4. Configure Environment (2 minutes)

```bash
# Copy example environment file
cp .env.example .env

# Edit .env file with your settings
# Minimum required changes:
# - DB_PASSWORD (your PostgreSQL password)
# - JWT_SECRET (generate with: openssl rand -base64 32)
```

### 5. Start the Application (1 minute)

```bash
# Start both frontend and backend
npm run dev

# The application will be available at:
# Frontend: http://localhost:3000
# Backend: http://localhost:5000
```

## First Time Usage

### Create an Account

1. Open http://localhost:3000
2. Click "Sign up"
3. Fill in your details
4. Login with your credentials

### Try These Features

1. **Browse Music** - View the music library on the home page
2. **Play a Song** - Click any song to start playback
3. **AI Playlist** - Use the AI playlist generator on the right sidebar
   - Try: "Upbeat workout songs" or "Relaxing study music"
4. **Vibe Controls** - Adjust speed and pitch sliders in the player
5. **Stem Separation** - Toggle vocals, drums, bass, and other stems
6. **Listening Rooms** - Navigate to "Listening Rooms" to create/join rooms

## Common Issues & Solutions

### "Cannot connect to database"
- Ensure PostgreSQL is running: `pg_isready`
- Check database exists: `psql -l | grep hathor_music`
- Verify credentials in `.env` file

### "Redis connection failed"
- Start Redis: `redis-server`
- Test connection: `redis-cli ping` (should return "PONG")

### "Port 5000 already in use"
- Change PORT in `.env` file
- Or stop the process using port 5000: `lsof -ti:5000 | xargs kill -9`

### "Cannot find module"
- Re-run: `npm install && cd client && npm install`

## Development Tips

### Hot Reload
Both frontend and backend have hot reload enabled:
- Frontend: React Fast Refresh
- Backend: Nodemon

### Database Changes
After modifying `database/schema.sql`:
```bash
psql -U postgres -d hathor_music -f database/schema.sql
```

### View Logs
```bash
# Backend logs are in the terminal running `npm run dev`
# Frontend logs are in browser console (F12)
```

### Stop the Application
Press `Ctrl+C` in the terminal running `npm run dev`

## Next Steps

1. **Read the full documentation:**
   - [README.md](README.md) - Project overview
   - [API.md](API.md) - API reference
   - [DEPLOYMENT.md](DEPLOYMENT.md) - Production deployment

2. **Customize the platform:**
   - Add your own music files to `/uploads`
   - Modify UI components in `/client/src/components`
   - Add new API endpoints in `/server/routes`

3. **Deploy to production:**
   - Follow [DEPLOYMENT.md](DEPLOYMENT.md) for production setup
   - Configure SSL/HTTPS
   - Set up monitoring and backups

## Getting Help

- Check the [API Documentation](API.md) for endpoint details
- Review error logs in the terminal
- Ensure all services (PostgreSQL, Redis) are running
- Verify environment variables are correctly set

## Quick Commands Reference

```bash
# Install all dependencies
npm run install-all

# Start development servers
npm run dev

# Start backend only
npm run server

# Start frontend only
npm run client

# Build for production
npm run build

# Reset database
psql -U postgres -d hathor_music -f database/schema.sql
```

---

**Ready to start!** Run `npm run dev` and visit http://localhost:3000

## Environment Setup

Copy `.env.example` to `.env` and fill in required values:

```bash
cp .env.example .env
```

**Required:** Generate a secure JWT secret before starting the server:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

Paste the output into `JWT_SECRET` in your `.env` file. The server will refuse to issue tokens without it.

Optional stream token TTL can be configured with `STREAM_TOKEN_EXPIRE` (default: `60s`).
