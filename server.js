// Serveur minimal : coordonne la borne et le téléphone, applique la règle 12h.
// Démarrage : npm install && npm start
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// CORS (la borne et le site appellent ce serveur)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Sert le site du téléphone (dossier public/)
app.use(express.static(path.join(__dirname, 'public')));

const COOLDOWN_HOURS = 0.01;                      // <-- règle des 12h
const PLAYS_FILE = path.join(__dirname, 'plays.json');

function loadPlays() { try { return JSON.parse(fs.readFileSync(PLAYS_FILE, 'utf8')); } catch { return {}; } }
function savePlays(p) { try { fs.writeFileSync(PLAYS_FILE, JSON.stringify(p)); } catch {} }
function hash(s) { return crypto.createHash('sha256').update(String(s || '')).digest('hex'); }

// Sessions en mémoire : sid -> { status, cooldownMinutes }
const sessions = new Map();

// 1) La borne crée une session et affiche un QR contenant ?sid=...
app.post('/api/session', (req, res) => {
  const sid = crypto.randomBytes(8).toString('hex');
  sessions.set(sid, { status: 'waiting' });
  res.json({ sid });
});

// 2) La borne interroge l'état de la session (polling)
app.get('/api/session/:sid', (req, res) => {
  const s = sessions.get(req.params.sid);
  if (!s) return res.json({ status: 'unknown' });
  res.json({ status: s.status, cooldownMinutes: s.cooldownMinutes || 0 });
});

// 3) Le téléphone se signale après le scan (vérifie la règle 12h)
app.post('/api/scan', (req, res) => {
  const { sid, deviceId } = req.body || {};
  const s = sessions.get(sid);
  if (!s) return res.status(404).json({ status: 'unknown' });

  const plays = loadPlays();
  const key = hash(deviceId);
  const now = Date.now();
  const last = plays[key] || 0;
  const remaining = last + COOLDOWN_HOURS * 3600 * 1000 - now;

  if (last && remaining > 0) {
    s.status = 'blocked';
    s.cooldownMinutes = Math.ceil(remaining / 60000);
    return res.json({ status: 'blocked', cooldownMinutes: s.cooldownMinutes });
  }

  plays[key] = now;
  savePlays(plays);
  s.status = 'allowed';
  res.json({ status: 'allowed' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Digital Events server sur le port ' + PORT));
