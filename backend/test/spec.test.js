// Spec tests for the game rules, the question vault and staff passwords.
// No database or network: the store module is replaced by a stub before anything loads it.
// Run from backend/: npm test
const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const crypto = require('crypto');

process.env.QUESTION_VAULT_SECRET = process.env.QUESTION_VAULT_SECRET || crypto.randomBytes(32).toString('base64');
require.cache[path.join(__dirname, '..', 'store.js')] = {
  id: 'store', filename: 'store', loaded: true, exports: {},
};

const engine = require('../gameEngine');
const vault = require('../vault');
const auth = require('../auth');

const ANSWER_GRACE_MS = engine.ANSWER_GRACE_MS;

// A question of a level, with optional cut and media.
const q = (id, level, extra = {}) => ({
  id, level, text: `Question ${id}`, type: 'mcq', options: ['A', 'B', 'C', 'D'], correctAnswer: 'A',
  timeLimit: 20, points: 1000, levelName: `Level ${level}`, multiplier: 1, cut: null, theme: null,
  image: null, video: null, ...extra,
});

const players = (n) => {
  for (let i = 0; i < n; i++) engine.addPlayer(`s${i + 1}`, `Player ${i + 1}`, 'Team', null, null);
};

// Put the engine into a live question with a fixed start time (so timing can be controlled).
const goLive = (elapsedMs = 0) => {
  engine.startGame();
  engine.startQuestion(); // intro -> question
  engine.questionStartTime = Date.now() - elapsedMs;
  engine.questionEndsAt = engine.questionStartTime + 20000;
};

beforeEach(() => {
  engine.reset();
  engine.rules = { ...engine.DEFAULT_RULES };
});

describe('scoring', () => {
  test('first correct answer gets the time bonus and the first-to-answer bonus', () => {
    engine.setQuestions([q(1, 1)]);
    players(1);
    goLive(10000); // 10 s of a 20 s timer used
    const r = engine.submitAnswer('s1', 'A');
    // 1000 × (0.5 + 0.5 × 10/20) = 750, plus 20% first-to-answer = 950
    assert.equal(r.record.isCorrect, true);
    assert.equal(r.record.pointsEarned, 950);
    assert.equal(r.record.badge, '1st to Answer');
  });

  test('a later correct answer gets no first-to-answer bonus', () => {
    engine.setQuestions([q(1, 1)]);
    players(2);
    goLive(10000);
    engine.submitAnswer('s1', 'A');
    const r = engine.submitAnswer('s2', 'A');
    assert.ok(Math.abs(r.record.pointsEarned - 750) <= 5, `expected about 750, got ${r.record.pointsEarned}`);
  });

  test('a wrong answer scores nothing', () => {
    engine.setQuestions([q(1, 1)]);
    players(1);
    goLive(1000);
    const r = engine.submitAnswer('s1', 'B');
    assert.equal(r.record.isCorrect, false);
    assert.equal(r.record.pointsEarned, 0);
  });

  test('points are multiplied by the level multiplier', () => {
    engine.setQuestions([q(1, 1, { multiplier: 2 }), q(2, 1, { multiplier: 2 })]);
    players(2);
    goLive(0);
    engine.submitAnswer('s1', 'A'); // first to answer takes the bonus
    const r = engine.submitAnswer('s2', 'A');
    // Second correct answer at the start: 1000 × 2 × 1.0 = 2000
    assert.ok(Math.abs(r.record.pointsEarned - 2000) <= 5, `expected about 2000, got ${r.record.pointsEarned}`);
  });
});

describe('answer rules', () => {
  test('an answer after the timer plus the grace period is rejected', () => {
    engine.setQuestions([q(1, 1)]);
    players(1);
    goLive(0);
    engine.questionEndsAt = Date.now() - ANSWER_GRACE_MS - 500;
    assert.equal(engine.submitAnswer('s1', 'A').error, "Time's up");
  });

  test('an answer inside the grace period is accepted', () => {
    engine.setQuestions([q(1, 1)]);
    players(1);
    goLive(0);
    engine.questionEndsAt = Date.now() - 200;
    assert.equal(engine.submitAnswer('s1', 'A').success, true);
  });

  test('a second answer to the same question is rejected', () => {
    engine.setQuestions([q(1, 1)]);
    players(1);
    goLive(0);
    engine.submitAnswer('s1', 'A');
    assert.equal(engine.submitAnswer('s1', 'B').error, 'Already answered');
  });

  test('an option that is not on the question is rejected', () => {
    engine.setQuestions([q(1, 1)]);
    players(1);
    goLive(0);
    assert.equal(engine.submitAnswer('s1', 'Z').error, 'Invalid option');
    assert.equal(engine.submitAnswer('s1', '').error, 'Invalid answer');
  });

  test('an eliminated player cannot answer', () => {
    engine.setQuestions([q(1, 1)]);
    players(2);
    goLive(0);
    engine.players[engine.sockets['s1']].status = 'eliminated';
    assert.match(engine.submitAnswer('s1', 'A').error, /out of the game/);
  });

  test('answers are only accepted while a question is live', () => {
    engine.setQuestions([q(1, 1)]);
    players(1);
    engine.startGame(); // intro, no question yet
    assert.equal(engine.submitAnswer('s1', 'A').error, 'Not accepting answers now');
  });
});

