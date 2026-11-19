(() => {
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} } };

let ws, S = null, lastEv = null, lastFate = null, tab = 'game', hostBuilt = false;
let session = null; try { session = JSON.parse(store.get('feud-session') || 'null'); } catch {}
let muted = store.get('feud-mute') === '1';

/* ---------- sound ---------- */
let AC;
function tone(f, d, type = 'sine', t0 = 0, vol = 0.25) {
  if (muted) return;
  try {
    AC = AC || new (window.AudioContext || window.webkitAudioContext)();
    if (AC.state === 'suspended') AC.resume();
    const o = AC.createOscillator(), g = AC.createGain(), t = AC.currentTime + t0;
    o.type = type; o.frequency.value = f; g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + d);
    o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + d);
  } catch {}
}
const SND = {
  buzz: () => { tone(180, .5, 'square'); tone(140, .5, 'square', .05); },
  open: () => { tone(660, .12, 'triangle'); tone(880, .18, 'triangle', .13); },
  ding: () => { tone(988, .35, 'sine'); tone(1319, .5, 'sine', .12); },
  strike: () => tone(110, .7, 'sawtooth', 0, .3),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .3, 'triangle', i * .12))
};
function paintMute() { $('#mute').textContent = muted ? 'Sound off' : 'Sound on'; }
$('#mute').onclick = () => { muted = !muted; store.set('feud-mute', muted ? '1' : '0'); paintMute(); };
paintMute();

function toast(t, ms = 3500) {
  const el = $('#toast'); el.textContent = t; el.classList.remove('hide');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.add('hide'), ms);
}

/* ---------- connection ---------- */
function send(m) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); }
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onopen = () => {
    $('#conn').classList.add('hide');
    if (session) send({ type: session.role === 'host' ? 'host-resume' : 'resume', code: session.code, token: session.token });
    else { const c = ($('#code') || {}).value; if (c && c.length === 4) send({ type: 'peek', code: c }); }
  };
  ws.onmessage = e => onMsg(JSON.parse(e.data));
  ws.onclose = () => { $('#conn').classList.remove('hide'); setTimeout(connect, 1500); };
}
function onMsg(m) {
  if (m.type === 'joined') { session = { code: m.code, role: m.role, token: m.token }; store.set('feud-session', JSON.stringify(session)); }
  else if (m.type === 'error') {
    if (m.fatal) { session = null; S = null; store.del('feud-session'); hostBuilt = false; renderHome(); }
    setErr(m.error);
  } else if (m.type === 'peeked') paintTeams(m.teams);
  else if (m.type === 'state') {
    S = m.s;
    if (lastEv === null) lastEv = S.ev.id;
    else if (S.ev.id !== lastEv) { lastEv = S.ev.id; if (SND[S.ev.k]) SND[S.ev.k](); if (S.ev.k === 'buzz' && navigator.vibrate && S.you && S.you.leader) navigator.vibrate(200); }
    if (S.fate && S.fate.id !== lastFate) { if (lastFate !== null) toast('Fate has chosen: ' + S.fate.text + '!', 6000); lastFate = S.fate.id; }
    else if (lastFate === null) lastFate = S.fate ? S.fate.id : 0;
    render();
  }
}
function setErr(t) { const e = $('#err'); if (e) e.textContent = t || ''; }

