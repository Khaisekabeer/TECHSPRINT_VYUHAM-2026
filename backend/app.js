// The admin/staff HTTP app (no live game). Runs:
//   - inside server.js, next to the game in one process (development / laptop-only fallback)
//   - on Vercel as a serverless function (api/index.js), talking to the laptop's game server
const express = require('express');
const cors = require('cors');
const createApi = require('./api');
const questionKeys = require('./questionKeys');
const remote = require('./remoteGame');

function createApp(hooks) {
  const app = express();
  app.disable('x-powered-by');
  // On Vercel the visitor's IP is in X-Forwarded-For (Vercel overwrites it, so it can't be
  // spoofed); login attempt limits are keyed on it. Elsewhere, use the connection address.
  if (process.env.VERCEL) app.set('trust proxy', true);
  app.use(cors());
  app.use('/api', createApi(hooks));
  return app;
}

// Game in the same process.
function localHooks(game) {
  return {
    async onQuestionsChanged(dek) {
      // Edits in the lobby refresh questions that were already loaded; a running game keeps its list.
      const s = game.status();
      if (s.state !== 'lobby' || !s.count) return;
      try {
        game.loadQuestions(await questionKeys.loadGameQuestions(dek), s.by);
      } catch (err) {
        console.error(err.message);
      }
    },
    async loadQuestionsIntoGame(dek, staff) {
      return game.loadQuestions(await questionKeys.loadGameQuestions(dek), staff.displayName);
    },
    async gameStatus() {
      return game.status();
    },
    async onSettingsChanged(next) {
      game.applySettings(next);
    },
  };
}

// Game on another machine (Vercel → Cloudflare Tunnel → laptop).
function remoteHooks() {
  return {
    async onQuestionsChanged() {
      // The quiz master presses "Reload into game" after edits.
    },
    async loadQuestionsIntoGame(dek, staff) {
      const questions = await questionKeys.loadGameQuestions(dek);
      return remote.call('POST', '/internal/questions', { questions, by: staff.displayName });
    },
    async gameStatus() {
      const r = await remote.call('GET', '/internal/status');
      return r.error ? { online: false, error: r.error, count: 0 } : r;
    },
    async onSettingsChanged(next) {
      remote.invalidate();
      if (next.requireCheckin !== undefined) await remote.call('POST', '/internal/settings', next);
    },
  };
}

module.exports = { createApp, localHooks, remoteHooks };
