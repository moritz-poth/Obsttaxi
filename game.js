'use strict';
// Obst-Taxi: isometric fruit delivery on the real OSM street map of Kreuzberg 36.
// World units are metres, x east, y south, origin at the north-west corner of the map.
const M = window.MAP, W = M.w, H = M.h;
const $ = id => document.getElementById(id);
const rnd = (a, b) => a + Math.random() * (b - a), pick = a => a[Math.random() * a.length | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));


// ---------- map prep
const bbox = p => { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i]); c = Math.max(c, p[i]); b = Math.min(b, p[i + 1]); d = Math.max(d, p[i + 1]); } return [a, b, c, d]; };
const trace = (g, p, close) => { g.beginPath(); g.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]); if (close) g.closePath(); };
const CAR_ROADS = new Set(['primary', 'secondary', 'secondary_link', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
M.roads.forEach(r => { r.bb = bbox(r.p); r.car = CAR_ROADS.has(r.t); });
M.rails.forEach(r => r.bb = bbox(r.p));
M.green.forEach(g => g.bb = bbox(g.p));
const WATER = M.water.map(p => ({ p, bb: bbox(p) }));
const hash = n => { n = Math.sin(n * 127.1) * 43758.5453; return n - Math.floor(n); };
M.buildings.forEach((b, n) => {
  const p = b.p; b.bb = bbox(p); b.n = n;
  let area = 0, cx = 0, cy = 0; const k = p.length / 2;
  for (let i = 0; i < k; i++) { const j = (i + 1) % k; area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; cx += p[2 * i]; cy += p[2 * i + 1]; }
  b.cx = cx / k; b.cy = cy / k; b.ws = Math.sign(area);
  b.h += (hash(n + 11) - 0.5) * 1.6; // eaves never line up perfectly
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

// ---------- road graph: M.adj is undirected (police with sirens may go anywhere), rules live on the edges
const N = M.nodes.length / 2, NX = i => M.nodes[2 * i], NY = i => M.nodes[2 * i + 1];
M.adj = Array.from({ length: N }, () => []);
const EDGES = [], WRONGWAY = new Set(), CLOSED = new Set(), EGRID = new Map(), EG = 20;
const EMAP = new Map();
for (let i = 0; i < M.edges.length; i += 8) {
  const [a, b, lim, ow, w, lf, lb, pk] = M.edges.slice(i, i + 8);
  if (!M.adj[a].includes(b)) { M.adj[a].push(b); M.adj[b].push(a); }
  if (ow) WRONGWAY.add(b + ',' + a);
  const e = { a, b, lim, ow, w, lf, lb, pk }; EDGES.push(e); EMAP.set(a < b ? a + ',' + b : b + ',' + a, e);
  const n = Math.ceil(dist(NX(a), NY(a), NX(b), NY(b)) / 5);
  for (let s = 0; s <= n; s++) {
    const k = ((NX(a) + (NX(b) - NX(a)) * s / n) / EG | 0) + ',' + ((NY(a) + (NY(b) - NY(a)) * s / n) / EG | 0);
    if (!EGRID.has(k)) EGRID.set(k, new Set()); EGRID.get(k).add(e);
  }
}
const ekey = (a, b) => a < b ? a + ',' + b : b + ',' + a;
const legal = (a, b) => !WRONGWAY.has(a + ',' + b) && !CLOSED.has(ekey(a, b));
function nearestEdge(x, y, maxD) { // -> { e, d } closest road centre line within maxD metres
  let best = null, bd = maxD;
  const gx = x / EG | 0, gy = y / EG | 0;
  for (let i = gx - 1; i <= gx + 1; i++) for (let j = gy - 1; j <= gy + 1; j++) for (const e of EGRID.get(i + ',' + j) || []) {
    const ax = NX(e.a), ay = NY(e.a), dx = NX(e.b) - ax, dy = NY(e.b) - ay, l2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / l2, 0, 1), d = dist(x, y, ax + dx * t, ay + dy * t);
    if (d < bd) { bd = d; best = e; }
  }
  return best && { e: best, d: bd };
}

// traffic lights: OSM signal nodes within 35 m form one junction sharing a 40 s cycle.
// Axis A (along the junction's main road) is green 0-16 s, amber 16-19, then axis B gets the same 20 s later.
const SIG = new Map(), JUNCS = [];
for (const n of M.signals) {
  let j = JUNCS.find(j => j.nodes.some(m => dist(NX(m), NY(m), NX(n), NY(n)) < 35));
  if (!j) { const nb = M.adj[n][0] ?? n; j = { nodes: [], off: rnd(0, 40), th: Math.atan2(NY(nb) - NY(n), NX(nb) - NX(n)) }; JUNCS.push(j); }
  j.nodes.push(n); SIG.set(n, j);
}
function light(j, heading) { // 'g' | 'y' | 'r', plus seconds since it turned red
  const axisA = Math.abs(Math.cos(heading - j.th)) > Math.SQRT1_2;
  const t = ((G.time + j.off) % 40 + (axisA ? 0 : 20)) % 40;
  return t < 16 ? ['g', 0] : t < 19 ? ['y', 0] : ['r', t - 19];
}

// crime areas (Kriminalitätsatlas Berlin): which Bezirksregion is (x,y) in
function inPoly(p, x, y) {
  let c = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2)
    if ((p[i + 1] > y) !== (p[j + 1] > y) && x < (p[j] - p[i]) * (y - p[i + 1]) / (p[j + 1] - p[i + 1]) + p[i]) c = !c;
  return c;
}
const AVG_AREA = { n: 'Berlin', all: 1, drugs: 1 };
const areaAt = (x, y) => M.areas.find(a => a.p.some(p => inPoly(p, x, y))) || AVG_AREA;
console.assert(inPoly([0, 0, 10, 0, 10, 10, 0, 10], 5, 5) && !inPoly([0, 0, 10, 0, 10, 10, 0, 10], 15, 5), 'inPoly');

// ---------- parked cars along the kerbs: Berlin side streets are lined nose to tail on both sides.
// Static: baked into the ground tiles and stamped into the collision mask (value 3, doesn't block line of sight).
const NOPARK = new Set(), noPark = (x, y, r) => { for (let i = -r; i <= r; i += 4) for (let j = -r; j <= r; j += 4) NOPARK.add(((x + i) / 4 | 0) + ',' + ((y + j) / 4 | 0)); };
for (let n = 0; n < N; n++) if (M.adj[n].length >= 3) noPark(NX(n), NY(n), 12);
for (const n of M.signals) noPark(NX(n), NY(n), 10);
for (let i = 0; i < M.crossings.length; i += 2) noPark(NX(M.crossings[i]), NY(M.crossings[i]), 6);
for (let i = 0; i < M.stops.length; i += 2) noPark(M.stops[i], M.stops[i + 1], 12);
noPark(894, 928, 30); noPark(1930, 780, 20); // start (Kotti) and the respray shop
const PARKED = [], PGRID = new Map(); // x, y, angle, colour seed
for (const r of M.roads) {
  if (!r.pk || !(r.pk[0] || r.pk[1])) continue;
  const p = r.p, off = r.w / 2 - 1.15;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1], L = Math.hypot(dx, dy); if (L < 9) continue;
    const ux = dx / L, uy = dy / L, a = Math.atan2(dy, dx);
    for (const side of [-1, 1]) if (r.pk[side < 0 ? 0 : 1]) for (let d = 3.2; d < L - 3.2; d += 5.3 + hash(i * 7 + d) * 1.4) {
      const x = p[i] + ux * d - uy * off * side, y = p[i + 1] + uy * d + ux * off * side, seed = x * 13.1 + y * 7.7;
      if (hash(seed) < 0.12 || NOPARK.has((x / 4 | 0) + ',' + (y / 4 | 0))) continue;
      if (cell(x, y) || cell(x + ux * 2.3, y + uy * 2.3) || cell(x - ux * 2.3, y - uy * 2.3) || nearestEdge(x, y, off - 0.6)) continue;
      const k = PARKED.length; PARKED.push(x, y, a + (side > 0 ? 0 : Math.PI), hash(seed + 2));
      const t = (x / 64 | 0) + ',' + (y / 64 | 0); if (!PGRID.has(t)) PGRID.set(t, []); PGRID.get(t).push(k);
    }
  }
}
for (let k = 0; k < PARKED.length; k += 4) {
  const [x, y, a] = PARKED.slice(k, k + 3), c = Math.cos(a), s = Math.sin(a);
  for (let l = -2.2; l <= 2.2; l += 0.5) for (let w = -0.9; w <= 0.9; w += 0.45) {
    const px = x + c * l - s * w | 0, py = y + s * l + c * w | 0;
    if (px >= 0 && py >= 0 && px < W && py < H && !mask[py * W + px]) mask[py * W + px] = 3;
  }
}
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
// main roads (50 km/h or wide) carry most of the traffic
const BIG = MAIN.filter(n => M.adj[n].some(m => { const e = EMAP.get(ekey(n, m)); return e && (e.lim >= 50 || e.w >= 13); }));
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
    for (const v of M.adj[u]) { if (CLOSED.has(ekey(u, v))) continue; const nd = du + dist(NX(u), NY(u), NX(v), NY(v)); if (nd < d[v]) { d[v] = nd; push([nd, v]); } }
  }
  return d;
}
const place = n => ({ x: NX(n), y: NY(n), name: M.names[M.nodeName[n]] || 'a backyard' });
function randNode(x, y, minR, maxR, offscreen, pool = MAIN) {
  for (let t = 0; t < 200; t++) {
    const n = pick(pool), d = dist(x, y, NX(n), NY(n));
    if (d < minR || d > maxR || (offscreen && onScreen(NX(n), NY(n), 25))) continue;
    if (!offscreen && (M.nodeName[n] < 0 || NX(n) < 80 || NY(n) < 80 || NX(n) > W - 80 || NY(n) > H - 80)) continue;
    return n;
  }
  return -1;
}

