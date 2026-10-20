// The live game over Socket.IO: lobby, questions, timer, scoring, eliminations, host / monitor /
// projector rooms, and the per-candidate activity log. Used by server.js (all-in-one) and
// game-server.js (event-day laptop behind a tunnel).
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
  // The projector gets the public list; host and monitor also see tickets and malpractice flags.
  const broadcastPlayers = () => {
    io.to('bigscreen').emit('players_list', gameEngine.getPlayersList());
    io.to('host').to('monitor').emit('players_list', gameEngine.getStaffPlayersList());
  };
  // Frequent changes (screen switches) refresh the staff list at most once a second.
  let playersTimer = null;
  const schedulePlayersBroadcast = () => {
    if (!playersTimer) playersTimer = setTimeout(() => { playersTimer = null; broadcastPlayers(); }, 1000);
  };
  const broadcastAnswerCount = () => io.to('host').to('bigscreen').to('monitor').emit('answer_count', {
    answered: gameEngine.answeredCount(),
    total: gameEngine.connectedCount(),
  });

  // ─── Activity log: everything each candidate does, written in batches ───────
  const pendingEvents = [];
  function logEvent(event, { player = null, socket = null, ticketId = null, detail = {} } = {}) {
    const live = gameEngine.state === 'question';
    pendingEvents.push({
      game_id: gameEngine.gameId,
      participant_id: player?.id ?? null,
      ticket_id: player?.ticketId ?? ticketId ?? null,
      player_name: player?.name ?? null,
      event,
      question_index: live ? gameEngine.currentQuestionIndex + 1 : null,
      question_id: live ? gameEngine.currentQuestion()?.id ?? null : null,
      detail,
      ip: socket ? clientIp(socket) : null,
      at: new Date().toISOString(),
    });
    if (pendingEvents.length >= 500) flushEvents();
  }
  function flushEvents() {
    if (pendingEvents.length) db.logEvents(pendingEvents.splice(0));
  }
  setInterval(flushEvents, 5000).unref();

  // Caps noisy events (rejected answers, screen switches) per player per question.
  function underLimit(player, kind, max) {
    const key = `${kind}:${gameEngine.currentQuestionIndex}`;
    player.logCounts = player.logCounts || {};
    player.logCounts[key] = (player.logCounts[key] || 0) + 1;
    return player.logCounts[key] <= max;
  }

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

  const sendToPlayer = (p, event, payload) => { if (p.connected && p.socketId) io.to(p.socketId).emit(event, payload); };

  function endCurrentQuestion() {
    clearTimeout(questionTimer);
    const question = gameEngine.currentQuestion();
    const answers = Object.values(gameEngine.answers);
    const result = gameEngine.endQuestion();
    if (!result) return; // already ended
    // Participants (with any new eliminated status) first, then the elimination records.
    db.saveQuestionResults(gameEngine.gameId, question?.id, answers, gameEngine.rankedPlayers());
    if (result.elimination?.eliminated.length) {
      const out = result.elimination.eliminated.map(e => gameEngine.players[e.id]);
      db.recordEliminations(gameEngine.gameId, out);
      for (const p of out) {
        logEvent('eliminated', { player: p, detail: { level: p.exit.levelName, round: p.exit.round, rank: p.exit.rank, score: p.exit.score, top: result.elimination.qualifyTop } });
      }
      console.log(`Cut after ${result.elimination.levelName}: ${result.elimination.advanced} advance, ${out.length} eliminated`);
    }
    flushEvents();
    io.emit('question_result', result);
    // Each player learns their own result (and whether they made the cut) only now, at the reveal.
    for (const p of Object.values(gameEngine.players)) {
      sendToPlayer(p, 'my_result', { player: gameEngine.privateView(p), myAnswer: gameEngine.answerFor(p), standing: gameEngine.standingOf(p) });
    }
    broadcastState();
    broadcastPlayers();
  }

  // Disqualify (any time after the game starts) — kept on record with the reason and who did it.
  function disqualifyPlayer(playerId, note, staff) {
    const result = gameEngine.disqualify(playerId, typeof note === 'string' ? note.trim().slice(0, 200) : '', staff?.id ?? null);
    if (result.error) return result;
    const p = result.player;
    db.saveParticipants(gameEngine.gameId, [p]);
    db.recordEliminations(gameEngine.gameId, [p]);
    logEvent('disqualified', { player: p, detail: { reason: p.exit.note, by: staff?.displayName ?? null } });
    flushEvents();
    sendToPlayer(p, 'player_update', { player: gameEngine.privateView(p) });
    broadcastPlayers();
    if (gameEngine.state === 'question') broadcastAnswerCount();
    return { success: true };
  }

  // ─── Join attempt limits (slows down guessing ticket IDs) ───────────────────
  // Only failures count (unknown ticket, wrong phone digits), so a crowd joining from one venue
  // Wi-Fi address isn't throttled. Behind Cloudflare Tunnel the visitor's IP is in CF-Connecting-IP
  // (trusted only when the connection comes from the local cloudflared).
  const JOIN_WINDOW_MS = 10 * 60 * 1000;
  const JOIN_LIMITS = { socket: 8, ip: 60 };
  const joinFailures = new Map(); // key -> { count, until }
  function clientIp(socket) {
    const addr = socket.handshake.address || '';
    const cf = socket.handshake.headers['cf-connecting-ip'];
    return /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(addr) && typeof cf === 'string' ? cf : addr;
  }
  const failureKeys = socket => [[`s:${socket.id}`, JOIN_LIMITS.socket], [`ip:${clientIp(socket)}`, JOIN_LIMITS.ip]];
  const tooManyJoinFailures = socket => failureKeys(socket).some(([key, max]) => {
    const f = joinFailures.get(key);
    return f && f.until > Date.now() && f.count >= max;
  });
  const recordJoinFailure = socket => {
    for (const [key] of failureKeys(socket)) {
      const f = joinFailures.get(key);
      if (!f || f.until <= Date.now()) joinFailures.set(key, { count: 1, until: Date.now() + JOIN_WINDOW_MS });
      else f.count += 1;
    }
  };
  setInterval(() => {
    for (const [key, f] of joinFailures) if (f.until <= Date.now()) joinFailures.delete(key);
  }, 60 * 1000).unref();

  // Last 4 digits of the phone number on the registration, used to prove a ticket is yours.
  const phoneDigits = reg => String(reg?.phone || '').replace(/\D/g, '').slice(-4);
  const device = socket => String(socket.handshake.headers['user-agent'] || '').slice(0, 160);

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

    start_game(callback, data, staff) {
      const result = gameEngine.startGame();
      if (result.error) return callback(result);
      db.markGameStarted(gameEngine.gameId, gameEngine.rankedPlayers());
      logEvent('game_started', { detail: { players: gameEngine.activePlayers().length, questions: gameEngine.questions.length, by: staff?.displayName ?? null } });
      flushEvents();
      broadcastState();
      callback(result);
    },

    start_question(callback) {
      const result = gameEngine.startQuestion();
      if (result.error) return callback(result);
      if (gameEngine.state === 'question') {
        scheduleQuestionEnd();
        const info = gameEngine.levelInfo(gameEngine.currentLevel);
        logEvent('question_started', { detail: { level: info.name, round: info.round, playersLeft: gameEngine.activePlayers().length } });
      }
      if (gameEngine.state === 'podium') {
        db.finishGame(gameEngine.gameId, gameEngine.rankedPlayers());
        logEvent('game_finished', { detail: { finalists: gameEngine.activePlayers().length } });
        flushEvents();
      }
      broadcastState();
      if (gameEngine.state === 'question') broadcastAnswerCount();
      callback(result);
    },

    end_question(callback) {
      if (gameEngine.state !== 'question') return callback({ error: 'No question is live' });
      endCurrentQuestion();
      callback({ success: true });
    },

    // In the lobby: remove the player. Once the game has started: disqualify (kept on record).
    kick_player(callback, data, staff) {
      if (gameEngine.state !== 'lobby') return callback(disqualifyPlayer(data?.playerId, 'Removed by the host', staff));
      const player = gameEngine.removePlayer(data?.playerId);
      if (!player) return callback({ error: 'Player not found' });
      logEvent('kicked', { player, detail: { by: staff?.displayName ?? null } });
      const socket = player.socketId && io.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.emit('kicked');
        socket.disconnect(true);
      }
      broadcastPlayers();
      callback({ success: true });
    },

    disqualify_player(callback, data, staff) {
      if (gameEngine.state === 'lobby') return callback({ error: 'The game has not started — use Kick in the lobby' });
      callback(disqualifyPlayer(data?.playerId, data?.reason, staff));
    },

    reset_game(callback, data, staff) {
      clearTimeout(questionTimer);
      logEvent('game_reset', { detail: { state: gameEngine.state, by: staff?.displayName ?? null } });
      flushEvents();
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
      socket.emit('players_list', role === 'bigscreen' ? gameEngine.getPlayersList() : gameEngine.getStaffPlayersList());
      socket.emit('answer_count', { answered: gameEngine.answeredCount(), total: gameEngine.connectedCount() });
      if (gameEngine.state === 'leaderboard' && gameEngine.lastResult) socket.emit('question_result', gameEngine.lastResult);
      callback({ success: true });
    });

    handle(socket, 'host_action', async (callback, action, data) => {
      if (!socket.data.isHost) return callback({ error: 'Not authorised' });
      const run = hostActions[action];
      if (!run) return callback({ error: 'Unknown action' });
      console.log(`Host action: ${action} (${socket.data.staff?.displayName})`);
      await run(callback, data, socket.data.staff);
    });

    // When check-in is required, players join with the ticket ID from their pass, and only
    // tickets a volunteer has admitted can play.
    handle(socket, 'join_game', async (callback, data) => {
      const fail = (error, ticketId = null, extra = {}) => {
        logEvent('join_failed', { socket, ticketId, detail: { reason: error } });
        return callback({ error, ...extra });
      };

      if (!settings.requireCheckin) {
        if (gameEngine.state !== 'lobby') return callback({ error: 'Game already started' });
        const result = gameEngine.addPlayer(socket.id, data?.name, data?.team, null, data?.avatar);
        if (result.error) return callback(result);
        socket.join('players');
        logEvent('join', { player: gameEngine.playerBySocket(socket.id), socket, detail: { device: device(socket), checkin: false } });
        broadcastPlayers();
        return callback(result);
      }

      const ticketId = store.normalizeTicketId(data?.ticketId);
      if (!ticketId) return callback({ error: 'Enter the ticket ID printed on your pass' });
      if (tooManyJoinFailures(socket)) return fail('Too many attempts — wait a few minutes, or ask the quiz desk', ticketId);

      // Same ticket on a new phone: the seat moves only if the old device dropped off AND the
      // player proves the ticket is theirs (the pass alone is visible to anyone nearby).
      const seated = gameEngine.playerByTicket(ticketId);
      if (seated) {
        if (seated.connected) return fail('This ticket is already playing on another device', ticketId);
        let reg;
        try {
          reg = await store.getRegistration(ticketId);
        } catch (err) {
          console.error(err.message);
          return callback({ error: 'Could not verify your ticket right now — try again' });
        }
        const expected = phoneDigits(reg);
        if (expected.length < 4) return fail('This ticket is already in the game — ask the quiz desk to help you continue on this device', ticketId);
        const given = String(data?.verify ?? '').replace(/\D/g, '');
        if (!given) {
          return callback({ needsVerify: true, error: 'This ticket is already in the game. To continue on this device, enter the last 4 digits of the phone number you registered with.' });
        }
        if (given !== expected) {
          recordJoinFailure(socket);
          logEvent('verify_failed', { player: seated, socket, detail: { device: device(socket) } });
          return callback({ needsVerify: true, error: "That doesn't match the phone number registered for this ticket" });
        }
      }
      const reclaimed = seated && gameEngine.reclaimByTicket(socket.id, ticketId);
      if (reclaimed?.error) return fail(reclaimed.error, ticketId);
      if (reclaimed) {
        const old = reclaimed.previousSocketId && io.sockets.sockets.get(reclaimed.previousSocketId);
        if (old && old.id !== socket.id) old.disconnect(true);
        socket.join('players');
        logEvent('seat_reclaimed', { player: seated, socket, detail: { device: device(socket) } });
        broadcastPlayers();
        return callback({ success: true, player: reclaimed.player, token: reclaimed.token, reclaimed: true });
      }

      if (gameEngine.state !== 'lobby') return fail('Game already started', ticketId);
      let reg;
      try {
        reg = await store.getRegistration(ticketId);
      } catch (err) {
        console.error(err.message);
        return callback({ error: 'Could not verify your ticket right now — try again' });
      }
      if (!reg) {
        recordJoinFailure(socket);
        return fail('Ticket not found — check the ID on your pass', ticketId);
      }
      if (!reg.checkedInAt) return fail('Not checked in yet — show your pass at the entry desk first', ticketId);

      const displayName = (typeof data?.name === 'string' && data.name.trim()) || reg.name.trim().split(/\s+/)[0];
      const result = gameEngine.addPlayer(socket.id, displayName.slice(0, 20), '', { ticketId, fullName: reg.name }, data?.avatar);
      if (result.error) return fail(result.error, ticketId);
      socket.join('players');
      logEvent('join', { player: gameEngine.playerBySocket(socket.id), socket, detail: { device: device(socket) } });
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
      const player = gameEngine.players[gameEngine.sockets[socket.id]];
      logEvent('rejoin', { player, socket });
      broadcastPlayers();
      if (gameEngine.state === 'question') broadcastAnswerCount();
      callback({
        success: true,
        player: result.player,
        gameState: gameEngine.getState(),
        myAnswer: gameEngine.answerFor(player),
      });
    });

    handle(socket, 'submit_answer', (callback, answer) => {
      const result = gameEngine.submitAnswer(socket.id, answer);
      const player = result.player ?? gameEngine.playerBySocket(socket.id);
      if (!result.success) {
        if (player && underLimit(player, 'rejected', 5)) {
          logEvent('answer_rejected', { player, socket, detail: { reason: result.error, answer: typeof answer === 'string' ? answer.slice(0, 160) : null } });
        }
        return callback({ error: result.error });
      }
      const r = result.record;
      logEvent('answer', { player, socket, detail: { answer: r.answer, correct: r.isCorrect, ms: r.time, points: r.pointsEarned, badge: r.badge } });
      callback({ success: true }); // right/wrong only at the reveal
      broadcastAnswerCount();
    });

    // The phone reports when the quiz page is hidden/shown during a question (switching apps or
    // tabs). Logged and flagged for staff; never acted on automatically.
    handle(socket, 'screen', (callback, data) => {
      const change = gameEngine.screenChange(socket.id, data?.hidden === true);
      if (change && underLimit(change.player, 'screen', 40)) {
        logEvent(change.event, { player: change.player, socket, detail: change.awayMs != null ? { awayMs: change.awayMs } : {} });
        schedulePlayersBroadcast();
      }
      callback({ success: true });
    });

    socket.on('disconnect', (reason) => {
      const player = gameEngine.disconnect(socket.id);
      if (player) {
        logEvent('disconnect', { player, detail: { reason } });
        broadcastPlayers();
        if (gameEngine.state === 'question') broadcastAnswerCount();
      }
    });
  });

  // GET /live-image/:index — a question's picture, served only once that question is live.
  // ?g= (game id) is only there so browsers don't reuse an image from a previous game.
  function liveImage(req, res) {
    const image = gameEngine.liveImage(Number(req.params.index));
    if (!image) return res.status(404).end();
    res.set({ 'Content-Type': image.mime, 'Cache-Control': 'private, max-age=600' });
    res.send(Buffer.from(image.data, 'base64'));
  }

  // Let queued database writes finish before the process exits.
  async function shutdown() {
    clearTimeout(questionTimer);
    flushEvents();
    io.close();
    await Promise.race([db.flush(), new Promise(r => setTimeout(r, 10000))]);
  }

  return { loadQuestions, status, applySettings, refreshSettings, publicConfig, shutdown, liveImage, settings, engine: gameEngine };
}

module.exports = createGame;
