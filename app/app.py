"""
Productivity Framework Tracker
Create lists of work items, apply productivity frameworks, and organize your work.
"""

import os
import io
import csv
import json
import re
import sys
import sqlite3
import secrets
import time
import logging
import hashlib
import html as html_mod
from functools import wraps
from datetime import timedelta
from collections import defaultdict
from logging.handlers import RotatingFileHandler

from flask import (
    Flask, request, jsonify, session,
    render_template, g, Response, abort
)
from werkzeug.security import generate_password_hash, check_password_hash

# ── Configuration ─────────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
DB_PATH     = os.environ.get("DATABASE_PATH", os.path.join(BASE_DIR, "productivity.db"))
SECRET_FILE = os.path.join(BASE_DIR, ".flask_secret")
LOG_DIR     = os.environ.get("LOG_DIR", os.path.join(BASE_DIR, "logs"))
LOG_LEVEL   = os.environ.get("LOG_LEVEL", "INFO").upper()
ENV         = os.environ.get("FLASK_ENV", "development")
IS_PROD     = ENV == "production"

# ── Logging Setup ─────────────────────────────────────────────────────────
os.makedirs(LOG_DIR, exist_ok=True)

def _setup_logging(app_instance):
    """Configure structured logging for both console and rotating files."""
    formatter = logging.Formatter(
        fmt="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    # Rotating file handler (10 MB per file, keep 5 backups)
    file_handler = RotatingFileHandler(
        os.path.join(LOG_DIR, "app.log"),
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.DEBUG)

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(getattr(logging, LOG_LEVEL, logging.INFO))

    # Security audit log (auth events only)
    audit_handler = RotatingFileHandler(
        os.path.join(LOG_DIR, "audit.log"),
        maxBytes=5 * 1024 * 1024,
        backupCount=10,
        encoding="utf-8",
    )
    audit_handler.setFormatter(formatter)
    audit_handler.setLevel(logging.INFO)

    # App logger
    app_instance.logger.handlers.clear()
    app_instance.logger.addHandler(file_handler)
    app_instance.logger.addHandler(console_handler)
    app_instance.logger.setLevel(logging.DEBUG)

    # Audit logger (separate)
    _audit = logging.getLogger("audit")
    _audit.handlers.clear()
    _audit.addHandler(audit_handler)
    _audit.addHandler(console_handler)
    _audit.setLevel(logging.INFO)
    _audit.propagate = False

    # Suppress noisy werkzeug request logs in production
    if IS_PROD:
        logging.getLogger("werkzeug").setLevel(logging.WARNING)

    return _audit

audit_log = None  # initialised after app creation

# ── Persistent secret key ─────────────────────────────────────────────────
def _get_secret_key():
    """Use env var, or persist to file so sessions survive restarts."""
    key = os.environ.get("FLASK_SECRET_KEY")
    if key:
        return key
    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "r") as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(SECRET_FILE, "w") as f:
        f.write(key)
    return key

app = Flask(__name__)
app.secret_key = _get_secret_key()
app.permanent_session_lifetime = timedelta(days=30)

# ── Secure cookie configuration ──────────────────────────────────────────
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=IS_PROD,
    MAX_CONTENT_LENGTH=2 * 1024 * 1024,  # 2 MB max request body
)

# Initialise logging
audit_log = _setup_logging(app)
app.logger.info("App starting — env=%s, db=%s", ENV, DB_PATH)

# ── Rate limiting (in-memory) ─────────────────────────────────────────────
_rate_store = defaultdict(list)  # ip -> [timestamps]
RATE_LIMIT = 10   # max requests
RATE_WINDOW = 60  # per window (seconds)

def _rate_limited(key_suffix=""):
    """Return True if the current IP is rate-limited."""
    ip = request.remote_addr or "unknown"
    key = f"{ip}:{key_suffix}"
    now = time.time()
    _rate_store[key] = [t for t in _rate_store[key] if now - t < RATE_WINDOW]
    if len(_rate_store[key]) >= RATE_LIMIT:
        app.logger.warning("Rate limit hit — ip=%s suffix=%s", ip, key_suffix)
        return True
    _rate_store[key].append(now)
    return False

# ── Request lifecycle logging & security headers ─────────────────────────
@app.before_request
def _log_request_start():
    g.request_start = time.time()

@app.after_request
def _log_and_secure(response):
    # Security headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    if request.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"

    # Request logging
    duration = round((time.time() - g.get("request_start", time.time())) * 1000, 1)
    level = logging.WARNING if response.status_code >= 400 else logging.DEBUG
    app.logger.log(
        level,
        "%s %s %s %sms — ip=%s user=%s",
        request.method,
        request.path,
        response.status_code,
        duration,
        request.remote_addr,
        session.get("username", "-"),
    )
    return response

# ── Error handlers ────────────────────────────────────────────────────────
@app.errorhandler(404)
def _not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found"}), 404
    return render_template("index.html"), 404

