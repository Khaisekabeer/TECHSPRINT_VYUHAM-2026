# TechSprint · Vyuham '26

TechSprint is the live tech quiz of Vyuham '26.

A real-time multiplayer quiz for live events: participants are checked in at the entry by scanning their pass, answer on their phones, the coordinator conducts the game from a host console, and a projector shows questions and standings. Built and load-tested for 150+ concurrent players.

## Architecture

```
                        ┌──────────── Vercel ─────────────┐
 Phones, projector,     │  all pages (React build)        │      Supabase Postgres
 host console, admin ──►│  /api  admin API (serverless) ──┼───►  staff, registrations,
        │               └────────────┬────────────────────┘      encrypted questions,
        │                            │ Load into game             games, answers
        │ Socket.IO (wss)            │ (server-to-server,              ▲
        ▼                            ▼  GAME_LINK_SECRET)              │
 https://game.yourdomain.com ── Cloudflare Tunnel ── event-day laptop: npm run game
```

- **Vercel** hosts every page and the admin API (login, roles, participants, check-in, encrypted question bank, results) as serverless functions. Staff can work from anywhere, any time — e.g. the quiz master adds questions from home.
- **Live game** (timer, scoring, state) runs on the **event-day laptop** (`npm run game`, Socket.IO), published over HTTPS by **Cloudflare Tunnel**. The server is authoritative: it enforces the timer, scores answers, and never sends correct answers while a question is live. An admin sets its address in **Admin → Overview → Live game server**; every page connects there.
- **Supabase** stores everything persistent. Game writes happen in batches (game start, end of each question, podium), never on the answer path.
- **All-in-one mode** (`npm start`) still runs API + game + pages in one process — for development, or as a laptop-only fallback.

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
| **Admin** | Management | Import participants (MakeMyPass CSV), check-in dashboard, scan passes, manage staff, settings (game server address, *require check-in*), results CSV, host console. Everything except the question bank |
| **Quiz master** | Questions & answers | Encrypted question bank behind a **second PIN**: add/edit/reorder/hide questions per level, timers, points; **Load into game** |
| **Coordinator** | Conducts the live event | Host console (start, next question, reveal, kick, reset) and the live monitor |
| **Volunteer** | Monitors the live event | Pass check-in scanner and the read-only live monitor (who is online/disconnected, answers in) |

- **First sign-in:** on first start the server creates an admin `admin` whose password is `ADMIN_PASSWORD` from `backend/.env`. Sign in, create real accounts, then change or disable `admin`.

## Question bank encryption

Questions are only ever visible to quiz masters until they appear live on the projector.

- Each question's text, options and correct answer are stored **encrypted** (AES-256-GCM) in Supabase. The database, the Supabase dashboard, admins and coordinators only ever see ciphertext.
- The encryption key is never stored in the clear. It is wrapped for each quiz master with a key derived from their **PIN** plus the server secret `QUESTION_VAULT_SECRET`. Entering the PIN in **Admin → Questions** unlocks it for 30 minutes (*Lock now* ends it early). While unlocked, the key is kept with the session, sealed under the session token that only the quiz master's browser holds.
- **Load into game** (quiz master, game in the lobby) decrypts the active questions and sends them straight to the game server's memory. The coordinator then conducts the game; phones and the projector receive each question only when it goes live, and the answer only at the reveal. After a game-server restart the quiz master loads them again.
- **Several quiz masters:** whenever one quiz master unlocks, every other quiz master automatically receives their own copy of the key — no PIN sharing. A quiz master whose PIN is reset gets it again the same way.
- **Recovery code:** shown once when the bank is first encrypted (and on *New recovery code*). It is the only way back in if every quiz master's PIN is lost. Store it offline.
- **Back up `QUESTION_VAULT_SECRET`.** Without it (and with the database alone) the questions cannot be decrypted.
- `npm run seed` writes plaintext rows; they are encrypted automatically the next time a quiz master unlocks the bank. Keep real questions out of `seed_questions.json` and out of git.

## Check-in flow

1. **Admin** exports the attendee list from MakeMyPass (bookings) as CSV and uploads it in **Admin → Participants** (columns are auto-detected; re-importing updates details and never clears check-ins). Excel files: save as CSV first.
2. **Volunteer** opens **Admin → Check-in** on a phone, starts the camera and scans the QR code on the pass (it contains the ticket ID, e.g. `MMP49081761`). The participant's details appear; tap **Admit**. Unknown and already-admitted tickets are flagged. Manual ticket entry is always available.
3. **Participant** joins the quiz at `/` with the ticket ID from their pass. Only admitted tickets can play; one device per ticket (a player on a new phone can reclaim their seat if the old one disconnected).
4. Fallback: an admin can switch off **Require check-in to play** (Overview) so anyone joins with just a name.

The camera needs HTTPS — Vercel provides it. (In all-in-one LAN mode, `HTTPS=true npm start` serves a self-signed certificate instead.)

## Deployment

### Secrets

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Vercel + laptop | Supabase → Project Settings → API Keys |
| `QUESTION_VAULT_SECRET` | Vercel (+ laptop for all-in-one mode) | Decrypts the question bank with the quiz master's PIN. **Back it up.** |
| `GAME_LINK_SECRET` | Vercel + laptop (same value) | Authenticates *Load into game* from Vercel to the laptop |
| `ADMIN_PASSWORD` | first run only | Password of the bootstrap `admin` account |

