// Player accounts: the server keeps every bankroll. Browsers only ever see a copy.
// Money changes only through debit/credit calls made by the games that run on this server.
'use strict';
const crypto = require('crypto');

const START = 100000;                 // $1,000 in cents
const IMPORT_CAP = 25000000;          // balances above $250,000 from before the upgrade are not trusted
const LOG_LEN = 40;
const hash = t => crypto.createHash('sha256').update(String(t)).digest('hex');
const cleanName = n => String(n || '').replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim().slice(0, 18);
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const blankStats = () => ({ hands: 0, spins: 0, rolls: 0, bigWin: 0, blackjacks: 0, bestMult: 0, pointsMade: 0, wagered: 0, paid: 0, rounds: 0 });

module.exports = function createAccounts(hooks = {}) {
  const players = new Map();          // id -> record
  const dirty = new Set(), removed = new Set();
  const extras = [];                  // functions (id) -> cents held elsewhere (live tables)
  const onChange = hooks.onChange || (() => {});
  const house = {};                   // game -> { wagered, paid, rounds }
  let P = null;                       // progression (levels, achievements, tournament), plugged in by the server
  const setProgress = p => { P = p; };
  // which wallet a bet uses: tournament chips for the solo games while the player is in tournament mode
  const TOUR_GAMES = new Set(['slots', 'slots2', 'roulette', 'blackjack', 'plinko', 'mines']);
  const inTour = (rec, game) => !!(P && TOUR_GAMES.has(game) && P.tourActive(rec));
  const wal = (rec, game) => (inTour(rec, game) ? rec.tour : rec);
  const balOf = (id, game) => { const rec = players.get(id); return rec ? wal(rec, game).bal : 0; };

  function touch(id) { dirty.add(id); onChange(id); }
  function blank(id, token, ip) {
    return {
      v: 2, tokenHash: hash(token), name: '', bal: START, peak: START, resets: 0,
      joined: Date.now(), seen: Date.now(), ip: ip || '', banned: null, st: blankStats(), log: [], games: {},
    };
  }
  // saved entries from before the upgrade kept their bankroll in the browser; carry it over, within reason
  function migrate(id, e) {
    if (e && e.v === 2) { e.st = Object.assign(blankStats(), e.st || {}); e.games = e.games || {}; e.log = e.log || []; return e; }
    const d = (e && e.data) || {};
    const claimed = Math.max(0, Math.round(Number(d.cash) || 0));
    const trusted = claimed <= IMPORT_CAP;
    const rec = {
      v: 2, tokenHash: e.tokenHash, name: cleanName(d.name), bal: trusted ? claimed : START,
      peak: trusted ? Math.min(Math.max(claimed, Number(d.peak) || 0), IMPORT_CAP) : START, resets: Math.max(0, Math.round(Number(d.resets) || 0)),
      joined: Number(d.joined) || Date.now(), seen: Number(d.updatedAt) || Date.now(), ip: '', banned: null,
      st: Object.assign(blankStats(), {
        hands: +d.hands || 0, spins: +d.spins || 0, rolls: +d.rolls || 0, blackjacks: +d.blackjacks || 0, pointsMade: +d.pointsMade || 0,
        bestMult: Math.min(500, +d.bestMult || 0), bigWin: trusted ? Math.min(+d.bigWin || 0, IMPORT_CAP) : 0,
      }),
      log: [[Date.now(), 'import', 0, trusted ? claimed : START, trusted ? 'Bankroll carried over from before the security upgrade' : `Claimed ${claimed} cents before the upgrade; not trusted, reset to $1,000`]],
      games: {}, imported: claimed, flagged: trusted ? '' : 'Balance was over $250,000 before the security upgrade',
    };
    return rec;
  }
  function load(entries) {
    for (const [id, e] of entries) { try { players.set(id, migrate(id, e)); if (!e || e.v !== 2) dirty.add(id); } catch (x) { /* skip a damaged entry */ } }
  }
  const get = id => players.get(id) || null;

  // who is calling: { rec } or { error, code, reason }
  function auth(id, token, ip, opts = {}) {
    id = String(id || ''); token = String(token || '');
    if (!ID_RE.test(id) || token.length < 16 || token.length > 128) return { error: 'Missing player id or token.', code: 400, reason: 'bad-id' };
    let rec = players.get(id);
    if (rec) {
      if (rec.tokenHash !== hash(token)) return { error: 'This seat belongs to another browser.', code: 403, reason: 'wrong-token' };
    } else {
      if (!opts.create) return { error: 'Open the lobby first.', code: 404, reason: 'unknown' };
      if (hooks.canCreate) { const why = hooks.canCreate(ip); if (why) return { error: why, code: 429, reason: 'create-limit' }; }
      rec = blank(id, token, ip);
      players.set(id, rec);
      logTx(rec, 'join', 0, 'New player');
      touch(id);
      rec.fresh = true;
    }
    if (ip && rec.ip !== ip) { rec.ip = ip; dirty.add(id); }
    rec.seen = Date.now();
    if (rec.banned && !opts.allowBanned) return { error: 'Your account has been suspended by the casino.', code: 403, reason: 'banned', rec };
    return { rec, id };
  }
  function logTx(rec, game, delta, note) {
    rec.log.push([Date.now(), game, delta, rec.bal, note || '']);
    if (rec.log.length > LOG_LEN) rec.log.splice(0, rec.log.length - LOG_LEN);
  }
  const houseFor = g => (house[g] = house[g] || { wagered: 0, paid: 0, rounds: 0 });
  // take money for a bet; false if it isn't there
  function debit(id, cents, game, note) {
    const rec = players.get(id);
    cents = Math.round(cents);
    if (!rec || !(cents >= 0)) return false;
    const w = wal(rec, game);
    if (w.bal < cents) return false;
    if (!cents) return true;
    w.bal -= cents;
    if (w === rec) { houseFor(game).wagered += cents; rec.st.wagered += cents; logTx(rec, game, -cents, note); }
    else rec.tour.wagered = (rec.tour.wagered || 0) + cents;
    touch(id);
    return true;
  }
  function credit(id, cents, game, note) {
    const rec = players.get(id);
    cents = Math.round(cents);
    if (!rec || !(cents > 0)) return;
    const w = wal(rec, game);
    w.bal += cents;
    if (w === rec) { houseFor(game).paid += cents; rec.st.paid += cents; rec.peak = Math.max(rec.peak, cash(id)); logTx(rec, game, cents, note); }
    touch(id);
  }
  // a bet that was never played comes back (it doesn't count as the house paying out)
  function refund(id, cents, game, note) {
    const rec = players.get(id);
    cents = Math.round(cents);
    if (!rec || !(cents > 0)) return;
    const w = wal(rec, game);
    w.bal += cents;
    if (w === rec) {
      const h = houseFor(game); h.wagered = Math.max(0, h.wagered - cents);
      rec.st.wagered = Math.max(0, rec.st.wagered - cents);
      logTx(rec, game, cents, note || 'Bet returned');
    }
    touch(id);
  }
  // money that leaves the bankroll but not as a bet (moving chips onto a live table), and comes back later
  function move(id, cents, note) {
    const rec = players.get(id);
    cents = Math.round(cents);
    if (!rec) return false;
    if (cents < 0 && rec.bal < -cents) return false;
    if (!cents) return true;
    rec.bal += cents;
    logTx(rec, 'table', cents, note);
    touch(id);
    return true;
  }
  // a finished round, for the leaderboard and the house books
  function round(id, game, { staked = 0, paid = 0, hands = 0, spins = 0, rolls = 0, blackjacks = 0, mult = 0, points = 0, tags = [] } = {}) {
    const rec = players.get(id);
    if (!rec) return;
    const tour = inTour(rec, game);
    if (P) { try { P.onRound(id, game, { staked, paid, tags, tour }); } catch (e) { console.error('progress', e); } }
    if (tour) { rec.tour.rounds = (rec.tour.rounds || 0) + 1; rec.lastGame = game; rec.lastPlay = Date.now(); touch(id); return; }
    const st = rec.st;
    st.rounds++; st.hands += hands; st.spins += spins; st.rolls += rolls; st.blackjacks += blackjacks; st.pointsMade += points;
    if (mult) st.bestMult = Math.max(st.bestMult, mult);
    st.bigWin = Math.max(st.bigWin, paid - staked);
    houseFor(game).rounds++;
    rec.lastGame = game; rec.lastPlay = Date.now();
    rec.peak = Math.max(rec.peak, cash(id));
    touch(id);
  }
  const tableMoney = id => { const rec = players.get(id); const c = rec && rec.games.craps; return c && c.bets ? Object.values(c.bets).reduce((a, b) => a + (+b || 0), 0) : 0; };
  const elsewhere = id => extras.reduce((a, f) => a + (f(id) || 0), 0);
  const cash = id => { const rec = players.get(id); return rec ? rec.bal + tableMoney(id) + elsewhere(id) : 0; };
  // $1,000 fresh start, only when the player is out of money everywhere
  function reset(id) {
    const rec = players.get(id);
    if (!rec) return { error: 'Unknown player.' };
    const have = cash(id);
    if (have >= 500) return { error: `You still have ${usd(have)}. A fresh $1,000 is only for when you're out of chips.`, code: 409 };
    rec.bal += START; rec.resets++;
    logTx(rec, 'reset', START, 'Fresh $1,000 stack');
    touch(id);
    return { ok: true };
  }
  const usd = c => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });
  function setName(id, name) {
    const rec = players.get(id), n = cleanName(name);
    if (!rec || n.length < 2 || n === rec.name || rec.nameLocked) return;
    rec.name = n; touch(id);
  }
  function me(id, ctx) {
    const rec = players.get(id);
    const tour = !!(P && P.tourActive(rec));
    const lvl = P ? P.levelOf((rec.life || {}).xp || 0) : 0;
    return { id, name: rec.name, cents: ctx === 'solo' && tour ? rec.tour.bal : rec.bal, bank: rec.bal, cash: cash(id), peak: rec.peak, resets: rec.resets, stats: rec.st, banned: !!rec.banned,
      level: lvl, vip: !!(P && P.vipOf(rec)), mode: tour ? 'tour' : 'main', tourBal: tour ? rec.tour.bal : null, free: rec.free && rec.free.n > 0 ? rec.free : null };
  }
  // popups waiting for this player (achievements, level ups, gifts)
  function takePop(id) { const rec = players.get(id); if (!rec || !rec.pop || !rec.pop.length) return null; const p = rec.pop; rec.pop = []; touch(id); return p; }
  function publicList() {
    const out = [];
    for (const [id, r] of players) {
      if (!r.name || r.banned || r.hidden) continue;
      out.push({ id, name: r.name, cash: cash(id), peak: r.peak, resets: r.resets, hands: r.st.hands, spins: r.st.spins, rolls: r.st.rolls,
        bigWin: r.st.bigWin, blackjacks: r.st.blackjacks, bestMult: r.st.bestMult, pointsMade: r.st.pointsMade, joined: r.joined, updatedAt: r.lastPlay || r.seen,
        ...(P ? P.boardExtras(id, r) : {}) });
    }
    return out.sort((a, b) => b.cash - a.cash);
  }
  function remove(id) { if (!players.has(id)) return false; players.delete(id); dirty.delete(id); removed.add(id); onChange(id); return true; }
  // for the storage layer
  function takeDirty() {
    const set = [...dirty].filter(id => players.has(id)).map(id => [id, JSON.stringify(serialize(players.get(id)))]);
    const del = [...removed];
    dirty.clear(); removed.clear();
    return { set, del };
  }
  function putBack({ set, del }) { set.forEach(([id]) => dirty.add(id)); del.forEach(id => removed.add(id)); }
  // the blackjack shoe isn't saved (a restart just shuffles a new one); everything else is
  function serialize(r) {
    const o = Object.assign({}, r); delete o.fresh;
    if (r.games && r.games.bj) { o.games = Object.assign({}, r.games, { bj: Object.assign({}, r.games.bj, { shoe: [], shoeSize: 0, dealt: 0, shuffleDue: true }) }); }
    return o;
  }
  return {
    START, players, load, get, auth, debit, credit, refund, move, round, reset, setName, me, takePop, publicList, remove, takeDirty, putBack, setProgress, balOf, inTour, TOUR_GAMES,
    cash, tableMoney, logTx, touch, house, houseFor, extras, hash, cleanName, usd, all: () => players,
  };
};
