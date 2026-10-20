# TechSprint · Vyuham '26

TechSprint is the live tech quiz of Vyuham '26.

A real-time multiplayer quiz for live events: participants are checked in at the entry by scanning their pass, answer on their phones, the coordinator conducts the game from a host console, and a projector shows questions and standings. Built and load-tested for 150+ concurrent players.

## Architecture

```
                        ┌──────────── Vercel ─────────────┐
 Phones, projector,     │  all pages (React build)        │      Supabase Postgres
 host console, admin ──►│  /api  admin API (serverless) ──┼───►  staff, registrations,
        │               └────────────┬────────────────────┘      encrypted questions,
        │                            │ Load set (with its PIN)    games, answers
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
| **Admin** | Management | Import participants (MakeMyPass CSV), check-in dashboard, scan passes, manage staff, settings (game server address, *require check-in*), results CSV, host console. Can't read question sets (only load one with its PIN) |
| **Quiz master** | Questions & answers | **Question sets** (e.g. Main set, Trial set), each encrypted with its own PIN chosen by the quiz master: levels, questions, pictures, timers, points, themes; gives the coordinator the PIN of the set to play |
| **Coordinator** | Conducts the live event | Host console: **loads a question set with its PIN**, then start, next question, reveal, disqualify, reset; live monitor |
| **Volunteer** | Monitors the live event | Pass check-in scanner and the read-only live monitor (who is online/disconnected, answers in) |

- **First sign-in:** on first start the server creates an admin `admin` whose password is `ADMIN_PASSWORD` from `backend/.env`. Sign in, create real accounts, then change or disable `admin`.

## Question sets & PINs

Questions are only ever visible to quiz masters until they appear live on the projector.

- **Sets:** questions live in **question sets** — e.g. *Main set* (the real event) and *Trial set* (a practice round). Each set has its own levels, questions, **PIN** and **recovery code**. The PIN belongs to the set, not to an account.
- **Quiz master:** creates a set (Admin → Questions → *+ New question set*), names it and chooses its PIN (4–12 digits). Opening a set with its PIN unlocks it for editing for 30 minutes (*Lock · switch set* ends it early). From the open set they can rename it, **change the PIN**, make a **new recovery code**, or delete it.
- **Coordinator:** loads the set to play from the **host console** (lobby → *Question set*): pick the set, enter the PIN the quiz master gave them, *Load set*. They never see the questions — they go straight to the game server's memory and reach phones/projector one at a time (answers only at the reveal). After a game-server restart, load the set again. A quiz master can also load the set they have open, to test it.
- **Encryption:** each question's text, options, answer and picture is encrypted (AES-256-GCM) with the set's key. The key is stored only sealed with a key derived from the **set PIN plus the server secret** `QUESTION_VAULT_SECRET`, so a copy of the database can't be brute-forced, and admins can't read questions. Wrong PINs are limited (5 per person per 5 minutes, 30 per set per 15 minutes).
- **Forgot a set's PIN:** *Forgot PIN* on the set → enter that set's recovery code → choose a new PIN. Without the PIN or the recovery code, the set can't be opened by anyone.
- **Moving the old question bank:** questions written before sets existed are in *Trial set*, which needs a PIN once: a quiz master clicks *Set up*, enters their **old quiz master PIN** (or the old recovery code) and chooses the new set PIN.
- **Back up `QUESTION_VAULT_SECRET`** (backend `.env` and Vercel). Without it, no set can be decrypted, even with the right PIN.
- `npm run seed` / `npm run seed:test` add plaintext questions to a set (default *Trial set*); they're encrypted the next time a quiz master opens it. Keep real questions out of `seed_questions.json` and out of git.

## Check-in flow

1. **Admin** exports the attendee list from MakeMyPass (bookings) as CSV and uploads it in **Admin → Participants** (columns are auto-detected; re-importing updates details and never clears check-ins). Excel files: save as CSV first.
2. **Volunteer** opens **Admin → Check-in** on a phone, starts the camera and scans the QR code on the pass (it contains the ticket ID, e.g. `MMP49081761`). The participant's details appear; tap **Admit**. Unknown and already-admitted tickets are flagged. Manual ticket entry is always available.
3. **Participant** joins the quiz at `/` with the ticket ID from their pass. Only admitted tickets can play; one device per ticket. A player on a new phone can take their seat back if the old one disconnected, by entering the last 4 digits of the phone number they registered with. Repeated wrong ticket IDs or digits are throttled.
4. Fallback: an admin can switch off **Require check-in to play** (Overview) so anyone joins with just a name.

The camera needs HTTPS — Vercel provides it. (In all-in-one LAN mode, `HTTPS=true npm start` serves a self-signed certificate instead.)

## Deployment

### Secrets

| Variable | Where | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Vercel + laptop | Supabase → Project Settings → API Keys |
| `QUESTION_VAULT_SECRET` | Vercel (+ laptop for all-in-one mode) | Decrypts the question bank with the quiz master's PIN. **Back it up.** |
| `GAME_LINK_SECRET` | Vercel + laptop (same value) | Authenticates loading a question set from Vercel to the laptop |
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

**Levels** are set up by the quiz master in Admin → Questions: add as many as needed, name them, and give each a points multiplier (default: 1 Warm-up ×1, 2 Core Tech ×2, 3 Brain Burner ×3). They are played in tab order, each opening with an intro on the projector; empty levels are skipped. A level can be deleted once it has no questions.

**Looks:** the projector and phones use comic game themes — **Blast** (yellow sunburst), **Pop** (yellow & pink pop art), **Arcade** (lime burst), **Circuit** (blue tech windows) and **Classic** (plain white). Each level can have its own (level settings → "Look on screen"); left on *Automatic*, every round gets the next theme. The lobby and podium use Blast, with the Vyuham logo throughout.

**Standings** on the projector show everyone still in, and the layout follows the size of the field: a dense grid for a crowd (80 players → 8 × 10 tiles), rows for 11–30, big character cards for the final 10. Before a cut, players below it are marked at risk; phones show each player's rank ("#12 of 80") and whether they're inside the cut.

**Avatars:** players pick a character (cartoon person or robot) when they join; it appears on the projector, podium, host console and live monitor. Drawn in the browser (DiceBear Avataaars and Bottts, free for commercial use).

**Picture questions** ("identify this person / object"): add a picture in the question editor. It is resized in the browser, stored encrypted with the question key, and served by the live game server only once that question is live — on the projector (large, next to the options) and on phones.

Each question belongs to a level and is multiple-choice (2-4 options) or true/false, a timer (5-300 s) and base points. Hidden questions stay in the bank but are left out of the game.

Scoring: `points × level multiplier`, scaled from 100% (instant) to 50% (last second), plus +200 for the first correct answer and +100 on a streak of 3+. Standings: higher score first; on a tie, less total answer time (a skipped question counts as its full timer, so skipping never helps).

## Eliminations & disqualification

- **Cut after a level:** set **Top N advance** on a level (Admin → Questions → level settings). When that level's last question ends, everyone below the top N is eliminated (ties go to the faster player). The projector shows "Top N advance · M eliminated", eliminated phones show their rank and score and can keep watching, but can no longer answer. Leave it empty for no cut; the final level never cuts.
- **Disqualify:** once the game has started, the host console's **DQ** button removes a player with a reason (e.g. "Using a second phone"). Their answer to the live question is discarded and they get no final rank. (In the lobby, **Kick** simply removes a player.)
- **Where it's stored:** players stay in `participants` with `status` = `active` / `eliminated` / `disqualified` (their answers and log must survive), and every exit gets a row in `eliminations`: round, level, reason, note, rank and score at exit, and the staff member for disqualifications.
- **Final ranking:** finalists by score, then the eliminated (later rounds first, then by score), then the disqualified with no rank. The results CSV includes status, round and reason.

## Activity log & malpractice

Every candidate's actions are logged in `participant_events` (written in batches, a few thousand rows per game): join, failed join attempts (unknown ticket, not checked in, wrong phone digits), seat moved to a new device, reconnects, disconnects, every answer (option, correct, time, points), rejected answers (late, duplicate, after elimination), **leaving the quiz screen during a question** and for how long, elimination and disqualification. Admin → Overview → **Activity log** downloads it as a CSV for any game. IP addresses are logged for joins and reconnects; keep the log only as long as needed.

Precautions against malpractice:

| Risk | Protection |
|---|---|
| Seeing questions early | Encrypted bank, visible only to quiz masters; questions reach phones only when they go live |
| Peeking at a neighbour's result | The correct answer and right/wrong are sent only at the reveal |
| Answering late or twice, changing answers | The server keeps the time (1 s grace for latency) and accepts one answer per question |
| Someone else playing for you | Check-in at the entry by pass; one device per ticket; moving to another device needs the last 4 digits of the registered phone |
| Guessing ticket IDs | Throttled after 8 wrong attempts per connection (60 per IP in 10 minutes) |
| Looking up answers on the same phone | Short timers and speed scoring; leaving the quiz screen is flagged to staff (count and seconds away) |
| Scripted / bot answering | Very fast correct answers (< 1.5 s on 10 s+ questions) are flagged |
| Tampered messages | The server validates every message; options must match the question; eliminated or disqualified players can't answer |

Flags appear in the host console and the volunteers' **Live monitor** ("to watch"), sorted to the top. They are hints, not proof (a notification can hide the page for a moment): an invigilator checks in person and the host decides whether to disqualify. Copying from a neighbour can't be detected by software; seating and invigilators handle that.

## Running the event

1. Laptop: `npm run game` + `cloudflared tunnel run techsprint`; Admin → Overview shows the game server **Online**.
2. Volunteers sign in at `/admin` on their phones and check people in at the entry.
3. Projector: open `/screen` on the Vercel address, press F11. Its QR code points players to the Vercel address.
4. Coordinator: host console → *Question set* → pick the set (e.g. Trial set for a practice round, then Main set) → enter its PIN from the quiz master → **Load set**.
5. Coordinator: `/admin` → Live event → **Open host console**.
6. Players scan the QR and join with their ticket ID while the game is in the lobby.
7. **Start game** → **Next question**. Each question ends automatically when its timer runs out. After the last question, **Show final results** shows the podium; every phone shows its rank.
8. Admin: Overview → **Download CSV** for the results (the latest finished game by default; earlier, reset or test games can be picked from the list).

### Day-of checklist
- [ ] Real staff accounts created; `admin` password changed or account disabled
- [ ] Participant CSV imported; a test pass scans and admits correctly
- [ ] Game server **Online** in Admin → Overview; laptop on power and won't sleep
- [ ] Every set has a PIN; the coordinator has the PIN of the set to play and can **Load set**; question count correct in the host console
- [ ] Each set's recovery code, `QUESTION_VAULT_SECRET` and `GAME_LINK_SECRET` stored safely offline
- [ ] Venue internet works for players' phones (backup: mobile data / hotspot)
- [ ] Test with 2-3 phones before the crowd arrives
- [ ] Supabase project is active (free projects pause after a week of inactivity)

## Event simulation

Rehearse the event with bot players that behave like a real crowd: different speeds and accuracy, a few who skip questions, late joiners and phones that drop and reconnect. The quiz master loads the questions first.

```bash
cd backend
npm run simulate                                # 40 bots join; you conduct from /host and watch /screen
node simulate-event.js --players=100            # more bots
SIM_USER=... SIM_PASSWORD=... node simulate-event.js --auto   # the script conducts the whole game
```

- With check-in required, the bots use tickets `SIM0001…`, added as checked in (remove them in the Supabase dashboard afterwards).
- Bots answer the test questions from `npm run seed:test` correctly according to their skill; other questions at random.
- Bots rejoin after a game reset, so you can run several rounds. Event-day server: `--server=https://game.yourdomain.com`.
- `--auto` options: `--lobby=10`, `--intro=4`, `--reveal=6` (seconds). Results are saved to Supabase like a real game.

## Load test

```bash
cd backend
SERVER_URL=http://localhost:3001 node load-test.js 150
```

Runs against the all-in-one server. Runs the game as an admin/coordinator (`LOADTEST_USER` / `LOADTEST_PASSWORD`); set `LOADTEST_SET` / `LOADTEST_SET_PIN` (a set name and its PIN) to have it load that set, like the coordinator. Seeds checked-in `LTTEST…` tickets when check-in is required, plays a full game with 150 simulated players, checks rejoin and malformed input, and reports latency. It resets the server's current game and saves results to Supabase like a real game.

## Limitations

- The game server holds the live game in memory; if it restarts mid-game the in-progress game is lost (results saved so far remain in Supabase). Staff stay signed in across restarts.
- Every phone needs internet: pages come from Vercel and the game goes through Cloudflare. Quiz traffic is small, but the venue connection must be reliable.
- Vercel functions can't hold WebSockets, which is why the live game runs on the laptop (or any long-running server).
