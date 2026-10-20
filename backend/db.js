const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL } = process.env;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set in backend/.env');
}

// Secret-key client: bypasses RLS. Never expose this key to the frontend.
const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Writes run one at a time in order (so a game row exists before its participants),
// off the gameplay path. A failed write is logged and never blocks or crashes the game.
let writeQueue = Promise.resolve();
function enqueue(label, fn) {
  writeQueue = writeQueue
    .then(fn)
    .then(({ error } = {}) => {
      if (error) console.error(`[db] ${label} failed:`, error.message);
    })
    .catch(err => console.error(`[db] ${label} failed:`, err.message));
  return writeQueue;
}

function toQuestion(row) {
  return {
    id: row.id,
    level: row.level,
    text: row.text,
    type: row.type,
    options: row.options || [],
    correctAnswer: row.correct_answer,
    timeLimit: row.time_limit,
    points: row.points,
    imageUrl: row.image_url,
  };
}

function toParticipantRow(gameId, p) {
  return {
    id: p.id,
    game_id: gameId,
    name: p.name,
    team: p.team || null,
    score: p.score,
    streak: p.streak,
    total_response_ms: p.totalResponseTime,
    final_rank: p.finalRank ?? null,
    ticket_id: p.ticketId ?? null,
    status: p.status || 'active',
    avatar: p.avatar ?? null,
    eliminated_level: p.exit?.level ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function getAllQuestions() {
  const { data, error } = await supabase
    .from('questions')
    .select('*')
    .eq('is_active', true)
    .order('level')
    .order('position')
    .order('id')
    .abortSignal(AbortSignal.timeout(10000)); // never leave the host waiting on a stalled request
  if (error) throw new Error(`Loading questions failed: ${error.message}`);
  return data.map(toQuestion);
}

// The game row is created when the host starts the game, so lobbies that never start leave no trace.
function markGameStarted(gameId, players) {
  enqueue('markGameStarted', () => supabase
    .from('games')
    .upsert({ id: gameId, name: "TechSprint · Vyuham '26", status: 'running', started_at: new Date().toISOString() }));
  return saveParticipants(gameId, players);
}

function saveParticipants(gameId, players) {
  if (players.length === 0) return writeQueue;
  return enqueue('saveParticipants', () => supabase
    .from('participants')
    .upsert(players.map(p => toParticipantRow(gameId, p))));
}

// Called once per question at end_question: all answers plus updated scores in two requests.
function saveQuestionResults(gameId, questionId, answers, players) {
  saveParticipants(gameId, players);
  if (answers.length === 0) return writeQueue;
  return enqueue('saveAnswers', () => supabase
    .from('answers')
    .upsert(answers.map(a => ({
      game_id: gameId,
      participant_id: a.participantId,
      question_id: questionId,
      answer: a.answer,
      is_correct: a.isCorrect,
      points: a.pointsEarned,
      response_ms: a.time,
      badge: a.badge,
    })), { onConflict: 'participant_id,question_id', ignoreDuplicates: true }));
}

// rankedPlayers is in final order; disqualified players get no rank.
function finishGame(gameId, rankedPlayers) {
  let rank = 0;
  saveParticipants(gameId, rankedPlayers.map(p => ({ ...p, finalRank: p.status === 'disqualified' ? null : ++rank })));
  return enqueue('finishGame', () => supabase
    .from('games')
    .update({ status: 'finished', ended_at: new Date().toISOString() })
    .eq('id', gameId));
}

// Players who left before the end (cut after a level, or disqualified). Their participants rows
// must already be saved (the write queue keeps the order).
function recordEliminations(gameId, players) {
  if (players.length === 0) return writeQueue;
  return enqueue('recordEliminations', () => supabase
    .from('eliminations')
    .upsert(players.map(p => ({
      game_id: gameId,
      participant_id: p.id,
      ticket_id: p.ticketId ?? null,
      name: p.name,
      level: p.exit.level,
      round: p.exit.round,
      reason: p.exit.reason,
      note: p.exit.note?.slice(0, 300) ?? null,
      rank_at_exit: p.exit.rank,
      score_at_exit: p.exit.score,
      staff_id: p.exit.staffId ?? null,
    })), { onConflict: 'game_id,participant_id', ignoreDuplicates: true }));
}

// Activity log rows (see game.js logEvent), written in batches.
function logEvents(rows) {
  if (rows.length === 0) return writeQueue;
  return enqueue('logEvents', () => supabase.from('participant_events').insert(rows));
}

function deleteParticipant(participantId) {
  return enqueue('deleteParticipant', () => supabase
    .from('participants')
    .delete()
    .eq('id', participantId));
}

async function replaceQuestions(questions) {
  const { error: delError } = await supabase.from('questions').delete().gte('id', 0);
  if (delError) throw new Error(`Clearing questions failed: ${delError.message}`);
  const rows = questions.map((q, i) => ({
    level: q.level || 1,
    position: i,
    text: q.text,
    type: q.type,
    options: q.options || [],
    correct_answer: q.correctAnswer,
    time_limit: q.timeLimit || 20,
    points: q.points || 1000,
    image_url: q.imageUrl || null,
  }));
  const { error } = await supabase.from('questions').insert(rows);
  if (error) throw new Error(`Inserting questions failed: ${error.message}`);
}

module.exports = {
  supabase,
  getAllQuestions,
  markGameStarted,
  saveParticipants,
  saveQuestionResults,
  finishGame,
  deleteParticipant,
  recordEliminations,
  logEvents,
  replaceQuestions,
  flush: () => writeQueue,
};
