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
await cmd('Page.navigate', { url: URL }); await sleep(3000);
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
console.log('errors', errors);
ws.close(); chrome.kill();
