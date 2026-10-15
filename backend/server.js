require('dotenv').config({ quiet: true });
const express = require('express');
const http = require('http');
const https = require('https');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./db');
const store = require('./store');
const auth = require('./auth');
const createApi = require('./api');
const questionKeys = require('./questionKeys');
const gameEngine = require('./gameEngine');
const { ANSWER_GRACE_MS } = gameEngine;

// ─── Network info for the join screen ─────────────────────────────────────────
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

// HTTPS=true serves over TLS so phone cameras work for pass scanning (browsers only allow the
// camera on secure pages). Uses certs/key.pem + certs/cert.pem, generating a self-signed pair
// for this machine's addresses on first run.
function tlsOptions() {
  const dir = path.join(__dirname, 'certs');
  const keyFile = path.join(dir, 'key.pem');
  const certFile = path.join(dir, 'cert.pem');
  if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) {
    const selfsigned = require('selfsigned');
    const altNames = [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, ...lanAddresses().map(ip => ({ type: 7, ip }))];
    const pems = selfsigned.generate([{ name: 'commonName', value: 'TechSprint' }], {
      days: 365, keySize: 2048, algorithm: 'sha256',
      extensions: [{ name: 'subjectAltName', altNames }],
    });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(certFile, pems.cert);
    console.log('Generated a self-signed certificate in backend/certs/');
  }
  return { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
}

const useHttps = process.env.HTTPS === 'true';
const app = express();
const server = useHttps ? https.createServer(tlsOptions(), app) : http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 16 * 1024, // clients only ever send small messages
});

app.use(cors());

// ─── Settings (cached; the coordinator changes them through the API) ──────────
const settings = { requireCheckin: true };
async function loadSettings() {
  const s = await store.getSettings();
  settings.requireCheckin = s.require_checkin !== false;
}

// ─── Questions in the game ────────────────────────────────────────────────────
// The bank is encrypted; questions reach the game only when a quiz master (PIN unlocked) loads
// them. They are then held decrypted in this process's memory only.
let questionsLoaded = null; // { count, by, at }

async function loadQuestionsIntoGame(dek, staff) {
  if (gameEngine.state !== 'lobby') return { error: 'Questions can only be loaded while the game is in the lobby' };
  const qs = await questionKeys.loadGameQuestions(dek);
  gameEngine.setQuestions(qs);
  questionsLoaded = { count: qs.length, by: staff.displayName, at: Date.now() };
  console.log(`${staff.displayName} loaded ${qs.length} questions into the game`);
  broadcastState();
  io.to('host').to('monitor').emit('questions_loaded', questionsLoaded);
  return { success: true, ...questionsLoaded };
}

// ─── Staff API ────────────────────────────────────────────────────────────────
app.use('/api', createApi({
  onQuestionsChanged(dek) {
    // Edits in the lobby refresh questions that were already loaded; a running game keeps its list.
    if (gameEngine.state !== 'lobby' || !questionsLoaded) return;
    questionKeys.loadGameQuestions(dek)
      .then(qs => {
        gameEngine.setQuestions(qs);
        questionsLoaded = { ...questionsLoaded, count: qs.length, at: Date.now() };
        broadcastState();
        io.to('host').to('monitor').emit('questions_loaded', questionsLoaded);
      })
      .catch(err => console.error(err.message));
  },
  loadQuestionsIntoGame,
  gameQuestionsStatus: () => ({ state: gameEngine.state, ...(questionsLoaded || { count: 0 }) }),
  onSettingsChanged(next) {
    Object.assign(settings, next);
    io.emit('config', publicConfig());
  },
}));

// What the participant page needs to know before joining.
const publicConfig = () => ({ requireCheckin: settings.requireCheckin });
app.get('/api/config', (req, res) => res.json(publicConfig()));

// Questions live in Supabase; the quiz master manages them in Admin → Questions
// (or import a file with `npm run seed`).

// ─── Broadcast helpers ────────────────────────────────────────────────────────
const broadcastState = () => io.emit('game_state', gameEngine.getState());
const broadcastPlayers = () => io.to('host').to('bigscreen').to('monitor').emit('players_list', gameEngine.getPlayersList());
const broadcastAnswerCount = () => io.to('host').to('bigscreen').to('monitor').emit('answer_count', {
  answered: gameEngine.answeredCount(),
  total: gameEngine.connectedCount(),
});

// ─── Question timer: the server ends each question when its time runs out ────
let questionTimer = null;

function scheduleQuestionEnd() {
  clearTimeout(questionTimer);
  const delay = gameEngine.questionEndsAt - Date.now() + ANSWER_GRACE_MS;
  questionTimer = setTimeout(endCurrentQuestion, Math.max(0, delay));
}

