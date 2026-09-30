// Miguel's Casino server: hosts the casino, keeps every player's bankroll, runs every game, and has a hidden admin room.
// No packages needed. Start it with:  node server.js
//
// Where things are saved:
//   - If UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are set, in that Upstash Redis database
//     (use this on Render's free plan, which wipes local files whenever the server sleeps).
//   - Otherwise in data/ next to this file (fine on your own computer).
//
// Admin room (optional): set ADMIN_USER, ADMIN_PASSWORD and ADMIN_PATH in the environment.
// The room is then at https://your-casino/ADMIN_PATH and nowhere else.

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const PAGES = ['index.html', 'blackjack.html', 'roulette.html', 'craps.html', 'slots.html', 'blackjack-live.html', 'roulette-live.html', 'poker-live.html'];
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
const PUBLIC_DIR = findPublicDir();
const REDIS_URL = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || '';
const USE_REDIS = Boolean(REDIS_URL && REDIS_TOKEN);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const KEYS = { players: 'miguels-casino:players', live: 'miguels-casino:live', meta: 'miguels-casino:meta' };
const MAX_PLAYERS = 2000;
const FLUSH_MS = 10000;
const META_MS = 45000;           // the house books and logs change with every bet; save them less often
const ADMIN = {
  user: process.env.ADMIN_USER || '', pass: process.env.ADMIN_PASSWORD || '',
  path: String(process.env.ADMIN_PATH || '').replace(/^\/+|\/+$/g, ''),
};
const ADMIN_ON = ADMIN.user.length >= 3 && ADMIN.pass.length >= 8 && /^[A-Za-z0-9_-]{6,64}$/.test(ADMIN.path);
const STARTED = Date.now();

/* ---------------- storage ---------------- */
async function redis(command) {
  const res = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) throw new Error(`Upstash error: ${body.error || res.status}`);
  return body.result;
}
const file = name => path.join(DATA_DIR, name + '.json');
function writeFileAtomic(name, text) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file(name) + '.tmp', text); fs.renameSync(file(name) + '.tmp', file(name)); }
const readFile = name => (fs.existsSync(file(name)) ? fs.readFileSync(file(name), 'utf8') : null);

/* ---------------- accounts, security log, settings ---------------- */
const A = require('./accounts')({ onChange: () => boardChanged(), canCreate });
const META = { settings: { notice: null, locked: false, closed: false }, security: [], audit: [], house: A.house };
let metaDirty = false;
const saveMeta = () => { metaDirty = true; };
function clientIp(req) { return (String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '').replace(/^::ffff:/, '').slice(0, 64); }
function flag(id, kind, detail, ip) {
  const rec = id ? A.get(id) : null;
  META.security.push({ t: Date.now(), id: id || '', name: rec ? rec.name : '', ip: ip || (rec && rec.ip) || '', kind, detail: String(detail).slice(0, 200) });
  if (META.security.length > 400) META.security.splice(0, META.security.length - 400);
  if (rec) { rec.alerts = (rec.alerts || 0) + 1; A.touch(id); }
  saveMeta();
}
function audit(action, detail, ip) {
  META.audit.push({ t: Date.now(), action, detail: String(detail).slice(0, 200), ip });
  if (META.audit.length > 300) META.audit.splice(0, META.audit.length - 300);
  saveMeta();
}
// how fast new players can be made from one network (a whole school can share one address, so this is generous)
const created = new Map();
function canCreate(ip) {
  if (META.settings.locked) return 'The casino is not taking new players right now.';
  if (A.players.size >= MAX_PLAYERS) return 'The casino is full.';
  const now = Date.now(), list = (created.get(ip) || []).filter(t => now - t < 3600000);
  if (list.length >= 20) return 'Too many new players from this network. Try again later.';
  list.push(now); created.set(ip, list);
  return null;
}
// rate limits: a bucket of requests per key that refills over time
const buckets = new Map();
function allow(key, perSec, burst) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) { b = { tokens: burst, t: now }; buckets.set(key, b); }
  b.tokens = Math.min(burst, b.tokens + (now - b.t) / 1000 * perSec); b.t = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1; return true;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.t > 600000) buckets.delete(k); }, 300000).unref();

