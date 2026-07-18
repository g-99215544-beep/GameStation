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
- Create: `tangram/ui.js` — shared Canvas UI module (`attachTangram`); consumed by both the prototype and `index.html` so no glue is duplicated.
- Create: `tangram-prototype.html` — Canvas UI shell + authoring dump button (loads engine/shapes/ui).
- Modify: `index.html` — add `tangram` to `GAME_TYPES`, three `<script>` includes, a `tangram` branch in `renderGame`, solve → `finishGame`.

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

### Task 5: Shared UI module + prototype

**Files:**
- Create: `tangram/ui.js`
- Create: `tangram-prototype.html`

**Interfaces:**
- Consumes: `window.TangramEngine` (Tasks 1/3/4), `window.TangramShapes` (Task 2).
- Produces (on `module.exports` / `window.TangramUI`):
  - `attachTangram(canvas, opts) -> controller`
    - `opts`: `{ solution?, ppu?, onSolve?, onSelect?, polygons?, pieceSet? }`
      (defaults: `polygons = TangramShapes.PIECE_POLYGONS`, `pieceSet = TangramShapes.PIECE_SET`, `ppu = 38`).
    - Behavior: renders the 7 pieces scattered on the canvas; drag moves a
      piece; a tap (< 6px move) rotates the selected piece +45° CW; on release,
      snaps to grid + nearest 45° + nearest neighbour vertex; draws the reference
      silhouette (from `solution`) top-right; calls `onSolve()` once when
      `isSolved` is true.
    - `controller`: `{ getPieces(), setPieces(arr), flipSelected(), getSelected(), redraw(), destroy() }`.
      `getPieces()` returns `[{type,pos:{x,y},angle,flipped}]` with coords rounded
      to 4 decimals (used for authoring dumps in Task 6).

This single module is consumed by BOTH the prototype (this task) and
`index.html` (Task 7) — no Canvas/pointer glue is duplicated.

- [ ] **Step 1: Create the shared UI module**

Create `tangram/ui.js`:

```js
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.TangramUI = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const COLORS = { largeTri:'#3a7d5c', medTri:'#c0453a', smallTri:'#1e2a4a', square:'#d4a94e', para:'#7a5cc0' };

  function attachTangram(canvas, opts) {
    opts = opts || {};
    const E = opts.engine || (typeof window !== 'undefined' ? window.TangramEngine : null);
    const S = opts.shapes || (typeof window !== 'undefined' ? window.TangramShapes : null);
    const polygons = opts.polygons || S.PIECE_POLYGONS;
    const pieceSet = opts.pieceSet || S.PIECE_SET;
    const solution = opts.solution || null;
    const PPU = opts.ppu || 38;
    const onSolve = opts.onSolve || function () {};
    const onSelect = opts.onSelect || function () {};
    const ctx = canvas.getContext('2d');

    let pieces = pieceSet.map((t, i) => ({
      id: i, type: t, angle: 0, flipped: false,
      pos: { x: 1.4 + (i % 4) * 2, y: 1.4 + Math.floor(i / 4) * 3 }
    }));
    let selected = null, dragging = false, startPx = null, grab = null, solved = false;

    const wp = p => E.transformPolygon(polygons[p.type], p.pos, p.angle, p.flipped);
    const u2p = p => ({ x: p.x * PPU, y: p.y * PPU });
    const p2u = p => ({ x: p.x / PPU, y: p.y / PPU });

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        const poly = wp(p).map(u2p);
        ctx.beginPath();
        poly.forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y));
        ctx.closePath();
        ctx.fillStyle = COLORS[p.type] || '#888'; ctx.fill();
        ctx.strokeStyle = (p === selected) ? '#000' : '#fff';
        ctx.lineWidth = (p === selected) ? 3 : 2; ctx.stroke();
      });
      if (solution) {
        const c = solution.reduce((a, s) => ({ x: a.x + s.pos.x, y: a.y + s.pos.y }), { x: 0, y: 0 });
        c.x /= solution.length; c.y /= solution.length;
        ctx.save(); ctx.fillStyle = 'rgba(30,42,74,.85)';
        solution.forEach(s => {
          const poly = E.transformPolygon(polygons[s.type], s.pos, s.angle, s.flipped);
          ctx.beginPath();
          poly.forEach((v, i) => {
            const x = canvas.width - 64 + (v.x - c.x) * 9, y = 12 + (v.y - c.y) * 9 + 26;
            i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
          });
          ctx.closePath(); ctx.fill();
        });
        ctx.restore();
      }
    }
    const evtU = e => { const r = canvas.getBoundingClientRect(); return p2u({ x: e.clientX - r.left, y: e.clientY - r.top }); };
    const hit = u => { for (let i = pieces.length - 1; i >= 0; i--) if (E.pointInPolygon(u, wp(pieces[i]))) return pieces[i]; return null; };
    function snap(p) {
      p.pos = E.snapToGrid(p.pos, E.GRID_SIZE); p.angle = E.snapAngle(p.angle);
      const others = []; pieces.forEach(q => { if (q !== p) wp(q).forEach(v => others.push(v)); });
      const s = E.findVertexSnap(wp(p), others, E.SNAP_RADIUS); if (s) { p.pos.x += s.dx; p.pos.y += s.dy; }
    }
    function check() { if (solved || !solution) return; if (E.isSolved(pieces, solution, polygons)) { solved = true; onSolve(); } }

    function onDown(e) {
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
      const u = evtU(e); selected = hit(u); dragging = false; startPx = { x: e.clientX, y: e.clientY };
      if (selected) { pieces = pieces.filter(q => q !== selected); pieces.push(selected); grab = { x: u.x - selected.pos.x, y: u.y - selected.pos.y }; }
      onSelect(selected); draw();
    }
    function onMove(e) {
      if (!selected) return;
      if (!dragging && Math.hypot(e.clientX - startPx.x, e.clientY - startPx.y) > 6) dragging = true;
      if (dragging) { const u = evtU(e); selected.pos = { x: u.x - grab.x, y: u.y - grab.y }; draw(); }
    }
    function onUp() {
      if (!selected) return;
      if (!dragging) selected.angle = E.snapAngle(selected.angle + 45); else snap(selected);
      draw(); check();
    }
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    draw();

    return {
      getPieces: () => pieces.map(p => ({ type: p.type, pos: { x: +p.pos.x.toFixed(4), y: +p.pos.y.toFixed(4) }, angle: p.angle, flipped: p.flipped })),
      setPieces: (arr) => { pieces = arr.map((s, i) => ({ id: i, type: s.type, pos: { x: s.pos.x, y: s.pos.y }, angle: s.angle, flipped: s.flipped })); solved = false; draw(); check(); },
      flipSelected: () => { if (!selected) return; selected.flipped = !selected.flipped; snap(selected); draw(); check(); },
      getSelected: () => selected,
      redraw: draw,
      destroy: () => { canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove); canvas.removeEventListener('pointerup', onUp); }
    };
  }
  return { attachTangram };
});
```

