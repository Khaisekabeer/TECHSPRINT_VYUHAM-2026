// All-in-one server: admin API + live game + built frontend in one process.
// Used for development and as a laptop-only fallback. For the split deployment (UI + API on
// Vercel, game on a laptop behind Cloudflare Tunnel) see api/index.js and game-server.js.
require('dotenv').config({ quiet: true });
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const store = require('./store');
const auth = require('./auth');
const createGame = require('./game');
const { createApp, localHooks } = require('./app');
const { createHttpServer, lanAddresses, scheme } = require('./serve');

const PORT = Number(process.env.PORT) || 3001;

const handler = express();
const server = createHttpServer(handler);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] }, maxHttpBufferSize: 16 * 1024 });
const game = createGame(io, { serverInfo: () => ({ lanAddresses: lanAddresses(), port: PORT }) });

handler.use(createApp(localHooks(game)));

// Frontend (production build) with SPA fallback for React Router (/host, /screen, ...).
const distDir = path.join(__dirname, '../frontend/dist');
handler.use(express.static(distDir));
handler.use((req, res) => {
  const index = path.join(distDir, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send('Frontend not built. Run "npm run build" in frontend/, or use the Vite dev server on port 5173.');
});

server.listen(PORT, '0.0.0.0', async () => {
  try {
    await auth.ensureBootstrapAdmin();
    await game.refreshSettings();
    store.deleteExpiredSessions().catch(() => {});
  } catch (err) {
    console.error(`Staff/settings setup failed: ${err.message}`);
  }
  if (!process.env.QUESTION_VAULT_SECRET) console.error('QUESTION_VAULT_SECRET is not set - the question bank cannot be unlocked');
  console.log(`Server running on ${scheme}://0.0.0.0:${PORT}  (check-in required to play: ${game.settings.requireCheckin})`);
  for (const ip of lanAddresses()) console.log(`  Network: ${scheme}://${ip}:${PORT}`);
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
