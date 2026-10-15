// Simulates a live event: bot players join the game and answer like real people (different speeds
// and accuracy, a few who skip questions, late joiners, phones that drop and reconnect).
//
// Usage (from backend/):
//   node simulate-event.js [--players=40]
//       Bots only. Conduct the game yourself from the host console and watch /screen.
//       Bots rejoin automatically after a game reset, so you can run several rounds.
//   node simulate-event.js --players=40 --auto
//       The script also conducts the game (start, every question, results) with the account in
//       SIM_USER / SIM_PASSWORD (admin or coordinator). Exits after the podium.
//
// Options: --server=URL   game server (default SERVER_URL or http://localhost:3001)
//          --api=URL      admin API, if different (split deployment: the Vercel address)
//          --lobby=10     auto: seconds to wait in the lobby after the bots have joined
//          --reveal=6     auto: seconds to show each answer and the standings
//          --intro=4      auto: seconds to show each round intro
//
// Questions must already be loaded into the game (quiz master: Admin -> Questions -> Load into game).
// With check-in required, the bots use tickets SIM0001... which are added as checked in.
// Results are saved to Supabase like a real game.
require('dotenv').config({ quiet: true });
const { io } = require('socket.io-client');

const arg = (name, fallback) => {
  const hit = process.argv.find(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.includes('=') ? hit.split('=').slice(1).join('=') : true;
};
const SERVER = String(arg('server', process.env.SERVER_URL || 'http://localhost:3001')).replace(/\/$/, '');
const API = String(arg('api', SERVER)).replace(/\/$/, '');
const PLAYERS = Math.max(1, Number(arg('players', 40)) || 40);
const AUTO = Boolean(arg('auto', false));
const LOBBY_S = Number(arg('lobby', 10));
const REVEAL_S = Number(arg('reveal', 6));
const INTRO_S = Number(arg('intro', 4));

const wait = ms => new Promise(r => setTimeout(r, ms));
const rand = (min, max) => min + Math.random() * (max - min);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const ask = (socket, ...args) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timeout: ${args[0]}`)), 10000);
  socket.emit(...args, res => { clearTimeout(timer); resolve(res); });
});
const connect = () => new Promise((resolve, reject) => {
  const s = io(SERVER, { reconnection: false, transports: ['websocket'] });
  s.once('connect', () => resolve(s));
  s.once('connect_error', reject);
});
const log = (...m) => console.log(new Date().toTimeString().slice(0, 8), ...m);

// Answer key for known test questions, so bots can be "good" or "bad" at the quiz. Unknown
// questions (the real, encrypted bank) are answered at random.
const ANSWERS = new Map();
try { require('./seed-test-data').QUESTIONS.forEach(q => ANSWERS.set(q.text, q.correct_answer)); } catch { /* optional */ }
try { require('../seed_questions.json').forEach(q => ANSWERS.set(q.text, q.correctAnswer)); } catch { /* optional */ }

const FIRST = ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Arjun', 'Meera', 'Kiran', 'Sneha', 'Rahul', 'Fathima', 'Nikhil',
  'Lakshmi', 'Adil', 'Gauri', 'Vishnu', 'Nandana', 'Sidharth', 'Aleena', 'Hari', 'Riya', 'Amal', 'Devika', 'Joel',
  'Anjali', 'Farhan', 'Keerthi', 'Midhun', 'Parvathy', 'Sanjay', 'Theertha', 'Yadu', 'Zara'];
const LAST = ['Nair', 'Menon', 'Pillai', 'Thomas', 'Varghese', 'Kumar', 'Joseph', 'Rahman', 'Das', 'Krishnan', 'George', 'Babu'];

// A persona: how quickly and how well a bot answers, and how flaky its connection is.
const PERSONAS = [
  { kind: 'sharp', weight: 2, skill: [0.8, 0.95], speed: [0.1, 0.35] },
  { kind: 'steady', weight: 5, skill: [0.5, 0.8], speed: [0.25, 0.65] },
  { kind: 'guesser', weight: 2, skill: [0.2, 0.45], speed: [0.05, 0.3] },
  { kind: 'slow', weight: 2, skill: [0.4, 0.75], speed: [0.55, 0.95] },
];
function persona() {
  let r = Math.random() * PERSONAS.reduce((s, p) => s + p.weight, 0);
  const p = PERSONAS.find(x => (r -= x.weight) < 0) || PERSONAS[1];
  return { kind: p.kind, skill: rand(...p.skill), speed: p.speed, skipRate: rand(0.01, 0.06), flaky: Math.random() < 0.08 };
}

let requireCheckin = true;
let lastState = null;
const bots = [];
const stats = { joined: 0, answered: 0, skipped: 0, drops: 0, errors: new Map() };
const countError = msg => stats.errors.set(msg, (stats.errors.get(msg) || 0) + 1);

class Bot {
  constructor(i) {
    this.i = i;
    this.ticketId = `SIM${String(i + 1).padStart(4, '0')}`;
    this.name = `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`;
    // Display names must be unique in a game: first name, then first name + initial (+ number).
    const [first, last] = this.name.split(' ');
    this.displayName = i < FIRST.length ? first : `${first} ${last[0]}${i >= FIRST.length * 3 ? i : ''}`;
    this.p = persona();
    this.token = null;
    this.score = 0;
    this.answeredIndex = null;
    this.stopped = false;
  }

  async open() {
    this.socket = await connect();
    this.socket.on('game_state', s => this.onState(s));
    this.socket.on('my_result', r => { this.score = r.player.score; });
    this.socket.on('kicked', () => { this.stopped = true; log(`  ${this.name} was removed by the host`); });
    this.socket.on('game_reset', () => {
      this.token = null;
      this.score = 0;
      setTimeout(() => this.join(), rand(1000, 4000)); // like players re-joining for the next round
    });
  }

  async join() {
    if (this.stopped) return;
    const payload = requireCheckin ? { ticketId: this.ticketId, name: this.displayName } : { name: this.displayName };
    try {
      const res = await ask(this.socket, 'join_game', payload);
      if (res.success) {
        this.token = res.token;
        stats.joined++;
      } else countError(`join: ${res.error}`);
    } catch (err) { countError(`join: ${err.message}`); }
  }

  onState(s) {
    lastState = s;
    if (!this.token || this.stopped || s.state !== 'question' || this.answeredIndex === s.currentQuestionIndex) return;
    this.answeredIndex = s.currentQuestionIndex;
    if (Math.random() < this.p.skipRate) { stats.skipped++; return; }

    const q = s.currentQuestion;
    const offset = s.serverNow - Date.now();
    const remaining = s.questionEndsAt - (Date.now() + offset);
    const delay = Math.min(remaining - 400, (q.timeLimit * 1000) * rand(...this.p.speed) + rand(600, 1500));
    if (delay <= 0) return;

    const known = ANSWERS.get(q.text);
    const choice = known && Math.random() < this.p.skill
      ? q.options.find(o => o.toLowerCase() === String(known).toLowerCase()) || pick(q.options)
      : pick(q.options);

    this.pending = setTimeout(async () => {
      if (this.stopped || !this.socket.connected) return;
      try {
        const res = await ask(this.socket, 'submit_answer', choice);
        if (res.success) stats.answered++;
        else countError(`answer: ${res.error}`);
      } catch (err) { countError(`answer: ${err.message}`); }
    }, delay);

    // A flaky phone sometimes drops mid-question and comes back a few seconds later.
    if (this.p.flaky && Math.random() < 0.35) setTimeout(() => this.drop(), rand(500, Math.max(600, delay - 200)));
  }

  async drop() {
    if (this.stopped || !this.token) return;
    stats.drops++;
    clearTimeout(this.pending); // the answer is sent again after rejoining, if still needed
    this.socket.removeAllListeners();
    this.socket.disconnect();
    await wait(rand(2000, 6000));
    try {
      await this.open();
      const res = await ask(this.socket, 'rejoin_game', this.token);
      if (!res.success) return countError(`rejoin: ${res.error}`);
      if (res.myAnswer) this.answeredIndex = res.gameState.currentQuestionIndex;
      else this.answeredIndex = null;
      this.onState(res.gameState); // answers if the question is still running
    } catch (err) { countError(`rejoin: ${err.message}`); }
  }
}

function printStandings(board, title) {
  log(title);
  board.slice(0, 5).forEach((p, i) => log(`   ${i + 1}. ${p.name.padEnd(12)} ${String(p.score).padStart(6)}`));
}

async function conduct() {
  const login = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: process.env.SIM_USER, password: process.env.SIM_PASSWORD }),
  }).then(r => r.json()).catch(() => ({}));
  if (!login.token) throw new Error('--auto needs SIM_USER / SIM_PASSWORD of an admin or coordinator');

  const host = await connect();
  let state = null;
  let result = null;
  host.on('game_state', s => { state = s; });
  host.on('question_result', r => { result = r; });
  const action = async (name) => {
    const res = await ask(host, 'host_action', name, null);
    if (res.error) throw new Error(`${name}: ${res.error}`);
    return res;
  };
  const joined = await ask(host, 'join_role', 'host', login.token);
  if (joined.error) throw new Error(joined.error);
  const { count } = await action('load_questions');
  if (!count) throw new Error('No questions loaded - the quiz master must press "Load into game" first');
  await wait(300);
  if (state?.state !== 'lobby') throw new Error('The game is not in the lobby - reset it from the host console first');
  log(`Conducting: ${count} questions`);
  return { host, action, count, get state() { return state; }, get result() { return result; } };
}

async function runAuto(h) {
  log(`Lobby open for ${LOBBY_S}s…`);
  await wait(LOBBY_S * 1000);
  await h.action('start_game');
  log('Game started');
  while (true) {
    await wait(INTRO_S * 1000);
    await h.action('start_question');
    await wait(200);
    const s = h.state;
    if (s.state === 'podium') break;
    if (s.state === 'intro') {
      log(`── Round ${s.currentLevel}: ${s.levelConfig?.name || ''}`);
      continue;
    }
    const q = s.currentQuestion;
    log(`Q${s.currentQuestionIndex + 1}/${s.totalQuestions} (${q.timeLimit}s) ${q.text}`);
    while (h.state.state === 'question') await wait(250); // the server ends it when the timer runs out
    const r = h.result;
    const answers = Object.values(r.stats).reduce((a, b) => a + b, 0);
    log(`   Answer: ${r.correctAnswer}  ·  ${r.stats[r.correctAnswer] || 0}/${answers} correct${r.speedStar ? `  ·  fastest: ${r.speedStar}` : ''}`);
    await wait(Math.max(0, REVEAL_S * 1000 - INTRO_S * 1000));
  }
  await wait(500);
  printStandings(h.state.finalLeaderboard || [], 'Final standings');
}

(async () => {
  log(`Event simulation: ${PLAYERS} players → ${SERVER}${AUTO ? ' (auto-conduct)' : ''}`);
  try {
    (await connect()).disconnect();
  } catch (err) {
    throw new Error(`Cannot reach the game server at ${SERVER} (${err.message}) - is it running?`);
  }
  // All-in-one server: /api/config. Event-day game server: /health.
  const config = await fetch(`${API}/api/config`).then(r => r.json())
    .catch(() => fetch(`${SERVER}/health`).then(r => r.json()))
    .catch(() => null);
  if (typeof config?.requireCheckin === 'boolean') requireCheckin = config.requireCheckin;
  else log('Could not read the check-in setting - assuming check-in is required');

  if (requireCheckin) {
    const { supabase } = require('./db');
    const now = new Date().toISOString();
    const rows = Array.from({ length: PLAYERS }, (_, i) => {
      const b = new Bot(i);
      return { ticket_id: b.ticketId, name: b.name, college: 'Simulation', checked_in_at: now };
    });
    const { error } = await supabase.from('registrations').upsert(rows, { onConflict: 'ticket_id' });
    if (error) throw new Error(`Adding SIM tickets failed: ${error.message}`);
    log(`Check-in required: SIM0001-SIM${String(PLAYERS).padStart(4, '0')} added as checked in`);
  }

  const h = AUTO ? await conduct() : null;

  // Most players arrive over ~15 s; about one in ten turns up late.
  for (let i = 0; i < PLAYERS; i++) bots.push(new Bot(i));
  await Promise.all(bots.map(async b => {
    await wait(Math.random() < 0.1 ? rand(15000, 25000) : rand(0, 15000));
    await b.open();
    await b.join();
  }));
  log(`Joined: ${stats.joined}/${PLAYERS}${stats.errors.size ? ` · ${[...stats.errors].map(([m, n]) => `${m} ×${n}`).join(', ')}` : ''}`);

  const kinds = bots.reduce((m, b) => ({ ...m, [b.p.kind]: (m[b.p.kind] || 0) + 1 }), {});
  log(`Players: ${Object.entries(kinds).map(([k, n]) => `${n} ${k}`).join(', ')} · ${bots.filter(b => b.p.flaky).length} on flaky connections`);

  const summary = () => log(`Answers: ${stats.answered} · skipped: ${stats.skipped} · connection drops: ${stats.drops}${
    stats.errors.size ? ` · errors: ${[...stats.errors].map(([m, n]) => `${m} ×${n}`).join(', ')}` : ''}`);

  if (AUTO) {
    await runAuto(h);
    summary();
    bots.forEach(b => b.socket?.disconnect());
    h.host.disconnect();
    process.exit(0);
  }

  log('Bots are in the lobby. Conduct the game from the host console; Ctrl+C to stop.');
  let reported = null;
  setInterval(() => {
    const s = lastState;
    if (s?.state === 'podium' && reported !== 'podium') {
      reported = 'podium';
      printStandings(s.finalLeaderboard || [], 'Final standings');
      summary();
    } else if (s && s.state !== 'podium') reported = null;
  }, 1000);
  process.on('SIGINT', () => { summary(); process.exit(0); });
})().catch(err => {
  console.error('Simulation failed:', err.message);
  process.exit(1);
});