describe('cut rules', () => {
  // Five players with fixed scores; level 1 has the cut under test.
  const scored = (cut, scores = [500, 400, 300, 200, 100], extra = {}) => {
    engine.setQuestions([q(1, 1, { cut, ...extra }), q(2, 2)]);
    players(scores.length);
    Object.values(engine.players).forEach((p, i) => { p.score = scores[i]; p.levelCorrect = { 1: scores.length - i }; });
    return engine.computeCut(1);
  };

  test('top N: the best N go through, the rest are out', () => {
    const r = scored({ rule: 'top', value: 2, ties: 'speed' });
    assert.deepEqual(r.out.length, 3);
    assert.deepEqual(r.ranked.slice(0, 2).map(p => p.id).every(id => r.keep.has(id)), true);
  });

  test('top %: rounds up, so 40% of 5 players keeps 2', () => {
    const r = scored({ rule: 'percent', value: 40, ties: 'speed' });
    assert.equal(r.keep.size, 2);
  });

  test('bottom N: the bottom N are out', () => {
    const r = scored({ rule: 'bottom', value: 1, ties: 'speed' });
    assert.equal(r.out.length, 1);
    assert.equal(r.out[0], r.ranked[4].id);
  });

  test('minimum score: everyone at or above the value goes through', () => {
    const r = scored({ rule: 'min_score', value: 300, ties: 'speed' });
    assert.equal(r.keep.size, 3);
  });

  test('minimum correct answers in the level', () => {
    const r = scored({ rule: 'min_correct', value: 4, ties: 'speed' });
    assert.equal(r.keep.size, 2); // the players with 5 and 4 correct
  });

  test('a tie at the line: "speed" keeps only the cut count', () => {
    const r = scored({ rule: 'top', value: 2, ties: 'speed' }, [500, 300, 300, 300, 100]);
    assert.equal(r.keep.size, 2);
  });

  test('a tie at the line: "include" keeps everyone tied with the last place through', () => {
    const r = scored({ rule: 'top', value: 2, ties: 'include' }, [500, 300, 300, 300, 100]);
    assert.equal(r.keep.size, 4);
  });

  test('the final level has no cut', () => {
    engine.setQuestions([q(1, 1, { cut: { rule: 'top', value: 1, ties: 'speed' } }), q(2, 2)]);
    assert.equal(engine.levelInfo(2).cut, null);
  });
});

describe('levels and rounds', () => {
  test('round numbers count only the levels that are loaded (switched-off levels are not loaded)', () => {
    engine.setQuestions([q(1, 1), q(4, 3), q(5, 3)]);
    assert.equal(engine.levelInfo(1).round, 1);
    assert.equal(engine.levelInfo(3).round, 2);
  });

  test('the answer note is sent only at the reveal, and a question without one sends nothing', () => {
    engine.setQuestions([q(1, 1, { note: 'Because of HTTP.', video: { mime: 'video/mp4', url: 'https://x/v' } }), q(2, 1)]);
    players(1);
    const hidden = () => assert.ok(!JSON.stringify(engine.getState()).includes('Because of HTTP'));
    hidden();
    engine.startGame();
    hidden();
    engine.startQuestion(); // the video
    hidden();
    engine.startQuestion(); // the question
    hidden();
    assert.equal(engine.getState().answerNote, null);
    engine.endQuestion();
    assert.equal(engine.getState().answerNote, 'Because of HTTP.');
    engine.startQuestion();
    assert.equal(engine.getState().answerNote, null);
    engine.endQuestion();
    assert.equal(engine.getState().answerNote, null);
  });

  test('media links are sent only while their question is live', () => {
    engine.setQuestions([q(1, 1, { image: { mime: 'image/png', data: 'AA==' }, video: { mime: 'video/mp4', url: 'https://x/v' } })]);
    players(1);
    assert.equal(engine.getState().currentQuestion, null);
    engine.startGame();
    engine.startQuestion(); // the video plays first
    assert.equal(engine.getState().state, 'video');
    assert.equal(engine.getState().video.url, 'https://x/v');
    assert.equal(engine.getState().currentQuestion, null);
    engine.startQuestion(); // then the question
    const live = engine.getState().currentQuestion;
    assert.equal(engine.getState().video, null);
    assert.equal(live.imageUrl, '/live-image/0?g=' + engine.gameId);
    assert.equal(engine.liveImage(0).mime, 'image/png');
    engine.state = 'leaderboard';
    assert.equal(engine.getState().currentQuestion, null);
    assert.equal(engine.liveImage(0), null);
  });
});

