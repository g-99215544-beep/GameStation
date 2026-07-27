# Battleship Drag Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Battleship placement phase's coordinate numpad with a ship dock the student drags from, a tap-to-rotate gesture on placed ships, and an explicit "Sedia! Mula Menembak" button.

**Architecture:** All work is inline in `index.html` beside the existing battleship block; `battleship/engine.js` gains nothing, because `shipCells` and `canPlace` already cover placement maths. Dragging uses Pointer Events (finger and mouse in one code path) with an absolutely positioned ghost and `document.elementFromPoint` for hit-testing.

**Tech Stack:** Vanilla JS (no framework, no build step), Pointer Events, inline event handlers matching the file's existing style, Playwright for end-to-end tests.

## Global Constraints

- Grid is `0`–`10` inclusive on both axes (11×11), first quadrant only; `y` increases **upward**, so DOM row order is y=10 first, y=0 last.
- Fleet is exactly the 5 ships in `FLEET_SPEC`: Lookout Cruiser (2), Submarine (3), Battleship (3), Destroyer (4), Pirate ship (5).
- Ships are horizontal (`'h'`) or vertical (`'v'`) only, never overlapping, never off-grid.
- Placement is by **drag only**; tap on a placed ship rotates it. No coordinate entry, no orientation buttons, no numpad in the placing phase.
- Rotation pivots on the ship's **starting cell** (`cells[0]`), and is refused when the result would not fit.
- A ship leaves the dock **horizontal**. A ship dragged off the grid keeps its current orientation.
- Ships may be placed in **any order** and moved any number of times until the battle starts.
- Movement under **8px** between pointerdown and pointerup is a tap, not a drag.
- The battle starts only when the student presses "Sedia! Mula Menembak", which is disabled until all five ships are on the grid.
- The firing phase, scoring, computer turn, loss reset, and shot animations are **unchanged**.
- Follow the existing style in `index.html`: compact one-line function bodies, plain DOM APIs, inline `onclick`/`onpointerdown` attributes, Malay UI text.
- No service-worker cache bump is needed: `battleship/engine.js` does not change, and `index.html` is served network-first by `sw.js`.
- Spec of record: `docs/superpowers/specs/2026-07-27-battleship-drag-placement-design.md`.

---

### Task 1: Placement state, ship dock, and the start button

Replaces the placing screen's UI and its underlying state, without dragging yet. Placement happens through `placeBsShipAt`, the same function the drop handler will call in Task 2, so the existing firing tests keep running by calling it directly.

**Files:**
- Modify: `index.html` (CSS block near `.bs-place-prompt`; `startBattleship`; `renderBsBoard`; `renderBattleship` placing branch; `resetBsPlacement`; delete `setBsOrientation` and `placeBsShip`)
- Modify: `tests/battleship.spec.js`

**Interfaces:**
- Consumes: `BattleshipEngine.FLEET_SPEC`, `BattleshipEngine.shipCells(x,y,length,orientation)`, `BattleshipEngine.canPlace(occupiedCells,x,y,length,orientation)`, `BattleshipEngine.generateFleet()`, existing `renderBattleship`, `setBsMsg`, `fitBsBoard`, `escapeHtml`.
- Produces (used by Tasks 2–3):
  - `bsShipByName(name)` → the ship object in `gameState.battleship.playerFleet`, or `undefined`
  - `bsOccupiedCells(exceptName)` → flat `[{x,y},...]` of every placed ship except `exceptName`
  - `placeBsShipAt(name, x, y, orientation)` → `boolean`; places or moves the named ship, re-rendering on success
  - `renderBsDock()` → HTML string for the dock
  - `updateBsStartEnabled()` → enables `#bsStartBtn` when five ships are placed
  - `bsStartBattle()` → generates the enemy fleet and switches to the firing screen
  - Grid ship cells carry `data-ship="<ship name>"`; dock ships are `.bs-dock-ship[data-ship]` with `.bs-dock-cell` children.

- [ ] **Step 1: Write the failing tests**

In `tests/battleship.spec.js`, replace the `placeFleet` helper (currently drives the numpad) with a direct-placement version, and replace the test named `battleship requires placing all five ships before play begins`.

Replace the helper:

```js
async function placeFleet(page) {
  // Rows y=0..4, each ship horizontal from x=0: the longest ship is 5 cells,
  // so every row fits inside the 11-wide grid. Task 2 swaps this for real drags.
  await page.evaluate(() => {
    BattleshipEngine.FLEET_SPEC.forEach((spec, i) => placeBsShipAt(spec.name, 0, i, 'h'));
  });
  await page.getByRole('button', { name: 'Sedia! Mula Menembak' }).click();
}
```

