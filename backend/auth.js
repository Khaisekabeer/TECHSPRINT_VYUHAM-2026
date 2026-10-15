// Staff authentication: scrypt password/PIN hashing, sessions (cached in memory, persisted in
// Supabase so a server restart doesn't sign everyone out), role guards and attempt limiting.
const crypto = require('crypto');
const { promisify } = require('util');
const store = require('./store');

const scrypt = promisify(crypto.scrypt);
const SESSION_TTL_MS = 14 * 60 * 60 * 1000; // one event day
const VAULT_TTL_MS = 30 * 60 * 1000;        // question bank stays unlocked for 30 minutes

// ─── Hashing ──────────────────────────────────────────────────────────────────
async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(secret, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function verifySecret(secret, stored) {
  if (typeof secret !== 'string' || typeof stored !== 'string') return false;
  const [alg, saltHex, keyHex] = stored.split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const key = await scrypt(secret, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(key, expected);
}

const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');

// ─── Attempt limiting (per key: IP for logins, session for PINs) ──────────────
const attempts = new Map(); // key -> { count, until }
function isLockedOut(key) {
  const a = attempts.get(key);
  return !!a && a.until > Date.now() && a.count >= a.max;
}
function recordFailure(key, max, windowMs) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || a.until <= now) attempts.set(key, { count: 1, max, until: now + windowMs });
  else a.count += 1;
}
const clearFailures = key => attempts.delete(key);

// ─── Sessions ─────────────────────────────────────────────────────────────────
const cache = new Map(); // tokenHash -> { staff, expiresAt, vaultUntil }

function toSessionStaff(s) {
  return { id: s.id, username: s.username, displayName: s.display_name, role: s.role };
}

async function createSession(staffRow) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await store.insertSession({ token_hash: tokenHash, staff_id: staffRow.id, expires_at: new Date(expiresAt).toISOString() });
  cache.set(tokenHash, { staff: toSessionStaff(staffRow), expiresAt, vaultUntil: 0 });
  return token;
}

async function getSession(token) {
  if (typeof token !== 'string' || token.length < 32) return null;
  const tokenHash = sha256(token);
  const hit = cache.get(tokenHash);
  if (hit) {
    if (hit.expiresAt > Date.now()) return { ...hit, tokenHash };
    cache.delete(tokenHash);
    return null;
  }
  const row = await store.getSessionWithStaff(tokenHash);
  if (!row || !row.staff?.active) return null;
  const expiresAt = new Date(row.expires_at).getTime();
  if (expiresAt <= Date.now()) return null;
  const session = {
    staff: toSessionStaff(row.staff),
    expiresAt,
    vaultUntil: row.vault_until ? new Date(row.vault_until).getTime() : 0,
  };
  cache.set(tokenHash, session);
  return { ...session, tokenHash };
}

async function unlockVault(tokenHash) {
  const vaultUntil = Date.now() + VAULT_TTL_MS;
  await store.setSessionVault(tokenHash, new Date(vaultUntil).toISOString());
  const s = cache.get(tokenHash);
  if (s) s.vaultUntil = vaultUntil;
  return vaultUntil;
}

async function lockVault(tokenHash) {
  await store.setSessionVault(tokenHash, null);
  const s = cache.get(tokenHash);
  if (s) s.vaultUntil = 0;
}

async function endSession(tokenHash) {
  cache.delete(tokenHash);
  await store.deleteSession(tokenHash);
}

// Used when an account is deactivated or its password/role changes.
async function endSessionsForStaff(staffId) {
  for (const [hash, s] of cache) if (s.staff.id === staffId) cache.delete(hash);
  await store.deleteSessionsForStaff(staffId);
}

// ─── Express guards ───────────────────────────────────────────────────────────
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

function requireStaff(...roles) {
  return async (req, res, next) => {
    try {
      const session = await getSession(bearer(req));
      if (!session) return res.status(401).json({ error: 'Please sign in again' });
      if (roles.length && !roles.includes(session.staff.role)) {
        return res.status(403).json({ error: 'Your role does not have access to this' });
      }
      req.session = session;
      next();
    } catch (err) {
      console.error('[auth]', err.message);
      res.status(503).json({ error: 'Authentication service unavailable, try again' });
    }
  };
}

function requireVault(req, res, next) {
  if (!(req.session?.vaultUntil > Date.now())) {
    return res.status(423).json({ error: 'Question bank is locked — enter your quiz master PIN', locked: true });
  }
  next();
}

// First run: create a coordinator so someone can sign in and set up the rest.
async function ensureBootstrapCoordinator() {
  if ((await store.countStaff()) > 0) return;
  const password = process.env.ADMIN_PASSWORD || 'admin';
  await store.createStaff({
    username: 'admin',
    display_name: 'Coordinator',
    role: 'coordinator',
    password_hash: await hashSecret(password),
  });
  console.warn('Created first coordinator account "admin" (password = ADMIN_PASSWORD). Change it in Admin → Staff.');
}

module.exports = {
  VAULT_TTL_MS,
  hashSecret,
  verifySecret,
  isLockedOut,
  recordFailure,
  clearFailures,
  createSession,
  getSession,
  unlockVault,
  lockVault,
  endSession,
  endSessionsForStaff,
  requireStaff,
  requireVault,
  ensureBootstrapCoordinator,
};
