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
