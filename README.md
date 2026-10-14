# Vyuham '26 TechQuiz

A real-time multiplayer quiz for live events: players answer on their phones, the quiz master runs the game from a host console, and a projector shows questions and standings. Built and load-tested for 150+ concurrent players.

## Architecture

```
Phones / Host console / Projector  â”€â”€WebSocket (Socket.IO)â”€â”€â–º  Node.js server  â”€â”€â–º  Supabase Postgres
        React (Vite)                                           game runs in memory     questions, games,
                                                               serves the React build  participants, answers
```

- **Live game** (timer, scoring, state) runs in memory on one Node.js + Socket.IO server. The server is authoritative: it enforces the timer, scores answers, and never sends correct answers while a question is live.
- **Supabase** stores the question bank and every game's participants, answers, scores and final ranks. Writes happen in batches (game start, end of each question, podium), never on the answer path, so database latency cannot slow the game.
- In production the same Node server serves the built React app, so there is **one thing to deploy**.

| Path | Who | Purpose |
|---|---|---|
| `/` | Players | Join with a name, answer on the phone |
| `/host` | Quiz master | Password-protected game controls |
| `/screen` | Projector | Join instructions, questions, standings, podium |

## Setup

Requires Node.js 22+ and a Supabase project.

1. **Database** - in the Supabase SQL Editor, run [`supabase/migrations/20261014000000_init_quiz_schema.sql`](supabase/migrations/20261014000000_init_quiz_schema.sql).
2. **Config** - copy `backend/.env.example` to `backend/.env` and fill in `SUPABASE_URL`, `SUPABASE_SECRET_KEY` (Project Settings -> API Keys) and a strong `ADMIN_PASSWORD`. Never commit `.env`.
3. **Install and seed questions**
   ```bash
   cd backend && npm install
   npm run seed            # imports ../seed_questions.json (replaces the question bank)
   cd ../frontend && npm install
   ```

### Development

```bash
cd backend && npm run dev      # API + WebSocket on :3001
cd frontend && npm run dev -- --host   # UI on :5173
```

Open `http://<laptop-ip>:5173/`, `/host`, `/screen`.

### Production (single server)

```bash
cd frontend && npm run build
cd ../backend && npm start                 # serves everything on :3001
```

Or with Docker: `docker compose up --build -d` (reads `backend/.env`).

## Questions

Edit `seed_questions.json` and run `npm run seed`, or edit the `questions` table in the Supabase dashboard and press **Reload Questions** in the host console. Fields: `level` (1-3), `text`, `type` (`mcq` or `tf`), `options`, `correctAnswer` (must match one option exactly), `timeLimit` (seconds), `points`.

Scoring: `points x level multiplier (1/2/3)`, scaled from 100% (instant) to 50% (last second), plus +200 for the first correct answer and +100 on a streak of 3+.

## Running the event

1. Start the server and note the **Network** address it prints.
2. Projector: open `http://<network-ip>:<port>/screen` (use the network address, not `localhost`, so the join address shown is correct). Press F11.
3. Host: open `/host` on another device or tab and sign in.
4. Players join at the address on the projector, in the lobby, before the game starts.
5. **Start Game** -> **Next Question**. Each question ends automatically when its timer runs out (or press **End Question**). Level changes show an intro screen. After the last question, **Show Final Results** shows the podium; every phone shows its final rank.

Players who refresh or lose Wi-Fi rejoin automatically with their score. The host can kick players; **Reset** clears the game.

### Day-of checklist
- [ ] `ADMIN_PASSWORD` changed from the default
- [ ] Questions seeded and checked (Reload Questions shows the right count)
- [ ] Laptop on power, on the same Wi-Fi as players (or the server is deployed)
- [ ] Test with 2-3 phones on the venue Wi-Fi before the crowd arrives
- [ ] Supabase project is active (free projects pause after a week of inactivity)

## Load test

```bash
cd backend
SERVER_URL=http://localhost:3001 node load-test.js 150
```

Plays a full game with 150 simulated players, checks rejoin and malformed-input handling, and reports answer latency. It resets the server's current game and saves its results to Supabase like a real game.

## Limitations

- One server process holds the live game; if it restarts mid-game the in-progress game is lost (results saved so far remain in Supabase).
- WebSocket hosting needs a long-running server (Render, Railway, a VPS, or a laptop); serverless functions such as Vercel's cannot host it.
