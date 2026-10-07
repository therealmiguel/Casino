// Plinko, Mines and Cosmic Cascade, played on the server like every other solo game.
'use strict';
const crypto = require('crypto');
const CE = require('./cascade_engine');
const BE = require('./book_engine');

// Plinko pays, from the edge bucket to the middle one (the board is symmetric)
const PLINKO_HALF = {
  8: { low: [5.5, 2, 1.1, 1, 0.5], med: [12, 3, 1.3, 0.7, 0.4], high: [28, 4, 1.5, 0.3, 0.2] },
  12: { low: [9, 3, 1.6, 1.3, 1.1, 1, 0.5], med: [30, 10, 4, 2, 1.1, 0.6, 0.3], high: [150, 24, 8, 2, 0.7, 0.2, 0.2] },
  16: { low: [15, 9, 2, 1.4, 1.3, 1.2, 1.1, 1, 0.5], med: [100, 40, 10, 5, 3, 1.5, 1, 0.5, 0.25], high: [800, 120, 25, 9, 4, 2, 0.2, 0.2, 0.2] },
};
const PLINKO = {};
for (const rows of [8, 12, 16]) { PLINKO[rows] = {}; for (const risk of ['low', 'med', 'high']) { const h = PLINKO_HALF[rows][risk]; PLINKO[rows][risk] = [...h, ...h.slice(0, -1).reverse()]; } }

const MINES_EDGE = 0.97, MINES_MAX_WIN = 25000000; // a Mines game pays at most $250,000
function minesMult(m, k) { let x = MINES_EDGE; for (let i = 0; i < k; i++) x *= (25 - i) / (25 - m - i); return Math.floor(x * 100) / 100; }

// Cluck Crossing: the chicken crosses lane after lane. The traffic gets heavier the further it goes:
// each lane's chance of a car rises steadily from the first lane to the last, and every multiplier
// pays back 97% of the risk taken to get there.
const ROAD_EDGE = 0.97, ROAD_MAX_WIN = 25000000;
const ROAD = {
  easy: { lanes: 24, first: 1 / 25, top: 24 },
  medium: { lanes: 22, first: 3 / 25, top: 2200 },
  hard: { lanes: 20, first: 5 / 25, top: 50000 },
  hardcore: { lanes: 15, first: 10 / 25, top: 3000000 },
};
for (const R of Object.values(ROAD)) {
  // find the last lane's danger so that crossing every lane pays exactly R.top
  const qs = last => Array.from({ length: R.lanes }, (_, i) => R.first + (last - R.first) * i / (R.lanes - 1));
  const topFor = last => ROAD_EDGE / qs(last).reduce((a, q) => a * (1 - q), 1);
  let lo = R.first, hi = 0.97;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (topFor(mid) < R.top) lo = mid; else hi = mid; }
  R.q = qs((lo + hi) / 2);
  R.mult = [1]; let surv = 1;
  for (const q of R.q) { surv *= 1 - q; R.mult.push(Math.floor(ROAD_EDGE / surv * 100) / 100); }
}
function roadMult(diff, k) { return ROAD[diff].mult[k]; }