/* ---------------- loading & saving ---------------- */
let ready = false, loadError = '';
let liveState = null, liveDirty = false;
async function load() {
  if (USE_REDIS) {
    const flat = (await redis(['HGETALL', KEYS.players])) || [];
    const entries = [];
    for (let i = 0; i + 1 < flat.length; i += 2) { try { entries.push([flat[i], JSON.parse(flat[i + 1])]); } catch (e) { /* skip */ } }
    A.load(entries);
    const meta = await redis(['GET', KEYS.meta]);
    if (meta) mergeMeta(JSON.parse(meta));
    const liveRaw = await redis(['GET', KEYS.live]);
    return liveRaw ? JSON.parse(liveRaw) : null;
  }
  const p = readFile('players');
  if (p) A.load(Object.entries(JSON.parse(p)));
  const m = readFile('meta');
  if (m) mergeMeta(JSON.parse(m));
  const l = readFile('live');
  return l ? JSON.parse(l) : null;
}
function mergeMeta(m) {
  Object.assign(META.settings, m.settings || {});
  META.security = Array.isArray(m.security) ? m.security : [];
  META.audit = Array.isArray(m.audit) ? m.audit : [];
  for (const [g, h] of Object.entries(m.house || {})) Object.assign(A.houseFor(g), h);
}
let flushing = false, lastMeta = 0;
async function flush(force) {
  if (flushing || !ready) return;
  flushing = true;
  const batch = A.takeDirty();
  try {
    if (USE_REDIS) {
      for (let i = 0; i < batch.set.length; i += 25) await redis(['HSET', KEYS.players, ...batch.set.slice(i, i + 25).flat()]);
      if (batch.del.length) await redis(['HDEL', KEYS.players, ...batch.del]);
      if (metaDirty && (force || Date.now() - lastMeta > META_MS)) { metaDirty = false; lastMeta = Date.now(); await redis(['SET', KEYS.meta, JSON.stringify(META)]); }
      if (liveDirty && liveState) { liveDirty = false; await redis(['SET', KEYS.live, JSON.stringify(liveState)]); }
    } else {
      if (batch.set.length || batch.del.length) {
        const all = {}; for (const [id, r] of A.players) all[id] = r;
        writeFileAtomic('players', JSON.stringify(all));
      }
      if (metaDirty) { metaDirty = false; writeFileAtomic('meta', JSON.stringify(META)); }
      if (liveDirty && liveState) { liveDirty = false; writeFileAtomic('live', JSON.stringify(liveState)); }
    }
  } catch (e) {
    A.putBack(batch); metaDirty = true; liveDirty = true;
    console.error('Could not save:', e.message);
  } finally { flushing = false; }
}
setInterval(flush, FLUSH_MS).unref();

/* ---------------- the games ---------------- */
function authPlayer(id, token, ip, opts = {}) {
  const r = A.auth(id, token, ip, opts);
  if (r.error && r.reason === 'wrong-token') flag(id, 'wrong-key', 'Someone tried to use this seat with the wrong key', ip);
  return r;
}
const games = require('./games')(A, { flag: (id, kind, detail) => flag(id, kind, detail), isClosed: () => META.settings.closed });
const live = require('./live')({
  A, cleanName: A.cleanName, flag,
  saveState: s => { liveState = s; liveDirty = true; },
  auth: (id, token, ip) => authPlayer(id, token, ip),
  isClosed: () => META.settings.closed,
});

