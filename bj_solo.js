// Brass Table Blackjack, played on the server: the server shuffles, deals, and pays.
// It follows the same rules as the blackjack page, step for step, so the page can animate the cards it is sent.
// All money is in cents.
'use strict';
const MIN = 500, MAX = 100000, SIDE_MAX = 10000;
const SUITS = ['♠', '♥', '♦', '♣'], RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const DECKS = [1, 2, 4, 6, 8];
const pts = r => (r === 'A' ? 11 : ['J', 'Q', 'K', '10'].includes(r) ? 10 : +r);
const splitVal = r => (r === 'A' ? 1 : Math.min(10, pts(r)));
function total(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { if (c.r === 'A') { aces++; t += 1; } else t += pts(c.r); }
  const soft = aces > 0 && t + 10 <= 21;
  return { total: soft ? t + 10 : t, soft, low: t };
}
const isBJ = h => h.cards.length === 2 && !h.fromSplit && total(h.cards).total === 21;
const isRed = s => s === '♥' || s === '♦';
function evalPP(a, b) {
  if (a.r !== b.r) return null;
  if (a.s === b.s) return { label: 'Perfect pair', mult: 25 };
  if (isRed(a.s) === isRed(b.s)) return { label: 'Coloured pair', mult: 12 };
  return { label: 'Mixed pair', mult: 6 };
}
function eval213(a, b, c) {
  const cs = [a, b, c];
  const flush = cs.every(x => x.s === a.s), trips = cs.every(x => x.r === a.r);
  const v = cs.map(x => RANKS.indexOf(x.r) + 1).sort((x, y) => x - y);
  const straight = !trips && ((v[1] === v[0] + 1 && v[2] === v[1] + 1) || (v[0] === 1 && v[1] === 12 && v[2] === 13));
  if (trips && flush) return { label: 'Suited trips', mult: 100 };
  if (straight && flush) return { label: 'Straight flush', mult: 40 };
  if (trips) return { label: 'Three of a kind', mult: 30 };
  if (straight) return { label: 'Straight', mult: 10 };
  if (flush) return { label: 'Flush', mult: 5 };
  return null;
}
function evalLL(a, b, dBJ) {
  if (total([a, b]).total !== 20) return null;
  const qh = x => x.r === 'Q' && x.s === '♥';
  if (qh(a) && qh(b)) return dBJ ? { label: 'Q♥ pair + dealer blackjack', mult: 1000 } : { label: 'Pair of Q♥', mult: 125 };
  if (a.r === b.r && a.s === b.s) return { label: 'Matched 20', mult: 19 };
  if (a.s === b.s) return { label: 'Suited 20', mult: 9 };
  return { label: 'Any 20', mult: 4 };
}
const newHand = bet => ({ cards: [], bet, done: false, bust: false, doubled: false, fromSplit: false, splitAces: false, surrendered: false, evenMoney: false, result: null });

// wallet: { bal() , debit(c) -> bool, credit(c) }   rnd(n): whole number 0..n-1
function createSession() {
  return { decks: 6, shoe: [], shoeSize: 0, cutAt: 0, dealt: 0, shuffleDue: true, round: null };
}
function buildShoe(S, rnd) {
  const a = [];
  for (let d = 0; d < S.decks; d++) for (const s of SUITS) for (const r of RANKS) a.push({ r, s });
  for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  S.shoe = a; S.shoeSize = a.length; S.dealt = 0;
  S.cutAt = Math.floor(a.length * (S.decks === 1 ? 0.6 : 0.75)) + rnd(Math.max(1, Math.floor(a.length * 0.05)));
  S.shuffleDue = false;
}

