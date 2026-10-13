# Secure Tech Quiz Competition Platform (vyuham26)

A production-quality Secure Tech Quiz Competition Platform designed for technical college/company quizzes.

## Features

- **Secure Logical Sandbox**: Real-time tracking of `blur` and `visibilitychange` to prevent cheating.
- **Server-Authoritative Timing**: Timers run strictly on the backend.
- **Anti-Malpractice System**: Detects tab-switching and optionally forfeits questions.
- **Real-Time WebSockets**: Pub/sub system powered by Redis for live leaderboards and lobby synchronization.
- **Premium UI**: Built with Next.js, Tailwind CSS, and Framer Motion concepts for a modern look.

## Architecture

- **Frontend**: Next.js (App Router), React, Tailwind CSS
- **Backend**: Python, FastAPI, SQLAlchemy, Pydantic, WebSockets
- **Database**: Supabase PostgreSQL (Persistent storage)
- **Cache / Real-time**: Redis (Session locks, Pub/Sub)
- **Infrastructure**: Docker & Docker Compose

## Requirements

- Docker and Docker Compose
- Node.js 22+ (for local frontend development)
- Python 3.11+ (for local backend development)

## Quick Start (Docker)

1. Create your environment file:
```bash
cp .env.example .env
```

2. Start the services:
```bash
docker compose up --build -d
```

3. Initialize Database Migrations (Run inside the backend container):
```bash
docker compose exec backend alembic upgrade head
```

4. Load Demo Seed Data:
```bash
docker compose exec backend python -m app.seed
```

This creates an admin account (`admin` / `password123`) and a sample quiz (`DEMO26`).

## Accessing the Application

- **Frontend (Participants & Admin UI)**: `http://localhost:3000`
- **Backend API Docs**: `http://localhost:8000/docs`

## Security & Browser Limitations

> **Important**: A browser-based website cannot guarantee full OS lockdown.
We implement a **Logical Secure Sandbox**. It detects when users switch tabs or blur the window. In "Competition Mode", any departure from the active window forfeits the current question and records a high-severity violation. 

## Deployment

The provided `docker-compose.yml` runs Redis, FastAPI, and Next.js.
For production:
- Since you are using **Supabase**, update `DATABASE_URL` in `.env` to your Supabase Postgres connection string.
- Change `JWT_SECRET` in `.env`.
- Ensure `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` point to your public domain.
- Set `APP_ENV=production`.
- Use a Reverse Proxy (like Nginx or Caddy) to handle HTTPS and route `/api/*` to FastAPI.