- [ ] **Step 2: Create the prototype consuming the module**

Create `tangram-prototype.html`:

```html
<!DOCTYPE html>
<html lang="ms"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Tangram Prototype</title>
<style>
  body{font-family:'Segoe UI',sans-serif;background:#faf6ee;margin:0;color:#1e2a4a;text-align:center;}
  #board{background:#fff;border:3px solid #d4a94e;border-radius:12px;touch-action:none;display:block;margin:10px auto;}
  button,select{background:#1e2a4a;color:#fff;border:none;padding:10px 16px;border-radius:8px;font-weight:700;margin:4px;font-size:15px;}
  #status{font-weight:800;font-size:18px;min-height:24px;}
  #dump{text-align:left;max-width:360px;margin:0 auto;white-space:pre-wrap;font-size:11px;}
</style></head><body>
<h2>Tangram Prototype</h2>
<select id="shapeSel"><option value="segiempat">Segi empat</option><option value="kuda">Kuda</option></select>
<button id="flipBtn" style="display:none;">↔ Balik</button>
<div id="status"></div>
<canvas id="board" width="360" height="380"></canvas>
<div>
  <button id="dumpBtn">📋 Dump state</button>
  <button id="resetBtn">↺ Reset</button>
</div>
<pre id="dump"></pre>
<script src="tangram/engine.js"></script>
<script src="tangram/shapes.js"></script>
<script src="tangram/ui.js"></script>
<script>
const S = TangramShapes;
const cv = document.getElementById('board');
let ctrl, shape = 'segiempat';

function build(){
  if (ctrl) ctrl.destroy();
  shape = document.getElementById('shapeSel').value;
  document.getElementById('status').textContent = '';
  ctrl = TangramUI.attachTangram(cv, {
    solution: S.SOLUTIONS[shape] || null,
    onSolve: () => { document.getElementById('status').textContent = '🎉 BERJAYA!'; },
    onSelect: (p) => { document.getElementById('flipBtn').style.display = (p && p.type === 'para') ? 'inline-block' : 'none'; }
  });
}
document.getElementById('shapeSel').onchange = build;
document.getElementById('resetBtn').onclick = build;
document.getElementById('flipBtn').onclick = () => ctrl.flipSelected();
document.getElementById('dumpBtn').onclick = () => {
  document.getElementById('dump').textContent = JSON.stringify(ctrl.getPieces());
};
build();
</script></body></html>
```

