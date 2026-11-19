'use strict';
/* JARVIS front end: renders the server snapshot (calendars, mail, files, tasks) and keeps it live over SSE. */
const $ = id => document.getElementById(id);
const PALETTE = ['#4fa3ff', '#33c48d', '#b48cff', '#ffb347', '#ff7ac6', '#ffd84f', '#4fd8ff'];
const DAY = 864e5;
let RAW = null;   // snapshot exactly as the server sent it
let S = null;     // snapshot with hidden calendars removed
let G = null;     // dependency graph (overlaps, tight hand-offs) from web.js
let SYS = null;
let linkUp = false;

/* ---------- small helpers ---------- */
function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}
function safeLink(text, href, cls) {
  if (typeof href === 'string' && /^https:\/\//.test(href)) {
    const a = el('a', cls || '', text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
  }
  return el('span', cls || '', text);
}
function store(key, val) {
  try { if (val === undefined) return JSON.parse(localStorage.getItem(key) || 'null'); localStorage.setItem(key, JSON.stringify(val)); } catch (e) { return null; }
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jarvis': '1' }, body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}
function parse(iso, allDay) {
  if (!iso) return null;
  if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).getTime(); }
  const t = new Date(iso).getTime();
  return isNaN(t) ? null : t;
}
const sod = t => { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); };
const dayIndex = t => Math.round((sod(t) - sod(Date.now())) / DAY);
const fmtT = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function dayName(t) {
  const i = dayIndex(t);
  if (i === 0) return 'Today';
  if (i === 1) return 'Tomorrow';
  if (i === -1) return 'Yesterday';
  return new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
function longDay(t) { return new Date(t).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }); }
function durText(min) { const h = Math.floor(min / 60), m = min % 60; return h ? (m ? `${h} h ${m} min` : `${h} h`) : `${m} min`; }
function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return Math.round(s / 60) + ' min ago';
  if (s < DAY / 1000) return Math.round(s / 3600) + ' h ago';
  return dayName(t);
}
function until(t) {
  const m = Math.round((t - Date.now()) / 60000);
  if (m <= 0) return 'now';
  if (m < 60) return `in ${m} min`;
  if (m < 24 * 60 && dayIndex(t) === 0) return `in ${durText(m)}`;
  return `${dayName(t)} ${fmtT(t)}`;
}
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isClean = c => /clean/i.test(c.label || c.name);

/* ---------- state shaping ---------- */
let hidden = new Set(store('jarvis-hidden-cals') || []);
function normalise(raw) {
  raw.calendars.forEach((c, i) => { c.color = c.color || PALETTE[i % PALETTE.length]; c.label = c.label || c.name; });
  return raw;
}
function accountColor(email) {
  const c = RAW && RAW.calendars.find(x => x.primary && x.account === email);
  if (c) return c.color;
  const i = RAW ? RAW.accounts.findIndex(a => a.email === email) : 0;
  return PALETTE[(i + 3) % PALETTE.length];
}
function accountLabel(email) {
  const c = RAW && RAW.calendars.find(x => x.primary && x.account === email);
  return c ? c.label : email;
}
function applyView() {
  S = Object.assign({}, RAW, { calendars: RAW.calendars.filter(c => !hidden.has(c.id)) });
  G = window.JarvisWeb ? window.JarvisWeb.buildGraph(S, Date.now()) : null;
  window.JARVIS_STATE = S;
  window.dispatchEvent(new CustomEvent('jarvis:snapshot', { detail: S }));
}
const evKey = (c, e) => `e:${c.id}:${e.id}:${e.start}`;
function allEvents() {
  const out = [];
  for (const c of S.calendars) for (const e of c.events) {
    const s = parse(e.start, e.allDay); if (s === null) continue;
    const en = parse(e.end, e.allDay) || s + 36e5;
    out.push({ c, e, s, en, key: evKey(c, e) });
  }
  return out.sort((a, b) => a.s - b.s);
}
function flags(key) {
  const f = { red: [], amber: [] };
  if (!G) return f;
  for (const l of G.conflicts) if (l.a.key === key || l.b.key === key) f.red.push(l);
  for (const l of G.tight) if (l.a.key === key || l.b.key === key) f.amber.push(l);
  return f;
}

