// Miguel's Casino: live No-Limit Texas Hold'em (6 seats). The server deals and enforces every rule;
// each player only ever receives their own hole cards until showdown.
'use strict';

/* ================= hand evaluator ================= */
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const SUITS = ['♠', '♥', '♦', '♣'];
const RV = Object.fromEntries(RANKS.map((r, i) => [r, i + 2]));        // '2' -> 2 ... 'A' -> 14
const NAME = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
const PLURAL = v => (v === 6 ? 'Sixes' : NAME[v] + 's');
const CATS = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

// rank of exactly 5 cards: [category, tiebreakers...] compared left to right
function rank5(cs) {
  const v = cs.map(c => RV[c.r]).sort((a, b) => b - a);
  const flush = cs.every(c => c.s === cs[0].s);
  const uniq = [...new Set(v)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (v[0] - v[4] === 4) straightHigh = v[0];
    else if (v[0] === 14 && v[1] === 5 && v[4] === 2) straightHigh = 5;       // A-2-3-4-5
  }
  if (straightHigh && flush) return [8, straightHigh];
  const counts = {};
  for (const x of v) counts[x] = (counts[x] || 0) + 1;
  const groups = Object.entries(counts).map(([k, n]) => [n, +k]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  if (groups[0][0] === 4) return [7, groups[0][1], groups[1][1]];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, groups[0][1], groups[1][1]];
  if (flush) return [5, ...v];
  if (straightHigh) return [4, straightHigh];
  if (groups[0][0] === 3) return [3, groups[0][1], ...groups.slice(1).map(g => g[1])];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, groups[0][1], groups[1][1], groups[2][1]];
  if (groups[0][0] === 2) return [1, groups[0][1], ...groups.slice(1).map(g => g[1])];
  return [0, ...v];
}
function cmp(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
}
// best 5 of 5-7 cards
function best(cards) {
  let top = null, topCards = null;
  const n = cards.length;
  const idx = [];
  const pick = (start, left) => {
    if (!left) {
      const five = idx.map(i => cards[i]);
      const r = rank5(five);
      if (!top || cmp(r, top) > 0) { top = r; topCards = five; }
      return;
    }
    for (let i = start; i <= n - left; i++) { idx.push(i); pick(i + 1, left - 1); idx.pop(); }
  };
  pick(0, 5);
  return { rank: top, cards: topCards, name: describe(top) };
}
function describe(r) {
  const [c, a, b] = r;
  switch (c) {
    case 8: return a === 14 ? 'Royal flush' : `Straight flush, ${NAME[a]} high`;
    case 7: return `Four of a kind, ${PLURAL(a)}`;
    case 6: return `Full house, ${PLURAL(a)} full of ${PLURAL(b)}`;
    case 5: return `Flush, ${NAME[a]} high`;
    case 4: return `Straight, ${NAME[a]} high`;
    case 3: return `Three of a kind, ${PLURAL(a)}`;
    case 2: return `Two pair, ${PLURAL(a)} and ${PLURAL(b)}`;
    case 1: return `Pair of ${PLURAL(a)}`;
    default: return `${NAME[a]} high`;
  }
}

