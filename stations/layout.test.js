const test = require('node:test');
const assert = require('node:assert');
const S = require('./layout.js');

test('constants', () => {
  assert.strictEqual(S.MIN_STATIONS, 3);
  assert.strictEqual(S.MAX_STATIONS, 6);
});
test('clampStationCount clamps to 3..6 and defaults to 3', () => {
  assert.strictEqual(S.clampStationCount(1), 3);
  assert.strictEqual(S.clampStationCount(2), 3);
  assert.strictEqual(S.clampStationCount(3), 3);
  assert.strictEqual(S.clampStationCount(5), 5);
  assert.strictEqual(S.clampStationCount(6), 6);
  assert.strictEqual(S.clampStationCount(9), 6);
  assert.strictEqual(S.clampStationCount(0), 3);
  assert.strictEqual(S.clampStationCount(undefined), 3);
  assert.strictEqual(S.clampStationCount('x'), 3);
  assert.strictEqual(S.clampStationCount(4.7), 4);
});
test('defaultStartStation wraps by group id', () => {
  assert.strictEqual(S.defaultStartStation(1, 3), 1);
  assert.strictEqual(S.defaultStartStation(2, 3), 2);
  assert.strictEqual(S.defaultStartStation(3, 3), 3);
  assert.strictEqual(S.defaultStartStation(4, 3), 1);
  assert.strictEqual(S.defaultStartStation(7, 6), 1);
});
test('rotationOrder wraps and has length count', () => {
  assert.deepStrictEqual(S.rotationOrder(1, 3), [1, 2, 3]);
  assert.deepStrictEqual(S.rotationOrder(3, 3), [3, 1, 2]);
  assert.deepStrictEqual(S.rotationOrder(2, 3), [2, 3, 1]);
  assert.deepStrictEqual(S.rotationOrder(5, 6), [5, 6, 1, 2, 3, 4]);
});
test('isJourneyDone compares against count', () => {
  assert.strictEqual(S.isJourneyDone(2, 3), false);
  assert.strictEqual(S.isJourneyDone(3, 3), true);
  assert.strictEqual(S.isJourneyDone(6, 6), true);
  assert.strictEqual(S.isJourneyDone(5, 6), false);
});
