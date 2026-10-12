// Casino Radio: MP3s the admin uploads, played for everyone like a radio station.
// Everyone hears the same song at the same moment: the playlist runs on a clock (R.epoch), so changing page
// or coming back later picks the music up where the station is, instead of starting over.
// Songs are kept in Upstash Redis in 512 KB pieces (or in DATA_DIR/songs without Redis) and in memory once played.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

module.exports = function createRadio({ redis, useRedis, dataDir, headers = {} }) {
  const KEY = 'miguels-casino:radio', PART = id => `miguels-casino:song:${id}:`;
  const CHUNK = 512 * 1024, MAX_SONG = 20 * 1048576, MAX_TOTAL = 150 * 1048576, MAX_SONGS = 80, CACHE_MAX = 100 * 1048576;
  let R = { on: true, lock: false, songs: [], epoch: Date.now(), v: 1 };
  const songDir = path.join(dataDir, 'songs'), metaFile = path.join(dataDir, 'radio.json');

  /* ---------- the playlist ---------- */
  async function load() {
    try {
      const raw = useRedis ? await redis(['GET', KEY]) : (fs.existsSync(metaFile) ? fs.readFileSync(metaFile, 'utf8') : null);
      if (raw) R = Object.assign(R, JSON.parse(raw));
    } catch (e) { console.error('Radio: could not load the playlist:', e.message); }
  }
  async function save() {
    R.v = (R.v || 0) + 1;
    const t = JSON.stringify(R);
    if (useRedis) await redis(['SET', KEY, t]);
    else { fs.mkdirSync(dataDir, { recursive: true }); fs.writeFileSync(metaFile + '.tmp', t); fs.renameSync(metaFile + '.tmp', metaFile); }
  }
  const total = () => R.songs.reduce((a, s) => a + s.dur, 0);
  const startOf = i => R.songs.slice(0, i).reduce((a, s) => a + s.dur, 0);
  function nowPlaying(at = Date.now()) {
    const T = total(); if (!T) return null;
    let pos = ((at - R.epoch) / 1000) % T; if (pos < 0) pos += T;
    for (let i = 0; i < R.songs.length; i++) { const s = R.songs[i]; if (pos < s.dur) return { i, id: s.id, name: s.name, offset: pos, dur: s.dur }; pos -= s.dur; }
    return { i: 0, id: R.songs[0].id, name: R.songs[0].name, offset: 0, dur: R.songs[0].dur };
  }
  // change the list without making everyone's song jump
  function keepPlace(change) {
    const np = nowPlaying();
    change();
    if (!R.songs.length) { R.epoch = Date.now(); return; }
    if (np) {
      const i = R.songs.findIndex(s => s.id === np.id);
      if (i >= 0) { R.epoch = Date.now() - (startOf(i) + np.offset) * 1000; return; }
      R.epoch = Date.now() - startOf(Math.min(np.i, R.songs.length - 1)) * 1000;    // the song playing was removed: go on with the next one
      return;
    }
    R.epoch = Date.now();
  }

  /* ---------- the song files ---------- */
  const cache = new Map(); let cacheBytes = 0; const pending = new Map();
  function remember(id, buf) {
    if (cache.has(id)) return;
    cache.set(id, buf); cacheBytes += buf.length;
    for (const [k, b] of cache) { if (cacheBytes <= CACHE_MAX) break; if (k === id) continue; cache.delete(k); cacheBytes -= b.length; }
  }
  async function putSong(id, buf) {
    if (!useRedis) { fs.mkdirSync(songDir, { recursive: true }); fs.writeFileSync(path.join(songDir, id + '.mp3'), buf); return 1; }
    const n = Math.ceil(buf.length / CHUNK);
    for (let i = 0; i < n; i++) await redis(['SET', PART(id) + i, buf.subarray(i * CHUNK, (i + 1) * CHUNK).toString('base64')]);
    return n;
  }
  async function dropSong(s) {
    cache.has(s.id) && (cacheBytes -= cache.get(s.id).length, cache.delete(s.id));
    if (!useRedis) { try { fs.unlinkSync(path.join(songDir, s.id + '.mp3')); } catch (e) {} return; }
    const keys = Array.from({ length: s.chunks }, (_, i) => PART(s.id) + i);
    for (let i = 0; i < keys.length; i += 50) await redis(['DEL', ...keys.slice(i, i + 50)]);
  }
  async function getSong(id) {
    if (cache.has(id)) { const b = cache.get(id); cache.delete(id); cache.set(id, b); return b; }
    const s = R.songs.find(x => x.id === id); if (!s) return null;
    if (pending.has(id)) return pending.get(id);
    const p = (async () => {
      let buf;
      if (useRedis) {
        const parts = [];
        for (let i = 0; i < s.chunks; i += 8) parts.push(...await Promise.all(Array.from({ length: Math.min(8, s.chunks - i) }, (_, k) => redis(['GET', PART(id) + (i + k)]))));
        if (parts.some(x => !x)) throw new Error('song pieces missing');
        buf = Buffer.concat(parts.map(x => Buffer.from(x, 'base64')));
      } else buf = fs.readFileSync(path.join(songDir, id + '.mp3'));
      remember(id, buf); return buf;
    })().finally(() => pending.delete(id));
    pending.set(id, p);
    return p;
  }
  const isMp3 = b => b.length > 1024 && ((b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0));
  function readRaw(req, limit) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > limit) { reject(Object.assign(new Error('too large'), { big: true })); req.destroy(); } else chunks.push(c); });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }

  /* ---------- for every page ---------- */
  const publicView = () => ({ on: !!R.on, lock: !!R.lock, epoch: R.epoch, now: Date.now(), v: R.v, songs: R.songs.map(s => ({ id: s.id, name: s.name, dur: s.dur })) });
  async function serveSong(req, res, id) {
    let buf;
    try { buf = await getSong(id); } catch (e) { console.error('Radio:', e.message); }
    if (!buf) { res.writeHead(404, Object.assign({ 'Content-Type': 'text/plain' }, headers)); return res.end('Not found'); }
    const base = Object.assign({ 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable' }, headers);
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && (m[1] || m[2])) {
      let start = m[1] ? +m[1] : buf.length - +m[2], end = m[1] && m[2] ? Math.min(+m[2], buf.length - 1) : buf.length - 1;
      if (start < 0) start = 0;
      if (start >= buf.length || start > end) { res.writeHead(416, Object.assign({ 'Content-Range': `bytes */${buf.length}` }, headers)); return res.end(); }
      res.writeHead(206, Object.assign(base, { 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': end - start + 1 }));
      return res.end(req.method === 'HEAD' ? undefined : buf.subarray(start, end + 1));
    }
    res.writeHead(200, Object.assign(base, { 'Content-Length': buf.length }));
    res.end(req.method === 'HEAD' ? undefined : buf);
  }

  /* ---------- the admin room ---------- */
  const adminView = () => {
    const np = nowPlaying();
    return Object.assign(publicView(), { bytes: R.songs.reduce((a, s) => a + s.size, 0), maxBytes: MAX_TOTAL, maxSong: MAX_SONG, storage: useRedis ? 'upstash' : 'file',
      playing: np ? { id: np.id, offset: Math.round(np.offset), dur: np.dur } : null, songs: R.songs.map(s => ({ id: s.id, name: s.name, dur: s.dur, size: s.size, added: s.added })) });
  };
  async function upload(req) {
    const name = (() => { try { return decodeURIComponent(String(req.headers['x-name'] || '')); } catch (e) { return ''; } })()
      .replace(/\.mp3$/i, '').replace(/[\u0000-\u001f<>]/g, '').replace(/[_]+/g, ' ').trim().slice(0, 80) || 'Untitled';
    const dur = Number(req.headers['x-dur']);
    if (!(dur >= 3 && dur <= 3 * 3600)) return { code: 400, body: { error: 'Could not read how long the song is.' } };
    if (R.songs.length >= MAX_SONGS) return { code: 400, body: { error: `The radio holds ${MAX_SONGS} songs at most. Delete some first.` } };
    let buf;
    try { buf = await readRaw(req, MAX_SONG); } catch (e) { return { code: 413, body: { error: `That file is too big. Songs can be up to ${MAX_SONG / 1048576} MB.` } }; }
    if (!isMp3(buf)) return { code: 400, body: { error: 'That isn’t an MP3 file.' } };
    const used = R.songs.reduce((a, s) => a + s.size, 0);
    if (used + buf.length > MAX_TOTAL) return { code: 400, body: { error: `Not enough room: the radio can hold ${MAX_TOTAL / 1048576} MB of songs. Delete some first.` } };
    const id = crypto.randomBytes(8).toString('hex');
    const chunks = await putSong(id, buf);
    remember(id, buf);
    keepPlace(() => { R.songs.push({ id, name, dur: Math.round(dur * 100) / 100, size: buf.length, chunks, added: Date.now() }); });
    await save();
    return { code: 200, body: { ok: true, id, name } };
  }
  async function admin(req, sub, body) {
    if (sub === '/api/radio' && req.method === 'GET') return { code: 200, body: adminView() };
    if (sub === '/api/radio/upload' && req.method === 'POST') { const r = await upload(req); return Object.assign(r, { audit: r.code === 200 ? `Added “${r.body.name}” to the radio` : null }); }
    const b = body || {};
    if (sub === '/api/radio/delete') {
      const s = R.songs.find(x => x.id === b.id); if (!s) return { code: 404, body: { error: 'That song is gone.' } };
      keepPlace(() => { R.songs = R.songs.filter(x => x.id !== s.id); });
      await save(); await dropSong(s);
      return { code: 200, body: adminView(), audit: `Removed “${s.name}” from the radio` };
    }
    if (sub === '/api/radio/move') {
      const i = R.songs.findIndex(x => x.id === b.id), j = i + (b.dir < 0 ? -1 : 1);
      if (i < 0 || j < 0 || j >= R.songs.length) return { code: 200, body: adminView() };
      keepPlace(() => { const [s] = R.songs.splice(i, 1); R.songs.splice(j, 0, s); });
      await save(); return { code: 200, body: adminView() };
    }
    if (sub === '/api/radio/play') {      // jump straight to a song (or the next one)
      const np = nowPlaying(); if (!np) return { code: 200, body: adminView() };
      const i = b.id ? R.songs.findIndex(x => x.id === b.id) : (np.i + 1) % R.songs.length;
      if (i < 0) return { code: 404, body: { error: 'That song is gone.' } };
      R.epoch = Date.now() - startOf(i) * 1000;
      await save(); return { code: 200, body: adminView(), audit: `Radio: now playing “${R.songs[i].name}”` };
    }
    if (sub === '/api/radio/set') {
      if (typeof b.on === 'boolean') R.on = b.on;
      if (typeof b.lock === 'boolean') R.lock = b.lock;
      await save(); return { code: 200, body: adminView(), audit: `Radio ${R.on ? 'on' : 'off'}${R.lock ? ', everyone has to listen' : ''}` };
    }
    return null;
  }
  return { load, publicView, serveSong, admin, nowPlaying, _test: { R: () => R, keepPlace, total } };
};
