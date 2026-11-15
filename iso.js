'use strict';
// Isometric pixel-art renderer for Obst-Taxi.
// Look and technique after "Pixel Plays" by Amir Mushich (MIT License, github.com/amirmushichge/pixel-plays):
// a fixed 30° orthographic camera, a small framebuffer scaled up in whole pixels, a depth buffer, hue-shifted
// colour ramps (shadows drift violet, lights drift warm), Bayer dither and pixel edges taken from the depth buffer.
// The city is baked once into 64 m tiles (ground, buildings, trees, parked cars, viaduct); cars, people and
// traffic lights are drawn every frame on top, sorted by the same depth buffer.
// Loaded before game.js: functions here use game globals (M, player, cars, G, ...) only when they are called.

const SIN = 0.5, COS = Math.sqrt(3) / 2, R2 = Math.SQRT2;
// detail level 1..4 (key P or ?px=N, remembered): game pixels across the screen; the view keeps the same metres, so PS grows with it
const DETAILS = [480, 720, 960, 1440];
let DETAIL = (() => { let n = +new URLSearchParams(location.search).get('px'); try { if (!n) n = +localStorage.getItem('obst-px'); } catch (e) {} return Math.min(4, Math.max(1, n || 3)); })();
let RES = DETAILS[DETAIL - 1], PSK = RES / 480, ZOOMS = [3, 4, 5, 6].map(z => Math.round(z * PSK));
let PS = ZOOMS[1]; // game pixels per metre
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const ui = document.getElementById('ui'), uctx = ui.getContext('2d');
let DPR = 1, VW = 0, VH = 0, SCALE = 3, frameImg = null, pix = null, zb = null, knd = null;
function resize() {
  DPR = devicePixelRatio || 1;
  const dw = Math.round(innerWidth * DPR), dh = Math.round(innerHeight * DPR);
  SCALE = Math.max(1, Math.round(dw / RES)); // about RES game pixels across, each one a whole number of screen pixels
  VW = Math.ceil(dw / SCALE); VH = Math.ceil(dh / SCALE);
  cv.width = VW; cv.height = VH;
  cv.style.width = VW * SCALE / DPR + 'px'; cv.style.height = VH * SCALE / DPR + 'px';
  ui.width = dw; ui.height = dh;
  frameImg = ctx.createImageData(VW, VH); pix = new Uint32Array(frameImg.data.buffer);
  zb = new Float32Array(VW * VH); knd = new Uint8Array(VW * VH);
}
addEventListener('resize', resize); resize();
function isoZoom(d) {
  const k = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(PS) + d));
  if (ZOOMS[k] !== PS) { PS = ZOOMS[k]; tiles.clear(); }
}
function setDetail(n) { // switch live: same zoom step, new pixel size; tiles and material maps are rebuilt
  const zi = Math.max(0, ZOOMS.indexOf(PS));
  DETAIL = (n - 1 + 4) % 4 + 1; RES = DETAILS[DETAIL - 1]; PSK = RES / 480; ZOOMS = [3, 4, 5, 6].map(z => Math.round(z * PSK)); PS = ZOOMS[zi];
  MR = Math.ceil(4 * PSK); NT = TILE * MR; MC.width = MC.height = SC.width = SC.height = NT;
  try { localStorage.setItem('obst-px', DETAIL); } catch (e) {}
  tiles.clear(); resize();
}

// ---------- colour
const byte = v => v < 0 ? 0 : v > 255 ? 255 : v | 0;
const pack = (r, g, b) => (255 << 24 | byte(b) << 16 | byte(g) << 8 | byte(r)) >>> 0;
const tintC = (c, r, g, b) => pack((c & 255) * r, (c >> 8 & 255) * g, (c >> 16 & 255) * b);
const lerp = (a, b, t) => a + (b - a) * t;
const COOL = [46, 38, 84], WARM = [255, 232, 180];
const RAMPS = new Map();
function ramp(c) { // 5 tones of one colour: dark violet shadow ... warm highlight
  const key = (c[0] & 255) << 16 | (c[1] & 255) << 8 | (c[2] & 255);
  let r = RAMPS.get(key);
  if (r) return r;
  const mix = (m, t, k) => pack(lerp(c[0] * m, t[0], k), lerp(c[1] * m, t[1], k), lerp(c[2] * m, t[2], k));
  r = [mix(.4, COOL, .34), mix(.62, COOL, .18), mix(.84, COOL, .05), mix(1, WARM, 0), mix(1.1, WARM, .22)];
  RAMPS.set(key, r);
  return r;
}
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(v => (v + .5) / 16);
const bay = (x, y) => BAYER[(y & 3) * 4 + (x & 3)]; // by absolute pixel, so the dither doesn't crawl while scrolling
const tone = (R, t, gx, gy) => { const k = Math.floor(t + (bay(gx, gy) - .5) * .5); return R[k < 0 ? 0 : k > 4 ? 4 : k]; };
function h2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), e = t => t * t * (3 - 2 * t), fx = e(x - ix), fy = e(y - iy);
  return lerp(lerp(h2(ix, iy), h2(ix + 1, iy), fx), lerp(h2(ix, iy + 1), h2(ix + 1, iy + 1), fx), fy);
}
const HEX = new Map();
const hexC = s => { let c = HEX.get(s); if (!c) { c = [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)); HEX.set(s, c); } return c; };
console.assert(hexC('#ff8000').join() === '255,128,0' && pack(255, 0, 0) === 0xff0000ff, 'colour helpers');

// ---------- projection (absolute screen pixels; linear, so it also maps vectors)
// The view turns in 8 steps of 45° so the car always drives up the screen. (RX, RY) is the world direction of
// screen-right, (DX, DY) the one towards the camera (screen-down). View 0 is the classic iso view looking north-west.
// Sun (LX, LY) and ground shadows (SHX, SHY) turn with the view, so the lighting on screen always looks the same.
let VROT = 0, RX, RY, DX, DY, LX, LY, SHX, SHY;
function setView(k) {
  VROT = (k % 8 + 8) % 8;
  const d = VROT * Math.PI / 4, a = d - Math.PI / 4, c = Math.cos(d), s = Math.sin(d);
  RX = Math.cos(a); RY = Math.sin(a); DX = -Math.sin(a); DY = Math.cos(a);
  LX = -.45 * c - .55 * s; LY = -.45 * s + .55 * c; // view 0: sun from the south-west, +y walls lit, +x walls in shade
  SHX = .55 * c + .22 * s; SHY = .55 * s - .22 * c; // ground shadow offset per metre of height
}
setView(0);
const PX = (x, y) => (x * RX + y * RY) * PS;
const PY = (x, y, z) => ((x * DX + y * DY) * SIN - z * COS) * PS;
const DEP = (x, y, z) => (x * DX + y * DY) * COS + z * SIN; // bigger = nearer the camera
const facing = (nx, ny) => nx * DX + ny * DY > .015; // a wall with this outward normal can be seen
// snapped to whole ramp steps: flat faces read as clean pixel-art planes instead of a dither checkerboard
const lit = (nx, ny) => Math.round(2.1 + 1.7 * (nx * LX + ny * LY)) + .15;
console.assert(Math.abs(PX(1, -1) - R2 * PS) < 1e-9 && Math.abs(DEP(1, 1, 0) - R2 * COS) < 1e-9, 'view 0 is the classic iso view');

// a draw target: the frame, or a tile sprite being baked. ox/oy = absolute pixel of its top-left corner
let T = null, FT = null;
function newTarget(ox, oy, w, h) {
  const dep = new Float32Array(w * h); dep.fill(-Infinity);
  return { ox, oy, w, h, col: new Uint32Array(w * h), dep, knd: new Uint8Array(w * h) }; // knd: 0 empty, 1/3 ground (3 = shaded), 2 object
}
function plot(x, y, z, c) {
  const t = T, ix = Math.floor(PX(x, y) - t.ox), iy = Math.floor(PY(x, y, z) - t.oy);
  if (ix < 0 || iy < 0 || ix >= t.w || iy >= t.h) return;
  const i = iy * t.w + ix, d = DEP(x, y, z);
  if (d <= t.dep[i]) return;
  t.dep[i] = d; t.col[i] = c; t.knd[i] = 2;
}
function column(x, y, z0, z1, c) { for (let z = z0; z < z1; z += 1 / (COS * PS)) plot(x, y, z, c); }

