'use strict';
// WebGL renderer for Obst-Taxi, built on three.js r158 (MIT, vendor/three.min.js).
// A chase camera stays behind the car. The frame is rendered small and scaled up in whole pixels, with the pixel-art
// treatment of the earlier iso renderer (after "Pixel Plays" by Amir Mushich, MIT): every surface is shaded into
// hue-shifted 5-tone ramps (shadows drift violet, lights warm) with a Bayer dither, and a post pass draws dark
// outlines where the depth jumps. The city is built in 256 m chunks around the camera: a ground texture (streets,
// sidewalks, markings, parks, water), buildings with windows drawn by the shader, trees, parked cars, the viaduct,
// bus stops, traffic lights and roadwork cones. Everything that moves is drawn as instances each frame.
// Loaded before game.js: functions here use game globals (M, player, cars, G, ...) only when they are called.
// World: x east, y south, z up (metres). three.js: X = x, Y = z, Z = y.

const T3 = THREE;
T3.ColorManagement.enabled = false; // colours are the same bytes the old renderer used, no sRGB conversion

// ---------- frame size: detail level 1..4 (key P or ?px=N, remembered) = game pixels across the screen
const DETAILS = [480, 720, 960, 1440];
let DETAIL = (() => { let n = +new URLSearchParams(location.search).get('px'); try { if (!n) n = +localStorage.getItem('obst-px'); } catch (e) {} return Math.min(4, Math.max(1, n || 3)); })();
let RES = DETAILS[DETAIL - 1];
const cv = document.getElementById('c'), ui = document.getElementById('ui'), uctx = ui.getContext('2d');
const renderer = new T3.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.outputColorSpace = T3.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = T3.BasicShadowMap; // hard pixel shadows
const scene = new T3.Scene(), camera = new T3.PerspectiveCamera(42, 1, 1, 1600);
const HAZE = 0xc8cdc2; scene.background = new T3.Color(HAZE); scene.fog = new T3.Fog(HAZE, 420, 820);
let DPR = 1, VW = 0, VH = 0, SCALE = 3, RT = null;
function resize() {
  DPR = devicePixelRatio || 1;
  const dw = Math.round(innerWidth * DPR), dh = Math.round(innerHeight * DPR);
  SCALE = Math.max(1, Math.round(dw / RES)); // about RES game pixels across, each one a whole number of screen pixels
  VW = Math.ceil(dw / SCALE); VH = Math.ceil(dh / SCALE);
  renderer.setSize(VW, VH, false);
  cv.style.width = VW * SCALE / DPR + 'px'; cv.style.height = VH * SCALE / DPR + 'px';
  ui.width = dw; ui.height = dh;
  if (RT) RT.dispose();
  RT = new T3.WebGLRenderTarget(VW, VH, { minFilter: T3.NearestFilter, magFilter: T3.NearestFilter, depthTexture: new T3.DepthTexture(VW, VH) });
  camera.aspect = VW / VH; camera.updateProjectionMatrix();
  POST.uniforms.res.value.set(VW, VH);
}
function setDetail(n) {
  DETAIL = (n - 1 + 4) % 4 + 1; RES = DETAILS[DETAIL - 1];
  try { localStorage.setItem('obst-px', DETAIL); } catch (e) {}
  resize();
}
const DISTS = [42, 58, 78, 104]; let distI = 1; // camera distance from the car when standing (+/-); speed adds to it
function isoZoom(d) { distI = Math.max(0, Math.min(DISTS.length - 1, distI - d)); }

// ---------- the pixel-art shading, patched into three's Lambert material
const RAMP_GLSL = `
{
  const float BAY[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  vec3 alb = max(diffuseColor.rgb, vec3(.004));
  float l = dot(outgoingLight, vec3(.3, .59, .11)) / dot(alb, vec3(.3, .59, .11));
  int bi = int(mod(gl_FragCoord.y, 4.)) * 4 + int(mod(gl_FragCoord.x, 4.));
  float t = l * 3.4 - .4 + ((BAY[bi] + .5) / 16. - .5) * .5;
  int k = int(clamp(floor(t), 0., 4.));
  const vec3 COOL = vec3(46., 38., 84.) / 255., WARM = vec3(255., 232., 180.) / 255.;
  vec3 c = k == 0 ? mix(alb * .4, COOL, .34) : k == 1 ? mix(alb * .62, COOL, .18) : k == 2 ? mix(alb * .84, COOL, .05) : k == 3 ? alb : mix(min(alb * 1.1, vec3(1.)), WARM, .22);
  gl_FragColor = vec4(c, diffuseColor.a);
}`;
// facades: windows, frames, sky in the glass, curtains, ledges, a shop front on street walls. wuv = (along wall, height,
// wall height) in metres, wst = (style, seed, shop front, wall length); style < 0 = not a wall
const FACADE_GLSL = `
if (vWst.x >= 0.) {
  int st = int(vWst.x + .5);
  // storey height, cell width, window x0, x1, z0, z1 (metres) for alt, platte, brick, office, low, deck
  float FH[6] = float[6](3.6, 2.9, 4.2, 3.5, 3.3, 99.);
  float CW[6] = float[6](3.4, 3., 3.6, 1.6, 6., 99.);
  vec4 WIN[6] = vec4[6](vec4(1.1, 2.3, .9, 3.), vec4(.5, 2.5, .95, 2.3), vec4(.8, 2.8, 1., 3.6), vec4(.12, 1.5, .9, 3.1), vec4(1.2, 4.8, 0., 2.6), vec4(0.));
  float s = vWuv.x, z = vWuv.y, Hh = vWuv.z, L = vWst.w, seed = vWst.y;
  vec3 base = diffuseColor.rgb;
  vec3 glass = vec3(52., 64., 84.) / 255., frame = (st == 1 || st == 3) ? vec3(.77, .78, .78) : vec3(238., 232., 218.) / 255.;
  if (z > Hh - .45) diffuseColor.rgb = base * 1.08; // cornice
  else if (vWst.z > .5 && z < 3.8 && Hh > 7.) { // shop front: awning, lit window
    float cs = mod(s, 4.2);
    if (z > 2.85 && z < 3.35 && cs > .2 && cs < 3.6) diffuseColor.rgb = mod(floor(cs / .6), 2.) > .5 ? vec3(184., 50., 42.) / 255. : vec3(236., 228., 210.) / 255.;
    else if (cs > .4 && cs < 3.4 && z > .3 && z < 2.7) diffuseColor.rgb = z < 1.1 ? vec3(236., 196., 120.) / 255. : glass * (z > 2.3 ? 1.6 : 1.);
  } else if (z < .45) diffuseColor.rgb = base * .85; // plinth
  else if (st < 5) {
    float cw = CW[st], cells = floor(L / cw), s0 = (L - cells * cw) * .5, sc = s - s0, cell = floor(sc / cw), cs = sc - cell * cw;
    float storey = floor(z / FH[st]), zz = z - storey * FH[st];
    vec4 w = WIN[st];
    if (cell >= 0. && cell < cells && z < Hh - .9 && cs > w.x - .14 && cs < w.y + .14 && zz > w.z - .14 && zz < w.w + .14) {
      if (cs < w.x || cs > w.y || zz < w.z || zz > w.w) diffuseColor.rgb = frame;
      else if (st == 4) diffuseColor.rgb = vec3(.47, .46, .44) * (mod(floor(cs * 2.5), 2.) > .5 ? .85 : 1.);
      else {
        float hh = fract(sin(cell * 12.9898 + storey * 78.233 + seed * 3.7) * 43758.5453);
        if ((zz - w.z) / (w.w - w.z) > .74) diffuseColor.rgb = glass * 1.9;
        else if (hh > .84) diffuseColor.rgb = vec3(214., 190., 140.) / 255.;
        else diffuseColor.rgb = glass * (1. + hh * .5);
      }
    } else if (st == 0 && zz < .16) diffuseColor.rgb = base * 1.06;
    else if (st == 1 && zz < .2) diffuseColor.rgb = base * .9;
  }
}`;
// cutaway: whatever stands between the camera and you is screened out with a dither pattern, so you're never hidden
const CUT = { uCam: { value: new T3.Vector3() }, uTgt: { value: new T3.Vector3() } };
const CUT_GLSL = `
{
  vec3 ab = uTgt - uCam; float t = clamp(dot(vWorld - uCam, ab) / dot(ab, ab), 0., 1.);
  float d = length(vWorld - (uCam + ab * t));
  const float BAYC[16] = float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
  int bc = int(mod(gl_FragCoord.y, 4.)) * 4 + int(mod(gl_FragCoord.x, 4.));
  if (t < .93 && d < 2.5 + 9. * t && BAYC[bc] < 12.) discard;
}`;
function pixMat(o = {}, facade = false, cut = false) {
  const m = new T3.MeshLambertMaterial(o);
  m.onBeforeCompile = sh => {
    if (cut) {
      Object.assign(sh.uniforms, CUT);
      sh.vertexShader = 'varying vec3 vWorld;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n#ifdef USE_INSTANCING\nvWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;\n#else\nvWorld = (modelMatrix * vec4(transformed, 1.)).xyz;\n#endif');
      sh.fragmentShader = 'uniform vec3 uCam, uTgt; varying vec3 vWorld;\n' + sh.fragmentShader.replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + CUT_GLSL);
    }
    if (facade) {
      sh.vertexShader = 'attribute vec3 wuv; attribute vec4 wst; varying vec3 vWuv; varying vec4 vWst;\n' +
        sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvWuv = wuv; vWst = wst;');
      sh.fragmentShader = 'varying vec3 vWuv; varying vec4 vWst;\n' + sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + FACADE_GLSL);
    }
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', '#include <opaque_fragment>\n' + RAMP_GLSL);
  };
  m.customProgramCacheKey = () => 'pix' + (facade ? '-facade' : '') + (cut ? '-cut' : ''); // different patches must not share a compiled program
  return m;
}
const MAT = { plain: pixMat({ vertexColors: true }), inst: pixMat(), facade: pixMat({ vertexColors: true }, true, true), trees: pixMat({}, false, true),
  glow: new T3.MeshBasicMaterial({ vertexColors: false }) };

