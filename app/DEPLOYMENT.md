# Deployment Guide — Productivity Framework Tracker

---

## Table of Contents

- [Database Modes](#database-modes)
- [Quick Start (Docker Compose)](#quick-start-docker-compose)
- [Local Development](#local-development)
- [Deploy to Fly.io](#deploy-to-flyio)
- [Deploy to Other Platforms](#deploy-to-other-platforms)
- [Environment Variables](#environment-variables)
- [Logging](#logging)
- [Security Checklist](#security-checklist)

---

## Database Modes

The app supports **two database backends** — choose based on your needs:

| Feature     | SQLite                       | PostgreSQL                |
| ----------- | ---------------------------- | ------------------------- |
| Setup       | Zero config (default)        | Requires a running server |
| Scaling     | Single instance only         | Multiple app instances OK |
| Persistence | Needs persistent volume      | External managed DB       |
| Best for    | Local dev, hobby, single VPS | Production, teams, PaaS   |

**How it works:**

- If `DATABASE_URL` is set → uses PostgreSQL
- Otherwise → falls back to SQLite at `DATABASE_PATH`

---

## Quick Start (Docker Compose)

The compose stack starts **PostgreSQL + nginx + the app**:

```bash
# 1. Create your .env
cp .env.example .env
# Edit .env — set FLASK_SECRET_KEY and POSTGRES_PASSWORD

# 2. Build and start
docker compose up -d --build

# 3. Verify
curl http://localhost/health
# → {"status":"healthy","database":"postgresql"}

# 4. View logs
docker compose logs -f app
```

### Services started:

| Service    | Port | Purpose                                  |
| ---------- | ---- | ---------------------------------------- |
| `nginx`    | 80   | Reverse proxy, static file serving, gzip |
| `app`      | 8000 | Gunicorn + Flask (internal only)         |
| `postgres` | 5432 | PostgreSQL 16 (internal only)            |

### Stop / Destroy:

```bash
docker compose down          # Stop containers (keeps data)
docker compose down -v       # Stop + delete all data volumes
```

---

## Local Development

For local development, SQLite is used by default (no PostgreSQL needed):

```bash
# 1. Create virtual environment
python -m venv venv
source venv/bin/activate   # Linux/macOS
# venv\Scripts\activate    # Windows

# 2. Install dependencies
pip install -r requirements.txt

# 3. Run the dev server (SQLite)
python app.py
# → http://127.0.0.1:5000

# 4. Or to test with PostgreSQL locally:
export DATABASE_URL=postgresql://user:pass@localhost:5432/productivity
python app.py
```

---

## Deploy to Fly.io

### Prerequisites

- Install the Fly CLI: https://fly.io/docs/flyctl/install/
- Create a Fly account: `fly auth signup`

### Step-by-step

#### 1. Launch the app

```bash
cd app/
fly launch
# When prompted:
#   - App name: pick a name (e.g., my-productivity-tracker)
#   - Region: choose closest to your users
#   - Would you like to set up a Postgresql database? → Yes
#   - Would you like to set up an Upstash Redis database? → No
```

Fly automatically detects the `Dockerfile` and `fly.toml`.

#### 2. Create a persistent volume (for logs)

```bash
fly volumes create app_data --size 1 --region iad
# Replace 'iad' with your chosen region
```

#### 3. Set secrets

```bash
# Set a strong secret key
fly secrets set FLASK_SECRET_KEY=$(python -c "import secrets; print(secrets.token_hex(32))")

# DATABASE_URL is automatically set when you provision Fly Postgres
# Verify:
fly secrets list
```

#### 4. Deploy

```bash
fly deploy
```

#### 5. Verify

```bash
fly status
fly open           # Opens the app in your browser
fly logs           # Stream live logs

# Check health
curl https://your-app-name.fly.dev/health
```

#### 6. Manage the database

```bash
# Connect to your Fly Postgres
fly postgres connect -a your-app-name-db

# Check app logs
fly logs --app your-app-name
```

### Scaling on Fly

```bash
# Scale to 2 machines
fly scale count 2

# Scale machine size
fly scale vm shared-cpu-1x --memory 512

# Autoscale settings are in fly.toml
```

### Updating

```bash
# After code changes:
fly deploy
```

---

## Deploy to Other Platforms

### Railway

```bash
# 1. Push code to GitHub
# 2. Connect repo at railway.app
# 3. Add a PostgreSQL plugin (one click)
# 4. Railway auto-sets DATABASE_URL
# 5. Set FLASK_SECRET_KEY in environment variables
# 6. Deploy happens automatically
```

### Render

1. Create a **Web Service** at [render.com](https://render.com)
2. Connect GitHub repo
3. Set **Build Command:** `pip install -r requirements.txt`
4. Set **Start Command:** `gunicorn wsgi:app -c gunicorn.conf.py`
5. Add a **PostgreSQL database** (free tier available)
6. Render auto-sets `DATABASE_URL`
7. Add `FLASK_SECRET_KEY` in environment settings

### VPS (DigitalOcean / Linode / Hetzner)

```bash
# 1. SSH into server, install Docker
# 2. Clone repo
git clone <your-repo> && cd app/

# 3. Configure
cp .env.example .env
# Edit .env with production values

# 4. Start
docker compose up -d --build

# 5. Set up SSL with Certbot (optional, for custom domain)
# Use a separate nginx on the host or Caddy as reverse proxy
```

---

## Environment Variables

| Variable            | Default                     | Description                                    |
| ------------------- | --------------------------- | ---------------------------------------------- |
| `DATABASE_URL`      | _(unset — uses SQLite)_     | PostgreSQL connection string                   |
| `DATABASE_PATH`     | `./productivity.db`         | SQLite file path (ignored if DATABASE_URL set) |
| `FLASK_ENV`         | `development`               | Set to `production` for production             |
| `FLASK_SECRET_KEY`  | _(auto-generated)_          | Session encryption key (set in prod!)          |
| `PORT`              | `8000` (app) / `80` (nginx) | HTTP port                                      |
| `WEB_CONCURRENCY`   | `auto (CPU×2+1)`            | Gunicorn worker count                          |
| `LOG_LEVEL`         | `INFO`                      | DEBUG / INFO / WARNING / ERROR / CRITICAL      |
| `LOG_DIR`           | `./logs`                    | Log file directory                             |
| `POSTGRES_USER`     | `productivity`              | Docker Compose PG user                         |
| `POSTGRES_PASSWORD` | `changeme`                  | Docker Compose PG password                     |
| `POSTGRES_DB`       | `productivity`              | Docker Compose PG database name                |

---

## Logging

Two rotating log files:

| Log File    | Size Limit | Backups | Contents                              |
| ----------- | ---------- | ------- | ------------------------------------- |
| `app.log`   | 10 MB      | 5       | App events, errors, request traces    |
| `audit.log` | 5 MB       | 10      | Auth events (login, register, logout) |

```bash
# Follow logs
tail -f logs/app.log
tail -f logs/audit.log

# Docker
docker compose logs -f app
```

---

## Security Checklist

- [ ] `FLASK_SECRET_KEY` set to a random value (64+ hex chars)
- [ ] `FLASK_ENV=production`
- [ ] `POSTGRES_PASSWORD` changed from default
- [ ] HTTPS enabled (platform TLS or Certbot)
- [ ] `.env` is **NOT** in Git (check `.gitignore`)
- [ ] Database credentials are in secrets, not code
- [ ] `/health` accessible to load balancer only (optionally)
