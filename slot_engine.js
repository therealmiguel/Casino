/* Dynamite Diggers: game math. Pure functions, all amounts in multiples of the total bet. */
const SlotEngine = (() => {
  const REELS = 5, ROWS = 3;
  const PAYING = ['BIRD', 'HELM', 'LAMP', 'PICK', 'A', 'K', 'Q', 'J'];
  // pay for 3, 4, 5 of a kind, per way, in multiples of the total bet (243 ways)
  const PAY = {
    BIRD: [0.45, 1.8, 7], HELM: [0.35, 1.1, 4.5], LAMP: [0.28, 0.9, 2.7], PICK: [0.22, 0.7, 2.2],
    A: [0.09, 0.27, 0.9], K: [0.09, 0.27, 0.9], Q: [0.07, 0.18, 0.55], J: [0.07, 0.18, 0.55],
  };
  // symbol weights on each reel
  const W = {
    BIRD: [4, 4, 4, 4, 4], HELM: [5, 5, 5, 5, 5], LAMP: [6, 6, 6, 6, 6], PICK: [7, 7, 7, 7, 7],
    A: [9, 9, 9, 9, 9], K: [9, 9, 9, 9, 9], Q: [10, 10, 10, 10, 10], J: [10, 10, 10, 10, 10],
    WILD: [0, 2.6, 2.6, 2.6, 2.6], SCAT: [3.3, 0, 3.3, 0, 3.3], NUG: [9.3, 9.3, 9.3, 9.3, 9.3], CART: [0, 0, 0, 0, 0.95],
  };
  const FS_W = Object.assign({}, W, { WILD: [0, 1.0, 1.0, 1.0, 1.0], NUG: [7, 7, 7, 7, 7] });
  const JACKPOTS = { MINI: 15, MINOR: 40, MAJOR: 150, GRAND: 1000 };
  const CASH = [[0.2, 30], [0.5, 30], [1, 18], [2, 10], [3, 6], [5, 3], [10, 1.5], ['MINI', 0.8], ['MINOR', 0.2], ['MAJOR', 0.03]];
  const WILD_MULT = [[2, 80], [3, 20]];
  const FUSE_BASE = 1 / 26, FUSE_FS = 1 / 16;
  const FS_AWARD = 8;
  const HB = { nug: 0.046, cart: 0.008, tnt: 0.008, respins: 3 };
  const pickW = (rng, list) => { let t = 0; for (const x of list) t += x[1]; let r = rng() * t; for (const x of list) { if ((r -= x[1]) < 0) return x[0]; } return list[list.length - 1][0]; };
  const tables = [W, FS_W].map(w => Array.from({ length: REELS }, (_, r) => Object.keys(w).map(k => [k, w[k][r]]).filter(x => x[1] > 0)));
  function nugget(rng) {
    const v = pickW(rng, CASH);
    return typeof v === 'string' ? { sym: 'NUG', v: JACKPOTS[v], jp: v } : { sym: 'NUG', v };
  }
  function cell(rng, reel, fs) {
    const s = pickW(rng, tables[fs ? 1 : 0][reel]);
    if (s === 'NUG') return nugget(rng);
    if (s === 'WILD') return { sym: 'WILD', m: fs ? pickW(rng, WILD_MULT) : 1 };
    return { sym: s };
  }
  // grid[reel][row]
  function evaluate(grid) {
    const wins = [];
    let total = 0;
    for (const s of PAYING) {
      let ways = 1, n = 0; const cells = [];
      for (let r = 0; r < REELS; r++) {
        let c = 0; const here = [];
        grid[r].forEach((x, row) => { if (x.sym === s) { c += 1; here.push([r, row]); } else if (x.sym === 'WILD') { c += x.m || 1; here.push([r, row]); } });
        if (!c) break;
        ways *= c; n++; cells.push(...here);
      }
      if (n >= 3 && grid[0].some(x => x.sym === s)) {
        const amt = PAY[s][n - 3] * ways;
        total += amt; wins.push({ sym: s, n, ways, amount: amt, cells });
      }
    }
    // mine cart on reel 5 collects every gold nugget in view
    let collect = null;
    const carts = grid[4].map((x, row) => (x.sym === 'CART' ? row : -1)).filter(i => i >= 0);
    const nugs = [];
    grid.forEach((col, r) => col.forEach((x, row) => { if (x.sym === 'NUG') nugs.push([r, row]); }));
    if (carts.length && nugs.length) {
      const sum = nugs.reduce((a, [r, row]) => a + grid[r][row].v, 0) * carts.length;
      collect = { amount: sum, carts: carts.map(row => [4, row]), cells: nugs };
      total += sum;
    }
    const scat = []; grid.forEach((col, r) => col.forEach((x, row) => { if (x.sym === 'SCAT') scat.push([r, row]); }));
    return { wins, collect, total, scatters: scat, nuggets: nugs, freeSpins: scat.length >= 3, holdBlast: nugs.length >= 6 };
  }
  // one spin: base (fs = false) or free spin (fs = true)
  function spin(rng, fs) {
    const grid = Array.from({ length: REELS }, (_, r) => Array.from({ length: ROWS }, () => cell(rng, r, fs)));
    const before = grid.map(c => c.map(x => Object.assign({}, x)));
    let fuse = null;
    if (rng() < (fs ? FUSE_FS : FUSE_BASE)) {
      // dynamite blasts random spots on reels 2-5 into wilds
      const spots = [];
      for (let r = 1; r < REELS; r++) for (let row = 0; row < ROWS; row++) if (!['SCAT', 'NUG', 'CART', 'WILD'].includes(grid[r][row].sym)) spots.push([r, row]);
      const n = Math.min(spots.length, 2 + Math.floor(rng() * 4));
      fuse = [];
      for (let k = 0; k < n; k++) {
        const [r, row] = spots.splice(Math.floor(rng() * spots.length), 1)[0];
        grid[r][row] = { sym: 'WILD', m: fs ? pickW(rng, WILD_MULT) : 1 };
        fuse.push([r, row]);
      }
    }
    return Object.assign({ grid, before, fuse }, evaluate(grid));
  }
  // Hold & Blast: start from the nuggets on the grid, 3 respins that reset when anything lands
  function holdBlast(rng, grid) {
    const cells = Array.from({ length: REELS * ROWS }, () => null);
    grid.forEach((col, r) => col.forEach((x, row) => { if (x.sym === 'NUG') cells[r * ROWS + row] = { kind: x.jp ? 'jp' : 'cash', v: x.v, jp: x.jp }; }));
    const start = cells.map(c => c && Object.assign({}, c));
    const steps = [];
    let left = HB.respins;
    while (left > 0 && cells.some(c => !c)) {
      const landed = [];
      for (let i = 0; i < cells.length; i++) {
        if (cells[i]) continue;
        const x = rng();
        if (x < HB.nug) { const n = nugget(rng); cells[i] = { kind: n.jp ? 'jp' : 'cash', v: n.v, jp: n.jp }; landed.push(i); }
        else if (x < HB.nug + HB.tnt) { cells[i] = { kind: 'tnt', v: 0 }; landed.push(i); }
        else if (x < HB.nug + HB.tnt + HB.cart) { cells[i] = { kind: 'cart', v: 0 }; landed.push(i); }
      }
      const events = [];
      const snap = () => cells.map(c => c && Object.assign({}, c));
      const pre = snap();
      // dynamite doubles every cash value and cart already on the grid
      for (const i of landed) if (cells[i].kind === 'tnt') {
        const hit = [];
        cells.forEach((c, j) => { if (c && (c.kind === 'cash' || (c.kind === 'cart' && !landed.includes(j)))) { c.v *= 2; hit.push(j); } });
        events.push({ type: 'tnt', at: i, hit, after: snap() });
      }
      // a mine cart collects everything showing
      for (const i of landed) if (cells[i].kind === 'cart') {
        const from = []; let sum = 0;
        cells.forEach((c, j) => { if (c && j !== i && c.kind !== 'tnt' && c.v > 0) { sum += c.v; from.push(j); } });
        cells[i].v = sum;
        events.push({ type: 'cart', at: i, from, v: sum, after: snap() });
      }
      left = landed.length ? HB.respins : left - 1;
      steps.push({ landed, pre, events, cells: snap(), left });
    }
    const full = cells.every(Boolean);
    const sum = cells.reduce((a, c) => a + (c ? c.v : 0), 0);
    const total = sum + (full ? JACKPOTS.GRAND : 0);
    return { start, steps, full, total, cells };
  }
  // bought bonus: six nuggets in random spots
  function boughtGrid(rng) {
    const plain = r => { let c; do { c = cell(rng, r, false); } while (['NUG', 'SCAT', 'CART', 'WILD'].includes(c.sym)); return c; };
    const grid = Array.from({ length: REELS }, (_, r) => Array.from({ length: ROWS }, () => plain(r)));
    const idx = [...Array(REELS * ROWS).keys()];
    for (let k = 0; k < 6; k++) { const i = idx.splice(Math.floor(rng() * idx.length), 1)[0]; grid[Math.floor(i / ROWS)][i % ROWS] = nugget(rng); }
    return grid;
  }
  const BUY_PRICE = 29;
  return { REELS, ROWS, PAY, JACKPOTS, FS_AWARD, BUY_PRICE, spin, evaluate, holdBlast, boughtGrid, nugget, cell };
})();
if (typeof module !== 'undefined') module.exports = SlotEngine;
