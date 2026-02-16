# Deployment Guide — Productivity Framework Tracker

This guide covers production deployment for the Productivity Framework Tracker app.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start (Docker)](#quick-start-docker)
- [Manual Deployment](#manual-deployment)
- [Platform Deployment](#platform-deployment)
- [Environment Variables](#environment-variables)
- [Logging](#logging)
- [Security Checklist](#security-checklist)
- [SQLite Considerations](#sqlite-considerations)

---

## Prerequisites

- Python 3.10+
- pip
- Docker & Docker Compose (optional, for containerized deployment)

---

## Quick Start (Docker)

```bash
# 1. Create your .env from template
cp .env.example .env
# Edit .env and set FLASK_SECRET_KEY to a random string (64+ chars)

# 2. Build and start
docker compose up -d --build

# 3. Check health
curl http://localhost:8000/health

# 4. View logs
docker compose logs -f app
```

---

## Manual Deployment

```bash
# 1. Create virtual environment
python -m venv venv
source venv/bin/activate   # Linux/macOS
# venv\Scripts\activate    # Windows

# 2. Install dependencies
pip install -r requirements.txt

# 3. Set environment variables
export FLASK_ENV=production
export FLASK_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
export PORT=8000

# 4. Start with Gunicorn
gunicorn wsgi:app -c gunicorn.conf.py
```

---

## Platform Deployment

### Recommended Platforms

Below are platforms suited for this app, ranked by ease of deployment:

---

### 1. Railway (Recommended for quick deploys)

- **Free Tier:** $5 credit/month (enough for hobby projects)
- **Why:** Auto-detects Python, supports SQLite with persistent volumes, zero-config
- **Steps:**
  1. Push code to GitHub
  2. Connect repo on [railway.app](https://railway.app)
  3. Add a persistent volume mounted to `/data`
  4. Set environment variables in the Railway dashboard
  5. Railway auto-detects `Procfile` and deploys

---

### 2. Render

- **Free Tier:** 750 hours/month (sleeps after inactivity)
- **Why:** Native Docker support, persistent disks, auto-deploy from Git
- **Steps:**
  1. Create a new **Web Service** on [render.com](https://render.com)
  2. Connect your GitHub repo
  3. Set **Build Command:** `pip install -r requirements.txt`
  4. Set **Start Command:** `gunicorn wsgi:app -c gunicorn.conf.py`
  5. Add a **Disk** mounted at `/data` for SQLite persistence
  6. Set environment variables in the dashboard

---

### 3. Fly.io

- **Free Tier:** 3 shared VMs, 3GB persistent storage
- **Why:** Global edge deployment, persistent volumes, built-in health checks
- **Steps:**
  ```bash
  fly launch             # Detects Dockerfile
  fly volumes create data --size 1
  fly deploy
  ```
  Update `fly.toml` to mount the volume at `/data`.

---

### 4. DigitalOcean App Platform

- **Pricing:** Starts at $5/month
- **Why:** Managed platform, supports Docker, persistent storage
- **Steps:**
  1. Create a new App from your GitHub repo
  2. Select the Dockerfile build option
  3. Add a **Database Component** or persistent block storage
  4. Configure environment variables

---

### 5. Heroku

- **Pricing:** $5/month Eco dynos (no free tier)
- **Why:** Pioneer PaaS, simple workflow, auto-detects Procfile
- **Caveat:** Ephemeral filesystem — SQLite data is **lost on restart**. Use Heroku Postgres addon for persistent storage (requires code migration).
- **Steps:**
  ```bash
  heroku create
  heroku config:set FLASK_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")
  git push heroku main
  ```

---

### 6. VPS (DigitalOcean Droplet / Linode / Hetzner)

- **Pricing:** $4–6/month
- **Why:** Full control, persistent filesystem, best for SQLite
- **Steps:**
  1. SSH into server
  2. Install Docker and Docker Compose
  3. Clone repo and run:
     ```bash
     cp .env.example .env
     # Edit .env
     docker compose up -d --build
     ```
  4. Set up Nginx reverse proxy (see `nginx.conf`)
  5. Use Certbot for SSL: `certbot --nginx -d your-domain.com`

---

### 7. AWS Elastic Beanstalk

- **Free Tier:** 12 months free (t2.micro)
- **Why:** Full AWS ecosystem, auto-scaling, load balancing
- **Steps:**
  ```bash
  eb init -p python-3.12
  eb create production
  eb setenv FLASK_SECRET_KEY=your-secret-key
  ```

---

### Platform Comparison Table

| Platform            | Free Tier?   | SQLite Friendly | Docker Support | Ease of Use |
| ------------------- | ------------ | --------------- | -------------- | ----------- |
| **Railway**         | $5 credit/mo | ✅ (volumes)    | ✅             | ⭐⭐⭐⭐⭐  |
| **Render**          | 750 hrs/mo   | ✅ (disks)      | ✅             | ⭐⭐⭐⭐⭐  |
| **Fly.io**          | 3 VMs free   | ✅ (volumes)    | ✅             | ⭐⭐⭐⭐    |
| **DO App Platform** | No           | ⚠️ (limited)    | ✅             | ⭐⭐⭐⭐    |
| **Heroku**          | No           | ❌ (ephemeral)  | ✅             | ⭐⭐⭐⭐⭐  |
| **VPS**             | No           | ✅ (full disk)  | ✅             | ⭐⭐⭐      |
| **AWS EB**          | 12 months    | ⚠️ (EBS needed) | ✅             | ⭐⭐⭐      |

> **Note:** Since this app uses SQLite, platforms with persistent volumes (Railway, Render, Fly.io, VPS) are the best fit. SQLite is a single-file database — it doesn't need a separate DB server, but it does need a persistent filesystem.

---

## Environment Variables

| Variable           | Default             | Description                              |
| ------------------ | ------------------- | ---------------------------------------- |
| `FLASK_ENV`        | `development`       | Set to `production` for production       |
| `FLASK_SECRET_KEY` | auto-generated      | Session encryption key (set in prod!)    |
| `PORT`             | `8000`              | HTTP port                                |
| `WEB_CONCURRENCY`  | auto (CPU×2+1)      | Number of Gunicorn workers               |
| `DATABASE_PATH`    | `./productivity.db` | Path to SQLite database                  |
| `LOG_DIR`          | `./logs`            | Directory for log files                  |
| `LOG_LEVEL`        | `INFO`              | Logging level (DEBUG/INFO/WARNING/ERROR) |

---

## Logging

The app produces two log files with automatic rotation:

| Log File    | Size Limit | Backups | Contents                              |
| ----------- | ---------- | ------- | ------------------------------------- |
| `app.log`   | 10 MB      | 5       | Application events, errors, requests  |
| `audit.log` | 5 MB       | 10      | Auth events (login, register, logout) |

### Log format:

```
[2025-01-15 10:23:45,123] INFO in app: GET /api/frameworks 200 45ms from 192.168.1.1 user=john
```

### Monitoring:

```bash
# Follow application logs
tail -f logs/app.log

# Watch auth events
tail -f logs/audit.log

# Docker logs
docker compose logs -f app
```

---

## Security Checklist

Before deploying to production, verify:

- [ ] `FLASK_SECRET_KEY` is set to a long random value (64+ hex chars)
- [ ] `FLASK_ENV` is set to `production`
- [ ] HTTPS is enabled (via Nginx/reverse proxy or platform setting)
- [ ] `.env` file is **NOT** committed to Git
- [ ] Database file has restrictive file permissions (e.g., `chmod 600`)
- [ ] Rate limiting is active (built into the app)
- [ ] Security headers are enabled (built into the app)
- [ ] Health check endpoint `/health` is accessible to load balancer

---

## SQLite Considerations

This app uses SQLite which is excellent for single-server deployments:

- **Concurrency:** SQLite supports multiple concurrent readers with WAL mode (enabled), but only one writer at a time. This is fine for most single-instance workloads.
- **Backups:** Simply copy the `.db` file while the app is idle, or use `sqlite3 .backup` command.
- **When to migrate:** If you need horizontal scaling (multiple app instances writing to the same DB), consider migrating to PostgreSQL.

### Backup script:

```bash
# Backup SQLite database
sqlite3 /data/productivity.db ".backup /data/backups/productivity-$(date +%Y%m%d-%H%M%S).db"
```
