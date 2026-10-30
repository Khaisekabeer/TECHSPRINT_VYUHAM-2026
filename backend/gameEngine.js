const { randomUUID, randomBytes } = require('crypto');

// Answers arriving this long after the deadline are still accepted (network latency).
const ANSWER_GRACE_MS = 1000;
const MAX_NAME_LENGTH = 20;
// A correct answer faster than this on a question of 10 s or more is flagged for staff to review.
const FAST_CORRECT_MS = 1500;
// Avatar picked on the phone: style (a = cartoon person, b = robot) and a seed, drawn in the browser.
const AVATAR_RE = /^[ab]:[A-Za-z0-9]{1,16}$/;
// Level themes; a level without one gets the next in this order by its round.
const THEME_ORDER = ['blast', 'pop', 'arcade', 'circuit'];
// Scoring rules the coordinator can switch off in the lobby. These defaults are the original rules.
const DEFAULT_RULES = {
  multiplier: true,  // each level's points multiplier
  firstBlood: true,  // +20% of base for the first correct answer on each question
  streak: true,      // +10% of base for each correct answer once a streak of 3 is reached
  roundReset: false, // every player starts each round at 0 points (and the cut uses round points)
};

// What other clients may see about a player (never the rejoin token or ticket).
function publicPlayer(p) {
  return { id: p.id, name: p.name, avatar: p.avatar, team: p.team, score: p.score, streak: p.streak, connected: p.connected, status: p.status, time: p.totalResponseTime };
}

// Standings: higher score first; on a tie, less total answer time (a skipped question counts as
// its full timer, so skipping never helps).
const byStanding = (a, b) => (b.score - a.score) || (a.totalResponseTime - b.totalResponseTime);

// How a level's cut reads on screens and in the records.
function cutLabel({ rule, value }) {
  switch (rule) {
    case 'top': return `Top ${value} go through`;
    case 'percent': return `Top ${value}% go through`;
    case 'min_score': return `${value}+ points to go through`;
    case 'bottom': return `Bottom ${value} are out`;
    case 'min_correct': return `${value}+ correct answers to go through`;
    default: return '';
  }
}

class GameEngine {
  constructor() {
    this.questions = [];
    // Coordinator's choice, kept across resets: hide the standings during the last round so the
    // winner is only revealed at the final results.
    this.hideFinalStandings = false;
    // Scoring rules, chosen by the coordinator before the game starts; kept across resets.
    this.rules = { ...DEFAULT_RULES };
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
    // End-of-level cut waiting for the coordinator: { level, info, keep: Set, out: Set }.
    this.pendingCut = null;
  }

  setQuestions(questions) {
    this.questions = questions;
  }

  // Levels come with the questions (levelName, multiplier, cut, theme set by the quiz master).
  // The round number is the level's place among the levels in this game, so gaps don't show.
  levelNumbers() {
    return [...new Set(this.questions.map(q => q.level || 1))];
  }

