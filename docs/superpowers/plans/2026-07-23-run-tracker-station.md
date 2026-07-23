# Run Tracker Station (`Jejak Lari GPS`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new station game type where a student runs a teacher-set target distance (e.g. 3 km), tracked live by the phone's GPS, scored by time left plus 25 marks per km run.

**Architecture:** Pure run math (distance accumulation, jitter guard, scoring, target parsing) lives in a new UMD module `run/tracker.js` — loaded via `<script>` in the browser and `require`-able for `node:test`, exactly like `tangram/engine.js`. All UI/GPS wiring lives in `index.html`, following the self-managed tangram flow (own "Mula" button so a GPS permission prompt is triggered by a user gesture). Results flow through the existing `submitCompletion(onTime, score, timeTakenSec)`.

**Tech Stack:** Vanilla JS single-page app (`index.html`), Firebase Realtime DB (compat SDK), `node:test` for pure logic, Playwright for browser flow (Firebase + geolocation mocked).

## Global Constraints

- All pure logic goes in `run/tracker.js` as a UMD module: `(function(root,factory){ const mod=factory(); if(typeof module!=='undefined'&&module.exports) module.exports=mod; else root.RunTracker=mod; })(...)`. Mirror `tangram/engine.js:1-5`.
- gameType id is exactly `jejak_lari`; display name is exactly `Jejak Lari GPS`.
- Scoring: `base = (reachedTarget && !timeUp) ? round(max(0,timeLeftSec)/totalSec*100) : 0`; `bonus = 25 * floor(distanceM/1000)`; `score = base + bonus`. No `-20` timeout penalty for this type.
- Jitter guard constants (in `run/tracker.js`): `ACC_MAX = 30` (m, ignore fixes worse than this), `MIN_STEP = 1` (m, ignore sub-metre noise), `MAX_JUMP = 200` (m, a single delta larger than this is a GPS teleport glitch — resync position but add no distance), `BONUS_PER_KM = 25`.
- UI copy is Malay, matching existing stations.
- Run `node:test` files with `node --test <path>` (NOT `node --test <dir>` — that errors). Playwright with `npx playwright test <path>`.

## File Structure

- **Create `run/tracker.js`** — pure functions: `parseTargetKm`, `haversineMeters`, `accumulate`, `runScore`, plus exported constants. One responsibility: run measurement + scoring math, no DOM.
- **Create `run/tracker.test.js`** — `node:test` unit tests for the module.
- **Create `tests/run-tracker.spec.js`** — Playwright browser-flow test (GPS mocked).
- **Modify `index.html`** — load the module, register the game type, add the teacher config field, add the student run flow.

---

### Task 1: Pure run-tracker module (`run/tracker.js`)

**Files:**
- Create: `run/tracker.js`
- Test: `run/tracker.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (on `window.RunTracker` and `module.exports`):
  - `parseTargetKm(raw: string) -> number` — parses `{"targetKm":N}`; returns N when finite and > 0, else `3`.
  - `haversineMeters(a, b) -> number` — great-circle metres; `a`,`b` are `{lat, lng}`.
  - `accumulate(state, pt) -> state` — `state` is `{distanceM: number, lastPt: {lat,lng}|null}`; `pt` is `{lat, lng, acc}`. Applies the jitter guards and returns the next state (never mutates in place at the fields that matter for callers — returns a fresh object when distance/position changes).
  - `runScore({reachedTarget, timeUp, timeLeftSec, totalSec, distanceM}) -> number`.
  - Constants: `ACC_MAX`, `MIN_STEP`, `MAX_JUMP`, `BONUS_PER_KM`.

- [ ] **Step 1: Write the failing tests**

Create `run/tracker.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const R = require('./tracker.js');

test('parseTargetKm reads targetKm', () => {
  assert.strictEqual(R.parseTargetKm('{"targetKm":5}'), 5);
});
test('parseTargetKm defaults to 3 on junk / missing / non-positive', () => {
  assert.strictEqual(R.parseTargetKm(''), 3);
  assert.strictEqual(R.parseTargetKm('not json'), 3);
  assert.strictEqual(R.parseTargetKm('{"targetKm":0}'), 3);
  assert.strictEqual(R.parseTargetKm('{"targetKm":-2}'), 3);
});

