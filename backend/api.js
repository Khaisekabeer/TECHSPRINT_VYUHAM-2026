// Staff REST API. Roles:
//   admin        management: participants (MakeMyPass CSV), staff, check-in, settings, results
//   quizmaster   builds the question sets; each set is encrypted and opened with its own PIN
//   coordinator  conducts the live event; loads a question set by entering its PIN
//   volunteer    pass check-in and live monitoring
const crypto = require('crypto');
const express = require('express');
const auth = require('./auth');
const store = require('./store');
const vault = require('./vault');
const questionKeys = require('./questionKeys');
const mail = require('./mail');

const { requireStaff, requireVault } = auth;
const ADMIN = 'admin';
const COORD = 'coordinator';
const QM = 'quizmaster';
const VOL = 'volunteer';
const ROLES = [ADMIN, QM, COORD, VOL];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const THEMES = ['blast', 'pop', 'arcade', 'circuit', 'classic'];
const CUT_RULES = ['top', 'percent', 'min_score', 'bottom', 'min_correct'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const VIDEO_TYPES = ['video/mp4', 'video/webm'];
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

const USERNAME_RE = /^[a-zA-Z0-9._@+-]{3,64}$/; // plain usernames or email addresses

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
  const text = str(body.text, 1000);
  const options = type === 'tf'
    ? ['True', 'False']
    : (Array.isArray(body.options) ? body.options.map(o => str(o, 160)).filter(Boolean) : []);
  const correctAnswer = str(body.correctAnswer, 160);
  const note = str(body.note, 300); // optional, shown on phones after the answer is revealed
  const timeLimit = Math.round(Number(body.timeLimit));
  const points = Math.round(Number(body.points));

  check(Number.isInteger(level) && level >= 1 && level <= 99, 'Choose a level');
  check(text.length > 0, 'Question text is required');
  check(options.length >= 2 && options.length <= 4, 'Multiple choice needs 2 to 4 options');
  check(new Set(options.map(o => o.toLowerCase())).size === options.length, 'Options must be different');
  check(options.includes(correctAnswer), 'Pick the correct answer from the options');
  check(timeLimit >= 5 && timeLimit <= 300, 'Timer must be between 5 and 300 seconds');
  check(points >= 100 && points <= 10000, 'Points must be between 100 and 10000');
  // Optional picture for "identify this person / object" questions (uploaded separately, encrypted).
  const imageId = body.imageId == null || body.imageId === '' ? null : String(body.imageId);
  check(imageId === null || UUID_RE.test(imageId), 'Invalid image');
  // Optional video, uploaded separately (stored in the private video bucket).
  const videoId = body.videoId == null || body.videoId === '' ? null : String(body.videoId);
  check(videoId === null || UUID_RE.test(videoId), 'Invalid video');
  return { level, type, text, options, correctAnswer, note, backup: body.backup === true, timeLimit, points, imageId, videoId, isActive: body.isActive !== false };
}