function endCurrentQuestion() {
  clearTimeout(questionTimer);
  const question = gameEngine.currentQuestion();
  const answers = Object.values(gameEngine.answers);
  const result = gameEngine.endQuestion();
  if (!result) return; // already ended
  db.saveQuestionResults(gameEngine.gameId, question?.id, answers, gameEngine.rankedPlayers());
  io.emit('question_result', result);
  broadcastState();
  broadcastPlayers();
}

// ─── Socket handlers ──────────────────────────────────────────────────────────
// Wraps a handler so bad input or a thrown error can never crash the server,
// and so a missing acknowledgement callback is harmless.
function handle(socket, event, handler) {
  socket.on(event, async (...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : () => {};
    try {
      await handler(callback, ...args);
    } catch (err) {
      console.error(`[socket] ${event} failed:`, err);
      callback({ error: 'Server error' });
    }
  });
}

const hostActions = {
  // Questions are encrypted; only the quiz master can load them (Admin → Questions).
  load_questions(callback) {
    callback(questionsLoaded
      ? { success: true, ...questionsLoaded }
      : { error: 'Questions are loaded by the quiz master (Admin → Questions → Load into game)' });
  },

  start_game(callback) {
    const result = gameEngine.startGame();
    if (result.error) return callback(result);
    db.markGameStarted(gameEngine.gameId, gameEngine.rankedPlayers());
    broadcastState();
    callback(result);
  },

  start_question(callback) {
    const result = gameEngine.startQuestion();
    if (result.error) return callback(result);
    if (gameEngine.state === 'question') scheduleQuestionEnd();
    if (gameEngine.state === 'podium') db.finishGame(gameEngine.gameId, gameEngine.rankedPlayers());
    broadcastState();
    if (gameEngine.state === 'question') broadcastAnswerCount();
    callback(result);
  },

  end_question(callback) {
    if (gameEngine.state !== 'question') return callback({ error: 'No question is live' });
    endCurrentQuestion();
    callback({ success: true });
  },

  kick_player(callback, data) {
    const player = gameEngine.removePlayer(data?.playerId);
    if (!player) return callback({ error: 'Player not found' });
    if (gameEngine.state !== 'lobby') db.deleteParticipant(player.id);
    const socket = player.socketId && io.sockets.sockets.get(player.socketId);
    if (socket) {
      socket.emit('kicked');
      socket.disconnect(true);
    }
    broadcastPlayers();
    callback({ success: true });
  },

  reset_game(callback) {
    clearTimeout(questionTimer);
    gameEngine.reset();
    io.emit('game_reset');
    broadcastState();
    broadcastPlayers();
    callback({ success: true });
  },
};

