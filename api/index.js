// Vercel serverless entry: the admin/staff API (no live game). The live game runs on the
// event-day laptop (backend/game-server.js); this API reaches it at the admin-configured
// "game server address" using GAME_LINK_SECRET.
const { createApp, remoteHooks } = require('../backend/app');

module.exports = createApp(remoteHooks());
