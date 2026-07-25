# Crossword Puzzle Station — Design

Date: 2026-07-25

## Context

Teachers wanted another station game: a **math crossword** where interlocking
equations read across and down, and students fill the blank cells with digits
(reference: "Math Crossword Level 5" worksheet). It joins the existing set of
self-contained games (Sudoku, Sifir, Tangram, Jejak Lari, Lembaran Kerja).

Like Sudoku/Sifir/Tangram, the puzzle content is **baked into the code** — there
is no teacher-authoring UI (the raw "Data Game (JSON)" field is hidden and the
JSON-driven game types were removed). Decisions locked during brainstorming:

- **One built-in puzzle**, designed and verified by us (not transcribed from the image).
- **Count-only feedback** on check — no per-cell red marks — consistent with the
  Sudoku change, so students can't brute-force 0–9.
- **Single puzzle** for now (no multi-stage).
- **10-minute** timer (the existing per-station default), **scroll** in all
  directions, **zoom** in/out, and an on-screen **numpad** on cell tap.

## Architecture

Follows the pattern of the other standalone games: a small pure **engine module**
holds the puzzle + logic (testable under `node --test`), while rendering, input,
and lifecycle live inline in `index.html` next to `startSudoku`/`showSudokuStage`.

### New: `crossword/engine.js` (UMD, like `sifir/engine.js`)

Exposes `root.CrosswordEngine` / `module.exports`:

- **`PUZZLE`** — `{cols, rows, grid}`. `grid` is a `rows × cols` array; each cell is:
  - `null` → gap (no box drawn)
  - `{v:'x'}` → **given**: shown, not editable. `v` is a display string —
    an operator (`x`, `÷`, `+`, `-`, `=`) or a fixed number (`18`, `-2`, `6`).
  - `{a:6}` → **blank**: student-fillable. `a` is the correct **single digit 0–9**
    (every blank is one digit, so one numpad tap fills a cell).
- **`blanks(grid)`** → `[{r, c, answer}]` for all blank cells.
- **`grade(grid, answers)`** where `answers` maps `"r,c" → string`; returns
  `{total, correct, wrong, empty, solved}`. `solved` is `correct === total`.
- **`verifySolution(grid)`** → fills every blank with its `a`, scans each maximal
  horizontal and vertical run of non-null cells, and checks that every run which
  forms a complete equation (`... = ...`) evaluates true. Returns `{ok, failures}`.
  This is what guarantees the shipped puzzle is internally consistent.

The concrete grid (~11×11 interlocking equations, all blanks single-digit) is
authored during implementation and locked by the engine test — not hand-specified
here, because the test is the source of truth for its correctness.

### Edits to `index.html`

- **Head:** `<script src="crossword/engine.js"></script>` (beside the other engine includes).
- **`GAME_TYPES`:** add `{id:'crossword', name:'Crossword Puzzle'}`.
- **`renderGame(st)`:** add `else if(st.gameType==='crossword'){ startCrossword(st); return; }`.
- **New functions** (mirroring the Sudoku block):
  - `startCrossword(st)` — set `gameState.type='crossword'`, `total = blanks.length`,
    `correct = 0`, stash `{station, grid, answers:{}, selected:null}`, register
    `window._crosswordTimeout = () => finishCrossword(false)`, then render.
  - `renderCrossword()` — build the scroll viewport + zoomable board + "Semak" button
    + message area. Givens are static boxes; blanks are tappable boxes showing their
    current value.
  - Numpad handlers — `selectCwCell(r,c)`, `cwInput(digit)`, `cwBackspace()`,
    `cwNext()`, `hideCwPad()`.
  - `checkCrossword()` — call `grade`; if `solved` → `finishCrossword(true)`, else
    show count-only message (`"N kotak belum diisi dan M jawapan perlu disemak."`).
  - `finishCrossword(onTime)` — mirror `finishSudoku`: `score = round(correct/total*100)`,
    `-20` if `!onTime`; route through `showTestResult` (test mode) or `submitCompletion`.
- **`tick()` timeout block:** add
  `if(gameState && gameState.type==='crossword' && window._crosswordTimeout){ window._crosswordTimeout(); }`.
- **CSS:** `.crossword-viewport` (scrollable, capped height), `.crossword-board`
  (grid using `--cw-cell`), `.cw-cell` / `.cw-cell.given` / `.cw-cell.blank` /
  `.cw-cell.selected`, `.cw-zoom` buttons, and `.cw-pad` docked keypad — in the
  participant-mode "island" visual style like `.sudoku-*`.

`startGame` needs **no change**: crossword is not tangram/jejak, so it already
starts the shared timer, shows the test banner, and (via `renderGame`) dispatches.

## Interaction detail

- **Scroll:** the board can exceed the viewport; `overflow:auto` gives native
  touch-swipe and scrollbars in every direction.
- **Zoom:** 🔍+ / 🔍− buttons step `--cw-cell` (e.g. 30–64px) and the board
  re-lays-out — chosen over `transform:scale` because it keeps scrolling correct on touch.
- **Numpad:** tapping a blank highlights it and shows the docked keypad
  (`1–9`, `0`, `⌫`, `→`). A digit fills the cell and auto-advances to the next
  empty blank; `⌫` clears the selected cell; `→` jumps to the next empty blank;
  a done/close control hides the pad. Blanks are `<div>`s (not `<input>`) so the
  device keyboard never opens.

## Error / edge handling

- Grading treats empty and wrong the same in the message (count only); never marks
  which cell is wrong.
- Timeout auto-finishes with the partial score (students who can't finish aren't stranded).
- Test mode ("Uji Cara Main Stesen Ini") runs the identical flow and shows the
  result locally without saving — inherited from `startGame`/`finishCrossword`.

## Testing

- `crossword/engine.test.js` (runs under existing `node --test`):
  - `verifySolution(PUZZLE.grid).ok === true` — the shipped puzzle is consistent.
  - `grade` counts `correct`/`wrong`/`empty` correctly and reports `solved` only
    when the full answer key is supplied.
  - `blanks` returns one entry per blank cell.
- Manual: admin (PIN `1234`) → add a Crossword station → "▶️ Uji Cara Main Stesen Ini":
  confirm scroll, zoom, numpad entry, count-only "Semak" message, and that
  completing the grid finishes with a score.
