const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data', 'submissions.json');

// ── Configure your tasting here ─────────────────────────────────────────────
const PEOPLE = [
  'Alex', 'Sam', 'Jordan', 'Taylor',
  'Morgan', 'Casey', 'Riley', 'Drew'
];

const TEQUILAS = [
  { id: 1, label: 'A', name: 'Tequila A', detail: '' },
  { id: 2, label: 'B', name: 'Tequila B', detail: '' },
  { id: 3, label: 'C', name: 'Tequila C', detail: '' },
  { id: 4, label: 'D', name: 'Tequila D', detail: '' },
];
// ────────────────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function load() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return []; }
}

function save(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/config', (_req, res) => {
  res.json({ people: PEOPLE, tequilas: TEQUILAS });
});

app.get('/api/submissions', (_req, res) => {
  res.json(load());
});

app.post('/api/submit', (req, res) => {
  const { person, tequilaId, notes } = req.body;
  if (!person || !tequilaId || !notes) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const all = load();
  const idx = all.findIndex(s => s.person === person && s.tequilaId === tequilaId);
  const entry = { person, tequilaId, notes, timestamp: new Date().toISOString() };

  if (idx >= 0) {
    all[idx] = entry;
  } else {
    all.push(entry);
  }

  save(all);
  res.json({ ok: true });
});

app.delete('/api/reset', (_req, res) => {
  save([]);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`\nTequila Tasting running at http://localhost:${PORT}\n`);
});