/* ---------- top bar ---------- */
function renderTop() {
  const live = $('live');
  live.className = 'live ' + (linkUp ? 'on' : 'off');
  $('live-text').textContent = linkUp ? 'Live' : 'Reconnecting';
  $('sync').textContent = SYS && SYS.syncedAt ? 'Synced ' + ago(SYS.syncedAt) : 'Not synced yet';
  const box = $('acct-btn'); box.replaceChildren();
  if (!RAW) return;
  RAW.accounts.forEach(a => {
    const av = el('span', 'av' + (Object.keys(a.errors || {}).length ? ' warn' : ''), a.email[0].toUpperCase());
    av.style.background = accountColor(a.email); av.title = a.email;
    box.appendChild(av);
  });
  if (!RAW.accounts.length) box.appendChild(el('span', 'av add', '+'));
  box.title = RAW.accounts.length ? 'Accounts: ' + RAW.accounts.map(a => a.email).join(', ') : 'Connect a Google account';
}

/* ---------- briefing ---------- */
function summaryParts() {
  const now = Date.now();
  const today = allEvents().filter(x => dayIndex(x.s) === 0 || (x.s < sod(now) && x.en > now));
  const cleans = today.filter(x => isClean(x.c)).length;
  const next = allEvents().find(x => !x.e.allDay && x.en > now);
  const parts = [];
  if (!RAW.accounts.length && !RAW.demo) return [['Connect a Google account to bring your calendar, mail and files in. Click the '], ['+', 1], [' at the top right.']];
  if (today.length) {
    parts.push(['You have '], [plural(today.length, 'event'), 1], [' today']);
    if (cleans) parts.push([', including '], [plural(cleans, 'clean'), 1]);
    parts.push(['. ']);
  } else parts.push(['Nothing on your calendar today. ']);
  if (next) {
    const live = next.s <= now;
    parts.push([live ? 'Happening now: ' : 'Next: '], [next.e.title, 1], [live ? `, until ${fmtT(next.en)}. ` : ` ${until(next.s)}${dayIndex(next.s) === 0 ? ' (' + fmtT(next.s) + ')' : ''}. `]);
  }
  if (S.mail.unread) parts.push([plural(S.mail.unread, 'unread thread'), 1], ['. ']);
  if (G && (G.conflicts.length || G.tight.length)) {
    const bits = [];
    if (G.conflicts.length) bits.push(plural(G.conflicts.length, 'double-booking'));
    if (G.tight.length) bits.push(plural(G.tight.length, 'tight hand-off'));
    parts.push([bits.join(' and '), 1], [' this week need a look.']);
  }
  return parts;
}
function renderBriefing() {
  const h = new Date().getHours();
  $('greet').textContent = h < 5 ? 'Working late.' : h < 12 ? 'Good morning.' : h < 17 ? 'Good afternoon.' : 'Good evening.';
  const sum = $('summary'); sum.replaceChildren();
  summaryParts().forEach(([t, b]) => sum.appendChild(b ? el('b', '', t) : document.createTextNode(t)));

  const now = Date.now();
  const evs = allEvents();
  const next = evs.find(x => !x.e.allDay && x.en > now);
  $('next-title').textContent = next ? next.e.title : 'Nothing scheduled';
  $('next-when').textContent = next ? (next.s <= now ? `Now, until ${fmtT(next.en)}` : until(next.s)) : '';
  $('next-where').textContent = next ? (next.e.location ? '· ' + next.e.location.split(',')[0] : '· ' + next.c.label) : 'this week';
  $('c-next').onclick = () => next && openEvent(next.key);
  $('c-next').disabled = !next;

  const today = evs.filter(x => dayIndex(x.s) === 0);
  const left = today.filter(x => x.en > now).length;
  const cleans = today.filter(x => isClean(x.c)).length;
  $('today-count').textContent = today.length;
  $('today-sub').textContent = today.length ? [cleans ? plural(cleans, 'clean') : '', left === today.length ? 'none done yet' : `${left} still to go`].filter(Boolean).join(' · ') : 'Free day';

  $('mail-count').textContent = S.mail.unread;
  const perAcct = {};
  S.mail.threads.forEach(t => { perAcct[t.account] = (perAcct[t.account] || 0) + 1; });
  $('mail-sub').textContent = RAW.accounts.length > 1 ? Object.entries(perAcct).map(([a, n]) => `${n} ${accountLabel(a)}`).join(' · ') : (S.mail.threads[0] ? 'Latest from ' + S.mail.threads[0].from : 'Inbox zero');

  const nc = G ? G.conflicts.length : 0, nt = G ? G.tight.length : 0;
  $('attn-count').textContent = nc + nt;
  $('attn-unit').textContent = nc + nt === 1 ? 'item' : 'items';
  $('attn-sub').textContent = nc + nt ? [nc ? plural(nc, 'double-booking') : '', nt ? plural(nt, 'tight hand-off') : ''].filter(Boolean).join(' · ') : 'All clear this week';
  $('c-attn').classList.toggle('has-red', !!nc);
  $('c-attn').classList.toggle('has-amber', !nc && !!nt);
}

