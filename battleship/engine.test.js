const test = require('node:test');
const assert = require('node:assert');
const E = require('./engine.js');

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('generateFleet places all 5 ships with correct lengths, in bounds, no overlaps', () => {
  for (let seed = 1; seed <= 500; seed++) {
    const fleet = E.generateFleet(seeded(seed));
    assert.strictEqual(fleet.length, E.FLEET_SPEC.length);
    const occupied = new Set();
    fleet.forEach((ship, i) => {
      assert.strictEqual(ship.name, E.FLEET_SPEC[i].name);
      assert.strictEqual(ship.length, E.FLEET_SPEC[i].length);
      assert.strictEqual(ship.cells.length, ship.length);
      const sameRow = ship.cells.every(c => c.y === ship.cells[0].y);
      const sameCol = ship.cells.every(c => c.x === ship.cells[0].x);
      assert.ok(sameRow || sameCol, `ship ${ship.name} is neither a straight row nor column`);
      ship.cells.forEach(c => {
        assert.ok(c.x >= 0 && c.x < E.GRID_SIZE, `x out of bounds: ${c.x}`);
        assert.ok(c.y >= 0 && c.y < E.GRID_SIZE, `y out of bounds: ${c.y}`);
        const key = `${c.x},${c.y}`;
        assert.ok(!occupied.has(key), `overlap at ${key}`);
        occupied.add(key);
      });
    });
    assert.strictEqual(occupied.size, 17); // 2+3+3+4+5
  }
});

test('generateFleet with different seeds produces different layouts', () => {
  const a = E.generateFleet(seeded(1)).map(s => s.cells);
  const b = E.generateFleet(seeded(2)).map(s => s.cells);
  assert.notDeepStrictEqual(a, b);
});

test('fireAt reports miss on empty water and does not mutate the input shotLog', () => {
  const fleet = [{ name: 'Test', length: 2, cells: [{ x: 5, y: 5 }, { x: 6, y: 5 }] }];
  const shotLog = {};
  const { shotLog: nextLog, result } = E.fireAt(fleet, shotLog, 0, 0);
  assert.strictEqual(result, 'miss');
  assert.strictEqual(nextLog['0,0'], 'miss');
  assert.deepStrictEqual(shotLog, {});
});

test('fireAt reports hit, then sunk on the last cell of a ship', () => {
  const fleet = [{ name: 'Test', length: 2, cells: [{ x: 5, y: 5 }, { x: 6, y: 5 }] }];
  let log = {};
  let res = E.fireAt(fleet, log, 5, 5);
  assert.strictEqual(res.result, 'hit');
  log = res.shotLog;
  res = E.fireAt(fleet, log, 6, 5);
  assert.strictEqual(res.result, 'sunk');
  assert.strictEqual(res.shipName, 'Test');
});

test('fireAt reports already-shot on a repeated coordinate', () => {
  const fleet = [{ name: 'Test', length: 1, cells: [{ x: 0, y: 0 }] }];
  let log = {};
  log = E.fireAt(fleet, log, 3, 3).shotLog;
  const res = E.fireAt(fleet, log, 3, 3);
  assert.strictEqual(res.result, 'already-shot');
});

test('isFleetSunk and countSunk track partial and full completion', () => {
  const fleet = [
    { name: 'A', length: 1, cells: [{ x: 0, y: 0 }] },
    { name: 'B', length: 2, cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }] }
  ];
  let log = {};
  assert.strictEqual(E.countSunk(fleet, log), 0);
  assert.strictEqual(E.isFleetSunk(fleet, log), false);
  log = E.fireAt(fleet, log, 0, 0).shotLog;
  assert.strictEqual(E.countSunk(fleet, log), 1);
  assert.strictEqual(E.isFleetSunk(fleet, log), false);
  log = E.fireAt(fleet, log, 1, 0).shotLog;
  log = E.fireAt(fleet, log, 2, 0).shotLog;
  assert.strictEqual(E.countSunk(fleet, log), 2);
  assert.strictEqual(E.isFleetSunk(fleet, log), true);
});

test('isShipSunk is true only when every cell of that ship is hit', () => {
  const ship = { name: 'B', length: 2, cells: [{ x: 1, y: 0 }, { x: 2, y: 0 }] };
  let log = { '1,0': 'hit' };
  assert.strictEqual(E.isShipSunk(ship, log), false);
  log = { '1,0': 'hit', '2,0': 'hit' };
  assert.strictEqual(E.isShipSunk(ship, log), true);
});
