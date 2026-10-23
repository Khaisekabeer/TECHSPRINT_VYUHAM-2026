// Plays a full game against a running server with simulated players.
// Usage: node load-test.js [players]
//   env SERVER_URL         default http://localhost:3001
//       LOADTEST_USER / LOADTEST_PASSWORD           an admin or coordinator (runs the game)
//       LOADTEST_SET / LOADTEST_SET_PIN
//                          a question set and its PIN; if set, the host loads that set (like the coordinator)
// Note: results are saved to Supabase like a real game; run it against a test project
// or delete the game rows afterwards.
require('dotenv').config({ quiet: true });
const { io } = require('socket.io-client');

const SERVER = process.env.SERVER_URL || 'http://localhost:3001';
const PLAYERS = Number(process.argv[2]) || 150;
const PASSWORD = process.env.ADMIN_PASSWORD || 'admin';

const wait = ms => new Promise(r => setTimeout(r, ms));
const ask = (socket, ...args) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`timeout: ${args[0]}`)), 10000);
  socket.emit(...args, res => { clearTimeout(timer); resolve(res); });
});
const connect = () => new Promise((resolve, reject) => {
  const s = io(SERVER, { reconnection: false, transports: ['websocket'] });
  s.once('connect', () => resolve(s));
  s.once('connect_error', reject);
});
const pct = (arr, p) => [...arr].sort((a, b) => a - b)[Math.min(arr.length - 1, Math.floor(arr.length * p))];