// ---------- vehicles
const SPEC = {
  player: { acc: 11, brake: 24, drag: 0.35, turn: 2.8 },
  traffic: { acc: 6, brake: 18, drag: 0.5, turn: 2.6 },
  police: { acc: 12.5, brake: 24, drag: 0.35, turn: 2.9 },
  bike: { acc: 2.2, brake: 6, drag: 0.6, turn: 3.4 },
};
const CORNERS = [[2.3, 1], [2.3, -1], [-2.3, 1], [-2.3, -1], [0, 1], [0, -1], [2.3, 0]], BIKE_PTS = [[0.9, 0], [-0.9, 0], [0, 0.3], [0, -0.3]];
// shortcut: the mask is 1 m coarse, so parked cars (cell 3) poke up to 1 m into the lane; AI vehicles keep to their
// lanes and ignore them (ai = true), only the player bumps into them. A finer parked-car mask would fix this properly.
function hits(x, y, a, pts = CORNERS, ai = false) {
  const c = Math.cos(a), s = Math.sin(a);
  for (const [l, w] of pts) { const v = cell(x + c * l - s * w, y + s * l + c * w); if (v && !(ai && v === 3)) return true; }
  return false;
}
const speedOf = c => c.vx * Math.cos(c.a) + c.vy * Math.sin(c.a);
function physics(c, thr, steer, hb, dt) {
  const P = SPEC[c.kind] || SPEC.traffic, fx = Math.cos(c.a), fy = Math.sin(c.a), pts = c.kind === 'bike' ? BIKE_PTS : CORNERS, ai = c !== player;
  let fwd = c.vx * fx + c.vy * fy, lat = -c.vx * fy + c.vy * fx;
  if (thr > 0) fwd += (fwd < -0.5 ? P.brake : P.acc) * thr * dt;
  else if (thr < 0) fwd -= (fwd > 0.5 ? P.brake : P.acc * 0.6) * -thr * dt;
  else fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 3 * dt);
  fwd -= fwd * P.drag * dt;
  if (hb) fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 7 * dt);
  lat *= Math.exp(-(hb ? 1.2 : 10) * dt);
  c.braking = (thr < 0 && fwd > 0.5) || hb;
  const na = c.a + steer * P.turn * clamp(fwd / 5, -1, 1) / (1 + Math.abs(fwd) / 30) * (hb ? 1.4 : 1) * dt;
  c.vx = fwd * fx - lat * fy; c.vy = fwd * fy + lat * fx;
  let impact = 0;
  const nx = c.x + c.vx * dt; if (hits(nx, c.y, na, pts, ai)) { impact += Math.abs(c.vx); c.vx *= -0.3; } else c.x = nx;
  const ny = c.y + c.vy * dt; if (hits(c.x, ny, na, pts, ai)) { impact += Math.abs(c.vy); c.vy *= -0.3; } else c.y = ny;
  if (!hits(c.x, c.y, na, pts, ai)) c.a = na;
  return impact;
}
// AI: head for (tx,ty) at about vt m/s; back up for a moment when stuck against something
function drive(c, tx, ty, vt, dt) {
  const da = angDiff(Math.atan2(ty - c.y, tx - c.x), c.a), sp = speedOf(c);
  if (c.rev > 0) { c.rev -= dt; return physics(c, -1, -Math.sign(da), false, dt); }
  const thr = vt < 0.3 ? (sp > 0.6 ? -1 : 0) : sp < vt - 0.5 ? 1 : sp > vt + 1.5 ? -1 : sp > vt ? 0 : 0.3;
  c.stuck = thr > 0 && sp < 0.5 ? (c.stuck || 0) + dt : 0;
  if (c.stuck > 1.5) { c.rev = 0.9; c.stuck = 0; }
  return physics(c, thr, clamp(da * 2.5, -1, 1), false, dt);
}
// what's actually parked in Berlin: mostly black, grey, silver and white
const PAINT = ['#202224', '#2b2b2b', '#3c3f44', '#55595e', '#8c9298', '#b9bec3', '#d9dcde', '#eeeeec', '#f6f6f4', '#1f3554', '#2e5c9a',
  '#6b1f1f', '#a8322a', '#2e4a3a', '#7a6a52', '#c9b48a', '#d9a21b'];
