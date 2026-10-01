// Miguel's Casino live tables, part two: Crash and Baccarat, plus the chat on every live table.
// Like the other live tables, the server keeps time, decides every result and moves the money.
'use strict';
const crypto = require('crypto');
const rnd = n => crypto.randomInt(n);
const F = Number(process.env.LIVE_TIME_SCALE) || 1;   // for automated tests only
const WF = require('./wordfilter');

module.exports = function createLive2({ A, cleanName, auth, isClosed, flag, vip, persist }) {
  const maxFor = pid => (vip && vip(pid) ? 500000 : 100000);
  const bal = pid => { const r = A.get(pid); return r ? r.bal : 0; };
  const nameOf = (pid, fallback) => cleanName(fallback) || (A.get(pid) || {}).name || 'Player';
  const conns = new Set();   // { res, game, pid, name }
  const dirty = new Set(); let flushTimer = null;
  function changed(game) {
    dirty.add(game);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const games = [...dirty]; dirty.clear();
      for (const c of conns) if (games.includes(c.game)) push(c);
      persist();
    }, 40);
  }
  function push(c) { try { c.res.write(`event: state\ndata: ${JSON.stringify(c.game === 'cr' ? crView(c.pid) : bcView(c.pid))}\n\n`); } catch (e) {} }
  const present = game => { for (const c of conns) if (c.game === game) return true; return false; };
  setInterval(() => { for (const c of conns) { try { c.res.write(': keep-alive\n\n'); } catch (e) {} } }, 15000).unref();

  /* =============== CRASH =============== */
  // the multiplier grows as e^(RATE·t); the round busts at a point drawn so that P(bust ≥ x) = 0.97 / x
  const RATE = 0.08 / F, CR_BET_MS = 9000 * F, CR_AFTER_MS = 4000 * F, CR_MAX = 1000;
  const CR = { phase: 'idle', round: 0, deadline: 0, start: 0, bust: 0, bets: new Map(), history: [], timer: null, tick: null };
  const multAt = t => Math.floor(Math.exp(RATE * Math.max(0, t) / 1000) * 100) / 100;
  const timeFor = m => Math.log(m) / RATE * 1000;
  function bustPoint() {
    const u = (crypto.randomInt(2 ** 32)) / 2 ** 32;        // 0 <= u < 1
    const x = Math.floor(97 / (1 - u)) / 100;               // 3% of rounds bust at 1.00
    return Math.min(CR_MAX, Math.max(1, x));
  }
  const crTimer = (ms, fn) => { clearTimeout(CR.timer); CR.timer = setTimeout(fn, ms); };
  function crBetting() {
    CR.phase = 'betting'; CR.deadline = Date.now() + CR_BET_MS; CR.bust = 0; CR.start = 0;
    crTimer(CR_BET_MS, crLaunch); changed('cr');
  }
  function crLaunch() {
    if (!CR.bets.size) { if (present('cr')) crBetting(); else { CR.phase = 'idle'; CR.deadline = 0; changed('cr'); } return; }
    CR.round++;
    CR.bust = bustPoint();
    CR.phase = 'running'; CR.start = Date.now() + 600 * F;     // a short "3, 2, 1" before lift-off
    CR.deadline = CR.start + timeFor(CR.bust);
    crTimer(CR.deadline - Date.now(), crBust);
    clearInterval(CR.tick); CR.tick = setInterval(crAuto, 100);
    changed('cr');
  }
  function cashOut(pid, b, m) {
    b.out = m; b.paid = Math.round(b.bet * m);
    A.credit(pid, b.paid, 'crash', `Crash cash-out at ${m.toFixed(2)}×`);
    const tags = []; if (m >= 2) tags.push('crash-2x'); if (m >= 10) tags.push('crash-10'); if (m >= 50) tags.push('crash-50');
    A.round(pid, 'crash', { staked: b.bet, paid: b.paid, spins: 1, mult: m >= 10 ? Math.floor(m) : 0, tags });
  }
  function crAuto() {
    if (CR.phase !== 'running') return;
    const now = multAt(Date.now() - CR.start);
    let any = false;
    for (const [pid, b] of CR.bets) if (!b.out && b.auto && b.auto <= now && b.auto < CR.bust) { cashOut(pid, b, b.auto); any = true; }
    if (any) changed('cr');
  }
  function crBust() {
    clearInterval(CR.tick);
    // automatic cash-outs below the bust point always pay, even between ticks
    for (const [pid, b] of CR.bets) {
      if (b.out) continue;
      if (b.auto && b.auto < CR.bust) cashOut(pid, b, b.auto);
      else { b.lost = true; A.round(pid, 'crash', { staked: b.bet, paid: 0, spins: 1 }); }
    }
    CR.phase = 'crashed'; CR.deadline = Date.now() + CR_AFTER_MS;
    CR.history.push(CR.bust); if (CR.history.length > 30) CR.history.shift();
    CR.last = [...CR.bets].map(([pid, b]) => ({ pid, name: b.name, bet: b.bet, out: b.out || 0, paid: b.paid || 0 }));
    CR.bets.clear();
    changed('cr');
    crTimer(CR_AFTER_MS, () => { if (present('cr')) crBetting(); else { CR.phase = 'idle'; CR.deadline = 0; changed('cr'); } });
  }
  function crAction(pid, name, body) {
    const act = String(body.action || '');
    if (act === 'bet') {
      if (CR.phase !== 'betting' && CR.phase !== 'idle') return { code: 409, body: { error: 'Wait for the next round to bet.', cents: bal(pid) } };
      if (CR.bets.has(pid)) return { code: 409, body: { error: 'You already have a bet on this round.', cents: bal(pid) } };
      const bet = Math.round(Number(body.bet));
      if (!(bet >= 100) || bet > maxFor(pid) || bet % 10) return { code: 400, body: { error: `Bets go from $1 to $${(maxFor(pid) / 100).toLocaleString('en-US')}.` }, flag: `crash bet ${String(body.bet).slice(0, 20)}` };
      let auto = body.auto == null || body.auto === '' ? 0 : Math.floor(Number(body.auto) * 100) / 100;
      if (auto && !(auto >= 1.01 && auto <= CR_MAX)) return { code: 400, body: { error: 'Auto cash-out goes from 1.01× to 1,000×.' } };
      if (!A.debit(pid, bet, 'crash', 'Crash bet')) return { code: 409, body: { error: 'Not enough in your bankroll.', cents: bal(pid) } };
      CR.bets.set(pid, { bet, auto, name, t: Date.now() });
      if (CR.phase === 'idle') crBetting(); else changed('cr');
      return { code: 200, body: { ok: true, cents: bal(pid) } };
    }
    if (act === 'cancel') {
      const b = CR.bets.get(pid);
      if (!b || CR.phase !== 'betting') return { code: 409, body: { error: 'Too late to take it back.', cents: bal(pid) } };
      A.refund(pid, b.bet, 'crash', 'Crash bet taken back'); CR.bets.delete(pid); changed('cr');
      return { code: 200, body: { ok: true, cents: bal(pid) } };
    }
    if (act === 'cash') {
      const b = CR.bets.get(pid);
      if (!b || CR.phase !== 'running' || b.out) return { code: 409, body: { error: 'Nothing to cash out.', cents: bal(pid) } };
      const t = Date.now() - CR.start;
      if (t < 0) return { code: 409, body: { error: 'The rocket hasn’t taken off yet.', cents: bal(pid) } };
      const m = multAt(t);
      if (m >= CR.bust) return { code: 409, body: { error: 'Too late, it crashed.', cents: bal(pid) } };
      cashOut(pid, b, m); changed('cr');
      return { code: 200, body: { ok: true, at: m, paid: b.paid, cents: bal(pid) } };
    }
    return { code: 400, body: { error: 'Unknown action.' } };
  }
  function crView(pid) {
    const players = [...CR.bets].map(([p, b]) => ({ name: b.name, me: p === pid, bet: b.bet, out: b.out || 0, paid: b.paid || 0 }))
      .concat(CR.phase === 'crashed' && CR.last ? CR.last.filter(x => !CR.bets.has(x.pid)).map(x => ({ name: x.name, me: x.pid === pid, bet: x.bet, out: x.out, paid: x.paid, lost: !x.out })) : []);
    const mine = CR.bets.get(pid) || (CR.phase === 'crashed' && CR.last ? CR.last.find(x => x.pid === pid) : null);
    let watching = 0; const seen = new Set(); for (const c of conns) if (c.game === 'cr' && !seen.has(c.pid)) { seen.add(c.pid); watching++; }
    return {
      game: 'cr', now: Date.now(), phase: CR.phase, round: CR.round, deadline: CR.deadline, start: CR.start, rate: RATE,
      bust: CR.phase === 'crashed' ? CR.history[CR.history.length - 1] : null,           // never sent before the crash
      history: CR.history.slice(-20), players, watching,
      me: { bet: mine ? mine.bet : 0, auto: mine && mine.auto || 0, out: mine ? mine.out || 0 : 0, paid: mine ? mine.paid || 0 : 0, cents: bal(pid), max: maxFor(pid) },
    };
  }

  /* =============== BACCARAT (punto banco, 8 decks) =============== */
  const BC_BET_MS = 15000 * F, BC_RESULT_MS = 6000 * F, BC_CARD_MS = 900 * F, BC_THIRD_MS = 1300 * F;
  const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const val = r => (r === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(r) ? 0 : +r);
  const score = cards => cards.reduce((a, c) => a + val(c.r), 0) % 10;
  const SPOTS = ['player', 'banker', 'tie', 'pp', 'bp'];
  const BC = { phase: 'idle', round: 0, deadline: 0, shoe: [], bets: new Map(), hand: null, road: [], timer: null, results: {}, shuffled: false };
  function newShoe() {
    const s = [];
    for (let d = 0; d < 8; d++) for (const su of SUITS) for (const r of RANKS) s.push({ r, s: su });
    for (let i = s.length - 1; i > 0; i--) { const j = rnd(i + 1); [s[i], s[j]] = [s[j], s[i]]; }
    BC.shoe = s; BC.shuffled = true; BC.road = [];
  }
  const draw = () => BC.shoe.pop();
  const bcTimer = (ms, fn) => { clearTimeout(BC.timer); BC.timer = setTimeout(fn, ms); };
  function bcBetting() { BC.phase = 'betting'; BC.deadline = Date.now() + BC_BET_MS; BC.hand = null; bcTimer(BC_BET_MS, bcDeal); changed('bc'); }
  // the standard drawing rules: the player draws on 0-5; the banker's draw depends on the player's third card
  function playHand() {
    const P = [draw()], B = [draw()]; P.push(draw()); B.push(draw());
    const order = [['p', 0], ['b', 0], ['p', 1], ['b', 1]];
    let ps = score(P), bs = score(B);
    const natural = ps >= 8 || bs >= 8;
    let p3 = null;
    if (!natural) {
      if (ps <= 5) { p3 = draw(); P.push(p3); order.push(['p', 2]); }
      const t = p3 ? val(p3.r) : null;
      let bDraw;
      if (p3 === null) bDraw = bs <= 5;
      else if (bs <= 2) bDraw = true;
      else if (bs === 3) bDraw = t !== 8;
      else if (bs === 4) bDraw = t >= 2 && t <= 7;
      else if (bs === 5) bDraw = t >= 4 && t <= 7;
      else if (bs === 6) bDraw = t === 6 || t === 7;
      else bDraw = false;
      if (bDraw) { B.push(draw()); order.push(['b', 2]); }
    }
    ps = score(P); bs = score(B);
    const win = ps > bs ? 'player' : bs > ps ? 'banker' : 'tie';
    return { P, B, order, ps, bs, win, natural, pp: P[0].r === P[1].r, bp: B[0].r === B[1].r };
  }
  function bcDeal() {
    if (![...BC.bets.values()].some(b => b.total > 0)) { if (present('bc')) bcBetting(); else { BC.phase = 'idle'; BC.deadline = 0; changed('bc'); } return; }
    if (BC.shoe.length < 20) newShoe(); else BC.shuffled = false;
    BC.round++;
    BC.hand = playHand();
    BC.phase = 'dealing'; BC.dealStart = Date.now();
    const ms = 4 * BC_CARD_MS + (BC.hand.order.length - 4) * BC_THIRD_MS + 1200 * F;
    BC.deadline = BC.dealStart + ms;
    bcTimer(ms, bcSettle); changed('bc');
  }
  function bcSettle() {
    const H = BC.hand; BC.results = {};
    for (const [pid, b] of BC.bets) {
      let paid = 0;
      const s = b.spots;
      if (H.win === 'tie') { paid += (s.player || 0) + (s.banker || 0) + (s.tie || 0) * 9; }
      else if (H.win === 'player') paid += (s.player || 0) * 2;
      else paid += Math.floor((s.banker || 0) * 1.95);
      if (H.pp) paid += (s.pp || 0) * 12;
      if (H.bp) paid += (s.bp || 0) * 12;
      if (paid > 0) A.credit(pid, paid, 'live-bc', `Baccarat: ${H.win === 'tie' ? 'tie' : H.win + ' wins'} ${H.ps}-${H.bs}`);
      const tags = [];
      const wonMain = (H.win === 'player' && s.player) || (H.win === 'banker' && s.banker);
      if (wonMain && (H.win === 'player' ? H.ps : H.bs) === 9 && H.natural) tags.push('natural-9');
      if (H.win === 'tie' && s.tie) tags.push('tie-win');
      A.round(pid, 'live-bc', { staked: b.total, paid, hands: 1, tags });
      BC.results[pid] = { name: b.name, staked: b.total, net: paid - b.total };
    }
    BC.road.push({ w: H.win[0], ps: H.ps, bs: H.bs, n: H.natural, pp: H.pp, bp: H.bp });
    if (BC.road.length > 72) BC.road.shift();
    BC.bets.clear();
    BC.phase = 'result'; BC.deadline = Date.now() + BC_RESULT_MS;
    changed('bc');
    bcTimer(BC_RESULT_MS, () => { if (present('bc')) bcBetting(); else { BC.phase = 'idle'; BC.deadline = 0; changed('bc'); } });
  }
  function bcAction(pid, name, body) {
    if (body.action !== 'bets') return { code: 400, body: { error: 'Unknown action.' } };
    if (BC.phase !== 'betting' && BC.phase !== 'idle') return { code: 409, body: { error: 'Bets are closed for this hand.', cents: bal(pid) } };
    const raw = body.bets && typeof body.bets === 'object' ? body.bets : {};
    const spots = {}; let sum = 0;
    const mainMax = maxFor(pid), sideMax = Math.round(mainMax / 5);
    for (const [k, v] of Object.entries(raw)) {
      const amt = Math.round(Number(v));
      if (!SPOTS.includes(k) || !(amt >= 0) || amt % 100) return { code: 400, body: { error: 'That bet is not on the table.' }, flag: `baccarat bet ${String(k).slice(0, 20)}=${String(v).slice(0, 12)}` };
      if (!amt) continue;
      const lim = k === 'player' || k === 'banker' ? mainMax : sideMax;
      if (amt > lim) return { code: 400, body: { error: `${k === 'player' || k === 'banker' ? 'Player and Banker' : 'Tie and pair bets'} take up to $${(lim / 100).toLocaleString('en-US')}.` } };
      spots[k] = amt; sum += amt;
    }
    if (spots.player && spots.banker) return { code: 400, body: { error: 'Bet on Player or Banker, not both.' } };
    const before = (BC.bets.get(pid) || { total: 0 }).total, delta = sum - before;
    if (delta > 0 && !A.debit(pid, delta, 'live-bc', 'Baccarat bets')) return { code: 409, body: { error: 'Not enough in your bankroll.', cents: bal(pid), total: before } };
    if (delta < 0) A.refund(pid, -delta, 'live-bc', 'Baccarat bets taken back');
    if (sum) BC.bets.set(pid, { spots, total: sum, name }); else BC.bets.delete(pid);
    if (BC.phase === 'idle') bcBetting(); else changed('bc');
    return { code: 200, body: { ok: true, total: sum, cents: bal(pid) } };
  }
  function bcView(pid) {
    const seen = new Map();
    for (const c of conns) if (c.game === 'bc') seen.set(c.pid, c.name);
    for (const [p, b] of BC.bets) seen.set(p, b.name);
    if (BC.phase === 'result') for (const [p, r] of Object.entries(BC.results)) seen.set(p, r.name);
    const players = [...seen].map(([p, n]) => {
      const b = BC.bets.get(p), r = BC.phase === 'result' ? BC.results[p] : null;
      return { name: n, me: p === pid, bet: r ? r.staked : b ? b.total : 0, net: r ? r.net : null, side: b ? (b.spots.player ? 'P' : b.spots.banker ? 'B' : b.spots.tie ? 'T' : '') : '' };
    });
    // the cards are only sent once the hand is being dealt, and the page shows them in order
    const H = BC.phase === 'dealing' || BC.phase === 'result' ? BC.hand : null;
    const mine = BC.bets.get(pid);
    return {
      game: 'bc', now: Date.now(), phase: BC.phase, round: BC.round, deadline: BC.deadline, dealStart: BC.dealStart || 0,
      cardMs: BC_CARD_MS, thirdMs: BC_THIRD_MS, shoeLeft: BC.shoe.length, shuffled: BC.shuffled && BC.phase !== 'betting',
      hand: H ? { P: H.P, B: H.B, order: H.order, ps: H.ps, bs: H.bs, win: H.win, natural: H.natural, pp: H.pp, bp: H.bp } : null,
      road: BC.road.slice(-72), players,
      me: { spots: mine ? mine.spots : {}, total: mine ? mine.total : 0, cents: bal(pid), max: maxFor(pid), sideMax: Math.round(maxFor(pid) / 5), result: BC.phase === 'result' && BC.results[pid] ? BC.results[pid] : null },
    };
  }

  /* =============== CHAT =============== */
  const ROOMS = ['bj', 'rl', 'pk', 'cr', 'bc'];
  const REACTS = ['👍', '😂', '🔥', '😮', '😭', '🎉', '💰', '🍀'];
  const chat = Object.fromEntries(ROOMS.map(r => [r, []]));
  const chatConns = new Set();
  let msgId = 0;
  const lastMsg = new Map(), lastReact = new Map();
  function broadcast(room, event, data) {
    const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of chatConns) if (c.room === room) { try { c.res.write(s); } catch (e) {} }
  }
  function chatStream(req, res, url, ip) {
    const room = url.searchParams.get('room'), pid = url.searchParams.get('id') || '', token = url.searchParams.get('token') || '';
    if (!ROOMS.includes(room)) { res.writeHead(400); return res.end(); }
    const who = auth(pid, token, ip);
    if (who.error) { res.writeHead(who.code || 403); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(`retry: 3000\nevent: history\ndata: ${JSON.stringify(chat[room].slice(-40))}\n\n`);
    const c = { res, room, pid }; chatConns.add(c);
    req.on('close', () => chatConns.delete(c));
  }
  const mutedFor = rec => (rec && rec.muted && rec.muted > Date.now() ? rec.muted : 0);
  function chatPost(body, ip) {
    const pid = String(body.id || ''), token = String(body.token || '');
    const who = auth(pid, token, ip);
    if (who.error) return { code: who.code || 403, body: { error: who.error } };
    const room = String(body.room || '');
    if (!ROOMS.includes(room)) return { code: 400, body: { error: 'Unknown table.' } };
    const rec = A.get(pid);
    if (rec.banned) return { code: 403, body: { error: 'Your account has been suspended.' } };
    if (body.react !== undefined) {
      if (!REACTS.includes(body.react)) return { code: 400, body: { error: 'Unknown reaction.' } };
      if (Date.now() - (lastReact.get(pid) || 0) < 800) return { code: 429, body: { error: 'Easy on the reactions.' } };
      lastReact.set(pid, Date.now());
      broadcast(room, 'react', { e: body.react, name: rec.name || 'Player' });
      return { code: 200, body: { ok: true } };
    }
    const m = mutedFor(rec);
    if (m) return { code: 403, body: { error: `You’re muted for ${Math.ceil((m - Date.now()) / 60000)} more minute${Math.ceil((m - Date.now()) / 60000) === 1 ? '' : 's'}.` } };
    if (!rec.name) return { code: 409, body: { error: 'Pick a name in the lobby to chat.' } };
    if (Date.now() - (lastMsg.get(pid) || 0) < 2000) return { code: 429, body: { error: 'One message every 2 seconds.' } };
    let text = String(body.text || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 140);
    if (!text) return { code: 400, body: { error: 'Type a message first.' } };
    text = WF.clean(text);
    if (WF.bad(text)) { flag && flag(pid, 'chat', `Blocked chat message: ${text.slice(0, 60)}`, ip); return { code: 400, body: { error: 'Keep the chat friendly. That message wasn’t sent.' } }; }
    lastMsg.set(pid, Date.now());
    const lvl = rec.life ? Math.floor(Math.sqrt((rec.life.xp || 0) / 100)) : 0;
    const msg = { id: ++msgId, t: Date.now(), name: rec.name, lvl, text, p: crypto.createHash('sha256').update(pid).digest('hex').slice(0, 8) };
    chat[room].push(msg); if (chat[room].length > 60) chat[room].shift();
    broadcast(room, 'msg', msg);
    return { code: 200, body: { ok: true } };
  }
  // admin room
  function chatClear(room) { for (const r of room === 'all' ? ROOMS : [room]) if (chat[r]) { chat[r] = []; broadcast(r, 'clear', {}); } }
  function chatRecent() { return ROOMS.flatMap(r => chat[r].map(m => Object.assign({ room: r }, m))).sort((a, b) => b.t - a.t).slice(0, 40); }
  function chatDelete(id) { for (const r of ROOMS) { const n = chat[r].length; chat[r] = chat[r].filter(m => m.id !== id); if (chat[r].length !== n) broadcast(r, 'del', { id }); } }

  /* =============== shared =============== */
  function stream(req, res, url, ip) {
    const game = url.searchParams.get('game'), pid = url.searchParams.get('id') || '', token = url.searchParams.get('token') || '';
    if (game !== 'cr' && game !== 'bc') { res.writeHead(400); return res.end(); }
    const who = auth(pid, token, ip);
    if (who.error) { res.writeHead(who.code || 403); return res.end(); }
    const c = { res, game, pid, name: nameOf(pid, url.searchParams.get('name')) };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    conns.add(c);
    if (game === 'cr' && CR.phase === 'idle') crBetting();
    if (game === 'bc' && BC.phase === 'idle') bcBetting();
    push(c); changed(game);
    req.on('close', () => { conns.delete(c); changed(game); });
  }
  function action(game, body, ip) {
    const pid = String(body.id || ''), token = String(body.token || '');
    const who = auth(pid, token, ip);
    if (who.error) return { code: who.code || 403, body: { error: who.error } };
    if (isClosed()) return { code: 503, body: { error: 'The casino is closed for a moment. Try again soon.' } };
    const name = nameOf(pid, body.name);
    return game === 'cr' ? crAction(pid, name, body) : bcAction(pid, name, body);
  }
  // money on these tables right now
  function onTables(pid) {
    let c = 0;
    const b = CR.bets.get(pid); if (b && !b.out && CR.phase !== 'crashed') c += b.bet;
    const k = BC.bets.get(pid); if (k && BC.phase !== 'result') c += k.total;
    return c;
  }
  A.extras.push(onTables);
  function atRisk() {
    const out = {};
    for (const [pid, b] of CR.bets) if (!b.out && CR.phase !== 'crashed') out[pid] = (out[pid] || 0) + b.bet;
    if (BC.phase !== 'result') for (const [pid, b] of BC.bets) out[pid] = (out[pid] || 0) + b.total;
    return out;
  }
  function summary() {
    const n = g => { const s = new Set(); for (const c of conns) if (c.game === g) s.add(c.pid); return s.size; };
    return { cr: { players: n('cr'), phase: CR.phase, last: CR.history.slice(-1)[0] || null }, bc: { players: n('bc'), phase: BC.phase } };
  }
  function where(pid) {
    const out = [];
    if (CR.bets.has(pid) || [...conns].some(c => c.game === 'cr' && c.pid === pid)) out.push('Crash');
    if (BC.bets.has(pid) || [...conns].some(c => c.game === 'bc' && c.pid === pid)) out.push('Live baccarat');
    return out;
  }
  function kick(pid) {
    let n = 0;
    const b = CR.bets.get(pid);
    if (b && CR.phase === 'betting') { A.refund(pid, b.bet, 'crash', 'Crash bet returned'); CR.bets.delete(pid); n++; changed('cr'); }
    const k = BC.bets.get(pid);
    if (k && BC.phase === 'betting') { A.refund(pid, k.total, 'live-bc', 'Baccarat bets returned'); BC.bets.delete(pid); n++; changed('bc'); }
    for (const c of [...conns]) if (c.pid === pid) { try { c.res.end(); } catch (e) {} conns.delete(c); }
    for (const c of [...chatConns]) if (c.pid === pid) { try { c.res.end(); } catch (e) {} chatConns.delete(c); }
    return n;
  }
  const allPids = () => new Set([...CR.bets.keys(), ...BC.bets.keys()]);
  function onlineNow(m) { for (const c of conns) { if (!m.has(c.pid)) m.set(c.pid, []); m.get(c.pid).push(c.game); } return m; }
  return { stream, action, chatStream, chatPost, chatClear, chatRecent, chatDelete, summary, where, kick, allPids, onlineNow, atRisk, REACTS, _test: { CR, BC, playHand, score, bustPoint, multAt, crBust, bcSettle, newShoe } };
};
