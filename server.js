const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');
const QUESTIONS = require('./questions');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (q, r) => r.send('ok'));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

const rooms = new Map();
const MAX_ROOMS = 200, MAX_PLAYERS = 100;
const uid = () => crypto.randomBytes(8).toString('hex');
const other = t => (t === 'A' ? 'B' : 'A');
const clean = (s, n = 20) => String(s == null ? '' : s).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

function newCode() {
  const A = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let c;
  do { c = Array.from({ length: 4 }, () => A[Math.floor(Math.random() * A.length)]).join(''); } while (rooms.has(c));
  return c;
}
const freshGame = () => ({
  phase: 'lobby', round: 0, revealed: [], pot: 0, firstTeam: null, lateMs: null, buzzAt: 0,
  answerer: null, faceoffMissed: [], control: null, playing: null, stealer: null, winner: null, msg: ''
});
function createRoom() {
  const code = newCode();
  const room = {
    code, hostToken: uid(), last: Date.now(), evId: 0, evKind: '', fate: null, hist: [],
    teams: { A: { name: 'Team A', score: 0, leader: null }, B: { name: 'Team B', score: 0, leader: null } },
    players: new Map(), sockets: new Set(), g: freshGame()
  };
  rooms.set(code, room);
  return room;
}

function view(room, ctx) {
  const g = room.g, host = ctx && ctx.role === 'host';
  const Q = QUESTIONS[g.round];
  const inGame = g.phase !== 'lobby';
  const me = ctx && ctx.role === 'player' ? room.players.get(ctx.pid) : null;
  return {
    code: room.code, role: host ? 'host' : 'player',
    teams: { A: { ...room.teams.A }, B: { ...room.teams.B } },
    phase: g.phase, round: g.round + 1, rounds: QUESTIONS.length,
    q: inGame && Q ? Q.q : null,
    // Hidden answers are only ever sent to the host.
    answers: inGame && Q ? Q.a.map((a, i) => (g.revealed[i] || host ? { t: a[0], p: a[1], up: !!g.revealed[i] } : { up: false })) : [],
    pot: g.pot, firstTeam: g.firstTeam, lateMs: g.lateMs, answerer: g.answerer, control: g.control,
    playing: g.playing, stealer: g.stealer, winner: g.winner, msg: g.msg,
    players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team, online: p.online })),
    you: me ? { id: me.id, name: me.name, team: me.team, leader: room.teams[me.team].leader === me.id } : null,
    canUndo: host && room.hist.length > 0,
    ev: { id: room.evId, k: room.evKind }, fate: room.fate
  };
}
function broadcast(room) {
  room.last = Date.now();
  for (const s of room.sockets) send(s, { type: 'state', s: view(room, s.ctx) });
}
const ev = (room, k) => { room.evId++; room.evKind = k; };
const snap = room => JSON.stringify({ g: room.g, A: room.teams.A.score, B: room.teams.B.score });
function save(room) { room.hist.push(snap(room)); if (room.hist.length > 30) room.hist.shift(); }
function restore(room) {
  const s = JSON.parse(room.hist.pop());
  room.g = s.g; room.teams.A.score = s.A; room.teams.B.score = s.B;
}
const tn = (room, t) => room.teams[t].name;

function startRound(room, i) {
  const Q = QUESTIONS[i];
  Object.assign(room.g, {
    round: i, revealed: Q.a.map(() => false), pot: 0, firstTeam: null, lateMs: null, answerer: null,
    faceoffMissed: [], control: null, playing: null, stealer: null, winner: null,
    phase: 'ready', msg: 'Host is reading the question.'
  });
}
function resolve(room, winner, why) {
  const g = room.g;
  g.winner = winner;
  room.teams[winner].score += g.pot;
  g.revealed = g.revealed.map(() => true);
  g.phase = 'roundEnd';
  g.msg = `${tn(room, winner)} wins ${g.pot} points. ${why}`;
  ev(room, 'win');
}
function lockBuzz(room, team) {
  const g = room.g;
  g.phase = 'faceoff'; g.firstTeam = team; g.answerer = team; g.buzzAt = Date.now(); g.lateMs = null; g.faceoffMissed = [];
  g.msg = `${tn(room, team)} buzzed first. Answer out loud!`;
  ev(room, 'buzz');
}

