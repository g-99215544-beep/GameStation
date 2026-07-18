# Tangram Challenge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `tangram` station game type where students drag/tap-rotate 7 tangram pieces that snap edge-to-edge to rebuild a target animal silhouette.

**Architecture:** Pure geometry + solve/snap logic lives in a DOM-free module (`tangram/engine.js`) unit-tested with Node's built-in test runner. Piece shapes and target solutions live in `tangram/shapes.js`. A standalone `tangram-prototype.html` builds the Canvas UI on top and is also used to *author* the two target shapes by assembling them and dumping their snapped coordinates. Once proven, the engine is wired into `index.html` as a new `renderGame` branch.

**Tech Stack:** Vanilla JS (UMD modules, no build step), HTML5 Canvas 2D, Node's `node:test`/`node:assert` for tests (zero npm dependencies), Firebase (existing, untouched by the engine).

## Global Constraints

- Single-file-friendly deploy: engine/shapes are plain `<script src>` files, no bundler, no npm install to run the app.
- Tests run with `node --test tangram/` — only Node built-ins (`node:test`, `node:assert`), no dependencies.
- All geometry is in **unit space** (piece-relative units); the Canvas multiplies by a `PPU` (pixels-per-unit) constant. Never bake pixels into the engine.
- Touch-first: every gesture must work with pointer/touch events on a phone.
- UI copy is in Malay (match existing `index.html`).
- Engine functions are **pure** (no globals, no DOM); piece polygons are passed in as parameters.
- Geometry constants (verbatim): `POS_TOL = 0.3`, `GRID_SIZE = 0.5`, `SNAP_RADIUS = 0.4`, angle step `45`.

---

## File Structure

- Create: `tangram/engine.js` — pure geometry, snap, solve detection (UMD; no deps).
- Create: `tangram/shapes.js` — `PIECE_POLYGONS`, `PIECE_SET`, `SOLUTIONS` (UMD; no deps).
- Create: `tangram/engine.test.js` — Node tests for engine + shapes.
- Create: `tangram-prototype.html` — Canvas UI + authoring dump button (loads the two JS files).
- Modify: `index.html` — add `tangram` to `GAME_TYPES`, `<script>` includes, a `tangram` branch in `renderGame`, solve → `finishGame`.

---

### Task 1: Engine core geometry

**Files:**
- Create: `tangram/engine.js`
- Test: `tangram/engine.test.js`

**Interfaces:**
- Produces (on `module.exports` / `window.TangramEngine`):
  - `rotatePoint({x,y}, deg) -> {x,y}`
  - `transformPolygon(localPoly, pos, angleDeg, flipped) -> [{x,y}...]`
  - `polygonArea(poly) -> number`
  - `polygonCentroid(poly) -> {x,y}`
  - `pointInPolygon({x,y}, poly) -> boolean`
  - Constants `POS_TOL, GRID_SIZE, SNAP_RADIUS`

- [ ] **Step 1: Write the failing test**

Create `tangram/engine.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const E = require('./engine.js');

test('rotatePoint rotates 90deg CCW-in-math (CW on screen)', () => {
  const r = E.rotatePoint({x:1,y:0}, 90);
  assert.ok(Math.abs(r.x - 0) < 1e-9);
  assert.ok(Math.abs(r.y - 1) < 1e-9);
});

test('polygonArea of unit square is 1', () => {
  const sq = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  assert.ok(Math.abs(E.polygonArea(sq) - 1) < 1e-9);
});

test('polygonCentroid of unit square is (0.5,0.5)', () => {
  const sq = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const c = E.polygonCentroid(sq);
  assert.ok(Math.abs(c.x-0.5) < 1e-9 && Math.abs(c.y-0.5) < 1e-9);
});

test('transformPolygon translates and rotates', () => {
  const tri = [{x:0,y:0},{x:1,y:0},{x:0,y:1}];
  const t = E.transformPolygon(tri, {x:10,y:5}, 0, false);
  assert.deepStrictEqual(t[1], {x:11,y:5});
});

test('pointInPolygon inside/outside', () => {
  const sq = [{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}];
  assert.strictEqual(E.pointInPolygon({x:1,y:1}, sq), true);
  assert.strictEqual(E.pointInPolygon({x:3,y:1}, sq), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tangram/`
Expected: FAIL — `Cannot find module './engine.js'`

- [ ] **Step 3: Write minimal implementation**

Create `tangram/engine.js`:

