const { randomUUID, randomBytes } = require('crypto');

// Answers arriving this long after the deadline are still accepted (network latency).
const ANSWER_GRACE_MS = 1000;
const MAX_NAME_LENGTH = 20;

const LEVELS = {
  1: { multiplier: 1, name: 'Warm-up', theme: 'blue' },
  2: { multiplier: 2, name: 'Core Tech', theme: 'purple' },
  3: { multiplier: 3, name: 'Brain Burner', theme: 'red' },
};

function shuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// What other clients may see about a player (never the rejoin token).
function publicPlayer(p) {
  return { id: p.id, name: p.name, team: p.team, score: p.score, streak: p.streak, connected: p.connected };
}

class GameEngine {
  constructor() {
    this.questions = [];
    this.reset();
  }

  reset() {
    this.gameId = randomUUID(); // games.id in Supabase
    this.state = 'lobby'; // lobby, intro, question, leaderboard, podium
    // participantId -> { id, token, socketId, connected, name, team, score, streak, droneAssists, totalResponseTime }
    this.players = {};
    this.tokens = {};  // rejoin token -> participantId
    this.sockets = {}; // socketId -> participantId
    this.currentQuestionIndex = -1; // index of the question being asked, or the next one to ask
    this.currentLevel = this.questions[0]?.level || 1;
    this.questionStartTime = null;
    this.questionEndsAt = null;
    this.answers = {};    // participantId -> { participantId, answer, time, isCorrect, pointsEarned, badge }
    this.droneUsed = {};  // participantId -> true, for the current question
    this.firstBloodAwarded = false;
    this.lastResult = null; // reveal data for the last question, resent to screens that (re)connect
  }

  setQuestions(questions) {
    this.questions = questions;
  }

  currentQuestion() {
    return this.questions[this.currentQuestionIndex];
  }

  playerBySocket(socketId) {
    return this.players[this.sockets[socketId]];
  }

  addPlayer(socketId, rawName, rawTeam) {
    if (this.sockets[socketId]) return { error: 'Already joined' };
    const name = typeof rawName === 'string' ? rawName.trim() : '';
    if (!name || name.length > MAX_NAME_LENGTH) return { error: `Name must be 1-${MAX_NAME_LENGTH} characters` };
    const team = typeof rawTeam === 'string' ? rawTeam.trim().slice(0, 30) : '';

    const isDuplicate = Object.values(this.players).some(p => p.name.toLowerCase() === name.toLowerCase());
    if (isDuplicate) return { error: 'Name already taken' };

    const player = {
      id: randomUUID(), // participants.id in Supabase
      token: randomBytes(16).toString('hex'),
      socketId,
      connected: true,
      name,
      team,
      score: 0,
      streak: 0,
      droneAssists: 2,
      totalResponseTime: 0,
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
    this.sockets[socketId] = player.id;
    return { success: true, player: this.privateView(player), previousSocketId };
  }

  disconnect(socketId) {
    const player = this.playerBySocket(socketId);
    delete this.sockets[socketId];
    if (!player || player.socketId !== socketId) return null;
    player.socketId = null;
    player.connected = false;
    return player;
  }

  removePlayer(participantId) {
    const player = this.players[participantId];
    if (!player) return null;
    delete this.players[participantId];
    delete this.tokens[player.token];
    if (player.socketId) delete this.sockets[player.socketId];
    return player;
  }

  // What a player may see about themselves.
  privateView(player) {
    return { ...publicPlayer(player), droneAssists: player.droneAssists };
  }

  // The player's result for the current/last question, used to restore their screen on rejoin.
  answerFor(player) {
    const a = this.answers[player.id];
    return a ? { answer: a.answer, success: true, isCorrect: a.isCorrect, points: a.pointsEarned, badge: a.badge } : null;
  }

  rankedPlayers() {
    return Object.values(this.players).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.totalResponseTime - b.totalResponseTime;
    });
  }

  getPlayersList() {
    return this.rankedPlayers().map(publicPlayer);
  }

  connectedCount() {
    return Object.values(this.players).filter(p => p.connected).length;
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
    if (this.currentQuestionIndex >= this.questions.length) {
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
    this.droneUsed = {};
    this.firstBloodAwarded = false;
    return { success: true };
  }

  submitAnswer(socketId, answer) {
    const player = this.playerBySocket(socketId);
    if (!player) return { error: 'You are not in this game' };
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
      const multiplier = LEVELS[this.currentLevel]?.multiplier || 1;

      // Base points + time bonus
      const baseScore = (q.points || 1000) * multiplier;
      points = Math.round(baseScore * (0.5 + 0.5 * (timeRemaining / timeLimitMs)));

      if (!this.firstBloodAwarded) {
        points += 200;
        this.firstBloodAwarded = true;
        badge = 'First Blood';
      }

      player.streak += 1;
      if (player.streak >= 3) {
        points += 100;
        if (!badge) badge = 'Streak Master';
      }
      if (timeTaken < 2000 && !badge) badge = 'Lightning';
      player.score += points;
    } else {
      player.streak = 0;
    }
    player.totalResponseTime += timeTaken;

    this.answers[player.id] = {
      participantId: player.id,
      answer,
      time: timeTaken,
      isCorrect,
      pointsEarned: points,
      badge,
    };

    return { success: true, points, isCorrect, badge };
  }

  answeredCount() {
    return Object.keys(this.answers).length;
  }

  useDroneAssist(socketId) {
    const player = this.playerBySocket(socketId);
    if (!player) return { error: 'You are not in this game' };
    if (this.state !== 'question') return { error: 'Can only use during a question' };
    if (player.droneAssists <= 0) return { error: 'No 50/50 lifelines left' };
    if (this.droneUsed[player.id]) return { error: 'Already used on this question' };
    if (this.answers[player.id]) return { error: 'Already answered' };

    const q = this.currentQuestion();
    if (q.type !== 'mcq') return { error: '50/50 only works on multiple-choice questions' };

    player.droneAssists -= 1;
    this.droneUsed[player.id] = true;
    const correct = String(q.correctAnswer).toLowerCase();
    const removedOptions = shuffle(q.options.filter(o => o.toLowerCase() !== correct)).slice(0, 2);
    return { success: true, removedOptions, droneAssists: player.droneAssists };
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

    // Not answering breaks a streak too.
    for (const p of Object.values(this.players)) {
      if (!this.answers[p.id]) p.streak = 0;
    }

    this.currentQuestionIndex++;

    this.lastResult = {
      state: this.state,
      correctAnswer: q.correctAnswer,
      stats,
      speedStar,
      leaderboard: this.getPlayersList().slice(0, 10),
      isLastQuestion: this.currentQuestionIndex >= this.questions.length,
    };
    return this.lastResult;
  }

  getState() {
    const q = this.state === 'question' ? this.currentQuestion() : null;
    return {
      state: this.state,
      currentQuestionIndex: this.currentQuestionIndex,
      currentLevel: this.currentLevel,
      totalQuestions: this.questions.length,
      levelConfig: LEVELS[this.currentLevel],
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