Generate secrets with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Never commit `.env`.

### 1. Supabase
Run the files in [`supabase/migrations/`](supabase/migrations/) in order (SQL Editor).

### 2. Vercel (pages + admin API)
1. Import the GitHub repo into Vercel. Keep the **root directory** as the repo root — [`vercel.json`](vercel.json) builds `frontend/`, installs `backend/` for the API function and routes `/api/*` to [`api/index.js`](api/index.js).
2. Add the environment variables above (Production).
3. Deploy. Staff sign in at `https://<your-app>.vercel.app/admin`.

Functions run in Sydney (`syd1`, next to the Supabase database); change `regions` in `vercel.json` if you move the database.

### 3. Event-day laptop (live game) + Cloudflare Tunnel
One-time:
1. Free Cloudflare account; add your domain to Cloudflare (at GoDaddy, switch the domain's nameservers to the two Cloudflare gives you).
2. Install `cloudflared`, then:
   ```bash
   cloudflared tunnel login
   cloudflared tunnel create techsprint
   cloudflared tunnel route dns techsprint game.yourdomain.com
   ```
3. Copy [`backend/cloudflared.example.yml`](backend/cloudflared.example.yml) to `~/.cloudflared/config.yml` and fill in the tunnel ID and hostname.
4. On the laptop: `cd backend && npm install`, create `backend/.env` with the Supabase keys and the same `GAME_LINK_SECRET` as Vercel.
5. Admin → Overview → **Live game server**: enter `https://game.yourdomain.com` and save.

Event day (two terminals on the laptop):
```bash
cd backend && npm run game                # live game on :3001
cloudflared tunnel run techsprint         # publishes it at https://game.yourdomain.com
```
Admin → Overview should show the game server **Online**. Players, projector and host console are all opened from the Vercel address.

### All-in-one mode (development / fallback)
```bash
cd backend && npm run dev                 # API + live game on :3001
cd frontend && npm run dev -- --host      # UI on :5173
```
Leave the game server address empty. Test data: `npm run seed:test` in `backend/` adds 30 dummy tickets (`TEST0001`-`TEST0020` checked in, `TEST0021`-`TEST0030` not) and 10 test questions across the 3 rounds. For a laptop-only event without Vercel: `npm run build` in `frontend/`, then `HTTPS=true npm start` in `backend/` and open `https://<laptop-ip>:3001`. Docker: `docker compose up --build -d`.

## Questions & scoring

Each question has a level (1 Warm-up, 2 Core Tech, 3 Brain Burner), multiple-choice (2-4 options) or true/false, a timer (5-300 s) and base points. Hidden questions stay in the bank but are left out of the game.

Scoring: `points × level multiplier (1/2/3)`, scaled from 100% (instant) to 50% (last second), plus +200 for the first correct answer and +100 on a streak of 3+.

## Running the event

1. Laptop: `npm run game` + `cloudflared tunnel run techsprint`; Admin → Overview shows the game server **Online**.
2. Volunteers sign in at `/admin` on their phones and check people in at the entry.
3. Projector: open `/screen` on the Vercel address, press F11. Its QR code points players to the Vercel address.
4. Quiz master: `/admin` → Questions → enter PIN → **Load into game**.
5. Coordinator: `/admin` → Live event → **Open host console**.
6. Players scan the QR and join with their ticket ID while the game is in the lobby.
7. **Start game** → **Next question**. Each question ends automatically when its timer runs out. After the last question, **Show final results** shows the podium; every phone shows its rank.
8. Admin: Overview → **Download CSV** for the results.

### Day-of checklist
- [ ] Real staff accounts created; `admin` password changed or account disabled
- [ ] Participant CSV imported; a test pass scans and admits correctly
- [ ] Game server **Online** in Admin → Overview; laptop on power and won't sleep
- [ ] Quiz master can unlock the bank and **Load into game**; question count correct in the host console
- [ ] Recovery code, `QUESTION_VAULT_SECRET` and `GAME_LINK_SECRET` stored safely offline
- [ ] Venue internet works for players' phones (backup: mobile data / hotspot)
- [ ] Test with 2-3 phones before the crowd arrives
- [ ] Supabase project is active (free projects pause after a week of inactivity)

## Load test

```bash
cd backend
SERVER_URL=http://localhost:3001 node load-test.js 150
```

Runs against the all-in-one server. Runs the game as an admin/coordinator (`LOADTEST_USER` / `LOADTEST_PASSWORD`); set `LOADTEST_QM_USER` / `LOADTEST_QM_PASSWORD` / `LOADTEST_QM_PIN` to have a quiz master unlock and load the questions. Seeds checked-in `LTTEST…` tickets when check-in is required, plays a full game with 150 simulated players, checks rejoin and malformed input, and reports latency. It resets the server's current game and saves results to Supabase like a real game.

## Limitations

- The game server holds the live game in memory; if it restarts mid-game the in-progress game is lost (results saved so far remain in Supabase). Staff stay signed in across restarts.
- Every phone needs internet: pages come from Vercel and the game goes through Cloudflare. Quiz traffic is small, but the venue connection must be reliable.
- Vercel functions can't hold WebSockets, which is why the live game runs on the laptop (or any long-running server).
