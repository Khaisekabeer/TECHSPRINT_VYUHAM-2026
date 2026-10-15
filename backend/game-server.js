// Event-day live game server (Socket.IO only). Runs on a laptop on the venue network and is
// published over HTTPS with Cloudflare Tunnel, e.g. https://game.example.com → http://localhost:3001.
// All pages and the admin API run on Vercel; they reach this server at the "Game server address"
// set in Admin → Overview.
//
//   npm run game
//   cloudflared tunnel run techsprint
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');
const store = require('./store');
const createGame = require('./game');
const { LINK_HEADER, linkSecret } = require('./remoteGame');
const { createHttpServer, lanAddresses, scheme } = require('./serve');

const PORT = Number(process.env.GAME_PORT || process.env.PORT) || 3001;

const app = express();
app.disable('x-powered-by');
app.use(cors());
const server = createHttpServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] }, maxHttpBufferSize: 16 * 1024 });
const game = createGame(io, { serverInfo: () => ({ lanAddresses: [], port: null }) });

app.get('/', (req, res) => res.type('text').send('TechSprint live game server is running.'));
app.get('/health', (req, res) => res.json({ ok: true, state: game.status().state, ...game.publicConfig() }));

// ─── Internal endpoints, called only by the admin API (shared secret) ──────────
const internal = express.Router();
internal.use(express.json({ limit: '1mb' }));
internal.use((req, res, next) => {
  let expected;
  try { expected = linkSecret(); } catch { return res.status(503).json({ error: 'GAME_LINK_SECRET is not set on the game server' }); }
  const given = String(req.get(LINK_HEADER) || '');
  const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return res.status(401).json({ error: 'Not authorised' });
  next();
});

internal.get('/status', (req, res) => res.json(game.status()));

// Decrypted questions from the quiz master's "Load into game" (sent by the admin API).
internal.post('/questions', (req, res) => {
  const { questions, by } = req.body || {};
  const valid = Array.isArray(questions) && questions.every(q =>
    q && typeof q.text === 'string' && Array.isArray(q.options) && typeof q.correctAnswer === 'string' && [1, 2, 3].includes(q.level));
  if (!valid) return res.status(400).json({ error: 'Invalid question list' });
  const result = game.loadQuestions(questions, typeof by === 'string' ? by.slice(0, 60) : 'Quiz master');
  res.status(result.error ? 409 : 200).json(result);
});

internal.post('/settings', (req, res) => {
  game.applySettings(req.body || {});
  res.json({ success: true });
});

app.use('/internal', internal);

server.listen(PORT, '0.0.0.0', async () => {
  await game.refreshSettings();
  try { linkSecret(); } catch (err) { console.error(err.message); }
  store.getSettings()
    .then(s => console.log(`Admin "game server address" is currently: ${s.game_server_url || '(not set)'}`))
    .catch(() => {});
  console.log(`Live game server on ${scheme}://0.0.0.0:${PORT}  (check-in required to play: ${game.settings.requireCheckin})`);
  for (const ip of lanAddresses()) console.log(`  Network: ${scheme}://${ip}:${PORT}`);
  console.log('Publish it with: cloudflared tunnel run <tunnel-name>');
});

process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received - saving pending results...`);
    await game.shutdown();
    process.exit(0);
  });
}