test('haversineMeters ~111.32m per 0.001 deg latitude', () => {
  const d = R.haversineMeters({lat:1.5, lng:110}, {lat:1.501, lng:110});
  assert.ok(Math.abs(d - 111.32) < 1.0, `got ${d}`);
});

test('accumulate seeds lastPt on first point, adds no distance', () => {
  const s = R.accumulate({distanceM:0, lastPt:null}, {lat:1.5, lng:110, acc:5});
  assert.strictEqual(s.distanceM, 0);
  assert.deepStrictEqual(s.lastPt, {lat:1.5, lng:110});
});
test('accumulate adds a normal step', () => {
  let s = {distanceM:0, lastPt:{lat:1.5, lng:110}};
  s = R.accumulate(s, {lat:1.5004, lng:110, acc:5}); // ~44m
  assert.ok(s.distanceM > 40 && s.distanceM < 50, `got ${s.distanceM}`);
});
test('accumulate ignores low-accuracy fixes', () => {
  const before = {distanceM:10, lastPt:{lat:1.5, lng:110}};
  const s = R.accumulate(before, {lat:1.5004, lng:110, acc:99});
  assert.strictEqual(s.distanceM, 10);
});
test('accumulate ignores sub-metre noise', () => {
  const before = {distanceM:10, lastPt:{lat:1.5, lng:110}};
  const s = R.accumulate(before, {lat:1.500001, lng:110, acc:5});
  assert.strictEqual(s.distanceM, 10);
});
test('accumulate treats a >200m jump as a glitch: resync, no distance added', () => {
  const before = {distanceM:10, lastPt:{lat:1.5, lng:110}};
  const s = R.accumulate(before, {lat:1.505, lng:110, acc:5}); // ~556m
  assert.strictEqual(s.distanceM, 10);
  assert.deepStrictEqual(s.lastPt, {lat:1.505, lng:110});
});