// ---------- the post pass: outlines on the near side of every depth step
const POST = new T3.ShaderMaterial({
  uniforms: { tC: { value: null }, tD: { value: null }, res: { value: new T3.Vector2(1, 1) }, cn: { value: camera.near }, cf: { value: camera.far } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }',
  fragmentShader: `#include <packing>
uniform sampler2D tC, tD; uniform vec2 res; uniform float cn, cf; varying vec2 vUv;
float vz(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tD, uv).x, cn, cf); }
void main() {
  vec2 p = 1. / res; vec3 c = texture2D(tC, vUv).rgb;
  float d = vz(vUv), l = vz(vUv - vec2(p.x, 0.)), r = vz(vUv + vec2(p.x, 0.)), u = vz(vUv + vec2(0., p.y)), b = vz(vUv - vec2(0., p.y));
  float lap = abs(1. / l + 1. / r - 2. / d) + abs(1. / u + 1. / b - 2. / d), far = max(max(l, r), max(u, b));
  if (d < cf * .9 && lap * d > .07 && far > d * 1.03) c *= vec3(.62, .6, .72);
  gl_FragColor = vec4(c, 1.);
}`, depthTest: false, depthWrite: false });
const postScene = new T3.Scene(), postCam = new T3.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new T3.Mesh(new T3.PlaneGeometry(2, 2), POST));
addEventListener('resize', resize); resize();

// ---------- light: sun from the south-west like before, its shadow box follows the camera
scene.add(new T3.HemisphereLight(0xdfe6ff, 0x8a8070, .5 * Math.PI)); // three r155+ lights are physical: x pi
const sun = new T3.DirectionalLight(0xffffff, .62 * Math.PI);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -120, right: 120, top: 120, bottom: -120, near: 1, far: 500 });
sun.shadow.bias = -.0008; sun.shadow.normalBias = .04;
scene.add(sun, sun.target);
const SUN = new T3.Vector3(-.45, .75, .55).normalize().multiplyScalar(220);

// ---------- colour helpers
const HEX = new Map();
const hexC = s => { let c = HEX.get(s); if (!c) { c = [1, 3, 5].map(i => parseInt(s.slice(i, i + 2), 16)); HEX.set(s, c); } return c; };
const col3 = (c, k = 1) => new T3.Color(c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k);
function h2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
console.assert(hexC('#ff8000').join() === '255,128,0', 'colour helpers');

// ---------- building colours by style from OSM tags (see style() in tools/build-map.mjs)
const FACADE = {
  alt: [[232, 220, 196], [222, 206, 170], [236, 226, 210], [214, 190, 156], [205, 200, 190], [226, 206, 186], [210, 214, 200],
    [200, 206, 214], [228, 196, 170], [190, 170, 140], [176, 160, 150], [160, 150, 138], [238, 214, 160], [186, 120, 96]],
  platte: [[236, 234, 226], [220, 214, 200], [206, 200, 188], [226, 220, 196], [214, 206, 180], [188, 196, 202]],
  brick: [[158, 74, 52], [170, 90, 62], [142, 62, 46], [196, 160, 108], [180, 120, 80]],
  office: [[196, 202, 208], [170, 178, 186], [220, 218, 210], [150, 156, 164]],
  low: [[168, 164, 156], [150, 146, 140], [190, 184, 170], [130, 128, 124]],
  deck: [[70, 96, 78]],
};
const STYLE_ID = { alt: 0, platte: 1, brick: 2, office: 3, low: 4, deck: 5 };
const ROOF = { m: [[128, 126, 122], [140, 136, 128], [118, 116, 114], [88, 84, 82]], p: [[150, 76, 56], [168, 86, 62], [120, 110, 104]], f: [[150, 148, 140], [136, 134, 128], [164, 160, 150], [124, 124, 122]] };
const GROUND = { yard: '#6e7a5c', grass: '#56763a', pitch: '#4f8a48', play: '#b89a72', water: '#2c7a78', path: '#b0a48c', plaza: '#bcb6a8',
  cycle: '#a84a3c', pave: '#aaa8a0', kerb: '#c8c6be', asph: '#46484f', mark: '#ebebe6', railbed: '#6e6054', rail: '#a0a0a6', site: '#c87a3c', ymark: '#f2c200' };

