'use strict';
// 2D maps for Obst-Taxi: the round minimap (turns with the camera, heading up) and the big north-up map (key M).
// Loaded before game.js: functions here use game globals (M, player, cars, G, ...) only when they are called.

// ---------- minimap: turns with the camera (your heading points up), about 500 m across
const mini = document.getElementById('mini'), mctx = mini.getContext('2d');
const MINI = new Map(), MB = 0.5, MC5 = 512; // base map: 0.5 px per metre, in 512 m chunks drawn on first use
function miniBase(i, j) {
  const k = i + ',' + j; let c = MINI.get(k);
  if (c) return c;
  const x0 = i * MC5, y0 = j * MC5, q = kind => query(kind, x0 - 10, y0 - 10, x0 + MC5 + 10, y0 + MC5 + 10);
  c = document.createElement('canvas'); c.width = c.height = MC5 * MB;
  const g = c.getContext('2d'); g.setTransform(MB, 0, 0, MB, -x0 * MB, -y0 * MB); g.lineCap = g.lineJoin = 'round';
  g.fillStyle = '#2a4634'; g.fillRect(x0, y0, MC5, MC5);
  g.fillStyle = '#3f6f45'; for (const a of q('green')) { trace(g, a.p, 1); g.fill(); }
  g.fillStyle = '#2f7c84'; for (const w of q('water')) { trace(g, w.p, 1); g.fill(); }
  g.fillStyle = '#1d3326'; for (const b of q('bs')) { trace(g, b.p, 1); g.fill(); }
  for (const r of q('roads').sort((a, b) => a.rk - b.rk)) if (r.car) { g.strokeStyle = ['primary', 'secondary', 'tertiary'].includes(r.t) ? '#e8d9a8' : '#a9b3a6'; g.lineWidth = Math.max(5, r.w * .8); trace(g, r.p); g.stroke(); }
  if (MINI.size > 160) MINI.delete(MINI.keys().next().value);
  MINI.set(k, c); return c;
}
function drawMini() {
  const dpr = devicePixelRatio || 1, size = Math.round(mini.clientWidth * dpr);
  if (!size) return;
  if (mini.width !== size) mini.width = mini.height = size;
  const g = mctx, k = size / 500, e = size / 2 - k * (player.x * RX + player.y * RY), f = size / 2 - k * (player.x * DX + player.y * DY);
  const mp = (x, y) => [k * (x * RX + y * RY) + e, k * (x * DX + y * DY) + f];
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#132a1e'; g.fillRect(0, 0, size, size);
  g.setTransform(k * RX, k * DX, k * RY, k * DY, e, f);
  for (let i = Math.floor((player.x - 420) / MC5); i <= Math.floor((player.x + 420) / MC5); i++) for (let j = Math.floor((player.y - 420) / MC5); j <= Math.floor((player.y + 420) / MC5); j++)
    if (i >= 0 && j >= 0 && i * MC5 < M.w && j * MC5 < M.h) g.drawImage(miniBase(i, j), i * MC5, j * MC5, MC5, MC5);
  g.setTransform(1, 0, 0, 1, 0, 0);
  const dot = (x, y, r, col, edge) => {
    let [px, py] = mp(x, y); const m = 8 * dpr;
    if (edge) { px = clamp(px, m, size - m); py = clamp(py, m, size - m); }
    else if (px < 0 || py < 0 || px > size || py > size) return;
    g.fillStyle = col; g.beginPath(); g.arc(px, py, r * dpr, 0, 7); g.fill(); g.strokeStyle = '#132a1e'; g.lineWidth = 1.5 * dpr; g.stroke();
  };
  if (G.wanted > 0 && G.time - G.lastSeen > 1.5) {
    const [px, py] = mp(G.known.x, G.known.y), r = searchRadius() * k;
    g.strokeStyle = 'rgba(110,160,255,.8)'; g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.arc(px, py, r, 0, 7); g.stroke(); g.setLineDash([]);
  }
  const j = G.job;
  if (j && j.stage === 'pickup') dot(j.pickup.x, j.pickup.y, 5, '#ffd60a', true);
  if (j && j.stage === 'deliver') dot(j.drop.x, j.drop.y, 5, '#9bd32d', true);
  if (G.wanted > 0) dot(shop.x, shop.y, 4, '#d64fa0', true);
  for (const c of cars) if (c.kind === 'police') dot(c.x, c.y, 3, c.chase || c.stop || c.block ? ((G.time * 4 | 0) % 2 ? '#ff4a3a' : '#4a8cff') : '#4a8cff');
  if (G.heli) dot(G.heli.x, G.heli.y, 4, '#ffffff');
  // you: an arrow along your heading, turned into the minimap's frame
  const [px, py] = mp(player.x, player.y), hx = Math.cos(player.a), hy = Math.sin(player.a), dx = hx * RX + hy * RY, dy = hx * DX + hy * DY, dl = Math.hypot(dx, dy) || 1;
  g.setTransform(dpr, 0, 0, dpr, px, py); g.rotate(Math.atan2(dy / dl, dx / dl));
  g.fillStyle = '#f3efe4'; g.strokeStyle = '#132a1e'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(7, 0); g.lineTo(-5, -5); g.lineTo(-2, 0); g.lineTo(-5, 5); g.closePath(); g.fill(); g.stroke();
}

