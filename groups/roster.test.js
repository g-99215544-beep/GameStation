const test = require('node:test');
const assert = require('node:assert');
const G = require('./roster.js');

test('normalizeNames trims, collapses spaces, drops blanks', () => {
  assert.deepStrictEqual(
    G.normalizeNames('  Ali \n\n Siti  Binti  \n\t\n Abu\n'),
    ['Ali', 'Siti Binti', 'Abu']);
});

test('distributeNames fills sequentially, exact fit', () => {
  const r = G.distributeNames(['a','b','c','d'], 2, 2);
  assert.deepStrictEqual(r.groups, [['a','b'], ['c','d']]);
  assert.deepStrictEqual(r.overflow, []);
});
test('distributeNames underflow leaves short/empty groups', () => {
  const r = G.distributeNames(['a','b','c'], 3, 2);
  assert.deepStrictEqual(r.groups, [['a','b'], ['c'], []]);
  assert.deepStrictEqual(r.overflow, []);
});
test('distributeNames overflow lists the surplus', () => {
  const r = G.distributeNames(['a','b','c','d','e'], 2, 2);
  assert.deepStrictEqual(r.groups, [['a','b'], ['c','d']]);
  assert.deepStrictEqual(r.overflow, ['e']);
});
test('distributeNames with zero names makes empty groups', () => {
  const r = G.distributeNames([], 3, 5);
  assert.deepStrictEqual(r.groups, [[], [], []]);
});

test('moveMember relocates across groups without mutating input', () => {
  const src = [['a','b'], ['c']];
  const out = G.moveMember(src, 0, 0, 1);
  assert.deepStrictEqual(out, [['b'], ['c','a']]);
  assert.deepStrictEqual(src, [['a','b'], ['c']]); // unchanged
});
test('moveMember same group is a no-op copy', () => {
  const out = G.moveMember([['a','b']], 0, 0, 0);
  assert.deepStrictEqual(out, [['a','b']]);
});

test('addMember appends trimmed name, ignores blank', () => {
  assert.deepStrictEqual(G.addMember([['a']], 0, '  Bob '), [['a','Bob']]);
  assert.deepStrictEqual(G.addMember([['a']], 0, '   '), [['a']]);
});
test('removeMember drops the entry', () => {
  assert.deepStrictEqual(G.removeMember([['a','b','c']], 0, 1), [['a','c']]);
});
test('addGroup appends an empty group', () => {
  assert.deepStrictEqual(G.addGroup([['a']]), [['a'], []]);
});
test('removeGroup removes group and members', () => {
  assert.deepStrictEqual(G.removeGroup([['a'], ['b'], ['c']], 1), [['a'], ['c']]);
});
