import type { HealthEnv } from "./env"

export function renderPage(env: HealthEnv): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>quick-market health</title>
<style>
:root { color-scheme: dark; --bg:#0b0e12; --panel:#12161d; --line:#232b36; --txt:#e8edf3; --dim:#93a1b3; --ok:#34d17b; --warn:#f5b83d; --bad:#f2564d; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--txt); font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
header { padding:18px 20px 10px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; }
h1 { font-size:18px; margin:0; }
.pill { font-weight:700; padding:4px 12px; border-radius:999px; background:#333; text-transform:uppercase; font-size:12px; letter-spacing:.06em; }
.pill.ok { background:rgba(52,209,123,.15); color:var(--ok); border:1px solid var(--ok); }
.pill.degraded { background:rgba(245,184,61,.12); color:var(--warn); border:1px solid var(--warn); }
.pill.down { background:rgba(242,86,77,.12); color:var(--bad); border:1px solid var(--bad); }
.meta { color:var(--dim); font-size:12px; }
main { padding:0 20px 40px; display:grid; gap:16px; max-width:1100px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
.card h2 { margin:0 0 10px; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); }
table { width:100%; border-collapse:collapse; }
th, td { text-align:left; padding:8px 8px; border-top:1px solid var(--line); vertical-align:top; }
th { border-top:0; color:var(--dim); font-weight:600; font-size:12px; }
.dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; }
.dot.ok { background:var(--ok); } .dot.bad { background:var(--bad); }
.ms { font-variant-numeric:tabular-nums; white-space:nowrap; }
.err { color:var(--bad); font-size:12px; }
.dim { color:var(--dim); }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
.venue { border:1px solid var(--line); border-radius:8px; padding:10px; }
.venue .v { font-weight:700; }
.venue.stale { opacity:.65; border-style:dashed; }
.bars { display:flex; gap:2px; align-items:flex-end; height:44px; }
.bars i { flex:1; min-width:3px; border-radius:2px; background:var(--ok); display:block; }
.bars i.warn { background:var(--warn); } .bars i.bad { background:var(--bad); }
code, pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
pre { background:#0a0d11; border:1px solid var(--line); border-radius:8px; padding:10px; overflow:auto; max-height:320px; font-size:12px; }
details summary { cursor:pointer; color:var(--dim); }
.kv { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:6px 18px; }
.kv div b { display:block; font-size:11px; color:var(--dim); font-weight:600; text-transform:uppercase; letter-spacing:.06em; }
a { color:#7db8ff; }
</style>
</head>
<body>
<header>
<h1>quick-market health</h1>
<span id="pill" class="pill">…</span>
<span id="sub" class="meta">connecting…</span>
</header>
<main>
<section class="card"><h2>pieces · ping · ms</h2><table>
<thead><tr><th>piece</th><th>ms</th><th>state</th></tr></thead>
<tbody id="checks"><tr><td colspan="3" class="dim">waiting for first probe…</td></tr></tbody>
</table></section>
<section class="card"><h2>market state</h2><div id="state" class="kv"></div></section>
<section class="card"><h2>crash reasons · restarts · outage</h2><div id="crash" class="kv"></div><div id="downreason" class="meta" style="margin-top:8px"></div></section>
<section class="card"><h2>price venues</h2><div id="venues" class="grid"></div></section>
<section class="card"><h2>history</h2><div id="histmeta" class="meta"></div><div id="bars" class="bars"></div></section>
<section class="card"><details><summary>raw report JSON</summary><pre id="raw">{}</pre></details></section>
</main>
<script>
const REFRESH = ${env.refreshMs};
const pill = document.getElementById('pill');
const sub = document.getElementById('sub');
const checksEl = document.getElementById('checks');
const stateEl = document.getElementById('state');
const crashEl = document.getElementById('crash');
const downEl = document.getElementById('downreason');
const venuesEl = document.getElementById('venues');
const barsEl = document.getElementById('bars');
const histmeta = document.getElementById('histmeta');
const raw = document.getElementById('raw');
function fmtMs(ms){ if(ms==null||!isFinite(ms)) return '—'; if(ms<10) return ms.toFixed(1)+' ms'; return Math.round(ms)+' ms'; }
function fmtAge(ms){ if(ms==null||!isFinite(ms)) return '—'; if(ms<1000) return Math.round(ms)+' ms'; if(ms<60000) return (ms/1000).toFixed(1)+'s'; return (ms/60000).toFixed(1)+'m'; }
function esc(s){ return String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
async function tick(){
  try {
    const [r, h] = await Promise.all([
      fetch('/api/check?fresh=1').then(r => r.json()),
      fetch('/api/history').then(r => r.json()).catch(() => null),
    ]);
    pill.textContent = r.status;
    pill.className = 'pill ' + r.status;
    const when = new Date(r.at).toLocaleTimeString();
    sub.textContent = r.target + ' · checked ' + when + ' · probe ' + fmtMs(r.totalMs);
    checksEl.innerHTML = r.checks.map(c =>
      '<tr><td><span class="dot ' + (c.ok?'ok':'bad') + '"></span>' + esc(c.label) + '</td>' +
      '<td class="ms">' + fmtMs(c.ms) + '</td>' +
      '<td>' + esc(c.detail) + (c.error ? '<div class="err">' + esc(c.error) + '</div>' : '') + '</td></tr>'
    ).join('');
    const s = r.summary || {};
    const kv = (k,v) => '<div><b>'+k+'</b><span>'+esc(v)+'</span></div>';
    stateEl.innerHTML =
      kv('chain', (s.chainKey??'—') + ' / ' + (s.chainName??'')) +
      kv('feed', s.feed ?? '—') +
      kv('ticker', (s.tickerPrice??'—') + ' via ' + (s.tickerVenue??'—')) +
      kv('clock skew', fmtMs(s.clockSkewMs)) +
      kv('tape', (s.tapePoints??'—') + ' pts · age ' + fmtAge(s.tapeAgeMs)) +
      kv('join window', (s.joinId??'—') + ' · closes in ' + fmtAge(s.windowCloseInMs)) +
      kv('live market', s.liveId ?? '—') +
      kv('pool up/down', (s.poolUpMicros??'—') + ' / ' + (s.poolDownMicros??'—')) +
      kv('handoff', s.handoff ?? 'none') +
      kv('ws open/first/rtt', fmtMs(s.wsConnectMs) + ' / ' + fmtMs(s.wsFirstMsgMs) + ' / ' + fmtMs(s.wsRttMs));
    venuesEl.innerHTML = (r.venues||[]).map(v =>
      '<div class="venue' + (v.stale?' stale':'') + '"><div class="v">' + esc(v.venue) + ' ' + (v.stale?'· stale':'· fresh') + '</div>' +
      '<div>' + esc(v.price ?? 'no price') + '</div>' +
      '<div class="dim">age ' + fmtAge(v.ageMs) + ' · ' + esc(v.role ?? '') + '</div>' +
      '<div class="dim">' + esc(v.reason ?? '') + '</div>' +
      '<div class="dim">swing ' + esc(v.swing ?? '—') + ' · gap ' + esc(v.gap ?? '—') + '</div>' +
      '<div class="dim">' + esc(v.feed ?? 'no socket') + '</div></div>'
    ).join('') || '<span class="dim">no venue data</span>';
    const p = r.process || {};
    const prev = r.previous || {};
    const t = r.tracking || {};
    const memMb = (v) => (v==null||!isFinite(v)) ? '—' : (v/1048576).toFixed(1)+' MB';
    crashEl.innerHTML =
      kv('market status', (p.status ?? r.status ?? '—') + (p.reason ? ' · ' + p.reason : '')) +
      kv('boot', (p.bootId ? String(p.bootId).slice(0,8) : '—') + ' · #' + (p.bootCount ?? '—') + ' · up ' + fmtAge(p.uptimeMs)) +
      kv('last error', (p.lastError && p.lastError.message) ? ((p.lastError.kind ?? '') + ': ' + p.lastError.message) : 'none') +
      kv('last signal', p.lastSignal ?? 'none') +
      kv('prev run', prev.bootId ? ((prev.clean ? 'clean' : 'UNCLEAN') + ' · ' + (prev.reason ?? '')) : 'first boot / unknown') +
      kv('restarts seen', (t.restartCount ?? 0) + (t.lastRestartAt ? ' · last ' + new Date(t.lastRestartAt).toLocaleTimeString() : '')) +
      kv('restart reason', t.lastRestartReason ?? (prev.reason ?? '—')) +
      kv('outage', (t.consecutiveDown ? (t.consecutiveDown + ' failing probes since ' + (t.downSince ? new Date(t.downSince).toLocaleTimeString() : '?')) : 'none') + (t.lastOkAt ? ' · last ok ' + new Date(t.lastOkAt).toLocaleTimeString() : '')) +
      kv('memory rss/heap', memMb(p.memory && p.memory.rss) + ' / ' + memMb(p.memory && p.memory.heapUsed)) +
      kv('counters u/r/t', ((p.counters&&p.counters.uncaught)??'—') + '/' + ((p.counters&&p.counters.unhandled)??'—') + '/' + ((p.counters&&p.counters.requestErrors)??'—') + '/' + ((p.counters&&p.counters.tickErrors)??'—') + ' (uncaught/unhandled/req/tick)');
    downEl.textContent = r.downReason ? ('why: ' + r.downReason) : (r.status==='ok' ? 'market reports no failure reason' : '');
    if (h && h.samples) {
      const n = h.samples.length;
      const ok = h.samples.filter(x => x.status==='ok').length;
      histmeta.textContent = n ? ('last ' + n + ' probes · ' + (100*ok/n).toFixed(1) + '% ok · avg probe ' +
        fmtMs(h.samples.reduce((a,x)=>a+x.totalMs,0)/n)) : 'no history yet';
      barsEl.innerHTML = h.samples.slice(-120).map(x =>
        '<i class="' + (x.status==='ok'?'':x.status==='degraded'?'warn':'bad') + '" style="height:' +
        Math.max(8, Math.min(100, x.totalMs/20)) + 'px" title="' + new Date(x.at).toLocaleTimeString() + ' ' + x.status + ' ' + Math.round(x.totalMs) + 'ms"></i>'
      ).join('');
    }
    raw.textContent = JSON.stringify(r, null, 2);
  } catch (e) {
    sub.textContent = 'health service unreachable: ' + e;
  }
}
tick();
setInterval(tick, REFRESH);
</script>
</body>
</html>`
}
