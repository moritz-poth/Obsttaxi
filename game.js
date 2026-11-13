'use strict';
// Obst-Taxi: top-down fruit delivery on the real OSM street map of Kreuzberg 36.
// World units are metres, x east, y south, origin at the north-west corner of the map.
const M = window.MAP, W = M.w, H = M.h;
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const $ = id => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.random() * a.length | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

let DPR = 1, VW = 0, VH = 0;
function resize() { DPR = Math.min(devicePixelRatio || 1, 2); VW = cv.width = innerWidth * DPR | 0; VH = cv.height = innerHeight * DPR | 0; }
addEventListener('resize', resize); resize();

// ---------- map prep
const bbox = p => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); c = Math.max(c, p[i]); b = Math.min(b, p[i + 1]); d = Math.max(d, p[i + 1]); } return [a, b, c, d]; };
const trace = (g, p, close) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); if (close) g.closePath(); };
const CAR_ROADS = new Set(['primary', 'secondary', 'secondary_link', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
M.roads.forEach(r => { r.bb = bbox(r.p); r.car = CAR_ROADS.has(r.t); });
M.green.forEach(g => g.bb = bbox(g.p));
const WATER = M.water.map(p => ({ p, bb: bbox(p) }));
const ROOFS = [[138, 84, 70], [125, 127, 134], [156, 143, 122], [111, 106, 99], [164, 106, 82], [146, 122, 104]];
const LIGHT = [-0.45, -0.89];
M.buildings.forEach((b, n) => {
  const p = b.p; b.bb = bbox(p);
  let area = 0, cx = 0, cy = 0; const k = p.length / 2;
  for (let i = 0; i < k; i++) { const j = (i + 1) % k; area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; cx += p[2 * i]; cy += p[2 * i + 1]; }
  b.cx = cx / k; b.cy = cy / k; b.ws = Math.sign(area);
  const rgb = ROOFS[n % ROOFS.length], col = f => `rgb(${rgb.map(v => v * f | 0)})`;
  b.roof = col(1); b.edge = col(0.7);
  b.wall = [];
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k, ex = p[2 * j] - p[2 * i], ey = p[2 * j + 1] - p[2 * i + 1], l = Math.hypot(ex, ey) || 1;
    b.wall.push(col(0.62 + 0.28 * (ey * LIGHT[0] - ex * LIGHT[1]) * b.ws / l));
  }
});

// collision mask, 1 px per metre: 0 free, 1 building, 2 water
const mask = (() => {
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
  const m = mc.getContext('2d');
  m.fillStyle = '#0f0'; WATER.forEach(w => { trace(m, w.p, 1); m.fill(); });
  m.fillStyle = '#f00'; M.buildings.forEach(b => { trace(m, b.p, 1); m.fill(); });
  m.globalCompositeOperation = 'destination-out'; m.lineCap = m.lineJoin = 'round';
  M.roads.forEach(r => { if (r.car || r.b) { m.lineWidth = r.w; trace(m, r.p); m.stroke(); } });
  const d = m.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) if (d[i * 4 + 3] > 100) out[i] = d[i * 4] > 100 ? 1 : 2;
  return out;
})();
const cell = (x, y) => { x |= 0; y |= 0; return x < 0 || y < 0 || x >= W || y >= H ? 1 : mask[y * W + x]; };
function los(ax, ay, bx, by) {
  const n = Math.ceil(dist(ax, ay, bx, by) / 2);
  for (let i = 1; i < n; i++) if (cell(ax + (bx - ax) * i / n, ay + (by - ay) * i / n) === 1) return false;
  return true;
}