/**
 * Hooks connect the API to the live game, either in the same process or on another machine
 * (see app.js localHooks / remoteHooks). All are async.
 * @param hooks.onQuestionsChanged(dek, bankId)     refresh already-loaded game questions (lobby only)
 * @param hooks.loadQuestionsIntoGame(dek, staff, bank)  decrypt a set's active questions into the game
 * @param hooks.gameStatus()                       { online, state, count, by, players }
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


  api.post('/auth/logout', requireStaff(), route(async (req, res) => {
    await auth.endSession(req.session.tokenHash);
    res.json({ success: true });
  }));

  // ─── Password reset via email OTP ──────────────────────────────────────────
  api.post('/auth/forgot-password', small, route(async (req, res) => {
    const ipKey = `forgot:${req.ip}`;
    if (auth.isLockedOut(ipKey)) return res.status(429).json({ error: 'Too many reset requests. Wait a few minutes.' });

    const emailOrUsername = str(req.body?.email || req.body?.username, 160).toLowerCase();
    check(emailOrUsername, 'Enter your registered email address or username');
    auth.recordFailure(ipKey, 5, 15 * 60 * 1000);

    // The same answer whether or not the account exists, so this can't be used to find staff accounts.
    const sent = { success: true, message: 'If that account has an email address, a verification code has been sent. Otherwise ask an administrator.' };
    const staff = await store.findStaffForLogin(emailOrUsername);
    const targetEmail = staff?.active && staff.username.includes('@') ? staff.username : null;
    if (!targetEmail) return res.json(sent);

    const otp = String(crypto.randomInt(100000, 1000000));
    const otpHash = crypto.createHash('sha256').update(otp).digest('hex');
    const expiresAt = Date.now() + 15 * 60 * 1000;

    await store.setSetting(`otp:${staff.id}`, {
      otpHash,
      email: targetEmail,
      expiresAt,
      attempts: 0,
    });

    try {
      await mail.sendPasswordResetOtp(targetEmail, otp, staff.display_name);
      res.json(sent);
    } catch (err) {
      console.error('[forgot-password]', err.message);
      res.status(500).json({ error: 'Could not send verification email right now. Please try again later or contact admin.' });
    }
  }));

  api.post('/auth/reset-password', small, route(async (req, res) => {
    const emailOrUsername = str(req.body?.email || req.body?.username, 160).toLowerCase();
    const otp = str(String(req.body?.otp ?? ''), 10).trim();
    const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    check(emailOrUsername, 'Username or email is required');
    check(otp.length === 6, 'Verification code must be 6 digits');
    check(newPassword.length >= 8, 'New password must be at least 8 characters');

    const ipKey = `reset:${req.ip}`;
    if (auth.isLockedOut(ipKey)) return res.status(429).json({ error: 'Too many attempts. Wait a few minutes.' });
    const invalid = () => {
      auth.recordFailure(ipKey, 10, 15 * 60 * 1000);
      return res.status(400).json({ error: 'Invalid or expired verification code' });
    };

    const staff = await store.findStaffForLogin(emailOrUsername);
    if (!staff || !staff.active) return invalid();

    const record = await store.getSetting(`otp:${staff.id}`);
    if (!record || !record.expiresAt || Date.now() > record.expiresAt) return invalid();

    if (record.attempts >= 5) {
      await store.deleteSetting(`otp:${staff.id}`);
      return res.status(429).json({ error: 'Too many failed attempts. Please request a new code.' });
    }

    const givenHash = crypto.createHash('sha256').update(otp).digest('hex');
    if (givenHash !== record.otpHash) {
      record.attempts = (record.attempts || 0) + 1;
      await store.setSetting(`otp:${staff.id}`, record);
      return invalid();
    }

    await store.updateStaff(staff.id, { password_hash: await auth.hashSecret(newPassword) });
    await store.deleteSetting(`otp:${staff.id}`);
    await store.endStaffSessions(staff.id);

    res.json({ success: true, message: 'Password has been reset successfully. You can now sign in.' });
  }));

  // ─── Question sets ("Main set", "Trial set", ...), each opened with its own PIN ──
  // Wrong PINs are limited per person and set (5 per 5 minutes) and per set overall (30 per 15
  // minutes), so a set PIN can't be guessed by trying many accounts.
  function pinLimited(req, res, bankId) {
    const keys = [[`setpin:${bankId}:${req.session.staff.id}`, 5, 5 * 60 * 1000], [`setpin:${bankId}`, 30, 15 * 60 * 1000]];
    if (keys.some(([key]) => auth.isLockedOut(key))) {
      res.status(429).json({ error: 'Too many wrong PINs for this set. Wait a few minutes.' });

      return null;
    }
    return {
      fail: () => keys.forEach(([key, max, ms]) => auth.recordFailure(key, max, ms)),
      ok: () => auth.clearFailures(keys[0][0]),
    };
  }

  function vaultFailure(res, err, limiter) {
    if (err instanceof vault.VaultError) {
      if (['BAD_PIN', 'BAD_RECOVERY'].includes(err.code)) limiter?.fail();
      // 403, not 401: a wrong set PIN must not look like an expired sign-in (that signs people out).
      const status = { BAD_PIN: 403, BAD_RECOVERY: 403, NOT_FOUND: 404, NO_SECRET: 500 }[err.code] ?? 400;
      if (err.code === 'NO_SECRET') console.error('[vault]', err.message);
      return res.status(status).json({ error: err.code === 'NO_SECRET' ? 'Question encryption is not configured on the server' : err.message, code: err.code });
    }
    throw err;
  }

  // Open a set in this session (one at a time) and tidy it up.
  async function openSet(req, bank, dek) {
    const vaultUntil = await auth.unlockVault(req.session, dek, bank.id);
    await questionKeys.afterOpen(bank.id, dek);
    return { vaultUntil, bank: { id: bank.id, name: bank.name } };
  }

  const bankName = v => str(v, 60);
  const isUuid = v => typeof v === 'string' && UUID_RE.test(v);

  api.get('/auth/me', requireStaff(), route(async (req, res) => {
    const open = auth.vaultOpen(req.session);
    const bank = open ? await store.getBank(req.session.bankId) : null;
    res.json({ staff: req.session.staff, vaultUntil: open ? req.session.vaultUntil : null, vaultBank: bank && { id: bank.id, name: bank.name } });
  }));

  // Names and counts only (never questions): quiz masters manage sets, the coordinator picks one to load.
  api.get('/banks', requireStaff(QM, COORD, ADMIN), route(async (req, res) => {
    res.json(await store.listBanks());
  }));

  // New set: the quiz master names it and chooses its PIN. The recovery code is shown once.
  api.post('/banks', small, requireStaff(QM), route(async (req, res) => {
    const name = bankName(req.body?.name);
    check(name, 'Give the set a name, e.g. "Main set"');
    check((await store.listBanks()).length < 20, 'At most 20 question sets');
    try {
      const { bank, dek, recoveryCode } = await questionKeys.createBank(name, req.body?.pin, req.session.staff.id);
      // Start it with one level so questions can be added straight away.
      await store.createLevel(bank.id, { name: 'Round 1', multiplier: 1 });
      res.status(201).json({ ...(await openSet(req, bank, dek)), recoveryCode });
    } catch (err) {
      vaultFailure(res, err);
    }
  }));

  api.post('/banks/:id/open', small, requireStaff(QM), route(async (req, res) => {
    check(isUuid(req.params.id), 'Invalid set');
    const limiter = pinLimited(req, res, req.params.id);
    if (!limiter) return;
    try {
      const { bank, dek } = await questionKeys.openBank(req.params.id, req.body?.pin);
      limiter.ok();
      res.json(await openSet(req, bank, dek));
    } catch (err) {
      vaultFailure(res, err, limiter);
    }
  }));

  // First PIN for a set that has none (the old single bank, moved into a set). Its questions are
  // already encrypted, so the old quiz master PIN of this account (or the old recovery code) is
  // needed once to carry the key over.
  api.post('/banks/:id/setup', small, requireStaff(QM), route(async (req, res) => {
    check(isUuid(req.params.id), 'Invalid set');
    const limiter = pinLimited(req, res, req.params.id);
    if (!limiter) return;
    try {
      const staffRow = await store.getStaffRow(req.session.staff.id);
      const { bank, dek, recoveryCode } = await questionKeys.setupBank(req.params.id, req.body?.pin, {
        staffRow,
        legacyPin: req.body?.oldPin,
        legacyRecoveryCode: req.body?.oldRecoveryCode ? String(req.body.oldRecoveryCode) : null,
      });
      limiter.ok();
      res.json({ ...(await openSet(req, bank, dek)), recoveryCode });
    } catch (err) {
      vaultFailure(res, err, limiter);
    }
  }));

  // Forgotten PIN: the set's recovery code sets a new PIN and opens the set.
  api.post('/banks/:id/recover', small, requireStaff(QM), route(async (req, res) => {
    check(isUuid(req.params.id), 'Invalid set');
    const limiter = pinLimited(req, res, req.params.id);
    if (!limiter) return;
    try {
      const { bank, dek } = await questionKeys.recoverBank(req.params.id, String(req.body?.recoveryCode ?? ''), req.body?.pin);
      limiter.ok();
      res.json(await openSet(req, bank, dek));
    } catch (err) {
      vaultFailure(res, err, limiter);
    }
  }));

  // Change a set's PIN (needs the current one). Tell the coordinator the new PIN.
  api.post('/banks/:id/pin', small, requireStaff(QM), route(async (req, res) => {
    check(isUuid(req.params.id), 'Invalid set');
    const limiter = pinLimited(req, res, req.params.id);
    if (!limiter) return;
    try {
      await questionKeys.changeBankPin(req.params.id, req.body?.currentPin, req.body?.pin);
      limiter.ok();
      res.json({ success: true });
    } catch (err) {
      vaultFailure(res, err, limiter);
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
    check(USERNAME_RE.test(username), 'Username: an email address, or 3-64 letters, numbers, dot, dash or underscore');
    check(displayName, 'Name is required');
    check(ROLES.includes(role), 'Choose a role');
    check(password.length >= 8, 'Password must be at least 8 characters');
    check(!(await store.findStaffForLogin(username)), 'That username is taken');
    const staff = await store.createStaff({
      username,
      display_name: displayName,
      role,
      password_hash: await auth.hashSecret(password),
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
      const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
      check(currentPassword.length > 0, 'Your current admin password is required to change a password');
      const currentAdmin = await store.getStaffRow(req.session.staff.id);
      const isCurrentPasswordValid = currentAdmin && await auth.verifySecret(currentPassword, currentAdmin.password_hash);
      if (!isCurrentPasswordValid) {
        return res.status(401).json({ error: 'Incorrect current password' });
      }
      fields.password_hash = await auth.hashSecret(req.body.password);
      endSessions = !isSelf || endSessions;
    }
    // Never leave the event without an active admin.
    if (target.role === ADMIN && (fields.active === false || (fields.role && fields.role !== ADMIN))) {
      check((await store.countActiveAdmins()) > 1, 'There must be at least one active admin');
    }
    check(Object.keys(fields).length, 'Nothing to change');
    const staff = await store.updateStaff(target.id, fields);
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

  // ─── Public config (participant page, projector, socket address) ───────────
  const readConfig = async () => {
    const s = await store.getSettings();
    return { requireCheckin: s.require_checkin !== false, gameServerUrl: String(s.game_server_url || '') };
  };

  api.get('/config', route(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(await readConfig());
  }));

  // ─── Settings & results (admin) ────────────────────────────────────────────
  api.get('/settings', requireStaff(ADMIN), route(async (req, res) => {
    res.json(await readConfig());
  }));

  api.put('/settings', small, requireStaff(ADMIN), route(async (req, res) => {
    const next = {};
    if (req.body?.requireCheckin !== undefined) {
      check(typeof req.body.requireCheckin === 'boolean', 'requireCheckin must be true or false');
      await store.setSetting('require_checkin', req.body.requireCheckin);
      next.requireCheckin = req.body.requireCheckin;
    }
    if (req.body?.gameServerUrl !== undefined) {
      const url = str(req.body.gameServerUrl, 200).replace(/\/+$/, '');
      if (url) {
        let parsed;
        try { parsed = new URL(url); } catch { /* invalid */ }
        check(parsed && ['https:', 'http:'].includes(parsed.protocol) && !parsed.search && !parsed.hash,
          'Game server address must look like https://game.example.com');
      }
      await store.setSetting('game_server_url', url);
      next.gameServerUrl = url;
    }
    check(Object.keys(next).length, 'Nothing to change');
    await hooks.onSettingsChanged(next);
    res.json(await readConfig());
  }));

  // Live game server health for staff dashboards.
  api.get('/game/status', requireStaff(ADMIN, COORD, VOL), route(async (req, res) => {
    res.json(await hooks.gameStatus());
  }));

  api.get('/results/games', requireStaff(ADMIN), route(async (req, res) => {
    res.json(await store.listGames());
  }));

  // Quote every cell, and stop spreadsheet apps from running a player-chosen name as a formula.
  const csvCell = v => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const sendCsv = (res, filename, rows) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'));
  };
  const gameParam = req => (typeof req.query.game === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.game) ? req.query.game : null);
  const STATUS_LABEL = { active: 'Finalist', eliminated: 'Eliminated', disqualified: 'Disqualified' };

  // ?game=<id> for a specific game; otherwise the most recent finished one.
  api.get('/results/latest.csv', requireStaff(ADMIN), route(async (req, res) => {
    const gameId = gameParam(req);
    const result = await store.gameResults(gameId);
    if (!result) return res.status(404).json({ error: gameId ? 'Game not found' : 'No game has finished yet' });
    const rows = [['Rank', 'Status', 'Out after round', 'Reason', 'Display name', 'Ticket ID', 'Registered name', 'College', 'Email', 'Phone', 'Score']];
    for (const r of result.rows) {
      const exit = Array.isArray(r.exit) ? r.exit[0] : r.exit;
      rows.push([
        r.final_rank ?? '', STATUS_LABEL[r.status] ?? r.status, exit?.round ?? '', exit?.note ?? '',
        r.name, r.ticket_id, r.registration?.name, r.registration?.college, r.registration?.email, r.registration?.phone, r.score,
      ]);
    }
    sendCsv(res, 'techsprint-results.csv', rows);
  }));

  // Everything each candidate did in a game, in time order (same ?game= rule).
  api.get('/results/activity.csv', requireStaff(ADMIN), route(async (req, res) => {
    const gameId = gameParam(req);
    const result = await store.gameResults(gameId);
    if (!result) return res.status(404).json({ error: gameId ? 'Game not found' : 'No game has finished yet' });
    const rows = [['Time', 'Ticket ID', 'Player', 'Event', 'Question #', 'Details', 'IP']];
    for (const e of await store.gameEvents(result.game.id)) {
      const detail = Object.entries(e.detail || {})
        .filter(([, v]) => v !== null && v !== '')
        .map(([k, v]) => `${k}=${v}`)
        .join('; ');
      rows.push([new Date(e.at).toISOString(), e.ticket_id, e.player_name, e.event, e.question_index ?? '', detail, e.ip]);
    }
    sendCsv(res, 'techsprint-activity-log.csv', rows);
  }));

  // ─── The open question set (quiz master; contents encrypted at rest) ────────
  // Everything below works on the set this session opened with its PIN.
  const qm = [requireStaff(QM), requireVault];
  const dekOf = req => req.session.dek;
  const bankOf = req => req.session.bankId;
  const sealContent = (req, q) => vault.encryptQuestion(dekOf(req), { text: q.text, options: q.options, correctAnswer: q.correctAnswer, imageId: q.imageId, videoId: q.videoId, note: q.note, backup: q.backup });
  const changed = req => hooks.onQuestionsChanged(dekOf(req), bankOf(req));
  // The image or video a stored question points to (inside its encrypted content).
  const mediaOf = async (req, id) => {
    const row = (await store.listQuestionRows(bankOf(req))).find(r => r.id === id);
    const content = row ? questionKeys.decryptRow(row, dekOf(req)) : {};
    return { imageId: content.imageId ?? null, videoId: content.videoId ?? null };
  };

  // Rename or delete the open set.
  api.patch('/banks/current', small, ...qm, route(async (req, res) => {
    const name = bankName(req.body?.name);
    check(name, 'Give the set a name');
    await store.updateBank(bankOf(req), { name });
    res.json({ id: bankOf(req), name });
  }));

  api.delete('/banks/current', small, ...qm, route(async (req, res) => {
    const bank = await store.getBank(bankOf(req));
    check(bank && req.body?.confirmName === bank.name, 'Type the set name to confirm');
    // Video files live in storage, outside the database cascade.
    await store.deleteVideos(bank.id, (await store.listVideoMeta(bank.id)).map(v => v.id));
    await store.deleteBank(bank.id); // its levels, questions and pictures go with it
    await auth.lockVault(req.session.tokenHash);
    res.json({ success: true });
  }));

  // Upload a question image: the browser sends it resized (base64); stored encrypted.
  const imageBody = express.json({ limit: '5mb' });
  api.post('/questions/images', imageBody, ...qm, route(async (req, res) => {
    const mime = String(req.body?.mime || '');
    check(IMAGE_TYPES.includes(mime), 'Use a JPEG, PNG or WebP image');
    const bytes = Buffer.from(String(req.body?.data || ''), 'base64');
    check(bytes.length > 0 && bytes.length <= MAX_IMAGE_BYTES, 'Image must be under 3 MB');
    const image = await store.insertImage({ bank_id: bankOf(req), mime, payload: vault.encryptImage(dekOf(req), bytes), bytes: bytes.length, created_by: req.session.staff.id });
    res.status(201).json(image);
  }));

  // Preview for the quiz master (decrypted on the fly, never cached).
  api.get('/questions/images/:id', ...qm, route(async (req, res) => {
    check(UUID_RE.test(req.params.id), 'Invalid image');
    const [image] = await store.getImages([req.params.id], bankOf(req));
    if (!image) return res.status(404).json({ error: 'Image not found' });
    res.set({ 'Content-Type': image.mime, 'Cache-Control': 'no-store' });
    res.send(vault.decryptImage(dekOf(req), image.payload));
  }));

  // Upload a question video (up to 50 MB) in two steps: get a one-time link, the browser sends the file
  // straight to the private bucket, then the upload is recorded. The bucket enforces size and type.
  api.post('/questions/videos/upload', small, ...qm, route(async (req, res) => {
    check(VIDEO_TYPES.includes(req.body?.mime), 'Use an MP4 or WebM video');
    check(Number(req.body?.bytes) > 0 && Number(req.body.bytes) <= MAX_VIDEO_BYTES, 'Video must be under 50 MB');
    res.status(201).json(await store.createVideoUpload(bankOf(req)));
  }));

  api.post('/questions/videos', small, ...qm, route(async (req, res) => {
    const bankId = bankOf(req);
    const path = String(req.body?.path || '');
    // Only a file in this set's own folder can be attached to it.
    check(path.startsWith(`${bankId}/`) && UUID_RE.test(path.slice(bankId.length + 1)), 'Invalid video');
    const video = await store.insertVideo({ bank_id: bankId, path, created_by: req.session.staff.id });
    check(video, 'The video did not finish uploading — try again');
    res.status(201).json({ id: video.id });
  }));

  // Preview for the quiz master: a short-lived link to the video file (never cached).
  api.get('/questions/videos/:id', ...qm, route(async (req, res) => {
    check(UUID_RE.test(req.params.id), 'Invalid video');
    const [video] = await store.getVideos([req.params.id], bankOf(req));
    if (!video) return res.status(404).json({ error: 'Video not found' });
    res.set('Cache-Control', 'no-store').json({ url: await store.signedVideoUrl(video.path) });
  }));

  api.post('/questions/recovery-code', ...qm, route(async (req, res) => {
    res.json({ recoveryCode: await questionKeys.rotateRecoveryCode(bankOf(req), dekOf(req)) });
  }));

  api.get('/questions', ...qm, route(async (req, res) => {
    res.json((await store.listQuestionRows(bankOf(req))).map(r => questionKeys.decryptRow(r, dekOf(req))));
  }));

  const checkLevelExists = async (req, level) =>
    check((await store.listLevels(bankOf(req))).some(l => l.number === level), 'That level no longer exists — reload the page');

  api.post('/questions', small, ...qm, route(async (req, res) => {
    const q = validateQuestion(req.body || {});
    await checkLevelExists(req, q.level);
    const row = await store.createQuestion(bankOf(req), q, sealContent(req, q));
    changed(req);
    res.status(201).json(questionKeys.decryptRow(row, dekOf(req)));
  }));

  api.put('/questions/:id', small, ...qm, route(async (req, res) => {
    const q = validateQuestion(req.body || {});
    await checkLevelExists(req, q.level);
    const id = Number(req.params.id);
    const old = await mediaOf(req, id);
    const row = await store.updateQuestion(bankOf(req), id, q, sealContent(req, q));
    if (!row) return res.status(404).json({ error: 'Question not found' });
    if (old.imageId && old.imageId !== q.imageId) await store.deleteImages([old.imageId]);
    if (old.videoId && old.videoId !== q.videoId) await store.deleteVideos(bankOf(req), [old.videoId]);
    changed(req);
    res.json(questionKeys.decryptRow(row, dekOf(req)));
  }));

  api.delete('/questions/:id', ...qm, route(async (req, res) => {
    const id = Number(req.params.id);
    const media = await mediaOf(req, id);
    await store.deleteQuestion(bankOf(req), id);
    if (media.imageId) await store.deleteImages([media.imageId]);
    if (media.videoId) await store.deleteVideos(bankOf(req), [media.videoId]);
    changed(req);
    res.json({ success: true });
  }));

  api.post('/questions/:id/move', small, ...qm, route(async (req, res) => {
    check(['up', 'down'].includes(req.body?.direction), 'direction must be up or down');
    if (!(await store.moveQuestion(bankOf(req), Number(req.params.id), req.body.direction))) return res.status(404).json({ error: 'Question not found' });
    changed(req);
    res.json({ success: true });
  }));

  // Levels (rounds) of the open set: names and multipliers aren't secret, but only quiz masters manage them.
  function validateLevel(body) {
    const name = str(body?.name, 40);
    const multiplier = Math.round(Number(body?.multiplier) * 100) / 100;
    check(name, 'Level name is required');
    check(multiplier > 0 && multiplier <= 10, 'Multiplier must be between 0.1 and 10');
    const theme = body?.theme == null || body.theme === '' ? null : String(body.theme);
    check(theme === null || THEMES.includes(theme), 'Unknown theme');
    // Elimination at the end of the level (see gameEngine.computeCut); none = everyone advances.
    const cut = body?.cut;
    const rule = cut?.rule || null;
    check(rule === null || CUT_RULES.includes(rule), 'Unknown cut rule');
    const value = rule ? Number(cut.value) : null;
    if (rule) {
      const whole = ['top', 'bottom', 'min_correct'].includes(rule);
      check(Number.isFinite(value) && value >= (rule === 'min_score' ? 0 : 1) && (!whole || Number.isInteger(value)),
        rule === 'percent' ? 'Percent must be between 1 and 100' : rule === 'min_score' ? 'Minimum score must be 0 or more' : 'Enter a whole number of 1 or more');
      check(rule !== 'percent' || value <= 100, 'Percent must be between 1 and 100');
    }
    const ties = cut?.ties === 'include' ? 'include' : 'speed';
    return { name, multiplier, theme, cut_rule: rule, cut_value: value, cut_ties: ties };
  }

  api.get('/levels', ...qm, route(async (req, res) => {
    res.json(await store.listLevels(bankOf(req)));
  }));

  api.post('/levels', small, ...qm, route(async (req, res) => {
    const levels = await store.listLevels(bankOf(req));
    check(levels.length < 20, 'At most 20 levels');
    check(!levels.length || levels[levels.length - 1].number < 99, 'Level numbers are used up');
    const level = await store.createLevel(bankOf(req), validateLevel(req.body));
    res.status(201).json(level);
  }));

  api.put('/levels/:level', small, ...qm, route(async (req, res) => {
    const level = await store.updateLevel(bankOf(req), Number(req.params.level), validateLevel(req.body));
    if (!level) return res.status(404).json({ error: 'Level not found' });
    changed(req);
    res.json(level);
  }));

  api.delete('/levels/:level', ...qm, route(async (req, res) => {
    const number = Number(req.params.level);
    check((await store.countQuestionsInLevel(bankOf(req), number)) === 0, 'Move or delete the questions in this level first');
    await store.deleteLevel(bankOf(req), number);
    res.json({ success: true });
  }));

  api.put('/levels/:level/timer', small, ...qm, route(async (req, res) => {
    const level = Number(req.params.level);
    const seconds = Math.round(Number(req.body?.seconds));
    await checkLevelExists(req, level);
    check(seconds >= 5 && seconds <= 300, 'Timer must be between 5 and 300 seconds');
    await store.setLevelTimer(bankOf(req), level, seconds);
    changed(req);
    res.json({ success: true });
  }));

  // Switch a level off or on. An off level stays in the set but is left out of the game, so the levels
  // after it are numbered consecutively without it.
  api.put('/levels/:level/active', small, ...qm, route(async (req, res) => {
    const level = Number(req.params.level);
    await checkLevelExists(req, level);
    await store.setLevelActive(bankOf(req), level, req.body?.active !== false);
    changed(req);
    res.json({ success: true });
  }));

  // ─── Loading a set into the live game ────────────────────────────────────────
  // The only path from a set to the live event. The coordinator (or an admin) picks the set and
  // enters its PIN in the host console; a quiz master can also load the set they have open.
  // The questions are decrypted straight into the game server's memory.
  api.get('/game/questions-status', requireStaff(QM, COORD, ADMIN), route(async (req, res) => {
    res.json(await hooks.gameStatus());
  }));

  api.post('/game/load-questions', small, requireStaff(QM, COORD, ADMIN), route(async (req, res) => {
    const bankId = req.body?.bankId ?? (auth.vaultOpen(req.session) ? req.session.bankId : null);
    check(isUuid(bankId), 'Choose a question set');
    let bank;
    let dek;
    if (req.body?.pin == null && auth.vaultOpen(req.session) && req.session.bankId === bankId) {
      bank = await store.getBank(bankId);
      dek = req.session.dek;
    } else {
      const limiter = pinLimited(req, res, bankId);
      if (!limiter) return;
      try {
        ({ bank, dek } = await questionKeys.openBank(bankId, req.body?.pin));
        limiter.ok();
      } catch (err) {
        return vaultFailure(res, err, limiter);
      }
    }
    const result = await hooks.loadQuestionsIntoGame(dek, req.session.staff, { id: bank.id, name: bank.name });
    if (result.error) return res.status(result.offline ? 502 : 409).json(result);
    res.json(result);
  }));

  return api;
};
