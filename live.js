// Miguel's Casino live tables: shared blackjack (5 seats), a shared roulette wheel and Texas Hold'em.
// The server deals, spins and keeps time, and it also holds the money: bets come out of the player's
// server-side bankroll and winnings go straight back into it. Browsers only show what happened.
'use strict';
const crypto = require('crypto');
const rnd = n => crypto.randomInt(n);
const F = Number(process.env.LIVE_TIME_SCALE) || 1;   // for automated tests only
const RR = require('./roulette_rules');
const { createPoker } = require('./poker');

module.exports = function createLive({ A, cleanName, saveState, auth, isClosed, flag }) {
  /* ---------------- connections & notices ---------------- */
  const conns = new Set();                 // { res, game, pid, name }
  const notices = new Map();               // pid -> [{ id, game, payout, staked, net, ... }]  (for messages only; money is already paid)
  const lastSeen = new Map();
  const online = (game, pid) => { for (const c of conns) if (c.game === game && c.pid === pid) return true; return false; };
  const recentlySeen = (pid, ms) => Date.now() - (lastSeen.get(pid) || 0) < ms;
  function owe(pid, entry) {
    const list = notices.get(pid) || [];
    list.push(entry);
    while (list.length > 30) list.shift();
    notices.set(pid, list);
  }
  const bal = pid => { const r = A.get(pid); return r ? r.bal : 0; };
  const dirty = new Set();
  let flushTimer = null;
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
  function push(c) {
    const view = c.game === 'bj' ? bjView(c.pid) : c.game === 'pk' ? pkView(c.pid) : rlView(c.pid);
    c.res.write(`event: state\ndata: ${JSON.stringify(view)}\n\n`);
  }
  setInterval(() => {
    for (const c of conns) { lastSeen.set(c.pid, Date.now()); c.res.write(': keep-alive\n\n'); }
  }, 15000).unref();

  /* =============== BLACKJACK =============== */
  const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const MIN = 500, MAX = 100000;           // cents
  const TURN_MS = 20000 * F, AWAY_TURN_MS = 5000 * F, BET_MS = 15000 * F, SETTLE_MS = 6000 * F, INS_MS = 12000 * F;
  const pts = r => (r === 'A' ? 11 : ['10', 'J', 'Q', 'K'].includes(r) ? 10 : +r);
  const splitVal = r => (r === 'A' ? 1 : Math.min(10, pts(r)));
  function total(cards) {
    let t = 0, aces = 0;
    for (const c of cards) { if (c.r === 'A') { aces++; t += 1; } else t += pts(c.r); }
    const soft = aces > 0 && t + 10 <= 21;
    return { total: soft ? t + 10 : t, soft };
  }
  const natural = h => h.cards.length === 2 && !h.fromSplit && total(h.cards).total === 21;
  const BJ = { seats: [null, null, null, null, null], phase: 'waiting', roundId: 0, dealer: [], hole: true, turn: null, deadline: 0, shoe: [], cut: 0, news: '', timer: null, peek: null };
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
  const inRound = s => s && s.inRound === BJ.roundId && s.hands.length > 0;
  const bjRefund = (s, why) => { if (s && s.bet > 0) { A.refund(s.pid, s.bet, 'live-bj', why || 'Live blackjack bet returned'); owe(s.pid, { id: `bj-refund-${Date.now()}-${rnd(1e9)}`, game: 'bj', payout: s.bet, staked: 0, net: 0, notice: true, refund: true }); s.bet = 0; } };

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
    BJ.seats.forEach(s => { if (s && s.bet > 0 && s.bet < MIN) bjRefund(s, 'Below the table minimum, returned'); });
    const parts = BJ.seats.map((s, i) => (s && s.bet >= MIN ? i : -1)).filter(i => i >= 0);
    if (!parts.length) { BJ.phase = 'waiting'; BJ.deadline = 0; changed('bj'); return; }
    BJ.news = '';
    if (BJ.shoe.length < BJ.cut) { newShoe(); BJ.news = 'Fresh shoe shuffled'; }
    BJ.roundId++;
    BJ.phase = 'playing'; BJ.dealer = []; BJ.hole = true; BJ.turn = null; BJ.peek = null;
    for (const i of parts) {
      const s = BJ.seats[i];
      s.hands = [{ cards: [], bet: s.bet, done: false }]; s.inRound = BJ.roundId; s.ready = false; s.ins = null; s.lastBet = s.bet; s.bet = 0;
    }
    for (let k = 0; k < 2; k++) { for (const i of parts) BJ.seats[i].hands[0].cards.push(draw()); BJ.dealer.push(draw()); }
    const up = BJ.dealer[0];
    if (up.r === 'A') {
      // every player at the table is offered insurance (or even money on a blackjack)
      BJ.phase = 'insurance'; BJ.deadline = Date.now() + INS_MS;
      BJ.news = 'Dealer shows an ace · insurance?';
      bjTimer(INS_MS, resolveInsurance);
      changed('bj');
      return;
    }
    if (pts(up.r) === 10) {
      BJ.peek = total(BJ.dealer).total === 21 ? 'bj' : 'none';
      if (BJ.peek === 'bj') { BJ.hole = false; BJ.news = 'Dealer checks the hole card: blackjack'; changed('bj'); bjTimer(1200 * F, settle); return; }
      BJ.news = 'Dealer checked for blackjack: no blackjack';
    }
    startPlay();
  }
  function startPlay() {
    BJ.phase = 'playing';
    for (const s of BJ.seats) if (inRound(s)) { const h = s.hands[0]; if (total(h.cards).total === 21) h.done = true; }
    advance();
  }
  function allInsured() { return BJ.seats.every(s => !inRound(s) || s.ins !== null); }
  function resolveInsurance() {
    if (BJ.phase !== 'insurance') return;
    for (const s of BJ.seats) if (inRound(s) && s.ins === null) s.ins = 0;
    // even money: the blackjack is paid 1 to 1 now, whatever the dealer has
    for (const s of BJ.seats) if (inRound(s) && s.ins === 'even') { s.hands[0].evenMoney = true; s.hands[0].done = true; }
    const dBJ = total(BJ.dealer).total === 21;
    BJ.peek = dBJ ? 'bj' : 'none';
    if (dBJ) {
      BJ.hole = false; BJ.phase = 'playing';
      const insured = BJ.seats.some(s => inRound(s) && (s.ins > 0 || s.ins === 'even'));
      BJ.news = insured ? 'Dealer has blackjack · insurance pays 2 to 1' : 'Dealer has blackjack';
      changed('bj'); bjTimer(1200 * F, settle); return;
    }
    const lost = BJ.seats.some(s => inRound(s) && s.ins > 0);
    BJ.news = lost ? 'No dealer blackjack · insurance loses' : 'Dealer checked for blackjack: no blackjack';
    startPlay();
  }
  function advance() {
    for (let i = 0; i < 5; i++) {
      const s = BJ.seats[i];
      if (!inRound(s)) continue;
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
    const live = BJ.seats.some(s => inRound(s) && s.hands.some(h => {
      const t = total(h.cards).total;
      return t <= 21 && !h.surrendered && !h.evenMoney && !natural(h);
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
      if (!inRound(s)) continue;
      let pay = 0, staked = 0, bjs = 0;
      for (const hand of s.hands) {
        const t = total(hand.cards).total, nat = natural(hand);
        let p, label;
        if (hand.evenMoney) { p = hand.bet * 2; label = 'Even money'; }
        else if (hand.surrendered) { p = hand.bet / 2; label = 'Surrendered'; }
        else if (t > 21) { p = 0; label = 'Bust'; }
        else if (nat && !dBJ) { p = Math.floor(hand.bet * 2.5); label = 'Blackjack'; bjs++; }
        else if (nat && dBJ) { p = hand.bet; label = 'Push'; }
        else if (dBJ) { p = 0; label = 'Dealer blackjack'; }
        else if (d > 21 || t > d) { p = hand.bet * 2; label = 'Win'; }
        else if (t === d) { p = hand.bet; label = 'Push'; }
        else { p = 0; label = 'Lose'; }
        hand.result = { label, payout: p, net: p - hand.bet };
        hand.done = true;
        pay += p; staked += hand.bet;
      }
      let insNet = 0;
      if (s.ins > 0) { staked += s.ins; if (dBJ) { pay += s.ins * 3; insNet = s.ins * 2; } else insNet = -s.ins; }
      s.insResult = s.ins > 0 ? insNet : null;
      if (pay > 0) A.credit(s.pid, pay, 'live-bj', 'Live blackjack payout');
      A.round(s.pid, 'live-bj', { staked, paid: pay, hands: s.hands.length, blackjacks: bjs });
      owe(s.pid, { id: `bj-${BJ.roundId}`, game: 'bj', payout: pay, staked, net: pay - staked, hands: s.hands.length, insurance: s.insResult });
    }
    BJ.deadline = Date.now() + SETTLE_MS;
    changed('bj');
    bjTimer(SETTLE_MS, nextRound);
  }
  function nextRound() {
    BJ.seats.forEach((s, i) => {
      if (!s) return;
      if (s.leaving || !recentlySeen(s.pid, 45000)) { bjRefund(s); BJ.seats[i] = null; return; }
      s.hands = []; s.ready = false; s.inRound = 0; s.ins = null; s.insResult = null;
    });
    BJ.dealer = []; BJ.hole = true; BJ.phase = BJ.seats.some(s => s && s.bet > 0) ? 'betting' : 'waiting'; BJ.news = ''; BJ.peek = null;
    if (BJ.phase === 'betting') startBetting(); else { BJ.deadline = 0; changed('bj'); }
  }
  // empty seats of players who closed the page between rounds
  setInterval(() => {
    if (BJ.phase !== 'waiting' && BJ.phase !== 'betting') return;
    let any = false;
    BJ.seats.forEach((s, i) => {
      if (s && !online('bj', s.pid) && !recentlySeen(s.pid, 45000)) { bjRefund(s); BJ.seats[i] = null; any = true; }
    });
    if (any) {
      if (BJ.phase === 'betting' && !BJ.seats.some(s => s && s.bet > 0)) { clearTimeout(BJ.timer); BJ.phase = 'waiting'; BJ.deadline = 0; }
      else if (BJ.phase === 'betting') checkAllReady();
      changed('bj');
    }
  }, 5000).unref();

  function bjAction(pid, name, body) {
    const a = String(body.action || '');
    const i = seatOf(pid);
    const s = i >= 0 ? BJ.seats[i] : null;
    if (s) s.name = name;
    const err = (m, code = 409) => ({ code, body: { error: m, cents: bal(pid) } });
    const ok = (extra = {}) => { changed('bj'); return { code: 200, body: Object.assign({ ok: true }, extra, { cents: bal(pid) }) }; };
    if (a === 'sit') {
      const want = Number(body.seat);
      if (!(want >= 0 && want < 5) || !Number.isInteger(want)) return err('Pick a seat from 1 to 5.', 400);
      if (s) return err('You already have a seat.');
      if (BJ.seats[want]) return err('Someone just took that seat.');
      BJ.seats[want] = { pid, name, bet: 0, ready: false, hands: [], inRound: 0, leaving: false, ins: null };
      return ok();
    }
    if (!s) return err('Take a seat first.');
    if (a === 'leave') {
      const inPlay = ['playing', 'dealer', 'insurance'].includes(BJ.phase) && s.inRound === BJ.roundId;
      if (inPlay) {
        s.leaving = true;
        if (BJ.phase === 'insurance' && s.ins === null) { s.ins = 0; if (allInsured()) bjTimer(500 * F, resolveInsurance); }
        if (BJ.turn && BJ.turn.seat === i) { s.hands.forEach(h => { h.done = true; }); advance(); }
        return ok({ leftAfterRound: true });
      }
      const refund = s.bet;
      bjRefund(s, 'Left the live blackjack table');
      BJ.seats[i] = null;
      if (BJ.phase === 'betting' && !BJ.seats.some(x => x && x.bet > 0)) { clearTimeout(BJ.timer); BJ.phase = 'waiting'; BJ.deadline = 0; }
      else if (BJ.phase === 'betting') checkAllReady();
      return ok({ refund });
    }
    if (a === 'bet') {
      if (BJ.phase !== 'waiting' && BJ.phase !== 'betting' && BJ.phase !== 'settle') return err('Wait for the next round to bet.');
      const amount = Math.round(Number(body.amount));
      if (!(amount >= 100) || amount % 100) return err('Bets are in whole dollars, from $1.', 400);
      if (s.bet + amount > MAX) return err('The table maximum is $1,000.');
      if (!A.debit(pid, amount, 'live-bj', 'Live blackjack bet')) return err('Not enough in your bankroll.');
      s.bet += amount; s.ready = false;
      if (BJ.phase === 'waiting') startBetting();
      return ok({ charge: amount, bet: s.bet });
    }
    if (a === 'clear') {
      if (BJ.phase !== 'waiting' && BJ.phase !== 'betting' && BJ.phase !== 'settle') return err('Cards are already out.');
      const refund = s.bet;
      bjRefund(s, 'Live blackjack bet cleared');
      s.ready = false;
      if (BJ.phase === 'betting' && !BJ.seats.some(x => x && x.bet > 0)) { clearTimeout(BJ.timer); BJ.phase = 'waiting'; BJ.deadline = 0; }
      return ok({ refund });
    }
    if (a === 'ready') {
      if (BJ.phase !== 'betting') return err('Place a bet first.');
      if (s.bet < MIN) return err('The minimum bet is $5.');
      s.ready = true; checkAllReady();
      return ok();
    }
    if (a === 'insurance') {
      if (BJ.phase !== 'insurance' || !inRound(s)) return err('Insurance is only offered when the dealer shows an ace.');
      if (s.ins !== null) return err('You already answered.');
      const h = s.hands[0];
      if (body.take) {
        if (natural(h)) s.ins = 'even';
        else {
          const cost = h.bet / 2;
          if (!A.debit(pid, cost, 'live-bj', 'Live blackjack insurance')) return err('Not enough in your bankroll for insurance.');
          s.ins = cost;
        }
      } else s.ins = 0;
      if (allInsured()) { BJ.deadline = Date.now() + 600 * F; bjTimer(600 * F, resolveInsurance); }
      return ok({ charge: s.ins > 0 ? s.ins : 0 });
    }
    // playing actions
    if (BJ.phase !== 'playing' || !BJ.turn || BJ.turn.seat !== i) return err("It isn't your turn.");
    const hand = s.hands[BJ.turn.hand];
    const restart = () => { BJ.deadline = Date.now() + TURN_MS; const h = BJ.turn.hand; bjTimer(TURN_MS, () => { if (BJ.turn && BJ.turn.seat === i && BJ.turn.hand === h) { hand.done = true; advance(); } }); };
    if (a === 'hit') {
      hand.cards.push(draw());
      const t = total(hand.cards).total;
      if (t >= 21) { hand.done = true; advance(); } else restart();
      return ok();
    }
    if (a === 'stand') { hand.done = true; advance(); return ok(); }
    if (a === 'double') {
      if (hand.cards.length !== 2 || hand.splitAces) return err('You can only double on your first two cards.');
      if (!A.debit(pid, hand.bet, 'live-bj', 'Live blackjack double down')) return err('Not enough in your bankroll to double.');
      const charge = hand.bet;
      hand.bet *= 2; hand.doubled = true;
      hand.cards.push(draw()); hand.done = true; advance();
      return ok({ charge });
    }
    if (a === 'split') {
      if (hand.cards.length !== 2 || splitVal(hand.cards[0].r) !== splitVal(hand.cards[1].r)) return err('You can only split a pair.');
      if (s.hands.length >= 4) return err('Four hands is the limit.');
      if (hand.splitAces) return err('Split aces get one card each.');
      if (!A.debit(pid, hand.bet, 'live-bj', 'Live blackjack split')) return err('Not enough in your bankroll to split.');
      const charge = hand.bet;
      const aces = hand.cards[0].r === 'A';
      const moved = hand.cards.pop();
      const nh = { cards: [moved], bet: hand.bet, done: false, fromSplit: true, splitAces: aces };
      hand.fromSplit = true; hand.splitAces = aces;
      s.hands.splice(BJ.turn.hand + 1, 0, nh);
      hand.cards.push(draw());
      if (aces || total(hand.cards).total === 21) { hand.done = true; advance(); } else restart();
      return ok({ charge });
    }
    if (a === 'surrender') {
      if (s.hands.length !== 1 || hand.cards.length !== 2 || hand.fromSplit) return err('Surrender is only allowed on your first two cards.');
      hand.surrendered = true; hand.done = true; advance();
      return ok();
    }
    return err('Unknown action.', 400);
  }
  function bjView(pid) {
    const visibleDealer = BJ.hole && BJ.dealer.length ? [BJ.dealer[0], null] : BJ.dealer;
    return {
      game: 'bj', now: Date.now(), phase: BJ.phase, roundId: BJ.roundId, deadline: BJ.deadline, turn: BJ.turn, news: BJ.news, peek: BJ.peek,
      minBet: MIN, maxBet: MAX, shoeLeft: BJ.shoe.length, insMs: INS_MS,
      dealer: visibleDealer, dealerTotal: BJ.hole ? (BJ.dealer.length ? total([BJ.dealer[0]]).total : 0) : total(BJ.dealer).total,
      seats: BJ.seats.map(s => s && {
        name: s.name, bet: s.bet, ready: s.ready, leaving: s.leaving, me: s.pid === pid, online: online('bj', s.pid),
        inRound: inRound(s), ins: s.ins === null || s.ins === undefined ? null : s.ins === 'even' ? 'even' : s.ins, insResult: s.insResult == null ? null : s.insResult,
        hands: s.hands.map(h => ({ cards: h.cards, bet: h.bet, done: h.done, doubled: !!h.doubled, fromSplit: !!h.fromSplit, splitAces: !!h.splitAces, surrendered: !!h.surrendered, evenMoney: !!h.evenMoney, total: total(h.cards).total, soft: total(h.cards).soft, result: h.result || null })),
      }),
      me: { seat: seatOf(pid), cents: bal(pid), unclaimed: (notices.get(pid) || []).filter(e => e.game === 'bj') },
    };
  }

  /* =============== ROULETTE =============== */
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
    RL.strikes = RR.genStrikes(rnd);
    RL.n = rnd(37);
    RL.phase = 'spinning'; RL.spinStart = Date.now();
    const ms = (350 + RL.strikes.length * 650 + 400 + 5800 + 1500) * F;
    RL.deadline = RL.spinStart + ms;
    rlTimer(ms, rlSettle); changed('rl');
  }
  function rlSettle() {
    RL.results = {};
    for (const [pid, b] of RL.bets) {
      const { total: payout, mult } = RR.payout(b.bets, RL.n, RL.strikes, true);
      if (payout > 0) A.credit(pid, payout, 'live-rl', `Live roulette: ${RL.n}`);
      A.round(pid, 'live-rl', { staked: b.total, paid: payout, spins: 1, mult });
      owe(pid, { id: `rl-${RL.roundId}`, game: 'rl', payout, staked: b.total, net: payout - b.total });
      RL.results[pid] = { name: RL.names.get(pid) || 'Player', net: payout - b.total, staked: b.total };
    }
    const hit = RL.strikes.find(s => s.n === RL.n);
    RL.history.push({ roundId: RL.roundId, n: RL.n, m: hit ? hit.m : 0 });
    if (RL.history.length > 30) RL.history.shift();
    RL.bets.clear();
    RL.phase = 'result'; RL.deadline = Date.now() + RL_RESULT_MS;
    changed('rl');
    rlTimer(RL_RESULT_MS, () => { if (rlPresent()) rlStartBetting(); else { RL.phase = 'idle'; RL.deadline = 0; changed('rl'); } });
  }
  function rlAction(pid, name, body) {
    RL.names.set(pid, name);
    if (body.action !== 'bets') return { code: 400, body: { error: 'Unknown action.' } };
    if (RL.phase !== 'betting' && RL.phase !== 'idle') return { code: 409, body: { error: 'Bets are closed for this spin.', cents: bal(pid) } };
    const raw = body.bets && typeof body.bets === 'object' ? body.bets : {};
    const clean = {};
    let sum = 0, count = 0;
    for (const [k, v] of Object.entries(raw)) {
      const amt = Math.round(Number(v));
      if (!RR.SPOTS.has(k) || !(amt >= 100) || amt > 100000 || amt % 100) return { code: 400, body: { error: 'That bet is not on the layout.' }, flag: `live roulette bet ${String(k).slice(0, 30)}=${String(v).slice(0, 12)}` };
      if (++count > 160) return { code: 400, body: { error: 'Too many bets.' } };
      clean[k] = amt; sum += amt;
    }
    const before = (RL.bets.get(pid) || { total: 0 }).total;
    const delta = sum - before;
    if (delta > 0 && !A.debit(pid, delta, 'live-rl', 'Live roulette bets')) return { code: 409, body: { error: 'Not enough in your bankroll.', cents: bal(pid), total: before } };
    if (delta < 0) A.refund(pid, -delta, 'live-rl', 'Live roulette bets taken back');
    if (sum) RL.bets.set(pid, { bets: clean, total: sum }); else RL.bets.delete(pid);
    if (RL.phase === 'idle') rlStartBetting(); else changed('rl');
    return { code: 200, body: { ok: true, total: sum, cents: bal(pid) } };
  }
  function rlView(pid) {
    const seen = new Map();
    for (const c of conns) if (c.game === 'rl') seen.set(c.pid, c.name);
    for (const pidB of RL.bets.keys()) if (!seen.has(pidB)) seen.set(pidB, RL.names.get(pidB) || 'Player');
    if (RL.phase === 'result') for (const p of Object.keys(RL.results)) if (!seen.has(p)) seen.set(p, RL.results[p].name);
    const players = [...seen].map(([p, n]) => ({
      name: n, me: p === pid, bet: RL.phase === 'result' && RL.results[p] ? RL.results[p].staked : (RL.bets.get(p) || { total: 0 }).total,
      net: RL.phase === 'result' && RL.results[p] ? RL.results[p].net : null,
    }));
    const showSpin = RL.phase === 'spinning' || RL.phase === 'result';
    return {
      game: 'rl', now: Date.now(), phase: RL.phase, roundId: RL.roundId, deadline: RL.deadline,
      strikes: showSpin ? RL.strikes : [], n: showSpin ? RL.n : null, spinStart: RL.spinStart,
      history: RL.history.slice(-14), players,
      me: { bets: (RL.bets.get(pid) || { bets: {} }).bets, cents: bal(pid), unclaimed: (notices.get(pid) || []).filter(e => e.game === 'rl') },
    };
  }

  /* =============== TEXAS HOLD'EM =============== */
  let pokerSeated = {};
  const PK = createPoker({
    owe, rnd, timeScale: F,
    changed: () => changed('pk'),
    online: pid => online('pk', pid),
    persist: st => { pokerSeated = st.seated || {}; persist(); },
    take: (pid, c, why) => A.move(pid, -c, why || 'Poker buy-in'),
    give: (pid, c, why) => A.move(pid, c, why || 'Poker cash-out'),
    handDone: (pid, staked, won) => { A.round(pid, 'poker', { staked, paid: won, hands: 1 }); watchHand(pid, staked, won); },
  });
  // chip dumping: a player losing a big pot to someone on the same network (an alt account feeding a main one)
  let handBatch = [];
  function watchHand(pid, staked, won) {
    if (!handBatch.length) setImmediate(() => {
      const list = handBatch; handBatch = [];
      const winners = list.filter(h => h.won - h.staked >= 20000), losers = list.filter(h => h.won < h.staked);
      for (const w of winners) for (const l of losers) {
        const a = A.get(w.pid), b = A.get(l.pid);
        if (flag && a && b && a.ip && a.ip === b.ip) flag(l.pid, 'chip-dump', `Lost ${A.usd(l.staked - l.won)} at Hold\u2019em to ${a.name || 'a player'} on the same network (${a.ip}). Could be an alt account feeding chips.`, b.ip);
      }
    });
    handBatch.push({ pid, staked, won });
  }
  function pkView(pid) {
    const v = PK.view(pid);
    v.me.unclaimed = (notices.get(pid) || []).filter(e => e.game === 'pk');
    v.me.cents = bal(pid);
    return v;
  }
  setInterval(() => { PK.tick(); for (const c of conns) if (c.game === 'pk') PK.seen(c.pid); }, 5000).unref();

  // money a player has on the live tables right now (counts toward their cash on the leaderboard)
  function onTables(pid) {
    let c = 0;
    const i = seatOf(pid);
    if (i >= 0) {
      const s = BJ.seats[i];
      c += s.bet || 0;
      if (inRound(s) && BJ.phase !== 'settle') { c += s.hands.reduce((a, h) => a + h.bet, 0); if (s.ins > 0) c += s.ins; }
    }
    const rb = RL.bets.get(pid); if (rb && RL.phase !== 'result') c += rb.total;
    const pk = pokerSeated[pid]; if (pk) c += pk.stack || 0;
    return c;
  }
  A.extras.push(onTables);
  // saved often, so a restart (Render going to sleep or an update) hands every chip back
  function persist() {
    if (!saveState) return;
    const atRisk = {};
    for (const s of BJ.seats) {
      if (!s) continue;
      let c = s.bet || 0;
      if (inRound(s) && BJ.phase !== 'settle') { c += s.hands.reduce((a, h) => a + h.bet, 0); if (s.ins > 0) c += s.ins; }
      if (c) atRisk[s.pid] = (atRisk[s.pid] || 0) + c;
    }
    if (RL.phase !== 'result') for (const [pid, b] of RL.bets) atRisk[pid] = (atRisk[pid] || 0) + b.total;
    saveState({ v: 2, atRisk, pokerSeated });
  }

  /* =============== http =============== */
  function stream(req, res, url, ip) {
    const game = url.searchParams.get('game'), pid = url.searchParams.get('id') || '', token = url.searchParams.get('token') || '';
    if (game !== 'bj' && game !== 'rl' && game !== 'pk') { res.writeHead(400); return res.end(); }
    const who = auth(pid, token, ip);
    if (who.error) { res.writeHead(who.code || 403); return res.end(); }
    const c = { res, game, pid, name: cleanName(url.searchParams.get('name')) || A.get(pid).name || 'Player' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    conns.add(c); lastSeen.set(pid, Date.now());
    if (game === 'rl') { RL.names.set(pid, c.name); if (RL.phase === 'idle') rlStartBetting(); }
    const i = seatOf(pid); if (game === 'bj' && i >= 0) BJ.seats[i].name = c.name;
    push(c); changed(game);
    req.on('close', () => { conns.delete(c); lastSeen.set(pid, Date.now()); changed(game); });
  }
  function action(game, body, ip) {
    const pid = String(body.id || ''), token = String(body.token || '');
    const who = auth(pid, token, ip);
    if (who.error) return { code: who.code || 403, body: { error: who.error } };
    if (isClosed()) return { code: 503, body: { error: 'The casino is closed for a moment. Try again soon.' } };
    lastSeen.set(pid, Date.now());
    const name = cleanName(body.name) || A.get(pid).name || 'Player';
    return game === 'bj' ? bjAction(pid, name, body) : game === 'pk' ? PK.action(pid, name, body) : rlAction(pid, name, body);
  }
  function claim(body, ip) {
    const pid = String(body.id || ''), token = String(body.token || '');
    const who = auth(pid, token, ip);
    if (who.error) return { code: 403, body: { error: 'Not your seat.' } };
    const ids = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
    const list = notices.get(pid) || [];
    const keep = list.filter(e => !ids.has(e.id));
    if (keep.length !== list.length) { notices.set(pid, keep); changed('bj'); changed('rl'); changed('pk'); }
    return { code: 200, body: { ok: true } };
  }
  function summary() {
    const rlPlayers = new Set();
    for (const c of conns) if (c.game === 'rl') rlPlayers.add(c.pid);
    return {
      bj: { seated: BJ.seats.filter(Boolean).length, seats: 5, phase: BJ.phase },
      rl: { players: rlPlayers.size, phase: RL.phase },
      pk: PK.summary(),
    };
  }
  // after a restart: hand back every chip that was on a table
  function restore(saved) {
    if (!saved) return;
    if (saved.v === 2) {
      for (const [pid, c] of Object.entries(saved.atRisk || {})) if (c > 0 && A.get(pid)) A.refund(pid, c, 'live', 'Live table bets returned after a server restart');
    } else {
      // older format: money that was owed to browsers; the server now pays it straight into the bankroll
      for (const [pid, list] of Object.entries(saved.owed || {})) for (const e of list || []) if (e && e.payout > 0 && A.get(pid)) A.move(pid, Math.round(e.payout), 'Live table money owed from before the upgrade');
    }
    PK.restore({ seated: Object.fromEntries(Object.entries(saved.pokerSeated || {}).filter(([pid]) => A.get(pid))) });
    persist();
  }
  // for the admin room
  function where(pid) {
    const out = [];
    if (seatOf(pid) >= 0) out.push('Live blackjack');
    if (RL.bets.has(pid) || [...conns].some(c => c.game === 'rl' && c.pid === pid)) out.push('Live roulette');
    if (pokerSeated[pid]) out.push('Hold’em');
    return out;
  }
  function kick(pid) {
    let n = 0;
    const i = seatOf(pid);
    if (i >= 0) {
      const s = BJ.seats[i];
      if (inRound(s) && ['playing', 'dealer', 'insurance'].includes(BJ.phase)) { s.leaving = true; if (BJ.turn && BJ.turn.seat === i) { s.hands.forEach(h => { h.done = true; }); advance(); } }
      else { bjRefund(s, 'Removed from the live blackjack table'); BJ.seats[i] = null; }
      n++; changed('bj');
    }
    if (RL.bets.has(pid) && (RL.phase === 'betting' || RL.phase === 'idle')) { A.refund(pid, RL.bets.get(pid).total, 'live-rl', 'Live roulette bets returned'); RL.bets.delete(pid); n++; changed('rl'); }
    const r = PK.action(pid, (A.get(pid) || {}).name || 'Player', { action: 'leave' });
    if (r.code === 200) n++;
    for (const c of [...conns]) if (c.pid === pid) { try { c.res.end(); } catch (e) {} conns.delete(c); }
    return n;
  }
  function onlineNow() { const m = new Map(); for (const c of conns) { if (!m.has(c.pid)) m.set(c.pid, []); m.get(c.pid).push(c.game); } return m; }
  return { stream, action, claim, summary, restore, where, kick, onlineNow, persist, _test: { BJ, RL, total, PK, resolveInsurance, settle } };
};
