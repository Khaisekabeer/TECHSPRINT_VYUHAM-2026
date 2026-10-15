# TechSprint · Vyuham '26

TechSprint is the live tech quiz of Vyuham '26.

A real-time multiplayer quiz for live events: participants are checked in at the entry by scanning their pass, answer on their phones, the coordinator conducts the game from a host console, and a projector shows questions and standings. Built and load-tested for 150+ concurrent players.

## Architecture

```
Phones / Host console / Projector  ──WebSocket (Socket.IO)──►  Node.js server  ──►  Supabase Postgres
Admin panel (staff)                ──REST /api────────────►   game runs in memory     questions, games, players,
        React (Vite)                                           serves the React build  answers, staff, registrations
```

- **Live game** (timer, scoring, state) runs in memory on one Node.js + Socket.IO server. The server is authoritative: it enforces the timer, scores answers, and never sends correct answers while a question is live.
- **Supabase** stores the question bank, staff accounts, registrations and check-ins, and every game's players, answers, scores and final ranks. Game writes happen in batches (game start, end of each question, podium), never on the answer path.
- In production the same Node server serves the built React app, so there is **one thing to deploy**.

| Path | Who | Purpose |
|---|---|---|
| `/` | Players | Join with the ticket ID on their pass, answer on the phone |
| `/admin` | Staff | Role-based admin panel (see below) |
| `/host` | Coordinator, admin | Conducts the live event |
| `/screen` | Projector | Join QR code, questions, standings, podium |

## Staff roles

Every staff member has their own login (username or email), created by an admin in **Admin → Staff**.

| Role | Responsibility | Can do |
|---|---|---|
| **Admin** | Management | Import participants (MakeMyPass CSV), check-in dashboard, scan passes, manage staff, *require check-in* switch, results CSV, host console. Everything except the question bank |
| **Quiz master** | Questions & answers | Encrypted question bank behind a **second PIN**: add/edit/reorder/hide questions per level, timers, points; **Load into game** |
| **Coordinator** | Conducts the live event | Host console (start, next question, reveal, kick, reset) and the live monitor |
| **Volunteer** | Monitors the live event | Pass check-in scanner and the read-only live monitor (who is online/disconnected, answers in) |

- **First sign-in:** on first start the server creates an admin `admin` whose password is `ADMIN_PASSWORD` from `backend/.env`. Sign in, create real accounts, then change or disable `admin`.

## Question bank encryption

Questions are only ever visible to quiz masters until they appear live on the projector.

- Each question's text, options and correct answer are stored **encrypted** (AES-256-GCM) in Supabase. The database, the Supabase dashboard, admins and coordinators only ever see ciphertext.
- The encryption key is never stored in the clear. It is wrapped for each quiz master with a key derived from their **PIN** plus the server secret `QUESTION_VAULT_SECRET`. Entering the PIN in **Admin → Questions** unlocks the key in server memory for 30 minutes (*Lock now* ends it early).
- **Load into game** (quiz master, game in the lobby) decrypts the active questions into the game server's memory. The coordinator then conducts the game; phones and the projector receive each question only when it goes live, and the answer only at the reveal. After a server restart the quiz master loads them again.
- **Several quiz masters:** whenever one quiz master unlocks, every other quiz master automatically receives their own copy of the key — no PIN sharing. A quiz master whose PIN is reset gets it again the same way.
- **Recovery code:** shown once when the bank is first encrypted (and on *New recovery code*). It is the only way back in if every quiz master's PIN is lost. Store it offline.
- **Back up `QUESTION_VAULT_SECRET`.** Without it (and with the database alone) the questions cannot be decrypted.
- `npm run seed` writes plaintext rows; they are encrypted automatically the next time a quiz master unlocks the bank. Keep real questions out of `seed_questions.json` and out of git.

## Check-in flow

1. **Admin** exports the attendee list from MakeMyPass (bookings) as CSV and uploads it in **Admin → Participants** (columns are auto-detected; re-importing updates details and never clears check-ins). Excel files: save as CSV first.
2. **Volunteer** opens **Admin → Check-in** on a phone, starts the camera and scans the QR code on the pass (it contains the ticket ID, e.g. `MMP49081761`). The participant's details appear; tap **Admit**. Unknown and already-admitted tickets are flagged. Manual ticket entry is always available.
3. **Participant** joins the quiz at `/` with the ticket ID from their pass. Only admitted tickets can play; one device per ticket (a player on a new phone can reclaim their seat if the old one disconnected).
4. Fallback: an admin can switch off **Require check-in to play** (Overview) so anyone joins with just a name.

