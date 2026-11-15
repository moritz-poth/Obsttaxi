// Converts data/raw.json (Overpass "out geom") into map.js for the game.
// Usage: node tools/build-map.mjs   (refetch raw.json with tools/fetch.mjs; the area is tools/area.json)
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert';

const { s, w, n, e } = JSON.parse(readFileSync(new URL('area.json', import.meta.url))), BBOX = { s, w, n, e };
const LAT0 = (BBOX.s + BBOX.n) / 2;
const KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110540;
const X = lon => Math.round((lon - BBOX.w) * KX * 10) / 10;
const Y = lat => Math.round((BBOX.n - lat) * KY * 10) / 10;
const W = Math.ceil(X(BBOX.e)), H = Math.ceil(Y(BBOX.s));

// road width in metres (kerb to kerb, roughly) and whether AI cars may route on it
const ROADS = {
  primary: [17, 1], secondary: [15, 1], secondary_link: [8, 1], tertiary: [13, 1],
  // Berlin side streets are ~11 m kerb to kerb: parked cars both sides, one shared lane in the middle
  unclassified: [11, 1], residential: [11, 1], living_street: [7, 1],
  service: [5, 0], pedestrian: [8, 0], track: [4, 0],
  footway: [2.5, 0], path: [2.5, 0], cycleway: [2.5, 0], steps: [2.5, 0],
};

// legal speed limit in km/h (StVO: 50 in town unless signed). Untagged residential/service streets
// count as Tempo-30-Zone, which is what nearly every Nebenstraße in Kreuzberg is.
export function maxspeed(t) {
  const v = t.maxspeed || t['zone:maxspeed'] || '';
  if (/walk|living_street/.test(v) || t.highway === 'living_street') return 7;
  const n = parseInt(v.replace(/^DE:(zone)?/, ''));
  if (n > 0) return n;
  if (v === 'DE:urban') return 50;
  return ['residential', 'service'].includes(t.highway) ? 30 : 50;
}
assert.equal(maxspeed({ maxspeed: 'DE:zone30', highway: 'tertiary' }), 30);
assert.equal(maxspeed({ highway: 'living_street' }), 7);
assert.equal(maxspeed({ highway: 'primary' }), 50);
assert.equal(maxspeed({ 'zone:maxspeed': 'DE:30', highway: 'secondary' }), 30);
// 1 = only along the way's node order, -1 = only against it, 0 = both
export const oneway = t => ['yes', '1', 'true'].includes(t.oneway) ? 1 : t.oneway === '-1' ? -1
  : t.oneway !== 'no' && (t.junction === 'roundabout' || t.junction === 'circular') ? 1 : 0;
assert.equal(oneway({ junction: 'roundabout' }), 1);
assert.equal(oneway({ oneway: '-1' }), -1);

// facade style from OSM tags: alt (Gründerzeit Altbau), platte (post-war/social housing), brick (Gewerbehof, school,
// church), office (glass/commercial), low (garages, sheds). Roof: m mansard, p pitched, f flat
export function style(t) {
  const b = t.building, lv = parseFloat(t['building:levels']) || 0, shape = t['roof:shape'];
  let k = 'alt';
  if (['garages', 'garage', 'shed', 'carport', 'service', 'kiosk', 'toilets', 'stable', 'hut', 'container'].includes(b) ||
      (lv && lv <= 1 && !['church', 'retail', 'commercial', 'school', 'kindergarten'].includes(b))) k = 'low';
  else if (t['building:material'] === 'brick' || ['industrial', 'warehouse', 'church', 'school', 'civic', 'hospital', 'manufacture'].includes(b)) k = 'brick';
  else if (['commercial', 'office', 'retail', 'sports_centre', 'parking', 'supermarket'].includes(b)) k = 'office';
  else if (lv >= 8 || ((shape === 'flat' || t['roof:levels'] === '0') && lv >= 3)) k = 'platte';
  const r = /gabled|hipped|saltbox|pyramidal|mansard|gambrel/.test(shape) ? 'p' : shape === 'flat' || k !== 'alt' ? 'f' : 'm';
  return [k, r];
}
assert.deepEqual(style({ building: 'apartments', 'building:levels': '5' }), ['alt', 'm']);
assert.deepEqual(style({ building: 'garages' }), ['low', 'f']);
assert.deepEqual(style({ building: 'apartments', 'building:levels': '11' }), ['platte', 'f']);

