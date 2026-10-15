// Calls from the admin API (on Vercel) to the live game server (event-day laptop, published via
// Cloudflare Tunnel). Authenticated with a shared secret, GAME_LINK_SECRET, set on both sides.
const store = require('./store');

const LINK_HEADER = 'x-techsprint-link';
const URL_CACHE_MS = 10 * 1000;
let cached = { url: '', at: 0 };

async function gameServerUrl() {
  if (Date.now() - cached.at < URL_CACHE_MS) return cached.url;
  const s = await store.getSettings();
  cached = { url: String(s.game_server_url || '').replace(/\/+$/, ''), at: Date.now() };
  return cached.url;
}

function linkSecret() {
  const secret = process.env.GAME_LINK_SECRET;
  if (!secret || secret.length < 32) throw new Error('GAME_LINK_SECRET is not set (needs 32+ characters)');
  return secret;
}

// Never throws: returns the game server's JSON, or { error, offline? }.
async function call(method, path, body) {
  const base = await gameServerUrl();
  if (!base) return { error: 'No game server address set — an admin sets it in Admin → Overview', offline: true };
  let secret;
  try { secret = linkSecret(); } catch (err) { console.error('[remoteGame]', err.message); return { error: 'Game server link is not configured on this deployment' }; }
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', [LINK_HEADER]: secret },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { error: data.error || `Game server error (${res.status})` };
    return data;
  } catch {
    return { error: `Game server at ${base} is offline or unreachable`, offline: true };
  }
}

module.exports = { LINK_HEADER, linkSecret, gameServerUrl, call, invalidate: () => { cached.at = 0; } };
