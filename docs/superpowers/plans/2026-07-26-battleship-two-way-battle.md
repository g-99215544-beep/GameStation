# Battleship Two-Way Battle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the one-way Battleship station into a full two-way battle: the student places their own fleet, the computer fires back at random, losing your fleet restarts the round, and every shot is animated with SVG (missile arc, hit burst, sea splash).

**Architecture:** Pure logic stays in `battleship/engine.js` (testable under `node --test`); rendering, input, turn sequencing, and animation live inline in `index.html` beside the sibling games. The turn loop becomes async so animations can be awaited in sequence.

**Tech Stack:** Vanilla JS (no framework, no build step), UMD module pattern, inline SVG + Web Animations API for animation, `node:test` for engine unit tests, Playwright for end-to-end tests.

## Global Constraints

- Grid is `0`–`10` inclusive on both axes (11×11 = 121 cells), first quadrant only.
- Fleet is exactly the 5 ships in `FLEET_SPEC`: Lookout Cruiser (2), Submarine (3), Battleship (3), Destroyer (4), Pirate ship (5) — 17 cells.
- Ships are placed horizontally or vertically only, never overlapping, never off-grid — for both the student's fleet and the computer's.
- Placement is by coordinate entry on the existing numpad (`<div>`-based, never `<input>`) plus a Melintang/Menegak toggle — never by tapping the grid.
- Strict alternating turns: one student shot, then one computer shot.
- Computer AI is **purely random**: it picks uniformly among cells it has not fired at yet. No targeting, no follow-up after a hit, no pattern, no memory between turns.
- Losing (all 5 student ships sunk) resets the round — new computer fleet, both boards cleared, **student's ship layout preserved**, same station timer, no score deduction.
- Scoring is unchanged in shape: `round(enemyShipsSunk / 5 * 100)`, `-20` if the timer expires first, clamped at 0.
- ~0.8 s of animation per shot (≈0.5 s missile flight, ≈0.3 s impact). Animation is skipped entirely when `prefers-reduced-motion: reduce` matches.
- Input is locked (`bs.busy`) for the whole turn so a double-tap cannot desync turn order.
- No admin config UI — content stays baked-in like the sibling games.
- The existing `battleship-mode` full-height mobile flex layout must keep working: no page-level scroll on a phone, board absorbs leftover space.
- Follow existing code style in `index.html`: compact one-line function bodies, plain DOM APIs, Malay UI text.
- Spec of record: `docs/superpowers/specs/2026-07-26-battleship-two-way-battle-design.md`.

---

### Task 1: Engine additions — placement helpers and random computer AI

**Files:**
- Modify: `battleship/engine.js`
- Modify: `battleship/engine.test.js`

**Interfaces:**
- Consumes: existing `GRID_SIZE`, `FLEET_SPEC`, `cellsFor`, `inBounds`, `overlaps` (module-internal).
- Produces (used by Tasks 2–4):
  - `BattleshipEngine.shipCells(x, y, length, orientation)` → `[{x,y}, ...]`; `orientation` is `'h'` or `'v'`
  - `BattleshipEngine.canPlace(occupiedCells, x, y, length, orientation)` → `boolean`; `occupiedCells` is a flat array of `{x,y}`
  - `BattleshipEngine.nextComputerShot(shotLog, rng)` → `{x, y}`, or `null` when every cell has been fired at. Stateless: no memory between turns, never inspects a fleet.

- [ ] **Step 1: Write the failing tests**

Append to `battleship/engine.test.js`:

```js
test('shipCells lays cells out horizontally and vertically', () => {
  assert.deepStrictEqual(E.shipCells(2, 5, 3, 'h'), [{ x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 }]);
  assert.deepStrictEqual(E.shipCells(2, 5, 3, 'v'), [{ x: 2, y: 5 }, { x: 2, y: 6 }, { x: 2, y: 7 }]);
  assert.deepStrictEqual(E.shipCells(0, 0, 1, 'h'), [{ x: 0, y: 0 }]);
});

test('canPlace accepts valid positions and rejects off-grid or overlapping ones', () => {
  assert.strictEqual(E.canPlace([], 0, 0, 5, 'h'), true);
  assert.strictEqual(E.canPlace([], 6, 0, 5, 'h'), true);   // ends exactly at x=10
  assert.strictEqual(E.canPlace([], 7, 0, 5, 'h'), false);  // runs off the right edge
  assert.strictEqual(E.canPlace([], 0, 7, 5, 'v'), false);  // runs off the top edge
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test battleship/engine.test.js`
Expected: FAIL — `E.shipCells is not a function` (and the other new exports likewise).

- [ ] **Step 3: Implement the engine additions**

In `battleship/engine.js`, find this line:

```js
  function isShipSunk(ship, shotLog) {
```

Insert immediately **before** it:

```js
  function shipCells(x, y, length, orientation) {
    return cellsFor(x, y, length, orientation === 'h');
  }

  function canPlace(occupiedCells, x, y, length, orientation) {
    const cells = shipCells(x, y, length, orientation);
    if (!inBounds(cells)) return false;
    const occupied = new Set(occupiedCells.map(c => `${c.x},${c.y}`));
    return !overlaps(cells, occupied);
  }

  // The computer's whole AI: pick uniformly among cells it has not fired at
  // yet. Deliberately has no targeting and no memory between turns — it never
  // chases a hit, so a student is never punished for being unlucky early.
  function nextComputerShot(shotLog, rng) {
    const random = rng || Math.random;
    const open = [];
    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        if (!Object.prototype.hasOwnProperty.call(shotLog, `${x},${y}`)) open.push({ x, y });
      }
    }
    if (!open.length) return null;
    return open[Math.floor(random() * open.length)];
  }
```

Then change the export line at the end of the file from:

```js
  return { GRID_SIZE, FLEET_SPEC, generateFleet, fireAt, isFleetSunk, countSunk, isShipSunk };
```