// ---------- the city in 256 m chunks (CK from game.js), built nearest first, a few milliseconds per frame
const GCH = new Map(); // 'i,j' -> { group, parked, lamps, sig, i, j }
const GT = 4; // ground texture pixels per metre
const boxGeo = new T3.BoxGeometry(1, 1, 1).translate(0, .5, 0); // unit box standing on y = 0
const crownGeo = new T3.IcosahedronGeometry(1, 1), coneGeo = new T3.ConeGeometry(.22, .7, 6).translate(0, .35, 0);
const _m = new T3.Matrix4(), _q = new T3.Quaternion(), _p = new T3.Vector3(), _s = new T3.Vector3(), _up = new T3.Vector3(0, 1, 0), _c = new T3.Color();
function putBox(mesh, k, x, y, z, a, l, h, w) { // instance k: box l (along a) x h (up) x w, base at height z
  _q.setFromAxisAngle(_up, -a); _p.set(x, z, y); _s.set(l, h, w); _m.compose(_p, _q, _s); mesh.setMatrixAt(k, _m);
}
function instanced(geo, n, mat = MAT.inst) {
  const m = new T3.InstancedMesh(geo, mat, Math.max(1, n)); m.count = n; m.castShadow = m.receiveShadow = true; return m;
}
function groundTexture(x0, y0) {
  const c = document.createElement('canvas'); c.width = c.height = CK * GT;
  const g = c.getContext('2d'), q = kind => query(kind, x0 - 25, y0 - 25, x0 + CK + 25, y0 + CK + 25);
  g.setTransform(GT, 0, 0, GT, -x0 * GT, -y0 * GT); g.lineCap = g.lineJoin = 'round';
  const line = (col, w, p) => { g.strokeStyle = col; g.lineWidth = w; trace(g, p); g.stroke(); };
  g.fillStyle = GROUND.yard; g.fillRect(x0, y0, CK, CK);
  for (const a of q('green')) { g.fillStyle = GROUND[a.k === 'pitch' ? 'pitch' : a.k === 'play' ? 'play' : 'grass']; trace(g, a.p, 1); g.fill(); }
  g.fillStyle = GROUND.water; for (const w of q('water')) { trace(g, w.p, 1); g.fill(); }
  const roads = q('roads').sort((a, b) => a.rk - b.rk);
  for (const r of roads) if (!r.car) line(GROUND[r.t === 'cycleway' ? 'cycle' : r.t === 'pedestrian' ? 'plaza' : r.t === 'footway' ? 'pave' : 'path'], r.w, r.p);
  for (const r of roads) if (r.car) line(GROUND.pave, r.w + (r.t === 'service' ? 1.5 : 9), r.p); // Berlin sidewalks, ~4.5 m each side
  for (const r of roads) if (r.car) line(GROUND.kerb, r.w + .8, r.p);
  for (const r of roads) if (r.car) line(GROUND.asph, r.w, r.p);
  g.setLineDash([3, 4]); for (const r of roads) if (r.car && r.w >= 12) line(GROUND.mark, .3, r.p); g.setLineDash([]);
  for (const r of q('rails')) if (!r.v) { line(GROUND.railbed, 3.6, r.p); line(GROUND.rail, 1.9, r.p); line(GROUND.railbed, 1.3, r.p); }
  g.fillStyle = GROUND.mark;
  for (let i = 0; i < CROSS.length; i += 3) { // zebra (stripes along the road) or signalled Fußgängerfurt (two dashed lines)
    const x = CROSS[i], y = CROSS[i + 1];
    if (x < x0 - 10 || x > x0 + CK + 10 || y < y0 - 10 || y > y0 + CK + 10) continue;
    const n = M.crossings[i / 3 * 2], nb = M.adj[n][0];
    if (nb === undefined) continue;
    g.save(); g.translate(x, y); g.rotate(Math.atan2(NY(nb) - y, NX(nb) - x));
    if (CROSS[i + 2] === 1) for (let k = -4; k <= 4; k++) g.fillRect(-1.5, k - .3, 3, .6);
    else for (const o of [-2, 1.6]) for (let k = -4.5; k < 4.5; k += 1) g.fillRect(o, k, .4, .5);
    g.restore();
  }
  for (const w of WORKS) if (w.bb[2] > x0 - 10 && w.bb[0] < x0 + CK + 10 && w.bb[3] > y0 - 10 && w.bb[1] < y0 + CK + 10) {
    if (w.closed) line(GROUND.site, 6.6, w.pts); else { g.setLineDash([3, 2]); line(GROUND.ymark, .35, w.pts); g.setLineDash([]); }
  }
  // a little grain so big surfaces don't look flat
  g.setTransform(1, 0, 0, 1, 0, 0);
  const img = g.getImageData(0, 0, c.width, c.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = (h2(i * .37, x0 + y0) - .5) * 14; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = new T3.CanvasTexture(c);
  t.magFilter = T3.NearestFilter; t.minFilter = T3.NearestMipmapLinearFilter; t.anisotropy = 4;
  return t;
}
// roof furniture: chimneys and satellite dishes on Altbau, plant rooms on flat roofs. -> [x, y, z, angle, kind]
function roofBits(b) {
  if (b.k === 'low' || b.k === 'deck') return [];
  const p = b.p, n = b.n, k = p.length / 2, out = [];
  for (let i = 0; i < k && out.length < 6; i++) {
    const j = (i + 1) % k, ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1], L = Math.hypot(bx - ax, by - ay);
    if (L < 7 || h2(n * 31, ax) > .55) continue;
    const nx = (by - ay) * b.ws / L, ny = -(bx - ax) * b.ws / L, d = b.r === 'f' ? 4 + 3 * h2(n, ay) : 1.6;
    const x = (ax + bx) / 2 - nx * d, y = (ay + by) / 2 - ny * d; // inwards from the eave
    if (inPoly(p, x, y)) out.push([x, y, b.h, Math.atan2(by - ay, bx - ax), b.r === 'f' ? 'box' : h2(n, bx) < .3 ? 'dish' : 'chimney']);
  }
  return out;
}
function buildingGeometry(bs) { // walls (with facade attributes) and flat roofs, merged into one geometry
  const P = [], N = [], C = [], U = [], S = [];
  const vert = (x, y, z, nx, ny, nz, c, u, st) => { P.push(x, z, y); N.push(nx, nz, ny); C.push(c.r, c.g, c.b); U.push(...u); S.push(...st); };
  for (const b of bs) {
    const p = b.p, n = b.n, k = p.length / 2, z0 = b.z0 || 0, h = b.h, jit = .93 + .14 * h2(n, 1);
    const pick = (a, s) => a[h2(n, s) * a.length | 0];
    const fc = col3(pick(FACADE[b.k] || FACADE.alt, 3), jit), st = STYLE_ID[b.k] ?? 0;
    const rc = b.r === 'f' && b.k !== 'low' && b.k !== 'deck' && h2(n, 5) < .12 ? col3([104, 132, 78]) : col3(pick(ROOF[b.r] || ROOF.f, 7), jit);
    const shopB = b.k === 'alt' || (b.k === 'platte' && h2(n, 2) < .4);
    for (let i = 0; i < k; i++) {
      const j = (i + 1) % k, ax = p[2 * i], ay = p[2 * i + 1], bx = p[2 * j], by = p[2 * j + 1], ex = bx - ax, ey = by - ay, L = Math.hypot(ex, ey);
      if (L < .05) continue;
      const nx = ey * b.ws / L, ny = -ex * b.ws / L; // outward
      const street = shopB && h2(n, 4) < .55 && !!nearestEdge((ax + bx) / 2 + nx * 5, (ay + by) / 2 + ny * 5, 9) ? 1 : 0;
      const sw = [st, n % 97, street, L], H = h - z0;
      // front face counter-clockwise from outside: (B - A) x up must point outwards
      const flip = (-ey) * nx + ex * ny < 0; // (B-A) x up in game coordinates is (-ey, ex)
      const [qx, qy, rx, ry, s0, s1] = flip ? [bx, by, ax, ay, L, 0] : [ax, ay, bx, by, 0, L];
      const q0 = [qx, qy, z0, s0, 0], r0 = [rx, ry, z0, s1, 0], r1 = [rx, ry, h, s1, H], q1 = [qx, qy, h, s0, H];
      for (const v of [q0, r0, r1, q0, r1, q1]) vert(v[0], v[1], v[2], nx, ny, 0, fc, [v[3], v[4], H], sw);
    }
    // roof
    const pts = []; for (let i = 0; i < k; i++) pts.push(new T3.Vector2(p[2 * i], p[2 * i + 1]));
    if (pts.length > 2 && pts[0].equals(pts[pts.length - 1])) pts.pop();
    let tris = [];
    try { tris = T3.ShapeUtils.triangulateShape(pts, []); } catch (e) {}
    for (const t of tris) {
      const [a, bb, c] = t.map(i => pts[i]);
      // counter-clockwise seen from above (+Y): in game xy that means clockwise, since y points south
      const cr = (bb.x - a.x) * (c.y - a.y) - (bb.y - a.y) * (c.x - a.x), tri = cr > 0 ? [a, c, bb] : [a, bb, c];
      for (const v of tri) vert(v.x, v.y, h, 0, 0, 1, rc, [0, 0, 0], [-1, 0, 0, 0]);
    }
  }
  const g = new T3.BufferGeometry();
  g.setAttribute('position', new T3.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new T3.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new T3.Float32BufferAttribute(C, 3)); g.setAttribute('wuv', new T3.Float32BufferAttribute(U, 3));
  g.setAttribute('wst', new T3.Float32BufferAttribute(S, 4));
  return g;
}
const LEAF = [[58, 84, 62], [76, 104, 66], [100, 126, 78], [86, 112, 60]], BARK = [92, 74, 60];
const treeR = i => M.trees[i + 2] || 2.8 + 2.2 * hash(i);
const STEEL = [70, 96, 78];
let DECKS = null;
function decks() { // elevated U-Bahn stations: drawn as buildings on stilts
  if (DECKS) return DECKS;
  return (DECKS = M.decks.map((p, n) => {
    let area = 0, cx = 0, cy = 0; const k = p.length / 2;
    for (let i = 0; i < k; i++) { const j = (i + 1) % k; area += p[2 * i] * p[2 * j + 1] - p[2 * j] * p[2 * i + 1]; cx += p[2 * i]; cy += p[2 * i + 1]; }
    return { p, h: 9.2, z0: 6, k: 'deck', r: 'f', n: 90000 + n, bb: bbox(p), ws: Math.sign(area), cx: cx / k, cy: cy / k };
  }));
}
function buildChunk(ci, cj) {
  ensureChunk(ci, cj); // its parked cars exist
  const x0 = ci * CK, y0 = cj * CK, inC = (x, y) => x >= x0 && y >= y0 && x < x0 + CK && y < y0 + CK;
  const group = new T3.Group(), ch = { group, i: ci, j: cj };
  // ground
  const ground = new T3.Mesh(new T3.PlaneGeometry(CK, CK).rotateX(-Math.PI / 2), pixMat({ map: groundTexture(x0, y0) }));
  ground.position.set(x0 + CK / 2, 0, y0 + CK / 2); ground.receiveShadow = true; group.add(ground);
  // buildings (each in the chunk of its centre)
  const bs = query('bs', x0, y0, x0 + CK, y0 + CK).filter(b => inC(b.cx, b.cy)).concat(decks().filter(d => inC(d.cx, d.cy)));
  if (bs.length) { const m = new T3.Mesh(buildingGeometry(bs), MAT.facade); m.castShadow = m.receiveShadow = true; group.add(m); }
  const bits = bs.flatMap(roofBits), boxes = bits.filter(b => b[4] !== 'dish'), dishes = bits.filter(b => b[4] === 'dish');
  const bm = instanced(boxGeo, boxes.length), dm = instanced(crownGeo, dishes.length);
  boxes.forEach(([x, y, z, a, kind], k) => {
    if (kind === 'chimney') { putBox(bm, k, x, y, z, a, .9, 1.3, .7); bm.setColorAt(k, col3([150, 84, 62])); }
    else { putBox(bm, k, x, y, z, a, 3, 1.5, 2); bm.setColorAt(k, col3([170, 170, 166])); }
  });
  dishes.forEach(([x, y, z, a], k) => {
    _q.setFromAxisAngle(_up, -a); _p.set(x, z + .5, y); _s.set(.45, .45, .12); _m.compose(_p, _q, _s); dm.setMatrixAt(k, _m); dm.setColorAt(k, col3([236, 236, 230]));
  });
  group.add(bm, dm);
  // trees
  const ts = query('trees', x0, y0, x0 + CK, y0 + CK).filter(i => inC(M.trees[i], M.trees[i + 1]));
  const trunk = instanced(boxGeo, ts.length, MAT.trees), crown = instanced(crownGeo, ts.length * 5, MAT.trees); // a crown is 5 leaf clumps
  ts.forEach((i, k) => {
    const x = M.trees[i], y = M.trees[i + 1], r = treeR(i), H = 7 + r * 1.3;
    putBox(trunk, k, x, y, 0, 0, .4, H - r * .6, .4); trunk.setColorAt(k, col3(BARK));
    for (let c = 0; c < 5; c++) {
      const q = i * 7 + c, a = hash(q) * 6.283, d = c ? r * .5 : 0, cr = r * (c ? .55 : .7);
      _q.setFromAxisAngle(_up, hash(q + 1) * 6); _p.set(x + Math.cos(a) * d, H - r * .75 + (c ? (hash(q + 2) - .4) * r * .6 : r * .25), y + Math.sin(a) * d); _s.set(cr, cr * .85, cr);
      _m.compose(_p, _q, _s); crown.setMatrixAt(5 * k + c, _m);
      crown.setColorAt(5 * k + c, col3(LEAF[hash(q + 3) * LEAF.length | 0], .9 + .2 * hash(q + 5)));
    }
  });
  group.add(trunk, crown);
  // viaduct: a green steel deck 7 m up on pillars every 14 m
  const segs = [], pil = [];
  for (const r of query('rails', x0, y0, x0 + CK, y0 + CK)) if (r.v) {
    let run = 0;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const ax = r.p[i], ay = r.p[i + 1], bx = r.p[i + 2], by = r.p[i + 3], L = Math.hypot(bx - ax, by - ay), a = Math.atan2(by - ay, bx - ax);
      if (inC((ax + bx) / 2, (ay + by) / 2)) segs.push([(ax + bx) / 2, (ay + by) / 2, a, L]);
      for (let d = 14 - run % 14; d < L; d += 14) { const x = ax + (bx - ax) * d / L, y = ay + (by - ay) * d / L; if (inC(x, y)) pil.push([x, y, a]); }
      run += L;
    }
  }
  const deck = instanced(boxGeo, segs.length), pillars = instanced(boxGeo, pil.length);
  // OSM maps each track as its own way, ~3 m apart: two 5.2 m decks make one 8 m viaduct
  segs.forEach(([x, y, a, L], k) => { putBox(deck, k, x, y, 5.9, a, L + .3, 1.2, 5.2); deck.setColorAt(k, col3(STEEL)); });
  // the track on top: ballast bed and two rails along the way's centre line
  const bed = instanced(boxGeo, segs.length), rails = instanced(boxGeo, segs.length * 2);
  segs.forEach(([x, y, a, L], k) => {
    const sx = -Math.sin(a), sy = Math.cos(a);
    putBox(bed, k, x, y, 7.1, a, L + .3, .12, 2.6); bed.setColorAt(k, col3([110, 96, 84]));
    [-.72, .72].forEach((r, q) => { putBox(rails, 2 * k + q, x + sx * r, y + sy * r, 7.22, a, L + .3, .12, .12); rails.setColorAt(2 * k + q, col3([196, 196, 202])); });
  });
  group.add(bed, rails);
  pil.forEach(([x, y, a], k) => { putBox(pillars, k, x, y, 0, a, .6, 5.9, .6); pillars.setColorAt(k, col3(STEEL, .8)); }); // one steel column per track
  group.add(deck, pillars);
  // bus stops: pole with the green H on a yellow sign
  const stops = []; for (let i = 0; i < M.stops.length; i += 2) if (inC(M.stops[i], M.stops[i + 1])) stops.push(i);
  const poles = instanced(boxGeo, stops.length * 2);
  stops.forEach((i, k) => { putBox(poles, 2 * k, M.stops[i], M.stops[i + 1], 0, 0, .12, 2.6, .12); poles.setColorAt(2 * k, col3([110, 110, 116])); putBox(poles, 2 * k + 1, M.stops[i], M.stops[i + 1], 2.3, 0, .1, .5, .5); poles.setColorAt(2 * k + 1, col3([242, 194, 0])); });
  group.add(poles);
  // traffic lights: pole by the kerb + three lamps whose colours change every frame
  ch.sig = [];
  for (const [n, j] of SIG) {
    const x = NX(n), y = NY(n);
    if (!inC(x, y)) continue;
    const nb = M.adj[n][0] ?? n, a = Math.atan2(NY(nb) - y, NX(nb) - x), e = EMAP.get(ekey(n, nb)), off = (e ? e.w / 2 : 5) + .8;
    ch.sig.push([x - Math.sin(a) * off, y + Math.cos(a) * off, a, j]);
  }
  const spoles = instanced(boxGeo, ch.sig.length); ch.lamps = instanced(boxGeo, ch.sig.length * 3, MAT.glow);
  ch.sig.forEach(([x, y, a], k) => {
    putBox(spoles, k, x, y, 0, a, .16, 3, .16); spoles.setColorAt(k, col3([70, 72, 78]));
    for (let l = 0; l < 3; l++) { putBox(ch.lamps, 3 * k + l, x, y, 3 + l * .32, a, .3, .28, .3); ch.lamps.setColorAt(3 * k + l, col3([46, 46, 52])); }
  });
  group.add(spoles, ch.lamps);
  // roadwork cones
  const cones = [];
  for (const wk of WORKS) for (let i = 0; i + 3 < wk.pts.length; i += 2) {
    const p = wk.pts, L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    for (let d = 0; d < L; d += wk.closed ? 3 : 6) { const x = p[i] + (p[i + 2] - p[i]) * d / L, y = p[i + 1] + (p[i + 3] - p[i + 1]) * d / L; if (inC(x, y)) cones.push([x, y]); }
  }
  const cm = instanced(coneGeo, cones.length);
  cones.forEach(([x, y], k) => { _q.identity(); _p.set(x, 0, y); _s.set(1, 1, 1); _m.compose(_p, _q, _s); cm.setMatrixAt(k, _m); cm.setColorAt(k, col3([255, 106, 0])); });
  group.add(cm);
  scene.add(group);
  GCH.set(ci + ',' + cj, ch);
  buildParked(ch);
  return ch;
}
function buildParked(ch) { // parked cars from game.js (PARKED / PGRID), stolen ones (seed -1) left out
  if (ch.parked) { for (const m of ch.parked) { ch.group.remove(m); m.dispose(); } }
  const x0 = ch.i * CK, y0 = ch.j * CK, list = [];
  for (let ti = x0 / 64; ti < (x0 + CK) / 64; ti++) for (let tj = y0 / 64; tj < (y0 + CK) / 64; tj++) for (const k of PGRID.get(ti + ',' + tj) || []) if (PARKED[k + 3] >= 0) list.push(k);
  const parts = carMeshes(list.length);
  list.forEach((k, n) => carAt(parts, n, PARKED[k], PARKED[k + 1], PARKED[k + 2], hexC(PAINT[PARKED[k + 3] * PAINT.length | 0])));
  ch.parked = parts; ch.group.add(...parts);
}
function dropChunk(key) {
  const ch = GCH.get(key); if (!ch) return;
  scene.remove(ch.group);
  ch.group.traverse(o => { if (o.geometry && o.geometry !== boxGeo && o.geometry !== crownGeo && o.geometry !== coneGeo && !SHARED_GEO.has(o.geometry)) o.geometry.dispose(); if (o.material && o.material.map) { o.material.map.dispose(); o.material.dispose(); } if (o.isInstancedMesh) o.dispose(); });
  GCH.delete(key);
}
function streamChunks(budget) { // load near the camera first, drop far ones
  const R = 760, list = [];
  for (let i = Math.floor((camX - R) / CK); i <= Math.floor((camX + R) / CK); i++) for (let j = Math.floor((camY - R) / CK); j <= Math.floor((camY + R) / CK); j++) {
    if (i < 0 || j < 0 || i * CK >= M.w || j * CK >= M.h || GCH.has(i + ',' + j)) continue;
    const d = dist(camX, camY, (i + .5) * CK, (j + .5) * CK); if (d < R) list.push([i, j, d]);
  }
  list.sort((a, b) => a[2] - b[2]);
  const t0 = performance.now();
  for (const [i, j, d] of list) { if (d > 300 && performance.now() - t0 > budget) break; buildChunk(i, j); } // nearby ones always, at once
  for (const [k, ch] of GCH) if (dist(camX, camY, (ch.i + .5) * CK, (ch.j + .5) * CK) > 1050) dropChunk(k);
}
// game.js hooks: parked cars arrive with ensureChunk, a stolen one disappears, roadworks loaded
function tileAddParked(list) { const seen = new Set(); for (const k of list) { const key = (PARKED[k] / CK | 0) + ',' + (PARKED[k + 1] / CK | 0); if (!seen.has(key) && GCH.has(key)) { seen.add(key); buildParked(GCH.get(key)); } } }
function invalidateTiles(x, y) { const ch = GCH.get((x / CK | 0) + ',' + (y / CK | 0)); if (ch) buildParked(ch); }
function worldChanged() { for (const k of [...GCH.keys()]) dropChunk(k); }

