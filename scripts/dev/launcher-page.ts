/**
 * The Dev Launcher page: ONE self-contained HTML document (inline CSS + JS, no external assets,
 * no framework), light/dark from the OS setting.
 *
 * WHY SELF-CONTAINED: the launcher must work before anything else is built, offline, and under a
 * strict CSP (nonce-only scripts/styles, no inline style attributes). Data from the server is
 * written with textContent only — never innerHTML.
 */
import type { DEV_URLS } from './topology';

/** The launcher's own routes (not Nexus API routes), shared by the server and the page script. */
export const LAUNCHER_ROUTES = {
  page: '/',
  status: '/status',
  logs: '/logs',
  ping: '/ping',
  signIn: '/signin',
  signOut: '/signout',
  seed: '/actions/seed',
  traffic: '/actions/traffic',
  demoKeys: '/actions/demo-keys',
  shutdown: '/actions/shutdown',
} as const;

/** Custom header every JSON action needs (CSRF guard, see launcher-server.ts). */
export const LAUNCHER_ACTION_HEADER = 'X-Dev-Launcher';

export const LAUNCHER_TITLE = 'Data Nexus Traffic — Dev Launcher';

/** Status poll interval of the page. */
export const STATUS_POLL_MS = 3000;

export interface LauncherPageInput {
  nonce: string;
  /** True when the dashboard redirected a signed-out user here. */
  signInRequired: boolean;
  /** Already validated with safeReturnUrl. */
  returnUrl: string | null;
  defaultEmail: string;
  viewerEmail: string;
  adminEmails: string[];
  urls: typeof DEV_URLS;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** JSON safe to embed in a <script type="application/json"> block. */
function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

const STYLES = `
:root{--bg:#f6f7f9;--panel:#fff;--text:#1d2330;--muted:#5e6778;--border:#e2e5eb;--accent:#3b5bdb;--accent-text:#fff;
--ok:#2f9e44;--bad:#e03131;--warn:#f08c00;--idle:#adb5bd;--code:#f1f3f5;--banner:#fff4e6;--banner-border:#ffc078}
@media (prefers-color-scheme:dark){:root{--bg:#101318;--panel:#171b22;--text:#e6e9ef;--muted:#98a2b3;--border:#2a303b;
--accent:#748ffc;--accent-text:#0b0e13;--ok:#51cf66;--bad:#ff6b6b;--warn:#ffa94d;--idle:#495057;--code:#0d1015;
--banner:#2b2112;--banner-border:#8a5a1c}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1120px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px;flex-wrap:wrap}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 12px}
p{margin:0}
.muted{color:var(--muted)}
.banner{background:var(--banner);border:1px solid var(--banner-border);border-radius:10px;padding:12px 16px;margin-bottom:20px}
.banner strong{display:block;font-size:15px}
.grid{display:grid;gap:16px}
.cards{grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-bottom:16px}
.two{grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-bottom:16px}
.panel{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px}
.card-head{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.card-head h3{font-size:15px;margin:0;flex:1}
.port{font:12px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--muted)}
.dot{width:10px;height:10px;border-radius:50%;background:var(--idle);flex:none}
.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}.dot.warn{background:var(--warn)}
.detail{font-size:13px;color:var(--muted)}
.detail div{display:flex;justify-content:space-between;gap:8px}
.steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:6px 16px}
.steps li{display:flex;align-items:center;gap:8px;font-size:13px}
.links{list-style:none;margin:0;padding:0}
.links li{padding:6px 0;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;gap:12px}
.links li:last-child{border-bottom:0}
a{color:var(--accent)}
label{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}
input{font:inherit;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:7px 10px;width:100%}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
button{font:inherit;cursor:pointer;border-radius:8px;padding:7px 14px;border:1px solid var(--border);background:var(--panel);color:var(--text)}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
button.danger{border-color:var(--bad);color:var(--bad)}
button:disabled{opacity:.55;cursor:progress}
.inline{display:flex;gap:8px;align-items:flex-end}
.inline .grow{flex:1}
.result{margin-top:10px;font-size:13px;min-height:20px}
.result.bad{color:var(--bad)}
.keys{margin-top:10px;display:grid;gap:6px}
.key{display:flex;align-items:center;gap:8px;font-size:13px}
.key code{flex:1;background:var(--code);padding:4px 8px;border-radius:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
code,pre{font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
.tabs button{padding:4px 10px;font-size:13px}
.tabs button[aria-selected="true"]{background:var(--accent);border-color:var(--accent);color:var(--accent-text)}
pre{margin:0;background:var(--code);border-radius:8px;padding:10px;height:320px;overflow:auto;white-space:pre-wrap;word-break:break-all}
.whoami{font-size:13px;margin-bottom:10px}
.hidden{display:none}
`;

/** Page behaviour: polling, rendering with textContent, actions. Reads its config from #boot. */
const SCRIPT = `
(function(){
'use strict';
var boot=JSON.parse(document.getElementById('boot').textContent);
var R=boot.routes,H={};H[boot.actionHeader]='1';
function $(id){return document.getElementById(id)}
function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function dot(state){var d=el('span','dot'+(state?' '+state:''));return d}
function probeText(p){return p.ok?(p.status+' OK'):(p.status?String(p.status):(p.error||'no answer'))}
function procText(p){if(!p)return'-';var t=p.state;if(p.pid)t+=' (pid '+p.pid+')';if(p.exitCode!=null&&p.state==='exited')t+=' code '+p.exitCode;return t}
function detail(rows){var d=el('div','detail');rows.forEach(function(r){var row=el('div');row.appendChild(el('span',null,r[0]));row.appendChild(el('span',null,r[1]));d.appendChild(row)});return d}
function card(title,port,state,rows,note){var c=el('div','panel');var h=el('div','card-head');h.appendChild(dot(state));h.appendChild(el('h3',null,title));h.appendChild(el('span','port',':'+port));c.appendChild(h);c.appendChild(detail(rows));if(note){var n=el('p','detail',note);c.appendChild(n)}return c}
function renderCards(s){
 var box=$('cards');box.textContent='';
 var dbState=s.db.state==='running'&&s.db.accepting?'ok':(s.db.state==='missing'?'':'bad');
 box.appendChild(card('Dev database',s.db.port,dbState,[['container',s.db.container],['state',s.db.state],['accepting TCP',s.db.accepting?'yes':'no']]));
 var apiState=s.api.health.ok&&s.api.ready.ok?'ok':(s.api.health.ok?'warn':(s.api.process.state==='not-started'?'':'bad'));
 box.appendChild(card('API',s.api.port,apiState,[['/api/health',probeText(s.api.health)],['/api/health/ready',probeText(s.api.ready)],['process',procText(s.api.process)]]));
 var webUp=s.web.health.ok;var webNote=webUp?null:(s.web.process.note||(s.web.process.state==='running'?'starting (first compile can take a minute)':'dashboard not available yet'));
 box.appendChild(card('Dashboard',s.web.port,webUp?'ok':(s.web.process.state==='running'?'warn':'bad'),[['/traffic/healthz',probeText(s.web.health)],['process',procText(s.web.process)]],webNote));
}
var STEP_DOT={ok:'ok',failed:'bad',warn:'warn',running:'warn',skipped:'',pending:''};
function renderSteps(steps){var ul=$('steps');ul.textContent='';steps.forEach(function(st){var li=el('li');li.appendChild(dot(STEP_DOT[st.state]));li.appendChild(el('span',null,st.label+' — '+st.state+(st.note?' ('+st.note+')':'')));ul.appendChild(li)})}
function renderViewer(v){var w=$('whoami');if(!v){w.textContent='Not signed in.';$('signout').classList.add('hidden');return}
 w.textContent='Signed in as '+v.email+' — '+(v.allowed?(v.isAdmin?'admin':'viewer'):'not allowed by the access policy');$('signout').classList.remove('hidden')}
function renderDemo(d){var k=$('keys');k.textContent='';if(!d.secretKeyPrefix&&!d.publishableKeyPrefix){k.appendChild(el('p','muted','No demo keys yet.'));return}
 [['secret',d.secretKeyPrefix],['publishable',d.publishableKeyPrefix]].forEach(function(p){if(!p[1])return;var row=el('div','key');row.appendChild(el('span',null,p[0]));row.appendChild(el('code',null,p[1]+'…'));var b=el('button',null,'Copy');b.type='button';b.addEventListener('click',function(){copyKey(p[0],b)});row.appendChild(b);k.appendChild(row)})}
function copyKey(kind,btn){fetch(R.demoKeys,{headers:H}).then(function(r){return r.json()}).then(function(j){var v=j[kind];if(!v)throw new Error('no key');return navigator.clipboard.writeText(v)}).then(function(){btn.textContent='Copied';setTimeout(function(){btn.textContent='Copy'},1500)}).catch(function(){btn.textContent='Copy failed'})}
function poll(){fetch(R.status).then(function(r){return r.json()}).then(function(s){renderCards(s);renderSteps(s.steps);renderViewer(s.viewer);renderDemo(s.demo);$('updated').textContent='updated '+new Date().toLocaleTimeString()}).catch(function(){$('updated').textContent='launcher not reachable — is npm run dev still running?'})}
function action(path,body,btn,out){btn.disabled=true;out.className='result muted';out.textContent='working…';
 var opts={method:'POST',headers:Object.assign({'Content-Type':'application/json'},H),body:JSON.stringify(body||{})};
 return fetch(path,opts).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||('HTTP '+r.status));return j})})
 .then(function(j){out.className='result';return j}).catch(function(e){out.className='result bad';out.textContent=e.message;return null}).finally(function(){btn.disabled=false})}
$('seed').addEventListener('click',function(){var out=$('seed-result');action(R.seed,{},this,out).then(function(j){if(!j)return;
 out.textContent='App '+j.appSlug+(j.appCreated?' created':' already existed')+'; keys: '+j.keys.map(function(k){return k.kind+' '+(k.created?'created':'reused')}).join(', ')+'. Stored in .env.dev.';poll()})});
$('traffic').addEventListener('click',function(){var out=$('traffic-result');action(R.traffic,{count:$('count').value},this,out).then(function(j){if(!j)return;
 out.textContent='Sent '+j.sent+' events in '+j.batches+' batch(es): '+j.accepted+' accepted, '+j.duplicates+' duplicates, '+j.rejected+' rejected'+(j.rejectionCodes.length?' ('+j.rejectionCodes.join(', ')+')':'')+'.'})});
$('stop').addEventListener('click',function(){if(!confirm('Stop the API, dashboard and launcher? (The dev DB keeps running.)'))return;var out=$('updated');action(R.shutdown,{},this,out).then(function(){out.textContent='stopping… you can close this tab.'})});
var current='api';
function selectTab(name){current=name;Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(b){b.setAttribute('aria-selected',String(b.dataset.proc===name))});loadLogs(true)}
function loadLogs(jump){var pre=$('log');var atBottom=pre.scrollTop+pre.clientHeight>=pre.scrollHeight-8;fetch(R.logs+'?proc='+encodeURIComponent(current)).then(function(r){return r.json()}).then(function(j){pre.textContent=j.lines.length?j.lines.join('\\n'):'(no output yet)';if(jump||atBottom)pre.scrollTop=pre.scrollHeight}).catch(function(){})}
Array.prototype.forEach.call(document.querySelectorAll('.tabs button'),function(b){b.addEventListener('click',function(){selectTab(b.dataset.proc)})});
selectTab('api');poll();setInterval(poll,boot.pollMs);setInterval(function(){loadLogs(false)},boot.pollMs);
})();
`;

const LOG_TABS = ['api', 'web', 'migrate', 'db', 'build', 'launcher', 'dev'] as const;

function linkRow(label: string, href: string, note: string): string {
  return `<li><span><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${escapeHtml(label)}</a></span><span class="muted">${escapeHtml(note)}</span></li>`;
}

/** The whole page. Every interpolated value is escaped or JSON-embedded. */
export function renderLauncherPage(input: LauncherPageInput): string {
  const { nonce, urls } = input;
  const boot = {
    routes: LAUNCHER_ROUTES,
    actionHeader: LAUNCHER_ACTION_HEADER,
    pollMs: STATUS_POLL_MS,
  };
  const banner = input.signInRequired
    ? `<div class="banner" role="status"><strong>Sign in to continue</strong><span class="muted">The dashboard needs a signed-in user. Pick one below and you will be sent back${
        input.returnUrl ? ` to <code>${escapeHtml(input.returnUrl)}</code>` : ''
      }.</span></div>`
    : '';
  const returnField = input.returnUrl ? `<input type="hidden" name="return" value="${escapeHtml(input.returnUrl)}">` : '';
  const tabs = LOG_TABS.map((p) => `<button type="button" data-proc="${p}" aria-selected="false">${p}</button>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(LAUNCHER_TITLE)}</title>
<style nonce="${escapeHtml(nonce)}">${STYLES}</style>
</head>
<body>
<main>
<header>
  <div>
    <h1>${escapeHtml(LAUNCHER_TITLE)}</h1>
    <p class="muted">Local dev environment started by <code>npm run dev</code>. <span id="updated"></span></p>
  </div>
  <button type="button" id="stop" class="danger">Stop all</button>
</header>
${banner}
<section class="grid cards" id="cards" aria-label="Status"></section>
<section class="panel" aria-label="Start steps">
  <h2>Start sequence</h2>
  <ul class="steps" id="steps"></ul>
</section>
<div class="grid two" id="middle">
  <section class="panel" aria-label="Quick links">
    <h2>Quick links</h2>
    <ul class="links">
      ${linkRow('Dashboard', urls.dashboard, 'Next.js, needs sign-in')}
      ${linkRow('API health', urls.apiHealth, 'liveness')}
      ${linkRow('API readiness', urls.apiReady, 'database reachable')}
      ${linkRow('Public integration guide', urls.guide, 'what other teams read')}
      ${linkRow('OpenAPI JSON', urls.openapi, 'the ingest contract')}
    </ul>
  </section>
  <section class="panel" aria-label="Sign in">
    <h2>Sign in (dev token)</h2>
    <p class="whoami" id="whoami">Checking…</p>
    <form method="post" action="${LAUNCHER_ROUTES.signIn}">
      ${returnField}
      <label for="email">Email</label>
      <input id="email" name="email" type="email" value="${escapeHtml(input.defaultEmail)}" autocomplete="off">
      <div class="row">
        <button type="submit" name="role" value="admin" class="primary">Sign in as admin</button>
        <button type="submit" name="role" value="viewer">Sign in as viewer (${escapeHtml(input.viewerEmail)})</button>
      </div>
    </form>
    <form method="post" action="${LAUNCHER_ROUTES.signOut}" class="row"><button type="submit" id="signout" class="hidden">Sign out</button></form>
    <p class="detail">Admins in this dev environment: ${escapeHtml(input.adminEmails.join(', '))}. Any other @libas.in email signs in as a viewer.</p>
  </section>
</div>
<div class="grid two">
  <section class="panel" aria-label="Demo data">
    <h2>Demo data</h2>
    <p class="muted">Creates app <code>demo-app</code> (base path /demo) with one secret and one publishable key, stored in <code>.env.dev</code>.</p>
    <div class="row"><button type="button" id="seed" class="primary">Seed demo data</button></div>
    <div class="result" id="seed-result"></div>
    <div class="keys" id="keys"></div>
  </section>
  <section class="panel" aria-label="Sample traffic">
    <h2>Sample traffic</h2>
    <p class="muted">Realistic server events for <code>demo-app</code> over the last 6 hours, sent to the real ingest route.</p>
    <div class="inline row">
      <div class="grow"><label for="count">Events</label><input id="count" type="number" min="1" max="5000" value="200"></div>
      <button type="button" id="traffic" class="primary">Send sample traffic</button>
    </div>
    <div class="result" id="traffic-result"></div>
  </section>
</div>
<section class="panel" aria-label="Logs">
  <h2>Logs (last 200 lines)</h2>
  <div class="tabs" role="tablist">${tabs}</div>
  <pre id="log" aria-live="off"></pre>
</section>
</main>
<script type="application/json" id="boot">${embedJson(boot)}</script>
<script nonce="${escapeHtml(nonce)}">${SCRIPT}</script>
</body>
</html>`;
}