// a planar polygon pts=[[x,y,z],..] lying in the plane O + a*E1 + b*E2; shade(a, b, gx, gy) -> colour (0 = skip)
const XS = [];
function poly(pts, O, E1, E2, shade) {
  const t = T, ox = PX(O[0], O[1]) - t.ox, oy = PY(O[0], O[1], O[2]) - t.oy;
  const e1x = PX(E1[0], E1[1]), e1y = PY(E1[0], E1[1], E1[2]), e2x = PX(E2[0], E2[1]), e2y = PY(E2[0], E2[1], E2[2]);
  const det = e1x * e2y - e2x * e1y;
  if (Math.abs(det) < 1e-3) return; // seen edge-on
  const ia = e2y / det, ib = -e2x / det, ic = -e1y / det, id = e1x / det;
  const d0 = DEP(O[0], O[1], O[2]), d1 = DEP(E1[0], E1[1], E1[2]), d2 = DEP(E2[0], E2[1], E2[2]);
  const n = pts.length, X = new Float64Array(n), Y = new Float64Array(n);
  let y0 = Infinity, y1 = -Infinity;
  for (let k = 0; k < n; k++) {
    const p = pts[k]; X[k] = PX(p[0], p[1]) - t.ox; Y[k] = PY(p[0], p[1], p[2]) - t.oy;
    if (Y[k] < y0) y0 = Y[k]; if (Y[k] > y1) y1 = Y[k];
  }
  const iy0 = Math.max(0, Math.floor(y0)), iy1 = Math.min(t.h - 1, Math.ceil(y1));
  for (let iy = iy0; iy <= iy1; iy++) {
    const yc = iy + .5; XS.length = 0;
    for (let k = 0, j = n - 1; k < n; j = k++) if ((Y[k] <= yc) !== (Y[j] <= yc)) XS.push(X[k] + (yc - Y[k]) * (X[j] - X[k]) / (Y[j] - Y[k]));
    XS.sort((a, b) => a - b);
    for (let q = 0; q + 1 < XS.length; q += 2) {
      const ix0 = Math.max(0, Math.ceil(XS[q] - .5)), ix1 = Math.min(t.w - 1, Math.floor(XS[q + 1] - .5));
      for (let ix = ix0; ix <= ix1; ix++) {
        const dx = ix + .5 - ox, dy = yc - oy, a = ia * dx + ib * dy, b = ic * dx + id * dy;
        const d = d0 + a * d1 + b * d2, i = iy * t.w + ix;
        if (d <= t.dep[i]) continue;
        const c = shade(a < 0 ? 0 : a > 1 ? 1 : a, b < 0 ? 0 : b > 1 ? 1 : b, ix + t.ox, iy + t.oy);
        if (!c) continue;
        t.dep[i] = d; t.col[i] = c; t.knd[i] = 2;
      }
    }
  }
}
// a lit sphere (tree leaves, trunks, dishes); rough = speckled like foliage
function sphere(x, y, z, r, c, rough) {
  const t = T, R = ramp(c), sx = PX(x, y) - t.ox, sy = PY(x, y, z) - t.oy, d0 = DEP(x, y, z), rp = Math.max(r * PS, .75);
  const y0 = Math.max(0, Math.floor(sy - rp)), y1 = Math.min(t.h - 1, Math.ceil(sy + rp));
  const x0 = Math.max(0, Math.floor(sx - rp)), x1 = Math.min(t.w - 1, Math.ceil(sx + rp));
  for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
    const dx = (ix + .5 - sx) / rp, dy = (iy + .5 - sy) / rp, nn = dx * dx + dy * dy;
    if (nn > 1) continue;
    const nz = Math.sqrt(1 - nn), d = d0 + r * nz, i = iy * t.w + ix;
    if (d <= t.dep[i]) continue;
    const gx = ix + t.ox, gy = iy + t.oy;
    let l = -.55 * dx - .6 * dy + .58 * nz;
    if (rough) l += (h2(gx, gy) - .5) * .55;
    t.dep[i] = d; t.knd[i] = 2;
    t.col[i] = R[Math.max(0, Math.min(4, Math.floor(l * 4.4 + .2 + (bay(gx, gy) - .5) * .7)))];
  }
}
// an oriented box. face(f, u, v, lightIndex, gx, gy) -> colour; f: 0 top, 1 front, 2 back, 3 right, 4 left.
// top: u back->front, v left->right; sides: u along the face, v bottom->top
function obox(x, y, a, l, w, z0, z1, face) {
  const fx = Math.cos(a), fy = Math.sin(a), rx = -fy, ry = fx, hl = l / 2, hw = w / 2;
  const P = (p, q, z) => [x + fx * p * hl + rx * q * hw, y + fy * p * hl + ry * q * hw, z];
  const top = P(-1, -1, z1), up = [0, 0, z1 - z0];
  poly([top, P(1, -1, z1), P(1, 1, z1), P(-1, 1, z1)], top, [fx * l, fy * l, 0], [rx * w, ry * w, 0], (u, v, gx, gy) => face(0, u, v, 3.2, gx, gy));
  const side = (f, nx, ny, A, B) => {
    if (!facing(nx, ny)) return;
    const li = lit(nx, ny);
    poly([A, B, [B[0], B[1], z1], [A[0], A[1], z1]], A, [B[0] - A[0], B[1] - A[1], 0], up, (u, v, gx, gy) => face(f, u, v, li, gx, gy));
  };
  side(1, fx, fy, P(1, -1, z0), P(1, 1, z0));
  side(2, -fx, -fy, P(-1, 1, z0), P(-1, -1, z0));
  side(3, rx, ry, P(1, 1, z0), P(-1, 1, z0));
  side(4, -rx, -ry, P(-1, -1, z0), P(1, -1, z0));
}
const flat = c => { const R = ramp(c); return (f, u, v, i, gx, gy) => tone(R, i, gx, gy); };

// ---------- vehicles and people
const GLASSC = [52, 64, 84], TYRE = [44, 42, 48], POLBLUE = [40, 84, 176], CRATE = [176, 122, 64];
const HEAD = pack(255, 246, 214), TAIL = pack(150, 30, 26), TAIL_ON = pack(255, 64, 40);
function car3d(x, y, a, col, o = {}) {
  const R = ramp(col), Gl = ramp(GLASSC), Ty = ramp(TYRE), Pb = ramp(POLBLUE);
  obox(x, y, a, 4, 1.66, 0, .42, (f, u, v, i, gx, gy) => tone(Ty, i, gx, gy));
  obox(x, y, a, 4.4, 1.8, .32, .98, (f, u, v, i, gx, gy) => {
    if (f === 1 && v > .5 && (u < .24 || u > .76)) return HEAD;
    if (f === 2 && v > .5 && (u < .24 || u > .76)) return o.braking ? TAIL_ON : TAIL;
    if (o.police && f > 2 && v > .25 && v < .6) return tone(Pb, i, gx, gy);
    return tone(R, i, gx, gy);
  });
  const bx = x - Math.cos(a) * .3, by = y - Math.sin(a) * .3;
  obox(bx, by, a, 2.3, 1.56, .98, 1.46, (f, u, v, i, gx, gy) => f === 0 ? tone(R, i + .3, gx, gy) : v > .8 ? tone(R, i, gx, gy) : tone(Gl, i + (v > .45 ? .9 : 0), gx, gy));
  if (o.police) {
    const on = (G.time * 7 | 0) % 2 === 1, Lb = ramp([150, 156, 170]);
    obox(bx, by, a, .45, 1.3, 1.46, 1.64, (f, u, v, i, gx, gy) => o.lit ? ((f === 0 ? v : u) < .5) === on ? pack(170, 210, 255) : pack(30, 80, 230) : tone(Lb, i, gx, gy));
  }
  if (o.cargo) {
    const Fr = ramp(o.cargo), Cr = ramp(CRATE);
    obox(bx, by, a, 1.3, 1.2, 1.46, 1.86, (f, u, v, i, gx, gy) => f === 0 && ((u * 4 | 0) + (v * 3 | 0)) % 2 ? tone(Fr, 3.4, gx, gy) : tone(Cr, i, gx, gy));
  }
}
function bus3d(x, y, a, len, col, z = 0, train = false) {
  const Y = ramp(col), Gl = ramp(GLASSC), Ty = ramp(TYRE), gap = train ? 3.1 : 2.6;
  obox(x, y, a, len - .5, 2.3, z, z + .5, (f, u, v, i, gx, gy) => tone(Ty, i, gx, gy));
  obox(x, y, a, len, 2.55, z + .35, z + 3, (f, u, v, i, gx, gy) => {
    if (f === 0) return tone(Y, 2.9 + ((u * len / 2.5 | 0) % 2) * .4, gx, gy);
    if (v > .45 && v < .85 && (f < 3 || (u * len) % gap > .35)) return tone(Gl, i + (v > .72 ? 1 : 0), gx, gy);
    return tone(Y, i, gx, gy);
  });
}
// a person in a few pixels: legs, shirt, head, hair. ph = walk phase
function person(x, y, ph, c, fallen, z = 0) {
  const t = T, ix = Math.floor(PX(x, y) - t.ox), iy = Math.floor(PY(x, y, z) - t.oy), d0 = DEP(x, y, z) + .3, dz = SIN / (COS * PS);
  const put = (px, py, col, d) => {
    if (px < 0 || py < 0 || px >= t.w || py >= t.h) return;
    const i = py * t.w + px;
    if (d <= t.dep[i]) return;
    t.dep[i] = d; t.col[i] = col; t.knd[i] = 2;
  };
  if (fallen) { for (let k = -1; k <= 2; k++) put(ix + k, iy, k === 2 ? c.skin : c.shirt, d0); return; }
  const H = Math.max(5, Math.round(1.75 * COS * PS)), legs = Math.round(H * .38), head = Math.max(2, Math.round(H * .28)), step = Math.floor(ph) & 1;
  for (let r = 0; r < H; r++) {
    const d = d0 + r * dz, py = iy - r;
    if (r < legs) { if (!(r === 0 && step)) put(ix, py, c.legs, d); if (!(r === 0 && !step)) put(ix + 1, py, c.legs, d); }
    else if (r < H - head) { put(ix, py, c.shirt, d); put(ix + 1, py, c.shirtD, d); }
    else if (r === H - 1) { put(ix, py, c.hair, d); put(ix + 1, py, c.hair, d); }
    else { put(ix, py, c.skin, d); put(ix + 1, py, c.skinD, d); }
  }
}
const PANTS = [[52, 58, 82], [44, 44, 48], [96, 88, 78], [30, 32, 40], [104, 124, 150], [150, 130, 100]];
const SKIN = [[232, 184, 148], [214, 160, 122], [176, 122, 88], [122, 82, 58]];
function pedColours(pd) {
  if (pd.pc) return pd.pc;
  const s = hexC(pd.col || pd.color), k = SKIN[Math.random() * SKIN.length | 0];
  return (pd.pc = { shirt: pack(...s), shirtD: tintC(pack(...s), .72, .7, .82), legs: pack(...PANTS[Math.random() * PANTS.length | 0]),
    hair: pack(...hexC(pd.hair)), skin: pack(...k), skinD: tintC(pack(...k), .8, .76, .84) });
}