@app.errorhandler(500)
def _server_error(e):
    app.logger.exception("Internal server error: %s", e)
    return jsonify({"error": "Internal server error"}), 500

@app.errorhandler(413)
def _too_large(e):
    return jsonify({"error": "Request too large (max 2 MB)"}), 413

@app.errorhandler(429)
def _too_many(e):
    return jsonify({"error": "Too many requests"}), 429

# ── Input sanitisation helpers ────────────────────────────────────────────
MAX_STR = 1000
MAX_TEXT = 5000

def _san(val, maxlen=MAX_STR):
    """Sanitise a short string input: strip, truncate, escape HTML."""
    if not isinstance(val, str):
        return ""
    return html_mod.escape(val.strip()[:maxlen])

def _san_text(val, maxlen=MAX_TEXT):
    """Sanitise a longer text input."""
    return _san(val, maxlen)

def _valid_date(val):
    """Return val if it looks like YYYY-MM-DD, else None."""
    if not val:
        return None
    if re.match(r"^\d{4}-\d{2}-\d{2}$", val):
        return val
    return None

FRAMEWORKS = {
    "eisenhower": {
        "name": "Eisenhower Matrix",
        "author": "Dwight D. Eisenhower",
        "description": "Sort tasks by urgent vs important to stop treating everything like an emergency.",
        "icon": "\U0001f4cb",
        "color": "#6366f1"
    },
    "timeboxing": {
        "name": "Timeboxing",
        "author": "James Martin",
        "description": "Give tasks a fixed time limit so they can\u2019t expand and swallow your whole week.",
        "icon": "\u23f1\ufe0f",
        "color": "#f59e0b"
    },
    "impact_effort": {
        "name": "Impact / Effort Matrix",
        "author": "Lean / Agile practices",
        "description": "Rank tasks by impact vs effort to pick the work that actually moves things forward.",
        "icon": "\U0001f4ca",
        "color": "#10b981"
    },
    "kanban": {
        "name": "Kanban Board",
        "author": "Taiichi Ohno",
        "description": "Track tasks through stages so you can see what\u2019s stuck.",
        "icon": "\U0001f4cc",
        "color": "#3b82f6"
    },
    "stop_doing": {
        "name": "Stop Doing List",
        "author": "Jim Collins",
        "description": "Win by removing commitments instead of stacking more on top.",
        "icon": "\U0001f6ab",
        "color": "#ef4444"
    },
    "pareto": {
        "name": "80/20 Principle",
        "author": "Vilfredo Pareto",
        "description": "Focus on the 20% of inputs that drive 80% of results.",
        "icon": "\U0001f3af",
        "color": "#8b5cf6"
    },
}

# ── Database ──────────────────────────────────────────────────────────────

def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db

@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()

