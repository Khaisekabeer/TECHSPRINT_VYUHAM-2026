// Replaces the Supabase question bank with ../seed_questions.json.
// Usage: npm run seed            (or: node seed.js path/to/questions.json)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('./db');

const file = path.resolve(__dirname, process.argv[2] || '../seed_questions.json');

(async () => {
  const questions = JSON.parse(fs.readFileSync(file, 'utf8'));
  await db.replaceQuestions(questions);
  const loaded = await db.getAllQuestions();
  console.log(`Seeded ${loaded.length} questions from ${path.basename(file)}`);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
