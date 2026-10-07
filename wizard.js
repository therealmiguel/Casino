// Wizard, the trick-taking card game: 3 to 6 players (bots can fill seats), played for points, not chips.
// 60 cards: four colours 1-13, 4 Wizards (always win) and 4 Jesters (always lose).
// Round r deals r cards each; the next card shows trump; everyone bids how many tricks they'll take;
// exactly right scores 20 + 10 per trick, otherwise -10 per trick off.
'use strict';
const crypto = require('crypto');
const rnd = n => crypto.randomInt(n);
const F = Number(process.env.LIVE_TIME_SCALE) || 1;

const SUITS = ['blue', 'red', 'green', 'yellow'];
const BOT_NAMES = ['Merlin', 'Morgana', 'Gandolfo', 'Elara', 'Zoltan', 'Nimue', 'Rincewort', 'Saruwin'];
const TURN_MS = 40000 * F, AWAY_MS = 6000 * F, BOT_MS = 1100 * F, TRICK_PAUSE = 1800 * F, ROUND_PAUSE = 6000 * F;

function deck() {
  const d = [];
  for (const s of SUITS) for (let v = 1; v <= 13; v++) d.push({ s, v, id: `${s[0]}${v}` });
  for (let i = 0; i < 4; i++) { d.push({ s: 'w', v: 99, id: `w${i}` }); d.push({ s: 'j', v: 0, id: `j${i}` }); }
  for (let i = d.length - 1; i > 0; i--) { const j = rnd(i + 1); [d[i], d[j]] = [d[j], d[i]]; }
  return d;
}
// the colour players must follow: set by the first coloured card, unless a Wizard came first
function leadSuit(trick) {
  for (const p of trick) { if (p.card.s === 'w') return null; if (p.card.s !== 'j') return p.card.s; }
  return null;
}
function winner(trick, trump) {
  const w = trick.find(p => p.card.s === 'w'); if (w) return w.seat;
  if (trick.every(p => p.card.s === 'j')) return trick[0].seat;
  const lead = leadSuit(trick);
  let best = null;
  for (const p of trick) {
    const c = p.card; if (c.s === 'j') continue;
    const score = (c.s === trump ? 200 : c.s === lead ? 100 : 0) + c.v;
    if (!best || score > best.score) best = { seat: p.seat, score };
  }
  return best ? best.seat : trick[0].seat;
}
function legal(hand, trick) {
  const lead = leadSuit(trick);
  if (!lead || !hand.some(c => c.s === lead)) return hand.map(c => c.id);
  return hand.filter(c => c.s === lead || c.s === 'w' || c.s === 'j').map(c => c.id);
}