/* ---------------- leaderboard stream ---------------- */
const streams = new Set();
let boardTimer = null;
function boardChanged() {
  if (boardTimer || !ready) return;
  boardTimer = setTimeout(() => {
    boardTimer = null;
    const msg = `event: players\ndata: ${JSON.stringify(A.publicList())}\n\n`;
    for (const res of streams) res.write(msg);
  }, 1000);
}
function noticeNow() { const n = META.settings.notice; return n && n.text && (!n.until || n.until > Date.now()) ? n : null; }
function sendNotice() { const msg = `event: notice\ndata: ${JSON.stringify(noticeNow())}\n\n`; for (const res of streams) res.write(msg); }
setInterval(() => { for (const res of streams) res.write(': keep-alive\n\n'); }, 25000).unref();

/* ---------------- http helpers ---------------- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon' };
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' };
function send(res, status, body, type = 'application/json', extra = {}) {
  res.writeHead(status, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, SECURITY_HEADERS, extra));
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function jsonBody(req) { try { const b = JSON.parse(await readBody(req)); return b && typeof b === 'object' ? b : null; } catch (e) { return null; } }
function serveFile(req, res, urlPath) {
  if (!PUBLIC_DIR) return send(res, 200, '<!doctype html><meta charset="utf-8"><title>Setup</title><p>The server is running, but the casino pages are missing. Upload index.html and the game pages next to server.js.', 'text/html; charset=utf-8');
  let rel;
  try { rel = decodeURIComponent(urlPath); } catch (e) { return send(res, 400, 'Bad address', 'text/plain; charset=utf-8'); }
  if (rel === '/' || rel === '') rel = '/index.html';
  const f = path.normalize(path.join(PUBLIC_DIR, rel));
  const allowed = /\.(html|css|svg|png|jpe?g|webp|ico)$/i.test(f);
  const inData = f.startsWith(path.resolve(DATA_DIR) + path.sep);
  if (!f.startsWith(PUBLIC_DIR + path.sep) || !allowed || inData || /backroom/i.test(f)) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  fs.readFile(f, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    res.writeHead(200, Object.assign({ 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' }, SECURITY_HEADERS));
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

/* ---------------- player API ---------------- */
function meBody(id) {
  return Object.assign(A.me(id), { notice: noticeNow(), closed: !!META.settings.closed, craps: (A.get(id).games.craps || null) });
}
async function playerApi(req, res, p, ip) {
  if (!ready) return send(res, 503, { error: 'The casino is opening. Try again in a few seconds.' });
  if (p === '/api/players' && req.method === 'GET') return send(res, 200, A.publicList());
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  const b = await jsonBody(req);
  if (!b) return send(res, 400, { error: 'Send JSON.' });
  const id = String(b.id || '');
  if (!allow('ip:' + ip, 40, 80)) return send(res, 429, { error: 'Slow down a little.' });
  if (id && !allow('p:' + id, 14, 30)) { if (allow('flag429:' + id, 0.02, 1)) flag(id, 'rate-limit', 'Sent requests faster than any person can play', ip); return send(res, 429, { error: 'Slow down a little.' }); }

  // the old leaderboard address: browsers used to report their own bankroll here. Nothing it says about money is used now.
  if (p === '/api/players') {
    const who = authPlayer(id, b.token, ip, { create: true, allowBanned: true });
    if (who.error) return send(res, who.code, { error: who.error });
    if (b.name) A.setName(id, b.name);
    if (b.cash !== undefined) {
      const claimed = Math.round(Number(b.cash) || 0), real = A.cash(id);
      if (Math.abs(claimed - real) > 100) flag(id, claimed > real + 1000000 ? 'tamper' : 'legacy', `Reported a bankroll of ${A.usd(claimed)} (real: ${A.usd(real)}). Ignored.`, ip);
    }
    return send(res, 200, { ok: true, ignored: true, cents: who.rec.bal });
  }
  if (p === '/api/me') {
    const who = authPlayer(id, b.token, ip, { create: true, allowBanned: true });
    if (who.error) return send(res, who.code, { error: who.error });
    if (b.name) A.setName(id, b.name);
    return send(res, 200, meBody(id));
  }
  const who = authPlayer(id, b.token, ip);
  if (who.error) return send(res, who.code, { error: who.error });
  if (p === '/api/wallet/reset') {
    const r = A.reset(id);
    if (r.error) return send(res, r.code || 409, { error: r.error, cents: who.rec.bal });
    return send(res, 200, meBody(id));
  }
  let m;
  if ((m = p.match(/^\/api\/g\/(slots|roulette|blackjack|craps)$/))) {
    const r = games.handle(m[1], id, b);
    return send(res, r.code, r.body);
  }
  return send(res, 404, { error: 'Unknown address.' });
}

