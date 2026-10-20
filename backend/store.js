// Admin data access: staff, sessions, registrations/check-in, settings, question bank, results.
// Gameplay persistence lives in db.js; both share the same secret-key Supabase client.
const { supabase } = require('./db');

const TIMEOUT_MS = 10000;
const timed = query => query.abortSignal(AbortSignal.timeout(TIMEOUT_MS));

// Throws on a Supabase error so callers can use plain try/catch.
async function run(query, label) {
  const { data, error, count } = await timed(query);
  if (error) throw new Error(`${label}: ${error.message}`);
  return count !== undefined && count !== null ? { data, count } : data;
}

const STAFF_COLUMNS = 'id, username, display_name, role, active, created_at, pin_hash';

function toStaff(row) {
  return row && {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    active: row.active,
    createdAt: row.created_at,
    hasPin: !!row.pin_hash,
  };
}

// Ticket IDs are printed/encoded in different shapes; store them uppercase without spaces.
function normalizeTicketId(raw) {
  if (typeof raw !== 'string') return '';
  let s = raw.trim();
  // A URL: take the last path segment (…/ticket/MMP49081761)
  if (/^https?:\/\//i.test(s)) {
    try { s = new URL(s).pathname.split('/').filter(Boolean).pop() || ''; } catch { /* keep as is */ }
  }
  return s.replace(/\s+/g, '').toUpperCase().slice(0, 64);
}

// ─── Staff ────────────────────────────────────────────────────────────────────
async function countStaff() {
  const { count } = await run(supabase.from('staff').select('id', { count: 'exact', head: true }), 'Counting staff');
  return count;
}

async function findStaffForLogin(username) {
  const rows = await run(
    supabase.from('staff').select('*').ilike('username', username.replace(/[%_]/g, '\\$&')).limit(1),
    'Finding staff',
  );
  return rows[0] || null;
}

async function getStaffRow(id) {
  const rows = await run(supabase.from('staff').select('*').eq('id', id).limit(1), 'Loading staff');
  return rows[0] || null;
}

async function listStaff() {
  const rows = await run(supabase.from('staff').select(STAFF_COLUMNS).order('role').order('display_name'), 'Listing staff');
  return rows.map(toStaff);
}

async function countActiveAdmins() {
  const { count } = await run(
    supabase.from('staff').select('id', { count: 'exact', head: true }).eq('role', 'admin').eq('active', true),
    'Counting admins',
  );
  return count;
}

async function createStaff(fields) {
  const rows = await run(supabase.from('staff').insert(fields).select(STAFF_COLUMNS), 'Creating staff');
  return toStaff(rows[0]);
}

async function updateStaff(id, fields) {
  const rows = await run(supabase.from('staff').update(fields).eq('id', id).select(STAFF_COLUMNS), 'Updating staff');
  return toStaff(rows[0]);
}

// ─── Sessions ─────────────────────────────────────────────────────────────────
function insertSession(row) {
  return run(supabase.from('staff_sessions').insert(row), 'Creating session');
}

async function getSessionWithStaff(tokenHash) {
  const rows = await run(
    supabase.from('staff_sessions')
      .select('token_hash, expires_at, vault_until, vault_dek, vault_bank, staff:staff_id (id, username, display_name, role, active)')
      .eq('token_hash', tokenHash)
      .limit(1),
    'Loading session',
  );
  return rows[0] || null;
}

function setSessionVault(tokenHash, vaultUntil, vaultDek = null, bankId = null) {
  return run(
    supabase.from('staff_sessions').update({ vault_until: vaultUntil, vault_dek: vaultDek, vault_bank: bankId }).eq('token_hash', tokenHash),
    'Updating session',
  );
}

function deleteSession(tokenHash) {
  return run(supabase.from('staff_sessions').delete().eq('token_hash', tokenHash), 'Ending session');
}

function deleteSessionsForStaff(staffId) {
  return run(supabase.from('staff_sessions').delete().eq('staff_id', staffId), 'Ending sessions');
}

