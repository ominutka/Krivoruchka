// Криворучка — сервер.
// Комнаты: у каждой компании своя партия, свой холст, свой ведущий.
// Рисование считается здесь, всем участникам комнаты рассылаются отрезки.
// Без зависимостей. Запуск: node server.js

const http = require('http');
const fs   = require('fs');
const path = require('path');
const os   = require('os');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');

// --- параметры ------------------------------------------------------------
const W = 1800, H = 1000;
const TASKS = ['Кот','Утюг','Тираннозавр','Велосипед','Бабушка','Осьминог','Пожарная машина','Чайник',
  'Пингвин','Гитара','Замок','Кактус','Вертолёт','Снеговик','Микроволновка','Жираф','Подводная лодка','Ёжик'];
const COLORS = ['#1A1D22','#E8452B','#2D9CDB','#17B890'];
const ROUND_OPTIONS = [60, 90, 120, 180, 0];  // 0 = без ограничения времени
const ROUND_S = 90;                         // по умолчанию
const TICK_MS = 33;
const SPEED = 340, SLOW_K = 0.38, FAST_K = 2.2;
const MIN_W = 3, MAX_W = 46;
const LIMITS = { stamp:4, shake:2, mirror:2 };
const SHAKE_MS = 2200, SHAKE_AMP = 15;
const MIN_PLAYERS = 2, MAX_PLAYERS = 6;

const MODES = {
  free:  { name:'Свободная',  tag:'Как есть',        desc:'Все видят слово, никто не мешает. Просто рисуем и смеёмся.' },
  noise: { name:'Помехи',     tag:'Погода',          desc:'Всё то же, но игра сама подкидывает гадости случайному игроку.' },
  mole:  { name:'Крот',       tag:'Один против всех',desc:'Один игрок видит другое слово и честно рисует его. В конце всё вскроется.' },
  guide: { name:'Проводник',  tag:'Кооператив',      desc:'Слово знает только один — и только ему можно говорить. Остальные молчат и слушаются.' }
};

const NOISES = ['shake','boost','fat','freeze','blob'];
const NOISE_MIN = 9000, NOISE_MAX = 15000;
const FREEZE_MS = 3000, BOOST_MS = 4000;

// Комнаты живут, пока в них кто-то есть, плюс запас на переподключение
const ROOM_TTL_MS = 20 * 60 * 1000;
// Латинские согласные без похожих друг на друга букв: код остаётся читаемым
// в ссылке, набирается на любой раскладке и не складывается в слова
const CODE_ABC = 'BCDFGHJKLMNPRSTVXZ';
const CODE_LEN = 4;

// --- комнаты --------------------------------------------------------------
const rooms = new Map();
let nextId = 1;

const r = v => Math.round(v * 10) / 10;
const pick = a => a[Math.floor(Math.random() * a.length)];

function newRoom(code){
  const room = {
    code,
    clients: [],
    roleOf: new Map(),        // cid -> role
    held:   new Map(),        // cid -> Set(action)
    joinOrder: [],
    playerCount: 4,
    roundSecs: ROUND_S,
    timer: null,
    lastSeen: Date.now(),
    G: {
      stage:'mode', mode:'free',
      running:false, task:'', altTask:'', secretRole:null,
      endsAt:0,
      x:W/2, y:H/2, width:10, colorIx:0,
      left:{...LIMITS}, stampIx:0, shakeUntil:0, boostUntil:0,
      frozen:null, frozenUntil:0,
      down:false,
      inp:{left:0,right:0,up:0,down:0,draw:0,erase:0,thin:0,thick:0,slow:0,fast:0,mirror:0},
      ops:[], nextNoise:0,
      sentX:-1, sentY:-1, sentW:-1, sentC:'', sentD:-1, sentM:-1, sentS:-1
    }
  };
  rooms.set(code, room);
  return room;
}

function makeCode(){
  let code;
  do {
    code = '';
    for (let i = 0; i < CODE_LEN; i++) code += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)];
  } while (rooms.has(code));
  return code;
}

