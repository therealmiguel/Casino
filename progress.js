// Progression and casino-wide extras: XP and levels, achievements, daily bonus and challenges,
// the shared progressive jackpot, happy hour events, monthly seasons, the weekly tournament and tips.
// Everything here runs on the server; pages only show it.
'use strict';
const crypto = require('crypto');
const TZ = 'Europe/Vienna';

/* ---------- time in Vienna ---------- */
const partsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function vienna(t = Date.now()) {
  const p = {}; for (const x of partsFmt.formatToParts(new Date(t))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute };
}
const pad = n => String(n).padStart(2, '0');
const dayKey = (t = Date.now()) => { const v = vienna(t); return `${v.y}-${pad(v.m)}-${pad(v.d)}`; };
// the moment it is midnight in Vienna on a given date
function viennaMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  const v = vienna(guess);
  const offset = Date.UTC(v.y, v.m - 1, v.d, v.h, v.min) - guess;
  return guess - offset;
}
function nextMonthStart(t = Date.now()) { const v = vienna(t); return v.m === 12 ? viennaMidnight(v.y + 1, 1, 1) : viennaMidnight(v.y, v.m + 1, 1); }
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function weekOf(t = Date.now()) {
  const v = vienna(t);
  const date = new Date(Date.UTC(v.y, v.m - 1, v.d));
  const dow = (date.getUTCDay() + 6) % 7;                    // Monday = 0
  const monday = new Date(date); monday.setUTCDate(date.getUTCDate() - dow);
  const thursday = new Date(monday); thursday.setUTCDate(monday.getUTCDate() + 3);
  const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
  const start = viennaMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
  const nm = new Date(monday); nm.setUTCDate(monday.getUTCDate() + 7);
  const end = viennaMidnight(nm.getUTCFullYear(), nm.getUTCMonth() + 1, nm.getUTCDate());
  return { key: `${thursday.getUTCFullYear()}-W${pad(wk)}`, start, end };
}

/* ---------- levels ---------- */
const levelOf = xp => Math.floor(Math.sqrt(Math.max(0, xp) / 100));
const xpFor = L => 100 * L * L;
const VIP_LEVEL = 10;

/* ---------- achievements ---------- */
const ACH = [
  ['first', '🎲', 'First steps', 'Play your first round'],
  ['natural', '🂡', 'Blackjack!', 'Get a natural blackjack'],
  ['split-win', '✂️', 'Split decision', 'Split a pair and win'],
  ['insured', '🛡️', 'Saved by insurance', 'Win an insurance bet'],
  ['lightning', '⚡', 'Lightning strikes', 'Win on a lightning number at roulette'],
  ['lightning-500', '🌩️', '500× bolt', 'Hit a 500× lightning number'],
  ['point-made', '🎯', 'Point maker', 'Make a point at craps'],
  ['hot-shooter', '🔥', 'Hot shooter', 'Make 3 points in one craps hand'],
  ['hold-blast', '💥', 'Hold & Blast', 'Start the Hold & Blast bonus'],
  ['grand', '👑', 'Grand!', 'Win the Grand jackpot in Dynamite Diggers'],
  ['free-spins', '🎰', 'Bonus round', 'Trigger free spins on a slot'],
  ['cascade-5', '🌀', 'Chain reaction', 'Get 5 cascades in one spin of Cosmic Cascade'],
  ['wheel', '🎡', 'Spin the wheel', 'Reach the prize wheel in Cosmic Cascade'],
  ['crash-10', '🚀', 'To the moon', 'Cash out at 10× or more in Crash'],
  ['crash-50', '💎', 'Diamond hands', 'Cash out at 50× or more in Crash'],
  ['skyline', '🏙️', 'Skyline', 'Win 100× or more in Dice City'],
  ['wizard-win', '🧙', 'Archmage', 'Win a game of Wizard'],
  ['book', '📜', 'Book worm', 'Open the book and start free spins in Tomb of Amun-Ra'],
  ['road-10', '🐔', 'Why did the chicken…', 'Cash out at 10× or more in Cluck Crossing'],
  ['crossed', '🏁', 'The other side', 'Get the chicken all the way across the road'],
  ['mines-10', '💣', 'Minesweeper', 'Clear 10 safe tiles in one Mines game'],
  ['plinko-edge', '🔻', 'Edge of glory', 'Land in an outside Plinko bucket'],
  ['natural-9', '9️⃣', 'Natural nine', 'Win a baccarat bet with a natural 9'],
  ['tie-win', '🤝', 'Tie breaker', 'Win a tie bet at baccarat'],
  ['pot-500', '🦈', 'Poker shark', 'Win a Hold’em pot of $500 or more'],
  ['high-roller', '💼', 'High roller', 'Bet $1,000 or more on one round'],
  ['big-win', '💰', 'Big win', 'Win $5,000 or more in one round'],
  ['mega-win', '🏦', 'Mega win', 'Win $50,000 or more in one round'],
  ['millionaire', '🤑', 'Millionaire', 'Reach $1,000,000'],
  ['comeback', '📈', 'Comeback kid', 'Reach $5,000 after a reset'],
  ['streak-7', '📅', 'Regular', 'Claim the daily bonus 7 days in a row'],
  ['challenger', '✅', 'Challenger', 'Finish all three daily challenges in one day'],
  ['social', '🎁', 'Generous', 'Send chips to a friend'],
  ['jackpot', '🏆', 'Jackpot!', 'Win the progressive Mega Jackpot'],
  ['podium', '🥇', 'Podium', 'Finish top 3 in a weekly tournament'],
  ['champion', '🌟', 'Season champion', 'Finish a season at number 1'],
  ['level-10', '💠', 'VIP', 'Reach level 10'],
  ['level-25', '🔱', 'Legend', 'Reach level 25'],
].map(([k, icon, name, desc]) => ({ k, icon, name, desc }));
const ACH_BY = Object.fromEntries(ACH.map(a => [a.k, a]));

