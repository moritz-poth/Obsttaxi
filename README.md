# Obst-Taxi

Top-down browser driving game on the real street map of Kreuzberg 36 (OpenStreetMap). Deliver exotic fruit, don't get caught.

**Play:** open `index.html` in a browser. No server, no build step.

**Rebuild the map:** `tools/fetch.sh` (downloads OSM data, LOR district shapes and the police crime atlas into `data/`), then `node tools/build-map.mjs` (writes `map.js`). Area and road widths are set at the top of `tools/build-map.mjs` and in `tools/query.overpassql`.

**Test:** `node tools/playtest.mjs <outdir> "$PWD/index.html"` (headless Chrome, screenshots + rule checks).

## Data
- Streets, speed limits, one-way streets, traffic lights, crossings, trees, U-Bahn: © OpenStreetMap contributors, ODbL
- Live roadworks and closures: VIZ Berlin (`api.viz.berlin.de`), loaded when the game starts
- Live buses and U-Bahn trains: BVG via the community API `v6.bvg.transport.rest`, every 15 s
- Crime per Bezirksregion: Polizei Berlin, Kriminalitätsatlas (PKS), plus LOR shapes from gdi.berlin.de

## Rules
Fines follow the German Bußgeldkatalog (car, in town). A patrol has to see the offence; then it pulls you over (stop, wait 3 s, pay). Drive off and you're wanted. Patrol density follows the area's crime rate; the chance they search the car follows its drug-offence rate.