// ---------- vehicles and people as instance pools
const SHARED_GEO = new Set();
const wheelGeo = new T3.TorusGeometry(.3, .06, 4, 10); SHARED_GEO.add(wheelGeo);
function carMeshes(n) { // tyres, body, cabin, lights
  return [instanced(boxGeo, n), instanced(boxGeo, n), instanced(boxGeo, n), instanced(boxGeo, n * 2, MAT.glow)];
}
const GLASS = [52, 64, 84];
function carAt(parts, k, x, y, a, rgb, o = {}) {
  const [tyre, body, cab, lights] = parts, fx = Math.cos(a), fy = Math.sin(a);
  putBox(tyre, k, x, y, 0, a, 4, .42, 1.66); tyre.setColorAt(k, col3([44, 42, 48]));
  putBox(body, k, x, y, .32, a, 4.4, .66, 1.8); body.setColorAt(k, col3(rgb));
  putBox(cab, k, x - fx * .3, y - fy * .3, .98, a, 2.3, .48, 1.56); cab.setColorAt(k, col3(o.police ? [40, 84, 176] : GLASS));
  putBox(lights, 2 * k, x + fx * 2.2, y + fy * 2.2, .62, a, .08, .16, 1.4); lights.setColorAt(2 * k, col3([255, 246, 214]));
  putBox(lights, 2 * k + 1, x - fx * 2.2, y - fy * 2.2, .62, a, .08, .16, 1.4); lights.setColorAt(2 * k + 1, col3(o.braking ? [255, 64, 40] : [150, 30, 26]));
}
const POOL = { cars: carMeshes(400), bars: instanced(boxGeo, 60, MAT.glow), crates: instanced(boxGeo, 2),
  legs: instanced(boxGeo, 200), torso: instanced(boxGeo, 200), heads: instanced(boxGeo, 200),
  bikeF: instanced(boxGeo, 60), wheels: instanced(wheelGeo, 120),
  buses: instanced(boxGeo, 300), bandsB: instanced(boxGeo, 300), heli: instanced(boxGeo, 6), marks: instanced(boxGeo, 4, new T3.MeshBasicMaterial({ transparent: true, opacity: .45, depthWrite: false })) };
