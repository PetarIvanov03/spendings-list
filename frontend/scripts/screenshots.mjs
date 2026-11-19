// Screenshots of the DEMO build for the docs (docs/screenshots/*-light.png and *-dark.png).
// Made-up data only. No dependencies: drives a headless Chromium browser (Edge or Chrome) over
// the DevTools protocol.
//
//   npm run build && npm run build:demo
//   npx vite preview --port 8791 --strictPort        (in another terminal)
//   npm run screenshots
//
// BROWSER=<path to chrome/msedge> to override the browser, BASE=<url> to override the demo url.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:8791/spendings-list/demo/';
const OUT = new URL('../../docs/screenshots/', import.meta.url);
const BROWSER =
  process.env.BROWSER ??
  [
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find((p) => fs.existsSync(p));
if (!BROWSER) throw new Error('No Chrome or Edge found: set BROWSER=<path>');

const PORT = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spend-shots-'));
const browser = spawn(BROWSER, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let targets;
for (let i = 0; i < 50 && !targets; i++) {
  await sleep(200);
  try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { /* not up yet */ }
}
const ws = new WebSocket(targets.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const waiting = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (waiting.has(m.id)) { waiting.get(m.id)(m.result); waiting.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { waiting.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
const run = (code) => send('Runtime.evaluate', { expression: `(async () => { ${code} })()`, awaitPromise: true });

// Helpers available to every scene.
const HELPERS = `
  const w = (ms) => new Promise((r) => setTimeout(r, ms));
  const tab = (i) => (document.querySelector('.sidebar').offsetParent ? document.querySelectorAll('.side-link') : document.querySelectorAll('.tabbar .tab'))[i].click();
  const type = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  const everyone = async () => { document.querySelector('.dd-trigger').click(); await w(200); [...document.querySelectorAll('.dd-option')].find((o) => o.textContent.includes('Всички')).click(); await w(900); };
`;

async function shot(name, { width, height, scale, mobile, user, role, steps }, theme) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: BASE });
  await sleep(800);
  await run(`localStorage.clear();
    localStorage.setItem('spend-demo:session', JSON.stringify({ user: { name: '${user}', role: '${role}' } }));
    localStorage.setItem('spend-demo:lastActivityAt', String(Date.now()));
    location.reload();`);
  await sleep(1500);
  await run(HELPERS + steps);
  await sleep(900);
  const { data } = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(new URL(`${name}-${theme}.png`, OUT), Buffer.from(data, 'base64'));
  console.log(`docs/screenshots/${name}-${theme}.png`);
}

const phone = { width: 390, height: 844, scale: 2, mobile: true };
const desktop = { width: 1440, height: 900, scale: 1, mobile: false };
const SCENES = {
  add: { ...phone, user: 'elena', role: 'parent', steps: `
    type(document.getElementById('price'), '24,90');
    type(document.getElementById('item'), 'Пазар');
    [...document.querySelectorAll('.scope .filter-chip')].find((b) => b.textContent === 'Семеен').click();
    document.querySelector('.chip').click();
    document.activeElement.blur();` },
  list: { ...phone, user: 'maria', role: 'admin', steps: `tab(1); await w(900); await everyone();` },
  summary: { ...phone, user: 'maria', role: 'admin', steps: `tab(2); await w(900);` },
  desktop: { ...desktop, user: 'maria', role: 'admin', steps: `tab(1); await w(900); await everyone();` },
};

fs.mkdirSync(OUT, { recursive: true });
try {
  for (const theme of ['light', 'dark']) for (const [name, scene] of Object.entries(SCENES)) await shot(name, scene, theme);
} finally {
  const exited = new Promise((r) => browser.once('exit', r));
  await Promise.race([send('Browser.close'), sleep(2000)]); // closes every browser process
  ws.close();
  await Promise.race([exited, sleep(5000)]);
  await sleep(1000); // Windows releases the profile files a moment after exit
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch { /* temp dir, harmless */ }
}
process.exit(0);
