// End-to-end tests: the real API and the real game server on localhost, driven by real Socket.IO
// clients. Only the database, its write queue and email are replaced, so nothing here touches
// Supabase. Run from backend/: npm test
const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const { io: connect } = require('socket.io-client');

process.env.QUESTION_VAULT_SECRET = crypto.randomBytes(32).toString('base64');

// ─── Stand-ins ────────────────────────────────────────────────────────────────
const sessions = new Map(); // tokenHash -> row
const staffRows = new Map(); // username -> row
const settingsMap = new Map();
const registrations = new Map();
const mailed = [];
const uuid = () => crypto.randomUUID();
const known = {
  normalizeTicketId: raw => (typeof raw === 'string' ? raw.trim().toUpperCase() : ''),
  insertSession: async row => { sessions.set(row.token_hash, row); },
  getSessionWithStaff: async hash => {
    const row = sessions.get(hash);
    if (!row) return null;
    const staff = [...staffRows.values()].find(s => s.id === row.staff_id);
    return { ...row, staff };
  },
  deleteSessionsForStaff: async id => { for (const [k, v] of sessions) if (v.staff_id === id) sessions.delete(k); },
  deleteSession: async hash => { sessions.delete(hash); },
  setSessionVault: async () => {},
  findStaffForLogin: async name => staffRows.get(name) ?? null,
  getSetting: async key => settingsMap.get(key) ?? null,
  setSetting: async (key, value) => { settingsMap.set(key, value); },
  deleteSetting: async key => { settingsMap.delete(key); },
  getSettings: async () => ({ require_checkin: true, game_server_url: '' }),
  getRegistration: async id => registrations.get(id) ?? null,
  listLevels: async () => [],
  listBanks: async () => [],
  createVideoUpload: async () => { throw new Error('must not be reached'); },
  insertVideo: async () => { throw new Error('must not be reached'); },
};
const store = new Proxy(known, { get: (t, k) => (k in t ? t[k] : async () => null) });
const stub = (file, exports) => {
  const filename = path.join(__dirname, '..', file);
  require.cache[filename] = { id: filename, filename, loaded: true, exports };
};
stub('store.js', store);
stub('mail.js', { sendPasswordResetOtp: async (to, otp) => { mailed.push({ to, otp }); } });
const noWrite = async () => {};
const savedResults = [];
stub('db.js', {
  markGameStarted: noWrite, saveParticipants: noWrite, saveQuestionResults: async (...args) => { savedResults.push(args); }, finishGame: noWrite,
  recordEliminations: noWrite, logEvents: noWrite, flush: noWrite,
});

const auth = require('../auth');
const vault = require('../vault');
const engine = require('../gameEngine');
const createGame = require('../game');
const createApi = require('../api');
const { createApp, localHooks } = require('../app');

// ─── Server and helpers ───────────────────────────────────────────────────────
let server; let io; let game; let base; let hooks;
const open = [];
const tokens = {};
const staffId = {};

const q = (id, level, extra = {}) => ({
  id, level, text: `SECRET QUESTION ${id}`, type: 'mcq', options: ['A', 'B', 'C', 'D'], correctAnswer: 'A',
  timeLimit: 20, points: 1000, levelName: `Level ${level}`, multiplier: 1, cut: null, theme: null,
  image: null, video: null, ...extra,
});