/* ---------- calendar toggles ---------- */
function renderToggles() {
  const box = $('cal-toggles'); box.replaceChildren();
  if (!RAW.calendars.length) return;
  box.appendChild(el('span', 'lbl', 'Calendars'));
  RAW.calendars.forEach(c => {
    const on = !hidden.has(c.id);
    const b = el('button', 'chip'); b.type = 'button';
    b.setAttribute('aria-pressed', String(on));
    b.title = (on ? 'Hide ' : 'Show ') + c.label + (c.primary ? ` (${c.account})` : '');
    const dot = el('span', 'dot'); dot.style.background = c.color;
    b.append(dot, document.createTextNode(c.label));
    b.addEventListener('click', () => {
      if (on) hidden.add(c.id); else hidden.delete(c.id);
      store('jarvis-hidden-cals', [...hidden]);
      applyView(); renderAll();
    });
    box.appendChild(b);
  });
}

/* ---------- today timeline ---------- */
const PX = 64; // pixels per hour
function renderTimeline() {
  const now = Date.now(), t0 = sod(now), t1 = t0 + DAY;
  $('today-date').textContent = longDay(now);
  const evs = allEvents().filter(x => x.en > t0 && x.s < t1);
  const allDay = evs.filter(x => x.e.allDay);
  const timed = evs.filter(x => !x.e.allDay).map(x => Object.assign({}, x, { vs: Math.max(x.s, t0), ve: Math.min(x.en, t1) }));

  const ad = $('allday'); ad.replaceChildren();
  allDay.forEach(x => {
    const p = el('button', 'pill', x.e.title); p.type = 'button'; p.style.setProperty('--c', x.c.color);
    p.addEventListener('click', () => openEvent(x.key)); ad.appendChild(p);
  });

  const tl = $('timeline'); tl.replaceChildren();
  if (!timed.length) { tl.style.height = 'auto'; tl.appendChild(el('p', 'empty', allDay.length ? 'No timed events today.' : 'Nothing on your calendar today.')); return; }
  const hourOf = t => (t - t0) / 36e5;
  let startH = Math.min(8, Math.floor(Math.min(...timed.map(x => hourOf(x.vs)))));
  let endH = Math.max(18, Math.ceil(Math.max(...timed.map(x => hourOf(x.ve)))));
  const nowH = hourOf(now);
  startH = Math.max(0, Math.min(startH, Math.floor(nowH))); endH = Math.min(24, Math.max(endH, Math.ceil(nowH + 0.01)));
  tl.style.height = (endH - startH) * PX + 'px';

  for (let h = startH; h <= endH; h++) {
    const line = el('div', 'hour'); line.style.top = (h - startH) * PX + 'px';
    if (h < endH) line.appendChild(el('span', '', new Date(t0 + h * 36e5).toLocaleTimeString([], { hour: 'numeric' })));
    tl.appendChild(line);
  }

  // Two lanes: your own calendars, and shared ones (like the Cleaning Schedule), so the crews' jobs
  // don't squeeze your day. Inside a lane, events that overlap sit side by side.
  const yours = timed.filter(x => x.c.primary), others = timed.filter(x => !x.c.primary);
  const otherCals = [...new Set(others.map(x => x.c.label))];
  const lanes = yours.length && others.length
    ? [{ label: 'Your calendars', items: yours }, { label: otherCals.length === 1 ? otherCals[0] : 'Shared calendars', items: others }]
    : [{ label: '', items: timed }];
  const heads = $('lane-heads'); heads.replaceChildren();
  heads.hidden = lanes.length < 2;
  lanes.forEach((lane, li) => {
    heads.appendChild(el('span', '', lane.label));
    let cluster = [], cols = [], clusterEnd = -Infinity;
    const flush = () => { cluster.forEach(x => { x.ncol = cols.length; }); cluster = []; cols = []; };
    lane.items.sort((a, b) => a.vs - b.vs || b.ve - a.ve).forEach(x => {
      if (x.vs >= clusterEnd) { flush(); clusterEnd = -Infinity; }
      let col = cols.findIndex(end => end <= x.vs);
      if (col < 0) { col = cols.length; cols.push(x.ve); } else cols[col] = x.ve;
      x.col = col; x.lane = li; cluster.push(x); clusterEnd = Math.max(clusterEnd, x.ve);
    });
    flush();
  });
  const laneW = 100 / lanes.length;
  for (let i = 1; i < lanes.length; i++) { const d = el('div', 'lane-split'); d.style.left = i * laneW + '%'; tl.appendChild(d); }

  timed.forEach(x => {
    const top = (hourOf(x.vs) - startH) * PX, height = Math.max(24, (x.ve - x.vs) / 36e5 * PX - 3);
    const f = flags(x.key);
    const b = el('button', 'ev'); b.type = 'button';
    b.style.setProperty('--c', x.c.color);
    b.style.top = top + 'px'; b.style.height = height + 'px';
    b.style.left = `calc(${x.lane * laneW + (x.col / x.ncol) * laneW}% + 3px)`; b.style.width = `calc(${laneW / x.ncol}% - 6px)`;
    if (x.en < now) b.classList.add('past');
    if (height < 38) b.classList.add('short');
    if (f.red.length) b.classList.add('flag-red'); else if (f.amber.length) b.classList.add('flag-amber');
    b.appendChild(el('span', 't', x.e.title));
    const meta = el('span', 'm');
    if (x.s <= now && x.en > now) meta.appendChild(el('span', 'badge live', 'Now'));
    if (f.red.length) meta.appendChild(el('span', 'badge red', 'Double-booked'));
    if (f.amber.length) meta.appendChild(el('span', 'badge amber', 'Tight'));
    meta.appendChild(document.createTextNode(` ${fmtT(x.s)}–${fmtT(x.en)}${x.e.location ? ' · ' + x.e.location.split(',')[0] : ''}`));
    b.appendChild(meta);
    b.title = `${x.e.title}\n${fmtT(x.s)}–${fmtT(x.en)} · ${x.c.label}`;
    b.setAttribute('aria-label', `${x.e.title}, ${fmtT(x.s)} to ${fmtT(x.en)}, ${x.c.label}${f.red.length ? ', double-booked' : ''}${f.amber.length ? ', tight hand-off' : ''}`);
    b.addEventListener('click', () => openEvent(x.key));
    tl.appendChild(b);
  });

  if (nowH >= startH && nowH <= endH) {
    const n = el('div', 'now'); n.style.top = (nowH - startH) * PX + 'px';
    n.appendChild(el('span', '', 'Now ' + fmtT(now)));
    tl.appendChild(n);
  }
}

