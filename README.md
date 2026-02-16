# Productivity Framework Tracker

An open-source web application that helps you organize tasks using proven productivity frameworks. Create lists, add work items, and apply methodologies like the Eisenhower Matrix, Kanban, Timeboxing, and more — all from a single, clean interface.

---

## Why This Exists

Most to-do apps let you check things off a list. This one goes further by letting you **apply real productivity frameworks** to your tasks — so you can decide _what_ to work on, not just track _that_ you did it.

Whether you're a student, developer, freelancer, or team lead, this app gives you structured ways to prioritize, categorize, and time-manage your work — without needing a different tool for each method.

---

## Features

### Productivity Frameworks

Apply any of these frameworks to your lists and visually organize items within them:

| Framework             | Author                 | What It Does                                             |
| --------------------- | ---------------------- | -------------------------------------------------------- |
| **Eisenhower Matrix** | Dwight D. Eisenhower   | Sort tasks by urgency vs. importance into four quadrants |
| **Timeboxing**        | James Martin           | Assign fixed time limits to tasks to prevent scope creep |
| **Impact/Effort**     | Lean / Agile practices | Rank tasks by impact vs. effort to find quick wins       |
| **Kanban Board**      | Taiichi Ohno           | Track tasks through stages (To Do → In Progress → Done)  |
| **Stop Doing List**   | Jim Collins            | Identify commitments to drop instead of piling on more   |
| **80/20 (Pareto)**    | Vilfredo Pareto        | Focus on the 20% of inputs driving 80% of results        |

### Task Management

- **Lists & Items** — Create multiple lists, each with its own set of tasks
- **Priority Levels** — High / Medium / Low priority with visual indicators
- **Due Dates** — Set deadlines with overdue warnings
- **Tags** — Create custom color-coded tags and filter by them
- **Drag & Drop Reorder** — Rearrange items with drag-and-drop (touch supported)
- **Bulk Actions** — Select multiple items to delete or move between lists
- **Comments** — Add notes and comments to individual items
- **Search & Filter** — Filter items by text, priority, status, or tag in real time
- **Undo Delete** — Accidentally deleted something? Undo it instantly

### Collaboration & Sharing

- **Share Lists** — Share lists with other users (read-only or read-write)
- **Shared View** — Dedicated view for lists others have shared with you

### Templates

- **Save as Template** — Turn any list into a reusable template
- **Create from Template** — Spin up new lists from saved templates

### Import / Export

- **CSV Export** — Export any list to CSV
- **CSV Import** — Import items from a CSV file into a new list

### Dashboard

- **Overview Stats** — Total lists, items, completion rate, overdue count
- **Framework Usage** — See which frameworks you use most
- **Recent Items** — Quick access to your latest tasks

### User Experience

- **Dark / Light Theme** — Toggle between themes, preference is remembered
- **Mobile-First Design** — Fully responsive, works on phones and tablets
- **Progressive Web App** — Installable on mobile via the browser
- **Keyboard Shortcuts** — Navigate with `N` (new item), `Esc` (close modal), etc.

---

## Tech Stack

| Layer      | Technology                     |
| ---------- | ------------------------------ |
| Backend    | Python 3.10+, Flask 3.x        |
| Database   | SQLite (default) or PostgreSQL |
| Frontend   | Vanilla JavaScript, CSS        |
| Deployment | Docker, Gunicorn, Nginx        |

No frontend build step. No npm. No bundler. Just HTML, CSS, and JS served by Flask.

---

## Quick Start

### Run Locally

```bash
# 1. Clone the repo
git clone https://github.com/olawale1rty/productivity-tracker.git
cd productivity-tracker/app

# 2. Create a virtual environment
python -m venv venv
source venv/bin/activate   # Linux / macOS
# venv\Scripts\activate    # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. Start the dev server
python app.py
```

Open **http://localhost:5000**, register an account, and start organizing.

### Run with Docker

```bash
cp .env.example .env       # Edit .env and set a secret key
docker compose up -d --build
```

The app will be available at **http://localhost** (port 80 via Nginx).

---

## Project Structure

