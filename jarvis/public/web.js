'use strict';
/*
 * Spider-web view. Each ring is a day (today innermost), each spoke an hour of the day.
 * Events sit on the web; people and places float around them, tied to every event they share.
 * Dependencies drawn between events: overlaps (red), tight hand-offs between places (amber),
 * and the day's running order (thin thread).
 */
(function () {
  const DAY = 864e5;
  const PALETTE = ['#4fd8ff', '#ffb347', '#b48cff', '#5ef0a8', '#ff7ac6', '#ffd84f', '#8fb3ff'];
  const TIGHT_MIN = 45;
  const DRIVE_BUFFER = 10;

  function parse(iso, allDay) {
    if (!iso) return null;
    if (allDay && /^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); }
    const d = new Date(iso);
    return isNaN(d) ? null : d;
  }
  function sod(t) { const d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(); }
  function placeKey(loc) {
    const first = String(loc || '').split(',')[0].toLowerCase()
      .replace(/\broad\b/g, 'rd').replace(/\bstreet\b/g, 'st').replace(/\bavenue\b/g, 'ave').replace(/\bdrive\b/g, 'dr')
      .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    return /^(online|zoom|google meet|teams|phone|tbd)$/.test(first) ? '' : first;
  }

  /* Pure: snapshot -> graph. Exported for tests. */
  function buildGraph(S, now, opts) {
    now = now || Date.now(); opts = opts || {};
    const days = S.windowDays || 7;
    const t0 = sod(now);
    const calendars = (S.calendars || []).map((c, i) => ({
      id: c.id, name: c.label || (c.primary ? (c.account || c.name) : c.name), primary: !!c.primary, color: c.color || PALETTE[i % PALETTE.length],
    }));
    const events = [];
    (S.calendars || []).forEach((c, ci) => (c.events || []).forEach(e => {
      const s = parse(e.start, e.allDay); if (!s) return;
      const en = parse(e.end, e.allDay) || new Date(s.getTime() + 36e5);
      if (en.getTime() <= t0) return;
      let day = Math.floor((sod(s.getTime()) - t0) / DAY);
      let hour = e.allDay ? null : s.getHours() + s.getMinutes() / 60;
      if (day < 0) { day = 0; hour = e.allDay ? null : 0; }
      if (day >= days) return;
      events.push({ key: `e:${c.id}:${e.id}:${e.start}`, kind: 'event', e, cal: calendars[ci], s: s.getTime(), en: en.getTime(), day, hour, allDay: !!e.allDay, links: [] });
    }));
    events.sort((a, b) => a.s - b.s || a.key.localeCompare(b.key));

    const ents = new Map();
    const links = [];
    const mine = new Set([...(S.accounts || []).map(a => String(a.email).toLowerCase()), ...(opts.mine || [])]);
    const ent = (key, kind, label, extra) => {
      let n = ents.get(key);
      if (!n) { n = Object.assign({ key, kind, label, events: [], links: [] }, extra); ents.set(key, n); }
      return n;
    };
    const connect = (a, b, type, extra) => {
      const l = Object.assign({ a, b, type }, extra); links.push(l); a.links.push(l); b.links.push(l); return l;
    };
    for (const ev of events) {
      for (const p of ev.e.attendees || []) {
        if (!p.email || mine.has(p.email)) continue;
        const n = ent('p:' + p.email, 'person', p.name || p.email.split('@')[0], { email: p.email, mail: [] });
        if (!n.events.includes(ev)) { n.events.push(ev); connect(ev, n, 'person'); }
      }
      const pk = placeKey(ev.e.location);
      if (pk) {
        const n = ent('l:' + pk, 'place', String(ev.e.location).split(',')[0].trim(), { full: ev.e.location });
        if (!n.events.includes(ev)) { n.events.push(ev); connect(ev, n, 'place'); }
      }
    }
    for (const t of (S.mail && S.mail.threads) || []) {
      const n = t.fromEmail && ents.get('p:' + String(t.fromEmail).toLowerCase());
      if (n) n.mail.push(t);
    }

    // Time dependencies. A clash or tight hand-off only counts for someone who is in both events:
    // you (events on your own calendars) or a person invited to both.
    const timed = events.filter(x => !x.allDay);
    const tp = S.travel && S.travel.places ? new Map(S.travel.places.map((p, i) => [p, i])) : null;
    const driveMin = (a, b) => {
      if (!tp) return null;
      const i = tp.get(String(a || '').trim()), j = tp.get(String(b || '').trim());
      if (i === undefined || j === undefined) return null;
      const m = S.travel.minutes[i] && S.travel.minutes[i][j];
      return typeof m === 'number' ? m : null;
    };
    const actors = new Map();
    const addActor = (id, label, x) => { if (!actors.has(id)) actors.set(id, { label, list: [] }); actors.get(id).list.push(x); };
    for (const x of timed) {
      if (x.cal.primary) addActor('me', 'You', x);
      for (const p of x.e.attendees || []) if (p.email && !mine.has(p.email)) addActor(p.email, p.name || p.email.split('@')[0], x);
    }
    const pairs = new Map();
    const conflicts = [], tight = [], seq = [];
    const dep = (a, b, type, extra, who, bucket) => {
      const k = a.key + '|' + b.key;
      const have = pairs.get(k);
      if (have) { if (!have.who.includes(who)) have.who.push(who); return; }
      const l = connect(a, b, type, Object.assign({ who: [who] }, extra));
      pairs.set(k, l); bucket.push(l);
    };
    for (const { label, list } of actors.values()) {
      list.sort((a, b) => a.s - b.s || a.key.localeCompare(b.key));
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length && list[j].s < list[i].en; j++) {
          dep(list[i], list[j], 'conflict', { minutes: Math.round((Math.min(list[i].en, list[j].en) - list[j].s) / 60000) }, label, conflicts);
        }
      }
      let last = null;
      for (const x of list) {
        if (last && x.s >= last.en && sod(x.s) === sod(last.s)) {
          const gap = Math.round((x.s - last.en) / 60000);
          const pa = placeKey(last.e.location), pb = placeKey(x.e.location);
          if (pa && pb && pa !== pb) {
            // With a known drive time, "tight" means the gap is shorter than the drive plus a 10-minute buffer.
            const drive = driveMin(last.e.location, x.e.location);
            if (drive !== null ? gap < drive + DRIVE_BUFFER : gap <= TIGHT_MIN) dep(last, x, 'tight', { gap, drive }, label, tight);
          }
        }
        if (!last || x.en > last.en) last = x;
      }
    }
    // Running order: each day's events in sequence, where no stronger link exists.
    const byDay = new Map();
    timed.forEach(x => { const k = sod(x.s); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(x); });
    for (const list of byDay.values()) {
      for (let i = 1; i < list.length; i++) {
        const a = list[i - 1], b = list[i];
        if (pairs.has(a.key + '|' + b.key)) continue;
        const l = connect(a, b, 'next', { gap: Math.round((b.s - a.en) / 60000) });
        pairs.set(a.key + '|' + b.key, l); seq.push(l);
      }
    }

    let entities = [...ents.values()];
    if (opts.sharedOnly) entities = entities.filter(n => n.events.length > 1);
    if (opts.hidePeople) entities = entities.filter(n => n.kind !== 'person');
    if (opts.hidePlaces) entities = entities.filter(n => n.kind !== 'place');
    const keep = new Set([...events, ...entities]);
    const shown = links.filter(l => keep.has(l.a) && keep.has(l.b) && !(opts.hideSequence && l.type === 'next'));
    return { events, entities, links: shown, conflicts, tight, seq, calendars, days, t0 };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { buildGraph, placeKey }; return; }
  window.JarvisWeb = { buildGraph, placeKey, PALETTE };

  /* ================= browser UI ================= */
  const $ = id => document.getElementById(id);
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const R = 300; // world radius of the outermost ring
  const C = {};
  let S = window.JARVIS_STATE || null;
  let G = null;
  const pos = new Map(); // key -> {x,y,vx,vy,pinned}
  let alpha = 0;
  let view = { k: 1, x: 0, y: 0, user: 1, panX: 0, panY: 0 };
  let hover = null, selected = null, running = false, canvas, ctx, dpr = 1, W = 0, H = 0;

  // Today is the outer ring (most room for the busiest day); later days step inward.
  const ringR = d => R * (1 - 0.72 * d / Math.max(1, G.days - 1));
  const hourAng = h => -Math.PI / 2 + (h / 24) * Math.PI * 2;
  const fmtT = t => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const fmtD = t => {
    const diff = Math.round((sod(t) - sod(Date.now())) / DAY);
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : new Date(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  };

  function opts() {
    return {
      hidePeople: !$('wf-people').checked, hidePlaces: !$('wf-places').checked,
      hideSequence: !$('wf-seq').checked, sharedOnly: $('wf-shared').checked,
    };
  }

  function layoutEvents() {
    const perDay = new Map();
    for (const ev of G.events) {
      const h = ev.allDay ? 0 : ev.hour;
      const r = ringR(ev.day);
      ev.ang = hourAng(h);
      ev.r = r;
      if (!perDay.has(ev.day)) perDay.set(ev.day, []);
      perDay.get(ev.day).push(ev);
    }
    // Spread all-day events and events that start at almost the same time.
    for (const list of perDay.values()) {
      list.sort((a, b) => a.ang - b.ang);
      let prev = null, stack = 0;
      for (const ev of list) {
        const minSep = 16 / ev.r;
        if (prev && ev.ang - prev.ang < minSep) { stack++; ev.r = ringR(ev.day) + (stack % 2 ? 1 : -1) * Math.ceil(stack / 2) * 9; }
        else stack = 0;
        prev = ev;
      }
    }
    for (const ev of G.events) {
      pos.set(ev.key, { x: Math.cos(ev.ang) * ev.r, y: Math.sin(ev.ang) * ev.r, fixed: true });
    }
  }
  function seedEntities() {
    for (const n of G.entities) {
      if (pos.has(n.key)) continue;
      let x = 0, y = 0;
      n.events.forEach(ev => { const p = pos.get(ev.key); x += p.x; y += p.y; });
      x /= n.events.length || 1; y /= n.events.length || 1;
      const len = Math.hypot(x, y) || 1, push = n.events.length > 1 ? 0.92 : 1.18;
      pos.set(n.key, { x: x * push + (Math.random() - .5) * 30 + (x / len) * 8, y: y * push + (Math.random() - .5) * 30 + (y / len) * 8, vx: 0, vy: 0 });
    }
  }
  function rebuild() {
    if (!S) return;
    const keepSel = selected && selected.key;
    G = buildGraph(S, Date.now(), opts());
    layoutEvents();
    seedEntities();
    const all = new Map([...G.events, ...G.entities].map(n => [n.key, n]));
    selected = keepSel ? all.get(keepSel) || null : null;
    hover = null;
    alpha = 1;
    renderSide();
  }

  function step() {
    if (alpha < 0.01) return;
    const ents = G.entities;
    for (const n of ents) {
      const p = pos.get(n.key); if (p.pinned) continue;
      for (const ev of n.events) {
        const q = pos.get(ev.key); if (!q) continue;
        const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
        const f = (d - 46) * 0.03 * alpha;
        p.vx += dx / d * f; p.vy += dy / d * f;
      }
      for (const m of ents) {
        if (m === n) continue;
        const q = pos.get(m.key), dx = p.x - q.x, dy = p.y - q.y, d2 = dx * dx + dy * dy;
        if (d2 < 140 * 140 && d2 > 0.01) { const f = 700 / d2 * alpha; const d = Math.sqrt(d2); p.vx += dx / d * f; p.vy += dy / d * f; }
      }
      for (const ev of G.events) {
        const q = pos.get(ev.key), dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy);
        if (d < 26 && d > 0.01) { p.vx += dx / d * 1.2 * alpha; p.vy += dy / d * 1.2 * alpha; }
      }
    }
    for (const n of ents) {
      const p = pos.get(n.key); if (p.pinned) continue;
      p.vx *= 0.82; p.vy *= 0.82; p.x += p.vx; p.y += p.vy;
      const d = Math.hypot(p.x, p.y), max = R + 70;
      if (d > max) { p.x *= max / d; p.y *= max / d; }
    }
    alpha *= 0.985;
  }

  /* ---------- drawing ---------- */
  function resize() {
    const box = canvas.parentElement.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    W = box.width; H = box.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    view.k = Math.min(W, H) / (2 * (R + 70)) * view.user;
    view.x = W / 2 + view.panX; view.y = H / 2 + view.panY;
  }
  const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });

  function neighbours(n) {
    const s = new Set([n]);
    if (!n) return s;
    n.links.forEach(l => { s.add(l.a); s.add(l.b); });
    return s;
  }
  function draw() {
    const k = view.k, px = v => v / k;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, dpr * view.x, dpr * view.y);
    const focus = selected || hover;
    const near = focus ? neighbours(focus) : null;
    const dimmed = n => near && !near.has(n);

    // the web: day rings and hour spokes
    ctx.lineWidth = px(1);
    for (let d = 0; d < G.days; d++) {
      ctx.strokeStyle = d === 0 ? C.ring0 : C.ring;
      ctx.beginPath(); ctx.arc(0, 0, ringR(d), 0, Math.PI * 2); ctx.stroke();
    }
    for (let h = 0; h < 24; h++) {
      const a = hourAng(h), major = h % 3 === 0;
      ctx.strokeStyle = major ? C.spoke0 : C.spoke;
      ctx.beginPath(); ctx.moveTo(Math.cos(a) * ringR(G.days - 1) * 0.5, Math.sin(a) * ringR(G.days - 1) * 0.5);
      ctx.lineTo(Math.cos(a) * (R + 14), Math.sin(a) * (R + 14)); ctx.stroke();
      if (major) {
        ctx.fillStyle = C.muted; ctx.font = `${px(11)}px ${C.body}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(p2(h) + ':00', Math.cos(a) * (R + 30), Math.sin(a) * (R + 30));
      }
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.font = `${px(10)}px ${C.body}`;
    for (let d = 0; d < G.days; d++) {
      const label = d === 0 ? 'TODAY' : new Date(G.t0 + d * DAY + 36e5).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }).toUpperCase();
      const a = hourAng(23.55), r = ringR(d);
      ctx.fillStyle = d === 0 ? C.cyan : C.muted;
      ctx.fillText(label, Math.cos(a) * r - px(4), Math.sin(a) * r);
    }

    // now hand
    const nowD = new Date(), na = hourAng(nowD.getHours() + nowD.getMinutes() / 60 + nowD.getSeconds() / 3600);
    ctx.strokeStyle = C.amber; ctx.lineWidth = px(1.5); ctx.shadowColor = C.amber; ctx.shadowBlur = 0;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(na) * (R + 14), Math.sin(na) * (R + 14)); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = C.amber; ctx.beginPath(); ctx.arc(Math.cos(na) * ringR(0), Math.sin(na) * ringR(0), px(3.5), 0, Math.PI * 2); ctx.fill();

    // links
    for (const l of G.links) {
      const a = pos.get(l.a.key), b = pos.get(l.b.key); if (!a || !b) continue;
      const hot = near && near.has(l.a) && near.has(l.b) && (l.a === focus || l.b === focus);
      const faded = near && !hot;
      ctx.setLineDash([]);
      if (l.type === 'person' || l.type === 'place') {
        ctx.strokeStyle = l.type === 'person' ? C.person : C.place;
        ctx.globalAlpha = faded ? 0.06 : hot ? 0.9 : 0.32;
        ctx.lineWidth = px(hot ? 1.6 : 1);
        const mx = (a.x + b.x) / 2 * 0.9, my = (a.y + b.y) / 2 * 0.9;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
      } else {
        const col = l.type === 'conflict' ? C.red : l.type === 'tight' ? C.amber : C.cyan;
        ctx.strokeStyle = col;
        ctx.globalAlpha = faded ? 0.08 : l.type === 'next' ? (hot ? 0.8 : 0.28) : 0.95;
        ctx.lineWidth = px(l.type === 'next' ? 1 : 2.4);
        if (l.type === 'tight') ctx.setLineDash([px(6), px(4)]);
        if (l.type !== 'next') { ctx.shadowColor = col; ctx.shadowBlur = 0; }
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.shadowBlur = 0;
      }
    }
    ctx.globalAlpha = 1; ctx.setLineDash([]);

    // entity nodes
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    for (const n of G.entities) {
      const p = pos.get(n.key), dim = dimmed(n);
      ctx.globalAlpha = dim ? 0.18 : 1;
      const r = px(4) + Math.min(n.events.length, 8) * px(0.7);
      ctx.lineWidth = px(1.5);
      if (n.kind === 'person') {
        ctx.strokeStyle = C.person; ctx.fillStyle = C.bg;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        if (n.mail && n.mail.length) { ctx.fillStyle = C.amber; ctx.beginPath(); ctx.arc(p.x + r, p.y - r, px(3), 0, Math.PI * 2); ctx.fill(); }
      } else {
        ctx.strokeStyle = C.place; ctx.fillStyle = C.bg;
        ctx.beginPath(); ctx.moveTo(p.x, p.y - r * 1.25); ctx.lineTo(p.x + r * 1.25, p.y); ctx.lineTo(p.x, p.y + r * 1.25); ctx.lineTo(p.x - r * 1.25, p.y); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      if (n === focus || (near && near.has(n)) || (!near && n.events.length > 1)) {
        ctx.fillStyle = n.kind === 'person' ? C.person : C.place;
        ctx.font = `${px(n === focus ? 13 : 11)}px ${C.body}`;
        ctx.fillText(n.label, p.x + r + px(5), p.y);
      }
    }

    // event nodes
    const now = Date.now();
    for (const ev of G.events) {
      const p = pos.get(ev.key), dim = dimmed(ev), past = ev.en < now, live = ev.s <= now && ev.en > now;
      ctx.globalAlpha = dim ? 0.15 : past ? 0.35 : 1;
      const r = px(ev === focus ? 7.5 : 5.5);
      ctx.fillStyle = ev.cal.color; ctx.shadowColor = ev.cal.color; ctx.shadowBlur = dim ? 0 : 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (live) { ctx.strokeStyle = C.amber; ctx.lineWidth = px(1.5); ctx.beginPath(); ctx.arc(p.x, p.y, r + px(4 + 2 * Math.sin(now / 300)), 0, Math.PI * 2); ctx.stroke(); }
      if (ev === focus || (near && near.has(ev))) {
        ctx.fillStyle = C.fg; ctx.font = `${px(ev === focus ? 13 : 11)}px ${C.body}`;
        const out = Math.cos(p.x === 0 ? 0 : Math.atan2(p.y, p.x)) >= 0;
        ctx.textAlign = out ? 'left' : 'right';
        ctx.fillText(`${ev.e.title} · ${ev.allDay ? 'all day' : fmtT(ev.s)}`, p.x + (out ? 1 : -1) * (r + px(6)), p.y);
        ctx.textAlign = 'left';
      }
    }
    ctx.globalAlpha = 1;
  }
  const p2 = n => String(n).padStart(2, '0');

  function loop() {
    if (!running) return;
    if (G) { step(); draw(); }
    requestAnimationFrame(loop);
  }

  /* ---------- interaction ---------- */
  function hit(sx, sy) {
    if (!G) return null;
    const w = toWorld(sx, sy), lim = 12 / view.k;
    let best = null, bd = lim;
    for (const n of [...G.events, ...G.entities]) {
      const p = pos.get(n.key); if (!p) continue;
      const d = Math.hypot(p.x - w.x, p.y - w.y);
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }
  function bindCanvas() {
    let drag = null;
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      const n = hit(sx, sy);
      drag = { n, sx, sy, moved: 0, panX: view.panX, panY: view.panY };
      if (n && n.kind !== 'event') { pos.get(n.key).pinned = true; alpha = Math.max(alpha, 0.4); }
    });
    canvas.addEventListener('pointermove', e => {
      const r = canvas.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (!drag) { const h = hit(sx, sy); if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : 'grab'; } return; }
      drag.moved = Math.max(drag.moved, Math.hypot(sx - drag.sx, sy - drag.sy));
      if (drag.n && drag.n.kind !== 'event') {
        const w = toWorld(sx, sy), p = pos.get(drag.n.key); p.x = w.x; p.y = w.y; p.vx = p.vy = 0; alpha = Math.max(alpha, 0.3);
      } else if (!drag.n || drag.moved > 4) {
        view.panX = drag.panX + sx - drag.sx; view.panY = drag.panY + sy - drag.sy; resize();
      }
    });
    const end = () => {
      if (!drag) return;
      if (drag.n && drag.n.kind !== 'event') pos.get(drag.n.key).pinned = false;
      if (drag.moved < 5) select(drag.n);
      drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.offsetX, e.offsetY);
    }, { passive: false });
  }
  function zoom(f, sx, sy) {
    if (sx === undefined) { sx = W / 2; sy = H / 2; }
    const before = toWorld(sx, sy);
    view.user = Math.min(6, Math.max(0.5, view.user * f));
    resize();
    const after = toWorld(sx, sy);
    view.panX += (after.x - before.x) * view.k; view.panY += (after.y - before.y) * view.k;
    resize();
  }
  function select(n) { selected = n || null; renderDetail(); }

  /* ---------- side panel ---------- */
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function pick(n, text, sub) {
    const li = el('li');
    const b = el('button', 'pick', text); b.type = 'button';
    b.addEventListener('click', () => select(n));
    li.appendChild(b);
    if (sub) li.appendChild(el('small', '', sub));
    return li;
  }
  function list(ul, items, empty) { ul.replaceChildren(); if (!items.length) ul.appendChild(el('li', 'msg', empty)); else items.forEach(i => ul.appendChild(i)); }
  const evLine = ev => `${fmtD(ev.s)} ${ev.allDay ? 'all day' : fmtT(ev.s)}`;

  function renderSide() {
    const people = G.entities.filter(n => n.kind === 'person').length, places = G.entities.filter(n => n.kind === 'place').length;
    $('w-sum').textContent = `${G.events.length} events · ${people} people · ${places} places`;
    $('w-conf').textContent = G.conflicts.length; $('w-conf').classList.toggle('crit', !!G.conflicts.length);
    $('w-tight').textContent = G.tight.length; $('w-tight').classList.toggle('warn', !!G.tight.length);
    const watch = [
      ...G.conflicts.map(l => { const li = pick(l.a, `${l.a.e.title} ↔ ${l.b.e.title}`, `${l.who.join(', ')} · ${evLine(l.b)} · overlap ${l.minutes} min`); li.classList.add('w-conf'); return li; }),
      ...G.tight.map(l => { const li = pick(l.b, `${l.a.e.title} → ${l.b.e.title}`, `${l.who.join(', ')} · ${l.gap} min to get from ${String(l.a.e.location).split(',')[0]} to ${String(l.b.e.location).split(',')[0]}`); li.classList.add('w-tight'); return li; }),
    ];
    list($('w-watch'), watch, 'No overlaps or tight hand-offs this week.');
    const hubs = G.entities.filter(n => n.events.length > 1).sort((a, b) => b.events.length - a.events.length).slice(0, 6)
      .map(n => pick(n, n.label, `${n.events.length} events${n.mail && n.mail.length ? ` · ${n.mail.length} unread` : ''}`));
    list($('w-hubs'), hubs, 'No shared people or places yet.');
    const leg = $('w-legend'); leg.replaceChildren();
    G.calendars.forEach(c => { const li = el('li'); const sw = el('i', 'sw'); sw.style.background = c.color; li.appendChild(sw); li.appendChild(el('span', '', c.name)); leg.appendChild(li); });
    renderDetail();
  }
  function renderDetail() {
    const box = $('w-detail'); box.replaceChildren();
    const n = selected;
    if (!n) { box.appendChild(el('p', 'msg', 'Tap a dot to see what it connects to. Drag people and places to untangle the web.')); return; }
    const h = el('h3', '', n.kind === 'event' ? n.e.title : n.label);
    box.appendChild(h);
    const ul = el('ul');
    if (n.kind === 'event') {
      const sub = el('p', 'msg', `${fmtD(n.s)} · ${n.allDay ? 'all day' : fmtT(n.s) + '–' + fmtT(n.en)} · ${n.cal.name}`);
      box.appendChild(sub);
      if (n.e.location) box.appendChild(el('p', 'msg', n.e.location));
      for (const l of n.links) {
        const o = l.a === n ? l.b : l.a;
        if (l.type === 'conflict') ul.appendChild(Object.assign(pick(o, `Overlaps ${o.e.title}`, `${l.who.join(', ')} · ${l.minutes} min · ${evLine(o)}`), { className: 'w-conf' }));
        else if (l.type === 'tight') ul.appendChild(Object.assign(pick(o, `${l.a === n ? 'Then' : 'After'} ${o.e.title}`, `${l.who.join(', ')} · only ${l.gap} min to change places`), { className: 'w-tight' }));
        else if (l.type === 'next') ul.appendChild(pick(o, `${l.a === n ? 'Next' : 'Before'}: ${o.e.title}`, `${l.gap < 0 ? 'runs at the same time' : l.gap + ' min gap'} · ${evLine(o)}`));
        else ul.appendChild(pick(o, o.label, `${o.kind === 'person' ? 'Person' : 'Place'} · ${o.events.length} event${o.events.length > 1 ? 's' : ''} this week`));
      }
      if (/^https:\/\//.test(n.e.link || '')) { const a = el('a', 'open', 'Open in Google Calendar'); a.href = n.e.link; a.target = '_blank'; a.rel = 'noopener noreferrer'; box.appendChild(a); }
    } else {
      box.appendChild(el('p', 'msg', n.kind === 'person' ? n.email : n.full));
      n.events.forEach(ev => ul.appendChild(pick(ev, ev.e.title, `${evLine(ev)} · ${ev.cal.name}`)));
      (n.mail || []).forEach(t => {
        const li = el('li', 'w-mail');
        li.appendChild(/^https:\/\//.test(t.url || '') ? Object.assign(el('a', '', '✉ ' + t.subject), { href: t.url, target: '_blank', rel: 'noopener noreferrer' }) : el('span', '', '✉ ' + t.subject));
        ul.appendChild(li);
      });
    }
    box.appendChild(ul);
  }

  /* ---------- routing and wiring ---------- */
  function route() {
    const on = location.hash === '#web';
    document.body.classList.toggle('web-mode', on);
    $('v-hud').setAttribute('aria-current', on ? 'false' : 'page');
    $('v-web').setAttribute('aria-current', on ? 'page' : 'false');
    if (on && !running) { running = true; resize(); if (!G) rebuild(); requestAnimationFrame(loop); }
    if (!on) running = false;
  }
  function init() {
    canvas = $('web-canvas'); ctx = canvas.getContext('2d');
    ['bg', 'fg', 'cyan', 'amber', 'red', 'muted', 'mono', 'body', 'person', 'place', 'ring0', 'ring', 'spoke0', 'spoke'].forEach(n => { C[n] = css('--' + n); });
    bindCanvas();
    new ResizeObserver(() => { if (running) resize(); }).observe(canvas.parentElement);
    ['wf-people', 'wf-places', 'wf-seq', 'wf-shared'].forEach(id => $(id).addEventListener('change', rebuild));
    $('w-in').addEventListener('click', () => zoom(1.25));
    $('w-out').addEventListener('click', () => zoom(1 / 1.25));
    $('w-reset').addEventListener('click', () => { view.user = 1; view.panX = view.panY = 0; resize(); alpha = 1; });
    window.addEventListener('jarvis:snapshot', e => { S = e.detail; if (running || G) rebuild(); });
    window.addEventListener('hashchange', route);
    setInterval(() => { if (G) { $('w-sum') && renderSide(); } }, 60000); // past/now states move with the clock
    route();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
