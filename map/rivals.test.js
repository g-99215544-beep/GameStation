const test = require('node:test');
const assert = require('node:assert');
const R = require('./rivals.js');

const STOPS = { 0:{x:50,y:89}, 1:{x:57,y:78}, 2:{x:34,y:66}, 3:{x:59,y:55}, 4:{x:36,y:46}, 5:{x:62,y:36}, 6:{x:50,y:27} };
const groups = ids => Object.fromEntries(ids.map(id => [String(id), { id, name: 'Kumpulan ' + id }]));

test('MAX_RIVALS is three and there are three berths', () => {
  assert.strictEqual(R.MAX_RIVALS, 3);
  assert.strictEqual(R.BERTHS.length, 3);
});

// A round-1 tuning pass widened these far enough to guarantee a tappable
// area, and in doing so moored ships closer to a NEIGHBOURING island than
// their own — a pupil could no longer trust the map to say where anyone
// actually was. This locks the truthfulness guarantee the human chose over
// tappability: every berth must stay a small nudge from its own mooring, not
// a leap toward someone else's.
test('every berth stays within the small-nudge envelope, and none is the pupil\'s own mooring', () => {
  R.BERTHS.forEach(berth => {
    assert.ok(Math.abs(berth.dx) <= R.BERTH_ENVELOPE.maxDx,
      `berth dx ${berth.dx} exceeds the ${R.BERTH_ENVELOPE.maxDx}-point envelope`);
    assert.ok(Math.abs(berth.dy) <= R.BERTH_ENVELOPE.maxDy,
      `berth dy ${berth.dy} exceeds the ${R.BERTH_ENVELOPE.maxDy}-point envelope`);
    assert.ok(!(berth.dx === 0 && berth.dy === 0), 'a berth sits exactly on the pupil\'s own mooring');
  });
});

test('positionOf reads currentIndex and clamps to the island count', () => {
  assert.strictEqual(R.positionOf({ currentIndex: 2 }, 6), 2);
  assert.strictEqual(R.positionOf({ currentIndex: 0 }, 6), 0);
  assert.strictEqual(R.positionOf({ currentIndex: 9 }, 6), 6);
  assert.strictEqual(R.positionOf({ currentIndex: -3 }, 6), 0);
  assert.strictEqual(R.positionOf({}, 6), 0);
  assert.strictEqual(R.positionOf(null, 6), 0);
  assert.strictEqual(R.positionOf({ currentIndex: 'x' }, 6), 0);
});

test('positionOf docks a group that opened its chest at the last island', () => {
  assert.strictEqual(R.positionOf({ currentIndex: 1, status: 'won' }, 6), 6);
});

test('rank orders by island, then score, then group id', () => {
  const all = {
    1: { currentIndex: 1, totalScore: 500 },
    2: { currentIndex: 3, totalScore: 100 },
    3: { currentIndex: 1, totalScore: 900 },
    4: { currentIndex: 1, totalScore: 900 }
  };
  const order = R.rank(all, groups([1, 2, 3, 4]), 6).map(e => e.gid);
  assert.deepStrictEqual(order, ['2', '3', '4', '1']);
});

test('rank keeps a group with no progress entry at the start line', () => {
  const ranked = R.rank({ 1: { currentIndex: 2 } }, groups([1, 2]), 6);
  const idle = ranked.find(e => e.gid === '2');
  assert.strictEqual(idle.position, 0);
  assert.strictEqual(idle.score, 0);
  assert.strictEqual(idle.finished, false);
  assert.strictEqual(idle.name, 'Kumpulan 2');
});

test('rank falls back to a generated name when the group config has none', () => {
  const ranked = R.rank({}, { 7: { id: 7 } }, 6);
  assert.strictEqual(ranked[0].name, 'Kumpulan 7');
});

test('rank breaks ties by group id numerically, not as strings', () => {
  const all = { 2: { currentIndex: 3 }, 10: { currentIndex: 3 }, 9: { currentIndex: 3 } };
  const order = R.rank(all, groups([2, 9, 10]), 6).map(e => e.gid);
  assert.deepStrictEqual(order, ['2', '9', '10']);
});

test('selectNearest takes two ahead and one behind', () => {
  const ranked = R.rank({
    1: { currentIndex: 5 }, 2: { currentIndex: 4 }, 3: { currentIndex: 3 },
    4: { currentIndex: 2 }, 5: { currentIndex: 1 }
  }, groups([1, 2, 3, 4, 5]), 6);
  assert.deepStrictEqual(R.selectNearest(ranked, '3').map(e => e.gid), ['2', '1', '4']);
});

