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
  // Authored target shapes. Each is 7 placements {type,pos,angle(deg),flipped}.
  // segiempat: the exact standard-tangram dissection of the 2*sqrt2 square.
  // kuda: a non-overlapping horse silhouette (facing left).
  const SOLUTIONS = {
    segiempat: [
      { type: 'largeTri', pos: { x: 4.5, y: 3.557191 }, angle: 135, flipped: true },
      { type: 'largeTri', pos: { x: 3.557191, y: 4.5 }, angle: 45, flipped: true },
      { type: 'medTri', pos: { x: 5.442809, y: 5.442809 }, angle: 90, flipped: true },
      { type: 'smallTri', pos: { x: 5.678511, y: 3.792893 }, angle: 225, flipped: true },
      { type: 'smallTri', pos: { x: 4.5, y: 4.971405 }, angle: 45, flipped: false },
      { type: 'square', pos: { x: 5.207107, y: 4.5 }, angle: 45, flipped: false },
      { type: 'para', pos: { x: 4.146447, y: 5.56066 }, angle: 135, flipped: false },
    ],
    kuda: [
      { type: 'largeTri', pos: { x: 4.667, y: 5.667 }, angle: 0,   flipped: false }, // body (upper-left half)
      { type: 'largeTri', pos: { x: 5.333, y: 6.333 }, angle: 180, flipped: false }, // body (lower-right half) -> 2x2 square barrel
      { type: 'para',     pos: { x: 3.4,   y: 4.2 },   angle: 45,  flipped: false }, // neck (rising up-left)
      { type: 'medTri',   pos: { x: 2.5,   y: 3.05 },  angle: 225, flipped: false }, // head
      { type: 'smallTri', pos: { x: 4.3,   y: 7.667 }, angle: 180, flipped: false }, // front leg
      { type: 'smallTri', pos: { x: 6.5,   y: 7.667 }, angle: 180, flipped: false }, // back leg
      { type: 'square',   pos: { x: 6.5,   y: 6.5 },   angle: 0,   flipped: false }, // rump / hindquarter
    ],
  };

  return { PIECE_POLYGONS, PIECE_SET, SOLUTIONS };
});
