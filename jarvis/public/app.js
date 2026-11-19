'use strict';
const $ = id => document.getElementById(id);
const p2 = n => String(n).padStart(2, '0');
let S = null, SYS = null;

/* ---------- safe DOM helpers: all remote text goes through textContent ---------- */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function link(text, href) {
  if (typeof href === 'string' && /^https:\/\//.test(href)) {
    const a = el('a', '', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  return document.createTextNode(text);
}
function item(tagText, tagCls, main, sub, href) {
  const li = el('li');
  li.appendChild(el('time', tagCls || '', tagText));
  const t = el('span', 't');
  t.appendChild(link(main, href));
  if (sub) t.appendChild(el('small', '', sub));
  li.appendChild(t);
  return li;
}
function setList(ul, items, empty) {
  ul.replaceChildren();
  if (!items.length) ul.appendChild(el('li', 'msg', empty));
  else items.forEach(i => ul.appendChild(i));
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

/* ---------- reactor decoration ---------- */
(function () {
  let t = '';
  for (let i = 0; i < 72; i++) {
    const a = i * 5 * Math.PI / 180, r1 = i % 6 ? 176 : 168, r2 = 182;
    t += `<line x1="${200 + r1 * Math.cos(a)}" y1="${200 + r1 * Math.sin(a)}" x2="${200 + r2 * Math.cos(a)}" y2="${200 + r2 * Math.sin(a)}" stroke-opacity="${i % 6 ? .4 : .9}"/>`;
  }
  $('ticks').innerHTML = t;
  let c = '';
  for (let i = 0; i < 10; i++) {
    const a = i * 36 * Math.PI / 180, P = (r, d) => `${200 + r * Math.cos(a + d)} ${200 + r * Math.sin(a + d)}`;
    c += `<path d="M${P(66, -.12)}L${P(100, -.12)}L${P(100, .12)}L${P(66, .12)}Z"/>`;
  }
  $('coils').innerHTML = c;
})();

/* ---------- time helpers ---------- */
function parse(iso, allDay) {
  if (!iso) return null;
  if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
  return new Date(iso);
}
function dayLabel(d) {
  const n = new Date(), t0 = new Date(n.getFullYear(), n.getMonth(), n.getDate()), d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((d0 - t0) / 864e5);
  return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
const hm = d => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function ago(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  return s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago';
}

/* ---------- renderers ---------- */
function renderCals() {
  const box = $('cals'); box.replaceChildren();
  const now = Date.now();
  if (!S.calendars.length) {
    const sec = el('section', 'panel'); sec.appendChild(el('h2', '', 'Schedule'));
    const ul = el('ul'); setList(ul, [], S.accounts.length ? 'No calendars found.' : 'Connect a Google account to load your calendars.');
    sec.appendChild(ul); box.appendChild(sec); return;
  }
  for (const c of S.calendars) {
    const sec = el('section', 'panel');
    const h = el('h2', '', c.primary ? 'Schedule' : c.name);
    const sub = el('span', '', c.primary ? c.account : `${c.events.length} in next ${S.windowDays || 7} days`);
    sub.title = c.primary ? c.account : c.name;
    h.appendChild(sub); sec.appendChild(h);
    const upcoming = c.events.filter(e => { const end = parse(e.end, e.allDay); return !end || end.getTime() > now; });
    const ul = el('ul');
    setList(ul, upcoming.slice(0, 8).map(e => {
      const s = parse(e.start, e.allDay), end = parse(e.end, e.allDay);
      const live = s && s.getTime() <= now && (!end || end.getTime() > now);
      const tag = live ? 'NOW' : e.allDay ? 'ALL DAY' : hm(s);
      const where = [dayLabel(s), e.location].filter(Boolean).join(' · ');
      return item(tag, live ? 'warn' : '', e.title, where, e.link);
    }), 'Nothing booked.');
    sec.appendChild(ul); box.appendChild(sec);
  }
}
function renderMail() {
  $('s-mail').textContent = S.mail.unread ? `${S.mail.unread} unread` : '';
  setList($('mail'), S.mail.threads.map(t => {
    const d = new Date(t.ts), today = d.toDateString() === new Date().toDateString();
    const when = today ? hm(d) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const sub = S.accounts.length > 1 ? `${t.from} · ${t.account}` : t.from;
    return item(when, '', t.subject, sub, t.url);
  }), S.accounts.length ? 'No unread mail.' : 'No account connected.');
}
function mimeTag(m) {
  return /folder/.test(m) ? 'DIR' : /spreadsheet/.test(m) ? 'SHEET' : /document/.test(m) ? 'DOC' : /presentation/.test(m) ? 'DECK' : /pdf/.test(m) ? 'PDF' : 'FILE';
}
function renderFiles() {
  setList($('drive'), S.files.map(f => item(mimeTag(f.mime || ''), '', f.name,
    'Edited ' + new Date(f.modified).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), f.url)),
  S.accounts.length ? 'No recent files.' : 'No account connected.');
}
function renderTasks() {
  setList($('tasks'), S.tasks.map((t, i) => {
    const li = el('li');
    li.appendChild(el('span', 'tag', p2(i + 1)));
    li.appendChild(el('span', 't', t.text));
    const x = el('button', 'x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Remove task');
    x.addEventListener('click', () => post('/api/tasks/delete', { id: t.id }).catch(() => say('Could not remove that task. Check the server is running.')));
    li.appendChild(x);
    return li;
  }), 'No open tasks. Add one below.');
}
function renderAccounts() {
  setList($('accts'), S.accounts.map(a => {
    const errs = Object.entries(a.errors || {});
    const li = el('li');
    li.appendChild(el('span', 'tag ' + (errs.length ? 'warn' : ''), errs.length ? 'CHECK' : 'OK'));
    const t = el('span', 't', a.email);
    if (errs.length) t.appendChild(el('small', '', errs.map(([k, v]) => `${k}: ${v}`).join(' · ')));
    li.appendChild(t);
    if (!S.demo) {
      const x = el('button', 'x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Disconnect ' + a.email);
      let armed = false;
      x.addEventListener('click', () => {
        if (!armed) { armed = true; x.textContent = 'REMOVE?'; setTimeout(() => { armed = false; x.textContent = '✕'; }, 4000); return; }
        post('/auth/remove', { email: a.email }).catch(() => say('Could not disconnect that account.'));
      });
      li.appendChild(x);
    }
    return li;
  }), S.configured ? 'No accounts yet.' : 'Google sign-in is not set up on the server yet. See the README.');
  $('add').hidden = !!S.demo;
}
function renderAlerts() {
  const out = [], now = Date.now();
  const soon = S.calendars.flatMap(c => c.events).filter(e => !e.allDay)
    .map(e => ({ e, d: parse(e.start) })).filter(x => x.d - now > 0 && x.d - now < 3600e3)
    .sort((a, b) => a.d - b.d)[0];
  if (soon) out.push(item('SOON', 'warn', `${soon.e.title} in ${Math.round((soon.d - now) / 60000)} min`));
  const clean = S.calendars.find(c => /clean/i.test(c.name));
  if (clean) {
    const n = clean.events.filter(e => { const d = parse(e.start, e.allDay); return d && d.toDateString() === new Date().toDateString(); }).length;
    if (n) out.push(item('CLEAN', '', `${n} clean${n > 1 ? 's' : ''} today`));
  }
  if (S.mail.unread) out.push(item('MAIL', '', `${S.mail.unread} unread`));
  if (S.tasks.length) out.push(item('TASK', '', `${S.tasks.length} open task${S.tasks.length > 1 ? 's' : ''}`));
  S.accounts.filter(a => Object.keys(a.errors || {}).length).forEach(a => out.push(item('LINK', 'crit', `${a.email} needs attention`)));
  if (!linkUp) out.push(item('LINK', 'crit', 'Lost connection to the JARVIS server. Retrying.'));
  setList($('alerts'), out, 'All clear.');
}
function renderAll() {
  if (!S) return;
  $('demo').hidden = !S.demo;
  renderCals(); renderMail(); renderFiles(); renderTasks(); renderAccounts(); renderAlerts();
}
function renderSys() {
  if (!SYS) return;
  $('cpu').textContent = SYS.cpu + '%'; $('cpub').style.width = SYS.cpu + '%';
  $('mem').textContent = SYS.mem + '%'; $('memb').style.width = SYS.mem + '%';
  $('s-host').textContent = `${SYS.cores} cores · load ${SYS.load}`;
  const h = Math.floor(SYS.uptime / 3600);
  $('up').textContent = h >= 24 ? Math.floor(h / 24) + 'D ' + (h % 24) + 'H' : h + 'H ' + Math.floor(SYS.uptime / 60) % 60 + 'M';
}
function tickSync() {
  if (!SYS) return;
  $('sync').textContent = SYS.syncedAt ? ago(SYS.syncedAt).toUpperCase() : 'PENDING';
  const left = Math.max(0, Math.round((SYS.nextAt - Date.now()) / 1000));
  $('next').textContent = left + 's';
  $('nextb').style.width = (100 * (1 - left / SYS.pollSeconds)) + '%';
}

/* ---------- live link ---------- */
let linkUp = false;
function setLink(up) {
  linkUp = up;
  const b = $('link'); b.textContent = up ? 'LIVE' : 'RECONNECTING'; b.classList.toggle('bad', !up);
  if (S) renderAlerts();
}
let first = true;
const es = new EventSource('/api/stream');
es.onopen = () => setLink(true);
es.onerror = () => setLink(false);
es.addEventListener('snapshot', ev => {
  S = JSON.parse(ev.data);
  renderAll();
  if (first) {
    first = false;
    if (S.demo) say('Good day. Running on demo data. Ask me about the schedule, mail, files or tasks.');
    else if (!S.accounts.length) say('Good day. Connect a Google account to bring your calendar, mail and files online.');
    else say(`Good day. ${S.accounts.length} account${S.accounts.length > 1 ? 's' : ''} online. ${S.mail.unread} unread messages.`);
  }
});
es.addEventListener('sys', ev => { SYS = JSON.parse(ev.data); renderSys(); tickSync(); });

/* ---------- clock ---------- */
function tick() {
  const d = new Date();
  $('clock').textContent = `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
  $('date').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  tickSync();
}
tick();
setInterval(tick, 1000);
setInterval(() => { if (S) { renderCals(); renderAlerts(); } }, 30000); // NOW / SOON markers move with the clock

/* ---------- tasks ---------- */
$('tf').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('ti').value.trim();
  if (!v) return;
  post('/api/tasks', { text: v }).then(() => { $('ti').value = ''; }).catch(() => say('Could not save that task. Check the server is running.'));
});

/* ---------- voice and commands ---------- */
let voiceOn = false, typing;
function say(msg) {
  const box = $('say'); clearTimeout(typing); let i = 0; box.textContent = '';
  (function n() { box.textContent = msg.slice(0, ++i); if (i < msg.length) typing = setTimeout(n, 12); })();
  if (voiceOn && 'speechSynthesis' in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(msg);
    u.onstart = () => document.body.classList.add('speaking');
    u.onend = u.onerror = () => document.body.classList.remove('speaking');
    speechSynthesis.speak(u);
  }
}
async function run(q) {
  say('Thinking…');
  try { say((await post('/api/ask', { q })).text); }
  catch (e) { say('I could not reach the JARVIS server.'); }
}
['schedule', 'cleaning', 'mail', 'files', 'tasks', 'report'].forEach(c => {
  const b = el('button', '', c); b.type = 'button'; b.addEventListener('click', () => run(c)); $('chips').appendChild(b);
});
const focusBtn = el('button', '', 'focus today'); focusBtn.type = 'button';
focusBtn.addEventListener('click', () => run('What should I focus on today?'));
$('chips').appendChild(focusBtn);
$('f').addEventListener('submit', e => { e.preventDefault(); const v = $('q').value.trim(); if (v) { run(v); $('q').value = ''; } });

if ('speechSynthesis' in window) {
  const b = $('voice'); b.hidden = false;
  b.addEventListener('click', () => {
    voiceOn = !voiceOn; b.setAttribute('aria-pressed', voiceOn); b.textContent = 'VOICE: ' + (voiceOn ? 'ON' : 'OFF');
    if (!voiceOn) speechSynthesis.cancel();
  });
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
  const m = $('mic'); m.hidden = false;
  const rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true;
  let listening = false;
  rec.onresult = ev => { $('q').value = Array.from(ev.results).map(r => r[0].transcript).join(' '); };
  rec.onstart = () => { listening = true; m.setAttribute('aria-pressed', 'true'); };
  rec.onend = () => {
    listening = false; m.setAttribute('aria-pressed', 'false');
    const v = $('q').value.trim(); if (v) { $('q').value = ''; run(v); }
  };
  rec.onerror = ev => { if (ev.error === 'not-allowed') say('Microphone access was blocked. Allow it in the browser to dictate.'); };
  m.addEventListener('click', () => { if (listening) rec.stop(); else { try { rec.start(); } catch (e) { /* already running */ } } });
}
