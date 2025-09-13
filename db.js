// db.js
const sqlite3 = require('sqlite3').verbose();
const DBSOURCE = "voting.db";

let db = new sqlite3.Database(DBSOURCE, (err) => {
  if (err) {
    console.error(err.message);
    throw err;
  }
  console.log("Connected to SQLite database.");
});

const init = () => {
  // users: student accounts (admin flag for admin)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT UNIQUE,
    name TEXT,
    password TEXT,
    is_admin INTEGER DEFAULT 0,
    has_voted INTEGER DEFAULT 0
  )`);

  // candidates
  db.run(`CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    description TEXT,
    votes INTEGER DEFAULT 0
  )`);

  // votes (audit log)
  db.run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    candidate_id INTEGER,
    voted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(candidate_id) REFERENCES candidates(id)
  )`);
};

init();

module.exports = db;
