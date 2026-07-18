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

  return { rotatePoint, transformPolygon, polygonArea, polygonCentroid,
    pointInPolygon, snapAngle, snapToGrid, findVertexSnap, POS_TOL, GRID_SIZE, SNAP_RADIUS };
});