// lanes per direction [along the way, against it]; OSM `lanes` counts both directions on two-way roads
export function lanes(t, ow, w) {
  const n = parseInt(t.lanes), f = parseInt(t['lanes:forward']), b = parseInt(t['lanes:backward']);
  if (ow) return [n > 0 ? n : w >= 13 ? 2 : 1, 0];
  const half = n > 1 ? Math.floor(n / 2) : w >= 15 ? 2 : 1;
  return [f > 0 ? f : half, b > 0 ? b : n > 1 ? n - (f > 0 ? f : half) : half];
}
assert.deepEqual(lanes({ lanes: '3' }, 1, 15), [3, 0]);
assert.deepEqual(lanes({ lanes: '4' }, 0, 15), [2, 2]);
assert.deepEqual(lanes({}, 0, 11), [1, 1]);
// parked cars on the carriageway, [left, right] of the way direction. Untagged side streets: yes (Berlin default)
const PARKED_ON_ROAD = ['lane', 'on_kerb', 'half_on_kerb', 'parallel', 'diagonal', 'perpendicular'];
export function parking(t) {
  const side = s => t['parking:' + s] || t['parking:both'] || t['parking:lane:' + s] || t['parking:lane:both'];
  return ['left', 'right'].map(s => { const v = side(s); return v ? (PARKED_ON_ROAD.includes(v) ? 1 : 0) : ['residential', 'unclassified', 'tertiary', 'secondary'].includes(t.highway) ? 1 : 0; });
}
assert.deepEqual(parking({ highway: 'secondary', 'parking:both': 'no' }), [0, 0]);
assert.deepEqual(parking({ highway: 'residential', 'parking:right': 'separate' }), [1, 0]);

const flat = geom => geom.flatMap(p => [X(p.lon), Y(p.lat)]);

// Join open way segments (multipolygon members) into closed rings.
export function joinRings(segs) {
  const rings = [], open = segs.map(s => s.slice());
  while (open.length) {
    let ring = open.pop();
    for (let grew = true; grew && ring.length > 1;) {
      grew = false;
      const a = ring[0], b = ring[ring.length - 1];
      if (a === b) break;
      for (let i = 0; i < open.length; i++) {
        const s = open[i], s0 = s[0], s1 = s[s.length - 1];
        if (s0 === b) ring = ring.concat(s.slice(1));
        else if (s1 === b) ring = ring.concat(s.slice(0, -1).reverse());
        else if (s1 === a) ring = s.concat(ring.slice(1));
        else if (s0 === a) ring = s.slice().reverse().concat(ring.slice(1));
        else continue;
        open.splice(i, 1); grew = true; break;
      }
    }
    rings.push(ring);
  }
  return rings;
}
assert.deepEqual(joinRings([['a', 'b'], ['c', 'b'], ['c', 'a']]).map(r => r.join('')), ['cabc']);

const raw = JSON.parse(readFileSync(new URL('../data/raw.json', import.meta.url)));
const out = { w: W, h: H, roads: [], buildings: [], green: [], water: [], nodes: [], edges: [], names: [], nodeName: [],
  signals: [], crossings: [], trees: [], stops: [], rails: [], decks: [], areas: [],
  geo: { ...BBOX, kx: KX, ky: KY } }; // so the game can place live lat/lon data (roadworks, BVG)
const nodeIdx = new Map(), nameIdx = new Map();
const nameId = n => { if (!nameIdx.has(n)) { nameIdx.set(n, out.names.length); out.names.push(n); } return nameIdx.get(n); };

const relRings = rel => {
  const key = p => p.lon + ',' + p.lat, pts = new Map();
  const segs = rel.members.filter(m => m.type === 'way' && m.role !== 'inner' && m.geometry)
    .map(m => m.geometry.map(p => { pts.set(key(p), p); return key(p); }));
  // shortcut: inner rings (courtyards, islands) are ignored; fine for SO36, revisit if holes look wrong
  return joinRings(segs).filter(r => r.length > 3).map(r => flat(r.map(k => pts.get(k))));
};