module.exports = function createGames2(A, { flag, P, rng, rnd, vip, ok, bad, SLOT_BETS, VIP_SLOT_BETS, luck }) {
  luck = luck || { pick: (id, g) => g(), steer: () => 0 };
  const betOk = (id, c, max) => Number.isInteger(c) && c >= 10 && c <= (vip(id) ? max * 5 : max);

  /* ---------- Plinko ---------- */
  function plinko(id, b) {
    const rows = Number(b.rows), risk = String(b.risk || ''), bet = Math.round(Number(b.bet));
    if (!PLINKO[rows] || !PLINKO[rows][risk]) return bad(id, `plinko board ${String(b.rows).slice(0, 8)}/${risk.slice(0, 8)}`, 'Pick 8, 12 or 16 rows and a risk.');
    if (!betOk(id, bet, 10000)) return bad(id, `plinko bet ${String(b.bet).slice(0, 20)}`, `Each ball takes $0.10 to $${vip(id) ? '500' : '100'}.`);
    if (!A.debit(id, bet, 'plinko', 'Plinko ball')) return { code: 409, body: { error: 'Not enough in your bankroll.' } };
    const drop = luck.pick(id, () => { const path = []; let k = 0; for (let i = 0; i < rows; i++) { const r = rnd(2); path.push(r); k += r; } return { path, k }; }, o => Math.round(bet * PLINKO[rows][risk][o.k]) - bet);
    const path = drop.path, k = drop.k;
    const mult = PLINKO[rows][risk][k];
    const paid = Math.round(bet * mult);
    if (paid > 0) A.credit(id, paid, 'plinko', `Plinko ${mult}×`);
    const tags = (k === 0 || k === rows) ? ['plinko-edge'] : [];
    A.round(id, 'plinko', { staked: bet, paid, spins: 1, mult: mult >= 10 ? Math.round(mult) : 0, tags });
    return ok(id, { path, bucket: k, mult, paid }, 'plinko');
  }

  /* ---------- Mines ---------- */
  const minesOf = id => { const r = A.get(id); return r.games.mines || null; };
  const minesView = (G, reveal) => ({ live: !!G.live, bet: G.bet, m: G.m, open: G.open, mult: minesMult(G.m, G.open.length), next: G.open.length < 25 - G.m ? minesMult(G.m, G.open.length + 1) : null, mines: reveal ? G.mines : undefined, boom: G.boom, paid: G.paid || 0 });
  function minesEnd(id, G, paid) {
    G.live = false; G.paid = paid;
    if (paid > 0) A.credit(id, paid, 'mines', `Mines cash-out ${minesMult(G.m, G.open.length)}×`);
    const tags = []; if (G.open.length >= 5) tags.push('mines-5'); if (G.open.length >= 10) tags.push('mines-10');
    A.round(id, 'mines', { staked: G.bet, paid, spins: 1, tags });
  }
  function mines(id, b) {
    const rec = A.get(id), act = String(b.action || '');
    let G = minesOf(id);
    if (act === 'state') return ok(id, G ? minesView(G, !G.live) : { live: false }, 'mines');
    if (act === 'start') {
      if (G && G.live) return { code: 409, body: Object.assign({ error: 'Finish this game first.' }, minesView(G, false)) };
      const m = Math.round(Number(b.mines)), bet = Math.round(Number(b.bet));
      if (!(m >= 1 && m <= 24)) return bad(id, `mines count ${String(b.mines).slice(0, 8)}`, 'Pick 1 to 24 mines.');
      if (!betOk(id, bet, 10000)) return bad(id, `mines bet ${String(b.bet).slice(0, 20)}`, `Bets go from $0.10 to $${vip(id) ? '500' : '100'}.`);
      if (!A.debit(id, bet, 'mines', 'Mines bet')) return { code: 409, body: { error: 'Not enough in your bankroll.' } };
      const cells = Array.from({ length: 25 }, (_, i) => i);
      for (let i = 24; i > 0; i--) { const j = rnd(i + 1); [cells[i], cells[j]] = [cells[j], cells[i]]; }
      G = rec.games.mines = { live: true, bet, m, mines: cells.slice(0, m).sort((x, y) => x - y), open: [], t: Date.now(), tour: A.inTour(rec, 'mines') };
      A.touch(id);
      return ok(id, minesView(G, false), 'mines');
    }
    if (!G || !G.live) return { code: 409, body: { error: 'Start a game first.', live: false } };
    if (act === 'pick') {
      const i = Math.round(Number(b.i));
      if (!(i >= 0 && i < 25)) return bad(id, `mines tile ${String(b.i).slice(0, 8)}`, 'That tile is not on the board.');
      if (G.open.includes(i)) return ok(id, minesView(G, false), 'mines');
      // luck: quietly move a mine away from (or onto) the chosen tile
      const st = luck.steer(id);
      if (st > 0 && G.mines.includes(i)) { const free = [...Array(25).keys()].filter(t => t !== i && !G.open.includes(t) && !G.mines.includes(t)); if (free.length) { G.mines = G.mines.filter(t => t !== i).concat(free[rnd(free.length)]).sort((x, y) => x - y); } }
      else if (st < 0 && !G.mines.includes(i)) { const j = G.mines[rnd(G.mines.length)]; G.mines = G.mines.filter(t => t !== j).concat(i).sort((x, y) => x - y); }
      if (G.mines.includes(i)) { G.boom = i; minesEnd(id, G, 0); A.touch(id); return ok(id, Object.assign(minesView(G, true), { hit: true }), 'mines'); }
      G.open.push(i); A.touch(id);
      const win = Math.round(G.bet * minesMult(G.m, G.open.length));
      if (G.open.length === 25 - G.m || win >= MINES_MAX_WIN) { minesEnd(id, G, Math.min(win, MINES_MAX_WIN)); return ok(id, Object.assign(minesView(G, true), { auto: true }), 'mines'); }
      return ok(id, minesView(G, false), 'mines');
    }
    if (act === 'cash') {
      if (!G.open.length) return { code: 409, body: { error: 'Open at least one tile first.' } };
      minesEnd(id, G, Math.min(MINES_MAX_WIN, Math.round(G.bet * minesMult(G.m, G.open.length))));
      return ok(id, minesView(G, true), 'mines');
    }
    return bad(id, `mines action ${act.slice(0, 20)}`, 'Unknown move.');
  }

  /* ---------- Cosmic Cascade ---------- */
  function slots2(id, b) {
    const rec = A.get(id);
    const bet = Math.round(Number(b.bet));
    if (!SLOT_BETS.includes(bet) && !(VIP_SLOT_BETS.includes(bet) && vip(id))) return bad(id, `cascade bet ${String(b.bet).slice(0, 20)}`, 'That bet size is not on this machine.');
    const buy = !!b.buy;
    const cost = buy ? bet * CE.BUY_PRICE : bet;
    if (!A.debit(id, cost, 'slots2', buy ? 'Cosmic Cascade bonus buy' : 'Cosmic Cascade spin')) return { code: 409, body: { error: 'Not enough in your bankroll.' } };
    const plan = luck.pick(id, () => CE.play(rng, buy), p => Math.round(p.total * bet) - cost);
    const payout = Math.round(plan.total * bet);
    if (payout > 0) A.credit(id, payout, 'slots2', 'Cosmic Cascade win');
    const jackpot = P && !A.inTour(rec, 'slots2') ? P.jackpotSpin(id, cost, 'slots2', rng) : 0;
    const tags = [];
    const maxCasc = Math.max(plan.base ? plan.base.cascades : 0, ...(plan.bonus && plan.bonus.fs ? plan.bonus.fs.list.map(f => f.s.cascades) : [0]));
    if (maxCasc >= 5) tags.push('cascade-5');
    if (plan.bonus) { tags.push('wheel', 'bonus'); if (plan.bonus.fs) tags.push('free-spins'); }
    A.round(id, 'slots2', { staked: cost, paid: payout, spins: 1, mult: Math.round(plan.total), tags });
    return ok(id, { plan, payout, cost, jackpot, pool: P ? Math.round(P.jackpot().pool) : 0 }, 'slots2');
  }

  /* ---------- Cluck Crossing ---------- */
  const roadView = (G) => ({ table: ROAD[G.diff].mult, live: !!G.live, bet: G.bet, diff: G.diff, step: G.step, lanes: ROAD[G.diff].lanes, mult: roadMult(G.diff, G.step), next: G.step < ROAD[G.diff].lanes ? roadMult(G.diff, G.step + 1) : null, dead: G.dead || false, paid: G.paid || 0 });
  function roadEnd(id, G, paid) {
    G.live = false; G.paid = paid;
    if (paid > 0) A.credit(id, paid, 'chicken', `Cluck Crossing cash-out ${roadMult(G.diff, G.step)}×`);
    const tags = []; const m = roadMult(G.diff, G.step);
    if (paid > 0 && m >= 10) tags.push('road-10');
    if (paid > 0 && G.step >= ROAD[G.diff].lanes) tags.push('crossed');
    A.round(id, 'chicken', { staked: G.bet, paid, spins: 1, mult: paid > 0 && m >= 10 ? Math.floor(m) : 0, tags });
  }
  function chicken(id, b) {
    const rec = A.get(id), act = String(b.action || '');
    let G = rec.games.chick || null;
    if (act === 'state') return ok(id, Object.assign(G ? roadView(G) : { live: false }, { tables: Object.fromEntries(Object.entries(ROAD).map(([k, R]) => [k, R.mult])), chance: Object.fromEntries(Object.entries(ROAD).map(([k, R]) => [k, R.q.map(q => Math.round(q * 1000) / 10)])) }), 'chicken');
    if (act === 'start') {
      if (G && G.live) return { code: 409, body: Object.assign({ error: 'Finish this crossing first.' }, roadView(G)) };
      const diff = String(b.diff || ''), bet = Math.round(Number(b.bet));
      if (!ROAD[diff]) return bad(id, `road difficulty ${diff.slice(0, 12)}`, 'Pick a difficulty.');
      if (!betOk(id, bet, 10000)) return bad(id, `road bet ${String(b.bet).slice(0, 20)}`, `Bets go from $0.10 to $${vip(id) ? '500' : '100'}.`);
      if (!A.debit(id, bet, 'chicken', 'Cluck Crossing bet')) return { code: 409, body: { error: 'Not enough in your bankroll.' } };
      G = rec.games.chick = { live: true, bet, diff, step: 0, t: Date.now() };
      A.touch(id);
      return ok(id, roadView(G), 'chicken');
    }
    if (!G || !G.live) return { code: 409, body: { error: 'Start a crossing first.', live: false } };
    if (act === 'go') {
      // the server decides each lane at the moment the chicken steps into it
      let hit = rnd(1000000) < ROAD[G.diff].q[G.step] * 1000000;
      const st = luck.steer(id);
      if (st > 0) hit = false; else if (st < 0) hit = true;
      if (hit) { G.dead = true; G.step++; roadEnd(id, G, 0); A.touch(id); return ok(id, Object.assign(roadView(G), { hit: true }), 'chicken'); }
      G.step++; A.touch(id);
      const win = Math.round(G.bet * roadMult(G.diff, G.step));
      if (G.step >= ROAD[G.diff].lanes || win >= ROAD_MAX_WIN) { roadEnd(id, G, Math.min(win, ROAD_MAX_WIN)); return ok(id, Object.assign(roadView(G), { auto: true }), 'chicken'); }
      return ok(id, roadView(G), 'chicken');
    }
    if (act === 'cash') {
      if (!G.step) return { code: 409, body: { error: 'Cross at least one lane first.' } };
      roadEnd(id, G, Math.min(ROAD_MAX_WIN, Math.round(G.bet * roadMult(G.diff, G.step))));
      return ok(id, roadView(G), 'chicken');
    }
    return bad(id, `road action ${act.slice(0, 20)}`, 'Unknown move.');
  }

  /* ---------- Tomb of Amun-Ra (book slot) ---------- */
  function book(id, b) {
    const rec = A.get(id), act = String(b.action || 'spin');
    rec.games.book = rec.games.book || {};
    const T = rec.games.book;
    // the gamble: put the last win on red or black; a correct guess doubles it, up to 5 times in a row
    if (act === 'gamble') {
      const pick = String(b.pick || '');
      if (!['red', 'black'].includes(pick)) return bad(id, `book gamble ${pick.slice(0, 10)}`, 'Pick red or black.');
      if (!(T.last > 0) || T.steps >= 5) return { code: 409, body: { error: 'Nothing to gamble.' } };
      if (T.last * 2 > 5000000) return { code: 409, body: { error: 'That win is too big to gamble.' } };
      const stake = T.last;
      if (!A.debit(id, stake, 'book', 'Tomb of Amun-Ra gamble')) return { code: 409, body: { error: 'Nothing to gamble.' } };
      const card = { s: ['♥', '♦', '♠', '♣'][rnd(4)], r: ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'][rnd(13)] };
      const red = card.s === '♥' || card.s === '♦';
      let won = (pick === 'red') === red;
      // secret luck from the admin room works here too
      const st = luck.steer(id);
      if (st > 0 && !won) { won = true; card.s = pick === 'red' ? '♥' : '♠'; } else if (st < 0 && won) { won = false; card.s = pick === 'red' ? '♠' : '♥'; }
      T.steps = (T.steps || 0) + 1;
      if (won) { A.credit(id, stake * 2, 'book', 'Tomb of Amun-Ra gamble won'); T.last = stake * 2; }
      else T.last = 0;
      A.round(id, 'book', { staked: stake, paid: won ? stake * 2 : 0, spins: 0, tags: [] });
      A.touch(id);
      return ok(id, { card, won, last: T.last, steps: T.steps }, 'book');
    }
    if (act === 'collect') { T.last = 0; T.steps = 0; A.touch(id); return ok(id, { last: 0 }, 'book'); }
    const bet = Math.round(Number(b.bet));
    if (!SLOT_BETS.includes(bet) && !(VIP_SLOT_BETS.includes(bet) && vip(id))) return bad(id, `book bet ${String(b.bet).slice(0, 20)}`, 'That bet size is not on this machine.');
    if (!A.debit(id, bet, 'book', 'Tomb of Amun-Ra spin')) return { code: 409, body: { error: 'Not enough in your bankroll.' } };
    const plan = luck.pick(id, () => BE.play(rng), p => Math.round(p.total * bet) - bet);
    const payout = Math.round(plan.total * bet);
    if (payout > 0) A.credit(id, payout, 'book', 'Tomb of Amun-Ra win');
    const jackpot = P && !A.inTour(rec, 'book') ? P.jackpotSpin(id, bet, 'book', rng) : 0;
    // only plain wins from the base game can be gambled
    T.last = payout > 0 && !plan.fs ? payout : 0; T.steps = 0;
    const tags = []; if (plan.fs) tags.push('free-spins', 'bonus', 'book');
    A.round(id, 'book', { staked: bet, paid: payout, spins: 1, mult: Math.round(plan.total), tags });
    return ok(id, { plan, payout, jackpot, gamble: T.last, pool: P ? Math.round(P.jackpot().pool) : 0 }, 'book');
  }

  return { plinko, mines, slots2, chicken, book, PLINKO, minesMult, ROAD, roadMult };
};
module.exports.PLINKO = PLINKO;
module.exports.minesMult = minesMult;
module.exports.ROAD = ROAD;
module.exports.roadMult = roadMult;