to:

```js
  return {
    GRID_SIZE, FLEET_SPEC, generateFleet, fireAt, isFleetSunk, countSunk, isShipSunk,
    shipCells, canPlace, nextComputerShot
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test battleship/engine.test.js`
Expected: PASS — all tests (the 7 pre-existing plus the 4 new ones).

- [ ] **Step 5: Commit**

```bash
git add battleship/engine.js battleship/engine.test.js
git commit -m "Add Battleship placement helpers and random computer AI"
```

---

### Task 2: Placement phase and two-fleet state model

**Files:**
- Modify: `index.html` (CSS block at ~line 344–386, battleship JS block at ~line 2835–2988)
- Modify: `tests/battleship.spec.js`

**Interfaces:**
- Consumes: `BattleshipEngine.{GRID_SIZE, FLEET_SPEC, generateFleet, fireAt, isFleetSunk, countSunk, isShipSunk, shipCells, canPlace}` from Task 1; existing globals `gameState`, `timeUp`, `timerInterval`, `window._gameOver`, `window._startedAt`, `window._testMode`, `escapeHtml`, `showTestResult`, `submitCompletion`.
- Produces (used by Tasks 3–4):
  - `gameState.battleship` = `{station, phase, playerFleet, placingIndex, orientation, enemyFleet, playerShotLog, enemyShotLog, pendingX, pendingY, activeField, busy, round}`
  - Functions: `startBattleship(st)`, `renderBattleship()`, `renderBsBoard(fleet, shotLog, opts)`, `renderBsFleetList()`, `setBsMsg(text)`, `clearBsCoords()`, `applyBsCell(prefix, x, y, result)`, `setBsOrientation(o)`, `placeBsShip()`, `resetBsPlacement()`, `selectBsField(field)`, `updateBsActionEnabled()`, `bsInput(digit)`, `bsBackspace()`, `hideBsPad()`, `fireBattleship()`, `finishBattleship(onTime)`
  - DOM ids: `#bsMsg`, `#bsFleetList`, `#bsBoxX`, `#bsBoxY`, `#bsActionBtn`, `#bsPad`, `#bsOrientH`, `#bsOrientV`, `#bsPlacePrompt`; enemy cells `#bs_{x}_{y}`, player cells `#bsp_{x}_{y}`

**Note on the rename:** `bs.fleet` → `bs.enemyFleet` and `bs.shotLog` → `bs.playerShotLog` throughout. The existing Playwright tests reference the old names and the old no-placement startup, so this task updates them in the same commit — otherwise the suite breaks.

- [ ] **Step 1: Replace the CSS block**

In `index.html`, find the line:

```css
  .battleship-game{max-width:600px;margin:auto;overflow-anchor:none;}
```

Replace everything from that line through this line (inclusive):

```css
  .participant-mode .bs-pad{border-radius:5px;background:linear-gradient(135deg,#fff3b4,#e6b954);}
```

with:

```css
  .battleship-game{max-width:600px;margin:auto;overflow-anchor:none;}
  .battleship-game > p{color:#666;font-size:14px;margin:4px 0 12px;}
  .bs-board-wrap{position:relative;width:100%;max-height:min(58vh,480px);overflow:auto;padding:12px;background:#dce9ed;border:3px solid var(--navy);border-radius:8px;touch-action:pan-x pan-y;}
  .bs-board{--bs-cell:34px;display:grid;grid-template-columns:repeat(12,var(--bs-cell));gap:2px;width:max-content;padding:5px;background:#0d4268;border-radius:5px;}
  .bs-board.plain{grid-template-columns:repeat(11,var(--bs-cell));}
  .bs-board.mini{--bs-cell:13px;gap:1px;}
  .bs-row-label,.bs-col-label,.bs-corner{display:flex;align-items:center;justify-content:center;height:var(--bs-cell);font-weight:700;font-size:calc(var(--bs-cell) * .4);color:#fff;}
  .bs-cell{display:flex;align-items:center;justify-content:center;height:var(--bs-cell);background:#a8d8e8;border:1px solid #6fa8bf;color:#0d4268;font-weight:900;font-size:calc(var(--bs-cell) * .5);user-select:none;}
  .bs-cell.ship{background:#5c6b7a;border-color:#3d4854;}
  .bs-cell.hit{background:#c8493f;color:#fff;border-color:#8f342c;}
  .bs-cell.miss{background:#eef6f9;color:#5b8ea3;border-color:#bcd7e0;}
  .bs-mini-head{display:flex;align-items:center;justify-content:center;gap:8px;margin:8px 0 4px;font-weight:700;font-size:13px;color:var(--navy);}
  .bs-mini-wrap{position:relative;display:flex;justify-content:center;padding:6px;background:#dce9ed;border:2px solid var(--navy);border-radius:6px;}
  #bsMsg{min-height:24px;font-weight:700;color:var(--navy);text-align:center;margin:8px 0;}
  .bs-fleet-status{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:8px 0;}
  .bs-fleet-item{padding:5px 10px;border-radius:20px;background:#fdf3d8;color:#12385b;font-weight:700;font-size:12px;}
  .bs-fleet-item.sunk{background:#dff5e5;color:var(--green);text-decoration:line-through;}
  .bs-place-prompt{text-align:center;font-weight:800;color:var(--navy);margin:8px 0;}
  .bs-orient{display:flex;gap:8px;justify-content:center;margin:8px 0;}
  .bs-orient button{margin:0;padding:8px 16px;font-size:14px;background:#e6e8ed;color:var(--navy);}
  .bs-orient button.active{background:var(--navy);color:var(--gold);}
  .bs-coord-row{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;margin:12px 0;}
  .bs-coord-row span{font-size:24px;font-weight:800;color:var(--navy);}
  .bs-coord-box{min-width:44px;height:44px;padding:0 8px;display:flex;align-items:center;justify-content:center;border:3px solid #8b5427;border-radius:6px;background:#fff9df;color:#17324d;font-weight:900;font-size:20px;cursor:pointer;touch-action:manipulation;}
  .bs-coord-box.active{outline:4px solid #20a9e0;outline-offset:-4px;background:#d7f3ff;}
  .bs-coord-row button.big{width:auto;margin:0;padding:10px 24px;}
  .bs-pad{display:grid;grid-template-columns:repeat(3,minmax(58px,1fr));gap:7px;width:min(100%,330px);margin:12px auto 0;padding:10px;border:3px solid #704018;border-radius:7px;background:#fff0b5;box-shadow:0 -3px 12px #063a6655;}
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
    body.battleship-mode .bs-board{--bs-cell:28px;}
    body.battleship-mode .bs-board.mini{--bs-cell:12px;}
    body.battleship-mode .bs-board-wrap{flex:1 1 0;min-height:0;min-width:0;max-height:none;}
    body.battleship-mode #bsMsg{min-height:0;margin:4px 0;}
    body.battleship-mode .bs-fleet-status{margin:4px 0;}
    body.battleship-mode .bs-mini-head{margin:4px 0 2px;}
    body.battleship-mode .bs-coord-row{margin:8px 0;}
    .bs-pad{grid-template-columns:repeat(4,minmax(48px,1fr));gap:5px;width:100%;max-width:420px;margin:8px auto 0;padding:8px;}
    .bs-pad button{min-height:40px;padding:4px;font-size:18px;}
    .bs-pad-close{min-height:36px;}
  }
  .participant-mode .bs-board-wrap,.participant-mode .bs-mini-wrap{border-color:#704018;border-radius:5px;background:#8fc7d4;box-shadow:4px 4px 0 #063a66;}
  .participant-mode .bs-board{box-shadow:inset 0 0 0 2px #4ea5cd;}
  .participant-mode .bs-coord-box.active{outline-color:#0e8fc8;background:#d7f3ff;}
  .participant-mode .bs-pad{border-radius:5px;background:linear-gradient(135deg,#fff3b4,#e6b954);}
```

