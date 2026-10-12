// Big games: the schedule of upcoming and live matches in lots of sports, with scores. Information only.
// The data comes from ESPN's public scoreboards; the server checks every 30 minutes, every 2 minutes while games are live,
// and every page reads the result from /api/fixtures.
'use strict';

module.exports = function createFixtures({ fetchImpl, now = () => Date.now() } = {}) {
  const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
  // FIXTURES_MOCK=file.json (a map of league path -> scoreboard) lets the tests run without the internet
  if (!fetchImpl && process.env.FIXTURES_MOCK) {
    const mock = JSON.parse(require('fs').readFileSync(process.env.FIXTURES_MOCK, 'utf8'));
    fetchImpl = async u => { const k = Object.keys(mock).sort((a, b) => b.length - a.length).find(p => u.includes('/' + p + '/') || u.includes(p)); return { ok: true, status: 200, json: async () => (k ? mock[k] : { events: [] }) }; };
  }
  const doFetch = fetchImpl || (u => fetch(u, { headers: { 'User-Agent': 'MiguelsCasino/1.0' }, signal: AbortSignal.timeout(12000) }));
  // path, name, sport, how big a deal the league is
  const LEAGUES = [
    ['soccer/uefa.champions', 'Champions League', 'football', 10],
    ['soccer/uefa.europa', 'Europa League', 'football', 6],
    ['soccer/uefa.europa.conf', 'Conference League', 'football', 4],
    ['soccer/fifa.world', 'World Cup', 'football', 12],
    ['soccer/fifa.worldq.uefa', 'World Cup qualifiers', 'football', 8],
    ['soccer/uefa.nations', 'Nations League', 'football', 7],
    ['soccer/uefa.euro', 'European Championship', 'football', 11],
    ['soccer/eng.1', 'Premier League', 'football', 8],
    ['soccer/ger.1', 'Bundesliga', 'football', 7],
    ['soccer/esp.1', 'LaLiga', 'football', 7],
    ['soccer/ita.1', 'Serie A', 'football', 6],
    ['soccer/fra.1', 'Ligue 1', 'football', 5],
    ['soccer/aut.1', 'Austrian Bundesliga', 'football', 7],
    ['basketball/nba', 'NBA', 'basketball', 7],
    ['football/nfl', 'NFL', 'american-football', 7],
    ['hockey/nhl', 'NHL', 'hockey', 5],
    ['baseball/mlb', 'MLB', 'baseball', 4],
    ['racing/f1', 'Formula 1', 'f1', 9],
    ['tennis/atp', 'ATP', 'tennis', 6],
    ['tennis/wta', 'WTA', 'tennis', 6],
  ];
  // clubs and teams people care about: a game with one of them is bigger, with two of them bigger still
  const BIG = /real madrid|barcelona|bayern|dortmund|leverkusen|liverpool|manchester city|manchester united|man city|man united|arsenal|chelsea|tottenham|newcastle|paris saint|psg|inter|juventus|ac milan|napoli|atl[eé]tico|benfica|porto|ajax|salzburg|rapid wien|austria wien|sturm graz|lask|austria$|germany|england|france|spain|italy|portugal|brazil|argentina|netherlands|lakers|celtics|warriors|knicks|nuggets|thunder|bucks|76ers|heat|chiefs|eagles|49ers|cowboys|bills|ravens|packers|yankees|dodgers|mets|red sox|cubs|maple leafs|oilers|rangers|bruins|panthers/i;
  const ICON = { football: '⚽', basketball: '🏀', 'american-football': '🏈', hockey: '🏒', baseball: '⚾', f1: '🏎️', tennis: '🎾' };
  let events = [], updated = 0, errors = {}, timer = null, busy = false;

  const ymd = t => new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
  const team = c => ({
    name: (c.team && (c.team.displayName || c.team.name)) || (c.athlete && c.athlete.displayName) || '?',
    short: (c.team && (c.team.shortDisplayName || c.team.abbreviation)) || (c.athlete && (c.athlete.shortName || c.athlete.displayName)) || '?',
    abbr: (c.team && c.team.abbreviation) || '',
    logo: (c.team && c.team.logo) || (c.athlete && c.athlete.flag && c.athlete.flag.href) || '',
    score: c.score !== undefined && c.score !== null && c.score !== '' ? String(c.score) : (Array.isArray(c.linescores) ? c.linescores.map(l => Math.round(l.value)).join(' ') : ''),
    winner: !!c.winner,
  });
  const st = s => { const t = (s && s.type) || {}; return { state: t.state || 'pre', detail: t.shortDetail || t.detail || '', done: !!t.completed }; };

  function normalize(ev, lg) {
    const [pathKey, leagueName, sport, weight] = lg, out = [];
    const comps = ev.competitions || [];
    if (sport === 'f1') {
      // a Grand Prix weekend: show the qualifying and the race
      for (const c of comps) {
        const kind = ((c.type && (c.type.abbreviation || c.type.text)) || '').toLowerCase();
        if (!/race|qual|sprint/.test(kind)) continue;
        const s = st(c.status);
        const top = (c.competitors || []).slice().sort((a, b) => (a.order || 99) - (b.order || 99)).slice(0, 3).map(team);
        out.push({ id: `${ev.id}-${c.id}`, league: leagueName, path: pathKey, sport, kind: 'race', title: ev.shortName || ev.name, session: /race/.test(kind) ? 'Race' : /sprint/.test(kind) ? 'Sprint' : 'Qualifying',
          start: Date.parse(c.date || ev.date), ...s, podium: s.state !== 'pre' ? top : [], venue: ev.circuit ? [ev.circuit.fullName, ev.circuit.address && ev.circuit.address.country].filter(Boolean).join(', ') : '',
          score: weight + (/race/.test(kind) ? 3 : 0) });
      }
      return out;
    }
    if (sport === 'tennis') {
      // tournaments: only the matches from the quarter-finals on
      for (const g of ev.groupings || []) {
        if (!/singles/i.test((g.grouping && (g.grouping.displayName || g.grouping.slug)) || '')) continue;
        for (const c of g.competitions || []) {
          const round = (c.round && c.round.displayName) || '';
          if (!/quarter|semi|^final|\bfinal$/i.test(round)) continue;
          const cs = c.competitors || []; if (cs.length < 2) continue;
          const s = st(c.status);
          out.push({ id: `${ev.id}-${c.id}`, league: `${ev.name} · ${(g.grouping && g.grouping.displayName) || ''}`.trim(), path: pathKey, sport, kind: 'match', round,
            start: Date.parse(c.date), ...s, home: team(cs[0]), away: team(cs[1]), venue: '', score: weight + (/^final/i.test(round) ? 4 : /semi/i.test(round) ? 2 : 0) });
        }
      }
      return out;
    }
    const c = comps[0]; if (!c) return out;
    const cs = c.competitors || [];
    const home = cs.find(x => x.homeAway === 'home') || cs[0], away = cs.find(x => x.homeAway === 'away') || cs[1];
    if (!home || !away) return out;
    const H = team(home), Aw = team(away);
    const bigs = [H.name, Aw.name].filter(n => BIG.test(n)).length;
    const post = ev.season && ev.season.type === 3 ? 4 : 0;           // playoffs
    const tv = ((c.broadcasts || [])[0] || {}).names || [];
    out.push({ id: String(ev.id), league: leagueName, path: pathKey, sport, kind: 'match', start: Date.parse(ev.date), ...st(ev.status || c.status), home: H, away: Aw,
      venue: c.venue ? [c.venue.fullName, c.venue.address && c.venue.address.city].filter(Boolean).join(', ') : '', tv: tv.slice(0, 2), note: (c.notes && c.notes[0] && c.notes[0].headline) || '',
      score: weight + bigs * 3 + (bigs === 2 ? 2 : 0) + post });
    return out;
  }

  async function loadLeague(lg) {
    const from = now() - 1 * 86400000, to = now() + 8 * 86400000;
    const datesOk = !/^(racing|tennis)\//.test(lg[0]);
    let j = null, why = '';
    // the whole week in one go; if ESPN doesn't like that for a league, its current round instead
    for (const url of datesOk ? [BASE + lg[0] + `/scoreboard?dates=${ymd(from)}-${ymd(to)}`, BASE + lg[0] + '/scoreboard'] : [BASE + lg[0] + '/scoreboard']) {
      try { const r = await doFetch(url); if (r.ok) { j = await r.json(); break; } why = 'HTTP ' + r.status; } catch (e) { why = e.message; }
    }
    if (!j) throw new Error(why || 'no data');
    return (j.events || []).flatMap(ev => { try { return normalize(ev, lg); } catch (e) { return []; } });
  }
  let lastFull = 0;
  async function refresh() {
    if (busy) return; busy = true;
    try {
      const full = now() - lastFull > 30 * 60000;
      const liveLeagues = new Set(events.filter(e => e.state === 'in').map(e => e.path));
      const todo = full ? LEAGUES : LEAGUES.filter(l => liveLeagues.has(l[0]));
      if (!todo.length) return;
      const results = await Promise.all(todo.map(async lg => { try { const r = await loadLeague(lg); delete errors[lg[0]]; return [lg[0], r]; } catch (e) { errors[lg[0]] = e.message; return [lg[0], null]; } }));
      const map = new Map(events.map(e => [e.id, e]));
      for (const [p, list] of results) {
        if (!list) continue;                                  // keep what we had if a league failed this time
        for (const [id, e] of map) if (e.path === p) map.delete(id);
        for (const e of list) map.set(e.id, e);
      }
      const keepFrom = now() - 36 * 3600000, keepTo = now() + 9 * 86400000;
      events = [...map.values()].filter(e => e.start >= keepFrom && e.start <= keepTo).sort((a, b) => a.start - b.start);
      updated = now(); if (full) lastFull = now();
    } finally { busy = false; }
  }
  function start() {
    refresh().catch(() => {});
    timer = setInterval(() => { refresh().catch(() => {}); }, 2 * 60000);    // live leagues every 2 minutes, everything every 30
    if (timer.unref) timer.unref();
  }
  // the big ones: live games first, then the most important games of the next three days
  function view() {
    const t = now();
    const live = events.filter(e => e.state === 'in');
    const soon = events.filter(e => e.state === 'pre' && e.start > t - 600000 && e.start < t + 3 * 86400000);
    const featured = [...live.sort((a, b) => b.score - a.score), ...soon.sort((a, b) => b.score - a.score || a.start - b.start)].slice(0, 10)
      .sort((a, b) => ((b.state === 'in') - (a.state === 'in')) || a.start - b.start);
    return { updated, now: t, featured, events, icons: ICON, sports: [...new Set(LEAGUES.map(l => l[2]))], ok: updated > 0, failing: Object.keys(errors).length, errors };
  }
  /* ---------- one match in detail: stats, events, lineups, box score, leaders, plays ---------- */
  const sumCache = new Map();
  const arr = x => (Array.isArray(x) ? x : []);
  const nm = a => (a && (a.displayName || a.shortName || a.fullName)) || '';
  function sideOf(teamObj, homeId, awayId) { const id = teamObj && String(teamObj.id || ''); return id && id === homeId ? 'home' : id && id === awayId ? 'away' : ''; }
  function shapeSummary(j, pathKey, id) {
    const lg = LEAGUES.find(l => l[0] === pathKey) || [pathKey, '', '', 0];
    const comp = ((j.header && j.header.competitions) || [])[0] || {};
    const cs = arr(comp.competitors);
    const H = cs.find(c => c.homeAway === 'home') || cs[0] || {}, Aw = cs.find(c => c.homeAway === 'away') || cs[1] || {};
    const homeId = String((H.team && H.team.id) || H.id || ''), awayId = String((Aw.team && Aw.team.id) || Aw.id || '');
    const side = c => ({ name: nm(c.team), short: (c.team && (c.team.shortDisplayName || c.team.abbreviation)) || '', logo: (c.team && (c.team.logo || (arr(c.team.logos)[0] || {}).href)) || '',
      color: c.team && c.team.color ? '#' + c.team.color : '', score: c.score !== undefined ? String(c.score) : '', record: (arr(c.record)[0] || {}).summary || (arr(c.records)[0] || {}).summary || '',
      periods: arr(c.linescores).map(l => l.displayValue !== undefined ? String(l.displayValue) : String(l.value ?? '')), winner: !!c.winner });
    const status = st(comp.status || (j.header && j.header.status));
    const out = { id, path: pathKey, league: lg[1], sport: lg[2], ...status, start: Date.parse(comp.date || ''), home: side(H), away: side(Aw), venue: '', attendance: 0, stats: [], events: [], leaders: [], lineups: null, box: [], plays: [], winProb: null };
    const gi = j.gameInfo || {};
    if (gi.venue) out.venue = [gi.venue.fullName, gi.venue.address && gi.venue.address.city].filter(Boolean).join(', ');
    if (gi.attendance) out.attendance = gi.attendance;
    // team statistics side by side
    const bt = arr(j.boxscore && j.boxscore.teams);
    const tH = bt.find(t => t.homeAway === 'home' || sideOf(t.team, homeId, awayId) === 'home'), tA = bt.find(t => t.homeAway === 'away' || sideOf(t.team, homeId, awayId) === 'away');
    if (tH && tA) {
      const mapA = new Map(arr(tA.statistics).map(x => [x.name || x.label, x]));
      out.stats = arr(tH.statistics).map(x => { const y = mapA.get(x.name || x.label); return y ? { label: x.label || x.name, home: String(x.displayValue ?? ''), away: String(y.displayValue ?? '') } : null; })
        .filter(x => x && x.label && (x.home !== '' || x.away !== '')).slice(0, 18);
    }
    // what happened: goals, cards and substitutions (football) or scoring plays (other sports)
    const kinds = t => { t = (t || '').toLowerCase(); return /own goal/.test(t) ? 'goal' : /goal|penalty - scored/.test(t) ? 'goal' : /red card/.test(t) ? 'red' : /yellow/.test(t) ? 'yellow' : /substitution/.test(t) ? 'sub' : /touchdown|field goal|safety/.test(t) ? 'score' : 'other'; };
    for (const k of arr(j.keyEvents)) {
      const type = kinds((k.type && (k.type.text || k.type.type)) || k.text);
      if (type === 'other' && !k.scoringPlay) continue;
      out.events.push({ min: (k.clock && k.clock.displayValue) || '', type, side: sideOf(k.team, homeId, awayId), who: arr(k.participants).map(p => nm(p.athlete)).filter(Boolean).slice(0, 2), text: k.text || (k.type && k.type.text) || '' });
    }
    if (!out.events.length) for (const p of arr(j.scoringPlays)) {
      out.events.push({ min: [p.period && p.period.number ? 'Q' + p.period.number : '', p.clock && p.clock.displayValue].filter(Boolean).join(' '), type: 'score', side: sideOf(p.team, homeId, awayId), who: [], text: p.text || '', score: `${p.homeScore ?? ''}–${p.awayScore ?? ''}` });
    }
    out.events = out.events.slice(-40);
    // best players of each team
    for (const L of arr(j.leaders)) {
      const s = sideOf(L.team, homeId, awayId); if (!s) continue;
      for (const cat of arr(L.leaders).slice(0, 4)) {
        const top = arr(cat.leaders)[0]; if (!top) continue;
        let row = out.leaders.find(r => r.cat === (cat.displayName || cat.name));
        if (!row) { row = { cat: cat.displayName || cat.name }; out.leaders.push(row); }
        row[s] = { name: nm(top.athlete), value: top.displayValue || '', photo: (top.athlete && top.athlete.headshot && top.athlete.headshot.href) || '' };
      }
    }
    // football lineups
    const rs = arr(j.rosters).filter(r => arr(r.roster).length);
    if (rs.length) {
      out.lineups = {};
      for (const r of rs) {
        const s = r.homeAway || sideOf(r.team, homeId, awayId); if (!s) continue;
        const pl = arr(r.roster).map(p => ({ n: p.jersey || '', name: nm(p.athlete), pos: (p.position && p.position.abbreviation) || '', starter: !!p.starter, in: !!p.subbedIn, out: !!p.subbedOut,
          goals: +((arr(p.stats).find(x => x.name === 'totalGoals') || {}).value || 0), cards: ((arr(p.stats).find(x => x.name === 'yellowCards') || {}).value ? 'Y' : '') + ((arr(p.stats).find(x => x.name === 'redCards') || {}).value ? 'R' : '') }));
        out.lineups[s] = { formation: r.formation || '', starters: pl.filter(p => p.starter), subs: pl.filter(p => !p.starter).slice(0, 12) };
      }
    }
    // box score (basketball, american football, hockey, baseball): the main table of each team
    for (const t of arr(j.boxscore && j.boxscore.players).slice().sort((a, b) => (sideOf(a.team, homeId, awayId) === 'home' ? 0 : 1) - (sideOf(b.team, homeId, awayId) === 'home' ? 0 : 1))) {
      const s = sideOf(t.team, homeId, awayId) || (t.team && t.team.displayName === out.home.name ? 'home' : 'away');
      for (const g of arr(t.statistics).slice(0, lg[2] === 'american-football' ? 3 : 1)) {
        const cols = arr(g.labels).length ? g.labels : arr(g.names);
        const rows = arr(g.athletes).filter(a => arr(a.stats).length).slice(0, 14).map(a => ({ name: nm(a.athlete), pos: (a.athlete && a.athlete.position && a.athlete.position.abbreviation) || '', starter: !!a.starter, stats: a.stats.map(String) }));
        if (rows.length) out.box.push({ side: s, title: g.text || g.name || '', cols: cols.slice(0, 12), rows: rows.map(r => Object.assign(r, { stats: r.stats.slice(0, 12) })) });
      }
    }
    // the latest plays, newest first
    const plays = arr(j.plays).length ? arr(j.plays) : arr(j.commentary).map(c => ({ text: c.text, clock: c.time || c.clock, team: c.play && c.play.team }));
    out.plays = plays.slice(-25).reverse().map(p => ({ t: (p.clock && (p.clock.displayValue || p.clock)) || (p.period && p.period.displayValue) || '', text: String(p.text || '').slice(0, 220), side: sideOf(p.team, homeId, awayId), scoring: !!p.scoringPlay, score: p.scoringPlay ? `${p.homeScore ?? ''}–${p.awayScore ?? ''}` : '' })).filter(p => p.text);
    const wp = arr(j.winprobability); if (wp.length) out.winProb = Math.round((wp[wp.length - 1].homeWinPercentage || 0) * 100);
    return out;
  }
  async function summary(pathKey, id) {
    if (!LEAGUES.some(l => l[0] === pathKey) || !/^\d{1,12}$/.test(String(id))) return null;
    const key = pathKey + ':' + id, hit = sumCache.get(key);
    const ev = events.find(e => e.id === String(id));
    const ttl = ev && ev.state === 'in' ? 25000 : ev && ev.state === 'post' ? 600000 : 300000;
    if (hit && now() - hit.t < ttl) return hit.v;
    const r = await doFetch(BASE + pathKey + '/summary?event=' + id);
    if (!r.ok) { if (hit) return hit.v; throw new Error('HTTP ' + r.status); }
    const v = shapeSummary(await r.json(), pathKey, String(id));
    // anything ESPN left out of the details, the schedule already knows
    if (ev) {
      for (const k of ['home', 'away']) if (!v[k].name && ev[k]) v[k] = Object.assign({ periods: [], record: '', color: '' }, ev[k]);
      if (!v.start) v.start = ev.start;
      if (!v.detail) { v.state = ev.state; v.detail = ev.detail; }
      if (!v.venue) v.venue = ev.venue || '';
    }
    sumCache.set(key, { t: now(), v });
    if (sumCache.size > 300) sumCache.delete(sumCache.keys().next().value);
    return v;
  }
  return { start, refresh, view, summary, _test: { normalize, shapeSummary, LEAGUES } };
};