// ---------- buildings: colours by style from OSM tags (see style() in tools/build-map.mjs)
const FACADE = {
  // Altbau: renovated pastels next to sooty unrenovated grey, the Kreuzberg mix
  alt: [[232, 220, 196], [222, 206, 170], [236, 226, 210], [214, 190, 156], [205, 200, 190], [226, 206, 186], [210, 214, 200],
    [200, 206, 214], [228, 196, 170], [190, 170, 140], [176, 160, 150], [160, 150, 138], [238, 214, 160], [186, 120, 96]],
  platte: [[236, 234, 226], [220, 214, 200], [206, 200, 188], [226, 220, 196], [214, 206, 180], [188, 196, 202]],
  brick: [[158, 74, 52], [170, 90, 62], [142, 62, 46], [196, 160, 108], [180, 120, 80]],
  office: [[196, 202, 208], [170, 178, 186], [220, 218, 210], [150, 156, 164]],
  low: [[168, 164, 156], [150, 146, 140], [190, 184, 170], [130, 128, 124]],
  deck: [[70, 96, 78]],
};
const ROOFC = {
  m: { band: [[72, 74, 80], [104, 108, 112], [150, 78, 58], [88, 84, 82]], top: [[128, 126, 122], [140, 136, 128], [118, 116, 114]] },
  p: { band: [[168, 86, 62], [150, 76, 56], [120, 110, 104], [176, 98, 70]], top: [[150, 76, 56]] },
  f: { band: null, top: [[150, 148, 140], [136, 134, 128], [164, 160, 150], [124, 124, 122]] },
};
// storey height, window cell width, window x range and height range inside one cell (metres)
const STY = {
  alt: { fh: 3.6, cw: 3.4, wx: [1.1, 2.3], wz: [.9, 3] },
  platte: { fh: 2.9, cw: 3, wx: [.5, 2.5], wz: [.95, 2.3] },
  brick: { fh: 4.2, cw: 3.6, wx: [.8, 2.8], wz: [1, 3.6] },
  office: { fh: 3.5, cw: 1.6, wx: [.12, 1.5], wz: [.9, 3.1] },
  low: { fh: 3.3, cw: 6, wx: [1.2, 4.8], wz: [0, 2.6], gate: true },
  deck: { none: true },
};
const FRAMEC = [238, 232, 218], CURTAIN = [214, 190, 140], SHOPLIT = [236, 196, 120];
const AWN = [[184, 50, 42], [45, 106, 58], [36, 69, 110]];
const GRAFF = [[232, 51, 109], [47, 181, 232], [24, 24, 28], [242, 194, 0], [122, 208, 74], [250, 250, 246], [166, 77, 255]];
function prepB(b) {
  if (b.prep) return;
  b.prep = true;
  const p = b.p, k = p.length / 2, n = b.n, jit = .93 + .14 * h2(n, 1);
  const pc = (a, s) => a[h2(n, s) * a.length | 0].map(v => Math.round(Math.min(255, v * jit)));
  const R = ROOFC[b.r] || ROOFC.f;
  b.fc = pc(FACADE[b.k] || FACADE.alt, 3);
  b.rc = b.r === 'f' && b.k !== 'low' && b.k !== 'deck' && h2(n, 5) < .12 ? [104, 132, 78] : pc(R.top, 7); // some green roofs
  b.bc = R.band && pc(R.band, 8);
  b.frame = b.k === 'platte' || b.k === 'office' ? [196, 198, 200] : FRAMEC;
  b.shopV = b.k === 'alt' || (b.k === 'platte' && h2(n, 2) < .4) ? h2(n, 4) * 6 | 0 : -1;
  b.edges = [];
  for (let i = 0; i < k; i++) {
    const j = (i + 1) % k, ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1], ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey);
    if (len < .05) continue;
    const nx = ey * b.ws / len, ny = -ex * b.ws / len; // outward
    // a wall facing a street gets shops and graffiti
    const street = b.k !== 'deck' && !!nearestEdge((ax + bx) / 2 + nx * 5, (ay + by) / 2 + ny * 5, 9);
    b.edges.push({ ax, ay, bx, by, len, nx, ny, street });
  }
  // roof furniture: chimneys + satellite dishes on Altbau, plant rooms on flat roofs
  b.bits = [];
  for (const e of b.edges) {
    if (b.bits.length >= 6 || e.len < 7 || h2(n * 31, e.ax) > .55 || b.k === 'low' || b.k === 'deck') continue;
    const d = b.r === 'f' ? 4 + 3 * h2(n, e.ay) : 1.6, x = (e.ax + e.bx) / 2 - e.nx * d, y = (e.ay + e.by) / 2 - e.ny * d;
    if (inPoly(p, x, y)) b.bits.push([x, y, Math.atan2(e.by - e.ay, e.bx - e.ax), b.r === 'f' ? 'box' : h2(n, e.bx) < .3 ? 'dish' : 'chimney']);
  }
}
function graff(n, s, z, th) {
  if (z > 2.4 || noise2(s * .9 + n * 3.1, z * 1.6 + n) < th) return 0;
  return pack(...GRAFF[h2(Math.floor(s * .6), n) * GRAFF.length | 0]);
}
function shopPx(b, s, z, li, gx, gy, R) {
  const v = b.shopV, cs = s % 4.2, gr = graff(b.n, s, z, v === 3 ? .55 : .72);
  if (v < 3) { // shop: awning over a window with warm light inside
    if (z > 2.85 && z < 3.35 && cs > .2 && cs < 3.6) return tone(ramp((cs / .6 | 0) % 2 ? AWN[v] : [236, 228, 210]), li + .5, gx, gy);
    if (cs > .4 && cs < 3.4 && z > .3 && z < 2.7) return z < 1.1 ? tone(ramp(SHOPLIT), 3, gx, gy) : tone(ramp(GLASSC), z > 2.3 ? 3.2 : 1.6, gx, gy);
  } else if (v === 3) { // roller shutter, sprayed all over
    if (cs > .3 && cs < 3.8 && z < 2.8) return gr || tone(ramp([150, 150, 146]), li - ((z * 5 | 0) % 2) * .6, gx, gy);
  } else { // house door + window
    if (cs > .5 && cs < 1.7 && z < 2.6) return tone(ramp([96, 66, 46]), li, gx, gy);
    if (cs > 2.3 && cs < 3.6 && z > .9 && z < 2.6) return tone(ramp(GLASSC), z > 2.2 ? 3.2 : 1.5, gx, gy);
  }
  if (gr) return gr;
  return tone(R, li - (z < .45 ? .8 : 0) + (h2(gx, gy) - .5) * .35, gx, gy);
}
function wallShader(b, e) {
  const st = STY[b.k] || STY.alt, L = e.len, z0 = b.z0 || 0, Hh = b.h - z0, li = lit(e.nx, e.ny), n = b.n;
  const R = ramp(b.fc), Gl = ramp(GLASSC), Fr = ramp(b.frame), Cu = ramp(CURTAIN);
  const cw = st.cw, cells = Math.floor(L / cw), s0 = (L - cells * cw) / 2, shop = e.street && b.shopV >= 0 && b.h > 7;
  return (a, v, gx, gy) => {
    const s = a * L, z = v * Hh, g = (h2(gx, gy) - .5) * .3;
    if (z > Hh - .45) return tone(R, li + .9 + g, gx, gy); // cornice
    if (shop && z < 3.8) return shopPx(b, s, z, li, gx, gy, R);
    if (z < .45) return tone(R, li - .8 + g, gx, gy); // plinth
    if (st.none) return tone(R, li + g, gx, gy);
    const sc = s - s0, cell = Math.floor(sc / cw), cs = sc - cell * cw, storey = Math.floor(z / st.fh), zz = z - storey * st.fh;
    if (cell >= 0 && cell < cells && z < Hh - .9 && cs > st.wx[0] - .14 && cs < st.wx[1] + .14 && zz > st.wz[0] - .14 && zz < st.wz[1] + .14) {
      if (cs < st.wx[0] || cs > st.wx[1] || zz < st.wz[0] || zz > st.wz[1]) return tone(Fr, li + .5, gx, gy); // frame
      if (st.gate) return tone(ramp([120, 118, 112]), li - ((cs * 2.5 | 0) % 2) * .5, gx, gy); // garage gate
      const hh = h2(cell + n * 7, storey);
      if ((zz - st.wz[0]) / (st.wz[1] - st.wz[0]) > .74) return tone(Gl, 3.3, gx, gy); // sky in the glass
      if (hh > .84) return tone(Cu, li, gx, gy);
      return tone(Gl, 1.2 + hh, gx, gy);
    }
    if (e.street && b.k === 'alt' && z < 2.4) { const gr = graff(n, s, z, .74); if (gr) return gr; }
    if (b.k === 'alt' && zz < .16) return tone(R, li + .7, gx, gy); // ledge between storeys
    if (b.k === 'platte' && zz < .2) return tone(R, li - .6, gx, gy); // panel joint
    if (b.k === 'brick' && (z * 3.6 | 0) % 2 === 0 && h2(gx, gy * 3) < .5) return tone(R, li - .5, gx, gy);
    return tone(R, li + g, gx, gy);
  };
}
function roofShader(b) {
  const Rr = ramp(b.rc), Rb = b.bc ? ramp(b.bc) : Rr, E = b.edges, O = b.bb, r = b.r, band = r === 'm' ? 3.2 : r === 'p' ? 99 : 0;
  return (a, v, gx, gy) => {
    const x = O[0] + a, y = O[1] + v;
    let bd = 1e9, bn = E[0];
    for (const e of E) {
      const dx = e.bx - e.ax, dy = e.by - e.ay;
      let t = ((x - e.ax) * dx + (y - e.ay) * dy) / (e.len * e.len); t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(x - e.ax - dx * t, y - e.ay - dy * t);
      if (d < bd) { bd = d; bn = e; }
    }
    const g = (h2(gx, gy) - .5) * .4;
    if (bd > band || !bn) {
      if (r === 'f' && bd < .35) return tone(Rr, 4, gx, gy); // parapet
      if (r === 'f' && bd < .8) return tone(Rr, 2, gx, gy);
      return tone(Rr, 3.15 + g * .6 + (noise2(x * .4, y * .4) - .5) * .5, gx, gy);
    }
    // sloped part faces outwards from its nearest eave: shaded by that direction, with tile/slate rows
    const row = (bd * (r === 'p' ? 3 : 2.2)) % 1 < .22;
    return tone(Rb, 2.7 + 1.5 * (bn.nx * LX + bn.ny * LY) - (row ? .7 : 0) + g, gx, gy);
  };
}
function building(b) {
  prepB(b);
  const z0 = b.z0 || 0, h = b.h, p = b.p;
  for (const e of b.edges) {
    if (!facing(e.nx, e.ny)) continue; // back walls are hidden anyway
    const A = [e.ax, e.ay, z0];
    poly([A, [e.bx, e.by, z0], [e.bx, e.by, h], [e.ax, e.ay, h]], A, [e.bx - e.ax, e.by - e.ay, 0], [0, 0, h - z0], wallShader(b, e));
  }
  const pts = [];
  for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1], h]);
  poly(pts, [b.bb[0], b.bb[1], h], [1, 0, 0], [0, 1, 0], roofShader(b));
  for (const [x, y, a, kind] of b.bits) {
    if (kind === 'chimney') obox(x, y, a, .9, .7, h, h + 1.3, flat([150, 84, 62]));
    else if (kind === 'dish') sphere(x, y, h + .7, .4, [236, 236, 230]);
    else obox(x, y, a, 3, 2, h, h + 1.5, flat([170, 170, 166]));
  }
}
const LEAF = [[58, 84, 62], [100, 126, 78], [146, 162, 112]], BARK = [92, 74, 60];
const treeH = r => 7 + r * 1.3;
function tree(x, y, r, seed) {
  const H = treeH(r), cz = H - r * .75;
  for (let z = 0; z < cz; z += .3) sphere(x + z / cz * .25, y, z, .34 - z / cz * .12, BARK, true);
  const n = 16 + r * 6 | 0;
  for (let k = 0; k < n; k++) {
    const q = seed * 31 + k, a = h2(q, 7) * 6.283, tl = h2(q, 8) * 2 - 1, d = Math.cbrt(h2(q, 9)), fl = Math.sqrt(1 - tl * tl);
    const rz = tl * d * r * .6, tn = h2(q, 10) + rz / r * .6 + (d - .5) * .3;
    sphere(x + Math.cos(a) * fl * d * r * .8, y + Math.sin(a) * fl * d * r * .8, cz + rz, .55 + h2(q, 11) * .5 + r * .08, tn > .75 ? LEAF[2] : tn > .3 ? LEAF[1] : LEAF[0], true);
  }
}
const STEEL = [70, 96, 78];
function viaSeg(ax, ay, bx, by) { // U1/U3 Hochbahn deck, 7 m up: two tracks on a green steel deck
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  if (L < .1) return;
  const ux = -dy / L, uy = dx / L, Z = 7, St = ramp(STEEL), Sl = ramp([110, 96, 84]), Ra = ramp([196, 196, 202]);
  const A = [ax - ux * 4, ay - uy * 4, Z];
  poly([A, [bx - ux * 4, by - uy * 4, Z], [bx + ux * 4, by + uy * 4, Z], [ax + ux * 4, ay + uy * 4, Z]], A, [dx, dy, 0], [ux * 8, uy * 8, 0], (u, v, gx, gy) => {
    const q = Math.abs((v - .5) * 8), tr = Math.abs(q - 2);
    if (tr < .9) return Math.abs(tr - .72) < .12 ? tone(Ra, 3.6, gx, gy) : tone(Sl, (u * L * 1.6) % 1 < .45 ? 2 : 3, gx, gy);
    return tone(St, q > 3.6 ? 3.8 : 3 + (h2(gx, gy) - .5) * .4, gx, gy);
  });
  for (const s of [-1, 1]) {
    const nx = ux * s, ny = uy * s;
    if (!facing(nx, ny)) continue;
    const B = [ax + nx * 4, ay + ny * 4, Z - 1.1];
    poly([B, [bx + nx * 4, by + ny * 4, Z - 1.1], [bx + nx * 4, by + ny * 4, Z], [ax + nx * 4, ay + ny * 4, Z]], B, [dx, dy, 0], [0, 0, 1.1],
      (u, v, gx, gy) => tone(St, lit(nx, ny) + ((u * L / 1.2) % 1 < .15 ? .7 : 0), gx, gy));
  }
}

