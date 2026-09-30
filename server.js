// Miguel's Casino server: hosts the casino pages and keeps the shared High Rollers leaderboard.
// No packages needed. Start it with:  node server.js
//
// Where the leaderboard is saved:
//   - If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, in that Upstash Redis database
//     (use this on Render's free plan, which wipes local files whenever the server sleeps).
//   - Otherwise in data/players.json next to this file (fine on your own computer).

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
// Find the casino pages: normally in public/, but also works when they were uploaded
// next to server.js or inside an extra folder (GitHub's upload page sometimes does that).
const PAGES = ['index.html', 'blackjack.html', 'roulette.html', 'craps.html', 'blackjack-live.html', 'roulette-live.html'];
function findPublicDir() {
  const hasPages = dir => { try { return fs.existsSync(path.join(dir, 'index.html')); } catch (e) { return false; } };
  const preferred = [path.join(__dirname, 'public'), __dirname];
  for (const d of preferred) if (hasPages(d)) return d;
  const queue = [[__dirname, 0]];
  while (queue.length) {
    const [dir, depth] = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const sub = path.join(dir, e.name);
      if (hasPages(sub)) return sub;
      if (depth < 3) queue.push([sub, depth + 1]);
    }
  }
  return null;
}
function listFiles(dir, depth = 0, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name), rel = path.relative(__dirname, full) || e.name;
    if (e.isDirectory()) { out.push(rel + '/'); if (depth < 3) listFiles(full, depth + 1, out); }
    else out.push(rel);
    if (out.length > 60) break;
  }
  return out;
}
const PUBLIC_DIR = findPublicDir();
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_REDIS = Boolean(REDIS_URL && REDIS_TOKEN);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'players.json');
const REDIS_KEY = 'miguels-casino:players';
const MAX_PLAYERS = 500;
const FLUSH_MS = 10000;          // save changed players at most every 10 s (keeps Upstash usage low)
const MIN_WRITE_GAP_MS = 1000;   // one update per player per second

/** id -> { tokenHash, data } */
const players = new Map();
const dirty = new Set();
const lastWrite = new Map();