/* ---------- coming up ---------- */
function renderUpcoming() {
  const box = $('upcoming'); box.replaceChildren();
  const days = (RAW.windowDays || 7) - 1;
  $('upcoming-hint').textContent = `next ${plural(days, 'day')}`;
  const groups = new Map();
  allEvents().filter(x => dayIndex(x.s) >= 1).forEach(x => {
    const k = dayIndex(x.s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x);
  });
  if (!groups.size) { box.appendChild(el('p', 'empty', 'Nothing else on your calendars this week.')); return; }
  [...groups.keys()].sort((a, b) => a - b).forEach(k => {
    const list = groups.get(k).sort((a, b) => Number(b.e.allDay) - Number(a.e.allDay) || a.s - b.s);
    const sec = el('div', 'day');
    const h = el('h3');
    h.appendChild(el('b', '', k === 1 ? 'Tomorrow · ' + new Date(list[0].s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : longDay(list[0].s)));
    const cl = list.filter(x => isClean(x.c)).length;
    h.appendChild(el('span', '', plural(list.length, 'event') + (cl ? ` · ${plural(cl, 'clean')}` : '')));
    sec.appendChild(h);
    list.forEach(x => {
      const f = flags(x.key);
      const row = el('button', 'up'); row.type = 'button'; row.style.setProperty('--c', x.c.color);
      row.appendChild(el('time', '', x.e.allDay ? 'All day' : fmtT(x.s)));
      row.appendChild(el('span', 'dot'));
      const t = el('span', 't', x.e.title);
      if (x.e.location) t.appendChild(el('small', '', x.e.location.split(',')[0]));
      row.appendChild(t);
      const badges = el('span', 'badges');
      if (f.red.length) badges.appendChild(el('span', 'badge red', 'Double-booked'));
      else if (f.amber.length) badges.appendChild(el('span', 'badge amber', 'Tight'));
      row.appendChild(badges);
      row.title = x.c.label;
      row.addEventListener('click', () => openEvent(x.key));
      sec.appendChild(row);
    });
    box.appendChild(sec);
  });
}

/* ---------- needs attention ---------- */
function renderAttention() {
  const ul = $('attn-list'); ul.replaceChildren();
  const add = (cls, title, meta, onClick) => {
    const li = el('li');
    li.appendChild(el('span', 'flag ' + cls));
    const g = el('div', 'grow');
    const b = el('button', 'title', title); b.type = 'button'; if (onClick) b.addEventListener('click', onClick); else b.disabled = true;
    g.append(b, el('span', 'meta', meta));
    li.appendChild(g); ul.appendChild(li);
  };
  if (!linkUp) add('amber', 'Lost connection to JARVIS', 'Retrying. Check the Terminal window is still open.');
  RAW.accounts.filter(a => Object.keys(a.errors || {}).length).forEach(a =>
    add('red', `${a.email} needs attention`, Object.entries(a.errors).map(([k, v]) => `${k}: ${v}`).join(' · '), openAccounts));
  if (G) {
    G.conflicts.forEach(l => add('red', `Double-booked: ${l.a.e.title} and ${l.b.e.title}`,
      `${l.who.join(', ')} · ${dayName(l.b.s)} ${fmtT(l.b.s)} · ${l.minutes} min overlap`, () => openEvent(l.b.key)));
    G.tight.forEach(l => add('amber', `Tight: ${l.a.e.title} → ${l.b.e.title}`,
      `${l.who.join(', ')} · ${dayName(l.b.s)} · ${l.gap} min to get from ${String(l.a.e.location).split(',')[0]} to ${String(l.b.e.location).split(',')[0]}`, () => openEvent(l.b.key)));
  }
  if (!ul.children.length) ul.appendChild(el('li', 'empty', 'Nothing needs attention this week.'));
}

/* ---------- mail, tasks, files ---------- */
function renderMail() {
  const ul = $('mail'); ul.replaceChildren();
  $('mail-hint').textContent = RAW.accounts.length > 1 ? `across ${plural(RAW.accounts.length, 'account')}` : '';
  S.mail.threads.forEach(t => {
    const li = el('li');
    const dot = el('span', 'acct'); dot.style.background = accountColor(t.account); dot.title = t.account;
    const g = el('div', 'grow');
    g.append(safeLink(t.subject, t.url, 'title'), el('span', 'meta', t.from + (RAW.accounts.length > 1 ? ` · ${accountLabel(t.account)}` : '')));
    const d = new Date(t.ts);
    li.append(dot, g, el('span', 'when', dayIndex(t.ts) === 0 ? fmtT(t.ts) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })));
    ul.appendChild(li);
  });
  if (!ul.children.length) ul.appendChild(el('li', 'empty', RAW.accounts.length ? 'No unread mail. Nice.' : 'No account connected yet.'));
}
function renderTasks() {
  const ul = $('tasks'); ul.replaceChildren();
  S.tasks.forEach(t => {
    const li = el('li');
    const done = el('button', 'check'); done.type = 'button'; done.title = 'Mark done'; done.setAttribute('aria-label', 'Mark done: ' + t.text);
    done.addEventListener('click', () => post('/api/tasks/delete', { id: t.id }).catch(() => say('Could not update that task. Is JARVIS still running?')));
    li.append(done, el('span', 'grow title', t.text));
    ul.appendChild(li);
  });
  if (!ul.children.length) ul.appendChild(el('li', 'empty', 'No open tasks.'));
}
function mimeTag(m) {
  return /folder/.test(m) ? 'DIR' : /spreadsheet/.test(m) ? 'XLS' : /document/.test(m) ? 'DOC' : /presentation/.test(m) ? 'PPT' : /pdf/.test(m) ? 'PDF' : 'FILE';
}
function renderFiles() {
  const ul = $('drive'); ul.replaceChildren();
  S.files.forEach(f => {
    const li = el('li');
    const g = el('div', 'grow');
    g.append(safeLink(f.name, f.url, 'title'), el('span', 'meta', `Edited ${dayName(new Date(f.modified).getTime())}${RAW.accounts.length > 1 ? ' · ' + accountLabel(f.account) : ''}`));
    li.append(el('span', 'ico', mimeTag(f.mime || '')), g);
    ul.appendChild(li);
  });
  if (!ul.children.length) ul.appendChild(el('li', 'empty', RAW.accounts.length ? 'No recent files.' : 'No account connected yet.'));
}
function renderFoot() {
  const f = $('host'); f.replaceChildren();
  if (!SYS) return;
  const nextIn = Math.max(0, Math.round((SYS.nextAt - Date.now()) / 60000));
  [
    SYS.syncedAt ? `Last synced ${fmtT(SYS.syncedAt)}` : 'Waiting for first sync',
    `Next automatic sync in ${durText(nextIn)}`,
    `This computer: CPU ${SYS.cpu}% · memory ${SYS.mem}%`,
    RAW ? plural(RAW.accounts.length, 'account') + ' connected' : '',
  ].filter(Boolean).forEach(t => f.appendChild(el('span', '', t)));
}