function playerBuzz(room, ctx) {
  const p = room.players.get(ctx.pid);
  if (!p) return;
  const t = p.team, g = room.g, now = Date.now();
  if (room.teams[t].leader !== p.id) return;
  if (g.phase === 'buzzing') {
    save(room);
    lockBuzz(room, t);
  } else if (g.phase === 'faceoff' && g.answerer === g.firstTeam && t !== g.firstTeam && g.lateMs == null && now - g.buzzAt < 2000) {
    g.lateMs = now - g.buzzAt; // for the host's information only, does not change who is locked in
  } else return;
  broadcast(room);
}

function hostAct(room, m) {
  const g = room.g, Q = QUESTIONS[g.round], ph = g.phase;
  const T = m.team === 'A' || m.team === 'B' ? m.team : null;
  switch (m.a) {
    case 'teamName': if (T) room.teams[T].name = clean(m.name) || 'Team ' + T; break;
    case 'leader': {
      const p = room.players.get(m.pid); if (!p) return;
      room.teams[p.team].leader = p.id; break;
    }
    case 'setTeam': {
      const p = room.players.get(m.pid); if (!p || !T) return;
      for (const k of ['A', 'B']) if (room.teams[k].leader === p.id) room.teams[k].leader = null;
      p.team = T; break;
    }
    case 'start':
      if (ph !== 'lobby' || !room.teams.A.leader || !room.teams.B.leader) return;
      save(room); startRound(room, 0); break;
    case 'open':
      if (ph !== 'ready') return;
      save(room); g.phase = 'buzzing'; g.msg = 'Buzzers are open!'; ev(room, 'open'); break;
    case 'manual':
      if (ph !== 'buzzing' || !T) return;
      save(room); lockBuzz(room, T); break;
    case 'reveal': {
      const i = Number(m.i);
      if (!Q || !Number.isInteger(i) || i < 0 || i >= Q.a.length || g.revealed[i]) return;
      if (ph === 'faceoff') {
        save(room); g.revealed[i] = true; g.pot += Q.a[i][1]; g.control = g.answerer; g.phase = 'choose';
        g.msg = `${tn(room, g.control)} is correct and wins control. Play or pass?`; ev(room, 'ding');
      } else if (ph === 'play') {
        save(room); g.revealed[i] = true; g.pot += Q.a[i][1]; ev(room, 'ding');
        if (g.revealed.every(Boolean)) resolve(room, g.playing, 'All answers revealed with no strike.');
        else g.msg = `Correct! ${tn(room, g.playing)}, next teammate.`;
      } else if (ph === 'steal') {
        save(room); g.revealed[i] = true; g.pot += Q.a[i][1];
        resolve(room, g.stealer, 'Steal successful!');
      } else return;
      break;
    }
    case 'miss':
      if (ph === 'faceoff') {
        save(room); g.faceoffMissed.push(g.answerer);
        if (g.faceoffMissed.length >= 2) {
          g.phase = 'ready'; g.firstTeam = null; g.answerer = null; g.lateMs = null; g.faceoffMissed = [];
          g.msg = 'Both leaders missed. Host will reopen the buzzer.'; ev(room, 'strike');
        } else {
          g.answerer = other(g.answerer);
          g.msg = `Missed. ${tn(room, g.answerer)} leader, your turn to answer. No strike.`; ev(room, 'strike');
        }
      } else if (ph === 'play') {
        save(room); g.phase = 'steal'; g.stealer = other(g.playing);
        g.msg = `Strike! ${tn(room, g.stealer)} gets one chance to steal the pot.`; ev(room, 'strike');
      } else if (ph === 'steal') {
        save(room); resolve(room, g.playing, 'Steal failed.'); ev(room, 'strike');
      } else return;
      break;
    case 'choose':
      if (ph !== 'choose' || (m.c !== 'play' && m.c !== 'pass')) return;
      save(room);
      g.playing = m.c === 'play' ? g.control : other(g.control);
      g.phase = 'play';
      g.msg = `${tn(room, g.playing)} plays. Teammates take turns. One strike and it's over.`; ev(room, 'open'); break;
    case 'next':
      if (ph !== 'roundEnd') return;
      save(room);
      if (g.round + 1 < QUESTIONS.length) startRound(room, g.round + 1);
      else {
        const a = room.teams.A.score, b = room.teams.B.score;
        g.phase = 'gameOver';
        g.msg = a === b ? `It's a tie at ${a}!` : `${tn(room, a > b ? 'A' : 'B')} wins the game!`; ev(room, 'win');
      }
      break;
    case 'undo': if (!room.hist.length) return; restore(room); break;
    case 'reset':
      room.teams.A.score = 0; room.teams.B.score = 0; room.g = freshGame(); room.hist = []; room.fate = null; break;
    case 'fate': room.fate = m.text ? { id: Date.now(), text: clean(m.text, 40) } : null; if (room.fate) ev(room, 'win'); break;
    default: return;
  }
  broadcast(room);
}

