# Battleship Coordinate Game — Design

Date: 2026-07-26

## Context

Teachers wanted another station game: a **coordinate-graphing Battleship**
where students practice reading/writing ordered pairs `(x, y)` by firing at
a hidden computer fleet (reference: "Coordinate Graphing Battleship" worksheet,
Seacoast Science Center). It joins the existing set of self-contained games
(Sudoku, Sifir, Tangram, Jejak Lari, Crossword, Lembaran Kerja).

Unlike the two-player paper original, this is **single-player vs. the
computer**: the computer places a hidden fleet, the student fires coordinates
until every ship sinks or time runs out. Decisions locked during
brainstorming:

- **11×11 grid**, axes `0`–`10`, **first quadrant only** (no negative
  coordinates) — true Cartesian orientation, y=0 row at the bottom.
- **One-directional play**: student attacks the computer's fleet only. The
  computer never fires back and the student never places ships — this keeps
  the game focused purely on reading/writing coordinates.
- **Classic 5-ship fleet** from the worksheet: Lookout Cruiser (2), Submarine
  (3), Battleship (3), Destroyer (4), Pirate ship (5) — 17 cells total,
  placed horizontally or vertically, no overlaps, in an 11×11 (121-cell) grid.
- **Fleet status panel**: all 5 ships listed by name/size, struck through
  when sunk, with a "Kapal [name] tenggelam!" message on the sinking shot.
- **Unlimited shots** until the round ends — no accuracy/attempts penalty.
- **Numpad coordinate entry**: `(x, y)` boxes + docked on-screen keypad (same
  interaction family as the crossword numpad), not native `<input>`.
  Already-fired cells can't be re-fired.
- **Fresh random fleet every playthrough** (like crossword's
  `generatePuzzle`) so students can't share answers.
- **Scoring**: `round(shipsSunk / 5 * 100)`, minus a flat 20-point late
  penalty if time runs out before the fleet is fully sunk (clamped at 0) —
  identical shape to crossword/sudoku.
- **Visual theme**: existing pirate/ocean palette
  (`--navy`/`--gold`/`--cream`, wood-plank `.card` in participant-mode), ships
  drawn as simple labeled grid cells — no new sprite work.
- **No admin config UI** — baked-in content like Sudoku/Sifir/Crossword.

## Architecture

Follows the crossword pattern: a pure **engine module** (testable under
`node --test`) holds fleet generation + shot logic, while rendering, input,
and lifecycle live inline in `index.html` next to `startCrossword`/`renderCrossword`.

### New: `battleship/engine.js` (UMD, like `crossword/engine.js`)

Exposes `root.BattleshipEngine` / `module.exports`:

- **`GRID_SIZE`** = `11` (coordinates `0`–`10` inclusive on each axis).
- **`FLEET_SPEC`** = `[{name:'Lookout Cruiser', length:2}, {name:'Submarine', length:3}, {name:'Battleship', length:3}, {name:'Destroyer', length:4}, {name:'Pirate ship', length:5}]`.
- **`generateFleet(rng)`** → places each ship from `FLEET_SPEC` at a random
  cell + random orientation (horizontal/vertical), retrying on out-of-bounds
  or overlap with an already-placed ship, until all 5 fit. Returns
  `[{name, length, cells:[{x,y}, ...], hits:Set-like array of booleans}]`
  (plain arrays/objects only — no `Set`/class instances — to stay JSON-friendly
  and trivially testable). Deterministic given a seeded `rng` (defaults to
  `Math.random`), mirroring crossword's injectable-RNG convention.
- **`fireAt(fleet, shotLog, x, y)`** — pure function, does not mutate inputs;
  returns a new `{shotLog, result}` where `result` is one of
  `'already-shot' | 'miss' | 'hit' | 'sunk'`, plus the sunk ship's `name` when
  applicable. `shotLog` is a plain map `"x,y" → 'hit'|'miss'` the caller
  threads through subsequent calls (same threading style as crossword's
  `answers` map).
- **`isFleetSunk(fleet, shotLog)`** → `true` once every ship cell has a
  recorded hit.
- **`countSunk(fleet, shotLog)`** → number of fully-sunk ships (drives the
  0–5 score numerator).

### Edits to `index.html`