Replace the whole `battleship requires placing all five ships before play begins` test with:

```js
test('the dock lists every ship and the battle starts only when all five are placed', async ({ page }) => {
  await openBattleship(page);

  await expect(page.locator('.bs-dock-ship')).toHaveCount(5);
  await expect(page.locator('.bs-dock-ship[data-ship="Submarine"] .bs-dock-cell')).toHaveCount(3);
  await expect(page.locator('#bsPad')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Letak' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sedia! Mula Menembak' })).toBeDisabled();

  // Four ships is not enough.
  await page.evaluate(() => {
    BattleshipEngine.FLEET_SPEC.slice(0, 4).forEach((spec, i) => placeBsShipAt(spec.name, 0, i, 'h'));
  });
  await expect(page.locator('.bs-dock-ship.placed')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Sedia! Mula Menembak' })).toBeDisabled();

  // An off-grid or overlapping placement is refused and changes nothing.
  const refused = await page.evaluate(() => [
    placeBsShipAt('Pirate ship', 10, 5, 'h'),
    placeBsShipAt('Pirate ship', 0, 0, 'h')
  ]);
  expect(refused).toEqual([false, false]);
  await expect(page.locator('.bs-dock-ship.placed')).toHaveCount(4);

  await page.evaluate(() => placeBsShipAt('Pirate ship', 0, 4, 'h'));
  await expect(page.locator('.bs-dock-ship.placed')).toHaveCount(5);
  const start = page.getByRole('button', { name: 'Sedia! Mula Menembak' });
  await expect(start).toBeEnabled();

  await start.click();
  await expect(page.getByRole('button', { name: 'Tembak' })).toBeVisible();
  await expect(page.locator('.bs-dock')).toHaveCount(0);
});
```

