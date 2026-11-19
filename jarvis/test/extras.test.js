'use strict';
// Claude chat, weather and drive times, each against a local stand-in for the outside service.
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');
const { buildGraph } = require('../public/web.js');

function fakeWorld() {
  const seen = { claude: [], headers: [], nominatim: [], osrm: [] };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const json = o => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/v1/messages') {
      let body = ''; req.on('data', c => { body += c; });
      return req.on('end', () => {
        seen.claude.push(JSON.parse(body)); seen.headers.push(req.headers);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
        ev('message_start', { message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, usage: { input_tokens: 10, output_tokens: 0 } } });
        ev('content_block_start', { index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
        ev('content_block_delta', { index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } });
        ev('content_block_stop', { index: 0 });
        ev('content_block_start', { index: 1, content_block: { type: 'text', text: '' } });
        ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'Your next clean ' } });
        ev('content_block_delta', { index: 1, delta: { type: 'text_delta', text: 'is at **9:30**.' } });
        ev('content_block_stop', { index: 1 });
        ev('message_delta', { delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } });
        ev('message_stop', {});
        res.end();
      });
    }
    if (u.pathname === '/geo') return json({ results: [{ name: 'Springfield', admin1: 'Illinois', country: 'United States', latitude: 39.8, longitude: -89.6 }, { name: 'Springfield', admin1: 'Ontario', country: 'Canada', latitude: 42.83, longitude: -80.93 }] });
    if (u.pathname === '/wx') return json({ current: { temperature_2m: 3.6, apparent_temperature: 0.2, weather_code: 71, wind_speed_10m: 12.2 },
      daily: { time: ['2026-11-19', '2026-11-20'], weather_code: [71, 3], temperature_2m_max: [4.4, 6], temperature_2m_min: [-2.2, 0], precipitation_probability_max: [80, 10], snowfall_sum: [2.1, 0] } });
    if (u.pathname === '/nominatim') {
      seen.nominatim.push(u.searchParams.get('q'));
      const q = u.searchParams.get('q');
      return json(/^420 Talbot/.test(q) ? [] : [{ lat: String(42.8 + seen.nominatim.length / 100), lon: '-80.9' }]);
    }
    if (u.pathname.startsWith('/osrm/table/')) {
      const n = u.pathname.split('/').pop().split(';').length; seen.osrm.push(n);
      return json({ code: 'Ok', durations: Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 0 : 1500))) }); // 25 min everywhere
    }
    res.writeHead(404); res.end();
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

async function setup(extra) {
  const w = await fakeWorld();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-x-'));
  const app = createApp({ PORT: '0', DATA_DIR: dir, QUIET: '1', DEMO: '1', BASE_URL: 'http://localhost:1',
    ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: w.url, OPENMETEO_GEO_URL: w.url + '/geo', OPENMETEO_URL: w.url + '/wx',
    NOMINATIM_URL: w.url + '/nominatim', OSRM_URL: w.url + '/osrm', GEOCODE_PAUSE_MS: '1', ...extra });
  const port = await app.listen();
  await app.refresh();
  return { w, app, base: `http://127.0.0.1:${port}`, async close() { await app.close(); w.server.close(); } };
}
async function say(base, id, text) {
  const r = await fetch(base + '/api/chat', { method: 'POST', headers: { 'x-jarvis': '1', 'content-type': 'application/json' }, body: JSON.stringify({ id, text }) });
  const raw = await r.text();
  return [...raw.matchAll(/event: (\w+)\ndata: (.*)\n/g)].map(m => [m[1], JSON.parse(m[2])]);
}

test('Claude chat streams, keeps the conversation, and sends your data once', async () => {
  const t = await setup();
  try {
    const ev = await say(t.base, 'c1', 'When is my next clean?');
    assert.deepStrictEqual(ev.filter(e => e[0] === 'delta').map(e => e[1].text).join(''), 'Your next clean is at **9:30**.');
    assert.strictEqual(ev.at(-1)[0], 'done');
    const first = t.w.seen.claude[0];
    assert.strictEqual(first.model, 'claude-opus-5-5');
    assert.deepStrictEqual(first.thinking, { type: 'adaptive' });
    assert.deepStrictEqual(first.output_config, { effort: 'low' });
    assert.strictEqual(first.fallbacks, 'default');
    assert.match(t.w.seen.headers[0]['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.strictEqual(first.stream, true);
    assert.match(first.messages[0].content, /<jarvis_data>[\s\S]*House clean, Fifth Ave[\s\S]*<\/jarvis_data>\n\nWhen is my next clean\?$/);

    await say(t.base, 'c1', 'And after that?');
    const second = t.w.seen.claude[1];
    assert.strictEqual(second.messages.length, 3);
    assert.strictEqual(second.messages[0].content, first.messages[0].content, 'history is append-only');
    assert.deepStrictEqual(second.messages[1].content.map(b => b.type), ['thinking', 'text'], "Claude's reply goes back unchanged, thinking block included");
    assert.strictEqual(second.messages[1].content[0].signature, 'sig-abc');
    assert.strictEqual(second.messages[2].content, 'And after that?', 'unchanged data is not sent twice');

    await say(t.base, 'c2', 'Hello');
    assert.strictEqual(t.w.seen.claude[2].messages.length, 1, 'a new chat starts clean');
  } finally { await t.close(); }
});

test('weather and drive times', async () => {
  const t = await setup({ JARVIS_CITY: 'Springfield, Ontario', JARVIS_DRIVE_TIMES: '1' });
  try {
    const s = t.app.getState();
    assert.strictEqual(s.weather.place, 'Springfield, Ontario', 'picks the city in the right province');
    assert.deepStrictEqual(s.weather.current, { temp: 4, feels: 0, code: 71, wind: 12 });
    assert.strictEqual(s.weather.days[0].snow, 2.1);
    assert.ok(t.w.seen.nominatim.length >= 5, 'each address looked up');
    assert.ok(!s.travel.places.some(p => /^420 Talbot/.test(p)), 'an address that cannot be found is left out');
    assert.strictEqual(s.travel.minutes[0][1], 25);
    const before = t.w.seen.nominatim.length;
    await t.app.refresh();
    assert.strictEqual(t.w.seen.nominatim.length, before, 'addresses are only looked up once');
    assert.strictEqual(t.w.seen.osrm.length, 1, 'routes are only fetched when the places change');

    // Every drive is 25 minutes, so a 30-minute gap (under 25 + 10 buffer) is tight and a 60-minute gap is not.
    const g = buildGraph(s, Date.now());
    assert.ok(g.tight.length >= 2);
    assert.ok(g.tight.every(l => l.drive === 25 && l.gap < 35), JSON.stringify(g.tight.map(l => [l.a.e.title, l.b.e.title, l.gap, l.drive])));
  } finally { await t.close(); }
});

test('drive times are off unless switched on', async () => {
  const t = await setup({ JARVIS_CITY: 'Springfield, Ontario' });
  try {
    assert.ok(t.app.getState().weather);
    assert.strictEqual(t.app.getState().travel, null);
    assert.strictEqual(t.w.seen.nominatim.length, 0, 'no addresses leave the computer');
  } finally { await t.close(); }
});
