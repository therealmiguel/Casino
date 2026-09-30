// Voltage Roulette rules, shared by the solo wheel and the live wheel.
// Bet keys match the roulette page: "type:n1-n2-...".
'use strict';
const REDS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const PAY = { straight: 35, split: 17, street: 11, trio: 11, corner: 8, basket: 8, line: 5, dozen: 2, column: 2, even: 1 };
const LIGHTNING_STRAIGHT = 29;           // straight-up pays 29:1 on the lightning wheel, or the struck multiplier
const MULTS = [[50, 40], [100, 25], [150, 12], [200, 10], [300, 7], [400, 4], [500, 2]];
const STRIKES = [[1, 28], [2, 30], [3, 22], [4, 12], [5, 8]];

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
  [n => n <= 18, n => n % 2 === 0, n => REDS.has(n), n => !REDS.has(n), n => n % 2 === 1, n => n >= 19].forEach(f => add('even', ALL.filter(f)));
  for (let c = 0; c < 11; c++) for (let r = 0; r < 3; r++) add('split', [numAt(c, r), numAt(c + 1, r)]);
  for (let c = 0; c < 12; c++) for (let r = 0; r < 2; r++) add('split', [numAt(c, r), numAt(c, r + 1)]);
  for (let c = 0; c < 11; c++) for (let r = 0; r < 2; r++) add('corner', [numAt(c, r), numAt(c, r + 1), numAt(c + 1, r), numAt(c + 1, r + 1)]);
  const street = c => [numAt(c, 0), numAt(c, 1), numAt(c, 2)];
  for (let c = 0; c < 12; c++) add('street', street(c));
  for (let c = 0; c < 11; c++) add('line', [...street(c), ...street(c + 1)]);
  for (let r = 0; r < 3; r++) add('split', [0, numAt(0, r)]);
  add('trio', [0, 2, 3]); add('trio', [0, 1, 2]); add('basket', [0, 1, 2, 3]);
})();

function weighted(list, rnd) {
  let r = rnd(list.reduce((a, [, w]) => a + w, 0));
  for (const [v, w] of list) { if (r < w) return v; r -= w; }
  return list[0][0];
}
// rnd(n) returns a whole number from 0 to n-1
function genStrikes(rnd) {
  const k = weighted(STRIKES, rnd), pool = Array.from({ length: 37 }, (_, i) => i), out = [];
  for (let i = 0; i < k; i++) out.push({ n: pool.splice(rnd(pool.length), 1)[0], m: weighted(MULTS, rnd) });
  return out.sort((a, b) => a.m - b.m);
}
// bets: { key: amount }, any unit. Returns what comes back (stake + winnings) in the same unit.
function payout(bets, n, strikes, lightning) {
  const hit = lightning ? strikes.find(s => s.n === n) : null;
  let total = 0, mult = 0;
  for (const [k, amt] of Object.entries(bets)) {
    const spot = SPOTS.get(k);
    if (!spot || !spot.nums.includes(n)) continue;
    let m = PAY[spot.type];
    if (spot.type === 'straight' && lightning) { m = hit ? hit.m : LIGHTNING_STRAIGHT; if (hit) mult = hit.m; }
    total += amt * (m + 1);
  }
  return { total, mult };
}
module.exports = { SPOTS, PAY, MULTS, STRIKES, REDS, LIGHTNING_STRAIGHT, genStrikes, payout, weighted };