const nodeTags = new Map(), pendingNodes = [];
for (const e of raw.elements) if (e.type === 'node') nodeTags.set(e.id, e);
for (const e of raw.elements) {
  const t = e.tags || {};
  if (e.type === 'node') {
    if (t.natural === 'tree') {
      const r = parseFloat(t.diameter_crown) / 2;
      out.trees.push(X(e.lon), Y(e.lat), r > 1 && r < 12 ? Math.round(r * 10) / 10 : 0);
    } else if (t.highway === 'bus_stop') out.stops.push(X(e.lon), Y(e.lat));
    else pendingNodes.push(e); // signals and crossings need the road graph first
    continue;
  }
  if (['subway', 'light_rail', 'rail'].includes(t.railway)) {
    if (t.tunnel === 'yes' || !e.geometry) continue;
    out.rails.push({ v: t.bridge ? 1 : 0, p: flat(e.geometry) });
    continue;
  }
  if (t.building) {
    // elevated U-Bahn stations span the street: drawn as a deck overhead, no walls, no collision
    if (t.building === 'train_station' && parseInt(t.layer) >= 1) { if (e.geometry) out.decks.push(flat(e.geometry)); continue; }
    // open structures over streets (station roofs, carports) must not become walls
    if (['roof', 'bridge', 'carport'].includes(t.building) || parseInt(t.layer) < 0) continue;
    const lv = parseFloat(t['building:levels']);
    const h = parseFloat(t.height) || (lv ? lv * 3.3 + 1 : 18);
    const rings = e.type === 'way' ? [flat(e.geometry)] : relRings(e);
    const [k, r] = style(t);
    for (const p of rings) out.buildings.push({ h: Math.round(h), k, r, p });
  } else if (t.natural === 'water') {
    (e.type === 'way' ? [flat(e.geometry)] : relRings(e)).forEach(p => out.water.push(p));
  } else if (t.leisure || t.landuse) {
    if (e.geometry) out.green.push({ k: t.leisure === 'pitch' ? 'pitch' : t.leisure === 'playground' ? 'play' : 'grass', p: flat(e.geometry) });
  } else if (t.highway && ROADS[t.highway] && t.tunnel !== 'yes' && t.footway !== 'sidewalk' && t.service !== 'parking_aisle') {
    const [w, drive] = ROADS[t.highway];
    const pk = drive && !t.bridge ? parking(t) : [0, 0];
    out.roads.push({ t: t.highway, w, b: t.bridge ? 1 : 0, pk, p: flat(e.geometry) });
    if (!drive) continue;
    const name = t.name ? nameId(t.name) : -1, vmax = maxspeed(t), ow = oneway(t), [lf, lb] = lanes(t, ow, w);
    let prev = -1;
    e.nodes.forEach((id, i) => {
      if (!nodeIdx.has(id)) {
        nodeIdx.set(id, out.nodes.length / 2);
        out.nodes.push(X(e.geometry[i].lon), Y(e.geometry[i].lat));
        out.nodeName.push(name);
      }
      const n = nodeIdx.get(id);
      if (out.nodeName[n] < 0) out.nodeName[n] = name;
      // edge: from, to, speed limit, oneway (1 = only from->to), road width, lanes from->to, lanes to->from,
      // parked-car strips on the carriageway (left + right; for reversed oneways the sides swap, the sum doesn't)
      if (prev >= 0 && prev !== n) out.edges.push(...(ow < 0 ? [n, prev] : [prev, n]), vmax, ow ? 1 : 0, w, lf, lb, pk[0] + pk[1]);
      prev = n;
    });
  }
}
for (const e of pendingNodes) {
  const t = e.tags;
  if (t.highway === 'traffic_signals' && nodeIdx.has(e.id)) out.signals.push(nodeIdx.get(e.id));
  // pedestrian crossings: zebra (Zeichen 293) or signalled Fußgängerfurt; road direction comes from the graph at runtime
  const kind = t.crossing_ref === 'zebra' || t.crossing === 'zebra' ? 1 : t.crossing === 'traffic_signals' ? 2 : 0;
  if (t.highway === 'crossing' && kind && nodeIdx.has(e.id)) out.crossings.push(nodeIdx.get(e.id), kind);
}