// ---------- road graph
const N = M.nodes.length / 2, NX = i => M.nodes[2 * i], NY = i => M.nodes[2 * i + 1];
const MAIN = (() => { // largest connected component, so nobody spawns on an island
  const comp = new Int32Array(N).fill(-1); let best = [], c = 0;
  for (let s = 0; s < N; s++) {
    if (comp[s] >= 0) continue;
    const list = [s]; comp[s] = c;
    for (let q = 0; q < list.length; q++) for (const nb of M.adj[list[q]]) if (comp[nb] < 0) { comp[nb] = c; list.push(nb); }
    if (list.length > best.length) best = list; c++;
  }
  return best;
})();
const GRID = 40, grid = new Map();
MAIN.forEach(n => { const k = (NX(n) / GRID | 0) + ',' + (NY(n) / GRID | 0); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(n); });
function nearestNode(x, y) {
  const gx = x / GRID | 0, gy = y / GRID | 0; let best = MAIN[0], bd = Infinity;
  for (let r = 0; r < 30 && bd === Infinity; r++)
    for (let i = gx - r; i <= gx + r; i++) for (let j = gy - r; j <= gy + r; j++)
      for (const n of grid.get(i + ',' + j) || []) { const d = dist(x, y, NX(n), NY(n)); if (d < bd) { bd = d; best = n; } }
  return best;
}
function dijkstra(src) {
  const d = new Float64Array(N).fill(Infinity), heap = [[0, src]]; d[src] = 0;
  const push = e => { heap.push(e); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= e[0]) break; heap[i] = heap[p]; i = p; } heap[i] = e; };
  const pop = () => { const top = heap[0], e = heap.pop(); if (heap.length) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= heap.length) break; if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++; if (heap[c][0] >= e[0]) break; heap[i] = heap[c]; i = c; } heap[i] = e; } return top; };
  while (heap.length) {
    const [du, u] = pop(); if (du > d[u]) continue;
    for (const v of M.adj[u]) { const nd = du + dist(NX(u), NY(u), NX(v), NY(v)); if (nd < d[v]) { d[v] = nd; push([nd, v]); } }
  }
  return d;
}
const place = n => ({ x: NX(n), y: NY(n), name: M.names[M.nodeName[n]] || 'a backyard' });
function randNode(x, y, minR, maxR, offscreen) {
  for (let t = 0; t < 200; t++) {
    const n = pick(MAIN), d = dist(x, y, NX(n), NY(n));
    if (d < minR || d > maxR || (offscreen && onScreen(NX(n), NY(n), 25))) continue;
    if (!offscreen && (M.nodeName[n] < 0 || NX(n) < 80 || NY(n) < 80 || NX(n) > W - 80 || NY(n) > H - 80)) continue;
    return n;
  }
  return -1;
}

// ---------- cars
const SPEC = {
  player: { acc: 11, brake: 24, drag: 0.35, turn: 2.8 },
  traffic: { acc: 6, brake: 18, drag: 0.5, turn: 2.6 },
  police: { acc: 12.5, brake: 24, drag: 0.35, turn: 2.9 },
};
const CORNERS = [[2.3, 1], [2.3, -1], [-2.3, 1], [-2.3, -1], [0, 1], [0, -1], [2.3, 0]];
function hits(x, y, a) {
  const c = Math.cos(a), s = Math.sin(a);
  for (const [l, w] of CORNERS) if (cell(x + c * l - s * w, y + s * l + c * w)) return true;
  return false;
}
const speedOf = c => c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a);
function physics(c, thr, steer, hb, dt) {
  const P = SPEC[c.kind], fx = Math.cos(c.a), fy = Math.sin(c.a);
  let fwd = c.vx * fx + c.vy * fy, lat = -c.vx * fy + c.vy * fx;
  if (thr > 0) fwd += (fwd < -0.5 ? P.brake : P.acc) * thr * dt;
  else if (thr < 0) fwd -= (fwd > 0.5 ? P.brake : P.acc * 0.6) * -thr * dt;
  else fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 3 * dt);
  fwd -= fwd * P.drag * dt;
  if (hb) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 7 * dt);
  lat *= Math.exp(-(hb ? 1.2 : 10) * dt);
  const na = c.a + steer * P.turn * clamp(fwd / 5, -1, 1) / (1 + Math.abs(fwd) / 30) * (hb ? 1.4 : 1) * dt;
  c.vx = fwd * fx - lat * fy; c.vy = fwd * fy + lat * fx;
  let impact = 0;
  const nx = c.x + c.vx * dt; if (hits(nx, c.y, na)) { impact += Math.abs(c.vx); c.vx *= -0.3; } else c.x = nx;
  const ny = c.y + c.vy * dt; if (hits(c.x, ny, na)) { impact += Math.abs(c.vy); c.vy *= -0.3; } else c.y = ny;
  if (!hits(c.x, c.y, na)) c.a = na;
  return impact;
}
// AI: drive towards (tx,ty) at roughly `want` m/s, back up when stuck
function steerTo(c, tx, ty, want, dt) {
  const da = angDiff(Math.atan2(ty - c.y, tx - c.x), c.a), sp = speedOf(c);
  if (c.rev > 0) { c.rev -= dt; return physics(c, -1, -Math.sign(da), false, dt); }
  const target = Math.abs(da) > 0.6 ? Math.max(4, want * 0.4) : want;
  let thr = sp < target - 1 ? 1 : sp > target + 1 ? -1 : 0.2;
  c.wait = c.blocked ? (c.wait || 0) + dt : Math.max(0, (c.wait || 0) - dt);
  if (c.wait > 4.5) c.wait = 0;
  if (c.blocked && c.wait < 3) thr = sp > 0.5 ? -1 : 0; // shortcut: head-on standoffs resolve by pushing through
  c.stuck = thr > 0 && sp < 0.8 ? c.stuck + dt : 0;
  if (c.stuck > 1.2) { c.rev = 1; c.stuck = 0; }
  return physics(c, thr, clamp(da * 2.5, -1, 1), false, dt);
}
const PAINT = ['#c0392b', '#2e5c9a', '#e8e2d0', '#2b2b2b', '#7f8c8d', '#d9a21b', '#5d3a6b', '#1f7a6d', '#a0522d'];
function makeCar(kind, from, to) {
  return { kind, x: NX(from), y: NY(from), a: Math.atan2(NY(to) - NY(from), NX(to) - NX(from)), vx: 0, vy: 0,
    from, to, stuck: 0, rev: 0, chase: false, color: kind === 'police' ? '#f4f4f4' : pick(PAINT) };
}
function lanePoint(c) { // aim 2.2 m right of the edge centre line
  const dx = NX(c.to) - NX(c.from), dy = NY(c.to) - NY(c.from), l = Math.hypot(dx, dy) || 1;
  return [NX(c.to) - dy / l * 2.2, NY(c.to) + dx / l * 2.2];
}

