const { randomUUID, randomBytes } = require('crypto');

// Answers arriving this long after the deadline are still accepted (network latency).
const ANSWER_GRACE_MS = 1000;
const MAX_NAME_LENGTH = 20;
// A correct answer faster than this on a question of 10 s or more is flagged for staff to review.
const FAST_CORRECT_MS = 1500;

// What other clients may see about a player (never the rejoin token or ticket).
function publicPlayer(p) {
  return { id: p.id, name: p.name, team: p.team, score: p.score, streak: p.streak, connected: p.connected, status: p.status };
}

// Standings: higher score first; on a tie, less total answer time (a skipped question counts as
// its full timer, so skipping never helps).
const byStanding = (a, b) => (b.score - a.score) || (a.totalResponseTime - b.totalResponseTime);

class GameEngine {
  constructor() {
    this.questions = [];
    this.reset();
  }

  reset() {
    this.gameId = randomUUID(); // games.id in Supabase
    this.state = 'lobby'; // lobby, intro, question, leaderboard, podium
    // participantId -> player (see addPlayer)
    this.players = {};
    this.tokens = {};  // rejoin token -> participantId
    this.sockets = {}; // socketId -> participantId
    this.currentQuestionIndex = -1; // index of the question being asked, or the next one to ask
    this.currentLevel = this.questions[0]?.level || 1;
    this.questionStartTime = null;
    this.questionEndsAt = null;
    this.answers = {};    // participantId -> { participantId, answer, time, isCorrect, pointsEarned, badge }
    this.firstBloodAwarded = false;
    this.lastResult = null; // reveal data for the last question, resent to screens that (re)connect
  }

  setQuestions(questions) {
    this.questions = questions;
  }

  // Levels come with the questions (levelName, multiplier, qualifyTop set by the quiz master).
  // The round number is the level's place among the levels in this game, so gaps don't show.
  levelNumbers() {
    return [...new Set(this.questions.map(q => q.level || 1))];
  }

  levelInfo(level) {
    const q = this.questions.find(x => (x.level || 1) === level);
    const multiplier = Number(q?.multiplier);
    const top = Number(q?.qualifyTop);
    return {
      number: level,
      round: Math.max(1, this.levelNumbers().indexOf(level) + 1),
      name: q?.levelName || `Level ${level}`,
      multiplier: multiplier > 0 ? multiplier : 1,
      qualifyTop: Number.isInteger(top) && top > 0 ? top : null,
    };
  }

  currentQuestion() {
    return this.questions[this.currentQuestionIndex];
  }

  playerBySocket(socketId) {
    return this.players[this.sockets[socketId]];
  }

  playerByTicket(ticketId) {
    return ticketId ? Object.values(this.players).find(p => p.ticketId === ticketId) : undefined;
  }

  // ticket: { ticketId, fullName } when check-in is required, otherwise null.
  addPlayer(socketId, rawName, rawTeam, ticket = null) {
    if (this.sockets[socketId]) return { error: 'Already joined' };
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) return { error: `Name must be 1-${MAX_NAME_LENGTH} characters` };
    const team = typeof rawTeam === 'string' ? rawTeam.trim().slice(0, 30) : '';

    if (ticket && this.playerByTicket(ticket.ticketId)) return { error: 'This ticket is already playing on another device' };
    const isDuplicate = Object.values(this.players).some(p => p.name.toLowerCase() === name.toLowerCase());
    if (isDuplicate) return { error: 'That display name is taken — pick another' };

