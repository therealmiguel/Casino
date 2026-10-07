// Tomb of Amun-Ra: 5 reels x 3 rows, 10 paylines.
// The Book is both wild and scatter: 3 or more anywhere pay and start 10 free spins.
// Before the free spins one symbol is picked at random; during them it expands to cover its whole reel
// and pays on all 10 lines, even on reels that aren't next to each other.
// The server runs this; the page only shows the results it is sent.
'use strict';
const BookEngine = (() => {
  const REELS = 5, ROWS = 3;
  // symbol ids: 0-4 card letters, 5 scarab, 6 ankh, 7 sphinx, 8 explorer, 9 book
  const NAMES = ['10', 'J', 'Q', 'K', 'A', 'Scarab', 'Ankh', 'Sphinx', 'Explorer', 'Book'];
  const BOOK = 9;
  // pays per line, times the LINE bet, for 2/3/4/5 of a kind (left to right)
  const PAY = {
    0: [0, 5, 25, 100], 1: [0, 5, 25, 100], 2: [0, 5, 25, 100], 3: [0, 5, 40, 150], 4: [0, 5, 40, 150],
    5: [5, 30, 100, 750], 6: [5, 30, 100, 750], 7: [5, 40, 400, 2000], 8: [10, 100, 1000, 5000],
  };
  const SCATTER = { 3: 2, 4: 20, 5: 200 };          // times the TOTAL bet
  const LINES = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [1, 2, 2, 2, 1], [1, 0, 0, 0, 1], [2, 2, 1, 0, 0], [0, 0, 1, 2, 2], [2, 1, 1, 1, 0],
  ];
  const FS_COUNT = 10, MAX_WIN = 5000;             // max win: 5,000x the total bet
  // how often each symbol lands, per reel (the book is a little rarer on the outer reels)
  const W = [
    [22.6, 22.6, 21.6, 19, 19, 14, 14, 9, 5, 3.52],
    [22.6, 22.6, 21.6, 19, 19, 14, 14, 9, 5, 3.87],
    [22.6, 22.6, 21.6, 19, 19, 14, 14, 9, 5, 3.87],
    [22.6, 22.6, 21.6, 19, 19, 14, 14, 9, 5, 3.87],
    [22.6, 22.6, 21.6, 19, 19, 14, 14, 9, 5, 3.52],
  ];
  const pickW = (rng, w) => { let r = rng() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return i; } return w.length - 1; };
  function grid(rng) { return Array.from({ length: REELS }, (_, c) => Array.from({ length: ROWS }, () => pickW(rng, W[c]))); }
  // line wins, the book standing in for any symbol (or paying as itself if that's better)
  function lineWins(g, lineBet) {
    const wins = []; let total = 0;
    LINES.forEach((L, li) => {
      const cells = L.map((r, c) => g[c][r]);
      let sym = cells.find(s => s !== BOOK); if (sym === undefined) sym = BOOK;
      let n = 0; while (n < 5 && (cells[n] === sym || cells[n] === BOOK)) n++;
      let pay = sym !== BOOK && PAY[sym] && n >= 2 ? PAY[sym][n - 2] : 0;
      // a run of books alone pays as the explorer would not; books only pay as a scatter
      if (pay > 0) { wins.push({ line: li, sym, n, pay: pay * lineBet }); total += pay * lineBet; }
    });
    return { wins, total };
  }
  function scatter(g) { const pos = []; g.forEach((col, c) => col.forEach((s, r) => { if (s === BOOK) pos.push([c, r]); })); return pos; }
  // free spins: the special symbol expands on every reel it lands on and pays on all lines
  function expand(g, special, lineBet) {
    const reels = g.map((col, c) => (col.includes(special) ? c : -1)).filter(c => c >= 0);
    const need = special >= 5 ? 2 : 3;
    if (reels.length < need) return null;
    const pay = PAY[special][reels.length - 2] * lineBet * LINES.length;
    return { sym: special, reels, pay };
  }
  // one spin; lineBet in "bet units" (the server multiplies by real money)
  function spin(rng, opts = {}) {
    const lineBet = 1, totalBet = LINES.length;
    const g = grid(rng);
    const lw = lineWins(g, lineBet);
    const sc = scatter(g);
    const scPay = sc.length >= 3 ? SCATTER[Math.min(5, sc.length)] * totalBet : 0;
    let ex = null;
    if (opts.special !== undefined) ex = expand(g, opts.special, lineBet);
    return { grid: g, wins: lw.wins, lineWin: lw.total, scatter: sc, scatterWin: scPay, expand: ex, win: lw.total + scPay + (ex ? ex.pay : 0), trigger: sc.length >= 3 };
  }
  // a whole paid spin, including any free spins it starts; totals are in multiples of the TOTAL bet
  function play(rng) {
    const base = spin(rng);
    let total = base.win / LINES.length, fs = null;
    if (base.trigger) {
      const special = pickW(rng, [8, 8, 8, 8, 8, 9, 9, 9, 7]);
      fs = { special, spins: [] };
      let left = FS_COUNT;
      while (left > 0 && fs.spins.length < 200) {
        left--;
        const s = spin(rng, { special });
        if (s.trigger) left += FS_COUNT;
        fs.spins.push(s);
        total += s.win / LINES.length;
      }
    }
    let capped = false;
    if (total > MAX_WIN) { total = MAX_WIN; capped = true; }
    return { base, fs, total: Math.round(total * 100) / 100, capped };
  }
  return { REELS, ROWS, NAMES, BOOK, PAY, SCATTER, LINES, FS_COUNT, MAX_WIN, spin, play, expand };
})();
if (typeof module !== 'undefined') module.exports = BookEngine;