// ---------- game content
const FRUITS = [
  { n: 'Alphonso Mango', e: '🥭', p: 35, life: 150, smell: 0.25, col: '#f2a531' },
  { n: 'Rambutan', e: '🔴', p: 45, life: 120, smell: 0.15, col: '#d6333a' },
  { n: 'Mangosteen', e: '🟣', p: 60, life: 110, smell: 0.15, col: '#6b2a5e' },
  { n: 'Dragon Fruit', e: '🐉', p: 40, life: 160, smell: 0.1, col: '#e0457b' },
  { n: 'Cherimoya', e: '💚', p: 70, life: 100, smell: 0.35, col: '#9cc464' },
  { n: 'Jackfruit', e: '🟡', p: 55, life: 130, smell: 0.55, col: '#d8c03a' },
  { n: 'Durian', e: '🤢', p: 120, life: 90, smell: 1, col: '#b5a642' },
];
const CLIENTS = ['Kiki 🦄', 'Startup Steffen 💻', 'Oma Hilde 👵', 'DJ Mangold 🎧', 'Ayla 🌙', 'Techno Tim 🕺', 'Dr. Pflaume 🩺', 'Vegan Lukas 🌱', 'Späti Murat 🏪', 'Influencer Lea 📸'];
const OFFERS = [
  'yo got any {f}? need {q} 🙏 {d}. €{p}',
  'emergency. smoothie party. {q} {f} to {d}. €{p} cash',
  'hey 👀 the exotic stuff… {f}? {q}, {d}. paying €{p}',
  'is this the fruit guy? {q} {f} pls. {d}. €{p}',
];
const HAPPY = ['you\'re a legend 🙌', 'perfect ripeness 🤌', 'see u next week', 'smells divine. here\'s ur money'];
const MEH = ['bit mushy but ok…', 'took u long enough 🙄 paying less'];
const FRED = 'Fruity Fred 🍍';

const keys = {};
const G = { started: false, time: 0, money: 100, wanted: 0, lastSeen: 0, crimeCd: 0, bustT: 0, grace: 0,
  job: null, nextOffer: 3, banner: '', bannerT: 0, shake: 0, distT: 0, D: null, spawnT: 0 };
const startNode = nearestNode(894, 928); // Kottbusser Tor
const player = makeCar('player', startNode, M.adj[startNode][0]);
player.color = '#9bd32d';
const shop = place(nearestNode(1930, 780)); // Wrangelkiez
const cars = [player];
let camX = player.x, camY = player.y, zoom = 7;
let S = zoom * DPR;
function onScreen(x, y, m) { return Math.abs(x - camX) < VW / 2 / S + m && Math.abs(y - camY) < VH / 2 / S + m; }

