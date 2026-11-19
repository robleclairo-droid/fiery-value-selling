'use strict';
// Runs the real server against a fake Google API. No network access or credentials needed.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

const inHours = h => new Date(Date.now() + h * 36e5).toISOString();
const CLEAN = 'clean123@group.calendar.google.com';

function fakeGoogle() {
  const hits = [];
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push(u.pathname);
    const send = (o, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/token') {
      let body = ''; req.on('data', c => { body += c; });
      return req.on('end', () => {
        const p = new URLSearchParams(body);
        if (p.get('grant_type') === 'authorization_code') return send({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 });
        if (p.get('refresh_token') === 'rt-revoked') return send({ error: 'invalid_grant' }, 400);
        return send({ access_token: 'at-' + p.get('refresh_token'), expires_in: 3600 });
      });
    }
    if (req.headers.authorization === undefined) return send({ error: 'no auth' }, 401);
    if (u.pathname === '/userinfo') return send({ email: 'Second@Example.com' });
    if (u.pathname === '/cal/users/me/calendarList') return send({ items: [
      { id: 'me@example.com', summary: 'me@example.com', primary: true },
      { id: CLEAN, summary: 'Cleaning Schedule', backgroundColor: '#33c48d' },
      { id: 'hol', summary: 'Holidays in Canada' },
      { id: 'hidden', summary: 'Hidden one', selected: false },
    ] });
    if (u.pathname === `/cal/calendars/${encodeURIComponent('me@example.com')}/events`) return send({ items: [
      { id: 'e1', iCalUID: 'u1', summary: 'Volleyball', start: { dateTime: inHours(2) }, end: { dateTime: inHours(3) }, organizer: { email: 'me@example.com' } },
      { id: 'e2', iCalUID: 'u2', summary: 'Invite copy of a clean', start: { dateTime: inHours(5) }, end: { dateTime: inHours(6) }, organizer: { email: CLEAN } },
      { id: 'e3', iCalUID: 'u3', summary: 'Cancelled', status: 'cancelled', start: { dateTime: inHours(7) }, end: { dateTime: inHours(8) } },
    ] });
    if (u.pathname === `/cal/calendars/${encodeURIComponent(CLEAN)}/events`) return send({ items: [
      { id: 'c1', iCalUID: 'u2', summary: 'House clean', location: '137 Fifth Ave', start: { dateTime: inHours(5) }, end: { dateTime: inHours(6) }, organizer: { email: CLEAN } },
    ] });
    if (u.pathname.startsWith('/cal/')) return send({ items: [] });
    if (u.pathname === '/gmail/users/me/labels/INBOX') return send({ threadsUnread: 4 });
    if (u.pathname === '/gmail/users/me/threads') return send({ threads: [{ id: 't1' }] });
    if (u.pathname === '/gmail/users/me/threads/t1') return send({ messages: [
      { internalDate: '1700000000000', payload: { headers: [{ name: 'From', value: 'Old <old@x.com>' }, { name: 'Subject', value: 'Old' }] } },
      { internalDate: '1800000000000', payload: { headers: [{ name: 'From', value: '"Dana Smith" <dana@x.com>' }, { name: 'Subject', value: 'Quote for Friday' }] } },
    ] });
    if (u.pathname === '/drive/files') return send({ files: [{ id: 'f1', name: 'Pipeline', mimeType: 'application/vnd.google-apps.spreadsheet', modifiedTime: '2026-11-15T21:43:13Z', webViewLink: 'https://docs.google.com/x' }] });
    send({ error: 'not found' }, 404);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, hits, url: `http://127.0.0.1:${server.address().port}` })));
}

async function setup(accounts) {
  const g = await fakeGoogle();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-'));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ accounts, tasks: [] }));
  const app = createApp({
    PORT: '0', DATA_DIR: dir, QUIET: '1', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec',
    BASE_URL: 'http://localhost:1', GOOGLE_TOKEN_URL: g.url + '/token', GOOGLE_USERINFO_URL: g.url + '/userinfo',
    GOOGLE_CAL_URL: g.url + '/cal', GOOGLE_GMAIL_URL: g.url + '/gmail', GOOGLE_DRIVE_URL: g.url + '/drive',
    GOOGLE_AUTH_URL: g.url + '/auth',
  });
  const port = await app.listen();
  await app.refresh();
  const base = `http://127.0.0.1:${port}`;
  return { g, app, dir, base, async close() { await app.close(); g.server.close(); } };
}