Also update the test named `a successful placement fully clears the coordinate boxes` — the coordinate boxes no longer exist during placement, so delete that test entirely.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/battleship.spec.js --reporter=list`
Expected: the new dock test fails (`.bs-dock-ship` resolves to 0 elements), and every test using `placeFleet` fails (`placeBsShipAt is not defined`).

- [ ] **Step 3: Add the dock CSS**

In `index.html`, immediately after the `.bs-place-prompt` rule, insert:

```css
  .bs-dock{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:10px 0;}
  .bs-dock-ship{display:flex;flex-direction:column;align-items:center;gap:4px;padding:6px;border:2px solid var(--navy);border-radius:6px;background:#fdf3d8;cursor:grab;touch-action:none;}
  .bs-dock-ship.placed{opacity:.35;pointer-events:none;}
  .bs-dock-cells{display:flex;gap:2px;}
  .bs-dock-cell{width:var(--bs-dock-cell,22px);height:var(--bs-dock-cell,22px);background:#5c6b7a;border:1px solid #3d4854;}
  .bs-dock-name{font-size:11px;font-weight:700;color:var(--navy);}
  .bs-place-actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin:8px 0;}
  .bs-place-actions button{margin:0;}
```

And inside the existing `@media (max-width:720px)` block, right after the `body.battleship-mode .bs-mini-head` rule, insert:

```css
    body.battleship-mode .bs-dock{gap:6px;margin:6px 0;}
    body.battleship-mode .bs-dock-ship{padding:4px;gap:2px;--bs-dock-cell:16px;}
    body.battleship-mode .bs-dock-name{font-size:10px;}
```

- [ ] **Step 4: Reshape the placement state**

In `startBattleship`, replace the `gameState.battleship` literal's second line so `placingIndex` and `orientation` are gone and `drag` exists:

```js
  gameState.battleship={
    station:st,phase:'placing',
    playerFleet:[],drag:null,
    enemyFleet:[],playerShotLog:{},enemyShotLog:{},
    pendingX:'',pendingY:'',activeField:'x',busy:false,round:1
  };
```

- [ ] **Step 5: Tag grid cells with the ship that owns them**

In `renderBsBoard`, replace the `shipAt` set with a map so a cell knows its ship, and emit `data-ship`. Replace these three fragments:

```js
  const shipAt=new Set();
  if(opts.showShips) fleet.forEach(s=>s.cells.forEach(c=>shipAt.add(`${c.x},${c.y}`)));
```

with:

```js
  const shipAt=new Map();
  if(opts.showShips) fleet.forEach(s=>s.cells.forEach(c=>shipAt.set(`${c.x},${c.y}`,s.name)));
```

then:

```js
      else if(shipAt.has(key)){ cls='ship'; state='kapal anda'; }
      cells+=`<div id="${opts.prefix}_${x}_${y}" class="bs-cell ${cls}" aria-label="Petak (${x}, ${y}), ${state}">${mark}</div>`;
```

with:

```js
      else if(shipAt.has(key)){ cls='ship'; state='kapal anda'; }
      const owner=cls==='ship'?` data-ship="${escapeHtml(shipAt.get(key))}"`:'';
      cells+=`<div id="${opts.prefix}_${x}_${y}" class="bs-cell ${cls}"${owner} aria-label="Petak (${x}, ${y}), ${state}">${mark}</div>`;
```

- [ ] **Step 6: Add the placement helpers**

Insert these functions in `index.html` immediately before `function resetBsPlacement(`:

```js
function bsShipByName(name){
  return gameState.battleship.playerFleet.find(s=>s.name===name);
}
function bsOccupiedCells(exceptName){
  return gameState.battleship.playerFleet.filter(s=>s.name!==exceptName).reduce((all,s)=>all.concat(s.cells),[]);
}
// Places a ship, or moves one already on the grid. Returns false and leaves the
// fleet untouched when the target does not fit, so every caller — drop, rotate,
// move — can share one validation path.
function placeBsShipAt(name,x,y,orientation){
  const bs=gameState.battleship;
  if(!bs || bs.phase!=='placing') return false;
  const spec=BattleshipEngine.FLEET_SPEC.find(s=>s.name===name);
  if(!spec) return false;
  if(!BattleshipEngine.canPlace(bsOccupiedCells(name),x,y,spec.length,orientation)) return false;
  bs.playerFleet=bs.playerFleet.filter(s=>s.name!==name);
  bs.playerFleet.push({name:spec.name,length:spec.length,cells:BattleshipEngine.shipCells(x,y,spec.length,orientation)});
  renderBattleship();
  return true;
}
function renderBsDock(){
  const placed=new Set(gameState.battleship.playerFleet.map(s=>s.name));
  return BattleshipEngine.FLEET_SPEC.map(spec=>{
    const cells=new Array(spec.length).fill('<div class="bs-dock-cell"></div>').join('');
    return `<div class="bs-dock-ship${placed.has(spec.name)?' placed':''}" data-ship="${escapeHtml(spec.name)}" data-length="${spec.length}">
      <div class="bs-dock-cells">${cells}</div>
      <div class="bs-dock-name">${escapeHtml(spec.name)} (${spec.length})</div>
    </div>`;
  }).join('');
}
function updateBsStartEnabled(){
  const btn=document.getElementById('bsStartBtn');
  if(btn) btn.disabled=gameState.battleship.playerFleet.length<BattleshipEngine.FLEET_SPEC.length;
}
function bsStartBattle(){
  const bs=gameState.battleship;
  if(!bs || bs.phase!=='placing' || bs.playerFleet.length<BattleshipEngine.FLEET_SPEC.length) return;
  bs.phase='playing';
  bs.enemyFleet=BattleshipEngine.generateFleet();
  renderBattleship();
  setBsMsg('Armada sedia! Mula menembak.');
}
```

- [ ] **Step 7: Rebuild the placing screen**

In `renderBattleship`, replace the whole `if(bs.phase==='placing'){ ... }` branch with:

```js
  if(bs.phase==='placing'){
    document.getElementById('gameCard').innerHTML=`<div class="battleship-game placing">
      ${head}
      <p>Seret kapal dari bawah ke grid. Ketik kapal di grid untuk pusingkannya.</p>
      <div class="bs-board-wrap">
        <div class="bs-board">${renderBsBoard(bs.playerFleet,{},{prefix:'bsp',showShips:true,showLabels:true})}</div>
      </div>
      <div id="bsMsg" aria-live="polite"></div>
      <div id="bsDock" class="bs-dock">${renderBsDock()}</div>
      <div class="bs-place-actions">
        <button type="button" onclick="resetBsPlacement()">Susun Semula</button>
        <button id="bsStartBtn" class="big" type="button" onclick="bsStartBattle()" disabled>Sedia! Mula Menembak</button>
      </div>
    </div>`;
    updateBsStartEnabled();
    fitBsBoard();
    return;
  }
```

- [ ] **Step 8: Update reset and delete the dead placement code**

Replace `resetBsPlacement` with:

```js
function resetBsPlacement(){
  const bs=gameState.battleship;
  if(!bs || bs.phase!=='placing') return;
  bs.playerFleet=[]; bs.drag=null;
  renderBattleship();
  setBsMsg('Susunan dikosongkan. Mula semula.');
}
```

Then delete these two functions entirely — nothing calls them any more:
- `function setBsOrientation(o){ ... }`
- `function placeBsShip(){ ... }`

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx playwright test tests/battleship.spec.js --reporter=list`
Expected: all pass. If `setBsMsg` throws inside `placeBsShipAt`'s re-render path, check that `renderBattleship` still creates `#bsMsg` in the placing branch.

- [ ] **Step 10: Commit**

```bash
git add index.html tests/battleship.spec.js
git commit -m "Replace Battleship placement prompt with a ship dock and start button"
```

---

### Task 2: Drag a ship from the dock onto the grid

**Files:**
- Modify: `index.html` (CSS after `.bs-dock-name`; new pointer handlers before `bsShipByName`; `renderBattleship` placing branch gets the `onpointerdown` hook)
- Modify: `tests/battleship.spec.js`

**Interfaces:**
- Consumes: `placeBsShipAt`, `bsOccupiedCells`, `bsShipByName`, `renderBsDock`, `setBsMsg`, `BattleshipEngine.shipCells`, `BattleshipEngine.canPlace`.
- Produces (used by Task 3):
  - `BS_DRAG_THRESHOLD` = `8` (px of movement that separates a tap from a drag)
  - `bsPointerDown(event)` / `bsPointerMove(event)` / `bsPointerUp(event)`
  - `bsCellFromPoint(clientX, clientY)` → `{x, y}` or `null`
  - `bsDragOrigin(cell, grabIndex, orientation)` → `{x, y}` — the ship's starting cell for a grab landing on `cell`
  - `showBsPreview(cells, ok)` / `clearBsPreview()`
  - `gameState.battleship.drag` → `{name, length, orientation, grabIndex, fromGrid, pointerId, startX, startY, ghost}` or `null`

- [ ] **Step 1: Write the failing tests**

Add this helper next to `placeFleet` in `tests/battleship.spec.js`:

```js
async function dragShip(page, name, x, y, options) {
  // Drops the ship so that its `grabIndex`-th cell lands on grid cell (x, y).
  const grabIndex = (options && options.grabIndex) || 0;
  const from = (options && options.from) === 'grid'
    ? page.locator(`#bsp_${options.fromX}_${options.fromY}`)
    : page.locator(`.bs-dock-ship[data-ship="${name}"] .bs-dock-cell`).nth(grabIndex);
  const source = await from.boundingBox();
  const target = await page.locator(`#bsp_${x}_${y}`).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}
```

Then add these tests:

```js
test('a ship dragged from the dock lands on the cells it was dropped on', async ({ page }) => {
  await openBattleship(page);

  await dragShip(page, 'Submarine', 4, 6);

  const cells = await page.evaluate(() => bsShipByName('Submarine').cells);
  expect(cells).toEqual([{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }]);
  await expect(page.locator('.bs-dock-ship[data-ship="Submarine"]')).toHaveClass(/placed/);
  await expect(page.locator('#bsp_4_6')).toHaveClass(/ship/);
});

test('the grabbed cell is the cell that lands under the pointer', async ({ page }) => {
  await openBattleship(page);

  // Grab the Destroyer by its third cell (index 2) and drop that cell on (5,5):
  // the ship must start two cells to the left, at (3,5).
  await dragShip(page, 'Destroyer', 5, 5, { grabIndex: 2 });

  const cells = await page.evaluate(() => bsShipByName('Destroyer').cells);
  expect(cells[0]).toEqual({ x: 3, y: 5 });
  expect(cells).toHaveLength(4);
});

test('a drop that does not fit returns the ship to the dock', async ({ page }) => {
  await openBattleship(page);
  await dragShip(page, 'Submarine', 0, 0);

  // Off the right edge: a 5-cell ship starting at x=9 runs past x=10.
  await dragShip(page, 'Pirate ship', 9, 8);
  expect(await page.evaluate(() => !!bsShipByName('Pirate ship'))).toBe(false);
  await expect(page.locator('.bs-dock-ship[data-ship="Pirate ship"]')).not.toHaveClass(/placed/);
  await expect(page.locator('#bsMsg')).toContainText('Tidak muat');

  // On top of the Submarine already at (0,0)-(2,0).
  await dragShip(page, 'Battleship', 1, 0);
  expect(await page.evaluate(() => !!bsShipByName('Battleship'))).toBe(false);
  await expect(page.locator('#bsMsg')).toContainText('Tidak muat');
});

test('dragging highlights the target cells green when they fit and red when they do not', async ({ page }) => {
  await openBattleship(page);
  await dragShip(page, 'Submarine', 0, 0);

  const grab = await page.locator('.bs-dock-ship[data-ship="Battleship"] .bs-dock-cell').first().boundingBox();
  const good = await page.locator('#bsp_4_4').boundingBox();
  const bad = await page.locator('#bsp_1_0').boundingBox();

  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(good.x + good.width / 2, good.y + good.height / 2, { steps: 5 });
  await expect(page.locator('.bs-cell.preview-ok')).toHaveCount(3);
  await page.mouse.move(bad.x + bad.width / 2, bad.y + bad.height / 2, { steps: 5 });
  await expect(page.locator('.bs-cell.preview-bad')).toHaveCount(3);
  await expect(page.locator('.bs-cell.preview-ok')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.bs-cell.preview-ok, .bs-cell.preview-bad')).toHaveCount(0);
});

test('a touch drag places a ship, so the phone path works', async ({ page }) => {
  await openBattleship(page);

  // page.mouse produces mouse-type pointer events; this drives the same
  // handlers with pointerType 'touch', which is what a student's finger sends.
  await page.evaluate(() => {
    const dock = document.querySelector('.bs-dock-ship[data-ship="Submarine"] .bs-dock-cell');
    const target = document.getElementById('bsp_2_3');
    const at = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const from = at(dock), to = at(target);
    const fire = (type, node, point) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch',
      clientX: point.x, clientY: point.y
    }));
    fire('pointerdown', dock, from);
    fire('pointermove', window, { x: from.x + 20, y: from.y - 20 });
    fire('pointermove', window, to);
    fire('pointerup', window, to);
  });

  const cells = await page.evaluate(() => bsShipByName('Submarine').cells);
  expect(cells[0]).toEqual({ x: 2, y: 3 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/battleship.spec.js --reporter=list`
Expected: the five new tests fail — nothing happens on pointerdown, so `bsShipByName('Submarine')` is `undefined`.

- [ ] **Step 3: Add the drag CSS**

In `index.html`, immediately after the `.bs-dock-name` rule, insert:

```css
  .bs-drag-ghost{position:fixed;z-index:90;display:flex;gap:2px;pointer-events:none;opacity:.85;}
  .bs-drag-ghost.vertical{flex-direction:column-reverse;}
  .bs-drag-ghost div{width:var(--bs-ghost-cell,22px);height:var(--bs-ghost-cell,22px);background:#5c6b7a;border:1px solid #3d4854;}
  .bs-cell.preview-ok{background:#7fd39b;border-color:#3f8f5f;}
  .bs-cell.preview-bad{background:#e78b84;border-color:#a8453c;}
  .battleship-game.placing{touch-action:none;}
```

The ghost is `pointer-events:none` so `document.elementFromPoint` sees the board underneath it, and `.vertical` uses `column-reverse` because `y` grows upward while the screen grows downward.

- [ ] **Step 4: Write the pointer handlers**

Insert immediately before `function bsShipByName(` in `index.html`:

```js
// Placement is drag-driven: below this many pixels of travel a press is a tap
// (rotate), above it a drag (place/move). One code path serves finger and mouse.
const BS_DRAG_THRESHOLD=8;
function bsCellFromPoint(clientX,clientY){
  const el=document.elementFromPoint(clientX,clientY);
  const cell=el && el.closest && el.closest('.bs-cell');
  if(!cell || !cell.id.startsWith('bsp_')) return null;
  const parts=cell.id.split('_');
  return {x:Number(parts[1]),y:Number(parts[2])};
}
function bsDragOrigin(cell,grabIndex,orientation){
  return orientation==='h'?{x:cell.x-grabIndex,y:cell.y}:{x:cell.x,y:cell.y-grabIndex};
}
function clearBsPreview(){
  document.querySelectorAll('.bs-cell.preview-ok,.bs-cell.preview-bad').forEach(c=>c.classList.remove('preview-ok','preview-bad'));
}
function showBsPreview(cells,ok){
  clearBsPreview();
  cells.forEach(c=>{
    const el=document.getElementById(`bsp_${c.x}_${c.y}`);
    if(el) el.classList.add(ok?'preview-ok':'preview-bad');
  });
}
function bsMakeGhost(length,orientation){
  const ghost=document.createElement('div');
  ghost.className='bs-drag-ghost'+(orientation==='v'?' vertical':'');
  const cell=document.querySelector('.bs-board:not(.mini) .bs-cell');
  if(cell) ghost.style.setProperty('--bs-ghost-cell',cell.getBoundingClientRect().width+'px');
  for(let i=0;i<length;i++) ghost.appendChild(document.createElement('div'));
  document.body.appendChild(ghost);
  return ghost;
}
function bsMoveGhost(clientX,clientY){
  const drag=gameState.battleship.drag;
  if(!drag || !drag.ghost) return;
  const cellSize=parseFloat(getComputedStyle(drag.ghost).getPropertyValue('--bs-ghost-cell'))||22;
  const step=cellSize+BS_BOARD_GAP;
  const left=drag.orientation==='h'?clientX-(drag.grabIndex+0.5)*step:clientX-cellSize/2;
  const top=drag.orientation==='h'?clientY-cellSize/2:clientY-(drag.length-drag.grabIndex-0.5)*step;
  drag.ghost.style.left=left+'px';
  drag.ghost.style.top=top+'px';
}
function bsPointerDown(event){
  const bs=gameState.battleship;
  if(!bs || bs.phase!=='placing' || bs.drag) return;
  const dockShip=event.target.closest && event.target.closest('.bs-dock-ship');
  const gridCell=event.target.closest && event.target.closest('.bs-cell[data-ship]');
  let name,orientation,grabIndex,fromGrid;
  if(dockShip){
    name=dockShip.dataset.ship;
    orientation='h';
    fromGrid=false;
    const cells=Array.from(dockShip.querySelectorAll('.bs-dock-cell'));
    grabIndex=Math.max(0,cells.indexOf(event.target.closest('.bs-dock-cell')));
  } else if(gridCell){
    name=gridCell.dataset.ship;
    const ship=bsShipByName(name);
    if(!ship) return;
    orientation=ship.cells.length>1 && ship.cells[1].x!==ship.cells[0].x?'h':'v';
    fromGrid=true;
    grabIndex=ship.cells.findIndex(c=>`bsp_${c.x}_${c.y}`===gridCell.id);
  } else return;
  const spec=BattleshipEngine.FLEET_SPEC.find(s=>s.name===name);
  bs.drag={name,length:spec.length,orientation,grabIndex,fromGrid,
    pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,ghost:null};
  window.addEventListener('pointermove',bsPointerMove);
  window.addEventListener('pointerup',bsPointerUp);
  window.addEventListener('pointercancel',bsPointerUp);
  event.preventDefault();
}
function bsPointerMove(event){
  const drag=gameState.battleship.drag;
  if(!drag || event.pointerId!==drag.pointerId) return;
  const travelled=Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY);
  if(!drag.ghost){
    if(travelled<BS_DRAG_THRESHOLD) return;
    drag.ghost=bsMakeGhost(drag.length,drag.orientation);
  }
  bsMoveGhost(event.clientX,event.clientY);
  const cell=bsCellFromPoint(event.clientX,event.clientY);
  if(!cell){ clearBsPreview(); return; }
  const origin=bsDragOrigin(cell,drag.grabIndex,drag.orientation);
  const cells=BattleshipEngine.shipCells(origin.x,origin.y,drag.length,drag.orientation);
  showBsPreview(cells,BattleshipEngine.canPlace(bsOccupiedCells(drag.name),origin.x,origin.y,drag.length,drag.orientation));
}
function bsPointerUp(event){
  const bs=gameState.battleship;
  const drag=bs.drag;
  if(!drag || (event.pointerId!==undefined && event.pointerId!==drag.pointerId)) return;
  window.removeEventListener('pointermove',bsPointerMove);
  window.removeEventListener('pointerup',bsPointerUp);
  window.removeEventListener('pointercancel',bsPointerUp);
  const dragged=!!drag.ghost;
  if(drag.ghost) drag.ghost.remove();
  clearBsPreview();
  bs.drag=null;
  if(event.type==='pointercancel' || !dragged) return;
  const cell=bsCellFromPoint(event.clientX,event.clientY);
  if(!cell){ setBsMsg('Tidak muat di situ. Cuba tempat lain.'); return; }
  const origin=bsDragOrigin(cell,drag.grabIndex,drag.orientation);
  if(placeBsShipAt(drag.name,origin.x,origin.y,drag.orientation)) setBsMsg(`${drag.name} diletakkan.`);
  else setBsMsg('Tidak muat di situ. Cuba tempat lain.');
}
```

- [ ] **Step 5: Hook the handler onto the placing screen**

In `renderBattleship`'s placing branch, change the container's opening tag from:

```js
    document.getElementById('gameCard').innerHTML=`<div class="battleship-game placing">
```

to:

```js
    document.getElementById('gameCard').innerHTML=`<div class="battleship-game placing" onpointerdown="bsPointerDown(event)">
```

- [ ] **Step 6: Switch the shared helper to real drags**

In `tests/battleship.spec.js`, replace the `placeFleet` body written in Task 1 with real drags, so every firing test now exercises the production drag path:

```js
async function placeFleet(page) {
  // Rows y=0..4, each ship horizontal from x=0: the longest ship is 5 cells,
  // so every row fits inside the 11-wide grid.
  const ships = await page.evaluate(() => BattleshipEngine.FLEET_SPEC.map(s => s.name));
  for (let i = 0; i < ships.length; i++) await dragShip(page, ships[i], 0, i);
  await page.getByRole('button', { name: 'Sedia! Mula Menembak' }).click();
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx playwright test tests/battleship.spec.js --reporter=list`
Expected: all pass. If a drop lands one cell off, check `bsDragOrigin` against `grabIndex`; if the preview stays after `pointerup`, check that `clearBsPreview` runs before the early `return` paths.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/battleship.spec.js
git commit -m "Place Battleship ships by dragging them from the dock"
```

---

### Task 3: Tap to rotate, and drag a placed ship to move it

**Files:**
- Modify: `index.html` (add `rotateBsShip`, extend `bsPointerUp`)
- Modify: `tests/battleship.spec.js`

**Interfaces:**
- Consumes: `bsShipByName`, `placeBsShipAt`, `bsOccupiedCells`, `BS_DRAG_THRESHOLD`, `setBsMsg`.
- Produces: `rotateBsShip(name)` → `boolean`; flips the named ship's orientation about `cells[0]`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/battleship.spec.js`:

```js
test('tapping a placed ship rotates it about its starting cell', async ({ page }) => {
  await openBattleship(page);
  await dragShip(page, 'Submarine', 4, 2);

  await page.locator('#bsp_4_2').click();

  // Horizontal (4,2)-(6,2) becomes vertical (4,2)-(4,4): y grows upward.
  const cells = await page.evaluate(() => bsShipByName('Submarine').cells);
  expect(cells).toEqual([{ x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 }]);
  await expect(page.locator('#bsp_4_4')).toHaveClass(/ship/);
  await expect(page.locator('#bsp_6_2')).not.toHaveClass(/ship/);

  // Tapping again turns it back.
  await page.locator('#bsp_4_2').click();
  expect(await page.evaluate(() => bsShipByName('Submarine').cells)).toEqual([
    { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }
  ]);
});

test('a rotation that would not fit is refused and the ship keeps its cells', async ({ page }) => {
  await openBattleship(page);
  // Starting at y=9, a 5-cell vertical ship would need y=9..13 — off the grid.
  await dragShip(page, 'Pirate ship', 0, 9);

  await page.locator('#bsp_0_9').click();

  expect(await page.evaluate(() => bsShipByName('Pirate ship').cells)).toEqual([
    { x: 0, y: 9 }, { x: 1, y: 9 }, { x: 2, y: 9 }, { x: 3, y: 9 }, { x: 4, y: 9 }
  ]);
  await expect(page.locator('#bsMsg')).toContainText('Tidak muat');
});

test('dragging a placed ship moves it and frees the cells it left', async ({ page }) => {
  await openBattleship(page);
  await dragShip(page, 'Submarine', 0, 0);

  await dragShip(page, 'Submarine', 7, 7, { from: 'grid', fromX: 0, fromY: 0 });

  expect(await page.evaluate(() => bsShipByName('Submarine').cells)).toEqual([
    { x: 7, y: 7 }, { x: 8, y: 7 }, { x: 9, y: 7 }
  ]);
  await expect(page.locator('#bsp_0_0')).toHaveClass(/water/);
  await expect(page.locator('#bsp_7_7')).toHaveClass(/ship/);
});

test('a placed ship may be moved onto cells it currently occupies', async ({ page }) => {
  await openBattleship(page);
  await dragShip(page, 'Destroyer', 3, 3);

  // Shift one cell right: the target overlaps the ship's own old cells, which
  // must not count as a collision.
  await dragShip(page, 'Destroyer', 4, 3, { from: 'grid', fromX: 3, fromY: 3 });

  expect(await page.evaluate(() => bsShipByName('Destroyer').cells[0])).toEqual({ x: 4, y: 3 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/battleship.spec.js --reporter=list`
Expected: the rotate tests fail (a click leaves the cells unchanged). The two move tests may already pass — Task 2's `bsPointerUp` handles grid grabs — but keep them: they lock in behaviour that Task 3's changes could break.

- [ ] **Step 3: Add the rotate function**

Insert immediately after `placeBsShipAt` in `index.html`:

```js
// A tap turns a ship 90° about its starting cell — the cell the student can see
// stays put, and the rest of the hull swings round it.
function rotateBsShip(name){
  const ship=bsShipByName(name);
  if(!ship) return false;
  const horizontal=ship.cells.length>1 && ship.cells[1].x!==ship.cells[0].x;
  return placeBsShipAt(name,ship.cells[0].x,ship.cells[0].y,horizontal?'v':'h');
}
```

- [ ] **Step 4: Route taps to it**

In `bsPointerUp`, replace this line:

```js
  if(event.type==='pointercancel' || !dragged) return;
```

with:

```js
  if(event.type==='pointercancel') return;
  if(!dragged){
    if(drag.fromGrid && !rotateBsShip(drag.name)) setBsMsg('Tidak muat di situ. Cuba tempat lain.');
    return;
  }
```

A tap on a dock ship still does nothing, because `fromGrid` is false there.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx playwright test tests/battleship.spec.js --reporter=list`
Expected: all pass. If the second tap in the first test does not turn the ship back, check that `rotateBsShip` reads orientation from `cells[1].x !== cells[0].x` rather than from stale state.

- [ ] **Step 6: Commit**

```bash
git add index.html tests/battleship.spec.js
git commit -m "Rotate Battleship ships with a tap and move them by dragging"
```

---

### Task 4: Phone layout and full regression

**Files:**
- Modify: `tests/battleship.spec.js`
- Modify: `index.html` (only if the layout test finds a problem)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Add to `tests/battleship.spec.js`:

```js
test('the placement screen fits a phone and drags work at phone size', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBattleship(page);

  const layout = await page.evaluate(() => ({
    dockBottom: document.querySelector('.bs-dock').getBoundingClientRect().bottom,
    startBottom: document.getElementById('bsStartBtn').getBoundingClientRect().bottom,
    headingTop: document.querySelector('.battleship-game h2').getBoundingClientRect().top,
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight
  }));
  expect(layout.headingTop).toBeGreaterThanOrEqual(0);
  expect(layout.dockBottom).toBeLessThanOrEqual(layout.innerHeight);
  expect(layout.startBottom).toBeLessThanOrEqual(layout.innerHeight);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight + 1);

  // A drag must still hit the right cell at phone cell sizes.
  await dragShip(page, 'Submarine', 8, 8);
  expect(await page.evaluate(() => bsShipByName('Submarine').cells[0])).toEqual({ x: 8, y: 8 });
});
```

- [ ] **Step 2: Run the test**

Run: `npx playwright test tests/battleship.spec.js -g "fits a phone" --reporter=list`
Expected: PASS, or a failure showing which element overflows.

If it fails on `scrollHeight` or a bottom edge, shrink the dock inside the existing `@media (max-width:720px)` block rather than the board — the board already shrinks itself through `fitBsBoard`. For example, drop `--bs-dock-cell` to `13px` and hide the ship names:

```css
    body.battleship-mode .bs-dock-ship{padding:3px;gap:2px;--bs-dock-cell:13px;}
    body.battleship-mode .bs-dock-name{font-size:9px;}
```

Re-run until it passes.

- [ ] **Step 3: Run every engine unit test suite**

Run: `node --test battleship/engine.test.js crossword/engine.test.js sifir/engine.test.js`
Expected: all pass, 0 failures. The engine was not touched, so a failure here means something unrelated broke.

- [ ] **Step 4: Run the full Playwright suite**

Run: `npx playwright test tests/ --reporter=list`
Expected: all pass **except** `tests/station-count.spec.js:83 — saving fewer stations regenerates group orders and preserves roster`, a pre-existing failure unrelated to this feature and present on `main`. Any other failure is a real regression — investigate before proceeding.

- [ ] **Step 5: Manual smoke test**

Open `index.html`, log in as admin (PIN `1234`), press "＋ Setup Treasure Hunt Baru", pick "Langkah 2: Pengurusan Stesen", set station 1's game type to "Battleship Koordinat", and press "▶️ Uji Cara Main Stesen Ini". In a phone-width window confirm:
- All five ships sit in the dock at their true lengths; the board shows no coordinate boxes, no numpad, and no Melintang/Menegak buttons.
- Dragging a ship shows a ghost that follows the finger, with green cells where it fits and red where it does not.
- A bad drop returns the ship to the dock with "Tidak muat di situ."
- Tapping a placed ship turns it; tapping one that cannot turn leaves it alone and shows the message.
- Dragging a placed ship moves it and frees its old cells.
- "Susun Semula" empties the grid; "Sedia! Mula Menembak" is dead until all five are placed, then opens the firing screen with the numpad, where firing, the computer's reply, and the animations behave as before.

- [ ] **Step 6: Final commit (only if Steps 2 or 5 surfaced fixes)**

```bash
git add -A
git commit -m "Fix issues found during Battleship drag placement verification"
```

Skip this step if nothing needed fixing.