/* ---------- home ---------- */
function renderHome() {
  const params = new URLSearchParams(location.search);
  const pre = (params.get('room') || '').toUpperCase().slice(0, 4);
  $('#app').innerHTML = `
  <h1>Family Feud</h1>
  <div class="grid2">
    <div class="card"><h2>Join a game</h2>
      <label class="l" for="code">Room code</label><input id="code" type="text" maxlength="4" autocomplete="off" autocapitalize="characters" value="${esc(pre)}" placeholder="ABCD">
      <label class="l" for="pname">Your name</label><input id="pname" type="text" maxlength="20" autocomplete="nickname" placeholder="e.g. Arri">
      <div class="l">Your team</div>
      <div class="teampick">
        <label><input type="radio" name="team" value="A" checked><span id="tA">Team A</span></label>
        <label><input type="radio" name="team" value="B"><span id="tB">Team B</span></label>
      </div>
      <button class="btn" id="join">Join game</button>
      <div class="err" id="err"></div>
    </div>
    <div class="card"><h2>Host a game</h2>
      <p class="muted">Creates a room with a 4-letter code. Share the code or link with your players, pick one leader per team, then run the game from the host panel.</p>
      <button class="btn dark" id="host">Create room</button>
    </div>
  </div>`;
  $('#code').oninput = e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); if (e.target.value.length === 4) send({ type: 'peek', code: e.target.value }); else paintTeams(null); };
  $('#join').onclick = () => { setErr(''); send({ type: 'join', code: $('#code').value, name: $('#pname').value, team: document.querySelector('input[name=team]:checked').value }); };
  $('#host').onclick = () => { setErr(''); send({ type: 'create' }); };
  if (pre.length === 4) send({ type: 'peek', code: pre });
}
function paintTeams(t) { const a = $('#tA'), b = $('#tB'); if (!a) return; a.textContent = t ? t.A : 'Team A'; b.textContent = t ? t.B : 'Team B'; }

/* ---------- shared bits ---------- */
const tname = t => esc(S.teams[t].name);
const pname = id => { const p = S.players.find(x => x.id === id); return p ? esc(p.name) : 'no leader'; };
function activeTeam() { return { faceoff: S.answerer, choose: S.control, play: S.playing, steal: S.stealer }[S.phase] || null; }
function scoreHTML() {
  const a = activeTeam();
  const box = t => `<div class="team ${a === t ? 'active' : ''}"><div class="tn">${tname(t)}</div><b>${S.teams[t].score}</b><small>Leader: ${pname(S.teams[t].leader)}</small></div>`;
  return `<div class="scores">${box('A')}<div class="pot">Round pot<b>${S.pot}</b>${S.round && S.phase !== 'lobby' ? `<small>Round ${S.round}/${S.rounds}</small>` : ''}</div>${box('B')}</div>`;
}
function boardHTML(host) {
  const canClick = host && ['faceoff', 'play', 'steal'].includes(S.phase);
  return `<div class="board">${S.answers.map((a, i) => {
    if (a.up) return `<div class="tile up"><span class="t">${esc(a.t)}</span><span class="p">${a.p}</span></div>`;
    if (host) return `<button class="tile key" data-a="reveal" data-i="${i}" ${canClick ? '' : 'disabled'}><span>${i + 1}. ${esc(a.t)}<small>Click to reveal when correct</small></span><span class="p">${a.p}</span></button>`;
    return `<div class="tile"><span class="n">${i + 1}</span></div>`;
  }).join('')}</div>`;
}
function stageHTML(host) {
  if (S.phase === 'lobby') return `<div class="stage">${scoreHTML()}<div class="msg">Waiting for the host to start the game.</div></div>`;
  return `<div class="stage">${scoreHTML()}<div class="q">${esc(S.q)}</div>${boardHTML(host)}<div class="msg">${esc(S.msg)}</div></div>`;
}
function rosterHTML(host) {
  const col = t => {
    const ps = S.players.filter(p => p.team === t);
    return `<div><h2>${host ? `<input type="text" id="tn${t}" value="${esc(S.teams[t].name)}" maxlength="20" data-team="${t}" aria-label="Team ${t} name" style="margin:0">` : tname(t)}</h2>
      ${ps.map(p => `<div class="pl"><span class="${p.online ? '' : 'off'}">${esc(p.name)}${S.teams[t].leader === p.id ? '<span class="badge">LEADER</span>' : ''}${p.online ? '' : ' (offline)'}</span>
        ${host ? `<span>${S.teams[t].leader === p.id ? '' : `<button class="btn sm" data-a="leader" data-pid="${p.id}">Make leader</button> `}<button class="btn sm dark" data-a="setTeam" data-pid="${p.id}" data-team="${t === 'A' ? 'B' : 'A'}">Move</button></span>` : ''}</div>`).join('') || '<p class="muted">No players yet.</p>'}</div>`;
  };
  return `<div class="roster">${col('A')}${col('B')}</div>`;
}