```
app/
├── app.py               # Flask backend (API + auth + DB)
├── wsgi.py              # WSGI entry point for production
├── gunicorn.conf.py     # Gunicorn configuration
├── requirements.txt     # Python dependencies
├── Dockerfile           # Container image
├── docker-compose.yml   # Postgres + App + Nginx stack
├── nginx.conf           # Reverse proxy configuration
├── fly.toml             # Fly.io deployment config
├── Procfile             # Heroku / Railway process file
├── .env.example         # Environment variable template
├── DEPLOYMENT.md        # Full deployment guide
├── templates/
│   └── index.html       # Single-page application HTML
└── static/
    ├── css/app.css      # Mobile-first stylesheet
    ├── js/app.js        # Frontend application logic
    ├── favicon.svg      # App icon
    ├── manifest.json    # PWA manifest
    └── sw.js            # Service worker
```

---

## Database

The app supports **both SQLite and PostgreSQL** out of the box:

- **SQLite** (default) — Zero config, perfect for local dev and single-server deployments. Data lives in a single `productivity.db` file.
- **PostgreSQL** — Set the `DATABASE_URL` environment variable and the app switches automatically. Used by the Docker Compose stack.

No migration tool needed — the app auto-creates all tables on first run.

---

## Environment Variables

| Variable           | Default             | Description                                    |
| ------------------ | ------------------- | ---------------------------------------------- |
| `FLASK_ENV`        | `development`       | `production` enables Waitress/Gunicorn         |
| `FLASK_SECRET_KEY` | auto-generated      | Session encryption key (set in prod!)          |
| `DATABASE_URL`     | _(unset)_           | PostgreSQL connection string                   |
| `DATABASE_PATH`    | `./productivity.db` | SQLite file path (used when no `DATABASE_URL`) |
| `PORT`             | `8000`              | HTTP port                                      |
| `LOG_DIR`          | `./logs`            | Directory for rotating log files               |
| `LOG_LEVEL`        | `INFO`              | `DEBUG` / `INFO` / `WARNING` / `ERROR`         |

See [.env.example](app/.env.example) for the full template.

---

## Deployment

For detailed deployment instructions — Docker Compose, Fly.io, Railway, Render, Heroku, VPS, and more — see [DEPLOYMENT.md](app/DEPLOYMENT.md).

---

## API Overview

All endpoints are under `/api/` and return JSON. Authentication is session-based.

| Area          | Endpoints                                                            |
| ------------- | -------------------------------------------------------------------- |
| Auth          | `POST /api/register`, `/api/login`, `/api/logout`, `GET /api/me`     |
| Lists         | `GET/POST /api/lists`, `PUT/DELETE /api/lists/:id`                   |
| Items         | `CRUD /api/lists/:id/items`, toggle, reorder, bulk ops               |
| Frameworks    | `GET /api/frameworks-catalog`, attach/detach per list, per-item data |
| Tags          | `GET/POST /api/tags`, `DELETE /api/tags/:id`, assign/remove on items |
| Comments      | `GET/POST /api/items/:id/comments`, `DELETE /api/comments/:id`       |
| Sharing       | `POST/GET/DELETE /api/lists/:id/share`, `GET /api/shared-lists`      |
| Templates     | `GET /api/templates`, save from list, create list from template      |
| Import/Export | `GET /api/lists/:id/export`, `POST /api/lists/import`                |
| Dashboard     | `GET /api/dashboard`                                                 |
| Health        | `GET /health`                                                        |

---

## Contributing

Contributions are welcome! Here's how to get started:

1. **Fork** the repository
2. **Create a branch** for your feature or fix: `git checkout -b feat/my-feature`
3. **Make your changes** and test locally
4. **Submit a pull request** with a clear description

### Ideas for Contributions

- New productivity frameworks (Pomodoro, GTD, RICE scoring, etc.)
- Calendar / timeline view for due dates
- Recurring tasks
- Notifications and reminders
- Mobile app wrapper (Capacitor / Tauri)
- Localization / i18n support
- REST API documentation (OpenAPI / Swagger)

---

## License

This project is open source. See the [LICENSE](LICENSE) file for details.

---

## Acknowledgments

Built with [Flask](https://flask.palletsprojects.com/) and inspired by the productivity methodologies of Eisenhower, Taiichi Ohno, Jim Collins, Vilfredo Pareto, and others who showed that _how_ you organize work matters as much as _doing_ the work.