test('runScore: reached target on time = time-left% + 25/km', () => {
  const score = R.runScore({reachedTarget:true, timeUp:false, timeLeftSec:300, totalSec:600, distanceM:3000});
  assert.strictEqual(score, 50 + 75); // 125
});
test('runScore: timed out = 0 base but keeps km bonus', () => {
  const score = R.runScore({reachedTarget:false, timeUp:true, timeLeftSec:0, totalSec:600, distanceM:2000});
  assert.strictEqual(score, 50); // 0 + 2*25
});
test('runScore: partial km rounds down', () => {
  const score = R.runScore({reachedTarget:false, timeUp:true, timeLeftSec:0, totalSec:600, distanceM:2999});
  assert.strictEqual(score, 50); // floor(2.999)=2 -> 50
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test run/tracker.test.js`
Expected: FAIL — `Cannot find module './tracker.js'`.

- [ ] **Step 3: Write the module**

Create `run/tracker.js`:

```javascript
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.RunTracker = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const ACC_MAX = 30;      // metres — ignore fixes with worse reported accuracy
  const MIN_STEP = 1;      // metres — ignore sub-metre GPS noise
  const MAX_JUMP = 200;    // metres — a single delta larger than this is a glitch
  const BONUS_PER_KM = 25; // marks per full kilometre run

  function parseTargetKm(raw) {
    let data = {};
    try { data = JSON.parse(raw || '{}'); } catch (e) { data = {}; }
    const km = Number(data.targetKm);
    return (isFinite(km) && km > 0) ? km : 3;
  }

  function haversineMeters(a, b) {
    const R = 6371000, toRad = x => x * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // state: { distanceM, lastPt: {lat,lng}|null }; pt: {lat,lng,acc}
  function accumulate(state, pt) {
    const here = { lat: pt.lat, lng: pt.lng };
    if (!state.lastPt) return { distanceM: state.distanceM || 0, lastPt: here };
    if (pt.acc != null && pt.acc > ACC_MAX) return state;      // too noisy — ignore
    const d = haversineMeters(state.lastPt, here);
    if (d < MIN_STEP) return state;                            // jitter — ignore
    if (d > MAX_JUMP) return { distanceM: state.distanceM, lastPt: here }; // glitch — resync only
    return { distanceM: state.distanceM + d, lastPt: here };
  }

  function runScore({ reachedTarget, timeUp, timeLeftSec, totalSec, distanceM }) {
    const base = (reachedTarget && !timeUp)
      ? Math.round(Math.max(0, timeLeftSec) / totalSec * 100) : 0;
    const bonus = BONUS_PER_KM * Math.floor(distanceM / 1000);
    return base + bonus;
  }

  return { parseTargetKm, haversineMeters, accumulate, runScore,
    ACC_MAX, MIN_STEP, MAX_JUMP, BONUS_PER_KM };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test run/tracker.test.js`
Expected: PASS — all 11 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add run/tracker.js run/tracker.test.js
git commit -m "feat: add run-tracker distance and scoring module"
```

---

### Task 2: Register game type and teacher config field (`index.html`)

**Files:**
- Modify: `index.html` — script include near line 11-13; `GAME_TYPES` at line 569; editor at `buildStationsUI` line 1196-1217, `toggleWorksheetEditor` line 1189-1195; save paths `collectStations` line 1218-1233 and `testStation` line 1515-1535; CSS near the worksheet-editor rules line 228-233.

**Interfaces:**
- Consumes from Task 1: `window.RunTracker.parseTargetKm(raw)`.
- Produces (used by Task 3): a new global `stationGameDataRaw(i, gameType)` returning the `gameDataRaw` string for station `i`; a station whose `gameType` is `jejak_lari` with `gameDataRaw` = `{"targetKm":N}`.

- [ ] **Step 1: Load the module.** In `index.html` after line 13 (`<script src="tangram/ui.js"></script>`), add:

```html
<script src="run/tracker.js"></script>
```

- [ ] **Step 2: Register the game type.** In `GAME_TYPES` (line 569-579), add a final entry after the tangram line:

```javascript
  {id:'tangram', name:'Tangram Challenge'},
  {id:'jejak_lari', name:'Jejak Lari GPS'}
```

(Add a comma after the tangram entry; the array currently ends `...'Tangram Challenge'}\n];`.)

- [ ] **Step 3: Add editor CSS.** After line 233 (end of the `.worksheet-add` rule), add:

```css
  .run-editor{display:none;margin-top:10px;}
  .run-editor input{max-width:160px;}
```

- [ ] **Step 4: Add the target-km input in the station block.** In `buildStationsUI` (line 1211), immediately after the `worksheet-editor` div line, add a run editor div. The block becomes:

```javascript
      <div class="worksheet-editor" id="worksheet_editor_${i}"></div>
      <div class="run-editor" id="run_editor_${i}">
        <label>Jarak Sasaran (km)</label>
        <input id="st_targetkm_${i}" type="number" min="0.1" step="0.1" value="${RunTracker.parseTargetKm(s.gameDataRaw)}">
      </div>
```

- [ ] **Step 5: Show/hide the run editor with the game type.** Replace `toggleWorksheetEditor` (line 1189-1195) with:

```javascript
function toggleWorksheetEditor(i){
  const gameType=document.getElementById('st_gametype_'+i).value;
  const isWorksheet=gameType==='lembaran_kerja';
  const isRun=gameType==='jejak_lari';
  const editor=document.getElementById('worksheet_editor_'+i);
  const runEditor=document.getElementById('run_editor_'+i);
  const rawField=document.getElementById('game_data_field_'+i);
  if(editor) editor.style.display=isWorksheet?'block':'none';
  if(runEditor) runEditor.style.display=isRun?'block':'none';
  if(rawField) rawField.style.display=(isWorksheet||isRun)?'none':'block';
}
```

- [ ] **Step 6: Add a shared `gameDataRaw` builder.** Immediately before `collectStations` (line 1218), add:

```javascript
function stationGameDataRaw(i, gameType){
  if(gameType==='lembaran_kerja') return JSON.stringify({questions:getWorksheetQuestionsFromEditor(i)});
  if(gameType==='jejak_lari'){
    const km=Number(document.getElementById('st_targetkm_'+i).value);
    return JSON.stringify({targetKm:(isFinite(km)&&km>0)?km:3});
  }
  return document.getElementById('st_gamedata_'+i).value;
}
```

- [ ] **Step 7: Use the builder in both save paths.** In `collectStations` (line 1228-1230) replace the `gameDataRaw:` value with:

```javascript
      gameDataRaw:stationGameDataRaw(i, gameType)};
```

And in `testStation` (line 1524-1526) replace the `gameDataRaw:` value with:

```javascript
    gameDataRaw:stationGameDataRaw(i, gameType)
```

- [ ] **Step 8: Manually verify in a browser.** Open `index.html`, go to the admin panel (PIN `1234`), and for any station pick **Jejak Lari GPS** from Jenis Game. Confirm the "Jarak Sasaran (km)" number input appears (default `3`) and the raw JSON field is hidden; switching to another type hides it and shows the JSON field again.

Expected: the run editor toggles correctly; no console errors.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "feat: register Jejak Lari GPS station type and teacher config field"
```

---

### Task 3: Student run flow with live GPS tracking (`index.html`)

**Files:**
- Modify: `index.html` — `startGame` early-return line 1567; `renderGame` branch near line 1659-1662; `tick` timeout hooks line 1590-1591; `endTest` line 1536-1541; add new run functions after the tangram section.
- Test: `tests/run-tracker.spec.js`

**Interfaces:**
- Consumes from Task 1: `RunTracker.parseTargetKm`, `RunTracker.accumulate`, `RunTracker.runScore`.
- Consumes existing: `submitCompletion(onTime, score, timeTakenSec)`, `showTestResult(onTime, score, timeTakenSec)`, globals `timeLeftSec`, `timeUp`, `timerInterval`, `gameState`, `window._testMode`, `window._startedAt`, `window._gameOver`.
- Produces: globals `startRun(st)`, `beginRun()`, `onRunPosition(pos)`, `onRunError(err)`, `renderRunLive()`, `updateRunLive()`, `finishRun(reachedTarget)`, and `window._runWatchId`, `window._runTimeout`.

- [ ] **Step 1: Write the failing Playwright test.** Create `tests/run-tracker.spec.js`:

```javascript
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

test.use({ permissions: ['geolocation'], geolocation: { latitude: 1.5, longitude: 110.0 } });

test('run tracker accrues GPS distance and completes at target', async ({ page, context }) => {
  // Stub the Firebase compat SDK so the page boots offline (matches student-island-journey.spec.js).
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(() => {
    window.firebase = {
      apps: [],
      initializeApp() { this.apps.push({}); },
      database() {
        return { ref() { return {
          once: () => Promise.resolve({ val: () => null }),
          on: () => {}, off: () => {},
          set: () => Promise.resolve(), update: () => Promise.resolve()
        }; } };
      }
    };
  });

  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await expect(page.locator('#view-login')).toHaveClass(/active/);

  // Start a run station in test mode: 0.05 km target (~50 m).
  await page.evaluate(() => {
    window._testMode = true;
    startGame('t', { id: 't', name: 'Lari Ujian', location: 'x', password: '12345',
      timeLimitMin: 10, gameType: 'jejak_lari', gameDataRaw: '{"targetKm":0.05}' });
  });
  await page.getByText('Mula Lari').click();
  await expect(page.locator('#runKm')).toBeVisible();

  // Move north in two ~44 m steps (each < MAX_JUMP 200 m) -> ~88 m total > 50 m target.
  await context.setGeolocation({ latitude: 1.5004, longitude: 110.0 });
  await context.setGeolocation({ latitude: 1.5008, longitude: 110.0 });

  await expect(page.locator('#view-result')).toHaveClass(/active/, { timeout: 6000 });
  await expect(page.locator('#resultCard')).toContainText('Ujian Selesai');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/run-tracker.spec.js`
Expected: FAIL — no "Mula Lari" button (the `jejak_lari` runtime does not exist yet).

- [ ] **Step 3: Add the `jejak_lari` early return in `startGame`.** In `startGame` (line 1567) extend the tangram guard:

```javascript
  if(st.gameType==='tangram') return;
  if(st.gameType==='jejak_lari'){ startRun(st); return; }
```

(Place the new line right after the existing tangram `return;`. `renderGame` is already called above at line 1564, but the run flow is driven by `startRun`; see Step 4 — the `renderGame` branch simply defers to it, so this guard prevents the generic timer/test-banner from starting.)

- [ ] **Step 4: Add the `renderGame` branch.** In `renderGame`, after the tangram branch (line 1659-1662), add:

```javascript
  else if(st.gameType==='jejak_lari'){
    startRun(st);
    return;
  }
```

- [ ] **Step 5: Add the `tick` timeout hook.** In `tick` (after line 1591, the sudoku hook), add:

```javascript
    if(gameState && gameState.type==='jejak_lari' && window._runTimeout){ window._runTimeout(); }
```

- [ ] **Step 6: Clear the GPS watch in `endTest`.** In `endTest` (line 1536-1541), after `if(timerInterval) clearInterval(timerInterval);` add:

```javascript
  if(window._runWatchId!=null && navigator.geolocation){ navigator.geolocation.clearWatch(window._runWatchId); window._runWatchId=null; }
```

- [ ] **Step 7: Add the run flow functions.** Immediately before `function finishSudoku(onTime){` (line 1859), add:

```javascript
// ---------- RUN TRACKER (jejak_lari): live GPS distance ----------
function startRun(st){
  const targetKm = RunTracker.parseTargetKm(st.gameDataRaw);
  gameState = { type:'jejak_lari', targetKm, distanceM:0, lastPt:null,
                totalSec: timeLeftSec, started:false, total:1, correct:0 };
  window._runWatchId = null;
  window._runTimeout = null;
  const card = document.getElementById('gameCard');
  const testBanner = window._testMode
    ? '<div class="msg" style="background:#fdf3d8;margin-top:0;">🧪 <b>Mod Ujian</b> — markah tidak disimpan. <button class="linkbtn" onclick="endTest()">← Kembali ke Admin</button></div>'
    : '';
  card.innerHTML = `${testBanner}<h2>🏃 ${st.name}</h2>
    <div class="clue">Lari sejauh <b>${targetKm} km</b> sebelum masa tamat. GPS akan mengesan jarak larian anda.</div>
    <p style="color:#65513a;font-size:14px;">Markah: baki masa + <b>25 markah</b> setiap 1 km yang dilari.</p>
    <button class="big" onclick="beginRun()">▶️ Mula Lari</button>
    <div id="runMsg"></div>`;
}
function beginRun(){
  const msg = document.getElementById('runMsg');
  if(!navigator.geolocation){
    if(msg) msg.innerHTML='<div class="msg err">GPS tidak disokong pada peranti ini.</div>';
    return;
  }
  if(msg) msg.innerHTML='<div class="msg">📡 Mendapatkan isyarat GPS…</div>';
  window._runWatchId = navigator.geolocation.watchPosition(
    onRunPosition, onRunError, { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });
}
function onRunPosition(pos){
  const pt = { lat:pos.coords.latitude, lng:pos.coords.longitude, acc:pos.coords.accuracy };
  if(!gameState.started){
    // First fix: start the clock and the live UI, seed the position.
    gameState.started = true;
    gameState = RunTracker.accumulate(gameState, pt); // seeds lastPt
    Object.assign(gameState, { type:'jejak_lari', started:true, total:1, correct:0 });
    window._startedAt = Date.now();
    renderRunLive();
    document.getElementById('timer').style.display='block';
    timerInterval = setInterval(tick,1000);
    window._runTimeout = ()=>finishRun(false);
    return;
  }
  gameState = RunTracker.accumulate(gameState, pt);
  Object.assign(gameState, { type:'jejak_lari', started:true, total:1, correct:0 });
  updateRunLive();
  if(gameState.distanceM >= gameState.targetKm*1000) finishRun(true);
}
function onRunError(err){
  const msg = document.getElementById('runMsg');
  if(!msg) return;
  const why = err && err.code===1 ? 'kebenaran GPS ditolak' : 'isyarat GPS tidak diperoleh';
  msg.innerHTML = `<div class="msg err">Tidak dapat mula (${why}). Benarkan akses lokasi, kemudian <button class="linkbtn" onclick="beginRun()">cuba lagi</button>.</div>`;
}
function renderRunLive(){
  const card = document.getElementById('gameCard');
  const testBanner = window._testMode
    ? '<div class="msg" style="background:#fdf3d8;margin-top:0;">🧪 <b>Mod Ujian</b> — markah tidak disimpan. <button class="linkbtn" onclick="endTest()">← Kembali ke Admin</button></div>'
    : '';
  card.innerHTML = `${testBanner}<h2>🏃 Larian Anda</h2>
    <div style="font-size:34px;font-weight:900;color:var(--navy);text-align:center;margin:10px 0;">
      <span id="runKm">0.00</span> / ${gameState.targetKm.toFixed(2)} km</div>
    <div style="height:18px;border:2px solid var(--gold);border-radius:10px;overflow:hidden;background:#fff8df;">
      <div id="runBar" style="height:100%;width:0%;background:var(--green);transition:width .3s;"></div></div>
    <p style="color:#888;font-size:13px;text-align:center;margin-top:10px;">📡 GPS aktif — teruskan berlari!</p>
    <div id="runMsg"></div>`;
}
function updateRunLive(){
  const km = gameState.distanceM/1000;
  const kmEl = document.getElementById('runKm');
  const bar = document.getElementById('runBar');
  if(kmEl) kmEl.textContent = km.toFixed(2);
  if(bar) bar.style.width = Math.min(100, km/gameState.targetKm*100) + '%';
}
function finishRun(reachedTarget){
  if(window._gameOver) return;   // guard against double-finish (target hit + timeout race)
  window._gameOver = true;
  if(window._runWatchId!=null && navigator.geolocation){
    navigator.geolocation.clearWatch(window._runWatchId); window._runWatchId=null;
  }
  clearInterval(timerInterval);
  const onTime = reachedTarget && !timeUp;
  const timeTakenSec = Math.round((Date.now()-window._startedAt)/1000);
  const score = RunTracker.runScore({
    reachedTarget, timeUp,
    timeLeftSec: Math.max(0, timeLeftSec),
    totalSec: gameState.totalSec,
    distanceM: gameState.distanceM });
  if(window._testMode){ showTestResult(onTime, score, timeTakenSec); return; }
  submitCompletion(onTime, score, timeTakenSec);
}
```

Note on the `Object.assign(...)` lines: `RunTracker.accumulate` returns a fresh `{distanceM, lastPt}` object, so re-stamp the run-specific fields (`type`, `started`, `total`, `correct`, and — preserved because assign keeps existing keys — `targetKm`, `totalSec`) that `tick`, `finishRun`, and `submitCompletion` rely on. `targetKm`/`totalSec` survive because `accumulate` copies neither away — it only returns `distanceM`/`lastPt`; therefore spread them explicitly:

Replace the two `Object.assign(gameState, { type:'jejak_lari', started:true, total:1, correct:0 });` lines with the safer form that preserves config:

```javascript
    const carried = { targetKm: gameState.targetKm, totalSec: gameState.totalSec,
                      type:'jejak_lari', started:true, total:1, correct:0 };
    gameState = Object.assign(RunTracker.accumulate(gameState, pt), carried);
```

i.e. compute the accumulate result and re-apply `carried` in one expression. Use this pattern in BOTH the first-fix branch (after seeding) and the normal branch. Concretely `onRunPosition` becomes:

```javascript
function onRunPosition(pos){
  const pt = { lat:pos.coords.latitude, lng:pos.coords.longitude, acc:pos.coords.accuracy };
  const carried = { targetKm: gameState.targetKm, totalSec: gameState.totalSec,
                    type:'jejak_lari', total:1, correct:0 };
  if(!gameState.started){
    gameState = Object.assign(RunTracker.accumulate(gameState, pt), carried, { started:true });
    window._startedAt = Date.now();
    renderRunLive();
    document.getElementById('timer').style.display='block';
    timerInterval = setInterval(tick,1000);
    window._runTimeout = ()=>finishRun(false);
    return;
  }
  gameState = Object.assign(RunTracker.accumulate(gameState, pt), carried, { started:true });
  updateRunLive();
  if(gameState.distanceM >= gameState.targetKm*1000) finishRun(true);
}
```

Use this final `onRunPosition`; delete the earlier draft version above it (the two `Object.assign` one-liners were the interim form).

- [ ] **Step 8: Run the Playwright test to verify it passes**

Run: `npx playwright test tests/run-tracker.spec.js`
Expected: PASS — the run reaches target and the result card shows "Ujian Selesai".

- [ ] **Step 9: Run the module tests to confirm no regressions**

Run: `node --test run/tracker.test.js tangram/engine.test.js`
Expected: PASS — all tests pass.

- [ ] **Step 10: Manually smoke-test in the browser.** In the admin panel, create a `Jejak Lari GPS` station with a small target (e.g. `0.05`), press **▶️ Uji Cara Main Stesen Ini**, then **Mula Lari**, and allow location. Confirm the distance counter and progress bar move as your device location updates and that finishing shows a score. (On desktop without real GPS, this is best verified by the Playwright test; the manual check is for a real phone outdoors.)

- [ ] **Step 11: Commit**

```bash
git add index.html tests/run-tracker.spec.js
git commit -m "feat: add live GPS run flow for Jejak Lari GPS station"
```

---

## Self-Review

**Spec coverage:**
- New `jejak_lari` / "Jejak Lari GPS" type — Task 2 Step 2. ✓
- Teacher target-km config stored as `{"targetKm":N}` — Task 2 Steps 4-7. ✓
- Self-managed flow with "Mula Lari" start button (GPS permission via user gesture) — Task 3 Steps 3-4, 7. ✓
- Live distance + progress bar + countdown — Task 3 `renderRunLive`/`updateRunLive`. ✓
- Haversine accumulation with jitter guard — Task 1 `accumulate` + constants. ✓
- Reach target → auto-finish success; timeout → auto-finish keeping km bonus — Task 3 `onRunPosition` (target check) + `tick` hook + `finishRun`. ✓
- Denied GPS → error + retry, no auto-fail — Task 3 `onRunError`. ✓
- Scoring `base + 25/km`, no −20 penalty, may exceed 100 — Task 1 `runScore`. ✓
- Flows through `submitCompletion`; test mode via `showTestResult` — Task 3 `finishRun`. ✓
- Clears watch/timer on finish and on leaving — Task 3 `finishRun` + `endTest` (Step 6). ✓

**Placeholder scan:** No TBD/TODO; all steps carry full code. ✓

**Type consistency:** `RunTracker.parseTargetKm/accumulate/runScore` names and `{distanceM,lastPt}` / `{lat,lng,acc}` shapes match between Task 1 (definition) and Tasks 2-3 (use). `stationGameDataRaw(i, gameType)` defined once (Task 2 Step 6), used in both save paths. `window._runWatchId` / `window._runTimeout` set in Task 3 Step 7, cleared in Step 6. `gameState.totalSec` set in `startRun`, read in `finishRun`. ✓

One resolved subtlety: `accumulate` returns only `{distanceM,lastPt}`, so `onRunPosition` re-stamps `targetKm`, `totalSec`, `type`, `started`, `total`, `correct` via the `carried` object each fix (Task 3 Step 7 final form).