def init_db():
    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS lists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS list_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            description TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            due_date TEXT DEFAULT NULL,
            priority TEXT DEFAULT 'medium',
            completed INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS list_frameworks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id INTEGER NOT NULL,
            framework_key TEXT NOT NULL,
            added_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
            UNIQUE(list_id, framework_key)
        );
        CREATE TABLE IF NOT EXISTS item_framework_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            framework_key TEXT NOT NULL,
            data_json TEXT DEFAULT '{}',
            updated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (item_id) REFERENCES list_items(id) ON DELETE CASCADE,
            UNIQUE(item_id, framework_key)
        );
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            color TEXT DEFAULT '#6366f1',
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, name)
        );
        CREATE TABLE IF NOT EXISTS item_tags (
            item_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (item_id, tag_id),
            FOREIGN KEY (item_id) REFERENCES list_items(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS list_shares (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id INTEGER NOT NULL,
            owner_id INTEGER NOT NULL,
            shared_with_id INTEGER NOT NULL,
            permission TEXT DEFAULT 'view',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
            FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (shared_with_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(list_id, shared_with_id)
        );
        CREATE TABLE IF NOT EXISTS item_comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            item_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (item_id) REFERENCES list_items(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS list_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            description TEXT DEFAULT '',
            items_json TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    """)
    # Migrate: add columns if they don't exist (for existing DBs)
    try:
        db.execute("ALTER TABLE list_items ADD COLUMN due_date TEXT DEFAULT NULL")
    except sqlite3.OperationalError:
        pass
    try:
        db.execute("ALTER TABLE list_items ADD COLUMN priority TEXT DEFAULT 'medium'")
    except sqlite3.OperationalError:
        pass
    try:
        db.execute("ALTER TABLE list_items ADD COLUMN completed INTEGER DEFAULT 0")
    except sqlite3.OperationalError:
        pass
    db.commit()
    db.close()

# ── Auth helpers ──────────────────────────────────────────────────────────

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if "user_id" not in session:
            return jsonify({"error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated

def uid():
    return session.get("user_id")

def _owns_list(db, list_id):
    return db.execute("SELECT id FROM lists WHERE id=? AND user_id=?",
                       (list_id, uid())).fetchone()

# ── Page ──────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    return render_template("index.html")

# ── Auth API ──────────────────────────────────────────────────────────────

@app.route("/api/register", methods=["POST"])
def register():
    if _rate_limited("auth"):
        return jsonify({"error": "Too many attempts. Try again later."}), 429
    d = request.get_json(silent=True)
    if not d:
        return jsonify({"error": "Invalid request body"}), 400
    username = _san(d.get("username") or "").lower()
    password = d.get("password") or ""
    if not re.match(r"^[a-z0-9_]{3,30}$", username):
        return jsonify({"error": "Username must be 3-30 chars (letters, numbers, underscore)"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400
    if len(password) > 128:
        return jsonify({"error": "Password too long"}), 400
    db = get_db()
    if db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone():
        return jsonify({"error": "Username already taken"}), 409
    cur = db.execute("INSERT INTO users (username, password) VALUES (?, ?)",
                      (username, generate_password_hash(password)))
    db.commit()
    session.permanent = True
    session["user_id"] = cur.lastrowid
    session["username"] = username
    audit_log.info("REGISTER success — user=%s ip=%s", username, request.remote_addr)
    return jsonify({"ok": True, "username": username})

@app.route("/api/login", methods=["POST"])
def login():
    if _rate_limited("auth"):
        return jsonify({"error": "Too many attempts. Try again later."}), 429
    d = request.get_json(silent=True)
    if not d:
        return jsonify({"error": "Invalid request body"}), 400
    username = _san(d.get("username") or "").lower()
    password = d.get("password") or ""
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    if not user or not check_password_hash(user["password"], password):
        audit_log.warning("LOGIN failed — user=%s ip=%s", username, request.remote_addr)
        return jsonify({"error": "Invalid credentials"}), 401
    # Prevent session fixation: clear then re-populate
    session.clear()
    session.permanent = True
    session["user_id"] = user["id"]
    session["username"] = user["username"]
    audit_log.info("LOGIN success — user=%s ip=%s", username, request.remote_addr)
    return jsonify({"ok": True, "username": user["username"]})

@app.route("/api/logout", methods=["POST"])
def logout():
    user = session.get("username", "-")
    session.clear()
    audit_log.info("LOGOUT — user=%s ip=%s", user, request.remote_addr)
    return jsonify({"ok": True})

@app.route("/api/me")
def me():
    if "user_id" in session:
        return jsonify({"logged_in": True, "username": session["username"]})
    return jsonify({"logged_in": False})

# ── Frameworks Catalog ────────────────────────────────────────────────────

@app.route("/api/frameworks-catalog")
@login_required
def frameworks_catalog():
    return jsonify(FRAMEWORKS)

# ── Lists CRUD ────────────────────────────────────────────────────────────

@app.route("/api/lists", methods=["GET"])
@login_required
def get_lists():
    db = get_db()
    # Own lists
    rows = db.execute("SELECT * FROM lists WHERE user_id=? ORDER BY created_at DESC",
                       (uid(),)).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["item_count"] = db.execute(
            "SELECT COUNT(*) as c FROM list_items WHERE list_id=?", (r["id"],)
        ).fetchone()["c"]
        completed = db.execute(
            "SELECT COUNT(*) as c FROM list_items WHERE list_id=? AND completed=1", (r["id"],)
        ).fetchone()["c"]
        d["completed_count"] = completed
        fw = db.execute("SELECT framework_key FROM list_frameworks WHERE list_id=?",
                         (r["id"],)).fetchall()
        d["frameworks"] = [f["framework_key"] for f in fw]
        d["shared"] = False
        result.append(d)
    return jsonify(result)

@app.route("/api/lists", methods=["POST"])
@login_required
def create_list():
    d = request.get_json(silent=True) or {}
    name = _san(d.get("name") or "")
    desc = _san_text(d.get("description") or "")
    if not name:
        return jsonify({"error": "List name is required"}), 400
    db = get_db()
    cur = db.execute("INSERT INTO lists (user_id, name, description) VALUES (?,?,?)",
                      (uid(), name, desc))
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid}), 201

@app.route("/api/lists/<int:lid>", methods=["PUT"])
@login_required
def update_list(lid):
    d = request.get_json(silent=True) or {}
    db = get_db()
    db.execute("UPDATE lists SET name=?, description=? WHERE id=? AND user_id=?",
               (_san(d.get("name") or ""), _san_text(d.get("description") or ""), lid, uid()))
    db.commit()
    return jsonify({"ok": True})

@app.route("/api/lists/<int:lid>", methods=["DELETE"])
@login_required
def delete_list(lid):
    db = get_db()
    db.execute("DELETE FROM lists WHERE id=? AND user_id=?", (lid, uid()))
    db.commit()
    return jsonify({"ok": True})

# ── Items CRUD ────────────────────────────────────────────────────────────

@app.route("/api/lists/<int:lid>/items", methods=["GET"])
@login_required
def get_items(lid):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    rows = db.execute("SELECT * FROM list_items WHERE list_id=? ORDER BY sort_order, id",
                       (lid,)).fetchall()
    items = []
    for r in rows:
        d = dict(r)
        # Attach tags
        tag_rows = db.execute("""
            SELECT t.id, t.name, t.color FROM tags t
            JOIN item_tags it ON it.tag_id = t.id
            WHERE it.item_id = ?
        """, (r["id"],)).fetchall()
        d["tags"] = [{"id": t["id"], "name": t["name"], "color": t["color"]} for t in tag_rows]
        items.append(d)
    return jsonify(items)

@app.route("/api/lists/<int:lid>/items", methods=["POST"])
@login_required
def create_item(lid):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    d = request.get_json(silent=True) or {}
    title = _san(d.get("title") or "")
    desc = _san_text(d.get("description") or "")
    due_date = _valid_date(d.get("due_date"))
    priority = d.get("priority") or "medium"
    if priority not in ("low", "medium", "high"):
        priority = "medium"
    if not title:
        return jsonify({"error": "Title is required"}), 400
    nxt = db.execute("SELECT COALESCE(MAX(sort_order),-1)+1 as n FROM list_items WHERE list_id=?",
                      (lid,)).fetchone()["n"]
    cur = db.execute(
        "INSERT INTO list_items (list_id,title,description,sort_order,due_date,priority) VALUES (?,?,?,?,?,?)",
        (lid, title, desc, nxt, due_date, priority))
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid}), 201

@app.route("/api/lists/<int:lid>/items/<int:iid>", methods=["PUT"])
@login_required
def update_item(lid, iid):
    db = get_db()
    if not db.execute("SELECT li.id FROM list_items li JOIN lists l ON l.id=li.list_id WHERE li.id=? AND li.list_id=? AND l.user_id=?",
                       (iid, lid, uid())).fetchone():
        return jsonify({"error": "Not found"}), 404
    d = request.get_json(silent=True) or {}
    title = _san(d.get("title") or "")
    if not title:
        return jsonify({"error": "Title is required"}), 400
    due_date = _valid_date(d.get("due_date"))
    priority = d.get("priority") or "medium"
    if priority not in ("low", "medium", "high"):
        priority = "medium"
    db.execute("UPDATE list_items SET title=?, description=?, due_date=?, priority=? WHERE id=?",
               (title, _san_text(d.get("description") or ""), due_date, priority, iid))
    db.commit()
    return jsonify({"ok": True})

@app.route("/api/lists/<int:lid>/items/<int:iid>", methods=["DELETE"])
@login_required
def delete_item(lid, iid):
    db = get_db()
    db.execute("DELETE FROM list_items WHERE id=? AND list_id=? AND list_id IN (SELECT id FROM lists WHERE user_id=?)",
               (iid, lid, uid()))
    db.commit()
    return jsonify({"ok": True})

@app.route("/api/lists/<int:lid>/items/<int:iid>/toggle", methods=["PUT"])
@login_required
def toggle_item(lid, iid):
    db = get_db()
    item = db.execute("SELECT li.completed FROM list_items li JOIN lists l ON l.id=li.list_id WHERE li.id=? AND li.list_id=? AND l.user_id=?",
                       (iid, lid, uid())).fetchone()
    if not item:
        return jsonify({"error": "Not found"}), 404
    new_val = 0 if item["completed"] else 1
    db.execute("UPDATE list_items SET completed=? WHERE id=?", (new_val, iid))
    db.commit()
    return jsonify({"ok": True, "completed": new_val})

@app.route("/api/lists/<int:lid>/items/reorder", methods=["PUT"])
@login_required
def reorder_items(lid):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    d = request.get_json(silent=True) or {}
    order = d.get("order", [])
    if not isinstance(order, list) or len(order) > 500:
        return jsonify({"error": "Invalid order"}), 400
    for idx, item_id in enumerate(order):
        if not isinstance(item_id, int):
            continue
        db.execute("UPDATE list_items SET sort_order=? WHERE id=? AND list_id=?",
                    (idx, item_id, lid))
    db.commit()
    return jsonify({"ok": True})

@app.route("/api/lists/<int:lid>/items/bulk-delete", methods=["POST"])
@login_required
def bulk_delete_items(lid):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    d = request.get_json(silent=True) or {}
    ids = d.get("ids", [])
    if not isinstance(ids, list) or len(ids) > 500:
        return jsonify({"error": "Invalid ids"}), 400
    for iid in ids:
        db.execute("DELETE FROM list_items WHERE id=? AND list_id=?", (iid, lid))
    db.commit()
    return jsonify({"ok": True})

@app.route("/api/lists/<int:lid>/items/bulk-move", methods=["POST"])
@login_required
def bulk_move_items(lid):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    d = request.get_json(silent=True) or {}
    ids = d.get("ids", [])
    if not isinstance(ids, list) or len(ids) > 500:
        return jsonify({"error": "Invalid ids"}), 400
    target_list_id = d.get("target_list_id")
    if not _owns_list(db, target_list_id):
        return jsonify({"error": "Target list not found"}), 404
    for iid in ids:
        db.execute("UPDATE list_items SET list_id=? WHERE id=? AND list_id=?",
                    (target_list_id, iid, lid))
    db.commit()
    return jsonify({"ok": True})

# ── List Frameworks ───────────────────────────────────────────────────────

@app.route("/api/lists/<int:lid>/frameworks", methods=["GET"])
@login_required
def get_list_frameworks(lid):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    rows = db.execute("SELECT framework_key FROM list_frameworks WHERE list_id=?",
                       (lid,)).fetchall()
    return jsonify([r["framework_key"] for r in rows])

@app.route("/api/lists/<int:lid>/frameworks", methods=["POST"])
@login_required
def add_list_framework(lid):
    d = request.get_json(silent=True) or {}
    key = d.get("framework_key", "")
    if key not in FRAMEWORKS:
        return jsonify({"error": "Invalid framework"}), 400
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    try:
        db.execute("INSERT INTO list_frameworks (list_id, framework_key) VALUES (?,?)",
                    (lid, key))
        db.commit()
    except sqlite3.IntegrityError:
        pass
    return jsonify({"ok": True}), 201

@app.route("/api/lists/<int:lid>/frameworks/<key>", methods=["DELETE"])
@login_required
def remove_list_framework(lid, key):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    db.execute("DELETE FROM list_frameworks WHERE list_id=? AND framework_key=?", (lid, key))
    db.execute("DELETE FROM item_framework_data WHERE framework_key=? AND item_id IN (SELECT id FROM list_items WHERE list_id=?)",
               (key, lid))
    db.commit()
    return jsonify({"ok": True})

# ── Item Framework Data ───────────────────────────────────────────────────

@app.route("/api/lists/<int:lid>/framework-data/<key>", methods=["GET"])
@login_required
def get_framework_data(lid, key):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    rows = db.execute("""
        SELECT ifd.item_id, ifd.data_json, li.title, li.description
        FROM item_framework_data ifd
        JOIN list_items li ON li.id = ifd.item_id
        WHERE ifd.framework_key=? AND li.list_id=?
    """, (key, lid)).fetchall()
    result = {}
    for r in rows:
        result[str(r["item_id"])] = {
            "data": json.loads(r["data_json"]),
            "title": r["title"],
            "description": r["description"]
        }
    return jsonify(result)

@app.route("/api/items/<int:iid>/framework-data/<key>", methods=["PUT"])
@login_required
def update_framework_data(iid, key):
    d = request.get_json(silent=True) or {}
    db = get_db()
    if not db.execute("SELECT li.id FROM list_items li JOIN lists l ON l.id=li.list_id WHERE li.id=? AND l.user_id=?",
                       (iid, uid())).fetchone():
        return jsonify({"error": "Not found"}), 404
    db.execute("""
        INSERT INTO item_framework_data (item_id, framework_key, data_json, updated_at)
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(item_id, framework_key)
        DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at
    """, (iid, key, json.dumps(d.get("data", {}))))
    db.commit()
    return jsonify({"ok": True})

@app.route("/api/lists/<int:lid>/framework-data/<key>/batch", methods=["PUT"])
@login_required
def batch_update_framework_data(lid, key):
    d = request.get_json(silent=True) or {}
    items = d.get("items", {})
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    for iid_str, idata in items.items():
        db.execute("""
            INSERT INTO item_framework_data (item_id, framework_key, data_json, updated_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(item_id, framework_key)
            DO UPDATE SET data_json=excluded.data_json, updated_at=excluded.updated_at
        """, (int(iid_str), key, json.dumps(idata)))
    db.commit()
    return jsonify({"ok": True})

# ── Tags CRUD ─────────────────────────────────────────────────────────────

@app.route("/api/tags", methods=["GET"])
@login_required
def get_tags():
    db = get_db()
    rows = db.execute("SELECT * FROM tags WHERE user_id=? ORDER BY name", (uid(),)).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/tags", methods=["POST"])
@login_required
def create_tag():
    d = request.get_json(silent=True) or {}
    name = _san(d.get("name") or "")
    color = d.get("color") or "#6366f1"
    if not re.match(r'^#[0-9a-fA-F]{6}$', color):
        color = "#6366f1"
    if not name:
        return jsonify({"error": "Tag name is required"}), 400
    db = get_db()
    try:
        cur = db.execute("INSERT INTO tags (user_id, name, color) VALUES (?,?,?)",
                          (uid(), name, color))
        db.commit()
        return jsonify({"ok": True, "id": cur.lastrowid}), 201
    except sqlite3.IntegrityError:
        return jsonify({"error": "Tag already exists"}), 409

@app.route("/api/tags/<int:tid>", methods=["DELETE"])
@login_required
def delete_tag(tid):
    db = get_db()
    db.execute("DELETE FROM tags WHERE id=? AND user_id=?", (tid, uid()))
    db.commit()
    return jsonify({"ok": True})

@app.route("/api/items/<int:iid>/tags/<int:tid>", methods=["POST"])
@login_required
def add_item_tag(iid, tid):
    db = get_db()
    # Verify user owns the item
    if not db.execute("SELECT li.id FROM list_items li JOIN lists l ON l.id=li.list_id WHERE li.id=? AND l.user_id=?",
                       (iid, uid())).fetchone():
        return jsonify({"error": "Not found"}), 404
    # Verify user owns the tag
    if not db.execute("SELECT id FROM tags WHERE id=? AND user_id=?", (tid, uid())).fetchone():
        return jsonify({"error": "Tag not found"}), 404
    try:
        db.execute("INSERT INTO item_tags (item_id, tag_id) VALUES (?,?)", (iid, tid))
        db.commit()
    except sqlite3.IntegrityError:
        pass
    return jsonify({"ok": True})

@app.route("/api/items/<int:iid>/tags/<int:tid>", methods=["DELETE"])
@login_required
def remove_item_tag(iid, tid):
    db = get_db()
    # Verify user owns the item
    if not db.execute("SELECT li.id FROM list_items li JOIN lists l ON l.id=li.list_id WHERE li.id=? AND l.user_id=?",
                       (iid, uid())).fetchone():
        return jsonify({"error": "Not found"}), 404
    db.execute("DELETE FROM item_tags WHERE item_id=? AND tag_id=?", (iid, tid))
    db.commit()
    return jsonify({"ok": True})

# ── Comments ──────────────────────────────────────────────────────────────

@app.route("/api/items/<int:iid>/comments", methods=["GET"])
@login_required
def get_comments(iid):
    db = get_db()
    # Verify user owns the item (or it's shared with them)
    if not db.execute("SELECT li.id FROM list_items li JOIN lists l ON l.id=li.list_id WHERE li.id=? AND l.user_id=?",
                       (iid, uid())).fetchone():
        return jsonify({"error": "Not found"}), 404
    rows = db.execute("""
        SELECT ic.*, u.username FROM item_comments ic
        JOIN users u ON u.id = ic.user_id
        WHERE ic.item_id=? ORDER BY ic.created_at ASC
    """, (iid,)).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/items/<int:iid>/comments", methods=["POST"])
@login_required
def add_comment(iid):
    d = request.get_json(silent=True) or {}
    content = _san_text(d.get("content") or "")
    if not content:
        return jsonify({"error": "Comment cannot be empty"}), 400
    db = get_db()
    cur = db.execute("INSERT INTO item_comments (item_id, user_id, content) VALUES (?,?,?)",
                      (iid, uid(), content))
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid}), 201

@app.route("/api/comments/<int:cid>", methods=["DELETE"])
@login_required
def delete_comment(cid):
    db = get_db()
    db.execute("DELETE FROM item_comments WHERE id=? AND user_id=?", (cid, uid()))
    db.commit()
    return jsonify({"ok": True})

# ── Dashboard ─────────────────────────────────────────────────────────────

@app.route("/api/dashboard", methods=["GET"])
@login_required
def dashboard():
    db = get_db()
    total_lists = db.execute("SELECT COUNT(*) as c FROM lists WHERE user_id=?", (uid(),)).fetchone()["c"]
    total_items = db.execute("""
        SELECT COUNT(*) as c FROM list_items li
        JOIN lists l ON l.id = li.list_id WHERE l.user_id=?
    """, (uid(),)).fetchone()["c"]
    completed_items = db.execute("""
        SELECT COUNT(*) as c FROM list_items li
        JOIN lists l ON l.id = li.list_id WHERE l.user_id=? AND li.completed=1
    """, (uid(),)).fetchone()["c"]
    overdue = db.execute("""
        SELECT COUNT(*) as c FROM list_items li
        JOIN lists l ON l.id = li.list_id
        WHERE l.user_id=? AND li.due_date IS NOT NULL AND li.due_date < date('now') AND li.completed=0
    """, (uid(),)).fetchone()["c"]
    high_pri = db.execute("""
        SELECT COUNT(*) as c FROM list_items li
        JOIN lists l ON l.id = li.list_id WHERE l.user_id=? AND li.priority='high' AND li.completed=0
    """, (uid(),)).fetchone()["c"]

    # Framework usage breakdown
    fw_usage = db.execute("""
        SELECT lf.framework_key, COUNT(*) as cnt FROM list_frameworks lf
        JOIN lists l ON l.id = lf.list_id WHERE l.user_id=?
        GROUP BY lf.framework_key
    """, (uid(),)).fetchall()
    fw_data = {r["framework_key"]: r["cnt"] for r in fw_usage}

    # Recent items
    recent = db.execute("""
        SELECT li.*, l.name as list_name FROM list_items li
        JOIN lists l ON l.id = li.list_id WHERE l.user_id=?
        ORDER BY li.created_at DESC LIMIT 10
    """, (uid(),)).fetchall()

    return jsonify({
        "total_lists": total_lists,
        "total_items": total_items,
        "completed_items": completed_items,
        "overdue_items": overdue,
        "high_priority": high_pri,
        "framework_usage": fw_data,
        "recent_items": [dict(r) for r in recent],
        "completion_rate": round((completed_items / total_items * 100) if total_items else 0, 1)
    })

# ── Export / Import ───────────────────────────────────────────────────────

@app.route("/api/lists/<int:lid>/export", methods=["GET"])
@login_required
def export_list(lid):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    lst = dict(db.execute("SELECT * FROM lists WHERE id=?", (lid,)).fetchone())
    items = [dict(r) for r in db.execute("SELECT * FROM list_items WHERE list_id=? ORDER BY sort_order",
                                          (lid,)).fetchall()]
    fw = [r["framework_key"] for r in db.execute("SELECT framework_key FROM list_frameworks WHERE list_id=?",
                                                   (lid,)).fetchall()]
    fmt = request.args.get("format", "json")
    if fmt not in ("json", "csv"):
        fmt = "json"
    safe_name = re.sub(r'[^a-zA-Z0-9_\- ]', '', lst['name'])[:50] or "export"
    if fmt == "csv":
        si = io.StringIO()
        writer = csv.writer(si)
        writer.writerow(["title", "description", "priority", "due_date", "completed"])
        for item in items:
            writer.writerow([item["title"], item.get("description", ""),
                           item.get("priority", "medium"), item.get("due_date", ""),
                           item.get("completed", 0)])
        return Response(si.getvalue(), mimetype="text/csv",
                       headers={"Content-Disposition": f"attachment;filename={safe_name}.csv"})
    data = {"name": lst["name"], "description": lst.get("description", ""),
            "frameworks": fw, "items": items}
    return Response(json.dumps(data, indent=2), mimetype="application/json",
                   headers={"Content-Disposition": f"attachment;filename={safe_name}.json"})

@app.route("/api/lists/import", methods=["POST"])
@login_required
def import_list():
    d = request.get_json(silent=True) or {}
    name = _san(d.get("name") or "Imported List")
    desc = _san_text(d.get("description") or "")
    items = d.get("items", [])
    if not isinstance(items, list) or len(items) > 1000:
        return jsonify({"error": "Too many items"}), 400
    frameworks = d.get("frameworks", [])
    db = get_db()
    cur = db.execute("INSERT INTO lists (user_id, name, description) VALUES (?,?,?)",
                      (uid(), name, desc))
    lid = cur.lastrowid
    for idx, item in enumerate(items):
        title = _san(item.get("title", ""))
        if not title:
            continue
        priority = item.get("priority", "medium")
        if priority not in ("low", "medium", "high"):
            priority = "medium"
        db.execute(
            "INSERT INTO list_items (list_id,title,description,sort_order,due_date,priority,completed) VALUES (?,?,?,?,?,?,?)",
            (lid, title, _san_text(item.get("description", "")), idx,
             _valid_date(item.get("due_date")), priority,
             1 if item.get("completed") else 0))
    for fk in frameworks:
        if fk in FRAMEWORKS:
            try:
                db.execute("INSERT INTO list_frameworks (list_id, framework_key) VALUES (?,?)",
                            (lid, fk))
            except sqlite3.IntegrityError:
                pass
    db.commit()
    return jsonify({"ok": True, "id": lid}), 201

# ── List Sharing ──────────────────────────────────────────────────────────

@app.route("/api/lists/<int:lid>/share", methods=["POST"])
@login_required
def share_list(lid):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    d = request.get_json(silent=True) or {}
    username = _san(d.get("username") or "").lower()
    permission = d.get("permission", "view")
    if permission not in ("view", "edit"):
        permission = "view"
    user = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
    if not user:
        return jsonify({"error": "User not found"}), 404
    if user["id"] == uid():
        return jsonify({"error": "Cannot share with yourself"}), 400
    try:
        db.execute("INSERT INTO list_shares (list_id, owner_id, shared_with_id, permission) VALUES (?,?,?,?)",
                    (lid, uid(), user["id"], permission))
        db.commit()
    except sqlite3.IntegrityError:
        db.execute("UPDATE list_shares SET permission=? WHERE list_id=? AND shared_with_id=?",
                    (permission, lid, user["id"]))
        db.commit()
    return jsonify({"ok": True})

@app.route("/api/lists/<int:lid>/share", methods=["GET"])
@login_required
def get_shares(lid):
    db = get_db()
    rows = db.execute("""
        SELECT ls.*, u.username FROM list_shares ls
        JOIN users u ON u.id = ls.shared_with_id
        WHERE ls.list_id=? AND ls.owner_id=?
    """, (lid, uid())).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/lists/<int:lid>/share/<int:sid>", methods=["DELETE"])
@login_required
def remove_share(lid, sid):
    db = get_db()
    db.execute("DELETE FROM list_shares WHERE id=? AND list_id=? AND owner_id=?",
               (sid, lid, uid()))
    db.commit()
    return jsonify({"ok": True})

@app.route("/api/shared-lists", methods=["GET"])
@login_required
def get_shared_lists():
    db = get_db()
    rows = db.execute("""
        SELECT l.*, ls.permission, u.username as owner_name FROM list_shares ls
        JOIN lists l ON l.id = ls.list_id
        JOIN users u ON u.id = ls.owner_id
        WHERE ls.shared_with_id=?
    """, (uid(),)).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["item_count"] = db.execute(
            "SELECT COUNT(*) as c FROM list_items WHERE list_id=?", (r["id"],)
        ).fetchone()["c"]
        d["shared"] = True
        result.append(d)
    return jsonify(result)

# ── Templates ─────────────────────────────────────────────────────────────

@app.route("/api/templates", methods=["GET"])
@login_required
def get_templates():
    db = get_db()
    rows = db.execute("SELECT * FROM list_templates WHERE user_id=? ORDER BY created_at DESC",
                       (uid(),)).fetchall()
    return jsonify([dict(r) for r in rows])

@app.route("/api/lists/<int:lid>/save-template", methods=["POST"])
@login_required
def save_template(lid):
    db = get_db()
    if not _owns_list(db, lid):
        return jsonify({"error": "Not found"}), 404
    d = request.get_json(silent=True) or {}
    name = _san(d.get("name") or "")
    if not name:
        return jsonify({"error": "Template name required"}), 400
    lst = dict(db.execute("SELECT * FROM lists WHERE id=?", (lid,)).fetchone())
    items = [{"title": dict(r)["title"], "description": dict(r).get("description", ""),
              "priority": dict(r).get("priority", "medium")}
             for r in db.execute("SELECT * FROM list_items WHERE list_id=? ORDER BY sort_order",
                                  (lid,)).fetchall()]
    cur = db.execute("INSERT INTO list_templates (user_id, name, description, items_json) VALUES (?,?,?,?)",
                      (uid(), name, lst.get("description", ""), json.dumps(items)))
    db.commit()
    return jsonify({"ok": True, "id": cur.lastrowid}), 201

@app.route("/api/templates/<int:tid>/create-list", methods=["POST"])
@login_required
def create_from_template(tid):
    db = get_db()
    tmpl = db.execute("SELECT * FROM list_templates WHERE id=? AND user_id=?",
                       (tid, uid())).fetchone()
    if not tmpl:
        return jsonify({"error": "Template not found"}), 404
    d = request.get_json(silent=True) or {}
    name = _san(d.get("name") or tmpl["name"])
    cur = db.execute("INSERT INTO lists (user_id, name, description) VALUES (?,?,?)",
                      (uid(), name, tmpl["description"]))
    lid = cur.lastrowid
    items = json.loads(tmpl["items_json"])
    for idx, item in enumerate(items):
        db.execute(
            "INSERT INTO list_items (list_id,title,description,sort_order,priority) VALUES (?,?,?,?,?)",
            (lid, item["title"], item.get("description", ""), idx, item.get("priority", "medium")))
    db.commit()
    return jsonify({"ok": True, "id": lid}), 201

@app.route("/api/templates/<int:tid>", methods=["DELETE"])
@login_required
def delete_template(tid):
    db = get_db()
    db.execute("DELETE FROM list_templates WHERE id=? AND user_id=?", (tid, uid()))
    db.commit()
    return jsonify({"ok": True})

# ── Health Check ──────────────────────────────────────────────────────────

@app.route("/health")
def health_check():
    """Liveness/readiness probe for load balancers and orchestrators."""
    try:
        db = get_db()
        db.execute("SELECT 1").fetchone()
        return jsonify({"status": "healthy", "env": ENV}), 200
    except Exception as e:
        app.logger.error("Health check failed: %s", e)
        return jsonify({"status": "unhealthy", "error": str(e)}), 503

# ── Run (development only) ────────────────────────────────────────────────

if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 5000))
    debug = not IS_PROD
    app.logger.info("Starting dev server on port %d (debug=%s)", port, debug)
    print(f"\n  Productivity Framework Tracker → http://127.0.0.1:{port}\n")
    app.run(debug=debug, host="0.0.0.0", port=port)