test('merges calendars, mail and files from Google', async () => {
  const t = await setup({ 'me@example.com': { refresh_token: 'rt1' } });
  try {
    const s = t.app.getState();
    assert.deepStrictEqual(s.calendars.map(c => c.name), ['me@example.com', 'Cleaning Schedule'], 'holiday and unselected calendars hidden, primary first');
    const primary = s.calendars[0], clean = s.calendars[1];
    assert.strictEqual(primary.label, 'example.com', 'main calendar named after its domain');
    assert.strictEqual(clean.label, 'Cleaning Schedule');
    assert.strictEqual(clean.color, '#33c48d', 'Google Calendar colour passed through');
    assert.strictEqual(primary.color, '', 'no colour from Google: the page picks one');
    assert.deepStrictEqual(primary.events.map(e => e.title), ['Volleyball'], 'invite copy of a clean and cancelled event dropped');
    assert.deepStrictEqual(clean.events.map(e => e.title), ['House clean']);
    assert.strictEqual(clean.events[0].location, '137 Fifth Ave');
    assert.strictEqual(s.mail.unread, 4);
    assert.strictEqual(s.mail.threads[0].from, 'Dana Smith');
    assert.strictEqual(s.mail.threads[0].subject, 'Quote for Friday', 'uses newest message in thread');
    assert.strictEqual(s.files[0].name, 'Pipeline');
    assert.deepStrictEqual(s.accounts, [{ email: 'me@example.com', errors: {} }]);
  } finally { await t.close(); }
});

test('revoked account is reported, not fatal', async () => {
  const t = await setup({ 'me@example.com': { refresh_token: 'rt1' }, 'gone@example.com': { refresh_token: 'rt-revoked' } });
  try {
    const s = t.app.getState();
    const gone = s.accounts.find(a => a.email === 'gone@example.com');
    assert.strictEqual(gone.errors.calendar, 'Reconnect this account');
    assert.strictEqual(s.calendars.length, 2, 'healthy account still loads');
  } finally { await t.close(); }
});

test('OAuth flow adds an account', async () => {
  const t = await setup({});
  try {
    const start = await fetch(t.base + '/auth/google', { redirect: 'manual' });
    assert.strictEqual(start.status, 302);
    const loc = new URL(start.headers.get('location'));
    assert.match(loc.searchParams.get('scope'), /calendar\.readonly/);
    assert.strictEqual(loc.searchParams.get('access_type'), 'offline');
    const bad = await fetch(t.base + '/auth/callback?code=x&state=wrong', { redirect: 'manual' });
    assert.strictEqual(bad.status, 400, 'rejects unknown state');
    const cb = await fetch(`${t.base}/auth/callback?code=abc&state=${loc.searchParams.get('state')}`, { redirect: 'manual' });
    assert.strictEqual(cb.status, 302);
    const store = JSON.parse(fs.readFileSync(path.join(t.dir, 'store.json'), 'utf8'));
    assert.deepStrictEqual(Object.keys(store.accounts), ['second@example.com']);
    assert.strictEqual(store.accounts['second@example.com'].refresh_token, 'rt-new');
  } finally { await t.close(); }
});

test('tasks persist and stream; POST needs the x-jarvis header; foreign Host is refused', async () => {
  const t = await setup({});
  try {
    const noHeader = await fetch(t.base + '/api/tasks', { method: 'POST', body: '{"text":"x"}' });
    assert.strictEqual(noHeader.status, 403);
    const evil = await new Promise(r => http.get(t.base + '/api/state', { headers: { host: 'evil.example' } }, res => { res.resume(); r(res.statusCode); }));
    assert.strictEqual(evil, 421);

    const ctrl = new AbortController();
    const stream = await fetch(t.base + '/api/stream', { signal: ctrl.signal });
    const reader = stream.body.getReader();
    let buf = '';
    const waitFor = async needle => { while (!buf.includes(needle)) { const { value } = await reader.read(); buf += Buffer.from(value).toString(); } };
    await waitFor('event: snapshot');

    const r = await fetch(t.base + '/api/tasks', { method: 'POST', headers: { 'x-jarvis': '1', 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Call Dana back' }) });
    assert.strictEqual(r.status, 200);
    await waitFor('Call Dana back');
    ctrl.abort();
    const store = JSON.parse(fs.readFileSync(path.join(t.dir, 'store.json'), 'utf8'));
    assert.strictEqual(store.tasks[0].text, 'Call Dana back');

    const ask = await (await fetch(t.base + '/api/ask', { method: 'POST', headers: { 'x-jarvis': '1' }, body: JSON.stringify({ q: 'tasks' }) })).json();
    assert.match(ask.text, /Call Dana back/);
  } finally { await t.close(); }
});
