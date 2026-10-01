<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Back Room</title>
<style>
:root{
  color-scheme: dark;
  --bg:#0C0B10; --panel:#15131B; --panel-2:#1D1A25; --line:rgba(255,255,255,.08); --line-2:rgba(255,255,255,.14);
  --text:#EEEAF4; --muted:#9E97AC; --dim:#6F6880; --gold:#E9C46A; --gold-2:#F6DE9C;
  --good:#58D18F; --warn:#F2B35B; --bad:#F2786D; --info:#7CB8F2;
  --mono:ui-monospace,"JetBrains Mono",Menlo,Consolas,monospace; --body:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 var(--body)}
button,input,select,textarea{font:inherit;color:inherit}
:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
a{color:var(--gold-2)}
/* login */
.login{min-height:100vh;display:grid;place-items:center;padding:16px}
.lcard{width:min(380px,100%);background:var(--panel);border:1px solid var(--line-2);border-radius:18px;padding:28px 24px;box-shadow:0 30px 80px rgba(0,0,0,.5)}
.lcard h1{margin:0 0 4px;font-size:22px;letter-spacing:-.01em}
.lcard p{margin:0 0 20px;color:var(--muted)}
label{display:block;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:12px 0 6px}
input[type=text],input[type=password],input[type=number],input[type=search],select,textarea{width:100%;background:#0A090E;border:1px solid var(--line-2);border-radius:10px;padding:10px 12px}
textarea{resize:vertical;min-height:70px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 14px;border-radius:10px;border:1px solid var(--line-2);background:var(--panel-2);cursor:pointer;font-weight:650;white-space:nowrap}
.btn:hover:not(:disabled){background:#27232F}
.btn:disabled{opacity:.4;cursor:not-allowed}
.btn.gold{background:linear-gradient(180deg,var(--gold-2),var(--gold));color:#231A05;border-color:transparent}
.btn.bad{border-color:rgba(242,120,109,.5);color:#FFB4AB}
.btn.small{padding:6px 10px;font-size:13px}
.err{color:#FFB4AB;min-height:20px;margin-top:10px;font-size:13px}
/* shell */
.top{position:sticky;top:0;z-index:10;display:flex;align-items:center;gap:12px;padding:12px 20px;background:rgba(12,11,16,.92);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.top h1{margin:0;font-size:17px;display:flex;align-items:center;gap:8px}
.top h1 i{width:9px;height:9px;border-radius:50%;background:var(--good);box-shadow:0 0 10px var(--good)}
.tabs{display:flex;gap:4px;margin-left:12px;flex-wrap:wrap}
.tab{padding:7px 12px;border-radius:9px;border:0;background:none;color:var(--muted);cursor:pointer;font-weight:650}
.tab[aria-selected=true]{background:var(--panel-2);color:var(--text)}
.tab .n{display:inline-block;min-width:18px;padding:0 5px;margin-left:5px;border-radius:9px;background:rgba(242,120,109,.2);color:#FFB4AB;font-size:11.5px;text-align:center}
.sp{flex:1}
.chip{display:inline-flex;align-items:center;gap:6px;padding:3px 9px;border-radius:999px;font-size:12px;font-weight:700;border:1px solid var(--line-2);color:var(--muted);white-space:nowrap}
.chip::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
.chip.good{color:var(--good)} .chip.warn{color:var(--warn)} .chip.bad{color:var(--bad)} .chip.info{color:var(--info)} .chip.plain::before{display:none}
main{max-width:1240px;margin:0 auto;padding:20px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:18px}
.tile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 16px}
.tile .k{font-size:12px;color:var(--muted);font-weight:650}
.tile .v{font:700 26px/1.2 var(--mono);margin-top:4px;font-variant-numeric:tabular-nums}
.tile .s{font-size:12.5px;color:var(--dim);margin-top:2px}
.grid2{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px}
@media (max-width:900px){.grid2{grid-template-columns:minmax(0,1fr)}.tabs{margin-left:0}}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px;margin-bottom:16px;min-width:0}
.card h2{margin:0 0 12px;font-size:15px;display:flex;align-items:center;gap:8px}
.card h2 small{font-weight:500;color:var(--muted);font-size:12.5px}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:8px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
th{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);font-weight:700;white-space:nowrap;cursor:default}
th.sort{cursor:pointer} th.sort:hover{color:var(--text)}
td.num,th.num{text-align:right;font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
tr.click{cursor:pointer} tr.click:hover td{background:rgba(255,255,255,.03)}
.wrap{overflow-x:auto}
.pos{color:var(--good)} .neg{color:var(--bad)} .muted{color:var(--muted)} .dim{color:var(--dim)}
.who{display:flex;align-items:center;gap:9px;min-width:0}
.av{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;font-weight:800;color:#15131B;flex:none;font-size:13px}
.nm{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px}
.tags{display:flex;gap:5px;flex-wrap:wrap}
.log li{list-style:none;padding:8px 0;border-bottom:1px solid var(--line);display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:start}
.log{margin:0;padding:0}
.log .t{font:12px var(--mono);color:var(--dim);white-space:nowrap}
.log .d{min-width:0}
.log .d b{font-weight:650}
.log .d div{color:var(--muted);font-size:13px;overflow-wrap:anywhere}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.help{color:var(--muted);font-size:13px;margin:0 0 10px}
/* drawer */
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:20}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,100%);background:var(--panel);border-left:1px solid var(--line-2);z-index:21;overflow-y:auto;padding:20px;box-shadow:-20px 0 60px rgba(0,0,0,.5)}
.drawer h2{margin:0;font-size:20px;display:flex;gap:10px;align-items:center}
.drawer h3{margin:20px 0 8px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.kv{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.kv div{background:var(--panel-2);border-radius:10px;padding:8px 10px}
.kv span{display:block;font-size:11.5px;color:var(--muted)}
.kv b{font:700 15px var(--mono);font-variant-numeric:tabular-nums}
.acts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.act{background:var(--panel-2);border-radius:12px;padding:12px}
.act .row{margin-top:8px}
.act input{padding:8px 10px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#221E2B;border:1px solid var(--line-2);border-radius:12px;padding:10px 16px;z-index:40;font-weight:650;box-shadow:0 12px 30px rgba(0,0,0,.5)}
.empty{color:var(--dim);padding:14px 0;text-align:center}
.switch{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-bottom:1px solid var(--line)}
.switch:last-child{border-bottom:0}
.switch b{display:block}
.switch span{color:var(--muted);font-size:13px}
@media (max-width:640px){main{padding:14px}.top{padding:10px 14px;flex-wrap:wrap}.acts{grid-template-columns:minmax(0,1fr)}.kv{grid-template-columns:repeat(2,minmax(0,1fr))}.hide-sm{display:none}}
</style>
</head>
<body>
<section class="login" id="login" hidden>
  <form class="lcard" id="lform" autocomplete="on">
    <h1>Back room</h1>
    <p>Staff only.</p>
    <label for="lu">Username</label><input type="text" id="lu" autocomplete="username" required>
    <label for="lp">Password</label><input type="password" id="lp" autocomplete="current-password" required>
    <div class="err" id="lerr" role="alert"></div>
    <button class="btn gold" style="width:100%;margin-top:6px" type="submit">Sign in</button>
  </form>
</section>

<div id="app" hidden>
  <header class="top">
    <h1><i></i>Miguel's Casino · Back room</h1>
    <nav class="tabs" role="tablist">
      <button class="tab" role="tab" data-tab="overview" aria-selected="true">Overview</button>
      <button class="tab" role="tab" data-tab="players" aria-selected="false">Players</button>
      <button class="tab" role="tab" data-tab="security" aria-selected="false">Security<span class="n" id="secN" hidden></span></button>
      <button class="tab" role="tab" data-tab="controls" aria-selected="false">Controls</button>
    </nav>
    <div class="sp"></div>
    <span class="chip" id="stChip"></span>
    <button class="btn small" id="refresh" title="Refresh">Refresh</button>
    <button class="btn small" id="logout">Sign out</button>
  </header>
  <main>
    <section data-view="overview">
      <div class="tiles" id="tiles"></div>
      <div class="grid2">
        <div>
          <div class="card"><h2>House books <small>every bet since the security upgrade</small></h2><div class="wrap"><table id="house"></table></div></div>
          <div class="card"><h2>Biggest wins <small>last 7 days</small></h2><div class="wrap"><table id="wins"></table></div></div>
        </div>
        <div>
          <div class="card"><h2>Live tables</h2><div id="liveBox"></div></div>
          <div class="card"><h2>Latest alerts</h2><ul class="log" id="alerts"></ul></div>
        </div>
      </div>
    </section>

    <section data-view="players" hidden>
      <div class="card">
        <div class="row" style="margin-bottom:12px">
          <input type="search" id="q" placeholder="Search by name, id or IP" style="max-width:320px" aria-label="Search players">
          <select id="filter" style="max-width:220px" aria-label="Filter">
            <option value="all">Everyone</option><option value="online">Online now</option><option value="alerts">With alerts</option>
            <option value="banned">Suspended</option><option value="flagged">Balance not trusted at upgrade</option><option value="noname">No name yet</option>
          </select>
          <div class="sp"></div><span class="muted" id="pcount"></span>
        </div>
        <div class="wrap"><table id="ptable"></table></div>
      </div>
    </section>

    <section data-view="security" hidden>
      <div class="card">
        <h2>Security log <small>attempts to cheat, wrong keys, odd requests</small></h2>
        <p class="help"><b>Tamper</b>: someone sent a fake bankroll to the old leaderboard address. <b>Wrong key</b>: someone tried to play as another player. <b>Invalid</b>: a bet the tables don't allow (usually edited by hand). <b>Rate limit</b>: requests faster than a person can play. <b>Admin login</b>: a wrong password on this page. <b>Chip dump?</b>: someone lost a big poker pot to a player on the same network, which is how alt accounts pass money to a main account. <b>Old page</b>: an out-of-date page reported a different bankroll (harmless, it's ignored).</p>
        <div class="row" style="margin-bottom:10px"><select id="secKind" style="max-width:220px" aria-label="Kind"><option value="">All kinds</option><option>tamper</option><option>wrong-key</option><option>invalid</option><option>rate-limit</option><option>admin-login</option><option>chip-dump</option><option>chat</option><option>legacy</option></select><div class="sp"></div><button class="btn small bad" id="clearLog">Clear log</button></div>
        <ul class="log" id="seclog"></ul>
      </div>
    </section>

    <section data-view="controls" hidden>
      <div class="grid2">
        <div>
          <div class="card">
            <h2>Announcement</h2>
            <p class="help">Shows a banner at the top of every page for everyone in the casino.</p>
            <textarea id="nText" maxlength="200" placeholder="Happy hour! Everyone gets $500 at 8pm."></textarea>
            <div class="row" style="margin-top:10px">
              <select id="nKind" style="max-width:160px" aria-label="Style"><option value="info">Gold</option><option value="party">Party</option><option value="warn">Warning</option></select>
              <select id="nHours" style="max-width:170px" aria-label="How long"><option value="1">For 1 hour</option><option value="3">For 3 hours</option><option value="24" selected>For 1 day</option><option value="168">For 1 week</option><option value="0">Until I remove it</option></select>
              <button class="btn gold" id="nSend">Post</button><button class="btn" id="nClear">Remove</button>
            </div>
            <p class="help" id="nNow" style="margin-top:10px"></p>
          </div>
          <div class="card">
            <h2>Happy hour</h2>
            <p class="help">Boost everyone's winnings on a game for a while. A banner tells the whole casino.</p>
            <div class="row"><select id="hhGame" style="max-width:170px" aria-label="Game"><option value="all">Every game</option><option value="slots">Slots</option><option value="blackjack">Blackjack</option><option value="roulette">Roulette</option><option value="craps">Craps</option><option value="plinko">Plinko</option><option value="mines">Mines</option><option value="chicken">Cluck Crossing</option><option value="crash">Crash</option><option value="live-bc">Baccarat</option><option value="live-dc">Dice City</option></select>
              <select id="hhMult" style="max-width:110px" aria-label="Boost"><option value="1.5">×1.5</option><option value="2" selected>×2</option><option value="3">×3</option></select>
              <select id="hhHours" style="max-width:130px" aria-label="How long"><option value="0.5">30 minutes</option><option value="1" selected>1 hour</option><option value="2">2 hours</option><option value="6">6 hours</option><option value="24">1 day</option></select>
              <button class="btn gold" id="hhGo">Start</button><button class="btn" id="hhStop">Stop</button></div>
            <div class="row" style="margin-top:12px"><b style="flex:1">Double XP</b><select id="xpHours" style="max-width:130px" aria-label="How long"><option value="1">1 hour</option><option value="3">3 hours</option><option value="24" selected>1 day</option><option value="72">3 days</option></select><button class="btn gold" id="xpGo">Start</button><button class="btn" id="xpStop">Stop</button></div>
            <p class="help" id="evNow" style="margin-top:10px"></p>
          </div>
          <div class="card">
            <h2>Free spins</h2>
            <p class="help">Free spins on Dynamite Diggers. Players see a button on the slot and a popup.</p>
            <div class="row"><input type="number" id="fsN" min="1" max="100" value="10" style="max-width:90px" aria-label="Spins"><span class="muted">spins at</span>
              <select id="fsBet" style="max-width:110px" aria-label="Bet"><option value="20">$0.20</option><option value="100" selected>$1</option><option value="200">$2</option><option value="1000">$10</option></select>
              <select id="fsTo" style="max-width:180px" aria-label="Who"><option value="all">Everyone</option><option value="online">Online now</option></select><button class="btn gold" id="fsGo">Give</button></div>
          </div>
          <div class="card">
            <h2>Gift chips</h2>
            <p class="help">Adds money to every named player's bankroll. It shows up in their history as a gift from the casino.</p>
            <div class="row"><input type="number" id="gAmt" min="1" step="1" placeholder="Amount in $" style="max-width:150px" aria-label="Amount in dollars">
              <select id="gTo" style="max-width:190px" aria-label="Who"><option value="online">Players online now</option><option value="all">Everyone</option></select>
              <input type="text" id="gNote" maxlength="60" placeholder="Note (optional)" style="max-width:200px" aria-label="Note">
              <button class="btn gold" id="gSend">Send gift</button></div>
          </div>
        </div>
        <div>
          <div class="card">
            <h2>Casino switches</h2>
            <div class="switch"><div><b>Close the casino</b><span>Every table stops taking bets (use it before updating the site).</span></div><button class="btn" id="swClosed"></button></div>
            <div class="switch"><div><b>Lock new players out</b><span>Only people who already have a seat can play.</span></div><button class="btn" id="swLocked"></button></div>
          </div>
          <div class="card">
            <h2>Rig the next live round <small class="dim" style="font-size:12px">secret</small></h2>
            <p class="help">Pick what the next round at a live table will be, for everyone at it. It's used once, then the table goes back to random. Blackjack and Hold'em can't be rigged per round (blackjack's shoe is shared and poker is player against player).</p>
            <div class="row" style="flex-wrap:wrap;gap:8px">
              <span style="min-width:140px">🚀 Crash crashes at</span><input type="number" id="rgCr" min="1" max="1000" step="0.01" placeholder="e.g. 1.00 or 50" style="max-width:150px" aria-label="Crash point"><button class="btn small" data-rig="cr">Set</button>
            </div>
            <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:8px">
              <span style="min-width:140px">⚡ Roulette lands on</span><input type="number" id="rgRl" min="0" max="36" placeholder="0–36" style="max-width:150px" aria-label="Roulette number"><button class="btn small" data-rig="rl">Set</button>
            </div>
            <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:8px">
              <span style="min-width:140px">🏙️ Dice City rolls</span><input type="number" id="rgDc" min="2" max="12" placeholder="2–12" style="max-width:150px" aria-label="Dice total"><button class="btn small" data-rig="dc">Set</button>
            </div>
            <div class="row" style="flex-wrap:wrap;gap:8px;margin-top:8px">
              <span style="min-width:140px">🎴 Baccarat winner</span><select id="rgBc" style="max-width:150px" aria-label="Baccarat winner"><option value="player">Player</option><option value="banker">Banker</option><option value="tie">Tie</option></select><button class="btn small" data-rig="bc">Set</button>
            </div>
            <p class="help" id="rigNow" style="margin-top:10px"></p>
          </div>
          <div class="card">
            <h2>Table chat</h2>
            <p class="help">The latest messages from every live table. Swear words are starred out automatically; messages that are still rude aren't sent and show up in the security log. Mute someone from their profile.</p>
            <ul class="log" id="chatList" style="max-height:260px;overflow:auto"></ul>
            <div class="row" style="margin-top:10px"><button class="btn small bad" id="chatClear">Clear every table's chat</button></div>
          </div>
          <div class="card">
            <h2>Season</h2>
            <p class="help" id="seasonNow"></p>
            <div class="row"><button class="btn bad" id="seasonEnd">End the season now</button></div>
          </div>
          <div class="card">
            <h2>Weekly tournament</h2>
            <p class="help" id="tourNow"></p>
            <div class="row"><input type="number" id="tp1" min="0" placeholder="1st $" style="max-width:110px" aria-label="First prize"><input type="number" id="tp2" min="0" placeholder="2nd $" style="max-width:110px" aria-label="Second prize"><input type="number" id="tp3" min="0" placeholder="3rd $" style="max-width:110px" aria-label="Third prize"><button class="btn" id="tpSave">Save prizes</button></div>
            <div class="row" style="margin-top:10px"><button class="btn bad" id="tourEnd">End this week's tournament now</button></div>
          </div>
          <div class="card">
            <h2>Mega jackpot</h2>
            <p class="help" id="jpNow"></p>
            <div class="row"><input type="number" id="jpPool" min="0" placeholder="Pot now $" style="max-width:140px" aria-label="Pot now"><input type="number" id="jpSeed" min="0" placeholder="Restart at $" style="max-width:140px" aria-label="Restart at"><button class="btn" id="jpSave">Save</button></div>
          </div>
          <div class="card">
            <h2>Backup</h2>
            <p class="help">Download every player, balance and history as one file.</p>
            <button class="btn" id="export">Download backup</button>
          </div>
          <div class="card"><h2>What you did <small>admin actions</small></h2><ul class="log" id="auditlog"></ul></div>
        </div>
      </div>
    </section>
  </main>
</div>

<div class="scrim" id="scrim" hidden></div>
<aside class="drawer" id="drawer" hidden aria-label="Player"></aside>
<div class="toast" id="toast" hidden role="status"></div>

<script>
(() => {
'use strict';
const BASE = '/__ADMIN_PATH__/api/';
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = c => (c < 0 ? '−' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: Math.abs(c) % 100 ? 2 : 0, maximumFractionDigits: 2 });
const usdS = c => (c > 0 ? '+' : '') + usd(c);
const ago = t => { if (!t) return '—'; const s = (Date.now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; return Math.round(s / 86400) + 'd ago'; };
const when = t => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const COLORS = ['#E8C170', '#E07A5F', '#81B29A', '#9C89B8', '#F2CC8F', '#6FB1D6', '#E5989B', '#B5E48C'];
const tint = s => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COLORS[h % COLORS.length]; };
const GAMES = { chicken: 'Cluck Crossing', crash: 'Crash', 'live-dc': 'Dice City', bonus: 'Bonuses & challenges', jackpot: 'Mega jackpot', tournament: 'Tournament prizes', event: 'Happy hour & free spins', tip: 'Tip', season: 'Season', slots2: 'Cosmic Cascade', plinko: 'Plinko', mines: 'Mines', crash: 'Crash', 'live-bc': 'Live baccarat', slots: 'Dynamite Diggers', roulette: 'Voltage Roulette', blackjack: 'Brass Table Blackjack', craps: 'Bubble Dome Craps', 'live-bj': 'Live blackjack', 'live-rl': 'Live roulette', poker: 'Hold’em (player vs player)', live: 'Live tables', admin: 'Casino', reset: 'Fresh $1,000', import: 'Upgrade', join: 'Joined', table: 'Poker chips' };
let toastT;
function toast(m) { const t = $('toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600); }
async function api(path, body) {
  const r = await fetch(BASE + path, { method: body ? 'POST' : 'GET', headers: Object.assign({ 'X-Backroom': '1' }, body ? { 'Content-Type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  if (r.status === 404 && path !== 'session') { showLogin(); throw new Error('Signed out'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}

/* ---------- login ---------- */
function showLogin() { $('app').hidden = true; $('login').hidden = false; setTimeout(() => $('lu').focus(), 30); }
$('lform').addEventListener('submit', async e => {
  e.preventDefault(); $('lerr').textContent = '';
  try { await api('login', { user: $('lu').value, pass: $('lp').value }); $('lp').value = ''; enter(); }
  catch (x) { $('lerr').textContent = x.message; }
});
$('logout').onclick = async () => { try { await api('logout', {}); } catch (e) {} showLogin(); };

/* ---------- tabs ---------- */
let tab = 'overview';
document.querySelectorAll('.tab').forEach(b => b.onclick = () => { tab = b.dataset.tab; document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === b)); document.querySelectorAll('[data-view]').forEach(v => { v.hidden = v.dataset.view !== tab; }); load(); });

/* ---------- data ---------- */
let OV = null, PL = [], sortKey = 'cash', sortDir = -1, secSeen = +(localStorage.getItem('bk-sec-seen') || 0);
async function load() {
  try {
    OV = await api('overview');
    if (tab === 'players' || !PL.length) PL = await api('players');
    render();
  } catch (e) { if (e.message !== 'Signed out') toast(e.message); }
}
function render() {
  if (!OV) return;
  const st = OV.settings;
  const chip = $('stChip');
  chip.className = 'chip ' + (st.closed ? 'bad' : 'good');
  chip.textContent = st.closed ? 'Casino closed' : 'Casino open';
  const newSec = OV.security.filter(e => e.t > secSeen && e.kind !== 'legacy').length;
  $('secN').hidden = !newSec; $('secN').textContent = newSec;
  if (tab === 'overview') renderOverview();
  if (tab === 'players') renderPlayers();
  if (tab === 'security') { renderSecurity(); secSeen = Date.now(); localStorage.setItem('bk-sec-seen', secSeen); $('secN').hidden = true; }
  if (tab === 'controls') renderControls();
}
function renderOverview() {
  let wag = 0, paid = 0, rounds = 0;
  for (const [g, h] of Object.entries(OV.house)) { if (g === 'poker') continue; wag += h.wagered; paid += h.paid; rounds += h.rounds; }
  const profit = wag - paid;
  $('tiles').innerHTML = [
    ['Players', OV.named.toLocaleString(), `${OV.players} seats · ${OV.banned} suspended`],
    ['Online now', OV.online.toLocaleString(), 'active in the last 3 minutes'],
    ['Money in the casino', usd(OV.money), 'all bankrolls and chips on tables'],
    ['House result', usdS(profit), `${rounds.toLocaleString()} rounds · ${wag ? (paid / wag * 100).toFixed(1) + '% paid back' : 'no bets yet'}`],
  ].map(([k, v, s]) => `<div class="tile"><div class="k">${k}</div><div class="v ${k === 'House result' ? (profit >= 0 ? 'pos' : 'neg') : ''}">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join('');
  const rows = Object.entries(OV.house).filter(([g]) => GAMES[g]).sort((a, b) => b[1].wagered - a[1].wagered);
  $('house').innerHTML = `<thead><tr><th>Game</th><th class="num">Rounds</th><th class="num">Bet</th><th class="num">Paid out</th><th class="num">House result</th><th class="num hide-sm">Paid back</th></tr></thead><tbody>` +
    (rows.length ? rows.map(([g, h]) => {
      const pr = h.wagered - h.paid, p2p = g === 'poker';
      return `<tr><td>${esc(GAMES[g])}</td><td class="num">${h.rounds.toLocaleString()}</td><td class="num">${p2p ? '—' : usd(h.wagered)}</td><td class="num">${p2p ? '—' : usd(h.paid)}</td><td class="num ${p2p ? 'dim' : pr >= 0 ? 'pos' : 'neg'}">${p2p ? 'players only' : usdS(pr)}</td><td class="num hide-sm">${p2p || !h.wagered ? '—' : (h.paid / h.wagered * 100).toFixed(1) + '%'}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">No bets yet.</td></tr>') + '</tbody>';
  $('wins').innerHTML = `<thead><tr><th>Player</th><th>Game</th><th class="num">Won</th><th class="num hide-sm">When</th></tr></thead><tbody>` +
    (OV.bigWins.length ? OV.bigWins.map(w => `<tr class="click" data-id="${esc(w.id)}"><td>${esc(w.name || '(no name)')}</td><td>${esc(GAMES[w.game] || w.game)}</td><td class="num pos">${usd(w.amount)}</td><td class="num hide-sm dim">${ago(w.t)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">No payouts over $500 this week.</td></tr>') + '</tbody>';
  const L = OV.live;
  $('liveBox').innerHTML = `<table><tbody>
    <tr><td>Live blackjack</td><td class="num">${L.bj.seated} of 5 seats</td><td class="muted">${esc(L.bj.phase)}</td></tr>
    <tr><td>Live roulette</td><td class="num">${L.rl.players} at the wheel</td><td class="muted">${esc(L.rl.phase)}</td></tr>
    <tr><td>Hold’em</td><td class="num">${L.pk.seated} of 6 seats</td><td class="muted">${esc(L.pk.street)}</td></tr></tbody></table>
    <p class="help" style="margin:10px 0 0">Server up since ${when(OV.startedAt)} · saved in ${esc(OV.storage)}</p>`;
  $('alerts').innerHTML = logItems(OV.security.filter(e => e.kind !== 'legacy').slice(0, 6)) || '<li class="empty" style="display:block">All quiet.</li>';
}
const KIND = { tamper: ['bad', 'Tamper'], 'wrong-key': ['bad', 'Wrong key'], 'chip-dump': ['warn', 'Chip dump?'], chat: ['info', 'Chat'], invalid: ['warn', 'Invalid'], 'rate-limit': ['warn', 'Rate limit'], 'admin-login': ['bad', 'Admin login'], legacy: ['info', 'Old page'] };
function logItems(list) {
  return list.map(e => {
    const [cls, lab] = KIND[e.kind] || ['info', e.kind];
    const who = e.id ? `<a href="#" data-id="${esc(e.id)}">${esc(e.name || '(no name)')}</a>` : '<span class="muted">Unknown visitor</span>';
    return `<li><span class="chip ${cls}">${esc(lab)}</span><div class="d"><b>${who}</b>${e.ip ? ` <span class="dim">· ${esc(e.ip)}</span>` : ''}<div>${esc(e.detail)}</div></div><span class="t">${ago(e.t)}</span></li>`;
  }).join('');
}
function renderSecurity() {
  const k = $('secKind').value;
  const list = OV.security.filter(e => !k || e.kind === k);
  $('seclog').innerHTML = logItems(list) || '<li class="empty" style="display:block">Nothing here. Nobody has tried anything.</li>';
}
$('secKind').onchange = renderSecurity;
$('clearLog').onclick = async () => { if (!confirm('Clear the whole security log?')) return; await api('clearlog', {}); toast('Log cleared'); load(); };

/* ---------- players ---------- */
const COLS = [['name', 'Player'], ['cash', 'Cash', 1], ['bal', 'Bankroll', 1], ['rounds', 'Rounds', 1], ['bigWin', 'Best win', 1], ['seen', 'Last seen', 1], ['alerts', 'Alerts', 1]];
function renderPlayers() {
  const q = $('q').value.trim().toLowerCase(), f = $('filter').value;
  let list = PL.filter(p => !q || (p.name || '').toLowerCase().includes(q) || p.id.toLowerCase().includes(q) || (p.ip || '').includes(q));
  if (f === 'online') list = list.filter(p => p.online);
  if (f === 'alerts') list = list.filter(p => p.alerts > 0);
  if (f === 'banned') list = list.filter(p => p.banned);
  if (f === 'flagged') list = list.filter(p => p.flagged);
  if (f === 'noname') list = list.filter(p => !p.name);
  list.sort((a, b) => { const x = a[sortKey], y = b[sortKey]; return (typeof x === 'string' ? String(x).localeCompare(String(y)) : (x || 0) - (y || 0)) * sortDir; });
  $('pcount').textContent = `${list.length} of ${PL.length}`;
  $('ptable').innerHTML = `<thead><tr>${COLS.map(([k, l, n]) => `<th class="sort ${n ? 'num' : ''}${k === 'bigWin' || k === 'rounds' ? ' hide-sm' : ''}" data-k="${k}">${l}${sortKey === k ? (sortDir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead><tbody>` +
    (list.length ? list.map(p => `<tr class="click" data-id="${esc(p.id)}">
      <td><div class="who"><div class="av" style="background:${tint(p.name || p.id)}">${esc((p.name || '?').slice(0, 1).toUpperCase())}</div><div style="min-width:0"><div class="nm">${esc(p.name || '(no name yet)')}</div><div class="tags">${tags(p)}</div></div></div></td>
      <td class="num">${usd(p.cash)}</td><td class="num">${usd(p.bal)}</td><td class="num hide-sm">${p.rounds.toLocaleString()}</td><td class="num hide-sm">${usd(p.bigWin)}</td><td class="num dim">${p.online ? '<span class="pos">online</span>' : ago(p.seen)}</td><td class="num ${p.alerts ? 'neg' : 'dim'}">${p.alerts || 0}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No players match.</td></tr>') + '</tbody>';
}
function tags(p) {
  const t = [];
  if (p.banned) t.push('<span class="chip bad">Suspended</span>');
  if (p.hidden) t.push('<span class="chip plain">Hidden from board</span>');
  if (p.flagged) t.push('<span class="chip warn">Reset at upgrade</span>');
  if (p.luck) t.push(`<span class="chip ${p.luck === 'lucky' || p.luck === 'win' ? 'good' : 'bad'}" title="Only you can see this">${({ lucky: '🍀 Lucky', unlucky: '💀 Unlucky', win: '🍀 Forced wins', lose: '💀 Forced losses' })[p.luck]}</span>`);
  if (p.where && p.where.length) t.push(`<span class="chip info">${esc(p.where.join(', '))}</span>`);
  return t.join('');
}
$('q').oninput = renderPlayers; $('filter').onchange = renderPlayers;
$('ptable').addEventListener('click', e => {
  const th = e.target.closest('th[data-k]');
  if (th) { const k = th.dataset.k; if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; } renderPlayers(); return; }
  const tr = e.target.closest('tr[data-id]'); if (tr) openPlayer(tr.dataset.id);
});
document.addEventListener('click', e => { const a = e.target.closest('a[data-id], #wins tr[data-id]'); if (a) { e.preventDefault(); openPlayer(a.dataset.id); } });

/* ---------- one player ---------- */
let current = null;
async function openPlayer(id) {
  try { current = await api('player?id=' + encodeURIComponent(id)); } catch (e) { toast(e.message); return; }
  drawPlayer();
  $('scrim').hidden = false; $('drawer').hidden = false;
}
function closePlayer() { $('scrim').hidden = true; $('drawer').hidden = true; current = null; }
$('scrim').onclick = closePlayer;
document.addEventListener('keydown', e => { if (e.key === 'Escape' && current) closePlayer(); });
function drawPlayer() {
  const p = current, s = p.st;
  const games = p.log.slice().reverse();
  $('drawer').innerHTML = `
    <div class="row" style="justify-content:space-between"><h2><span class="av" style="background:${tint(p.name || p.id)};width:36px;height:36px">${esc((p.name || '?').slice(0, 1).toUpperCase())}</span>${esc(p.name || '(no name yet)')}</h2><button class="btn small" id="dClose">Close</button></div>
    <p class="help" style="margin:6px 0 0">${esc(p.id)} · joined ${when(p.joined)} · last seen ${ago(Math.max(p.seen || 0, p.lastPlay || 0))}${p.ip ? ' · IP ' + esc(p.ip) : ''}</p>
    <div class="tags" style="margin-top:8px">${tags(p)}${p.banned ? `<span class="chip plain">Reason: ${esc(p.banned.reason)}</span>` : ''}</div>
    ${p.flagged ? `<p class="help" style="margin-top:10px;color:var(--warn)">${esc(p.flagged)}. Before the upgrade they reported ${usd(p.imported || 0)}.</p>` : p.imported !== undefined ? `<p class="help" style="margin-top:10px">Carried over ${usd(p.imported)} from before the security upgrade.</p>` : ''}
    <h3>Money</h3>
    <div class="kv"><div><span>Cash (all)</span><b>${usd(p.cash)}</b></div><div><span>Bankroll</span><b>${usd(p.bal)}</b></div><div><span>Peak</span><b>${usd(p.peak)}</b></div>
      <div><span>Total bet</span><b>${usd(s.wagered)}</b></div><div><span>Total paid</span><b>${usd(s.paid)}</b></div><div><span>Resets</span><b>${p.resets}</b></div></div>
    <h3>Play</h3>
    <div class="kv"><div><span>Rounds</span><b>${s.rounds.toLocaleString()}</b></div><div><span>Hands</span><b>${s.hands.toLocaleString()}</b></div><div><span>Spins</span><b>${s.spins.toLocaleString()}</b></div>
      <div><span>Rolls</span><b>${s.rolls.toLocaleString()}</b></div><div><span>Blackjacks</span><b>${s.blackjacks.toLocaleString()}</b></div><div><span>Best win</span><b>${usd(s.bigWin)}</b></div>
      <div><span>Level</span><b>${p.level}</b></div><div><span>XP</span><b>${(p.xp || 0).toLocaleString()}</b></div><div><span>Badges</span><b>${p.badges || 0}</b></div></div>
    <p class="help" style="margin-top:8px"><a href="/profile.html?id=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">Open their public profile →</a></p>
    ${p.craps && p.craps.bets && Object.keys(p.craps.bets).length ? `<p class="help" style="margin-top:8px">${usd(Object.values(p.craps.bets).reduce((a, b) => a + b, 0))} riding on their craps table${p.craps.point ? ` (point ${p.craps.point})` : ''}.</p>` : ''}
    <h3>Luck <small class="dim">secret, only you can see this</small></h3>
    <p class="help">${p.luckText ? `Right now: <b>${esc(p.luckText)}</b>.` : 'Normal luck: every game plays fair for them.'} Works on all solo games (slots, roulette, blackjack, craps, Plinko, Mines, Cluck Crossing). Each game re-rolls results that go against their luck, so it still looks natural.</p>
    <div class="acts">
      <div class="act"><b>Make them</b><div class="row" style="flex-wrap:wrap">
        <select id="lMode" aria-label="Luck" style="max-width:130px"><option value="lucky">🍀 Lucky</option><option value="unlucky">💀 Unlucky</option></select>
        <select id="lPower" aria-label="How much" style="max-width:150px"><option value="1">a bit</option><option value="2" selected>very</option><option value="3">always</option></select>
        <select id="lFor" aria-label="For how long" style="max-width:170px"><option value="0">until I stop it</option><option value="r10">for 10 rounds</option><option value="r50">for 50 rounds</option><option value="h1">for 1 hour</option><option value="h24">for 1 day</option></select>
        <button class="btn small gold" data-op="luck">Set</button></div></div>
      <div class="act"><b>Force the next rounds</b><div class="row"><input type="number" id="fN" min="1" max="100" value="3" style="max-width:80px" aria-label="Rounds"><button class="btn small" data-op="forceWin">🍀 Win</button><button class="btn small" data-op="forceLose">💀 Lose</button></div></div>
    </div>
    <div class="row" style="margin-top:8px"><button class="btn small" data-op="luckoff" ${p.luck ? '' : 'disabled'}>Back to normal luck</button></div>
    <h3>Manage</h3>
    <div class="acts">
      <div class="act"><b>Set bankroll</b><div class="row"><input type="number" id="aSet" min="0" step="0.01" placeholder="$" aria-label="New bankroll in dollars"><button class="btn small gold" data-op="setBalance">Set</button></div></div>
      <div class="act"><b>Give or take chips</b><div class="row"><input type="number" id="aAdj" step="0.01" placeholder="+500 or -200" aria-label="Amount in dollars"><button class="btn small gold" data-op="adjust">Apply</button></div></div>
      <div class="act"><b>Rename</b><div class="row"><input type="text" id="aName" maxlength="18" value="${esc(p.name)}" aria-label="New name"><button class="btn small" data-op="rename">Save</button></div></div>
      <div class="act"><b>${p.muted > Date.now() ? `Muted until ${when(p.muted)}` : 'Mute in chat'}</b><div class="row">${p.muted > Date.now() ? '<button class="btn small" data-op="unmute">Unmute</button>' : '<select id="aMute" aria-label="How long"><option value="15">15 minutes</option><option value="60" selected>1 hour</option><option value="1440">1 day</option><option value="10080">1 week</option></select><button class="btn small" data-op="mute">Mute</button>'}</div></div>
      <div class="act"><b>${p.banned ? 'Suspended' : 'Suspend'}</b><div class="row">${p.banned ? '<button class="btn small" data-op="unban">Lift suspension</button>' : '<input type="text" id="aWhy" maxlength="80" placeholder="Reason" aria-label="Reason"><button class="btn small bad" data-op="ban">Suspend</button>'}</div></div>
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn small" data-op="hide">${p.hidden ? 'Show on leaderboard' : 'Hide from leaderboard'}</button>
      <button class="btn small" data-op="kick" ${p.where && p.where.length ? '' : 'disabled'}>Remove from live tables</button>
      <button class="btn small" data-op="resetStats">Clear stats</button>
      <button class="btn small" data-op="clearFlag" ${p.alerts || p.flagged ? '' : 'disabled'}>Clear alerts</button>
      <button class="btn small bad" data-op="delete">Delete profile</button>
    </div>
    ${p.sameIp && p.sameIp.length ? `<h3>Same network (IP)</h3><p class="help">${p.sameIp.map(x => `<a href="#" data-id="${esc(x.id)}">${esc(x.name)}</a>`).join(', ')}. Classmates at school often share one address, so this alone proves nothing.</p>` : ''}
    <h3>History <small class="dim">latest first</small></h3>
    <table><tbody>${games.map(e => `<tr><td class="dim" style="white-space:nowrap">${ago(e[0])}</td><td>${esc(GAMES[e[1]] || e[1])}<div class="dim" style="font-size:12.5px">${esc(e[4])}</div></td><td class="num ${e[2] > 0 ? 'pos' : e[2] < 0 ? 'neg' : 'dim'}">${e[2] ? usdS(e[2]) : ''}</td><td class="num dim">${usd(e[3])}</td></tr>`).join('') || '<tr><td class="empty">Nothing yet.</td></tr>'}</tbody></table>
    ${p.security && p.security.length ? `<h3>Alerts</h3><ul class="log">${logItems(p.security)}</ul>` : ''}`;
  $('dClose').onclick = closePlayer;
}
$('drawer').addEventListener('click', async e => {
  const b = e.target.closest('[data-op]'); if (!b || !current) return;
  const op = b.dataset.op, body = { id: current.id, op };
  const dollars = id => Math.round(parseFloat($(id).value) * 100);
  if (op === 'setBalance') { body.cents = dollars('aSet'); if (!Number.isFinite(body.cents)) return toast('Type an amount first'); if (!confirm(`Set ${current.name || 'this player'}'s bankroll to ${usd(body.cents)}?`)) return; }
  if (op === 'adjust') { body.cents = dollars('aAdj'); if (!Number.isFinite(body.cents) || !body.cents) return toast('Type an amount first'); }
  if (op === 'rename') body.name = $('aName').value;
  if (op === 'mute') body.minutes = +$('aMute').value;
  if (op === 'luck') { body.mode = $('lMode').value; body.power = +$('lPower').value; const f = $('lFor').value; if (f[0] === 'r') body.rounds = +f.slice(1); if (f[0] === 'h') body.hours = +f.slice(1); }
  if (op === 'forceWin' || op === 'forceLose') { body.result = op === 'forceWin' ? 'win' : 'lose'; body.n = +$('fN').value; body.op = 'force'; }
  if (op === 'ban') { body.reason = $('aWhy').value || 'Cheating'; if (!confirm(`Suspend ${current.name || 'this player'}? They can't play until you lift it.`)) return; }
  if (op === 'delete') { const n = prompt(`Delete ${current.name || 'this player'} for good? Their bankroll and history are gone and they start over as a new player.\n\nType DELETE to confirm.`); if (n !== 'DELETE') return; }
  try {
    await api('player', body);
    toast({ setBalance: 'Bankroll set', adjust: 'Chips moved', rename: 'Renamed', ban: 'Suspended', unban: 'Suspension lifted', hide: 'Leaderboard updated', kick: 'Removed from live tables', resetStats: 'Stats cleared', clearFlag: 'Alerts cleared', delete: 'Profile deleted' }[op] || 'Done');
    if (op === 'delete') { closePlayer(); PL = PL.filter(p => p.id !== body.id); } else await openPlayer(current.id);
    PL = await api('players'); OV = await api('overview'); render();
  } catch (x) { toast(x.message); }
});

/* ---------- controls ---------- */
function renderControls() {
  const st = OV.settings;
  const ev = OV.events || {}, live_ = e => e && e.until > Date.now();
  $('evNow').textContent = [live_(ev.boost) ? `Happy hour ×${ev.boost.mult} on ${ev.boost.game} until ${when(ev.boost.until)}.` : 'No happy hour running.', live_(ev.xp) ? `Double XP until ${when(ev.xp.until)}.` : ''].join(' ');
  $('seasonNow').textContent = `Season ${OV.season.n} started ${when(OV.season.start)} and ends ${when(OV.season.end)}. When it ends, the top 3 go into the hall of fame and everyone restarts with $1,000 (levels and badges stay).`;
  const T = OV.tour || {};
  $('tourNow').innerHTML = `Week ${esc(T.week || '')} ends ${T.end ? when(T.end) : ''}. ${T.board && T.board.length ? 'Leading: ' + T.board.slice(0, 3).map((r, i) => `${['🥇', '🥈', '🥉'][i]} ${esc(r.name)} ${usd(r.bal)}`).join(' · ') : 'Nobody has joined yet.'} Prizes now: ${(T.prizes || []).map(usd).join(' / ')}. Players need 10 rounds to win a prize.`;
  if (T.prizes && !$('tp1').value) { $('tp1').value = T.prizes[0] / 100; $('tp2').value = T.prizes[1] / 100; $('tp3').value = T.prizes[2] / 100; }
  const ROOMS = { bj: 'Blackjack', rl: 'Roulette', pk: 'Hold\u2019em', cr: 'Crash', bc: 'Baccarat', dc: 'Dice City' };
  $('chatList').innerHTML = (OV.chat || []).map(m => `<li><span class="dim">${ago(m.t)} · ${ROOMS[m.room] || m.room}</span> <b>${esc(m.name)}</b>: ${esc(m.text)} <button class="btn small" data-chatdel="${m.id}" style="float:right;height:24px;padding:0 8px">Remove</button></li>`).join('') || '<li class="dim">No messages yet.</li>';
  const RG = OV.rig || {}, RGN = { cr: v => `Crash at ${v}×`, rl: v => `roulette ${v}`, dc: v => `Dice City ${v}`, bc: v => `baccarat ${v}` };
  const rigs = Object.entries(RG).filter(([k, v]) => v !== null && v !== undefined && RGN[k]);
  $('rigNow').innerHTML = rigs.length ? 'Waiting for the next round: ' + rigs.map(([k, v]) => `<b>${esc(RGN[k](v))}</b> <a href="#" data-unrig="${k}">cancel</a>`).join(' · ') : 'Nothing rigged. Every live table is random.';
  const J = OV.jackpot || {};
  $('jpNow').textContent = `The pot is ${usd(Math.round(J.pool || 0))} and restarts at ${usd(J.seed || 0)} after a win.${J.last ? ` Last won by ${J.last.name}: ${usd(J.last.amount)} (${ago(J.last.t)}).` : ''}`;
  $('swClosed').textContent = st.closed ? 'Open the casino' : 'Close the casino'; $('swClosed').className = 'btn ' + (st.closed ? 'gold' : 'bad');
  $('swLocked').textContent = st.locked ? 'Let new players in' : 'Lock them out'; $('swLocked').className = 'btn ' + (st.locked ? 'gold' : '');
  const n = st.notice;
  $('nNow').innerHTML = n && n.text && (!n.until || n.until > Date.now()) ? `Showing now: “${esc(n.text)}”${n.until ? ` until ${when(n.until)}` : ''}` : 'No announcement right now.';
  $('auditlog').innerHTML = OV.audit.map(a => `<li><span class="chip plain">${esc(a.action)}</span><div class="d"><div>${esc(a.detail)}</div></div><span class="t">${ago(a.t)}</span></li>`).join('') || '<li class="empty" style="display:block">Nothing yet.</li>';
}
$('swClosed').onclick = async () => { const c = !OV.settings.closed; if (c && !confirm('Close the casino? Nobody can bet until you open it again.')) return; await api('settings', { closed: c }); toast(c ? 'Casino closed' : 'Casino open'); load(); };
$('swLocked').onclick = async () => { await api('settings', { locked: !OV.settings.locked }); toast(OV.settings.locked ? 'New players welcome' : 'New players locked out'); load(); };
$('nSend').onclick = async () => { const text = $('nText').value.trim(); if (!text) return toast('Write the announcement first'); await api('settings', { notice: { text, kind: $('nKind').value, hours: +$('nHours').value } }); toast('Announcement posted'); $('nText').value = ''; load(); };
$('nClear').onclick = async () => { await api('settings', { notice: null }); toast('Announcement removed'); load(); };
$('gSend').onclick = async () => {
  const c = Math.round(parseFloat($('gAmt').value) * 100);
  if (!(c > 0)) return toast('Type an amount first');
  const who = $('gTo').value === 'all' ? 'every player' : 'every player online now';
  if (!confirm(`Give ${usd(c)} to ${who}?`)) return;
  try { const r = await api('gift', { cents: c, to: $('gTo').value, note: $('gNote').value }); toast(`Sent to ${r.count} player${r.count === 1 ? '' : 's'}`); $('gAmt').value = ''; load(); } catch (x) { toast(x.message); }
};
const post = async (path, body, msg) => { try { await api(path, body); toast(msg); load(); } catch (x) { toast(x.message); } };
document.querySelectorAll('[data-rig]').forEach(b => b.onclick = () => { const g = b.dataset.rig, v = { cr: $('rgCr').value, rl: $('rgRl').value, dc: $('rgDc').value, bc: $('rgBc').value }[g]; if (v === '') return toast('Type a result first'); post('rig', { game: g, value: g === 'bc' ? v : +v }, 'Rigged for the next round'); });
$('rigNow').addEventListener('click', e => { const a = e.target.closest('[data-unrig]'); if (a) { e.preventDefault(); post('rig', { game: a.dataset.unrig, value: null }, 'Rig cancelled'); } });
$('chatClear').onclick = () => { if (confirm('Clear the chat at every live table?')) post('chatclear', { room: 'all' }, 'Chat cleared'); };
$('chatList').addEventListener('click', e => { const b = e.target.closest('[data-chatdel]'); if (b) post('chatdel', { msg: +b.dataset.chatdel }, 'Message removed'); });
$('hhGo').onclick = () => post('event', { boost: { game: $('hhGame').value, mult: +$('hhMult').value, hours: +$('hhHours').value } }, 'Happy hour started');
$('hhStop').onclick = () => post('event', { boost: null }, 'Happy hour stopped');
$('xpGo').onclick = () => post('event', { xp: { hours: +$('xpHours').value } }, 'Double XP started');
$('xpStop').onclick = () => post('event', { xp: null }, 'Double XP stopped');
$('fsGo').onclick = () => { if (confirm(`Give ${$('fsN').value} free spins to ${$('fsTo').value === 'all' ? 'everyone' : 'everyone online'}?`)) post('freespins', { n: +$('fsN').value, bet: +$('fsBet').value, to: $('fsTo').value }, 'Free spins sent'); };
$('seasonEnd').onclick = () => { if (prompt('End the season now? Everyone goes back to $1,000. Type END to confirm.') === 'END') post('season', { action: 'end' }, 'New season started'); };
$('tpSave').onclick = () => post('tournament', { action: 'prizes', prizes: [$('tp1').value, $('tp2').value, $('tp3').value].map(v => Math.round(parseFloat(v || 0) * 100)) }, 'Prizes saved');
$('tourEnd').onclick = () => { if (confirm('End this week\u2019s tournament now and pay the prizes?')) post('tournament', { action: 'end' }, 'Tournament ended'); };
$('jpSave').onclick = () => post('jackpot', { pool: Math.round(parseFloat($('jpPool').value) * 100), seed: Math.round(parseFloat($('jpSeed').value) * 100) }, 'Jackpot saved');
$('export').onclick = async () => {
  const data = await api('export');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  a.download = `miguels-casino-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('refresh').onclick = load;

/* ---------- start ---------- */
let poll = null;
function enter() {
  $('login').hidden = true; $('app').hidden = false;
  load();
  clearInterval(poll); poll = setInterval(() => { if (!document.hidden && !current) load(); }, 15000);
}
api('session').then(r => (r.ok ? enter() : showLogin())).catch(showLogin);
})();
</script>
</body>
</html>