// ---------- ground materials: a top-down canvas per tile, decoded back into material ids
const TILE = 64; let MR = Math.ceil(4 * PSK), NT = TILE * MR; // material map keeps up with the game pixels
const [YARD, GRASSM, PITCH, PLAY, WATERM, PATH, PLAZA, CYCLE, PAVE, KERB, ASPH, MARK, RAILBED, RAIL, SITE, YMARK] = [...Array(16).keys()].map(i => i + 1);
const MCODE = [], MKEY = new Map();
for (let m = 0; m <= 16; m++) { MCODE[m] = `rgb(${m * 12},${255 - m * 9},${m * 71 % 256})`; MKEY.set((m * 12) << 16 | (255 - m * 9) << 8 | (m * 71 % 256), m); }
const MC = document.createElement('canvas'); MC.width = MC.height = NT;
const mg = MC.getContext('2d', { willReadFrequently: true });
const SC = document.createElement('canvas'); SC.width = SC.height = NT;
const sg = SC.getContext('2d', { willReadFrequently: true });
const GRASS = [[34, 62, 50], [52, 88, 52], [82, 118, 54], [124, 146, 62], [168, 172, 76]], GRASSP = GRASS.map(c => pack(...c));
const WATER_T = [[34, 102, 108], [44, 122, 120], [62, 146, 134], [94, 172, 150]].map(c => pack(...c));
const GC = { [PITCH]: [70, 140, 76], [PLAY]: [214, 196, 150], [PATH]: [196, 178, 138], [PLAZA]: [200, 192, 176], [CYCLE]: [168, 84, 72],
  [PAVE]: [176, 170, 158], [KERB]: [204, 200, 190], [ASPH]: [84, 86, 96], [MARK]: [236, 232, 214], [RAILBED]: [118, 104, 92],
  [RAIL]: [186, 186, 190], [SITE]: [160, 130, 92], [YMARK]: [240, 196, 40] };
const DIRT = ramp([128, 110, 84]);
function groundPx(m, x, y, gx, gy) {
  const f = h2(gx, gy);
  switch (m) {
    case YARD: // back yards: patchy grass and trodden earth
      if (noise2(x * .3, y * .3) < .3) return tone(DIRT, 2.6 + noise2(x * 2, y * 2) + (f - .5) * .6, gx, gy);
    // falls through: the rest of the yard is grass
    case GRASSM: { const t = noise2(x * .9, y * .9) * 1.15 + (f - .5) * .55 - .08; return GRASSP[Math.max(0, Math.min(3, Math.floor(t * 4.2 + (bay(gx, gy) - .5) * .5)))]; }
    case WATERM: return WATER_T[Math.max(0, Math.min(3, Math.floor(.4 + noise2(x * .2, y * .5) * 2.4 + (bay(gx, gy) - .5) * .7)))];
    case PITCH: return tone(ramp(GC[m]), (Math.floor((x + y) / 4) % 2 ? 3.2 : 2.7) + (f - .5) * .4, gx, gy);
    case PAVE: { // granite slabs with joints
      const sx = x / 1.6, sy = y / 1.6, joint = sx % 1 < .1 || sy % 1 < .1;
      return tone(ramp(GC[m]), joint ? 2.1 : 3 + (h2(Math.floor(sx), Math.floor(sy)) - .5) * .8, gx, gy);
    }
    case ASPH: return tone(ramp(GC[m]), 3.1 + (noise2(x * .3, y * .3) - .5) * .5 + (f > .97 ? -1 : 0), gx, gy);
    case MARK: case YMARK: case KERB: return tone(ramp(GC[m]), 3.3, gx, gy);
    default: return tone(ramp(GC[m]), 3 + (noise2(x * 1.5, y * 1.5) - .5) * .7 + (f - .5) * .4, gx, gy);
  }
}
function materials(x0, y0) {
  const g = mg, line = (m, w, p) => { g.strokeStyle = MCODE[m]; g.lineWidth = w; trace(g, p); g.stroke(); };
  const inT = bb => bb[2] >= x0 - 25 && bb[0] <= x0 + TILE + 25 && bb[3] >= y0 - 25 && bb[1] <= y0 + TILE + 25;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, NT, NT);
  g.setTransform(MR, 0, 0, MR, -x0 * MR, -y0 * MR); g.lineCap = g.lineJoin = 'round';
  g.fillStyle = MCODE[YARD]; g.fillRect(0, 0, M.w, M.h);
  const q = kind => query(kind, x0 - 25, y0 - 25, x0 + TILE + 25, y0 + TILE + 25);
  for (const a of q('green')) if (inT(a.bb)) { g.fillStyle = MCODE[{ pitch: PITCH, play: PLAY }[a.k] || GRASSM]; trace(g, a.p, 1); g.fill(); }
  g.fillStyle = MCODE[WATERM]; for (const w of q('water')) if (inT(w.bb)) { trace(g, w.p, 1); g.fill(); }
  const roads = q('roads').sort((a, b) => a.rk - b.rk);
  for (const r of roads) if (!r.car) line(r.t === 'cycleway' ? CYCLE : r.t === 'pedestrian' ? PLAZA : r.t === 'footway' ? PAVE : PATH, r.w, r.p);
  for (const r of roads) if (r.car) line(PAVE, r.w + (r.t === 'service' ? 1.5 : 9), r.p); // Berlin sidewalks, ~4.5 m each side
  for (const r of roads) if (r.car) line(KERB, r.w + .8, r.p);
  for (const r of roads) if (r.car) line(ASPH, r.w, r.p);
  g.setLineDash([3, 4]); for (const r of roads) if (r.car && r.w >= 12) line(MARK, .3, r.p); g.setLineDash([]);
  for (const r of q('rails')) if (!r.v) { line(RAILBED, 3.6, r.p); line(RAIL, 1.9, r.p); line(RAILBED, 1.3, r.p); }
  // pedestrian crossings: zebra (stripes along the road) or signalled Fußgängerfurt (two dashed lines)
  g.fillStyle = MCODE[MARK];
  for (let i = 0; i < CROSS.length; i += 3) {
    const x = CROSS[i], y = CROSS[i + 1];
    if (x < x0 - 10 || x > x0 + TILE + 10 || y < y0 - 10 || y > y0 + TILE + 10) continue;
    const n = M.crossings[i / 3 * 2], nb = M.adj[n][0];
    if (nb === undefined) continue;
    g.save(); g.translate(x, y); g.rotate(Math.atan2(NY(nb) - y, NX(nb) - x));
    if (CROSS[i + 2] === 1) for (let k = -4; k <= 4; k++) g.fillRect(-1.5, k - .3, 3, .6);
    else for (const o of [-2, 1.6]) for (let k = -4.5; k < 4.5; k += 1) g.fillRect(o, k, .4, .5);
    g.restore();
  }
  for (const w of WORKS) if (inT(w.bb)) {
    if (w.closed) line(SITE, 6.6, w.pts);
    else { g.setLineDash([3, 2]); line(YMARK, .35, w.pts); g.setLineDash([]); }
  }
  // decode: exact colour match, antialiased edge texels take a matched neighbour
  const d = g.getImageData(0, 0, NT, NT).data, out = new Uint8Array(NT * NT);
  for (let q = 0; q < out.length; q++) out[q] = d[q * 4 + 3] === 0 ? 0 : MKEY.get(d[q * 4] << 16 | d[q * 4 + 1] << 8 | d[q * 4 + 2]) ?? 255;
  for (let q = 0; q < out.length; q++) if (out[q] === 255) {
    const c = [q - 1, q + 1, q - NT, q + NT, q - NT - 1, q + NT + 1].find(k => k >= 0 && k < out.length && out[k] && out[k] !== 255);
    out[q] = c === undefined ? YARD : out[c];
  }
  return out;
}
function shadows(x0, y0) { // red: cast shadow, green: ambient occlusion along walls
  const g = sg, near = (bb, m) => bb[2] >= x0 - m && bb[0] <= x0 + TILE + m && bb[3] >= y0 - m && bb[1] <= y0 + TILE + m;
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, NT, NT);
  g.setTransform(MR, 0, 0, MR, -x0 * MR, -y0 * MR); g.fillStyle = '#f00';
  const sweep = (p, h) => { // footprint swept along the shadow vector
    const ox = SHX * h, oy = SHY * h, steps = Math.ceil(Math.hypot(ox, oy) / 1.2) || 1;
    g.beginPath();
    for (let s = 0; s <= steps; s++) { const dx = ox * s / steps, dy = oy * s / steps; g.moveTo(p[0] + dx, p[1] + dy); for (let i = 2; i < p.length; i += 2) g.lineTo(p[i] + dx, p[i + 1] + dy); g.closePath(); }
    g.fill();
  };
  const m = Math.min(250, BMAXH * .6 + 2), bs = query('bs', x0 - m, y0 - m, x0 + TILE + m, y0 + TILE + m);
  for (const b of bs) if (near(b.bb, b.h * .6 + 2)) sweep(b.p, b.h);
  for (const d of DECKS) if (near(d.bb, 8)) sweep(d.p, d.h);
  for (const i of query('trees', x0 - 40, y0 - 40, x0 + TILE + 40, y0 + TILE + 40)) {
    const x = M.trees[i], y = M.trees[i + 1], r = treeR(i), H = treeH(r) - r * .6;
    if (Math.abs(x - x0 - 32) > 32 + r + H || Math.abs(y - y0 - 32) > 32 + r + H) continue;
    g.beginPath(); g.ellipse(x + SHX * H, y + SHY * H, r * .85, r * .75, 0, 0, 7); g.fill();
  }
  g.strokeStyle = '#f00'; g.lineWidth = 8;
  for (const r of query('rails', x0 - 10, y0 - 10, x0 + TILE + 10, y0 + TILE + 10)) if (r.v) { g.beginPath(); for (let i = 0; i < r.p.length; i += 2) g.lineTo(r.p[i] + SHX * 7, r.p[i + 1] + SHY * 7); g.stroke(); }
  for (let ti = x0 / 64 - 1; ti <= x0 / 64 + 1; ti++) for (let tj = y0 / 64 - 1; tj <= y0 / 64 + 1; tj++) for (const k of PGRID.get(ti + ',' + tj) || []) {
    const x = PARKED[k], y = PARKED[k + 1];
    if (PARKED[k + 3] < 0 || x < x0 - 4 || x > x0 + TILE + 4 || y < y0 - 4 || y > y0 + TILE + 4) continue;
    g.save(); g.translate(x + SHX * .8, y + SHY * .8); g.rotate(PARKED[k + 2]); g.fillRect(-2.2, -.9, 4.4, 1.8); g.restore();
  }
  g.globalCompositeOperation = 'lighter'; g.filter = `blur(${MR * .7}px)`; g.strokeStyle = '#0b0'; g.lineWidth = 2.4;
  for (const b of bs) if (near(b.bb, 4)) { trace(g, b.p, 1); g.stroke(); }
  g.filter = 'none';
  return g.getImageData(0, 0, NT, NT).data;
}
const treeR = i => M.trees[i + 2] || 2.8 + 2.2 * hash(i);