function play(S, action, body, wallet, rnd, limits) {
  const LIM = limits || { max: MAX, sideMax: SIDE_MAX };
  let R = S.round;
  const log = [];                                  // cards in the order they were drawn: { to: 'p'|'d', hand, card }
  const err = m => ({ error: m });
  const draw = () => {
    if (!S.shoe.length) buildShoe(S, rnd);
    const c = S.shoe.pop();
    S.dealt++;
    if (S.dealt >= S.cutAt) S.shuffleDue = true;
    return c;
  };
  // luck (admin only): with a bias set, the card that comes off the shoe is the best (or worst) of the next few
  const drawFor = score => {
    const B = S.bias;
    if (!B || !B.look || Math.random() >= B.chance) return draw();
    if (!S.shoe.length) buildShoe(S, rnd);
    const n = Math.min(B.look, S.shoe.length);
    let bi = S.shoe.length - 1, bs = -Infinity;
    for (let k = 0; k < n; k++) { const idx = S.shoe.length - 1 - k, v = score(S.shoe[idx]) * B.dir; if (v > bs) { bs = v; bi = idx; } }
    const c = S.shoe.splice(bi, 1)[0];
    S.dealt++; if (S.dealt >= S.cutAt) S.shuffleDue = true;
    return c;
  };
  const forPlayer = h => c => { const t = total(h.cards.concat([c])).total; return t > 21 ? -50 : t; };
  const forDealer = () => c => {
    const t = total(R.dealer.concat([c])).total;
    if (t > 21) return 50;
    if (R.dealer.length < 1) return -t;
    const best = Math.max(0, ...R.hands.filter(h => !h.bust && !h.surrendered).map(h => total(h.cards).total).filter(x => x <= 21));
    return t >= 17 && t >= best ? -30 - t : -t / 4;
  };
  const cur = () => R.hands[R.active];
  const give = (h, i) => { const c = drawFor(forPlayer(h)); h.cards.push(c); log.push({ to: 'p', hand: i, card: c }); return c; };
  const giveD = () => { const c = drawFor(forDealer()); R.dealer.push(c); log.push({ to: 'd', card: c }); return c; };
  const dealerBJ = () => R.dealer.length === 2 && total(R.dealer).total === 21;
  let shuffled = false;

  function settle() {
    const d = total(R.dealer), dBJ = dealerBJ(), dBust = d.total > 21;
    let paid = 0;
    R.hands.forEach(h => {
      const t = total(h.cards).total, stake = h.bet;
      let pay = 0, label;
      if (h.evenMoney) { pay = stake * 2; label = 'Even money'; }
      else if (h.surrendered) { pay = stake / 2; label = 'Surrendered'; }
      else if (isBJ(h)) { if (dBJ) { pay = stake; label = 'Push'; } else { pay = stake * 2.5; label = 'Blackjack'; } }
      else if (h.bust) label = 'Bust';
      else if (dBJ) label = 'Dealer blackjack';
      else if (dBust || t > d.total) { pay = stake * 2; label = 'Win'; }
      else if (t === d.total) { pay = stake; label = 'Push'; }
      else label = 'Lose';
      h.result = { label, pay, delta: pay - stake };
      h.done = true;
      paid += pay;
    });
    if (R.insurance && dBJ) paid += R.insurance * 3;
    if (R.sides.ll) {
      const res = evalLL(R.firstTwo[0], R.firstTwo[1], dBJ);
      R.sideRes.ll = res ? { label: res.label, mult: res.mult, win: true } : { win: false };
      if (res) paid += R.sides.ll * (res.mult + 1);
    }
    paid = Math.round(paid);
    wallet.credit(paid);
    R.paid += paid;
    R.phase = 'done';
    R.hole = false;
  }
  function dealerTurn() {
    R.hole = false;
    const live = R.hands.some(h => !h.bust && !h.surrendered);
    if (live) {
      const shouldHit = () => { const t = total(R.dealer); return t.total < 17 || (R.h17 && t.total === 17 && t.soft); };
      while (shouldHit()) giveD();
    }
    settle();
  }
  function next() {
    R.active++;
    while (R.active < R.hands.length) {
      const h = R.hands[R.active];
      if (h.cards.length === 1) give(h, R.active);
      if (h.splitAces || total(h.cards).total === 21) { h.done = true; R.active++; continue; }
      return;
    }
    R.active = R.hands.length - 1;
    dealerTurn();
  }
  function startPlay() {
    R.phase = 'play'; R.active = 0;
    const h = cur();
    if (total(h.cards).total === 21) { h.done = true; next(); }
  }
  function afterDeal() {
    const up = R.dealer[0], h = R.hands[0];
    if (up.r === 'A') { R.phase = 'insurance'; return; }
    if (pts(up.r) === 10) { R.peeked = true; if (dealerBJ()) { R.hole = false; return settle(); } }
    if (isBJ(h)) { R.hole = false; return settle(); }
    startPlay();
  }

  if (action === 'deal') {
    if (R && R.phase !== 'done') return err('Finish this hand first.');
    const bet = Math.round(Number(body.bet));
    const sidesOn = body.sidesOn !== false;
    const sides = { pp: 0, t21: 0, ll: 0 };
    for (const k of Object.keys(sides)) {
      const v = Math.round(Number((body.sides || {})[k] || 0));
      if (!(v >= 0 && v <= LIM.sideMax) || v % 100) return err(`Side bets are $1 to $${LIM.sideMax / 100}.`);
      if (v && !sidesOn) return err('Side bets are switched off.');
      sides[k] = v;
    }
    if (!(bet >= MIN && bet <= LIM.max) || bet % 100) return err(`The main bet is $5 to $${(LIM.max / 100).toLocaleString('en-US')}.`);
    const decks = Math.round(Number(body.decks) || 6);
    if (!DECKS.includes(decks)) return err('Pick a shoe of 1, 2, 4, 6 or 8 decks.');
    const stake = bet + sides.pp + sides.t21 + sides.ll;
    if (!wallet.debit(stake)) return err('Not enough in your bankroll.');
    if (decks !== S.decks) { S.decks = decks; S.shuffleDue = true; }
    if (S.shuffleDue || !S.shoe.length) { shuffled = S.shoeSize > 0 || S.dealt > 0; buildShoe(S, rnd); }
    const h = newHand(bet);
    S.round = {
      id: (R ? R.id : 0) + 1, hands: [h], dealer: [], hole: true, active: 0, phase: 'deal', insurance: 0,
      sides, sideRes: {}, firstTwo: null, h17: !!body.h17, surrender: body.surrender !== false, staked: stake, paid: 0, peeked: false,
    };
    R = S.round;
    for (const who of ['p', 'd', 'p', 'd']) who === 'p' ? give(h, 0) : giveD();
    R.firstTwo = h.cards.slice(0, 2);
    const up = R.dealer[0];
    if (R.sides.pp) { const res = evalPP(R.firstTwo[0], R.firstTwo[1]); R.sideRes.pp = res ? { label: res.label, mult: res.mult, win: true } : { win: false }; if (res) { const p = R.sides.pp * (res.mult + 1); wallet.credit(p); R.paid += p; } }
    if (R.sides.t21) { const res = eval213(R.firstTwo[0], R.firstTwo[1], up); R.sideRes.t21 = res ? { label: res.label, mult: res.mult, win: true } : { win: false }; if (res) { const p = R.sides.t21 * (res.mult + 1); wallet.credit(p); R.paid += p; } }
    afterDeal();
    const v = view(S, log);
    v.shuffled = shuffled;
    return v;
  }
  if (!R) return err('Deal a hand first.');
  if (action === 'insurance') {
    if (R.phase !== 'insurance') return err('Insurance is only offered when the dealer shows an ace.');
    const take = !!body.take;
    const h = R.hands[0], pBJ = isBJ(h);
    R.peeked = true;
    if (take && pBJ) { h.evenMoney = true; R.hole = false; settle(); return view(S, log); }
    if (take) { const cost = h.bet / 2; if (wallet.debit(cost)) { R.insurance = cost; R.staked += cost; } }
    if (dealerBJ()) { R.hole = false; settle(); return view(S, log); }
    R.insuranceLost = R.insurance;
    if (pBJ) { R.hole = false; settle(); return view(S, log); }
    startPlay();
    return view(S, log);
  }
  if (R.phase !== 'play') return err(R.phase === 'done' ? 'This hand is over. Deal again.' : 'Answer insurance first.');
  const h = cur();
  if (!h) return err('No hand to play.');
  if (action === 'hit') {
    give(h, R.active);
    const t = total(h.cards).total;
    if (t > 21) { h.bust = true; h.done = true; next(); }
    else if (t === 21) { h.done = true; next(); }
    return view(S, log);
  }
  if (action === 'stand') { h.done = true; next(); return view(S, log); }
  if (action === 'double') {
    if (h.cards.length !== 2 || h.splitAces) return err('You can only double on your first two cards.');
    if (!wallet.debit(h.bet)) return err('Not enough in your bankroll to double.');
    R.staked += h.bet;
    h.bet *= 2; h.doubled = true;
    give(h, R.active);
    if (total(h.cards).total > 21) h.bust = true;
    h.done = true;
    next();
    return view(S, log);
  }
  if (action === 'split') {
    // unlimited splits: any pair can be split again, as long as there's money for the extra bet
    if (h.cards.length !== 2 || h.splitAces || splitVal(h.cards[0].r) !== splitVal(h.cards[1].r)) return err('You can only split a pair.');
    if (!wallet.debit(h.bet)) return err('Not enough in your bankroll to split.');
    R.staked += h.bet;
    const moved = h.cards.pop();
    const nh = newHand(h.bet);
    nh.cards = [moved]; nh.fromSplit = true; h.fromSplit = true;
    if (h.cards[0].r === 'A') { h.splitAces = true; nh.splitAces = true; }
    R.hands.splice(R.active + 1, 0, nh);
    give(h, R.active);
    if (h.splitAces || total(h.cards).total === 21) { h.done = true; next(); }
    return view(S, log);
  }
  if (action === 'surrender') {
    if (!R.surrender || R.hands.length !== 1 || h.cards.length !== 2 || h.fromSplit) return err('Surrender is only allowed on your first two cards.');
    h.surrendered = true; h.done = true;
    next();
    return view(S, log);
  }
  return err('Unknown move.');
}
// what the page is allowed to see: the hole card stays hidden until it is turned over
function view(S, log) {
  const R = S.round;
  const hideHole = R.hole && R.phase !== 'done';
  return {
    round: R.id, phase: R.phase, active: R.active, insurance: R.insurance, insuranceLost: R.insuranceLost || 0,
    hands: R.hands.map(h => ({ cards: h.cards, bet: h.bet, done: h.done, bust: h.bust, doubled: h.doubled, fromSplit: h.fromSplit, splitAces: h.splitAces, surrendered: h.surrendered, evenMoney: h.evenMoney, result: h.result })),
    dealer: hideHole ? [R.dealer[0], null] : R.dealer,
    hole: hideHole,
    dealerBJ: R.peeked || R.phase === 'done' ? (R.dealer.length === 2 && total(R.dealer).total === 21) : null,
    sideRes: R.sideRes,
    drawn: log.map(e => (e.to === 'd' && hideHole && R.dealer.indexOf(e.card) === 1 ? { to: 'd', card: null } : e)),
    shoeLeft: S.shoe.length, shoeSize: S.shoeSize, shuffleDue: S.shuffleDue, decks: S.decks,
    staked: R.staked, paid: R.paid,
  };
}
// a hand left unfinished (page closed): stand everything and settle
function finishAbandoned(S, wallet, rnd) {
  const R = S.round;
  if (!R || R.phase === 'done') return null;
  let v = null;
  if (R.phase === 'insurance') v = play(S, 'insurance', { take: false }, wallet, rnd);
  let guard = 0;
  while (S.round.phase === 'play' && guard++ < 10) v = play(S, 'stand', {}, wallet, rnd);
  return v;
}
module.exports = { createSession, play, view, finishAbandoned, total, isBJ, MIN, MAX, SIDE_MAX, DECKS };
