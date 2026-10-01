// A word filter for chat and player names (English and German).
// Text is normalised first (accents, look-alike digits and symbols, repeated letters), so "f.u.u.c.k" or "sch3isse" still match.
'use strict';
const WordFilter = (() => {
  // stems: matched anywhere inside a word
  const STEMS = [
    'fuck', 'fuk', 'fck', 'shit', 'bitch', 'cunt', 'pussy', 'whore', 'slut', 'nigg', 'niga', 'nigr', 'faggot', 'fagot', 'retard', 'wank', 'twat', 'asshole', 'dildo', 'porn', 'jizz', 'hitler',
    'scheis', 'fotze', 'wichs', 'arschloch', 'schwuchtel', 'hurensohn', 'missgeburt', 'fick', 'nutte', 'neger', 'kanake', 'spast', 'behindert', 'schlampe', 'muschi', 'pimmel',
  ];
  // whole words only (these are parts of ordinary words too)
  const WORDS = ['fag', 'fags', 'dick', 'dicks', 'cock', 'cocks', 'kys', 'hure', 'huren', 'arsch', 'cum', 'tits', 'nazi', 'nazis', 'kkk', 'rape', 'raped', 'rapist', 'penis', 'vagina'];
  const MAP = { '0': 'o', '1': 'i', '!': 'i', '|': 'i', '3': 'e', '4': 'a', '@': 'a', '5': 's', '$': 's', '7': 't', '8': 'b', '9': 'g', 'ß': 'ss', 'ä': 'a', 'ö': 'o', 'ü': 'u', '€': 'e', '+': 't' };
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[0-9!|@$€+ß]/g, c => MAP[c] || c).replace(/[äöü]/g, c => MAP[c]);
  // the words of a message, each normalised; runs of single letters are joined (catches "f u c k")
  function pieces(text) {
    const n = norm(text);
    const raw = n.split(/[^a-z]+/).filter(Boolean);
    const words = raw.map(w => w.replace(/(.)\1+/g, '$1'));
    const runs = []; let cur = '';
    for (const w of raw) { if (w.length === 1) cur += w; else { if (cur.length >= 3) runs.push(cur); cur = ''; } }
    if (cur.length >= 3) runs.push(cur);
    return { words, runs: runs.map(r => r.replace(/(.)\1+/g, '$1')) };
  }
  const STEMS_D = STEMS.map(s => s.replace(/(.)\1+/g, '$1'));
  function bad(text) {
    const { words, runs } = pieces(text);
    return [...words, ...runs].some(w => WORDS.includes(w) || STEMS_D.some(s => w.includes(s)));
  }
  // chat: hide bad words with stars, keep the rest of the message
  function clean(text) {
    return String(text || '').replace(/[\p{L}\p{N}$@!|€+.*_-]+/gu, tok => (bad(tok) ? '*'.repeat(Math.min(8, tok.length)) : tok));
  }
  return { bad, clean };
})();
if (typeof module !== 'undefined') module.exports = WordFilter;