function makeCar(kind, from, to) {
  const c = { kind, police: kind === 'police', x: NX(from), y: NY(from), a: Math.atan2(NY(to) - NY(from), NX(to) - NX(from)), vx: 0, vy: 0,
    from, to, next: null, stuck: 0, rev: 0, chase: false, busy: kind === 'police' && Math.random() < 0.25, shift: 0, shiftT: 0, waitT: 0, yieldT: 0,
    lane: Math.random() < 0.6 ? 0 : Math.random() < 0.7 ? 1 : 2, color: kind === 'police' ? '#e2e6ec' : pick(PAINT) };
  if (kind === 'bike') { c.lane = 0; c.vmax = rnd(4, 6.5); c.rebel = Math.random() < 0.3; c.ph = 0; c.color = pick(CLOTHES); c.hair = pick(HAIR); }
  return c;
}
// lane centre, metres right of the centre line. k = 0 is the rightmost lane.
function laneOffset(e, fwd, k) {
  const mine = fwd ? e.lf : e.lb, other = fwd ? e.lb : e.lf, n = mine + other;
  const lw = Math.min(3.3, (e.w - 2.3 * e.pk) / n); // parked cars take 2.3 m per strip
  k = Math.min(k, mine - 1);
  return other ? (mine - 0.5 - k) * lw : ((mine - 1) / 2 - k) * lw;
}
console.assert(laneOffset({ lf: 1, lb: 1, w: 11, pk: 2 }, true, 0) > 1.5 && laneOffset({ lf: 1, lb: 0, w: 11, pk: 2 }, true, 0) === 0, 'laneOffset');
console.assert(laneOffset({ lf: 2, lb: 0, w: 15, pk: 0 }, true, 0) > 0 && laneOffset({ lf: 2, lb: 0, w: 15, pk: 0 }, true, 1) < 0, 'laneOffset oneway 2 lanes');
// the lane centre line from node a to node b for vehicle c: start point, direction, length.
// Bikes ride near the kerb; c.shift moves a car sideways (overtaking, making room for a siren)
function laneSeg(a, b, c) {
  const ax = NX(a), ay = NY(a), dx = NX(b) - ax, dy = NY(b) - ay, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L;
  const e = EMAP.get(ekey(a, b));
  let off = e ? laneOffset(e, e.a === a, c.lane) : 1.6;
  if (c.kind === 'bike' && e) off = Math.max(off, (e.w - 2.3 * e.pk) / 2 - 0.9);
  off += c.shift;
  return { x: ax - uy * off, y: ay + ux * off, ux, uy, L };
}
const isMain = e => !!e && (e.lim >= 50 || e.w >= 13);
function chooseNext(c) { // mostly straight on, main roads pull traffic, dead ends turn round
  const ux = NX(c.to) - NX(c.from), uy = NY(c.to) - NY(c.from), l = Math.hypot(ux, uy) || 1;
  const opts = M.adj[c.to].filter(n => n !== c.from && legal(c.to, n));
  if (!opts.length) return c.from;
  let tot = 0;
  const w = opts.map(n => {
    const dx = NX(n) - NX(c.to), dy = NY(n) - NY(c.to);
    const v = 0.25 + Math.max(0, (dx * ux + dy * uy) / (l * (Math.hypot(dx, dy) || 1))) * 1.5 + (isMain(EMAP.get(ekey(c.to, n))) ? 0.8 : 0);
    tot += v; return v;
  });
  let r = Math.random() * tot;
  for (let i = 0; i < opts.length; i++) if ((r -= w[i]) <= 0) return opts[i];
  return opts[0];
}
function reanchor(c) { // back on the road network after a chase or being pushed far off
  c.to = nearestNode(c.x, c.y);
  const back = M.adj[c.to].filter(n => legal(n, c.to));
  c.from = back.length ? back.reduce((b, n) => Math.cos(Math.atan2(NY(c.to) - NY(n), NX(c.to) - NX(n)) - c.a) > Math.cos(Math.atan2(NY(c.to) - NY(b), NX(c.to) - NX(b)) - c.a) ? n : b) : M.adj[c.to][0];
  c.next = null; c.shift = 0;
}
// normal traffic (and police on patrol): follow the lane, keep distance, stop at red, give way, sort out jams
function updateTraffic(c, dt) {
  if (c.abandoned) { physics(c, speedOf(c) > 0.6 ? -1 : 0, 0, true, dt); return; }
  if (c.fall > 0) { c.fall -= dt; physics(c, 0, 0, true, dt); return; }
  let s = laneSeg(c.from, c.to, c), along = (c.x - s.x) * s.ux + (c.y - s.y) * s.uy;
  if (Math.abs((c.x - s.x) * -s.uy + (c.y - s.y) * s.ux) > 25 || along < -25 || along > s.L + 25) { reanchor(c); s = laneSeg(c.from, c.to, c); along = (c.x - s.x) * s.ux + (c.y - s.y) * s.uy; }
  if (c.next == null) c.next = chooseNext(c);
  if (along > s.L - 2) {
    c.from = c.to; c.to = c.next; c.next = chooseNext(c);
    s = laneSeg(c.from, c.to, c); along = (c.x - s.x) * s.ux + (c.y - s.y) * s.uy;
  }
  const sp = speedOf(c), toEnd = s.L - along, nx = laneSeg(c.to, c.next, c), bike = c.kind === 'bike';
  // pure pursuit: aim at a point on the lane line a little ahead, round into the next road
  let rem = Math.max(0, along) + (bike ? 2.5 : 4) + Math.abs(sp) * 0.5, tx, ty;
  if (rem <= s.L) { tx = s.x + s.ux * rem; ty = s.y + s.uy * rem; } else { rem = Math.min(rem - s.L, nx.L); tx = nx.x + nx.ux * rem; ty = nx.y + nx.uy * rem; }
  const e = EMAP.get(ekey(c.from, c.to));
  let vt = bike ? c.vmax : (e ? e.lim : 50) / 3.6 * 0.95;
  const turn = Math.acos(clamp(s.ux * nx.ux + s.uy * nx.uy, -1, 1));
  if (turn > 0.35) vt = Math.min(vt, 3 + 8 * (1 - turn / Math.PI) + Math.max(0, toEnd - 8) * 0.5);
  // traffic lights: stop 6 m before the signal node; amber only if there's room to stop
  const j = SIG.get(c.to);
  if (j && toEnd < 5) c.lastJ = j; // inside this junction: never stop again mid-crossing
  let red = false;
  if (j && j !== c.lastJ && !c.rebel) {
    const [st] = light(j, Math.atan2(s.uy, s.ux));
    if (st === 'r' || (st === 'y' && toEnd > sp * 1.2 + 6)) { red = toEnd < 40; vt = Math.min(vt, Math.max(0, (toEnd - 6) * 0.7)); }
  }
  // whatever is in my path: keep a gap, match its speed
  const fx = Math.cos(c.a), fy = Math.sin(c.a), wide = bike ? 0.8 : 1.5, mine = bike ? 0.9 : 2.3;
  let gap = Infinity, lead = null;
  for (const o of cars) {
    if (o === c || Math.abs(o.x - c.x) > 32 || Math.abs(o.y - c.y) > 32) continue;
    const dx = o.x - c.x, dy = o.y - c.y, fwd = dx * fx + dy * fy;
    if (fwd <= 0) continue;
    const small = o.kind === 'bike' || o.kind === 'foot', lat = Math.abs(dy * fx - dx * fy), cs = Math.cos(o.a - c.a);
    // oncoming traffic only counts when it is really in my lane (narrow streets: both squeeze right)
    if (lat > (cs < -0.5 && !small ? 1.1 : wide + (small ? 0.4 : 0.8))) { if (cs < -0.5 && lat < 2.6 && fwd < 15) { c.shift = Math.max(c.shift, 0.6); c.shiftT = 1; } continue; }
    if (c.yieldT > 0 && cs < 0.5) continue; // deadlock breaker: push through crossing and oncoming traffic
    const g = fwd - mine - (small ? 0.6 : 2.3);
    if (g < gap) { gap = g; lead = o; }
  }
  for (const b of buses) if (!b.train && Math.abs(b.x - c.x) < 40 && Math.abs(b.y - c.y) < 40) {
    const dx = b.x - c.x, dy = b.y - c.y, fwd = dx * fx + dy * fy;
    if (fwd > 0 && Math.abs(dy * fx - dx * fy) < wide + 1.2 && fwd - mine - b.len / 2 < gap) { gap = fwd - mine - b.len / 2; lead = b; }
  }
  for (const pd of peds) if (!pd.fall && Math.abs(pd.x - c.x) < 14 && Math.abs(pd.y - c.y) < 14) {
    const dx = pd.x - c.x, dy = pd.y - c.y, fwd = dx * fx + dy * fy;
    if (fwd > 0 && Math.abs(dy * fx - dx * fy) < wide) gap = Math.min(gap, fwd - mine - 0.5);
  }
  if (gap < 35) {
    const lv = lead ? Math.max(0, (lead.vx || 0) * fx + (lead.vy || 0) * fy) : 0;
    vt = Math.min(vt, Math.max(0, gap - 1.5) * 0.8 + lv * 0.6);
  }
  // give way at junctions without lights: main road first, otherwise rechts vor links (§8 StVO)
  if (!j && c.yieldT <= 0 && toEnd < 14 && toEnd > 2.5 && M.adj[c.to].length >= 3) {
    const jx = NX(c.to), jy = NY(c.to), main = isMain(e);
    for (const o of cars) {
      if (o === c || o.kind === 'foot' || o.abandoned || Math.abs(o.x - jx) > 18 || Math.abs(o.y - jy) > 18) continue;
      const dO = dist(o.x, o.y, jx, jy);
      if (dO > 18 || dO < 3 || o.vx * (jx - o.x) + o.vy * (jy - o.y) <= 0.5 * dO) continue; // not heading for the junction
      const rel = Math.abs(angDiff(o.a, c.a));
      if (rel < 0.5 || rel > 2.6) continue; // same direction or oncoming
      const theirs = isMain(o.from != null && EMAP.get(ekey(o.from, o.to))), right = (o.x - c.x) * -fy + (o.y - c.y) * fx > 0;
      if ((theirs && !main) || (theirs === main && right)) { vt = Math.min(vt, Math.max(0, (toEnd - 5) * 0.8)); break; }
    }
  }
  // make room for blue lights coming up behind
  for (const p of G.sirens) {
    if (p === c) continue;
    const dx = c.x - p.x, dy = c.y - p.y;
    if (dx * dx + dy * dy < 900 && dx * Math.cos(p.a) + dy * Math.sin(p.a) > 0 && Math.cos(p.a - c.a) > 0.5) { c.shift = bike ? 0.3 : 1.8; c.shiftT = 2; vt = Math.min(vt, 3); }
  }
  // jams: queue behind red lights; anything else that blocks for long gets pushed through or driven round
  c.queue = red || (!!lead && gap < 8 && !!lead.queue && Math.cos(lead.a - c.a) > 0.7);
  c.waitT = vt < 0.4 && !c.queue ? c.waitT + dt : Math.max(0, c.waitT - dt * 2);
  c.yieldT -= dt;
  if (c.waitT > 5 && c.yieldT < -3) c.yieldT = 2.5;
  if (c.waitT > 8 && lead && !lead.len && !lead.queue && Math.abs(speedOf(lead)) < 0.3) { c.shift = bike ? -1.2 : -3; c.shiftT = 6; c.waitT = 0; }
  if ((c.shiftT -= dt) <= 0) c.shift *= 1 - Math.min(1, dt * 0.8);
  drive(c, tx, ty, vt, dt);
  if (bike) c.ph += Math.abs(sp) * dt * 2;
}
// ---------- live data: VIZ Berlin roadworks, BVG vehicles (both CORS-enabled, game runs fine without them)
const LL = (lon, lat) => [(lon - M.geo.w) * M.geo.kx, (M.geo.n - lat) * M.geo.ky];
const WORKS = []; // { closed, pts:[x,y,...], bb }
const inWorks = (x, y) => WORKS.some(w => x > w.bb[0] - 12 && x < w.bb[2] + 12 && y > w.bb[1] - 12 && y < w.bb[3] + 12 && segDist(w.pts, x, y) < 10);
function segDist(p, x, y) {
  let best = Infinity;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1], l2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - p[i]) * dx + (y - p[i + 1]) * dy) / l2, 0, 1);
    best = Math.min(best, dist(x, y, p[i] + dx * t, p[i + 1] + dy * t));
  }
  return best;
}
console.assert(Math.abs(segDist([0, 0, 10, 0], 5, 3) - 3) < 1e-9, 'segDist');
const LIVE = { works: null, bvg: null };
async function loadWorks() {
  try {
    const d = await (await fetch('https://api.viz.berlin.de/daten/baustellen_sperrungen_viz.json')).json(), now = new Date();
    for (const f of d.features) {
      const p = f.properties, v = p.validity || {};
      if (!['Baustelle', 'Sperrung'].includes(p.subtype) || new Date(v.from) > now || new Date(v.to) < now) continue;
      const geoms = f.geometry.type === 'GeometryCollection' ? f.geometry.geometries : [f.geometry];
      for (const g of geoms) {
        if (g.type !== 'LineString') continue;
        const pts = g.coordinates.flatMap(([lon, lat]) => LL(lon, lat));
        const bb = bbox(pts);
        if (bb[2] < 0 || bb[3] < 0 || bb[0] > W || bb[1] > H) continue;
        WORKS.push({ closed: p.severity === 'Vollsperrung', pts, bb, street: p.street });
      }
    }
    for (const w of WORKS) if (w.closed) {
      // full closure: barrier across both ends, the stretch between is a building site (solid)
      for (const e of EDGES) if (segDist(w.pts, (NX(e.a) + NX(e.b)) / 2, (NY(e.a) + NY(e.b)) / 2) < 4) CLOSED.add(ekey(e.a, e.b));
      const p = w.pts;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const n = Math.ceil(dist(p[i], p[i + 1], p[i + 2], p[i + 3]));
        for (let s = 0; s <= n; s++) {
          const x = p[i] + (p[i + 2] - p[i]) * s / n, y = p[i + 1] + (p[i + 3] - p[i + 1]) * s / n;
          if (dist(x, y, player.x, player.y) < 15) continue; // never wall the player in
          for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) if (x + a >= 0 && y + b >= 0 && x + a < W && y + b < H) mask[(y + b | 0) * W + (x + a | 0)] = 1;
        }
      }
    }
    LIVE.works = WORKS.length; tiles.clear();
    if (WORKS.length) msg(null, `🚧 ${WORKS.length} live roadworks today: ${[...new Set(WORKS.map(w => w.street.replace(/ \(.*/, '')))].join(', ')}`);
  } catch (e) { LIVE.works = 'offline'; }
}
// BVG radar (v6.bvg.transport.rest, community API on BVG's HAFAS): real buses and U-Bahn trains, polled every 15 s.
// Buses are solid; U1/U3 run on the Hochbahn viaduct; U8 is underground and not drawn.
const buses = [], POLL = 15;
async function pollBVG() {
  try {
    const g = M.geo, u = `https://v6.bvg.transport.rest/radar?north=${g.n}&west=${g.w}&south=${g.s}&east=${g.e}&results=256&frames=0&polylines=false`;
    const d = await (await fetch(u)).json(), seen = new Set();
    for (const m of d.movements) {
      const prod = m.line.product, name = m.line.name;
      if (prod === 'subway' && !['U1', 'U3'].includes(name)) continue;
      if (!['bus', 'subway', 'suburban', 'tram'].includes(prod)) continue;
      const id = m.tripId; seen.add(id);
      let [x, y] = LL(m.location.longitude, m.location.latitude);
      const train = prod !== 'bus' && prod !== 'tram';
      let v = buses.find(b => b.id === id);
      if (!v) {
        v = { id, name, dir: m.direction, train, len: train ? 50 : prod === 'tram' ? 30 : name.startsWith('M') ? 18 : 12, x, y, a: 0, x0: x, y0: y, x1: x, y1: y, t: 1 };
        buses.push(v);
      } else { v.x0 = v.x; v.y0 = v.y; v.x1 = x; v.y1 = y; v.t = 0; }
    }
    for (let i = buses.length - 1; i >= 0; i--) if (!seen.has(buses[i].id)) buses.splice(i, 1);
    LIVE.bvg = buses.length;
  } catch (e) { LIVE.bvg = 'offline'; }
  setTimeout(pollBVG, POLL * 1000);
}
function updateBuses(dt) {
  for (const b of buses) {
    b.t = Math.min(1, b.t + dt / POLL);
    const nx = b.x0 + (b.x1 - b.x0) * b.t, ny = b.y0 + (b.y1 - b.y0) * b.t;
    if (dist(nx, ny, b.x, b.y) > 0.01) b.a = Math.atan2(ny - b.y, nx - b.x);
    b.vx = (nx - b.x) / dt; b.vy = (ny - b.y) / dt; b.x = nx; b.y = ny;
    if (b.train) continue;
    // player vs bus: push the player out of the bus rectangle
    const c = Math.cos(b.a), s = Math.sin(b.a), dx = player.x - b.x, dy = player.y - b.y;
    const lx = dx * c + dy * s, ly = -dx * s + dy * c, px = b.len / 2 + 2 - Math.abs(lx), py = 1.25 + 1.6 - Math.abs(ly);
    if (px <= 0 || py <= 0) continue;
    const [nx2, ny2, pen] = px < py ? [c * Math.sign(lx), s * Math.sign(lx), px] : [-s * Math.sign(ly), c * Math.sign(ly), py];
    if (!hits(player.x + nx2 * pen, player.y + ny2 * pen, player.a)) { player.x += nx2 * pen; player.y += ny2 * pen; }
    const rv = (player.vx - b.vx) * nx2 + (player.vy - b.vy) * ny2;
    if (rv < 0) {
      player.vx -= 1.5 * rv * nx2; player.vy -= 1.5 * rv * ny2;
      if (-rv > 3) { G.shake = Math.min(12, -rv * 1.5); offence('Crashed into a BVG bus', 35); }
    }
  }
}

