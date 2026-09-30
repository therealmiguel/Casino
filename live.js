// Miguel's Casino live tables: one shared blackjack table (5 seats) and one shared roulette wheel.
// The server deals, spins and keeps time, so every player sees the same game.
// Money stays in each player's browser: the server says what to charge and what to pay out.
'use strict';
const crypto = require('crypto');
const rnd = n => crypto.randomInt(n);
const F = Number(process.env.LIVE_TIME_SCALE) || 1;   // for automated tests only

module.exports = function createLive({ checkToken, cleanName }) {
  /* ---------------- connections & payouts ---------------- */
  const conns = new Set();                 // { res, game, pid, name }
  const unclaimed = new Map();             // pid -> [{ id, game, payout, staked, net }]
  const lastSeen = new Map();              // pid -> ms
  const online = (game, pid) => { for (const c of conns) if (c.game === game && c.pid === pid) return true; return false; };
  const recentlySeen = (pid, ms) => Date.now() - (lastSeen.get(pid) || 0) < ms;
  function owe(pid, entry) {
    const list = unclaimed.get(pid) || [];
    list.push(entry);
    while (list.length > 60) list.shift();
    unclaimed.set(pid, list);
  }
  const dirty = new Set();
  let flushTimer = null;
  function changed(game) {
    dirty.add(game);
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const games = [...dirty]; dirty.clear();
      for (const c of conns) if (games.includes(c.game)) push(c);
    }, 40);
  }
  function push(c) {
    const view = c.game === 'bj' ? bjView(c.pid) : rlView(c.pid);
    c.res.write(`event: state\ndata: ${JSON.stringify(view)}\n\n`);
  }
  setInterval(() => {
    for (const c of conns) { lastSeen.set(c.pid, Date.now()); c.res.write(': keep-alive\n\n'); }
  }, 15000).unref();

  /* =============== BLACKJACK =============== */
  const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const MIN = 500, MAX = 100000;           // cents
  const TURN_MS = 20000 * F, AWAY_TURN_MS = 5000 * F, BET_MS = 15000 * F, SETTLE_MS = 6000 * F;
  const pts = r => (r === 'A' ? 11 : ['10', 'J', 'Q', 'K'].includes(r) ? 10 : +r);
  const splitVal = r => (r === 'A' ? 1 : Math.min(10, pts(r)));
  function total(cards) {
    let t = 0, aces = 0;
    for (const c of cards) { if (c.r === 'A') { aces++; t += 1; } else t += pts(c.r); }
    const soft = aces > 0 && t + 10 <= 21;
    return { total: soft ? t + 10 : t, soft };
  }
  const BJ = { seats: [null, null, null, null, null], phase: 'waiting', roundId: 0, dealer: [], hole: true, turn: null, deadline: 0, shoe: [], cut: 0, news: '', timer: null };
  function newShoe() {
    const a = [];
    for (let d = 0; d < 6; d++) for (const s of SUITS) for (const r of RANKS) a.push({ r, s });
    for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    BJ.shoe = a;
    BJ.cut = 70 + rnd(30);                  // reshuffle when fewer cards than this remain
  }
  newShoe();
  const draw = () => { if (!BJ.shoe.length) newShoe(); return BJ.shoe.pop(); };
  const bjTimer = (ms, fn) => { clearTimeout(BJ.timer); BJ.timer = setTimeout(fn, ms); };
  const seatOf = pid => BJ.seats.findIndex(s => s && s.pid === pid);

  function startBetting() {
    BJ.phase = 'betting'; BJ.deadline = Date.now() + BET_MS;
    bjTimer(BET_MS, deal);
    changed('bj');
  }
  function checkAllReady() {
    const seated = BJ.seats.filter(s => s && !s.leaving);
    if (seated.length && seated.every(s => s.bet >= MIN && s.ready)) { BJ.deadline = Date.now() + 700 * F; bjTimer(700 * F, deal); }
  }
  function deal() {
    BJ.seats.forEach(s => {
      if (s && s.bet > 0 && s.bet < MIN) { owe(s.pid, { id: `bj-refund-${Date.now()}-${s.pid}`, game: 'bj', payout: s.bet, staked: 0, net: 0 }); s.bet = 0; }
    });
    const parts = BJ.seats.map((s, i) => (s && s.bet >= MIN ? i : -1)).filter(i => i >= 0);
    if (!parts.length) { BJ.phase = 'waiting'; BJ.deadline = 0; changed('bj'); return; }
    BJ.news = '';
    if (BJ.shoe.length < BJ.cut) { newShoe(); BJ.news = 'Fresh shoe shuffled'; }
    BJ.roundId++;
    BJ.phase = 'playing'; BJ.dealer = []; BJ.hole = true; BJ.turn = null;
    for (const i of parts) { const s = BJ.seats[i]; s.hands = [{ cards: [], bet: s.bet, done: false }]; s.inRound = BJ.roundId; s.ready = false; }
    for (let k = 0; k < 2; k++) { for (const i of parts) BJ.seats[i].hands[0].cards.push(draw()); BJ.dealer.push(draw()); }
    const up = BJ.dealer[0], dealerBJ = total(BJ.dealer).total === 21;
    if ((up.r === 'A' || pts(up.r) === 10) && dealerBJ) { BJ.hole = false; BJ.news = 'Dealer has blackjack'; changed('bj'); bjTimer(900 * F, settle); return; }
    for (const i of parts) { const h = BJ.seats[i].hands[0]; if (total(h.cards).total === 21) h.done = true; }
    advance();
  }
  function advance() {
    for (let i = 0; i < 5; i++) {
      const s = BJ.seats[i];
      if (!s || !s.hands.length || s.inRound !== BJ.roundId) continue;
      for (let h = 0; h < s.hands.length; h++) {
        const hand = s.hands[h];
        if (hand.done) continue;
        if (hand.cards.length === 1) {                 // second hand of a split gets its card now
          hand.cards.push(draw());
          if (hand.splitAces || total(hand.cards).total === 21) { hand.done = true; continue; }
        }
        if (s.leaving) { hand.done = true; continue; }
        BJ.turn = { seat: i, hand: h };
        const ms = online('bj', s.pid) ? TURN_MS : AWAY_TURN_MS;
        BJ.deadline = Date.now() + ms;
        bjTimer(ms, () => { if (BJ.turn && BJ.turn.seat === i && BJ.turn.hand === h) { hand.done = true; advance(); } });
        changed('bj');
        return;
      }
    }
    BJ.turn = null;
    dealerTurn();
  }
  function dealerTurn() {
    BJ.phase = 'dealer'; BJ.hole = false; BJ.deadline = 0;
    changed('bj');
    const live = BJ.seats.some(s => s && s.inRound === BJ.roundId && s.hands.some(h => {
      const t = total(h.cards).total;
      return t <= 21 && !(h.cards.length === 2 && !h.fromSplit && t === 21);
    }));
    const step = () => {
      if (live && total(BJ.dealer).total < 17) { BJ.dealer.push(draw()); changed('bj'); bjTimer(750 * F, step); }
      else bjTimer(700 * F, settle);
    };
    bjTimer(800 * F, step);
  }
  function settle() {
    BJ.phase = 'settle'; BJ.turn = null; BJ.hole = false;
    const d = total(BJ.dealer).total, dBJ = BJ.dealer.length === 2 && d === 21;
    for (const s of BJ.seats) {
      if (!s || s.inRound !== BJ.roundId) continue;
      let pay = 0, staked = 0;
      for (const hand of s.hands) {
        const t = total(hand.cards).total, natural = hand.cards.length === 2 && !hand.fromSplit && t === 21;
        let p, label;
        if (t > 21) { p = 0; label = 'Bust'; }
        else if (natural && !dBJ) { p = Math.floor(hand.bet * 2.5); label = 'Blackjack'; }
        else if (natural && dBJ) { p = hand.bet; label = 'Push'; }
        else if (dBJ) { p = 0; label = 'Dealer blackjack'; }
        else if (d > 21 || t > d) { p = hand.bet * 2; label = 'Win'; }
        else if (t === d) { p = hand.bet; label = 'Push'; }
        else { p = 0; label = 'Lose'; }
        hand.result = { label, payout: p, net: p - hand.bet };
        hand.done = true;
        pay += p; staked += hand.bet;
      }
      owe(s.pid, { id: `bj-${BJ.roundId}`, game: 'bj', payout: pay, staked, net: pay - staked, hands: s.hands.length });
    }
    BJ.deadline = Date.now() + SETTLE_MS;
    changed('bj');
    bjTimer(SETTLE_MS, nextRound);
  }
  function nextRound() {
    BJ.seats.forEach((s, i) => {
      if (!s) return;
      if (s.leaving || !recentlySeen(s.pid, 45000)) { BJ.seats[i] = null; return; }
      s.hands = []; s.bet = 0; s.ready = false; s.inRound = 0;
    });
    BJ.dealer = []; BJ.hole = true; BJ.phase = 'waiting'; BJ.deadline = 0; BJ.news = '';
    changed('bj');
  }
  // empty seats of players who closed the page between rounds
  setInterval(() => {
    if (BJ.phase !== 'waiting' && BJ.phase !== 'betting') return;
    let any = false;
    BJ.seats.forEach((s, i) => {
      if (s && !online('bj', s.pid) && !recentlySeen(s.pid, 45000)) {
        if (s.bet) owe(s.pid, { id: `bj-refund-${Date.now()}-${s.pid}`, game: 'bj', payout: s.bet, staked: 0, net: 0 });
        BJ.seats[i] = null; any = true;
      }
    });
    if (any) {
      if (BJ.phase === 'betting' && !BJ.seats.some(s => s && s.bet > 0)) { clearTimeout(BJ.timer); BJ.phase = 'waiting'; BJ.deadline = 0; }
      else if (BJ.phase === 'betting') checkAllReady();
      changed('bj');
    }
  }, 5000).unref();

  function bjAction(pid, name, body) {
    const a = String(body.action || '');
    let i = seatOf(pid);
    const s = i >= 0 ? BJ.seats[i] : null;
    if (s) s.name = name;
    const err = (m, code = 409) => ({ code, body: { error: m } });
    const ok = (extra = {}) => { changed('bj'); return { code: 200, body: Object.assign({ ok: true }, extra) }; };
    if (a === 'sit') {
      const want = Number(body.seat);
      if (!(want >= 0 && want < 5) || !Number.isInteger(want)) return err('Pick a seat from 1 to 5.', 400);
      if (s) return err('You already have a seat.');
      if (BJ.seats[want]) return err('Someone just took that seat.');
      BJ.seats[want] = { pid, name, bet: 0, ready: false, hands: [], inRound: 0, leaving: false };
      return ok();
    }
    if (!s) return err('Take a seat first.');
    if (a === 'leave') {
      const inPlay = (BJ.phase === 'playing' || BJ.phase === 'dealer') && s.inRound === BJ.roundId;
      if (inPlay) {
        s.leaving = true;
        if (BJ.turn && BJ.turn.seat === i) { s.hands.forEach(h => { h.done = true; }); advance(); }
        return ok({ leftAfterRound: true });
      }
      const refund = BJ.phase === 'settle' ? 0 : s.bet;
      BJ.seats[i] = null;
      if (BJ.phase === 'betting' && !BJ.seats.some(x => x && x.bet > 0)) { clearTimeout(BJ.timer); BJ.phase = 'waiting'; BJ.deadline = 0; }
      else if (BJ.phase === 'betting') checkAllReady();
      return ok({ refund });
    }
    if (a === 'bet') {
      if (BJ.phase !== 'waiting' && BJ.phase !== 'betting') return err('Wait for the next round to bet.');
      const amount = Math.round(Number(body.amount));
      if (!(amount >= 100)) return err('Bets start at $1.', 400);
      if (s.bet + amount > MAX) return err('The table maximum is $1,000.');
      s.bet += amount; s.ready = false;
      if (BJ.phase === 'waiting') startBetting();
      return ok({ charge: amount, bet: s.bet });
    }
    if (a === 'clear') {
      if (BJ.phase !== 'waiting' && BJ.phase !== 'betting') return err('Cards are already out.');
      const refund = s.bet; s.bet = 0; s.ready = false;
      if (BJ.phase === 'betting' && !BJ.seats.some(x => x && x.bet > 0)) { clearTimeout(BJ.timer); BJ.phase = 'waiting'; BJ.deadline = 0; }
      return ok({ refund });
    }
    if (a === 'ready') {
      if (BJ.phase !== 'betting') return err('Place a bet first.');
      if (s.bet < MIN) return err('The minimum bet is $5.');
      s.ready = true; checkAllReady();
      return ok();
    }
    // playing actions
    if (BJ.phase !== 'playing' || !BJ.turn || BJ.turn.seat !== i) return err("It isn't your turn.");
    const hand = s.hands[BJ.turn.hand];
    if (a === 'hit') {
      hand.cards.push(draw());
      const t = total(hand.cards).total;
      if (t >= 21) { hand.done = true; advance(); }
      else { BJ.deadline = Date.now() + TURN_MS; const h = BJ.turn.hand; bjTimer(TURN_MS, () => { if (BJ.turn && BJ.turn.seat === i && BJ.turn.hand === h) { hand.done = true; advance(); } }); }
      return ok();
    }
    if (a === 'stand') { hand.done = true; advance(); return ok(); }
    if (a === 'double') {
      if (hand.cards.length !== 2 || hand.splitAces) return err('You can only double on your first two cards.');
      const charge = hand.bet;
      hand.bet *= 2; hand.doubled = true;
      hand.cards.push(draw()); hand.done = true; advance();
      return ok({ charge });
    }
    if (a === 'split') {
      if (hand.cards.length !== 2 || splitVal(hand.cards[0].r) !== splitVal(hand.cards[1].r)) return err('You can only split a pair.');
      if (s.hands.length >= 4) return err('Four hands is the limit.');
      if (hand.splitAces) return err('Split aces get one card each.');
      const charge = hand.bet;
      const aces = hand.cards[0].r === 'A';
      const moved = hand.cards.pop();
      const nh = { cards: [moved], bet: hand.bet, done: false, fromSplit: true, splitAces: aces };
      hand.fromSplit = true; hand.splitAces = aces;
      s.hands.splice(BJ.turn.hand + 1, 0, nh);
      hand.cards.push(draw());
      if (aces || total(hand.cards).total === 21) { hand.done = true; advance(); }
      else { BJ.deadline = Date.now() + TURN_MS; const h = BJ.turn.hand; bjTimer(TURN_MS, () => { if (BJ.turn && BJ.turn.seat === i && BJ.turn.hand === h) { hand.done = true; advance(); } }); }
      return ok({ charge });
    }
    return err('Unknown action.', 400);
  }
  function bjView(pid) {
    const visibleDealer = BJ.hole && BJ.dealer.length ? [BJ.dealer[0], null] : BJ.dealer;
    return {
      game: 'bj', now: Date.now(), phase: BJ.phase, roundId: BJ.roundId, deadline: BJ.deadline, turn: BJ.turn, news: BJ.news,
      minBet: MIN, maxBet: MAX, shoeLeft: BJ.shoe.length,
      dealer: visibleDealer, dealerTotal: BJ.hole ? (BJ.dealer.length ? total([BJ.dealer[0]]).total : 0) : total(BJ.dealer).total,
      seats: BJ.seats.map(s => s && {
        name: s.name, bet: s.bet, ready: s.ready, leaving: s.leaving, me: s.pid === pid, online: online('bj', s.pid),
        inRound: s.inRound === BJ.roundId && s.hands.length > 0,
        hands: s.hands.map(h => ({ cards: h.cards, bet: h.bet, done: h.done, doubled: !!h.doubled, fromSplit: !!h.fromSplit, splitAces: !!h.splitAces, total: total(h.cards).total, soft: total(h.cards).soft, result: h.result || null })),
      }),
      me: { seat: seatOf(pid), unclaimed: (unclaimed.get(pid) || []).filter(e => e.game === 'bj') },
    };
  }

  /* =============== ROULETTE =============== */
  const WHEEL_REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  const PAY = { straight: 29, split: 17, street: 11, trio: 11, corner: 8, basket: 8, line: 5, dozen: 2, column: 2, even: 1 };
  const MULTS = [[50, 40], [100, 25], [150, 12], [200, 10], [300, 7], [400, 4], [500, 2]];
  const STRIKES = [[1, 28], [2, 30], [3, 22], [4, 12], [5, 8]];
  const weighted = list => { let r = rnd(list.reduce((a, [, w]) => a + w, 0)); for (const [v, w] of list) { if (r < w) return v; r -= w; } return list[0][0]; };
  // every legal bet on the layout, keyed the same way the roulette page keys them
  const SPOTS = new Map();
  (() => {
    const key = (t, n) => t + ':' + [...n].sort((a, b) => a - b).join('-');
    const add = (t, n) => SPOTS.set(key(t, n), { type: t, nums: [...n] });
    const numAt = (c, r) => 3 * c + (3 - r);
    const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    const ALL = range(1, 36);
    add('straight', [0]);
    for (let c = 0; c < 12; c++) for (let r = 0; r < 3; r++) add('straight', [numAt(c, r)]);
    for (let r = 0; r < 3; r++) add('column', range(0, 11).map(c => numAt(c, r)));
    for (let d = 0; d < 3; d++) add('dozen', range(12 * d + 1, 12 * d + 12));
    [n => n <= 18, n => n % 2 === 0, n => WHEEL_REDS.has(n), n => !WHEEL_REDS.has(n), n => n % 2 === 1, n => n >= 19].forEach(f => add('even', ALL.filter(f)));
    for (let c = 0; c < 11; c++) for (let r = 0; r < 3; r++) add('split', [numAt(c, r), numAt(c + 1, r)]);
    for (let c = 0; c < 12; c++) for (let r = 0; r < 2; r++) add('split', [numAt(c, r), numAt(c, r + 1)]);
    for (let c = 0; c < 11; c++) for (let r = 0; r < 2; r++) add('corner', [numAt(c, r), numAt(c, r + 1), numAt(c + 1, r), numAt(c + 1, r + 1)]);
    const street = c => [numAt(c, 0), numAt(c, 1), numAt(c, 2)];
    for (let c = 0; c < 12; c++) add('street', street(c));
    for (let c = 0; c < 11; c++) add('line', [...street(c), ...street(c + 1)]);
    for (let r = 0; r < 3; r++) add('split', [0, numAt(0, r)]);
    add('trio', [0, 2, 3]); add('trio', [0, 1, 2]); add('basket', [0, 1, 2, 3]);
  })();
  const RL_BET_MS = 20000 * F, RL_RESULT_MS = 6000 * F;
  const RL = { phase: 'idle', roundId: 0, deadline: 0, bets: new Map(), names: new Map(), strikes: [], n: null, spinStart: 0, history: [], results: {}, timer: null };
  const rlTimer = (ms, fn) => { clearTimeout(RL.timer); RL.timer = setTimeout(fn, ms); };
  const rlPresent = () => { for (const c of conns) if (c.game === 'rl') return true; return false; };
  function rlStartBetting() {
    RL.phase = 'betting'; RL.deadline = Date.now() + RL_BET_MS; RL.strikes = []; RL.n = null;
    rlTimer(RL_BET_MS, rlClose); changed('rl');
  }
  function rlClose() {
    if (![...RL.bets.values()].some(b => b.total > 0)) {
      if (rlPresent()) rlStartBetting(); else { RL.phase = 'idle'; RL.deadline = 0; changed('rl'); }
      return;
    }
    RL.roundId++;
    const k = weighted(STRIKES), pool = Array.from({ length: 37 }, (_, i) => i);
    RL.strikes = [];
    for (let i = 0; i < k; i++) RL.strikes.push({ n: pool.splice(rnd(pool.length), 1)[0], m: weighted(MULTS) });
    RL.strikes.sort((a, b) => a.m - b.m);
    RL.n = rnd(37);
    RL.phase = 'spinning'; RL.spinStart = Date.now();
    const ms = (350 + RL.strikes.length * 650 + 400 + 5800 + 1500) * F;
    RL.deadline = RL.spinStart + ms;
    rlTimer(ms, rlSettle); changed('rl');
  }
  function rlSettle() {
    const hit = RL.strikes.find(s => s.n === RL.n);
    RL.results = {};
    for (const [pid, b] of RL.bets) {
      let payout = 0;
      for (const [k, amt] of Object.entries(b.bets)) {
        const spot = SPOTS.get(k);
        if (!spot || !spot.nums.includes(RL.n)) continue;
        const m = spot.type === 'straight' && hit ? hit.m : PAY[spot.type];
        payout += amt * (m + 1);
      }
      owe(pid, { id: `rl-${RL.roundId}`, game: 'rl', payout, staked: b.total, net: payout - b.total });
      RL.results[pid] = { name: RL.names.get(pid) || 'Player', net: payout - b.total, staked: b.total };
    }
    RL.history.push({ roundId: RL.roundId, n: RL.n, m: hit ? hit.m : 0 });
    if (RL.history.length > 30) RL.history.shift();
    RL.phase = 'result'; RL.deadline = Date.now() + RL_RESULT_MS;
    changed('rl');
    rlTimer(RL_RESULT_MS, () => { RL.bets.clear(); if (rlPresent()) rlStartBetting(); else { RL.phase = 'idle'; RL.deadline = 0; changed('rl'); } });
  }
  function rlAction(pid, name, body) {
    RL.names.set(pid, name);
    if (body.action !== 'bets') return { code: 400, body: { error: 'Unknown action.' } };
    if (RL.phase !== 'betting' && RL.phase !== 'idle') return { code: 409, body: { error: 'Bets are closed for this spin.' } };
    const raw = body.bets && typeof body.bets === 'object' ? body.bets : {};
    const clean = {};
    let sum = 0, count = 0;
    for (const [k, v] of Object.entries(raw)) {
      const amt = Math.round(Number(v));
      if (!SPOTS.has(k) || !(amt >= 100) || amt > 100000) return { code: 400, body: { error: 'That bet is not on the layout.' } };
      if (++count > 160) return { code: 400, body: { error: 'Too many bets.' } };
      clean[k] = amt; sum += amt;
    }
    if (sum) RL.bets.set(pid, { bets: clean, total: sum }); else RL.bets.delete(pid);
    if (RL.phase === 'idle') rlStartBetting(); else changed('rl');
    return { code: 200, body: { ok: true, total: sum } };
  }
  function rlView(pid) {
    const seen = new Map();
    for (const c of conns) if (c.game === 'rl') seen.set(c.pid, c.name);
    for (const pidB of RL.bets.keys()) if (!seen.has(pidB)) seen.set(pidB, RL.names.get(pidB) || 'Player');
    const players = [...seen].map(([p, n]) => ({
      name: n, me: p === pid, bet: (RL.bets.get(p) || { total: 0 }).total,
      net: RL.phase === 'result' && RL.results[p] ? RL.results[p].net : null,
    }));
    const showSpin = RL.phase === 'spinning' || RL.phase === 'result';
    return {
      game: 'rl', now: Date.now(), phase: RL.phase, roundId: RL.roundId, deadline: RL.deadline,
      strikes: showSpin ? RL.strikes : [], n: showSpin ? RL.n : null, spinStart: RL.spinStart,
      history: RL.history.slice(-14), players,
      me: { bets: (RL.bets.get(pid) || { bets: {} }).bets, unclaimed: (unclaimed.get(pid) || []).filter(e => e.game === 'rl') },
    };
  }

  /* =============== http =============== */
  function stream(req, res, url) {
    const game = url.searchParams.get('game'), pid = url.searchParams.get('id') || '', token = url.searchParams.get('token') || '';
    if (game !== 'bj' && game !== 'rl') { res.writeHead(400); return res.end(); }
    if (!checkToken(pid, token)) { res.writeHead(403); return res.end(); }
    const c = { res, game, pid, name: cleanName(url.searchParams.get('name')) };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    conns.add(c); lastSeen.set(pid, Date.now());
    if (game === 'rl') { RL.names.set(pid, c.name); if (RL.phase === 'idle') rlStartBetting(); }
    const i = seatOf(pid); if (game === 'bj' && i >= 0) BJ.seats[i].name = c.name;
    push(c); changed(game);
    req.on('close', () => { conns.delete(c); lastSeen.set(pid, Date.now()); changed(game); });
  }
  function action(game, body) {
    const pid = String(body.id || ''), token = String(body.token || '');
    if (!checkToken(pid, token)) return { code: 403, body: { error: 'This seat belongs to another browser.' } };
    lastSeen.set(pid, Date.now());
    const name = cleanName(body.name);
    return game === 'bj' ? bjAction(pid, name, body) : rlAction(pid, name, body);
  }
  function claim(body) {
    const pid = String(body.id || ''), token = String(body.token || '');
    if (!checkToken(pid, token)) return { code: 403, body: { error: 'Not your seat.' } };
    const ids = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
    const list = unclaimed.get(pid) || [];
    const keep = list.filter(e => !ids.has(e.id));
    if (keep.length !== list.length) {
      unclaimed.set(pid, keep);
      changed('bj'); changed('rl');
    }
    return { code: 200, body: { ok: true } };
  }
  function summary() {
    const rlPlayers = new Set();
    for (const c of conns) if (c.game === 'rl') rlPlayers.add(c.pid);
    return {
      bj: { seated: BJ.seats.filter(Boolean).length, seats: 5, phase: BJ.phase },
      rl: { players: rlPlayers.size, phase: RL.phase },
    };
  }
  return { stream, action, claim, summary, _test: { BJ, RL, total, SPOTS } };
};
