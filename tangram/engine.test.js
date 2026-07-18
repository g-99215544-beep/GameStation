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
