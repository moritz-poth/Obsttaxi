# Obst-Taxi

Top-down browser driving game on the real street map of Kreuzberg 36 (OpenStreetMap). Deliver exotic fruit, don't get caught.

**Play:** open `index.html` in a browser. No server, no build step.

**Rebuild the map:** `tools/fetch.sh` (downloads OSM data into `data/raw.json`), then `node tools/build-map.mjs` (writes `map.js`). Area and road widths are set at the top of `tools/build-map.mjs` and in `tools/query.overpassql`.

Map data © OpenStreetMap contributors, ODbL.