// ---------- tiles: what belongs to each 64 m tile and how far its pixels reach on screen (at 1 px per metre)
const tiles = new Map();
let TINFO = null, DECKS = [];
const px1 = (x, y) => x * RX + y * RY, py1 = (x, y, z) => (x * DX + y * DY) * SIN - z * COS;
const at = (x, y) => TINFO.get(Math.max(0, Math.min(Math.ceil(M.w / TILE) - 1, Math.floor(x / TILE))) + ',' + Math.max(0, Math.min(Math.ceil(M.h / TILE) - 1, Math.floor(y / TILE))));
function grow(inf, x, y, z0, z1) { // world box of everything drawn in the tile: x0, y0, x1, y1, top
  const w = inf.w; w[0] = Math.min(w[0], x); w[1] = Math.min(w[1], y); w[2] = Math.max(w[2], x); w[3] = Math.max(w[3], y); w[4] = Math.max(w[4], z1); inf.bk = -1;
}
function tileB(inf) { // its screen box at 1 px per metre in the current view
  if (inf.bk === VROT) return inf.b;
  const w = inf.w, b = inf.b = [1e9, 1e9, -1e9, -1e9];
  for (const x of [w[0], w[2]]) for (const y of [w[1], w[3]]) {
    const u = px1(x, y); b[0] = Math.min(b[0], u); b[2] = Math.max(b[2], u); b[1] = Math.min(b[1], py1(x, y, w[4])); b[3] = Math.max(b[3], py1(x, y, 0));
  }
  inf.bk = VROT; return b;
}
const tkey = inf => inf.key + '|' + VROT;
const dropTile = key => { for (let r = 0; r < 8; r++) tiles.delete(key + '|' + r); };
function tilesIn(ox, oy) { // tiles whose screen box meets the frame at (ox, oy), current view; only near the camera
  const out = [], R = 330;
  for (let i = Math.floor((camX - R) / TILE); i <= Math.floor((camX + R) / TILE); i++) for (let j = Math.floor((camY - R) / TILE); j <= Math.floor((camY + R) / TILE); j++) {
    const inf = TINFO.get(i + ',' + j); if (!inf) continue;
    const b = tileB(inf);
    if (b[2] * PS < ox || b[0] * PS > ox + VW || b[3] * PS < oy || b[1] * PS > oy + VH) continue;
    out.push(inf);
  }
  return out;
}
const growBox = (inf, bb, z0, z1) => { for (const x of [bb[0], bb[2]]) for (const y of [bb[1], bb[3]]) grow(inf, x, y, z0, z1); };
function tileAddParked(list) { // parked cars arrive chunk by chunk (game.js ensureChunk)
  if (!TINFO) return;
  for (const k of list) { const inf = at(PARKED[k], PARKED[k + 1]); inf.parked.push(k); growBox(inf, [PARKED[k] - 3, PARKED[k + 1] - 3, PARKED[k] + 3, PARKED[k + 1] + 3], 0, 2); dropTile(inf.key); }
}
function tileInfo() {
  if (TINFO) return TINFO;
  TINFO = new Map();
  const ni = Math.ceil(M.w / TILE), nj = Math.ceil(M.h / TILE);
  for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
    const x0 = i * TILE, y0 = j * TILE;
    TINFO.set(i + ',' + j, { i, j, key: i + ',' + j, w: [x0, y0, x0 + TILE, y0 + TILE, 0], bk: -1, b: null, bs: [], trees: [], parked: [], via: [], pillars: [], stops: [] });
  }
  DECKS = M.decks.map((p, n) => {
    let area = 0, cx = 0, cy = 0; const k = p.length / 2;
    for (let i = 0; i < k; i++) { const j = (i + 1) % k; area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; cx += p[2 * i]; cy += p[2 * i + 1]; }
    return { p, h: 9.2, z0: 6, k: 'deck', r: 'f', n: 90000 + n, bb: bbox(p), ws: Math.sign(area), cx: cx / k, cy: cy / k };
  });
  for (const b of [...M.buildings, ...DECKS]) { const inf = at(b.cx, b.cy); inf.bs.push(b); growBox(inf, b.bb, 0, b.h + 2); }
  for (let i = 0; i < M.trees.length; i += 3) {
    const x = M.trees[i], y = M.trees[i + 1], r = treeR(i), inf = at(x, y);
    inf.trees.push(i); growBox(inf, [x - r, y - r, x + r, y + r], 0, treeH(r) + r);
  }
  for (let k = 0; k < PARKED.length; k += 4) { const inf = at(PARKED[k], PARKED[k + 1]); inf.parked.push(k); growBox(inf, [PARKED[k] - 3, PARKED[k + 1] - 3, PARKED[k] + 3, PARKED[k + 1] + 3], 0, 2); }
  for (const r of M.rails) if (r.v) {
    let run = 0;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], ay = r.p[i + 1], bx = r.p[i + 2], by = r.p[i + 3], L = Math.hypot(bx - ax, by - ay);
      const inf = at((ax + bx) / 2, (ay + by) / 2); inf.via.push([ax, ay, bx, by]);
      growBox(inf, [Math.min(ax, bx) - 5, Math.min(ay, by) - 5, Math.max(ax, bx) + 5, Math.max(ay, by) + 5], 0, 8);
      for (let d = 14 - run % 14; d < L; d += 14) { // pillars every 14 m
        const x = ax + (bx - ax) * d / L, y = ay + (by - ay) * d / L, pi = at(x, y);
        pi.pillars.push([x, y, Math.atan2(by - ay, bx - ax)]); growBox(pi, [x - 4, y - 4, x + 4, y + 4], 0, 7);
      }
      run += L;
    }
  }
  for (let i = 0; i < M.stops.length; i += 2) { const inf = at(M.stops[i], M.stops[i + 1]); inf.stops.push(i); growBox(inf, [M.stops[i] - 1, M.stops[i + 1] - 1, M.stops[i] + 1, M.stops[i + 1] + 1], 0, 3); }
  return TINFO;
}
function makeTile(inf) {
  const x0 = inf.i * TILE, y0 = inf.j * TILE, b = tileB(inf);
  for (const [x, y] of [[x0 - 8, y0 - 8], [x0 + TILE + 8, y0 - 8], [x0 - 8, y0 + TILE + 8], [x0 + TILE + 8, y0 + TILE + 8]]) ensureChunk(x / CK | 0, y / CK | 0); // its parked cars (and the neighbours' shadows)
  const ox = Math.floor(b[0] * PS) - 2, oy = Math.floor(b[1] * PS) - 2, t = newTarget(ox, oy, Math.ceil(b[2] * PS) - ox + 2, Math.ceil(b[3] * PS) - oy + 2);
  T = t;
  const mat = materials(x0, y0), shd = shadows(x0, y0), w = t.w, tufts = [];
  const cs = [[x0, y0], [x0 + TILE, y0], [x0, y0 + TILE], [x0 + TILE, y0 + TILE]], gxs = cs.map(([x, y]) => PX(x, y)), gys = cs.map(([x, y]) => PY(x, y, 0));
  const gx0 = Math.floor(Math.min(...gxs)), gx1 = Math.ceil(Math.max(...gxs)), gy0 = Math.floor(Math.min(...gys)), gy1 = Math.ceil(Math.max(...gys));
  for (let gy = gy0; gy < gy1; gy++) for (let gx = gx0; gx < gx1; gx++) {
    const u = (gx + .5) / PS, v = (gy + .5) / PS / SIN, x = u * RX + v * DX, y = u * RY + v * DY;
    if (x < x0 || x >= x0 + TILE || y < y0 || y >= y0 + TILE) continue;
    const mi = ((y - y0) * MR | 0) * NT + ((x - x0) * MR | 0), m = mat[mi];
    if (!m) continue;
    let c = groundPx(m, x, y, gx, gy);
    const sh = shd[mi * 4] > 100;
    if (sh) c = tintC(c, .56, .54, .74);
    if (shd[mi * 4 + 1] > bay(gx, gy) * 400) c = tintC(c, .8, .78, .88);
    const k = (gy - oy) * w + gx - ox;
    t.col[k] = c; t.dep[k] = DEP(x, y, 0); t.knd[k] = 1;
    if ((m === GRASSM || m === YARD) && h2(gx * 3, gy * 5) < .14) tufts.push(k, gx, gy, sh);
  }
  // grass blades, 1-3 px, only over ground
  for (let q = 0; q < tufts.length; q += 4) {
    const k = tufts[q], gx = tufts[q + 1], gy = tufts[q + 2], hgt = 1 + (h2(gx, gy * 2) * 3 | 0), base = Math.round(noise2(gx * .09, gy * .18) * 2.2);
    for (let r = 1; r <= hgt; r++) {
      const j = k - r * w;
      if (j < 0 || t.knd[j] !== 1) break;
      const c = GRASSP[Math.min(4, base + r)];
      t.col[j] = tufts[q + 3] ? tintC(c, .56, .54, .74) : c;
    }
  }
  for (const bd of inf.bs) building(bd);
  for (const i of inf.trees) tree(M.trees[i], M.trees[i + 1], treeR(i), i);
  for (const k of inf.parked) if (PARKED[k + 3] >= 0) car3d(PARKED[k], PARKED[k + 1], PARKED[k + 2], hexC(PAINT[PARKED[k + 3] * PAINT.length | 0]));
  for (const s of inf.via) viaSeg(...s);
  for (const [x, y, a] of inf.pillars) for (const s of [-2.6, 2.6]) obox(x - Math.sin(a) * s, y + Math.cos(a) * s, a, .6, .6, 0, 5.9, flat(STEEL));
  const pole = pack(110, 110, 116), yel = pack(242, 194, 0), grn = pack(30, 122, 60);
  for (const i of inf.stops) { // Berlin bus stop: the green H on a yellow disc, on a pole
    const x = M.stops[i], y = M.stops[i + 1], dz = 1 / (COS * PS);
    column(x, y, 0, 2.2, pole); plot(x, y, 2.2, yel); plot(x, y, 2.2 + dz, grn); plot(x, y, 2.2 + 2 * dz, yel);
  }
  const cone = pack(255, 106, 0), white = pack(250, 250, 246);
  for (const wk of WORKS) for (let i = 0; i + 3 < wk.pts.length; i += 2) {
    const p = wk.pts, L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    for (let d = 0; d < L; d += wk.closed ? 3 : 6) {
      const x = p[i] + (p[i + 2] - p[i]) * d / L, y = p[i + 1] + (p[i + 3] - p[i + 1]) * d / L;
      if (x < x0 || x >= x0 + TILE || y < y0 || y >= y0 + TILE) continue;
      const dz = 1 / (COS * PS);
      plot(x, y, 0, cone); plot(x, y, dz, white); plot(x, y, 2 * dz, cone);
    }
  }
  T = FT;
  return t;
}
function invalidateTiles(x, y) { // something static changed at (x, y): rebake that tile and its neighbours
  const i = Math.floor(x / TILE), j = Math.floor(y / TILE);
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) dropTile((i + a) + ',' + (j + b));
}
function blit(t) {
  const fx0 = t.ox - FT.ox, fy0 = t.oy - FT.oy;
  const x0 = Math.max(0, fx0), x1 = Math.min(VW, fx0 + t.w), y0 = Math.max(0, fy0), y1 = Math.min(VH, fy0 + t.h);
  for (let y = y0; y < y1; y++) {
    let i = y * VW + x0, j = (y - fy0) * t.w + x0 - fx0;
    for (let x = x0; x < x1; x++, i++, j++) { const d = t.dep[j]; if (d > zb[i]) { zb[i] = d; pix[i] = t.col[j]; knd[i] = t.knd[j]; } }
  }
}