function msg(from, text) {
  const el = document.createElement('div'); el.className = from ? 'm' : 'm sys';
  el.innerHTML = from ? '<b></b><span></span>' : '<span></span>';
  if (from) el.querySelector('b').textContent = from;
  el.querySelector('span').textContent = text;
  const box = $('msgs'); box.append(el); while (box.children.length > 7) box.firstChild.remove();
}
const banner = (t, s = 2.5) => { G.banner = t; G.bannerT = s; };
function crime(reason) {
  if (G.crimeCd > 0 || G.grace > 0) return;
  G.crimeCd = 4; G.lastSeen = G.time;
  const first = G.wanted === 0;
  G.wanted = Math.min(5, G.wanted + 1);
  banner(reason + '!  ' + '★'.repeat(G.wanted));
  if (first) msg(FRED, `cops on ur tail? lose them or get a respray at ${shop.name} (€150)`);
}
function busted() {
  const fine = Math.min(G.money, 100 + 50 * G.wanted);
  G.money -= fine; G.wanted = 0; G.bustT = 0; G.grace = 5;
  banner('BUSTED  −€' + fine, 3);
  if (G.job && G.job.stage === 'deliver') msg(FRED, 'u lost my crate?! that comes out of ur pocket 😤');
  if (G.job && G.job.stage !== 'offer') { G.job = null; G.nextOffer = G.time + 8; }
  player.vx = player.vy = 0;
}

function newOffer() {
  const pn = randNode(player.x, player.y, 250, 800), pk = pn >= 0 && place(pn);
  const dn = pk && randNode(pk.x, pk.y, 500, 1500);
  if (!pk || dn < 0) { G.nextOffer = G.time + 2; return; }
  const f = pick(FRUITS), q = 1 + (Math.random() * 4 | 0), client = pick(CLIENTS);
  G.job = { stage: 'offer', f, q, client, pickup: pk, drop: place(dn), pay: f.p * q, exp: G.time + 25, ripe: 0 };
  msg(client, pick(OFFERS).replace('{f}', f.n + ' ' + f.e).replace('{q}', q + (q > 1 ? ' boxes' : ' box')).replace('{d}', G.job.drop.name).replace('{p}', G.job.pay));
  msg(null, '[Y] accept · [N] ignore');
}
function updateJob(dt) {
  const j = G.job, sp = Math.abs(speedOf(player));
  if (!j || j.stage !== 'offer') G.answer = null; // a stray Y must not accept a later offer
  if (!j) { if (G.time > G.nextOffer) newOffer(); return; }
  const done = () => { G.job = null; G.nextOffer = G.time + rnd(5, 12); };
  if (j.stage === 'offer') {
    const ans = G.answer; G.answer = null;
    if (ans === 'y') { j.stage = 'pickup'; msg(FRED, `fresh ${j.f.n} waiting at ${j.pickup.name}. don't let the cops sniff it 👃`); if (j.f.smell >= 1) msg(FRED, 'careful, durian STINKS. cops smell it a mile off'); }
    else if (ans === 'n' || G.time > j.exp) { msg(null, ans === 'n' ? 'ignored.' : 'offer expired.'); done(); }
  } else if (j.stage === 'pickup') {
    if (dist(player.x, player.y, j.pickup.x, j.pickup.y) < 10 && sp < 5) {
      j.stage = 'deliver'; j.ripe = 0.15; banner(`${j.q}× ${j.f.n} loaded`);
      msg(j.client, 'omw? 👀');
    }
  } else {
    j.ripe += dt / j.f.life;
    if (j.ripe >= 1) { msg(j.client, 'ew. it\'s mush now. deal\'s off ❌'); banner('Fruit rotten'); done(); return; }
    if (dist(player.x, player.y, j.drop.x, j.drop.y) < 10 && sp < 5) {
      const pay = Math.round(j.pay * (j.ripe < 0.6 ? 1 : 1.6 - j.ripe));
      G.money += pay; banner('+€' + pay);
      msg(j.client, pick(j.ripe < 0.6 ? HAPPY : MEH)); done();
    }
  }
}