describe('full game', () => {
  test('two levels, a cut after level 1, and the podium at the end', () => {
    engine.setQuestions([
      q(1, 1, { cut: { rule: 'top', value: 3, ties: 'speed' } }),
      q(2, 1, { cut: { rule: 'top', value: 3, ties: 'speed' } }),
      q(3, 1, { cut: { rule: 'top', value: 3, ties: 'speed' } }),
      q(4, 2, { multiplier: 2 }),
      q(5, 2, { multiplier: 2 }),
    ]);
    players(5);
    engine.startGame();
    let guard = 0;
    let cutConfirmed = false;
    while (engine.getState().state !== 'podium' && guard++ < 50) {
      const st = engine.getState();
      if (st.state === 'intro' || st.state === 'leaderboard') {
        if (engine.pendingCut) { assert.equal(engine.confirmCut().error, undefined); cutConfirmed = true; continue; }
        assert.equal(engine.startQuestion().error, undefined);
        continue;
      }
      assert.equal(st.state, 'question');
      ['s1', 's2', 's3', 's4'].forEach(s => engine.submitAnswer(s, 'A'));
      engine.submitAnswer('s5', 'B');
      engine.endQuestion();
    }
    assert.equal(engine.getState().state, 'podium');
    assert.ok(cutConfirmed, 'the cut after level 1 must be confirmed');
    const alive = engine.activePlayers().length;
    assert.ok(alive > 0 && alive < 5, `cut should keep some and remove some (alive ${alive})`);
  });
});

describe('scoring rules (coordinator options)', () => {
  // Two levels: a round 1 question, then a round 2 question; no cuts, so the round change is simple.
  const twoRounds = () => engine.setQuestions([q(1, 1), q(2, 2, { multiplier: 2 })]);
  const answerAll = (ans) => engine.submitAnswer('s1', ans);

  test('the defaults are the original rules', () => {
    assert.deepEqual(engine.rules, { multiplier: true, firstBlood: true, streak: true, roundReset: false });
  });

  test('rules can only be changed in the lobby, and unknown keys are ignored', () => {
    twoRounds();
    players(1);
    const r = engine.setRules({ multiplier: false, bogus: true, streak: 'yes' });
    assert.equal(r.success, true);
    assert.deepEqual(r.rules, { multiplier: false, firstBlood: true, streak: true, roundReset: false });
    engine.startGame();
    assert.match(engine.setRules({ streak: false }).error, /before the game starts/);
  });

  test('multiplier off: a ×2 level scores like a ×1 level', () => {
    engine.setRules({ multiplier: false, firstBlood: false });
    twoRounds();
    players(1);
    engine.startGame();
    engine.startQuestion(); engine.questionStartTime = Date.now(); engine.questionEndsAt = Date.now() + 20000;
    engine.endQuestion();
    engine.startQuestion(); // round 2 intro
    engine.startQuestion(); // round 2 question
    engine.questionStartTime = Date.now(); engine.questionEndsAt = Date.now() + 20000;
    const r = answerAll('A');
    assert.ok(Math.abs(r.record.pointsEarned - 1000) <= 5, `expected about 1000, got ${r.record.pointsEarned}`);
    assert.equal(engine.getState().levelConfig.multiplier, 1);
  });

  test('first-to-answer bonus off: the first correct answer gets no extra 20%', () => {
    engine.setRules({ firstBlood: false });
    engine.setQuestions([q(1, 1)]);
    players(1);
    goLive(10000);
    const r = answerAll('A');
    assert.ok(Math.abs(r.record.pointsEarned - 750) <= 5, `expected about 750, got ${r.record.pointsEarned}`);
    assert.notEqual(r.record.badge, '1st to Answer');
  });

  test('streak bonus off: a player on a streak gets no extra 10%', () => {
    engine.setQuestions([q(1, 1)]);
    players(1);
    engine.setRules({ firstBlood: false, streak: false });
    goLive(10000);
    engine.players[engine.sockets['s1']].streak = 2;
    assert.ok(Math.abs(answerAll('A').record.pointsEarned - 750) <= 5);
    engine.rules.streak = true; // setRules is lobby-only; flip it directly to compare the same answer
    engine.players[engine.sockets['s1']].streak = 2;
    engine.answers = {};
    assert.ok(Math.abs(answerAll('A').record.pointsEarned - 850) <= 5);
  });

  test('round reset off: totals carry into the next round', () => {
    twoRounds();
    players(1);
    engine.startGame();
    engine.startQuestion(); engine.questionStartTime = Date.now(); engine.questionEndsAt = Date.now() + 20000;
    answerAll('A');
    engine.endQuestion();
    const before = engine.players[engine.sockets['s1']].score;
    engine.startQuestion(); // into round 2
    assert.ok(before > 0);
    assert.equal(engine.players[engine.sockets['s1']].score, before);
  });

  test('round reset on: everyone still in starts the next round at 0', () => {
    engine.setRules({ roundReset: true });
    twoRounds();
    players(2);
    engine.startGame();
    engine.startQuestion(); engine.questionStartTime = Date.now(); engine.questionEndsAt = Date.now() + 20000;
    engine.submitAnswer('s1', 'A');
    engine.endQuestion();
    assert.ok(engine.players[engine.sockets['s1']].score > 0);
    engine.startQuestion(); // into round 2
    assert.equal(engine.players[engine.sockets['s1']].score, 0);
    assert.equal(engine.players[engine.sockets['s1']].totalResponseTime, 0);
  });

  test('the chosen rules survive a game reset, and the game records them in its state', () => {
    engine.setRules({ streak: false, roundReset: true });
    engine.reset();
    assert.equal(engine.rules.streak, false);
    assert.equal(engine.rules.roundReset, true);
    assert.equal(engine.getState().rules.roundReset, true);
  });
});

