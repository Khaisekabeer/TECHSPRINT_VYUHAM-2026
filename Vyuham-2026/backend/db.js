const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.resolve(__dirname, 'techquiz.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // Questions table
  db.run(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level INTEGER NOT NULL,
      text TEXT NOT NULL,
      type TEXT NOT NULL, -- 'mcq', 'tf', 'short', 'image'
      options TEXT, -- JSON array of strings
      correctAnswer TEXT NOT NULL,
      timeLimit INTEGER DEFAULT 20,
      points INTEGER DEFAULT 1000,
      imageUrl TEXT
    )
  `);

  // Results table for exporting
  db.run(`
    CREATE TABLE IF NOT EXISTS results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      playerName TEXT,
      score INTEGER,
      rank INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// Seed data function
function seedDatabase(questions) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run("DELETE FROM questions");
      const stmt = db.prepare("INSERT INTO questions (level, text, type, options, correctAnswer, timeLimit, points, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
      
      questions.forEach(q => {
        stmt.run(
          q.level, 
          q.text, 
          q.type, 
          JSON.stringify(q.options || []), 
          q.correctAnswer, 
          q.timeLimit || 20, 
          q.points || 1000, 
          q.imageUrl || null
        );
      });
      
      stmt.finalize((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}

function getAllQuestions() {
  return new Promise((resolve, reject) => {
    db.all("SELECT * FROM questions", (err, rows) => {
      if (err) {
        reject(err);
      } else {
        // Parse options back to array
        const qs = rows.map(r => ({
          ...r,
          options: r.options ? JSON.parse(r.options) : []
        }));
        resolve(qs);
      }
    });
  });
}

module.exports = {
  db,
  seedDatabase,
  getAllQuestions
};