function renderAll() {
  if (!RAW) return;
  $('demo').hidden = !RAW.demo;
  renderTop(); renderBriefing(); renderToggles(); renderTimeline(); renderUpcoming();
  renderAttention(); renderMail(); renderTasks(); renderFiles(); renderFoot();
}

/* ---------- drawer ---------- */
let lastFocus = null;
function openDrawer(build) {
  lastFocus = document.activeElement;
  const body = $('drawer-body'); body.replaceChildren();
  build(body);
  $('drawer').hidden = false; $('scrim').hidden = false;
  $('drawer-close').focus();
}
function closeDrawer() {
  $('drawer').hidden = true; $('scrim').hidden = true;
  if (lastFocus && lastFocus.focus) lastFocus.focus();
}
$('drawer-close').addEventListener('click', closeDrawer);
$('scrim').addEventListener('click', closeDrawer);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('drawer').hidden) closeDrawer(); });

function fact(icon, content) {
  const d = el('div', 'fact'); d.appendChild(el('span', '', icon));
  const c = el('span'); if (typeof content === 'string') c.textContent = content; else c.appendChild(content);
  d.appendChild(c); return d;
}
function openEvent(key) {
  const x = allEvents().find(v => v.key === key);
  if (!x) return;
  openDrawer(body => {
    const h = el('h2', '', x.e.title); h.id = 'drawer-title'; body.appendChild(h);
    const mins = Math.round((x.en - x.s) / 60000);
    body.appendChild(el('p', 'when', x.e.allDay ? `${longDay(x.s)} · all day` : `${dayName(x.s)}, ${longDay(x.s).split(', ').slice(1).join(', ')} · ${fmtT(x.s)} – ${fmtT(x.en)} (${durText(mins)})`));
    const cal = el('div', 'cal'); cal.style.setProperty('--c', x.c.color);
    cal.append(el('i'), document.createTextNode(`${x.c.label}${x.c.primary ? '' : ' · ' + x.c.account}`));
    body.appendChild(cal);

    if (x.e.location) {
      const a = el('a', '', x.e.location); a.href = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(x.e.location);
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      body.appendChild(fact('📍', a));
    }
    if (x.e.attendees && x.e.attendees.length) body.appendChild(fact('👥', x.e.attendees.map(a => a.name || a.email).join(', ')));
    if (x.e.meet) body.appendChild(fact('🎥', safeLink('Join Google Meet', x.e.meet)));

    const f = flags(key);
    if (f.red.length || f.amber.length) {
      body.appendChild(el('h3', '', 'Needs attention'));
      f.red.forEach(l => {
        const o = l.a.key === key ? l.b : l.a;
        const n = el('div', 'note red');
        n.appendChild(el('b', '', `Double-booked with ${o.e.title}`));
        n.appendChild(document.createTextNode(`${l.who.join(', ')} ${l.who.length > 1 || l.who[0] === 'You' ? 'are' : 'is'} in both. They overlap by ${l.minutes} min. `));
        const go = el('button', '', 'Open ' + o.e.title); go.type = 'button'; go.addEventListener('click', () => openEvent(o.key));
        n.appendChild(go); body.appendChild(n);
      });
      f.amber.forEach(l => {
        const before = l.b.key === key, o = before ? l.a : l.b;
        const n = el('div', 'note amber');
        n.appendChild(el('b', '', before ? `Only ${l.gap} min after ${o.e.title}` : `Only ${l.gap} min before ${o.e.title}`));
        n.appendChild(document.createTextNode(`${l.who.join(', ')} must get from ${String(l.a.e.location).split(',')[0]} to ${String(l.b.e.location).split(',')[0]}. `));
        const go = el('button', '', 'Open ' + o.e.title); go.type = 'button'; go.addEventListener('click', () => openEvent(o.key));
        n.appendChild(go); body.appendChild(n);
      });
    }

    if (!x.e.allDay) {
      // Only events that involve the same people: your own calendars together, or a shared attendee.
      const people = new Set((x.e.attendees || []).map(a => a.email));
      const related = v => (x.c.primary && v.c.primary) || (v.e.attendees || []).some(a => people.has(a.email))
        || (!x.c.primary && !people.size && v.c.id === x.c.id);
      const same = allEvents().filter(v => !v.e.allDay && sod(v.s) === sod(x.s) && v.key !== key && related(v));
      const prev = same.filter(v => v.en <= x.s).pop(), next = same.find(v => v.s >= x.en);
      if (prev || next) {
        body.appendChild(el('h3', '', 'Around it'));
        const ul = el('ul', 'rows');
        [[prev, 'Before'], [next, 'After']].forEach(([v, label]) => {
          if (!v) return;
          const gap = Math.round((label === 'Before' ? x.s - v.en : v.s - x.en) / 60000);
          const li = el('li'); const g = el('div', 'grow');
          const b = el('button', 'title', v.e.title); b.type = 'button'; b.addEventListener('click', () => openEvent(v.key));
          g.append(b, el('span', 'meta', `${label} · ${fmtT(v.s)}–${fmtT(v.en)} · ${gap ? durText(gap) + ' gap' : 'back to back'} · ${v.c.label}`));
          li.appendChild(g); ul.appendChild(li);
        });
        body.appendChild(ul);
      }
    }

    const acts = el('div', 'actions');
    if (/^https:\/\//.test(x.e.link || '')) acts.appendChild(safeLink('Open in Google Calendar', x.e.link, 'btn primary'));
    const web = el('a', 'btn', 'See it on the week web'); web.href = '#web'; web.addEventListener('click', closeDrawer);
    acts.appendChild(web);
    body.appendChild(acts);
  });
}
function openAccounts() {
  openDrawer(body => {
    const h = el('h2', '', 'Accounts'); h.id = 'drawer-title'; body.appendChild(h);
    body.appendChild(el('p', 'when', 'JARVIS reads these Google accounts. It can see calendars, mail and Drive file names, and cannot change anything.'));
    const ul = el('ul', 'rows');
    RAW.accounts.forEach(a => {
      const errs = Object.entries(a.errors || {});
      const li = el('li');
      const dot = el('span', 'acct'); dot.style.background = accountColor(a.email);
      const g = el('div', 'grow');
      g.append(el('span', 'title', a.email), el('span', 'meta', errs.length ? errs.map(([k, v]) => `${k}: ${v}`).join(' · ') : 'Working'));
      li.append(dot, g);
      if (!RAW.demo) {
        const rm = el('button', 'x', 'Disconnect'); rm.type = 'button';
        let armed = false;
        rm.addEventListener('click', () => {
          if (!armed) { armed = true; rm.textContent = 'Click again to disconnect'; setTimeout(() => { armed = false; rm.textContent = 'Disconnect'; }, 4000); return; }
          post('/auth/remove', { email: a.email }).then(closeDrawer).catch(() => say('Could not disconnect that account.'));
        });
        li.appendChild(rm);
      }
      ul.appendChild(li);
    });
    if (!RAW.accounts.length) ul.appendChild(el('li', 'empty', 'No accounts connected yet.'));
    body.appendChild(ul);
    const acts = el('div', 'actions');
    if (RAW.demo) acts.appendChild(el('p', 'when', 'Demo mode. Start JARVIS without DEMO=1 to connect real accounts.'));
    else if (!RAW.configured) acts.appendChild(el('p', 'when', 'Google sign-in is not set up yet. Put the client_secret JSON file from Google Cloud in the jarvis folder and restart.'));
    else { const a = el('a', 'btn primary', '+ Connect a Google account'); a.href = '/auth/google'; acts.appendChild(a); }
    body.appendChild(acts);
    if (RAW.calendars.length) {
      body.appendChild(el('h3', '', 'Calendars'));
      const cl = el('ul', 'rows');
      RAW.calendars.forEach(c => {
        const li = el('li'); const dot = el('span', 'acct'); dot.style.background = c.color;
        const g = el('div', 'grow'); g.append(el('span', 'title', c.label), el('span', 'meta', `${c.account}${hidden.has(c.id) ? ' · hidden' : ''}`));
        li.append(dot, g); cl.appendChild(li);
      });
      body.appendChild(cl);
    }
  });
}
$('acct-btn').addEventListener('click', openAccounts);

/* ---------- refresh ---------- */
$('refresh').addEventListener('click', async () => {
  const b = $('refresh'); b.disabled = true; b.textContent = 'Refreshing…';
  try { await post('/api/refresh'); say('Pulled fresh data from Google.'); }
  catch (e) { say('Could not refresh. Is JARVIS still running in Terminal?'); }
  b.disabled = false; b.textContent = 'Refresh';
});

/* ---------- live link ---------- */
let first = true;
const es = new EventSource('/api/stream');
es.onopen = () => { linkUp = true; renderTop(); if (RAW) renderAttention(); };
es.onerror = () => { linkUp = false; renderTop(); if (RAW) renderAttention(); };
es.addEventListener('snapshot', ev => {
  RAW = normalise(JSON.parse(ev.data));
  applyView(); renderAll();
  if (first) {
    first = false;
    say(RAW.demo ? 'Running on demo data. Ask me about your schedule, cleans, mail or tasks.'
      : !RAW.accounts.length ? 'Connect a Google account to get started.'
        : 'Ready. Ask me about your day, or tap a suggestion below.');
  }
});
es.addEventListener('sys', ev => { SYS = JSON.parse(ev.data); renderTop(); renderFoot(); });
setInterval(() => { if (RAW) { G = window.JarvisWeb ? window.JarvisWeb.buildGraph(S, Date.now()) : G; renderAll(); } }, 30000);

/* ---------- tasks ---------- */
$('tf').addEventListener('submit', e => {
  e.preventDefault();
  const v = $('ti').value.trim(); if (!v) return;
  post('/api/tasks', { text: v }).then(() => { $('ti').value = ''; }).catch(() => say('Could not save that task. Is JARVIS still running?'));
});

/* ---------- ask, voice ---------- */
let typing, voiceOn = !!store('jarvis-voice');
function say(msg) {
  const box = $('say'); clearTimeout(typing); let i = 0; box.textContent = '';
  (function n() { box.textContent = msg.slice(0, ++i); if (i < msg.length) typing = setTimeout(n, 10); })();
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
  try { say((await post('/api/ask', { q })).text); } catch (e) { say('I could not reach the JARVIS server.'); }
}
[['What\'s next?', 'schedule'], ['Cleans', 'cleaning'], ['Double-bookings', 'conflicts'], ['Mail', 'mail'], ['Tasks', 'tasks'], ['Status report', 'report'], ['Focus today', 'What should I focus on today?']]
  .forEach(([label, q]) => { const b = el('button', '', label); b.type = 'button'; b.addEventListener('click', () => run(q)); $('chips').appendChild(b); });
$('f').addEventListener('submit', e => { e.preventDefault(); const v = $('q').value.trim(); if (v) { run(v); $('q').value = ''; } });
if ('speechSynthesis' in window) {
  $('voice-wrap').hidden = false; $('voice').checked = voiceOn;
  $('voice').addEventListener('change', () => { voiceOn = $('voice').checked; store('jarvis-voice', voiceOn); if (!voiceOn) speechSynthesis.cancel(); });
}
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
  const m = $('mic'); m.hidden = false;
  const rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true;
  let listening = false;
  rec.onresult = ev => { $('q').value = Array.from(ev.results).map(r => r[0].transcript).join(' '); };
  rec.onstart = () => { listening = true; m.setAttribute('aria-pressed', 'true'); };
  rec.onend = () => { listening = false; m.setAttribute('aria-pressed', 'false'); const v = $('q').value.trim(); if (v) { $('q').value = ''; run(v); } };
  rec.onerror = ev => { if (ev.error === 'not-allowed') say('Microphone access is blocked. Allow it in Chrome to dictate.'); };
  m.addEventListener('click', () => { if (listening) rec.stop(); else { try { rec.start(); } catch (e) { /* already listening */ } } });
}
