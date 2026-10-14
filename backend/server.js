require('dotenv').config({ quiet: true });
const express = require('express');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');
const cors = require('cors');
const db = require('./db');
const gameEngine = require('./gameEngine');
const { ANSWER_GRACE_MS } = gameEngine;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
if (!process.env.ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD is not set - using the default "admin"');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 16 * 1024, // clients only ever send small messages
});

app.use(cors());
app.use(express.json({ limit: '16kb' }));

// ─── Host authentication ──────────────────────────────────────────────────────
const hostTokens = new Set();

function passwordMatches(password) {
  if (typeof password !== 'string') return false;
  const hash = s => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(hash(password), hash(ADMIN_PASSWORD));
}

app.post('/api/admin/login', (req, res) => {
  if (!passwordMatches(req.body?.password)) {
    return res.status(401).json({ success: false, error: 'Invalid password' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  hostTokens.add(token);
  res.json({ success: true, token });
});

// Questions live in Supabase; import them with `npm run seed` (reads ../seed_questions.json).

// ─── Network info for the join screen ─────────────────────────────────────────
function lanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(a => a && a.family === 'IPv4' && !a.internal)
    .map(a => a.address);
}

// ─── Broadcast helpers ────────────────────────────────────────────────────────
const broadcastState = () => io.emit('game_state', gameEngine.getState());
const broadcastPlayers = () => io.to('host').to('bigscreen').emit('players_list', gameEngine.getPlayersList());
const broadcastAnswerCount = () => io.to('host').to('bigscreen').emit('answer_count', {
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
  async load_questions(callback) {
    if (gameEngine.state !== 'lobby') return callback({ error: 'Questions can only be loaded in the lobby' });
    try {
      const qs = await db.getAllQuestions();
      gameEngine.setQuestions(qs);
      broadcastState();
      callback({ success: true, count: qs.length });
    } catch (err) {
      console.error(err.message);
      callback({ error: 'Could not load questions from the database' });
    }
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
  // Host and big screen. The host must present a token from /api/admin/login.
  handle(socket, 'join_role', (callback, role, token) => {
    if (role === 'host') {
      if (!hostTokens.has(token)) return callback({ error: 'Session expired - please sign in again' });
      socket.data.isHost = true;
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
    console.log('Host action:', action);
    await run(callback, data);
  });

  handle(socket, 'join_game', (callback, data) => {
    if (gameEngine.state !== 'lobby') return callback({ error: 'Game already started' });
    const result = gameEngine.addPlayer(socket.id, data?.name, data?.team);
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
  try {
    const qs = await db.getAllQuestions();
    gameEngine.setQuestions(qs);
    console.log(`Loaded ${qs.length} questions from Supabase`);
  } catch (err) {
    console.error(`${err.message} - use "Load Questions" in the host console to retry`);
  }
  console.log(`Backend server running on http://0.0.0.0:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  Network: http://${ip}:${PORT}`);
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
