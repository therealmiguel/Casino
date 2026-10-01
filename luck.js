// Luck control (admin only, secret): makes a player luckier or unluckier on the solo games,
// or forces their next rounds to win or lose. Nothing here is ever sent to a player's browser.
//
//   rec.luck = { mode: 'lucky' | 'unlucky', power: 1 | 2 | 3, until: ms or 0, rounds: n or 0,
//                force: { result: 'win' | 'lose', n } }
//
// How it works: a game makes an outcome the normal way. If that outcome goes against the player's
// luck, the game rolls again, up to a few times (more with more power). A forced result keeps rolling
// until it gets one that wins (or loses).
'use strict';
const TRIES = { 1: 1, 2: 2, 3: 60 };          // extra rolls allowed per outcome
const STEP_IN = { 1: 0.4, 2: 1, 3: 1 };       // how often luck steps in at all
const CHANCE = { 1: 0.1, 2: 0.35, 3: 1 };       // for yes/no moments (a mine, a car): how often luck steps in

module.exports = function createLuck(A) {
  function state(id) {
    const rec = A.get(id);
    const L = rec && rec.luck;
    if (!L) return null;
    if (L.force && L.force.n > 0) return { dir: L.force.result === 'win' ? 1 : -1, power: 3, forced: true };
    if (L.until && L.until < Date.now()) { rec.luck = null; A.touch(id); return null; }
    if (L.mode === 'lucky' || L.mode === 'unlucky') return { dir: L.mode === 'lucky' ? 1 : -1, power: Math.min(3, Math.max(1, L.power || 1)) };
    return null;
  }
  // gen() makes one outcome; net(o) is what the player would gain from it (negative = loss)
  function pick(id, gen, net) {
    const s = state(id);
    let o = gen();
    if (!s) return o;
    const good = v => (s.dir > 0 ? v > 0 : v <= 0);
    let best = o, bestV = net(o);
    if (good(bestV)) return o;
    if (!s.forced && Math.random() >= STEP_IN[s.power]) return o;
    const tries = s.forced ? 400 : TRIES[s.power];
    for (let i = 0; i < tries; i++) {
      o = gen();
      const v = net(o);
      if (good(v)) return o;
      if (s.dir > 0 ? v > bestV : v < bestV) { best = o; bestV = v; }
    }
    return best;
  }
  // yes/no moments: does luck change this one? (dir +1 saves the player, -1 dooms them)
  function steer(id) {
    const s = state(id);
    if (!s) return 0;
    return Math.random() < (s.forced ? 1 : CHANCE[s.power]) ? s.dir : 0;
  }
  // blackjack: how hard to lean on the cards (0 = not at all)
  function bias(id) {
    const s = state(id);
    if (!s) return null;
    return { dir: s.dir, look: s.forced ? 20 : [0, 3, 6, 14][s.power], chance: s.forced ? 1 : CHANCE[s.power] };
  }
  // called after every finished round in any game
  function after(id) {
    const rec = A.get(id), L = rec && rec.luck;
    if (!L) return;
    if (L.force && L.force.n > 0) { L.force.n--; if (L.force.n <= 0) L.force = null; }
    else if (L.rounds > 0) { L.rounds--; if (L.rounds <= 0) { rec.luck = null; A.touch(id); return; } }
    if (!L.force && !L.mode) rec.luck = null;
    A.touch(id);
  }
  function describe(L) {
    if (!L) return '';
    const parts = [];
    if (L.force && L.force.n > 0) parts.push(`forced to ${L.force.result} the next ${L.force.n} round${L.force.n === 1 ? '' : 's'}`);
    if (L.mode) parts.push(`${['', 'a bit', 'very', 'always'][L.power || 1]} ${L.mode}${L.rounds ? ` for ${L.rounds} more rounds` : ''}${L.until ? ' until ' + new Date(L.until).toLocaleString('en-GB', { timeZone: 'Europe/Vienna', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : ''}`);
    return parts.join(', then ');
  }
  return { state, pick, steer, bias, after, describe };
};
