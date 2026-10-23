// Adds dummy data for a test run: 30 registrations (TEST0001-TEST0030; the first 20 already
// checked in, the rest left for the pass scanner) and 10 test questions across the 3 rounds.
// Usage: npm run seed:test                  (questions go into "Trial set")
//        node seed-test-data.js "Main set"   (another set)
//
// Registrations are upserted, so re-running is safe. Questions are appended to the set (existing
// questions are kept) as plaintext rows; they are encrypted automatically the next time a quiz
// master opens the set with its PIN. Re-running adds them again unless they are still plaintext.
// Clean up afterwards: delete or hide the test questions in Admin -> Questions, and remove the
// TEST tickets in the Supabase dashboard (registrations where ticket_id starts with TEST).
require('dotenv').config();
const { supabase } = require('./db');

const FIRST = ['Aarav', 'Diya', 'Rohan', 'Ananya', 'Arjun', 'Meera', 'Kiran', 'Sneha', 'Rahul', 'Fathima',
  'Nikhil', 'Lakshmi', 'Adil', 'Gauri', 'Vishnu', 'Nandana', 'Sidharth', 'Aleena', 'Hari', 'Riya'];
const LAST = ['Nair', 'Menon', 'Pillai', 'Thomas', 'Varghese', 'Kumar', 'Joseph', 'Rahman', 'Das', 'Krishnan'];
const COLLEGES = ['Digital University Kerala', 'CET Trivandrum', 'TKM College of Engineering', 'Model Engineering College', 'NIT Calicut'];

const REGISTRATIONS = Array.from({ length: 30 }, (_, i) => {
  const n = String(i + 1).padStart(4, '0');
  const first = FIRST[i % FIRST.length];
  const last = LAST[(i * 3) % LAST.length];
  return {
    ticket_id: `TEST${n}`,
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${n}@example.com`,
    phone: `90000${n.padStart(5, '0')}`,
    college: COLLEGES[i % COLLEGES.length],
    checked_in_at: i < 20 ? new Date().toISOString() : null,
  };
});

const mcq = (level, text, options, answer, timeLimit = 15, points = 1000) =>
  ({ level, type: 'mcq', text, options, correct_answer: answer, time_limit: timeLimit, points });
const tf = (level, text, answer, timeLimit = 10, points = 1000) =>
  ({ level, type: 'tf', text, options: ['True', 'False'], correct_answer: answer, time_limit: timeLimit, points });

const QUESTIONS = [
  // Round 1 · Warm-up
  mcq(1, 'What does CPU stand for?', ['Central Processing Unit', 'Computer Personal Unit', 'Central Program Utility', 'Core Processing Unit'], 'Central Processing Unit'),
  mcq(1, 'Which language is used to style web pages?', ['HTML', 'CSS', 'Python', 'SQL'], 'CSS'),
  tf(1, 'Linux is an open-source operating system.', 'True'),
  mcq(1, 'Which company makes the Android operating system?', ['Apple', 'Microsoft', 'Google', 'Samsung'], 'Google'),
  // Round 2 · Core Tech
  mcq(2, 'Which data structure works on First In, First Out?', ['Stack', 'Queue', 'Tree', 'Graph'], 'Queue', 20),
  mcq(2, 'What is the default port for HTTPS?', ['80', '21', '443', '8080'], '443', 20),
  tf(2, 'Git and GitHub are the same thing.', 'False'),
  // Round 3 · Brain Burner
  mcq(3, 'What is the time complexity of binary search?', ['O(n)', 'O(log n)', 'O(n log n)', 'O(1)'], 'O(log n)', 20),
  mcq(3, 'Which protocol does a WebSocket connection start with?', ['FTP', 'SMTP', 'HTTP', 'UDP'], 'HTTP', 20),
  mcq(3, 'What is the output size of a SHA-256 hash?', ['128 bits', '256 bits', '512 bits', '64 bits'], '256 bits', 20),
];

async function check(promise, label) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

// Append plaintext questions to a set by name (missing levels are created). Returns how many were added.
async function addQuestionsToSet(setName, questions) {
  const [bank] = await check(supabase.from('question_banks').select('id').eq('name', setName).limit(1), 'Finding the set');
  if (!bank) throw new Error(`No question set called "${setName}" — create it in Admin -> Questions first`);
  const levels = await check(supabase.from('levels').select('number').eq('bank_id', bank.id), 'Loading levels');
  const missing = [...new Set(questions.map(q => q.level))].filter(n => !levels.some(l => l.number === n));
  if (missing.length) await check(supabase.from('levels').insert(missing.map(n => ({ bank_id: bank.id, number: n, name: `Level ${n}`, multiplier: 1 }))), 'Adding levels');

  const existing = await check(supabase.from('questions').select('level, position, text').eq('bank_id', bank.id), 'Loading questions');
  const plaintext = new Set(existing.map(r => r.text).filter(Boolean));
  const nextPos = {};
  for (const r of existing) nextPos[r.level] = Math.max(nextPos[r.level] ?? 0, r.position + 1);
  const rows = questions.filter(q => !plaintext.has(q.text)).map(q => ({
    ...q,
    bank_id: bank.id,
    position: (nextPos[q.level] = (nextPos[q.level] ?? 0) + 1) - 1,
    is_active: true,
  }));
  if (rows.length) await check(supabase.from('questions').insert(rows), 'Adding questions');
  return rows.length;
}

async function main() {
  await check(supabase.from('registrations').upsert(REGISTRATIONS, { onConflict: 'ticket_id' }), 'Adding registrations');
  console.log(`Registrations: ${REGISTRATIONS.length} (TEST0001-TEST0020 checked in, TEST0021-TEST0030 not yet)`);
  const setName = process.argv[2] || 'Trial set';
  const added = await addQuestionsToSet(setName, QUESTIONS);
  console.log(`Questions: added ${added} to "${setName}"`);
  process.exit(0);
}

// QUESTIONS: the bots' answer key in simulate-event.js. addQuestionsToSet: used by seed.js.
module.exports = { QUESTIONS, addQuestionsToSet };

if (require.main === module) {
  main().catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}