for (const k in POOL) { const v = POOL[k]; for (const m of Array.isArray(v) ? v : [v]) { m.frustumCulled = false; scene.add(m); } }
POOL.marks.castShadow = false;
const POLICE_C = [226, 230, 236];
function personAt(k, x, y, a, ph, shirt, hair, fallen, z = 0) {
  const bob = fallen ? 0 : Math.abs(Math.sin(ph * 1.6)) * .06;
  if (fallen) { putBox(POOL.legs, k, x, y, 0, a, 1.7, .25, .4); POOL.torso.setMatrixAt(k, _m.makeScale(0, 0, 0)); POOL.heads.setMatrixAt(k, _m); POOL.legs.setColorAt(k, col3(shirt)); return; }
  putBox(POOL.legs, k, x, y, z, a, .26, .8 + bob, .32); POOL.legs.setColorAt(k, col3([44, 48, 62]));
  putBox(POOL.torso, k, x, y, z + .8 + bob, a, .3, .62, .44); POOL.torso.setColorAt(k, col3(shirt));
  putBox(POOL.heads, k, x, y, z + 1.42 + bob, a, .24, .26, .24); POOL.heads.setColorAt(k, col3(hair));
}
function drawMovers() {
  let nc = 0, nb = 0, np = 0, nf = 0, nw = 0, nbus = 0, nh = 0, nm = 0;
  const near = (x, y, r = 380) => Math.abs(x - camX) < r && Math.abs(y - camY) < r;
  const flash = (G.time * 7 | 0) % 2;
  for (const c of cars) {
    if (!near(c.x, c.y)) continue;
    if (c.kind === 'foot') { personAt(np++, c.x, c.y, c.a, c.ph, hexC(c.color), hexC(c.hair), c === player && G.downT > 0); continue; }
    if (c.kind === 'bike') {
      const fx = Math.cos(c.a), fy = Math.sin(c.a);
      if (c.fall > 0) { putBox(POOL.bikeF, nf, c.x, c.y, 0, c.a + 1.2, 1.6, .1, .5); POOL.bikeF.setColorAt(nf++, col3(hexC(c.frame))); personAt(np++, c.x + .6, c.y, c.a, 0, hexC(c.color), hexC(c.hair), true); continue; }
      putBox(POOL.bikeF, nf, c.x, c.y, .3, c.a, 1.0, .5, .06); POOL.bikeF.setColorAt(nf++, col3(hexC(c.frame)));
      for (const s of [-.52, .52]) { _q.setFromAxisAngle(_up, -c.a); _p.set(c.x + fx * s, .33, c.y + fy * s); _s.set(1, 1, 1); _m.compose(_p, _q, _s); POOL.wheels.setMatrixAt(nw, _m); POOL.wheels.setColorAt(nw++, col3([30, 30, 34])); }
      personAt(np++, c.x - fx * .2, c.y - fy * .2, c.a, c.ph, hexC(c.color), hexC(c.hair), false, .55);
      continue;
    }
    const police = c.kind === 'police' || c.police, lit = c.kind === 'police' && (c.chase || c.stop || c.block);
    carAt(POOL.cars, nc, c.x, c.y, c.a, police ? POLICE_C : hexC(c.color), { police, braking: c.braking }); nc++;
    if (police) { putBox(POOL.bars, nb, c.x - Math.cos(c.a) * .3, c.y - Math.sin(c.a) * .3, 1.46, c.a, .45, .18, 1.3); POOL.bars.setColorAt(nb++, col3(lit ? (flash ? [170, 210, 255] : [30, 80, 230]) : [150, 156, 170])); }
    if (c === player && G.job && G.job.stage === 'deliver') { putBox(POOL.crates, 0, c.x - Math.cos(c.a) * .3, c.y - Math.sin(c.a) * .3, 1.46, c.a, 1.3, .4, 1.2); POOL.crates.setColorAt(0, col3(hexC(G.job.f.col))); }
  }
  POOL.crates.count = player.kind !== 'foot' && G.job && G.job.stage === 'deliver' ? 1 : 0;
  for (const pd of peds) if (near(pd.x, pd.y, 250)) {
    if (np >= 199) break;
    personAt(np++, pd.x, pd.y, pd.a, pd.ph, hexC(pd.col), hexC(pd.hair), pd.fall > 0);
  }
  for (const b of buses) {
    if (!b.train) {
      if (!near(b.x, b.y)) continue;
      putBox(POOL.buses, nbus, b.x, b.y, .35, b.a, b.len, 2.65, 2.55); POOL.buses.setColorAt(nbus, col3([242, 196, 0]));
      putBox(POOL.bandsB, nbus, b.x, b.y, 1.55, b.a, b.len - .8, .8, 2.6); POOL.bandsB.setColorAt(nbus++, col3(GLASS));
      continue;
    }
    if (!near(b.x, b.y, 450)) continue;
    const s = snapRail(b);
    if (!s) continue;
    // separate cars that follow the curves: U-Bahn small profile 4 × 12.8 m, S-Bahn 4 × 18 m (one Halbzug)
    const u = b.name.startsWith('U'), cl = u ? 12.8 : 18, n = 4, gap = .9, total = n * cl + (n - 1) * gap, [, , , r, i, t, dir] = s;
    const pos = d => d >= 0 ? railWalk(r, i, t, dir, d) : railWalk(r, i, t, -dir, -d);
    for (let k = 0; k < n && nbus < 299; k++) {
      const front = total / 2 - k * (cl + gap), A = pos(front), B = pos(front - cl), z = r.v ? 7.1 : 0;
      const x = (A[0] + B[0]) / 2, y = (A[1] + B[1]) / 2, a = Math.atan2(A[1] - B[1], A[0] - B[0]);
      putBox(POOL.buses, nbus, x, y, z + .35, a, cl, 2.65, 2.55); POOL.buses.setColorAt(nbus, col3(u ? [242, 205, 0] : [181, 51, 46]));
      putBox(POOL.bandsB, nbus, x, y, z + 1.55, a, cl - .8, .8, 2.6); POOL.bandsB.setColorAt(nbus++, col3(GLASS));
    }
  }
  if (G.heli) { // police helicopter: body, tail, two rotor blades, a spotlight on the ground
    const h = G.heli, ca = Math.cos(h.a), sa = Math.sin(h.a);
    putBox(POOL.heli, nh, h.x, h.y, 30, h.a, 5.5, 2, 2); POOL.heli.setColorAt(nh++, col3(POLICE_C));
    putBox(POOL.heli, nh, h.x - ca * 4.5, h.y - sa * 4.5, 31, h.a, 4, .5, .4); POOL.heli.setColorAt(nh++, col3([40, 84, 176]));
    for (const r of [G.time * 25, G.time * 25 + Math.PI / 2]) { putBox(POOL.heli, nh, h.x, h.y, 32.2, r, 10, .12, .3); POOL.heli.setColorAt(nh++, col3([30, 30, 34])); }
    putBox(POOL.marks, nm, h.x, h.y, .05, 0, 18, .02, 18); POOL.marks.setColorAt(nm++, col3([255, 248, 210]));
  }
  putBox(POOL.marks, nm, shop.x, shop.y, .05, 0, 12, .02, 12); POOL.marks.setColorAt(nm++, col3([214, 79, 160]));
  const set = (m, n) => { m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; };
  POOL.cars.forEach((m, i) => set(m, i === 3 ? nc * 2 : nc));
  set(POOL.bars, nb); set(POOL.crates, POOL.crates.count); set(POOL.legs, np); set(POOL.torso, np); set(POOL.heads, np);
  set(POOL.bikeF, nf); set(POOL.wheels, nw); set(POOL.buses, nbus); set(POOL.bandsB, nbus); set(POOL.heli, nh); set(POOL.marks, nm);
  // traffic lights near the camera
  for (const ch of GCH.values()) {
    if (!ch.sig.length || Math.abs((ch.i + .5) * CK - camX) > 400 || Math.abs((ch.j + .5) * CK - camY) > 400) continue;
    ch.sig.forEach(([, , a, j], k) => {
      const [st] = light(j, a);
      ch.lamps.setColorAt(3 * k, col3(st === 'g' ? [70, 235, 120] : [46, 46, 52]));
      ch.lamps.setColorAt(3 * k + 1, col3(st === 'y' ? [255, 190, 0] : [46, 46, 52]));
      ch.lamps.setColorAt(3 * k + 2, col3(st === 'r' ? [255, 60, 40] : [46, 46, 52]));
    });
    ch.lamps.instanceColor.needsUpdate = true;
  }
}

