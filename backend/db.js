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
    drone_assists: p.droneAssists,
    total_response_ms: p.totalResponseTime,
    final_rank: p.finalRank ?? null,
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
    .order('id');
  if (error) throw new Error(`Loading questions failed: ${error.message}`);
  return data.map(toQuestion);
}

// The game row is created when the host starts the game, so lobbies that never start leave no trace.
function markGameStarted(gameId, players) {
  enqueue('markGameStarted', () => supabase
    .from('games')
    .upsert({ id: gameId, status: 'running', started_at: new Date().toISOString() }));
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

function finishGame(gameId, rankedPlayers) {
  saveParticipants(gameId, rankedPlayers.map((p, i) => ({ ...p, finalRank: i + 1 })));
  return enqueue('finishGame', () => supabase
    .from('games')
    .update({ status: 'finished', ended_at: new Date().toISOString() })
    .eq('id', gameId));
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
  replaceQuestions,
  flush: () => writeQueue,
};