  levelInfo(level) {
    const q = this.questions.find(x => (x.level || 1) === level);
    const multiplier = Number(q?.multiplier);
    const levels = this.levelNumbers();
    const round = Math.max(1, levels.indexOf(level) + 1);
    const isLast = levels[levels.length - 1] === level;
    const rawCut = q?.cut?.rule && Number.isFinite(Number(q.cut.value))
      ? { rule: q.cut.rule, value: Number(q.cut.value), ties: q.cut.ties === 'include' ? 'include' : 'speed' }
      : null;
    return {
      number: level,
      round,
      name: q?.levelName || `Level ${level}`,
      multiplier: multiplier > 0 ? multiplier : 1,
      // The cut at the end of this level (none on the final level).
      cut: rawCut && !isLast ? { ...rawCut, label: cutLabel(rawCut) } : null,
      theme: q?.theme || THEME_ORDER[(round - 1) % THEME_ORDER.length],
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
  addPlayer(socketId, rawName, rawTeam, ticket = null, rawAvatar = null) {
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
      avatar: typeof rawAvatar === 'string' && AVATAR_RE.test(rawAvatar) ? rawAvatar : `b:${randomBytes(4).toString('hex')}`,
      score: 0,
      streak: 0,
      totalResponseTime: 0,
      levelCorrect: {}, // level number -> correct answers in that level (for "min correct" cuts)
      answers: { correct: 0, wrong: 0, skipped: 0 }, // over the whole game, for the dashboard
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

  // ─── Elimination ────────────────────────────────────────────────────────────
  activePlayers() {
    return Object.values(this.players).filter(p => p.status === 'active');
  }

  // Who would go through if the level's cut were applied now. Rules (set per level):
  //   top N · top X% · bottom N out · score of at least X · at least K correct in this level.
  // Ties at the line: 'speed' = the faster player wins; 'include' = everyone tied goes through.
  computeCut(levelNumber) {
    const info = this.levelInfo(levelNumber);
    const cut = info.cut;
    if (!cut) return null;
    const ranked = this.activePlayers().sort(byStanding);
    const byCount = n => {
      const count = Math.max(0, Math.min(ranked.length, Math.floor(n)));
      if (count >= ranked.length) return ranked;
      if (count === 0) return [];
      if (cut.ties === 'include') {
        const line = ranked[count - 1].score;
        return ranked.filter(p => p.score >= line);
      }
      return ranked.slice(0, count);
    };
    let through;
    switch (cut.rule) {
      case 'top': through = byCount(cut.value); break;
      case 'percent': through = byCount(Math.ceil((ranked.length * cut.value) / 100)); break;
      case 'bottom': through = byCount(ranked.length - cut.value); break;
      case 'min_score': through = ranked.filter(p => p.score >= cut.value); break;
      case 'min_correct': through = ranked.filter(p => (p.levelCorrect[levelNumber] || 0) >= cut.value); break;
      default: through = ranked;
    }
    const keep = new Set(through.map(p => p.id));
    return { info, ranked, keep, out: ranked.filter(p => !keep.has(p.id)).map(p => p.id) };
  }

  // The proposed cut for the coordinator to review (staff only).
  pendingCutView() {
    const pc = this.pendingCut;
    if (!pc) return null;
    const ranked = this.activePlayers().sort(byStanding);
    const row = (p, i) => ({
      id: p.id, name: p.name, avatar: p.avatar, ticketId: p.ticketId, rank: i + 1, score: p.score,
      correctInLevel: p.levelCorrect[pc.level] || 0,
    });
    const rows = ranked.map(row);
    return {
      level: pc.level,
      round: pc.info.round,
      levelName: pc.info.name,
      label: pc.info.cut.label,
      ties: pc.info.cut.ties,
      advance: rows.filter(r => pc.keep.has(r.id)),
      out: rows.filter(r => pc.out.has(r.id)),
    };
  }

  // Coordinator moves a player across the line before confirming.
  adjustCut(participantId, keep) {
    const pc = this.pendingCut;
    if (!pc) return { error: 'There is no cut waiting' };
    if (!this.players[participantId] || this.players[participantId].status !== 'active') return { error: 'Player not found' };
    if (keep) { pc.out.delete(participantId); pc.keep.add(participantId); } else { pc.keep.delete(participantId); pc.out.add(participantId); }
    return { success: true };
  }

  // Apply the cut: everyone in `out` is eliminated with their rank at that moment.
  confirmCut(staffId = null) {
    const pc = this.pendingCut;
    if (!pc) return { error: 'There is no cut waiting' };
    const ranked = this.activePlayers().sort(byStanding);
    const before = new Map(ranked.map((p, i) => [p.id, { rank: i + 1, score: p.score }]));
    const out = ranked.filter(p => pc.out.has(p.id));
    for (const p of out) {
      this.closeAway(p);
      p.status = 'eliminated';
      p.exit = {
        reason: 'cut', level: pc.level, round: pc.info.round, levelName: pc.info.name,
        rank: before.get(p.id).rank, score: p.score, note: `${pc.info.cut.label} after ${pc.info.name}`, staffId,
      };
    }
    this.pendingCut = null;
    const elimination = {
      level: pc.level, round: pc.info.round, levelName: pc.info.name, label: pc.info.cut.label,
      advanced: ranked.length - out.length,
      eliminated: out.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, rank: p.exit.rank, score: p.score })),
    };
    // Survivors move up; prevRank lets the projector animate the change.
    const leaderboard = this.activePlayers().sort(byStanding)
      .map(p => ({ ...publicPlayer(p), prevRank: before.get(p.id).rank, prevScore: p.score }));
    const roundEnd = { round: pc.info.round, levelName: pc.info.name, isFinal: false, cutPending: false, cutLabel: pc.info.cut.label, eliminated: out.length };
    this.lastResult = { ...this.lastResult, leaderboard, elimination, pendingCut: null, atRisk: [], roundEnd };
    return { success: true, elimination, out, leaderboard, roundEnd };
  }

