# Battleship Coordinate Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new single-player-vs-computer "Battleship" station game where students practice ordered-pair coordinates by firing at a randomly-placed, hidden 5-ship computer fleet on an 11×11 first-quadrant grid.

**Architecture:** A pure `battleship/engine.js` module (UMD, same shape as `crossword/engine.js`) owns fleet generation and shot resolution. All rendering, input handling, and game lifecycle live inline in `index.html`, mirroring the existing `startCrossword`/`renderCrossword`/`checkCrossword`/`finishCrossword` block function-for-function.

**Tech Stack:** Vanilla JS (no framework), UMD module pattern, `node:test` for engine unit tests, Playwright for end-to-end tests. No build step — `index.html` is served as-is.

## Global Constraints

- Grid is `0`–`10` inclusive on both axes (11×11 = 121 cells), first quadrant only, no negative coordinates.
- Fleet is exactly the 5 ships from the reference worksheet: Lookout Cruiser (2), Submarine (3), Battleship (3), Destroyer (4), Pirate ship (5) — 17 ship cells total, placed horizontally or vertically only, never overlapping.
- Student only attacks the computer's fleet — no student fleet, no computer counter-attack.
- A fresh random fleet is generated every time the station starts (mirrors `CrosswordEngine.generatePuzzle()`).
- Unlimited shots; the round ends only when all 5 ships are sunk or the station timer runs out.
- Coordinate entry is via a docked on-screen numpad (`<div>`-based, not `<input>`) with two boxes `( x , y )`, not by tapping the grid directly.
- Scoring: `score = round(shipsSunk / 5 * 100)`, minus a flat 20-point late penalty if time runs out before the fleet is fully sunk (clamped at 0).
- No admin config UI — content is baked-in, exactly like crossword/sudoku/sifir.
- Follow the existing code style in `index.html`: no semicolon-per-line ceremony beyond what's already there, compact one-line function bodies where the surrounding code does the same, Malay UI text.
- Spec of record: `docs/superpowers/specs/2026-07-26-battleship-coordinate-game-design.md`.

---

### Task 1: Battleship engine module

**Files:**
- Create: `battleship/engine.js`
- Create: `battleship/engine.test.js`

**Interfaces:**
- Produces (used by Task 2 in `index.html`):
  - `BattleshipEngine.GRID_SIZE` — `11` (number)
  - `BattleshipEngine.FLEET_SPEC` — `[{name, length}, ...]`, 5 entries
  - `BattleshipEngine.generateFleet(rng)` → `[{name, length, cells:[{x,y},...]}, ...]`, 5 entries, `rng` optional (defaults to `Math.random`)
  - `BattleshipEngine.fireAt(fleet, shotLog, x, y)` → `{shotLog, result, shipName?}` where `result` is `'already-shot'|'miss'|'hit'|'sunk'`, does not mutate `shotLog`
  - `BattleshipEngine.isFleetSunk(fleet, shotLog)` → `boolean`
  - `BattleshipEngine.countSunk(fleet, shotLog)` → `number` (0–5)

- [ ] **Step 1: Write the engine module**

Create `battleship/engine.js`:

```js
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
```

- [ ] **Step 2: Write the failing tests**

Create `battleship/engine.test.js`:

```js
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
```

- [ ] **Step 3: Run the tests**

