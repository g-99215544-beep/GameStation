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

test('kuda is a legal non-overlapping arrangement of the 7 pieces', () => {
  const sol = S.SOLUTIONS.kuda;
  assert.strictEqual(sol.length, 7);
  const counts = {};
  sol.forEach(s => counts[s.type] = (counts[s.type] || 0) + 1);
  assert.deepStrictEqual(counts, { largeTri: 2, medTri: 1, smallTri: 2, square: 1, para: 1 });
  const { overlap } = sampleCoverage(sol, 0.05);
  assert.strictEqual(overlap, 0, 'kuda pieces must not overlap');
  assert.strictEqual(E.isSolved(sol, sol, S.PIECE_POLYGONS), true);
});

// A solution being self-consistent (isSolved(sol,sol)) does NOT mean a student
// can actually reach it: pieces are placed imperfectly and only edge/vertex
// snapping pulls them into place. This test simulates a student dropping each
// piece near its spot (deterministic seeded jitter, random order) and letting
// snapPieceToNeighbors settle it, then asserts the arrangement solves the vast
// majority of the time. It guards against authoring a shape whose pieces don't
// actually lock together via the snap system.
function lcg(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 0xffffffff; }; }
function reachRate(sol, jitter, trials, rnd) {
  let ok = 0;
  for (let t = 0; t < trials; t++) {
    const order = sol.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const placed = [];
    for (const idx of order) {
      const src = sol[idx];
      const p = { type: src.type, angle: src.angle, flipped: src.flipped,
        pos: { x: src.pos.x + (rnd() * 2 - 1) * jitter, y: src.pos.y + (rnd() * 2 - 1) * jitter } };
      placed.push(E.snapPieceToNeighbors(p, placed, S.PIECE_POLYGONS, E.SNAP_RADIUS, 3));
    }
    if (E.isSolved(placed, sol, S.PIECE_POLYGONS)) ok++;
  }
  return ok / trials;
}

test('both solutions are snap-reachable by a student at realistic jitter', () => {
  const rnd = lcg(0x1a2b3c4d);
  const sq = reachRate(S.SOLUTIONS.segiempat, 0.15, 80, rnd);
  const ku = reachRate(S.SOLUTIONS.kuda, 0.15, 80, rnd);
  assert.ok(sq >= 0.9, `segiempat reachability ${(sq * 100).toFixed(0)}% should be >=90%`);
  assert.ok(ku >= 0.9, `kuda reachability ${(ku * 100).toFixed(0)}% should be >=90%`);
});