Note the deliberate changes: `.bs-board-wrap` gains `position:relative` (the SVG overlay in Task 4 anchors to it), `.bs-board` drops the fixed `grid-template-rows` (row count now varies with the label row) and `.bs-cell` gains an explicit `height` to compensate, and `.bs-board.plain` / `.bs-board.mini` / `.bs-cell.ship` / the mini-board and orientation styles are new.

- [ ] **Step 2: Replace the battleship JS block**

In `index.html`, find the line:

```js
// ---------- BATTLESHIP: fire coordinates at a hidden computer fleet ----------
```

Replace everything from that line through the closing `}` of `finishBattleship` (the line immediately before `// ---------- RUN TRACKER (jejak_lari): live GPS distance ----------`) with:

```js
// ---------- BATTLESHIP: place your fleet, then trade shots with the computer ----------
function startBattleship(st){
  gameState.type='battleship';
  gameState.total=5;
  gameState.correct=0;
  gameState.battleship={
    station:st,phase:'placing',
    playerFleet:[],placingIndex:0,orientation:'h',
    enemyFleet:[],playerShotLog:{},enemyShotLog:{},
    pendingX:'',pendingY:'',activeField:'x',busy:false,round:1
  };
  window._battleshipTimeout=()=>finishBattleship(false);
  document.body.classList.add('battleship-mode');
  renderBattleship();
}
function renderBsBoard(fleet,shotLog,opts){
  const size=BattleshipEngine.GRID_SIZE;
  const shipAt=new Set();
  if(opts.showShips) fleet.forEach(s=>s.cells.forEach(c=>shipAt.add(`${c.x},${c.y}`)));
  let cells='';
  for(let y=size-1;y>=0;y--){
    if(opts.showLabels) cells+=`<div class="bs-row-label">${y}</div>`;
    for(let x=0;x<size;x++){
      const key=`${x},${y}`, shot=shotLog[key];
      let cls='water', mark='', state='belum ditembak';
      if(shot==='hit'){ cls='hit'; mark='X'; state='kena'; }
      else if(shot==='miss'){ cls='miss'; mark='O'; state='tidak kena'; }
      else if(shipAt.has(key)){ cls='ship'; state='kapal anda'; }
      cells+=`<div id="${opts.prefix}_${x}_${y}" class="bs-cell ${cls}" aria-label="Petak (${x}, ${y}), ${state}">${mark}</div>`;
    }
  }
  if(opts.showLabels){
    cells+='<div class="bs-corner" aria-hidden="true"></div>';
    for(let x=0;x<size;x++) cells+=`<div class="bs-col-label">${x}</div>`;
  }
  return cells;
}
function renderBsFleetList(){
  const bs=gameState.battleship;
  return bs.enemyFleet.map(ship=>{
    const sunk=BattleshipEngine.isShipSunk(ship,bs.playerShotLog);
    return `<div class="bs-fleet-item${sunk?' sunk':''}">${escapeHtml(ship.name)} (${ship.length})</div>`;
  }).join('');
}
function bsCoordRow(label,handler){
  return `<div class="bs-coord-row">
      <span>(</span>
      <div id="bsBoxX" class="bs-coord-box" role="button" tabindex="0" aria-label="Koordinat x" onclick="selectBsField('x')"></div>
      <span>,</span>
      <div id="bsBoxY" class="bs-coord-box" role="button" tabindex="0" aria-label="Koordinat y" onclick="selectBsField('y')"></div>
      <span>)</span>
      <button id="bsActionBtn" class="big" type="button" onclick="${handler}" disabled>${label}</button>
    </div>
    <div id="bsPad" class="bs-pad" hidden>
      ${[1,2,3,4,5,6,7,8,9].map(d=>`<button type="button" onclick="bsInput(${d})">${d}</button>`).join('')}
      <button type="button" onclick="bsBackspace()" aria-label="Padam">&#9003;</button>
      <button type="button" onclick="bsInput(0)">0</button>
      <button class="bs-pad-close" type="button" onclick="hideBsPad()">Selesai</button>
    </div>`;
}
function renderBattleship(){
  const bs=gameState.battleship;
  const head=`<h2>${escapeHtml(bs.station.name)}</h2>`;
  if(bs.phase==='placing'){
    const spec=BattleshipEngine.FLEET_SPEC[bs.placingIndex];
    document.getElementById('gameCard').innerHTML=`<div class="battleship-game">
      ${head}
      <p>Susun armada anda dahulu. Masukkan koordinat (x, y) permulaan kapal, pilih arah, lalu tekan Letak.</p>
      <div id="bsPlacePrompt" class="bs-place-prompt">Letak ${escapeHtml(spec.name)} — ${spec.length} petak (${bs.placingIndex+1}/5)</div>
      <div class="bs-board-wrap">
        <div class="bs-board">${renderBsBoard(bs.playerFleet,{},{prefix:'bsp',showShips:true,showLabels:true})}</div>
      </div>
      <div id="bsMsg" aria-live="polite"></div>
      <div class="bs-orient">
        <button id="bsOrientH" type="button" class="${bs.orientation==='h'?'active':''}" onclick="setBsOrientation('h')">Melintang &rarr;</button>
        <button id="bsOrientV" type="button" class="${bs.orientation==='v'?'active':''}" onclick="setBsOrientation('v')">Menegak &uarr;</button>
        <button type="button" onclick="resetBsPlacement()">Susun Semula</button>
      </div>
      ${bsCoordRow('Letak','placeBsShip()')}
    </div>`;
    return;
  }
  document.getElementById('gameCard').innerHTML=`<div class="battleship-game">
    ${head}
    <p>Tembak armada komputer. Masukkan koordinat (x, y) lalu tekan Tembak.</p>
    <div class="bs-board-wrap">
      <div class="bs-board">${renderBsBoard(bs.enemyFleet,bs.playerShotLog,{prefix:'bs',showShips:false,showLabels:true})}</div>
    </div>
    <div id="bsMsg" aria-live="polite"></div>
    <div id="bsFleetList" class="bs-fleet-status">${renderBsFleetList()}</div>
    <div class="bs-mini-head">Armada anda</div>
    <div class="bs-mini-wrap">
      <div class="bs-board plain mini">${renderBsBoard(bs.playerFleet,bs.enemyShotLog,{prefix:'bsp',showShips:true,showLabels:false})}</div>
    </div>
    ${bsCoordRow('Tembak','fireBattleship()')}
  </div>`;
}
function setBsMsg(text){
  const msg=document.getElementById('bsMsg');
  if(msg) msg.textContent=text;
}
function clearBsCoords(){
  const bs=gameState.battleship;
  bs.pendingX=''; bs.pendingY='';
  const boxX=document.getElementById('bsBoxX'); if(boxX) boxX.textContent='';
  const boxY=document.getElementById('bsBoxY'); if(boxY) boxY.textContent='';
  updateBsActionEnabled();
}
function applyBsCell(prefix,x,y,result){
  const cell=document.getElementById(`${prefix}_${x}_${y}`);
  if(!cell) return;
  cell.classList.remove('water','ship');
  cell.classList.add(result==='miss'?'miss':'hit');
  cell.textContent=result==='miss'?'O':'X';
  cell.setAttribute('aria-label',`Petak (${x}, ${y}), ${result==='miss'?'tidak kena':'kena'}`);
}
function setBsOrientation(o){
  const bs=gameState.battleship;
  if(!bs || bs.phase!=='placing') return;
  bs.orientation=o;
  const h=document.getElementById('bsOrientH'), v=document.getElementById('bsOrientV');
  if(h) h.classList.toggle('active',o==='h');
  if(v) v.classList.toggle('active',o==='v');
}
function resetBsPlacement(){
  const bs=gameState.battleship;
  if(!bs || bs.phase!=='placing') return;
  bs.playerFleet=[]; bs.placingIndex=0;
  renderBattleship();
  setBsMsg('Susunan dikosongkan. Mula semula.');
}
function placeBsShip(){
  const bs=gameState.battleship;
  if(!bs || window._gameOver || bs.phase!=='placing') return;
  if(bs.pendingX==='' || bs.pendingY==='') return;
  const x=Number(bs.pendingX), y=Number(bs.pendingY);
  const spec=BattleshipEngine.FLEET_SPEC[bs.placingIndex];
  const occupied=bs.playerFleet.reduce((all,s)=>all.concat(s.cells),[]);
  if(!BattleshipEngine.canPlace(occupied,x,y,spec.length,bs.orientation)){
    setBsMsg('Tidak muat di situ. Cuba koordinat atau arah lain.');
    clearBsCoords();
    return;
  }
  bs.playerFleet.push({name:spec.name,length:spec.length,cells:BattleshipEngine.shipCells(x,y,spec.length,bs.orientation)});
  bs.placingIndex++;
  if(bs.placingIndex>=BattleshipEngine.FLEET_SPEC.length){
    bs.phase='playing';
    bs.enemyFleet=BattleshipEngine.generateFleet();
    renderBattleship();
    setBsMsg('Armada sedia! Mula menembak.');
    return;
  }
  renderBattleship();
  setBsMsg(`${spec.name} diletakkan.`);
}
function selectBsField(field){
  const bs=gameState.battleship;
  if(!bs || window._gameOver || bs.busy) return;
  bs.activeField=field;
  const boxX=document.getElementById('bsBoxX'), boxY=document.getElementById('bsBoxY');
  if(boxX) boxX.classList.toggle('active', field==='x');
  if(boxY) boxY.classList.toggle('active', field==='y');
  const pad=document.getElementById('bsPad');
  if(pad) pad.hidden=false;
}
function updateBsActionEnabled(){
  const bs=gameState.battleship;
  const btn=document.getElementById('bsActionBtn');
  if(btn && bs) btn.disabled=bs.busy || bs.pendingX==='' || bs.pendingY==='';
}
function bsInput(digit){
  const bs=gameState.battleship;
  if(!bs || bs.busy || !Number.isInteger(digit) || digit<0 || digit>9) return;
  const key=bs.activeField==='x'?'pendingX':'pendingY';
  bs[key]=(bs[key]==='1' && digit===0)?'10':String(digit);
  const box=document.getElementById(bs.activeField==='x'?'bsBoxX':'bsBoxY');
  if(box) box.textContent=bs[key];
  updateBsActionEnabled();
}
function bsBackspace(){
  const bs=gameState.battleship;
  if(!bs || bs.busy) return;
  const key=bs.activeField==='x'?'pendingX':'pendingY';
  bs[key]=bs[key].slice(0,-1);
  const box=document.getElementById(bs.activeField==='x'?'bsBoxX':'bsBoxY');
  if(box) box.textContent=bs[key];
  updateBsActionEnabled();
}
function hideBsPad(){
  const pad=document.getElementById('bsPad');
  if(pad) pad.hidden=true;
}
function fireBattleship(){
  const bs=gameState.battleship;
  if(!bs || window._gameOver || bs.busy || bs.phase!=='playing') return;
  if(bs.pendingX==='' || bs.pendingY==='') return;
  const x=Number(bs.pendingX), y=Number(bs.pendingY);
  const shot=BattleshipEngine.fireAt(bs.enemyFleet,bs.playerShotLog,x,y);
  if(shot.result==='already-shot'){ setBsMsg('Sudah ditembak di sini.'); clearBsCoords(); return; }
  bs.playerShotLog=shot.shotLog;
  gameState.correct=BattleshipEngine.countSunk(bs.enemyFleet,bs.playerShotLog);
  applyBsCell('bs',x,y,shot.result);
  if(shot.result==='sunk'){
    setBsMsg(`Kapal ${shot.shipName} tenggelam!`);
    const list=document.getElementById('bsFleetList');
    if(list) list.innerHTML=renderBsFleetList();
  } else setBsMsg(shot.result==='hit'?'Kena!':'Tidak kena.');
  clearBsCoords();
  hideBsPad();
  if(BattleshipEngine.isFleetSunk(bs.enemyFleet,bs.playerShotLog)) finishBattleship(!timeUp);
}
function finishBattleship(onTime){
  if(window._gameOver) return;
  window._gameOver=true;
  window._battleshipTimeout=null;
  clearInterval(timerInterval);
  const bs=gameState.battleship;
  const sunk=BattleshipEngine.countSunk(bs.enemyFleet,bs.playerShotLog);
  gameState.correct=sunk;
  const timeTakenSec=Math.round((Date.now()-window._startedAt)/1000);
  let score=Math.round((sunk/5)*100);
  if(!onTime) score=Math.max(0,score-20);
  if(window._testMode){ showTestResult(onTime,score,timeTakenSec); return; }
  submitCompletion(onTime,score,timeTakenSec);
}
```