// ---------- rails: snap a live train to the nearest track and roll its cars along it
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
// -> [x, y, angle, rail, segment, t, dir] or null. U-Bahn only where it's up on a viaduct; S-Bahn on any track
function snapRail(b) {
  let best = null, bd = 40;
  for (const r of M.rails) {
    if (b.name.startsWith('U') && !r.v) continue;
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

// ---------- chase camera: always behind the car, turning smoothly with it
let camDist = 58, camYaw = null, lastT = performance.now(), RX = 0, RY = 1, DX = -1, DY = 0;
const PITCH = 42 * Math.PI / 180;
function updateCamera() {
  const now = performance.now(), dt = Math.min(.1, (now - lastT) / 1000); lastT = now;
  if (camYaw === null) camYaw = player.a;
  if (player.kind !== 'foot') camYaw += angDiff(player.a, camYaw) * Math.min(1, dt * 3.2); // on foot the camera holds still
  // the camera hangs behind the car itself (never over it) and backs off smoothly as you speed up
  const sp = player.kind === 'foot' ? 0 : Math.abs(speedOf(player));
  camDist += (DISTS[distI] + Math.min(40, sp * 1.3) - camDist) * Math.min(1, dt * 1.5);
  const fx = Math.cos(camYaw), fy = Math.sin(camYaw), D = camDist, ahead = player.kind === 'foot' ? 0 : 4 + Math.min(8, sp * .35);
  camX = player.x + fx * ahead; camY = player.y + fy * ahead; // what the camera looks at (and what loads first)
  const sh = G.shake > .5 ? G.shake * .05 : 0;
  camera.position.set(player.x - fx * D * Math.cos(PITCH) + rnd(-sh, sh), D * Math.sin(PITCH) + 1.5, player.y - fy * D * Math.cos(PITCH) + rnd(-sh, sh));
  camera.lookAt(camX, 0, camY);
  RX = -fy; RY = fx; DX = -fx; DY = -fy;
  CUT.uCam.value.copy(camera.position); CUT.uTgt.value.set(player.x, 1.2, player.y); // screen right and screen down (towards the camera) in world x/y, for walking and the minimap
  // the sun's shadow box follows, snapped to its texels so shadows don't shimmer
  const step = 240 / 2048, sx = Math.round(camX / step) * step, sy = Math.round(camY / step) * step;
  sun.target.position.set(sx, 0, sy); sun.position.set(sx + SUN.x, SUN.y, sy + SUN.z);
}
const _v = new T3.Vector3();
function project(x, y, z = 0) { // -> [screen px (device), screen py, in front?]
  _v.set(x, z, y).project(camera);
  return [(_v.x + 1) / 2 * ui.width, (1 - _v.y) / 2 * ui.height, _v.z < 1];
}
function onScreen(x, y, m = 0) {
  _v.set(x, 0, y).project(camera);
  if (_v.z >= 1) return false;
  const d = Math.hypot(x - camera.position.x, y - camera.position.z) + 1, k = m / (d * Math.tan(camera.fov * Math.PI / 360));
  return Math.abs(_v.x) < 1 + k / camera.aspect && Math.abs(_v.y) < 1 + k;
}

// ---------- frame
function render() {
  updateCamera();
  streamChunks(GCH.size ? 5 : Infinity);
  drawMovers();
  renderer.setRenderTarget(RT); renderer.render(scene, camera);
  POST.uniforms.tC.value = RT.texture; POST.uniforms.tD.value = RT.depthTexture;
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
  drawUI();
  drawMini();
}
const FONT = '"Inter Tight", "Helvetica Neue", Arial, sans-serif', MONO = '"JetBrains Mono", ui-monospace, Menlo, monospace';
function drawUI() {
  const g = uctx;
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, ui.width, ui.height);
  // where the police think you are: a dashed circle on the ground
  if (G.wanted > 0 && G.time - G.lastSeen > 1.5) {
    const R = searchRadius();
    g.strokeStyle = 'rgba(110,160,255,.9)'; g.lineWidth = 2 * DPR; g.setLineDash([6 * DPR, 6 * DPR]); g.beginPath();
    for (let k = 0; k <= 64; k++) { const [x, y, ok] = project(G.known.x + Math.cos(k / 64 * 6.283) * R, G.known.y + Math.sin(k / 64 * 6.283) * R); if (ok) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke(); g.setLineDash([]);
  }
  g.textAlign = 'center'; g.font = `600 ${11 * DPR}px ${MONO}`;
  const label = (x, y, text, bg, fg) => {
    const w = g.measureText(text).width + 10 * DPR;
    g.fillStyle = bg; g.fillRect(x - w / 2, y - 16 * DPR, w, 18 * DPR); g.fillStyle = fg; g.fillText(text, x, y - 3 * DPR);
  };
  if (onScreen(shop.x, shop.y)) { const [x, y] = project(shop.x, shop.y, 4); label(x, y, 'SPRAY €150', '#d64fa0', '#fff'); }
  for (const c of cars) {
    if (c.kind !== 'police' || !onScreen(c.x, c.y)) continue;
    const [x, y] = project(c.x, c.y, 3.2);
    if (c.stop) label(x, y, (G.time * .7 | 0) % 2 ? 'STOP' : 'POLIZEI', '#111', (G.time * 2 | 0) % 2 ? '#ff3b2a' : '#ffd23f');
    else if (c.block) label(x, y, 'ROADBLOCK', '#1d4fd8', '#fff');
    else if (c.chase) label(x, y, sees(c) ? 'PURSUIT' : 'SEARCHING', sees(c) ? '#d0021b' : '#1d4fd8', '#fff');
    else if (c.warnT > 0) label(x, y, '! WARNING', '#e8c45a', '#132a1e');
  }
  // targets: a bouncing arrow over them, or an arrow at the screen edge pointing their way
  const j = G.job, tg = [];
  if (j && j.stage === 'pickup') tg.push([j.pickup, '#ffd60a', `PICKUP ${Math.round(dist(player.x, player.y, j.pickup.x, j.pickup.y))} m`]);
  if (j && j.stage === 'deliver') tg.push([j.drop, '#9bd32d', `DROP ${Math.round(dist(player.x, player.y, j.drop.x, j.drop.y))} m`]);
  if (G.wanted > 0) tg.push([shop, '#d64fa0', 'SPRAY']);
  for (const [t, css, text] of tg) {
    let [x, y, ok] = project(t.x, t.y, 6 + Math.sin(G.time * 5) * .6);
    const m = 46 * DPR, inside = ok && x > m && x < ui.width - m && y > m && y < ui.height - m;
    g.fillStyle = css; g.strokeStyle = '#132a1e'; g.lineWidth = 2 * DPR;
    if (inside) {
      g.beginPath(); g.moveTo(x, y + 14 * DPR); g.lineTo(x - 11 * DPR, y - 4 * DPR); g.lineTo(x + 11 * DPR, y - 4 * DPR); g.closePath(); g.fill(); g.stroke();
      continue;
    }
    const cx = ui.width / 2, cy = ui.height / 2;
    if (!ok) { x = 2 * cx - x; y = 2 * cy - y; } // behind the camera: point the other way
    const a = Math.atan2(y - cy, x - cx), sc = Math.min((cx - m) / Math.abs(Math.cos(a)), (cy - m) / Math.abs(Math.sin(a)));
    g.setTransform(1, 0, 0, 1, cx + Math.cos(a) * sc, cy + Math.sin(a) * sc);
    g.font = `600 ${12 * DPR}px ${MONO}`; g.fillStyle = '#132a1e'; g.fillText(text, 1.5 * DPR, -16.5 * DPR); g.fillStyle = css; g.fillText(text, 0, -18 * DPR);
    g.rotate(a); g.fillStyle = css;
    g.beginPath(); g.moveTo(14 * DPR, 0); g.lineTo(-8 * DPR, -10 * DPR); g.lineTo(-8 * DPR, 10 * DPR); g.closePath(); g.fill(); g.stroke();
    g.setTransform(1, 0, 0, 1, 0, 0); g.font = `600 ${11 * DPR}px ${MONO}`;
  }
  if (G.bannerT > 0) {
    g.textAlign = 'center'; g.font = `800 ${40 * DPR}px ${FONT}`;
    g.fillStyle = '#132a1e'; g.fillText(G.banner, ui.width / 2 + 3 * DPR, ui.height * .3 + 3 * DPR);
    g.fillStyle = G.banner.startsWith('BUSTED') ? '#ff5a4a' : '#f3efe4'; g.fillText(G.banner, ui.width / 2, ui.height * .3);
  }
}
