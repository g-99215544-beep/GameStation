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

test('generateFleet places both ships with correct lengths, in bounds, no overlaps', () => {
  assert.strictEqual(E.GRID_SIZE, 9);
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
    assert.strictEqual(occupied.size, 5); // 2+3
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

test('shipCells lays cells out horizontally and vertically', () => {
  assert.deepStrictEqual(E.shipCells(2, 5, 3, 'h'), [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }]);
  assert.deepStrictEqual(E.shipCells(2, 5, 3, 'v'), [{ x: 2, y: 5 }, { x: 2, y: 6 }, { x: 2, y: 7 }]);
  assert.deepStrictEqual(E.shipCells(0, 0, 1, 'h'), [{ x: 0, y: 0 }]);
});

test('canPlace accepts valid positions and rejects off-grid or overlapping ones', () => {
  assert.strictEqual(E.canPlace([], 0, 0, 5, 'h'), true);
  assert.strictEqual(E.canPlace([], 4, 0, 5, 'h'), true);   // ends exactly at x=8
  assert.strictEqual(E.canPlace([], 5, 0, 5, 'h'), false);  // runs off the right edge
  assert.strictEqual(E.canPlace([], 0, 5, 5, 'v'), false);  // runs off the top edge
  assert.strictEqual(E.canPlace([], 6, 0, 5, 'v'), true);
  const occupied = [{ x: 3, y: 3 }, { x: 4, y: 3 }];
  assert.strictEqual(E.canPlace(occupied, 2, 3, 3, 'h'), false); // crosses (3,3)
  assert.strictEqual(E.canPlace(occupied, 2, 4, 3, 'h'), true);  // clear row above
});

test('nextComputerShot never repeats a cell and returns null once the grid is full', () => {
  let shotLog = {};
  const seen = new Set();
  for (let i = 0; i < E.GRID_SIZE * E.GRID_SIZE; i++) {
    const shot = E.nextComputerShot(shotLog, seeded(i + 1));
    assert.ok(shot, `ran out of cells early at shot ${i}`);
    const key = `${shot.x},${shot.y}`;
    assert.ok(!seen.has(key), `repeated cell ${key}`);
    seen.add(key);
    shotLog = Object.assign({}, shotLog, { [key]: 'miss' });
  }
  assert.strictEqual(E.nextComputerShot(shotLog, seeded(1)), null);
});

// Leaving exactly one cell open forces the random pick, so the "only ever
// returns an un-fired cell" contract is checked without depending on the RNG.
test('nextComputerShot only ever picks a cell absent from the shot log', () => {
  const shotLog = {};
  for (let x = 0; x < E.GRID_SIZE; x++) {
    for (let y = 0; y < E.GRID_SIZE; y++) {
      if (!(x === 3 && y === 4)) shotLog[`${x},${y}`] = 'miss';
    }
  }
  assert.deepStrictEqual(E.nextComputerShot(shotLog, seeded(9)), { x: 3, y: 4 });
});