- [ ] **Step 3: Verify in the browser**

Serve and drive with Playwright MCP:

```bash
python -m http.server 8765 >/dev/null 2>&1 &
```

Navigate to `http://localhost:8765/tangram-prototype.html`, snapshot, and evaluate:

```js
() => {
  const before = ctrl.getPieces().length;
  const sel = ctrl.getPieces()[0];
  return { pieceCount: before, firstType: sel.type, hasCtrl: !!ctrl };
}
```

Expected: `pieceCount: 7`, no console errors, 7 shapes visible on the canvas.
Then confirm a tap rotates and a drag moves a piece (via real pointer events or
`browser_click`/drag on the canvas), and that a moved piece clicks into place.

- [ ] **Step 4: Commit**

```bash
git add tangram/ui.js tangram-prototype.html
git commit -m "feat(tangram): shared canvas UI module + prototype"
```

---

### Task 6: Author the two target shapes

**Files:**
- Modify: `tangram/shapes.js` (fill `SOLUTIONS.segiempat` and `SOLUTIONS.kuda`)
- Modify: `tangram/engine.test.js` (append T1 tiling validation for the square)

**Interfaces:**
- Consumes: the prototype + `controller.getPieces()` from Task 5; `isSolved` from Task 4.
- Produces: `SOLUTIONS = { segiempat:[...7], kuda:[...7] }` with real, snapped coordinates.

- [ ] **Step 1: Author `segiempat` (the square)**

Serve and open the prototype. Select "Segi empat". Drag/rotate the 7 pieces to
reassemble the original square (snapping makes the result exact). Click
**📋 Dump state** and copy the JSON. Paste it into `tangram/shapes.js`, replacing
the `SOLUTIONS` line:

```js
const SOLUTIONS = { segiempat: /* PASTE dumped array here */, kuda: [] };
```

- [ ] **Step 2: Add + run the T1 tiling test for the square**

Append to `tangram/engine.test.js`:

```js
test('T1: segiempat solution tiles a square (area 8, square bbox)', () => {
  const sol = S.SOLUTIONS.segiempat;
  assert.strictEqual(sol.length, 7);
  const worlds = sol.map(s => E.transformPolygon(S.PIECE_POLYGONS[s.type], s.pos, s.angle, s.flipped));
  const totalArea = worlds.reduce((a, w) => a + E.polygonArea(w), 0);
  assert.ok(Math.abs(totalArea - 8) < 1e-6, 'piece areas must sum to 8');
  const xs = worlds.flat().map(p => p.x), ys = worlds.flat().map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const side = 2 * Math.SQRT2;
  assert.ok(Math.abs(w - side) < 0.05 && Math.abs(h - side) < 0.05,
    `bbox ${w.toFixed(3)}x${h.toFixed(3)} should be ${side.toFixed(3)} square`);
});
```

Run: `node --test tangram/`
Expected: PASS. If it fails, re-assemble the square in the prototype and re-dump
(snapping guarantees clean coordinates).

- [ ] **Step 3: Author `kuda` (the horse)**

In the prototype select "Kuda" (its reference is empty until filled — expected).
Assemble a horse silhouette you are happy with, **📋 Dump state**, and paste into
`SOLUTIONS.kuda` in `tangram/shapes.js`.

- [ ] **Step 4: Verify both shapes solve**

Serve, open the prototype, and drive with Playwright MCP:

```js
() => {
  const r = {};
  ['segiempat','kuda'].forEach(name => {
    const sol = S.SOLUTIONS[name];
    r[name] = sol.length === 7 && TangramEngine.isSolved(
      sol.map((s,i)=>({id:i,...JSON.parse(JSON.stringify(s))})), sol, S.PIECE_POLYGONS);
  });
  return r;
}
```

Expected: `{ segiempat: true, kuda: true }`. Visually confirm (screenshot) the
horse reference silhouette reads as a horse; if not, re-author and re-dump.

- [ ] **Step 5: Commit**

```bash
git add tangram/shapes.js tangram/engine.test.js
git commit -m "feat(tangram): author square + horse target solutions"
```

---

### Task 7: Integrate into the app

**Files:**
- Modify: `index.html`
  - `GAME_TYPES` (add tangram entry)
  - `<head>` add three `<script src="tangram/*.js">` includes
  - `renderGame(st)` add a `tangram` branch
  - add `startTangram(st, shapeId)` helper (uses `TangramUI.attachTangram`)