function deleteExpiredSessions() {
  return run(supabase.from('staff_sessions').delete().lt('expires_at', new Date().toISOString()), 'Cleaning sessions');
}

// ─── Registrations & check-in ─────────────────────────────────────────────────
const REG_COLUMNS = 'ticket_id, name, email, phone, college, checked_in_at, checked_in_by, checker:checked_in_by (display_name)';

function toRegistration(row) {
  return row && {
    ticketId: row.ticket_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    college: row.college,
    checkedInAt: row.checked_in_at,
    checkedInBy: row.checker?.display_name ?? null,
  };
}

// Upserts imported rows. Check-in columns are not part of the payload, so re-importing never
// clears who has already been admitted.
async function upsertRegistrations(rows) {
  let saved = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    await run(supabase.from('registrations').upsert(batch, { onConflict: 'ticket_id' }), 'Importing participants');
    saved += batch.length;
  }
  return saved;
}

async function searchRegistrations({ q = '', status = 'all', limit = 50, offset = 0 }) {
  let query = supabase.from('registrations').select(REG_COLUMNS, { count: 'exact' });
  const term = q.trim().replace(/[%_,()]/g, ' ');
  if (term) query = query.or(`ticket_id.ilike.%${term}%,name.ilike.%${term}%,email.ilike.%${term}%,college.ilike.%${term}%`);
  if (status === 'in') query = query.not('checked_in_at', 'is', null);
  if (status === 'out') query = query.is('checked_in_at', null);
  const { data, count } = await run(query.order('name').range(offset, offset + limit - 1), 'Searching participants');
  return { rows: data.map(toRegistration), total: count };
}

async function getRegistration(ticketId) {
  const rows = await run(supabase.from('registrations').select(REG_COLUMNS).eq('ticket_id', ticketId).limit(1), 'Loading ticket');
  return toRegistration(rows[0]);
}

// Atomic: only admits if not already checked in. Returns the registration, or null if it was already in.
async function admit(ticketId, staffId) {
  const rows = await run(
    supabase.from('registrations')
      .update({ checked_in_at: new Date().toISOString(), checked_in_by: staffId })
      .eq('ticket_id', ticketId)
      .is('checked_in_at', null)
      .select(REG_COLUMNS),
    'Admitting participant',
  );
  if (!rows.length) return null;
  await logCheckin(ticketId, staffId, 'admit');
  return toRegistration(rows[0]);
}

async function undoCheckin(ticketId, staffId) {
  const rows = await run(
    supabase.from('registrations')
      .update({ checked_in_at: null, checked_in_by: null })
      .eq('ticket_id', ticketId)
      .select(REG_COLUMNS),
    'Undoing check-in',
  );
  if (rows.length) await logCheckin(ticketId, staffId, 'undo');
  return toRegistration(rows[0]);
}

function logCheckin(ticketId, staffId, action) {
  return run(supabase.from('checkin_events').insert({ ticket_id: ticketId, staff_id: staffId, action }), 'Logging check-in');
}

async function checkinStats() {
  const [all, done] = await Promise.all([
    run(supabase.from('registrations').select('ticket_id', { count: 'exact', head: true }), 'Counting participants'),
    run(supabase.from('registrations').select('ticket_id', { count: 'exact', head: true }).not('checked_in_at', 'is', null), 'Counting check-ins'),
  ]);
  return { total: all.count, checkedIn: done.count };
}