/* ---------------- storage ---------------- */
async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Upstash error: ${body.error || res.status}`);
  return body.result;
}
async function load() {
  if (USE_REDIS) {
    const flat = (await redis(['HGETALL', REDIS_KEY])) || [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      try { players.set(flat[i], JSON.parse(flat[i + 1])); } catch (e) { /* skip a damaged entry */ }
    }
  } else if (fs.existsSync(DATA_FILE)) {
    const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    for (const [id, entry] of Object.entries(saved)) players.set(id, entry);
  }
}
let flushing = false;
async function flush() {
  if (flushing || !dirty.size) return;
  flushing = true;
  const ids = [...dirty];
  dirty.clear();
  try {
    if (USE_REDIS) {
      const cmd = ['HSET', REDIS_KEY];
      for (const id of ids) if (players.has(id)) cmd.push(id, JSON.stringify(players.get(id)));
      if (cmd.length > 2) await redis(cmd);
    } else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(players)));
      fs.renameSync(tmp, DATA_FILE);
    }
  } catch (e) {
    ids.forEach(id => dirty.add(id));   // try again next time
    console.error('Could not save the leaderboard:', e.message);
  } finally {
    flushing = false;
  }
}
setInterval(flush, FLUSH_MS).unref();

/* ---------------- players ---------------- */
const num = (v, max = 1e15) => (Number.isFinite(+v) ? Math.max(0, Math.min(max, Math.round(+v))) : 0);
function sanitize(b) {
  const name = String(b.name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
  return {
    name: name || 'Player',
    cash: num(b.cash), peak: num(b.peak), resets: num(b.resets, 1e6),
    hands: num(b.hands, 1e9), spins: num(b.spins, 1e9), rolls: num(b.rolls, 1e9),
    bigWin: num(b.bigWin), blackjacks: num(b.blackjacks, 1e9), bestMult: num(b.bestMult, 1e4), pointsMade: num(b.pointsMade, 1e9),
    joined: num(b.joined, 1e14),
    updatedAt: Date.now(),
  };
}
const publicList = () => [...players.entries()].map(([id, p]) => Object.assign({ id }, p.data)).sort((a, b) => b.cash - a.cash);
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');

/* ---------------- live tables ---------------- */
// the same browser seat (id + secret token) is used for the leaderboard and the live tables
const liveAuth = new Map();
function checkToken(id, token) {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || token.length < 16 || token.length > 128) return false;
  const known = players.has(id) ? players.get(id).tokenHash : liveAuth.get(id);
  if (known) return known === hash(token);
  liveAuth.set(id, hash(token));
  return true;
}
const cleanName = n => String(n || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18) || 'Player';
const live = require('./live')({ checkToken, cleanName });

/* ---------------- live updates (server-sent events) ---------------- */
const streams = new Set();
let broadcastTimer = null;
function broadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const msg = `event: players\ndata: ${JSON.stringify(publicList())}\n\n`;
    for (const res of streams) res.write(msg);
  }, 400);
}
setInterval(() => { for (const res of streams) res.write(': keep-alive\n\n'); }, 25000).unref();

/* ---------------- http ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8' };
function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function handleUpdate(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'Send the player as JSON.' }); }
  const id = String(body.id || ''), token = String(body.token || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id) || token.length < 16 || token.length > 128) return send(res, 400, { error: 'Missing player id or token.' });
  const now = Date.now();
  if (now - (lastWrite.get(id) || 0) < MIN_WRITE_GAP_MS) return send(res, 429, { error: 'Too many updates. Try again in a second.' });
  const existing = players.get(id);
  if (existing && existing.tokenHash !== hash(token)) return send(res, 403, { error: 'This seat belongs to another browser.' });
  if (!existing && liveAuth.has(id) && liveAuth.get(id) !== hash(token)) return send(res, 403, { error: 'This seat belongs to another browser.' });
  if (!existing && players.size >= MAX_PLAYERS) return send(res, 507, { error: 'The leaderboard is full.' });
  lastWrite.set(id, now);
  players.set(id, { tokenHash: hash(token), data: sanitize(body) });
  dirty.add(id);
  broadcast();
  send(res, 200, { ok: true });
}
function missingPagesPage(res) {
  const esc = t => String(t).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const files = listFiles(__dirname);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Miguel's Casino setup</title>
<style>body{margin:0;background:#16080E;color:#F5EBDD;font:16px/1.6 system-ui,sans-serif;padding:32px 20px}main{max-width:640px;margin:0 auto}h1{color:#F7DFA3;font-size:26px;margin:0 0 8px}
code,li{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:14px}ul{background:#0B0407;border-radius:12px;padding:14px 14px 14px 34px}b{color:#F7DFA3}</style></head><body><main>
<h1>The server is running, but the casino pages are missing</h1>
<p>It looked for <b>index.html</b> (plus blackjack.html, roulette.html and craps.html) and couldn't find them. Upload those four files to your GitHub repository, either inside a folder named <b>public</b> or next to server.js. Render updates the site by itself a minute later.</p>
<p>Files the server can see right now:</p><ul>${files.length ? files.map(f => `<li>${esc(f)}</li>`).join('') : '<li>(none)</li>'}</ul>
</main></body></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}
function serveFile(req, res, urlPath) {
  if (!PUBLIC_DIR) return missingPagesPage(res);
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  // only web pages and images, never the server's own files or the saved leaderboard
  const allowed = /\.(html|css|svg|png|jpe?g|webp|ico)$/i.test(file);
  const inData = file.startsWith(path.resolve(DATA_DIR) + path.sep);
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !allowed || inData) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(String(req.url || '/').replace(/^\/+/, '/'), 'http://localhost');
    const p = url.pathname;
    if (p === '/api/health') return send(res, 200, {
      ok: true, storage: USE_REDIS ? 'upstash' : 'file', players: players.size,
      pagesFolder: PUBLIC_DIR ? (path.relative(__dirname, PUBLIC_DIR) || '(next to server.js)') : 'NOT FOUND',
      pages: PAGES.map(f => `${f}: ${PUBLIC_DIR && fs.existsSync(path.join(PUBLIC_DIR, f)) ? 'found' : 'missing'}`),
    });
    if (p === '/api/players' && req.method === 'GET') return send(res, 200, publicList());
    if (p === '/api/players' && req.method === 'POST') return handleUpdate(req, res);
    if (p === '/api/stream') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(`retry: 3000\nevent: players\ndata: ${JSON.stringify(publicList())}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (p === '/api/live/stream') return live.stream(req, res, url);
    if (p === '/api/live/summary') return send(res, 200, live.summary());
    if ((p === '/api/live/bj' || p === '/api/live/rl' || p === '/api/live/claim') && req.method === 'POST') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return send(res, 400, { error: 'Send JSON.' }); }
      const r = p === '/api/live/claim' ? live.claim(body) : live.action(p.endsWith('bj') ? 'bj' : 'rl', body);
      return send(res, r.code, r.body);
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'Unknown address.' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
    return serveFile(req, res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
  }
});

async function shutdown() {
  await flush();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

load()
  .catch(e => console.error('Could not load the saved leaderboard:', e.message))
  .finally(() => server.listen(PORT, '0.0.0.0', () => {
    console.log(`Miguel's Casino is open on http://localhost:${PORT}`);
    console.log(PUBLIC_DIR ? `Casino pages found in ${PUBLIC_DIR}` : 'WARNING: casino pages not found. Upload index.html, blackjack.html, roulette.html and craps.html.');
    console.log(`Leaderboard saved in ${USE_REDIS ? 'Upstash Redis' : DATA_FILE} · ${players.size} player${players.size === 1 ? "" : "s"} loaded`);
  }));