```js
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.TangramEngine = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const POS_TOL = 0.3, GRID_SIZE = 0.5, SNAP_RADIUS = 0.4;

  function rotatePoint(p, deg) {
    const r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
  }
  function transformPolygon(local, pos, angle, flipped) {
    return local.map(v => {
      const rp = rotatePoint({ x: flipped ? -v.x : v.x, y: v.y }, angle);
      return { x: rp.x + pos.x, y: rp.y + pos.y };
    });
  }
  function polygonArea(poly) {
    let a = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      a += p.x * q.y - q.x * p.y;
    }
    return Math.abs(a) / 2;
  }
  function polygonCentroid(poly) {
    let x = 0, y = 0;
    poly.forEach(p => { x += p.x; y += p.y; });
    return { x: x / poly.length, y: y / poly.length };
  }
  function pointInPolygon(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      const hit = ((yi > pt.y) !== (yj > pt.y)) &&
        (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
      if (hit) inside = !inside;
    }
    return inside;
  }

  return { rotatePoint, transformPolygon, polygonArea, polygonCentroid,
    pointInPolygon, POS_TOL, GRID_SIZE, SNAP_RADIUS };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tangram/`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add tangram/engine.js tangram/engine.test.js
git commit -m "feat(tangram): core geometry primitives"
```

---

### Task 2: Piece definitions

**Files:**
- Create: `tangram/shapes.js`
- Test: `tangram/engine.test.js` (append)

**Interfaces:**
- Produces (on `module.exports` / `window.TangramShapes`):
  - `PIECE_POLYGONS` — `{ smallTri, medTri, largeTri, square, para }`, each an array of centroid-centered `{x,y}` vertices.
  - `PIECE_SET` — `['largeTri','largeTri','medTri','smallTri','smallTri','square','para']`
  - `SOLUTIONS` — `{}` (populated in Task 7)

- [ ] **Step 1: Write the failing test**

Append to `tangram/engine.test.js`:

```js
const S = require('./shapes.js');

test('PIECE_SET has the 7 standard pieces', () => {
  assert.strictEqual(S.PIECE_SET.length, 7);
  const counts = {};
  S.PIECE_SET.forEach(t => counts[t] = (counts[t] || 0) + 1);
  assert.deepStrictEqual(counts,
    { largeTri: 2, medTri: 1, smallTri: 2, square: 1, para: 1 });
});

test('piece areas follow tangram proportions (small=0.5, total=8)', () => {
  const area = t => E.polygonArea(S.PIECE_POLYGONS[t]);
  assert.ok(Math.abs(area('smallTri') - 0.5) < 1e-9);
  assert.ok(Math.abs(area('medTri') - 1) < 1e-9);
  assert.ok(Math.abs(area('largeTri') - 2) < 1e-9);
  assert.ok(Math.abs(area('square') - 1) < 1e-9);
  assert.ok(Math.abs(area('para') - 1) < 1e-9);
  const total = S.PIECE_SET.reduce((s, t) => s + area(t), 0);
  assert.ok(Math.abs(total - 8) < 1e-9);
});