**Camera needs HTTPS.** Phone browsers only allow the camera on secure pages. Start the server with `HTTPS=true` (production build): it generates a self-signed certificate for the laptop's addresses in `backend/certs/`. Volunteers open `https://<laptop-ip>:3001/admin` and accept the certificate warning once. Without HTTPS, volunteers can still type ticket IDs.

## Setup

Requires Node.js 22+ and a Supabase project.

1. **Database** - in the Supabase SQL Editor, run the files in [`supabase/migrations/`](supabase/migrations/) in order.
2. **Config** - copy `backend/.env.example` to `backend/.env` and fill in `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (Project Settings -> API Keys) and a strong `ADMIN_PASSWORD`. Never commit `.env`.
3. **Install**
   ```bash
   cd backend && npm install
   cd ../frontend && npm install
   ```
4. **Questions** - the quiz master adds them in **Admin → Questions**, or import a file with `npm run seed` in `backend/` (replaces the bank with `../seed_questions.json`).

### Development

```bash
cd backend && npm run dev      # API + WebSocket on :3001
cd frontend && npm run dev -- --host   # UI on :5173
```

Open `http://<laptop-ip>:5173/`, `/admin`, `/host`, `/screen`. (The scanner camera works on `localhost` in development.)

### Production (single server)

```bash
cd frontend && npm run build
cd ../backend && npm start                 # serves everything on :3001
HTTPS=true npm start                       # same, over HTTPS (needed for phone cameras)
```

Or with Docker: `docker compose up --build -d` (reads `backend/.env`).

## Questions & scoring

Each question has a level (1 Warm-up, 2 Core Tech, 3 Brain Burner), multiple-choice (2-4 options) or true/false, a timer (5-300 s) and base points. Hidden questions stay in the bank but are left out of the game. Changes made while the game is in the lobby are picked up immediately.

Scoring: `points × level multiplier (1/2/3)`, scaled from 100% (instant) to 50% (last second), plus +200 for the first correct answer and +100 on a streak of 3+.

## Running the event

1. Start the server (`HTTPS=true npm start`) and note the **Network** address it prints.
2. Volunteers sign in at `/admin` on their phones and check people in at the entry.
3. Projector: open `/screen` via the network address (not `localhost`) so the join QR code is correct. Press F11.
4. Quiz master: `/admin` → Questions → enter PIN → **Load into game**. Coordinator: `/admin` → Live event → **Open host console**.
5. Players scan the QR on the projector and join with their ticket ID while the game is in the lobby.
6. **Start game** → **Next question**. Each question ends automatically when its timer runs out. After the last question, **Show final results** shows the podium; every phone shows its rank.
7. Admin: Overview → **Download CSV** for the results.

### Day-of checklist
- [ ] Real staff accounts created; `admin` password changed or account disabled
- [ ] Participant CSV imported; a test pass scans and admits correctly over HTTPS
- [ ] Quiz master can unlock the bank with their PIN and **Load into game**; question count correct in the host console
- [ ] Recovery code and `QUESTION_VAULT_SECRET` stored safely offline
- [ ] Laptop on power, on the same Wi-Fi as players (or the server is deployed)
- [ ] Test with 2-3 phones on the venue Wi-Fi before the crowd arrives
- [ ] Supabase project is active (free projects pause after a week of inactivity)

## Load test

```bash
cd backend
SERVER_URL=http://localhost:3001 node load-test.js 150
```

Runs the game as an admin/coordinator (`LOADTEST_USER` / `LOADTEST_PASSWORD`); set `LOADTEST_QM_USER` / `LOADTEST_QM_PASSWORD` / `LOADTEST_QM_PIN` to have a quiz master unlock and load the questions, seeds checked-in `LTTEST…` tickets when check-in is required, plays a full game with 150 simulated players, checks rejoin and malformed input, and reports latency. It resets the server's current game and saves results to Supabase like a real game.

## Limitations

- One server process holds the live game; if it restarts mid-game the in-progress game is lost (results saved so far remain in Supabase). Staff stay signed in across restarts.
- WebSocket hosting needs a long-running server (Render, Railway, a VPS, or a laptop); serverless functions such as Vercel's cannot host it.