// ---------- simulation
const DT = 1 / 60, TRAFFIC = 28, PATROL = 3;
function spawn(kind, minR, maxR) {
  const n = randNode(player.x, player.y, minR, maxR, true);
  if (n < 0 || cars.some(c => dist(c.x, c.y, NX(n), NY(n)) < 10)) return null;
  const c = makeCar(kind, n, pick(M.adj[n])); cars.push(c); return c;
}
function update(dt) {
  G.time += dt; G.crimeCd -= dt; G.grace -= dt; G.bannerT -= dt; G.shake *= 0.9;
  const police = cars.filter(c => c.kind === 'police');

  // player
  const thr = (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0);
  const steer = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
  const imp = physics(player, thr, steer, keys.Space, dt);
  if (imp > 6) G.shake = Math.min(12, imp);

  // police distance field towards the player
  if (G.wanted > 0 && (G.distT -= dt) <= 0) { G.D = dijkstra(nearestNode(player.x, player.y)); G.distT = 0.5; }

  // AI
  for (const c of cars) {
    if (c === player) continue;
    const toPlayer = dist(c.x, c.y, player.x, player.y);
    if (c.chase) {
      c.blocked = false;
      if (toPlayer < 45 && los(c.x, c.y, player.x, player.y)) {
        steerTo(c, player.x + player.vx * 0.4, player.y + player.vy * 0.4, 16 + 3 * G.wanted, dt);
        continue;
      }
      if (dist(c.x, c.y, NX(c.to), NY(c.to)) > 40) c.to = nearestNode(c.x, c.y);
      if (dist(c.x, c.y, NX(c.to), NY(c.to)) < 8 && G.D) {
        let best = c.to; for (const nb of M.adj[c.to]) if (G.D[nb] < G.D[best]) best = nb;
        if (best === c.to) { steerTo(c, player.x, player.y, 12, dt); continue; }
        c.from = c.to; c.to = best;
      }
      steerTo(c, NX(c.to), NY(c.to), 16 + 3 * G.wanted, dt);
    } else {
      const [lx, ly] = lanePoint(c);
      if (dist(c.x, c.y, lx, ly) < 7) {
        const opts = M.adj[c.to].filter(n => n !== c.from);
        const nxt = opts.length ? pick(opts) : c.from; c.from = c.to; c.to = nxt;
      }
      const fx = Math.cos(c.a), fy = Math.sin(c.a);
      c.blocked = cars.some(o => o !== c && Math.abs(o.x - c.x) < 10 && Math.abs(o.y - c.y) < 10 && (() => {
        const dx = o.x - c.x, dy = o.y - c.y, d = Math.hypot(dx, dy);
        return d < 9 && dx * fx + dy * fy > 0.85 * d;
      })());
      steerTo(c, ...lanePoint(c), c.kind === 'police' ? 10 : 9, dt);
    }
  }

  // car vs car
  for (let i = 0; i < cars.length; i++) for (let k = i + 1; k < cars.length; k++) {
    const a = cars[i], b = cars[k], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d >= 3.6 || d === 0) continue;
    const nx = dx / d, ny = dy / d, push = (3.6 - d) / 2;
    if (!hits(a.x - nx * push, a.y - ny * push, a.a)) { a.x -= nx * push; a.y -= ny * push; }
    if (!hits(b.x + nx * push, b.y + ny * push, b.a)) { b.x += nx * push; b.y += ny * push; }
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv >= 0) continue;
    const j = -1.3 * rv / 2;
    a.vx -= j * nx; a.vy -= j * ny; b.vx += j * nx; b.vy += j * ny;
    if ((a === player || b === player) && -rv > 3) {
      G.shake = Math.min(12, -rv * 1.5);
      const other = a === player ? b : a;
      if (other.kind === 'police') { if (Math.abs(speedOf(player)) > 4) crime('Rammed a cop'); }
      else if (seenBy(police)) crime('Hit and run');
    }
  }

  // police logic
  const seen = seenBy(police), sp = Math.abs(speedOf(player));
  if (seen) G.lastSeen = G.time;
  if (seen && sp > 16.7 && G.wanted === 0) crime('Speeding');
  if (G.job && G.job.stage === 'deliver') {
    const s = G.job.f.smell * (0.5 + G.job.ripe);
    if (police.some(p => dist(p.x, p.y, player.x, player.y) < 10 + 40 * s)) crime(`Cop smelled the ${G.job.f.n}`);
  }
  if (G.wanted > 0 && G.time - G.lastSeen > 10 + 4 * G.wanted) {
    G.wanted--; G.lastSeen = G.time;
    banner(G.wanted ? 'Losing them…  ' + '★'.repeat(G.wanted) : 'Lost the cops');
  }
  if (G.wanted > 0 && dist(player.x, player.y, shop.x, shop.y) < 10 && sp < 4) {
    if (G.money >= 150) {
      G.money -= 150; G.wanted = 0; G.grace = 3;
      player.color = pick(['#9bd32d', '#e86f2d', '#3fa7d6', '#d64fa0', '#f2d43a']);
      banner('Fresh paint. Cops lost you.  −€150');
    } else if (G.bannerT <= 0) banner('Respray costs €150');
  }
  police.forEach(p => { p.chase = G.wanted > 0 && (p.chase || dist(p.x, p.y, player.x, player.y) < 350); });
  const near = police.some(p => dist(p.x, p.y, player.x, player.y) < 7);
  G.bustT = near && sp < 1.5 && G.wanted > 0 ? G.bustT + dt : Math.max(0, G.bustT - dt);
  if (G.bustT > 1.5) busted();

  // population: despawn far cars, spawn near the player but off screen
  for (let i = cars.length - 1; i > 0; i--) {
    const c = cars[i], d = dist(c.x, c.y, player.x, player.y);
    if (d > 550 && !onScreen(c.x, c.y, 30) && !(c.chase && d < 900)) cars.splice(i, 1);
  }
  if ((G.spawnT -= dt) <= 0) {
    G.spawnT = 0.3;
    const want = PATROL + (G.wanted ? 1 + G.wanted * 1.4 | 0 : 0);
    if (cars.filter(c => c.kind === 'police').length < want) spawn('police', G.wanted ? 180 : 250, G.wanted ? 350 : 500);
    else if (cars.filter(c => c.kind === 'traffic').length < TRAFFIC) spawn('traffic', 120, 450);
  }
  updateJob(dt);
}
function seenBy(police) {
  return police.some(p => dist(p.x, p.y, player.x, player.y) < 85 && los(p.x, p.y, player.x, player.y));
}