function client() {
  const s = connect(base, { transports: ['websocket'], reconnection: false, forceNew: true });
  s.seen = [];
  s.onAny((event, ...args) => s.seen.push([event, ...args]));
  open.push(s);
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}
const ask = (s, event, ...args) => new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error(`no answer to ${event}`)), 4000);
  s.emit(event, ...args, r => { clearTimeout(t); resolve(r); });
});
async function until(cond, label = 'condition') {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    if (cond()) return;
    await new Promise(r => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for ${label}`);
}
const last = (s, event) => s.seen.filter(e => e[0] === event).at(-1)?.[1];
const act = (s, action, data) => ask(s, 'host_action', action, data);
async function host(role = 'coordinator') {
  const s = await client();
  const r = await ask(s, 'join_role', 'host', tokens[role]);
  assert.equal(r.success, true);
  return s;
}
async function player(name) {
  const s = await client();
  const r = await ask(s, 'join_game', { name });
  assert.equal(r.success, true, JSON.stringify(r));
  s.token = r.token;
  return s;
}
const call = (method, url, { token, body } = {}) => fetch(`${base}/api${url}`, {
  method,
  headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: body !== undefined ? JSON.stringify(body) : undefined,
});

before(async () => {
  for (const role of ['admin', 'quizmaster', 'coordinator', 'volunteer']) {
    const row = { id: uuid(), username: `${role}@test.example`, display_name: role, role, active: true, password_hash: await auth.hashSecret('correct-password') };
    staffRows.set(row.username, row);
    staffId[role] = row.id;
    tokens[role] = await auth.createSession(row);
  }
  const handler = express();
  server = http.createServer(handler);
  io = new Server(server, { maxHttpBufferSize: 16 * 1024 });
  game = createGame(io);
  hooks = localHooks(game);
  handler.use(createApp(hooks));
  handler.get('/live-image/:index', game.liveImage);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  io.close();
  await new Promise(r => server.close(r));
});

beforeEach(() => {
  engine.reset();
  engine.rules = { ...engine.DEFAULT_RULES };
  engine.hideFinalStandings = false;
  engine.setQuestions([]);
  game.applySettings({ requireCheckin: false });
});
afterEach(() => { open.splice(0).forEach(s => s.disconnect()); });

// ─── Access control: every API route ──────────────────────────────────────────
describe('API access control', () => {
  const PUBLIC = ['POST /auth/login', 'POST /auth/forgot-password', 'POST /auth/reset-password', 'GET /config'];
  const ALLOWED = {
    volunteer: ['POST /auth/logout', 'GET /auth/me', 'GET /checkin/recent', 'GET /checkin/:ticketId', 'POST /checkin/:ticketId', 'GET /game/status'],
    coordinator: ['POST /auth/logout', 'GET /auth/me', 'GET /banks', 'GET /game/status', 'GET /game/questions-status', 'POST /game/load-questions'],
  };
  const routes = () => createApi({}).stack.filter(l => l.route).flatMap(l => Object.keys(l.route.methods)
    .map(m => ({ key: `${m.toUpperCase()} ${l.route.path}`, method: m.toUpperCase(), path: l.route.path })));
  const url = r => r.path.replace(':ticketId', 'T1').replace(':level', '1').replace(':id', uuid());
  const send = (r, token) => call(r.method, url(r), { token, body: r.method === 'GET' ? undefined : {} });

  test('finds the routes it is meant to cover', () => assert.ok(routes().length > 40));

  test('every route except the public ones needs a sign-in', async () => {
    for (const r of routes()) {
      if (PUBLIC.includes(r.key)) continue;
      assert.equal((await send(r)).status, 401, `${r.key} without a token`);
      assert.equal((await send(r, 'x'.repeat(64))).status, 401, `${r.key} with a fake token`);
    }
  });

  for (const role of Object.keys(ALLOWED)) {
    test(`a ${role} is refused everywhere outside their job`, async () => {
      for (const r of routes()) {
        if (PUBLIC.includes(r.key) || ALLOWED[role].includes(r.key)) continue;
        assert.equal((await send(r, tokens[role])).status, 403, `${r.key} as ${role}`);
      }
    });
  }

  test('an admin cannot read or change questions', async () => {
    for (const r of routes().filter(x => /^\/(questions|levels)/.test(x.path) || x.path.startsWith('/banks/'))) {
      assert.equal((await send(r, tokens.admin)).status, 403, r.key);
    }
  });

  test('a quiz master cannot reach staff, participants, settings or results', async () => {
    for (const r of routes().filter(x => /^\/(staff|registrations|settings|results)/.test(x.path))) {
      assert.equal((await send(r, tokens.quizmaster)).status, 403, r.key);
    }
  });

  test('a quiz master with no set open gets 423 on question routes', async () => {
    for (const r of routes().filter(x => /^\/(questions|levels)/.test(x.path))) {
      assert.equal((await send(r, tokens.quizmaster)).status, 423, r.key);
    }
  });

  test('public config never exposes reset codes or other settings', async () => {
    settingsMap.set('otp:someone', { otpHash: 'x' });
    const body = await (await call('GET', '/config')).json();
    assert.deepEqual(Object.keys(body).sort(), ['gameServerUrl', 'requireCheckin']);
  });
});

describe('sign-in and password reset', () => {
  test('wrong passwords lock out after 10 tries', async () => {
    let status;
    for (let i = 0; i < 11; i++) status = (await call('POST', '/auth/login', { body: { username: 'admin@test.example', password: 'nope' } })).status;
    assert.equal(status, 429);
  });

  test('forgot password answers the same for real and unknown accounts, and returns no address', async () => {
    const real = await (await call('POST', '/auth/forgot-password', { body: { email: 'coordinator@test.example' } })).json();
    const fake = await (await call('POST', '/auth/forgot-password', { body: { email: 'nobody@test.example' } })).json();
    assert.deepEqual(real, fake);
    assert.ok(!JSON.stringify(real).includes('@'));
    assert.equal(mailed.length, 1);
  });

  test('forgot password is limited per address', async () => {
    let status;
    for (let i = 0; i < 6; i++) status = (await call('POST', '/auth/forgot-password', { body: { email: 'nobody@test.example' } })).status;
    assert.equal(status, 429);
  });

  test('a wrong reset code reads the same as an unknown account', async () => {
    const send = email => call('POST', '/auth/reset-password', { body: { email, otp: '000000', newPassword: 'long-enough-1' } });
    const a = await send('coordinator@test.example');
    const b = await send('nobody@test.example');
    assert.equal(a.status, 400);
    assert.deepEqual(await a.json(), await b.json());
  });

  test('reset guesses are limited per address', async () => {
    let status;
    for (let i = 0; i < 12; i++) status = (await call('POST', '/auth/reset-password', { body: { email: 'nobody@test.example', otp: '000000', newPassword: 'long-enough-1' } })).status;
    assert.equal(status, 429);
  });
});

describe('answer notes through the admin API', () => {
  const stored = new Map();
  const replaced = {};
  const toRow = (id, q, payload) => ({ id, level: q.level, position: 0, type: q.type, time_limit: q.timeLimit, points: q.points, is_active: q.isActive, payload });
  const stand = {
    listLevels: async () => [{ number: 1 }],
    createQuestion: async (bank, q, payload) => { const row = toRow(1, q, payload); stored.set(1, row); return row; },
    updateQuestion: async (bank, id, q, payload) => { const row = toRow(id, q, payload); stored.set(id, row); return row; },
    listQuestionRows: async () => [...stored.values()],
  };
  before(async () => {
    Object.assign(replaced, Object.fromEntries(Object.keys(stand).map(k => [k, known[k]])));
    Object.assign(known, stand);
    await auth.unlockVault(await auth.getSession(tokens.quizmaster), vault.newDek(), uuid());
  });
  after(() => {
    for (const [k, v] of Object.entries(replaced)) { if (v) known[k] = v; else delete known[k]; }
  });
  const body = extra => ({ level: 1, type: 'tf', text: 'Is it?', correctAnswer: 'True', timeLimit: 20, points: 1000, ...extra });
  const list = async () => (await call('GET', '/questions', { token: tokens.quizmaster })).json();

  test('a note survives saving, editing and reloading, and is encrypted at rest', async () => {
    const saved = await call('POST', '/questions', { token: tokens.quizmaster, body: body({ note: '  Because of HTTP.  ' }) });
    assert.equal(saved.status, 201);
    assert.equal((await saved.json()).note, 'Because of HTTP.');
    assert.equal((await list())[0].note, 'Because of HTTP.');
    assert.ok(!JSON.stringify([...stored.values()]).includes('Because of HTTP'));
    await call('PUT', '/questions/1', { token: tokens.quizmaster, body: body({ note: 'Changed.' }) });
    assert.equal((await list())[0].note, 'Changed.');
    await call('PUT', '/questions/1', { token: tokens.quizmaster, body: body({ note: '' }) });
    assert.equal((await list())[0].note, '');
  });

  test('the backup tick survives saving and reloading, and defaults to off', async () => {
    const saved = await call('POST', '/questions', { token: tokens.quizmaster, body: body({ backup: true }) });
    assert.equal((await saved.json()).backup, true);
    assert.equal((await list())[0].backup, true);
    await call('PUT', '/questions/1', { token: tokens.quizmaster, body: body() });
    assert.equal((await list())[0].backup, false);
  });

  test('a question can hold up to 1000 characters, for code', async () => {
    const saved = await call('POST', '/questions', { token: tokens.quizmaster, body: body({ text: 'x'.repeat(1500) }) });
    assert.equal((await saved.json()).text.length, 1000);
  });

  test('a note is cut to 300 characters and is optional', async () => {
    const long = await call('POST', '/questions', { token: tokens.quizmaster, body: body({ note: 'x'.repeat(900) }) });
    assert.equal((await long.json()).note.length, 300);
    assert.equal((await call('POST', '/questions', { token: tokens.quizmaster, body: body() })).status, 201);
  });
});

describe('video upload checks', () => {
  const bankId = uuid();
  before(async () => {
    const session = await auth.getSession(tokens.quizmaster);
    await auth.unlockVault(session, vault.newDek(), bankId);
  });
  const up = body => call('POST', '/questions/videos/upload', { token: tokens.quizmaster, body });
  const record = pathValue => call('POST', '/questions/videos', { token: tokens.quizmaster, body: { path: pathValue } });

  test('refuses anything but MP4 and WebM', async () => {
    assert.equal((await up({ mime: 'text/html', bytes: 10 })).status, 400);
    assert.equal((await up({ mime: 'image/svg+xml', bytes: 10 })).status, 400);
  });
  test('refuses oversized and empty files', async () => {
    assert.equal((await up({ mime: 'video/mp4', bytes: 50 * 1024 * 1024 + 1 })).status, 400);
    assert.equal((await up({ mime: 'video/mp4', bytes: 0 })).status, 400);
  });
  test('refuses a file from another set, or a path that climbs out of its folder', async () => {
    assert.equal((await record(`${uuid()}/${uuid()}`)).status, 400);
    assert.equal((await record(`${bankId}/../${uuid()}`)).status, 400);
    assert.equal((await record(`${bankId}/${uuid()}/x`)).status, 400);
    assert.equal((await record('')).status, 400);
  });
});

// ─── Live game over real sockets ──────────────────────────────────────────────
describe('host control', () => {
  test('nobody but a signed-in host can run the game', async () => {
    const anon = await client();
    assert.equal((await act(anon, 'start_game')).error, 'Not authorised');
    assert.equal((await act(anon, 'reset_game')).error, 'Not authorised');
    await ask(anon, 'join_role', 'bigscreen');
    assert.equal((await act(anon, 'start_game')).error, 'Not authorised');
    const monitor = await client();
    await ask(monitor, 'join_role', 'monitor', tokens.volunteer);
    assert.equal((await act(monitor, 'reset_game')).error, 'Not authorised');
  });

  test('a volunteer or a fake token cannot become host', async () => {
    const s = await client();
    assert.match((await ask(s, 'join_role', 'host', tokens.volunteer)).error, /coordinator or admin/);
    assert.match((await ask(s, 'join_role', 'host', 'f'.repeat(64))).error, /Session expired/);
    assert.equal((await ask(s, 'join_role', 'superuser')).error, 'Unknown role');
  });

  test('a deactivated host loses control at once', async () => {
    const row = { id: uuid(), username: 'temp@test.example', display_name: 'Temp', role: 'coordinator', active: true, password_hash: 'x' };
    staffRows.set(row.username, row);
    tokens.temp = await auth.createSession(row);
    const s = await client();
    await ask(s, 'join_role', 'host', tokens.temp);
    assert.equal((await act(s, 'load_questions')).error !== 'Not authorised', true);
    await auth.endSessionsForStaff(row.id);
    assert.match((await act(s, 'start_game')).error, /Session expired/);
    assert.equal((await act(s, 'start_game')).error, 'Not authorised');
  });

  test('built-in object names are not actions', async () => {
    const h = await host();
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      assert.equal((await act(h, name)).error, 'Unknown action', name);
    }
  });

  test('scoring rules can be set in the lobby only, and reach every screen', async () => {
    engine.setQuestions([q(1, 1)]);
    const h = await host();
    const p = await player('Asha');
    const r = await act(h, 'set_scoring_rules', { rules: { streak: false, evil: true, roundReset: 'yes' } });
    assert.deepEqual(r.rules, { multiplier: true, firstBlood: true, streak: false, roundReset: false });
    await until(() => last(p, 'game_state')?.rules?.streak === false, 'rules on the phone');
    await act(h, 'start_game');
    assert.match((await act(h, 'set_scoring_rules', { rules: { streak: true } })).error, /before the game starts/);
  });
});

describe('secrecy during a game', () => {
  test('questions and answers stay hidden until they should appear', async () => {
    engine.setQuestions([q(1, 1), q(2, 1)]);
    const h = await host();
    const p = await player('Asha');
    const screen = await client();
    await ask(screen, 'join_role', 'bigscreen');
    await act(h, 'start_game');
    await until(() => last(p, 'game_state')?.state === 'intro', 'intro');
    assert.ok(!JSON.stringify(p.seen).includes('SECRET QUESTION'), 'no question text before it is live');

    await act(h, 'start_question');
    await until(() => last(p, 'game_state')?.state === 'question', 'question');
    await ask(p, 'submit_answer', 'A');
    for (const s of [p, screen]) {
      const text = JSON.stringify(s.seen);
      assert.ok(!text.includes('correctAnswer'), 'no answer while live');
      assert.ok(!text.includes('isCorrect'), 'no right/wrong while live');
      assert.ok(!text.includes('SECRET QUESTION 2'), 'no future question');
    }
    assert.equal(last(p, 'game_state').currentQuestion.correctAnswer, undefined);
    await act(h, 'end_question');
    await until(() => last(p, 'question_result'), 'reveal');
    assert.equal(last(p, 'question_result').correctAnswer, 'A');
    assert.ok(!JSON.stringify(p.seen).includes('SECRET QUESTION 2'));
  });

  test('tickets, full names and flags never reach phones or the projector', async () => {
    game.applySettings({ requireCheckin: true });
    registrations.set('T100', { ticketId: 'T100', name: 'Priya Secretname', phone: '9876543210', checkedInAt: 'now' });
    // The projector and monitor connect first, so this also covers the broadcast on every join.
    const screen = await client();
    await ask(screen, 'join_role', 'bigscreen');
    const monitor = await client();
    await ask(monitor, 'join_role', 'monitor', tokens.volunteer);
    const p = await client();
    assert.equal((await ask(p, 'join_game', { ticketId: 'T100', name: 'Priya' })).success, true);
    await until(() => last(screen, 'players_list')?.length === 1 && last(monitor, 'players_list')?.length === 1, 'list');
    assert.ok(!JSON.stringify(screen.seen).includes('T100'));
    assert.ok(!JSON.stringify(screen.seen).includes('Secretname'));
    assert.ok(!JSON.stringify(screen.seen).includes('98765'));
    assert.equal(p.seen.filter(e => e[0] === 'players_list').length, 0);
    assert.equal(last(monitor, 'players_list')[0].ticketId, 'T100');
  });

  test('pictures are served only while their question is live or after it', async () => {
    const image = { mime: 'image/png', data: Buffer.from('picture').toString('base64') };
    engine.setQuestions([q(1, 1, { image }), q(2, 1, { image })]);
    const h = await host();
    await player('Asha');
    const get = i => fetch(`${base}/live-image/${i}`).then(r => r.status);
    assert.equal(await get(0), 404);
    await act(h, 'start_game');
    assert.equal(await get(0), 404);
    await act(h, 'start_question');
    assert.equal(await get(0), 200);
    assert.equal(await get(1), 404);
    for (const bad of ['-1', 'constructor', '__proto__', '1e9', '0x0']) assert.notEqual(await get(bad) === 200 && bad !== '0x0', true, bad);
    await act(h, 'end_question');
    assert.equal(await get(1), 404);
  });

  test('a video plays first: no question, answers or timer until the host starts the question', async () => {
    engine.setQuestions([q(1, 1), q(2, 1, { video: { mime: 'video/mp4', url: 'https://storage.example/signed-link' } })]);
    const h = await host();
    const p = await player('Asha');
    const screen = await client();
    await ask(screen, 'join_role', 'bigscreen');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await act(h, 'end_question');
    await until(() => last(p, 'question_result'), 'reveal');
    assert.ok(!JSON.stringify(p.seen).includes('signed-link'));

    await act(h, 'start_question');
    await until(() => last(screen, 'game_state')?.state === 'video', 'video stage');
    assert.equal(last(screen, 'game_state').video.url, 'https://storage.example/signed-link');
    assert.ok(!JSON.stringify(screen.seen).includes('SECRET QUESTION 2'), 'question hidden during the video');
    assert.equal((await ask(p, 'submit_answer', 'A')).error, 'Not accepting answers now');
    assert.equal(engine.questionEndsAt, last(screen, 'game_state').questionEndsAt, 'timer untouched');
    const startedBefore = engine.questionStartTime;

    // The projector reports the end to the host, and that moves nothing on.
    assert.equal((await ask(p, 'video_status', 'ended')).error, 'No video is playing');
    assert.equal((await ask(screen, 'video_status', 'ended')).success, true);
    await until(() => last(h, 'video_status') === 'ended', 'host told the video ended');
    assert.equal(engine.state, 'video');
    await new Promise(r => setTimeout(r, 30));
    await act(h, 'start_question');
    await until(() => last(p, 'game_state')?.state === 'question', 'question after the video');
    assert.equal(last(p, 'game_state').currentQuestion.text, 'SECRET QUESTION 2');
    assert.equal(last(p, 'game_state').video, null);
    assert.ok(engine.questionStartTime > startedBefore, 'timer starts after the video');
    assert.ok(engine.questionEndsAt - Date.now() > 19000, 'the full timer is left');
    assert.equal((await ask(p, 'submit_answer', 'A')).success, true);
    assert.equal((await ask(screen, 'video_status', 'ended')).error, 'No video is playing');
    await act(h, 'end_question');
    await until(() => last(p, 'game_state')?.state === 'leaderboard', 'reveal');
  });

  test('the host can skip a video that will not play', async () => {
    engine.setQuestions([q(1, 1, { video: { mime: 'video/mp4', url: 'https://storage.example/broken' } })]);
    const h = await host();
    await player('Asha');
    await act(h, 'start_game');
    await act(h, 'start_question');
    assert.equal(engine.state, 'video');
    assert.equal((await act(h, 'end_question')).error, 'No question is live');
    await act(h, 'start_question');
    assert.equal(engine.state, 'question');
  });

  test('the dashboard counts right, wrong and skipped; staff see everyone, a phone only itself', async () => {
    engine.setQuestions([q(1, 1), q(2, 1)]);
    const h = await host();
    const a = await player('Asha');
    const b = await player('Ben');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await ask(b, 'submit_answer', 'B');
    await act(h, 'end_question');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'B');
    await act(h, 'end_question');
    await until(() => last(a, 'my_result')?.player.answers.wrong === 1, 'phone tally');
    assert.deepEqual(last(a, 'my_result').player.answers, { correct: 1, wrong: 1, skipped: 0 });
    await until(() => last(h, 'players_list')?.find(p => p.name === 'Ben')?.answers.skipped === 1, 'host dashboard');
    assert.deepEqual(last(h, 'players_list').find(p => p.name === 'Ben').answers, { correct: 0, wrong: 1, skipped: 1 });
    assert.equal(last(a, 'question_result').leaderboard[0].answers, undefined);
  });
});

describe('host controls', () => {
  const video = { mime: 'video/mp4', url: 'https://storage.example/clip' };
  const cut = { rule: 'top', value: 1, ties: 'speed' };

  test('the host plays, pauses and replays a video; only the projector hears it', async () => {
    engine.setQuestions([q(1, 1, { video })]);
    const h = await host();
    const p = await player('Asha');
    const screen = await client();
    await ask(screen, 'join_role', 'bigscreen');
    assert.equal((await act(h, 'video_control', { action: 'pause' })).error, 'No video is playing');
    await act(h, 'start_game');
    await act(h, 'start_question');
    for (const action of ['pause', 'play', 'replay']) {
      assert.equal((await act(h, 'video_control', { action })).success, true);
      await until(() => last(screen, 'video_control')?.action === action, action);
    }
    assert.equal((await act(h, 'video_control', { action: 'delete' })).error, 'Unknown video action');
    assert.equal(last(p, 'video_control'), undefined);
    assert.equal((await act(p, 'video_control', { action: 'pause' })).error, 'Not authorised');
    assert.equal((await ask(screen, 'video_status', 'hacked')).error, 'Unknown status');
    assert.equal(engine.state, 'video');
  });

  test('a cancelled question counts for nothing: no points, skip, time or streak change', async () => {
    engine.setQuestions([q(1, 1), q(2, 1), q(3, 1)]);
    const h = await host();
    const a = await player('Asha');
    await player('Ben');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await act(h, 'end_question');
    const asha = Object.values(engine.players).find(p => p.name === 'Asha');
    const before = { score: asha.score, time: asha.totalResponseTime, streak: asha.streak, answers: { ...asha.answers } };
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    const savedBefore = savedResults.length;
    assert.equal((await act(h, 'cancel_question')).success, true);
    assert.deepEqual({ score: asha.score, time: asha.totalResponseTime, streak: asha.streak, answers: asha.answers }, before);
    assert.equal(savedResults.length, savedBefore, 'no results are stored for it');
    await until(() => last(a, 'game_state')?.state === 'leaderboard' && last(a, 'game_state').cancelled, 'phones told');
    const result = last(a, 'question_result');
    assert.equal(result.cancelled, true);
    assert.equal(result.correctAnswer, null, 'the answer stays secret, it may be reused');
    assert.equal(result.note, null);
    await until(() => last(a, 'my_result')?.myAnswer === null, 'no result on the phone');
    await act(h, 'start_question');
    assert.equal(engine.state, 'question');
    assert.equal(engine.currentQuestion().id, 3);
    assert.equal((await act(a, 'cancel_question')).error, 'Not authorised');
    await act(h, 'end_question');
    assert.equal((await act(h, 'cancel_question')).error, 'No question is live');
  });

  test('a timer left running by a cancelled question cannot end the next one', async () => {
    engine.setQuestions([q(1, 1, { timeLimit: 1 }), q(2, 1)]);
    const h = await host();
    await player('Asha');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await act(h, 'cancel_question');
    await act(h, 'start_question');
    await new Promise(r => setTimeout(r, 1200));
    assert.equal(engine.state, 'question');
    assert.equal(engine.currentQuestion().id, 2);
  });

  test('a video can be cancelled too, and the question never starts', async () => {
    engine.setQuestions([q(1, 1, { video }), q(2, 1)]);
    const h = await host();
    await player('Asha');
    await act(h, 'start_game');
    await act(h, 'start_question');
    assert.equal(engine.state, 'video');
    await act(h, 'cancel_question');
    await act(h, 'start_question');
    assert.equal(engine.currentQuestion().id, 2);
  });

  test('cancelling the last question of a round still brings the cut', async () => {
    engine.setQuestions([q(1, 1, { cut }), q(2, 1, { cut }), q(3, 2)]);
    const h = await host();
    const a = await player('Asha');
    await player('Ben');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await act(h, 'end_question');
    await act(h, 'start_question');
    await act(h, 'cancel_question');
    await until(() => last(h, 'cut_pending'), 'cut waiting');
    assert.equal((await act(h, 'cut_confirm')).eliminated, 1);
  });

  test('backups stay out of the game until the host swaps one in for a cancelled question', async () => {
    engine.setQuestions([q(1, 1, { cut }), q(2, 2), q(9, 1, { backup: true, level: 7, levelName: 'Spare' })]);
    const h = await host();
    const a = await player('Asha');
    const b = await player('Ben');
    await until(() => last(h, 'backups')?.length === 1, 'host sees the backups');
    assert.deepEqual(Object.keys(last(h, 'backups')[0]).sort(), ['id', 'text', 'used'], 'no answer in the list');
    assert.equal(last(a, 'backups'), undefined);
    await act(h, 'start_game');
    assert.equal(engine.getState().totalQuestions, 2);
    assert.equal((await act(h, 'use_backup', { id: 9 })).error, 'A backup can replace a cancelled question only');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await act(h, 'end_question');
    assert.equal((await act(h, 'use_backup', { id: 9 })).error, 'A backup can replace a cancelled question only');
    await act(h, 'reset_game');
    await until(() => last(h, 'game_state')?.state === 'lobby', 'reset');
  });

  test('a backup keeps the round, number and cut of the question it replaces, and is used once', async () => {
    engine.setQuestions([q(1, 1, { cut }), q(2, 2), q(9, 2, { backup: true, levelName: 'Spare' }), q(8, 2, { backup: true })]);
    const h = await host();
    const a = await player('Asha');
    const b = await player('Ben');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await act(h, 'cancel_question');
    await until(() => last(h, 'cut_pending'), 'cut proposed after the cancel');
    await until(() => last(h, 'game_state')?.canUseBackup, 'backup offered');
    assert.equal((await act(h, 'use_backup', { id: 77 })).error, 'That backup is not available');
    assert.equal((await act(h, 'use_backup', { id: 9 })).success, true);
    await until(() => last(a, 'game_state')?.state === 'question', 'backup is live');
    const live = last(a, 'game_state');
    assert.equal(live.currentQuestion.id, 9);
    assert.equal(live.currentQuestionIndex, 0);
    assert.equal(live.totalQuestions, 2);
    assert.equal(live.levelConfig.name, engine.levelInfo(1).name);
    assert.equal(last(h, 'cut_pending'), null, 'the cut waits for the real end of the round');
    assert.equal(last(h, 'backups').find(x => x.id === 9).used, true);
    await ask(a, 'submit_answer', 'A');
    await ask(b, 'submit_answer', 'B');
    await act(h, 'end_question');
    await until(() => last(h, 'cut_pending'), 'cut proposed again');
    assert.equal((await act(h, 'cut_confirm')).eliminated, 1);
    assert.equal(Object.values(engine.players).find(p => p.name === 'Asha').status, 'active');
    await act(h, 'reset_game');
    assert.equal(engine.questions.map(x => x.id).join(), '1,2', 'the set is whole again after a reset');
    assert.equal(engine.backupList().every(x => !x.used), true);
  });

  test('once the cut is confirmed the cancelled question can no longer be replaced', async () => {
    engine.setQuestions([q(1, 1, { cut }), q(2, 2), q(9, 1, { backup: true })]);
    const h = await host();
    const a = await player('Asha');
    await player('Ben');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await act(h, 'cancel_question');
    await until(() => last(h, 'cut_pending'), 'cut');
    await act(h, 'cut_confirm');
    assert.equal((await act(h, 'use_backup', { id: 9 })).error, 'A backup can replace a cancelled question only');
  });
});

describe('players', () => {
  test('an answer can only be given once, and only with a real option', async () => {
    engine.setQuestions([q(1, 1)]);
    const h = await host();
    const p = await player('Asha');
    await act(h, 'start_game');
    await act(h, 'start_question');
    assert.equal((await ask(p, 'submit_answer', 'Z')).error, 'Invalid option');
    assert.equal((await ask(p, 'submit_answer', { $ne: 1 })).error, 'Invalid answer');
    assert.equal((await ask(p, 'submit_answer', 'B')).success, true);
    assert.equal((await ask(p, 'submit_answer', 'A')).error, 'Already answered');
  });

  test('someone who has not joined cannot answer', async () => {
    engine.setQuestions([q(1, 1)]);
    const h = await host();
    await player('Asha');
    await act(h, 'start_game');
    await act(h, 'start_question');
    const stranger = await client();
    assert.equal((await ask(stranger, 'submit_answer', 'A')).error, 'You are not in this game');
  });

  test('a refresh restores the seat, and a bad token does not', async () => {
    engine.setQuestions([q(1, 1)]);
    const h = await host();
    const p = await player('Asha');
    await act(h, 'start_game');
    await act(h, 'start_question');
    p.disconnect();
    await until(() => engine.connectedCount() === 0, 'disconnect');
    const back = await client();
    const r = await ask(back, 'rejoin_game', p.token);
    assert.equal(r.success, true);
    assert.equal(r.gameState.state, 'question');
    assert.equal((await ask(back, 'submit_answer', 'A')).success, true);
    for (const bad of ['__proto__', 'constructor', 'wrong', null, 1, {}, []]) {
      const s = await client();
      assert.equal((await ask(s, 'rejoin_game', bad)).error, 'Session not found', String(bad));
    }
  });

  test('check-in rules: unknown, not admitted, and guessing is throttled', async () => {
    game.applySettings({ requireCheckin: true });
    registrations.set('T200', { ticketId: 'T200', name: 'Not Admitted', phone: '', checkedInAt: null });
    const s = await client();
    assert.match((await ask(s, 'join_game', { ticketId: 'T200' })).error, /Not checked in/);
    let r;
    for (let i = 0; i < 9; i++) r = await ask(s, 'join_game', { ticketId: `GUESS${i}` });
    assert.match(r.error, /Too many attempts/);
  });

  test('a seat moves to a new phone only with the right digits, and never while the old one is on', async () => {
    game.applySettings({ requireCheckin: true });
    registrations.set('T300', { ticketId: 'T300', name: 'Ravi Kumar', phone: '+91 98765 43210', checkedInAt: 'now' });
    const first = await client();
    const joined = await ask(first, 'join_game', { ticketId: 'T300', name: 'Ravi' });
    assert.equal(joined.success, true);
    const other = await client();
    assert.match((await ask(other, 'join_game', { ticketId: 'T300' })).error, /already playing/);
    first.disconnect();
    await until(() => engine.connectedCount() === 0, 'disconnect');
    assert.equal((await ask(other, 'join_game', { ticketId: 'T300' })).needsVerify, true);
    assert.equal((await ask(other, 'join_game', { ticketId: 'T300', verify: '0000' })).needsVerify, true);
    const moved = await ask(other, 'join_game', { ticketId: 'T300', verify: '3210' });
    assert.equal(moved.reclaimed, true);
  });

  test('one connection can never hold two seats', async () => {
    game.applySettings({ requireCheckin: true });
    registrations.set('T400', { ticketId: 'T400', name: 'One', phone: '1111111111', checkedInAt: 'now' });
    registrations.set('T401', { ticketId: 'T401', name: 'Two', phone: '2222222222', checkedInAt: 'now' });
    const gone = await client();
    await ask(gone, 'join_game', { ticketId: 'T401', name: 'Two' });
    gone.disconnect();
    await until(() => engine.connectedCount() === 0, 'disconnect');
    const s = await client();
    await ask(s, 'join_game', { ticketId: 'T400', name: 'One' });
    assert.equal((await ask(s, 'join_game', { ticketId: 'T401', verify: '2222' })).error, 'Already joined');
  });

  test('hostile names stay plain text and long ones are refused', async () => {
    const s = await client();
    assert.match((await ask(s, 'join_game', { name: 'x'.repeat(21) })).error, /1-20/);
    assert.match((await ask(s, 'join_game', { name: '   ' })).error, /1-20/);
    assert.match((await ask(s, 'join_game', { name: { a: 1 } })).error, /1-20/);
    const ok = await ask(s, 'join_game', { name: '<img src=x>', avatar: '"><script>' });
    assert.equal(ok.success, true);
    assert.match(ok.player.avatar, /^b:/);
  });
});

describe('robustness', () => {
  test('garbage on every message never stops the server', async () => {
    engine.setQuestions([q(1, 1)]);
    const h = await host();
    const p = await player('Asha');
    const junk = [null, undefined, 0, -1, 1e308, '', 'x'.repeat(4000), [], [[]], {}, { __proto__: { a: 1 } }, { constructor: 1 }, true, '__proto__'];
    const events = ['join_game', 'rejoin_game', 'submit_answer', 'screen', 'join_role', 'host_action', 'not_an_event'];
    const attacker = await client();
    for (const event of events) for (const a of junk) for (const b of [undefined, ...junk.slice(0, 4)]) attacker.emit(event, a, b);
    for (const action of ['kick_player', 'disqualify_player', 'eliminate_player', 'cut_adjust', 'set_scoring_rules', 'set_hide_final_standings']) {
      for (const a of junk) await act(h, action, a);
    }
    await act(h, 'start_game');
    await act(h, 'start_question');
    for (const a of junk) p.emit('submit_answer', a);
    assert.equal((await ask(p, 'submit_answer', 'A')).success, true);
    assert.equal((await fetch(`${base}/api/config`)).status, 200);
  });

  test('an oversized message drops only that connection', async () => {
    const h = await host();
    const big = await client();
    big.emit('join_game', { name: 'x'.repeat(40 * 1024) });
    await until(() => !big.connected, 'drop');
    assert.equal((await act(h, 'load_questions')).error !== undefined, true);
  });

  test('a double press on the host console does no harm', async () => {
    engine.setQuestions([q(1, 1), q(2, 1)]);
    const h = await host();
    await player('Asha');
    const starts = await Promise.all([act(h, 'start_game'), act(h, 'start_game')]);
    assert.equal(starts.filter(r => r.success).length, 1);
    await act(h, 'start_question');
    const ends = await Promise.all([act(h, 'end_question'), act(h, 'end_question')]);
    assert.equal(ends.filter(r => r.success).length, 1);
    assert.equal(engine.currentQuestionIndex, 1);
  });

  test('the next round cannot start until the cut is confirmed', async () => {
    const cut = { rule: 'top', value: 1, ties: 'speed' };
    engine.setQuestions([q(1, 1, { cut }), q(2, 2)]);
    const h = await host();
    const a = await player('Asha');
    await player('Ben');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await act(h, 'end_question');
    assert.match((await act(h, 'start_question')).error, /Confirm the cut/);
  });

  test('a game can be reset mid-question and played again', async () => {
    engine.setQuestions([q(1, 1)]);
    const h = await host();
    await player('Asha');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await act(h, 'reset_game');
    assert.equal(engine.state, 'lobby');
    assert.equal(Object.keys(engine.players).length, 0);
    await player('Asha');
    assert.equal((await act(h, 'start_game')).success, true);
  });
});

describe('full games', () => {
  const cut = { rule: 'top', value: 2, ties: 'speed' };
  const setup = () => engine.setQuestions([q(1, 1, { cut, multiplier: 3 }), q(2, 2, { multiplier: 3 })]);

  test('Kahoot-style: no bonuses, points reset, cut on round points, everyone told', async () => {
    setup();
    const h = await host();
    await act(h, 'set_scoring_rules', { rules: { multiplier: false, firstBlood: false, streak: false, roundReset: true } });
    const [a, b, c] = [await player('Asha'), await player('Ben'), await player('Chitra')];
    const screen = await client();
    await ask(screen, 'join_role', 'bigscreen');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await ask(b, 'submit_answer', 'A');
    await ask(c, 'submit_answer', 'B');
    await act(h, 'end_question');
    await until(() => last(a, 'my_result'), 'result');
    const pts = last(a, 'my_result').myAnswer.points;
    assert.ok(pts > 900 && pts <= 1000, `speed points only, got ${pts}`);
    assert.equal(last(a, 'my_result').player.score, pts);

    assert.equal((await act(h, 'cut_confirm')).eliminated, 1);
    await until(() => last(c, 'player_update')?.player.status === 'eliminated', 'out');
    assert.equal(last(c, 'player_update').player.exit.round, 1);
    await until(() => last(a, 'player_update')?.roundEnd?.cutPending === false, 'through');

    await act(h, 'start_question'); // opens round 2
    await until(() => last(a, 'game_state')?.state === 'intro', 'round 2 intro');
    await until(() => last(a, 'player_update')?.player.score === 0, 'phone back at 0');
    await until(() => last(screen, 'players_list')?.filter(p => p.status === 'active').every(p => p.score === 0), 'projector back at 0');
    assert.equal(last(a, 'game_state').levelConfig.multiplier, 1);

    await act(h, 'start_question');
    await ask(b, 'submit_answer', 'A');
    await ask(a, 'submit_answer', 'B');
    await act(h, 'end_question');
    await act(h, 'start_question');
    await until(() => last(a, 'game_state')?.state === 'podium', 'podium');
    const final = engine.rankedPlayers().map(p => p.name);
    assert.deepEqual(final, ['Ben', 'Asha', 'Chitra']); // round 2 decides; the eliminated rank last
  });

  test('default rules: bonuses and multiplier apply, totals carry over', async () => {
    setup();
    const h = await host();
    const [a, b, c] = [await player('Asha'), await player('Ben'), await player('Chitra')];
    await act(h, 'start_game');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await ask(b, 'submit_answer', 'B');
    await ask(c, 'submit_answer', 'B');
    await act(h, 'end_question');
    await until(() => last(a, 'my_result'), 'result');
    const round1 = last(a, 'my_result').player.score;
    assert.ok(round1 > 3000, `3× base plus the first-answer bonus, got ${round1}`);
    await act(h, 'cut_confirm');
    await act(h, 'start_question');
    await until(() => last(a, 'game_state')?.state === 'intro', 'intro');
    assert.equal(engine.players[engine.sockets[a.id]].score, round1);
  });

  test('the leaderboard carries each player\'s total answer time; a skip counts as the full timer', async () => {
    engine.setQuestions([q(1, 1), q(2, 1)]);
    const h = await host();
    const a = await player('Asha');
    await player('Ben');
    const screen = await client();
    await ask(screen, 'join_role', 'bigscreen');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await act(h, 'end_question');
    await until(() => last(screen, 'question_result'), 'reveal');
    const board = last(screen, 'question_result').leaderboard;
    assert.ok(board.find(p => p.name === 'Asha').time < 3000);
    assert.equal(board.find(p => p.name === 'Ben').time, 20000);
  });

  test('the leaderboard also carries each player\'s time on the latest question only', async () => {
    engine.setQuestions([q(1, 1), q(2, 1), q(3, 1)]);
    const h = await host();
    const a = await player('Asha');
    const b = await player('Ben');
    const screen = await client();
    await ask(screen, 'join_role', 'bigscreen');
    await act(h, 'start_game');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await act(h, 'end_question'); // Ben skips
    await until(() => last(screen, 'question_result'), 'first reveal');
    await act(h, 'start_question');
    await ask(a, 'submit_answer', 'A');
    await ask(b, 'submit_answer', 'A');
    await act(h, 'end_question');
    await until(() => last(screen, 'question_result')?.questionIndex === 1, 'second reveal');
    const ben = last(screen, 'question_result').leaderboard.find(p => p.name === 'Ben');
    assert.ok(ben.lastTime < 3000, 'only the latest question');
    assert.ok(ben.time >= 20000, 'the tie-break total keeps the skip');
  });

  test('a dropped player is scored as skipped and the game carries on', async () => {
    engine.setQuestions([q(1, 1), q(2, 1)]);
    const h = await host();
    const a = await player('Asha');
    const b = await player('Ben');
    await act(h, 'start_game');
    await act(h, 'start_question');
    b.disconnect();
    await ask(a, 'submit_answer', 'A');
    await act(h, 'end_question');
    await act(h, 'start_question');
    assert.equal(engine.getState().state, 'question');
  });

  test('150 phones answering at once are all counted', async () => {
    engine.setQuestions([q(1, 1)]);
    const h = await host();
    const phones = await Promise.all(Array.from({ length: 150 }, (_, i) => player(`Player ${i}`)));
    await act(h, 'start_game');
    await act(h, 'start_question');
    const results = await Promise.all(phones.map(p => ask(p, 'submit_answer', 'A')));
    assert.equal(results.filter(r => r.success).length, 150);
    assert.equal(engine.answeredCount(), 150);
    await act(h, 'end_question');
    await until(() => phones.every(p => last(p, 'my_result')), 'every phone told its result');
    assert.equal(engine.rankedPlayers().filter(p => p.score > 0).length, 150);
  });
});
