// Question bank encryption (envelope encryption, Node's built-in crypto only).
//
//   DEK   random 256-bit data key; encrypts every question (AES-256-GCM). Never stored in the clear.
//   KEK   key-encryption key = HMAC-SHA256(server secret, scrypt(PIN or recovery code, salt)).
//         Needs both the secret (QUESTION_VAULT_SECRET, server only) and the PIN, so a database
//         copy alone can't be brute-forced.
//   Each quiz master has an X25519 key pair; the private key is sealed with their KEK and the DEK
//   is wrapped to their public key. Any unlocked quiz master can therefore grant the DEK to the
//   others without knowing their PINs. A recovery code wraps one more copy of the DEK.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

const b64 = buf => Buffer.from(buf).toString('base64');
const unb64 = s => Buffer.from(s, 'base64');

class VaultError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function serverSecret() {
  const raw = process.env.QUESTION_VAULT_SECRET;
  const secret = raw ? Buffer.from(raw, 'base64') : null;
  if (!secret || secret.length < 32) {
    throw new VaultError('QUESTION_VAULT_SECRET is missing or too short in backend/.env', 'NO_SECRET');
  }
  return secret;
}

// ─── AES-256-GCM: "iv.tag.ciphertext" (base64), bound to a purpose string ─────
function seal(key, plaintext, purpose) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map(b64).join('.');
}

function open(key, sealed, purpose) {
  const [iv, tag, ct] = String(sealed).split('.').map(unb64);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]); // throws if key/data is wrong
}

async function deriveKek(secret, saltB64) {
  const stretched = await scrypt(String(secret), unb64(saltB64), 32, SCRYPT);
  return crypto.createHmac('sha256', serverSecret()).update(stretched).digest();
}

// ─── Per-quiz-master key pair ─────────────────────────────────────────────────
async function createKeyPair(pin) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const salt = b64(crypto.randomBytes(16));
  const kek = await deriveKek(pin, salt);
  return {
    vault_public_key: b64(publicKey.export({ type: 'spki', format: 'der' })),
    vault_private_key: seal(kek, privateKey.export({ type: 'pkcs8', format: 'der' }), 'techsprint:private-key'),
    vault_key_salt: salt,
  };
}

async function openPrivateKey(staffRow, pin) {
  const kek = await deriveKek(pin, staffRow.vault_key_salt);
  const der = open(kek, staffRow.vault_private_key, 'techsprint:private-key');
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

function sharedKey(privateKey, publicKey) {
  const shared = crypto.diffieHellman({ privateKey, publicKey });
  return Buffer.from(crypto.hkdfSync('sha256', shared, Buffer.alloc(0), 'techsprint:dek-wrap', 32));
}

// Wrap the DEK to a quiz master's public key: "ephemeralPublicKey:sealedDek".
function wrapForPublicKey(dek, publicKeyB64) {
  const recipient = crypto.createPublicKey({ key: unb64(publicKeyB64), format: 'der', type: 'spki' });
  const eph = crypto.generateKeyPairSync('x25519');
  const sealed = seal(sharedKey(eph.privateKey, recipient), dek, 'techsprint:dek');
  return `${b64(eph.publicKey.export({ type: 'spki', format: 'der' }))}:${sealed}`;
}

function unwrapWithPrivateKey(wrapped, privateKey) {
  const i = wrapped.indexOf(':');
  const eph = crypto.createPublicKey({ key: unb64(wrapped.slice(0, i)), format: 'der', type: 'spki' });
  return open(sharedKey(privateKey, eph), wrapped.slice(i + 1), 'techsprint:dek');
}

// ─── Recovery code (Crockford base32, grouped: XXXX-XXXX-XXXX-XXXX-XXXX-XXXX) ──
const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function newRecoveryCode() {
  const bytes = crypto.randomBytes(15);
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  const chars = bits.match(/.{5}/g).map(c => B32[parseInt(c, 2)]).join('');
  return chars.match(/.{4}/g).join('-');
}
const normalizeRecoveryCode = code => String(code || '').toUpperCase()
  .replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

async function wrapWithRecoveryCode(dek, code) {
  const salt = b64(crypto.randomBytes(16));
  const kek = await deriveKek(normalizeRecoveryCode(code), salt);
  return { recovery_salt: salt, recovery_wrapped: seal(kek, dek, 'techsprint:recovery') };
}

async function unwrapWithRecoveryCode(vaultRow, code) {
  const kek = await deriveKek(normalizeRecoveryCode(code), vaultRow.recovery_salt);
  return open(kek, vaultRow.recovery_wrapped, 'techsprint:recovery');
}

// ─── Question payloads ────────────────────────────────────────────────────────
function encryptQuestion(dek, { text, options, correctAnswer }) {
  return seal(dek, Buffer.from(JSON.stringify({ text, options, correctAnswer })), 'techsprint:question');
}

function decryptQuestion(dek, payload) {
  return JSON.parse(open(dek, payload, 'techsprint:question').toString('utf8'));
}

const newDek = () => crypto.randomBytes(32);

// ─── Session-held DEK (serverless) ────────────────────────────────────────────
// While unlocked, the DEK is stored with the session, sealed under a key derived from the
// session token. The database keeps only the token's hash, so the row alone can't be opened.
const sessionKey = token => Buffer.from(crypto.hkdfSync('sha256', Buffer.from(String(token)), Buffer.alloc(0), 'techsprint:session-dek', 32));
const sealForSession = (token, dek) => seal(sessionKey(token), dek, 'techsprint:session-dek');
const openForSession = (token, sealed) => open(sessionKey(token), sealed, 'techsprint:session-dek');

module.exports = {
  VaultError,
  serverSecret,
  createKeyPair,
  openPrivateKey,
  wrapForPublicKey,
  unwrapWithPrivateKey,
  newRecoveryCode,
  wrapWithRecoveryCode,
  unwrapWithRecoveryCode,
  encryptQuestion,
  decryptQuestion,
  newDek,
  sealForSession,
  openForSession,
};
