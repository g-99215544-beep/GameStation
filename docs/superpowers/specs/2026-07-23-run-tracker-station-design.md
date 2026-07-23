# Run Tracker Station (`Jejak Lari GPS`) — Design

**Date:** 2026-07-23
**Status:** Approved, ready for implementation plan

## Summary

Add a new station game type that tracks how far a student runs, using the phone's
real GPS. The student runs a teacher-set target distance (e.g. 3 km) outdoors; the
phone measures actual distance covered. Reaching the target completes the station.
Marks reward finishing with time to spare, plus a bonus for each kilometre run.

All work is in `index.html`, following the existing station-type patterns
(especially the self-managed tangram flow).

## Terminology

- **gameType id:** `jejak_lari`
- **Display name:** `Jejak Lari GPS`
- **targetKm:** the distance (km) the student must run, set by the teacher.

## Teacher configuration

- One new config field: **target distance in km**, default `3`.
- Stored in the station's `gameDataRaw` as JSON: `{"targetKm": 3}` — the same
  special-case editor approach used by the worksheet (`lembaran_kerja`) type.
- The existing per-station **time limit** (`timeLimitMin`) is the countdown.
- No GPS-accuracy or bonus-per-km fields are exposed (kept internal / fixed).

## Student runtime flow

Follows the **tangram pattern**: the station manages its own flow and start
button, because a GPS permission prompt must be triggered by a user gesture.

1. Station screen shows: station name, the target (e.g. "Lari 3 km"),
   short instructions, and a **"Mula Lari"** button.
2. Pressing **Mula Lari**:
   - Requests geolocation and starts `navigator.geolocation.watchPosition(...)`.
   - Starts the countdown timer (`timerInterval` / `tick()`).
3. Live run screen shows:
   - **Distance covered** (km, live).
   - A **progress bar** toward the target.
   - The existing countdown clock (`#timer`).
4. On each GPS update, add the haversine distance from the previous accepted
   point to the running total.
   - **Jitter guard (internal, not configurable):** ignore a point whose reported
     accuracy is poor (e.g. worse than ~30 m) and ignore jumps that imply a
     physically impossible speed. Keeps GPS noise from inflating distance.
5. **Reaching the target distance → auto-finish as success.**
6. **Timer reaches 0 before target → auto-finish**, keeping the km bonus. Wired
   via a `window._runTimeout` hook invoked from `tick()` at `timeLeftSec <= 0`,
   the same mechanism tangram (`_tgTimeout`) and sudoku (`_sudokuTimeout`) use.
7. **GPS permission denied / error:** show an error message and a **retry**
   button. Do not silently score or auto-fail.
8. On finish (either path) and on leaving the screen: clear the geolocation
   watch and the timer interval.

## Scoring

```
totalSec = (timeLimitMin || 10) * 60
base     = round(timeLeftSec / totalSec * 100)   // time-left %, = 0 if timed out
bonus    = 25 * floor(kmCovered)                  // 25 marks per full km run
score    = base + bonus
onTime   = reached target before the timer ran out
```

- Finishing 3 km with half the time left ≈ 50 base + 75 bonus = **125**.
- Timing out after covering 2 km = 0 base + 50 bonus = **50**.
- Score may exceed 100 — consistent with tangram (up to 200).
- The unlike-other-stations `-20` timeout penalty is **not** applied here; a
  timeout simply yields base 0 plus whatever km bonus was earned.
- Result is submitted through the existing
  `submitCompletion(onTime, score, timeTakenSec)`, so chest bonuses, the
  Smart Board ranking, and per-station score storage all keep working unchanged.

## Integration points (all in `index.html`)

- **`GAME_TYPES`** — add `{id:'jejak_lari', name:'Jejak Lari GPS'}`.
- **Station editor** — add a target-km number input for this type, plus the
  save/collect handling that writes `{"targetKm":N}` into `gameDataRaw`
  (mirroring the worksheet special case).
- **`startGame()`** — add `if(st.gameType==='jejak_lari') return;` so the timer
  and test banner are managed by the run flow, not the generic path (as tangram
  does).
- **`renderGame()`** — add a `jejak_lari` branch that renders the instructions
  and the **Mula Lari** button.
- **New functions:**
  - `startRun(st)` — request geolocation, begin `watchPosition`, start timer,
    render the live distance/progress UI.
  - `finishRun(reachedTarget)` — clear watch + timer, compute score, then either
    `showTestResult(...)` (test mode) or `submitCompletion(...)`.
  - a haversine distance helper.
- **`tick()`** — add the `if(gameState.type==='jejak_lari' && window._runTimeout)
  window._runTimeout();` hook at timeout.
- **Test mode** — reuses the existing `showTestResult(onTime, score, timeTakenSec)`.

## Non-goals / assumptions

- No indoor tracking, step counting, or manual distance entry — GPS only.
- No anti-cheat beyond the internal jitter/impossible-jump guard.
- Bonus-per-km is fixed at 25 and not teacher-editable.
- Works only where the browser grants geolocation (outdoors, HTTPS context —
  the app is already served over HTTPS via Firebase hosting/GitHub).