// ---------- pedestrians: a walking graph over footways and both sidewalks of every street.
// Sidewalks stop short of the carriageway; a road is only crossed at a mapped crossing.
const ROADMASK = (() => { // 1 px per metre: 1 where cars drive
  const mc = document.createElement('canvas'); mc.width = W; mc.height = H;
  const m = mc.getContext('2d'); m.strokeStyle = '#fff'; m.lineCap = m.lineJoin = 'round';
  M.roads.forEach(r => { if (r.car) { m.lineWidth = r.w; trace(m, r.p); m.stroke(); } });
  const d = m.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3] > 128 ? 1 : 0;
  return out;
})();
const onRoad = (x, y) => { x |= 0; y |= 0; return x >= 0 && y >= 0 && x < W && y < H && ROADMASK[y * W + x] === 1; };
const CROSS = []; for (let i = 0; i < M.crossings.length; i += 2) CROSS.push(NX(M.crossings[i]), NY(M.crossings[i]), M.crossings[i + 1]);
const nearCrossing = (x, y, r) => { for (let i = 0; i < CROSS.length; i += 3) if (Math.abs(CROSS[i] - x) < r && Math.abs(CROSS[i + 1] - y) < r) return true; return false; };
const walkable = (x, y, cross) => { const c = cell(x, y); return c !== 1 && c !== 2 && (!onRoad(x, y) || (cross && nearCrossing(x, y, 7))); };
function offsetLine(p, d) {
  const out = [], n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = p[2 * b] - p[2 * a], dy = p[2 * b + 1] - p[2 * a + 1], l = Math.hypot(dx, dy) || 1;
    out.push(p[2 * i] - dy / l * d, p[2 * i + 1] + dx / l * d);
  }
  return out;
}
console.assert(offsetLine([0, 0, 10, 0], 2).join() === '0,2,10,2', 'offsetLine');
function densify(p, step) {
  const out = [p[0], p[1]];
  for (let i = 2; i < p.length; i += 2) {
    const ax = p[i - 2], ay = p[i - 1], n = Math.max(1, Math.ceil(dist(ax, ay, p[i], p[i + 1]) / step));
    for (let s = 1; s <= n; s++) out.push(ax + (p[i] - ax) * s / n, ay + (p[i + 1] - ay) * s / n);
  }
  return out;
}
const PN = [], PADJ = [], ZEBRA_NODES = new Set(), WALKGRID = new Map(), WG = 10;
function pnode(x, y) {
  const i = PADJ.length, k = (x / WG | 0) + ',' + (y / WG | 0);
  PN.push(x, y); PADJ.push([]);
  if (!WALKGRID.has(k)) WALKGRID.set(k, []); WALKGRID.get(k).push(i);
  return i;
}
const plink = (a, b) => { if (a !== b && !PADJ[a].includes(b)) { PADJ[a].push(b); PADJ[b].push(a); } };
function walkNear(x, y, r) {
  const out = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const n of WALKGRID.get(((x / WG | 0) + i) + ',' + ((y / WG | 0) + j)) || [])
    if (dist(x, y, PN[2 * n], PN[2 * n + 1]) < r) out.push(n);
  return out;
}
function clearWalk(ax, ay, bx, by) {
  const n = Math.ceil(dist(ax, ay, bx, by) / 0.7);
  for (let k = 1; k < n; k++) if (!walkable(ax + (bx - ax) * k / n, ay + (by - ay) * k / n, false)) return false;
  return true;
}
function walkLine(p, cross) { // a line becomes a chain of nodes; it breaks wherever it can't be walked
  const q = densify(p, 4);
  let prev = -1;
  for (let i = 0; i < q.length; i += 2) {
    if (!walkable(q[i], q[i + 1], cross) || (prev >= 0 && !walkable((q[i] + PN[2 * prev]) / 2, (q[i + 1] + PN[2 * prev + 1]) / 2, cross))) { prev = -1; continue; }
    const n = pnode(q[i], q[i + 1]);
    if (prev >= 0) plink(prev, n);
    prev = n;
  }
}
for (const r of M.roads) {
  if (!r.car && ['footway', 'path', 'pedestrian', 'steps'].includes(r.t)) walkLine(r.p, true);
  else if (r.car && r.t !== 'service' && !r.b) for (const d of [1, -1]) walkLine(offsetLine(r.p, d * (r.w / 2 + 1.9)), false);
}
for (let n = 0; n < PADJ.length; n++) if (PADJ[n].length <= 1) { // loose ends join a nearby line round the corner
  const x = PN[2 * n], y = PN[2 * n + 1];
  let best = -1, bd = 5;
  for (const m of walkNear(x, y, 5)) {
    if (m === n || PADJ[n].includes(m) || (PADJ[n][0] !== undefined && PADJ[PADJ[n][0]].includes(m))) continue;
    const d = dist(x, y, PN[2 * m], PN[2 * m + 1]);
    if (d < bd && clearWalk(x, y, PN[2 * m], PN[2 * m + 1])) { bd = d; best = m; }
  }
  if (best >= 0) plink(n, best);
}
for (let i = 0; i < CROSS.length; i += 3) { // every mapped crossing links the sidewalks on both sides
  const x = CROSS[i], y = CROSS[i + 1], r = nearestEdge(x, y, 3);
  if (!r) continue;
  const e = r.e, a = Math.atan2(NY(e.b) - NY(e.a), NX(e.b) - NX(e.a)), h = e.w / 2 + 1.9, sx = -Math.sin(a) * h, sy = Math.cos(a) * h;
  const ends = [[x + sx, y + sy], [x - sx, y - sy]].map(([px, py]) => {
    let best = -1, bd = 4.5;
    for (const m of walkNear(px, py, 4.5)) { const d = dist(px, py, PN[2 * m], PN[2 * m + 1]); if (d < bd) { bd = d; best = m; } }
    return best;
  });
  if (ends[0] < 0 || ends[1] < 0) continue;
  const mid = pnode(x, y); plink(ends[0], mid); plink(mid, ends[1]);
  if (CROSS[i + 2] === 1) ZEBRA_NODES.add(mid);
}
const ZEBRAS = []; for (let i = 0; i < CROSS.length; i += 3) if (CROSS[i + 2] === 1) ZEBRAS.push(CROSS[i], CROSS[i + 1]);
const CLOTHES = ['#1b1b1b', '#1b1b1b', '#2b2b2b', '#3a3f4a', '#5a4636', '#7a2b2b', '#2f4f6f', '#6b6b6b', '#c9b37a', '#3d5a3d', '#d8d2c4', '#a33a5a', '#e07a2e'];
const HAIR = ['#1a1a1a', '#2a1d14', '#3b2a1e', '#6b4a2e', '#c9a46a', '#8a8a8a', '#b5482a'];
const peds = [];
function addPed(n, extra) {
  if (!PADJ[n] || !PADJ[n].length) return null;
  const pd = { n0: n, n1: pick(PADJ[n]), d: 0, x: PN[2 * n], y: PN[2 * n + 1], a: 0, ox: 0, oy: 0, v: rnd(1.0, 1.6), fall: 0, flee: 0, ph: rnd(0, 6),
    col: pick(CLOTHES), hair: pick(HAIR), dog: Math.random() < 0.08, ...extra };
  peds.push(pd); return pd;
}
function spawnPed() {
  for (let t = 0; t < 20; t++) {
    const a = rnd(0, 6.28), r = rnd(40, 220), x = player.x + Math.cos(a) * r, y = player.y + Math.sin(a) * r;
    if (onScreen(x, y, 4)) continue;
    const list = WALKGRID.get((x / WG | 0) + ',' + (y / WG | 0));
    if (list && addPed(pick(list))) return;
  }
}
function pedNext(pd) { // arrived at n1: walk on, mostly straight ahead; a dead end turns them round
  const b = pd.n1, opts = PADJ[b].filter(n => n !== pd.n0);
  if (!opts.length) { pd.n1 = pd.n0; pd.n0 = b; pd.d = 0; return; }
  const hx = PN[2 * b] - PN[2 * pd.n0], hy = PN[2 * b + 1] - PN[2 * pd.n0 + 1], hl = Math.hypot(hx, hy) || 1;
  let best = opts[0], bw = -Infinity;
  for (const n of opts) {
    const dx = PN[2 * n] - PN[2 * b], dy = PN[2 * n + 1] - PN[2 * b + 1];
    const w = (dx * hx + dy * hy) / (hl * (Math.hypot(dx, dy) || 1)) + Math.random() * 1.2;
    if (w > bw) { bw = w; best = n; }
  }
  pd.n0 = b; pd.n1 = best; pd.d = 0;
}
function updatePeds(dt, police) {
  const drv = player.kind !== 'foot', sp = drv ? speedOf(player) : 0, fx = Math.cos(player.a), fy = Math.sin(player.a);
  for (let i = peds.length - 1; i >= 0; i--) {
    const pd = peds[i];
    if (dist(pd.x, pd.y, player.x, player.y) > 260 && !onScreen(pd.x, pd.y, 5)) { peds.splice(i, 1); continue; }
    if (pd.fall > 0) { pd.fall -= dt; continue; }
    pd.flee -= dt;
    const ax = PN[2 * pd.n0], ay = PN[2 * pd.n0 + 1], bx = PN[2 * pd.n1], by = PN[2 * pd.n1 + 1], L = dist(ax, ay, bx, by) || 0.01, v = pd.flee > 0 ? 3.6 : pd.v;
    pd.d += v * dt; pd.ph += v * dt * 4;
    if (pd.d >= L) { pedNext(pd); continue; }
    pd.a = Math.atan2(by - ay, bx - ax);
    const px = ax + (bx - ax) * pd.d / L, py = ay + (by - ay) * pd.d / L;
    // a car coming at you: step aside, never into the road or a wall; drift back when it's gone
    const dx = pd.x - player.x, dy = pd.y - player.y, ahead = dx * fx + dy * fy, lat = -dx * fy + dy * fx;
    let dodge = false;
    if (drv && Math.abs(sp) > 2 && ahead > 0 && ahead < 10 && Math.abs(lat) < 2.4) {
      const s = Math.sign(lat) || 1;
      for (const k of [s, -s]) {
        const tx = -fy * k * 3, ty = fx * k * 3;
        if (walkable(px + tx, py + ty, false)) { pd.ox += (tx - pd.ox) * Math.min(1, dt * 4); pd.oy += (ty - pd.oy) * Math.min(1, dt * 4); dodge = true; break; }
      }
    }
    if (!dodge) { pd.ox *= 1 - dt * 0.5; pd.oy *= 1 - dt * 0.5; }
    pd.x = px + pd.ox; pd.y = py + pd.oy;
    if (drv && Math.abs(sp) > 2.5 && dist(pd.x, pd.y, player.x, player.y) < 1.7) {
      pd.fall = 3; pd.ox += fx * 1.2; pd.oy += fy * 1.2; G.shake = 6;
      crime(seenBy(police) ? 'Hit a pedestrian' : 'Hit a pedestrian, passers-by called 110', seenBy(police) ? 2 : 1);
    }
  }
  // StVO §26: stop for anyone waiting at or on a zebra crossing
  if (drv && Math.abs(sp) > 3) for (let z = 0; z < ZEBRAS.length; z += 2) {
    if (dist(ZEBRAS[z], ZEBRAS[z + 1], player.x, player.y) > 5) continue;
    if (peds.some(pd => !pd.fall && dist(pd.x, pd.y, ZEBRAS[z], ZEBRAS[z + 1]) < 4)) offence('Ignored a pedestrian at a zebra crossing', 80, '', 0.7);
  }
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
const G = { started: false, time: 0, money: 100, wanted: 0, stop: null, known: { x: 0, y: 0, t: -99 }, rolled: {}, warned: {}, reports: [], sus: 0, limit: 50,
  area: AVG_AREA, areaT: 0, lastSeen: 0, crimeCd: 0, bustT: 0, grace: 0, tGrace: 0, downT: 0, blockT: 0, heli: null, sirens: [], seen: false,
  job: null, nextOffer: 3, banner: '', bannerT: 0, shake: 0, distT: 0, D: null, spawnT: 0 };
const startNode = nearestNode(894, 928); // Kottbusser Tor
let player = makeCar('player', startNode, M.adj[startNode][0]);
player.color = '#9bd32d';
const shop = place(nearestNode(1930, 780)); // Wrangelkiez
const cars = [player]; // cars[0] is always the player: in a car, or on foot
let camX = player.x, camY = player.y; // camera target in world metres (iso.js draws around it)

function msg(from, text) {
  const el = document.createElement('div'); el.className = from ? 'm' : 'm sys';
  el.innerHTML = from ? '<b></b><span></span>' : '<span></span>';
  if (from) el.querySelector('b').textContent = from;
  el.querySelector('span').textContent = text;
  const box = $('msgs'); box.append(el); while (box.children.length > 7) box.firstChild.remove();
}
const banner = (t, s = 2.5) => { G.banner = t; G.bannerT = s; };
// serious stuff (fleeing, ramming, carjacking): the police actually hunt you. (x, y) = where they think you are
function crime(reason, stars = 1, x = player.x, y = player.y) {
  if (G.crimeCd > 0 || G.grace > 0) return;
  G.crimeCd = 4; G.lastSeen = G.time; G.known = { x, y, t: G.time };
  const first = G.wanted === 0;
  G.wanted = Math.min(5, G.wanted + stars);
  banner(reason + '!  ' + '★'.repeat(G.wanted));
  endStop();
  if (first) msg(FRED, `cops on ur tail? lose them or get a respray at ${shop.name} (€150)`);
}
// a witness calls it in later (or not): `chance` that police hear about it after `delay` s
function report(reason, stars, delay, chance) {
  if (Math.random() < chance) G.reports.push({ t: G.time + delay, reason, stars, x: player.x, y: player.y });
}
// ---------- traffic rules (StVO), fines per Bußgeldkatalog (Pkw, innerorts, since 2021)
const SPEED_FINES = [[10, 30], [15, 50], [20, 70], [25, 115], [30, 180], [40, 260], [50, 400], [60, 560], [70, 700], [Infinity, 800]];
const speedFine = over => SPEED_FINES.find(([m]) => over <= m)[1];
console.assert(speedFine(12) === 50 && speedFine(26) === 180 && speedFine(99) === 800, 'speedFine');
function rules(sp) {
  const kmh = Math.abs(sp) * 3.6, r = nearestEdge(player.x, player.y, 10);
  if (r) G.limit = inWorks(player.x, player.y) ? Math.min(30, r.e.lim) : r.e.lim;
  // police deduct a 3 km/h tolerance below 100, and nobody measures 12 km/h over by eye
  const over = Math.floor(kmh - 3 - G.limit);
  if (over > 15) offence('Speeding', speedFine(over), `${Math.round(kmh)} in a ${G.limit} zone`, over <= 25 ? 0.35 : over <= 35 ? 0.7 : 1);
  if (r && r.e.ow && sp > 2) {
    const dx = NX(r.e.b) - NX(r.e.a), dy = NY(r.e.b) - NY(r.e.a);
    if ((Math.cos(player.a) * dx + Math.sin(player.a) * dy) / Math.hypot(dx, dy) < -0.5) offence('Wrong way down a one-way street', 25, '', 0.5);
  }
  if (sp > 3) for (const [n, j] of SIG) {
    if (Math.abs(NX(n) - player.x) > 5 || Math.abs(NY(n) - player.y) > 5 || G.ranJ === j) continue;
    const [st, t] = light(j, player.a);
    if (st === 'r') { G.ranJ = j; setTimeout(() => G.ranJ === j && (G.ranJ = null), 5000); offence('Ran a red light', t >= 1 ? 200 : 90, t >= 1 ? 'red for over 1 s' : '', t >= 1 ? 0.9 : 0.6); }
  }
}
// what a cop can actually see: 75 m ahead in a 130° cone, all round within 15 m, never through buildings.
// A cop who is already after you keeps looking around (all round up to 60 m).
const CONE = Math.cos(65 * Math.PI / 180);
function sees(p, x = player.x, y = player.y) {
  const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
  if (d > 75) return false;
  if (d > 15 && !((p.chase || p.stop) && d < 60) && (dx * Math.cos(p.a) + dy * Math.sin(p.a)) / d < CONE) return false;
  return los(p.x, p.y, x, y);
}
// A traffic offence only matters if a patrol sees it. They use discretion (`chance`, rolled once per 8 s), a small
// offence first gets a warning (flash + horn, "!" over the car); the same again within 2 minutes, or anything over
// €100, and they pull you over. Busy patrols (on their way to a call) ignore traffic stuff, and after a stop
// you get 45 s of peace.
function offence(reason, fine, detail = '', chance = 1) {
  if (player.kind === 'foot' || G.wanted > 0 || G.stop || G.tGrace > 0 || (G.rolled[reason] || 0) > G.time) return;
  const cop = cars.find(p => p.kind === 'police' && !p.busy && sees(p));
  if (!cop) return;
  G.rolled[reason] = G.time + 8;
  if (Math.random() >= chance) return;
  const text = `${reason}${detail ? ' (' + detail + ')' : ''}`;
  if (fine < 100 && !(G.warned[reason] > G.time)) {
    G.warned[reason] = G.time + 120; cop.warnT = 3;
    msg('Polizei 🚓', `${text}. This is a warning. Next time it's a fine.`); banner('Warning: ' + reason.toLowerCase(), 2);
    return;
  }
  pullOver(cop, reason, fine, detail);
}
const STOP_TIME = 15;
function pullOver(cop, reason, fine, detail = '') {
  G.stop = { cop, reason, fine, t: 0, check: 0 }; cop.stop = true;
  banner('POLICE: PULL OVER');
  msg('Polizei 🚓', `${reason}${detail ? ' (' + detail + ')' : ''}. Pull over and stop within ${STOP_TIME} s. Drive off and you're wanted.`);
}
function endStop() { if (G.stop) G.stop.cop.stop = false; G.stop = null; }
function updateStop(dt, sp) {
  const s = G.stop; if (!s) return;
  const d = dist(s.cop.x, s.cop.y, player.x, player.y);
  s.t += dt;
  if (!cars.includes(s.cop) || G.wanted > 0) return endStop();
  if (d > 150 || (s.check > 0.3 && sp > 3) || (s.t > STOP_TIME && !s.check)) { endStop(); crime('Fled a traffic stop', 1); return; }
  if (sp < 1 && d < 25) s.check += dt;
  if (s.check < 3) return;
  let fine = s.fine, text = s.fine ? `€${s.fine} fine for ${s.reason.toLowerCase()}.` : 'Papers ok.';
  const j = G.job;
  if (j && j.stage === 'deliver') {
    // more likely to search the car in drug hot spots (Rauschgiftdelikte vs Berlin average)
    const p = Math.min(0.9, j.f.smell * (0.4 + j.ripe) * (0.6 + 0.1 * G.area.drugs) + (s.fine ? 0 : 0.3));
    if (Math.random() < p) {
      fine += 250; text += ` They searched the car and found ${j.q}× ${j.f.n}. Confiscated, +€250.`;
      msg(FRED, 'u lost my crate?! that comes out of ur pocket 😤'); G.job = null; G.nextOffer = G.time + 8;
    } else text += ' They didn\'t search the car. Lucky.';
  }
  G.money -= Math.min(G.money, fine); G.grace = 4; G.tGrace = 45;
  msg('Polizei 🚓', text); banner(fine ? '−€' + fine : 'Free to go');
  endStop();
}

function busted() {
  const fine = Math.min(G.money, 100 + 50 * G.wanted);
  G.money -= fine; G.wanted = 0; G.bustT = 0; G.grace = 5; G.tGrace = 45; G.reports = [];
  banner('BUSTED  −€' + fine, 3);
  if (G.job && G.job.stage === 'deliver') msg(FRED, 'u lost my crate?! that comes out of ur pocket 😤');
  endStop();
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

// ---------- on foot: [F] gets out, and into any car close by (yours, a parked one, or someone else's)
function stampParked(k, v) { // collision mask under a parked car: 3 = parked car, 0 = free again
  const [x, y, a] = PARKED.slice(k, k + 3), c = Math.cos(a), s = Math.sin(a);
  for (let l = -2.2; l <= 2.2; l += 0.5) for (let w = -0.9; w <= 0.9; w += 0.45) {
    const px = x + c * l - s * w | 0, py = y + s * l + c * w | 0, i = py * W + px;
    if (px >= 0 && py >= 0 && px < W && py < H && mask[i] === (v ? 0 : 3)) mask[i] = v;
  }
}
function toggleCar() {
  if (player.kind === 'foot') return enterCar();
  if (Math.abs(speedOf(player)) > 3) return banner('Slow down to get out', 1.2);
  const car = player, lx = Math.sin(car.a) * 1.9, ly = -Math.cos(car.a) * 1.9; // driver's door: left side
  const [x, y] = [0, 3].includes(cell(car.x + lx, car.y + ly)) ? [car.x + lx, car.y + ly] : [car.x - lx, car.y - ly];
  car.kind = 'traffic'; car.abandoned = true; car.mine = true; car.vx = car.vy = 0; car.chase = car.stop = false;
  player = { kind: 'foot', x, y, a: car.a, vx: 0, vy: 0, ph: 0, color: '#9bd32d', hair: '#3b2a1e' };
  cars[0] = player; cars.push(car);
}
function enterCar() {
  let best = null, bd = 4;
  for (const c of cars) {
    if (c === player || c.kind === 'bike' || (c.kind === 'police' && !c.abandoned)) continue;
    const d = dist(c.x, c.y, player.x, player.y);
    if (d < bd) { bd = d; best = c; }
  }
  const witness = cars.some(p => p.kind === 'police' && sees(p));
  if (best) {
    cars.splice(cars.indexOf(best), 1);
    if (!best.abandoned) { // someone is driving: pull them out
      const n = walkNear(best.x, best.y, 15)[0];
      if (n !== undefined) addPed(n, { flee: 8, x: best.x, y: best.y });
      banner('Carjacked!', 1.5);
      if (witness) crime('Carjacking', 2); else report('Carjacking reported', 1, 8, 0.7);
    }
  } else {
    // a parked car: smash the window
    let k = -1, kd = 3.5;
    for (let i = 0; i < PARKED.length; i += 4) if (PARKED[i + 3] >= 0 && Math.abs(PARKED[i] - player.x) < 4 && Math.abs(PARKED[i + 1] - player.y) < 4) {
      const d = dist(PARKED[i], PARKED[i + 1], player.x, player.y);
      if (d < kd) { kd = d; k = i; }
    }
    if (k < 0) return banner('No car close enough', 1.2);
    const n = nearestNode(PARKED[k], PARKED[k + 1]);
    best = makeCar('traffic', n, M.adj[n][0]);
    Object.assign(best, { x: PARKED[k], y: PARKED[k + 1], a: PARKED[k + 2], color: PAINT[PARKED[k + 3] * PAINT.length | 0] });
    stampParked(k, 0); PARKED[k + 3] = -1; invalidateTiles(best.x, best.y);
    banner('Window smashed', 1.5);
    if (witness) crime('Car theft', 1); else report('Car theft reported', 1, 20, 0.4);
  }
  Object.assign(best, { kind: 'player', abandoned: false, mine: false, chase: false, stop: false, post: false, rev: 0, stuck: 0 });
  player = best; cars[0] = best;
}
function walk(dt) {
  if (G.downT > 0) { G.downT -= dt; player.vx = player.vy = 0; return; }
  // screen directions on the iso view: right = world (1,-1), down = world (1,1)
  const ix = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0), iy = (keys.ArrowDown || keys.KeyS ? 1 : 0) - (keys.ArrowUp || keys.KeyW ? 1 : 0);
  let wx = (ix + iy) / Math.SQRT2, wy = (iy - ix) / Math.SQRT2;
  const l = Math.hypot(wx, wy), v = keys.Space ? 5.5 : 2.4; // Space sprints
  if (l) { wx /= l; wy /= l; player.a = Math.atan2(wy, wx); player.ph += v * dt * 4; }
  player.vx = l ? wx * v : 0; player.vy = l ? wy * v : 0;
  const free = (x, y) => { const c = cell(x, y); return c === 0 || c === 3; }; // squeeze between parked cars, not through walls or water
  if (free(player.x + player.vx * dt, player.y)) player.x += player.vx * dt;
  if (free(player.x, player.y + player.vy * dt)) player.y += player.vy * dt;
}

// ---------- DirtyDave FM: plays the tracks listed in music/playlist.js (written by: node tools/playlist.mjs)
const RADIO = { on: true, list: [...(window.PLAYLIST || [])].sort(() => Math.random() - 0.5), i: -1, audio: new Audio(), title: '', errors: 0 };
RADIO.audio.addEventListener('ended', () => { RADIO.errors = 0; nextTrack(); });
RADIO.audio.addEventListener('error', () => { if (++RADIO.errors < RADIO.list.length) nextTrack(); else RADIO.title = 'no playable tracks'; });
function nextTrack() {
  if (!RADIO.list.length) return;
  RADIO.i = (RADIO.i + 1) % RADIO.list.length;
  const f = RADIO.list[RADIO.i];
  RADIO.title = f.replace(/^.*\//, '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ');
  RADIO.audio.src = 'music/' + f.split('/').map(encodeURIComponent).join('/');
  if (RADIO.on) RADIO.audio.play().catch(() => {});
}
function radioKey(code) {
  if (!RADIO.list.length) return msg('DirtyDave FM 📻', 'no tracks yet. Put music files into the music folder and run: node tools/playlist.mjs');
  if (code === 'KeyR') { RADIO.on = !RADIO.on; RADIO.on ? RADIO.audio.play().catch(() => {}) : RADIO.audio.pause(); }
  if (code === 'KeyT') { RADIO.on = true; nextTrack(); }
}

// ---------- simulation
const DT = 1 / 60, TRAFFIC = 120, BIKES = 24, PEDS = 90, PATROL = 1.5;
function spawn(kind, minR, maxR, cx = player.x, cy = player.y) {
  const n = randNode(cx, cy, minR, maxR, true, kind === 'traffic' && Math.random() < 0.65 ? BIG : MAIN);
  if (n < 0) return null;
  const opts = M.adj[n].filter(m => legal(n, m));
  if (!opts.length) return null;
  const c = makeCar(kind, n, pick(opts)), s = laneSeg(c.from, c.to, c);
  c.x = s.x + s.ux * Math.min(3, s.L / 2); c.y = s.y + s.uy * Math.min(3, s.L / 2); c.a = Math.atan2(s.uy, s.ux);
  if (cars.some(o => dist(o.x, o.y, c.x, c.y) < 7) || hits(c.x, c.y, c.a, CORNERS, true)) return null;
  cars.push(c); return c;
}
function updatePolice(c, dt) {
  const toP = dist(c.x, c.y, player.x, player.y);
  c.warnT = (c.warnT || 0) - dt;
  if (c.post) { physics(c, speedOf(c) > 0.3 ? -1 : 0, 0, true, dt); return; }
  if (c.stop) {
    // traffic stop: follow ~10 m behind you, park once you've stopped
    if (sees(c) && toP < 60) {
      if (toP < 16 && Math.abs(speedOf(player)) < 2) { drive(c, c.x + Math.cos(c.a), c.y + Math.sin(c.a), 0, dt); return; }
      const bx = player.x - Math.cos(player.a) * 10, by = player.y - Math.sin(player.a) * 10;
      drive(c, bx, by, toP < 25 ? Math.max(4, Math.abs(speedOf(player)) + (toP - 12) * 0.5) : 16, dt); return;
    }
    if (G.D) follow(c, G.D, 16, dt); return;
  }
  if (c.chase) {
    const fast = 15 + 2.5 * G.wanted;
    if (sees(c) && toP < 45) {
      // in sight: at 1 star they tail you and wait for you to stop; from 2 stars they ram
      const lead = G.wanted >= 2 ? 0.25 : 0.6;
      drive(c, player.x + player.vx * lead, player.y + player.vy * lead, G.wanted >= 2 || player.kind === 'foot' ? fast : Math.min(fast, Math.abs(speedOf(player)) + 6), dt);
      return;
    }
    if (G.time - G.known.t > 4) { // lost you: search the area around where you were last seen
      if (!c.goalD || c.goalT < G.time || dist(c.x, c.y, NX(c.goal), NY(c.goal)) < 10) {
        const n = randNode(G.known.x, G.known.y, 0, searchRadius(), false);
        if (n >= 0) { c.goal = n; c.goalD = dijkstra(n); c.goalT = G.time + 20; }
      }
      if (c.goalD) { follow(c, c.goalD, 10, dt); return; }
    }
    if (G.D) follow(c, G.D, fast, dt); else drive(c, G.known.x, G.known.y, fast, dt);
    return;
  }
  updateTraffic(c, dt); // on patrol: a normal car that follows the rules
}
function follow(c, D, speed, dt) { // drive downhill on a road distance field
  if (dist(c.x, c.y, NX(c.to), NY(c.to)) > 40) c.to = nearestNode(c.x, c.y);
  if (dist(c.x, c.y, NX(c.to), NY(c.to)) < 8) {
    let best = c.to; for (const nb of M.adj[c.to]) if (D[nb] < D[best]) best = nb;
    if (best === c.to) { c.goalT = 0; drive(c, NX(c.to), NY(c.to), 4, dt); return; }
    c.from = c.to; c.to = best; c.next = null;
  }
  drive(c, NX(c.to), NY(c.to), speed, dt);
}
const RAD = c => c.kind === 'foot' ? 0.45 : c.kind === 'bike' ? 0.75 : 1.8;
const canMove = (c, x, y) => c.kind === 'foot' ? [0, 3].includes(cell(x, y)) : !hits(x, y, c.a, c.kind === 'bike' ? BIKE_PTS : CORNERS, c !== player);
function collide() {
  for (let i = 0; i < cars.length; i++) for (let k = i + 1; k < cars.length; k++) {
    const a = cars[i], b = cars[k], R = RAD(a) + RAD(b), dx = b.x - a.x, dy = b.y - a.y;
    if (Math.abs(dx) >= R || Math.abs(dy) >= R) continue;
    const d = Math.hypot(dx, dy);
    if (d >= R || d === 0) continue;
    const nx = dx / d, ny = dy / d, push = (R - d) / 2;
    if (canMove(a, a.x - nx * push, a.y - ny * push)) { a.x -= nx * push; a.y -= ny * push; }
    if (canMove(b, b.x + nx * push, b.y + ny * push)) { b.x += nx * push; b.y += ny * push; }
    const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rv >= 0) continue;
    const j = -1.3 * rv / 2;
    if (a.kind !== 'foot') { a.vx -= j * nx; a.vy -= j * ny; }
    if (b.kind !== 'foot') { b.vx += j * nx; b.vy += j * ny; }
    if ((a === player || b === player) && -rv > 3) {
      const other = a === player ? b : a;
      if (player.kind === 'foot') { if (-rv > 4 && other.kind !== 'bike') { G.downT = 1.5; G.shake = 8; } continue; }
      G.shake = Math.min(12, -rv * 1.5);
      if (other.kind === 'police') { if (Math.abs(speedOf(player)) > 4) crime('Rammed a cop', 2); }
      else if (other.kind === 'bike') { other.fall = 3; crime(cars.some(p => p.kind === 'police' && sees(p)) ? 'Knocked a cyclist off' : 'Knocked a cyclist off, someone called 110', 1); }
      else offence('Caused a collision', 35);
    } else if (-rv > 3) for (const o of [a, b]) if (o.kind === 'bike') o.fall = 3;
  }
}
function heliUpdate(dt) { // from 4 stars a helicopter searches around where you were last seen; it sees 25 m round its spotlight
  if (G.wanted < 4) { G.heli = null; return false; }
  if (!G.heli) G.heli = { x: G.known.x - 200, y: G.known.y - 200, a: 0 };
  const h = G.heli, tx = G.time - G.known.t < 2 ? player.x : G.known.x + Math.cos(G.time * 0.4) * searchRadius() * 0.6, ty = G.time - G.known.t < 2 ? player.y : G.known.y + Math.sin(G.time * 0.4) * searchRadius() * 0.6;
  const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy) || 1, v = Math.min(d, 12 * dt);
  h.x += dx / d * v; h.y += dy / d * v; h.a = Math.atan2(dy, dx);
  return dist(h.x, h.y, player.x, player.y) < 25;
}
function roadblock() { // from 3 stars: two patrol cars across the road ~200 m ahead of you, out of sight
  const hx = Math.cos(player.a), hy = Math.sin(player.a);
  let best = -1, bs = 0.8;
  for (let t = 0; t < 80; t++) {
    const n = pick(MAIN), dx = NX(n) - player.x, dy = NY(n) - player.y, d = Math.hypot(dx, dy);
    if (d < 150 || d > 260 || onScreen(NX(n), NY(n), 20) || M.adj[n].length !== 2) continue;
    const s = (dx * hx + dy * hy) / d;
    if (s > bs) { bs = s; best = n; }
  }
  if (best < 0) return;
  const nb = M.adj[best][0], a = Math.atan2(NY(nb) - NY(best), NX(nb) - NX(best));
  for (const o of [-2.6, 2.6]) {
    const c = makeCar('police', best, nb);
    Object.assign(c, { x: NX(best) + Math.cos(a) * o, y: NY(best) + Math.sin(a) * o, a: a + Math.PI / 2 + (o > 0 ? 0.3 : -0.3), post: true, block: true, busy: false });
    cars.push(c);
  }
  msg('Polizeifunk 📻', `Roadblock going up at ${place(best).name}.`);
}
function update(dt) {
  G.time += dt; G.crimeCd -= dt; G.grace -= dt; G.tGrace -= dt; G.bannerT -= dt; G.shake *= 0.9;
  const police = cars.filter(c => c.kind === 'police'), foot = player.kind === 'foot';

  // player
  if (foot) walk(dt);
  else {
    const thr = (keys.ArrowUp || keys.KeyW ? 1 : 0) - (keys.ArrowDown || keys.KeyS ? 1 : 0);
    const steer = (keys.ArrowRight || keys.KeyD ? 1 : 0) - (keys.ArrowLeft || keys.KeyA ? 1 : 0);
    const imp = physics(player, thr, steer, keys.Space, dt);
    if (imp > 6) G.shake = Math.min(12, imp);
  }
  RADIO.audio.volume = foot ? 0.15 : 0.7;

  // road distance field: towards you during a traffic stop (they're following you), towards your last known position in a pursuit
  if ((G.wanted > 0 || G.stop) && (G.distT -= dt) <= 0) {
    G.D = dijkstra(G.stop ? nearestNode(player.x, player.y) : nearestNode(G.known.x, G.known.y)); G.distT = 0.5;
  }
  G.sirens = police.filter(c => c.chase || c.stop);
  for (const c of cars) if (c !== player) c.kind === 'police' ? updatePolice(c, dt) : updateTraffic(c, dt);
  collide();

  // police
  const heli = heliUpdate(dt), seen = police.some(p => sees(p)) || heli, sp = Math.abs(speedOf(player));
  G.seen = seen;
  if (seen) { G.lastSeen = G.time; G.known = { x: player.x, y: player.y, t: G.time }; }
  if ((G.areaT -= dt) <= 0) { G.areaT = 1; G.area = areaAt(player.x, player.y); }
  if (!foot) rules(speedOf(player));
  updateStop(dt, sp);
  for (let i = G.reports.length - 1; i >= 0; i--) if (G.reports[i].t < G.time) { const r = G.reports.splice(i, 1)[0]; crime(r.reason, r.stars, r.x, r.y); }
  // smelly cargo makes nearby cops suspicious; enough suspicion and they do a check (not a chase)
  const cargo = !foot && G.job && G.job.stage === 'deliver' && G.job.f.smell * (0.5 + G.job.ripe);
  const sniffer = cargo && !G.stop && !G.wanted && police.find(p => !p.busy && dist(p.x, p.y, player.x, player.y) < 15 + 25 * cargo && sees(p));
  G.sus = clamp(G.sus + (sniffer ? dt * cargo * (0.25 + 0.04 * G.area.drugs) : -dt * 0.1), 0, 1);
  if (G.sus >= 1) { G.sus = 0; pullOver(sniffer, 'Routine check', 0); }
  // out of sight long enough: one star at a time, they give up
  if (G.wanted > 0 && G.time - G.lastSeen > 18 + 6 * G.wanted) {
    G.wanted--; G.lastSeen = G.time;
    banner(G.wanted ? 'They\'re losing interest…  ' + '★'.repeat(G.wanted) : 'Search called off');
  }
  if (G.wanted > 0 && !foot && dist(player.x, player.y, shop.x, shop.y) < 10 && sp < 4 && !seen) {
    if (G.money >= 150) {
      G.money -= 150; G.wanted = 0; G.grace = 3; G.reports = [];
      player.color = pick(['#9bd32d', '#e86f2d', '#3fa7d6', '#d64fa0', '#f2d43a']);
      banner('Fresh paint. Cops lost you.  −€150');
    } else if (G.bannerT <= 0) banner('Respray costs €150');
  }
  if (G.wanted >= 3 && sp > 8 && (G.blockT -= dt) <= 0) { G.blockT = 25; roadblock(); }
  // radio call: units within 400 m of the reported position join after a few seconds; a cop who sees you joins at once
  police.forEach(p => {
    if (!G.wanted) { p.chase = false; p.radio = 0; p.goalD = null; return; }
    if (p.chase || p.block) return;
    if (sees(p)) { p.chase = true; p.post = false; return; }
    if (dist(p.x, p.y, G.known.x, G.known.y) < 400) { p.radio = (p.radio || rnd(3, 7)) - dt; if (p.radio <= 0) { p.chase = true; p.post = false; } }
  });
  // busted: a cop right next to you, and you've stopped (on foot they just grab you)
  const near = police.some(p => (p.chase || p.block) && dist(p.x, p.y, player.x, player.y) < (foot ? 4 : 7) && sees(p));
  G.bustT = near && (foot || sp < 1.5) && G.wanted > 0 ? G.bustT + dt : Math.max(0, G.bustT - dt);
  if (G.bustT > 1.5) busted();

  // population: despawn far or hopelessly stuck cars, spawn near the player but off screen
  for (let i = cars.length - 1; i > 0; i--) {
    const c = cars[i], d = dist(c.x, c.y, player.x, player.y), off = !onScreen(c.x, c.y, 30);
    if (c.mine) { if (d > 600) cars.splice(i, 1); continue; }
    if (c.block) { if (off && (d > 500 || !G.wanted)) cars.splice(i, 1); continue; }
    if (off && ((d > 420 && !c.post && !((c.chase || c.stop) && d < 900)) || c.waitT > 40)) cars.splice(i, 1);
  }
  if ((G.spawnT -= dt) <= 0) {
    G.spawnT = 0.15;
    // patrol density follows the real crime rate of the Bezirksregion you're in; extra units head for the reported position
    const want = Math.round(PATROL + 1.5 * G.area.all) + (G.wanted ? G.wanted * 1.5 | 0 : 0);
    if (cars.filter(c => c.kind === 'police' && !c.post).length < want)
      G.wanted ? spawn('police', 150, 350, G.known.x, G.known.y) : spawn('police', 200, 400);
    for (let k = 0; k < 3 && cars.filter(c => c.kind === 'traffic' && !c.abandoned).length < TRAFFIC; k++) spawn('traffic', 60, 380);
    if (cars.filter(c => c.kind === 'bike').length < BIKES) spawn('bike', 50, 300);
  }
  updateBuses(dt);
  updatePeds(dt, police);
  if (peds.length < PEDS) spawnPed();
  updateJob(dt);
}
function seenBy(police) { return police.some(p => sees(p)); }
const searchRadius = () => clamp(40 + 5 * (G.time - G.known.t), 40, 260);