function getRoom(code, create){
  if (!code) return null;
  code = String(code).toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LEN);
  if (code.length !== CODE_LEN) return null;
  let room = rooms.get(code);
  if (!room && create) room = newRoom(code);
  if (room) room.lastSeen = Date.now();
  return room || null;
}

// Пустые комнаты убираем, чтобы память не росла
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.clients.length === 0 && now - room.lastSeen > ROOM_TTL_MS) {
      clearInterval(room.timer);
      rooms.delete(code);
    }
  }
}, 60000).unref();

// --- служебное ------------------------------------------------------------
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.png':'image/png', '.ico':'image/x-icon' };

function write(c, p){ try { c.res.write('data: ' + JSON.stringify(p) + '\n\n'); } catch(e){} }
function all(room, p){ for (const c of room.clients) write(c, p); }
function byCid(room, cid){ return room.clients.filter(c => c.cid === cid); }
function roleIds(room){ return Array.from({length: room.playerCount}, (_, i) => String(i + 1)); }
function taken(room){ return [...room.roleOf.values()]; }
function freeRole(room){ const t = taken(room); return roleIds(room).find(x => !t.includes(x)) || null; }
function leaderCid(room){ return room.joinOrder[0] || null; }
function nextCid(room){ return room.joinOrder[1] || null; }
function cidOfRole(room, role){ for (const [c, x] of room.roleOf) if (x === role) return c; return null; }

function roster(room){
  return { type:'roster', taken: taken(room), count: room.playerCount,
           leader: leaderCid(room), stage: room.G.stage, mode: room.G.mode,
           room: room.code, secs: room.roundSecs, secsOptions: ROUND_OPTIONS,
           connected: new Set(room.clients.map(c => c.cid)).size };
}
function taskFor(room, cid){
  const G = room.G;
  if (!G.running && G.stage !== 'round') return '';
  const role = room.roleOf.get(cid);
  if (G.mode === 'mole')  return role && role === G.secretRole ? G.altTask : G.task;
  if (G.mode === 'guide') return role && role === G.secretRole ? G.task : null;
  return G.task;
}
function roundFor(room, c){
  const G = room.G, role = room.roleOf.get(c.cid);
  return { type:'round', running:G.running, stage:G.stage, mode:G.mode,
           task: taskFor(room, c.cid),
           secret: (role && role === G.secretRole) ? G.mode : null,
           secs: G.running
                   ? (Number.isFinite(G.endsAt) ? Math.max(0, Math.ceil((G.endsAt - Date.now())/1000)) : null)
                   : room.roundSecs,
           color: COLORS[G.colorIx], left: G.left, width: G.width };
}
function tellYou(room, c){
  write(c, { type:'you', cid:c.cid, role: room.roleOf.get(c.cid) || null,
             count: room.playerCount, leader: leaderCid(room) === c.cid,
             next: nextCid(room) === c.cid,
             room: room.code, secs: room.roundSecs,
             stage: room.G.stage, mode: room.G.mode });
}
function announce(room){
  all(room, roster(room));
  for (const c of room.clients) { tellYou(room, c); write(c, roundFor(room, c)); }
}

// --- состав ---------------------------------------------------------------
function releaseHeld(room, cid){
  const s = room.held.get(cid); if (!s) return;
  for (const a of s) if (a in room.G.inp) room.G.inp[a] = 0;
  s.clear();
}
function releaseAll(room){
  for (const k in room.G.inp) room.G.inp[k] = 0;
  for (const s of room.held.values()) s.clear();
}
function assignRoles(room){
  room.roleOf.clear();
  const ids = roleIds(room);
  room.joinOrder.forEach((cid, i) => { if (i < ids.length) room.roleOf.set(cid, ids[i]); });
}
function shuffleRoles(room){
  const cids = room.joinOrder.filter(c => room.roleOf.has(c));
  if (cids.length < 2) return;
  const roles = cids.map(c => room.roleOf.get(c));
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  if (cids.every((c, i) => room.roleOf.get(c) === roles[i])) roles.push(roles.shift());
  cids.forEach((c, i) => room.roleOf.set(c, roles[i]));
  releaseAll(room);
  all(room, { type:'shuffled' });
  announce(room);
}
function pickRole(room, cid, role){
  if (room.G.stage !== 'lobby') return;
  if (!roleIds(room).includes(role)) return;
  if (taken(room).includes(role)) return;
  room.roleOf.set(cid, role);
  announce(room);
}
// Ведение забирает только следующий в очереди, бывший ведущий уходит в конец
function claimLead(room, cid){
  if (room.G.running) return;
  if (cid !== nextCid(room)) return;
  const old = room.joinOrder.shift();
  const i = room.joinOrder.indexOf(cid);
  room.joinOrder.splice(i, 1);
  room.joinOrder.unshift(cid);
  room.joinOrder.push(old);
  announce(room);
}