/* ---------------- admin room ---------------- */
const sessions = new Map();          // token -> { exp, ip }
const loginFails = new Map();        // ip -> [times]
const sha = s => crypto.createHash('sha256').update(String(s)).digest();
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
function cookies(req) { const o = {}; String(req.headers.cookie || '').split(';').forEach(c => { const i = c.indexOf('='); if (i > 0) o[c.slice(0, i).trim()] = c.slice(i + 1).trim(); }); return o; }
function adminSession(req) {
  const t = cookies(req).mc_bk;
  if (!t) return null;
  const s = sessions.get(t);
  if (!s || s.exp < Date.now()) { sessions.delete(t); return null; }
  return s;
}
const isHttps = req => String(req.headers['x-forwarded-proto'] || '').includes('https');
async function adminApi(req, res, sub, ip) {
  const notFound = () => send(res, 404, 'Not found', 'text/plain; charset=utf-8');
  if (sub === '/api/login' && req.method === 'POST') {
    const fails = (loginFails.get(ip) || []).filter(t => Date.now() - t < 15 * 60000);
    if (fails.length >= 5) return send(res, 429, { error: 'Too many wrong tries. Wait 15 minutes.' });
    const b = await jsonBody(req);
    await new Promise(r => setTimeout(r, 400));
    if (!b || !same(String(b.user || ''), ADMIN.user) || !same(String(b.pass || ''), ADMIN.pass)) {
      fails.push(Date.now()); loginFails.set(ip, fails);
      flag('', 'admin-login', `Wrong admin username or password (try ${fails.length} of 5)`, ip);
      return send(res, 401, { error: 'Wrong username or password.' });
    }
    loginFails.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { exp: Date.now() + 12 * 3600000, ip });
    audit('login', 'Signed in', ip);
    return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': `mc_bk=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${isHttps(req) ? '; Secure' : ''}` });
  }
  const s = adminSession(req);
  // every admin request must come from the admin page itself
  if (!s || req.headers['x-backroom'] !== '1') return sub === '/api/session' ? send(res, 200, { ok: false }) : notFound();
  if (!ready) return send(res, 503, { error: 'Still loading.' });
  if (sub === '/api/session') return send(res, 200, { ok: true });
  if (sub === '/api/logout' && req.method === 'POST') { sessions.delete(cookies(req).mc_bk); return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': 'mc_bk=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); }
  const onlineMap = live.onlineNow();
  const recent = r => Date.now() - Math.max(r.lastPlay || 0, r.seen || 0) < 180000;
  if (sub === '/api/overview') {
    let money = 0, named = 0, banned = 0, online = 0;
    for (const [id, r] of A.players) { money += A.cash(id); if (r.name) named++; if (r.banned) banned++; if (recent(r) || onlineMap.has(id)) online++; }
    const bigWins = [];
    for (const [id, r] of A.players) for (const e of r.log) if (e[2] >= 50000 && Date.now() - e[0] < 7 * 86400000 && !['reset', 'admin', 'import', 'table', 'join'].includes(e[1])) bigWins.push({ t: e[0], id, name: r.name, game: e[1], amount: e[2] });
    bigWins.sort((a, b) => b.amount - a.amount);
    return send(res, 200, {
      players: A.players.size, named, banned, online, money, house: A.house, live: live.summary(), settings: META.settings,
      security: META.security.slice(-80).reverse(), audit: META.audit.slice(-40).reverse(), bigWins: bigWins.slice(0, 12),
      startedAt: STARTED, storage: USE_REDIS ? 'upstash' : 'file',
    });
  }
  if (sub === '/api/players') {
    const rows = [];
    for (const [id, r] of A.players) rows.push({
      id, name: r.name, bal: r.bal, cash: A.cash(id), peak: r.peak, resets: r.resets, rounds: r.st.rounds, wagered: r.st.wagered, paid: r.st.paid,
      bigWin: r.st.bigWin, joined: r.joined, seen: Math.max(r.seen || 0, r.lastPlay || 0), lastGame: r.lastGame || '', ip: r.ip, banned: r.banned, hidden: !!r.hidden,
      flagged: r.flagged || '', alerts: r.alerts || 0, imported: r.imported, online: recent(r) || onlineMap.has(id), where: live.where(id),
    });
    return send(res, 200, rows);
  }
  if (sub.startsWith('/api/player') && req.method === 'GET') {
    const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
    const r = A.get(id);
    if (!r) return send(res, 404, { error: 'No such player.' });
    const o = Object.assign({}, r); delete o.tokenHash; delete o.games;
    o.id = id; o.cash = A.cash(id); o.craps = r.games.craps || null; o.where = live.where(id);
    o.security = META.security.filter(e => e.id === id).slice(-40).reverse();
    o.sameIp = r.ip ? [...A.players].filter(([pid, x]) => pid !== id && x.ip === r.ip).map(([pid, x]) => ({ id: pid, name: x.name || '(no name)' })).slice(0, 20) : [];
    return send(res, 200, o);
  }
  if (req.method !== 'POST') return notFound();
  const b = await jsonBody(req);
  if (!b) return send(res, 400, { error: 'Send JSON.' });
  if (sub === '/api/player') {
    const id = String(b.id || ''), r = A.get(id);
    if (!r) return send(res, 404, { error: 'No such player.' });
    const who = `${r.name || '(no name)'} (${id})`;
    const cents = Math.round(Number(b.cents));
    switch (b.op) {
      case 'setBalance':
        if (!(cents >= 0 && cents <= 1e11)) return send(res, 400, { error: 'Pick an amount from $0 to $1,000,000,000.' });
        A.logTx(r, 'admin', cents - r.bal, 'Balance set by the casino'); r.bal = cents; r.peak = Math.max(r.peak, A.cash(id)); A.touch(id);
        audit('balance', `${who}: set to ${A.usd(cents)}`, ip); break;
      case 'adjust':
        if (!Number.isFinite(cents) || !cents || Math.abs(cents) > 1e11) return send(res, 400, { error: 'Pick an amount.' });
        if (r.bal + cents < 0) return send(res, 400, { error: `They only have ${A.usd(r.bal)}.` });
        r.bal += cents; A.logTx(r, 'admin', cents, cents > 0 ? 'Gift from the casino' : 'Taken by the casino'); r.peak = Math.max(r.peak, A.cash(id)); A.touch(id);
        audit('balance', `${who}: ${cents > 0 ? '+' : '−'}${A.usd(Math.abs(cents))}`, ip); break;
      case 'rename': {
        const n = A.cleanName(b.name);
        if (n.length < 2) return send(res, 400, { error: 'Names need at least 2 characters.' });
        audit('rename', `${who} → ${n}`, ip); r.name = n; r.nameLocked = true; A.touch(id); break;
      }
      case 'ban': r.banned = { t: Date.now(), reason: A.cleanName(b.reason || '').slice(0, 80) || 'Suspended' }; live.kick(id); A.touch(id); audit('ban', `${who}: ${r.banned.reason}`, ip); break;
      case 'unban': r.banned = null; A.touch(id); audit('unban', who, ip); break;
      case 'hide': r.hidden = !r.hidden; A.touch(id); audit('board', `${who}: ${r.hidden ? 'hidden from' : 'back on'} the leaderboard`, ip); break;
      case 'kick': audit('kick', `${who}: removed from ${live.kick(id)} live table(s)`, ip); break;
      case 'resetStats': r.st = Object.assign(r.st, { hands: 0, spins: 0, rolls: 0, bigWin: 0, blackjacks: 0, bestMult: 0, pointsMade: 0 }); r.resets = 0; r.peak = A.cash(id); A.touch(id); audit('stats', `${who}: stats cleared`, ip); break;
      case 'clearFlag': r.flagged = ''; r.alerts = 0; A.touch(id); audit('flag', `${who}: alerts cleared`, ip); break;
      case 'delete': live.kick(id); A.remove(id); audit('delete', `${who} deleted (had ${A.usd(r.bal)})`, ip); boardChanged(); return send(res, 200, { ok: true, deleted: true });
      default: return send(res, 400, { error: 'Unknown action.' });
    }
    boardChanged();
    return send(res, 200, { ok: true });
  }
  if (sub === '/api/settings') {
    const st = META.settings;
    if (b.notice !== undefined) {
      const text = String(b.notice && b.notice.text || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
      st.notice = text ? { text, kind: ['info', 'party', 'warn'].includes(b.notice.kind) ? b.notice.kind : 'info', until: Number(b.notice.hours) > 0 ? Date.now() + Math.min(720, Number(b.notice.hours)) * 3600000 : 0, t: Date.now() } : null;
      audit('notice', text ? `Announcement: ${text}` : 'Announcement removed', ip); sendNotice();
    }
    if (b.locked !== undefined) { st.locked = !!b.locked; audit('signups', st.locked ? 'New players locked out' : 'New players welcome again', ip); }
    if (b.closed !== undefined) { st.closed = !!b.closed; audit('closed', st.closed ? 'Casino closed' : 'Casino open', ip); }
    saveMeta();
    return send(res, 200, { ok: true, settings: st });
  }
  if (sub === '/api/gift') {
    const cents = Math.round(Number(b.cents));
    if (!(cents > 0 && cents <= 100000000)) return send(res, 400, { error: 'Gift $0.01 to $1,000,000.' });
    let n = 0;
    for (const [id, r] of A.players) {
      if (r.banned || !r.name) continue;
      if (b.to === 'online' && !(recent(r) || onlineMap.has(id))) continue;
      r.bal += cents; A.logTx(r, 'admin', cents, String(b.note || 'Gift from the casino').slice(0, 60)); A.touch(id); n++;
    }
    audit('gift', `${A.usd(cents)} to ${n} player${n === 1 ? '' : 's'} (${b.to === 'online' ? 'online now' : 'everyone'})`, ip);
    boardChanged();
    return send(res, 200, { ok: true, count: n });
  }
  if (sub === '/api/clearlog') { META.security = []; saveMeta(); audit('log', 'Security log cleared', ip); return send(res, 200, { ok: true }); }
  if (sub === '/api/export') {
    const all = {}; for (const [id, r] of A.players) { const o = Object.assign({}, r); delete o.tokenHash; all[id] = o; }
    audit('export', 'Downloaded a backup', ip);
    return send(res, 200, { exportedAt: new Date().toISOString(), players: all, house: A.house, settings: META.settings });
  }
  return notFound();
}
function adminPage(res) {
  let html = '';
  try { html = fs.readFileSync(path.join(__dirname, 'backroom.tpl'), 'utf8'); } catch (e) { return send(res, 404, 'Not found', 'text/plain; charset=utf-8'); }
  send(res, 200, html.replace(/__ADMIN_PATH__/g, ADMIN.path), 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex, nofollow', 'X-Frame-Options': 'DENY' });
}

/* ---------------- server ---------------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(String(req.url || '/').replace(/^\/+/, '/'), 'http://localhost');
    const p = url.pathname, ip = clientIp(req);
    if (ADMIN_ON && (p === '/' + ADMIN.path || p === '/' + ADMIN.path + '/')) return adminPage(res);
    if (ADMIN_ON && p.startsWith('/' + ADMIN.path + '/api/')) return adminApi(req, res, p.slice(ADMIN.path.length + 1), ip);
    if (p === '/api/health') return send(res, 200, {
      ok: true, ready, storage: USE_REDIS ? 'upstash' : 'file', players: A.players.size, secure: 2, error: loadError || undefined,
      pagesFolder: PUBLIC_DIR ? (path.relative(__dirname, PUBLIC_DIR) || '(next to server.js)') : 'NOT FOUND',
      pages: PAGES.map(f => `${f}: ${PUBLIC_DIR && fs.existsSync(path.join(PUBLIC_DIR, f)) ? 'found' : 'missing'}`),
    });
    if (p === '/api/stream') {
      if (!ready) return send(res, 503, { error: 'Opening.' });
      res.writeHead(200, Object.assign({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }, SECURITY_HEADERS));
      res.write(`retry: 3000\nevent: players\ndata: ${JSON.stringify(A.publicList())}\n\nevent: notice\ndata: ${JSON.stringify(noticeNow())}\n\n`);
      streams.add(res);
      req.on('close', () => streams.delete(res));
      return;
    }
    if (p === '/api/live/stream') { if (!ready) return send(res, 503, { error: 'Opening.' }); return live.stream(req, res, url, ip); }
    if (p === '/api/live/summary') return send(res, 200, live.summary());
    if ((p === '/api/live/bj' || p === '/api/live/rl' || p === '/api/live/pk' || p === '/api/live/claim') && req.method === 'POST') {
      if (!ready) return send(res, 503, { error: 'The casino is opening. Try again in a few seconds.' });
      const b = await jsonBody(req);
      if (!b) return send(res, 400, { error: 'Send JSON.' });
      if (!allow('ip:' + ip, 40, 80) || !allow('p:' + String(b.id || ''), 14, 30)) return send(res, 429, { error: 'Slow down a little.' });
      const r = p === '/api/live/claim' ? live.claim(b, ip) : live.action(p.endsWith('bj') ? 'bj' : p.endsWith('pk') ? 'pk' : 'rl', b, ip);
      if (r.flag) flag(String(b.id || ''), 'invalid', r.flag, ip);
      return send(res, r.code, r.body);
    }
    if (p.startsWith('/api/')) return playerApi(req, res, p, ip);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain; charset=utf-8');
    return serveFile(req, res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong.' });
  }
});

async function shutdown() {
  try { live.persist(); await flush(true); } catch (e) {}
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// open the doors right away (Render waits for the port), then load the saved casino
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Miguel's Casino is open on http://localhost:${PORT}`);
  console.log(PUBLIC_DIR ? `Casino pages found in ${PUBLIC_DIR}` : 'WARNING: casino pages not found.');
  console.log(ADMIN_ON ? `Admin room is at /${ADMIN.path}` : 'Admin room is off (set ADMIN_USER, ADMIN_PASSWORD and ADMIN_PATH to turn it on).');
});
(async function start(attempt = 1) {
  try {
    const liveSaved = await load();
    ready = true; loadError = '';
    live.restore(liveSaved);
    boardChanged();
    console.log(`Saved in ${USE_REDIS ? 'Upstash Redis' : DATA_DIR} · ${A.players.size} player${A.players.size === 1 ? '' : 's'} loaded`);
    flush();
  } catch (e) {
    loadError = e.message;
    console.error(`Could not load the casino (try ${attempt}):`, e.message);
    setTimeout(() => start(attempt + 1), Math.min(30000, 2000 * attempt));
  }
})();
