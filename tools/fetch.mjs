// Downloads the raw data for the map area (tools/area.json) into data/:
//  - OpenStreetMap (Overpass): streets, buildings, trees, signals, rails; fetched in tiles, merged by element id
//  - Berlin LOR district regions (Bezirksregionen) from gdi.berlin.de
//  - Berlin police crime atlas (Kriminalitätsatlas, PKS) from berlin.de
// Usage: node tools/fetch.mjs   (then node tools/build-map.mjs)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const A = JSON.parse(readFileSync(new URL('area.json', import.meta.url)));
const DATA = new URL('../data/', import.meta.url), UA = { 'User-Agent': 'osm-game-builder/0.1' };
mkdirSync(DATA, { recursive: true });
const Q = readFileSync(new URL('query.overpassql', import.meta.url), 'utf8');
const NX = 4, NY = 3, seen = new Map();
for (let i = 0; i < NX; i++) for (let j = 0; j < NY; j++) {
  const s = A.s + (A.n - A.s) * j / NY, n = A.s + (A.n - A.s) * (j + 1) / NY, w = A.w + (A.e - A.w) * i / NX, e = A.w + (A.e - A.w) * (i + 1) / NX;
  const q = Q.replaceAll('{{bbox}}', [s, w, n, e].map(v => v.toFixed(5)).join(','));
  for (let tries = 0; ; tries++) {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: UA, body: new URLSearchParams({ data: q }) });
    if (r.ok) {
      const els = (await r.json()).elements;
      for (const el of els) seen.set(el.type + el.id, el);
      console.log(`tile ${i},${j}: ${els.length} elements, ${seen.size} total`);
      break;
    }
    if (tries >= 4) throw new Error(`overpass tile ${i},${j}: HTTP ${r.status}`);
    console.log(`tile ${i},${j}: HTTP ${r.status}, retry in 60 s`); await new Promise(res => setTimeout(res, 60000));
  }
  await new Promise(res => setTimeout(res, 5000)); // be gentle with the public server
}
writeFileSync(new URL('raw.json', DATA), JSON.stringify({ elements: [...seen.values()] }));
const bzr = await fetch(`https://gdi.berlin.de/services/wfs/lor_2021?service=WFS&version=2.0.0&request=GetFeature&typeNames=lor_2021:b_lor_bzr_2021&outputFormat=application/json&srsName=EPSG:4326&bbox=${A.s},${A.w},${A.n},${A.e},urn:ogc:def:crs:EPSG::4326`, { headers: UA });
if (!bzr.ok) throw new Error('bzr HTTP ' + bzr.status);
writeFileSync(new URL('bzr.json', DATA), await bzr.text());
const xl = await fetch('https://www.berlin.de/polizei/_assets/dienststellen/lka/fallzahlen_hz-2016-2025.xlsx', { headers: UA });
if (!xl.ok) throw new Error('crime HTTP ' + xl.status);
writeFileSync(new URL('crime.xlsx', DATA), Buffer.from(await xl.arrayBuffer()));
// xlsx is a zip; build-map.mjs reads the shared strings + workbook index + sheets
const dir = new URL('crime', DATA).pathname;
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
execFileSync('unzip', ['-q', '-o', new URL('crime.xlsx', DATA).pathname, 'xl/sharedStrings.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/worksheets/*', '-d', dir]);
console.log('done');