// --- этапы ----------------------------------------------------------------
function setStage(room, s){
  if (s === 'mode') { room.roleOf.clear(); releaseAll(room); }
  room.G.stage = s;
  announce(room);
}
function setMode(room, m){
  if (room.G.stage !== 'mode' || !MODES[m]) return;
  room.G.mode = m;
  setStage(room, 'count');
}
function setCount(room, n){
  if (room.G.stage !== 'count') return;
  room.playerCount = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n | 0));
  assignRoles(room);
  setStage(room, 'lobby');
}
// Сколько длится раунд. Шестьдесят секунд многим оказалось мало,
// поэтому длительность выбирает ведущий, а не задаёт код.
function setTime(room, n){
  if (room.G.running) return;
  if (!ROUND_OPTIONS.includes(n | 0)) return;
  room.roundSecs = n | 0;
  announce(room);
}

function goBack(room){
  const s = room.G.stage;
  if (s === 'count') setStage(room, 'mode');
  else if (s === 'lobby') setStage(room, 'count');
  else if (s === 'result') setStage(room, 'lobby');
}

// --- раунд ----------------------------------------------------------------
function startRound(room){
  const G = room.G;
  if (G.stage !== 'lobby' || G.running) return;
  if (taken(room).length < 2) return;

  G.task = pick(TASKS);
  G.altTask = ''; G.secretRole = null;
  if (G.mode === 'mole') {
    G.secretRole = pick(taken(room));
    do { G.altTask = pick(TASKS); } while (G.altTask === G.task);
  } else if (G.mode === 'guide') {
    G.secretRole = pick(taken(room));
  }

  G.x = W/2; G.y = H/2; G.width = 10; G.colorIx = 0;
  G.left = {...LIMITS}; G.stampIx = 0;
  G.shakeUntil = 0; G.boostUntil = 0; G.frozen = null; G.frozenUntil = 0;
  G.down = false; G.ops = [];
  G.sentX = -1; G.sentY = -1; G.sentW = -1;
  G.sentC = ''; G.sentD = -1; G.sentM = -1; G.sentS = -1;
  releaseAll(room);

  G.running = true; G.stage = 'round';
  // 0 значит «без ограничения»: раунд идёт, пока ведущий не остановит сам
  G.endsAt = room.roundSecs > 0 ? Date.now() + room.roundSecs * 1000 : Infinity;
  G.nextNoise = Date.now() + NOISE_MIN + Math.random() * (NOISE_MAX - NOISE_MIN);

  all(room, { type:'clear' });
  announce(room);
  clearInterval(room.timer);
  room.timer = setInterval(() => tick(room), TICK_MS);
}

function endRound(room){
  const G = room.G;
  clearInterval(room.timer); room.timer = null;
  G.running = false; G.stage = 'result';
  G.shakeUntil = 0; G.boostUntil = 0; G.frozen = null;
  releaseAll(room);

  const reveal = { type:'result', mode:G.mode, task:G.task };
  if (G.mode === 'mole')  { reveal.secretRole = G.secretRole; reveal.altTask = G.altTask; }
  if (G.mode === 'guide') { reveal.secretRole = G.secretRole; }
  all(room, reveal);
  announce(room);
}

function pushOp(room, op){ room.G.ops.push(op); all(room, op); }