// ---------- rendering
const TILE = 128, RES = 8, tiles = new Map();
const COL = { pave: '#9d988c', curb: '#6f6b63', road: '#3d3f44', path: '#b8b2a3', mark: '#e9e4d2',
  grass: '#4f7f3a', pitch: '#3f8f4a', play: '#c9b27a', water: '#2f5f8f', void: '#15171a' };
function makeTile(i, j) {
  const c = document.createElement('canvas'); c.width = c.height = TILE * RES;
  const g = c.getContext('2d'), x0 = i * TILE, y0 = j * TILE, x1 = x0 + TILE, y1 = y0 + TILE;
  const inT = bb => bb[2] >= x0 - 20 && bb[0] <= x1 + 20 && bb[3] >= y0 - 20 && bb[1] <= y1 + 20;
  g.fillStyle = COL.void; g.fillRect(0, 0, c.width, c.height);
  g.setTransform(RES, 0, 0, RES, -x0 * RES, -y0 * RES);
  g.fillStyle = COL.pave; g.fillRect(0, 0, W, H);
  for (const a of M.green) if (inT(a.bb)) { g.fillStyle = COL[a.k]; trace(g, a.p, 1); g.fill(); }
  g.fillStyle = COL.water; for (const w of WATER) if (inT(w.bb)) { trace(g, w.p, 1); g.fill(); }
  g.lineCap = g.lineJoin = 'round';
  const roads = M.roads.filter(r => inT(r.bb));
  g.strokeStyle = COL.path; for (const r of roads) if (!r.car) { g.lineWidth = r.w; trace(g, r.p); g.stroke(); }
  g.strokeStyle = COL.curb; for (const r of roads) if (r.car) { g.lineWidth = r.w + 1; trace(g, r.p); g.stroke(); }
  g.strokeStyle = COL.road; for (const r of roads) if (r.car) { g.lineWidth = r.w; trace(g, r.p); g.stroke(); }
  g.strokeStyle = COL.mark; g.lineWidth = 0.25; g.setLineDash([3, 4]);
  for (const r of roads) if (r.w >= 12) { trace(g, r.p); g.stroke(); }
  return c;
}
function tile(i, j) {
  const k = i + ',' + j; let t = tiles.get(k);
  if (t) { tiles.delete(k); tiles.set(k, t); return t; }
  if (tile.budget-- <= 0) return null; // shortcut: max 2 new tiles per frame, rest pops in a frame later
  t = makeTile(i, j); tiles.set(k, t);
  if (tiles.size > 40) tiles.delete(tiles.keys().next().value);
  return t;
}
const CAMH = 200; // virtual camera height for the leaning-building effect
function drawBuildings() {
  const hw = VW / 2 / S, hh = VH / 2 / S, cx = VW / 2, cy = VH / 2;
  const vis = M.buildings.filter(b => b.bb[2] > camX - hw && b.bb[0] < camX + hw && b.bb[3] > camY - hh && b.bb[1] < camY + hh);
  vis.sort((a, b) => dist(b.cx, b.cy, camX, camY) - dist(a.cx, a.cy, camX, camY));
  ctx.lineJoin = 'round';
  for (const b of vis) {
    const p = b.p, k = p.length / 2, f = CAMH / (CAMH - Math.min(b.h, 80));
    const gx = [], gy = [], rx = [], ry = [];
    for (let i = 0; i < k; i++) {
      const dx = (p[2 * i] - camX) * S, dy = (p[2 * i + 1] - camY) * S;
      gx.push(cx + dx); gy.push(cy + dy); rx.push(cx + dx * f); ry.push(cy + dy * f);
    }
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      const area = (gx[i] * gy[j] - gx[j] * gy[i]) + (gx[j] * ry[j] - rx[j] * gy[j]) + (rx[j] * ry[i] - rx[i] * ry[j]) + (rx[i] * gy[i] - gx[i] * ry[i]);
      if (Math.sign(area) !== b.ws) continue; // wall faces away from the camera
      ctx.fillStyle = b.wall[i];
      ctx.beginPath(); ctx.moveTo(gx[i], gy[i]); ctx.lineTo(gx[j], gy[j]); ctx.lineTo(rx[j], ry[j]); ctx.lineTo(rx[i], ry[i]); ctx.fill();
    }
    ctx.beginPath(); ctx.moveTo(rx[0], ry[0]); for (let i = 1; i < k; i++) ctx.lineTo(rx[i], ry[i]); ctx.closePath();
    ctx.fillStyle = b.roof; ctx.fill(); ctx.strokeStyle = b.edge; ctx.lineWidth = DPR; ctx.stroke();
  }
}
function drawCar(c) {
  ctx.setTransform(S, 0, 0, S, VW / 2 + (c.x - camX) * S, VH / 2 + (c.y - camY) * S); ctx.rotate(c.a);
  ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(-2.1, -0.8, 4.7, 2.1);
  ctx.fillStyle = c.color; ctx.beginPath(); ctx.roundRect(-2.3, -1, 4.6, 2, 0.5); ctx.fill();
  ctx.fillStyle = '#1d2633'; ctx.fillRect(0.4, -0.8, 0.9, 1.6); ctx.fillRect(-1.7, -0.75, 0.6, 1.5);
  ctx.fillStyle = 'rgba(0,0,0,.15)'; ctx.fillRect(-1.1, -0.8, 1.5, 1.6);
  ctx.fillStyle = '#fff6c8'; ctx.fillRect(2.05, -0.85, 0.25, 0.45); ctx.fillRect(2.05, 0.4, 0.25, 0.45);
  if (c.kind === 'police') {
    ctx.fillStyle = '#1f4fa3'; ctx.fillRect(-2.3, -0.2, 4.6, 0.4);
    const on = c.chase && (G.time * 6 | 0) % 2;
    ctx.fillStyle = c.chase ? (on ? '#ff2a2a' : '#4466ff') : '#888'; ctx.fillRect(-0.6, -0.8, 0.45, 0.8);
    ctx.fillStyle = c.chase ? (on ? '#4466ff' : '#ff2a2a') : '#888'; ctx.fillRect(-0.6, 0, 0.45, 0.8);
  }
  if (c === player && G.job && G.job.stage === 'deliver') {
    ctx.fillStyle = '#b07a35'; ctx.fillRect(-1.2, -0.7, 1.4, 1.4);
    ctx.fillStyle = G.job.f.col;
    for (const [x, y] of [[-0.85, -0.35], [-0.35, -0.35], [-0.85, 0.35], [-0.35, 0.35]]) { ctx.beginPath(); ctx.arc(x, y, 0.28, 0, 7); ctx.fill(); }
  }
}
function drawTarget(t, color, label) {
  const sx = VW / 2 + (t.x - camX) * S, sy = VH / 2 + (t.y - camY) * S, m = 40 * DPR;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (sx > m && sx < VW - m && sy > m && sy < VH - m) {
    const r = (5 + Math.sin(G.time * 5)) * S;
    ctx.strokeStyle = color; ctx.lineWidth = 4 * DPR; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.stroke();
    return;
  }
  const a = Math.atan2(sy - VH / 2, sx - VW / 2), ex = VW / 2 - m, ey = VH / 2 - m;
  const sc = Math.min(ex / Math.abs(Math.cos(a)), ey / Math.abs(Math.sin(a)));
  ctx.translate(VW / 2 + Math.cos(a) * sc, VH / 2 + Math.sin(a) * sc);
  ctx.font = `bold ${12 * DPR}px ui-monospace, Menlo, monospace`; ctx.textAlign = 'center';
  ctx.fillStyle = '#000'; ctx.fillText(label, 1.5 * DPR, -18 * DPR + 1.5 * DPR); ctx.fillStyle = color; ctx.fillText(label, 0, -18 * DPR);
  ctx.rotate(a); ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 2 * DPR;
  ctx.beginPath(); ctx.moveTo(14 * DPR, 0); ctx.lineTo(-8 * DPR, -10 * DPR); ctx.lineTo(-8 * DPR, 10 * DPR); ctx.closePath(); ctx.fill(); ctx.stroke();
}
function render() {
  const sp = Math.abs(speedOf(player));
  zoom += (7 - clamp(sp / 30, 0, 1) * 3 - zoom) * 0.03; S = zoom * DPR;
  camX += (player.x + player.vx * 0.8 - camX) * 0.1; camY += (player.y + player.vy * 0.8 - camY) * 0.1;
  const shX = rnd(-1, 1) * G.shake / S, shY = rnd(-1, 1) * G.shake / S;
  camX += shX; camY += shY;

  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = COL.void; ctx.fillRect(0, 0, VW, VH);
  const hw = VW / 2 / S, hh = VH / 2 / S; tile.budget = 2;
  for (let i = Math.floor((camX - hw) / TILE); i <= Math.floor((camX + hw) / TILE); i++)
    for (let j = Math.floor((camY - hh) / TILE); j <= Math.floor((camY + hh) / TILE); j++) {
      const t = tile(i, j); if (t) ctx.drawImage(t, VW / 2 + (i * TILE - camX) * S, VH / 2 + (j * TILE - camY) * S, TILE * S + 1, TILE * S + 1);
    }
  // respray shop pad
  ctx.setTransform(S, 0, 0, S, VW / 2 + (shop.x - camX) * S, VH / 2 + (shop.y - camY) * S);
  ctx.fillStyle = 'rgba(214,79,160,.55)'; ctx.fillRect(-6, -6, 12, 12);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 2.2px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('SPRAY', 0, 0.8);

  for (const c of cars) if (onScreen(c.x, c.y, 5)) drawCar(c);
  ctx.setTransform(1, 0, 0, 1, 0, 0); drawBuildings();

  const j = G.job;
  if (j && j.stage === 'pickup') drawTarget(j.pickup, '#ffd23f', `PICKUP ${Math.round(dist(player.x, player.y, j.pickup.x, j.pickup.y))} m`);
  if (j && j.stage === 'deliver') drawTarget(j.drop, '#9bd32d', `DROP ${Math.round(dist(player.x, player.y, j.drop.x, j.drop.y))} m`);
  if (G.wanted > 0) drawTarget(shop, '#d64fa0', 'SPRAY');
  camX -= shX; camY -= shY;

  if (G.bannerT > 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.textAlign = 'center';
    ctx.font = `900 ${36 * DPR}px Impact, "Arial Black", sans-serif`;
    ctx.fillStyle = '#000'; ctx.fillText(G.banner, VW / 2 + 3 * DPR, VH * 0.3 + 3 * DPR);
    ctx.fillStyle = G.banner.startsWith('BUSTED') ? '#ff3b3b' : '#ffd23f'; ctx.fillText(G.banner, VW / 2, VH * 0.3);
  }
}
let hudT = 0;
function hud() {
  $('money').textContent = '€' + G.money;
  $('stars').innerHTML = [1, 2, 3, 4, 5].map(i => `<span class="${i <= G.wanted ? '' : 'off'}">★</span>`).join('');
  $('speed').textContent = Math.round(Math.abs(speedOf(player)) * 3.6) + ' km/h';
  const j = G.job;
  $('goal').textContent = !j ? 'Waiting for messages…' : j.stage === 'offer' ? 'New request! [Y] / [N]' : j.stage === 'pickup' ? '→ Pick up at ' + j.pickup.name : '→ Deliver to ' + j.drop.name;
  $('cargo').style.display = j && j.stage === 'deliver' ? 'block' : 'none';
  if (j && j.stage === 'deliver') {
    $('fruit').textContent = `${j.f.e} ${j.q}× ${j.f.n} · ripeness`;
    const bar = $('bar').firstChild; bar.style.width = j.ripe * 100 + '%';
    bar.style.background = j.ripe < 0.6 ? '#9bd32d' : j.ripe < 0.85 ? '#e0a030' : '#7a4a20';
  }
}

// ---------- loop
addEventListener('keydown', e => {
  keys[e.code] = true;
  const k = e.key.toLowerCase(); if (k === 'y' || k === 'n') G.answer = k; // by character: QWERTZ swaps Y/Z
  if (e.code === 'Enter' && !G.started) { G.started = true; $('start').remove(); msg(FRED, 'welcome to the business 🍍 phone stays on. clients text u directly.'); }
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let last = performance.now(), acc = 0;
function frame(t) {
  acc += Math.min(0.1, (t - last) / 1000); last = t;
  if (G.started) while (acc >= DT) { update(DT); acc -= DT; } else acc = 0;
  render();
  if ((hudT += 1) % 6 === 0) hud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
