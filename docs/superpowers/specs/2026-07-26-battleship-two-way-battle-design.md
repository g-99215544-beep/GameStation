# Battleship Two-Way Battle — Design

Date: 2026-07-26

## Context

The Battleship station shipped as a **one-way** game: the computer hid a
fleet, the student fired at it, and the round ended when all 5 enemy ships
sank or the timer expired. The student had no fleet and the computer never
fired back.

The teacher has since asked for the full game: students place their own
fleet before play, the computer fights back, and losing your whole fleet
restarts the round. They also asked for SVG animation — a ship launching a
guided missile, an explosion when it hits an enemy ship, and a splash into
the sea when it misses.

This supersedes the one-directional decision recorded in
`2026-07-26-battleship-coordinate-game-design.md`. Everything else from
that spec still holds: 11×11 first-quadrant grid (coordinates 0–10), the
classic 5-ship fleet, numpad-based coordinate entry (no OS keyboard), no
admin config UI, and the `battleship-mode` full-height mobile flex layout.

Decisions locked during brainstorming:

- **Placement by coordinate entry.** The student types the ship's starting
  `(x, y)` on the existing numpad, picks **Melintang** (horizontal) or
  **Menegak** (vertical), and taps **Letak** — reinforcing the coordinate
  skill the station exists to teach, rather than tapping the grid directly.
- **Strict alternating turns.** Student fires, then the computer fires, one
  shot each per turn.
- **Purely random AI.** The computer picks a random cell it has not fired at
  yet — no targeting, no follow-up on a hit, no pattern of any kind. (An
  earlier draft of this spec called for a hunting AI that chased adjacent
  cells after a hit; the teacher replaced it with plain random fire, which
  is both simpler and gentler on the students.)
- **Loss resets the round, keeping the student's layout.** New computer
  fleet, both boards cleared, the student's ship placement preserved, same
  station timer. Re-placing 5 ships after every loss would burn the
  station's time limit.
- **Score counts enemy ships sunk in the current attempt.** Winning is 100.
  A loss deducts nothing — the lost time is the penalty.
- **Both boards always visible.** Enemy board full-size on top (the one you
  attack), the student's own board below as a compact damage display.
- **~0.8 s of animation per shot** (≈0.5 s missile flight, ≈0.3 s impact),
  so a full turn is ≈1.6 s and a 10-minute station still fits 30–40 turns.
- **A small SVG ship at the board edge launches the missile**, rather than a
  missile appearing from off-screen or reusing the existing pirate-ship PNG.

## Architecture

The split established by the current implementation holds: pure logic in
`battleship/engine.js` (testable under `node --test`), with rendering,
input, and lifecycle inline in `index.html` beside the sibling games.

### Engine additions (`battleship/engine.js`)

`fireAt`, `isFleetSunk`, `countSunk`, `isShipSunk`, and `generateFleet` are
already side-agnostic and need no change — the same `fireAt` resolves both
the student's shots at the computer and the computer's shots at the
student. New pure functions:

- **`shipCells(x, y, length, orientation)`** → the cell list a ship would
  occupy. `orientation` is `'h'` or `'v'`. Extracted from the placement
  logic already inside `generateFleet` so both paths share one definition.
- **`canPlace(occupiedCells, x, y, length, orientation)`** → `true` when
  every resulting cell is inside the 11×11 grid and none collides with
  `occupiedCells`, which is a flat array of `{x, y}` objects (the same shape
  as a ship's `cells`, so callers pass
  `playerFleet.flatMap(s => s.cells)` directly).
- **`nextComputerShot(shotLog, rng)`** → `{x, y}`, or `null` when every cell
  has been fired at (defensive; the round always ends before this in
  practice). Picks uniformly at random among the cells absent from
  `shotLog`, so it never wastes a turn repeating a shot. It holds no memory
  between turns and never inspects a fleet — the whole AI is this one
  stateless choice.

### Game state

`gameState.battleship` grows to carry both sides and the phase:

```
{
  station,
  phase: 'placing' | 'playing',
  playerFleet,        // student's ships, built up during placing
  placingIndex,       // 0..4, which FLEET_SPEC entry is being placed
  orientation,        // 'h' | 'v', the placement toggle
  enemyFleet,         // computer's ships (generateFleet)
  playerShotLog,      // student's shots at the enemy board
  enemyShotLog,       // computer's shots at the student's board
  pendingX, pendingY, activeField,   // numpad entry (unchanged)
  busy,               // true while animating — locks input
  round               // increments each time a loss resets the round
}
```

Two shot logs and two fleets, never merged: the student's board and the
enemy board are independent, and `fireAt` is called with whichever pair
matches the direction of the shot.

### Phases

