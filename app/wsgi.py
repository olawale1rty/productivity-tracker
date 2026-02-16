"""
WSGI entry point for production deployment.

Usage:
    gunicorn wsgi:app -c gunicorn.conf.py
"""

from app import app, init_db

# Ensure database tables exist on first deploy
init_db()
