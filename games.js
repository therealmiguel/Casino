// The solo games, played on the server: slots, roulette, blackjack and craps.
// The pages send what the player wants to do; the server checks it, takes the bet, decides the result and pays.
'use strict';
const crypto = require('crypto');
const SlotEngine = require('./slot_engine');
const RR = require('./roulette_rules');
const CRAPS = require('./craps_rules');
const BJ = require('./bj_solo');
const createGames2 = require('./games2');

// fast, strong randomness: crypto bytes in a pool
let pool = Buffer.alloc(0), at = 0;
function u32() { if (at + 4 > pool.length) { pool = crypto.randomBytes(8192); at = 0; } const v = pool.readUInt32LE(at); at += 4; return v; }
const rng = () => u32() / 4294967296;                       // 0 <= x < 1
const rnd = n => crypto.randomInt(n);                         // whole number 0..n-1 (unbiased)

const SLOT_BETS = [20, 40, 60, 100, 200, 400, 600, 1000, 2000, 5000, 10000];
const VIP_SLOT_BETS = [20000, 50000];

module.exports = function createGames(A, { flag, isClosed, P, L }) {
  const luck = L || { pick: (id, g) => g(), steer: () => 0, bias: () => null };
  const vip = id => !!(P && P.vipOf(A.get(id)));
  const wallet = id => ({ bal: () => A.get(id).bal, debit: c => A.debit(id, c, 'blackjack', 'Blackjack bet'), credit: c => A.credit(id, c, 'blackjack', 'Blackjack payout') });
  const bad = (id, what, msg, code = 400) => { flag(id, 'invalid', what); return { code, body: { error: msg } }; };
  const ok = (id, body, game) => ({ code: 200, body: Object.assign(body, { cents: A.balOf(id, game), mode: A.inTour(A.get(id), game) ? 'tour' : 'main' }) });

  /* ---------- slots ---------- */
  function slots(id, b) {
    const rec = A.get(id);
    const freeSpin = !!b.free && rec.free && rec.free.n > 0 && !A.inTour(rec, 'slots');
    const bet = freeSpin ? rec.free.bet : Math.round(Number(b.bet));
    if (!SLOT_BETS.includes(bet) && !(VIP_SLOT_BETS.includes(bet) && vip(id)) && !freeSpin) return bad(id, `slots bet of ${b.bet}`, 'That bet size is not on this machine.');
    const buy = !!b.buy && !freeSpin;
    const cost = freeSpin ? 0 : buy ? bet * SlotEngine.BUY_PRICE : bet;
    if (freeSpin) { rec.free.n--; A.touch(id); }
    else if (!A.debit(id, cost, 'slots', buy ? 'Dynamite Diggers bonus buy' : 'Dynamite Diggers spin')) return { code: 409, body: { error: 'Not enough in your bankroll.' } };
    const plan = luck.pick(id, () => planSpin(buy), p => Math.round(p.total * bet) - cost);
    const payout = Math.round(plan.total * bet);
    if (payout > 0) A.credit(id, payout, freeSpin ? 'event' : 'slots', freeSpin ? 'Free spin win' : 'Dynamite Diggers win');
    const jackpot = P && !A.inTour(rec, 'slots') && !freeSpin ? P.jackpotSpin(id, cost, 'slots', rng) : 0;
    const tags = [];
    if (plan.hb) { tags.push('hold-blast', 'bonus'); if (plan.hb.full) tags.push('grand'); }
    if (plan.fs) { tags.push('free-spins', 'bonus'); if (plan.fs.some(f => f.hb)) tags.push('hold-blast'); }
    if (plan.fs && plan.fs.some(f => f.hb && f.hb.full)) tags.push('grand');
    A.round(id, 'slots', { staked: cost, paid: payout, spins: 1, mult: 0, tags });
    return ok(id, { plan, payout, cost, jackpot, pool: P ? Math.round(P.jackpot().pool) : 0, free: rec.free && rec.free.n > 0 ? rec.free : null }, 'slots');
  }
  function planSpin(buy) {
    const E = SlotEngine;
    if (buy) { const g = E.boughtGrid(rng); const hb = E.holdBlast(rng, g); return { buy: true, grid: g, hb, total: hb.total }; }
    const s = E.spin(rng, false);
    let total = s.total;
    const hb = s.holdBlast ? E.holdBlast(rng, s.grid) : null;
    if (hb) total += hb.total;
    let fs = null;
    if (s.freeSpins) {
      fs = []; let left = E.FS_AWARD;
      while (left > 0 && fs.length < 200) {
        left--;
        const f = E.spin(rng, true);
        const fhb = f.holdBlast ? E.holdBlast(rng, f.grid) : null;
        total += f.total + (fhb ? fhb.total : 0);
        if (f.freeSpins) left += E.FS_AWARD;
        fs.push({ s: f, hb: fhb });
      }
    }
    return { s, hb, fs, total };
  }

  /* ---------- roulette (solo wheel) ---------- */
  function roulette(id, b) {
    const lightning = b.mode !== 'classic';
    const raw = b.bets && typeof b.bets === 'object' ? b.bets : {};
    const bets = {}; let staked = 0, n = 0;
    for (const [k, v] of Object.entries(raw)) {
      const amt = Number(v);
      if (!RR.SPOTS.has(k)) return bad(id, `roulette spot ${String(k).slice(0, 40)}`, 'That bet is not on the layout.');
      const spotMax = vip(id) ? 5000 : 1000;
      if (!Number.isInteger(amt) || amt < 1 || amt > spotMax) return bad(id, `roulette amount ${String(v).slice(0, 20)}`, `Each spot takes $1 to $${spotMax.toLocaleString('en-US')}.`);
      if (++n > 157) return bad(id, 'too many roulette spots', 'Too many bets.');
      bets[k] = amt * 100; staked += amt * 100;
    }
    if (!staked) return { code: 400, body: { error: 'Place a bet first.' } };
    if (!A.debit(id, staked, 'roulette', 'Voltage Roulette bets')) return { code: 409, body: { error: 'Not enough in your bankroll.' } };
    const spin = luck.pick(id, () => { const strikes = lightning ? RR.genStrikes(rnd) : [], num = rnd(37); return Object.assign({ strikes, num }, RR.payout(bets, num, strikes, lightning)); }, o => o.total - staked);
    const { strikes, num, total, mult } = spin;
    if (total > 0) A.credit(id, total, 'roulette', `Voltage Roulette: ${num}`);
    const tags = [];
    if (mult) tags.push('lightning'); if (mult === 500) tags.push('lightning-500');
    A.round(id, 'roulette', { staked, paid: total, spins: 1, mult, tags });
    return ok(id, { n: num, strikes, win: total / 100 }, 'roulette');
  }

  /* ---------- blackjack (solo table) ---------- */
  const BJ_ACTIONS = new Set(['deal', 'insurance', 'hit', 'stand', 'double', 'split', 'surrender']);
  const bjLimits = id => (vip(id) ? { max: 500000, sideMax: 50000 } : { max: BJ.MAX, sideMax: BJ.SIDE_MAX });
  function sessionOf(id) {
    const rec = A.get(id);
    if (!rec.games.bj) rec.games.bj = BJ.createSession();
    if (!Array.isArray(rec.games.bj.shoe)) rec.games.bj.shoe = [];
    return rec.games.bj;
  }
  function blackjack(id, b) {
    const action = String(b.action || '');
    const S = sessionOf(id);
    if (action === 'state') {
      // an unfinished hand from before (page closed) is stood and paid now
      const before = A.get(id).bal;
      S.bias = luck.bias(id);
      const v = BJ.finishAbandoned(S, wallet(id), rnd);
      delete S.bias;
      if (v) roundDone(id, S);
      return ok(id, { finished: v ? { paid: S.round.paid, net: S.round.paid - S.round.staked } : null, shoeLeft: S.shoe.length, shoeSize: S.shoeSize, shuffleDue: S.shuffleDue, decks: S.decks, before, limits: bjLimits(id) }, 'blackjack');
    }
    if (!BJ_ACTIONS.has(action)) return bad(id, `blackjack action ${action.slice(0, 20)}`, 'Unknown move.');
    S.bias = luck.bias(id);
    const r = BJ.play(S, action, b, wallet(id), rnd, bjLimits(id));
    delete S.bias;
    A.touch(id);
    if (r.error) return { code: 409, body: { error: r.error } };
    if (r.phase === 'done') roundDone(id, S);
    return ok(id, r, 'blackjack');
  }
  function roundDone(id, S) {
    const R = S.round;
    if (R.counted) return;
    R.counted = true;
    const tags = [];
    if (R.hands.some(h => h.result && h.result.label === 'Blackjack')) tags.push('natural');
    if (R.hands.length > 1 && R.hands.some(h => h.result && h.result.delta > 0)) tags.push('split-win');
    if (R.insurance && R.dealer.length === 2 && BJ.total(R.dealer).total === 21) tags.push('insured');
    A.round(id, 'blackjack', { staked: R.staked, paid: R.paid, hands: R.hands.length, blackjacks: R.hands.filter(h => h.result && h.result.label === 'Blackjack').length, tags });
  }

  /* ---------- craps ---------- */
  const PT = CRAPS.PT;
  const FLAT_KEYS = new Set(['pass', 'dp', 'come', 'dc', 'field', 'big6', 'big8', 'any7', 'anyCraps', 'p2', 'p3', 'p11', 'p12', 'horn', 'ce',
    ...[4, 6, 8, 10].map(n => 'hard' + n), ...PT.flatMap(n => ['place' + n, 'buy' + n, 'lay' + n])]);
  const MAXBET = 50000;
  function crapsTable(id) {
    const rec = A.get(id);
    if (!rec.games.craps) rec.games.craps = { bets: {}, point: null };
    return rec.games.craps;
  }
  function cfgOf(b) {
    const c = b.settings || {};
    const odds = c.odds === '345' || c.odds === undefined ? '345' : Number(c.odds);
    if (!(odds === '345' || odds === 10 || odds === 100)) return null;
    const field12 = Number(c.field12 || 3);
    if (field12 !== 2 && field12 !== 3) return null;
    return { odds, field12, working: !!c.working, comeOddsOn: !!c.comeOddsOn };
  }
  // check a new layout against what is on the table now; returns an error message or null
  function checkLayout(old, point, next, cfg, maxBet = MAXBET) {
    const val = k => next[k] || 0, was = k => old[k] || 0;
    for (const [k, v] of Object.entries(next)) {
      if (!Number.isInteger(v) || v < 0) return `bad amount on ${k}`;
      if (v === 0) continue;
      let m;
      if (FLAT_KEYS.has(k)) { if (v > maxBet && v > was(k)) return `Each bet takes up to ${A.usd(maxBet)}.`; continue; }
      if (k === 'passOdds' || k === 'dpOdds') continue;
      if ((m = k.match(/^(come|dc)(\d+)(o?)$/)) && PT.includes(+m[2])) continue;
      return `unknown bet ${k.slice(0, 30)}`;
    }
    const on = point !== null;
    // line bets: only on the come-out; pass can't come down once a point is set, don't pass can
    if (on) {
      if (val('pass') !== was('pass')) return 'The pass line is a contract bet once the point is set.';
      if (val('dp') > was('dp')) return 'Don’t pass goes down on the come-out roll only.';
    } else {
      // a come bet can still be sitting in the come box after the point is decided; it can come down, not go up
      for (const k of ['come', 'dc', 'passOdds', 'dpOdds']) if (val(k) > was(k)) return k === 'come' || k === 'dc' ? 'Come bets open once a point is set.' : 'Odds need a point.';
    }
    if (on) {
      if (val('passOdds') > (val('pass') ? CRAPS.oddsMax(val('pass'), point, cfg.odds) : 0) && val('passOdds') > was('passOdds')) return 'Pass odds over the table limit.';
      if (val('dpOdds') > (val('dp') ? CRAPS.layMax(val('dp'), point, cfg.odds) : 0) && val('dpOdds') > was('dpOdds')) return 'Lay odds over the table limit.';
    }
    for (const n of PT) {
      // a come bet on a number is a contract bet; a don't come bet on a number can come down
      if (val('come' + n) !== was('come' + n)) return 'Come bets on a number have to stay.';
      if (val('dc' + n) > was('dc' + n)) return 'Don’t come bets travel from the bar only.';
      const co = val('come' + n + 'o'), dO = val('dc' + n + 'o');
      if (co > (val('come' + n) ? CRAPS.oddsMax(val('come' + n), n, cfg.odds) : 0) && co > was('come' + n + 'o')) return 'Come odds over the table limit.';
      if (dO > (val('dc' + n) ? CRAPS.layMax(val('dc' + n), n, cfg.odds) : 0) && dO > was('dc' + n + 'o')) return 'Lay odds over the table limit.';
    }
    return null;
  }
  function craps(id, b) {
    const T = crapsTable(id);
    const action = String(b.action || '');
    if (action === 'state') return ok(id, { bets: T.bets, point: T.point, maxBet: vip(id) ? 250000 : MAXBET }, 'craps');
    if (action !== 'sync' && action !== 'roll') return bad(id, `craps action ${action.slice(0, 20)}`, 'Unknown move.');
    const cfg = cfgOf(b);
    if (!cfg) return bad(id, 'craps settings', 'Those table settings are not offered.');
    const raw = b.bets && typeof b.bets === 'object' ? b.bets : {};
    const next = {};
    for (const [k, v] of Object.entries(raw)) { const n = Number(v); if (n) next[k] = n; }
    if (Object.keys(next).length > 80) return bad(id, 'too many craps bets', 'Too many bets.');
    const why = checkLayout(T.bets, T.point, next, cfg, vip(id) ? 250000 : MAXBET);
    if (why) {
      if (/^(bad amount|unknown bet)/.test(why)) return bad(id, `craps: ${why}`, 'That bet is not on the layout.');
      return { code: 409, body: { error: why, bets: T.bets, point: T.point, cents: A.get(id).bal } };
    }
    const sum = o => Object.values(o).reduce((a, v) => a + v, 0);
    const delta = sum(next) - sum(T.bets);
    if (delta > 0 && !A.debit(id, delta, 'craps', 'Craps bets')) return { code: 409, body: { error: 'Not enough in your bankroll.', bets: T.bets, point: T.point, cents: A.get(id).bal } };
    if (delta < 0) A.refund(id, -delta, 'craps', 'Bets taken down');
    T.bets = next;
    if (action === 'sync') { A.touch(id); return ok(id, { bets: T.bets, point: T.point }, 'craps'); }
    if (!sum(T.bets)) return { code: 400, body: { error: 'Place a bet to roll.' } };
    const before = sum(T.bets);
    const rules = { working: cfg.working, comeOddsOn: cfg.comeOddsOn, field12: cfg.field12 };
    const roll = luck.pick(id, () => { const a = rnd(6) + 1, b = rnd(6) + 1; return { a, b, r: CRAPS.resolve(JSON.parse(JSON.stringify(T.bets)), T.point, a, b, rules) }; },
      o => o.r.ev.filter(e => e.type === 'win').reduce((x, e) => x + e.amt, 0) - o.r.ev.filter(e => e.type === 'lose').reduce((x, e) => x + e.amt, 0));
    const d1 = roll.a, d2 = roll.b, r = roll.r;
    T.bets = r.bets; T.point = r.point;
    if (r.bank > 0) A.credit(id, r.bank, 'craps', `Craps roll ${d1 + d2}`);
    const won = r.ev.filter(e => e.type === 'win').reduce((a, e) => a + e.amt, 0);
    const lost = r.ev.filter(e => e.type === 'lose').reduce((a, e) => a + e.amt, 0);
    // for the leaderboard, a roll's result is what it won minus what it lost
    const tags = [];
    if (r.outcome === 'made') { tags.push('point-made'); T.made = (T.made || 0) + 1; if (T.made >= 3) tags.push('hot-shooter'); }
    if (r.outcome === 'sevenout') T.made = 0;
    A.round(id, 'craps', { staked: lost, paid: won, rolls: 1, points: r.outcome === 'made' ? 1 : 0, tags });
    return ok(id, { dice: [d1, d2], bets: T.bets, point: T.point, bank: r.bank, outcome: r.outcome, before }, 'craps');
  }

  const G2 = createGames2(A, { flag, P, rng, rnd, vip, ok, bad, SLOT_BETS, VIP_SLOT_BETS, luck });
  function handle(game, id, body) {
    if (isClosed()) return { code: 503, body: { error: 'The casino is closed for a moment. Try again soon.' } };
    if (game === 'slots') return slots(id, body);
    if (game === 'roulette') return roulette(id, body);
    if (game === 'blackjack') return blackjack(id, body);
    if (game === 'craps') return craps(id, body);
    if (game === 'plinko') return G2.plinko(id, body);
    if (game === 'mines') return G2.mines(id, body);
    if (game === 'slots2') return G2.slots2(id, body);
    if (game === 'chicken') return G2.chicken(id, body);
    return { code: 404, body: { error: 'Unknown game.' } };
  }
  return { handle, planSpin, SLOT_BETS, checkLayout, rng, rnd };
};