module.exports = function createWizard({ A, cleanName, auth, isClosed, onWin }) {
  const tables = new Map();   // id -> table
  const conns = new Set();    // { res, tid, pid }
  let nextId = 1;
  const nameOf = (pid, n) => cleanName(n) || (A.get(pid) || {}).name || 'Player';
  const online = (tid, pid) => { for (const c of conns) if (c.tid === tid && c.pid === pid) return true; return false; };

  function push(T) {
    for (const c of conns) if (c.tid === T.id) { try { c.res.write(`event: state\ndata: ${JSON.stringify(view(T, c.pid))}\n\n`); } catch (e) {} }
    T.version++;
  }
  function pushList() { const l = list(); for (const c of conns) if (c.tid === 'lobby') { try { c.res.write(`event: tables\ndata: ${JSON.stringify(l)}\n\n`); } catch (e) {} } }
  setInterval(() => { for (const c of conns) { try { c.res.write(': ping\n\n'); } catch (e) {} } }, 15000).unref();

  function list() {
    return [...tables.values()].filter(T => !T.closed).map(T => ({ id: T.id, name: T.name, phase: T.phase, round: T.round, rounds: T.rounds, seats: T.seats.map(s => (s ? { name: s.name, bot: !!s.bot } : null)), max: T.max }));
  }
  function create(pid, name, opts) {
    const id = 't' + (nextId++).toString(36) + rnd(1e6).toString(36);
    const T = { id, name: (cleanName(opts.title) || `${name}'s table`).slice(0, 28), host: pid, max: Math.min(6, Math.max(3, Math.round(Number(opts.max) || 4))), seats: [], phase: 'waiting', round: 0, rounds: 0, dealer: -1, version: 0, log: [], scores: [], timer: null, closed: false, created: Date.now() };
    T.seats = Array.from({ length: T.max }, () => null);
    T.seats[0] = { pid, name, bot: false, score: 0 };
    tables.set(id, T); pushList();
    return T;
  }
  const seatOf = (T, pid) => T.seats.findIndex(s => s && s.pid === pid);
  const filled = T => T.seats.filter(Boolean);
  // seats in play order (filled seats only, compacted when the game starts)
  function start(T) {
    T.seats = filled(T);
    T.n = T.seats.length;
    T.rounds = Math.floor(60 / T.n);
    T.round = 0; T.dealer = rnd(T.n);
    T.seats.forEach(s => { s.score = 0; });
    T.scores = [];
    newRound(T);
  }
  function newRound(T) {
    T.round++;
    T.dealer = (T.dealer + 1) % T.n;
    const d = deck();
    T.seats.forEach(s => { s.hand = d.splice(0, T.round).sort(order); s.bid = null; s.tricks = 0; });
    T.flip = d.length ? d[0] : null;
    T.trump = !T.flip ? null : T.flip.s === 'w' ? undefined : T.flip.s === 'j' ? null : T.flip.s;   // undefined: the dealer picks
    T.trick = []; T.lastTrick = null; T.leader = (T.dealer + 1) % T.n;
    if (T.trump === undefined) { T.phase = 'trump'; T.turn = T.dealer; }
    else { T.phase = 'bidding'; T.turn = (T.dealer + 1) % T.n; }
    arm(T); push(T); pushList();
  }
  const order = (a, b) => { const k = c => (c.s === 'j' ? -1 : c.s === 'w' ? 99 : SUITS.indexOf(c.s)); return k(a) - k(b) || a.v - b.v; };

  /* ---------- bots, and players who aren't there ---------- */
  function botBid(T, s) {
    let e = 0;
    for (const c of s.hand) {
      if (c.s === 'w') e += 1;
      else if (c.s === T.trump) e += c.v >= 11 ? 0.9 : c.v >= 8 ? 0.55 : 0.25;
      else if (c.s !== 'j') e += c.v === 13 ? 0.6 : c.v >= 11 ? 0.3 : 0.05;
    }
    return Math.max(0, Math.min(T.round, Math.round(e)));
  }
  function botPlay(T, s) {
    const ok = legal(s.hand, T.trick).map(id => s.hand.find(c => c.id === id));
    const want = s.bid - s.tricks > 0;
    const wouldWin = c => winner(T.trick.concat([{ seat: T.turn, card: c }]), T.trump) === T.turn;
    const val = c => (c.s === 'w' ? 300 : c.s === 'j' ? -1 : (c.s === T.trump ? 200 : 0) + c.v);
    if (want) {
      // win as cheaply as possible; if nothing wins, throw the weakest card
      const winners = ok.filter(wouldWin).sort((a, b) => val(a) - val(b));
      if (winners.length && (T.trick.length === T.n - 1 || val(winners[0]) > 150 || winners[0].v >= 10 || winners[0].s === 'w')) return winners[0];
      if (winners.length && T.trick.length > 0) return winners[0];
      return ok.slice().sort((a, b) => val(b) - val(a))[T.trick.length === 0 ? 0 : ok.length - 1];
    }
    // don't want tricks: play the highest card that still loses, or a Jester
    const losers = ok.filter(c => !wouldWin(c)).sort((a, b) => val(b) - val(a));
    if (losers.length) return losers[0];
    return ok.slice().sort((a, b) => val(a) - val(b))[0];
  }
  function botTrump(s) {
    const cnt = {}; s.hand.forEach(c => { if (SUITS.includes(c.s)) cnt[c.s] = (cnt[c.s] || 0) + c.v; });
    return Object.entries(cnt).sort((a, b) => b[1] - a[1])[0]?.[0] || SUITS[rnd(4)];
  }
  // whoever's turn it is gets a timer; bots answer quickly, away players a little slower
  function arm(T) {
    clearTimeout(T.timer);
    if (!['bidding', 'playing', 'trump'].includes(T.phase)) return;
    const s = T.seats[T.turn];
    const ms = s.bot ? BOT_MS : online(T.id, s.pid) ? TURN_MS : AWAY_MS;
    T.deadline = Date.now() + ms;
    T.timer = setTimeout(() => autoMove(T), ms);
  }
  function autoMove(T) {
    const s = T.seats[T.turn];
    if (T.phase === 'trump') return doTrump(T, T.turn, botTrump(s));
    if (T.phase === 'bidding') return doBid(T, T.turn, botBid(T, s));
    if (T.phase === 'playing') return doPlay(T, T.turn, botPlay(T, s).id);
  }

  /* ---------- moves ---------- */
  function doTrump(T, i, suit) {
    if (T.phase !== 'trump' || T.turn !== i || !SUITS.includes(suit)) return 'Not now.';
    T.trump = suit; T.log.push(`${T.seats[i].name} picked ${suit} as trump`);
    T.phase = 'bidding'; T.turn = (T.dealer + 1) % T.n;
    arm(T); push(T); return null;
  }
  function doBid(T, i, bid) {
    if (T.phase !== 'bidding' || T.turn !== i) return 'It’s not your turn to bid.';
    bid = Math.round(Number(bid));
    if (!(bid >= 0 && bid <= T.round)) return `Bid 0 to ${T.round}.`;
    T.seats[i].bid = bid;
    T.turn = (T.turn + 1) % T.n;
    if (T.seats.every(s => s.bid !== null)) { T.phase = 'playing'; T.turn = T.leader; T.trick = []; }
    arm(T); push(T); return null;
  }
  function doPlay(T, i, cardId) {
    if (T.phase !== 'playing' || T.turn !== i) return 'It’s not your turn.';
    const s = T.seats[i];
    if (!legal(s.hand, T.trick).includes(cardId)) return s.hand.some(c => c.id === cardId) ? 'You have to follow the lead colour (or play a Wizard or Jester).' : 'That card isn’t in your hand.';
    const card = s.hand.splice(s.hand.findIndex(c => c.id === cardId), 1)[0];
    T.trick.push({ seat: i, card });
    if (T.trick.length < T.n) { T.turn = (T.turn + 1) % T.n; arm(T); push(T); return null; }
    // the trick is complete
    const w = winner(T.trick, T.trump);
    T.seats[w].tricks++;
    T.lastTrick = { cards: T.trick, winner: w };
    T.phase = 'trick'; clearTimeout(T.timer); push(T);
    T.timer = setTimeout(() => {
      T.trick = []; T.leader = w; T.turn = w;
      if (T.seats[0].hand.length) { T.phase = 'playing'; arm(T); push(T); }
      else endRound(T);
    }, TRICK_PAUSE);
    return null;
  }
  function endRound(T) {
    const row = T.seats.map(s => { const d = s.tricks === s.bid ? 20 + 10 * s.tricks : -10 * Math.abs(s.tricks - s.bid); s.score += d; return { bid: s.bid, tricks: s.tricks, delta: d, total: s.score }; });
    T.scores.push({ round: T.round, trump: T.trump, rows: row });
    if (T.round >= T.rounds) return endGame(T);
    T.phase = 'scored'; push(T);
    T.timer = setTimeout(() => newRound(T), ROUND_PAUSE);
  }
  function endGame(T) {
    T.phase = 'over'; clearTimeout(T.timer);
    const best = Math.max(...T.seats.map(s => s.score));
    T.winners = T.seats.map((s, i) => (s.score === best ? i : -1)).filter(i => i >= 0);
    for (const i of T.winners) { const s = T.seats[i]; if (!s.bot && onWin) onWin(s.pid, s.score); }
    push(T); pushList();
  }

  /* ---------- what each player may see ---------- */
  function view(T, pid) {
    const me = seatOf(T, pid);
    return {
      id: T.id, name: T.name, phase: T.phase, round: T.round, rounds: T.rounds, max: T.max, host: T.host === pid, now: Date.now(), deadline: T.deadline || 0,
      dealer: T.dealer, turn: T.turn, leader: T.leader, trump: T.trump === undefined ? 'choosing' : T.trump, flip: T.flip || null,
      trick: T.trick, lastTrick: T.phase === 'trick' ? T.lastTrick : null,
      seats: T.seats.map((s, i) => (s ? { name: s.name, bot: !!s.bot, me: s.pid === pid, online: s.bot || online(T.id, s.pid), score: s.score || 0, bid: s.bid ?? null, tricks: s.tricks || 0, cards: s.hand ? s.hand.length : 0 } : null)),
      me, hand: me >= 0 && T.seats[me].hand ? T.seats[me].hand : [],
      legal: me >= 0 && T.phase === 'playing' && T.turn === me ? legal(T.seats[me].hand, T.trick) : [],
      // after the last bid, the sum of bids versus cards dealt says whether the round is "over" or "under" bid
      bids: T.seats.filter(Boolean).reduce((a, s) => a + (s.bid || 0), 0),
      scores: T.scores, winners: T.winners || [],
    };
  }

  /* ---------- http ---------- */
  function stream(req, res, url, ip) {
    const tid = url.searchParams.get('table') || 'lobby', pid = url.searchParams.get('id') || '', token = url.searchParams.get('token') || '';
    const who = auth(pid, token, ip);
    if (who.error) { res.writeHead(who.code || 403); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const c = { res, tid, pid }; conns.add(c);
    if (tid === 'lobby') res.write(`event: tables\ndata: ${JSON.stringify(list())}\n\n`);
    else { const T = tables.get(tid); if (T) { res.write(`event: state\ndata: ${JSON.stringify(view(T, pid))}\n\n`); push(T); } else res.write('event: gone\ndata: {}\n\n'); }
    req.on('close', () => { conns.delete(c); const T = tables.get(tid); if (T) { push(T); if (['bidding', 'playing', 'trump'].includes(T.phase) && T.seats[T.turn] && T.seats[T.turn].pid === pid) arm(T); } });
  }
  function action(body, ip) {
    const pid = String(body.id || ''), token = String(body.token || '');
    const who = auth(pid, token, ip);
    if (who.error) return { code: who.code || 403, body: { error: who.error } };
    if (isClosed()) return { code: 503, body: { error: 'The casino is closed for a moment.' } };
    const name = nameOf(pid, body.name), act = String(body.action || '');
    if (act === 'list') return { code: 200, body: { tables: list() } };
    if (act === 'create') {
      for (const T of tables.values()) if (!T.closed && T.phase === 'waiting' && seatOf(T, pid) >= 0) return { code: 409, body: { error: 'You already have a table waiting.', table: T.id } };
      const T = create(pid, name, body);
      return { code: 200, body: { ok: true, table: T.id } };
    }
    const T = tables.get(String(body.table || ''));
    if (!T || T.closed) return { code: 404, body: { error: 'That table is gone.' } };
    const i = seatOf(T, pid);
    const done = err => (err ? { code: 409, body: { error: err } } : { code: 200, body: { ok: true } });
    switch (act) {
      case 'join': {
        if (i >= 0) return done(null);
        if (T.phase !== 'waiting') return done('This game has already started. Watch, or open a new table.');
        const free = T.seats.findIndex(s => !s); if (free < 0) return done('The table is full.');
        T.seats[free] = { pid, name, bot: false, score: 0 }; push(T); pushList(); return done(null);
      }
      case 'leave': {
        if (i < 0) return done(null);
        if (T.phase === 'waiting') {
          T.seats[i] = null;
          if (!T.seats.some(s => s && !s.bot)) { T.closed = true; tables.delete(T.id); }
          else if (T.host === pid) T.host = T.seats.find(s => s && !s.bot).pid;
        } else if (T.phase === 'over') { /* nothing to do */ }
        else { T.seats[i].bot = true; T.seats[i].name += ' (bot)'; if (T.turn === i) arm(T); if (!T.seats.some(s => !s.bot)) { clearTimeout(T.timer); T.closed = true; tables.delete(T.id); } }
        if (!T.closed) push(T); pushList(); return done(null);
      }
      case 'addbot': {
        if (T.host !== pid || T.phase !== 'waiting') return done('Only the host can add bots before the game starts.');
        const free = T.seats.findIndex(s => !s); if (free < 0) return done('The table is full.');
        const used = new Set(T.seats.filter(Boolean).map(s => s.name));
        const nm = BOT_NAMES.find(n => !used.has(n + ' 🤖')) || 'Bot';
        T.seats[free] = { pid: 'bot-' + rnd(1e9), name: nm + ' 🤖', bot: true, score: 0 }; push(T); pushList(); return done(null);
      }
      case 'kick': {
        const k = Math.round(Number(body.seat));
        if (T.host !== pid || T.phase !== 'waiting' || !T.seats[k] || T.seats[k].pid === pid) return done('Not possible.');
        T.seats[k] = null; push(T); pushList(); return done(null);
      }
      case 'start': {
        if (T.host !== pid) return done('Only the host can start.');
        if (T.phase !== 'waiting' && T.phase !== 'over') return done('Already playing.');
        if (filled(T).length < 3) return done('Wizard needs at least 3 players. Add a bot or wait for friends.');
        start(T); pushList(); return done(null);
      }
      case 'trump': return done(i < 0 ? 'You are not at this table.' : doTrump(T, i, String(body.suit)));
      case 'bid': return done(i < 0 ? 'You are not at this table.' : doBid(T, i, body.bid));
      case 'play': return done(i < 0 ? 'You are not at this table.' : doPlay(T, i, String(body.card)));
      default: return { code: 400, body: { error: 'Unknown move.' } };
    }
  }
  // tidy up old tables
  setInterval(() => {
    for (const T of tables.values()) {
      // a table closes once none of its human players has been around for 5 minutes (bots don't play on alone)
      const people = T.seats.some(s => s && !s.bot && online(T.id, s.pid));
      if (people) T.seen = Date.now();
      else if (Date.now() - (T.seen || T.created) > 5 * 60000) { T.closed = true; clearTimeout(T.timer); tables.delete(T.id); pushList(); }
    }
  }, 60000).unref();
  return { stream, action, list, _test: { tables, winner, legal, leadSuit, deck, view } };
};
