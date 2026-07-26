(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.BattleshipEngine = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const GRID_SIZE = 11; // coordinates 0-10 inclusive on each axis

  const FLEET_SPEC = [
    { name: 'Lookout Cruiser', length: 2 },
    { name: 'Submarine', length: 3 },
    { name: 'Battleship', length: 3 },
    { name: 'Destroyer', length: 4 },
    { name: 'Pirate ship', length: 5 }
  ];

  // Known-good layout used only if generateFleet's random placement can't
  // find room within the retry budget (should never happen at this
  // grid size/fleet density — 17 cells in 121 — but keeps the game
  // unbreakable in class).
  const FALLBACK_LAYOUT = [
    { name: 'Lookout Cruiser', length: 2, cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }] },
    { name: 'Submarine', length: 3, cells: [{ x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }] },
    { name: 'Battleship', length: 3, cells: [{ x: 3, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }] },
    { name: 'Destroyer', length: 4, cells: [{ x: 7, y: 0 }, { x: 7, y: 1 }, { x: 7, y: 2 }, { x: 7, y: 3 }] },
    { name: 'Pirate ship', length: 5, cells: [{ x: 0, y: 6 }, { x: 1, y: 6 }, { x: 2, y: 6 }, { x: 3, y: 6 }, { x: 4, y: 6 }] }
  ];

  function cellsFor(x, y, length, horizontal) {
    const cells = [];
    for (let i = 0; i < length; i++) {
      cells.push(horizontal ? { x: x + i, y } : { x, y: y + i });
    }
    return cells;
  }

  function inBounds(cells) {
    return cells.every(c => c.x >= 0 && c.x < GRID_SIZE && c.y >= 0 && c.y < GRID_SIZE);
  }

  function overlaps(cells, occupied) {
    return cells.some(c => occupied.has(`${c.x},${c.y}`));
  }

  function generateFleet(rng) {
    const random = rng || Math.random;
    const MAX_LAYOUT_ATTEMPTS = 1000;
    const MAX_SHIP_ATTEMPTS = 200;
    for (let attempt = 0; attempt < MAX_LAYOUT_ATTEMPTS; attempt++) {
      const occupied = new Set();
      const fleet = [];
      let ok = true;
      for (const spec of FLEET_SPEC) {
        let placed = null;
        for (let tries = 0; tries < MAX_SHIP_ATTEMPTS && !placed; tries++) {
          const horizontal = random() < 0.5;
          const maxStart = GRID_SIZE - spec.length;
          const x = horizontal ? Math.floor(random() * (maxStart + 1)) : Math.floor(random() * GRID_SIZE);
          const y = horizontal ? Math.floor(random() * GRID_SIZE) : Math.floor(random() * (maxStart + 1));
          const cells = cellsFor(x, y, spec.length, horizontal);
          if (inBounds(cells) && !overlaps(cells, occupied)) placed = cells;
        }
        if (!placed) { ok = false; break; }
        placed.forEach(c => occupied.add(`${c.x},${c.y}`));
        fleet.push({ name: spec.name, length: spec.length, cells: placed });
      }
      if (ok) return fleet;
    }
    return FALLBACK_LAYOUT.map(ship => ({ name: ship.name, length: ship.length, cells: ship.cells.slice() }));
  }

  function fireAt(fleet, shotLog, x, y) {
    const key = `${x},${y}`;
    if (Object.prototype.hasOwnProperty.call(shotLog, key)) {
      return { shotLog, result: 'already-shot' };
    }
    const ship = fleet.find(s => s.cells.some(c => c.x === x && c.y === y));
    const nextLog = Object.assign({}, shotLog, { [key]: ship ? 'hit' : 'miss' });
    if (!ship) return { shotLog: nextLog, result: 'miss' };
    const sunk = ship.cells.every(c => nextLog[`${c.x},${c.y}`] === 'hit');
    return sunk
      ? { shotLog: nextLog, result: 'sunk', shipName: ship.name }
      : { shotLog: nextLog, result: 'hit' };
  }

  function isFleetSunk(fleet, shotLog) {
    return fleet.every(ship => ship.cells.every(c => shotLog[`${c.x},${c.y}`] === 'hit'));
  }

  function countSunk(fleet, shotLog) {
    return fleet.filter(ship => ship.cells.every(c => shotLog[`${c.x},${c.y}`] === 'hit')).length;
  }

  return { GRID_SIZE, FLEET_SPEC, generateFleet, fireAt, isFleetSunk, countSunk };
});