The computer's return fire is deliberately absent here — Task 3 adds it. After this task the game is: place 5 ships, then fire one-way at the computer, exactly as before but behind a placement phase.

- [ ] **Step 3: Update the Playwright suite for the placement phase**

In `tests/battleship.spec.js`, add this helper immediately after the `openBattleship` function:

```js
async function placeFleet(page) {
  // Place all 5 ships in fixed, non-overlapping rows through the real UI:
  // rows y=0..4, each ship horizontal starting at x=0. The longest ship is 5
  // cells, so every row fits inside the 11-wide grid.
  const count = await page.evaluate(() => BattleshipEngine.FLEET_SPEC.length);
  for (let i = 0; i < count; i++) {
    await enterCoords(page, 0, i);
    await page.getByRole('button', { name: 'Letak' }).click();
  }
}

async function enterCoords(page, x, y) {
  await page.locator('#bsBoxX').click();
  for (const digit of String(x)) {
    await page.locator('#bsPad button').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  }
  await page.locator('#bsBoxY').click();
  for (const digit of String(y)) {
    await page.locator('#bsPad button').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  }
}
```

Replace the existing `fireAt` helper with one built on `enterCoords`:

```js
async function fireAt(page, x, y) {
  await enterCoords(page, x, y);
  await page.getByRole('button', { name: 'Tembak' }).click();
}
```

