const test = require('node:test');
const assert = require('node:assert');
const H = require('./registry.js');

test('only one different hunt can be active', () => {
  const hunts = { a: { session: { status: 'active' } }, b: { session: { status: 'setup' } } };
  assert.strictEqual(H.canStart(hunts, 'a'), true);
  assert.strictEqual(H.canStart(hunts, 'b'), false);
  assert.strictEqual(H.activeHuntId(hunts), 'a');
});
test('labels map session statuses', () => {
  assert.strictEqual(H.statusLabel({ session: { status: 'setup' } }), 'Belum Mula');
  assert.strictEqual(H.statusLabel({ session: { status: 'active' } }), 'Aktif');
  assert.strictEqual(H.statusLabel({ session: { status: 'ended' } }), 'Tamat');
});
test('hunts are ordered by creation time', () => {
  assert.deepStrictEqual(H.sortedHunts({ b: { createdAt: 2 }, a: { createdAt: 1 } }).map(h => h.id), ['a', 'b']);
});
