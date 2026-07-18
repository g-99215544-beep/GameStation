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
      const others = pieces.filter(q => q !== p);
      const settled = E.snapPieceToNeighbors(p, others, polygons, E.SNAP_RADIUS, 3);
      p.pos = settled.pos; p.angle = settled.angle;
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
