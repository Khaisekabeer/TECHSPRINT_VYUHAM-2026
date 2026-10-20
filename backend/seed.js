// Adds the questions in ../seed_questions.json to a question set (existing questions are kept).
// Usage: npm run seed                         (adds to "Trial set")
//        node seed.js file.json "Main set"    (another file / set)
// Rows are stored as plaintext and encrypted automatically the next time a quiz master opens the
// set with its PIN. Keep real questions out of git: add them in Admin -> Questions instead.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { addQuestionsToSet } = require('./seed-test-data');

const file = path.resolve(__dirname, process.argv[2] || '../seed_questions.json');
const setName = process.argv[3] || 'Trial set';

(async () => {
  const questions = JSON.parse(fs.readFileSync(file, 'utf8')).map(q => ({
    level: q.level || 1,
    type: q.type,
    text: q.text,
    options: q.options || [],
    correct_answer: q.correctAnswer,
    time_limit: q.timeLimit || 20,
    points: q.points || 1000,
  }));
  const added = await addQuestionsToSet(setName, questions);
  console.log(`Added ${added} questions from ${path.basename(file)} to "${setName}"`);
  process.exit(0);
})().catch(err => {
  console.error(err.message);
  process.exit(1);
});