function attach(ws, room, ctx) {
  if (ws.ctx && ws.ctx.room) ws.ctx.room.sockets.delete(ws);
  ws.ctx = { ...ctx, room };
  room.sockets.add(ws);
}

function handle(ws, m) {
  if (!m || typeof m !== 'object') return;
  const code = String(m.code || '').toUpperCase();
  switch (m.type) {
    case 'create': {
      if (rooms.size >= MAX_ROOMS) return send(ws, { type: 'error', error: 'Server is full, try again later.' });
      const room = createRoom();
      attach(ws, room, { role: 'host' });
      send(ws, { type: 'joined', code: room.code, role: 'host', token: room.hostToken });
      return broadcast(room);
    }
    case 'peek': {
      const room = rooms.get(code);
      return send(ws, { type: 'peeked', code, teams: room ? { A: room.teams.A.name, B: room.teams.B.name } : null });
    }
    case 'host-resume': {
      const room = rooms.get(code);
      if (!room || room.hostToken !== m.token) return send(ws, { type: 'error', error: 'Session expired.', fatal: true });
      attach(ws, room, { role: 'host' });
      send(ws, { type: 'joined', code, role: 'host', token: room.hostToken });
      return broadcast(room);
    }
    case 'join': {
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', error: 'Room not found. Check the code.' });
      const name = clean(m.name);
      if (!name) return send(ws, { type: 'error', error: 'Enter your name.' });
      if (m.team !== 'A' && m.team !== 'B') return send(ws, { type: 'error', error: 'Pick a team.' });
      if (room.players.size >= MAX_PLAYERS) return send(ws, { type: 'error', error: 'Room is full.' });
      if ([...room.players.values()].some(p => p.name.toLowerCase() === name.toLowerCase()))
        return send(ws, { type: 'error', error: 'That name is taken. Add an initial or number.' });
      const p = { id: uid(), name, team: m.team, token: uid(), online: true };
      room.players.set(p.id, p);
      attach(ws, room, { role: 'player', pid: p.id });
      send(ws, { type: 'joined', code, role: 'player', token: p.token });
      return broadcast(room);
    }
    case 'resume': {
      const room = rooms.get(code);
      const p = room && [...room.players.values()].find(x => x.token === m.token);
      if (!p) return send(ws, { type: 'error', error: 'Session expired.', fatal: true });
      p.online = true;
      attach(ws, room, { role: 'player', pid: p.id });
      send(ws, { type: 'joined', code, role: 'player', token: p.token });
      return broadcast(room);
    }
    case 'buzz':
      if (ws.ctx && ws.ctx.role === 'player') playerBuzz(ws.ctx.room, ws.ctx);
      return;
    case 'host':
      if (ws.ctx && ws.ctx.role === 'host') hostAct(ws.ctx.room, m);
      return;
  }
}

wss.on('connection', ws => {
  ws.ctx = null;
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch { return; }
    try { handle(ws, m); } catch (e) { console.error(e); send(ws, { type: 'error', error: 'Server error.' }); }
  });
  ws.on('close', () => {
    const c = ws.ctx; if (!c || !c.room) return;
    c.room.sockets.delete(ws);
    if (c.role === 'player') {
      const p = c.room.players.get(c.pid);
      const still = [...c.room.sockets].some(s => s.ctx && s.ctx.pid === c.pid);
      if (p && !still) { p.online = false; broadcast(c.room); }
    }
  });
});

setInterval(() => {
  for (const [code, r] of rooms) if (!r.sockets.size && Date.now() - r.last > 12 * 3600e3) rooms.delete(code);
}, 600e3);

const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => console.log('Family Feud on http://localhost:' + PORT));
module.exports = { server };
