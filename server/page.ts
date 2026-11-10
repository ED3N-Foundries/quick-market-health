import type { HealthEnv } from "./env"

export function renderPage(env: HealthEnv): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>quick-market health</title>
<style>
:root { color-scheme: dark; --bg:#0b0e12; --panel:#12161d; --line:#232b36; --txt:#e8edf3; --dim:#93a1b3; --ok:#34d17b; --warn:#f5b83d; --bad:#f2564d; --info:#5aa9ff; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--txt); font:14px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; overflow-x:hidden; }
header { padding:18px 20px 10px; display:flex; gap:14px; align-items:center; flex-wrap:wrap; max-width:1100px; margin:0 auto; width:100%; }
h1 { font-size:18px; margin:0; }
.pill { font-weight:700; padding:4px 12px; border-radius:999px; background:#333; text-transform:uppercase; font-size:12px; letter-spacing:.06em; }
.pill.ok { background:rgba(52,209,123,.15); color:var(--ok); border:1px solid var(--ok); }
.pill.degraded { background:rgba(245,184,61,.12); color:var(--warn); border:1px solid var(--warn); }
.pill.down { background:rgba(242,86,77,.12); color:var(--bad); border:1px solid var(--bad); }
.pill.starting { background:rgba(90,169,255,.12); color:var(--info); border:1px solid var(--info); animation:pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.45; } }
.lifecycle { color:var(--dim); font-size:12px; overflow-wrap:anywhere; }
.meta { color:var(--dim); font-size:12px; overflow-wrap:anywhere; }
main { padding:0 20px 40px; display:grid; gap:16px; max-width:1100px; margin:0 auto; width:100%; grid-template-columns:minmax(0,1fr); }
main > * { min-width:0; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; min-width:0; max-width:100%; }
.card h2 { margin:0 0 10px; font-size:13px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); }
table { width:100%; border-collapse:collapse; }
table.wide { min-width:680px; }
th, td { text-align:left; padding:8px 8px; border-top:1px solid var(--line); vertical-align:top; }
th { border-top:0; color:var(--dim); font-weight:600; font-size:12px; }
.dot { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:8px; }
.dot.ok { background:var(--ok); } .dot.bad { background:var(--bad); }
.ms { font-variant-numeric:tabular-nums; white-space:nowrap; }
.err { color:var(--bad); font-size:12px; overflow-wrap:anywhere; }
.dim { color:var(--dim); }
.grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:10px; }
.venue { border:1px solid var(--line); border-radius:8px; padding:10px; }
.venue .v { font-weight:700; }
.venue.stale { opacity:.65; border-style:dashed; }
.bars { display:flex; gap:2px; align-items:flex-end; height:96px; padding-top:6px; border-bottom:1px solid var(--line); overflow:hidden; max-width:100%; }
.bars i { flex:1 1 0; min-width:2px; border-radius:3px 3px 0 0; background:var(--ok); display:block; cursor:pointer; }
.bars i.warn { background:var(--warn); } .bars i.bad { background:var(--bad); } .bars i.info { background:var(--info); }
.legend { display:flex; gap:12px; flex-wrap:wrap; margin:8px 0 2px; font-size:12px; color:var(--dim); }
.big { font-size:13px; color:var(--txt); }
.tip { position:fixed; z-index:10; max-width:min(340px,90vw); background:#0a0d11; border:1px solid var(--line); border-radius:8px; padding:8px 10px; font-size:12px; line-height:1.5; display:none; pointer-events:none; box-shadow:0 4px 16px rgba(0,0,0,.5); }
.tip.show { display:block; }
.tblwrap { overflow-x:auto; max-width:100%; }
.track { background:#0a0d11; border:1px solid var(--line); border-radius:4px; height:10px; min-width:60px; }
.track i { display:block; height:8px; border-radius:3px; background:var(--info); }
#copyjson { background:#0a0d11; color:var(--txt); border:1px solid var(--line); border-radius:6px; padding:2px 10px; font-size:12px; cursor:pointer; margin-left:8px; }
@media (max-width:640px) {
  header { padding:12px 12px 6px; gap:8px; }
  h1 { font-size:16px; }
  main { padding:0 12px 28px; gap:12px; }
  .card { padding:12px; }
  .kv { grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); }
  .grid { grid-template-columns:1fr; }
  table { font-size:13px; }
  th, td { padding:6px; }
  select { font-size:16px; padding:8px 10px; }
  pre { font-size:11px; }
  .tblwrap { -webkit-overflow-scrolling:touch; }
  #copyjson { font-size:14px; padding:6px 12px; }
}
code, pre { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
pre { background:#0a0d11; border:1px solid var(--line); border-radius:8px; padding:10px; overflow:auto; max-width:100%; max-height:320px; font-size:12px; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; }
details summary { cursor:pointer; color:var(--dim); }
#sub { min-width:0; overflow-wrap:anywhere; }
.kv { display:grid; grid-template-columns:repeat(auto-fill,minmax(210px,1fr)); gap:6px 18px; }
.kv div { min-width:0; }
.kv div span { overflow-wrap:anywhere; }
.kv div b { display:block; font-size:11px; color:var(--dim); font-weight:600; text-transform:uppercase; letter-spacing:.06em; }
a { color:#7db8ff; }
select { background:#0a0d11; color:var(--txt); border:1px solid var(--line); border-radius:6px; padding:4px 8px; font-size:12px; }
.toolbar { display:flex; gap:10px; align-items:center; margin-bottom:8px; flex-wrap:wrap; }
</style>
</head>
<body>
<header>
<h1>quick-market health</h1>
<span id="pill" class="pill">…</span>
<span id="sub" class="meta">connecting…</span>
</header>
<main>
<section class="card"><h2>lifecycle</h2><div id="lifecycle" class="lifecycle">waiting for first probe…</div></section>
<section class="card"><h2>boot</h2><div id="boot" class="kv"><span class="dim">waiting for first probe…</span></div></section>
<section class="card"><h2>containers</h2><div class="tblwrap"><table class="wide">
<thead><tr><th>container</th><th>state</th><th>health</th><th>uptime</th><th>restarts</th><th>exit</th><th>cpu</th><th>mem</th></tr></thead>
<tbody id="containers"><tr><td colspan="8" class="dim">waiting for first probe…</td></tr></tbody>
</table></div></section>
<section class="card"><h2>docker logs</h2>
<div class="toolbar">
<select id="logcontainer"></select>
<select id="logtail"><option value="100">last 100</option><option value="200" selected>last 200</option><option value="500">last 500</option><option value="1000">last 1000</option></select>
<span id="logsmeta" class="meta"></span>
<a id="logsraw" class="meta" href="/api/logs" target="_blank" rel="noopener">raw json</a>
</div>
<pre id="logs">waiting for first probe…</pre>
</section>
<section class="card"><h2>pieces · ping · ms</h2><div class="tblwrap"><table>
<thead><tr><th>piece</th><th>ms</th><th>state</th></tr></thead>
<tbody id="checks"><tr><td colspan="3" class="dim">waiting for first probe…</td></tr></tbody>
</table></div></section>
<section class="card"><h2>query speeds</h2><div class="tblwrap"><table class="wide">
<thead><tr><th>piece</th><th>now</th><th>avg</th><th>p95</th><th></th></tr></thead>
<tbody id="speeds"><tr><td colspan="5" class="dim">waiting for first probe…</td></tr></tbody>
</table></div><div class="meta">avg / p95 over recent probes</div></section>
<section class="card"><h2>market state</h2><div id="state" class="kv"></div></section>
<section class="card"><h2>crash reasons · restarts · outage</h2><div id="crash" class="kv"></div><div id="downreason" class="meta" style="margin-top:8px"></div></section>
<section class="card"><h2>price venues</h2><div id="venues" class="grid"></div></section>
<section class="card"><h2>history</h2><div id="histmeta" class="big"></div>
<div class="legend"><span><span class="dot ok"></span>online</span><span><span class="dot" style="background:var(--warn)"></span>degraded</span><span><span class="dot" style="background:var(--info)"></span>starting</span><span><span class="dot bad"></span>offline</span></div>
<div id="bars" class="bars"></div><div id="tip" class="tip"></div></section>
<section class="card"><details><summary>raw report JSON <button id="copyjson" type="button">copy</button></summary><pre id="raw">{}</pre></details></section>
</main>
<script>
const REFRESH = ${env.refreshMs};
const LOG_EVERY = 3;
const pill = document.getElementById('pill');
const sub = document.getElementById('sub');
const lifecycleEl = document.getElementById('lifecycle');
const bootEl = document.getElementById('boot');
const containersEl = document.getElementById('containers');
const checksEl = document.getElementById('checks');
const speedsEl = document.getElementById('speeds');
const stateEl = document.getElementById('state');
const crashEl = document.getElementById('crash');
const downEl = document.getElementById('downreason');
const venuesEl = document.getElementById('venues');
const barsEl = document.getElementById('bars');
const tipEl = document.getElementById('tip');
const histmeta = document.getElementById('histmeta');
const raw = document.getElementById('raw');
const copyBtn = document.getElementById('copyjson');
const logContainerSel = document.getElementById('logcontainer');
const logTailSel = document.getElementById('logtail');
const logsEl = document.getElementById('logs');
const logsMeta = document.getElementById('logsmeta');
const logsRaw = document.getElementById('logsraw');
let tickN = 0;
function pillClass(lc){ return lc==='online' ? 'ok' : lc==='degraded' ? 'degraded' : lc==='starting' ? 'starting' : lc==='offline' ? 'down' : ''; }
function fmtMs(ms){ if(ms==null||!isFinite(ms)) return '—'; if(ms<10) return ms.toFixed(1)+' ms'; return Math.round(ms)+' ms'; }
function fmtAge(ms){ if(ms==null||!isFinite(ms)) return '—'; if(ms<1000) return Math.round(ms)+' ms'; if(ms<60000) return (ms/1000).toFixed(1)+'s'; return (ms/60000).toFixed(1)+'m'; }
function fmtDT(ms){ if(ms==null||!isFinite(ms)) return '—'; const d = new Date(ms); return d.toLocaleDateString() + ' ' + d.toLocaleTimeString(); }
function fmtPct(v){ if(v==null||!isFinite(v)) return '—'; return v.toFixed(1)+'%'; }
function fmtBytes(v){ if(v==null||!isFinite(v)) return '—'; if(v<1024) return Math.round(v)+' B'; if(v<1048576) return (v/1024).toFixed(1)+' KB'; if(v<1073741824) return (v/1048576).toFixed(1)+' MB'; return (v/1073741824).toFixed(2)+' GB'; }
function fmtMem(used, limit){ if(used==null) return '—'; return fmtBytes(used) + (limit!=null&&isFinite(limit) ? ' / ' + fmtBytes(limit) : ''); }
function esc(s){ return String(s??'').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
async function tick(){
  try {
    const [r, h] = await Promise.all([
      fetch('/api/check?fresh=1').then(r => r.json()),
      fetch('/api/history').then(r => r.json()).catch(() => null),
    ]);
    pill.textContent = r.lifecycle || r.status;
    pill.className = 'pill ' + pillClass(r.lifecycle || r.status);
    const when = new Date(r.at).toLocaleTimeString();
    sub.textContent = r.target + ' · checked ' + when + ' · probe ' + fmtMs(r.totalMs) + ' · probes: ' + r.status + ' · refresh ' + Math.round(REFRESH/1000) + 's';
    lifecycleEl.textContent = (r.lifecycle || r.status) + (r.lifecycleReason ? ' — ' + r.lifecycleReason : '');
    const cons = r.containers || [];
    if (!cons.length) {
      containersEl.innerHTML = '<tr><td colspan="8" class="dim">docker not configured (DOCKER_SOCK empty) — container state unknown</td></tr>';
    } else {
      containersEl.innerHTML = cons.map(c => {
        const state = c.exists ? (c.restarting ? 'restarting' : c.status + (c.running ? '' : ' (stopped)')) : 'missing';
        const dot = !c.exists || (!c.running && !c.restarting) ? 'bad' : (c.health === 'unhealthy' ? 'bad' : 'ok');
        const exit = c.exitCode ?? '—';
        const restarts = (c.restartCount ?? '—');
        return '<tr><td><span class="dot ' + dot + '"></span>' + esc(c.name) + '</td>' +
          '<td>' + esc(state) + (c.oomKilled ? ' · OOM' : '') + (c.error ? '<div class="err">' + esc(c.error) + '</div>' : '') + '</td>' +
          '<td>' + esc(c.health) + (c.healthFailingStreak ? ' · streak ' + c.healthFailingStreak : '') + '</td>' +
          '<td class="ms">' + (c.uptimeMs != null ? fmtAge(c.uptimeMs) : '—') + '</td>' +
          '<td>' + esc(String(restarts)) + '</td>' +
          '<td>' + esc(String(exit)) + '</td>' +
          '<td class="ms">' + fmtPct(c.cpuPct) + (c.pids != null ? '<div class="dim">' + c.pids + ' pids</div>' : '') + '</td>' +
          '<td class="ms">' + fmtMem(c.memUsed, c.memLimit) + (c.memPct != null ? '<div class="dim">' + c.memPct.toFixed(1) + '%</div>' : '') + '</td></tr>';
      }).join('');
    }
    if (logContainerSel.options.length !== cons.length) {
      logContainerSel.innerHTML = cons.map(c => '<option value="' + esc(c.name) + '">' + esc(c.name) + '</option>').join('') || '<option value="">—</option>';
    }
    checksEl.innerHTML = r.checks.map(c =>
      '<tr><td><span class="dot ' + (c.ok?'ok':'bad') + '"></span>' + esc(c.label) + '</td>' +
      '<td class="ms">' + fmtMs(c.ms) + '</td>' +
      '<td>' + esc(c.detail) + (c.error ? '<div class="err">' + esc(c.error) + '</div>' : '') + '</td></tr>'
    ).join('');
    const s = r.summary || {};
    const kv = (k,v) => '<div><b>'+k+'</b><span>'+esc(v)+'</span></div>';
    renderSpeeds(r, h);
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
      kv('event loop lag', fmtMs(p.eventLoopLagMs)) +
      kv('counters u/r/t', ((p.counters&&p.counters.uncaught)??'—') + '/' + ((p.counters&&p.counters.unhandled)??'—') + '/' + ((p.counters&&p.counters.requestErrors)??'—') + '/' + ((p.counters&&p.counters.tickErrors)??'—') + ' (uncaught/unhandled/req/tick)');
    bootEl.innerHTML =
      kv('market booted', fmtDT(p.bootAt)) +
      kv('market uptime', fmtAge(p.uptimeMs)) +
      kv('boot count', '#' + (p.bootCount ?? '—')) +
      cons.map(c => kv(esc(c.name) + ' started', c.startedAt ? fmtDT(c.startedAt) + ' · up ' + fmtAge(c.uptimeMs) : '—')).join('');
    downEl.textContent = r.downReason ? ('why: ' + r.downReason) : (r.status==='ok' ? 'market reports no failure reason' : '');
    if (h && h.samples) {
      const n = h.samples.length;
      const ok = h.samples.filter(x => x.status==='ok').length;
      histmeta.textContent = n ? ('last ' + n + ' probes · ' + (100*ok/n).toFixed(1) + '% ok · avg probe ' +
        fmtMs(h.samples.reduce((a,x)=>a+x.totalMs,0)/n)) : 'no history yet';
      barSamples = h.samples.slice(-120);
      barsEl.innerHTML = barSamples.map((x, i) =>
        '<i data-i="' + i + '" class="' + barClass(x) + '" style="height:' +
        Math.max(8, Math.min(100, x.totalMs/20)) + 'px"></i>'
      ).join('');
    }
    raw.textContent = JSON.stringify(r, null, 2);
    tickN++;
    if (tickN % LOG_EVERY === 1 && !document.hidden) { tickLogs(); }
  } catch (e) {
    sub.textContent = 'health service unreachable: ' + e;
  }
}
async function tickLogs(){
  try {
    const container = logContainerSel.value;
    const tail = logTailSel.value || '200';
    if (!container) { logsEl.textContent = 'docker not configured — no containers to show logs for.'; return; }
    const url = '/api/logs?container=' + encodeURIComponent(container) + '&tail=' + encodeURIComponent(tail);
    logsRaw.href = url;
    const l = await fetch(url).then(r => r.json());
    if (l.error) {
      logsMeta.textContent = 'error';
      logsEl.textContent = l.error;
      return;
    }
    logsMeta.textContent = l.lines.length + ' lines · ' + new Date(l.at).toLocaleTimeString() + (l.truncated ? ' · truncated' : '');
    logsEl.textContent = l.lines.join('\\n') || '(no log output)';
    logsEl.scrollTop = logsEl.scrollHeight;
  } catch (e) {
    logsMeta.textContent = 'unreachable: ' + e;
  }
}
logContainerSel.addEventListener('change', tickLogs);
logTailSel.addEventListener('change', tickLogs);
document.addEventListener('visibilitychange', () => { if (!document.hidden) tickLogs(); });
let barSamples = [];
function barClass(x){
  const lc = x.lifecycle || x.status;
  if (lc === 'online' || lc === 'ok') return '';
  if (lc === 'degraded') return 'warn';
  if (lc === 'starting') return 'info';
  return 'bad';
}
function tipHtml(x){
  const fails = (x.checks || []).filter(c => !c.ok).map(c => c.id + (c.ms != null ? ' ' + Math.round(c.ms) + 'ms' : '')).join(', ');
  return '<b>' + new Date(x.at).toLocaleDateString() + ' ' + new Date(x.at).toLocaleTimeString() + ' · ' + esc(x.lifecycle || x.status) + '</b><br>' +
    'probe ' + fmtMs(x.totalMs) +
    (fails ? '<br>fail: ' + esc(fails) : '<br>all pieces ok') +
    (x.downReason ? '<br>' + esc(String(x.downReason).slice(0, 200)) : '') +
    (x.bootId ? '<br>boot ' + esc(String(x.bootId).slice(0, 8)) : '');
}
function showTip(bar, cx, cy){
  const x = barSamples[Number(bar.dataset.i)];
  if (!x) return;
  tipEl.innerHTML = tipHtml(x);
  tipEl.classList.add('show');
  const w = Math.min(340, window.innerWidth * 0.9);
  tipEl.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, cx + 12)) + 'px';
  tipEl.style.top = Math.max(8, cy + 12) + 'px';
}
function hideTip(){ tipEl.classList.remove('show'); }
barsEl.addEventListener('mouseover', (e) => {
  const bar = e.target.closest ? e.target.closest('i[data-i]') : null;
  if (bar) showTip(bar, e.clientX, e.clientY);
});
barsEl.addEventListener('mousemove', (e) => {
  if (!tipEl.classList.contains('show')) return;
  const bar = e.target.closest ? e.target.closest('i[data-i]') : null;
  if (bar) showTip(bar, e.clientX, e.clientY);
});
barsEl.addEventListener('mouseleave', hideTip);
barsEl.addEventListener('click', (e) => {
  const bar = e.target.closest ? e.target.closest('i[data-i]') : null;
  if (bar) showTip(bar, e.clientX, e.clientY);
  else hideTip();
});
function renderSpeeds(r, h){
  const samples = (h && h.samples) || [];
  const rows = (r.checks || []).map(c => {
    const vals = samples
      .map(s => { const f = (s.checks || []).find(x => x.id === c.id); return f && typeof f.ms === 'number' ? f.ms : null; })
      .filter(v => v != null)
      .sort((a, b) => a - b);
    const avg = (h && h.avgMs && typeof h.avgMs[c.id] === 'number')
      ? h.avgMs[c.id]
      : (vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null);
    const p95 = vals.length ? vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.95))] : null;
    return { label: c.label, now: c.ms, avg, p95 };
  });
  if (!rows.length) { speedsEl.innerHTML = '<tr><td colspan="5" class="dim">no probe data yet</td></tr>'; return; }
  const max = Math.max(1, ...rows.map(x => x.p95 ?? x.avg ?? x.now ?? 0));
  speedsEl.innerHTML = rows.map(x => {
    const v = x.p95 ?? x.avg ?? x.now ?? 0;
    return '<tr><td>' + esc(x.label) + '</td>' +
      '<td class="ms">' + fmtMs(x.now) + '</td>' +
      '<td class="ms">' + fmtMs(x.avg) + '</td>' +
      '<td class="ms">' + fmtMs(x.p95) + '</td>' +
      '<td><div class="track"><i style="width:' + Math.max(2, Math.round(100 * v / max)) + '%"></i></div></td></tr>';
  }).join('');
}
copyBtn.addEventListener('click', async (e) => {
  e.preventDefault();
  e.stopPropagation();
  const text = raw.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
  copyBtn.textContent = 'copied ✓';
  setTimeout(() => { copyBtn.textContent = 'copy'; }, 2000);
});
tick();
setInterval(tick, REFRESH);
</script>
</body>
</html>`
}