/* ---------- player view ---------- */
function renderPlayer() {
  const y = S.you; if (!y) return;
  let buzz = '';
  const g = S.phase, my = y.team;
  if (y.leader) {
    let cls = '', txt = 'WAIT', dis = true;
    if (g === 'buzzing') { cls = 'armed'; txt = 'BUZZ!'; dis = false; }
    else if (g === 'faceoff') {
      if (S.answerer === my && S.firstTeam === my) { cls = 'won'; txt = 'YOU BUZZED FIRST! Answer out loud'; }
      else if (S.answerer === my) { cls = 'won'; txt = 'Your turn to answer'; }
      else { cls = 'lost'; txt = S.firstTeam === my ? 'Missed. Other leader answers' : 'Locked out. Other team buzzed first'; }
    } else if (g === 'lobby' || g === 'ready') txt = 'Buzzer opens soon';
    else txt = 'Buzzer closed';
    buzz = `<div class="buzzwrap"><button class="buzzer ${cls}" id="buzz" ${dis ? 'aria-disabled="true"' : ''}>${txt}</button><div class="muted">You are the leader of ${tname(my)}. Tap or press Space.</div></div>`;
  } else {
    const l = S.teams[my].leader;
    buzz = `<p class="muted" style="text-align:center">You are on ${tname(my)}. ${l ? 'Your leader is ' + pname(l) + ', who has the buzzer.' : 'No leader picked yet.'}${['play', 'steal'].includes(g) && activeTeam() === my ? ' Your team is up, be ready to answer!' : ''}</p>`;
  }
  $('#app').innerHTML = `
    <div class="bar"><span class="code">${esc(S.code)}</span><span><b>${esc(y.name)}</b> <span class="muted">on ${tname(my)}</span> <button class="btn sm dark" id="leave">Leave</button></span></div>
    ${y.leader ? buzz + stageHTML(false) : stageHTML(false) + buzz}`;
  const b = $('#buzz'); if (b) b.onclick = () => { if (S.phase === 'buzzing') send({ type: 'buzz' }); };
  $('#leave').onclick = () => { if (confirm('Leave this game?')) { store.del('feud-session'); session = null; S = null; location.href = location.pathname; } };
}