// ---------- rendering: see iso.js
let hudT = 0;
function hud() {
  const foot = player.kind === 'foot';
  $('money').textContent = '€' + G.money;
  $('stars').innerHTML = [1, 2, 3, 4, 5].map(i => `<span class="${i <= G.wanted ? '' : 'off'}">★</span>`).join('');
  const kmh = Math.round(Math.abs(speedOf(player)) * 3.6);
  $('speed').textContent = foot ? 'on foot' : kmh + ' km/h';
  $('speed').style.color = foot ? '' : kmh - 3 - G.limit > 15 ? '#ff6a5a' : kmh - 3 > G.limit ? '#ffb000' : '';
  $('limit').textContent = G.limit;
  const a = G.area;
  $('area').textContent = a === AVG_AREA ? '' : `${a.n} · crime ×${a.all} · drug offences ×${a.drugs} (Berlin = 1)`;
  $('sus').style.display = G.sus > 0.02 ? 'block' : 'none'; $('sus').querySelector('i').style.width = G.sus * 100 + '%';
  const st = v => v === null ? '…' : v;
  $('live').textContent = `Live: ${st(LIVE.bvg)} BVG vehicles · ${st(LIVE.works)} roadworks · crime data PKS ${M.crimeYear}`;
  $('radio').textContent = !RADIO.list.length ? 'DirtyDave FM · no tracks yet' : RADIO.on ? `DirtyDave FM · ${RADIO.title}` : 'DirtyDave FM · off';
  const j = G.job, s = G.stop;
  $('goal').textContent = G.wanted
    ? (G.time - G.lastSeen < 1.5 ? `Pursuit: they can see you. Break line of sight${G.wanted >= 2 ? ', they will ram you' : ''}.` : `They lost you and are searching. Stay out of sight ${Math.max(0, Math.ceil(18 + 6 * G.wanted - (G.time - G.lastSeen)))} s.`)
    : s ? (s.check > 0 ? 'Police check. Stay put…' : `Pull over and stop: ${Math.max(0, Math.ceil(STOP_TIME - s.t))} s`)
    : !j ? 'Waiting for messages…' : j.stage === 'offer' ? 'New request! [Y] / [N]' : j.stage === 'pickup' ? 'Pick up at ' + j.pickup.name : 'Deliver to ' + j.drop.name;
  $('watch').textContent = !G.wanted && !s && G.seen ? 'A patrol can see you' : foot ? '[F] get into a car' : '';
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
  if (e.code === 'Enter' && !G.started) {
    G.started = true; $('start').remove(); msg(FRED, 'welcome to the business 🍍 phone stays on. clients text u directly.');
    if (RADIO.list.length) nextTrack(); else msg('DirtyDave FM 📻', 'no tracks yet. Put music files into the music folder and run: node tools/playlist.mjs');
  }
  if (G.started && !e.repeat && (e.code === 'KeyF' || e.code === 'KeyE')) toggleCar();
  if (G.started && !e.repeat && (e.code === 'KeyR' || e.code === 'KeyT')) radioKey(e.code);
  if (e.key === '+' || e.key === '=') isoZoom(1);
  if (e.key === '-') isoZoom(-1);
  if (!e.repeat && e.code === 'KeyP') { setDetail(DETAIL + 1); banner('Pixel detail ' + DETAIL + '/4', 1.5); }
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
loadWorks(); pollBVG();
for (let k = 0; k < TRAFFIC; k++) spawn('traffic', 45, 380); // the city is already busy when you arrive
for (let k = 0; k < BIKES; k++) spawn('bike', 45, 300);
// fixed posts: the Polizeiwache at Kottbusser Tor (opened 2023) and a car at the Görlitzer Park entrance
for (const [street, x, y] of [['Adalbertstraße', 894, 900], ['Wiener Straße', 2050, 1150]]) {
  const id = M.names.indexOf(street); if (id < 0) continue;
  let best = -1, bd = 250;
  for (const n of MAIN) if (M.nodeName[n] === id && dist(NX(n), NY(n), x, y) < bd && dist(NX(n), NY(n), player.x, player.y) > 25) { bd = dist(NX(n), NY(n), x, y); best = n; }
  if (best < 0) continue;
  const c = makeCar('police', best, M.adj[best][0]); c.post = true; c.busy = false; cars.push(c);
}
for (let k = 0; k < PEDS; k++) spawnPed();
let last = performance.now(), acc = 0;
function frame(t) {
  acc += Math.min(0.1, (t - last) / 1000); last = t;
  if (G.started) while (acc >= DT) { update(DT); acc -= DT; } else acc = 0;
  render();
  if ((hudT += 1) % 6 === 0) hud();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