// ---------- per-frame effects on the frame buffer
function unground(ix, iy) { const u = (ix + FT.ox + .5) / PS, v = (iy + FT.oy + .5) / PS / SIN; return [u * RX + v * DX, u * RY + v * DY]; }
// darken (or colour) the ground under a rotated rectangle; only pixels that show ground, each once
function groundRect(x, y, a, l, w, fn) {
  const c = Math.cos(a), s = Math.sin(a), r = (l + w) / 2;
  const sx = PX(x, y) - FT.ox, sy = PY(x, y, 0) - FT.oy, rx = r * PS * .75, ry = r * PS * .45;
  for (let iy = Math.max(0, Math.floor(sy - ry)); iy <= Math.min(VH - 1, Math.ceil(sy + ry)); iy++)
    for (let ix = Math.max(0, Math.floor(sx - rx)); ix <= Math.min(VW - 1, Math.ceil(sx + rx)); ix++) {
      const i = iy * VW + ix;
      if (knd[i] !== 1) continue;
      const [gx, gy] = unground(ix, iy), dx = gx - x, dy = gy - y;
      if (Math.abs(dx * c + dy * s) > l / 2 || Math.abs(-dx * s + dy * c) > w / 2) continue;
      pix[i] = fn(pix[i], ix, iy); knd[i] = 3;
    }
}
const shadowFn = c => tintC(c, .56, .54, .74);
function glow(x, y, r, col, k) { // tint everything around a point (police lights)
  const sx = PX(x, y) - FT.ox, sy = PY(x, y, 0) - FT.oy, R = r * PS;
  for (let iy = Math.max(0, Math.floor(sy - R * .6)); iy <= Math.min(VH - 1, sy + R * .6); iy++)
    for (let ix = Math.max(0, Math.floor(sx - R)); ix <= Math.min(VW - 1, sx + R); ix++) {
      const dx = (ix - sx) / R, dy = (iy - sy) / (R * .6), q = 1 - dx * dx - dy * dy;
      if (q <= 0 || q * k < bay(ix, iy) * .5) continue;
      const i = iy * VW + ix, p = pix[i];
      pix[i] = pack(lerp(p & 255, col[0], .35), lerp(p >> 8 & 255, col[1], .35), lerp(p >> 16 & 255, col[2], .35));
    }
}
// pixel-art edges from the depth buffer: objects get a dark outline against the ground, a warm rim on their
// upper/left edges over other objects and a dark line where they disappear behind something
function edges() {
  const GY = COS / (PS * SIN), E = Math.max(.3, 1.4 / PS);
  for (let iy = 1; iy < VH - 1; iy++) for (let ix = 1; ix < VW - 1; ix++) {
    const i = iy * VW + ix;
    if (knd[i] !== 2) continue;
    const d = zb[i], a = i - VW, b = i + VW, c = i - 1, e = i + 1;
    if (knd[a] !== 2 || knd[b] !== 2 || knd[c] !== 2 || knd[e] !== 2) pix[i] = tintC(pix[i], .68, .66, .76);
    else if (d - zb[a] - GY > E || d - zb[c] > E) { const p = pix[i]; pix[i] = pack(lerp(p & 255, WARM[0], .3), lerp(p >> 8 & 255, WARM[1], .3), lerp(p >> 16 & 255, WARM[2], .22)); }
    else if (zb[e] - d > E || zb[b] - GY - d > E) pix[i] = tintC(pix[i], .74, .72, .82);
  }
}
// draw something into a scratch target, then show it as a checkered silhouette wherever the frame hides it
function xray(x, y, draw, col) {
  const w = 12 * PS, h = 10 * PS, S = newTarget(Math.round(PX(x, y)) - w / 2, Math.round(PY(x, y, 0)) - h * .7 | 0, w, h);
  T = S; draw(); T = FT;
  const R = ramp(col);
  for (let iy = 0; iy < h; iy++) for (let ix = 0; ix < w; ix++) {
    const k = iy * w + ix, fx = ix + S.ox - FT.ox, fy = iy + S.oy - FT.oy;
    if (S.dep[k] === -Infinity || fx < 0 || fy < 0 || fx >= VW || fy >= VH) continue;
    const i = fy * VW + fx;
    if (zb[i] > S.dep[k] + .05) pix[i] = (fx + fy) & 1 ? R[4] : R[1];
  }
}
// a bobbing pixel arrow pointing down at a target
const ARROW = ['....ooooo....', '....oXXXo....', '....oXXXo....', '....oXXXo....', 'oooooXXXooooo', 'oXXXXXXXXXXXo',
  '.oXXXXXXXXXo.', '..oXXXXXXXo..', '...oXXXXXo...', '....oXXXo....', '.....oXo.....', '......o......'];
const INK = pack(28, 27, 25), PAPER = pack(255, 255, 255);
function arrow(sx, sy, fill) {
  const left = Math.round(sx) - 6, top = Math.round(sy) - ARROW.length - 2 - (G.time * 3 | 0) % 2 * 2;
  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < VW && y < VH) pix[y * VW + x] = c; };
  ARROW.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === 'o') for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) put(left + x + dx, top + y + dy, PAPER); }));
  ARROW.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') put(left + x, top + y, ch === 'o' ? INK : fill); }));
}