test('each piece polygon is centroid-centered at origin', () => {
  for (const t in S.PIECE_POLYGONS) {
    const c = E.polygonCentroid(S.PIECE_POLYGONS[t]);
    assert.ok(Math.hypot(c.x, c.y) < 1e-9, t + ' not centered');
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tangram/`
Expected: FAIL — `Cannot find module './shapes.js'`

- [ ] **Step 3: Write minimal implementation**

Create `tangram/shapes.js`:

```js
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.TangramShapes = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const RAW = {
    smallTri: [[0, 0], [1, 0], [0, 1]],
    medTri:   [[0, 0], [Math.SQRT2, 0], [0, Math.SQRT2]],
    largeTri: [[0, 0], [2, 0], [0, 2]],
    square:   [[0, 0], [1, 0], [1, 1], [0, 1]],
    para:     [[0, 0], [1, 0], [2, 1], [1, 1]],
  };
  function center(pts) {
    let cx = 0, cy = 0;
    pts.forEach(([x, y]) => { cx += x; cy += y; });
    cx /= pts.length; cy /= pts.length;
    return pts.map(([x, y]) => ({ x: x - cx, y: y - cy }));
  }
  const PIECE_POLYGONS = {};
  for (const k in RAW) PIECE_POLYGONS[k] = center(RAW[k]);

  const PIECE_SET = ['largeTri', 'largeTri', 'medTri', 'smallTri', 'smallTri', 'square', 'para'];
  const SOLUTIONS = {}; // populated in Task 7 (authored via prototype)

  return { PIECE_POLYGONS, PIECE_SET, SOLUTIONS };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tangram/`
Expected: PASS — all tests pass.

- [ ] **Step 5: Commit**

```bash
git add tangram/shapes.js tangram/engine.test.js
git commit -m "feat(tangram): standard piece polygons and set"
```

---

### Task 3: Snap helpers

**Files:**
- Modify: `tangram/engine.js` (add three functions + export them)
- Test: `tangram/engine.test.js` (append)

**Interfaces:**
- Consumes: `POS_TOL, GRID_SIZE, SNAP_RADIUS` from Task 1.
- Produces (added to engine exports):
  - `snapAngle(deg) -> number` — nearest multiple of 45 in `[0,360)`
  - `snapToGrid({x,y}, grid) -> {x,y}`
  - `findVertexSnap(myVerts, otherVerts, radius) -> {dx,dy} | null` — offset that moves `myVerts`' nearest vertex onto the nearest `otherVerts` vertex within `radius`, else `null`. `otherVerts` is a flat array of `{x,y}`.

- [ ] **Step 1: Write the failing test**

Append to `tangram/engine.test.js`:

```js
test('snapAngle rounds to nearest 45 and wraps', () => {
  assert.strictEqual(E.snapAngle(20), 45);
  assert.strictEqual(E.snapAngle(10), 0);
  assert.strictEqual(E.snapAngle(350), 0);
  assert.strictEqual(E.snapAngle(-45), 315);
});

test('snapToGrid rounds to grid', () => {
  assert.deepStrictEqual(E.snapToGrid({ x: 1.2, y: 0.9 }, 0.5), { x: 1.0, y: 1.0 });
});

test('findVertexSnap returns offset within radius, else null', () => {
  const mine = [{ x: 0.1, y: 0.1 }];
  const others = [{ x: 0, y: 0 }, { x: 5, y: 5 }];
  assert.deepStrictEqual(E.findVertexSnap(mine, others, 0.4),
    { dx: -0.1, dy: -0.1 });
  assert.strictEqual(E.findVertexSnap([{ x: 2, y: 2 }], others, 0.4), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tangram/`
Expected: FAIL — `E.snapAngle is not a function`

- [ ] **Step 3: Write minimal implementation**

In `tangram/engine.js`, add before the `return`:

```js
  function snapAngle(deg) {
    return ((Math.round(deg / 45) * 45) % 360 + 360) % 360;
  }
  function snapToGrid(pos, grid) {
    return { x: Math.round(pos.x / grid) * grid, y: Math.round(pos.y / grid) * grid };
  }
  function findVertexSnap(myVerts, otherVerts, radius) {
    let best = null, bestD = radius;
    for (const m of myVerts) {
      for (const o of otherVerts) {
        const d = Math.hypot(m.x - o.x, m.y - o.y);
        if (d <= bestD) { bestD = d; best = { dx: o.x - m.x, dy: o.y - m.y }; }
      }
    }
    return best;
  }
```

Add `snapAngle, snapToGrid, findVertexSnap` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tangram/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tangram/engine.js tangram/engine.test.js
git commit -m "feat(tangram): grid/angle/vertex snap helpers"
```

---

### Task 4: Solve detection (position/rotation invariant)

**Files:**
- Modify: `tangram/engine.js` (add `isSolved` + helpers + export)
- Test: `tangram/engine.test.js` (append)

**Interfaces:**
- Consumes: `transformPolygon`, `POS_TOL` from Task 1.
- Produces (added to engine exports):
  - `isSolved(current, solution, polygons, posTol?) -> boolean`
    - `current` / `solution`: arrays of `{type, pos:{x,y}, angle, flipped}` (identical shape).
    - `polygons`: a `type -> localPoly` map (e.g. `TangramShapes.PIECE_POLYGONS`).
    - Returns true iff there is a global rotation (multiple of 45°) + translation mapping `solution` onto `current`, matching pieces by type (interchangeable duplicates allowed), each within `posTol`.

- [ ] **Step 1: Write the failing test**

Append to `tangram/engine.test.js`:

```js
// Small synthetic fixture: two distinct-type pieces + a duplicate pair.
const FIX = {
  A: [{x:0,y:0},{x:1,y:0},{x:0,y:1}],   // 'a'
  B: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}], // 'b'
};
const SOL = [
  { type: 'a', pos: { x: 0, y: 0 }, angle: 0, flipped: false },
  { type: 'b', pos: { x: 3, y: 0 }, angle: 0, flipped: false },
  { type: 'a', pos: { x: 0, y: 3 }, angle: 0, flipped: false },
];
function rigid(arr, dx, dy, rot) {
  const E2 = E;
  return arr.map(p => {
    const rp = E2.rotatePoint(p.pos, rot);
    return { type: p.type, pos: { x: rp.x + dx, y: rp.y + dy },
      angle: p.angle + rot, flipped: p.flipped };
  });
}

test('isSolved: exact solution solves', () => {
  assert.strictEqual(E.isSolved(SOL, SOL, FIX), true);
});

test('isSolved: globally translated+rotated solution still solves', () => {
  const moved = rigid(SOL, 12, -7, 45);
  assert.strictEqual(E.isSolved(moved, SOL, FIX), true);
});

test('isSolved: one piece displaced does NOT solve', () => {
  const bad = SOL.map(p => ({ ...p, pos: { ...p.pos } }));
  bad[1].pos.x += 1.0; // beyond POS_TOL
  assert.strictEqual(E.isSolved(bad, SOL, FIX), false);
});

test('isSolved: swapping the two duplicate "a" pieces still solves', () => {
  const swapped = [SOL[2], SOL[1], SOL[0]];
  assert.strictEqual(E.isSolved(swapped, SOL, FIX), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tangram/`
Expected: FAIL — `E.isSolved is not a function`

- [ ] **Step 3: Write minimal implementation**

In `tangram/engine.js`, add before the `return`:

```js
  function _translate(poly, dx, dy) { return poly.map(p => ({ x: p.x + dx, y: p.y + dy })); }
  function _rotate(poly, deg) { return poly.map(p => rotatePoint(p, deg)); }
  function _avg(pts) {
    let x = 0, y = 0; pts.forEach(p => { x += p.x; y += p.y; });
    return { x: x / pts.length, y: y / pts.length };
  }
  function _polysMatch(a, b, tol) {
    if (a.length !== b.length) return false;
    const used = new Array(b.length).fill(false);
    for (const va of a) {
      let found = -1;
      for (let j = 0; j < b.length; j++) {
        if (!used[j] && Math.hypot(va.x - b[j].x, va.y - b[j].y) <= tol) { found = j; break; }
      }
      if (found < 0) return false;
      used[found] = true;
    }
    return true;
  }
  function isSolved(current, solution, polygons, posTol) {
    posTol = posTol == null ? POS_TOL : posTol;
    if (current.length !== solution.length) return false;
    const cw = current.map(p => transformPolygon(polygons[p.type], p.pos, p.angle, p.flipped));
    const tw = solution.map(s => transformPolygon(polygons[s.type], s.pos, s.angle, s.flipped));
    const Ccur = _avg(current.map(p => p.pos));
    const Ctar = _avg(solution.map(s => s.pos));
    const tarN = tw.map(poly => _translate(poly, -Ctar.x, -Ctar.y));
    for (let a = 0; a < 360; a += 45) {
      const curN = cw.map(poly => _rotate(_translate(poly, -Ccur.x, -Ccur.y), -a));
      const used = new Array(tarN.length).fill(false);
      const assign = (i) => {
        if (i === curN.length) return true;
        for (let j = 0; j < tarN.length; j++) {
          if (used[j] || current[i].type !== solution[j].type) continue;
          if (_polysMatch(curN[i], tarN[j], posTol)) {
            used[j] = true;
            if (assign(i + 1)) return true;
            used[j] = false;
          }
        }
        return false;
      };
      if (assign(0)) return true;
    }
    return false;
  }
```

Add `isSolved` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tangram/`
Expected: PASS — all four `isSolved` tests pass.

- [ ] **Step 5: Commit**

```bash
git add tangram/engine.js tangram/engine.test.js
git commit -m "feat(tangram): position/rotation-invariant solve detection"
```

---

### Task 5: Prototype — rendering

**Files:**
- Create: `tangram-prototype.html`

**Interfaces:**
- Consumes: `window.TangramEngine`, `window.TangramShapes` (browser globals from the UMD files).
- Produces: `initPieces()`, `render()`, and a module-level `pieces` array of `{id,type,pos,angle,flipped}`. `unitToPx`/`pxToUnit` helpers.

- [ ] **Step 1: Create the prototype file with rendering only**

Create `tangram-prototype.html`:

```html
<!DOCTYPE html>
<html lang="ms"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tangram Prototype</title>
<style>
  body{font-family:'Segoe UI',sans-serif;background:#faf6ee;margin:0;color:#1e2a4a;text-align:center;}
  #board{background:#fff;border:3px solid #d4a94e;border-radius:12px;touch-action:none;display:block;margin:10px auto;}
  button{background:#1e2a4a;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-weight:700;margin:4px;}
  #status{font-weight:800;font-size:18px;min-height:24px;}
</style></head><body>
<h2>Tangram Prototype</h2>
<div id="status"></div>
<canvas id="board" width="360" height="360"></canvas>
<div>
  <button onclick="dumpState()">📋 Dump state</button>
  <button onclick="initPieces();render();">↺ Reset</button>
</div>
<pre id="dump" style="text-align:left;max-width:360px;margin:0 auto;white-space:pre-wrap;"></pre>
<script src="tangram/engine.js"></script>
<script src="tangram/shapes.js"></script>
<script>
const E = TangramEngine, S = TangramShapes;
const PPU = 40;                 // pixels per unit
const cv = document.getElementById('board'), ctx = cv.getContext('2d');
let pieces = [];
const COLORS = { largeTri:'#3a7d5c', medTri:'#c0453a', smallTri:'#1e2a4a', square:'#d4a94e', para:'#7a5cc0' };

function unitToPx(p){ return { x: p.x*PPU, y: p.y*PPU }; }
function pxToUnit(p){ return { x: p.x/PPU, y: p.y/PPU }; }

function initPieces(){
  pieces = S.PIECE_SET.map((t,i)=>({
    id:i, type:t, angle:0, flipped:false,
    pos:{ x: 1.5 + (i%4)*2, y: 1.5 + Math.floor(i/4)*3 }
  }));
}
function worldPoly(p){ return E.transformPolygon(S.PIECE_POLYGONS[p.type], p.pos, p.angle, p.flipped); }

function render(){
  ctx.clearRect(0,0,cv.width,cv.height);
  pieces.forEach(p=>{
    const poly = worldPoly(p).map(unitToPx);
    ctx.beginPath();
    poly.forEach((v,i)=> i? ctx.lineTo(v.x,v.y) : ctx.moveTo(v.x,v.y));
    ctx.closePath();
    ctx.fillStyle = COLORS[p.type]; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  });
}
function dumpState(){
  const out = pieces.map(p=>({ type:p.type, pos:{x:+p.pos.x.toFixed(4), y:+p.pos.y.toFixed(4)}, angle:p.angle, flipped:p.flipped }));
  document.getElementById('dump').textContent = JSON.stringify(out);
}
initPieces(); render();
</script></body></html>
```

- [ ] **Step 2: Verify in the browser**

Serve and open, then confirm 7 colored pieces render without errors:

```bash
python -m http.server 8765 >/dev/null 2>&1 &
```

Drive with Playwright MCP: navigate to `http://localhost:8765/tangram-prototype.html`, take a snapshot, and evaluate:

```js
() => ({ pieceCount: pieces.length, err: window.__err || null })
```

Expected: `pieceCount: 7`, canvas shows 7 shapes, no console errors.

- [ ] **Step 3: Commit**

```bash
git add tangram-prototype.html
git commit -m "feat(tangram): prototype rendering of 7 pieces"
```

---

### Task 6: Prototype — interaction (drag, tap-rotate, flip, snap)

**Files:**
- Modify: `tangram-prototype.html` (add pointer handlers, flip button, snap-on-release)

**Interfaces:**
- Consumes: `pieces`, `worldPoly`, `render`, `pxToUnit` (Task 5); `E.snapToGrid`, `E.snapAngle`, `E.findVertexSnap`, `E.pointInPolygon` (Tasks 1/3).
- Produces: `snapPiece(p)`, `checkSolved()`, pointer-event wiring. Behavior: drag moves; tap (< 6px move) rotates selected piece +45°; a "↔ Balik" button flips the selected `para`.

- [ ] **Step 1: Add interaction code**

In `tangram-prototype.html`, add a flip button after the board:

```html
<button id="flipBtn" onclick="flipSelected()" style="display:none;">↔ Balik</button>
```

Add before `initPieces(); render();`:

```js
let selected = null, dragging = false, startPx = null, grabOffset = null;

function hitTest(uPt){
  for (let i = pieces.length - 1; i >= 0; i--) {
    if (E.pointInPolygon(uPt, worldPoly(pieces[i]))) return pieces[i];
  }
  return null;
}
function bringToTop(p){ pieces = pieces.filter(q => q !== p); pieces.push(p); }
function evtUnit(e){
  const r = cv.getBoundingClientRect();
  return pxToUnit({ x: e.clientX - r.left, y: e.clientY - r.top });
}
function updateFlipBtn(){
  document.getElementById('flipBtn').style.display =
    (selected && selected.type === 'para') ? 'inline-block' : 'none';
}

cv.addEventListener('pointerdown', e => {
  cv.setPointerCapture(e.pointerId);
  const u = evtUnit(e);
  selected = hitTest(u);
  dragging = false;
  startPx = { x: e.clientX, y: e.clientY };
  if (selected) { bringToTop(selected); grabOffset = { x: u.x - selected.pos.x, y: u.y - selected.pos.y }; }
  updateFlipBtn(); render();
});
cv.addEventListener('pointermove', e => {
  if (!selected) return;
  if (!dragging && Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y) > 6) dragging = true;
  if (dragging) {
    const u = evtUnit(e);
    selected.pos = { x: u.x - grabOffset.x, y: u.y - grabOffset.y };
    render();
  }
});
cv.addEventListener('pointerup', () => {
  if (!selected) return;
  if (!dragging) { selected.angle = E.snapAngle(selected.angle + 45); }  // tap = rotate CW
  else { snapPiece(selected); }
  render(); checkSolved();
});

function flipSelected(){
  if (!selected) return;
  selected.flipped = !selected.flipped;
  snapPiece(selected); render(); checkSolved();
}
function snapPiece(p){
  p.pos = E.snapToGrid(p.pos, E.GRID_SIZE);
  p.angle = E.snapAngle(p.angle);
  const mine = worldPoly(p);
  const others = [];
  pieces.forEach(q => { if (q !== p) worldPoly(q).forEach(v => others.push(v)); });
  const snap = E.findVertexSnap(mine, others, E.SNAP_RADIUS);
  if (snap) { p.pos.x += snap.dx; p.pos.y += snap.dy; }
}
function checkSolved(){
  const sol = S.SOLUTIONS[window.__shape];
  const st = document.getElementById('status');
  if (sol && E.isSolved(pieces, sol, S.PIECE_POLYGONS)) st.textContent = '🎉 BERJAYA!';
  else st.textContent = '';
}
```

- [ ] **Step 2: Verify in the browser**

Serve, navigate to the prototype. Drive with Playwright MCP `browser_evaluate` to simulate a rotate via tap and a drag+snap, checking state changes:

```js
() => {
  const before = pieces[0].angle;
  // simulate a tap-rotate directly through the handler path:
  selected = pieces[0]; dragging = false; selected.angle = E.snapAngle(selected.angle + 45);
  const after = pieces[0].angle;
  // simulate snap: nudge a piece near another's vertex then snap
  const p = pieces[1]; snapPiece(p);
  return { rotatedBy: after - before, angleIsMultipleOf45: after % 45 === 0 };
}
```

Expected: `rotatedBy: 45`, `angleIsMultipleOf45: true`. Then manually (via real pointer or `browser_click`/drag) confirm pieces move and click into place.

- [ ] **Step 3: Commit**

```bash
git add tangram-prototype.html
git commit -m "feat(tangram): drag, tap-rotate, flip, snap-on-release"
```

---

### Task 7: Author the two target shapes

**Files:**
- Modify: `tangram-prototype.html` (add a shape selector so you can author + test each)
- Modify: `tangram/shapes.js` (fill `SOLUTIONS.segiempat` and `SOLUTIONS.kuda`)
- Modify: `tangram/engine.test.js` (append T1 tiling validation for the square)

**Interfaces:**
- Consumes: everything from Tasks 1–6.
- Produces: `SOLUTIONS = { segiempat:[...7], kuda:[...7] }` with real, snapped coordinates; a reference-silhouette renderer in the prototype.

- [ ] **Step 1: Add shape selection + reference silhouette to the prototype**

In `tangram-prototype.html`, add near the top controls:

```html
<select id="shapeSel" onchange="window.__shape=this.value;render();checkSolved();">
  <option value="segiempat">Segi empat</option>
  <option value="kuda">Kuda</option>
</select>
```

Set default and draw a small reference (top-right of the canvas) from `SOLUTIONS`:

```js
window.__shape = 'segiempat';
function drawReference(){
  const sol = S.SOLUTIONS[window.__shape];
  if (!sol) return;
  const scale = 12, ox = cv.width - 90, oy = 10;
  const cen = sol.reduce((a,s)=>({x:a.x+s.pos.x,y:a.y+s.pos.y}),{x:0,y:0});
  cen.x/=sol.length; cen.y/=sol.length;
  ctx.save(); ctx.fillStyle='#1e2a4a';
  sol.forEach(s=>{
    const poly = E.transformPolygon(S.PIECE_POLYGONS[s.type], s.pos, s.angle, s.flipped);
    ctx.beginPath();
    poly.forEach((v,i)=>{ const x=ox+(v.x-cen.x)*scale+40, y=oy+(v.y-cen.y)*scale+40;
      i?ctx.lineTo(x,y):ctx.moveTo(x,y); });
    ctx.closePath(); ctx.fill();
  });
  ctx.restore();
}
```

Call `drawReference()` at the end of `render()`.

- [ ] **Step 2: Author `segiempat` (the square)**

Serve and open the prototype. Select "Segi empat". Drag/rotate the 7 pieces to assemble them into the original square (they snap to grid so the result is exact). When assembled, click **📋 Dump state**, copy the JSON.

Paste it into `tangram/shapes.js`, replacing the `SOLUTIONS` line:

```js
const SOLUTIONS = { segiempat: /* PASTE dumped array here */, kuda: [] };
```

- [ ] **Step 3: Add + run the T1 tiling test for the square**

Append to `tangram/engine.test.js`:

```js
test('T1: segiempat solution tiles a square (area 8, no overlap)', () => {
  const sol = S.SOLUTIONS.segiempat;
  assert.strictEqual(sol.length, 7);
  const worlds = sol.map(s => E.transformPolygon(S.PIECE_POLYGONS[s.type], s.pos, s.angle, s.flipped));
  const totalArea = worlds.reduce((a, w) => a + E.polygonArea(w), 0);
  assert.ok(Math.abs(totalArea - 8) < 1e-6, 'piece areas must sum to 8');
  // bounding box must be a square of side sqrt(8) = 2*sqrt(2)
  const xs = worlds.flat().map(p => p.x), ys = worlds.flat().map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const side = 2 * Math.SQRT2;
  assert.ok(Math.abs(w - side) < 0.05 && Math.abs(h - side) < 0.05,
    `bbox ${w.toFixed(3)}x${h.toFixed(3)} should be ${side.toFixed(3)} square`);
});
```

Run: `node --test tangram/`
Expected: PASS. If it fails, re-assemble the square in the prototype and re-dump (snapping guarantees clean coordinates).

- [ ] **Step 4: Author `kuda` (the horse)**

In the prototype select "Kuda" (reference will be empty until filled — that's expected). Assemble a horse silhouette you're happy with, **📋 Dump state**, and paste into `SOLUTIONS.kuda` in `tangram/shapes.js`.

- [ ] **Step 5: Verify both shapes solve in the browser**

Serve, open prototype. For each shape: select it, assemble to match, confirm the status shows **🎉 BERJAYA!**. Also drive via Playwright MCP:

```js
() => {
  window.__shape = 'segiempat';
  pieces = S.SOLUTIONS.segiempat.map((s,i)=>({id:i,...JSON.parse(JSON.stringify(s))}));
  const squareSolves = E.isSolved(pieces, S.SOLUTIONS.segiempat, S.PIECE_POLYGONS);
  pieces = S.SOLUTIONS.kuda.map((s,i)=>({id:i,...JSON.parse(JSON.stringify(s))}));
  const horseSolves = E.isSolved(pieces, S.SOLUTIONS.kuda, S.PIECE_POLYGONS);
  return { squareSolves, horseSolves };
}
```

Expected: `{ squareSolves: true, horseSolves: true }`. Visually confirm the horse reference silhouette looks like a horse.

- [ ] **Step 6: Commit**

```bash
git add tangram/shapes.js tangram/engine.test.js tangram-prototype.html
git commit -m "feat(tangram): author square + horse target solutions"
```

---

### Task 8: Integrate into the app

**Files:**
- Modify: `index.html`
  - `GAME_TYPES` (add tangram entry)
  - `<head>` add `<script src="tangram/engine.js">` + `<script src="tangram/shapes.js">`
  - `renderGame(st)` add a `tangram` branch
  - add `startTangram(st)` helper

**Interfaces:**
- Consumes: `window.TangramEngine`, `window.TangramShapes`; existing `gameState`, `finishGame()`, `#gameCard`, `#timer`, `window._testMode`.
- Produces: playable tangram station; solve → existing `finishGame()` with binary score.

- [ ] **Step 1: Register the game type and scripts**

In `index.html`, add to `GAME_TYPES` (after the existing entries):

```js
  {id:'tangram', name:'Tangram Challenge'}
```

In `<head>`, after the existing CDN script tags, add:

```html
<script src="tangram/engine.js"></script>
<script src="tangram/shapes.js"></script>
```

- [ ] **Step 2: Add the tangram branch in `renderGame`**

In `renderGame(st)`, add a branch (before the final `else`):

```js
  else if(st.gameType==='tangram'){
    let data={}; try{ data=JSON.parse(st.gameDataRaw||'{}'); }catch(e){ data={}; }
    const shapeId = data.shape || 'segiempat';
    gameState.total=1; gameState.correct=0;
    startTangram(st, shapeId);
    return;
  }
```

- [ ] **Step 3: Add the `startTangram` helper**

Add near the other game helpers in `index.html`:

```js
function startTangram(st, shapeId){
  const E = window.TangramEngine, S = window.TangramShapes;
  const card = document.getElementById('gameCard');
  const sol = S.SOLUTIONS[shapeId] || S.SOLUTIONS.segiempat;
  card.innerHTML = `<h2>${st.name}</h2>
    <canvas id="tgBoard" width="340" height="360" style="background:#fff;border:3px solid #d4a94e;border-radius:12px;touch-action:none;"></canvas>
    <p style="color:#555;font-size:13px;">Ketik keping = putar. Seret untuk gerak.</p>
    <button id="tgFlip" class="secondary" style="display:none;" onclick="tgFlipSelected()">↔ Balik</button>`;
  const cv = document.getElementById('tgBoard'), ctx = cv.getContext('2d');
  const PPU = 34;
  const COLORS = { largeTri:'#3a7d5c', medTri:'#c0453a', smallTri:'#1e2a4a', square:'#d4a94e', para:'#7a5cc0' };
  let pieces = S.PIECE_SET.map((t,i)=>({id:i,type:t,angle:0,flipped:false,
    pos:{ x: 1.4 + (i%4)*2, y: 1.4 + Math.floor(i/4)*3 }}));
  let selected=null, dragging=false, startPx=null, grabOffset=null, solved=false;
  const wp = p => E.transformPolygon(S.PIECE_POLYGONS[p.type], p.pos, p.angle, p.flipped);
  const u2p = p => ({x:p.x*PPU,y:p.y*PPU}), p2u = p => ({x:p.x/PPU,y:p.y/PPU});
  function draw(){
    ctx.clearRect(0,0,cv.width,cv.height);
    pieces.forEach(p=>{ const poly=wp(p).map(u2p); ctx.beginPath();
      poly.forEach((v,i)=> i?ctx.lineTo(v.x,v.y):ctx.moveTo(v.x,v.y)); ctx.closePath();
      ctx.fillStyle=COLORS[p.type]; ctx.fill(); ctx.strokeStyle='#fff'; ctx.lineWidth=2; ctx.stroke(); });
    // reference silhouette (top-right)
    const cen = sol.reduce((a,s)=>({x:a.x+s.pos.x,y:a.y+s.pos.y}),{x:0,y:0}); cen.x/=sol.length; cen.y/=sol.length;
    ctx.save(); ctx.fillStyle='rgba(30,42,74,.85)';
    sol.forEach(s=>{ const poly=E.transformPolygon(S.PIECE_POLYGONS[s.type],s.pos,s.angle,s.flipped);
      ctx.beginPath(); poly.forEach((v,i)=>{ const x=cv.width-70+(v.x-cen.x)*10, y=14+(v.y-cen.y)*10+30;
        i?ctx.lineTo(x,y):ctx.moveTo(x,y); }); ctx.closePath(); ctx.fill(); });
    ctx.restore();
  }
  const evtU = e => { const r=cv.getBoundingClientRect(); return p2u({x:e.clientX-r.left,y:e.clientY-r.top}); };
  const hit = u => { for(let i=pieces.length-1;i>=0;i--) if(E.pointInPolygon(u,wp(pieces[i]))) return pieces[i]; return null; };
  function flipBtn(){ document.getElementById('tgFlip').style.display=(selected&&selected.type==='para')?'inline-block':'none'; }
  function snap(p){ p.pos=E.snapToGrid(p.pos,E.GRID_SIZE); p.angle=E.snapAngle(p.angle);
    const others=[]; pieces.forEach(q=>{ if(q!==p) wp(q).forEach(v=>others.push(v)); });
    const s=E.findVertexSnap(wp(p),others,E.SNAP_RADIUS); if(s){ p.pos.x+=s.dx; p.pos.y+=s.dy; } }
  function check(){ if(solved) return;
    if(E.isSolved(pieces, sol, S.PIECE_POLYGONS)){ solved=true; finishGame(); } }
  cv.addEventListener('pointerdown', e=>{ cv.setPointerCapture(e.pointerId); const u=evtU(e);
    selected=hit(u); dragging=false; startPx={x:e.clientX,y:e.clientY};
    if(selected){ pieces=pieces.filter(q=>q!==selected); pieces.push(selected);
      grabOffset={x:u.x-selected.pos.x,y:u.y-selected.pos.y}; } flipBtn(); draw(); });
  cv.addEventListener('pointermove', e=>{ if(!selected) return;
    if(!dragging && Math.hypot(e.clientX-startPx.x,e.clientY-startPx.y)>6) dragging=true;
    if(dragging){ const u=evtU(e); selected.pos={x:u.x-grabOffset.x,y:u.y-grabOffset.y}; draw(); } });
  cv.addEventListener('pointerup', ()=>{ if(!selected) return;
    if(!dragging) selected.angle=E.snapAngle(selected.angle+45); else snap(selected);
    draw(); check(); });
  window.tgFlipSelected = ()=>{ if(!selected) return; selected.flipped=!selected.flipped; snap(selected); draw(); check(); };
  draw();
}
```

- [ ] **Step 4: Verify in the browser via the admin test button**

Serve the app. Drive with Playwright MCP: set up an admin station of type `tangram` and launch test mode (reusing the `testStation` path), then solve programmatically to confirm it routes to the existing result screen without a Firebase write:

```js
() => {
  buildStationsUI({1:{name:'Stesen Tangram', gameType:'tangram', gameDataRaw:'{"shape":"segiempat"}'}});
  show('view-admin');
  document.getElementById('st_gametype_1').value='tangram';
  document.getElementById('st_gamedata_1').value='{"shape":"segiempat"}';
  window._testMode = true;
  testStation(1);
  const hasCanvas = !!document.getElementById('tgBoard');
  return { hasCanvas, gameActive: document.getElementById('view-game').classList.contains('active') };
}
```

Expected: `{ hasCanvas: true, gameActive: true }`. Then confirm the reference silhouette renders and pieces are draggable. Finally verify the full solve path (drag pieces to solve, or set `pieces` to the solution and trigger `pointerup`) shows the 🧪 test result with **0 Firebase writes** (same spy technique as the earlier test-station verification).

- [ ] **Step 5: Run the full engine test suite one last time**

Run: `node --test tangram/`
Expected: PASS — all tests green.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(tangram): integrate tangram game type into station flow"
```

---

## Self-Review Notes

- **Spec coverage:** pieces & coordinate system → Tasks 1–2; interaction (drag/tap-rotate/flip/snap) → Tasks 3, 6; solve detection invariance → Task 4; reference silhouette from solution data → Task 7; layout & Canvas → Tasks 5–6; app integration + binary scoring + admin Uji → Task 8; build-prototype-first → Tasks 5–7; tests T1–T4 → Tasks 4 & 7 (T2/T4 in Task 4 via synthetic fixture, T1 in Task 7, snap/T3 in Task 3). All spec sections map to a task.
- **No-flip risk:** the flip control (Task 6/8) removes the parallelogram chirality constraint, so `kuda` can be authored freely.
- **Coordinate risk:** target coordinates are produced by in-prototype assembly + snap (Task 7), not hand-derived; T1 validates the square, and `isSolved` self-check validates the horse.
- **Type consistency:** `{type,pos:{x,y},angle,flipped}` is the single piece shape used by `isSolved`, `SOLUTIONS`, dump output, and both UIs.
```
