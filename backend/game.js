// The live game over Socket.IO: lobby, questions, timer, scoring, host / monitor / projector
// rooms. Used by server.js (all-in-one) and game-server.js (event-day laptop behind a tunnel).
//
// Questions arrive already decrypted (from the quiz master's "Load into game") and are held in
// this process's memory only.
const db = require('./db');
const store = require('./store');
const auth = require('./auth');
const gameEngine = require('./gameEngine');

const { ANSWER_GRACE_MS } = gameEngine;
const SETTINGS_REFRESH_MS = 15 * 1000;

/**
 * @param io        Socket.IO server
 * @param options.serverInfo  () => ({ lanAddresses, port }) for the projector's join screen
 */
function createGame(io, { serverInfo = () => ({ lanAddresses: [], port: null }) } = {}) {
  // ─── Settings (read from Supabase; pushed on change, refreshed periodically) ─
  const settings = { requireCheckin: true };
  const publicConfig = () => ({ requireCheckin: settings.requireCheckin });

  function applySettings(next) {
    const before = settings.requireCheckin;
    if (typeof next.requireCheckin === 'boolean') settings.requireCheckin = next.requireCheckin;
    if (before !== settings.requireCheckin) io.emit('config', publicConfig());
  }

  async function refreshSettings() {
    try {
      const s = await store.getSettings();
      applySettings({ requireCheckin: s.require_checkin !== false });
    } catch (err) {
      console.error(`[game] settings refresh failed: ${err.message}`);
    }
  }
  setInterval(refreshSettings, SETTINGS_REFRESH_MS).unref();

  // ─── Broadcast helpers ──────────────────────────────────────────────────────
  const broadcastState = () => io.emit('game_state', gameEngine.getState());
  const broadcastPlayers = () => io.to('host').to('bigscreen').to('monitor').emit('players_list', gameEngine.getPlayersList());
  const broadcastAnswerCount = () => io.to('host').to('bigscreen').to('monitor').emit('answer_count', {
    answered: gameEngine.answeredCount(),
    total: gameEngine.connectedCount(),
  });

  // ─── Questions ──────────────────────────────────────────────────────────────
  let questionsLoaded = null; // { count, by, at }

  function loadQuestions(questions, byName) {
    if (gameEngine.state !== 'lobby') return { error: 'Questions can only be loaded while the game is in the lobby' };
    gameEngine.setQuestions(questions);
    questionsLoaded = { count: questions.length, by: byName, at: Date.now() };
    console.log(`${byName} loaded ${questions.length} questions into the game`);
    broadcastState();
    io.to('host').to('monitor').emit('questions_loaded', questionsLoaded);
    return { success: true, ...questionsLoaded };
  }

  const status = () => ({ online: true, state: gameEngine.state, players: gameEngine.getPlayersList().length, ...(questionsLoaded || { count: 0 }) });

  // ─── Question timer: the server ends each question when its time runs out ──
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
    // Each player learns their own result only now, at the reveal.
    for (const p of Object.values(gameEngine.players)) {
      if (p.connected) io.to(p.socketId).emit('my_result', { player: gameEngine.privateView(p), myAnswer: gameEngine.answerFor(p) });
    }
    broadcastState();
    broadcastPlayers();
  }

  // ─── Socket handlers ────────────────────────────────────────────────────────
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
      socket.emit('server_info', serverInfo());
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


    socket.on('disconnect', () => {
      if (gameEngine.disconnect(socket.id)) {
        broadcastPlayers();
        if (gameEngine.state === 'question') broadcastAnswerCount();
      }
    });
  });

  // Let queued database writes finish before the process exits.
  async function shutdown() {
    clearTimeout(questionTimer);
    io.close();
    await Promise.race([db.flush(), new Promise(r => setTimeout(r, 10000))]);
  }

  return { loadQuestions, status, applySettings, refreshSettings, publicConfig, shutdown, settings, engine: gameEngine };
}

module.exports = createGame;
