(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.TangramEngine = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const POS_TOL = 0.3, GRID_SIZE = 0.5, SNAP_RADIUS = 0.5;

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

  function _project(poly, ax, ay) {
    let mn = Infinity, mx = -Infinity;
    for (const p of poly) { const d = p.x * ax + p.y * ay; if (d < mn) mn = d; if (d > mx) mx = d; }
    return [mn, mx];
  }
  // Minimal translation vector to push convex polygon A out of convex polygon B
  // (Separating Axis Theorem). Returns null if they are not overlapping (merely
  // touching counts as separated). Direction points from B toward A.
  function overlapMTV(A, B) {
    let minO = Infinity, axx = 0, axy = 0;
    for (const poly of [A, B]) {
      for (let i = 0; i < poly.length; i++) {
        const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
        let nx = -(p2.y - p1.y), ny = p2.x - p1.x;
        const l = Math.hypot(nx, ny) || 1; nx /= l; ny /= l;
        const [minA, maxA] = _project(A, nx, ny), [minB, maxB] = _project(B, nx, ny);
        const o = Math.min(maxA, maxB) - Math.max(minA, minB);
        if (o <= 1e-9) return null;
        if (o < minO) { minO = o; axx = nx; axy = ny; }
      }
    }
    const ca = polygonCentroid(A), cb = polygonCentroid(B);
    if ((ca.x - cb.x) * axx + (ca.y - cb.y) * axy < 0) { axx = -axx; axy = -axy; }
    return { x: axx * minO, y: axy * minO };
  }

  // Settle a piece on release: quantize its angle to 45deg, pull its nearest
  // vertex onto the nearest vertex of already-placed pieces ("assist stick to
  // side"), THEN push it out of any piece it overlaps so it ends up edge-to-edge,
  // never overlapping. Pure edge/vertex assembly — no absolute grid, because
  // tangram vertices do not lie on any rational grid. Single source of snap
  // truth, used by the UI (tangram/ui.js) and the reachability test. Returns a
  // new piece; does not mutate the input.
  function snapPieceToNeighbors(piece, otherPieces, polygons, radius, iters) {
    radius = radius == null ? SNAP_RADIUS : radius;
    iters = iters == null ? 3 : iters;
    const p = { type: piece.type, flipped: piece.flipped, angle: snapAngle(piece.angle), pos: { x: piece.pos.x, y: piece.pos.y } };
    const others = [];
    otherPieces.forEach(q => transformPolygon(polygons[q.type], q.pos, q.angle, q.flipped).forEach(v => others.push(v)));
    for (let i = 0; i < iters; i++) {
      const mine = transformPolygon(polygons[p.type], p.pos, p.angle, p.flipped);
      const s = findVertexSnap(mine, others, radius);
      if (!s) break;
      p.pos.x += s.dx; p.pos.y += s.dy;
    }
    // Guarantee no overlap on release: push out of any overlapping neighbour.
    const otherPolys = otherPieces.map(q => transformPolygon(polygons[q.type], q.pos, q.angle, q.flipped));
    for (let pass = 0; pass < 12; pass++) {
      const mine = transformPolygon(polygons[p.type], p.pos, p.angle, p.flipped);
      let moved = false;
      for (const qp of otherPolys) {
        const mtv = overlapMTV(mine, qp);
        if (mtv) { p.pos.x += mtv.x; p.pos.y += mtv.y; moved = true; break; }
      }
      if (!moved) break;
    }
    return p;
  }

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
  // How many target slots are currently filled by a correctly placed piece.
  // Each slot is consumed at most once, so two identical pieces stacked on the
  // same slot still count as one. Used to measure a student's progress on the
  // board (see the stuck-hint assist in index.html).
  function countPlacedInSlots(pieces, slots, polygons, tol) {
    tol = tol == null ? 0.05 : tol;
    const used = new Array(slots.length).fill(false);
    let n = 0;
    for (const p of pieces) {
      const mine = transformPolygon(polygons[p.type], p.pos, p.angle, p.flipped);
      for (let j = 0; j < slots.length; j++) {
        const s = slots[j];
        if (used[j] || s.type !== p.type) continue;
        if (_polysMatch(mine, transformPolygon(polygons[s.type], s.pos, s.angle, s.flipped), tol)) {
          used[j] = true; n++; break;
        }
      }
    }
    return n;
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

  return { rotatePoint, transformPolygon, polygonArea, polygonCentroid,
    pointInPolygon, snapAngle, snapToGrid, findVertexSnap, overlapMTV,
    snapPieceToNeighbors, polysMatch: _polysMatch, countPlacedInSlots, isSolved,
    POS_TOL, GRID_SIZE, SNAP_RADIUS };
});