function fireNoise(room){
  const G = room.G, kind = pick(NOISES), now = Date.now();
  let text = '', role = null;

  if (kind === 'shake') { G.shakeUntil = now + SHAKE_MS; text = 'Карандаш затрясло'; }
  else if (kind === 'boost') { G.boostUntil = now + BOOST_MS; text = 'Карандаш понесло'; }
  else if (kind === 'fat') { G.width = MAX_W; text = 'Линия раздулась'; }
  else if (kind === 'blob') { doBlob(room); text = 'Клякса'; }
  else {
    const t = taken(room);
    if (!t.length) return;
    role = pick(t);
    G.frozen = role; G.frozenUntil = now + FREEZE_MS;
    const cid = cidOfRole(room, role);
    if (cid) releaseHeld(room, cid);
    text = 'Кнопки отказали';
  }
  all(room, { type:'noise', kind, text, role });
}

function tick(room){
  const G = room.G, now = Date.now(), dt = TICK_MS / 1000;

  if (G.frozen && now >= G.frozenUntil) G.frozen = null;
  if (G.mode === 'noise' && now >= G.nextNoise) {
    fireNoise(room);
    G.nextNoise = now + NOISE_MIN + Math.random() * (NOISE_MAX - NOISE_MIN);
  }

  const boost = now < G.boostUntil ? 1.9 : 1;
  const k = (G.inp.fast ? FAST_K : 1) * (G.inp.slow ? SLOW_K : 1) * boost;
  const dx = G.inp.right - G.inp.left, dy = G.inp.down - G.inp.up;
  const px = G.x, py = G.y;

  G.x = Math.max(0, Math.min(W, G.x + dx * SPEED * k * dt));
  G.y = Math.max(0, Math.min(H, G.y + dy * SPEED * k * dt));

  if (now < G.shakeUntil) {
    G.x = Math.max(0, Math.min(W, G.x + (Math.random() - .5) * SHAKE_AMP));
    G.y = Math.max(0, Math.min(H, G.y + (Math.random() - .5) * SHAKE_AMP));
  }

  if (G.inp.thick) G.width = Math.min(MAX_W, G.width + 36 * dt);
  if (G.inp.thin)  G.width = Math.max(MIN_W, G.width - 36 * dt);

  const erasing = !!G.inp.erase, drawing = !!G.inp.draw && !erasing;
  let seg = null, mseg = null;
  if (drawing || erasing) {
    const from = G.down ? [px, py] : [G.x, G.y];
    const w2 = r(erasing ? Math.max(G.width * 2.6, 34) : G.width);
    const col = erasing ? null : COLORS[G.colorIx];
    seg = { type:'seg', a:[r(from[0]), r(from[1])], b:[r(G.x), r(G.y)], w:w2, c:col };
    G.ops.push(seg);
    if (G.inp.mirror) {
      mseg = { type:'seg', a:[r(W - from[0]), r(from[1])], b:[r(W - G.x), r(G.y)], w:w2, c:col };
      G.ops.push(mseg);
    }
  }
  G.down = drawing || erasing;

  // Бесплатные хостинги плохо переносят поток в 30 сообщений в секунду,
  // поэтому шлём кадр только когда что-то изменилось. Когда карандаш стоит
  // и никто не рисует, уходит одно сообщение в секунду — ради таймера.
  const secs = Number.isFinite(G.endsAt) ? Math.max(0, Math.ceil((G.endsAt - now) / 1000)) : null;
  const mirror = G.inp.mirror ? 1 : 0;
  const pen = drawing ? 1 : (erasing ? 2 : 0);
  const moved = r(G.x) !== G.sentX || r(G.y) !== G.sentY;
  const changed = moved || seg || r(G.width) !== G.sentW ||
                  COLORS[G.colorIx] !== G.sentC || pen !== G.sentD ||
                  mirror !== G.sentM || secs !== G.sentS;

  if (changed) {
    G.sentX = r(G.x); G.sentY = r(G.y); G.sentW = r(G.width);
    G.sentC = COLORS[G.colorIx]; G.sentD = pen; G.sentM = mirror; G.sentS = secs;
    all(room, { type:'t', x:G.sentX, y:G.sentY, w:G.sentW, c:G.sentC,
                s: secs, m: mirror, d: pen, seg, mseg });
  }

  if (Number.isFinite(G.endsAt) && now >= G.endsAt) endRound(room);
}

