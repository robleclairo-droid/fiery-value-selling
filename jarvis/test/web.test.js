'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildGraph, placeKey } = require('../public/web.js');

// Fixed "now": 8:00 on a local day, events placed relative to it.
const now = new Date(2026, 10, 19, 8, 0).getTime();
const at = (d, h, m = 0) => new Date(2026, 10, 19 + d, h, m).toISOString();
const ev = (id, title, d, h, m, mins, location, people) => ({
  id, title, start: at(d, h, m), end: new Date(new Date(at(d, h, m)).getTime() + mins * 60000).toISOString(),
  allDay: false, location: location || '', attendees: (people || []).map(e => ({ email: e, name: '' })),
});

const S = {
  windowDays: 7,
  accounts: [{ email: 'me@example.com' }],
  calendars: [
    { id: 'me', primary: true, account: 'me@example.com', name: 'me', events: [
      ev('a', 'Client call', 0, 11, 30, 45, '', ['ravi@x.com', 'me@example.com']),
      ev('f', 'Site visit', 0, 12, 0, 30, '', ['ravi@x.com']),
      ev('b', 'Lunch', 0, 13, 0, 60, 'Railway City Brewing, St Thomas', ['dana@x.com']),
      ev('old', 'Yesterday', -1, 9, 0, 60),
      ev('far', 'Next month', 30, 9, 0, 60),
    ] },
    { id: 'clean', name: 'Cleaning Schedule', events: [
      ev('c', 'Office clean', 0, 11, 0, 90, 'Co-operators office', ['maureen@x.com']),
      ev('g', 'Other crew clean', 0, 11, 0, 60, '9 Elm St', ['jac@x.com']),
      ev('d', 'House clean', 0, 12, 45, 120, '13326 Graham Road, Ontario', ['maureen@x.com']),
      ev('e', 'House clean', 2, 14, 30, 120, '13326 Graham Rd', ['maureen@x.com']),
    ] },
  ],
  mail: { threads: [{ subject: 'Quote', fromEmail: 'dana@x.com' }] },
};

test('places with different spellings of the same address match', () => {
  assert.strictEqual(placeKey('13326 Graham Road, Ontario N0L, Canada'), placeKey('13326 Graham Rd'));
  assert.strictEqual(placeKey('Online'), '');
});

test('builds events, people, places and dependencies', () => {
  const g = buildGraph(S, now);
  assert.deepStrictEqual(g.events.map(e => e.e.id), ['c', 'g', 'a', 'f', 'd', 'b', 'e'], 'past and out-of-window events dropped, sorted by start');
  const maureen = g.entities.find(n => n.key === 'p:maureen@x.com');
  assert.strictEqual(maureen.events.length, 3);
  assert.ok(!g.entities.some(n => n.key === 'p:me@example.com'), 'your own account is not a person node');
  const graham = g.entities.find(n => n.kind === 'place' && n.label.startsWith('13326'));
  assert.strictEqual(graham.events.length, 2, 'two Graham Rd cleans share one place node');
  assert.strictEqual(g.entities.find(n => n.key === 'p:dana@x.com').mail.length, 1, 'unread mail attached to sender');

  // Only the call and site visit clash: both are yours and both include Ravi.
  // The two cleans at 11:00 overlap but have different crews, so they are not a clash.
  assert.strictEqual(g.conflicts.length, 1);
  assert.deepStrictEqual([g.conflicts[0].a.e.id, g.conflicts[0].b.e.id], ['a', 'f']);
  assert.strictEqual(g.conflicts[0].minutes, 15);
  assert.deepStrictEqual(g.conflicts[0].who.sort(), ['You', 'ravi']);

  // Maureen finishes at the Co-operators office at 12:30 and starts Graham Rd at 12:45.
  assert.strictEqual(g.tight.length, 1);
  assert.deepStrictEqual([g.tight[0].a.e.id, g.tight[0].b.e.id, g.tight[0].gap, g.tight[0].who], ['c', 'd', 15, ['maureen']]);
});

test('filters', () => {
  const g = buildGraph(S, now, { sharedOnly: true, hideSequence: true });
  assert.ok(g.entities.every(n => n.events.length > 1));
  assert.ok(!g.links.some(l => l.type === 'next'));
  assert.ok(g.links.some(l => l.type === 'conflict'), 'dependencies always shown');
  const np = buildGraph(S, now, { hidePeople: true, hidePlaces: true });
  assert.strictEqual(np.entities.length, 0);
});