    const player = {
      id: randomUUID(), // participants.id in Supabase
      token: randomBytes(16).toString('hex'),
      socketId,
      connected: true,
      ticketId: ticket?.ticketId ?? null,
      fullName: ticket?.fullName ?? null,
      name,
      team,
      score: 0,
      streak: 0,
      totalResponseTime: 0,
      status: 'active', // active | eliminated | disqualified
      exit: null,       // { reason, level, round, levelName, rank, score, note, staffId } once out
      // Indicators for staff (never decisive on their own): leaving the quiz screen during a
      // question, very fast correct answers, reconnects.
      flags: { away: 0, awayMs: 0, fastCorrect: 0, reconnects: 0 },
      awaySince: null,
    };
    this.players[player.id] = player;
    this.tokens[player.token] = player.id;
    this.sockets[socketId] = player.id;
    return { success: true, player: this.privateView(player), token: player.token };
  }

  // Reattach a returning player (page refresh, Wi-Fi drop) to their new socket.
  rejoin(socketId, token) {
    const player = this.players[this.tokens[token]];
    if (typeof token !== 'string' || !player) return { error: 'Session not found' };
    const previousSocketId = player.socketId;
    if (previousSocketId) delete this.sockets[previousSocketId];
    player.socketId = socketId;
    player.connected = true;
    if (this.state !== 'lobby') player.flags.reconnects += 1;
    this.sockets[socketId] = player.id;
    return { success: true, player: this.privateView(player), previousSocketId };
  }

  // A checked-in player on a new device (lost the rejoin token) reclaims their seat by ticket,
  // but only while their old device is disconnected.
  reclaimByTicket(socketId, ticketId) {
    const player = this.playerByTicket(ticketId);
    if (!player) return null;
    if (player.connected) return { error: 'This ticket is already playing on another device' };
    const result = this.rejoin(socketId, player.token);
    return result.error ? result : { ...result, token: player.token };
  }

  disconnect(socketId) {
    const player = this.playerBySocket(socketId);
    delete this.sockets[socketId];
    if (!player || player.socketId !== socketId) return null;
    player.socketId = null;
    player.connected = false;
    this.closeAway(player);
    return player;
  }

  // Lobby only: take a player out entirely (nothing has been recorded yet).
  removePlayer(participantId) {
    const player = this.players[participantId];
    if (!player) return null;
    delete this.players[participantId];
    delete this.tokens[player.token];
    if (player.socketId) delete this.sockets[player.socketId];
    return player;
  }

  // ─── Elimination & disqualification ─────────────────────────────────────────
  activePlayers() {
    return Object.values(this.players).filter(p => p.status === 'active');
  }

  // After a level's last question: keep the top N (current standings among active players),
  // eliminate the rest. Called by endQuestion only when another level follows.
  applyCut(levelNumber) {
    const info = this.levelInfo(levelNumber);
    const ranked = this.activePlayers().sort(byStanding);
    const out = info.qualifyTop && ranked.length > info.qualifyTop ? ranked.slice(info.qualifyTop) : [];
    out.forEach((p, i) => {
      this.closeAway(p);
      p.status = 'eliminated';
      p.exit = {
        reason: 'cut',
        level: levelNumber,
        round: info.round,
        levelName: info.name,
        rank: info.qualifyTop + i + 1,
        score: p.score,
        note: `Top ${info.qualifyTop} advance after ${info.name}`,
        staffId: null,
      };
    });
    return {
      level: levelNumber,
      round: info.round,
      levelName: info.name,
      qualifyTop: info.qualifyTop,
      advanced: ranked.length - out.length,
      eliminated: out.map(p => ({ id: p.id, name: p.name, rank: p.exit.rank, score: p.score })),
    };
  }

  // Staff action (malpractice etc.): the player is out at once, keeps no rank, and an answer
  // they gave to the live question is discarded.
  disqualify(participantId, note, staffId = null) {
    const player = this.players[participantId];
    if (!player) return { error: 'Player not found' };
    if (player.status === 'disqualified') return { error: 'Already disqualified' };
    const info = this.levelInfo(this.currentLevel);
    this.closeAway(player);
    if (this.state === 'question') delete this.answers[player.id];
    player.status = 'disqualified';
    player.exit = {
      reason: 'disqualified',
      level: info.number,
      round: info.round,
      levelName: info.name,
      rank: null,
      score: player.score,
      note: note || 'Disqualified by the quiz host',
      staffId,
    };
    return { success: true, player };
  }

  // ─── Leaving the quiz screen (reported by the phone during a question) ──────
  // Returns { event, awayMs? } to log, or null if nothing changed.
  screenChange(socketId, hidden) {
    const player = this.playerBySocket(socketId);
    if (!player || player.status !== 'active' || this.state !== 'question') return null;
    if (hidden && !player.awaySince) {
      player.awaySince = Date.now();
      player.flags.away += 1;
      return { player, event: 'screen_left' };
    }
    if (!hidden && player.awaySince) {
      const awayMs = this.closeAway(player);
      return { player, event: 'screen_returned', awayMs };
    }
    return null;
  }

  closeAway(player) {
    if (!player.awaySince) return 0;
    const awayMs = Date.now() - player.awaySince;
    player.flags.awayMs += awayMs;
    player.awaySince = null;
    return awayMs;
  }

  // ─── Views ──────────────────────────────────────────────────────────────────
  // What a player may see about themselves.
  privateView(player) {
    return { ...publicPlayer(player), exit: player.exit && { ...player.exit, staffId: undefined } };
  }

  // What the host console and live monitor see (staff only).
  staffView(player) {
    return { ...this.privateView(player), ticketId: player.ticketId, fullName: player.fullName, flags: player.flags };
  }

  // The player's result for the current/last question, used to restore their screen on rejoin.
  // While the question is live only the chosen option is returned: right/wrong waits for the reveal.
  answerFor(player) {
    const a = this.answers[player.id];
    if (!a) return null;
    if (this.state === 'question') return { answer: a.answer, success: true };
    return { answer: a.answer, success: true, isCorrect: a.isCorrect, points: a.pointsEarned, badge: a.badge };
  }

  // Final order: players still in, then the eliminated (later exits first), then the
  // disqualified (who get no rank).
  rankedPlayers() {
    const all = Object.values(this.players);
    const active = all.filter(p => p.status === 'active').sort(byStanding);
    const eliminated = all.filter(p => p.status === 'eliminated')
      .sort((a, b) => (b.exit.round - a.exit.round) || byStanding(a, b));
    const disqualified = all.filter(p => p.status === 'disqualified').sort(byStanding);
    return [...active, ...eliminated, ...disqualified];
  }

  getPlayersList() {
    return this.rankedPlayers().map(publicPlayer);
  }

  getStaffPlayersList() {
    return this.rankedPlayers().map(p => this.staffView(p));
  }

  // Players who can still answer and are online (the "answers in" denominator).
  connectedCount() {
    return this.activePlayers().filter(p => p.connected).length;
  }

  startGame() {
    if (this.state !== 'lobby') return { error: 'Game already started' };
    if (this.questions.length === 0) return { error: 'No questions loaded' };
    this.state = 'intro';
    this.currentQuestionIndex = 0;
    this.currentLevel = this.questions[0].level || 1;
    return { success: true };
  }

  // Advances to the next question, showing a level intro first whenever the level changes.
  startQuestion() {
    if (this.state !== 'intro' && this.state !== 'leaderboard') return { error: 'Cannot start a question now' };
    if (this.currentQuestionIndex >= this.questions.length || this.activePlayers().length === 0) {
      this.state = 'podium';
      return { success: true };
    }

    const q = this.currentQuestion();
    if (this.state !== 'intro' && (q.level || 1) !== this.currentLevel) {
      this.currentLevel = q.level || 1;
      this.state = 'intro';
      return { success: true };
    }

    this.currentLevel = q.level || 1;
    this.state = 'question';
    this.questionStartTime = Date.now();
    this.questionEndsAt = this.questionStartTime + (q.timeLimit || 20) * 1000;
    this.answers = {};
    this.firstBloodAwarded = false;
    return { success: true };
  }

  // Returns { success, answer } — the recorded answer is for the server-side log only; the phone
  // gets just { success: true }.
  submitAnswer(socketId, answer) {
    const player = this.playerBySocket(socketId);
    if (!player) return { error: 'You are not in this game' };
    if (player.status !== 'active') return { error: player.status === 'disqualified' ? 'You have been disqualified' : "You're out of the game — you can keep watching" };
    if (this.state !== 'question') return { error: 'Not accepting answers now' };
    if (this.answers[player.id]) return { error: 'Already answered' };

    const q = this.currentQuestion();
    if (typeof answer !== 'string' || !answer) return { error: 'Invalid answer' };
    if (q.options?.length && !q.options.includes(answer)) return { error: 'Invalid option' };

    const now = Date.now();
    if (now > this.questionEndsAt + ANSWER_GRACE_MS) return { error: "Time's up" };

    const timeTaken = now - this.questionStartTime;
    const isCorrect = answer.toLowerCase() === String(q.correctAnswer).toLowerCase();

    let points = 0;
    let badge = null;

    if (isCorrect) {
      const timeLimitMs = (q.timeLimit || 20) * 1000;
      const timeRemaining = Math.max(0, timeLimitMs - timeTaken);
      const { multiplier } = this.levelInfo(this.currentLevel);

      // Base points + time bonus
      const baseScore = (q.points || 1000) * multiplier;
      points = Math.round(baseScore * (0.5 + 0.5 * (timeRemaining / timeLimitMs)));

      if (!this.firstBloodAwarded) {
        points += 200;
        this.firstBloodAwarded = true;
        badge = 'First Blood';
      }

      // Score and streak are applied in endQuestion, so nothing the player can see changes before the reveal.
      if (player.streak + 1 >= 3) {
        points += 100;
        if (!badge) badge = 'Streak Master';
      }
      if (timeTaken < 2000 && !badge) badge = 'Lightning';
      if (timeTaken < FAST_CORRECT_MS && (q.timeLimit || 20) >= 10) player.flags.fastCorrect += 1;
    }
    player.totalResponseTime += timeTaken;

    const record = { participantId: player.id, answer, time: timeTaken, isCorrect, pointsEarned: points, badge };
    this.answers[player.id] = record;
    return { success: true, record, player };
  }

  answeredCount() {
    return Object.keys(this.answers).length;
  }

  // Returns null if no question is live (guards against the auto-timer and host both ending it).
  endQuestion() {
    if (this.state !== 'question') return null;
    this.state = 'leaderboard';

    const q = this.currentQuestion();
    const stats = {};
    (q.options || []).forEach(o => { stats[o] = 0; });

    let speedStar = null;
    let minTime = Infinity;
    for (const a of Object.values(this.answers)) {
      stats[a.answer] = (stats[a.answer] || 0) + 1;
      if (a.isCorrect && a.time < minTime) {
        minTime = a.time;
        speedStar = this.players[a.participantId]?.name || null;
      }
    }

    // Apply the scores at the reveal. A wrong answer or no answer breaks the streak, and no
    // answer counts as the full timer for tie-breaks.
    for (const p of this.activePlayers()) {
      this.closeAway(p);
      const a = this.answers[p.id];
      if (!a) p.totalResponseTime += (q.timeLimit || 20) * 1000;
      if (a?.isCorrect) {
        p.score += a.pointsEarned;
        p.streak += 1;
      } else {
        p.streak = 0;
      }
    }

    this.currentQuestionIndex++;
    const next = this.questions[this.currentQuestionIndex];
    const level = q.level || 1;
    // End of a level with a cut, and another level follows: eliminate everyone below the cut.
    const elimination = next && (next.level || 1) !== level && this.levelInfo(level).qualifyTop
      ? this.applyCut(level)
      : null;

    this.lastResult = {
      state: this.state,
      correctAnswer: q.correctAnswer,
      stats,
      speedStar,
      leaderboard: this.activePlayers().sort(byStanding).slice(0, 10).map(publicPlayer),
      isLastQuestion: !next || this.activePlayers().length === 0,
      elimination,
    };
    return this.lastResult;
  }

  getState() {
    const q = this.state === 'question' ? this.currentQuestion() : null;
    return {
      state: this.state,
      currentQuestionIndex: this.currentQuestionIndex,
      currentLevel: this.levelInfo(this.currentLevel).round, // round number shown to people
      totalLevels: this.levelNumbers().length,
      totalQuestions: this.questions.length,
      levelConfig: this.levelInfo(this.currentLevel),
      playersLeft: this.activePlayers().length,
      questionStartTime: this.questionStartTime,
      questionEndsAt: this.questionEndsAt,
      serverNow: Date.now(),
      // Never send the correct answer while a question is live.
      currentQuestion: q ? {
        id: q.id,
        level: q.level,
        text: q.text,
        type: q.type,
        options: q.options,
        timeLimit: q.timeLimit,
        imageUrl: q.imageUrl,
      } : null,
      finalLeaderboard: this.state === 'podium' ? this.getPlayersList() : null,
    };
  }
}

module.exports = new GameEngine();
module.exports.ANSWER_GRACE_MS = ANSWER_GRACE_MS;
