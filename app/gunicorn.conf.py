"""
Gunicorn configuration for production deployment.
Usage: gunicorn wsgi:app -c gunicorn.conf.py
"""

import os
import multiprocessing

# ── Server socket ─────────────────────────────────────────────────────────
bind = f"0.0.0.0:{os.environ.get('PORT', '8000')}"

# ── Workers ───────────────────────────────────────────────────────────────
# 2-4 × CPU cores is recommended. Cap at 4 for small instances.
workers = int(os.environ.get("WEB_CONCURRENCY", min(multiprocessing.cpu_count() * 2 + 1, 4)))
worker_class = "gthread"
threads = 2

# ── Timeouts ──────────────────────────────────────────────────────────────
timeout = 120
graceful_timeout = 30
keepalive = 5

# ── Logging ───────────────────────────────────────────────────────────────
accesslog = "-"  # stdout
errorlog = "-"   # stderr
loglevel = os.environ.get("LOG_LEVEL", "info").lower()
access_log_format = '%(h)s %(l)s %(u)s %(t)s "%(r)s" %(s)s %(b)s "%(f)s" "%(a)s" %(D)sμs'

# ── Security ──────────────────────────────────────────────────────────────
limit_request_line = 8190
limit_request_fields = 100
limit_request_field_size = 8190

# ── Process naming ────────────────────────────────────────────────────────
proc_name = "productivity-tracker"

# ── Server hooks ──────────────────────────────────────────────────────────
def on_starting(server):
    server.log.info("Productivity Framework Tracker starting...")

def when_ready(server):
    server.log.info("Server ready. Listening on %s", bind)

def worker_exit(server, worker):
    server.log.info("Worker %s exited", worker.pid)