io.on('connection', (socket) => {
  // Host console (coordinator/admin), read-only live monitor (any staff), projector screen.
  handle(socket, 'join_role', async (callback, role, token) => {
    if (role === 'host' || role === 'monitor') {
      const session = await auth.getSession(token);
      if (!session) return callback({ error: 'Session expired - please sign in again' });
      if (role === 'host' && !['coordinator', 'admin'].includes(session.staff.role)) {
        return callback({ error: 'Only a coordinator or admin can conduct the live event' });
      }
      socket.data.isHost = role === 'host';
      socket.data.staff = session.staff;
      socket.emit('questions_loaded', questionsLoaded || { count: 0 });
    } else if (role !== 'bigscreen') {
      return callback({ error: 'Unknown role' });
    }
    socket.join(role);
    socket.emit('server_info', { lanAddresses: lanAddresses(), port: PORT });
    socket.emit('game_state', gameEngine.getState());
    socket.emit('players_list', gameEngine.getPlayersList());
    socket.emit('answer_count', { answered: gameEngine.answeredCount(), total: gameEngine.connectedCount() });
    if (gameEngine.state === 'leaderboard' && gameEngine.lastResult) socket.emit('question_result', gameEngine.lastResult);
    callback({ success: true });
  });

  handle(socket, 'host_action', async (callback, action, data) => {
    if (!socket.data.isHost) return callback({ error: 'Not authorised' });
    const run = hostActions[action];
    if (!run) return callback({ error: 'Unknown action' });
    console.log(`Host action: ${action} (${socket.data.staff?.displayName})`);
    await run(callback, data);
  });

  // When check-in is required, players join with the ticket ID from their pass, and only
  // tickets a volunteer has admitted can play.
  handle(socket, 'join_game', async (callback, data) => {
    if (!settings.requireCheckin) {
      if (gameEngine.state !== 'lobby') return callback({ error: 'Game already started' });
      const result = gameEngine.addPlayer(socket.id, data?.name, data?.team);
      if (result.error) return callback(result);
      socket.join('players');
      broadcastPlayers();
      return callback(result);
    }

    const ticketId = store.normalizeTicketId(data?.ticketId);
    if (!ticketId) return callback({ error: 'Enter the ticket ID printed on your pass' });

    // Same ticket on a new phone: take the seat back if the old device dropped off.
    const reclaimed = gameEngine.reclaimByTicket(socket.id, ticketId);
    if (reclaimed?.error) return callback(reclaimed);
    if (reclaimed) {
      const old = reclaimed.previousSocketId && io.sockets.sockets.get(reclaimed.previousSocketId);
      if (old && old.id !== socket.id) old.disconnect(true);
      socket.join('players');
      broadcastPlayers();
      return callback({ success: true, player: reclaimed.player, token: reclaimed.token, reclaimed: true });
    }

    if (gameEngine.state !== 'lobby') return callback({ error: 'Game already started' });
    let reg;
    try {
      reg = await store.getRegistration(ticketId);
    } catch (err) {
      console.error(err.message);
      return callback({ error: 'Could not verify your ticket right now — try again' });
    }
    if (!reg) return callback({ error: 'Ticket not found — check the ID on your pass' });
    if (!reg.checkedInAt) return callback({ error: 'Not checked in yet — show your pass at the entry desk first' });

    const displayName = (typeof data?.name === 'string' && data.name.trim()) || reg.name.trim().split(/\s+/)[0];
    const result = gameEngine.addPlayer(socket.id, displayName.slice(0, 20), '', { ticketId, fullName: reg.name });
    if (result.error) return callback(result);
    socket.join('players');
    broadcastPlayers();
    callback(result);
  });

  // A returning player (refresh or dropped connection) reclaims their seat with their token.
  handle(socket, 'rejoin_game', (callback, token) => {
    const result = gameEngine.rejoin(socket.id, token);
    if (result.error) return callback(result);
    const old = result.previousSocketId && io.sockets.sockets.get(result.previousSocketId);
    if (old && old.id !== socket.id) old.disconnect(true);
    socket.join('players');
    broadcastPlayers();
    if (gameEngine.state === 'question') broadcastAnswerCount();
    const player = gameEngine.players[gameEngine.sockets[socket.id]];
    callback({
      success: true,
      player: result.player,
      gameState: gameEngine.getState(),
      myAnswer: gameEngine.answerFor(player),
    });
  });

  handle(socket, 'submit_answer', (callback, answer) => {
    const result = gameEngine.submitAnswer(socket.id, answer);
    callback(result);
    if (result.success) broadcastAnswerCount();
  });

  handle(socket, 'use_drone', (callback) => {
    callback(gameEngine.useDroneAssist(socket.id));
  });

  socket.on('disconnect', () => {
    if (gameEngine.disconnect(socket.id)) {
      broadcastPlayers();
      if (gameEngine.state === 'question') broadcastAnswerCount();
    }
  });
});

// ─── Frontend (production build) ──────────────────────────────────────────────
const distDir = path.join(__dirname, '../frontend/dist');
app.use(express.static(distDir));
// SPA fallback for React Router (/host, /screen, ...) - Express 5 compatible
app.use((req, res) => {
  const index = path.join(distDir, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(404).send('Frontend not built. Run "npm run build" in frontend/, or use the Vite dev server on port 5173.');
});

// ─── Startup and shutdown ─────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001;

server.listen(PORT, '0.0.0.0', async () => {
  const scheme = useHttps ? 'https' : 'http';
  try {
    await auth.ensureBootstrapAdmin();
    await loadSettings();
    store.deleteExpiredSessions().catch(() => {});
  } catch (err) {
    console.error(`Staff/settings setup failed: ${err.message}`);
  }
  if (!process.env.QUESTION_VAULT_SECRET) console.error('QUESTION_VAULT_SECRET is not set - the question bank cannot be unlocked');
  console.log('Question bank is encrypted: the quiz master loads questions via Admin → Questions → Load into game');
  console.log(`Server running on ${scheme}://0.0.0.0:${PORT}  (check-in required to play: ${settings.requireCheckin})`);
  for (const ip of lanAddresses()) console.log(`  Network: ${scheme}://${ip}:${PORT}`);
});

process.on('unhandledRejection', err => console.error('[unhandledRejection]', err));

// Let queued database writes finish before exiting.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received - saving pending results...`);
  clearTimeout(questionTimer);
  io.close();
  await Promise.race([db.flush(), new Promise(r => setTimeout(r, 10000))]);
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
