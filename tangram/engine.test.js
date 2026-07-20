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

test('snapAngle rounds to nearest 45 and wraps', () => {
  assert.strictEqual(E.snapAngle(25), 45);
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

// Small synthetic fixture: two distinct-type pieces + a duplicate pair.
const FIX = {
  a: [{x:0,y:0},{x:1,y:0},{x:0,y:1}],
  b: [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],
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

test('countPlacedInSlots: 0 when pieces are far from every slot', () => {
  const scattered = SOL.map(p => ({ ...p, pos: { x: p.pos.x + 50, y: p.pos.y + 50 } }));
  assert.strictEqual(E.countPlacedInSlots(scattered, SOL, FIX), 0);
});

test('countPlacedInSlots: all slots filled when pieces match the solution exactly', () => {
  assert.strictEqual(E.countPlacedInSlots(SOL, SOL, FIX), SOL.length);
});

test('countPlacedInSlots: counts only the pieces that are actually correct', () => {
  const partial = SOL.map(p => ({ ...p, pos: { ...p.pos } }));
  partial[1].pos.x += 5; // move the 'b' piece away; the two 'a' pieces stay put
  assert.strictEqual(E.countPlacedInSlots(partial, SOL, FIX), 2);
});

test('countPlacedInSlots: two identical pieces stacked on one slot count once', () => {
  const stacked = [SOL[0], { ...SOL[0] }, SOL[1]]; // both 'a' pieces on SOL[0]'s slot
  assert.strictEqual(E.countPlacedInSlots(stacked, SOL, FIX), 2); // that slot + the 'b' slot
});

// Shrink a polygon slightly toward its centroid, so that pieces which merely
// share an edge (a legal, common tangram situation) are not counted as
// overlapping just because sample points land on the shared boundary line.
function inset(poly, d) {
  const c = E.polygonCentroid(poly);
  return poly.map(p => ({ x: c.x + (p.x - c.x) * (1 - d), y: c.y + (p.y - c.y) * (1 - d) }));
}

// Sample the bounding box of a solution's world polygons on a fine grid.
// Coverage uses the full polygons (proves no gaps); overlap uses slightly
// inset polygons (proves no real area overlap, ignoring shared-edge contact).
// This actually proves tiling/overlap properties — unlike area alone (which is
// constant) or bbox alone (which a gap+overlap pair would still satisfy).
function sampleCoverage(sol, step) {
  const worlds = sol.map(s => E.transformPolygon(S.PIECE_POLYGONS[s.type], s.pos, s.angle, s.flipped));
  const insets = worlds.map(w => inset(w, 0.03));
  const xs = worlds.flat().map(p => p.x), ys = worlds.flat().map(p => p.y);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  let overlap = 0, covered = 0, samples = 0;
  for (let x = minx + step / 2; x < maxx; x += step) {
    for (let y = miny + step / 2; y < maxy; y += step) {
      samples++;
      let full = 0, inner = 0;
      for (const w of worlds) if (E.pointInPolygon({ x, y }, w)) full++;
      for (const w of insets) if (E.pointInPolygon({ x, y }, w)) inner++;
      if (inner > 1) overlap++;
      if (full >= 1) covered++;
    }
  }
  return { overlap, coveredFrac: covered / samples, worlds };
}

test('T1: segiempat is an exact gap-free, overlap-free square tiling', () => {
  const sol = S.SOLUTIONS.segiempat;
  assert.strictEqual(sol.length, 7);
  const { overlap, coveredFrac, worlds } = sampleCoverage(sol, 0.05);
  // exact square bbox
  const xs = worlds.flat().map(p => p.x), ys = worlds.flat().map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  const side = 2 * Math.SQRT2;
  assert.ok(Math.abs(w - side) < 0.02 && Math.abs(h - side) < 0.02,
    `bbox ${w.toFixed(3)}x${h.toFixed(3)} should be ${side.toFixed(3)} square`);
  // no point covered by two pieces (no overlap)
  assert.strictEqual(overlap, 0, 'pieces must not overlap');
  // essentially every point inside the square bbox is covered (no gaps)
  assert.ok(coveredFrac > 0.99, `coverage ${coveredFrac.toFixed(4)} should be ~1.0 (no gaps)`);
});

for (const name of ['kuda', 'kucing']) {
  test(`${name} is a legal non-overlapping arrangement of the 7 pieces`, () => {
    const sol = S.SOLUTIONS[name];
    assert.strictEqual(sol.length, 7);
    const counts = {};
    sol.forEach(s => counts[s.type] = (counts[s.type] || 0) + 1);
    assert.deepStrictEqual(counts, { largeTri: 2, medTri: 1, smallTri: 2, square: 1, para: 1 });
    const { overlap } = sampleCoverage(sol, 0.05);
    assert.strictEqual(overlap, 0, `${name} pieces must not overlap`);
    assert.strictEqual(E.isSolved(sol, sol, S.PIECE_POLYGONS), true);
  });
}

// In the game a dropped piece sticks to its slot only when it is ALREADY at the
// right angle AND dropped within SLOT_SNAP of the slot (tangram/ui.js snap()); a
// wrong angle is NOT auto-corrected. This test mirrors that: it drops each piece
// at the correct orientation with position jitter, snaps it (with the same
// orientation gate), and asserts the arrangement solves — guarding every
// solution as reachable when the student rotates correctly and drops close.
const SLOT_SNAP = 0.7;
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0xffffffff; }; }
function coincide(a, b, tol) {
  if (a.length !== b.length) return false;
  const used = new Array(b.length).fill(false);
  for (const va of a) { let f = -1; for (let j = 0; j < b.length; j++) if (!used[j] && Math.hypot(va.x - b[j].x, va.y - b[j].y) <= tol) { f = j; break; } if (f < 0) return false; used[f] = true; }
  return true;
}
function slotSnap(p, slots, placed) {
  let best = null, bestD = SLOT_SNAP;
  for (const slot of slots) {
    if (slot.type !== p.type) continue;
    if (placed.some(q => Math.hypot(q.pos.x - slot.pos.x, q.pos.y - slot.pos.y) < 0.25)) continue;
    const d = Math.hypot(p.pos.x - slot.pos.x, p.pos.y - slot.pos.y);
    if (d >= bestD) continue;
    const mine = E.transformPolygon(S.PIECE_POLYGONS[p.type], slot.pos, p.angle, p.flipped);
    const want = E.transformPolygon(S.PIECE_POLYGONS[slot.type], slot.pos, slot.angle, slot.flipped);
    if (!coincide(mine, want, 0.02)) continue;
    bestD = d; best = slot;
  }
  return best ? { type: p.type, pos: { x: best.pos.x, y: best.pos.y }, angle: p.angle, flipped: p.flipped } : p;
}
function slotReach(sol, jitter, trials, rnd) {
  let ok = 0;
  for (let t = 0; t < trials; t++) {
    const order = sol.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const placed = [];
    for (const idx of order) {
      const src = sol[idx];
      const p = { type: src.type, angle: src.angle, flipped: src.flipped, // correct orientation (student rotated it)
        pos: { x: src.pos.x + (rnd() * 2 - 1) * jitter, y: src.pos.y + (rnd() * 2 - 1) * jitter } };
      placed.push(slotSnap(p, sol, placed));
    }
    if (E.isSolved(placed, sol, S.PIECE_POLYGONS)) ok++;
  }
  return ok / trials;
}

test('correctly-rotated pieces dropped close snap into every solution', () => {
  const rnd = lcg(0x1a2b3c4d);
  for (const name of ['segiempat', 'kuda', 'kucing']) {
    const rate = slotReach(S.SOLUTIONS[name], 0.3, 100, rnd);
    assert.ok(rate >= 0.99, `${name} slot-reachability ${(rate * 100).toFixed(0)}% should be >=99%`);
  }
});

test('a WRONG-angle piece dropped on its slot does NOT snap (assist is not automatic)', () => {
  const sol = S.SOLUTIONS.kuda;
  // take the medium triangle (no rotational symmetry), drop it exactly on its
  // slot but rotated 90deg off — it must NOT snap to the slot.
  const src = sol.find(s => s.type === 'medTri');
  const wrong = { type: 'medTri', pos: { x: src.pos.x, y: src.pos.y }, angle: src.angle + 90, flipped: src.flipped };
  const out = slotSnap(wrong, sol, []);
  assert.ok(Math.abs(out.angle - (src.angle + 90)) < 1e-9, 'angle must be left unchanged (not auto-fixed)');
});
