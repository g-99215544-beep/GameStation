const test = require('node:test');
const assert = require('node:assert');
const Store = require('./store.js');

test('advanceProgress adds a station result without mutating the prior state', () => {
  const before = { currentIndex: 0, keys: [], completedStations: {}, totalScore: 10, status: 'idle' };
  const after = Store.advanceProgress(before, { stId: 2, score: 75, onTime: true, timeTakenSec: 42, stationCount: 3, now: 99 });
  assert.deepStrictEqual(before.keys, []);
  assert.deepStrictEqual(after.keys, [2]);
  assert.strictEqual(after.currentIndex, 1);
  assert.strictEqual(after.totalScore, 85);
  assert.strictEqual(after.status, 'idle');
  assert.deepStrictEqual(after.completedStations[2], { score: 75, onTime: true, timeTakenSec: 42, ts: 99 });
});

test('advanceProgress marks the journey ready at the configured station count', () => {
  const result = Store.advanceProgress(
    { currentIndex: 2, keys: [1, 2], completedStations: {}, totalScore: 20, status: 'idle' },
    { stId: 3, score: 80, onTime: true, timeTakenSec: 20, stationCount: 3, now: 1 }
  );
  assert.strictEqual(result.currentIndex, 3);
  assert.strictEqual(result.status, 'ready_chest');
});

test('enqueueWrite keeps only the latest write for each path', () => {
  const first = Store.enqueueWrite([], { path: 'progress/1', data: { currentIndex: 1 }, ts: 1 });
  const second = Store.enqueueWrite(first, { path: 'progress/2', data: { currentIndex: 1 }, ts: 2 });
  const final = Store.enqueueWrite(second, { path: 'progress/1', data: { currentIndex: 2 }, ts: 3 });
  assert.deepStrictEqual(final, [
    { path: 'progress/2', data: { currentIndex: 1 }, ts: 2 },
    { path: 'progress/1', data: { currentIndex: 2 }, ts: 3 }
  ]);
});