Then, in each of the three existing tests, insert `await placeFleet(page);` immediately after the `await openBattleship(page);` line, and replace every occurrence of `gameState.battleship.fleet` with `gameState.battleship.enemyFleet` and every `bs.fleet` with `bs.enemyFleet`, `bs.shotLog` with `bs.playerShotLog`.

Finally add this new test at the end of the file:

```js
test('battleship requires placing all five ships before play begins', async ({ page }) => {
  await openBattleship(page);

  await expect(page.locator('#bsPlacePrompt')).toContainText('Lookout Cruiser');
  await expect(page.getByRole('button', { name: 'Letak' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tembak' })).toHaveCount(0);

  // An off-grid placement is rejected and does not consume the ship.
  await enterCoords(page, 10, 0);
  await page.getByRole('button', { name: 'Letak' }).click();
  await expect(page.locator('#bsMsg')).toContainText('Tidak muat');
  await expect(page.locator('#bsPlacePrompt')).toContainText('Lookout Cruiser');

  await enterCoords(page, 0, 0);
  await page.getByRole('button', { name: 'Letak' }).click();
  await expect(page.locator('#bsPlacePrompt')).toContainText('Submarine');

  // An overlapping placement is rejected too.
  await enterCoords(page, 0, 0);
  await page.getByRole('button', { name: 'Letak' }).click();
  await expect(page.locator('#bsMsg')).toContainText('Tidak muat');
  await expect(page.locator('#bsPlacePrompt')).toContainText('Submarine');

  await page.getByRole('button', { name: 'Susun Semula' }).click();
  await expect(page.locator('#bsPlacePrompt')).toContainText('Lookout Cruiser');

  await placeFleet(page);
  await expect(page.getByRole('button', { name: 'Tembak' })).toBeVisible();
  await expect(page.locator('.bs-fleet-item')).toHaveCount(5);
  await expect(page.locator('.bs-board.mini')).toBeVisible();
});
```