// ---------- the big map (key M): north up, drag to move, wheel or +/- to zoom. The game is paused while it's open.
const bigC = document.getElementById('bigmap'), bctx = bigC.getContext('2d');
const BM = { open: false, x: 0, y: 0, s: .25 }; // centre (world metres), CSS px per metre
let OVERVIEW = null;
function overview() { // the whole city at 0.1 px per metre, drawn once
  const k = .1, c = document.createElement('canvas'); c.width = Math.ceil(M.w * k); c.height = Math.ceil(M.h * k);
  const g = c.getContext('2d'); g.scale(k, k); g.lineCap = g.lineJoin = 'round';
  g.fillStyle = '#2a4634'; g.fillRect(0, 0, M.w, M.h);
  g.fillStyle = '#3f6f45'; for (const a of M.green) { trace(g, a.p, 1); g.fill(); }
  g.fillStyle = '#2f7c84'; for (const w of WATER) { trace(g, w.p, 1); g.fill(); }
  g.fillStyle = '#1d3326'; for (const b of M.buildings) { trace(g, b.p, 1); g.fill(); }
  for (const r of M.roads) if (r.car && r.t !== 'service') { const big = ['primary', 'secondary', 'tertiary'].includes(r.t); g.strokeStyle = big ? '#e8d9a8' : '#7d8a7e'; g.lineWidth = big ? 22 : 12; trace(g, r.p); g.stroke(); }
  return c;
}
function toggleMap(open = !BM.open) {
  BM.open = open; bigC.style.display = open ? 'block' : 'none';
  if (open) { BM.x = player.x; BM.y = player.y; }
}
function zoomMap(f, cx = innerWidth / 2, cy = innerHeight / 2) { // keep the point under (cx, cy) in place
  const wx = BM.x + (cx - innerWidth / 2) / BM.s, wy = BM.y + (cy - innerHeight / 2) / BM.s;
  BM.s = clamp(BM.s * f, .05, 3);
  BM.x = wx - (cx - innerWidth / 2) / BM.s; BM.y = wy - (cy - innerHeight / 2) / BM.s;
}
let drag = null;
bigC.addEventListener('wheel', e => { e.preventDefault(); zoomMap(Math.exp(-e.deltaY * .0015), e.clientX, e.clientY); }, { passive: false });
bigC.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY]; bigC.setPointerCapture(e.pointerId); });
bigC.addEventListener('pointermove', e => { if (!drag) return; BM.x -= (e.clientX - drag[0]) / BM.s; BM.y -= (e.clientY - drag[1]) / BM.s; drag = [e.clientX, e.clientY]; });
bigC.addEventListener('pointerup', () => { drag = null; });
function drawBigMap() {
  const dpr = devicePixelRatio || 1, W2 = Math.round(innerWidth * dpr), H2 = Math.round(innerHeight * dpr);
  if (bigC.width !== W2 || bigC.height !== H2) { bigC.width = W2; bigC.height = H2; }
  // arrow keys pan
  const pan = 9 / BM.s;
  if (keys.ArrowLeft || keys.KeyA) BM.x -= pan; if (keys.ArrowRight || keys.KeyD) BM.x += pan;
  if (keys.ArrowUp || keys.KeyW) BM.y -= pan; if (keys.ArrowDown || keys.KeyS) BM.y += pan;
  BM.x = clamp(BM.x, 0, M.w); BM.y = clamp(BM.y, 0, M.h);
  const g = bctx, k = BM.s * dpr, e = W2 / 2 - BM.x * k, f = H2 / 2 - BM.y * k, sx = x => x * k + e, sy = y => y * k + f;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#132a1e'; g.fillRect(0, 0, W2, H2);
  if (!OVERVIEW) OVERVIEW = overview();
  g.imageSmoothingEnabled = true;
  g.setTransform(k, 0, 0, k, e, f); g.drawImage(OVERVIEW, 0, 0, M.w, M.h);
  if (BM.s > .3) { // close up: the detailed minimap chunks, a few new ones per frame
    const x0 = BM.x - W2 / 2 / k, x1 = BM.x + W2 / 2 / k, y0 = BM.y - H2 / 2 / k, y1 = BM.y + H2 / 2 / k;
    let made = 0;
    for (let i = Math.max(0, Math.floor(x0 / MC5)); i <= Math.min(Math.ceil(M.w / MC5) - 1, Math.floor(x1 / MC5)); i++)
      for (let j = Math.max(0, Math.floor(y0 / MC5)); j <= Math.min(Math.ceil(M.h / MC5) - 1, Math.floor(y1 / MC5)); j++) {
        if (!MINI.has(i + ',' + j) && made++ > 3) continue;
        g.drawImage(miniBase(i, j), i * MC5, j * MC5, MC5, MC5);
      }
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
  // street names from the road graph, each name about once per 300 px
  if (BM.s > .45) {
    g.font = `600 ${11 * dpr}px "JetBrains Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 3 * dpr; g.strokeStyle = '#132a1edd'; g.fillStyle = '#f3efe4';
    const placed = [], x0 = BM.x - W2 / 2 / k, y0 = BM.y - H2 / 2 / k;
    for (let i = Math.floor(x0 / GRID); i <= Math.floor((x0 + W2 / k) / GRID); i++) for (let j = Math.floor(y0 / GRID); j <= Math.floor((y0 + H2 / k) / GRID); j++)
      for (const n of grid.get(i + ',' + j) || []) {
        const name = M.names[M.nodeName[n]]; if (!name) continue;
        const px = sx(NX(n)), py = sy(NY(n));
        if (placed.some(p => (p[2] === name && Math.hypot(p[0] - px, p[1] - py) < 300 * dpr) || (Math.abs(p[0] - px) < 90 * dpr && Math.abs(p[1] - py) < 16 * dpr))) continue;
        placed.push([px, py, name]); g.strokeText(name, px, py); g.fillText(name, px, py);
        if (placed.length > 120) break;
      }
  }
  const dot = (x, y, r, col, label) => {
    const px = clamp(sx(x), 12 * dpr, W2 - 12 * dpr), py = clamp(sy(y), 12 * dpr, H2 - 12 * dpr);
    g.fillStyle = col; g.strokeStyle = '#132a1e'; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(px, py, r * dpr, 0, 7); g.fill(); g.stroke();
    if (label) { g.font = `600 ${11 * dpr}px "JetBrains Mono", monospace`; g.textAlign = 'left'; g.lineWidth = 3 * dpr; g.strokeText(label, px + 9 * dpr, py); g.fillStyle = '#f3efe4'; g.fillText(label, px + 9 * dpr, py); }
  };
  const j = G.job;
  if (j && j.stage === 'pickup') dot(j.pickup.x, j.pickup.y, 7, '#ffd60a', 'pick up: ' + j.pickup.name);
  if (j && j.stage === 'deliver') dot(j.drop.x, j.drop.y, 7, '#9bd32d', 'deliver: ' + j.drop.name);
  dot(shop.x, shop.y, 5, '#d64fa0', 'respray');
  for (const c of cars) if (c.kind === 'police') dot(c.x, c.y, 4, '#4a8cff');
  if (G.heli) dot(G.heli.x, G.heli.y, 5, '#ffffff');
  g.setTransform(dpr, 0, 0, dpr, sx(player.x), sy(player.y)); g.rotate(player.a);
  g.fillStyle = '#f3efe4'; g.strokeStyle = '#132a1e'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(10, 0); g.lineTo(-7, -7); g.lineTo(-3, 0); g.lineTo(-7, 7); g.closePath(); g.fill(); g.stroke();
  g.setTransform(1, 0, 0, 1, 0, 0);
  // scale bar
  const m = [50, 100, 250, 500, 1000, 2000, 5000].find(v => v * BM.s > 80) || 5000, L = m * k;
  g.fillStyle = '#f3efe4'; g.fillRect(20 * dpr, H2 - 30 * dpr, L, 3 * dpr);
  g.font = `600 ${11 * dpr}px "JetBrains Mono", monospace`; g.textAlign = 'left'; g.fillText(m >= 1000 ? m / 1000 + ' km' : m + ' m', 20 * dpr, H2 - 42 * dpr);
  g.textAlign = 'right'; g.fillText('M / Esc close · drag or arrows move · wheel or +/− zoom · C centre on you', W2 - 20 * dpr, H2 - 30 * dpr);
}