test('selectNearest backfills from behind when the pupil leads', () => {
  const ranked = R.rank({
    1: { currentIndex: 5 }, 2: { currentIndex: 4 }, 3: { currentIndex: 3 }, 4: { currentIndex: 2 }
  }, groups([1, 2, 3, 4]), 6);
  assert.deepStrictEqual(R.selectNearest(ranked, '1').map(e => e.gid), ['2', '3', '4']);
});

test('selectNearest backfills from ahead when the pupil is last', () => {
  const ranked = R.rank({
    1: { currentIndex: 5 }, 2: { currentIndex: 4 }, 3: { currentIndex: 3 }, 4: { currentIndex: 2 }
  }, groups([1, 2, 3, 4]), 6);
  assert.deepStrictEqual(R.selectNearest(ranked, '4').map(e => e.gid), ['3', '2', '1']);
});

test('selectNearest returns fewer than three in a small hunt', () => {
  const ranked = R.rank({ 1: { currentIndex: 2 }, 2: { currentIndex: 1 } }, groups([1, 2]), 6);
  assert.deepStrictEqual(R.selectNearest(ranked, '1').map(e => e.gid), ['2']);
});

test('selectNearest returns the leaders when the pupil is not in the standings', () => {
  const ranked = R.rank({
    1: { currentIndex: 5 }, 2: { currentIndex: 4 }, 3: { currentIndex: 3 }, 4: { currentIndex: 2 }
  }, groups([1, 2, 3, 4]), 6);
  assert.deepStrictEqual(R.selectNearest(ranked, '99').map(e => e.gid), ['1', '2', '3']);
});

test('layout gives rivals sharing an island three distinct berths', () => {
  const ranked = R.rank({
    1: { currentIndex: 3 }, 2: { currentIndex: 3 }, 3: { currentIndex: 3 }
  }, groups([1, 2, 3]), 6);
  const placed = R.layout(ranked, STOPS);
  assert.deepStrictEqual(placed.map(e => e.slot), [0, 1, 2]);
  assert.strictEqual(new Set(placed.map(e => `${e.x},${e.y}`)).size, 3);
});

test('layout never puts a rival on the exact mooring the pupil occupies', () => {
  const ranked = R.rank({ 1: { currentIndex: 3 } }, groups([1]), 6);
  const [placed] = R.layout(ranked, STOPS);
  assert.ok(placed.x !== STOPS[3].x || placed.y !== STOPS[3].y);
});

test('layout restarts berth numbering on each island', () => {
  const ranked = R.rank({
    1: { currentIndex: 3 }, 2: { currentIndex: 3 }, 3: { currentIndex: 1 }
  }, groups([1, 2, 3]), 6);
  const placed = R.layout(ranked, STOPS);
  assert.strictEqual(placed.find(e => e.gid === '3').slot, 0);
});

test('layout is stable regardless of the order it receives rivals', () => {
  const ranked = R.rank({
    1: { currentIndex: 3 }, 2: { currentIndex: 3 }
  }, groups([1, 2]), 6);
  const forward = R.layout(ranked, STOPS);
  const backward = R.layout(ranked.slice().reverse(), STOPS);
  const slotOf = (list, gid) => list.find(e => e.gid === gid).slot;
  assert.strictEqual(slotOf(forward, '1'), slotOf(backward, '1'));
  assert.strictEqual(slotOf(forward, '2'), slotOf(backward, '2'));
});

test('pointAt applies the same berth offset at any island', () => {
  const here = R.pointAt(3, 1, STOPS);
  assert.strictEqual(here.x, STOPS[3].x + R.BERTHS[1].dx);
  assert.strictEqual(here.y, STOPS[3].y + R.BERTHS[1].dy);
});

test('pointAt falls back to the start line for an unknown island', () => {
  const point = R.pointAt(99, 0, STOPS);
  assert.strictEqual(point.x, STOPS[0].x + R.BERTHS[0].dx);
});

test('positions maps group id to island', () => {
  const ranked = R.rank({ 1: { currentIndex: 3 }, 2: { currentIndex: 1 } }, groups([1, 2]), 6);
  assert.deepStrictEqual(R.positions(ranked), { 1: 3, 2: 1 });
});

test('diff reports only groups whose island changed', () => {
  const ranked = R.rank({ 1: { currentIndex: 3 }, 2: { currentIndex: 1 } }, groups([1, 2]), 6);
  assert.deepStrictEqual(R.diff({ 1: 2, 2: 1 }, ranked), [{ gid: '1', from: 2, to: 3 }]);
});

test('diff ignores a rival that was not on screen before', () => {
  const ranked = R.rank({ 1: { currentIndex: 3 } }, groups([1]), 6);
  assert.deepStrictEqual(R.diff({}, ranked), []);
  assert.deepStrictEqual(R.diff(null, ranked), []);
});