describe('question vault', () => {
  test('question content round-trips, including the picture and video references', () => {
    const dek = vault.newDek();
    const payload = vault.encryptQuestion(dek, { text: 'Who?', options: ['A', 'B'], correctAnswer: 'A', imageId: 'img-1', videoId: 'vid-1', note: 'Because.' });
    const back = vault.decryptQuestion(dek, payload);
    assert.deepEqual(back, { text: 'Who?', options: ['A', 'B'], correctAnswer: 'A', imageId: 'img-1', videoId: 'vid-1', note: 'Because.' });
  });

  test('a question saved without media decrypts with null references', () => {
    const dek = vault.newDek();
    const back = vault.decryptQuestion(dek, vault.encryptQuestion(dek, { text: 'T', options: ['A', 'B'], correctAnswer: 'A' }));
    assert.equal(back.imageId, null);
    assert.equal(back.videoId, null);
    assert.equal(back.note, '');
  });

  test('a note stays out of the stored payload in readable form', () => {
    const dek = vault.newDek();
    const payload = vault.encryptQuestion(dek, { text: 'T', options: ['A', 'B'], correctAnswer: 'A', note: 'Secret explanation' });
    assert.ok(!String(payload).includes('Secret explanation'));
  });

  test('a tampered question payload is rejected', () => {
    const dek = vault.newDek();
    const payload = vault.encryptQuestion(dek, { text: 'T', options: ['A', 'B'], correctAnswer: 'A' });
    const bytes = Buffer.from(payload.split('.').pop(), 'base64');
    bytes[0] ^= 0xff;
    const tampered = [...payload.split('.').slice(0, -1), bytes.toString('base64')].join('.');
    assert.throws(() => vault.decryptQuestion(dek, tampered));
  });

  test('images round-trip byte for byte', () => {
    const dek = vault.newDek();
    const img = crypto.randomBytes(4096);
    assert.ok(vault.decryptImage(dek, vault.encryptImage(dek, img)).equals(img));
  });

  test('the set key opens with the right PIN only', async () => {
    const dek = vault.newDek();
    const bank = await vault.sealBankKey(dek, '4821');
    assert.ok((await vault.openBankKey(bank, '4821')).equals(dek));
    await assert.rejects(vault.openBankKey(bank, '0000'));
  });
});

describe('staff passwords', () => {
  test('a password verifies only with the right secret', async () => {
    const stored = await auth.hashSecret('correct horse');
    assert.match(stored, /^scrypt\$/);
    assert.equal(await auth.verifySecret('correct horse', stored), true);
    assert.equal(await auth.verifySecret('wrong', stored), false);
  });

  test('the same secret hashes differently each time (random salt)', async () => {
    assert.notEqual(await auth.hashSecret('same'), await auth.hashSecret('same'));
  });
});