async function recentCheckins({ staffId, limit = 20 } = {}) {
  let query = supabase.from('checkin_events')
    .select('id, action, created_at, ticket_id, registration:ticket_id (name, college), staff:staff_id (display_name)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (staffId) query = query.eq('staff_id', staffId);
  const rows = await run(query, 'Loading recent check-ins');
  return rows.map(r => ({
    id: r.id,
    action: r.action,
    at: r.created_at,
    ticketId: r.ticket_id,
    name: r.registration?.name ?? '',
    college: r.registration?.college ?? null,
    by: r.staff?.display_name ?? null,
  }));
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function getSettings() {
  const rows = await run(supabase.from('settings').select('key, value'), 'Loading settings');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

async function getSetting(key) {
  const rows = await run(supabase.from('settings').select('value').eq('key', key).limit(1), 'Loading setting');
  return rows[0]?.value ?? null;
}

function setSetting(key, value) {
  return run(supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() }), 'Saving setting');
}

function deleteSetting(key) {
  return run(supabase.from('settings').delete().eq('key', key), 'Deleting setting');
}

// ─── Question sets ("Main set", "Trial set", ...) ────────────────────────────
// Each set has its own key, sealed with the set's PIN (see questionKeys.js).
const BANK_SECRET_COLUMNS = 'pin_salt, wrapped_dek, recovery_salt, recovery_wrapped';

async function getBank(id) {
  const rows = await run(supabase.from('question_banks').select(`id, name, created_at, updated_at, ${BANK_SECRET_COLUMNS}`).eq('id', id).limit(1), 'Loading question set');
  return rows[0] || null;
}

// For pickers: name, whether it has a PIN yet, and how many questions/levels (no key material).
async function listBanks() {
  const [banks, questions, levels] = await Promise.all([
    run(supabase.from('question_banks').select('id, name, wrapped_dek, created_at, updated_at').order('created_at'), 'Listing question sets'),
    run(supabase.from('questions').select('bank_id, is_active'), 'Counting questions'),
    run(supabase.from('levels').select('bank_id'), 'Counting levels'),
  ]);
  return banks.map(b => ({
    id: b.id,
    name: b.name,
    ready: !!b.wrapped_dek,
    questions: questions.filter(q => q.bank_id === b.id).length,
    active: questions.filter(q => q.bank_id === b.id && q.is_active).length,
    levels: levels.filter(l => l.bank_id === b.id).length,
    updatedAt: b.updated_at,
  }));
}

async function insertBank(row) {
  const rows = await run(supabase.from('question_banks').insert(row).select('id, name'), 'Creating question set');
  return rows[0];
}

function updateBank(id, fields) {
  return run(supabase.from('question_banks').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id), 'Updating question set');
}

function deleteBank(id) {
  return run(supabase.from('question_banks').delete().eq('id', id), 'Deleting question set');
}

// ─── Questions of a set (content is encrypted; see vault.js) ─────────────────
// Rows carry plaintext metadata (level, order, type, timer, points) and an encrypted `payload`
// with the text, options and answer. Callers encrypt/decrypt; this layer only stores.
const EMPTY_CONTENT = { text: null, options: [], correct_answer: null };

function listQuestionRows(bankId) {
  return run(supabase.from('questions').select('*').eq('bank_id', bankId).order('level').order('position').order('id'), 'Loading questions');
}

async function createQuestion(bankId, meta, payload) {
  const last = await run(
    supabase.from('questions').select('position').eq('bank_id', bankId).eq('level', meta.level).order('position', { ascending: false }).limit(1),
    'Finding position',
  );
  const rows = await run(
    supabase.from('questions').insert({
      ...EMPTY_CONTENT,
      payload,
      bank_id: bankId,
      level: meta.level,
      position: (last[0]?.position ?? -1) + 1,
      type: meta.type,
      time_limit: meta.timeLimit,
      points: meta.points,
      is_active: meta.isActive,
    }).select('*'),
    'Creating question',
  );
  return rows[0];
}

async function updateQuestion(bankId, id, meta, payload) {
  const rows = await run(
    supabase.from('questions').update({
      ...EMPTY_CONTENT,
      payload,
      level: meta.level,
      type: meta.type,
      time_limit: meta.timeLimit,
      points: meta.points,
      is_active: meta.isActive,
    }).eq('id', id).eq('bank_id', bankId).select('*'),
    'Updating question',
  );
  return rows[0] || null;
}

// Replace plaintext content with its encrypted payload (used once per legacy/seeded row).
function sealQuestionRow(id, payload) {
  return run(supabase.from('questions').update({ ...EMPTY_CONTENT, payload }).eq('id', id).is('payload', null), 'Encrypting question');
}

function deleteQuestion(bankId, id) {
  return run(supabase.from('questions').delete().eq('id', id).eq('bank_id', bankId), 'Deleting question');
}

