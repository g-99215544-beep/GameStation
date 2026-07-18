# Tangram Challenge — Design Spec

**Date:** 2026-07-18
**Status:** Approved for planning
**App:** Game Station Matematik (`index.html`, single-file vanilla JS + Firebase)

## 1. Purpose & scope

Add a new interactive station game type, `tangram`, to replace "just quizzes" at a
station. Students receive the 7 standard tangram pieces scattered on a board, plus a
small reference silhouette of a target animal. They **drag** pieces, **tap** to rotate
45° clockwise, and pieces **snap edge-to-edge** to each other. The puzzle is solved when
the arrangement matches the target — regardless of where on the board it is built or how
the whole assembly is rotated.

**v1 target shapes (2 only):**
1. `segiempat` — the pieces reassembled into the original square (easy tutorial / warm-up).
2. `kuda` — a horse silhouette (the challenge).

Adding more shapes later = adding a new solution data entry; no engine changes.

**Non-goals for v1:** in-app shape authoring tool; multiplayer; partial-credit scoring.

## 2. The pieces

Standard 7-piece tangram, all vertices on a 45° grid:

- 2 × large right-isosceles triangle
- 1 × medium right-isosceles triangle
- 2 × small right-isosceles triangle
- 1 × square
- 1 × parallelogram

Each piece is defined once by a **local polygon** (its vertices in its own coordinate
frame, centroid-centered). Proportions (small-triangle leg = `a`): small legs `a`, medium
legs `a√2`, large legs `2a`, square side `a`, parallelogram sides `a` and `a√2`. Total
area `8a²`, i.e. a source square of side `2√2·a`.

Per-piece runtime state:

```js
{ type, pos:{x,y}, angle /* multiple of 45° */, flipped:false }
```

Only the parallelogram is chiral, so only it exposes a flip control.

## 3. Target shape data (single source of truth)

A target shape is an array of 7 placements:

```js
{ shape:'kuda', pieces:[ { type, tx, ty, angle, flipped }, ... ] }
```

This same data is used for **two** things:

1. **Solution check** (section 5).
2. **Reference silhouette** — render all target pieces filled solid, union them, scale
   down, and show at the top corner as the "what to build" hint. No external images.

The `segiempat` solution's placements must exactly reassemble the source square; this is
enforced by test **T1** (section 7), which is the authority on placement coordinates. Any
coordinate error is caught by T1, so placements are produced during implementation under
that test rather than hand-copied here.

## 4. Interaction (touch-first)

Runs on student phones — all gestures must work with touch on a small screen.

- **Drag** (pointer/touch move past a small threshold) = move the piece.
- **Tap** (pointer down+up, movement below threshold, short duration) = rotate the piece
  **45° clockwise** about its centroid.
- **Snap on release:**
  - Position snaps to the nearest node of a fine global grid.
  - Angle snaps to the nearest 45°.
  - If a vertex of the released piece is within a small radius of a vertex of another
    placed piece, snap exactly to that vertex ("assist stick to side"). Because all pieces
    share the same grid, coincident vertices make edges line up automatically.
- **Flip control:** a "↔ Balik" button appears only while the parallelogram is selected;
  it mirrors that piece. The `segiempat` tutorial does not require it.
- **Selection feedback:** the active piece lifts above others (draw order) with a shadow.

## 5. Solution detection (position/rotation invariant)

The assembly is correct wherever it is built and however the whole thing is globally
rotated. Algorithm:

1. Compute centroid `C_cur` of current piece centers and `C_tar` of target piece centers.
2. For each global angle `α ∈ {0,45,…,315}`:
   - Build rotation `R(α)`. Predicted target center for slot *i*:
     `R(α)·(T_i − C_tar) + C_cur`, and predicted target angle `φ_i + α`.
   - **Type-constrained matching:** match each current piece to an unused target slot of
     the **same piece type**, requiring position within `POS_TOL` and angle within
     `ANG_TOL` (angle compared modulo the piece's rotational symmetry: square 90°,
     parallelogram 180°, triangles none). Interchangeable duplicates (2 large, 2 small)
     may fill either matching slot — try the ≤2 permutations.
   - If all 7 pieces match → **solved**.
3. If no `α` yields a full match → not solved.

Cost is trivial (8 angles × tiny matching). Re-run the check after every piece release.

## 6. Rendering, layout & app integration

**Rendering:** Canvas 2D for full control and phone performance. Hit-testing via
point-in-polygon on transformed piece vertices; topmost piece wins. Pieces drawn in
selection order so the active piece is on top.

**Layout (portrait phone):**

```
+------------------------------+
| Kuda        ⏱ 6:23   [ref]   |   title · shared timer · small silhouette
+------------------------------+
|                              |
|      build board (canvas)    |   7 pieces dragged here
|                              |
+------------------------------+
| ketik keping = putar  ↔ balik|   controls hint + flip button
+------------------------------+
```

**Integration:**
- New `gameType:'tangram'`. `gameDataRaw` = `{"shape":"kuda"}` selecting a built-in shape.
- Enters through the existing `renderGame(st)` switch: a `tangram` branch builds the canvas
  and starts the engine.
- The existing per-station timer runs unchanged.
- On solve, the engine calls the existing `finishGame()`.
- **Scoring is binary** (consistent with `susun_nombor` / `grid_nombor`): `gameState.total=1`;
  solved → `correct=1` → 100 (minus the existing 20 late penalty); time-up before solve →
  `correct=0`. No new scoring code.
- The admin **▶️ Uji** (test) button already added works for `tangram` with no changes,
  since it just launches `renderGame` with the current form values in test mode.

## 7. Build approach & testing

The geometry engine is the risky part, so build and prove it in an **isolated prototype
file** (`tangram-prototype.html`) first, then wire the working engine into `index.html`.
This keeps the live app safe during iteration.

Tests:

- **T1 — square reassembly:** the `segiempat` solution placements tile the 4-unit source
  square exactly: union area equals the square's area and there is zero pairwise overlap.
  This test is the authority on placement coordinates.
- **T2 — solve detection invariance:** a correct arrangement that is globally translated
  and/or rotated by a multiple of 45° reports solved; a wrong arrangement (one piece off)
  reports not solved.
- **T3 — snap:** releasing a piece with a vertex within the snap radius of another piece's
  vertex results in exactly coincident vertices; angle rounds to the nearest 45°.
- **T4 — duplicate interchangeability:** swapping the two large (or two small) triangles
  still reports solved.
- **Manual drive:** exercise the real flow in a browser (drag, tap-rotate, flip, solve,
  and via the admin ▶️ Uji button) as done previously with the test-station feature.

## 8. Open follow-ups (out of v1 scope)

- More target shapes (cat, duck, boat) — data only.
- Optional per-piece "hint glow" if a station needs to be easier.
- In-app authoring tool for teachers.