function spend(room, key){
  const G = room.G;
  if (!G.running || G.left[key] <= 0) return false;
  G.left[key]--;
  for (const c of room.clients) write(c, roundFor(room, c));
  return true;
}
function doBlob(room){
  const G = room.G, R = G.width * 2.4 + 26, pts = [];
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) {
    const rr = R * (.72 + Math.random() * .5);
    pts.push([r(G.x + Math.cos(a) * rr), r(G.y + Math.sin(a) * rr)]);
  }
  pushOp(room, { type:'blob', pts, c: COLORS[G.colorIx] });
}
function doStamp(room){
  const G = room.G;
  if (!spend(room, 'stamp')) return;
  const base = { type:'stamp', kind: G.stampIx % 4, R: r(G.width * 2.6 + 52),
                 w: r(Math.max(G.width, 6)), c: COLORS[G.colorIx] };
  G.stampIx++;
  pushOp(room, { ...base, x:r(G.x), y:r(G.y) });
  if (G.inp.mirror) pushOp(room, { ...base, x:r(W - G.x), y:r(G.y) });
}
function doShake(room){ if (spend(room, 'shake')) room.G.shakeUntil = Date.now() + SHAKE_MS; }
function setMirror(room, down){
  const G = room.G;
  if (!down) { G.inp.mirror = 0; return; }
  if (G.inp.mirror) return;
  if (!spend(room, 'mirror')) return;
  G.inp.mirror = 1;
}

function applyInput(room, cid, action, down){
  const G = room.G, role = room.roleOf.get(cid);
  if (!role || !G.running) return;
  if (G.frozen === role) return;
  if (action === 'stamp') return doStamp(room);
  if (action === 'shake') return doShake(room);
  if (action === 'color'){ G.colorIx = (G.colorIx + 1) % COLORS.length;
    for (const c of room.clients) write(c, roundFor(room, c)); return; }
  if (action === 'mirror'){
    setMirror(room, down);
    if (!room.held.has(cid)) room.held.set(cid, new Set());
    down ? room.held.get(cid).add('mirror') : room.held.get(cid).delete('mirror');
    return;
  }
  if (!(action in G.inp)) return;
  G.inp[action] = down ? 1 : 0;
  if (!room.held.has(cid)) room.held.set(cid, new Set());
  down ? room.held.get(cid).add(action) : room.held.get(cid).delete(action);
}