// Swap a question with its neighbour inside its level.
async function moveQuestion(bankId, id, direction) {
  const all = await listQuestionRows(bankId);
  const q = all.find(x => x.id === id);
  if (!q) return false;
  const level = all.filter(x => x.level === q.level);
  const i = level.findIndex(x => x.id === id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (j < 0 || j >= level.length) return true;
  // Re-number the whole level so positions are unique and contiguous, then swap.
  const order = level.map(x => x.id);
  [order[i], order[j]] = [order[j], order[i]];
  await Promise.all(order.map((qid, pos) =>
    run(supabase.from('questions').update({ position: pos }).eq('id', qid), 'Reordering questions')));
  return true;
}

function setLevelTimer(bankId, level, seconds) {
  return run(supabase.from('questions').update({ time_limit: seconds }).eq('bank_id', bankId).eq('level', level), 'Setting level timer');
}

// ─── Levels of a set (rounds; played in number order) ────────────────────────
const LEVEL_COLUMNS = 'number, name, multiplier, qualify_top, theme';
const toLevel = row => ({ number: row.number, name: row.name, multiplier: Number(row.multiplier), qualifyTop: row.qualify_top ?? null, theme: row.theme ?? null });

async function listLevels(bankId) {
  return (await run(supabase.from('levels').select(LEVEL_COLUMNS).eq('bank_id', bankId).order('number'), 'Loading levels')).map(toLevel);
}

async function createLevel(bankId, { name, multiplier, qualify_top = null, theme = null }) {
  const last = await run(supabase.from('levels').select('number').eq('bank_id', bankId).order('number', { ascending: false }).limit(1), 'Finding level number');
  const rows = await run(
    supabase.from('levels').insert({ bank_id: bankId, number: (last[0]?.number ?? 0) + 1, name, multiplier, qualify_top, theme }).select(LEVEL_COLUMNS),
    'Adding level',
  );
  return toLevel(rows[0]);
}

async function updateLevel(bankId, number, fields) {
  const rows = await run(supabase.from('levels').update(fields).eq('bank_id', bankId).eq('number', number).select(LEVEL_COLUMNS), 'Updating level');
  return rows[0] ? toLevel(rows[0]) : null;
}

async function countQuestionsInLevel(bankId, number) {
  const { count } = await run(supabase.from('questions').select('id', { count: 'exact', head: true }).eq('bank_id', bankId).eq('level', number), 'Counting questions');
  return count;
}

function deleteLevel(bankId, number) {
  return run(supabase.from('levels').delete().eq('bank_id', bankId).eq('number', number), 'Deleting level');
}

// ─── Question images of a set (encrypted bytes) ──────────────────────────────
async function insertImage(row) {
  const rows = await run(supabase.from('question_images').insert(row).select('id, mime, bytes'), 'Saving image');
  return rows[0];
}

async function getImages(ids, bankId) {
  if (!ids.length) return [];
  return run(supabase.from('question_images').select('id, mime, payload').in('id', ids).eq('bank_id', bankId), 'Loading images');
}

function listImageMeta(bankId) {
  return run(supabase.from('question_images').select('id, created_at').eq('bank_id', bankId), 'Listing images');
}

function deleteImages(ids) {
  if (!ids.length) return Promise.resolve([]);
  return run(supabase.from('question_images').delete().in('id', ids), 'Deleting images');
}

// ─── Old single-bank keys (read once when moving the old bank into a set) ─────
async function getVault() {
  const rows = await run(supabase.from('question_vault').select('*').eq('id', 1).limit(1), 'Loading question vault');
  return rows[0] || null;
}

function insertVault(row) {
  return run(supabase.from('question_vault').insert({ id: 1, ...row }), 'Creating question vault');
}

function updateVaultRecovery(row) {
  return run(supabase.from('question_vault').update(row).eq('id', 1), 'Replacing recovery code');
}

async function getGrant(staffId) {
  const rows = await run(supabase.from('question_key_grants').select('*').eq('staff_id', staffId).limit(1), 'Loading key grant');
  return rows[0] || null;
}

function upsertGrant(row) {
  return run(supabase.from('question_key_grants').upsert({ ...row, granted_at: new Date().toISOString() }), 'Saving key grant');
}

function deleteGrant(staffId) {
  return run(supabase.from('question_key_grants').delete().eq('staff_id', staffId), 'Removing key grant');
}

// Active quiz masters that have a key pair but no copy of the question key yet.
async function quizmastersWithoutGrant() {
  const [qms, grants] = await Promise.all([
    run(supabase.from('staff').select('id, vault_public_key').eq('role', 'quizmaster').eq('active', true).not('vault_public_key', 'is', null), 'Listing quiz masters'),
    run(supabase.from('question_key_grants').select('staff_id'), 'Listing key grants'),
  ]);
  const granted = new Set(grants.map(g => g.staff_id));
  return qms.filter(q => !granted.has(q.id));
}

// ─── Results ──────────────────────────────────────────────────────────────────
// Recent games for the admin to pick from (test runs and resets show up here too).
async function listGames(limit = 15) {
  const games = await run(
    supabase.from('games').select('id, name, status, started_at, ended_at, participants(count)').not('started_at', 'is', null)
      .order('started_at', { ascending: false }).limit(limit),
    'Listing games',
  );
  return games.map(g => ({
    id: g.id, name: g.name, status: g.status, startedAt: g.started_at, endedAt: g.ended_at,
    players: g.participants?.[0]?.count ?? 0,
  }));
}

// Results of one game; by default the most recent *finished* one (not an abandoned or reset run).
async function gameResults(gameId) {
  let query = supabase.from('games').select('id, name, status, started_at, ended_at');
  query = gameId
    ? query.eq('id', gameId)
    : query.eq('status', 'finished').order('started_at', { ascending: false });
  const games = await run(query.limit(1), 'Loading game');
  const game = games[0];
  if (!game) return null;
  const rows = await run(
    supabase.from('participants')
      .select('name, score, final_rank, ticket_id, status, registration:ticket_id (name, email, phone, college), exit:eliminations (round, reason, note, rank_at_exit)')
      .eq('game_id', game.id)
      .order('final_rank', { ascending: true, nullsFirst: false })
      .order('score', { ascending: false }),
    'Loading results',
  );
  return { game, rows };
}

// The activity log of one game, in order (paged: Supabase returns at most 1000 rows per request).
async function gameEvents(gameId) {
  const all = [];
  for (let from = 0; ; from += 1000) {
    const page = await run(
      supabase.from('participant_events')
        .select('at, ticket_id, player_name, event, question_index, detail, ip')
        .eq('game_id', gameId)
        .order('at').order('id')
        .range(from, from + 999),
      'Loading activity log',
    );
    all.push(...page);
    if (page.length < 1000) return all;
  }
}

module.exports = {
  normalizeTicketId,
  countStaff,
  findStaffForLogin,
  getStaffRow,
  listStaff,
  countActiveAdmins,
  createStaff,
  updateStaff,
  toStaff,
  insertSession,
  getSessionWithStaff,
  setSessionVault,
  deleteSession,
  deleteSessionsForStaff,
  deleteExpiredSessions,
  upsertRegistrations,
  searchRegistrations,
  getRegistration,
  admit,
  undoCheckin,
  checkinStats,
  recentCheckins,
  getSettings,
  getSetting,
  setSetting,
  deleteSetting,
  getBank,
  listBanks,
  insertBank,
  updateBank,
  deleteBank,
  listQuestionRows,
  createQuestion,
  updateQuestion,
  sealQuestionRow,
  deleteQuestion,
  moveQuestion,
  setLevelTimer,
  insertImage,
  getImages,
  listImageMeta,
  deleteImages,
  listLevels,
  createLevel,
  updateLevel,
  countQuestionsInLevel,
  deleteLevel,
  getVault,
  insertVault,
  updateVaultRecovery,
  getGrant,
  upsertGrant,
  deleteGrant,
  quizmastersWithoutGrant,
  listGames,
  gameResults,
  gameEvents,
};