**`placing`** — the player board renders at full size (it is the thing being
edited); the enemy board is hidden. The prompt names the current ship and
its length ("Letak Submarine — 3 petak"). The action button reads **Letak**
instead of Tembak, with **Melintang**/**Menegak** toggle buttons beside it
and a **Susun Semula** button that clears all placements. A rejected
placement (off-grid or overlapping) shows a message and changes nothing —
without `Susun Semula` a single misplacement would be unrecoverable, which
is why it is in scope rather than a nice-to-have.

When the fifth ship is placed, the phase flips to `playing`, the enemy
fleet is generated, and the layout switches to the two-board view.

**`playing`** — one turn is: student fires → animation → result applied →
win check → computer fires → animation → result applied → loss check.
`busy` is true for the whole turn so a double-tap cannot desync the order.

**Loss** — when `isFleetSunk(playerFleet, enemyShotLog)`, show "Semua kapal
anda musnah! Pusingan baharu bermula.", then reset: new `enemyFleet`, empty
both shot logs, `round++`. `playerFleet` is untouched. The station timer
keeps running throughout.

**Win / timeout** — unchanged from the current implementation:
`finishBattleship(onTime)` with
`score = round(countSunk(enemyFleet, playerShotLog) / 5 * 100)`, `-20` when
`!onTime`, clamped at 0, routed through `showTestResult` or
`submitCompletion`.

### Layout

The existing `battleship-mode` full-height flex column is unchanged — it is
what keeps the numpad and headings on screen without page-level scroll on a
phone, and it already survived a review specifically for that.

- Enemy board: full size, inside the existing `flex:1 1 0; overflow:auto`
  wrapper, so it absorbs whatever vertical space is left and scrolls
  internally on small screens.
- Player board during `playing`: a compact grid at roughly 12 px per cell
  with **no axis labels** — it is a damage readout, not a target, and the
  labels are what make the full board tall. Every cell of the student's own
  ships is visible (they own that information), rendered in three states:
  intact ship, ship cell hit by the computer, and a computer shot that
  missed. Cells the computer has not fired at stay plain water.
- Player board during `placing`: full size with labels, since it is being
  aimed at.
- Enemy ship-name chips stay as they are. The student's side shows a
  compact sunk-count; the mini board itself carries the visual damage.
- **Each board owns its own message line**, directly beneath it: the
  student's shot result under the enemy board, the computer's reply under
  the student's mini board. A single shared line would not work — a turn
  produces two results, and the computer's reply would overwrite the
  student's own result before they could read it.

### SVG animation

A single SVG overlay is absolutely positioned over the board area, sized to
the board it is currently firing at, with `pointer-events: none` so it never
intercepts taps.

- **Launcher** — a small SVG ship (hull path, mast, sail) drawn at the
  bottom edge of the board being fired at.
- **Missile** — a small SVG group (nose triangle, body, fins) that travels a
  quadratic arc from the launcher to the centre of the target cell, rotated
  to face along its path.
- **Hit** — expanding orange/red ring plus short particle spokes, fading out.
- **Miss** — 2–3 expanding blue ripple rings plus a few droplets.

Driven by the **Web Animations API** (`element.animate(...)`): vanilla, no
dependency, and each call exposes a `.finished` promise, so the turn
sequence is written as sequential `await`s rather than nested `setTimeout`
callbacks. Arc keyframes are computed in JS from the launcher and target
coordinates.

Motion is skipped entirely — result applied instantly — when
`window.matchMedia('(prefers-reduced-motion: reduce)')` matches, consistent
with the daily-intro video's existing handling.

## Error / edge handling

- Placement rejects out-of-bounds and overlapping positions with a message;
  the ship is not consumed and `placingIndex` does not advance.
- Firing is blocked while `busy` is true, and the fire button stays disabled
  until both coordinates are entered (existing behaviour).
- Firing an already-shot cell shows "Sudah ditembak di sini." and does not
  consume the turn or trigger the computer's reply (existing behaviour,
  extended so the turn genuinely does not pass).
- `nextComputerShot` skips cells already in `enemyShotLog`, so the computer
  never wastes a turn on a repeat.
- Timeout during `placing` finishes with a score of 0 — no enemy ship can
  have been sunk yet.
- Timeout mid-animation still finishes cleanly: `window._gameOver` is
  checked before any animation result is applied.

## Testing

- **`battleship/engine.test.js`** (`node --test`):
  - `shipCells` for both orientations and several lengths.
  - `canPlace`: accepts a valid position; rejects off-grid in each
    direction; rejects overlap with an occupied cell.
  - `nextComputerShot`: never returns a cell already in `shotLog` across a
    full 121-shot sweep; returns `null` once the grid is exhausted; when
    exactly one cell is left open the random pick is forced to that cell,
    which makes the "only ever picks un-fired cells" contract testable
    without depending on the RNG.
- **`tests/battleship.spec.js`** (Playwright):
  - Placing all 5 ships through the real numpad/orientation UI moves the
    game into `playing` and reveals the enemy board.
  - An overlapping placement is rejected: message shown, ship count
    unchanged.
  - A full turn: the student fires through the UI, the computer's reply
    lands on the student's board, and both boards update.
  - Losing resets the round: boards clear, the student's fleet placement is
    preserved, the game is still playable. Driven deterministically by
    seeding `enemyShotLog` with every cell except the last un-hit player
    ship cell, so the computer's random pick has exactly one square left and
    must take it.
  - Phone viewport (390×844): both boards, the fleet status, coordinate
    boxes and numpad are on screen with no page-level scroll, before and
    after firing.
  - Animations are disabled for tests via the reduced-motion path so the
    suite stays fast and deterministic.

## Delivery order

Built so a working game exists at every checkpoint:

1. Engine logic (`shipCells`, `canPlace`, `nextComputerShot`) + unit tests.
2. Placement phase.
3. Two-way turns, loss/restart, two-board layout.
4. SVG animation layer.

Stopping after step 3 still leaves a complete, playable two-way game; the
animation layer sits on top without changing any game logic.
