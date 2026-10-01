// Cosmic Cascade: 6 columns x 5 rows, symbols pay anywhere (8 or more of a kind).
// Winning symbols vanish, the rest fall and new ones drop in, again and again.
// Multiplier orbs multiply the win of the spin; 4+ black holes spin the prize wheel.
// The server runs this and sends the page every step; the page only shows it.
'use strict';
const CascadeEngine = (() => {
  const COLS = 6, ROWS = 5, SCAT = 9, ORB = 100;
  // pays per symbol for 8-9, 10-11 and 12+ (times the bet)
  const PAY = [
    [10, 25, 50],      // 0 golden ringed planet
    [2.5, 10, 25],     // 1 red planet
    [2, 5, 15],        // 2 blue planet
    [1.5, 2, 12],      // 3 comet
    [1, 1.5, 10],      // 4 violet crystal
    [0.8, 1.2, 8],     // 5 green crystal
    [0.5, 1, 5],       // 6 blue crystal
    [0.4, 0.9, 4],     // 7 amber crystal
    [0.25, 0.75, 2],   // 8 rose crystal
  ];
  const SCALE = 1.59;
  PAY.forEach(row => row.forEach((v, i) => { row[i] = Math.round(v * SCALE * 100) / 100; }));
  const SCAT_PAY = { 4: 3, 5: 5, 6: 100 };
  const W_BASE = [5, 7, 8, 10, 13, 15, 16, 17, 18];
  const W_FS = [5, 6, 8, 10, 12, 15, 17, 20, 23];
  const SCAT_W = { base: 2.4, fs: 1.3 };
  const ORB_W = { base: 0.55, fs: 5 };
  const ORB_VALUES = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 50, 100];
  const ORB_VW = [40, 26, 20, 16, 12, 8, 6, 4, 3, 2, 1.2, 0.5, 0.18];
  const WHEEL = ['x20', 'fs10', 'x25', 'fs12', 'x20', 'fs10', 'x50', 'fs15', 'x30', 'fs10', 'x25', 'fs12', 'x200', 'fs10', 'x30', 'fs20'];
  const WHEEL_W = [8, 12, 6, 8, 8, 12, 3, 6, 6, 12, 6, 8, 0.7, 12, 6, 3];
  const BUY_PRICE = 100, MAX_WIN = 5000, FS_RETRIGGER = 5;
  const sumW = a => a.reduce((x, y) => x + y, 0);
  function pickW(rng, w) { let r = rng() * sumW(w); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; } return w.length - 1; }
  function cell(rng, mode, scatOk) {
    const sw = scatOk ? SCAT_W[mode] : 0, ow = ORB_W[mode];
    const W = mode === 'fs' ? W_FS : W_BASE;
    const tot = sumW(W) + sw + ow;
    let r = rng() * tot;
    if (r < sw) return SCAT;
    r -= sw;
    if (r < ow) return ORB + ORB_VALUES[pickW(rng, ORB_VW)];
    return pickW(rng, W);
  }
  const countScat = g => g.reduce((n, col) => n + col.filter(v => v === SCAT).length, 0);
  // one spin with all its cascades
  function spin(rng, mode = 'base') {
    // at most one black hole per column, so 6 is the most
    const fill = (col, n) => { const out = []; for (let i = 0; i < n; i++) { const v = cell(rng, mode, !col.includes(SCAT) && !out.includes(SCAT)); out.push(v); } return out; };
    let grid = Array.from({ length: COLS }, () => fill([], ROWS));
    const steps = [];
    let win = 0;
    for (let guard = 0; guard < 60; guard++) {
      const pos = {};
      grid.forEach((col, c) => col.forEach((v, r) => { if (v < SCAT) (pos[v] = pos[v] || []).push([c, r]); }));
      const wins = [];
      for (const s of Object.keys(pos)) {
        const n = pos[s].length;
        if (n < 8) continue;
        const pay = PAY[s][n >= 12 ? 2 : n >= 10 ? 1 : 0];
        wins.push({ s: +s, n, pos: pos[s], pay });
        win += pay;
      }
      steps.push({ grid: grid.map(c => c.slice()), wins });
      if (!wins.length) break;
      const gone = new Set(wins.flatMap(w => w.pos.map(([c, r]) => c * 10 + r)));
      grid = grid.map((col, c) => {
        const keep = col.filter((v, r) => !gone.has(c * 10 + r));
        return fill(keep, ROWS - keep.length).concat(keep);
      });
    }
    const last = steps[steps.length - 1].grid;
    const orbs = [], scat = [];
    last.forEach((col, c) => col.forEach((v, r) => { if (v >= ORB) orbs.push({ c, r, v: v - ORB }); else if (v === SCAT) scat.push([c, r]); }));
    const ns = scat.length;
    const scatPay = ns >= 4 ? SCAT_PAY[Math.min(6, ns)] : 0;
    return { steps, win: Math.round(win * 100) / 100, orbs, orbSum: orbs.reduce((a, o) => a + o.v, 0), scat, scatPay, cascades: steps.length - 1 };
  }
  function wheel(rng) { const i = pickW(rng, WHEEL_W); return { i, seg: WHEEL[i] }; }
  function freeSpins(rng, n) {
    const list = []; let left = n, run = 0, total = 0;
    while (left > 0 && list.length < 150) {
      left--;
      const s = spin(rng, 'fs');
      if (s.win > 0 && s.orbSum) run += s.orbSum;
      let pay = s.win * (s.win > 0 && run ? run : 1) + s.scatPay;
      const extra = s.scat.length >= 3 ? FS_RETRIGGER : 0;
      left += extra;
      pay = Math.round(pay * 100) / 100;
      total += pay;
      list.push({ s, run, pay, extra });
    }
    return { list, total: Math.round(total * 100) / 100 };
  }
  function bonus(rng) {
    const w = wheel(rng);
    if (w.seg[0] === 'x') return { wheel: w, cash: +w.seg.slice(1), fs: null, total: +w.seg.slice(1) };
    const fs = freeSpins(rng, +w.seg.slice(2));
    return { wheel: w, cash: 0, fs, total: fs.total };
  }
  // a whole paid spin, or a bought bonus
  function play(rng, buy) {
    let base = null, b = null, total = 0;
    if (buy) { b = bonus(rng); total = b.total; }
    else {
      base = spin(rng, 'base');
      total = base.win * (base.win > 0 && base.orbSum ? base.orbSum : 1) + base.scatPay;
      if (base.scat.length >= 4) { b = bonus(rng); total += b.total; }
    }
    let capped = false;
    if (total > MAX_WIN) { total = MAX_WIN; capped = true; }
    return { buy: !!buy, base, bonus: b, total: Math.round(total * 100) / 100, capped };
  }
  return { COLS, ROWS, SCAT, ORB, PAY, SCAT_PAY, WHEEL, BUY_PRICE, MAX_WIN, FS_RETRIGGER, spin, play, wheel, freeSpins };
})();
if (typeof module !== 'undefined') module.exports = CascadeEngine;
