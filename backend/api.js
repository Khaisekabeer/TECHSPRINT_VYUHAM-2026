// Staff REST API. Roles:
//   admin        management: participants (MakeMyPass CSV), staff, check-in, settings, results
//   quizmaster   encrypted question bank (behind a second PIN); loads questions into the game
//   coordinator  conducts the live event (host console, via Socket.IO)
//   volunteer    pass check-in and live monitoring
const express = require('express');
const auth = require('./auth');
const store = require('./store');
const vault = require('./vault');
const questionKeys = require('./questionKeys');

const { requireStaff, requireVault } = auth;
const ADMIN = 'admin';
const COORD = 'coordinator';
const QM = 'quizmaster';
const VOL = 'volunteer';
const ROLES = [ADMIN, QM, COORD, VOL];

const USERNAME_RE = /^[a-zA-Z0-9._@+-]{3,64}$/; // plain usernames or email addresses
const PIN_RE = /^\d{4,8}$/;

// Wrap async handlers: validation errors → 400, anything else → 500 (logged).
class BadRequest extends Error {}
const route = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof BadRequest) return res.status(400).json({ error: err.message });
    console.error(`[api] ${req.method} ${req.path}:`, err.message);
    res.status(500).json({ error: 'Something went wrong, please try again' });
  }
};
const check = (cond, msg) => { if (!cond) throw new BadRequest(msg); };
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function validateQuestion(body) {
  const level = Number(body.level);
  const type = body.type === 'tf' ? 'tf' : 'mcq';
  const text = str(body.text, 500);
  const options = type === 'tf'
    ? ['True', 'False']
    : (Array.isArray(body.options) ? body.options.map(o => str(o, 160)).filter(Boolean) : []);
  const correctAnswer = str(body.correctAnswer, 160);
  const timeLimit = Math.round(Number(body.timeLimit));
  const points = Math.round(Number(body.points));

  check([1, 2, 3].includes(level), 'Level must be 1, 2 or 3');
  check(text.length > 0, 'Question text is required');
  check(options.length >= 2 && options.length <= 4, 'Multiple choice needs 2 to 4 options');
  check(new Set(options.map(o => o.toLowerCase())).size === options.length, 'Options must be different');
  check(options.includes(correctAnswer), 'Pick the correct answer from the options');
  check(timeLimit >= 5 && timeLimit <= 300, 'Timer must be between 5 and 300 seconds');
  check(points >= 100 && points <= 10000, 'Points must be between 100 and 10000');
  return { level, type, text, options, correctAnswer, timeLimit, points, isActive: body.isActive !== false };
}

/**
 * @param hooks.onQuestionsChanged(dek)            refresh already-loaded game questions (lobby only)
 * @param hooks.loadQuestionsIntoGame(dek, staff)  decrypt active questions into the game
 * @param hooks.gameQuestionsStatus()              what the game currently has loaded
 * @param hooks.onSettingsChanged(settings)        push new settings to the game server
 */