// ---------- dynamic things
const LAMP = { r: pack(255, 60, 40), y: pack(255, 190, 0), g: pack(70, 235, 120) }, LAMP_OFF = pack(46, 46, 52), POLE = pack(70, 72, 78);
function drawSignals() {
  const dz = 1 / (COS * PS);
  for (const [n, j] of SIG) {
    const x = NX(n), y = NY(n);
    if (!onScreen(x, y, 8)) continue;
    const nb = M.adj[n][0] ?? n, a = Math.atan2(NY(nb) - y, NX(nb) - x), e = EMAP.get(ekey(n, nb)), off = (e ? e.w / 2 : 5) + .8;
    const px = x - Math.sin(a) * off, py = y + Math.cos(a) * off, [st] = light(j, a);
    column(px, py, 0, 3, POLE);
    plot(px, py, 3, st === 'g' ? LAMP.g : LAMP_OFF); plot(px, py, 3 + dz, st === 'y' ? LAMP.y : LAMP_OFF); plot(px, py, 3 + 2 * dz, st === 'r' ? LAMP.r : LAMP_OFF);
  }
}
// track ends, so a train can roll on from one OSM way into the next
let RAILEND = null;
const rkey = (x, y) => Math.round(x) + ',' + Math.round(y);
function railEnds() {
  RAILEND = new Map();
  for (const r of M.rails) for (const [k, start] of [[rkey(r.p[0], r.p[1]), true], [rkey(r.p[r.p.length - 2], r.p[r.p.length - 1]), false]]) {
    if (!RAILEND.has(k)) RAILEND.set(k, []); RAILEND.get(k).push({ r, start });
  }
}
// d metres along a track from segment i at t, dir +1 towards later points; -> [x, y]
function railWalk(r, i, t, dir, d) {
  let p = r.p, x = p[2 * i] + (p[2 * i + 2] - p[2 * i]) * t, y = p[2 * i + 1] + (p[2 * i + 3] - p[2 * i + 1]) * t;
  for (let guard = 0; guard < 400; guard++) {
    const ex = dir > 0 ? p[2 * i + 2] : p[2 * i], ey = dir > 0 ? p[2 * i + 3] : p[2 * i + 1], L = Math.hypot(ex - x, ey - y);
    if (d <= L) return L ? [x + (ex - x) * d / L, y + (ey - y) * d / L] : [x, y];
    d -= L; x = ex; y = ey; i += dir;
    if (i < 0 || 2 * i + 3 >= p.length) { // end of this way: continue on a way that starts or ends here
      if (!RAILEND) railEnds();
      const nx = (RAILEND.get(rkey(x, y)) || []).find(o => o.r !== r && o.r.v === r.v);
      if (!nx) return [x, y];
      r = nx.r; p = r.p;
      if (nx.start) { i = 0; dir = 1; } else { i = p.length / 2 - 2; dir = -1; }
    }
  }
  return [x, y];
}
console.assert(railWalk({ p: [0, 0, 10, 0, 10, 10], v: 0 }, 0, .5, 1, 10).join() === '10,5', 'railWalk');
// snap a train to the nearest track (viaduct for U-Bahn); -> [x, y, angle, rail, segment, t, dir] or null
function snapRail(b) {
  let best = null, bd = 40;
  for (const r of M.rails) {
    if (b.name.startsWith('U') && !r.v) continue; // U-Bahn only where it's up on a viaduct; S-Bahn on any track
    if (b.x < r.bb[0] - 40 || b.x > r.bb[2] + 40 || b.y < r.bb[1] - 40 || b.y > r.bb[3] + 40) continue;
    const p = r.p;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const dx = p[i + 2] - p[i], dy = p[i + 3] - p[i + 1], l2 = dx * dx + dy * dy || 1;
      const t = clamp(((b.x - p[i]) * dx + (b.y - p[i + 1]) * dy) / l2, 0, 1), x = p[i] + dx * t, y = p[i + 1] + dy * t, d = dist(b.x, b.y, x, y);
      if (d < bd) { bd = d; const a = Math.atan2(dy, dx), dir = Math.cos(a - b.a) < 0 ? -1 : 1; best = [x, y, dir < 0 ? a + Math.PI : a, r, i / 2, t, dir]; }
    }
  }
  return best;
}
// a bicycle drawn as 3D lines: two wheels, diamond frame, saddle, handlebar. lying = fallen over
function bike3d(x, y, a, col = '#2b5c8a', lying) {
  const fx = Math.cos(a), fy = Math.sin(a), sx = -fy, sy = fx, step = .7 / PS, tyre = pack(30, 30, 34), fr = hexC(col), frame = pack(...fr), dark = pack(...fr.map(v => v * .6 | 0));
  const P = (along, z) => lying ? [x + fx * along + sx * z, y + fy * along + sy * z, .08] : [x + fx * along, y + fy * along, z];
  const line = (a0, z0, a1, z1, c) => { const n = Math.max(1, Math.ceil(Math.hypot(a1 - a0, z1 - z0) / step)); for (let k = 0; k <= n; k++) plot(...P(a0 + (a1 - a0) * k / n, z0 + (z1 - z0) * k / n), c); };
  const R = .34, hub = .52;
  for (const h of [-hub, hub]) { const n = Math.ceil(2 * Math.PI * R / step); for (let k = 0; k < n; k++) { const t = k / n * 2 * Math.PI; plot(...P(h + Math.cos(t) * R, R + Math.sin(t) * R), tyre); } }
  line(-hub, R, 0, .3, frame); line(0, .3, -.2, .82, frame); line(-.2, .82, -hub, R, frame); // rear triangle
  line(-.2, .78, .36, .8, frame); line(0, .3, .36, .8, frame); line(.36, .8, hub, R, frame); // top tube, down tube, fork
  line(-.3, .9, -.1, .9, dark); line(.36, .8, .4, 1, frame); line(.4, 1, .3, 1, dark); // saddle, stem, handlebar
}
const POLICE_C = [226, 230, 236];
const FRAME_C = [40, 40, 46];
function drawCar(c) {
  if (c.kind === 'foot') { person(c.x, c.y, c.ph, pedColours(c), G.downT > 0); return; }
  if (c.kind === 'bike') {
    if (c.fall > 0) { bike3d(c.x, c.y, c.a + 1.2, c.frame, true); person(c.x + .6, c.y, 0, pedColours(c), true); return; }
    bike3d(c.x, c.y, c.a, c.frame, false);
    person(c.x - Math.cos(c.a) * .2, c.y - Math.sin(c.a) * .2, c.ph, pedColours(c), false, .6);
    return;
  }
  car3d(c.x, c.y, c.a, c.police ? POLICE_C : hexC(c.color), { police: c.police, lit: c.kind === 'police' && (c.chase || c.stop || c.block), braking: c.braking,
    cargo: c === player && G.job && G.job.stage === 'deliver' ? hexC(G.job.f.col) : null });
}
function drawHeli(h) { // police helicopter: blue/white body, spinning rotor, spotlight on the ground
  groundRect(h.x, h.y, 0, 18, 18, (c, ix, iy) => { const [gx, gy] = unground(ix, iy); return dist(gx, gy, h.x, h.y) < 9 ? pack(lerp(c & 255, 255, .35), lerp(c >> 8 & 255, 248, .35), lerp(c >> 16 & 255, 210, .3)) : c; });
  obox(h.x, h.y, h.a, 5.5, 2, 30, 32, (f, u, v, i, gx, gy) => tone(ramp(f > 2 && v < .5 ? POLBLUE : POLICE_C), i, gx, gy));
  obox(h.x - Math.cos(h.a) * 4.5, h.y - Math.sin(h.a) * 4.5, h.a, 4, .4, 31.2, 31.8, flat(POLICE_C));
  for (const r of [G.time * 25, G.time * 25 + Math.PI / 2]) obox(h.x, h.y, r, 10, .3, 32.3, 32.45, flat([30, 30, 34]));
}
// the view follows the car: once it has pointed into another 45° sector for a moment, that view is baked in the
// background (a few ms per frame) and switched to when its tiles are ready
let viewWant = 0, viewSince = 0, viewNext = -1;
function followView() {
  if (player.kind === 'foot' || Math.abs(speedOf(player)) < 2) { viewSince = performance.now(); return; }
  const h = player.a + 3 * Math.PI / 4, k = ((Math.round(h / (Math.PI / 4)) % 8) + 8) % 8;
  if (Math.abs(angDiff(h, VROT * Math.PI / 4)) < Math.PI / 8 + .3) { viewNext = -1; viewSince = performance.now(); return; } // still inside the current sector (+ hysteresis)
  if (k !== viewWant) { viewWant = k; viewSince = performance.now(); }
  if (performance.now() - viewSince > 350) viewNext = k;
}
function prebakeView(t0) {
  if (viewNext < 0 || viewNext === VROT) return;
  const keep = VROT; setView(viewNext);
  const ox = Math.round(PX(camX, camY)) - (VW >> 1), oy = Math.round(PY(camX, camY, 0)) - (VH >> 1);
  let left = 0;
  for (const inf of tilesIn(ox, oy)) {
    if (tiles.has(tkey(inf))) continue;
    if (performance.now() - t0 > 7) { left++; continue; }
    tiles.set(tkey(inf), makeTile(inf));
  }
  setView(keep);
  if (!left) { setView(viewNext); viewNext = -1; }
}
function onScreen(x, y, m = 0) {
  const u = PX(x - camX, y - camY), v = PY(x - camX, y - camY, 0);
  return Math.abs(u) < VW / 2 + m * PS && Math.abs(v) < VH / 2 + m * PS;
}
// frame coordinates of a ground point
const fxy = (x, y, z = 0) => [PX(x, y) - FT.ox, PY(x, y, z) - FT.oy];