(async () => {
  console.log(`Load test: ${PLAYERS} players against ${SERVER}`);

  const post = (path, body, token) => fetch(`${SERVER}/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body || {}),
  }).then(r => r.json());

  const login = await post('/auth/login', { username: process.env.LOADTEST_USER || 'admin', password: process.env.LOADTEST_PASSWORD || PASSWORD });
  if (!login.token) throw new Error('Staff login failed - set LOADTEST_USER / LOADTEST_PASSWORD (admin or coordinator)');

  // With check-in required, players need admitted tickets: seed LTTEST0000… as checked in.
  const { requireCheckin } = await fetch(`${SERVER}/api/config`).then(r => r.json());
  if (requireCheckin) {
    const { supabase } = require('./db');
    const now = new Date().toISOString();
    const rows = Array.from({ length: PLAYERS }, (_, i) => ({
      ticket_id: `LTTEST${String(i).padStart(4, '0')}`, name: `Load Test ${i}`, checked_in_at: now,
    }));
    const { error } = await supabase.from('registrations').upsert(rows, { onConflict: 'ticket_id' });
    if (error) throw new Error(`Seeding test tickets failed: ${error.message}`);
    console.log(`Check-in required: seeded ${PLAYERS} checked-in LTTEST tickets`);
  }

  const host = await connect();
  let state = null;
  host.on('game_state', s => { state = s; });
  const hostAction = async (action, data = null) => {
    const res = await ask(host, 'host_action', action, data);
    if (res.error) throw new Error(`${action}: ${res.error}`);
    return res;
  };
  if ((await ask(host, 'join_role', 'host', login.token)).error) throw new Error('Host join failed');
  await hostAction('reset_game');

  // Sets are encrypted: the host picks one and enters its PIN to load it (as the coordinator does).
  if (process.env.LOADTEST_SET) {
    const sets = await fetch(`${SERVER}/api/banks`, { headers: { Authorization: `Bearer ${login.token}` } }).then(r => r.json());
    const set = Array.isArray(sets) && sets.find(s => s.name === process.env.LOADTEST_SET);
    if (!set) throw new Error(`No question set called "${process.env.LOADTEST_SET}"`);
    const loaded = await post('/game/load-questions', { bankId: set.id, pin: process.env.LOADTEST_SET_PIN }, login.token);
    if (!loaded.success) throw new Error(`Loading questions failed: ${loaded.error}`);
  }
  const { count } = await hostAction('load_questions'); // reports what is loaded
  console.log(`Questions loaded: ${count}`);

  // Robustness: malformed messages must not crash the server.
  const rogue = await connect();
  rogue.emit('submit_answer', null);           // no callback, bad payload
  rogue.emit('join_game');                     // no data
  rogue.emit('host_action', 'reset_game');     // not a host
  await wait(300);
  rogue.disconnect();

  // Join players in the lobby.
  const t0 = Date.now();
  const players = [];
  const joinErrors = [];
  // Scores arrive privately at each reveal; the answer ack carries no result.
  const trackScore = p => p.socket.on('my_result', r => { p.score = r.player.score; p.revealed = true; });
  await Promise.all(Array.from({ length: PLAYERS }, async (_, i) => {
    try {
      const socket = await connect();
      const res = await ask(socket, 'join_game', { name: `LT_${i}`, ticketId: `LTTEST${String(i).padStart(4, '0')}` });
      if (res.success) {
        const p = { socket, token: res.token, name: `LT_${i}`, score: 0 };
        trackScore(p);
        players.push(p);
      } else joinErrors.push(res.error);
    } catch (err) {
      joinErrors.push(err.message);
    }
  }));
  console.log(`Joined: ${players.length}/${PLAYERS} in ${Date.now() - t0}ms${joinErrors.length ? ` (errors: ${[...new Set(joinErrors)].join(', ')})` : ''}`);

  await hostAction('start_game');
  const latencies = [];
  const answerErrors = [];
  let questionsPlayed = 0;

  while (true) {
    // An end-of-level cut waits for the coordinator; the load test confirms it as proposed.
    if (state?.cutPending) await hostAction('cut_confirm');
    await hostAction('start_question');
    await wait(150);
    if (state.state === 'podium') break;
    if (state.state === 'intro') continue; // level intro, advance again

    const options = state.currentQuestion.options;
    await Promise.all(players.map(async p => {
      await wait(Math.random() * 3000); // spread answers over 3 seconds
      const start = Date.now();
      try {
        const res = await ask(p.socket, 'submit_answer', options[Math.floor(Math.random() * options.length)]);
        latencies.push(Date.now() - start);
        if (!res.success) answerErrors.push(res.error);
        else if ('isCorrect' in res || 'points' in res) answerErrors.push('answer ack leaked the result');
      } catch (err) {
        answerErrors.push(err.message);
      }
    }));

    // Rejoin check on the first question: drop one player and reconnect with their token.
    if (questionsPlayed === 0 && players.length) {
      const p = players[0];
      p.socket.disconnect();
      await wait(200);
      p.socket = await connect();
      trackScore(p);
      const res = await ask(p.socket, 'rejoin_game', p.token);
      const ok = res.success && res.player.name === p.name && res.player.score === p.score
        && res.myAnswer?.answer && !('isCorrect' in res.myAnswer);
      console.log(`Rejoin check: ${ok ? 'OK (name, score and answer restored, result hidden)' : 'FAILED ' + JSON.stringify(res)}`);
    }

    await hostAction('end_question');
    await wait(300); // let each player's private result arrive
    questionsPlayed++;
  }

  const board = state.finalLeaderboard || [];
  const scoresMatch = players.every(p => board.find(b => b.name === p.name)?.score === p.score);
  console.log('--- LOAD TEST RESULTS ---');
  console.log(`Players:            ${players.length}`);
  console.log(`Questions played:   ${questionsPlayed}`);
  console.log(`Answers submitted:  ${latencies.length} (errors: ${answerErrors.length}${answerErrors.length ? ' - ' + [...new Set(answerErrors)].join(', ') : ''})`);
  if (latencies.length) {
    console.log(`Answer latency:     avg ${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(1)}ms, p95 ${pct(latencies, 0.95)}ms, max ${Math.max(...latencies)}ms`);
  }
  console.log(`Final leaderboard:  ${board.length} entries, scores match client totals: ${scoresMatch}`);
  console.log('-------------------------');

  players.forEach(p => p.socket.disconnect());
  host.disconnect();
  process.exit(scoresMatch && answerErrors.length === 0 ? 0 : 1);
})().catch(err => {
  console.error('Load test failed:', err.message);
  process.exit(1);
});
