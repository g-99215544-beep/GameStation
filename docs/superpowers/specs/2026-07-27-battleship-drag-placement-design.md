# Battleship Drag Placement — Design

Date: 2026-07-27

## Context

The two-way Battleship station currently opens with a **placement phase**
driven by the same coordinate numpad used for firing: the student types
`(x, y)`, picks Melintang/Menegak, and presses "Letak", one ship at a time in
a fixed order. Teachers want that replaced: during placement the student
should **pick a ship, drag it onto the grid, and tap it to rotate** — no
coordinate entry at all.

Coordinate practice is not lost. The firing phase is untouched, and firing is
where the student actually reads and writes ordered pairs. Placement becomes
what it is on a paper board: arranging your fleet.

Decisions locked during brainstorming:

- **Tap rotates a ship that is already on the grid**, not one still in the
  dock. Rotation is 90° clockwise, which for a straight ship means
  horizontal ↔ vertical.
- **The ship's starting cell is the pivot.** A 3-cell ship at `(4,2)`–`(6,2)`
  horizontal becomes `(4,2)`–`(4,4)` vertical. This matches how the engine
  already stores a ship (origin + orientation) and is the easiest rule to
  explain to a child.
- **A placed ship can be dragged again** to move it, any number of times,
  until the student starts the battle.
- **All five ships sit in a dock below the grid**, drawn as chains of cells at
  their true lengths (2, 3, 3, 4, 5) with their names. **Any order** — the
  fixed 1/5, 2/5 … sequence goes away.
- **The ship follows the finger from wherever it was grabbed.** Grab a ship by
  its middle cell and the middle cell stays under the finger; the ship never
  jumps to the hand.
- **An explicit "Sedia! Mula Menembak" button** starts the battle, enabled
  once all five ships are on the grid. Auto-starting on the fifth ship would
  take away the rearranging the drag interface exists to allow.
- **Pointer Events**, not the HTML5 drag-and-drop API, which does not work on
  a touch screen without a polyfill. Phones are the primary target.
- Firing phase, scoring, the computer's turn, the loss reset, and the shot
  animations are **unchanged**.

## Architecture

No new engine functions. `battleship/engine.js` already exposes everything the
drag interface needs:

- `shipCells(x, y, length, orientation)` — the cells a placement would occupy.
- `canPlace(occupiedCells, x, y, length, orientation)` — bounds + overlap check.

Moving or rotating a ship that is **already on the grid** reuses `canPlace`
by building `occupiedCells` from every ship **except the one being moved**, so
a ship is never treated as overlapping itself.

All new work is in `index.html`, beside the existing battleship block.

### Placement state

`gameState.battleship` loses `placingIndex` and `orientation` (both artefacts
of the one-at-a-time flow) and gains:

- `playerFleet` — unchanged in shape (`{name, length, cells}`), but now filled
  in whatever order the student places ships. A ship is "in the dock" when no
  entry in `playerFleet` carries its name.
- `drag` — `null` when idle, otherwise
  `{name, length, orientation, grabIndex, fromGrid, pointerId, cells}`.
  `grabIndex` is which cell of the ship (0-based, from its starting cell) the
  student grabbed, so the ship keeps its offset under the finger. `cells` is
  the currently previewed placement, or `null` when the pointer is off-grid.

### Functions added to `index.html`

- `renderBsDock()` — the five ships as cell chains, marking placed ones as
  spent.
- `bsPointerDown(event)` — starts a drag from a dock ship or a grid ship;
  records the grab cell and captures the pointer.
- `bsPointerMove(event)` — moves the drag ghost, resolves the cell under the
  pointer via `document.elementFromPoint`, computes the candidate origin from
  `grabIndex`, and paints the preview.
- `bsPointerUp(event)` — placement on a valid preview, otherwise return the
  ship to where it came from; below the movement threshold, treat as a tap and
  call `rotateBsShip`.
- `rotateBsShip(name)` — flips orientation about the starting cell, validated
  with `canPlace`.
- `bsStartBattle()` — generates the enemy fleet, moves to `phase:'playing'`,
  and renders the firing screen.

### Functions removed

- `setBsOrientation` and the Melintang/Menegak buttons.
- `placeBsShip` and the placement use of `bsCoordRow` — the coordinate boxes
  and numpad now exist only in the firing phase.
- `bs.placingIndex` and the "Letak <ship> — N petak (i/5)" prompt, replaced by
  a standing instruction and the dock itself.

`resetBsPlacement` ("Susun Semula") stays: it empties `playerFleet` and
returns every ship to the dock.

