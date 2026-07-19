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
    const refCanvas = opts.refCanvas || null;
    const boardTarget = opts.boardTarget !== false; // draw target outline on the board (fill guide)
    const targetGuideLines = !!opts.targetGuideLines; // also show internal piece cut-lines in the target
    const onSolve = opts.onSolve || function () {};
    const onSelect = opts.onSelect || function () {};
    const ctx = canvas.getContext('2d');

    // Scatter pieces in a grid that fits the board width, spaced so the larger
    // pieces don't start overlapping. Assembly happens by dragging them together.
    const perRow = Math.max(1, Math.floor((canvas.width / PPU - 0.6) / 2.1));
    let pieces = pieceSet.map((t, i) => ({
      id: i, type: t, angle: 0, flipped: false,
      pos: { x: 1.2 + (i % perRow) * 2.1, y: 1.3 + Math.floor(i / perRow) * 2.2 }
    }));
    let selected = null, dragging = false, startPx = null, grab = null, solved = false;

    const wp = p => E.transformPolygon(polygons[p.type], p.pos, p.angle, p.flipped);
    const u2p = p => ({ x: p.x * PPU, y: p.y * PPU });
    const p2u = p => ({ x: p.x / PPU, y: p.y / PPU });

    // Target outline drawn ON the board (a fill-guide): the solution silhouette
    // translated to a fixed spot in the lower-middle of the board. Internal
    // piece lines stay hidden; the student drops pieces onto it to fill it.
    let boardTargetPolys = null, targetSlots = null;
    if (solution) {
      const worlds = solution.map(s => E.transformPolygon(polygons[s.type], s.pos, s.angle, s.flipped));
      const xs = worlds.flat().map(p => p.x), ys = worlds.flat().map(p => p.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      const ox = canvas.width / PPU / 2 - cx, oy = canvas.height / PPU * 0.56 - cy;
      if (boardTarget) boardTargetPolys = worlds.map(poly => poly.map(v => ({ x: v.x + ox, y: v.y + oy })));
      // Each target slot = a solution piece translated onto the board. Dropping
      // a piece near its slot snaps it exactly into place (position + orientation).
      targetSlots = solution.map(s => ({ type: s.type, angle: s.angle, flipped: s.flipped, pos: { x: s.pos.x + ox, y: s.pos.y + oy } }));
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (boardTargetPolys) {
        ctx.save();
        // Solid slate fill. With targetGuideLines, stroke each piece in white to
        // reveal the internal cut-lines (a guided hint); otherwise stroke in the
        // fill colour so only the outer silhouette shows (harder).
        ctx.fillStyle = '#c7cedb';
        ctx.strokeStyle = targetGuideLines ? '#ffffff' : '#c7cedb';
        ctx.lineWidth = targetGuideLines ? 2 : 1.5; ctx.lineJoin = 'round';
        boardTargetPolys.forEach(poly => {
          ctx.beginPath();
          poly.forEach((v, i) => { const p = u2p(v); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); });
          ctx.closePath(); ctx.fill(); ctx.stroke();
        });
        ctx.restore();
      }
      pieces.forEach(p => {
        const poly = wp(p).map(u2p);
        ctx.beginPath();
        poly.forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y));
        ctx.closePath();
        ctx.fillStyle = COLORS[p.type] || '#888'; ctx.fill();
        ctx.strokeStyle = (p === selected) ? '#000' : '#fff';
        ctx.lineWidth = (p === selected) ? 3 : 2; ctx.stroke();
      });
    }
    // Draw the target silhouette on a SEPARATE canvas (above the board) at full
    // (100%) scale — the same PPU as the pieces — so it reads as a true-size hint.
    function drawReference() {
      if (!refCanvas || !solution) return;
      const worlds = solution.map(s => E.transformPolygon(polygons[s.type], s.pos, s.angle, s.flipped));
      const xs = worlds.flat().map(p => p.x), ys = worlds.flat().map(p => p.y);
      const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
      const pad = 6;
      refCanvas.width = Math.ceil((maxx - minx) * PPU) + pad * 2;
      refCanvas.height = Math.ceil((maxy - miny) * PPU) + pad * 2;
      const rctx = refCanvas.getContext('2d');
      rctx.clearRect(0, 0, refCanvas.width, refCanvas.height);
      // Solid silhouette only — internal piece boundaries stay hidden so the
      // student still has to work out which piece goes where (the puzzle).
      // Stroke each piece in the SAME colour as the fill to cover sub-pixel
      // anti-aliasing seams where adjacent pieces meet.
      rctx.fillStyle = '#1e2a4a'; rctx.strokeStyle = '#1e2a4a'; rctx.lineWidth = 1.5;
      rctx.lineJoin = 'round';
      worlds.forEach(poly => {
        rctx.beginPath();
        poly.forEach((v, i) => {
          const x = (v.x - minx) * PPU + pad, y = (v.y - miny) * PPU + pad;
          i ? rctx.lineTo(x, y) : rctx.moveTo(x, y);
        });
        rctx.closePath(); rctx.fill(); rctx.stroke();
      });
    }
    const evtU = e => {
      const r = canvas.getBoundingClientRect();
      // account for the canvas being CSS-scaled (max-width:100%) on small phones
      const sx = canvas.width / r.width, sy = canvas.height / r.height;
      return p2u({ x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy });
    };
    const hit = u => { for (let i = pieces.length - 1; i >= 0; i--) if (E.pointInPolygon(u, wp(pieces[i]))) return pieces[i]; return null; };
    var SLOT_SNAP = 0.7; // must be dropped this close (units) AND already at the right angle
    function polysCoincide(a, b, tol) {
      if (a.length !== b.length) return false;
      const used = new Array(b.length).fill(false);
      for (const va of a) {
        let f = -1;
        for (let j = 0; j < b.length; j++) if (!used[j] && Math.hypot(va.x - b[j].x, va.y - b[j].y) <= tol) { f = j; break; }
        if (f < 0) return false; used[f] = true;
      }
      return true;
    }
    function snap(p) {
      // 1) Stick to the gray target ONLY if the piece is ALREADY rotated correctly
      //    for a slot AND dropped close to it. It does NOT fix a wrong angle for you
      //    — the student must rotate the piece to the right orientation first.
      if (targetSlots) {
        let best = null, bestD = SLOT_SNAP;
        for (const slot of targetSlots) {
          if (slot.type !== p.type) continue;
          if (pieces.some(q => q !== p && Math.hypot(q.pos.x - slot.pos.x, q.pos.y - slot.pos.y) < 0.25)) continue;
          const d = Math.hypot(p.pos.x - slot.pos.x, p.pos.y - slot.pos.y);
          if (d >= bestD) continue;
          // orientation gate: the piece, at its CURRENT angle/flip, must produce the slot's shape
          const mine = E.transformPolygon(polygons[p.type], slot.pos, p.angle, p.flipped);
          const want = E.transformPolygon(polygons[slot.type], slot.pos, slot.angle, slot.flipped);
          if (!polysCoincide(mine, want, 0.02)) continue;
          bestD = d; best = slot;
        }
        if (best) { p.pos = { x: best.pos.x, y: best.pos.y }; return; } // fine-tune position only; angle already right
      }
      // 2) Otherwise assemble edge-to-edge against neighbours (angle snaps to 45deg).
      const others = pieces.filter(q => q !== p);
      const settled = E.snapPieceToNeighbors(p, others, polygons, E.SNAP_RADIUS, 3);
      p.pos = settled.pos; p.angle = settled.angle;
    }
    function check() { if (solved || !solution) return; if (E.isSolved(pieces, solution, polygons)) { solved = true; onSolve(); } }

    function onDown(e) {
      try { if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId); } catch (_) {}
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
    drawReference();

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