- [ ] **Step 4: Run the tests**

Run: `npx playwright test tests/battleship.spec.js --reporter=list`
Expected: PASS — all 4 tests.

If the win-path test fails because the student's fleet occupies cells the test also fires at, note that the two boards are independent: `placeFleet` writes to `bsp_*` cells and firing writes to `bs_*` cells, so they cannot collide. Any failure there is a real bug in the prefix wiring — investigate rather than adjusting the test.

- [ ] **Step 5: Commit**

```bash
git add index.html tests/battleship.spec.js
git commit -m "Add Battleship fleet placement phase and two-fleet state model"
```

---

### Task 3: Two-way turns, computer AI wiring, and loss/restart

**Files:**
- Modify: `index.html` (battleship JS block)
- Modify: `tests/battleship.spec.js`

**Interfaces:**
- Consumes: everything Task 2 produced, plus `BattleshipEngine.nextComputerShot` from Task 1.
- Produces (used by Task 4): `bsComputerTurn()` and `bsResetRound()`; `fireBattleship()` becomes `async` and sets `bs.busy` for the duration of a full turn.

- [ ] **Step 1: Replace `fireBattleship` with the async turn loop**

In `index.html`, find the whole `function fireBattleship(){ ... }` body added in Task 2 and replace it with:

```js
async function fireBattleship(){
  const bs=gameState.battleship;
  if(!bs || window._gameOver || bs.busy || bs.phase!=='playing') return;
  if(bs.pendingX==='' || bs.pendingY==='') return;
  const x=Number(bs.pendingX), y=Number(bs.pendingY);
  const shot=BattleshipEngine.fireAt(bs.enemyFleet,bs.playerShotLog,x,y);
  if(shot.result==='already-shot'){ setBsMsg('Sudah ditembak di sini.'); clearBsCoords(); return; }

  bs.busy=true;
  clearBsCoords();
  hideBsPad();
  updateBsActionEnabled();
  try{
    await bsAnimateShot('bs',x,y,shot.result);
    if(window._gameOver) return;
    bs.playerShotLog=shot.shotLog;
    gameState.correct=BattleshipEngine.countSunk(bs.enemyFleet,bs.playerShotLog);
    applyBsCell('bs',x,y,shot.result);
    if(shot.result==='sunk'){
      setBsMsg(`Kapal ${shot.shipName} tenggelam!`);
      const list=document.getElementById('bsFleetList');
      if(list) list.innerHTML=renderBsFleetList();
    } else setBsMsg(shot.result==='hit'?'Kena!':'Tidak kena.');

    if(BattleshipEngine.isFleetSunk(bs.enemyFleet,bs.playerShotLog)){ finishBattleship(!timeUp); return; }

    await bsComputerTurn();
  } finally {
    if(!window._gameOver){ bs.busy=false; updateBsActionEnabled(); }
  }
}
async function bsComputerTurn(){
  const bs=gameState.battleship;
  const pick=BattleshipEngine.nextComputerShot(bs.enemyShotLog);
  if(!pick) return;
  const res=BattleshipEngine.fireAt(bs.playerFleet,bs.enemyShotLog,pick.x,pick.y);
  await bsAnimateShot('bsp',pick.x,pick.y,res.result);
  if(window._gameOver) return;
  bs.enemyShotLog=res.shotLog;
  applyBsCell('bsp',pick.x,pick.y,res.result);
  if(res.result==='sunk') setBsMsg(`Kapal anda ${res.shipName} musnah!`);
  else setBsMsg(res.result==='hit'?'Komputer kena kapal anda!':'Komputer tersasar.');
  if(BattleshipEngine.isFleetSunk(bs.playerFleet,bs.enemyShotLog)) bsResetRound();
}
function bsResetRound(){
  const bs=gameState.battleship;
  bs.round++;
  bs.enemyFleet=BattleshipEngine.generateFleet();
  bs.playerShotLog={};
  bs.enemyShotLog={};
  bs.busy=false;
  gameState.correct=0;
  renderBattleship();
  setBsMsg('Semua kapal anda musnah! Pusingan baharu bermula.');
}
```

- [ ] **Step 2: Add the animation stub**

`bsAnimateShot` is implemented for real in Task 4. Add this stub now so Task 3 is independently runnable — insert it immediately **before** `async function fireBattleship(){`:

```js
async function bsAnimateShot(prefix,x,y,result){
  return Promise.resolve();
}
```

- [ ] **Step 3: Update the test harness for async turns**

In `tests/battleship.spec.js`, replace the `fireAt` helper with one that waits for the whole turn (player shot + computer reply) to finish:

```js
async function fireAt(page, x, y) {
  await enterCoords(page, x, y);
  await page.getByRole('button', { name: 'Tembak' }).click();
  await page.waitForFunction(() => !gameState.battleship.busy);
}
```

- [ ] **Step 4: Add tests for the computer's reply and the loss reset**

Append to `tests/battleship.spec.js`:

