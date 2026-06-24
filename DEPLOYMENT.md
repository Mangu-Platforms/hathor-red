# Hathor Music Platform - Deployment Guide

## Prerequisites

- **Node.js** 18.x or higher
- **PostgreSQL** 13.x or higher
- **Redis** 6.x or higher
- **npm** or **yarn**

---

## Local Development Setup

### 1. Clone the Repository

```bash
git clone https://github.com/redinc23/hathor-red.git
cd hathor-red
```

Already cloned? Pull the latest changes:
```bash
git pull
```

### 2. Install Dependencies

```bash
# Install root dependencies
npm install

# Install client dependencies
cd client
npm install
cd ..
```

### 3. Database Setup

#### Create PostgreSQL Database

```bash
# Access PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE hathor_music;

# Exit PostgreSQL
\q
```

#### Run Database Schema

```bash
psql -U postgres -d hathor_music -f database/schema.sql
```

#### (Optional) Seed Database with Sample Data

```bash
psql -U postgres -d hathor_music -f database/seed.sql
```

### 4. Redis Setup

#### Install Redis (if not already installed)

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install redis-server
sudo systemctl start redis
```

**macOS:**
```bash
brew install redis
brew services start redis
```

**Windows:**
Download and install from https://redis.io/download

### 5. Environment Configuration

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=hathor_music
DB_USER=postgres
DB_PASSWORD=your_password_here

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# JWT Configuration — generate a secure secret before deploying:
# node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=
JWT_EXPIRE=7d
STREAM_TOKEN_EXPIRE=60s

# CORS
CLIENT_URL=http://localhost:3000

# File Upload
UPLOAD_DIR=./uploads
MAX_FILE_SIZE=52428800
```

### 6. Create Upload Directory

```bash
mkdir -p uploads
```

### 7. Start Development Servers

**Option 1: Start both servers concurrently**
```bash
npm run dev
```

**Option 2: Start servers separately**

Terminal 1 (Backend):
```bash
npm run server
```

Terminal 2 (Frontend):
```bash
npm run client
```

### 8. Access the Application

- Frontend: http://localhost:3000
- Backend API: http://localhost:5000/api
- Health Check: http://localhost:5000/api/health

---

## Production Deployment

### Option 1: Traditional Server Deployment

#### 1. Prepare the Server

Install prerequisites:
```bash
# Update system
sudo apt-get update
sudo apt-get upgrade

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
sudo apt-get install postgresql postgresql-contrib

# Install Redis
sudo apt-get install redis-server

# Install Nginx (for reverse proxy)
sudo apt-get install nginx
```

#### 2. Clone and Setup Application

```bash
cd /var/www
sudo git clone <repository-url> hathor-music
cd hathor-music

# Install dependencies
npm install
cd client && npm install && cd ..

# Build client
cd client && npm run build && cd ..
```

#### 3. Configure Environment

```bash
sudo nano .env
```

Set production values:
```env
NODE_ENV=production
PORT=5000
DB_HOST=localhost
DB_PORT=5432
DB_NAME=hathor_music
DB_USER=hathor_user
DB_PASSWORD=strong_password_here
REDIS_HOST=localhost
REDIS_PORT=6379
JWT_SECRET=very_strong_random_secret_for_production
JWT_EXPIRE=7d
CLIENT_URL=https://yourdomain.com
UPLOAD_DIR=/var/www/hathor-music/uploads
MAX_FILE_SIZE=52428800
```

#### 4. Setup PostgreSQL

```bash
sudo -u postgres psql

CREATE USER hathor_user WITH PASSWORD 'strong_password_here';
CREATE DATABASE hathor_music OWNER hathor_user;
GRANT ALL PRIVILEGES ON DATABASE hathor_music TO hathor_user;
\q

# Run schema
sudo -u postgres psql -d hathor_music -f /var/www/hathor-music/database/schema.sql
```

#### 5. Configure Nginx

```bash
sudo nano /etc/nginx/sites-available/hathor-music
```

Add configuration:
```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;

    # Frontend
    location / {
        root /var/www/hathor-music/client/build;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # WebSocket support
    location /socket.io {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Uploaded files
    location /uploads {
        alias /var/www/hathor-music/uploads;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable site:
```bash
sudo ln -s /etc/nginx/sites-available/hathor-music /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 6. Setup SSL with Let's Encrypt

```bash
sudo apt-get install certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

#### 7. Setup PM2 for Process Management

```bash
sudo npm install -g pm2

# Start application
cd /var/www/hathor-music
pm2 start server/index.js --name hathor-music

# Setup PM2 to start on boot
pm2 startup
pm2 save
```

#### 8. Monitor and Logs

```bash
# View logs
pm2 logs hathor-music

# Monitor processes
pm2 monit

# Restart application
pm2 restart hathor-music
```

---

### Option 2: Docker Deployment

#### 1. Create Dockerfile

Create `Dockerfile` in root:

```dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY client/package*.json ./client/

# Install dependencies
RUN npm install
RUN cd client && npm install