- **Head:** `<script src="battleship/engine.js"></script>`.
- **`GAME_TYPES`:** add `{id:'battleship', name:'Battleship Koordinat'}`.
- **`renderGame(st)`:** add `else if(st.gameType==='battleship'){ startBattleship(st); return; }`.
- **New functions** (mirroring the crossword block):
  - `startBattleship(st)` — generate a fresh fleet via `BattleshipEngine.generateFleet()`,
    set `gameState.type='battleship'`, `total=5`, `correct=0`, stash
    `{station, fleet, shotLog:{}, pendingX:'', pendingY:'', activeField:'x'}`,
    register `window._battleshipTimeout = () => finishBattleship(false)`, add
    `document.body.classList.add('battleship-mode')`, then render.
  - `renderBattleship()` — build the 11×11 board (y=10 row first, y=0 row
    last, so it reads bottom-up like a Cartesian plane), the fleet status
    list, the `(x, y)` coordinate boxes, the docked numpad, and a "Tembak"
    button.
  - Numpad handlers — `selectBsField('x'|'y')`, `bsInput(digit)`,
    `bsBackspace()` (mirrors `cwInput`/`cwBackspace`, digits clamped so the
    typed value never exceeds `10`), `hideBsPad()`.
  - `fireBattleship()` — reads `pendingX`/`pendingY` (both required), calls
    `BattleshipEngine.fireAt`, updates the fired cell's mark (`X`/`O`), updates
    the score bookkeeping (`gameState.correct = BattleshipEngine.countSunk(...)`),
    shows a "tenggelam" message on `sunk`,
    clears the pending boxes, and calls `finishBattleship(true)` once
    `isFleetSunk` is true.
  - `finishBattleship(onTime)` — mirror `finishCrossword`: reveal any
    remaining unhit ship cells, `score = round(correct/5*100)`, `-20` if
    `!onTime`; route through `showTestResult` (test mode) or `submitCompletion`.
- **`tick()` timeout block:** add
  `if(gameState && gameState.type==='battleship' && window._battleshipTimeout){ window._battleshipTimeout(); }`.
- **`startGame`:** null out `window._battleshipTimeout` alongside the other
  reset slots (no other change needed — battleship starts the shared timer
  like crossword/sudoku).
- **`show(id)`:** extend the existing crossword-mode cleanup line to also
  clear `battleship-mode` when leaving the game view.
- **CSS:** `.battleship-board` (11×11 CSS grid, water/hit/miss cell states),
  `.bs-cell.ship-revealed` (end-of-round reveal), `.bs-fleet-status` (ship
  list, `.sunk` strike-through state), `.bs-coord` (the `(x, y)` boxes) and a
  `.bs-pad` docked keypad reusing the crossword numpad's structure, plus a
  `battleship-mode` `@media (max-width:720px)` block cloned from the
  `crossword-mode` fixed-height flex layout.

## Interaction detail

- **Board orientation:** column headers `0`–`10` along the bottom (x-axis),
  row headers `0`–`10` bottom-to-top along the left (y-axis) — row `y=10` is
  the first DOM row, row `y=0` is the last, so the grid reads as a real
  coordinate plane rather than a top-down screen grid.
- **Firing:** tapping the x-box shows the numpad and highlights x as active;
  a digit appends (clamped 0–10, single overwrite past 2 digits mirrors
  crossword's leading-zero guard); tapping the y-box switches the active
  field the same way. "Tembak" is disabled/no-ops until both boxes have a
  value. Firing an already-shot cell shows a small inline message
  ("Sudah ditembak di sini") and does not consume a "turn" (there's no turn
  limit anyway, but it should not re-log or re-animate the cell).
- **Feedback:** hit → cell shows a red `X`; miss → cell shows a grey `O`;
  sinking a ship crosses it off the fleet panel and shows a toast-style
  message with the ship's name.
- **Round end:** whether by winning or timing out, every ship cell that
  wasn't hit gets revealed (a lighter fill, distinguishable from a miss) so
  the student can see the answer.

## Error / edge handling

- `generateFleet` retries placement on collision; a hard iteration cap (e.g.
  1000 attempts) falls back to a **fixed known-good layout** shipped in the
  engine, mirroring crossword's `FALLBACK_PUZZLE` safety net, so the game
  never breaks in class even in a pathological RNG run.
- Firing requires both coordinates in range `0`–`10`; out-of-range or
  incomplete input disables "Tembak" rather than erroring.
- Timeout auto-finishes with partial credit (ships sunk so far), same as
  every other timed game.
- Test mode ("Uji Cara Main Stesen Ini") runs the identical flow and shows
  the result locally without saving.

## Testing

- `battleship/engine.test.js` (runs under existing `node --test`):
  - `generateFleet` stress loop (~500 iterations): every ship in range,
    correct length, only horizontal/vertical, no overlaps between any two
    ships, all 5 ships placed.
  - `fireAt`: hit/miss/already-shot/sunk transitions on a small hand-built
    fleet; firing every cell of a ship returns `'sunk'` exactly once, on the
    last cell.
  - `isFleetSunk` / `countSunk` correctness on partial and full shot logs.
- `tests/battleship.spec.js` (Playwright, mirrors `crossword.spec.js`):
  1. Full play-through: read the generated fleet from `gameState.battleship`,
     fire every ship cell via the numpad/evaluate, assert the fleet panel
     shows all 5 sunk and the round finishes with `Markah: 100`.
  2. Timeout keeps partial credit and applies the late penalty.
  3. Phone-viewport (390×844) layout check: board, fleet panel, coordinate
     boxes, and numpad all stay on-screen with no page scroll after firing —
     same assertions as the crossword mobile-layout test.
- Manual: admin (PIN `1234`) → add a Battleship station → "▶️ Uji Cara Main
  Stesen Ini": confirm coordinate entry, hit/miss marks, fleet panel, sinking
  message, end-of-round reveal, and score.