```js
test('the computer fires back after every player shot', async ({ page }) => {
  await openBattleship(page);
  await placeFleet(page);

  const before = await page.evaluate(() => Object.keys(gameState.battleship.enemyShotLog).length);
  expect(before).toBe(0);

  await fireAt(page, 9, 9);

  const after = await page.evaluate(() => Object.keys(gameState.battleship.enemyShotLog).length);
  expect(after).toBe(1);

  // The computer's shot must have marked a cell on the player's own board.
  const marked = await page.evaluate(() => {
    const [key] = Object.keys(gameState.battleship.enemyShotLog);
    const [x, y] = key.split(',');
    return document.getElementById(`bsp_${x}_${y}`).className;
  });
  expect(marked).toMatch(/hit|miss/);
});

test('losing the whole fleet resets the round and keeps the placement', async ({ page }) => {
  await openBattleship(page);
  await placeFleet(page);

  const layoutBefore = await page.evaluate(() => JSON.stringify(gameState.battleship.playerFleet));

  // The AI picks uniformly among un-fired cells, so the only way to force its
  // next shot is to leave exactly one cell open: sink every player ship cell
  // but the last, then close off every other square on the board.
  await page.evaluate(() => {
    const bs = gameState.battleship;
    const cells = bs.playerFleet.flatMap(s => s.cells);
    const last = cells[cells.length - 1];
    const fire = (x, y) => {
      bs.enemyShotLog = BattleshipEngine.fireAt(bs.playerFleet, bs.enemyShotLog, x, y).shotLog;
    };
    cells.slice(0, -1).forEach(c => fire(c.x, c.y));
    for (let x = 0; x < BattleshipEngine.GRID_SIZE; x++) {
      for (let y = 0; y < BattleshipEngine.GRID_SIZE; y++) {
        if (x !== last.x || y !== last.y) fire(x, y);
      }
    }
  });

  await fireAt(page, 8, 8);

  await expect(page.locator('#bsMsg')).toContainText('Pusingan baharu');
  const after = await page.evaluate(() => ({
    layout: JSON.stringify(gameState.battleship.playerFleet),
    playerShots: Object.keys(gameState.battleship.playerShotLog).length,
    enemyShots: Object.keys(gameState.battleship.enemyShotLog).length,
    round: gameState.battleship.round,
    phase: gameState.battleship.phase
  }));
  expect(after.layout).toBe(layoutBefore);   // placement preserved
  expect(after.playerShots).toBe(0);          // both boards cleared
  expect(after.enemyShots).toBe(0);
  expect(after.round).toBe(2);
  expect(after.phase).toBe('playing');        // still playable, not finished

  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toHaveCount(0);
});
```

- [ ] **Step 5: Run the tests**

Run: `npx playwright test tests/battleship.spec.js --reporter=list`
Expected: PASS — all 6 tests.

The win-path test now fires many shots, each triggering a computer reply. That is expected and must keep passing: the student can still sink all 5 enemy ships before the computer sinks all 5 of theirs, because the test fires directly at known ship cells while the computer fires blind.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/battleship.spec.js
git commit -m "Add two-way Battleship turns with computer AI and loss reset"
```

---

### Task 4: SVG shot animation

**Files:**
- Modify: `index.html` (CSS block + battleship JS block)
- Modify: `tests/battleship.spec.js`

**Interfaces:**
- Consumes: `bsAnimateShot(prefix, x, y, result)` call sites from Task 3 (`fireBattleship`, `bsComputerTurn`); DOM ids `#bs_{x}_{y}`, `#bsp_{x}_{y}`; the `.bs-board-wrap` / `.bs-mini-wrap` containers, which already have `position:relative` from Task 2.
- Produces: nothing consumed by later tasks — this is the top layer.

- [ ] **Step 1: Add the overlay CSS**

In `index.html`, find:

```css
  .bs-mini-head{display:flex;align-items:center;justify-content:center;gap:8px;margin:8px 0 4px;font-weight:700;font-size:13px;color:var(--navy);}
```

Insert immediately **before** it:

```css
  .bs-fx{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:visible;z-index:3;}
```

- [ ] **Step 2: Replace the animation stub with the real implementation**

In `index.html`, replace the whole stub:

```js
async function bsAnimateShot(prefix,x,y,result){
  return Promise.resolve();
}
```

with:

