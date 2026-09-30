// Bubble Dome Craps rules, copied from the craps page when the casino is built. Do not edit here.
'use strict';
const RULES = (() => {
  const PT = [4, 5, 6, 8, 9, 10];
  const TRUE_ODDS = { 4: [2, 1], 10: [2, 1], 5: [3, 2], 9: [3, 2], 6: [6, 5], 8: [6, 5] };
  const PLACE_PAY = { 4: [9, 5], 10: [9, 5], 5: [7, 5], 9: [7, 5], 6: [7, 6], 8: [7, 6] };
  const LAY_PAY = { 4: [1, 2], 10: [1, 2], 5: [2, 3], 9: [2, 3], 6: [5, 6], 8: [5, 6] };
  const HARD_PAY = { 4: 7, 10: 7, 6: 9, 8: 9 };
  const pay = (amt, r) => Math.floor(amt * r[0] / r[1]);          // amounts are in cents; fractions of a cent are dropped
  const vig = w => Math.floor(w * 5 / 100);                        // 5% commission on the win

  function oddsMax(flat, n, mode) {
    if (mode === '345') return flat * { 4: 3, 10: 3, 5: 4, 9: 4, 6: 5, 8: 5 }[n];
    return flat * mode;
  }
  function layMax(flat, n, mode) {
    if (mode === '345') return flat * 6;
    return Math.floor(flat * mode * { 4: 2, 10: 2, 5: 1.5, 9: 1.5, 6: 1.2, 8: 1.2 }[n]);
  }

  function resolve(bets, point, d1, d2, rules) {
    const t = d1 + d2, hard = d1 === d2, comeOut = point === null;
    const B = Object.assign({}, bets);
    const ev = [];
    let bank = 0;
    const has = k => (B[k] || 0) > 0;
    const win = (k, profit) => { bank += profit; ev.push({ k, type: 'win', amt: profit }); };                       // bet stays up
    const collect = (k, profit) => { bank += B[k] + profit; ev.push({ k, type: 'win', amt: profit, off: true }); delete B[k]; };
    const lose = k => { ev.push({ k, type: 'lose', amt: B[k] }); delete B[k]; };
    const giveBack = k => { bank += B[k]; ev.push({ k, type: 'back', amt: B[k] }); delete B[k]; };
    const push = k => ev.push({ k, type: 'push', amt: B[k] });
    const working = !comeOut || rules.working;          // place, buy and hardways
    const comeOddsOn = !comeOut || rules.comeOddsOn;

    // one-roll bets
    if (has('field')) {
      const a = B.field;
      if (t === 2) win('field', a * 2);
      else if (t === 12) win('field', a * rules.field12);
      else if ([3, 4, 9, 10, 11].includes(t)) win('field', a);
      else lose('field');
    }
    if (has('any7')) t === 7 ? win('any7', B.any7 * 4) : lose('any7');
    if (has('anyCraps')) [2, 3, 12].includes(t) ? win('anyCraps', B.anyCraps * 7) : lose('anyCraps');
    if (has('p2')) t === 2 ? win('p2', B.p2 * 30) : lose('p2');
    if (has('p3')) t === 3 ? win('p3', B.p3 * 15) : lose('p3');
    if (has('p11')) t === 11 ? win('p11', B.p11 * 15) : lose('p11');
    if (has('p12')) t === 12 ? win('p12', B.p12 * 30) : lose('p12');
    if (has('horn')) {            // one quarter each on 2, 3, 11, 12
      const a = B.horn;
      if (t === 2 || t === 12) win('horn', Math.floor(a * 27 / 4));
      else if (t === 3 || t === 11) win('horn', a * 3);
      else lose('horn');
    }
    if (has('ce')) {              // half on any craps, half on 11
      const a = B.ce;
      if ([2, 3, 12].includes(t)) win('ce', a * 3);
      else if (t === 11) win('ce', a * 7);
      else lose('ce');
    }
    // hardways
    for (const n of [4, 6, 8, 10]) {
      const k = 'hard' + n;
      if (!has(k) || !working) continue;
      if (t === 7) lose(k);
      else if (t === n) hard ? win(k, B[k] * HARD_PAY[n]) : lose(k);
    }
    // big 6 / big 8 (always working)
    for (const n of [6, 8]) {
      const k = 'big' + n;
      if (!has(k)) continue;
      if (t === 7) lose(k); else if (t === n) win(k, B[k]);
    }
    // place, buy, lay
    for (const n of PT) {
      let k = 'place' + n;
      if (has(k) && working) { if (t === 7) lose(k); else if (t === n) win(k, pay(B[k], PLACE_PAY[n])); }
      k = 'buy' + n;
      if (has(k) && working) { if (t === 7) lose(k); else if (t === n) { const w = pay(B[k], TRUE_ODDS[n]); win(k, w - vig(w)); } }
      k = 'lay' + n;
      if (has(k)) { if (t === 7) { const w = pay(B[k], LAY_PAY[n]); win(k, w - vig(w)); } else if (t === n) lose(k); }
    }
    // come and don't come bets already on numbers
    for (const n of PT) {
      const cf = 'come' + n, co = 'come' + n + 'o', df = 'dc' + n, dO = 'dc' + n + 'o';
      if (has(cf)) {
        if (t === n) { if (has(co)) { comeOddsOn ? collect(co, pay(B[co], TRUE_ODDS[n])) : giveBack(co); } collect(cf, B[cf]); }
        else if (t === 7) { if (has(co)) { comeOddsOn ? lose(co) : giveBack(co); } lose(cf); }
      } else if (has(co)) giveBack(co);
      if (has(df)) {
        if (t === 7) { if (has(dO)) collect(dO, pay(B[dO], LAY_PAY[n])); collect(df, B[df]); }
        else if (t === n) { if (has(dO)) lose(dO); lose(df); }
      } else if (has(dO)) giveBack(dO);
    }
    // new come / don't come bets
    if (has('come')) {
      const a = B.come;
      if (t === 7 || t === 11) win('come', a);
      else if ([2, 3, 12].includes(t)) lose('come');
      else { delete B.come; B['come' + t] = a; ev.push({ k: 'come', type: 'move', to: 'come' + t, amt: a }); }
    }
    if (has('dc')) {
      const a = B.dc;
      if (t === 2 || t === 3) win('dc', a);
      else if (t === 12) push('dc');
      else if (t === 7 || t === 11) lose('dc');
      else { delete B.dc; B['dc' + t] = a; ev.push({ k: 'dc', type: 'move', to: 'dc' + t, amt: a }); }
    }
    // line bets and the point
    let newPoint = point, outcome;
    if (comeOut) {
      if (has('pass')) { if (t === 7 || t === 11) win('pass', B.pass); else if ([2, 3, 12].includes(t)) lose('pass'); }
      if (has('dp')) { if (t === 2 || t === 3) win('dp', B.dp); else if (t === 12) push('dp'); else if (t === 7 || t === 11) lose('dp'); }
      if (has('passOdds')) giveBack('passOdds');
      if (has('dpOdds')) giveBack('dpOdds');
      if (PT.includes(t)) { newPoint = t; outcome = 'point'; }
      else outcome = t === 7 || t === 11 ? 'natural' : 'craps';
    } else if (t === point) {
      if (has('pass')) win('pass', B.pass);
      if (has('passOdds')) collect('passOdds', pay(B.passOdds, TRUE_ODDS[point]));
      if (has('dp')) lose('dp');
      if (has('dpOdds')) lose('dpOdds');
      newPoint = null; outcome = 'made';
    } else if (t === 7) {
      if (has('pass')) lose('pass');
      if (has('passOdds')) lose('passOdds');
      if (has('dp')) win('dp', B.dp);
      if (has('dpOdds')) collect('dpOdds', pay(B.dpOdds, LAY_PAY[point]));
      newPoint = null; outcome = 'sevenout';
    } else outcome = 'roll';
    return { bets: B, bank, ev, point: newPoint, total: t, hard, outcome };
  }
  return { PT, TRUE_ODDS, PLACE_PAY, LAY_PAY, HARD_PAY, resolve, oddsMax, layMax };
})();
module.exports = RULES;