  // Coordinator eliminates one player directly (e.g. a panel decision). Not a disqualification:
  // they keep a rank among the eliminated.
  eliminate(participantId, note, staffId = null) {
    const player = this.players[participantId];
    if (!player) return { error: 'Player not found' };
    if (player.status !== 'active') return { error: 'That player is already out' };
    const info = this.levelInfo(this.currentLevel);
    const rank = this.activePlayers().sort(byStanding).indexOf(player) + 1;
    this.closeAway(player);
    if (this.state === 'question') delete this.answers[player.id];
    this.pendingCut?.keep.delete(player.id);
    this.pendingCut?.out.delete(player.id);
    player.status = 'eliminated';
    player.exit = {
      reason: 'manual', level: info.number, round: info.round, levelName: info.name,
      rank, score: player.score, note: note || 'Eliminated by the quiz host', staffId,
    };
    return { success: true, player };
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
    this.pendingCut?.keep.delete(player.id);
    this.pendingCut?.out.delete(player.id);
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
    return { ...publicPlayer(player), answers: player.answers, exit: player.exit && { ...player.exit, staffId: undefined } };
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

  // Coordinator's scoring rules (lobby only). Unknown keys are ignored; the rules are fixed once the game starts.
  setRules(input) {
    if (this.state !== 'lobby') return { error: 'Scoring can only be changed before the game starts' };
    const next = { ...this.rules };
    for (const key of Object.keys(DEFAULT_RULES)) {
      if (typeof input?.[key] === 'boolean') next[key] = input[key];
    }
    this.rules = next;
    return { success: true, rules: { ...this.rules } };
  }

  // Round reset: everyone still in starts the new round at 0 (the tie-break time restarts too).
  resetRoundScores() {
    this.activePlayers().forEach(p => { p.score = 0; p.streak = 0; p.totalResponseTime = 0; });
  }

  // The level's details as shown to players: with the multiplier rule off, every level counts ×1.
  levelConfigShown() {
    const info = this.levelInfo(this.currentLevel);
    return this.rules.multiplier ? info : { ...info, multiplier: 1 };
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
    if (!['intro', 'leaderboard', 'video'].includes(this.state)) return { error: 'Cannot start a question now' };
    if (this.pendingCut) return { error: 'Confirm the cut first — it is waiting below' };
    if (this.currentQuestionIndex >= this.questions.length || this.activePlayers().length === 0) {
      this.state = 'podium';
      return { success: true };
    }

    const q = this.currentQuestion();
    if (this.state !== 'intro' && (q.level || 1) !== this.currentLevel) {
      this.currentLevel = q.level || 1;
      this.state = 'intro';
      if (this.rules.roundReset) this.resetRoundScores();
      return { success: true };
    }

    // A video question plays its video first: no question, no answers and no timer until it ends.
    if (q.video && this.state !== 'video') {
      this.currentLevel = q.level || 1;
      this.state = 'video';
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
      const multiplier = this.rules.multiplier ? this.levelInfo(this.currentLevel).multiplier : 1;

      // Base points + time bonus
      const baseScore = (q.points || 1000) * multiplier;
      points = Math.round(baseScore * (0.5 + 0.5 * (timeRemaining / timeLimitMs)));

      if (this.rules.firstBlood && !this.firstBloodAwarded) {
        points += Math.round(baseScore * 0.20);
        this.firstBloodAwarded = true;
        badge = '1st to Answer';
      }

      // Score and streak are applied in endQuestion, so nothing the player can see changes before the reveal.
      if (this.rules.streak && player.streak + 1 >= 3) {
        points += Math.round(baseScore * 0.10);
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
    const level = q.level || 1;
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

    // Standings before this question, so the projector can show the old order first and animate.
    const before = new Map(this.activePlayers().sort(byStanding).map((p, i) => [p.id, { rank: i + 1, score: p.score }]));

    // Apply the scores at the reveal. A wrong answer or no answer breaks the streak, and no
    // answer counts as the full timer for tie-breaks.
    for (const p of this.activePlayers()) {
      this.closeAway(p);
      const a = this.answers[p.id];
      if (!a) p.totalResponseTime += (q.timeLimit || 20) * 1000;
      p.answers[!a ? 'skipped' : a.isCorrect ? 'correct' : 'wrong'] += 1;
      if (a?.isCorrect) {
        p.score += a.pointsEarned;
        p.streak += 1;
        p.levelCorrect[level] = (p.levelCorrect[level] || 0) + 1;
      } else {
        p.streak = 0;
      }
    }

    this.currentQuestionIndex++;
    const next = this.questions[this.currentQuestionIndex];
    const levelEnds = !next || (next.level || 1) !== level;
    // Who is below the line right now (shown as "at risk" during the level). At the level's end
    // the cut waits for the coordinator to review and confirm it.
    const proposal = this.computeCut(level);
    let pendingCut = null;
    let elimination = null;
    if (levelEnds && proposal) {
      if (proposal.out.length) {
        this.pendingCut = { level, info: proposal.info, keep: proposal.keep, out: new Set(proposal.out) };
        pendingCut = { label: proposal.info.cut.label, advancing: proposal.keep.size, out: proposal.out.length };
      } else {
        elimination = { level, round: proposal.info.round, levelName: proposal.info.name, label: proposal.info.cut.label, advanced: proposal.keep.size, eliminated: [] };
      }
    }
    // Told to every phone at the reveal, so players know the round is over (and whether a cut follows).
    const endedLevel = this.levelInfo(level);
    const roundEnd = levelEnds ? {
      round: endedLevel.round, levelName: endedLevel.name, isFinal: !next, cutPending: !!pendingCut,
      cutLabel: endedLevel.cut?.label ?? null, eliminated: 0,
    } : null;

    this.lastResult = {
      state: this.state,
      correctAnswer: q.correctAnswer,
      note: q.note || null,
      stats,
      speedStar,
      // Everyone still in, in order (the projector adapts its layout to the count), with their
      // previous rank and score for the animation.
      leaderboard: this.activePlayers().sort(byStanding).map(p => ({
        ...publicPlayer(p), prevRank: before.get(p.id)?.rank ?? null, prevScore: before.get(p.id)?.score ?? p.score,
      })),
      atRisk: proposal ? proposal.out : [],
      cutLabel: proposal ? proposal.info.cut.label : null,
      pendingCut,
      elimination,
      roundEnd,
      hasImage: !!q.image,
      questionIndex: this.currentQuestionIndex - 1,
      isLastQuestion: !next || this.activePlayers().length === 0,
    };
    return this.lastResult;
  }

  // A player's place among those still in (for their phone at each reveal).
  standingOf(player) {
    if (player.status !== 'active') return null;
    const ranked = this.activePlayers().sort(byStanding);
    return {
      rank: ranked.indexOf(player) + 1,
      of: ranked.length,
      atRisk: !!this.lastResult?.atRisk?.includes(player.id),
      cutLabel: this.lastResult?.cutLabel ?? null,
    };
  }

  // A question's picture, only once that question is live (or already revealed).
  liveImage(index) {
    const q = this.questions[index];
    if (!q?.image) return null;
    const shown = index < this.currentQuestionIndex || (this.state === 'question' && index === this.currentQuestionIndex);
    return shown ? q.image : null;
  }

  getState() {
    const q = this.state === 'question' ? this.currentQuestion() : null;
    return {
      state: this.state,
      currentQuestionIndex: this.currentQuestionIndex,
      currentLevel: this.levelInfo(this.currentLevel).round, // round number shown to people
      totalLevels: this.levelNumbers().length,
      totalQuestions: this.questions.length,
      levelConfig: this.levelConfigShown(),
      rules: { ...this.rules },
      playersLeft: this.activePlayers().length,
      cutPending: !!this.pendingCut,
      hideFinalStandings: this.hideFinalStandings,
      standingsHidden: this.hideFinalStandings && this.state !== 'lobby' && this.state !== 'podium'
        && this.levelNumbers().at(-1) === this.currentLevel,
      questionStartTime: this.questionStartTime,
      questionEndsAt: this.questionEndsAt,
      serverNow: Date.now(),
      // The video of the next question, only while it is playing (the projector shows it).
      video: this.state === 'video' ? this.currentQuestion()?.video ?? null : null,
      // The note explains the answer, so like the answer it is sent only at the reveal.
      answerNote: this.state === 'leaderboard' ? this.lastResult?.note ?? null : null,
      // Never send the correct answer while a question is live.
      currentQuestion: q ? {
        id: q.id,
        level: q.level,
        text: q.text,
        type: q.type,
        options: q.options,
        timeLimit: q.timeLimit,
        hasImage: !!q.image,
        // Where the picture is served from (the game server), only while this question is live.
        imageUrl: q.image ? `/live-image/${this.currentQuestionIndex}?g=${this.gameId}` : null,
      } : null,
      finalLeaderboard: this.state === 'podium' ? this.getPlayersList() : null,
    };
  }
}

module.exports = new GameEngine();
module.exports.ANSWER_GRACE_MS = ANSWER_GRACE_MS;
module.exports.DEFAULT_RULES = DEFAULT_RULES;
