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
M.rails.forEach(r => r.bb = bbox(r.p));
M.green.forEach(g => g.bb = bbox(g.p));
const WATER = M.water.map(p => ({ p, bb: bbox(p) }));
// ---------- building looks, by style from OSM tags (see style() in tools/build-map.mjs)
const SUN = [-0.6, 0.8]; // direction towards the sun (south-west); shadows fall north-east
const hash = n => { n = Math.sin(n * 127.1) * 43758.5453; return n - Math.floor(n); };
const pickH = (a, n) => a[hash(n) * a.length | 0];
const FACADE = {
  // Altbau: renovated pastels next to sooty unrenovated grey, the Kreuzberg mix
  alt: [[232, 220, 196], [222, 206, 170], [236, 226, 210], [214, 190, 156], [205, 200, 190], [226, 206, 186], [210, 214, 200],
    [200, 206, 214], [228, 196, 170], [190, 170, 140], [176, 160, 150], [160, 150, 138], [238, 214, 160], [186, 120, 96]],
  platte: [[236, 234, 226], [220, 214, 200], [206, 200, 188], [226, 220, 196], [214, 206, 180], [188, 196, 202]],
  brick: [[158, 74, 52], [170, 90, 62], [142, 62, 46], [196, 160, 108], [180, 120, 80]],
  office: [[196, 202, 208], [170, 178, 186], [220, 218, 210], [150, 156, 164]],
  low: [[168, 164, 156], [150, 146, 140], [190, 184, 170], [130, 128, 124]],
};
const ROOF = {
  m: { band: [[72, 74, 80], [104, 108, 112], [150, 78, 58], [88, 84, 82]], top: [[128, 126, 122], [140, 136, 128], [118, 116, 114]], d: 3.2 },
  p: { band: [[158, 80, 58], [140, 70, 52], [120, 110, 104], [96, 92, 92]], top: [[150, 76, 56]], d: 9 },
  f: { band: null, top: [[120, 120, 118], [136, 134, 128], [104, 104, 106], [150, 146, 138]], d: 0 },
};
const rgb = (c, f = 1) => `rgb(${c.map(v => Math.min(255, v * f) | 0)})`;
// facade patterns: one tile = one cell of cw x ch metres, drawn at 64 px per cell
function pat(cw, ch, draw) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d'); g.scale(64 / cw, 64 / ch); draw(g, cw, ch);
  return { p: ctx.createPattern(c, 'repeat'), cw, ch };
}
const GLASS = 'rgba(34,44,58,.85)', FRAME = '#efe9dc';
function win(g, x, y, w, h, frame = FRAME) {
  g.fillStyle = frame; g.fillRect(x - 0.1, y - 0.1, w + 0.2, h + 0.2);
  g.fillStyle = GLASS; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,.16)'; g.fillRect(x, y, w, h * 0.22);
  g.fillStyle = frame; g.fillRect(x + w / 2 - 0.04, y, 0.08, h);
}
// patterns are mapped with y running from the ground up, so "bottom" of a storey is small y
const UPPER = {
  alt: [
    pat(3.4, 3.6, (g) => { win(g, 1.15, 1.0, 1.1, 2.0); g.fillStyle = 'rgba(255,255,255,.35)'; g.fillRect(0.95, 0.8, 1.5, 0.15); g.fillRect(0, 3.45, 3.4, 0.15); }),
    pat(3.4, 3.6, (g) => { win(g, 1.15, 0.9, 1.1, 2.1); g.fillStyle = 'rgba(255,255,255,.4)'; g.beginPath(); g.moveTo(0.95, 3.1); g.lineTo(1.7, 3.45); g.lineTo(2.45, 3.1); g.fill(); }),
    pat(3.8, 3.6, (g) => { win(g, 0.6, 1.0, 1.0, 2.0); win(g, 2.2, 1.0, 1.0, 2.0); g.fillStyle = 'rgba(60,60,60,.55)'; g.fillRect(0.4, 0.75, 3.0, 0.2); }), // balcony
    pat(3.4, 3.5, (g) => { win(g, 1.2, 1.0, 1.0, 1.9, '#d8d0c0'); g.fillStyle = 'rgba(0,0,0,.06)'; for (let y = 0; y < 3.5; y += 0.5) g.fillRect(0, y, 3.4, 0.05); }), // rusticated
  ],
  platte: [
    pat(3.0, 2.9, (g) => { win(g, 0.55, 1.0, 1.9, 1.3, '#cfcfcf'); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(0, 0.75, 3.0, 0.18); }),
    pat(3.6, 2.9, (g) => { g.fillStyle = 'rgba(40,40,46,.55)'; g.fillRect(0.3, 0.7, 3.0, 1.9); win(g, 0.6, 1.1, 1.0, 1.3, '#bbb'); g.fillStyle = 'rgba(230,230,225,.9)'; g.fillRect(0.3, 0.6, 3.0, 0.5); }), // loggia
  ],
  brick: [
    pat(3.6, 4.2, (g) => { g.fillStyle = 'rgba(0,0,0,.08)'; for (let y = 0; y < 4.2; y += 0.28) g.fillRect(0, y, 3.6, 0.04); win(g, 0.7, 1.0, 2.2, 2.6, '#e8e4dc'); g.fillStyle = '#e8e4dc'; g.fillRect(0.7, 2.2, 2.2, 0.07); }),
  ],
  office: [
    pat(3.0, 3.5, (g) => { g.fillStyle = 'rgba(52,70,88,.85)'; g.fillRect(0, 0.9, 3.0, 2.2); g.fillStyle = 'rgba(255,255,255,.2)'; g.fillRect(0, 2.7, 3.0, 0.4); g.fillStyle = '#9aa3ab'; g.fillRect(1.45, 0.9, 0.1, 2.2); }),
  ],
  low: [
    pat(3.0, 3.3, (g) => { g.fillStyle = '#8f8c86'; g.fillRect(0.3, 0, 2.4, 2.1); g.fillStyle = 'rgba(0,0,0,.18)'; for (let y = 0.15; y < 2.1; y += 0.2) g.fillRect(0.3, y, 2.4, 0.05); }),
  ],
};
// Erdgeschoss towards the street: shops, awnings, roller shutters and plenty of graffiti
const scribble = (g, n, w, h) => {
  const cols = ['#e8336d', '#2fb5e8', '#111', '#f2c200', '#7ad04a', '#fff', '#a64dff'];
  for (let k = 0; k < 3; k++) {
    g.strokeStyle = pickH(cols, n * 13 + k); g.lineWidth = 0.08 + 0.1 * hash(n + k); g.beginPath();
    let x = hash(n * 3 + k) * w * 0.6, y = 0.3 + hash(n * 5 + k) * 1.2; g.moveTo(x, y);
    for (let q = 0; q < 5; q++) { x += 0.2 + hash(n + q * 7 + k) * 0.5; g.quadraticCurveTo(x - 0.2, y + 0.6 * (hash(n + q + k * 9) - 0.3), x, y + 0.5 * (hash(n * q + k) - 0.5)); }
    g.stroke();
  }
};
const GROUND = [0, 1, 2, 3, 4, 5].map(v => pat(4.2, 3.8, (g, w) => {
  if (v < 3) { // shop with awning
    g.fillStyle = 'rgba(34,44,58,.9)'; g.fillRect(0.4, 0.15, 3.0, 2.6); g.fillStyle = 'rgba(255,240,200,.15)'; g.fillRect(0.4, 0.15, 3.0, 0.9);
    g.fillStyle = ['#b8322a', '#2d6a3a', '#24456e'][v]; g.fillRect(0.2, 2.75, 3.4, 0.55);
    g.fillStyle = 'rgba(255,255,255,.7)'; for (let x = 0.2; x < 3.6; x += 0.6) g.fillRect(x, 2.75, 0.25, 0.55);
  } else if (v === 3) { // roller shutter
    g.fillStyle = '#9a9a96'; g.fillRect(0.3, 0, 3.4, 2.8); g.fillStyle = 'rgba(0,0,0,.15)'; for (let y = 0.1; y < 2.8; y += 0.18) g.fillRect(0.3, y, 3.4, 0.05);
  } else { // house door + window
    g.fillStyle = '#4a3426'; g.fillRect(0.5, 0, 1.3, 2.6); win(g, 2.4, 0.9, 1.2, 1.7);
  }
  if (v !== 1) scribble(g, v + 1, w, 3.8);
}));
M.buildings.forEach((b, n) => {
  const p = b.p; b.bb = bbox(p);
  let area = 0, cx = 0, cy = 0; const k = p.length / 2;
  for (let i = 0; i < k; i++) { const j = (i + 1) % k; area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; cx += p[2 * i]; cy += p[2 * i + 1]; }
  b.cx = cx / k; b.cy = cy / k; b.ws = Math.sign(area);
  b.h += (hash(n + 11) - 0.5) * 1.6; // eaves never line up perfectly
  const jit = 0.93 + 0.14 * hash(n), R = ROOF[b.r], green = b.r === 'f' && b.k !== 'low' && hash(n + 5) < 0.12;
  b.fac = rgb(pickH(FACADE[b.k], n + 3), jit);
  b.pat = pickH(UPPER[b.k], n + 9);
  b.shop = b.k === 'alt' || (b.k === 'platte' && hash(n + 2) < 0.4) ? pickH(GROUND, n + 4) : null;
  b.roof = green ? rgb([104, 132, 78], jit) : rgb(pickH(R.top, n + 7), jit);
  b.band = R.band && pickH(R.band, n + 8); b.bandD = R.d;
  b.edge = rgb(pickH(R.top, n + 7), 1.15);
  b.shade = []; b.len = []; b.street = [];
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k, ex = p[2 * j] - p[2 * i], ey = p[2 * j + 1] - p[2 * i + 1], l = Math.hypot(ex, ey) || 1;
    b.len.push(l); // outward normal (ey,-ex)*ws/l dotted with the sun direction -> darkness of this wall
    b.shade.push(0.32 * (1 - clamp((ey * SUN[0] - ex * SUN[1]) * b.ws / l, -1, 1)) / 2 + 0.04);
  }
  // roof furniture: chimneys + satellite dishes on Altbau, plant rooms on flat roofs
  b.bits = [];
  for (let i = 0; i < k && b.bits.length < 6; i++) {
    if (b.len[i] < 7 || hash(n * 31 + i) > 0.55 || b.k === 'low') continue;
    const j = (i + 1) % k, mx = (p[2 * i] + p[2 * j]) / 2, my = (p[2 * i + 1] + p[2 * j + 1]) / 2;
    const nx = -(p[2 * j + 1] - p[2 * i + 1]) * b.ws / b.len[i], ny = (p[2 * j] - p[2 * i]) * b.ws / b.len[i]; // inward
    const d = b.r === 'f' ? 4 + 3 * hash(n + i) : 1.6, x = mx + nx * d, y = my + ny * d;
    if (inPoly(p, x, y)) b.bits.push([x, y, Math.atan2(p[2 * j + 1] - p[2 * i + 1], p[2 * j] - p[2 * i]), b.r === 'f' ? 'box' : hash(n + i * 3) < 0.3 ? 'dish' : 'chimney']);
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
  c.braking = (thr < 0 && fwd > 0.5) || hb;
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
  c.wait = c.blocked && !c.queued ? (c.wait || 0) + dt : Math.max(0, (c.wait || 0) - dt);
  if (c.wait > 4.5) c.wait = 0;
  // stop for red lights and for queues behind them; other standoffs resolve by pushing through after 3 s
  if (c.hold || (c.blocked && (c.queued || c.wait < 3))) { thr = sp > 0.5 ? -1 : 0; c.stuck = 0; }
  c.stuck = thr > 0 && sp < 0.8 ? c.stuck + dt : 0;
  if (c.stuck > 1.2) { c.rev = 1; c.stuck = 0; }
  return physics(c, thr, clamp(da * 2.5, -1, 1), false, dt);
}
// what's actually parked in Berlin: mostly black, grey, silver and white
const PAINT = ['#202224', '#2b2b2b', '#3c3f44', '#55595e', '#8c9298', '#b9bec3', '#d9dcde', '#eeeeec', '#f6f6f4', '#1f3554', '#2e5c9a',
  '#6b1f1f', '#a8322a', '#2e4a3a', '#7a6a52', '#c9b48a', '#d9a21b'];
function makeCar(kind, from, to) {
  return { kind, x: NX(from), y: NY(from), a: Math.atan2(NY(to) - NY(from), NX(to) - NX(from)), vx: 0, vy: 0,
    from, to, stuck: 0, rev: 0, chase: false, busy: kind === 'police' && Math.random() < 0.25, lane: Math.random() < 0.6 ? 0 : Math.random() < 0.7 ? 1 : 2, color: kind === 'police' ? '#dfe3e8' : pick(PAINT) };
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
function lanePoint(c) { // drive on the right, each car keeps its own lane (c.lane, 0 = rightmost)
  const dx = NX(c.to) - NX(c.from), dy = NY(c.to) - NY(c.from), l = Math.hypot(dx, dy) || 1;
  const e = EMAP.get(ekey(c.from, c.to)), off = e ? laneOffset(e, e.a === c.from, c.lane) : 1.6;
  return [NX(c.to) - dy / l * off, NY(c.to) + dx / l * off];
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

// ---------- pedestrians: walk the footways and both sidewalks of every street, cross at crossings
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
const PATHS = [], PATHGRID = new Map(), ENDS = new Map(), PG = 40;
for (const r of M.roads) {
  if (!r.car && ['footway', 'path', 'pedestrian', 'steps'].includes(r.t)) PATHS.push(r.p);
  else if (r.car && r.t !== 'service' && !r.b) for (const d of [1, -1]) PATHS.push(offsetLine(r.p, d * (r.w / 2 + 1.7)));
}
PATHS.forEach((p, pi) => {
  for (let k = 0; k < p.length / 2; k++) {
    const key = (p[2 * k] / PG | 0) + ',' + (p[2 * k + 1] / PG | 0);
    if (!PATHGRID.has(key)) PATHGRID.set(key, []); PATHGRID.get(key).push(pi, k);
  }
  for (const k of [0, p.length / 2 - 1]) {
    const key = (p[2 * k] / 8 | 0) + ',' + (p[2 * k + 1] / 8 | 0);
    if (!ENDS.has(key)) ENDS.set(key, []); ENDS.get(key).push(pi, k);
  }
});
const ZEBRAS = []; for (let i = 0; i < M.crossings.length; i += 2) if (M.crossings[i + 1] === 1) ZEBRAS.push(NX(M.crossings[i]), NY(M.crossings[i]));
const CLOTHES = ['#1b1b1b', '#1b1b1b', '#2b2b2b', '#3a3f4a', '#5a4636', '#7a2b2b', '#2f4f6f', '#6b6b6b', '#c9b37a', '#3d5a3d', '#d8d2c4', '#a33a5a', '#e07a2e'];
const HAIR = ['#1a1a1a', '#2a1d14', '#3b2a1e', '#6b4a2e', '#c9a46a', '#8a8a8a', '#b5482a'];
const peds = [];
function spawnPed() {
  for (let t = 0; t < 20; t++) {
    const a = rnd(0, 6.28), r = rnd(40, 220), x = player.x + Math.cos(a) * r, y = player.y + Math.sin(a) * r;
    if (onScreen(x, y, 4)) continue;
    const list = PATHGRID.get((x / PG | 0) + ',' + (y / PG | 0)); if (!list) continue;
    const q = (Math.random() * list.length / 2 | 0) * 2, pi = list[q], k = list[q + 1], p = PATHS[pi];
    if (cell(p[2 * k], p[2 * k + 1]) === 1) continue;
    const n = p.length / 2, dir = k === n - 1 ? -1 : k === 0 ? 1 : Math.random() < 0.5 ? 1 : -1;
    peds.push({ pi, k, dir, d: 0, x: p[2 * k], y: p[2 * k + 1], a: 0, ox: 0, oy: 0, v: rnd(1.0, 1.6), fall: 0, ph: rnd(0, 6),
      col: pick(CLOTHES), hair: pick(HAIR), dog: Math.random() < 0.08 });
    return;
  }
}
function pedNext(pd) { // reached point k+dir: continue, hop onto a connected path, or turn back
  pd.k += pd.dir; pd.d = 0;
  const p = PATHS[pd.pi], n = p.length / 2, nk = pd.k + pd.dir;
  if (nk >= 0 && nk < n && cell(p[2 * nk], p[2 * nk + 1]) !== 1) return;
  const x = p[2 * pd.k], y = p[2 * pd.k + 1], opts = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const l = ENDS.get(((x / 8 | 0) + i) + ',' + ((y / 8 | 0) + j)) || [];
    for (let q = 0; q < l.length; q += 2) if (l[q] !== pd.pi && dist(x, y, PATHS[l[q]][2 * l[q + 1]], PATHS[l[q]][2 * l[q + 1] + 1]) < 8) opts.push(l[q], l[q + 1]);
  }
  if (opts.length && Math.random() < 0.85) {
    const q = (Math.random() * opts.length / 2 | 0) * 2; pd.pi = opts[q]; pd.k = opts[q + 1];
    pd.dir = pd.k === 0 ? 1 : -1;
  } else pd.dir = -pd.dir;
}
function updatePeds(dt, police) {
  const sp = speedOf(player), fx = Math.cos(player.a), fy = Math.sin(player.a);
  for (let i = peds.length - 1; i >= 0; i--) {
    const pd = peds[i];
    if (dist(pd.x, pd.y, player.x, player.y) > 260 && !onScreen(pd.x, pd.y, 5)) { peds.splice(i, 1); continue; }
    if (pd.fall > 0) { pd.fall -= dt; continue; }
    const p = PATHS[pd.pi], ax = p[2 * pd.k], ay = p[2 * pd.k + 1], bx = p[2 * (pd.k + pd.dir)], by = p[2 * (pd.k + pd.dir) + 1];
    if (bx === undefined) { pd.dir = -pd.dir; continue; }
    const L = dist(ax, ay, bx, by) || 0.01;
    pd.d += pd.v * dt; pd.ph += pd.v * dt * 4;
    if (pd.d >= L) { pedNext(pd); continue; }
    pd.a = Math.atan2(by - ay, bx - ax);
    // a car coming at you: step aside (perpendicular to the car's path), drift back when it's gone
    const dx = pd.x - player.x, dy = pd.y - player.y, ahead = dx * fx + dy * fy, lat = -dx * fy + dy * fx;
    if (Math.abs(sp) > 2 && ahead > 0 && ahead < 10 && Math.abs(lat) < 2.4) {
      const s = Math.sign(lat) || 1, tx = -fy * s * 3, ty = fx * s * 3;
      if (cell(pd.x + tx, pd.y + ty) !== 1) { pd.ox += (tx - pd.ox) * Math.min(1, dt * 4); pd.oy += (ty - pd.oy) * Math.min(1, dt * 4); }
    } else { pd.ox *= 1 - dt * 0.5; pd.oy *= 1 - dt * 0.5; }
    pd.x = ax + (bx - ax) * pd.d / L + pd.ox; pd.y = ay + (by - ay) * pd.d / L + pd.oy;
    if (Math.abs(sp) > 2.5 && dist(pd.x, pd.y, player.x, player.y) < 1.7) {
      pd.fall = 3; pd.ox += fx * 1.2; pd.oy += fy * 1.2; G.shake = 6;
      crime(seenBy(police) ? 'Hit a pedestrian' : 'Hit a pedestrian, passers-by called 110', seenBy(police) ? 2 : 1);
    }
  }
  // StVO §26: stop for anyone waiting at or on a zebra crossing
  if (Math.abs(sp) > 3) for (let z = 0; z < ZEBRAS.length; z += 2) {
    if (dist(ZEBRAS[z], ZEBRAS[z + 1], player.x, player.y) > 5) continue;
    if (peds.some(pd => !pd.fall && dist(pd.x, pd.y, ZEBRAS[z], ZEBRAS[z + 1]) < 4)) offence('Ignored a pedestrian at a zebra crossing', 80, '', 0.7);
  }
}
function drawPed(pd) {
  ctx.setTransform(S * 1.25, 0, 0, S * 1.25, sx(pd.x), sy(pd.y)); ctx.rotate(pd.a); // a touch larger than life, to read at a glance
  if (pd.fall > 0) { // knocked over, gets back up
    ctx.fillStyle = pd.col; ctx.beginPath(); ctx.ellipse(-0.3, 0, 0.6, 0.22, 0, 0, 7); ctx.fill();
    ctx.fillStyle = pd.hair; ctx.beginPath(); ctx.arc(0.4, 0, 0.12, 0, 7); ctx.fill(); return;
  }
  const sw = Math.sin(pd.ph) * 0.22;
  ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0.15, 0.12, 0.22, 0.3, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#222'; ctx.beginPath(); ctx.ellipse(sw, -0.1, 0.13, 0.07, 0, 0, 7); ctx.ellipse(-sw, 0.1, 0.13, 0.07, 0, 0, 7); ctx.fill(); // feet
  ctx.fillStyle = pd.col; ctx.beginPath(); ctx.ellipse(0, 0, 0.15, 0.26, 0, 0, 7); ctx.fill(); // shoulders
  ctx.beginPath(); ctx.arc(-sw * 0.8, -0.27, 0.07, 0, 7); ctx.arc(sw * 0.8, 0.27, 0.07, 0, 7); ctx.fill(); // arms
  ctx.fillStyle = pd.hair; ctx.beginPath(); ctx.arc(0.02, 0, 0.11, 0, 7); ctx.fill();
  if (pd.dog) {
    ctx.strokeStyle = '#333'; ctx.lineWidth = 0.03; ctx.beginPath(); ctx.moveTo(0, 0.25); ctx.lineTo(-0.9, 0.45); ctx.stroke();
    ctx.fillStyle = '#7a5532'; ctx.beginPath(); ctx.ellipse(-1.2, 0.45, 0.32, 0.12, 0, 0, 7); ctx.fill(); ctx.beginPath(); ctx.arc(-0.85, 0.45, 0.1, 0, 7); ctx.fill();
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
const G = { started: false, time: 0, money: 100, wanted: 0, stop: null, known: { x: 0, y: 0, t: -99 }, rolled: {}, sus: 0, limit: 50, area: AVG_AREA, areaT: 0, lastSeen: 0, crimeCd: 0, bustT: 0, grace: 0,
  job: null, nextOffer: 3, banner: '', bannerT: 0, shake: 0, distT: 0, D: null, spawnT: 0 };
const startNode = nearestNode(894, 928); // Kottbusser Tor
const player = makeCar('player', startNode, M.adj[startNode][0]);
player.color = '#9bd32d';
const shop = place(nearestNode(1930, 780)); // Wrangelkiez
const cars = [player];
let camX = player.x, camY = player.y, zoom = 16, zoomPref = 1; // zoom = CSS px per metre
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
// serious stuff (fleeing, ramming): the police actually hunt you
function crime(reason, stars = 1) {
  if (G.crimeCd > 0 || G.grace > 0) return;
  G.crimeCd = 4; G.lastSeen = G.time; G.known = { x: player.x, y: player.y, t: G.time };
  const first = G.wanted === 0;
  G.wanted = Math.min(5, G.wanted + stars);
  banner(reason + '!  ' + '★'.repeat(G.wanted));
  if (first) msg(FRED, `cops on ur tail? lose them or get a respray at ${shop.name} (€150)`);
}
// ---------- traffic rules (StVO), fines per Bußgeldkatalog (Pkw, innerorts, since 2021)
const SPEED_FINES = [[10, 30], [15, 50], [20, 70], [25, 115], [30, 180], [40, 260], [50, 400], [60, 560], [70, 700], [Infinity, 800]];
const speedFine = over => SPEED_FINES.find(([m]) => over <= m)[1];
console.assert(speedFine(12) === 50 && speedFine(26) === 180 && speedFine(99) === 800, 'speedFine');
function rules(sp) {
  const kmh = Math.abs(sp) * 3.6, r = nearestEdge(player.x, player.y, 10);
  if (r) G.limit = inWorks(player.x, player.y) ? Math.min(30, r.e.lim) : r.e.lim;
  // police deduct a 3 km/h tolerance below 100; nobody gets pulled over for 5 km/h
  const over = Math.floor(kmh - 3 - G.limit);
  // a patrol only bothers with clear speeding; nobody measures 8 km/h over by eye
  if (over > 10) offence('Speeding', speedFine(over), `${Math.round(kmh)} in a ${G.limit} zone`, over <= 20 ? 0.2 : over <= 30 ? 0.6 : 1);
  if (r && r.e.ow && sp > 2) {
    const dx = NX(r.e.b) - NX(r.e.a), dy = NY(r.e.b) - NY(r.e.a);
    if ((Math.cos(player.a) * dx + Math.sin(player.a) * dy) / Math.hypot(dx, dy) < -0.5) offence('Wrong way down a one-way street', 25, '', 0.35);
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
// a traffic offence only matters if a patrol sees it, and even then they use discretion: `chance` is rolled
// once, then that offence is left alone for 6 s. Busy patrols (on their way to a call) ignore traffic stuff.
function offence(reason, fine, detail = '', chance = 1) {
  if (G.wanted > 0 || G.stop || G.grace > 0 || (G.rolled[reason] || 0) > G.time) return;
  const cop = cars.find(p => p.kind === 'police' && !p.busy && sees(p));
  if (!cop) return;
  G.rolled[reason] = G.time + 6;
  if (Math.random() < chance) pullOver(cop, reason, fine, detail);
}
function pullOver(cop, reason, fine, detail = '') {
  G.stop = { cop, reason, fine, t: 0, check: 0 }; cop.stop = true;
  banner('POLICE: PULL OVER');
  msg('Polizei 🚓', `${reason}${detail ? ' (' + detail + ')' : ''}. Bitte folgen: pull over and stop.`);
}
function endStop() { if (G.stop) G.stop.cop.stop = false; G.stop = null; }
function updateStop(dt, sp) {
  const s = G.stop; if (!s) return;
  const d = dist(s.cop.x, s.cop.y, player.x, player.y);
  s.t += dt;
  if (!cars.includes(s.cop) || G.wanted > 0) return endStop();
  if (d > 150 || (s.check > 0.3 && sp > 3) || (s.t > 20 && !s.check)) { endStop(); crime('Fled a traffic stop', 2); return; }
  if (sp < 1 && d < 22) s.check += dt;
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
  G.money -= Math.min(G.money, fine); G.grace = 4;
  msg('Polizei 🚓', text); banner(fine ? '−€' + fine : 'Free to go');
  endStop();
}

function busted() {
  const fine = Math.min(G.money, 100 + 50 * G.wanted);
  G.money -= fine; G.wanted = 0; G.bustT = 0; G.grace = 5;
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

// ---------- simulation
const DT = 1 / 60, TRAFFIC = 128, PEDS = 90, PATROL = 1.5;
function spawn(kind, minR, maxR, cx = player.x, cy = player.y) {
  const n = randNode(cx, cy, minR, maxR, true, kind === 'traffic' && Math.random() < 0.65 ? BIG : MAIN);
  if (n < 0 || cars.some(c => dist(c.x, c.y, NX(n), NY(n)) < 7)) return null;
  const opts = M.adj[n].filter(m => legal(n, m));
  if (!opts.length) return null;
  const c = makeCar(kind, n, pick(opts)); cars.push(c); return c;
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
  // road distance field: towards you during a traffic stop (they're following you), towards your last known position in a pursuit
  if ((G.wanted > 0 || G.stop) && (G.distT -= dt) <= 0) {
    G.D = dijkstra(G.stop ? nearestNode(player.x, player.y) : nearestNode(G.known.x, G.known.y)); G.distT = 0.5;
  }

  // AI
  for (const c of cars) {
    if (c === player) continue;
    const toPlayer = dist(c.x, c.y, player.x, player.y);
    if (c.chase || c.stop) {
      c.blocked = c.hold = c.queued = false;
      const see = sees(c), fast = c.stop ? 12 : 15 + 2.5 * G.wanted;
      if (c.stop && see) {
        // traffic stop: follow ~12 m behind, park behind you once you've stopped
        if (toPlayer < 18 && Math.abs(speedOf(player)) < 3) { physics(c, speedOf(c) > 0.5 ? -1 : 0, 0, false, dt); continue; }
        const bx = player.x - Math.cos(player.a) * 12, by = player.y - Math.sin(player.a) * 12;
        if (toPlayer < 50) { steerTo(c, bx, by, toPlayer < 20 ? Math.max(3, Math.abs(speedOf(player))) : fast, dt); continue; }
      } else if (see && toPlayer < 50) { steerTo(c, player.x + player.vx * 0.4, player.y + player.vy * 0.4, fast, dt); continue; }
      // out of sight: drive to where you were last seen; after a few seconds, search the area around it
      if (c.chase && G.time - G.known.t > 4) {
        const R = searchRadius();
        if (!c.goalD || c.goalT < G.time || dist(c.x, c.y, NX(c.goal), NY(c.goal)) < 10) {
          const n = randNode(G.known.x, G.known.y, 0, R, false);
          if (n >= 0) { c.goal = n; c.goalD = dijkstra(n); c.goalT = G.time + 20; }
        }
        if (c.goalD) { follow(c, c.goalD, 10, dt); continue; }
      }
      if (G.D) follow(c, G.D, fast, dt); else steerTo(c, G.known.x, G.known.y, fast, dt);
    } else if (c.post) {
      physics(c, speedOf(c) > 0.3 ? -1 : 0, 0, false, dt); // parked at the Wache, watching
    } else {
      const [lx, ly] = lanePoint(c);
      if (dist(c.x, c.y, lx, ly) < 7) {
        const opts = M.adj[c.to].filter(n => n !== c.from && legal(c.to, n));
        const nxt = opts.length ? pick(opts) : c.from; c.from = c.to; c.to = nxt;
      }
      const fx = Math.cos(c.a), fy = Math.sin(c.a);
      const ahead = [...cars, ...buses].find(o => o !== c && Math.abs(o.x - c.x) < 14 && Math.abs(o.y - c.y) < 14 && (() => {
        // in my lane ahead: close in front and less than a lane width to the side (cars next to me don't count)
        const dx = o.x - c.x, dy = o.y - c.y, fwd = dx * fx + dy * fy;
        return fwd > 0 && fwd < (o.len ? o.len / 2 + 5 : 9) && Math.abs(-dx * fy + dy * fx) < (o.len ? 2.4 : 2);
      })());
      const ped = peds.some(pd => { const dx = pd.x - c.x, dy = pd.y - c.y, a = dx * fx + dy * fy; return a > 1 && a < 8 && Math.abs(-dx * fy + dy * fx) < 1.8; });
      // queue only behind someone going our way (head-on standoffs must resolve); give up after a full red phase
      const behind = !!ahead && Math.cos(ahead.a - c.a) > 0.5 && (ahead.hold || ahead.queued || ahead.len > 0);
      c.qT = ped || behind ? (c.qT || 0) + dt : 0;
      c.blocked = !!ahead || ped; c.queued = (ped || behind) && c.qT < 26;
      // red light: stop before the signal node we are heading to
      const j = SIG.get(c.to), dTo = dist(c.x, c.y, NX(c.to), NY(c.to));
      if (j && dTo < 4) c.lastJ = j; // already inside this junction: never stop again mid-crossing
      c.hold = !!j && j !== c.lastJ && dTo > 4 && dTo < 16 && light(j, c.a)[0] !== 'g';
      const edge = EDGES.length && nearestEdge(c.x, c.y, 10);
      steerTo(c, ...lanePoint(c), Math.min(c.kind === 'police' ? 10 : 9, (edge ? edge.e.lim : 50) / 3.6 * 0.95), dt);
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
      if (other.kind === 'police') { if (Math.abs(speedOf(player)) > 4) crime('Rammed a cop', 2); }
      else offence('Caused a collision', 35);
    }
  }

  // police logic
  const seen = seenBy(police), sp = Math.abs(speedOf(player));
  if (seen) { G.lastSeen = G.time; G.known = { x: player.x, y: player.y, t: G.time }; }
  if ((G.areaT -= dt) <= 0) { G.areaT = 1; G.area = areaAt(player.x, player.y); }
  rules(speedOf(player));
  updateStop(dt, sp);
  // smelly cargo makes nearby cops suspicious; enough suspicion and they do a check (not a chase)
  const cargo = G.job && G.job.stage === 'deliver' && G.job.f.smell * (0.5 + G.job.ripe);
  const sniffer = cargo && !G.stop && !G.wanted && police.find(p => !p.busy && dist(p.x, p.y, player.x, player.y) < 15 + 25 * cargo && sees(p));
  G.sus = clamp(G.sus + (sniffer ? dt * cargo * (0.25 + 0.04 * G.area.drugs) : -dt * 0.1), 0, 1);
  if (G.sus >= 1) { G.sus = 0; pullOver(sniffer, 'Routine check', 0); }
  // out of sight long enough: one star at a time, they give up
  if (G.wanted > 0 && G.time - G.lastSeen > 18 + 6 * G.wanted) {
    G.wanted--; G.lastSeen = G.time;
    banner(G.wanted ? 'They\'re losing interest…  ' + '★'.repeat(G.wanted) : 'Search called off');
  }
  if (G.wanted > 0 && dist(player.x, player.y, shop.x, shop.y) < 10 && sp < 4 && !seen) {
    if (G.money >= 150) {
      G.money -= 150; G.wanted = 0; G.grace = 3;
      player.color = pick(['#9bd32d', '#e86f2d', '#3fa7d6', '#d64fa0', '#f2d43a']);
      banner('Fresh paint. Cops lost you.  −€150');
    } else if (G.bannerT <= 0) banner('Respray costs €150');
  }
  // radio call: units within 400 m of the reported position join after a few seconds; a cop who sees you joins at once
  police.forEach(p => {
    if (!G.wanted) { p.chase = false; p.radio = 0; p.goalD = null; return; }
    if (p.chase) return;
    if (sees(p)) { p.chase = true; p.post = false; return; }
    if (dist(p.x, p.y, G.known.x, G.known.y) < 400) { p.radio = (p.radio || rnd(3, 7)) - dt; if (p.radio <= 0) { p.chase = true; p.post = false; } }
  });
  const near = police.some(p => p.chase && dist(p.x, p.y, player.x, player.y) < 7 && sees(p));
  G.bustT = near && sp < 1.5 && G.wanted > 0 ? G.bustT + dt : Math.max(0, G.bustT - dt);
  if (G.bustT > 1.5) busted();

  // population: despawn far cars, spawn near the player but off screen
  for (let i = cars.length - 1; i > 0; i--) {
    const c = cars[i], d = dist(c.x, c.y, player.x, player.y);
    if (d > 300 && !onScreen(c.x, c.y, 30) && !c.post && !((c.chase || c.stop) && d < 900)) cars.splice(i, 1);
  }
  if ((G.spawnT -= dt) <= 0) {
    G.spawnT = 0.15;
    // patrol density follows the real crime rate of the Bezirksregion you're in
    // patrol density follows the real crime rate of the Bezirksregion you're in; extra units head for the reported position
    const want = Math.round(PATROL + 1.5 * G.area.all) + (G.wanted ? G.wanted * 1.5 | 0 : 0);
    if (cars.filter(c => c.kind === 'police' && !c.post).length < want)
      G.wanted ? spawn('police', 150, 350, G.known.x, G.known.y) : spawn('police', 200, 400);
    for (let k = 0; k < 3 && cars.filter(c => c.kind === 'traffic').length < TRAFFIC; k++) spawn('traffic', 45, 260);
  }
  updateBuses(dt);
  updatePeds(dt, police);
  if (peds.length < PEDS) spawnPed();
  updateJob(dt);
}
function seenBy(police) { return police.some(p => sees(p)); }
const searchRadius = () => clamp(40 + 5 * (G.time - G.known.t), 40, 260);
function follow(c, D, speed, dt) { // drive downhill on a road distance field
  if (dist(c.x, c.y, NX(c.to), NY(c.to)) > 40) c.to = nearestNode(c.x, c.y);
  if (dist(c.x, c.y, NX(c.to), NY(c.to)) < 8) {
    let best = c.to; for (const nb of M.adj[c.to]) if (D[nb] < D[best]) best = nb;
    if (best === c.to) { c.goalT = 0; steerTo(c, NX(c.to), NY(c.to), 5, dt); return; }
    c.from = c.to; c.to = best;
  }
  steerTo(c, NX(c.to), NY(c.to), speed, dt);
}

// ---------- rendering
// ground tiles: 64 m, sharp enough for the close camera on retina screens
const TILE = 64, RES = Math.min(16, Math.ceil(9 * DPR)), tiles = new Map();
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
  g.setLineDash([]);
  // tracks at street level (S-Bahn, U-Bahn ramps)
  for (const r of M.rails) if (!r.v && inT(bbox(r.p))) {
    g.strokeStyle = '#7d7466'; g.lineWidth = 3.6; trace(g, r.p); g.stroke();
    g.strokeStyle = '#4a4540'; g.lineWidth = 2.6; g.setLineDash([0.25, 0.6]); trace(g, r.p); g.stroke(); g.setLineDash([]);
    g.strokeStyle = '#b8b8b8'; g.lineWidth = 1.65; trace(g, r.p); g.stroke(); // two rails = wide grey line minus a narrower inner one
    g.strokeStyle = '#6a625a'; g.lineWidth = 1.35; trace(g, r.p); g.stroke();
  }
  // parked cars
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const k of PGRID.get((i + di) + ',' + (j + dj)) || []) {
    const x = PARKED[k], y = PARKED[k + 1];
    if (x < x0 - 3 || x > x1 + 3 || y < y0 - 3 || y > y1 + 3) continue;
    g.save(); g.translate(x, y); g.rotate(PARKED[k + 2]); carBody(g, PAINT[PARKED[k + 3] * PAINT.length | 0]); g.restore();
  }
  // pedestrian crossings: zebra (stripes along the road) or signalled Fußgängerfurt (two dashed lines)
  for (let i = 0; i < M.crossings.length; i += 2) {
    const n = M.crossings[i], x = NX(n), y = NY(n);
    if (x < x0 - 10 || x > x1 + 10 || y < y0 - 10 || y > y1 + 10) continue;
    const nb = M.adj[n][0]; if (nb === undefined) continue;
    g.save(); g.translate(x, y); g.rotate(Math.atan2(NY(nb) - y, NX(nb) - x)); g.fillStyle = COL.mark;
    if (M.crossings[i + 1] === 1) for (let k = -4; k <= 4; k++) g.fillRect(-1.5, k - 0.25, 3, 0.5);
    else for (const o of [-2, 1.6]) for (let k = -4.5; k < 4.5; k += 1) g.fillRect(o, k, 0.4, 0.5);
    g.restore();
  }
  // bus stops: the Berlin "H" sign
  for (let i = 0; i < M.stops.length; i += 2) {
    const x = M.stops[i], y = M.stops[i + 1];
    if (x < x0 - 5 || x > x1 + 5 || y < y0 - 5 || y > y1 + 5) continue;
    g.fillStyle = '#f2c200'; g.beginPath(); g.arc(x, y, 0.9, 0, 7); g.fill();
    g.fillStyle = '#1e7a3c'; g.font = 'bold 1.3px sans-serif'; g.textAlign = 'center'; g.fillText('H', x, y + 0.45);
  }
  // live roadworks: closures become a fenced building site, other works get yellow temporary markings and cones
  for (const w of WORKS) if (inT(w.bb)) {
    if (w.closed) {
      g.strokeStyle = '#fff'; g.lineWidth = 8; trace(g, w.pts); g.stroke();
      g.strokeStyle = '#d0021b'; g.setLineDash([1.2, 1.2]); trace(g, w.pts); g.stroke(); g.setLineDash([]);
      g.strokeStyle = '#a88f68'; g.lineWidth = 6.6; trace(g, w.pts); g.stroke();
    } else {
      g.strokeStyle = '#f2c200'; g.lineWidth = 0.3; g.setLineDash([3, 2]); trace(g, w.pts); g.stroke(); g.setLineDash([]);
    }
    const p = w.pts;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const L = dist(p[i], p[i + 1], p[i + 2], p[i + 3]);
      for (let d = 0; d < L; d += w.closed ? 3 : 6) {
        const x = p[i] + (p[i + 2] - p[i]) * d / L, y = p[i + 1] + (p[i + 3] - p[i + 1]) * d / L;
        g.fillStyle = '#ff6a00'; g.beginPath(); g.arc(x, y, 0.4, 0, 7); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 0.18, 0, 7); g.fill();
      }
    }
  }
  return c;
}
function tile(i, j) {
  const k = i + ',' + j; let t = tiles.get(k);
  if (t) { tiles.delete(k); tiles.set(k, t); return t; }
  if (tile.budget-- <= 0) return null; // shortcut: max 2 new tiles per frame, rest pops in a frame later
  t = makeTile(i, j); tiles.set(k, t);
  if (tiles.size > 48) tiles.delete(tiles.keys().next().value);
  return t;
}
const CAMH = 240; // virtual camera height for the leaning-building effect (lower = more lean)
const lean = h => CAMH / (CAMH - Math.min(h, 80));
const sx = x => VW / 2 + (x - camX) * S, sy = y => VH / 2 + (y - camY) * S;
// tree canopy sprites, lit from the south-west
const TREES = [0, 1, 2, 3].map(v => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const base = [[74, 112, 52], [62, 102, 48], [88, 120, 56], [70, 96, 60]][v];
  for (let k = 0; k < 9; k++) {
    const a = hash(v * 31 + k) * 6.28, r = k ? 9 + 6 * hash(v * 7 + k) : 22, d = k ? 13 + 5 * hash(k + v) : 0;
    const x = 32 + Math.cos(a) * d, y = 32 + Math.sin(a) * d;
    const gr = g.createRadialGradient(x - r * 0.4, y + r * 0.4, 1, x, y, r);
    gr.addColorStop(0, `rgb(${base.map(c => c * 1.45 | 0)})`); gr.addColorStop(1, `rgb(${base.map(c => c * 0.75 | 0)})`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  }
  return c;
});
const TREE_R = []; for (let i = 0; i < M.trees.length; i += 3) TREE_R.push(M.trees[i + 2] || 2.8 + 2.2 * hash(i));
const shc = document.createElement('canvas'), shx = shc.getContext('2d');
function visible(bb, hw, hh) { return bb[2] > camX - hw && bb[0] < camX + hw && bb[3] > camY - hh && bb[1] < camY + hh; }

// ground shadows of buildings, trees and the viaduct, drawn opaque into one layer and blended once
function drawShadows(vis, hw, hh) {
  if (shc.width !== VW || shc.height !== VH) { shc.width = VW; shc.height = VH; }
  shx.setTransform(1, 0, 0, 1, 0, 0); shx.clearRect(0, 0, VW, VH); shx.fillStyle = '#000';
  const sh = h => [-SUN[0] * h * 0.55 * S, -SUN[1] * h * 0.55 * S];
  for (const b of vis) {
    const [ox, oy] = sh(b.h), steps = Math.ceil(Math.hypot(ox, oy) / (2 * S)) || 1, p = b.p;
    shx.beginPath(); // union of the footprint swept along the shadow vector
    for (let s = 0; s <= steps; s++) {
      const dx = ox * s / steps, dy = oy * s / steps;
      shx.moveTo(sx(p[0]) + dx, sy(p[1]) + dy); for (let i = 2; i < p.length; i += 2) shx.lineTo(sx(p[i]) + dx, sy(p[i + 1]) + dy); shx.closePath();
    }
    shx.fill();
  }
  shx.beginPath();
  for (let i = 0, t = 0; i < M.trees.length; i += 3, t++) {
    const x = M.trees[i], y = M.trees[i + 1], r = TREE_R[t];
    if (Math.abs(x - camX) > hw + 20 || Math.abs(y - camY) > hh + 20) continue;
    const [ox, oy] = sh(5); shx.moveTo(sx(x) + ox + r * 0.6 * S, sy(y) + oy); shx.arc(sx(x) + ox, sy(y) + oy, r * 0.6 * S, 0, 6.29);
  }
  shx.fill();
  const [ox, oy] = sh(7);
  shx.strokeStyle = '#000'; shx.lineWidth = 7 * S;
  for (const r of M.rails) if (r.v && visible(r.bb, hw + 20, hh + 20)) { shx.beginPath(); shx.moveTo(sx(r.p[0]) + ox, sy(r.p[1]) + oy); for (let i = 2; i < r.p.length; i += 2) shx.lineTo(sx(r.p[i]) + ox, sy(r.p[i + 1]) + oy); shx.stroke(); }
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 0.26; ctx.drawImage(shc, 0, 0); ctx.globalAlpha = 1;
}
// a point at height h above (x,y), with the same perspective lean as buildings
const up = (x, y, h) => { const f = lean(h); return [VW / 2 + (x - camX) * S * f, VH / 2 + (y - camY) * S * f]; };
function drawViaduct(hw, hh) {
  // U1/U3 Hochbahn: dark green steel deck on pillars, 7 m above Skalitzer Straße
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
  const f = lean(7), path = r => { ctx.beginPath(); for (let i = 0; i < r.p.length; i += 2) ctx.lineTo(...up(r.p[i], r.p[i + 1], 7)); };
  const vis = M.rails.filter(r => r.v && visible(r.bb, hw + 20, hh + 20));
  // see-through while you drive underneath
  const under = vis.some(r => segDist(r.p, player.x, player.y) < 9) || M.decks.some(d => inPoly(d, player.x, player.y));
  ctx.globalAlpha = under ? 0.4 : 1;
  ctx.strokeStyle = '#3c4639'; ctx.lineWidth = 8 * S * f; for (const r of vis) { path(r); ctx.stroke(); }
  ctx.strokeStyle = '#56624f'; ctx.lineWidth = 6.6 * S * f; for (const r of vis) { path(r); ctx.stroke(); }
  ctx.strokeStyle = '#6d6a62'; ctx.lineWidth = 0.25 * S * f; ctx.setLineDash([0.4 * S, 0.5 * S]);
  ctx.lineWidth = 2.4 * S * f; for (const r of vis) { path(r); ctx.stroke(); } ctx.setLineDash([]);
  for (const d of M.decks) {
    if (!visible(d.bb || (d.bb = bbox(d)), hw + 20, hh + 20)) continue;
    ctx.beginPath(); for (let i = 0; i < d.length; i += 2) ctx.lineTo(...up(d[i], d[i + 1], 8)); ctx.closePath();
    ctx.fillStyle = '#56624f'; ctx.fill(); ctx.strokeStyle = '#3c4639'; ctx.lineWidth = 2 * DPR; ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
// snap a train to the nearest track (viaduct for U-Bahn); -> [x, y, angle] or null
function snapRail(b) {
  let best = null, bd = 40;
  for (const r of M.rails) {
    if (b.name.startsWith('U') !== !!r.v) continue;
    const p = r.p;
    if (b.x < r.bb[0] - 40 || b.x > r.bb[2] + 40 || b.y < r.bb[1] - 40 || b.y > r.bb[3] + 40) continue;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1], l2 = dx * dx + dy * dy || 1;
      const t = clamp(((b.x - p[i]) * dx + (b.y - p[i + 1]) * dy) / l2, 0, 1), x = p[i] + dx * t, y = p[i + 1] + dy * t, d = dist(b.x, b.y, x, y);
      if (d < bd) { bd = d; let a = Math.atan2(dy, dx); if (Math.cos(a - b.a) < 0) a += Math.PI; best = [x, y, a]; }
    }
  }
  return best;
}
function drawVehicle(b, x, y, a, h) { // BVG bus or train, h = height above ground (perspective)
  const f = lean(h), k = S * f;
  ctx.setTransform(k, 0, 0, k, VW / 2 + (x - camX) * k, VH / 2 + (y - camY) * k); ctx.rotate(a);
  const L = b.len, hl = L / 2, wd = b.train ? 2.65 : 2.55;
  if (!h) { ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(-hl + 0.4, -wd / 2 + 0.4, L, wd); }
  const body = b.train ? (b.name.startsWith('S') ? '#b5332e' : '#f2cd00') : '#f2cd00';
  ctx.fillStyle = body; ctx.beginPath(); ctx.roundRect(-hl, -wd / 2, L, wd, 0.6); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-hl + 0.6, -wd / 2 + 0.35, L - 1.2, wd - 0.7); // roof
  ctx.fillStyle = '#1d2633'; ctx.fillRect(hl - 0.9, -wd / 2 + 0.2, 0.6, wd - 0.4); // windscreen
  if (b.train || L > 15) { ctx.fillStyle = 'rgba(0,0,0,.4)'; for (let s = -hl + (b.train ? 12.5 : 7); s < hl - 1; s += b.train ? 12.5 : 99) ctx.fillRect(s - 0.15, -wd / 2, 0.3, wd); }
  ctx.fillStyle = '#111'; ctx.font = 'bold 1.6px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(b.name, 0, 0); ctx.textBaseline = 'alphabetic';
}
function drawTrees(hw, hh) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0, t = 0; i < M.trees.length; i += 3, t++) {
    const x = M.trees[i], y = M.trees[i + 1], r = TREE_R[t];
    if (Math.abs(x - camX) > hw + 10 || Math.abs(y - camY) > hh + 10) continue;
    const [px, py] = up(x, y, 10), R = r * S * lean(10);
    ctx.globalAlpha = dist(x, y, player.x, player.y) < r + 4 ? 0.35 : 0.95; // see your car under the canopy
    ctx.drawImage(TREES[t & 3], px - R, py - R, 2 * R, 2 * R);
  }
  ctx.globalAlpha = 1;
}
function drawSignals(hw, hh) {
  for (const [n, j] of SIG) {
    const x = NX(n), y = NY(n);
    if (Math.abs(x - camX) > hw || Math.abs(y - camY) > hh) continue;
    const nb = M.adj[n][0] ?? n, a = Math.atan2(NY(nb) - y, NX(nb) - x), [st] = light(j, a);
    ctx.setTransform(S, 0, 0, S, sx(x), sy(y)); ctx.rotate(a);
    ctx.fillStyle = '#1b1b1b'; ctx.fillRect(-0.5, -1.1, 1, 2.2);
    for (const [k, c] of [[-0.7, 'r'], [0, 'y'], [0.7, 'g']]) {
      ctx.fillStyle = st === c ? { r: '#ff3020', y: '#ffb000', g: '#30e060' }[c] : '#333';
      ctx.beginPath(); ctx.arc(0, k, 0.3, 0, 7); ctx.fill();
    }
  }
}
// facade pattern mapped affinely onto the wall quad (ground edge gi->gj, up vector u), from height y0 to y1 metres
function facade(P, gx, gy, ex, ey, L, ux, uy, h, y0, y1) {
  const a = y0 / h, b = y1 / h;
  ctx.beginPath();
  ctx.moveTo(gx + ux * a, gy + uy * a); ctx.lineTo(gx + ex + ux * a, gy + ey + uy * a);
  ctx.lineTo(gx + ex + ux * b, gy + ey + uy * b); ctx.lineTo(gx + ux * b, gy + uy * b);
  const ku = P.cw / (L * 64), kv = P.ch / (h * 64);
  P.p.setTransform(new DOMMatrix([ex * ku, ey * ku, ux * kv, uy * kv, gx + ux * a, gy + uy * a]));
  ctx.fillStyle = P.p; ctx.fill();
}
function drawBuildings(hw, hh) {
  const cx = VW / 2, cy = VH / 2;
  const vis = M.buildings.filter(b => visible(b.bb, hw, hh));
  vis.sort((a, b) => dist(b.cx, b.cy, camX, camY) - dist(a.cx, a.cy, camX, camY));
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.lineJoin = 'round';
  for (const b of vis) {
    const p = b.p, k = p.length / 2, f = lean(b.h);
    const gx = [], gy = [], rx = [], ry = [];
    for (let i = 0; i < k; i++) {
      const dx = (p[2 * i] - camX) * S, dy = (p[2 * i + 1] - camY) * S;
      gx.push(cx + dx); gy.push(cy + dy); rx.push(cx + dx * f); ry.push(cy + dy * f);
    }
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k;
      const area = (gx[i] * gy[j] - gx[j] * gy[i]) + (gx[j] * ry[j] - rx[j] * gy[j]) + (rx[j] * ry[i] - rx[i] * ry[j]) + (rx[i] * gy[i] - gx[i] * ry[i]);
      if (Math.sign(area) !== b.ws) continue; // wall faces away from the camera
      const quad = () => { ctx.beginPath(); ctx.moveTo(gx[i], gy[i]); ctx.lineTo(gx[j], gy[j]); ctx.lineTo(rx[j], ry[j]); ctx.lineTo(rx[i], ry[i]); };
      quad(); ctx.fillStyle = b.fac; ctx.fill();
      const ux = rx[i] - gx[i], uy = ry[i] - gy[i], ex = gx[j] - gx[i], ey = gy[j] - gy[i];
      if (b.len[i] > 2.5 && Math.hypot(ux, uy) > 5) {
        if (b.street[i] === undefined) { // does this wall face a street? (shops go there)
          const mx = (p[2 * i] + p[2 * j]) / 2 + (p[2 * j + 1] - p[2 * i + 1]) * b.ws / b.len[i] * 5;
          const my = (p[2 * i + 1] + p[2 * j + 1]) / 2 - (p[2 * j] - p[2 * i]) * b.ws / b.len[i] * 5;
          b.street[i] = !!nearestEdge(mx, my, 9);
        }
        const shop = b.shop && b.street[i] && b.h > 7;
        if (shop) facade(b.shop, gx[i], gy[i], ex, ey, b.len[i], ux, uy, b.h, 0, 3.8);
        facade(b.pat, gx[i], gy[i], ex, ey, b.len[i], ux, uy, b.h, shop ? 3.8 : 0, b.h - 0.6);
      }
      quad(); ctx.fillStyle = `rgba(20,24,32,${b.shade[i]})`; ctx.fill();
    }
    // roof: flat top, plus a sloped band along every edge (mansard / pitched), lit by orientation
    ctx.beginPath(); ctx.moveTo(rx[0], ry[0]); for (let i = 1; i < k; i++) ctx.lineTo(rx[i], ry[i]); ctx.closePath();
    ctx.fillStyle = b.roof; ctx.fill();
    if (b.band) {
      ctx.save(); ctx.clip(); ctx.lineCap = 'square'; ctx.lineWidth = 2 * b.bandD * S * f;
      for (let i = 0; i < k; i++) {
        const j = (i + 1) % k;
        ctx.strokeStyle = rgb(b.band, 1.15 - b.shade[i] * 1.6);
        ctx.beginPath(); ctx.moveTo(rx[i], ry[i]); ctx.lineTo(rx[j], ry[j]); ctx.stroke();
      }
      ctx.restore();
      ctx.beginPath(); ctx.moveTo(rx[0], ry[0]); for (let i = 1; i < k; i++) ctx.lineTo(rx[i], ry[i]); ctx.closePath();
    }
    ctx.strokeStyle = b.edge; ctx.lineWidth = 1.5 * DPR; ctx.stroke();
    if (S > 6 * DPR) for (const [x, y, a, t] of b.bits) { // roof furniture only when zoomed in enough to see it
      const [px, py] = up(x, y, b.h + 1), k2 = S * lean(b.h + 1);
      ctx.setTransform(k2, 0, 0, k2, px, py); ctx.rotate(a);
      if (t === 'chimney') { ctx.fillStyle = '#7a4a3a'; ctx.fillRect(-0.45, -0.35, 0.9, 0.7); ctx.fillStyle = '#222'; ctx.fillRect(-0.25, -0.15, 0.5, 0.3); }
      else if (t === 'dish') { ctx.fillStyle = '#eee'; ctx.beginPath(); ctx.arc(0, 0, 0.45, 0, 7); ctx.fill(); ctx.fillStyle = '#bbb'; ctx.fillRect(-0.05, 0, 0.1, 0.5); }
      else { ctx.fillStyle = '#9a9a98'; ctx.fillRect(-1.5, -1, 3, 2); ctx.fillStyle = '#b8b8b4'; ctx.fillRect(-1.5, -1, 3, 0.5); }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  }
}
// a car seen from above, 4.6 x 2 m, nose towards +x (also used for parked cars in the tiles)
function carBody(g, color, braking) {
  g.fillStyle = 'rgba(0,0,0,.35)'; g.beginPath(); g.roundRect(-2.15, -0.75, 4.7, 2.05, 0.6); g.fill();
  g.fillStyle = color; g.beginPath(); g.roundRect(-2.3, -1, 4.6, 2, 0.55); g.fill();
  g.fillStyle = 'rgba(255,255,255,.18)'; g.beginPath(); g.roundRect(-2.2, -0.95, 4.4, 0.6, 0.4); g.fill(); // light from the side
  g.fillStyle = '#1d2633'; g.beginPath(); g.roundRect(0.35, -0.82, 0.95, 1.64, 0.25); g.fill(); // windscreen
  g.beginPath(); g.roundRect(-1.75, -0.78, 0.6, 1.56, 0.2); g.fill(); // rear window
  g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(-1.15, -0.8, 1.5, 1.6); // roof
  g.fillStyle = color; g.fillRect(0.6, -1.12, 0.25, 0.14); g.fillRect(0.6, 0.98, 0.25, 0.14); // mirrors
  g.fillStyle = '#fff6c8'; g.fillRect(2.1, -0.85, 0.2, 0.42); g.fillRect(2.1, 0.43, 0.2, 0.42);
  g.fillStyle = braking ? '#ff2a1a' : '#8a1c14'; g.fillRect(-2.32, -0.85, 0.16, 0.4); g.fillRect(-2.32, 0.45, 0.16, 0.4);
}
function drawCar(c) {
  ctx.setTransform(S, 0, 0, S, VW / 2 + (c.x - camX) * S, VH / 2 + (c.y - camY) * S); ctx.rotate(c.a);
  carBody(ctx, c.color, c.braking);
  if (c.kind === 'police') {
    ctx.fillStyle = '#1f4fa3'; ctx.fillRect(-2.3, -0.2, 4.6, 0.4);
    const lit = c.chase || c.stop, on = (G.time * 7 | 0) % 2; // German Blaulicht: blue only
    ctx.fillStyle = lit ? (on ? '#7fb2ff' : '#1d4fd8') : '#8a93a3'; ctx.fillRect(-0.6, -0.8, 0.45, 0.8);
    ctx.fillStyle = lit ? (on ? '#1d4fd8' : '#7fb2ff') : '#8a93a3'; ctx.fillRect(-0.6, 0, 0.45, 0.8);
    if (lit) { ctx.fillStyle = `rgba(80,140,255,${on ? 0.25 : 0.12})`; ctx.beginPath(); ctx.arc(-0.4, 0, 4, 0, 7); ctx.fill(); }
    if (c.stop) { // roof display "STOP POLIZEI", readable from behind
      ctx.rotate(-c.a); ctx.fillStyle = '#111'; ctx.fillRect(-2.2, -3.6, 4.4, 1.4);
      ctx.fillStyle = (G.time * 2 | 0) % 2 ? '#ff3b2a' : '#ffd23f'; ctx.font = 'bold 0.9px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText((G.time * 0.7 | 0) % 2 ? 'STOP' : 'POLIZEI', 0, -2.55);
    }
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
  // close in when slow, pull back a bit at speed; +/- keys scale it
  zoom += ((17 - clamp(sp / 25, 0, 1) * 6) * zoomPref - zoom) * 0.03; S = zoom * DPR;
  camX += (player.x + player.vx * 1.1 - camX) * 0.08; camY += (player.y + player.vy * 1.1 - camY) * 0.08;
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

  drawSignals(hw, hh);
  for (const pd of peds) if (onScreen(pd.x, pd.y, 2)) drawPed(pd);
  for (const b of buses) if (!b.train && onScreen(b.x, b.y, 12)) drawVehicle(b, b.x, b.y, b.a, 0);
  for (const c of cars) if (onScreen(c.x, c.y, 5)) drawCar(c);
  const vis = M.buildings.filter(b => visible(b.bb, hw + 40, hh + 40));
  drawShadows(vis, hw, hh);
  drawViaduct(hw, hh);
  for (const b of buses) if (b.train && onScreen(b.x, b.y, 30)) { const s = snapRail(b); if (s) drawVehicle(b, s[0], s[1], s[2], b.name.startsWith('U') ? 7.5 : 0); }
  drawTrees(hw, hh);
  drawBuildings(hw, hh);

  const j = G.job;
  if (j && j.stage === 'pickup') drawTarget(j.pickup, '#ffd23f', `PICKUP ${Math.round(dist(player.x, player.y, j.pickup.x, j.pickup.y))} m`);
  if (j && j.stage === 'deliver') drawTarget(j.drop, '#9bd32d', `DROP ${Math.round(dist(player.x, player.y, j.drop.x, j.drop.y))} m`);
  if (G.wanted > 0) drawTarget(shop, '#d64fa0', 'SPRAY');
  if (G.wanted > 0 && G.time - G.lastSeen > 1.5) { // where they think you are
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.beginPath(); ctx.arc(sx(G.known.x), sy(G.known.y), searchRadius() * S, 0, 7);
    ctx.fillStyle = 'rgba(60,120,255,.07)'; ctx.fill();
    ctx.strokeStyle = 'rgba(90,150,255,.6)'; ctx.lineWidth = 2 * DPR; ctx.setLineDash([10 * DPR, 8 * DPR]); ctx.stroke(); ctx.setLineDash([]);
  }
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
  const kmh = Math.round(Math.abs(speedOf(player)) * 3.6);
  $('speed').textContent = kmh + ' km/h';
  $('speed').style.color = kmh - 3 - G.limit > 10 ? '#ff4a3a' : kmh - 3 > G.limit ? '#ffb000' : '#fff';
  $('limit').textContent = G.limit;
  const a = G.area;
  $('area').textContent = a === AVG_AREA ? '' : `📍 ${a.n} · crime ×${a.all} · drug offences ×${a.drugs} (Berlin = 1)`;
  $('sus').style.display = G.sus > 0.02 ? 'block' : 'none'; $('sus').querySelector('i').style.width = G.sus * 100 + '%';
  const st = v => v === null ? '…' : v;
  $('live').textContent = `Live: 🚌 ${st(LIVE.bvg)} BVG vehicles · 🚧 ${st(LIVE.works)} roadworks · crime data PKS ${M.crimeYear}`;
  const j = G.job;
  $('goal').textContent = G.wanted ? (G.time - G.lastSeen < 1.5 ? '🚨 They can see you!' : `🔍 Police searching the area. Stay out of sight (${Math.max(0, Math.ceil(18 + 6 * G.wanted - (G.time - G.lastSeen)))} s)`) : G.stop ? (G.stop.check > 0 ? '🚓 Police check…' : '🚓 Pull over and stop!') : !j ? 'Waiting for messages…' : j.stage === 'offer' ? 'New request! [Y] / [N]' : j.stage === 'pickup' ? '→ Pick up at ' + j.pickup.name : '→ Deliver to ' + j.drop.name;
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
  if (e.key === '+' || e.key === '=') zoomPref = Math.min(1.6, zoomPref * 1.12);
  if (e.key === '-') zoomPref = Math.max(0.35, zoomPref / 1.12);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
loadWorks(); pollBVG();
for (let k = 0; k < TRAFFIC; k++) spawn('traffic', 45, 260); // the city is already busy when you arrive
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
