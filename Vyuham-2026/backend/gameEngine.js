const { randomUUID } = require('crypto');

class GameEngine {
  constructor() {
    this.questions = [];
    this.reset();
  }

  reset() {
    this.gameId = randomUUID(); // games.id in Supabase
    this.state = 'lobby'; // lobby, intro, question, leaderboard, podium
    this.players = {}; // socketId -> { id, participantId, name, score, streak, droneAssists, team, totalResponseTime }
    this.currentQuestionIndex = -1;
    this.currentLevel = 1;
    this.questionStartTime = null;
    this.answers = {}; // socketId -> { answer, time, isCorrect, pointsEarned }
    this.levelConfig = {
      1: { multiplier: 1, name: 'Warm-up', theme: 'blue' },
      2: { multiplier: 2, name: 'Core Tech', theme: 'purple' },
      3: { multiplier: 3, name: 'Brain Burner', theme: 'red' },
    };
    this.firstBloodAwarded = false;
  }

  setQuestions(questions) {
    this.questions = questions;
  }

  addPlayer(socketId, name, team = '') {
    // Check duplicate name
    const isDuplicate = Object.values(this.players).some(p => p.name.toLowerCase() === name.toLowerCase());
    if (isDuplicate) return { error: 'Name already taken' };

    this.players[socketId] = {
      id: socketId,
      participantId: randomUUID(), // participants.id in Supabase
      name,
      team,
      score: 0,
      streak: 0,
      droneAssists: 2,
      totalResponseTime: 0
    };
    return { success: true, player: this.players[socketId] };
  }

  removePlayer(socketId) {
    if (this.players[socketId]) {
      delete this.players[socketId];
      return true;
    }
    return false;
  }

  getPlayersList() {
    return Object.values(this.players).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.totalResponseTime - b.totalResponseTime;
    });
  }

  startGame() {
    this.state = 'intro';
    this.currentQuestionIndex = 0;
    this.currentLevel = this.questions[0]?.level || 1;
    return this.getState();
  }

  startQuestion() {
    if (this.currentQuestionIndex >= this.questions.length) {
      this.state = 'podium';
      return this.getState();
    }
    
    const q = this.questions[this.currentQuestionIndex];
    this.currentLevel = q.level;
    this.state = 'question';
    this.questionStartTime = Date.now();
    this.answers = {};
    this.firstBloodAwarded = false;

    return this.getState();
  }

  submitAnswer(socketId, answer) {
    if (this.state !== 'question') return { error: 'Not accepting answers now' };
    if (this.answers[socketId]) return { error: 'Already answered' };

    const q = this.questions[this.currentQuestionIndex];
    if (!q) return { error: 'No current question' };

    const timeTaken = Date.now() - this.questionStartTime;
    const isCorrect = answer.toString().toLowerCase() === q.correctAnswer.toString().toLowerCase();
    
    let points = 0;
    let badge = null;
    
    if (isCorrect) {
      const timeLimitMs = (q.timeLimit || 20) * 1000;
      const timeRemaining = Math.max(0, timeLimitMs - timeTaken);
      
      const multiplier = this.levelConfig[this.currentLevel]?.multiplier || 1;
      
      // Base points + time bonus
      const baseScore = 1000 * multiplier;
      points = Math.round(baseScore * (0.5 + 0.5 * (timeRemaining / timeLimitMs)));

      // First blood bonus
      if (!this.firstBloodAwarded) {
        points += 200;
        this.firstBloodAwarded = true;
        badge = 'First Blood';
      }

      // Streak bonus
      const player = this.players[socketId];
      if (player) {
        player.streak += 1;
        if (player.streak >= 3) {
          points += 100;
          if (!badge) badge = 'Streak Master';
        }
        if (timeTaken < 2000 && !badge) {
          badge = 'Lightning';
        }
        player.score += points;
        player.totalResponseTime += timeTaken;
      }
    } else {
      const player = this.players[socketId];
      if (player) {
        player.streak = 0;
        player.totalResponseTime += timeTaken;
      }
    }

    this.answers[socketId] = {
      participantId: this.players[socketId]?.participantId,
      answer,
      time: timeTaken,
      isCorrect,
      pointsEarned: points,
      badge
    };

    return { success: true, points, isCorrect, badge };
  }

  useDroneAssist(socketId) {
    const player = this.players[socketId];
    if (!player || player.droneAssists <= 0) return { error: 'No drone assists left' };
    if (this.state !== 'question') return { error: 'Can only use during question' };
    
    const q = this.questions[this.currentQuestionIndex];
    if (q.type !== 'mcq') return { error: 'Drone assist only works for MCQs' };

    // Cost: 20% of the question's base points
    player.droneAssists -= 1;
    
    const wrongOptions = q.options.filter(o => o.toLowerCase() !== q.correctAnswer.toLowerCase());
    // Shuffle and pick 2
    wrongOptions.sort(() => Math.random() - 0.5);
    const removedOptions = wrongOptions.slice(0, 2);

    return { success: true, removedOptions };
  }

  endQuestion() {
    this.state = 'leaderboard';
    // Calculate stats
    const q = this.questions[this.currentQuestionIndex];
    const stats = {};
    if (q && q.options) {
       q.options.forEach(o => stats[o] = 0);
    }
    let speedStar = null;
    let minTime = Infinity;

    Object.values(this.answers).forEach(a => {
      if (stats[a.answer] !== undefined) stats[a.answer]++;
      else stats[a.answer] = 1;

      if (a.isCorrect && a.time < minTime) {
        minTime = a.time;
        // find player
        const playerId = Object.keys(this.answers).find(id => this.answers[id] === a);
        if (playerId && this.players[playerId]) {
          speedStar = this.players[playerId].name;
        }
      }
    });

    this.currentQuestionIndex++;

    return {
      state: this.state,
      correctAnswer: q ? q.correctAnswer : null,
      stats,
      speedStar,
      leaderboard: this.getPlayersList().slice(0, 10)
    };
  }

  getState() {
    return {
      state: this.state,
      currentQuestionIndex: this.currentQuestionIndex,
      currentLevel: this.currentLevel,
      questionStartTime: this.questionStartTime,
      // Hide correct answer from clients during question
      currentQuestion: this.state === 'question' ? {
        ...this.questions[this.currentQuestionIndex],
        correctAnswer: undefined 
      } : null,
      totalQuestions: this.questions.length,
      levelConfig: this.levelConfig[this.currentLevel]
    };
  }
}

module.exports = new GameEngine();
