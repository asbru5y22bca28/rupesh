// server.js
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const path = require('path');
const db = require('./db');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite' }),
  secret: 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 2 * 60 * 60 * 1000 } // 2 hours
}));

// Helper middleware
function requireLogin(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: 'Not authenticated' });
}
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.status(403).json({ error: 'Admin only' });
}

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { student_id, name, password } = req.body;
    if (!student_id || !name || !password) return res.status(400).json({ error: 'Missing fields' });
    const hashed = await bcrypt.hash(password, 10);
    const sql = 'INSERT INTO users (student_id, name, password) VALUES (?,?,?)';
    db.run(sql, [student_id, name, hashed], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Student ID already exists' });
        return res.status(500).json({ error: err.message });
      }
      res.json({ success: true, userId: this.lastID });
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Login
app.post('/api/login', (req, res) => {
  const { student_id, password } = req.body;
  if (!student_id || !password) return res.status(400).json({ error: 'Missing credentials' });
  db.get('SELECT * FROM users WHERE student_id = ?', [student_id], async (err, user) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });

    // set session
    req.session.userId = user.id;
    req.session.studentId = user.student_id;
    req.session.userName = user.name;
    req.session.isAdmin = user.is_admin === 1;
    res.json({ success: true, isAdmin: req.session.isAdmin });
  });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Get current user
app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    userId: req.session.userId,
    studentId: req.session.studentId,
    name: req.session.userName,
    isAdmin: req.session.isAdmin
  });
});

// Get candidates
app.get('/api/candidates', (req, res) => {
  db.all('SELECT id, name, description, votes FROM candidates', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Vote (student)
app.post('/api/vote', requireLogin, (req, res) => {
  const userId = req.session.userId;
  const { candidate_id } = req.body;
  if (!candidate_id) return res.status(400).json({ error: 'candidate_id required' });

  // Check if user already voted
  db.get('SELECT has_voted FROM users WHERE id = ?', [userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(400).json({ error: 'User not found' });
    if (row.has_voted === 1) return res.status(403).json({ error: 'You have already voted' });

    // increment candidate votes and mark user has voted and insert into votes log in a transaction
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      db.run('UPDATE candidates SET votes = votes + 1 WHERE id = ?', [candidate_id], function(err2) {
        if (err2) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: err2.message });
        }
        db.run('UPDATE users SET has_voted = 1 WHERE id = ?', [userId], function(err3) {
          if (err3) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: err3.message });
          }
          db.run('INSERT INTO votes (user_id, candidate_id) VALUES (?, ?)', [userId, candidate_id], function(err4) {
            if (err4) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: err4.message });
            }
            db.run('COMMIT');
            res.json({ success: true });
          });
        });
      });
    });
  });
});

// Admin: add candidate
app.post('/api/admin/candidates', requireLogin, requireAdmin, (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  db.run('INSERT INTO candidates (name, description) VALUES (?, ?)', [name, description || ''], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

// Admin: list users (simple)
app.get('/api/admin/users', requireLogin, requireAdmin, (req, res) => {
  db.all('SELECT id, student_id, name, is_admin, has_voted FROM users', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Results
app.get('/api/results', (req, res) => {
  db.all('SELECT id, name, votes FROM candidates ORDER BY votes DESC', [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Simple route to create an admin user (for demo). In production, create admin safely.
app.post('/api/create-admin', async (req, res) => {
  const { student_id, name, password } = req.body;
  if (!student_id || !name || !password) return res.status(400).json({ error: 'Missing' });
  const hashed = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (student_id, name, password, is_admin) VALUES (?,?,?,1)', [student_id, name, hashed], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true, id: this.lastID });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