/* ---------- daily challenges ---------- */
const BJ_GAMES = ['blackjack', 'live-bj'], RL_GAMES = ['roulette', 'live-rl'], SLOT_GAMES = ['slots', 'slots2', 'book'];
const CHALLENGES = [
  { id: 'bj-win', text: 'Win 3 rounds of blackjack', target: 3, tier: 1, inc: e => (BJ_GAMES.includes(e.game) && e.paid > e.staked ? 1 : 0) },
  { id: 'slot-30', text: 'Spin the slots 30 times', target: 30, tier: 1, inc: e => (SLOT_GAMES.includes(e.game) ? 1 : 0) },
  { id: 'rl-win', text: 'Win 5 roulette spins', target: 5, tier: 1, inc: e => (RL_GAMES.includes(e.game) && e.paid > e.staked ? 1 : 0) },
  { id: 'craps-20', text: 'Roll the dice 20 times at craps', target: 20, tier: 1, inc: e => (e.game === 'craps' ? 1 : 0) },
  { id: 'point', text: 'Make a point at craps', target: 1, tier: 2, inc: e => (e.tags.includes('point-made') ? 1 : 0) },
  { id: 'win-250', text: 'Win $250 in total today', target: 250, tier: 2, inc: e => Math.max(0, (e.paid - e.staked) / 100) },
  { id: 'bet-2000', text: 'Bet $2,000 in total', target: 2000, tier: 2, inc: e => e.staked / 100 },
  { id: 'plinko-10', text: 'Drop 10 Plinko balls', target: 10, tier: 1, inc: e => (e.game === 'plinko' ? 1 : 0) },
  { id: 'mines-5', text: 'Clear 5 tiles in one Mines game', target: 1, tier: 2, inc: e => (e.tags.includes('mines-5') ? 1 : 0) },
  { id: 'crash-2x', text: 'Cash out at 2× or more in Crash, 3 times', target: 3, tier: 2, inc: e => (e.tags.includes('crash-2x') ? 1 : 0) },
  { id: 'bacc-5', text: 'Play 5 hands of baccarat', target: 5, tier: 1, inc: e => (e.game === 'live-bc' ? 1 : 0) },
  { id: 'poker-10', text: 'Play 10 hands of Hold’em', target: 10, tier: 2, inc: e => (e.game === 'poker' ? 1 : 0) },
  { id: 'natural', text: 'Get a blackjack', target: 1, tier: 3, inc: e => (e.tags.includes('natural') ? 1 : 0) },
  { id: 'bonus', text: 'Trigger a slot bonus', target: 1, tier: 3, inc: e => (e.tags.includes('bonus') ? 1 : 0) },
  { id: 'big-10x', text: 'Win 10× your bet in one round', target: 1, tier: 3, inc: e => (e.staked > 0 && e.paid >= e.staked * 10 ? 1 : 0) },
];
const REWARD = { 1: [15000, 100], 2: [30000, 200], 3: [60000, 400] };   // cents, XP
const DAILY = [10000, 20000, 30000, 40000, 50000, 70000, 100000];       // $100 … $1,000