// --- HTTP -----------------------------------------------------------------
function readBody(req){
  return new Promise((ok2, no) => {
    let raw = '';
    req.on('data', c => { raw += c; if (raw.length > 1e5) { req.destroy(); no(new Error('big')); } });
    req.on('end', () => { try { ok2(raw ? JSON.parse(raw) : {}); } catch(e){ no(e); } });
  });
}
function serveStatic(req, res){
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/' || rel === '/play.html' || rel === '/host.html') rel = '/index.html';
  const file = path.join(PUBLIC, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}).end('Не найдено'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-store' });
    res.end(data);
  });
}
const json = (res, obj) => {
  res.writeHead(200, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(obj));
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Клиент может жить на другом домене (itch.io, свой сайт), поэтому
  // разрешаем запросы откуда угодно. Секретов на сервере нет.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return; }

  // Новая комната
  if (url.pathname === '/new') {
    const code = makeCode();
    newRoom(code);
    json(res, { room: code });
    return;
  }

  // Есть ли такая комната
  if (url.pathname === '/roster') {
    const room = getRoom(url.searchParams.get('room'), false);
    if (!room) { json(res, { error:'no-room' }); return; }
    json(res, roster(room));
    return;
  }

  if (url.pathname === '/stream') {
    const room = getRoom(url.searchParams.get('room'), false);
    const cid = url.searchParams.get('cid') || ('x' + nextId);
    const id = nextId++;

    res.writeHead(200, { 'Content-Type':'text/event-stream; charset=utf-8',
      'Cache-Control':'no-cache, no-transform', 'Connection':'keep-alive', 'X-Accel-Buffering':'no' });
    if (res.flushHeaders) res.flushHeaders();
    res.write(': ok\n\n');

    if (!room) {
      res.write('data: ' + JSON.stringify({ type:'no-room' }) + '\n\n');
      res.end();
      return;
    }

    const client = { id, res, cid };
    room.clients.push(client);
    if (!room.joinOrder.includes(cid)) room.joinOrder.push(cid);

    if (room.G.stage !== 'mode' && room.G.stage !== 'count' && !room.roleOf.has(cid)) {
      const role = freeRole(room);
      if (role) room.roleOf.set(cid, role);
    }

    write(client, { type:'hello', w:W, h:H, colors:COLORS, limits:LIMITS,
                    roundSecs:room.roundSecs, modes:MODES, room:room.code });
    write(client, { type:'snapshot', ops:room.G.ops });
    announce(room);

    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch(e){} }, 15000);

    req.on('close', () => {
      clearInterval(ping);
      room.clients = room.clients.filter(c => c.id !== id);
      room.lastSeen = Date.now();
      if (byCid(room, cid).length === 0) {
        releaseHeld(room, cid); room.held.delete(cid);
        const i = room.joinOrder.indexOf(cid); if (i >= 0) room.joinOrder.splice(i, 1);
        if (room.roleOf.has(cid)) {
          const role = room.roleOf.get(cid);
          room.roleOf.delete(cid);
          const waiting = room.joinOrder.find(c => !room.roleOf.has(c));
          if (waiting) room.roleOf.set(waiting, role);
        }
        announce(room);
      }
      // Комната без людей и без раунда — останавливаем таймер
      if (room.clients.length === 0 && room.timer) { clearInterval(room.timer); room.timer = null; room.G.running = false; }
    });
    return;
  }

  if (url.pathname === '/msg' && req.method === 'POST') {
    let b;
    try { b = await readBody(req); } catch(e){ res.writeHead(400).end('bad'); return; }
    const room = getRoom(b.room, false);
    if (!room) { res.writeHead(204).end(); return; }
    const lead = b.cid && b.cid === leaderCid(room);

    if (b.type === 'input') applyInput(room, b.cid, b.action, !!b.down);
    else if (b.type === 'pickRole') pickRole(room, b.cid, String(b.role));
    else if (b.type === 'claim') claimLead(room, b.cid);
    else if (b.type === 'mode'    && lead) setMode(room, b.m);
    else if (b.type === 'count'   && lead) setCount(room, b.n);
    else if (b.type === 'time'    && lead) setTime(room, b.n);
    else if (b.type === 'back'    && lead) goBack(room);
    else if (b.type === 'start'   && lead) startRound(room);
    else if (b.type === 'stop'    && lead && room.G.running) endRound(room);
    else if (b.type === 'again'   && lead && room.G.stage === 'result') setStage(room, 'lobby');
    else if (b.type === 'remode'  && lead) setStage(room, 'mode');
    else if (b.type === 'clear'   && lead) { room.G.ops = []; all(room, { type:'clear' }); }
    else if (b.type === 'shuffle' && lead) shuffleRoles(room);

    res.writeHead(204, {'Cache-Control':'no-store'}).end();
    return;
  }

  serveStatic(req, res);
});

function addresses(){
  const out = [];
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push(n.address);
  return out;
}

server.listen(PORT, () => {
  const a = addresses();
  console.log('\n  КРИВОРУЧКА — сервер запущен\n');
  console.log('  На этом устройстве:  http://localhost:' + PORT + '/');
  if (a.length) console.log('  В своей сети Wi-Fi:  http://' + a[0] + ':' + PORT + '/');
  console.log('\n  Чтобы играть с теми, кто не рядом, откройте доступ из интернета —');
  console.log('  см. раздел «Играть с кем угодно» в README.md');
  console.log('\n  Остановить: Ctrl+C\n');
});
