// Headless Chrome playtest via CDP. Usage: node tools/playtest.mjs <outdir> "$PWD/index.html"  (screenshots + log in outdir)
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const OUT = process.argv[2], URL = 'file://' + process.argv[3];
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=9333', '--window-size=1280,800', '--user-data-dir=' + OUT + '/prof', '--allow-file-access-from-files', 'about:blank']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
await sleep(1500);
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.onopen = r);
let id = 0; const pend = new Map(), errors = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id) pend.get(m.id)?.(m); if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(JSON.stringify(m.params.args)); };
const cmd = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => (await cmd('Runtime.evaluate', { expression: expr, returnByValue: true })).result?.result?.value;
const shot = async name => { const r = await cmd('Page.captureScreenshot'); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const key = (type, code, key) => cmd('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: 0 });
await cmd('Runtime.enable'); await cmd('Page.enable');
let t0 = Date.now();
await cmd('Page.navigate', { url: URL }); await sleep(+(process.env.LOADMS || 3000));
console.log('load+init ms ~', Date.now() - t0, 'nodes', await ev('MAIN.length'), 'player', await ev('[player.x|0,player.y|0]'));
await shot('1-start');
await key('keyDown', 'Enter', 'Enter'); await key('keyUp', 'Enter', 'Enter');
await sleep(4500);
console.log('job', await ev('G.job && [G.job.stage, G.job.f.n, G.job.pickup.name, G.job.drop.name]'));
await key('keyDown', 'KeyZ', 'y'); await key('keyUp', 'KeyZ', 'y'); await sleep(300);
console.log('after Y', await ev('G.job && G.job.stage'), 'cars', await ev('cars.length'));
await key('keyDown', 'ArrowUp', 'ArrowUp'); await sleep(2500);
console.log('speed km/h', await ev('Math.round(speedOf(player)*3.6)'), 'pos', await ev('[player.x|0,player.y|0]'));
await shot('2-driving');
await key('keyUp', 'ArrowUp', 'ArrowUp');
// teleport to pickup to test job flow
await ev('player.x=G.job.pickup.x; player.y=G.job.pickup.y; player.vx=player.vy=0; camX=player.x; camY=player.y');
await sleep(500); console.log('at pickup ->', await ev('G.job && G.job.stage'));
await ev('player.x=G.job.drop.x; player.y=G.job.drop.y; camX=player.x; camY=player.y');
await sleep(500); console.log('at drop -> job', await ev('G.job'), 'money', await ev('G.money'));
// police chase
await ev('crime("Test"); crime.cd=0; G.crimeCd=0; crime("Test2")');
await sleep(6000);
console.log('wanted', await ev('G.wanted'), 'police', await ev('cars.filter(c=>c.kind==="police").map(c=>[c.chase, Math.round(dist(c.x,c.y,player.x,player.y))])'));
await shot('3-chase');
await sleep(6000);
console.log('later police dists', await ev('cars.filter(c=>c.kind==="police").map(c=>Math.round(dist(c.x,c.y,player.x,player.y)))'), 'wanted', await ev('G.wanted'), 'banner', await ev('G.banner'));
const fps = await ev('new Promise(r=>{let n=0,s=performance.now();(function f(){n++; if(performance.now()-s<2000) requestAnimationFrame(f); else r(n/2)})()})');
console.log('fps (headless)', await (await cmd('Runtime.evaluate', { expression: 'new Promise(r=>{let n=0,s=performance.now();(function f(){n++; if(performance.now()-s<2000) requestAnimationFrame(f); else r(n/2)})()})', awaitPromise: true, returnByValue: true })).result.result.value);
await shot('4-later');
await ev('window._rnd = Math.random; Math.random = () => 0.01; G.rolled = {}'); // discretion rolls always act in these checks
// traffic rules: a cop sees speeding -> pull-over (no chase); stopping -> fine paid
await ev('G.wanted=0; for (const c of cars) c.chase=false; G.grace=0; G.stop=null');
const r1 = await ev(`(() => {
  const cop = cars.find(c => c.kind === 'police') || spawn('police', 0, 3000);
  const e = EDGES.find(e => e.lim === 30 && !e.ow && dist(NX(e.a),NY(e.a),NX(e.b),NY(e.b)) > 30);
  player.x = NX(e.a); player.y = NY(e.a); player.a = Math.atan2(NY(e.b)-NY(e.a), NX(e.b)-NX(e.a));
  player.vx = Math.cos(player.a) * 18; player.vy = Math.sin(player.a) * 18;
  cop.x = player.x + 1; cop.y = player.y; cop.vx = cop.vy = 0;
  G.money = 500; rules(speedOf(player)); player.vx = player.vy = 0; // the cop is 1 m away: stand still or it counts as ramming
  return [!!G.stop, G.stop && G.stop.reason, G.stop && G.stop.fine, G.wanted, G.limit];
})()`);
console.log('speeding 65 in 30 seen by cop -> stop, reason, fine, wanted, limit:', r1);
await ev('player.vx = player.vy = 0; G.stop.cop.x = player.x - 8; G.stop.cop.y = player.y');
await sleep(4500);
console.log('after stopping 4 s -> stop open?', await ev('!!G.stop'), 'money', await ev('G.money'), 'wanted', await ev('G.wanted'));
// fleeing a stop -> wanted 2
await ev('G.grace = 0; pullOver(cars.find(c => c.kind === "police"), "Test", 50); player.x += 200');
await sleep(300);
console.log('fled stop -> wanted', await ev('G.wanted'), 'stop', await ev('!!G.stop'));
// red light
const r2 = await ev(`(() => {
  G.wanted = 0; G.stop = null; G.grace = 0; G.tGrace = 0; G.crimeCd = 0;
  const [n, j] = [...SIG].find(([n]) => { const r = nearestEdge(NX(n), NY(n), 3); return r && !r.e.ow; });
  player.x = NX(n); player.y = NY(n);
  for (let a = 0; a < 6.3; a += 0.1) if (light(j, a)[0] === 'r') { player.a = a; break; }
  player.vx = Math.cos(player.a) * 8; player.vy = Math.sin(player.a) * 8;
  const cop = cars.find(c => c.kind === 'police'); cop.x = player.x + 2; cop.y = player.y + 2;
  rules(speedOf(player));
  return [light(j, player.a), G.stop && G.stop.reason, G.stop && G.stop.fine];
})()`);
console.log('red light -> light, reason, fine:', r2);
await ev('Math.random = window._rnd');
// pursuit: police chase the last known position, not you. Hide 300 m away -> they search there, then give up
await ev(`(() => { G.stop = null; G.wanted = 0; G.grace = 0; G.crimeCd = 0; for (const c of cars) { c.chase = false; c.stop = false; }
  crime('Test pursuit', 1); const k = G.known;
  const n = MAIN.find(n => dist(NX(n), NY(n), k.x, k.y) > 300 && dist(NX(n), NY(n), k.x, k.y) < 400);
  player.x = NX(n); player.y = NY(n); player.vx = player.vy = 0; camX = player.x; camY = player.y;
  for (const c of cars) if (c.kind === 'police' && dist(c.x, c.y, player.x, player.y) < 120) { c.x = k.x; c.y = k.y; } })()`);
await sleep(8000);
console.log('hiding: wanted', await ev('G.wanted'), 'known still old spot', await ev('dist(G.known.x, G.known.y, player.x, player.y) > 250'), 'chasing cops', await ev('cars.filter(c => c.chase).length'), 'any sees me', await ev('seenBy(cars.filter(c => c.kind === "police"))'), 'search r', await ev('Math.round(searchRadius())'));
await shot('8-search');
await sleep(20000);
console.log('after 28 s hidden: wanted', await ev('G.wanted'), 'chasing', await ev('cars.filter(c => c.chase).length'), 'goal', await ev('JSON.stringify(G.known)'));
console.log('AI wrong-way edges driven:', await ev('cars.filter(c => c.kind === "traffic" && WRONGWAY.has(c.from + "," + c.to)).length'), 'of', await ev('cars.filter(c => c.kind === "traffic").length'));
console.log('live', await ev('JSON.stringify(LIVE)'), 'area', await ev('G.area.n'), 'buses', await ev('buses.map(b => b.name).join(" ")'));
await ev('G.stop = null; player.x = 1500; player.y = 1080; camX = player.x; camY = player.y'); await sleep(1500); await shot('5-skalitzer');
await ev('player.x = 2050; player.y = 1200; camX = player.x; camY = player.y'); await sleep(1500); await shot('6-goerli');
await ev(`(() => { const e = EDGES.find(e => e.w === 11 && !e.ow && PGRID.has((NX(e.a)/64|0)+','+(NY(e.a)/64|0)) && dist(NX(e.a),NY(e.a),START[0],START[1]) > 300);
  player.x = NX(e.a); player.y = NY(e.a); player.a = Math.atan2(NY(e.b)-NY(e.a), NX(e.b)-NX(e.a)); camX = player.x; camY = player.y; })()`);
await sleep(2500); await shot('7-sidestreet');
console.log('counts: traffic', await ev('cars.filter(c => c.kind === "traffic").length'), 'onscreen cars', await ev('cars.filter(c => onScreen(c.x, c.y, 0)).length'), 'peds', await ev('peds.length'), 'onscreen peds', await ev('peds.filter(p => onScreen(p.x, p.y, 0)).length'), 'parked', await ev('PARKED.length / 4'));
const fps2 = await (await cmd('Runtime.evaluate', { expression: 'new Promise(r=>{let n=0,s=performance.now();(function f(){n++; if(performance.now()-s<2000) requestAnimationFrame(f); else r(n/2)})()})', awaitPromise: true, returnByValue: true })).result.result.value;
console.log('fps with full traffic', fps2);
// traffic: lane discipline (two-way roads: right of the centre line), pedestrians off the carriageway
console.log('lanes right/mid/wrong, peds on road:', await ev(`(() => { let r = 0, m = 0, w = 0;
  for (const c of cars) { if (c.kind !== 'traffic' || c.abandoned) continue; const q = nearestEdge(c.x, c.y, 12); if (!q || q.e.ow) continue;
    const e = q.e, dx = NX(e.b) - NX(e.a), dy = NY(e.b) - NY(e.a), f = Math.cos(c.a) * dx + Math.sin(c.a) * dy > 0 ? 1 : -1;
    const lat = ((c.x - NX(e.a)) * -dy + (c.y - NY(e.a)) * dx) / Math.hypot(dx, dy) * f; lat > 0.8 ? r++ : lat < -0.8 ? w++ : m++; }
  return [r, m, w, peds.filter(p => !p.fall && onRoad(p.x, p.y) && !nearCrossing(p.x, p.y, 7)).length]; })()`));
console.log('bikes', await ev('cars.filter(c => c.kind === "bike").length'), 'avg traffic km/h', await ev('Math.round(cars.filter(c => c.kind === "traffic").reduce((s, c) => s + Math.abs(speedOf(c)), 0) / cars.filter(c => c.kind === "traffic").length * 3.6)'));
// on foot: get out, walk, take a parked car, get out again, take a moving car (carjacking)
await ev('G.wanted = 0; G.stop = null; for (const c of cars) { c.chase = false; c.stop = false; } player.vx = player.vy = 0; toggleCar()');
console.log('got out -> kind', await ev('player.kind'), 'my car abandoned', await ev('cars.some(c => c.mine && c.abandoned)'));
await key('keyDown', 'ArrowRight', 'ArrowRight'); await sleep(1000); await key('keyUp', 'ArrowRight', 'ArrowRight');
console.log('walked', await ev('Math.round(Math.hypot(player.vx, player.vy) * 10) / 10 + " m/s last, at " + [player.x | 0, player.y | 0]'));
console.log('take parked car ->', await ev(`(() => { let k = 0; while (PARKED[k + 3] < 0) k += 4; player.x = PARKED[k] + 1.5; player.y = PARKED[k + 1]; const n = PARKED.filter((v, i) => i % 4 === 3 && v >= 0).length;
  toggleCar(); return [player.kind, PARKED.filter((v, i) => i % 4 === 3 && v >= 0).length === n - 1]; })()`));
await sleep(400); await shot('9-foot');
console.log('carjack ->', await ev(`(() => { toggleCar(); const v = cars.find(c => c.kind === 'traffic' && !c.abandoned && onScreen(c.x, c.y, 60)) || cars.find(c => c.kind === 'traffic' && !c.abandoned);
  player.x = v.x + 2; player.y = v.y; const np = peds.length; toggleCar(); return [player === v, player.kind, peds.length > np || 'no walk node near', G.reports.length + G.wanted > 0 || 'no witness (random)']; })()`));
console.log('errors after rules', errors);
console.log('errors', errors);
ws.close(); chrome.kill();