/* ---------- host view ---------- */
function hostActions() {
  const p = S.phase, T = S.teams;
  const leaderOf = t => pname(T[t].leader);
  let h = '';
  if (p === 'lobby') {
    const ok = T.A.leader && T.B.leader;
    h = `<p class="muted" style="text-align:center">Share the code <b>${esc(S.code)}</b> or the join link. Pick one leader per team, then start.</p>
      <div class="row"><button class="btn" data-a="start" ${ok ? '' : 'disabled'}>Start game</button></div>${ok ? '' : '<p class="muted" style="text-align:center">Both teams need a leader.</p>'}`;
  } else if (p === 'ready') h = `<p>Read the question aloud, then open the buzzer.</p><div class="row"><button class="btn" data-a="open">Open buzzer</button></div>`;
  else if (p === 'buzzing') h = `<p>Waiting for a leader to buzz…</p><div class="row"><button class="btn alt dark" data-a="manual" data-team="A">Give buzz to ${tname('A')}</button><button class="btn alt dark" data-a="manual" data-team="B">Give buzz to ${tname('B')}</button></div>`;
  else if (p === 'faceoff') {
    const late = S.lateMs != null ? ` ${tname(S.answerer === S.firstTeam ? (S.firstTeam === 'A' ? 'B' : 'A') : S.firstTeam)} leader pressed ${S.lateMs} ms later.` : '';
    h = S.answerer === S.firstTeam
      ? `<p><b>${leaderOf(S.firstTeam)}</b> (${tname(S.firstTeam)}) buzzed first.${late} Click the answer above if correct.</p>`
      : `<p>First leader missed. <b>${leaderOf(S.answerer)}</b> (${tname(S.answerer)}) answers now. Correct answer wins control.</p>`;
    h += `<div class="row"><button class="btn red" data-a="miss">Wrong / not on the board</button></div>`;
  } else if (p === 'choose') h = `<p><b>${tname(S.control)}</b> has control. Ask ${leaderOf(S.control)}: play or pass?</p><div class="row"><button class="btn green" data-a="choose" data-c="play">Play</button><button class="btn dark" data-a="choose" data-c="pass">Pass</button></div>`;
  else if (p === 'play') h = `<p><b>${tname(S.playing)}</b> is playing. Click each correct answer. First wrong answer is the only strike.</p><div class="row"><button class="btn red" data-a="miss">Wrong answer (strike)</button></div>`;
  else if (p === 'steal') h = `<p><b>${tname(S.stealer)}</b> gets one steal attempt for the pot. Click the answer if correct.</p><div class="row"><button class="btn red" data-a="miss">Steal failed</button></div>`;
  else if (p === 'roundEnd') h = `<div class="row"><button class="btn" data-a="next">${S.round < S.rounds ? 'Next round' : 'Finish game'}</button></div>`;
  else if (p === 'gameOver') h = `<div class="row"><button class="btn" data-a="reset">New game (reset scores)</button><button class="btn dark" id="wheelgo">Loser's wheel</button></div>`;
  return `<div class="card" style="text-align:center">${h}<div class="row">${S.canUndo ? '<button class="btn sm dark" data-a="undo">Undo last action</button>' : ''}</div></div>`;
}
function renderHost() {
  if (!hostBuilt) {
    hostBuilt = true;
    const link = location.origin + '/?room=' + S.code;
    $('#app').innerHTML = `
      <div class="bar"><span class="code">${esc(S.code)}</span><span class="muted" id="linkbox">Join link: <b>${esc(link)}</b> <button class="btn sm dark" id="copy">Copy</button></span></div>
      <div class="tabs"><button id="tabG" class="on">Game</button><button id="tabW">Wheel of Fate (loser's round)</button></div>
      <div id="paneG"><div id="hStage"></div><div id="hAct"></div><details class="card" id="hRoster"><summary><b>Players and leaders</b></summary><div id="hRosterBody"></div></details></div>
      <div id="paneW" class="hide"></div>`;
    $('#copy').onclick = () => { (navigator.clipboard ? navigator.clipboard.writeText(link) : Promise.reject()).then(() => toast('Link copied', 1500), () => prompt('Copy this link', link)); };
    $('#tabG').onclick = () => setTab('game'); $('#tabW').onclick = () => setTab('wheel');
    wheelInit();
  }
  const ae = document.activeElement, aid = ae && ae.id, aval = ae && ae.value, ss = ae && ae.selectionStart;
  $('#hStage').innerHTML = stageHTML(true);
  $('#hAct').innerHTML = hostActions();
  const d = $('#hRoster'); if (S.phase === 'lobby') d.open = true;
  $('#hRosterBody').innerHTML = rosterHTML(true);
  if (aid) { const n = document.getElementById(aid); if (n && n.tagName === 'INPUT') { n.value = aval; n.focus(); try { n.setSelectionRange(ss, ss); } catch {} } }
  const wg = $('#wheelgo'); if (wg) wg.onclick = () => setTab('wheel');
}
function setTab(t) {
  tab = t; $('#paneG').classList.toggle('hide', t !== 'game'); $('#paneW').classList.toggle('hide', t !== 'wheel');
  $('#tabG').classList.toggle('on', t === 'game'); $('#tabW').classList.toggle('on', t === 'wheel');
}

