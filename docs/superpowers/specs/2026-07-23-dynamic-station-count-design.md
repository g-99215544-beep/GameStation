# Dynamic Station Count + Admin Tab Reorder — Design

**Date:** 2026-07-23
**Status:** Approved, ready for implementation plan

## Summary

Two related admin changes:

1. **Reorder the admin steps** so group/member management comes first and
   station setup second.
2. **Make the number of stations configurable (3–6, default 3)** instead of a
   fixed 6. The whole treasure hunt currently hardcodes 6 stations (6 islands,
   6 keys, 6 chest keyholes, completion at `>=6`, rotation over 6). This makes
   `N` (the configured station count) the single source of truth and adapts the
   journey map, chest, rotation, completion, and displays to `N`.

The existing artwork (map with 6 island spots, chest with 6 keyholes) is reused:
for `N` stations we show the **first `N`** island spots and keyholes. No new art.
`N` ranges **3–6**; `+Stesen` caps at 6, `−Stesen` floors at 3.

Pure logic (rotation over `N`, count clamping, default start station) goes in a
new UMD module `stations/layout.js` (`node:test`-tested, mirroring
`groups/roster.js`). Everything else is in `index.html`.

## Part 1 — Admin tab reorder

New order in `#adminTabSelect` and matching `admin-panel` sections:

1. **Langkah 1: Pengurusan Ahli & Kumpulan** (`groups` tab — moved to first)
2. **Langkah 2: Pengurusan Stesen** (`setup` tab — relabelled from "Setup Stesen")
3. **Langkah 3: Password Kumpulan** (`passwords`)
4. **Langkah 4: QR Tersembunyi** (`qr`)
5. **Langkah 5: Mula / Tamat Treasure Hunt** (`session`)
6. Peti Harta Karun (`treasure`) · Dashboard Live (`dashboard`) — unchanged, not numbered.

Changes:
- Reorder the `<option>`s and the `<section>` blocks; update `ADMIN_TAB_NOTES`
  text and `ADMIN_STEP_MAP` to `{groups:1, setup:2, passwords:3, qr:4, session:5}`.
- The setup-steps progress bar becomes 5 steps with the new labels.
- Admin login lands on `groups` (Langkah 1) instead of `setup`.
- The `goToAdminStep(...)` "next/back" buttons in each section are rewired to the
  new neighbours (groups → setup → passwords → qr → session).

## Part 2 — Dynamic station count

### Source of truth

`N` = the number of stations in `config/stations` at runtime
(`Object.keys(stations).length`), clamped to 3–6. During station editing, a
`stationCount` UI variable drives how many station blocks are rendered; on save
exactly that many stations are written. A brand-new setup defaults to **3**;
an existing config with 6 stays 6.

### Pure module `stations/layout.js`

UMD module exposing `window.StationLayout` / `module.exports`, no DOM:

- `MIN_STATIONS = 3`, `MAX_STATIONS = 6`.
- `clampStationCount(n) -> number` — integer clamped to 3–6; returns 3 for
  invalid/undefined.
- `defaultStartStation(groupId, count) -> number` — `((groupId-1) % count) + 1`.
- `rotationOrder(startStation, count) -> number[]` — `[startStation, then +1 each,
  wrapping 1..count]`, length `count`.
- `isJourneyDone(currentIndex, count) -> boolean` — `currentIndex >= count`.

### Station manager UI (in the "Pengurusan Stesen" tab)

- Renders `stationCount` station blocks (existing station-block markup).
- **＋Stesen** button: `stationCount = clamp(stationCount+1)`, re-render; disabled
  at 6. **−Stesen** button: removes the **last** station, `clamp(stationCount-1)`,
  re-render; disabled at 3.
- Adding/removing preserves already-typed station form values (collect current
  values before re-rendering, the way the group draft is preserved).
- The heading shows the live count (e.g. "Setup Stesen (3)").
- Controls are **disabled while `sessionInfo.status === 'active'`** (same lock
  principle as the group manager), because saving resets progress.

### Ripple changes (everywhere `6` is currently assumed)

`N = Object.keys(stations).length` (clamped). Replace hardcoded 6:

- **`buildStationsUI`, `collectStations`, `generateQRs`** loop `1..stationCount` /
  `1..N` instead of `1..6`.
- **Rotation:** `rotationFor` / start-station defaults delegate to
  `StationLayout.rotationOrder` / `defaultStartStation` with `N`. Start-station
  `<select>`s list `1..N`.
- **Group orders regenerated on station-count change:** when stations are saved
  (`pushConfig`), each existing group's `startStation` is clamped to `1..N` and
  its `order` rebuilt via `rotationOrder(startStation, N)`; `loginPassword`,
  `members`, and `name` are preserved. `buildGroupsFromDraft` and `collectGroups`
  likewise build orders over `N`.
- **Completion:** `submitCompletion`'s `done = StationLayout.isJourneyDone(newIndex, N)`
  (was `newIndex >= 6`). The group-finale / waiting checks (`currentIndex >= 6`)
  use `N` too.
- **Journey map:** render islands for positions `1..N` (using `MAP_ISLANDS[1..N]`);
  the ship sails island 1 → `N`.
- **Chest:** `chestVis` and the keyhole rendering show the **first `N`** of the 6
  `KEYHOLES`; the group "won"/finale logic lights up to `N` keys.
- **Displays:** dashboard "Selesai N Pulau", `currentIndex/N`, current-island
  label, and the Smart-Board chest all use `N`.

### Save & reset

- Saving station setup (`pushConfig`) regenerates group orders for `N` and
  **resets `progress`** (already its behavior), and preserves the roster
  (unchanged from the group-management decoupling).
- Station management is locked during an active session.

## Error handling / edge cases

- `+Stesen` at 6 and `−Stesen` at 3 are no-ops (buttons disabled).
- Removing a station drops the **last** station block only (no middle gaps), so
  islands/keyholes stay a contiguous `1..N`.
- A group whose stored `startStation` exceeds `N` after a reduction is clamped to
  `defaultStartStation(id, N)` before its order is rebuilt.
- Saving while a session is active is prevented by the lock; `pushConfig`/station
  save also no-ops with a message if `sessionInfo.status === 'active'`.

## Testing

- **`stations/layout.test.js`** (`node:test`): `clampStationCount` (below 3, above
  6, non-numeric), `defaultStartStation` (wraps by group id), `rotationOrder`
  (length `count`, wraps correctly for counts 3 and 6), `isJourneyDone`.
- **`tests/station-count.spec.js`** (Playwright, Firebase stubbed with the CDN
  route-block): open the Pengurusan Stesen tab, assert default renders 3 station
  blocks; `+Stesen` → 4 blocks, capped at 6; `−Stesen` back to 3, floored;
  save and assert `config/stations` has `N` entries and each group's `order` has
  length `N`; assert the tab order shows groups as Langkah 1.

## Non-goals / assumptions

- Range is fixed 3–6; more than 6 is out of scope (would need new art).
- Station count is a whole-hunt setting, not per-group.
- No per-station reordering/drag; `−Stesen` removes the last only.
- Members/roster behavior is unchanged; this builds on the existing group manager.