module.exports = function createApi(hooks) {
  const api = express.Router();
  const big = express.json({ limit: '5mb' });
  const small = express.json({ limit: '32kb' });

  // ─── Auth ──────────────────────────────────────────────────────────────────
  api.post('/auth/login', small, route(async (req, res) => {
    const ipKey = `login:${req.ip}`;
    if (auth.isLockedOut(ipKey)) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });
    const username = str(req.body?.username, 64);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const row = USERNAME_RE.test(username) ? await store.findStaffForLogin(username) : null;
    const ok = row && row.active && await auth.verifySecret(password, row.password_hash);
    if (!ok) {
      auth.recordFailure(ipKey, 10, 10 * 60 * 1000);
      return res.status(401).json({ error: 'Wrong username or password' });
    }
    auth.clearFailures(ipKey);
    const token = await auth.createSession(row);
    res.json({ token, staff: { id: row.id, username: row.username, displayName: row.display_name, role: row.role } });
  }));

  api.get('/auth/me', requireStaff(), (req, res) => {
    res.json({ staff: req.session.staff, vaultUntil: req.session.vaultUntil > Date.now() ? req.session.vaultUntil : null });
  });

  api.post('/auth/logout', requireStaff(), route(async (req, res) => {
    await auth.endSession(req.session.tokenHash);
    res.json({ success: true });
  }));

  // Quiz master's second factor: the PIN unlocks the encryption key of the question bank.
  async function checkPin(req, res) {
    const key = `pin:${req.session.staff.id}`;
    if (auth.isLockedOut(key)) {
      res.status(429).json({ error: 'Too many wrong PINs. Wait 5 minutes.' });
      return null;
    }
    const row = await store.getStaffRow(req.session.staff.id);
    const pin = String(req.body?.pin ?? '');
    if (!(await auth.verifySecret(pin, row?.pin_hash))) {
      auth.recordFailure(key, 5, 5 * 60 * 1000);
      res.status(401).json({ error: 'Wrong PIN' });
      return null;
    }
    auth.clearFailures(key);
    return { row, pin };
  }

  function vaultFailure(res, err) {
    if (err instanceof vault.VaultError) {
      const status = err.code === 'NEEDS_GRANT' ? 409 : err.code === 'BAD_RECOVERY' ? 401 : err.code === 'NO_SECRET' ? 500 : 400;
      if (err.code === 'NO_SECRET') console.error('[vault]', err.message);
      return res.status(status).json({ error: err.code === 'NO_SECRET' ? 'Question encryption is not configured on the server' : err.message, needsGrant: err.code === 'NEEDS_GRANT' });
    }
    throw err;
  }

  async function openVault(req, dek) {
    const vaultUntil = await auth.unlockVault(req.session.tokenHash, dek);
    await questionKeys.afterUnlock(dek, req.session.staff.id);
    return vaultUntil;
  }

  api.post('/auth/vault', small, requireStaff(QM), route(async (req, res) => {
    const ok = await checkPin(req, res);
    if (!ok) return;
    try {
      const { dek, recoveryCode } = await questionKeys.unlock(ok.row, ok.pin);
      res.json({ vaultUntil: await openVault(req, dek), recoveryCode });
    } catch (err) {
      vaultFailure(res, err);
    }
  }));

  api.post('/auth/vault/recover', small, requireStaff(QM), route(async (req, res) => {
    const ok = await checkPin(req, res);
    if (!ok) return;
    try {
      const dek = await questionKeys.recover(ok.row, ok.pin, String(req.body?.recoveryCode ?? ''));
      res.json({ vaultUntil: await openVault(req, dek) });
    } catch (err) {
      vaultFailure(res, err);
    }
  }));

  api.post('/auth/vault/lock', requireStaff(QM), route(async (req, res) => {
    await auth.lockVault(req.session.tokenHash);
    res.json({ success: true });
  }));

  // ─── Staff management (admin) ──────────────────────────────────────────────
  api.get('/staff', requireStaff(ADMIN), route(async (req, res) => {
    res.json(await store.listStaff());
  }));

  api.post('/staff', small, requireStaff(ADMIN), route(async (req, res) => {
    const username = str(req.body?.username, 64);
    const displayName = str(req.body?.displayName, 60);
    const role = req.body?.role;
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const pin = req.body?.pin != null ? String(req.body.pin) : '';
    check(USERNAME_RE.test(username), 'Username: an email address, or 3-64 letters, numbers, dot, dash or underscore');
    check(displayName, 'Name is required');
    check(ROLES.includes(role), 'Choose a role');
    check(password.length >= 8, 'Password must be at least 8 characters');
    check(role !== QM || PIN_RE.test(pin), 'Quiz master needs a 4-8 digit PIN');
    check(!(await store.findStaffForLogin(username)), 'That username is taken');
    const staff = await store.createStaff({
      username,
      display_name: displayName,
      role,
      password_hash: await auth.hashSecret(password),
      pin_hash: role === QM ? await auth.hashSecret(pin) : null,
      ...(role === QM ? await questionKeys.keysForNewPin(pin) : {}),
      created_by: req.session.staff.id,
    });
    res.status(201).json(staff);
  }));

  api.patch('/staff/:id', small, requireStaff(ADMIN), route(async (req, res) => {
    const target = await store.getStaffRow(req.params.id);
    if (!target) return res.status(404).json({ error: 'Staff member not found' });
    const isSelf = target.id === req.session.staff.id;
    const fields = {};
    let endSessions = false;

    if (req.body.displayName !== undefined) {
      fields.display_name = str(req.body.displayName, 60);
      check(fields.display_name, 'Name is required');
    }
    if (req.body.role !== undefined && req.body.role !== target.role) {
      check(ROLES.includes(req.body.role), 'Choose a role');
      check(!isSelf, "You can't change your own role");
      check(req.body.role !== QM || target.pin_hash || PIN_RE.test(String(req.body.pin ?? '')), 'Quiz master needs a 4-8 digit PIN');
      fields.role = req.body.role;
      endSessions = true;
    }
    if (req.body.active !== undefined) {
      check(!isSelf || req.body.active, "You can't deactivate yourself");
      fields.active = !!req.body.active;
      if (!fields.active) endSessions = true;
    }
    if (req.body.password !== undefined) {
      check(typeof req.body.password === 'string' && req.body.password.length >= 8, 'Password must be at least 8 characters');
      fields.password_hash = await auth.hashSecret(req.body.password);
      endSessions = !isSelf || endSessions;
    }
    const newRole = fields.role ?? target.role;
    let resetKeyGrant = false;
    if (req.body.pin !== undefined && req.body.pin !== '') {
      check(PIN_RE.test(String(req.body.pin)), 'PIN must be 4-8 digits');
      fields.pin_hash = await auth.hashSecret(String(req.body.pin));
      // A new PIN means a new key pair; the question key is re-shared by the next unlocking quiz master.
      if (newRole === QM) {
        Object.assign(fields, await questionKeys.keysForNewPin(String(req.body.pin)));
        resetKeyGrant = true;
        endSessions = true;
      }
    }
    if (target.role === QM && fields.role && fields.role !== QM) {
      Object.assign(fields, { vault_public_key: null, vault_private_key: null, vault_key_salt: null });
      resetKeyGrant = true;
    }
    // Never leave the event without an active admin.
    if (target.role === ADMIN && (fields.active === false || (fields.role && fields.role !== ADMIN))) {
      check((await store.countActiveAdmins()) > 1, 'There must be at least one active admin');
    }
    check(Object.keys(fields).length, 'Nothing to change');
    const staff = await store.updateStaff(target.id, fields);
    if (resetKeyGrant) await store.deleteGrant(target.id);
    if (endSessions) await auth.endSessionsForStaff(target.id);
    res.json(staff);
  }));

  // ─── Participants (admin) ──────────────────────────────────────────────────
  api.post('/registrations/import', big, requireStaff(ADMIN), route(async (req, res) => {
    const input = Array.isArray(req.body?.rows) ? req.body.rows : [];
    check(input.length > 0, 'No rows to import');
    check(input.length <= 20000, 'Import at most 20,000 rows at a time');
    const seen = new Map();
    let skipped = 0;
    for (const r of input) {
      const ticketId = store.normalizeTicketId(r?.ticketId);
      const name = str(r?.name, 120);
      if (!ticketId || !name) { skipped++; continue; }
      const extra = r.extra && typeof r.extra === 'object' && !Array.isArray(r.extra)
        ? Object.fromEntries(Object.entries(r.extra).slice(0, 30).map(([k, v]) => [str(k, 60), str(String(v ?? ''), 300)]))
        : {};
      seen.set(ticketId, { ticket_id: ticketId, name, email: str(r.email, 160) || null, phone: str(r.phone, 40) || null, college: str(r.college, 160) || null, extra });
    }
    const imported = await store.upsertRegistrations([...seen.values()]);
    res.json({ imported, skipped, duplicates: input.length - skipped - seen.size });
  }));

  api.get('/registrations', requireStaff(ADMIN), route(async (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const status = ['in', 'out'].includes(req.query.status) ? req.query.status : 'all';
    res.json(await store.searchRegistrations({ q: str(req.query.q, 80), status, limit, offset }));
  }));

  api.post('/registrations/:ticketId/undo', requireStaff(ADMIN), route(async (req, res) => {
    const reg = await store.undoCheckin(store.normalizeTicketId(req.params.ticketId), req.session.staff.id);
    if (!reg) return res.status(404).json({ error: 'Ticket not found' });
    res.json(reg);
  }));

  api.get('/checkin/stats', requireStaff(ADMIN), route(async (req, res) => {
    res.json(await store.checkinStats());
  }));

  // ─── Check-in (volunteer + admin) ──────────────────────────────────────────
  api.get('/checkin/recent', requireStaff(ADMIN, VOL), route(async (req, res) => {
    const mine = req.session.staff.role === VOL || req.query.mine === '1';
    res.json(await store.recentCheckins({ staffId: mine ? req.session.staff.id : undefined, limit: 25 }));
  }));

  api.get('/checkin/:ticketId', requireStaff(ADMIN, VOL), route(async (req, res) => {
    const ticketId = store.normalizeTicketId(req.params.ticketId);
    check(ticketId, 'Ticket ID is required');
    const reg = await store.getRegistration(ticketId);
    if (!reg) return res.status(404).json({ error: 'Ticket not found in the participant list', ticketId });
    res.json(reg);
  }));

  api.post('/checkin/:ticketId', requireStaff(ADMIN, VOL), route(async (req, res) => {
    const ticketId = store.normalizeTicketId(req.params.ticketId);
    const admitted = await store.admit(ticketId, req.session.staff.id);
    if (admitted) return res.json({ status: 'admitted', registration: admitted });
    const existing = await store.getRegistration(ticketId);
    if (!existing) return res.status(404).json({ error: 'Ticket not found in the participant list', ticketId });
    res.status(409).json({ status: 'already', registration: existing, error: 'Already checked in' });
  }));

  // ─── Settings & results (admin) ────────────────────────────────────────────
  api.get('/settings', requireStaff(ADMIN), route(async (req, res) => {
    const s = await store.getSettings();
    res.json({ requireCheckin: s.require_checkin !== false });
  }));

  api.put('/settings', small, requireStaff(ADMIN), route(async (req, res) => {
    check(typeof req.body?.requireCheckin === 'boolean', 'requireCheckin must be true or false');
    await store.setSetting('require_checkin', req.body.requireCheckin);
    hooks.onSettingsChanged({ requireCheckin: req.body.requireCheckin });
    res.json({ requireCheckin: req.body.requireCheckin });
  }));

  api.get('/results/latest.csv', requireStaff(ADMIN), route(async (req, res) => {
    const result = await store.latestResults();
    if (!result) return res.status(404).json({ error: 'No game has been played yet' });
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [['Rank', 'Display name', 'Ticket ID', 'Registered name', 'College', 'Email', 'Phone', 'Score'].map(esc).join(',')];
    result.rows.forEach((r, i) => lines.push([
      r.final_rank ?? i + 1, r.name, r.ticket_id, r.registration?.name, r.registration?.college,
      r.registration?.email, r.registration?.phone, r.score,
    ].map(esc).join(',')));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="techsprint-results.csv"');
    res.send('﻿' + lines.join('\r\n'));
  }));

  // ─── Question bank (quiz master + PIN; contents encrypted at rest) ──────────
  const qm = [requireStaff(QM), requireVault];
  const dekOf = req => req.session.dek;
  const sealContent = (req, q) => vault.encryptQuestion(dekOf(req), { text: q.text, options: q.options, correctAnswer: q.correctAnswer });

  api.post('/questions/recovery-code', ...qm, route(async (req, res) => {
    res.json({ recoveryCode: await questionKeys.rotateRecoveryCode(dekOf(req)) });
  }));

  api.get('/questions', ...qm, route(async (req, res) => {
    res.json((await store.listQuestionRows()).map(r => questionKeys.decryptRow(r, dekOf(req))));
  }));

  api.post('/questions', small, ...qm, route(async (req, res) => {
    const q = validateQuestion(req.body || {});
    const row = await store.createQuestion(q, sealContent(req, q));
    hooks.onQuestionsChanged(dekOf(req));
    res.status(201).json(questionKeys.decryptRow(row, dekOf(req)));
  }));

  api.put('/questions/:id', small, ...qm, route(async (req, res) => {
    const q = validateQuestion(req.body || {});
    const row = await store.updateQuestion(Number(req.params.id), q, sealContent(req, q));
    if (!row) return res.status(404).json({ error: 'Question not found' });
    hooks.onQuestionsChanged(dekOf(req));
    res.json(questionKeys.decryptRow(row, dekOf(req)));
  }));

  api.delete('/questions/:id', ...qm, route(async (req, res) => {
    await store.deleteQuestion(Number(req.params.id));
    hooks.onQuestionsChanged(dekOf(req));
    res.json({ success: true });
  }));

  api.post('/questions/:id/move', small, ...qm, route(async (req, res) => {
    check(['up', 'down'].includes(req.body?.direction), 'direction must be up or down');
    if (!(await store.moveQuestion(Number(req.params.id), req.body.direction))) return res.status(404).json({ error: 'Question not found' });
    hooks.onQuestionsChanged(dekOf(req));
    res.json({ success: true });
  }));

  api.put('/levels/:level/timer', small, ...qm, route(async (req, res) => {
    const level = Number(req.params.level);
    const seconds = Math.round(Number(req.body?.seconds));
    check([1, 2, 3].includes(level), 'Level must be 1, 2 or 3');
    check(seconds >= 5 && seconds <= 300, 'Timer must be between 5 and 300 seconds');
    await store.setLevelTimer(level, seconds);
    hooks.onQuestionsChanged(dekOf(req));
    res.json({ success: true });
  }));

  // The only path from the encrypted bank to the live event: the quiz master decrypts the active
  // questions into the game server's memory. The coordinator then runs the game.
  api.get('/game/questions-status', requireStaff(QM), (req, res) => {
    res.json(hooks.gameQuestionsStatus());
  });

  api.post('/game/load-questions', ...qm, route(async (req, res) => {
    const result = await hooks.loadQuestionsIntoGame(dekOf(req), req.session.staff);
    if (result.error) return res.status(409).json(result);
    res.json(result);
  }));

  return api;
};