// crime: Kriminalitätsatlas Berlin (latest HZ_ sheet = offences per 100,000 residents) joined to LOR Bezirksregionen,
// stored as ratio to the Berlin average
const XL = new URL('../data/crime/xl/', import.meta.url), rd = p => readFileSync(new URL(p, XL), 'utf8');
const strs = [...rd('sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)].map(m => m[1].replace(/<[^>]+>/g, ''));
const sheets = [...rd('workbook.xml').matchAll(/<sheet name="HZ_(\d+)"[^>]*r:id="(\w+)"/g)].sort((a, b) => b[1] - a[1]);
const target = rd('_rels/workbook.xml.rels').match(new RegExp(`Target="([^"]+)"[^>]*Id="${sheets[0][2]}"|Id="${sheets[0][2]}"[^>]*Target="([^"]+)"`)).slice(1).find(Boolean);
const rows = new Map();
for (const r of rd(target).matchAll(/<row [^>]*>(.*?)<\/row>/gs)) {
  const cells = [...r[1].matchAll(/<c ([^>]*)>(?:<f>.*?<\/f>)?<v>([^<]*)<\/v>/g)].map(c => c[1].includes('t="s"') ? strs[+c[2]] : c[2]);
  if (/^\d{6}$/.test(cells[0])) rows.set(cells[0], cells);
}
const header = [...rd(target).matchAll(/<row [^>]*>(.*?)<\/row>/gs)].map(r => [...r[1].matchAll(/<c ([^>]*)>(?:<f>.*?<\/f>)?<v>([^<]*)<\/v>/g)].map(c => c[1].includes('t="s"') ? strs[+c[2]] : c[2])).find(c => c[0]?.startsWith('LOR'));
const col = re => header.findIndex(h => re.test(h.replace(/\s|-/g, '')));
const cAll = col(/^Straftateninsgesamt/), cDrug = col(/^Rauschgiftdelikte/), berlin = rows.get('999999');
assert(cAll > 1 && cDrug > 1 && berlin, 'crime sheet layout changed');
const bzr = JSON.parse(readFileSync(new URL('../data/bzr.json', import.meta.url)));
for (const f of bzr.features) {
  const row = rows.get(f.properties.bzr_id); if (!row) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  out.areas.push({ n: f.properties.bzr_name.replace(/\s+/g, ' '), all: Math.round(row[cAll] / berlin[cAll] * 100) / 100,
    drugs: Math.round(row[cDrug] / berlin[cDrug] * 100) / 100, p: polys.map(pl => pl[0].flatMap(([lon, lat]) => [X(lon), Y(lat)])) });
}
out.crimeYear = sheets[0][1];

// street trees: OSM puts many of them where the parking lane is, which the game draws as carriageway.
// Move every tree standing on a car road out to the sidewalk, 1.4 m behind the kerb.
export function kerbside(x, y, segs, grid, G) {
  let best = null, bd = Infinity;
  for (const k of grid.get((x / G | 0) + ',' + (y / G | 0)) || []) {
    const [ax, ay, bx, by, w] = segs[k], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)), px = ax + dx * t, py = ay + dy * t, d = Math.hypot(x - px, y - py);
    if (d < w / 2 + .3 && d - w / 2 < bd) { bd = d - w / 2; best = [px, py, d, w, dx, dy]; }
  }
  if (!best) return null;
  const [px, py, d, w, dx, dy] = best, l = Math.hypot(dx, dy) || 1;
  let nx = -dy / l, ny = dx / l; if (d > 1e-6 && (x - px) * nx + (y - py) * ny < 0) { nx = -nx; ny = -ny; }
  return [Math.round((px + nx * (w / 2 + 1.4)) * 10) / 10, Math.round((py + ny * (w / 2 + 1.4)) * 10) / 10];
}
{
  const G = 25, grid = new Map(), segs = [], CAR = ['primary', 'secondary', 'secondary_link', 'tertiary', 'unclassified', 'residential', 'living_street', 'service'];
  for (const r of out.roads) if (CAR.includes(r.t) && !r.b) for (let i = 0; i + 3 < r.p.length; i += 2) {
    const k = segs.length, [ax, ay, bx, by] = r.p.slice(i, i + 4); segs.push([ax, ay, bx, by, r.w]);
    const m = r.w / 2 + 1;
    for (let gx = Math.floor((Math.min(ax, bx) - m) / G); gx <= Math.floor((Math.max(ax, bx) + m) / G); gx++)
      for (let gy = Math.floor((Math.min(ay, by) - m) / G); gy <= Math.floor((Math.max(ay, by) + m) / G); gy++) {
        const key = gx + ',' + gy; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(k);
      }
  }
  let moved = 0;
  for (let i = 0; i < out.trees.length; i += 3) {
    const q = kerbside(out.trees[i], out.trees[i + 1], segs, grid, G);
    if (q) { out.trees[i] = q[0]; out.trees[i + 1] = q[1]; moved++; }
  }
  console.log(`trees moved from the carriageway to the sidewalk: ${moved}`);
  const tg = new Map([['0,0', [0]]]);
  assert.deepEqual(kerbside(5, 2, [[0, 0, 10, 0, 11]], tg, 25), [5, 6.9]); // 2 m off the centre of an 11 m road -> 5.5 + 1.4
  assert.equal(kerbside(5, 8, [[0, 0, 10, 0, 11]], tg, 25), null); // already on the sidewalk
}

// draw order: footpaths first, big roads on top
const rank = r => ['footway', 'path', 'cycleway', 'steps', 'track', 'service', 'pedestrian', 'living_street', 'residential', 'unclassified', 'tertiary', 'secondary_link', 'secondary', 'primary'].indexOf(r.t);
out.roads.sort((a, b) => rank(a) - rank(b));

writeFileSync(new URL('../map.js', import.meta.url),
  '// Generated by tools/build-map.mjs from OpenStreetMap data (c) OpenStreetMap contributors, ODbL\nwindow.MAP=' + JSON.stringify(out) + ';\n');
console.log(`map ${W}x${H} m: ${out.roads.length} roads, ${out.buildings.length} buildings, ${out.water.length} water, ${out.green.length} green, ${out.nodes.length / 2} graph nodes, ${out.edges.length / 8} edges, ${out.signals.length} signals, ${out.crossings.length / 2} crossings, ${out.trees.length / 3} trees, ${out.stops.length / 2} bus stops, ${out.rails.length} rails, ${out.decks.length} decks`);
console.log('crime ' + out.crimeYear + ': ' + out.areas.map(a => `${a.n} x${a.all} (drugs x${a.drugs})`).join(', '));