// ---------- frame
const BG = pack(24, 46, 34);
let uiQueue = [];
function render() {
  const ahead = player.kind === 'foot' ? 0 : 8; // look ahead of the car
  camX += (player.x + player.vx * .6 + Math.cos(player.a) * ahead - camX) * .08; camY += (player.y + player.vy * .6 + Math.sin(player.a) * ahead - camY) * .08;
  followView();
  const sh = G.shake > .5 ? G.shake * .35 : 0;
  FT = { ox: Math.round(PX(camX, camY) + rnd(-sh, sh)) - (VW >> 1), oy: Math.round(PY(camX, camY, 0) + rnd(-sh, sh)) - (VH >> 1), w: VW, h: VH, col: pix, dep: zb, knd };
  pix.fill(BG); zb.fill(-Infinity); knd.fill(0);
  T = FT;

  // static city: visible tiles, baking missing ones nearest first (all at once if the screen would be mostly empty)
  const vis = [], need = [];
  tileInfo();
  for (const inf of tilesIn(FT.ox, FT.oy)) {
    const k = tkey(inf), t = tiles.get(k);
    if (t) { tiles.delete(k); tiles.set(k, t); vis.push(t); } else need.push(inf);
  }
  const t0 = performance.now();
  if (need.length) {
    const cx = PX(camX, camY) / PS, cy = PY(camX, camY, 0) / PS, mid = b => Math.hypot((b[0] + b[2]) / 2 - cx, (b[1] + b[3]) / 2 - cy);
    need.sort((a, b) => mid(tileB(a)) - mid(tileB(b)));
    const all = vis.length < need.length;
    for (const inf of need) {
      if (!all && performance.now() - t0 > 6) break;
      const t = makeTile(inf); tiles.set(tkey(inf), t); vis.push(t);
    }
  }
  prebakeView(t0);
  while (tiles.size > Math.max(90, vis.length * 2 + 10)) tiles.delete(tiles.keys().next().value);
  for (const t of vis) blit(t);

  // ground effects, then everything that moves
  groundRect(shop.x, shop.y, 0, 12, 12, (c, ix, iy) => (ix + iy) % 3 ? pack(lerp(c & 255, 214, .5), lerp(c >> 8 & 255, 79, .5), lerp(c >> 16 & 255, 160, .5)) : c);
  for (const c of cars) if (onScreen(c.x, c.y, 6)) c.kind === 'foot' || c.kind === 'bike' ? groundRect(c.x + SHX * .5, c.y + SHY * .5, c.a, c.kind === 'bike' ? 1.6 : .7, .6, shadowFn) : groundRect(c.x + SHX * .9, c.y + SHY * .9, c.a, 4.6, 2, shadowFn);
  for (const b of buses) if (!b.train && onScreen(b.x, b.y, 15)) groundRect(b.x + SHX * 1.5, b.y + SHY * 1.5, b.a, b.len, 2.7, shadowFn);
  for (const c of cars) if (c !== player && onScreen(c.x, c.y, 6)) drawCar(c);
  for (const b of buses) {
    if (!b.train) { if (onScreen(b.x, b.y, 15)) bus3d(b.x, b.y, b.a, b.len, [242, 196, 0]); continue; }
    if (!onScreen(b.x, b.y, 35)) continue;
    const s = snapRail(b);
    if (!s) continue;
    // separate cars that follow the curves: U-Bahn small profile 4 × 12.8 m, S-Bahn 4 × 18 m (one Halbzug)
    const u = b.name.startsWith('U'), cl = u ? 12.8 : 18, n = 4, gap = .9, total = n * cl + (n - 1) * gap, [, , , r, i, t, dir] = s;
    const pos = d => d >= 0 ? railWalk(r, i, t, dir, d) : railWalk(r, i, t, -dir, -d); // + ahead, - behind the snap point
    for (let k = 0; k < n; k++) {
      const front = total / 2 - k * (cl + gap), A = pos(front), B = pos(front - cl);
      bus3d((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, Math.atan2(A[1] - B[1], A[0] - B[0]), cl, u ? [242, 205, 0] : [181, 51, 46], r.v ? 7.05 : 0, true);
    }
  }
  for (const pd of peds) {
    if (!onScreen(pd.x, pd.y, 3)) continue;
    const pc = pedColours(pd);
    person(pd.x, pd.y, pd.ph, pc, pd.fall > 0);
    if (pd.dog) { const dx = -Math.cos(pd.a) * 1.1, dy = -Math.sin(pd.a) * 1.1, br = pack(122, 85, 50); plot(pd.x + dx, pd.y + dy, .3, br); plot(pd.x + dx * 1.4, pd.y + dy * 1.4, .3, br); }
  }
  drawSignals();
  drawCar(player);
  if (G.heli && onScreen(G.heli.x, G.heli.y, 40)) drawHeli(G.heli);
  for (const c of cars) if (c.kind === 'police' && (c.chase || c.stop || c.block) && onScreen(c.x, c.y, 10)) glow(c.x, c.y, 5, (G.time * 7 | 0) % 2 ? [120, 170, 255] : [40, 90, 255], 1);
  edges();
  xray(player.x, player.y, () => drawCar(player), hexC(player.color));

  // overlays
  uiQueue = [];
  if (G.wanted > 0 && G.time - G.lastSeen > 1.5) { // where they think you are
    const R = searchRadius(), blue = pack(110, 160, 255);
    for (let k = 0; k < 160; k++) {
      if ((k >> 2) % 2) continue;
      const [x, y] = fxy(G.known.x + Math.cos(k / 160 * 6.283) * R, G.known.y + Math.sin(k / 160 * 6.283) * R), ix = x | 0, iy = y | 0;
      if (ix >= 0 && iy >= 0 && ix < VW && iy < VH) pix[iy * VW + ix] = blue;
    }
  }
  const j = G.job;
  if (j && j.stage === 'pickup') target(j.pickup, pack(255, 214, 10), '#ffd60a', `PICKUP ${Math.round(dist(player.x, player.y, j.pickup.x, j.pickup.y))} m`);
  if (j && j.stage === 'deliver') target(j.drop, pack(155, 211, 45), '#9bd32d', `DROP ${Math.round(dist(player.x, player.y, j.drop.x, j.drop.y))} m`);
  if (G.wanted > 0) target(shop, pack(214, 79, 160), '#d64fa0', 'SPRAY');
  ctx.putImageData(frameImg, 0, 0);
  drawUI();
  drawMini();
}
function target(t, fill, css, label) {
  const [x, y] = fxy(t.x, t.y), m = 16;
  if (x > m && x < VW - m && y > m + 14 && y < VH - m) { arrow(x, y, fill); return; }
  uiQueue.push(['edge', x, y, css, label]);
}
const FONT = '"Inter Tight", "Helvetica Neue", Arial, sans-serif', MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
function drawUI() {
  const g = uctx, k = SCALE; // frame px -> device px
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ui.width, ui.height);
  // labels over the world
  g.textAlign = 'center'; g.font = `600 ${11 * DPR}px ${MONO}`;
  const label = (x, y, text, bg, fg) => {
    const w = g.measureText(text).width + 10 * DPR;
    g.fillStyle = bg; g.fillRect(x * k - w / 2, y * k - 16 * DPR, w, 18 * DPR); g.fillStyle = fg; g.fillText(text, x * k, y * k - 3 * DPR);
  };
  if (onScreen(shop.x, shop.y, 0)) { const [x, y] = fxy(shop.x, shop.y, 4); label(x, y, 'SPRAY €150', '#d64fa0', '#fff'); }
  for (const c of cars) {
    if (c.kind !== 'police' || !onScreen(c.x, c.y, 0)) continue;
    const [x, y] = fxy(c.x, c.y, 3.2);
    if (c.stop) label(x, y, (G.time * .7 | 0) % 2 ? 'STOP' : 'POLIZEI', '#111', (G.time * 2 | 0) % 2 ? '#ff3b2a' : '#ffd23f');
    else if (c.block) label(x, y, 'ROADBLOCK', '#1d4fd8', '#fff');
    else if (c.chase) label(x, y, sees(c) ? 'PURSUIT' : 'SEARCHING', sees(c) ? '#d0021b' : '#1d4fd8', '#fff');
    else if (c.warnT > 0) label(x, y, '! WARNING', '#e8c45a', '#132a1e');
  }
  // off-screen targets: arrow at the screen edge
  for (const [, x, y, css, text] of uiQueue) {
    const cx = ui.width / 2, cy = ui.height / 2, a = Math.atan2(y * k - cy, x * k - cx), m = 46 * DPR;
    const sc = Math.min((cx - m) / Math.abs(Math.cos(a)), (cy - m) / Math.abs(Math.sin(a)));
    g.setTransform(1, 0, 0, 1, cx + Math.cos(a) * sc, cy + Math.sin(a) * sc);
    g.font = `600 ${12 * DPR}px ${MONO}`; g.fillStyle = '#132a1e'; g.fillText(text, 1.5 * DPR, -16.5 * DPR); g.fillStyle = css; g.fillText(text, 0, -18 * DPR);
    g.rotate(a); g.fillStyle = css; g.strokeStyle = '#132a1e'; g.lineWidth = 2 * DPR;
    g.beginPath(); g.moveTo(14 * DPR, 0); g.lineTo(-8 * DPR, -10 * DPR); g.lineTo(-8 * DPR, 10 * DPR); g.closePath(); g.fill(); g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (G.bannerT > 0) {
    g.textAlign = 'center'; g.font = `800 ${40 * DPR}px ${FONT}`;
    g.fillStyle = '#132a1e'; g.fillText(G.banner, ui.width / 2 + 3 * DPR, ui.height * .3 + 3 * DPR);
    g.fillStyle = G.banner.startsWith('BUSTED') ? '#ff5a4a' : '#f3efe4'; g.fillText(G.banner, ui.width / 2, ui.height * .3);
  }
}

// ---------- minimap: the same iso orientation as the view, about 500 m across
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
  const g = mctx, k = size / 500, e = size / 2 - k * (player.x * RX + player.y * RY), f = size / 2 - k * SIN * (player.x * DX + player.y * DY);
  const mp = (x, y) => [k * (x * RX + y * RY) + e, k * SIN * (x * DX + y * DY) + f];
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#132a1e'; g.fillRect(0, 0, size, size);
  g.setTransform(k * RX, k * SIN * DX, k * RY, k * SIN * DY, e, f);
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
    g.strokeStyle = 'rgba(110,160,255,.8)'; g.setLineDash([4 * dpr, 4 * dpr]); g.beginPath(); g.ellipse(px, py, r, r * SIN, 0, 0, 7); g.stroke(); g.setLineDash([]);
  }
  const j = G.job;
  if (j && j.stage === 'pickup') dot(j.pickup.x, j.pickup.y, 5, '#ffd60a', true);
  if (j && j.stage === 'deliver') dot(j.drop.x, j.drop.y, 5, '#9bd32d', true);
  if (G.wanted > 0) dot(shop.x, shop.y, 4, '#d64fa0', true);
  for (const c of cars) if (c.kind === 'police') dot(c.x, c.y, 3, c.chase || c.stop || c.block ? ((G.time * 4 | 0) % 2 ? '#ff4a3a' : '#4a8cff') : '#4a8cff');
  if (G.heli) dot(G.heli.x, G.heli.y, 4, '#ffffff');
  // you: an arrow along your heading, turned into the minimap's iso frame
  const [px, py] = mp(player.x, player.y), hx = Math.cos(player.a), hy = Math.sin(player.a), dx = hx * RX + hy * RY, dy = SIN * (hx * DX + hy * DY), dl = Math.hypot(dx, dy) || 1;
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