Run: `node --test battleship/engine.test.js`
Expected: all 6 tests pass (the engine file already exists from Step 1, so this confirms correctness rather than TDD red/green — that's fine here since the module is small and pure).

- [ ] **Step 4: Commit**

```bash
git add battleship/engine.js battleship/engine.test.js
git commit -m "Add Battleship engine: fleet generation and shot resolution"
```

---

### Task 2: Wire Battleship into index.html (CSS, rendering, input, firing, scoring)

**Files:**
- Modify: `index.html` (script include, CSS, `GAME_TYPES`, `renderGame`, `startGame`, `tick`, `show`, new function block)

**Interfaces:**
- Consumes: `BattleshipEngine.{GRID_SIZE, FLEET_SPEC, generateFleet, fireAt, isFleetSunk, countSunk}` from Task 1; existing app globals `gameState`, `timeUp`, `timerInterval`, `window._gameOver`, `window._startedAt`, `window._testMode`, and existing functions `escapeHtml(value)`, `showTestResult(onTime,score,timeTakenSec)`, `submitCompletion(onTime,score,timeTakenSec)`.
- Produces (used by Task 3): global functions `startBattleship(st)`, `renderBattleship()`, `selectBsField(field)`, `bsInput(digit)`, `bsBackspace()`, `fireBattleship()`, `finishBattleship(onTime)`; `gameState.battleship = {station, fleet, shotLog, pendingX, pendingY, activeField}`; DOM ids `#bsBoxX`, `#bsBoxY`, `#bsFireBtn`, `#bsPad`, `#bsMsg`, `#bsFleetList`, `#bs_{x}_{y}` per cell; body class `battleship-mode`.

- [ ] **Step 1: Add the script include**

In `index.html`, find this line (near the other engine script tags):

```html
<script src="crossword/engine.js"></script>
```

Add immediately after it:

```html
<script src="battleship/engine.js"></script>
```

- [ ] **Step 2: Add the CSS**

In `index.html`, find this line (the last crossword `participant-mode` rule):

```css
  .participant-mode .cw-pad{border-radius:5px;background:linear-gradient(135deg,#fff3b4,#e6b954);}
```

Add immediately after it (before the `.participant-mode .finalbox{...}` line that follows):

```css
  .battleship-game{max-width:600px;margin:auto;overflow-anchor:none;}
  .battleship-game > p{color:#666;font-size:14px;margin:4px 0 12px;}
  .bs-board-wrap{width:100%;max-height:min(58vh,480px);overflow:auto;padding:12px;background:#dce9ed;border:3px solid var(--navy);border-radius:8px;touch-action:pan-x pan-y;}
  .bs-board{--bs-cell:34px;display:grid;grid-template-columns:repeat(12,var(--bs-cell));grid-template-rows:repeat(12,var(--bs-cell));gap:2px;width:max-content;padding:5px;background:#0d4268;border-radius:5px;}
  .bs-row-label,.bs-col-label,.bs-corner{display:flex;align-items:center;justify-content:center;font-weight:700;font-size:calc(var(--bs-cell) * .4);color:#fff;}
  .bs-cell{display:flex;align-items:center;justify-content:center;background:#a8d8e8;border:1px solid #6fa8bf;color:#0d4268;font-weight:900;font-size:calc(var(--bs-cell) * .5);user-select:none;}
  .bs-cell.hit{background:#c8493f;color:#fff;border-color:#8f342c;}
  .bs-cell.miss{background:#eef6f9;color:#5b8ea3;border-color:#bcd7e0;}
  .bs-cell.ship-revealed{background:#ffe784;border-color:#8b5427;}
  #bsMsg{min-height:24px;font-weight:700;color:var(--navy);text-align:center;margin:8px 0;}
  .bs-fleet-status{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin:10px 0;}
  .bs-fleet-item{padding:6px 12px;border-radius:20px;background:#fdf3d8;color:#12385b;font-weight:700;font-size:13px;}
  .bs-fleet-item.sunk{background:#dff5e5;color:var(--green);text-decoration:line-through;}
  .bs-coord-row{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin:14px 0;}
  .bs-coord-row span{font-size:24px;font-weight:800;color:var(--navy);}
  .bs-coord-box{min-width:44px;height:44px;padding:0 8px;display:flex;align-items:center;justify-content:center;border:3px solid #8b5427;border-radius:6px;background:#fff9df;color:#17324d;font-weight:900;font-size:20px;cursor:pointer;touch-action:manipulation;}
  .bs-coord-box.active{outline:4px solid #20a9e0;outline-offset:-4px;background:#d7f3ff;}
  .bs-coord-row button.big{width:auto;margin:0;padding:10px 24px;}
  .bs-pad{display:grid;grid-template-columns:repeat(3,minmax(58px,1fr));gap:7px;width:min(100%,330px);margin:14px auto 0;padding:10px;border:3px solid #704018;border-radius:7px;background:#fff0b5;box-shadow:0 -3px 12px #063a6655;}
  .bs-pad[hidden]{display:none;}
  .bs-pad button{min-height:48px;margin:0;padding:6px;font-size:20px;}
  .bs-pad-close{grid-column:1/-1;font-size:15px;}
  @media (max-width:720px){
    body.battleship-mode{overflow:hidden;display:flex;flex-direction:column;height:100vh;height:100dvh;}
    body.battleship-mode .topbar{flex:0 0 auto;}
    body.battleship-mode .wrap{flex:1 1 auto;width:100%;min-height:0;min-width:0;margin:0;padding:8px;}
    body.battleship-mode #view-game.active{height:100%;display:flex;flex-direction:column;min-height:0;}
    body.battleship-mode #gameCard{flex:1 1 0;min-height:0;min-width:0;display:flex;flex-direction:column;padding:12px;}
    body.battleship-mode .battleship-game{display:flex;flex-direction:column;height:100%;width:100%;min-height:0;min-width:0;max-width:none;margin:0;}
    body.battleship-mode .battleship-game h2{margin:0 0 4px;font-size:17px;}
    body.battleship-mode .battleship-game > p{font-size:12px;margin:0;}
    body.battleship-mode .bs-board{--bs-cell:30px;}
    body.battleship-mode .bs-board-wrap{flex:1 1 0;min-height:0;min-width:0;max-height:none;}
    body.battleship-mode #bsMsg{min-height:0;}
    body.battleship-mode .bs-coord-row{margin:8px 0;}
    .bs-pad{grid-template-columns:repeat(4,minmax(48px,1fr));gap:5px;width:100%;max-width:420px;margin:8px auto 0;padding:8px;}
    .bs-pad button{min-height:40px;padding:4px;font-size:18px;}
    .bs-pad-close{min-height:36px;}
  }
  .participant-mode .bs-board-wrap{border-color:#704018;border-radius:5px;background:#8fc7d4;box-shadow:4px 4px 0 #063a66;}
  .participant-mode .bs-board{box-shadow:inset 0 0 0 2px #4ea5cd;}
  .participant-mode .bs-coord-box.active{outline-color:#0e8fc8;background:#d7f3ff;}
  .participant-mode .bs-pad{border-radius:5px;background:linear-gradient(135deg,#fff3b4,#e6b954);}
```

- [ ] **Step 3: Register the game type and dispatch**

In `index.html`, find:

```js
const GAME_TYPES = [
  {id:'lembaran_kerja', name:'Lembaran Kerja'},
  {id:'sudoku', name:'Sudoku Challenge (3 Stage)'},
  {id:'crossword', name:'Crossword Puzzle'},
  {id:'sifir', name:'Sifir Challenge'},
  {id:'tangram', name:'Tangram Challenge'},
  {id:'jejak_lari', name:'Jejak Lari GPS'}
];
```

Replace with:

```js
const GAME_TYPES = [
  {id:'lembaran_kerja', name:'Lembaran Kerja'},
  {id:'sudoku', name:'Sudoku Challenge (3 Stage)'},
  {id:'crossword', name:'Crossword Puzzle'},
  {id:'battleship', name:'Battleship Koordinat'},
  {id:'sifir', name:'Sifir Challenge'},
  {id:'tangram', name:'Tangram Challenge'},
  {id:'jejak_lari', name:'Jejak Lari GPS'}
];
```

In `index.html`, find:

```js
  else if(st.gameType==='crossword'){
    startCrossword(st);
    return;
  }
```

Add immediately after it:

```js
  else if(st.gameType==='battleship'){
    startBattleship(st);
    return;
  }
```

- [ ] **Step 4: Wire the timer lifecycle**

In `index.html`, find:

```js
  window._sudokuTimeout=null;
  window._crosswordTimeout=null;
  window._sifirTimeout=null;
```

Replace with:

```js
  window._sudokuTimeout=null;
  window._crosswordTimeout=null;
  window._battleshipTimeout=null;
  window._sifirTimeout=null;
```

In `index.html`, find:

```js
    if(gameState && gameState.type==='crossword' && window._crosswordTimeout){ window._crosswordTimeout(); }
```

Add immediately after it:

```js
    if(gameState && gameState.type==='battleship' && window._battleshipTimeout){ window._battleshipTimeout(); }
```

- [ ] **Step 5: Clean up the body class on navigation away**

In `index.html`, find:

```js
  if(id!=='view-game' || gameState.type!=='crossword') document.body.classList.remove('crossword-mode');
```

Add immediately after it:

```js
  if(id!=='view-game' || gameState.type!=='battleship') document.body.classList.remove('battleship-mode');
```

- [ ] **Step 6: Add the game function block**

In `index.html`, find the line:

```js
// ---------- RUN TRACKER (jejak_lari): live GPS distance ----------
```

Add immediately **before** it:

```js
// ---------- BATTLESHIP: fire coordinates at a hidden computer fleet ----------
function startBattleship(st){
  const fleet=BattleshipEngine.generateFleet();
  gameState.type='battleship';
  gameState.total=5;
  gameState.correct=0;
  gameState.battleship={station:st,fleet,shotLog:{},pendingX:'',pendingY:'',activeField:'x'};
  window._battleshipTimeout=()=>finishBattleship(false);
  document.body.classList.add('battleship-mode');
  renderBattleship();
}
function renderBsFleetList(){
  const bs=gameState.battleship;
  return bs.fleet.map(ship=>{
    const sunk=ship.cells.every(c=>bs.shotLog[`${c.x},${c.y}`]==='hit');
    return `<div class="bs-fleet-item${sunk?' sunk':''}">${escapeHtml(ship.name)} (${ship.length})</div>`;
  }).join('');
}
function renderBattleship(){
  const bs=gameState.battleship;
  const size=BattleshipEngine.GRID_SIZE;
  let cells='';
  for(let y=size-1;y>=0;y--){
    cells+=`<div class="bs-row-label">${y}</div>`;
    for(let x=0;x<size;x++){
      const key=`${x},${y}`;
      const shot=bs.shotLog[key];
      const cls=shot==='hit'?'hit':(shot==='miss'?'miss':'water');
      const mark=shot==='hit'?'X':(shot==='miss'?'O':'');
      const label=shot?`, ${shot==='hit'?'kena':'tidak kena'}`:'';
      cells+=`<div id="bs_${x}_${y}" class="bs-cell ${cls}" aria-label="Petak (${x}, ${y})${label}">${mark}</div>`;
    }
  }
  cells+='<div class="bs-corner" aria-hidden="true"></div>';
  for(let x=0;x<size;x++){
    cells+=`<div class="bs-col-label">${x}</div>`;
  }
  document.getElementById('gameCard').innerHTML=`<div class="battleship-game">
    <h2>${escapeHtml(bs.station.name)}</h2>
    <p>Tembak armada tersembunyi komputer. Masukkan koordinat (x, y) lalu tekan Tembak.</p>
    <div class="bs-board-wrap">
      <div class="bs-board">${cells}</div>
    </div>
    <div id="bsMsg" aria-live="polite"></div>
    <div id="bsFleetList" class="bs-fleet-status">${renderBsFleetList()}</div>
    <div class="bs-coord-row">
      <span>(</span>
      <div id="bsBoxX" class="bs-coord-box" role="button" tabindex="0" aria-label="Koordinat x" onclick="selectBsField('x')"></div>
      <span>,</span>
      <div id="bsBoxY" class="bs-coord-box" role="button" tabindex="0" aria-label="Koordinat y" onclick="selectBsField('y')"></div>
      <span>)</span>
      <button id="bsFireBtn" class="big" type="button" onclick="fireBattleship()" disabled>Tembak</button>
    </div>
    <div id="bsPad" class="bs-pad" hidden>
      ${[1,2,3,4,5,6,7,8,9].map(digit=>`<button type="button" onclick="bsInput(${digit})">${digit}</button>`).join('')}
      <button type="button" onclick="bsBackspace()" aria-label="Padam">&#9003;</button>
      <button type="button" onclick="bsInput(0)">0</button>
      <button class="bs-pad-close" type="button" onclick="hideBsPad()">Selesai</button>
    </div>
  </div>`;
}
function selectBsField(field){
  const bs=gameState.battleship;
  if(!bs || window._gameOver) return;
  bs.activeField=field;
  const boxX=document.getElementById('bsBoxX'), boxY=document.getElementById('bsBoxY');
  if(boxX) boxX.classList.toggle('active', field==='x');
  if(boxY) boxY.classList.toggle('active', field==='y');
  const pad=document.getElementById('bsPad');
  if(pad) pad.hidden=false;
}
function updateBsFireEnabled(){
  const bs=gameState.battleship;
  const btn=document.getElementById('bsFireBtn');
  if(btn && bs) btn.disabled=!(bs.pendingX!=='' && bs.pendingY!=='');
}
function bsInput(digit){
  const bs=gameState.battleship;
  if(!bs || !Number.isInteger(digit) || digit<0 || digit>9) return;
  const key=bs.activeField==='x'?'pendingX':'pendingY';
  const current=bs[key];
  bs[key]=(current==='1' && digit===0)?'10':String(digit);
  const box=document.getElementById(bs.activeField==='x'?'bsBoxX':'bsBoxY');
  if(box) box.textContent=bs[key];
  updateBsFireEnabled();
}
function bsBackspace(){
  const bs=gameState.battleship;
  if(!bs) return;
  const key=bs.activeField==='x'?'pendingX':'pendingY';
  bs[key]=bs[key].slice(0,-1);
  const box=document.getElementById(bs.activeField==='x'?'bsBoxX':'bsBoxY');
  if(box) box.textContent=bs[key];
  updateBsFireEnabled();
}
function hideBsPad(){
  const pad=document.getElementById('bsPad');
  if(pad) pad.hidden=true;
}
function revealBsFleet(){
  const bs=gameState.battleship;
  bs.fleet.forEach(ship=>ship.cells.forEach(c=>{
    if(bs.shotLog[`${c.x},${c.y}`]!=='hit'){
      const cell=document.getElementById(`bs_${c.x}_${c.y}`);
      if(cell) cell.classList.add('ship-revealed');
    }
  }));
}
function fireBattleship(){
  const bs=gameState.battleship;
  if(!bs || window._gameOver) return;
  if(bs.pendingX==='' || bs.pendingY==='') return;
  const x=Number(bs.pendingX), y=Number(bs.pendingY);
  const {shotLog,result,shipName}=BattleshipEngine.fireAt(bs.fleet,bs.shotLog,x,y);
  bs.shotLog=shotLog;
  gameState.correct=BattleshipEngine.countSunk(bs.fleet,bs.shotLog);

  const msg=document.getElementById('bsMsg');
  if(result==='already-shot'){
    if(msg) msg.textContent='Sudah ditembak di sini.';
  } else {
    const cell=document.getElementById(`bs_${x}_${y}`);
    if(cell){
      cell.classList.remove('water');
      cell.classList.add(result==='miss'?'miss':'hit');
      cell.textContent=result==='miss'?'O':'X';
      cell.setAttribute('aria-label',`Petak (${x}, ${y}), ${result==='miss'?'tidak kena':'kena'}`);
    }
    if(result==='sunk'){
      if(msg) msg.textContent=`Kapal ${shipName} tenggelam!`;
      const list=document.getElementById('bsFleetList');
      if(list) list.innerHTML=renderBsFleetList();
    } else if(result==='hit'){
      if(msg) msg.textContent='Kena!';
    } else {
      if(msg) msg.textContent='Tidak kena.';
    }
  }

  bs.pendingX=''; bs.pendingY='';
  const boxX=document.getElementById('bsBoxX'); if(boxX) boxX.textContent='';
  const boxY=document.getElementById('bsBoxY'); if(boxY) boxY.textContent='';
  updateBsFireEnabled();
  hideBsPad();

  if(BattleshipEngine.isFleetSunk(bs.fleet,bs.shotLog)){
    finishBattleship(!timeUp);
  }
}
function finishBattleship(onTime){
  if(window._gameOver) return;
  window._gameOver=true;
  window._battleshipTimeout=null;
  clearInterval(timerInterval);
  const bs=gameState.battleship;
  const sunk=BattleshipEngine.countSunk(bs.fleet,bs.shotLog);
  gameState.correct=sunk;
  revealBsFleet();
  const timeTakenSec=Math.round((Date.now()-window._startedAt)/1000);
  let score=Math.round((sunk/5)*100);
  if(!onTime) score=Math.max(0,score-20);
  if(window._testMode){ showTestResult(onTime,score,timeTakenSec); return; }
  submitCompletion(onTime,score,timeTakenSec);
}
```

- [ ] **Step 7: Manual smoke check**

This task has no automated test of its own — Task 3 formalizes verification. Do a quick throwaway check now so Task 3 isn't debugging a broken UI:

```bash
cat > tests/_debug_battleship.spec.js << 'EOF'
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

test('debug battleship smoke check', async ({ page }) => {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(() => {
    const snapshot = { val: () => null };
    window.firebase = {
      apps: [], initializeApp() { this.apps.push({}); },
      database() { return { ref() { return { once: () => Promise.resolve(snapshot), on: () => {}, off: () => {}, set: () => Promise.resolve(), update: () => Promise.resolve() }; } }; }
    };
  });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    window._testMode = true;
    startGame('bs-test', { id: 'bs-test', name: 'Battleship Koordinat', gameType: 'battleship', gameDataRaw: '{}', timeLimitMin: 10 });
  });
  await expect(page.locator('.bs-fleet-item')).toHaveCount(5);
  await page.locator('#bsBoxX').click();
  await page.locator('#bsPad button').filter({ hasText: /^3$/ }).click();
  await page.locator('#bsBoxY').click();
  await page.locator('#bsPad button').filter({ hasText: /^4$/ }).click();
  await page.getByRole('button', { name: 'Tembak' }).click();
  const marked = await page.locator('#bs_3_4').textContent();
  console.log('cell (3,4) after firing:', JSON.stringify(marked));
  expect(['X', 'O']).toContain(marked);
});
EOF
npx playwright test tests/_debug_battleship.spec.js --reporter=list
rm tests/_debug_battleship.spec.js
```

Expected: test passes, console shows `cell (3,4) after firing: "X"` or `"O"`.

- [ ] **Step 8: Commit**

```bash
git add index.html
git commit -m "Add Battleship coordinate game to index.html"
```

---

### Task 3: Playwright end-to-end tests

**Files:**
- Create: `tests/battleship.spec.js`

**Interfaces:**
- Consumes: `startGame`, `gameState.battleship`, `BattleshipEngine`, `finishBattleship`, `window._battleshipTimeout` from Task 2; DOM ids `#bsBoxX`, `#bsBoxY`, `#bsPad`, `#bsFleetList .bs-fleet-item`, `#bsMsg`, `#bs_{x}_{y}`.

- [ ] **Step 1: Write the spec**

Create `tests/battleship.spec.js`:

```js
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function openBattleship(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(() => {
    const snapshot = { val: () => null };
    window.firebase = {
      apps: [],
      initializeApp() { this.apps.push({}); },
      database() {
        return {
          ref() {
            return {
              once: () => Promise.resolve(snapshot),
              on: () => {},
              off: () => {},
              set: () => Promise.resolve(),
              update: () => Promise.resolve()
            };
          }
        };
      }
    };
  });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    window._testMode = true;
    startGame('battleship-test', {
      id: 'battleship-test',
      name: 'Battleship Koordinat',
      gameType: 'battleship',
      gameDataRaw: '{}',
      timeLimitMin: 10
    });
  });
}

async function fireAt(page, x, y) {
  await page.locator('#bsBoxX').click();
  for (const digit of String(x)) {
    await page.locator('#bsPad button').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  }
  await page.locator('#bsBoxY').click();
  for (const digit of String(y)) {
    await page.locator('#bsPad button').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  }
  await page.getByRole('button', { name: 'Tembak' }).click();
}

test('battleship supports coordinate entry, hit/miss feedback, sinking, and a full win', async ({ page }) => {
  await openBattleship(page);

  await expect(page.locator('.bs-fleet-item')).toHaveCount(5);
  await expect(page.locator('#bsPad')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Tembak' })).toBeDisabled();

  const fleet = await page.evaluate(() => gameState.battleship.fleet);

  const firstCell = fleet[0].cells[0];
  await fireAt(page, firstCell.x, firstCell.y);
  await expect(page.locator(`#bs_${firstCell.x}_${firstCell.y}`)).toHaveClass(/hit/);
  await expect(page.locator('#bsMsg')).not.toHaveText('');

  const occupied = new Set();
  fleet.forEach(ship => ship.cells.forEach(c => occupied.add(`${c.x},${c.y}`)));
  let missCell = null;
  for (let y = 0; y < 11 && !missCell; y++) {
    for (let x = 0; x < 11 && !missCell; x++) {
      if (!occupied.has(`${x},${y}`)) missCell = { x, y };
    }
  }
  await fireAt(page, missCell.x, missCell.y);
  await expect(page.locator(`#bs_${missCell.x}_${missCell.y}`)).toHaveClass(/miss/);

  await page.evaluate(() => {
    const bs = gameState.battleship;
    bs.fleet.forEach(ship => {
      ship.cells.forEach(c => {
        const key = `${c.x},${c.y}`;
        if (!(key in bs.shotLog)) {
          const res = BattleshipEngine.fireAt(bs.fleet, bs.shotLog, c.x, c.y);
          bs.shotLog = res.shotLog;
        }
      });
    });
    gameState.correct = BattleshipEngine.countSunk(bs.fleet, bs.shotLog);
    if (BattleshipEngine.isFleetSunk(bs.fleet, bs.shotLog)) finishBattleship(true);
  });

  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
  await expect(page.locator('#resultCard')).toContainText('Markah: 100');
});