```js
const BS_FLIGHT_MS=500, BS_IMPACT_MS=300;
function bsReducedMotion(){
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function bsSvg(tag,attrs){
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  Object.keys(attrs||{}).forEach(k=>el.setAttribute(k,attrs[k]));
  return el;
}
// A little cannon-boat drawn at the firing edge, so the missile visibly
// launches from a ship rather than sliding in from nowhere.
function bsLauncherShape(){
  const g=bsSvg('g',{});
  g.appendChild(bsSvg('path',{d:'M-16 6 L16 6 L11 15 L-11 15 Z',fill:'#7a4a1d',stroke:'#4a2c10','stroke-width':'2'}));
  g.appendChild(bsSvg('rect',{x:'-2',y:'-12',width:'4',height:'18',fill:'#4a2c10'}));
  g.appendChild(bsSvg('path',{d:'M2 -11 L14 -3 L2 1 Z',fill:'#fff3c4',stroke:'#4a2c10','stroke-width':'1.5'}));
  return g;
}
function bsMissileShape(){
  const g=bsSvg('g',{});
  g.appendChild(bsSvg('path',{d:'M8 0 L-2 4 L-2 -4 Z',fill:'#ffcb42',stroke:'#8f342c','stroke-width':'1.5'}));
  g.appendChild(bsSvg('rect',{x:'-8',y:'-2.5',width:'8',height:'5',rx:'1.5',fill:'#c8493f'}));
  g.appendChild(bsSvg('path',{d:'M-8 -2.5 L-12 -6 L-11 -1 Z',fill:'#8f342c'}));
  g.appendChild(bsSvg('path',{d:'M-8 2.5 L-12 6 L-11 1 Z',fill:'#8f342c'}));
  return g;
}
async function bsAnimateShot(prefix,x,y,result){
  if(bsReducedMotion()) return;
  const cell=document.getElementById(`${prefix}_${x}_${y}`);
  const board=cell && cell.closest('.bs-board-wrap,.bs-mini-wrap');
  if(!cell || !board) return;
  const boardBox=board.getBoundingClientRect(), cellBox=cell.getBoundingClientRect();
  const tx=cellBox.left-boardBox.left+cellBox.width/2;
  const ty=cellBox.top-boardBox.top+cellBox.height/2;
  const lx=boardBox.width/2, ly=boardBox.height-6;

  const svg=bsSvg('svg',{class:'bs-fx'});
  const launcher=bsLauncherShape();
  launcher.setAttribute('transform',`translate(${lx},${ly})`);
  const missile=bsMissileShape();
  svg.appendChild(launcher);
  svg.appendChild(missile);
  board.appendChild(svg);

  try{
    // Quadratic arc from the launcher up and over to the target cell, with the
    // missile rotated to face along its own path.
    const arc=Math.max(40,Math.abs(ty-ly)*0.5);
    const at=t=>({x:lx+(tx-lx)*t, y:ly+(ty-ly)*t-arc*4*t*(1-t)});
    const steps=14, frames=[];
    for(let i=0;i<=steps;i++){
      const p=at(i/steps), n=at(Math.min(1,i/steps+0.02));
      const angle=Math.atan2(n.y-p.y,n.x-p.x)*180/Math.PI;
      frames.push({transform:`translate(${p.x}px,${p.y}px) rotate(${angle}deg)`});
    }
    await missile.animate(frames,{duration:BS_FLIGHT_MS,easing:'linear',fill:'forwards'}).finished;
    missile.remove();

    const impact=bsSvg('g',{transform:`translate(${tx},${ty})`});
    if(result==='miss'){
      [0,1,2].forEach(i=>impact.appendChild(bsSvg('circle',{r:'4',fill:'none',stroke:'#dff3ff','stroke-width':'2.5','data-i':i})));
      svg.appendChild(impact);
      await Promise.all(Array.from(impact.children).map((ring,i)=>ring.animate(
        [{transform:'scale(0.3)',opacity:0.9},{transform:`scale(${2.4+i*0.9})`,opacity:0}],
        {duration:BS_IMPACT_MS,delay:i*60,easing:'ease-out',fill:'forwards'}
      ).finished));
    } else {
      const burst=bsSvg('circle',{r:'6',fill:'#ffcb42',stroke:'#c8493f','stroke-width':'3'});
      impact.appendChild(burst);
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4;
        impact.appendChild(bsSvg('line',{x1:Math.cos(a)*5,y1:Math.sin(a)*5,x2:Math.cos(a)*16,y2:Math.sin(a)*16,stroke:'#c8493f','stroke-width':'2.5','stroke-linecap':'round'}));
      }
      svg.appendChild(impact);
      await Promise.all(Array.from(impact.children).map(part=>part.animate(
        [{transform:'scale(0.4)',opacity:1},{transform:'scale(1.8)',opacity:0}],
        {duration:BS_IMPACT_MS,easing:'ease-out',fill:'forwards'}
      ).finished));
    }
  } catch(err) {
    // A cancelled animation (view torn down mid-flight) must never strand the
    // turn loop — bs.busy is released by fireBattleship's finally block.
  } finally {
    svg.remove();
  }
}
```

- [ ] **Step 3: Make the test suite deterministic**

In `tests/battleship.spec.js`, add reduced-motion emulation to the harness so tests skip animation and stay fast. Find in `openBattleship`:

```js
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
```

Insert immediately **before** it:

```js
  // Animations are verified in their own test; every other test runs with
  // reduced motion so shots resolve instantly and deterministically.
  await page.emulateMedia({ reducedMotion: 'reduce' });
```

- [ ] **Step 4: Add an animation test**

Append to `tests/battleship.spec.js`:

```js
test('a shot plays a missile and impact animation when motion is allowed', async ({ page }) => {
  await openBattleship(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await placeFleet(page);

  await enterCoords(page, 9, 9);
  await page.getByRole('button', { name: 'Tembak' }).click();

  // The SVG overlay exists while the shot is in flight...
  await expect(page.locator('.bs-fx')).toHaveCount(1);
  // ...and is cleaned up once the whole turn (including the computer's reply)
  // finishes, leaving no orphaned overlays behind.
  await page.waitForFunction(() => !gameState.battleship.busy);
  await expect(page.locator('.bs-fx')).toHaveCount(0);
});
```

- [ ] **Step 5: Run the tests**

Run: `npx playwright test tests/battleship.spec.js --reporter=list`
Expected: PASS — all 7 tests.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/battleship.spec.js
git commit -m "Add SVG missile, explosion, and splash animations to Battleship"
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
Expected: all pass **except** `tests/station-count.spec.js:83 — saving fewer stations regenerates group orders and preserves roster`, a pre-existing failure unrelated to this feature and already present on `main`. Any *other* failure is a real regression — investigate before proceeding.

- [ ] **Step 3: Manual smoke test**

Open `index.html`, log in as admin (PIN `1234`), add a station with game type "Battleship Koordinat", click "▶️ Uji Cara Main Stesen Ini", and confirm:
- Placement runs first: the prompt names each ship in turn, Melintang/Menegak switches direction, an off-grid or overlapping placement is refused with a message and does not consume the ship, and Susun Semula clears everything.
- After the fifth ship, the enemy board appears with your own fleet shown as a small board beneath it.
- Firing plays a missile arc from the ship at the board's edge, then an orange burst on a hit or a blue splash on a miss.
- The computer replies each turn, marking your mini board, and its shots visibly cluster after it lands a hit.
- Sinking all 5 enemy ships ends the round with a score; losing all 5 of yours shows "Pusingan baharu bermula" and play continues with your layout intact.
- On a phone-width window, both boards, the fleet chips, coordinate boxes and numpad stay on screen with no page scroll.

- [ ] **Step 4: Final commit (only if the smoke test surfaced fixes)**

```bash
git add -A
git commit -m "Fix issues found during Battleship two-way battle verification"
```

Skip this step if the smoke test found nothing.
