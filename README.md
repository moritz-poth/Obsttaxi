# Obst-Taxi

Isometric pixel-art driving game on the real street map of Kreuzberg 36 (OpenStreetMap). Deliver exotic fruit, don't get caught.

**Controls:** arrows/WASD drive (on foot: walk in screen directions) · Space handbrake / sprint · F get out, grab a car (yours, a parked one, or someone else's) · Y/N answer messages · R radio on/off · T next track · +/− zoom · P pixel detail (1–4, remembered).

**DirtyDave FM:** put music files into `music/`, run `node tools/playlist.mjs`, start the game. Tracks are not committed.

**Code:** `game.js` simulation (traffic, pedestrians, police, jobs), `iso.js` renderer (64 m tiles baked once, depth buffer, pixel edges, minimap). Look after Pixel Plays by Amir Mushich (MIT, github.com/amirmushichge/pixel-plays).

**Play:** open `index.html` in a browser. No server, no build step.

**Rebuild the map:** `tools/fetch.sh` (downloads OSM data, LOR district shapes and the police crime atlas into `data/`), then `node tools/build-map.mjs` (writes `map.js`). Area and road widths are set at the top of `tools/build-map.mjs` and in `tools/query.overpassql`.

**Test:** `node tools/playtest.mjs <outdir> "$PWD/index.html"` (headless Chrome, screenshots + rule checks).

## Data
- Streets, speed limits, one-way streets, traffic lights, crossings, trees, U-Bahn: © OpenStreetMap contributors, ODbL
- Live roadworks and closures: VIZ Berlin (`api.viz.berlin.de`), loaded when the game starts
- Live buses and U-Bahn trains: BVG via the community API `v6.bvg.transport.rest`, every 15 s
- Crime per Bezirksregion: Polizei Berlin, Kriminalitätsatlas (PKS), plus LOR shapes from gdi.berlin.de

## Rules
Fines follow the German Bußgeldkatalog (car, in town). A patrol has to see the offence. Small offences get a warning first; again within 2 minutes, or anything over €100, and they pull you over (stop within 15 s, wait 3 s, pay). Drive off and you're wanted. 1 star: they tail you; 2+: they ram; 3+: roadblocks; 4+: helicopter. Break line of sight and they search where they last saw you. Patrol density follows the area's crime rate; the chance they search the car follows its drug-offence rate.