function seeded(str) { const h = crypto.createHash('sha256').update(str).digest(); let i = 0; return () => h[i++ % h.length] / 256; }
function challengesFor(day) {
  const r = seeded('miguels-casino-' + day), pick = [];
  const pool = CHALLENGES.slice();
  // one easy, one medium, one hard each day
  for (const tier of [1, 2, 3]) { const opts = pool.filter(c => c.tier === tier); pick.push(opts[Math.floor(r() * opts.length)]); }
  return pick;
}

module.exports = function createProgress(A, opts) {
  const M = opts.meta;
  const save = opts.save || (() => {});
  const announce = opts.announce || (() => {});
  const flag = opts.flag || (() => {});
  M.jackpot = Object.assign({ pool: 500000, seed: 500000, last: null }, M.jackpot || {});
  M.events = Object.assign({ boost: null, xp: null }, M.events || {});
  M.season = M.season || { n: 1, start: Date.now(), end: nextMonthStart() };
  M.hall = M.hall || [];
  M.tour = M.tour || null;
  M.tourHistory = M.tourHistory || [];
  M.tourPrizes = M.tourPrizes || [2500000, 1000000, 500000];
  const TOUR_START = 100000;
  const tourNow = () => { const w = weekOf(); if (!M.tour || M.tour.week !== w.key) M.tour = { week: w.key, start: w.start, end: w.end }; return M.tour; };
  tourNow();

  const life = rec => (rec.life = Object.assign({ xp: 0, ach: {}, gs: {}, trophies: [], best: 0 }, rec.life || {}));
  const pop = (rec, item) => { rec.pop = rec.pop || []; rec.pop.push(item); if (rec.pop.length > 12) rec.pop.shift(); };
  const active = ev => ev && ev.until > Date.now();
  function unlock(id, rec, k) {
    const L = life(rec);
    if (L.ach[k] || !ACH_BY[k]) return;
    L.ach[k] = Date.now();
    const a = ACH_BY[k];
    pop(rec, { type: 'ach', icon: a.icon, title: a.name, text: a.desc });
    A.touch(id);
  }
  function addXp(id, rec, xp) {
    const L = life(rec);
    const mult = active(M.events.xp) ? M.events.xp.mult : 1;
    const before = levelOf(L.xp);
    L.xp += xp * mult;
    const after = levelOf(L.xp);
    if (after > before) {
      pop(rec, { type: 'level', icon: '⭐', title: `Level ${after}`, text: after >= VIP_LEVEL && before < VIP_LEVEL ? 'You unlocked VIP: higher table limits everywhere.' : 'Keep playing to level up.' });
      if (after >= 10) unlock(id, rec, 'level-10');
      if (after >= 25) unlock(id, rec, 'level-25');
    }
  }
  function sample(id, rec, force) {
    rec.hist = rec.hist || [];
    const last = rec.hist[rec.hist.length - 1], c = A.cash(id), now = Date.now();
    if (!force && last && now - last[0] < 10 * 60000 && Math.abs(c - last[1]) < Math.max(20000, last[1] * 0.2)) { if (now - last[0] < 10 * 60000) last[1] = c; return; }
    rec.hist.push([now, c]);
    if (rec.hist.length > 300) rec.hist.splice(0, rec.hist.length - 300);
  }
  function challengeState(rec) {
    const day = dayKey();
    if (!rec.ch || rec.ch.day !== day) rec.ch = { day, prog: [0, 0, 0], claimed: [false, false, false] };
    return rec.ch;
  }
  // called for every finished round, from every game
  function onRound(id, game, e) {
    const rec = A.get(id);
    if (!rec) return;
    e.tags = e.tags || [];
    const L = life(rec);
    const net = e.paid - e.staked;
    // XP: one point per dollar bet, and a little for every round
    addXp(id, rec, e.staked / 100 + 1);
    const g = L.gs[game] = L.gs[game] || { r: 0, w: 0, p: 0 };
    g.r++; g.w += e.staked; g.p += e.paid;
    if (!e.tour) L.best = Math.max(L.best, net);
    // happy hour: winnings on the chosen game get a boost
    const b = M.events.boost;
    if (active(b) && game !== 'poker' && net > 0 && (b.game === 'all' || b.game === game || (b.game === 'slots' && SLOT_GAMES.includes(game)) || (b.game === 'blackjack' && BJ_GAMES.includes(game)) || (b.game === 'roulette' && RL_GAMES.includes(game)))) {
      const extra = Math.round(net * (b.mult - 1));
      if (extra > 0) { A.credit(id, extra, game, `Happy hour ×${b.mult} bonus`); pop(rec, { type: 'boost', icon: '🎉', title: `Happy hour +${A.usd(extra)}`, text: `Your win was boosted ×${b.mult}` }); }
    }
    // achievements
    unlock(id, rec, 'first');
    for (const t of e.tags) if (ACH_BY[t]) unlock(id, rec, t);
    if (e.staked >= 100000) unlock(id, rec, 'high-roller');
    if (!e.tour && net >= 500000) unlock(id, rec, 'big-win');
    if (!e.tour && net >= 5000000) unlock(id, rec, 'mega-win');
    const cash = A.cash(id);
    if (cash >= 100000000) unlock(id, rec, 'millionaire');
    if (rec.resets > 0 && cash >= 500000) unlock(id, rec, 'comeback');
    // daily challenges
    const ch = challengeState(rec), list = challengesFor(ch.day);
    list.forEach((c, i) => {
      if (ch.prog[i] >= c.target) return;
      const add = c.inc(Object.assign({ game }, e));
      if (!add) return;
      ch.prog[i] = Math.min(c.target, ch.prog[i] + add);
      if (ch.prog[i] >= c.target) pop(rec, { type: 'challenge', icon: '✅', title: 'Challenge done', text: `${c.text}. Claim your reward in the lobby.` });
    });
    sample(id, rec);
    A.touch(id);
  }

  /* ---------- daily bonus ---------- */
  function dailyInfo(rec) {
    const d = rec.daily || { last: '', streak: 0 };
    const today = dayKey(), v = vienna(), mid = viennaMidnight(v.y, v.m, v.d);
    const yesterday = dayKey(mid - 12 * 3600000);
    const w = vienna(mid + 36 * 3600000), nextReset = viennaMidnight(w.y, w.m, w.d);
    const claimed = d.last === today;
    const streak = claimed || d.last === yesterday ? d.streak : 0;
    return { claimed, streak, next: claimed ? null : DAILY[Math.min(streak, DAILY.length - 1)], amounts: DAILY, nextReset };
  }
  function claimDaily(id) {
    const rec = A.get(id), info = dailyInfo(rec);
    if (info.claimed) return { error: 'You already claimed today’s bonus. Come back tomorrow!' };
    const amount = info.next;
    rec.daily = { last: dayKey(), streak: info.streak + 1 };
    rec.bal += amount; A.logTx(rec, 'bonus', amount, `Daily bonus, day ${rec.daily.streak}`); A.houseFor('bonus').paid += amount;
    addXp(id, rec, 50);
    if (rec.daily.streak >= 7) unlock(id, rec, 'streak-7');
    sample(id, rec, true);
    A.touch(id);
    return { ok: true, amount, streak: rec.daily.streak };
  }
  function claimChallenge(id, i) {
    const rec = A.get(id), ch = challengeState(rec), list = challengesFor(ch.day);
    i = Number(i);
    if (!(i >= 0 && i < 3)) return { error: 'Pick a challenge.' };
    if (ch.claimed[i]) return { error: 'Already claimed.' };
    if (ch.prog[i] < list[i].target) return { error: 'Not finished yet.' };
    const [cents, xp] = REWARD[list[i].tier];
    ch.claimed[i] = true;
    rec.bal += cents; A.logTx(rec, 'bonus', cents, `Challenge: ${list[i].text}`); A.houseFor('bonus').paid += cents;
    addXp(id, rec, xp);
    if (ch.claimed.every(Boolean)) unlock(id, rec, 'challenger');
    A.touch(id);
    return { ok: true, cents, xp };
  }

  /* ---------- progressive jackpot (fed by every slot spin) ---------- */
  let jpChanged = false;
  function jackpotSpin(id, bet, game, rng) {
    if (!(bet > 0)) return 0;
    const J = M.jackpot;
    J.pool += bet * 0.01; jpChanged = true;
    // the bigger the bet, the better the chance: 1 in 20,000 at the $100 bet
    const p = (bet / 10000) / 20000;
    if (rng() >= p) return 0;
    const won = Math.round(J.pool);
    const rec = A.get(id);
    A.credit(id, won, 'jackpot', 'Mega Jackpot!');
    J.last = { id, name: rec.name || 'A player', amount: won, t: Date.now(), game };
    J.pool = J.seed;
    unlock(id, rec, 'jackpot');
    announce(`🏆 ${rec.name || 'Someone'} just won the ${A.usd(won)} Mega Jackpot!`);
    save();
    return won;
  }

  /* ---------- tips ---------- */
  function tip(id, to, cents, note) {
    const rec = A.get(id), dest = A.get(String(to || ''));
    cents = Math.round(Number(cents));
    if (!dest || dest.banned || !dest.name || to === id) return { error: 'Pick a player to send chips to.' };
    if (!(cents >= 100 && cents <= 50000) || cents % 100) return { error: 'Send $1 to $500 at a time.' };
    if (levelOf(life(rec).xp) < 3) return { error: 'You can send chips from level 3.' };
    if (Date.now() - rec.joined < 24 * 3600000) return { error: 'New players can send chips after their first day.' };
    const day = dayKey();
    if (!rec.tips || rec.tips.day !== day) rec.tips = { day, sent: 0 };
    if (rec.tips.sent + cents > 50000) return { error: `You can send $500 a day. ${A.usd(50000 - rec.tips.sent)} left today.` };
    if (rec.bal < cents) return { error: 'Not enough in your bankroll.' };
    rec.bal -= cents; rec.tips.sent += cents;
    dest.bal += cents;
    const msg = String(note || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 60);
    A.logTx(rec, 'tip', -cents, `Sent to ${dest.name}${msg ? ': ' + msg : ''}`);
    A.logTx(dest, 'tip', cents, `From ${rec.name || 'a player'}${msg ? ': ' + msg : ''}`);
    pop(dest, { type: 'tip', icon: '🎁', title: `${rec.name || 'Someone'} sent you ${A.usd(cents)}`, text: msg || 'A gift from a friend' });
    unlock(id, rec, 'social');
    if (rec.ip && rec.ip === dest.ip) flag(id, 'chip-dump', `Sent ${A.usd(cents)} to ${dest.name} on the same network (${rec.ip}).`, rec.ip);
    A.touch(id); A.touch(to);
    return { ok: true, left: 50000 - rec.tips.sent };
  }

  /* ---------- weekly tournament ---------- */
  const tourOf = rec => (rec.tour && rec.tour.week === tourNow().week ? rec.tour : null);
  function tourAction(id, b) {
    const rec = A.get(id), T = tourNow();
    if (b.action === 'join') {
      if (tourOf(rec)) return { error: 'You are already in this week’s tournament.' };
      if (T.end - Date.now() < 3600000) return { error: 'This week’s tournament is about to end. Join the next one!' };
      rec.tour = { week: T.week, bal: TOUR_START, rounds: 0, joined: Date.now(), wagered: 0 };
      rec.mode = 'tour';
      A.touch(id);
      return { ok: true };
    }
    if (b.action === 'mode') {
      const want = b.mode === 'tour' ? 'tour' : 'main';
      if (want === 'tour' && !tourOf(rec)) return { error: 'Join the tournament first.' };
      const bj = rec.games.bj && rec.games.bj.round;
      if (bj && bj.phase !== 'done') return { error: 'Finish your blackjack hand first.' };
      if (rec.games.mines && rec.games.mines.live) return { error: 'Finish your Mines game first.' };
      if (rec.games.chick && rec.games.chick.live) return { error: 'Finish your crossing first.' };
      rec.mode = want; A.touch(id);
      return { ok: true };
    }
    return { error: 'Unknown action.' };
  }
  function tourBoard() {
    const T = tourNow(), rows = [];
    for (const [id, r] of A.players) { const t = r.tour; if (t && t.week === T.week && !r.banned) rows.push({ id, name: r.name || 'Player', bal: t.bal, rounds: t.rounds }); }
    return rows.sort((a, b) => b.bal - a.bal);
  }
  function endTournament(T) {
    const rows = [];
    for (const [id, r] of A.players) { const t = r.tour; if (t && t.week === T.week && !r.banned && t.rounds >= 10) rows.push({ id, name: r.name || 'Player', bal: t.bal }); }
    rows.sort((a, b) => b.bal - a.bal);
    const winners = rows.slice(0, 3).map((w, i) => ({ ...w, place: i + 1, prize: M.tourPrizes[i] || 0 }));
    for (const w of winners) {
      const rec = A.get(w.id);
      if (w.prize) A.credit(w.id, w.prize, 'tournament', `Tournament ${T.week}: place ${w.place}`);
      life(rec).trophies.push({ type: 'tournament', week: T.week, place: w.place, t: Date.now() });
      pop(rec, { type: 'trophy', icon: ['🥇', '🥈', '🥉'][w.place - 1], title: `Tournament: place ${w.place}`, text: w.prize ? `${A.usd(w.prize)} added to your bankroll` : 'Well played!' });
      unlock(w.id, rec, 'podium');
    }
    M.tourHistory.unshift({ week: T.week, end: T.end, players: rows.length, winners: winners.map(w => ({ name: w.name, bal: w.bal, prize: w.prize, place: w.place })) });
    M.tourHistory = M.tourHistory.slice(0, 20);
    for (const [id, r] of A.players) if (r.tour && r.tour.week === T.week) { r.mode = 'main'; A.touch(id); }
    if (winners.length) announce(`🏁 Tournament over! ${winners.map(w => `${['🥇', '🥈', '🥉'][w.place - 1]} ${w.name}`).join('  ')}`);
    save();
  }

  /* ---------- seasons ---------- */
  function endSeason(manual) {
    const S = M.season;
    if (opts.beforeSeasonReset) opts.beforeSeasonReset();
    const board = A.publicList().slice(0, 3);
    const v = vienna(S.start);
    M.hall.unshift({ n: S.n, label: `Season ${S.n} · ${MONTHS[v.m - 1]} ${v.y}`, start: S.start, end: Date.now(), top: board.map((p, i) => ({ id: p.id, name: p.name, cash: p.cash, place: i + 1 })) });
    M.hall = M.hall.slice(0, 24);
    board.forEach((p, i) => {
      const rec = A.get(p.id); if (!rec) return;
      life(rec).trophies.push({ type: 'season', n: S.n, place: i + 1, cash: p.cash, t: Date.now() });
      if (i === 0) unlock(p.id, rec, 'champion');
    });
    for (const [id, r] of A.players) {
      r.bal = A.START; r.peak = A.START; r.resets = 0;
      r.st = { hands: 0, spins: 0, rolls: 0, bigWin: 0, blackjacks: 0, bestMult: 0, pointsMade: 0, wagered: 0, paid: 0, rounds: 0 };
      if (r.games) { delete r.games.craps; if (r.games.bj) r.games.bj.round = null; delete r.games.mines; delete r.games.chick; }
      r.hist = [[Date.now(), A.START]];
      A.logTx(r, 'season', 0, `Season ${S.n + 1} begins: everyone starts fresh with $1,000`);
      pop(r, { type: 'season', icon: '🌅', title: `Season ${S.n + 1} has begun`, text: 'Everyone starts again with $1,000. Your level, badges and trophies stay.' });
      A.touch(id);
    }
    M.season = { n: S.n + 1, start: Date.now(), end: nextMonthStart() };
    announce(`🌅 Season ${S.n} is over${board[0] ? ` and ${board[0].name} is the champion` : ''}! Season ${S.n + 1} starts now: everyone has $1,000 again.`);
    save();
  }

  /* ---------- clock ---------- */
  function tick() {
    const now = Date.now();
    if (now >= M.season.end) endSeason();
    const T = M.tour;
    if (T && now >= T.end) { endTournament(T); M.tour = null; tourNow(); save(); }
    for (const k of ['boost', 'xp']) if (M.events[k] && M.events[k].until <= now) { M.events[k] = null; save(); }
  }
  setInterval(tick, 30000).unref();

  /* ---------- views ---------- */
  function hub(id) {
    const rec = A.get(id), L = life(rec), lvl = levelOf(L.xp), ch = challengeState(rec), list = challengesFor(ch.day), t = tourOf(rec), T = tourNow();
    const board = tourBoard();
    return {
      level: lvl, xp: Math.floor(L.xp), from: xpFor(lvl), to: xpFor(lvl + 1), vip: lvl >= VIP_LEVEL, vipLevel: VIP_LEVEL,
      daily: dailyInfo(rec),
      challenges: list.map((c, i) => ({ text: c.text, target: c.target, prog: Math.floor(ch.prog[i]), claimed: ch.claimed[i], reward: REWARD[c.tier][0], xp: REWARD[c.tier][1] })),
      achievements: ACH.map(a => ({ ...a, got: L.ach[a.k] || 0 })),
      jackpot: { pool: Math.round(M.jackpot.pool), last: M.jackpot.last },
      events: { boost: active(M.events.boost) ? M.events.boost : null, xp: active(M.events.xp) ? M.events.xp : null },
      season: { n: M.season.n, start: M.season.start, end: M.season.end },
      hall: M.hall.slice(0, 12),
      tour: { week: T.week, end: T.end, joined: !!t, bal: t ? t.bal : 0, rounds: t ? t.rounds : 0, mode: rec.mode === 'tour' && t ? 'tour' : 'main', prizes: M.tourPrizes, top: board.slice(0, 10).map(r => ({ id: r.id, name: r.name, bal: r.bal, rounds: r.rounds })), players: board.length, rank: t ? board.findIndex(r => r.id === id) + 1 : 0, history: M.tourHistory.slice(0, 5) },
      free: rec.free && rec.free.n > 0 ? rec.free : null,
      trophies: L.trophies,
    };
  }
  function profile(id) {
    const rec = A.get(id);
    if (!rec || !rec.name || rec.banned) return null;
    const L = life(rec), lvl = levelOf(L.xp);
    const favs = Object.entries(L.gs).map(([g, v]) => ({ game: g, rounds: v.r, wagered: v.w, paid: v.p })).sort((a, b) => b.rounds - a.rounds);
    const board = A.publicList(), rank = board.findIndex(p => p.id === id) + 1;
    return {
      id, name: rec.name, level: lvl, xp: Math.floor(L.xp), from: xpFor(lvl), to: xpFor(lvl + 1), vip: lvl >= VIP_LEVEL,
      cash: A.cash(id), peak: rec.peak, resets: rec.resets, joined: rec.joined, seen: Math.max(rec.seen || 0, rec.lastPlay || 0), rank, players: board.length,
      stats: rec.st, best: L.best, favs, hist: (rec.hist || []).slice(-200),
      achievements: ACH.map(a => ({ k: a.k, icon: a.icon, name: a.name, desc: a.desc, got: L.ach[a.k] || 0 })),
      trophies: L.trophies, streak: dailyInfo(rec).streak, season: M.season.n,
    };
  }
  // small extras for the leaderboard
  function boardExtras(id, rec) {
    const L = life(rec);
    const got = Object.entries(L.ach).sort((a, b) => b[1] - a[1]).map(([k]) => ACH_BY[k] && ACH_BY[k].icon).filter(Boolean);
    return { level: levelOf(L.xp), badges: got.slice(0, 4), nBadges: got.length, trophies: L.trophies.length };
  }
  const vipOf = rec => levelOf(life(rec).xp) >= VIP_LEVEL;
  const tourActive = rec => rec.mode === 'tour' && !!tourOf(rec);
  return {
    onRound, claimDaily, claimChallenge, jackpotSpin, tip, tourAction, tourBoard, endTournament: () => { const T = M.tour; if (T) { endTournament(T); M.tour = null; tourNow(); } }, endSeason, tick, hub, profile, boardExtras, vipOf, tourActive,
    jackpot: () => M.jackpot, jpTake: () => { const c = jpChanged; jpChanged = false; return c; }, levelOf, ACH, sample, life, pop, dayKey, weekOf, nextMonthStart, TOUR_START,
  };
};