/* ---------- wheel of fate (host only; result is announced to everyone) ---------- */
const COLS = ['#f6b72c', '#ff8a7a', '#7fd1c4', '#b8a9ff', '#ffb27a', '#8ab6ff', '#c5e86c', '#ffa6d2'];
let wAng = 0, wSpin = false, wPick = -1;
function wheelInit() {
  $('#paneW').innerHTML = `<div class="stage">
    <div class="wheelwrap"><div class="ptr"></div><canvas id="wh" width="640" height="640" role="img" aria-label="Wheel of Fate"></canvas></div>
    <div class="who" id="fate" aria-live="polite"></div>
    <div class="row"><button class="btn" id="spin">Spin the wheel</button><button class="btn alt" id="rm" disabled>Remove picked name</button><button class="btn alt" id="load">Load losing team</button></div>
    <textarea class="names" id="names" rows="8" aria-label="Names on the wheel, one per line">Adithya
Jannie
Jessa
Rhona
Satyam
Shantanu
Vinz</textarea>
    <p class="muted" style="text-align:center;color:#b9c4e2">One name per line. The picked name is announced on every player's screen.</p></div>`;
  $('#names').oninput = () => { wPick = -1; $('#rm').disabled = true; $('#fate').textContent = ''; drawWheel(); };
  $('#load').onclick = () => {
    const a = S.teams.A.score, b = S.teams.B.score;
    const t = a === b ? null : (a < b ? 'A' : 'B');
    const ps = S.players.filter(p => t ? p.team === t : true).map(p => p.name);
    $('#names').value = ps.join('\n'); wPick = -1; drawWheel();
    if (!t) toast('Scores are tied, loaded everyone', 2500);
  };
  $('#spin').onclick = spin;
  $('#rm').onclick = () => { const n = nms(); if (wPick < 0) return; n.splice(wPick, 1); $('#names').value = n.join('\n'); wPick = -1; $('#rm').disabled = true; $('#fate').textContent = ''; drawWheel(); };
  drawWheel();
}
const nms = () => $('#names').value.split('\n').map(s => s.trim()).filter(Boolean);
function drawWheel() {
  const n = nms(), c = $('#wh'), x = c.getContext('2d'), R = 320; x.clearRect(0, 0, 640, 640);
  if (!n.length) { x.fillStyle = '#ffffff22'; x.beginPath(); x.arc(R, R, R - 6, 0, 7); x.fill(); return; }
  const a = 2 * Math.PI / n.length;
  n.forEach((s, i) => {
    x.beginPath(); x.moveTo(R, R); x.arc(R, R, R - 6, wAng + i * a, wAng + (i + 1) * a); x.closePath();
    x.fillStyle = COLS[i % COLS.length]; x.fill(); x.strokeStyle = '#14264a'; x.lineWidth = 4; x.stroke();
    x.save(); x.translate(R, R); x.rotate(wAng + (i + .5) * a); x.textAlign = 'right'; x.fillStyle = '#14264a';
    x.font = '800 ' + (n.length > 10 ? 24 : 32) + 'px Nunito,sans-serif'; x.fillText(s.slice(0, 18), R - 34, 10); x.restore();
  });
}
function spin() {
  const n = nms(); if (wSpin || n.length < 2) return;
  wSpin = true; wPick = -1; $('#rm').disabled = true; $('#fate').textContent = ''; $('#spin').disabled = true;
  const start = wAng, total = (5 + Math.random() * 3) * 2 * Math.PI, dur = 4800, t0 = performance.now();
  (function f(t) {
    const p = Math.min((t - t0) / dur, 1), e = 1 - Math.pow(1 - p, 3);
    wAng = start + total * e; drawWheel();
    if (p < 1) { requestAnimationFrame(f); return; }
    wSpin = false; $('#spin').disabled = false;
    const a = 2 * Math.PI / n.length, TAU = 2 * Math.PI;
    wPick = Math.floor((((-Math.PI / 2 - wAng) % TAU) + TAU) % TAU / a);
    $('#fate').textContent = 'Fate has chosen: ' + n[wPick] + '!'; $('#rm').disabled = false;
    send({ type: 'host', a: 'fate', text: n[wPick] });
  })(t0);
}

/* ---------- events ---------- */
document.addEventListener('click', e => {
  const b = e.target.closest('[data-a]'); if (!b || b.disabled || !S || S.role !== 'host') return;
  const m = { type: 'host', a: b.dataset.a };
  for (const k of ['i', 'pid', 'team', 'c']) if (b.dataset[k] != null) m[k] = b.dataset[k];
  if (m.a === 'reset' && !confirm('Reset all scores and start over?')) return;
  send(m);
});
document.addEventListener('change', e => {
  const t = e.target; if (t.dataset && t.dataset.team && t.tagName === 'INPUT' && S && S.role === 'host') send({ type: 'host', a: 'teamName', team: t.dataset.team, name: t.value });
});
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && S && S.you && S.you.leader && S.phase === 'buzzing' && !/INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) { e.preventDefault(); send({ type: 'buzz' }); }
});

function render() { if (!S) return renderHome(); if (S.role === 'host') renderHost(); else renderPlayer(); }

if (session) $('#app').innerHTML = '<h1>Family Feud</h1><p class="muted">Reconnecting…</p>'; else renderHome();
connect();
})();