test('battleship timeout keeps partial credit and applies the late penalty', async ({ page }) => {
  await openBattleship(page);
  await page.evaluate(() => {
    const bs = gameState.battleship;
    bs.fleet.slice(0, 2).forEach(ship => {
      ship.cells.forEach(c => {
        const res = BattleshipEngine.fireAt(bs.fleet, bs.shotLog, c.x, c.y);
        bs.shotLog = res.shotLog;
      });
    });
    gameState.correct = BattleshipEngine.countSunk(bs.fleet, bs.shotLog);
    timeUp = true;
    window._battleshipTimeout();
  });
  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
  await expect(page.locator('#resultCard')).toContainText('Masa tamat');
  // 2 of 5 sunk -> round(2/5*100)=40, minus the 20-point late penalty.
  await expect(page.locator('#resultCard')).toContainText('Markah: 20');
});

test('battleship board, fleet panel, and coordinate pad stay visible on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBattleship(page);
  await page.locator('#bsBoxX').click();

  const pad = page.locator('#bsPad');
  await expect(pad).toBeVisible();

  const layout = await page.evaluate(() => {
    const padRect = document.getElementById('bsPad').getBoundingClientRect();
    const headingRect = document.querySelector('.battleship-game h2').getBoundingClientRect();
    return {
      padBottom: padRect.bottom,
      headingTop: headingRect.top,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight
    };
  });
  expect(layout.padBottom).toBeLessThanOrEqual(layout.innerHeight);
  expect(layout.headingTop).toBeGreaterThanOrEqual(0);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight + 1);
});
```

- [ ] **Step 2: Run the tests**

Run: `npx playwright test tests/battleship.spec.js --reporter=list`
Expected: all 3 tests pass.

If the layout test fails with `padBottom`/`scrollHeight` overflow, re-check Task 2 Step 2's CSS was inserted inside the `@media (max-width:720px)` block correctly (compare against the equivalent `crossword-mode` block a few lines above it).

- [ ] **Step 3: Commit**

```bash
git add tests/battleship.spec.js
git commit -m "Add Playwright end-to-end tests for Battleship"
```

---

### Task 4: Service worker cache

**Files:**
- Modify: `sw.js`

**Interfaces:**
- None (standalone config change).

- [ ] **Step 1: Add the new engine to the precache list and bump the cache name**

In `sw.js`, find:

```js
const CACHE_NAME = 'gs-shell-v5';
const LOCAL_ASSETS = [
  './', 'index.html',
  'tangram/engine.js', 'tangram/shapes.js', 'tangram/ui.js',
  'run/tracker.js', 'groups/roster.js', 'stations/layout.js',
  'sifir/engine.js', 'crossword/engine.js', 'offline/store.js',
```

Replace with:

```js
const CACHE_NAME = 'gs-shell-v6';
const LOCAL_ASSETS = [
  './', 'index.html',
  'tangram/engine.js', 'tangram/shapes.js', 'tangram/ui.js',
  'run/tracker.js', 'groups/roster.js', 'stations/layout.js',
  'sifir/engine.js', 'crossword/engine.js', 'battleship/engine.js', 'offline/store.js',
```

- [ ] **Step 2: Commit**

```bash
git add sw.js
git commit -m "Precache battleship/engine.js and bump the service worker cache version"
```

---

### Task 5: Full regression pass

**Files:**
- None (verification only).

**Interfaces:**
- None.

- [ ] **Step 1: Run every engine unit test suite**

Run: `node --test battleship/engine.test.js crossword/engine.test.js sifir/engine.test.js`
Expected: all pass, 0 failures.

- [ ] **Step 2: Run the full Playwright suite**

Run: `npx playwright test --reporter=list`
Expected: all pass **except** `tests/station-count.spec.js:83 — saving fewer stations regenerates group orders and preserves roster`, which is a pre-existing, unrelated failure already present on `main` before this feature (confirmed during the earlier crossword-mobile-numpad work). Any *other* failure means something in this feature broke a different game — investigate before proceeding.

- [ ] **Step 3: Manual admin smoke test**

Open `index.html` in a browser, log in as admin (PIN `1234`), add a station with game type "Battleship Koordinat", click "▶️ Uji Cara Main Stesen Ini", and confirm:
- The board renders with x-axis labels `0`–`10` along the bottom and y-axis labels `0`–`10` bottom-to-top along the left.
- Tapping the `x` box shows the numpad; typing a digit fills the box; tapping the `y` box switches the active field.
- "Tembak" is disabled until both boxes have a value.
- Firing shows a hit (`X`, red) or miss (`O`, grey) on the correct cell, and a "Kena!"/"Tidak kena." message.
- Sinking a ship crosses it off the fleet list and shows a "Kapal … tenggelam!" message.
- Firing an already-shot cell shows "Sudah ditembak di sini." without changing the board.
- Sinking all 5 ships ends the round and shows the score.
- Resize the browser to a phone width (or use dev tools device emulation) and confirm the board, fleet list, coordinate boxes, and numpad all stay on-screen with no page scroll.

- [ ] **Step 4: Final commit (if the smoke test surfaced fixes)**

```bash
git add -A
git commit -m "Fix issues found during Battleship manual verification"
```

(Skip this step if the smoke test found nothing to fix.)
