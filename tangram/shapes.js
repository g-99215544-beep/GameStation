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
    // A rearing horse (classic tangram figure). Every piece shares a full edge
    // or a vertex with a neighbour so the vertex-snap "assist stick" reliably
    // locks the arrangement together — see the reachability test in engine.test.js.
    // Rearing horse (classic tangram): head up, square neck, blue chest + an
    // orange hindquarter rotated 45deg (right-angle tip = the rump pointing
    // right), raised front leg, hind leg down, parallelogram tail down-right.
    kuda: [
      { type: 'medTri',   pos: { x: 3,      y: 2.6667 }, angle: 45,  flipped: false }, // head (points up)
      { type: 'square',   pos: { x: 3.5,    y: 3.5 },    angle: 0,   flipped: false }, // neck
      { type: 'largeTri', pos: { x: 3.3333, y: 4.6667 }, angle: 90,  flipped: false }, // chest
      { type: 'largeTri', pos: { x: 4.4714, y: 5.4142 }, angle: 135, flipped: false }, // hindquarter (rotated -> rump points right)
      { type: 'smallTri', pos: { x: 1.6667, y: 4.6667 }, angle: 180, flipped: false }, // raised front leg (points left)
      { type: 'smallTri', pos: { x: 3.6667, y: 7.1618 }, angle: 90,  flipped: false }, // hind leg (points down)
      { type: 'para',     pos: { x: 5.7678, y: 6.4749 }, angle: 45,  flipped: false }, // tail (down-right)
    ],
    // Sitting cat: two ears, medium-triangle face, two large triangles as the
    // seated body, a square paw, and a parallelogram tail curving up-right.
    kucing: [
      { type: 'smallTri', pos: { x: 1.3333, y: 2.6667 }, angle: 270, flipped: false }, // left ear
      { type: 'smallTri', pos: { x: 2.6667, y: 2.6667 }, angle: 180, flipped: false }, // right ear
      { type: 'medTri',   pos: { x: 2,      y: 3.3333 }, angle: 225, flipped: false }, // face
      { type: 'largeTri', pos: { x: 1.3333, y: 5.3333 }, angle: 180, flipped: false }, // body (left)
      { type: 'largeTri', pos: { x: 2.6667, y: 5.3333 }, angle: 270, flipped: false }, // body (right)
      { type: 'square',   pos: { x: 3.5,    y: 6.5 },    angle: 0,   flipped: false }, // paw
      { type: 'para',     pos: { x: 4.5,    y: 5 },      angle: 90,  flipped: false }, // tail (up-right)
    ],
  };

  return { PIECE_POLYGONS, PIECE_SET, SOLUTIONS };
});