**Interfaces:**
- Consumes: `window.TangramUI.attachTangram` (Task 5), `window.TangramShapes.SOLUTIONS` (Task 6); existing `gameState`, `finishGame()`, `#gameCard`, `#timer`, `window._testMode`.
- Produces: playable tangram station; solve → existing `finishGame()` (binary score).

- [ ] **Step 1: Register the game type and scripts**

In `index.html`, add to `GAME_TYPES` (after the existing entries):

```js
  {id:'tangram', name:'Tangram Challenge'}
```

In `<head>`, after the existing CDN `<script>` tags, add:

```html
<script src="tangram/engine.js"></script>
<script src="tangram/shapes.js"></script>
<script src="tangram/ui.js"></script>
```

- [ ] **Step 2: Add the tangram branch in `renderGame`**

In `renderGame(st)`, add a branch before the final `else`:

```js
  else if(st.gameType==='tangram'){
    let data={}; try{ data=JSON.parse(st.gameDataRaw||'{}'); }catch(e){ data={}; }
    startTangram(st, data.shape || 'segiempat');
    return;
  }
```

- [ ] **Step 3: Add the `startTangram` helper**

Add near the other game helpers in `index.html`:

```js
function startTangram(st, shapeId){
  const S = window.TangramShapes;
  gameState.total = 1; gameState.correct = 0;
  const sol = S.SOLUTIONS[shapeId] || S.SOLUTIONS.segiempat;
  const card = document.getElementById('gameCard');
  card.innerHTML = `<h2>${st.name}</h2>
    <canvas id="tgBoard" width="340" height="380" style="background:#fff;border:3px solid #d4a94e;border-radius:12px;touch-action:none;"></canvas>
    <p style="color:#555;font-size:13px;">Ketik keping = putar. Seret untuk gerak.</p>
    <button id="tgFlip" class="secondary" style="display:none;" onclick="window._tgCtrl && window._tgCtrl.flipSelected()">↔ Balik</button>`;
  window._tgCtrl = window.TangramUI.attachTangram(document.getElementById('tgBoard'), {
    solution: sol, ppu: 34,
    onSolve: () => { gameState.correct = 1; finishGame(); },
    onSelect: (p) => { document.getElementById('tgFlip').style.display = (p && p.type === 'para') ? 'inline-block' : 'none'; }
  });
}
```

- [ ] **Step 4: Verify via the admin test button in the browser**

Serve the app. Drive with Playwright MCP: build an admin `tangram` station and
launch test mode (reusing the existing `testStation` path), then confirm it
renders and solving routes to the existing result screen with 0 Firebase writes:

```js
() => {
  buildStationsUI({1:{name:'Stesen Tangram', gameType:'tangram', gameDataRaw:'{"shape":"segiempat"}'}});
  show('view-admin');
  document.getElementById('st_gametype_1').value = 'tangram';
  document.getElementById('st_gamedata_1').value = '{"shape":"segiempat"}';
  window._testMode = true;
  testStation(1);
  return { hasCanvas: !!document.getElementById('tgBoard'), gameActive: document.getElementById('view-game').classList.contains('active') };
}
```

Expected: `{ hasCanvas: true, gameActive: true }`. Then spy on Firebase writes
(same technique as the earlier test-station verification), solve by
`window._tgCtrl.setPieces(TangramShapes.SOLUTIONS.segiempat)`, and confirm the
🧪 test result appears with **0 Firebase writes**.

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

- **Spec coverage:** pieces & coordinates → Tasks 1–2; interaction (drag/tap-rotate/flip/snap) → Tasks 3, 5; solve detection invariance → Task 4; reference silhouette from solution data → Task 5; layout & Canvas → Task 5; app integration + binary scoring + admin Uji → Task 7; build-prototype-first → Tasks 5–6; tests T1–T4 → Tasks 4 & 6 (T2/T4 in Task 4 via synthetic fixture, T1 in Task 6, snap/T3 in Task 3). All spec sections map to a task.
- **No duplication:** all Canvas/pointer/snap/solve glue lives once in `tangram/ui.js` (`attachTangram`), consumed by both the prototype and `index.html`.
- **No-flip risk:** the flip control removes the parallelogram chirality constraint, so `kuda` can be authored freely.
- **Coordinate risk:** target coordinates come from in-prototype assembly + snap (Task 6), not hand derivation; T1 validates the square, `isSolved` self-check validates the horse.
- **Type consistency:** `{type,pos:{x,y},angle,flipped}` is the single piece shape used by `isSolved`, `SOLUTIONS`, `getPieces()` dumps, and both UIs.