/* ================= table ================= */
function createPoker(opts) {
  const { owe, changed, online, persist, rnd } = opts;
  // chips come from and go back to the player's casino bankroll, which the server keeps
  const take = opts.take || (() => true), give = opts.give || (() => {}), handDone = opts.handDone || (() => {});
  const now = opts.now || (() => Date.now());
  const schedule = opts.schedule || ((ms, fn) => setTimeout(fn, ms));
  const cancel = opts.cancel || (t => clearTimeout(t));
  const F = opts.timeScale || 1;
  const SEATS = 6, SB = 500, BB = 1000, MIN_BUY = 20000, MAX_BUY = 100000;
  const BOOT = Date.now().toString(36);
  const ACT_MS = 25000 * F, AWAY_MS = 6000 * F, STREET_MS = 900 * F, RUNOUT_MS = 1400 * F, SHOWDOWN_MS = 7000 * F, FOLDWIN_MS = 3000 * F, START_MS = 2500 * F;

  const T = {
    seats: Array(SEATS).fill(null), button: -1, sbSeat: -1, bbSeat: -1, handId: 0, street: 'waiting',
    deck: [], board: [], currentBet: 0, minRaise: BB, toAct: -1, deadline: 0, timer: null,
    log: [], showdown: null, lastWin: null, pending: false,
  };
  const S = i => T.seats[i];
  const seatOf = pid => T.seats.findIndex(s => s && s.pid === pid);
  const setTimer = (ms, fn) => { if (T.timer) cancel(T.timer); T.timer = schedule(ms, () => { T.timer = null; fn(); }); };
  const log = msg => { T.log.push({ h: T.handId, msg }); if (T.log.length > 60) T.log.shift(); };
  const money = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  const cardTxt = c => c.r + c.s;
  let cashId = 0;

  function saveState() {
    if (!persist) return;
    const seated = {};
    for (const s of T.seats) if (s) seated[s.pid] = { name: s.name, stack: s.stack + (s.inHand ? s.total : 0) };
    persist({ seated });
  }
  // stacks from before a server restart come back to their owners as cash-outs
  function restore(saved) {
    if (!saved || !saved.seated) return;
    for (const [pid, v] of Object.entries(saved.seated)) {
      if (v && v.stack > 0) { give(pid, Math.round(v.stack), 'Poker chips returned after a server restart'); owe(pid, { id: `pk-restore-${now()}-${cashId++}`, game: 'pk', payout: Math.round(v.stack), staked: 0, net: 0, cashout: true, notice: true }); }
    }
  }
  function cashOut(s, why) {
    if (s.stack > 0) { give(s.pid, s.stack, 'Poker cash-out'); owe(s.pid, { id: `pk-out-${now()}-${cashId++}`, game: 'pk', payout: s.stack, staked: 0, net: 0, cashout: true, why, notice: true }); }
    s.stack = 0;
  }
  const eligible = s => s && s.stack > 0 && !s.sittingOut && !s.leaving;
  function nextSeat(from, pred) {
    for (let k = 1; k <= SEATS; k++) { const i = (from + k + SEATS) % SEATS; if (pred(T.seats[i], i)) return i; }
    return -1;
  }
  const canAct = s => s && s.inHand && !s.folded && !s.allIn;
  const alive = () => T.seats.filter(s => s && s.inHand && !s.folded);

  function maybeStart() {
    if (T.street !== 'waiting' || T.pending) return;
    if (T.seats.filter(eligible).length >= 2) { T.pending = true; T.deadline = now() + START_MS; setTimer(START_MS, () => { T.pending = false; startHand(); }); changed(); }
  }
  function startHand() {
    const players = T.seats.map((s, i) => (eligible(s) ? i : -1)).filter(i => i >= 0);
    if (players.length < 2) { T.street = 'waiting'; T.deadline = 0; changed(); return; }
    T.handId++;
    T.deck = [];
    for (const s of SUITS) for (const r of RANKS) T.deck.push({ r, s });
    for (let i = T.deck.length - 1; i > 0; i--) { const j = rnd(i + 1); [T.deck[i], T.deck[j]] = [T.deck[j], T.deck[i]]; }
    T.board = []; T.showdown = null; T.lastWin = null;
    for (const s of T.seats) if (s) Object.assign(s, { inHand: false, folded: false, allIn: false, bet: 0, total: 0, hole: [], acted: false, canRaise: true, lastAction: '', won: 0, shown: false });
    for (const i of players) S(i).inHand = true;
    T.button = nextSeat(T.button, (s, i) => players.includes(i));
    if (players.length === 2) { T.sbSeat = T.button; T.bbSeat = nextSeat(T.button, (s, i) => players.includes(i)); }
    else { T.sbSeat = nextSeat(T.button, (s, i) => players.includes(i)); T.bbSeat = nextSeat(T.sbSeat, (s, i) => players.includes(i)); }
    saveState();
    log(`Hand #${T.handId} · ${S(T.button).name} has the button`);
    post(T.sbSeat, SB, 'Small blind'); post(T.bbSeat, BB, 'Big blind');
    T.currentBet = BB; T.minRaise = BB;
    // two hole cards each, one at a time, starting left of the button
    for (let round = 0; round < 2; round++) {
      let i = T.sbSeat;
      for (let k = 0; k < players.length; k++) { S(i).hole.push(T.deck.pop()); i = nextSeat(i, s => s && s.inHand); }
    }
    T.street = 'preflop';
    const first = players.length === 2 ? (canAct(S(T.sbSeat)) ? T.sbSeat : nextSeat(T.sbSeat, canAct)) : nextSeat(T.bbSeat, canAct);
    setTurn(first);
  }
  function post(i, amt, label) {
    const s = S(i), a = Math.min(amt, s.stack);
    s.stack -= a; s.bet += a; s.total += a;
    if (!s.stack) s.allIn = true;
    s.lastAction = label;
    log(`${s.name} posts the ${label.toLowerCase()} ${money(a)}`);
  }
  function setTurn(i) {
    if (i < 0 || roundDone()) { endStreet(); return; }
    T.toAct = i;
    const s = S(i);
    const ms = online(s.pid) ? ACT_MS : AWAY_MS;
    T.deadline = now() + ms;
    const hand = T.handId, street = T.street;
    setTimer(ms, () => {
      if (T.handId !== hand || T.street !== street || T.toAct !== i) return;
      s.timeouts = (s.timeouts || 0) + 1;
      if (s.timeouts >= 2) s.sittingOut = true;
      doAction(i, s.bet === T.currentBet ? 'check' : 'fold', 0, true);
    });
    changed();
  }
  function roundDone() {
    const al = alive();
    if (al.length <= 1) return true;
    const ca = al.filter(s => !s.allIn);
    if (ca.length === 0) return true;
    if (ca.length === 1 && ca[0].bet >= T.currentBet) return true;
    return ca.every(s => s.acted && s.bet === T.currentBet);
  }
  // amounts: "to" is the player's total bet for this street after the action
  function limits(i) {
    const s = S(i);
    const toCall = Math.max(0, T.currentBet - s.bet);
    const maxTo = s.bet + s.stack;
    const minTo = T.currentBet === 0 ? Math.min(BB, maxTo) : Math.min(T.currentBet + T.minRaise, maxTo);
    const canRaise = s.canRaise && s.stack > toCall && alive().some(o => o !== s && !o.allIn);
    return { toCall: Math.min(toCall, s.stack), minTo, maxTo, canRaise };
  }
  function doAction(i, type, to, auto) {
    const s = S(i), L = limits(i);
    const call = L.toCall;
    if (type === 'fold') {
      s.folded = true; s.lastAction = 'Fold';
      log(`${s.name} folds${auto ? ' (time)' : ''}`);
    } else if (type === 'check') {
      if (call > 0) return 'You can’t check, there is a bet to you.';
      s.lastAction = 'Check';
      log(`${s.name} checks${auto ? ' (time)' : ''}`);
    } else if (type === 'call') {
      if (call <= 0) return 'There is nothing to call. Check instead.';
      s.stack -= call; s.bet += call; s.total += call;
      if (!s.stack) s.allIn = true;
      s.lastAction = s.allIn ? 'All in' : 'Call';
      log(`${s.name} calls ${money(call)}${s.allIn ? ' and is all in' : ''}`);
    } else if (type === 'raise') {
      if (!L.canRaise) return 'You can only call or fold here.';
      to = Math.round(Number(to));
      if (!Number.isFinite(to)) return 'Enter an amount.';
      if (to > L.maxTo) to = L.maxTo;
      if (to < L.minTo) return `The minimum is ${money(L.minTo)}.`;
      if (to <= T.currentBet) return 'Raise above the current bet, or call.';
      const pay = to - s.bet;
      const raiseBy = to - T.currentBet;
      const wasBet = T.currentBet === 0;
      s.stack -= pay; s.bet = to; s.total += pay;
      if (!s.stack) s.allIn = true;
      if (raiseBy >= T.minRaise) {
        // full raise: reopens the betting for everyone
        T.minRaise = raiseBy;
        for (const o of T.seats) if (o && o !== s && canAct(o)) { o.acted = false; o.canRaise = true; }
      } else {
        // all-in for less than a full raise: others must respond, but players who already acted can't re-raise
        for (const o of T.seats) if (o && o !== s && canAct(o)) { if (o.acted) o.canRaise = false; o.acted = false; }
      }
      T.currentBet = to;
      s.lastAction = s.allIn ? 'All in' : wasBet ? 'Bet' : 'Raise';
      log(`${s.name} ${s.allIn ? 'goes all in for' : wasBet ? 'bets' : 'raises to'} ${money(to)}`);
    } else return 'Unknown action.';
    s.acted = true;
    if (!auto) s.timeouts = 0;
    advance(i);
    return null;
  }
  function advance(from) {
    if (alive().length === 1) { foldWin(); return; }
    if (roundDone()) { endStreet(); return; }
    const nxt = nextSeat(from, o => canAct(o) && (!o.acted || o.bet < T.currentBet));
    setTurn(nxt);
  }
  function collect() {
    for (const s of T.seats) if (s) { s.bet = 0; s.acted = false; s.canRaise = true; }
    T.currentBet = 0; T.minRaise = BB;
  }
  function endStreet() {
    T.toAct = -1; T.deadline = 0;
    if (alive().length === 1) { foldWin(); return; }
    collect();
    if (T.street === 'river') { showdown(); return; }
    const deal = n => { T.deck.pop(); for (let k = 0; k < n; k++) T.board.push(T.deck.pop()); };  // burn, then deal
    if (T.street === 'preflop') { deal(3); T.street = 'flop'; log(`Flop: ${T.board.map(cardTxt).join(' ')}`); }
    else if (T.street === 'flop') { deal(1); T.street = 'turn'; log(`Turn: ${cardTxt(T.board[3])}`); }
    else { deal(1); T.street = 'river'; log(`River: ${cardTxt(T.board[4])}`); }
    for (const s of T.seats) if (s && s.inHand && !s.folded && !s.allIn) s.lastAction = '';
    changed();
    const ca = alive().filter(s => !s.allIn);
    if (ca.length <= 1) {
      // everyone left is all in: show the hands and run out the board
      for (const s of alive()) s.shown = true;
      setTimer(RUNOUT_MS, endStreet);
      return;
    }
    const hand = T.handId;
    setTimer(STREET_MS, () => { if (T.handId === hand) setTurn(nextSeat(T.button, canAct)); });
  }
  // side pots from each player's total contribution; folded chips count but can't win
  function buildPots() {
    const rem = new Map(T.seats.filter(s => s && s.total > 0).map(s => [s, s.total]));
    const pots = [];
    while (true) {
      const live = [...rem].filter(([s, a]) => a > 0 && !s.folded);
      if (!live.length) break;
      const m = Math.min(...live.map(([, a]) => a));
      let amount = 0;
      for (const [s, a] of rem) { const take = Math.min(a, m); amount += take; rem.set(s, a - take); }
      pots.push({ amount, eligible: live.map(([s]) => s) });
    }
    const left = [...rem.values()].reduce((a, b) => a + b, 0);
    if (left && pots.length) pots[pots.length - 1].amount += left;
    return pots;
  }
  function foldWin() {
    T.toAct = -1; T.deadline = 0;
    const w = alive()[0];
    const pot = T.seats.reduce((a, s) => a + (s ? s.total : 0), 0);
    w.stack += pot; w.won = pot;
    log(`${w.name} wins ${money(pot)}`);
    T.lastWin = { seats: [T.seats.indexOf(w)], amount: pot, text: `${w.name} wins ${money(pot)}` };
    T.showdown = { results: [], pots: [{ amount: pot, winners: [T.seats.indexOf(w)], hand: '' }], uncontested: true };
    finish(FOLDWIN_MS);
  }
  function showdown() {
    T.street = 'showdown'; T.toAct = -1; T.deadline = 0;
    const al = alive();
    const ranked = new Map(al.map(s => [s, best([...s.hole, ...T.board])]));
    for (const s of al) s.shown = true;
    const pots = buildPots();
    const out = [];
    const order = [];
    for (let k = 1; k <= SEATS; k++) order.push((T.button + k) % SEATS);     // odd chips go left of the button first
    pots.forEach((p, pi) => {
      let top = null;
      for (const s of p.eligible) { const r = ranked.get(s).rank; if (!top || cmp(r, top) > 0) top = r; }
      const winners = p.eligible.filter(s => cmp(ranked.get(s).rank, top) === 0)
        .sort((a, b) => order.indexOf(T.seats.indexOf(a)) - order.indexOf(T.seats.indexOf(b)));
      const share = Math.floor(p.amount / winners.length);
      let odd = p.amount - share * winners.length;
      for (const w of winners) { const extra = odd > 0 ? 1 : 0; odd -= extra; w.stack += share + extra; w.won += share + extra; }
      const label = pots.length === 1 ? 'the pot' : pi === 0 ? 'the main pot' : `side pot ${pi}`;
      const hand = ranked.get(winners[0]).name;
      log(winners.length > 1 ? `${winners.map(w => w.name).join(' and ')} split ${label} (${money(p.amount)}) with ${hand}` : `${winners[0].name} wins ${label} (${money(p.amount)}) with ${hand}`);
      out.push({ amount: p.amount, winners: winners.map(w => T.seats.indexOf(w)), hand, label });
    });
    T.showdown = {
      results: al.map(s => ({ seat: T.seats.indexOf(s), hand: ranked.get(s).name, cards: ranked.get(s).cards, cat: ranked.get(s).rank[0] })),
      pots: out, uncontested: false,
    };
    const top = out[0];
    T.lastWin = { seats: [...new Set(out.flatMap(p => p.winners))], amount: out.reduce((a, p) => a + p.amount, 0), text: out.length === 1 && top.winners.length === 1 ? `${S(top.winners[0]).name} wins ${money(top.amount)} with ${top.hand}` : out.map(p => `${p.winners.map(w => S(w).name).join(' & ')} ${p.winners.length > 1 ? 'split' : 'win' + (p.winners.length === 1 ? 's' : '')} ${money(p.amount)}`).join(' · ') };
    finish(SHOWDOWN_MS);
  }
  function finish(ms) {
    T.street = T.street === 'showdown' ? 'showdown' : 'done';
    T.handResult = T.handId;
    // hand history per player (for their stats)
    for (const s of T.seats) if (s && s.inHand) { handDone(s.pid, s.total, s.won); owe(s.pid, { id: `pk-hand-${BOOT}-${T.handId}`, game: 'pk', payout: 0, staked: s.total, net: s.won - s.total, hand: true }); }
    changed();
    const hand = T.handId;
    setTimer(ms, () => { if (T.handId === hand) cleanup(); });
  }
  function cleanup() {
    T.seats.forEach((s, i) => {
      if (!s) return;
      s.inHand = false; s.bet = 0; s.total = 0; s.hole = []; s.folded = false; s.allIn = false; s.lastAction = ''; s.shown = false;
      if (s.leaving || (!online(s.pid) && now() - (s.lastSeen || 0) > 60000 * Math.max(F, 0.001))) { cashOut(s, 'left'); T.seats[i] = null; }
    });
    T.board = []; T.showdown = null; T.street = 'waiting'; T.toAct = -1; T.deadline = 0; T.currentBet = 0;
    saveState();
    changed();
    maybeStart();
  }

  /* -------- player actions -------- */
  function action(pid, name, body) {
    const a = String(body.action || '');
    const i = seatOf(pid), s = i >= 0 ? S(i) : null;
    const err = (m, code = 409) => ({ code, body: { error: m } });
    const ok = (extra = {}) => { changed(); return { code: 200, body: Object.assign({ ok: true }, extra) }; };
    if (s) { s.name = name; s.lastSeen = now(); }
    if (a === 'sit') {
      const want = Number(body.seat), buy = Math.round(Number(body.buyIn));
      if (!Number.isInteger(want) || want < 0 || want >= SEATS) return err('Pick a seat.', 400);
      if (s) return err('You already have a seat.');
      if (T.seats[want]) return err('Someone just took that seat.');
      if (!(buy >= MIN_BUY && buy <= MAX_BUY)) return err(`Buy in for ${money(MIN_BUY)} to ${money(MAX_BUY)}.`, 400);
      if (!take(pid, buy, 'Poker buy-in')) return err('Not enough in your bankroll.');
      T.seats[want] = { pid, name, stack: buy, inHand: false, folded: false, allIn: false, bet: 0, total: 0, hole: [], acted: false, canRaise: true, lastAction: '', sittingOut: false, leaving: false, timeouts: 0, lastSeen: now(), won: 0 };
      log(`${name} sits down with ${money(buy)}`);
      saveState();
      const r = ok({ charge: buy });
      maybeStart();
      return r;
    }
    if (!s) return err('Take a seat first.');
    if (a === 'leave') {
      const playing = ['preflop', 'flop', 'turn', 'river'].includes(T.street);
      if (s.inHand && !s.folded && !s.allIn && playing) {
        s.leaving = true;
        if (T.toAct === i) doAction(i, 'fold', 0, true);
        else {
          s.folded = true; s.lastAction = 'Fold'; log(`${s.name} folds and leaves`);
          if (alive().length === 1) foldWin();
          else if (T.toAct >= 0 && roundDone()) endStreet();
        }
        return ok({ leaving: true });
      }
      if (s.inHand) { s.leaving = true; return ok({ leaving: true }); }
      const refund = s.stack;
      give(pid, refund, 'Poker cash-out');
      log(`${s.name} leaves with ${money(refund)}`);
      T.seats[i] = null; saveState();
      return ok({ refund });
    }
    if (a === 'rebuy') {
      if (s.inHand) return err('Wait for this hand to finish.');
      const amt = Math.round(Number(body.amount));
      if (!(amt >= 100) || s.stack + amt > MAX_BUY) return err(`Your stack can go up to ${money(MAX_BUY)}.`, 400);
      if (!take(pid, amt, 'Poker chips added')) return err('Not enough in your bankroll.');
      s.stack += amt; s.sittingOut = false; s.timeouts = 0;
      log(`${s.name} adds ${money(amt)}`);
      saveState();
      const r = ok({ charge: amt });
      maybeStart();
      return r;
    }
    if (a === 'sitout') { s.sittingOut = !!body.value; if (!s.sittingOut) s.timeouts = 0; const r = ok(); maybeStart(); return r; }
    if (['fold', 'check', 'call', 'raise'].includes(a)) {
      if (T.toAct !== i || !['preflop', 'flop', 'turn', 'river'].includes(T.street)) return err("It isn't your turn.");
      const e = doAction(i, a, body.to);
      return e ? err(e) : ok();
    }
    return err('Unknown action.', 400);
  }
  function view(pid) {
    const me = seatOf(pid);
    const inPlay = ['preflop', 'flop', 'turn', 'river'].includes(T.street);
    const pots = inPlay || T.street === 'showdown' || T.street === 'done' ? buildPots().map(p => p.amount) : [];
    const collected = T.seats.reduce((a, s) => a + (s ? s.total - s.bet : 0), 0);
    return {
      game: 'pk', now: now(), handId: T.handId, street: T.street, board: T.board, toAct: T.toAct, deadline: T.deadline,
      button: T.button, sb: T.sbSeat, bb: T.bbSeat, blinds: { sb: SB, bb: BB }, buyIn: { min: MIN_BUY, max: MAX_BUY },
      currentBet: T.currentBet, collected, pots, starting: T.pending,
      seats: T.seats.map((s, i) => s && {
        name: s.name, stack: s.stack, bet: s.bet, folded: s.folded, allIn: s.allIn, inHand: s.inHand, sittingOut: s.sittingOut,
        leaving: s.leaving, lastAction: s.lastAction, online: online(s.pid), me: i === me, won: s.won || 0,
        cards: s.inHand ? (i === me || s.shown ? s.hole : s.folded ? [] : s.hole.map(() => null)) : [],
      }),
      showdown: T.showdown, lastWin: T.lastWin, log: T.log.slice(-14),
      me: me >= 0 && T.toAct === me && inPlay ? Object.assign({ seat: me }, limits(me)) : { seat: me },
    };
  }
  function summary() { return { seated: T.seats.filter(Boolean).length, seats: SEATS, street: T.street }; }
  function tick() {
    // players who closed the page between hands are cashed out after a minute
    if (T.street !== 'waiting') return;
    let any = false;
    T.seats.forEach((s, i) => {
      if (s && !online(s.pid) && now() - (s.lastSeen || 0) > 60000 * Math.max(F, 0.001)) { cashOut(s, 'away'); T.seats[i] = null; any = true; }
    });
    if (any) { saveState(); changed(); }
  }
  function seen(pid) { const i = seatOf(pid); if (i >= 0) S(i).lastSeen = now(); }
  return { action, view, summary, restore, tick, seen, maybeStart, _T: T, _buildPots: buildPots };
}

module.exports = { createPoker, best, rank5, cmp, describe, RANKS, SUITS };