# Copy application files
COPY . .

# Build client
RUN cd client && npm run build

# Expose port
EXPOSE 5000

# Start application
CMD ["npm", "start"]
```

#### 2. Create docker-compose.yml

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:13-alpine
    environment:
      POSTGRES_DB: hathor_music
      POSTGRES_USER: hathor_user
      POSTGRES_PASSWORD: secure_password
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database/schema.sql:/docker-entrypoint-initdb.d/schema.sql
    ports:
      - "5432:5432"

  redis:
    image: redis:6-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  app:
    build: .
    ports:
      - "5000:5000"
    environment:
      NODE_ENV: production
      PORT: 5000
      DB_HOST: postgres
      DB_PORT: 5432
      DB_NAME: hathor_music
      DB_USER: hathor_user
      DB_PASSWORD: secure_password
      REDIS_HOST: redis
      REDIS_PORT: 6379
      JWT_SECRET: your_jwt_secret_here
      JWT_EXPIRE: 7d
      CLIENT_URL: http://localhost:3000
    depends_on:
      - postgres
      - redis
    volumes:
      - ./uploads:/app/uploads

volumes:
  postgres_data:
  redis_data:
```

#### 3. Deploy with Docker

```bash
# Build and start containers
docker-compose up -d

# View logs
docker-compose logs -f

# Stop containers
docker-compose down
```

---

### Option 3: Cloud Platform Deployment

#### Heroku

1. Install Heroku CLI
2. Create app:
```bash
heroku create hathor-music
```

3. Add PostgreSQL and Redis addons:
```bash
heroku addons:create heroku-postgresql:hobby-dev
heroku addons:create heroku-redis:hobby-dev
```

4. Set environment variables:
```bash
heroku config:set NODE_ENV=production
heroku config:set JWT_SECRET=your_secret_here
heroku config:set CLIENT_URL=https://hathor-music.herokuapp.com
```

5. Deploy:
```bash
git push heroku main
```

#### AWS, Azure, Google Cloud

Similar steps:
1. Create VM instance
2. Install prerequisites
3. Follow "Traditional Server Deployment" steps
4. Configure cloud firewall rules
5. Setup domain and SSL

---

## Post-Deployment Checklist

- [ ] Database is accessible and schema is applied
- [ ] Redis is running and accessible
- [ ] Environment variables are properly set
- [ ] Uploads directory exists with proper permissions
- [ ] SSL certificate is installed (for production)
- [ ] Firewall rules allow necessary ports
- [ ] Application starts without errors
- [ ] API health check returns success
- [ ] Frontend loads correctly
- [ ] Authentication works
- [ ] File upload works
- [ ] WebSocket connections work
- [ ] Monitoring and logging is configured

---

## Maintenance

### Backup Database

```bash
pg_dump -U hathor_user hathor_music > backup_$(date +%Y%m%d).sql
```

### Restore Database

```bash
psql -U hathor_user hathor_music < backup_20231201.sql
```

### Update Application

```bash
cd /var/www/hathor-music
git pull
npm install
cd client && npm install && npm run build && cd ..
pm2 restart hathor-music
```

### Monitor Resources

```bash
# Check disk space
df -h

# Check memory
free -m

# Check CPU
top

# Check logs
pm2 logs hathor-music --lines 100
```

---

## Troubleshooting

### Database Connection Issues
- Check PostgreSQL is running: `sudo systemctl status postgresql`
- Verify credentials in `.env`
- Check firewall rules

### Redis Connection Issues
- Check Redis is running: `sudo systemctl status redis`
- Test connection: `redis-cli ping`

### Application Won't Start
- Check logs: `pm2 logs hathor-music`
- Verify all environment variables are set
- Check port availability: `sudo lsof -i :5000`

### WebSocket Issues
- Ensure Nginx is configured for WebSocket upgrade
- Check CORS settings
- Verify Socket.io version compatibility

---

## Security Recommendations

1. **Use strong JWT secret** - Generate with: `openssl rand -base64 32`
2. **Enable HTTPS** - Always use SSL in production
3. **Secure database** - Use strong passwords, limit network access
4. **Regular updates** - Keep dependencies up to date
5. **Rate limiting** - Implement API rate limiting
6. **Input validation** - Validate all user inputs
7. **File upload security** - Validate file types and sizes
8. **Environment variables** - Never commit `.env` file
9. **Backup regularly** - Automate database backups
10. **Monitor logs** - Set up log monitoring and alerts

## Streaming Security & Proxy Requirements

### Environment Variables
Add this optional variable to tune signed stream URL expiry:

```env
STREAM_TOKEN_EXPIRE=60s
```

### Reverse Proxy (Nginx)
For best playback/seek behavior, configure a dedicated stream location that preserves range headers and disables buffering:

```nginx
location ~* ^/api/songs/[0-9]+/stream$ {
    proxy_pass http://app;
    proxy_http_version 1.1;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;

    proxy_buffering off;
    proxy_cache off;
}
```

> Do not expose `/uploads` directly when using authenticated streaming.