### CSS added

- `.bs-dock` / `.bs-dock-ship` / `.bs-dock-cell` — the ship tray.
- `.bs-dock-ship.placed` — dimmed, non-draggable.
- `.bs-drag-ghost` — the absolutely positioned chain of cells that follows the
  pointer, `pointer-events:none` so `elementFromPoint` sees the board beneath.
- `.bs-cell.preview-ok` / `.bs-cell.preview-bad` — green/red target highlight.
- A `battleship-mode` mobile block for the dock, matching the existing
  full-height flex layout. `fitBsBoard()` keeps sizing the board; the dock is
  measured as part of the space it must fit around.

## Interaction detail

- **Grabbing.** `pointerdown` on a dock ship or on a grid cell belonging to a
  placed ship starts a drag. The board is `touch-action:none` during placement
  so a drag does not scroll the page. A ship leaves the dock **horizontal**;
  it is turned after it lands, by tapping it. A ship dragged from the grid
  keeps the orientation it already has.
- **Preview.** While dragging, the candidate cells are highlighted green when
  `canPlace` accepts them and red when it does not — essential on a phone,
  where the finger covers the board. When the pointer is outside the grid
  entirely, no cells are highlighted.
- **Dropping.** A green drop places the ship. A red or off-grid drop returns
  the ship to where it started (dock or previous cells) and shows
  "Tidak muat di situ."
- **Tap to rotate.** If the pointer travels less than **8px** between down and
  up, it is a tap, not a drag. A tap on a placed ship rotates it about its
  starting cell. A rotation that would run off the grid or hit another ship is
  refused, the ship keeps its current cells, and the same "Tidak muat di situ."
  message appears. A tap on a dock ship does nothing — rotation happens on the
  grid.
- **Starting.** "Sedia! Mula Menembak" is disabled until `playerFleet` holds
  all five ships; pressing it generates the enemy fleet and switches to the
  firing screen, which behaves exactly as it does today.

## Error / edge handling

- A `pointercancel` (call, notification, browser gesture) aborts the drag and
  restores the ship to its origin, same as an invalid drop.
- A second pointer during a drag is ignored: the drag tracks the `pointerId`
  it started with.
- `elementFromPoint` returning a non-cell element (dock, message, page
  background) means "no valid target": preview cleared, drop returns the ship.
- The timer keeps running through placement, unchanged. If the station times
  out mid-placement, `finishBattleship(false)` reports zero ships sunk and the
  late penalty — the existing timeout path already handles this.
- **Accepted consequence:** with the numpad gone from placement, there is no
  non-pointer way to arrange a fleet. A student with a broken touch screen or
  keyboard-only input cannot place ships. No fallback is included; adding one
  later would be a separate change.

## Testing

- `tests/battleship.spec.js` (Playwright) — the existing `placeFleet` helper
  drives the numpad and must be rewritten to drag instead. Chromium dispatches
  pointer events for `page.mouse`, so a drag is `mouse.move` → `mouse.down` →
  several `mouse.move` steps → `mouse.up`, and one test drives a raw
  touch-pointer sequence via `page.touchscreen` / dispatched events to prove
  the phone path works. Cases:
  1. Drag every ship from the dock onto the grid; the dock empties and each
     ship lands on the cells it was dropped on.
  2. A drop that runs off the grid returns the ship to the dock, with the
     "Tidak muat" message and no change to `playerFleet`.
  3. A drop overlapping a placed ship is refused the same way.
  4. Tapping a placed ship rotates it about its starting cell.
  5. Tapping a ship that cannot rotate (blocked by an edge or a neighbour)
     leaves its cells unchanged and shows the message.
  6. Dragging a placed ship moves it, and the vacated cells become water.
  7. "Sedia! Mula Menembak" is disabled with four ships placed and enabled
     with five; pressing it opens the firing screen.
  8. The phone-viewport layout test still passes: dock, board, and buttons on
     screen with no page scroll, and the whole grid inside its frame.
- Existing firing-phase tests (win path, timeout penalty, computer reply, loss
  reset, animation) keep their assertions and only swap in the new
  `placeFleet`.
- `battleship/engine.test.js` is untouched — no engine change.
- Manual: admin (PIN `1234`) → station with game type "Battleship Koordinat" →
  "▶️ Uji Cara Main Stesen Ini", on a phone-width window: drag each ship in,
  tap to rotate, drag one to a new spot, try an off-grid drop, press Susun
  Semula, then start the battle and fire a shot.
