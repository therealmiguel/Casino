// Big games: the schedule of upcoming and live matches in lots of sports, with scores. Information only.
// The data comes from ESPN's public scoreboards; the server checks every 30 minutes, every 2 minutes while games are live,
// and every page reads the result from /api/fixtures.
'use strict';

module.exports = function createFixtures({ fetchImpl, now = () => Date.now() } = {}) {
  const BASE = 'https://site.api.espn.com/apis/site/v2/sports/';
  // FIXTURES_MOCK=file.json (a map of league path -> scoreboard) lets the tests run without the internet
  if (!fetchImpl && process.env.FIXTURES_MOCK) {
    const mock = JSON.parse(require('fs').readFileSync(process.env.FIXTURES_MOCK, 'utf8'));
    fetchImpl = async u => { const k = Object.keys(mock).find(p => u.includes('/' + p + '/')); return { ok: true, status: 200, json: async () => (k ? mock[k] : { events: [] }) }; };
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
  return { start, refresh, view, _test: { normalize, LEAGUES } };
};
