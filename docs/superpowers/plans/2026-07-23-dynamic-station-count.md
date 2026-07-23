# Dynamic Station Count + Admin Tab Reorder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorder the admin steps (groups first, stations second) and make the station count configurable 3–6 (default 3), adapting the map, chest, rotation, completion, and displays to `N`.

**Architecture:** Pure logic (clamp, rotation over `N`, default start, completion) lives in a new UMD module `stations/layout.js` (`node:test`-tested, like `groups/roster.js`). `index.html` gains a `stationCount` editing variable and a runtime `currentStationCount()` derived from the saved config; every hardcoded `6` becomes `N`. Existing map/chest art is reused by showing the first `N` islands/keyholes.

**Tech Stack:** Vanilla JS single-page app (`index.html`), Firebase Realtime DB (compat), `node:test`, Playwright (Firebase stubbed).

## Global Constraints

- Pure logic in `stations/layout.js` as a UMD module: `(function(root,factory){ const mod=factory(); if(typeof module!=='undefined'&&module.exports) module.exports=mod; else root.StationLayout=mod; })(...)`. Mirror `groups/roster.js`.
- Station count range is **3–6**, default **3**. `MIN_STATIONS=3`, `MAX_STATIONS=6`.
- Two counts: `stationCount` (UI editing variable, drives how many station blocks render) and `currentStationCount()` (runtime `N` = `clampStationCount(Object.keys(stations).length)`).
- `rotationOrder(startStation, count)` = `[startStation, +1 each, wrapping 1..count]`, length `count`. `defaultStartStation(groupId, count)` = `((groupId-1)%count)+1`. `isJourneyDone(currentIndex, count)` = `currentIndex >= count`.
- Existing artwork reused: show the **first `N`** of the 6 `MAP_ISLANDS` and the first `N` of the 6 `KEYHOLES`. Never render more than 6.
- Changing the station count (saving station setup) regenerates every group's `startStation`/`order` for `N` (preserving `loginPassword`, `members`, `name`) and resets `progress`.
- Station setup and group management are locked while `sessionInfo.status === 'active'`.
- Admin tab order: `groups` (Langkah 1: Pengurusan Ahli & Kumpulan), `setup` (Langkah 2: Pengurusan Stesen), `passwords` (3), `qr` (4), `session` (5), then `treasure`, `dashboard`. `ADMIN_STEP_MAP = {groups:1, setup:2, passwords:3, qr:4, session:5}`.
- UI copy is Malay. Run `node --test <file>`; Playwright `npx playwright test <path>` (installed, git-ignored). Playwright specs MUST route-block `https://www.gstatic.com/firebasejs/**` (see existing specs).

## File Structure

- **Create `stations/layout.js`** — pure count/rotation/completion helpers (no DOM).
- **Create `stations/layout.test.js`** — `node:test` unit tests.
- **Create `tests/station-count.spec.js`** — Playwright flow tests (Firebase stubbed).
- **Modify `index.html`** — tab reorder; station-count editing UI; runtime `N` everywhere.

---

### Task 1: Pure station-layout module (`stations/layout.js`)

**Files:**
- Create: `stations/layout.js`
- Test: `stations/layout.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (on `window.StationLayout` and `module.exports`):
  - `MIN_STATIONS` (3), `MAX_STATIONS` (6).
  - `clampStationCount(n) -> number` — integer clamped to 3..6; returns 3 for non-integer/undefined/NaN.
  - `defaultStartStation(groupId, count) -> number` — `((groupId-1)%count)+1`.
  - `rotationOrder(startStation, count) -> number[]` — length `count`, wraps 1..count.
  - `isJourneyDone(currentIndex, count) -> boolean` — `currentIndex >= count`.

- [ ] **Step 1: Write the failing tests.** Create `stations/layout.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const S = require('./layout.js');

test('constants', () => {
  assert.strictEqual(S.MIN_STATIONS, 3);
  assert.strictEqual(S.MAX_STATIONS, 6);
});
test('clampStationCount clamps to 3..6 and defaults to 3', () => {
  assert.strictEqual(S.clampStationCount(1), 3);
  assert.strictEqual(S.clampStationCount(2), 3);
  assert.strictEqual(S.clampStationCount(3), 3);
  assert.strictEqual(S.clampStationCount(5), 5);
  assert.strictEqual(S.clampStationCount(6), 6);
  assert.strictEqual(S.clampStationCount(9), 6);
  assert.strictEqual(S.clampStationCount(0), 3);
  assert.strictEqual(S.clampStationCount(undefined), 3);
  assert.strictEqual(S.clampStationCount('x'), 3);
  assert.strictEqual(S.clampStationCount(4.7), 4);
});
test('defaultStartStation wraps by group id', () => {
  assert.strictEqual(S.defaultStartStation(1, 3), 1);
  assert.strictEqual(S.defaultStartStation(2, 3), 2);
  assert.strictEqual(S.defaultStartStation(3, 3), 3);
  assert.strictEqual(S.defaultStartStation(4, 3), 1);
  assert.strictEqual(S.defaultStartStation(7, 6), 1);
});
test('rotationOrder wraps and has length count', () => {
  assert.deepStrictEqual(S.rotationOrder(1, 3), [1,2,3]);
  assert.deepStrictEqual(S.rotationOrder(3, 3), [3,1,2]);
  assert.deepStrictEqual(S.rotationOrder(2, 3), [2,3,1]);
  assert.deepStrictEqual(S.rotationOrder(5, 6), [5,6,1,2,3,4]);
});
test('isJourneyDone compares against count', () => {
  assert.strictEqual(S.isJourneyDone(2, 3), false);
  assert.strictEqual(S.isJourneyDone(3, 3), true);
  assert.strictEqual(S.isJourneyDone(6, 6), true);
  assert.strictEqual(S.isJourneyDone(5, 6), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test stations/layout.test.js`
Expected: FAIL — `Cannot find module './layout.js'`.

- [ ] **Step 3: Write the module.** Create `stations/layout.js`:

```javascript
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.StationLayout = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN_STATIONS = 3;
  const MAX_STATIONS = 6;

  function clampStationCount(n) {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return MIN_STATIONS;
    if (v < MIN_STATIONS) return MIN_STATIONS;
    if (v > MAX_STATIONS) return MAX_STATIONS;
    return v;
  }
  function defaultStartStation(groupId, count) {
    const c = clampStationCount(count);
    return ((Number(groupId) - 1) % c) + 1;
  }
  function rotationOrder(startStation, count) {
    const c = clampStationCount(count);
    const start = Number(startStation);
    const order = [];
    for (let k = 0; k < c; k++) order.push(((start - 1 + k) % c) + 1);
    return order;
  }
  function isJourneyDone(currentIndex, count) {
    return Number(currentIndex) >= clampStationCount(count);
  }
  return { MIN_STATIONS, MAX_STATIONS, clampStationCount, defaultStartStation, rotationOrder, isJourneyDone };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test stations/layout.test.js`
Expected: PASS — all tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add stations/layout.js stations/layout.test.js
git commit -m "feat: add station-layout rotation and count module"
```

---

### Task 2: Admin tab reorder + relabel (`index.html`)

**Files:**
- Modify: `index.html` — `#adminTabSelect` options (line ~397); the setup-steps bar (line ~410-414); the `admin-panel-groups` / `admin-panel-setup` section order and headings; `ADMIN_TAB_NOTES` (line ~1213); `ADMIN_STEP_MAP` (line ~1222); `selectAdminTab('setup')` on admin login (line ~1136); the `goToAdminStep(...)` next/back buttons in the group and setup sections.
- Test: `tests/station-count.spec.js`

**Interfaces:**
- Consumes: existing `selectAdminTab`, `renderGroupManager`.
- Produces: reordered tabs used by Task 3's station tests.

- [ ] **Step 1: Write the failing Playwright test.** Create `tests/station-count.spec.js`:

```javascript
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function seedPage(page, seed) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(data => {
    const store = structuredClone(data);
    const at = key => key.split('/').filter(Boolean).reduce((v, p) => v && v[p], store);
    const write = (key, value) => {
      const parts = key.split('/').filter(Boolean);
      const last = parts.pop();
      const parent = parts.reduce((v, p) => (v[p] ||= {}), store);
      parent[last] = structuredClone(value);
    };
    window.firebase = {
      apps: [], initializeApp() { this.apps.push({}); },
      database() { return { ref(key) { return {
        once: () => Promise.resolve({ val: () => structuredClone(at(key)) }),
        on: (_e, cb) => cb({ val: () => structuredClone(at(key)) }), off: () => {},
        set: value => { write(key, value); return Promise.resolve(); },
        update: value => { write(key, { ...at(key), ...value }); return Promise.resolve(); }
      }; } }; }
    };
  }, seed);
}

function seedWith(nStations, groups) {
  const stations = Object.fromEntries(Array.from({ length: nStations }, (_, i) =>
    [i + 1, { id: i + 1, name: `Stesen ${i + 1}`, location: 'x', password: '12345', gameType: 'quiz', gameDataRaw: '{}', timeLimitMin: 10 }]));
  return { gamestation2026: { config: { stations, groups }, session: { status: 'setup' }, progress: {} } };
}

async function openAdmin(page, tab) {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await expect(page.locator('#view-login')).toHaveClass(/active/);
  await page.evaluate(async (t) => {
    await loadConfigCache();
    sessionInfo = { status: 'setup' };
    show('view-admin');
    selectAdminTab(t);
  }, tab);
}

test('admin tabs: groups is Langkah 1, stations is Langkah 2', async ({ page }) => {
  await seedPage(page, seedWith(3, {}));
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  const opts = await page.locator('#adminTabSelect option').allTextContents();
  expect(opts[0]).toMatch(/Langkah 1/);
  expect(opts[0]).toMatch(/Ahli & Kumpulan|Ahli &amp; Kumpulan|Kumpulan/);
  expect(opts[1]).toMatch(/Langkah 2/);
  expect(opts[1]).toMatch(/Stesen/);
  // values in order
  const vals = await page.locator('#adminTabSelect option').evaluateAll(os => os.map(o => o.value));
  expect(vals.slice(0, 5)).toEqual(['groups', 'setup', 'passwords', 'qr', 'session']);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/station-count.spec.js --reporter=line`
Expected: FAIL — first option is still `setup` / "Langkah 1: Setup Stesen".

- [ ] **Step 3: Reorder + relabel the dropdown options.** Replace the five step-options in `#adminTabSelect` (the block starting `<option value="setup">Langkah 1: Setup Stesen</option>`) with:

```html
          <option value="groups">Langkah 1: Pengurusan Ahli &amp; Kumpulan</option>
          <option value="setup">Langkah 2: Pengurusan Stesen</option>
          <option value="passwords">Langkah 3: Password Kumpulan</option>
          <option value="qr">Langkah 4: QR Tersembunyi</option>
          <option value="session">Langkah 5: Mula / Tamat Treasure Hunt</option>
```

(Leave the `treasure` and `dashboard` options that follow unchanged.)

- [ ] **Step 4: Update the setup-steps progress bar.** Replace the four `.setup-step` divs (line ~411-414) with five, in the new order:

```html
            <div class="setup-step" data-step="1"><span class="step-number">1</span>Ahli &amp; Kumpulan</div>
            <div class="setup-step" data-step="2"><span class="step-number">2</span>Stesen</div>
            <div class="setup-step" data-step="3"><span class="step-number">3</span>Password</div>
            <div class="setup-step" data-step="4"><span class="step-number">4</span>QR</div>
            <div class="setup-step" data-step="5"><span class="step-number">5</span>Mula Hunt</div>
```

- [ ] **Step 5: Move the groups section before the setup section.** In the HTML, cut the entire `<section class="admin-panel" id="admin-panel-groups"> ... </section>` block and paste it so it appears immediately **before** `<section class="admin-panel active" id="admin-panel-setup">`. Then move the `active` class: the `groups` section becomes the default-active panel and `setup` is not active. Concretely, the groups section opening tag becomes `<section class="admin-panel active" id="admin-panel-groups">` and the setup section opening tag becomes `<section class="admin-panel" id="admin-panel-setup">`.

- [ ] **Step 6: Relabel the setup section heading + intro.** In `#admin-panel-setup`, change `<h3>Setup Stesen</h3>` to `<h3>Pengurusan Stesen</h3>`. (The station-count controls are added in Task 3.)

- [ ] **Step 7: Rewire the step next/back buttons.** In the group section (`#admin-panel-groups`), the footer currently has no wizard nav; add a next button before its closing `</div></section>` (inside the `.card`, after the existing `#groupSaveMsg`):

```html
          <div class="step-actions">
            <button class="step-next" onclick="goToAdminStep('setup')">Seterusnya: Pengurusan Stesen &#8594;</button>
          </div>
```

In the setup section, change its existing nav: the "Seterusnya" button target stays `passwords`, but add a Back button to `groups`. Replace the setup section's `.step-actions` block with:

```html
          <div class="step-actions">
            <button onclick="goToAdminStep('groups')">&#8592; Kembali</button>
            <button class="step-next" onclick="goToAdminStep('passwords')">Seterusnya: Password Kumpulan &#8594;</button>
          </div>
```

- [ ] **Step 8: Update notes, step map, and default tab.** Replace `ADMIN_TAB_NOTES` (line ~1213) so it includes a `groups` note and reordered wording:

```javascript
const ADMIN_TAB_NOTES = {
  groups:'Langkah 1: tetapkan kumpulan, agih nama murid, dan urus ahli.',
  setup:'Langkah 2: lengkapkan maklumat dan permainan untuk setiap stesen.',
  passwords:'Langkah 3: semak dan agihkan password login kepada semua kumpulan.',
  qr:'Langkah 4: jana QR, cetak, dan sorokkan di lokasi yang dinyatakan.',
  session:'Langkah terakhir: mula atau tamatkan Treasure Hunt dari sini.',
  treasure:'Buka Smart Board untuk kawal peti harta karun dan bonus tamat.',
  dashboard:'Pantau status, stesen semasa, kunci, dan markah semua kumpulan.'
};
```

Replace `ADMIN_STEP_MAP` (line ~1222):

```javascript
const ADMIN_STEP_MAP = {groups:1,setup:2,passwords:3,qr:4,session:5};
```

Change the admin-login default tab: find `selectAdminTab('setup');` inside `loginAsAdmin` (line ~1136) and change it to:

```javascript
    selectAdminTab('groups');
```

(Leave the other `selectAdminTab('setup')` at line ~1187, which is inside the group-management Playwright-driven path/`tryRestoreSession`, as-is unless it is in `loginAsAdmin`; only the `loginAsAdmin` one changes. If both are in restore/login flows landing the admin on a tab, change only the one inside `loginAsAdmin`.)

- [ ] **Step 9: Run the test to verify it passes**

Run: `npx playwright test tests/station-count.spec.js --reporter=line`
Expected: PASS — option order is groups, setup, passwords, qr, session with the new labels.

- [ ] **Step 10: Run regressions**

Run: `npx playwright test tests/group-management.spec.js tests/student-island-journey.spec.js --reporter=line`
Expected: PASS — group-management tab still opens and works under the new order.

- [ ] **Step 11: Commit**

```bash
git add index.html tests/station-count.spec.js
git commit -m "feat: reorder admin tabs (groups first, stations second)"
```

---

### Task 3: Station-count editing UI (`index.html`)

**Files:**
- Modify: `index.html` — module `<script>` (after the `groups/roster.js` tag); `stationCount` global (near the other state globals); `currentStationCount()` helper; `buildStationsUI` (line ~1389); `collectStations` (line ~1423); the setup section controls (＋/−Stesen buttons + count label); `loadConfigCache` (set `stationCount`); a `syncStationSetupLock()` wired into `watchSession`.
- Test: `tests/station-count.spec.js` (append).

**Interfaces:**
- Consumes from Task 1: `window.StationLayout.clampStationCount`.
- Produces (used by Task 4): global `let stationCount`; `currentStationCount() -> number`; `addStation()`, `removeStation()`, `updateStationButtons()`, `syncStationSetupLock()`; `buildStationsUI`/`collectStations` loop `1..stationCount`.

- [ ] **Step 1: Append failing tests** to `tests/station-count.spec.js` (reuse `seedPage`, `seedWith`, `openAdmin`):

```javascript
test('station setup defaults to 3 blocks and +/- Stesen adjust within 3..6', async ({ page }) => {
  await seedPage(page, seedWith(3, {}));
  await openAdmin(page, 'setup');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(3);
  await page.click('#btnAddStation');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(4);
  await page.click('#btnAddStation');
  await page.click('#btnAddStation');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(6);
  await expect(page.locator('#btnAddStation')).toBeDisabled(); // capped at 6
  await page.click('#btnRemoveStation');
  await page.click('#btnRemoveStation');
  await page.click('#btnRemoveStation');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(3);
  await expect(page.locator('#btnRemoveStation')).toBeDisabled(); // floored at 3
});

test('existing 6-station config renders 6 blocks', async ({ page }) => {
  await seedPage(page, seedWith(6, {}));
  await openAdmin(page, 'setup');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(6);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test tests/station-count.spec.js --reporter=line`
Expected: FAIL — `#btnAddStation` does not exist; blocks are always 6.

- [ ] **Step 3: Load the module.** After the `groups/roster.js` script tag, add:

```html
<script src="stations/layout.js"></script>
```

- [ ] **Step 4: Add the `stationCount` global + `currentStationCount()`.** On the line after `let groupDraft = [];`, add:

```javascript
let stationCount = 3;
function currentStationCount(){ return StationLayout.clampStationCount(Object.keys(stations||{}).length); }
```

- [ ] **Step 5: Loop `1..stationCount` in `buildStationsUI` and `collectStations`.** In `buildStationsUI` change `for(let i=1;i<=6;i++){` to `for(let i=1;i<=stationCount;i++){`. In `collectStations` change `for(let i=1;i<=6;i++){` to `for(let i=1;i<=stationCount;i++){`.

- [ ] **Step 6: Initialise `stationCount` when config loads.** In `loadConfigCache`, set it from the loaded stations before `buildStationsUI`. Change the body so it reads:

```javascript
    stations = cfg.stations || {};
    groups = cfg.groups || {};
    stationCount = StationLayout.clampStationCount(Object.keys(stations).length);
    renderGroupLoginOptions();
    buildStationsUI(stations);
```

- [ ] **Step 7: Add the ＋/−Stesen controls + count label.** In `#admin-panel-setup`, replace the `<h3>Pengurusan Stesen</h3>` line (from Task 2) and the intro with a heading that shows the count plus the two buttons:

```html
          <h3>Pengurusan Stesen (<span id="stationCountLabel">3</span>)</h3>
          <p class="admin-panel-intro">Tetapkan bilangan stesen (3–6) dan lengkapkan setiap stesen. Tekan ＋Stesen / −Stesen untuk laraskan bilangan.</p>
          <div id="stationSetupLock"></div>
          <div class="feature-actions">
            <button id="btnAddStation" class="secondary" onclick="addStation()">＋ Stesen</button>
            <button id="btnRemoveStation" onclick="removeStation()">− Stesen</button>
          </div>
```

Insert this immediately before the existing `<div id="stationsArea"></div>` in that section (keep `stationsArea` and the rest of the section as-is).

- [ ] **Step 8: Add the add/remove/lock handlers.** Add these functions immediately before `function buildStationsUI(existing){`:

```javascript
function updateStationButtons(){
  const label=document.getElementById('stationCountLabel');
  if(label) label.textContent=String(stationCount);
  const locked=!!(sessionInfo && sessionInfo.status==='active');
  const add=document.getElementById('btnAddStation');
  const rem=document.getElementById('btnRemoveStation');
  if(add) add.disabled = locked || stationCount>=StationLayout.MAX_STATIONS;
  if(rem) rem.disabled = locked || stationCount<=StationLayout.MIN_STATIONS;
}
function addStation(){
  if(sessionInfo && sessionInfo.status==='active') return;
  if(stationCount>=StationLayout.MAX_STATIONS) return;
  const cur=collectStations();
  stationCount=StationLayout.clampStationCount(stationCount+1);
  buildStationsUI(cur);
}
function removeStation(){
  if(sessionInfo && sessionInfo.status==='active') return;
  if(stationCount<=StationLayout.MIN_STATIONS) return;
  const cur=collectStations();
  delete cur[stationCount];
  stationCount=StationLayout.clampStationCount(stationCount-1);
  buildStationsUI(cur);
}
function syncStationSetupLock(){
  const panel=document.getElementById('admin-panel-setup');
  const lock=document.getElementById('stationSetupLock');
  const locked=!!(sessionInfo && sessionInfo.status==='active');
  if(lock) lock.innerHTML = locked
    ? '<div class="msg">🔒 Sesi sedang aktif — bilangan stesen dikunci. Tekan Tamat sebelum mengubah.</div>' : '';
  updateStationButtons();
  if(panel){ panel.querySelectorAll('.station-block input, .station-block select, .station-block button').forEach(el=>{ el.disabled=locked; }); }
}
```

- [ ] **Step 9: Refresh the buttons after each render.** At the very end of `buildStationsUI` (right before its closing `}`), add:

```javascript
  updateStationButtons();
```

- [ ] **Step 10: Keep the lock reactive.** In `watchSession`, right after the `syncGroupManagerLock();` line, add:

```javascript
    syncStationSetupLock();
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npx playwright test tests/station-count.spec.js --reporter=line`
Expected: PASS — 3 default blocks; ＋/− adjust within 3..6 with the right disabled states; a 6-station seed shows 6 blocks.

- [ ] **Step 12: Run node + regression specs**

Run: `node --test stations/layout.test.js groups/roster.test.js run/tracker.test.js tangram/engine.test.js && npx playwright test tests/group-management.spec.js --reporter=line`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add index.html tests/station-count.spec.js
git commit -m "feat: configurable station count (3-6) in station setup"
```

---

### Task 4: Runtime adaptation to N (`index.html`)

**Files:**
- Modify: `index.html` — rotation helpers (`rotationFor`, `isValidStationId`, `startStationForGroup`), `collectGroups`, `buildGroupsFromDraft`, `pushConfig` (add `reindexGroupsForCount`), the `((gid-1)%6)+1` fallbacks and start-station `<select>` in `showLoginPasswords`, completion in `submitCompletion`, `reactToSessionForGroup`, `watchDashboard` rows, `renderKeyrowMini`, `renderJourneyIslandButtons`, `chestVis` + `renderSmartBoard`, and `showGoToBoard`.
- Test: `tests/station-count.spec.js` (append).

**Interfaces:**
- Consumes from Task 1: `StationLayout.{clampStationCount, defaultStartStation, rotationOrder, isJourneyDone}`. From Task 3: `currentStationCount()`.
- Produces: `reindexGroupsForCount(existingGroups, count)`; all runtime `6`s become `N`.

- [ ] **Step 1: Append the failing tests** to `tests/station-count.spec.js`:

```javascript
test('saving 3 stations regenerates group orders to length 3', async ({ page }) => {
  const groups = {
    1: { id:1, name:'Kumpulan 1', startStation:5, order:[5,6,1,2,3,4], loginPassword:'1001', members:['A'] },
    2: { id:2, name:'Kumpulan 2', startStation:2, order:[2,3,4,5,6,1], loginPassword:'1002', members:['B'] }
  };
  await seedPage(page, seedWith(6, groups));
  await openAdmin(page, 'setup');
  // reduce to 3 stations
  await page.click('#btnRemoveStation');
  await page.click('#btnRemoveStation');
  await page.click('#btnRemoveStation');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(3);
  await page.evaluate(() => pushConfig());
  const gr = await page.evaluate(() => db.ref('gamestation2026/config/groups').once('value').then(s => s.val()));
  expect(gr['1'].order.length).toBe(3);
  expect(gr['2'].order.length).toBe(3);
  expect(gr['1'].startStation).toBeLessThanOrEqual(3); // clamped from 5
  expect(gr['1'].members).toEqual(['A']);              // roster preserved
  const st = await page.evaluate(() => db.ref('gamestation2026/config/stations').once('value').then(s => s.val()));
  expect(Object.keys(st).length).toBe(3);
});

test('journey map shows N islands for a 3-station config', async ({ page }) => {
  const groups = { 1: { id:1, name:'Kumpulan 1', startStation:1, order:[1,2,3], loginPassword:'1001', members:[] } };
  await seedPage(page, seedWith(3, groups));
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(async () => {
    await loadConfigCache();
    currentGroupId = '1';
    progress = { currentIndex:0, status:'idle', completedStations:{}, keys:[], totalScore:0 };
    showJourneyMap();
  });
  await expect(page.locator('#journeyIslandButtons .journey-island-button')).toHaveCount(3);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx playwright test tests/station-count.spec.js --reporter=line`
Expected: FAIL — group orders stay length 6; journey shows 6 islands.

- [ ] **Step 3: Delegate the rotation helpers to the module.** Replace `rotationFor` (line ~1454-1458), `isValidStationId` (line ~1459-1462), and keep `startStationForGroup` but make it count-aware:

```javascript
function rotationFor(startStation, count){
  return StationLayout.rotationOrder(startStation, count == null ? currentStationCount() : count);
}
function isValidStationId(value, count){
  const N = count == null ? currentStationCount() : count;
  const id=Number(value);
  return Number.isInteger(id) && id>=1 && id<=N;
}
function startStationForGroup(group, fallback){
  return isValidStationId(group?.startStation) ? Number(group.startStation) : fallback;
}
```

- [ ] **Step 4: Add `reindexGroupsForCount` and rebuild orders in `pushConfig`.** Add this function immediately before `function pushConfig(){`:

```javascript
function reindexGroupsForCount(existingGroups, count){
  const N=StationLayout.clampStationCount(count);
  const out={};
  Object.keys(existingGroups||{}).sort((a,b)=>Number(a)-Number(b)).forEach(gid=>{
    const g=existingGroups[gid]; const id=Number(gid);
    let start=StationLayout.defaultStartStation(id, N);
    const cur=Number(g && g.startStation);
    if(Number.isInteger(cur) && cur>=1 && cur<=N) start=cur;
    out[gid]={...g, startStation:start, order:StationLayout.rotationOrder(start, N)};
  });
  return out;
}
```

Then replace the `pushConfig` body (line ~1497-1517) with:

```javascript
function pushConfig(){
  const st = collectStations();
  if(!validateStationPasswords(st) || !validateWorksheetStations(st)) return;
  if(sessionInfo && sessionInfo.status==='active'){
    document.getElementById('pushStatus').innerHTML='<div class="msg err">Tidak boleh simpan semasa sesi aktif. Tekan Tamat dahulu.</div>';
    return;
  }
  const N = StationLayout.clampStationCount(Object.keys(st).length);
  const hasGroups = groups && Object.keys(groups).length>0;
  const baseGroups = hasGroups ? groups : collectGroups(N);
  const gr = reindexGroupsForCount(baseGroups, N);
  const prog={};
  Object.keys(gr).forEach(gid=>{ prog[gid]={currentIndex:0,status:'idle',completedStations:{},keys:[],totalScore:0}; });
  db.ref(PATH+'/config/stations').set(st);
  db.ref(PATH+'/config/groups').set(gr);
  db.ref(PATH+'/session').set({status:'setup'});
  db.ref(PATH+'/progress').set(prog).then(()=>{
    stations=st; groups=gr;
    stationCount = N;
    renderGroupLoginOptions();
    let listHtml = '<h4>Password Login Kumpulan (beri kepada setiap kumpulan)</h4><table><tr><th>Kumpulan</th><th>Password</th><th>Mula di Stesen</th></tr>';
    Object.values(gr).forEach(g=>{ listHtml += `<tr><td>${g.name}</td><td><b>${g.loginPassword}</b></td><td>${g.startStation}</td></tr>`; });
    listHtml += '</table>';
    document.getElementById('pushStatus').innerHTML='<div class="msg ok">✅ Config di-push. '+Object.keys(gr).length+' kumpulan sedia.</div>'+listHtml;
  }).catch(err=>{
    document.getElementById('pushStatus').innerHTML=`<div class="msg err">❌ Gagal menyimpan: ${escapeHtml(err && err.message ? err.message : err)}.</div>`;
  });
}
```

- [ ] **Step 5: Make `collectGroups` count-aware.** Change its signature and the two `6`-based lines. Replace `function collectGroups(){` with `function collectGroups(count){` and inside it change `const defaultStart=((i-1)%6)+1;` to `const N=StationLayout.clampStationCount(count); const defaultStart=StationLayout.defaultStartStation(i, N);` and change the `order:rotationFor(startStation)` in its `out[i]=` object to `order:StationLayout.rotationOrder(startStation, N)`.

- [ ] **Step 6: Make `buildGroupsFromDraft` count-aware.** Replace the whole function with:

```javascript
function buildGroupsFromDraft(draftMembers, existingGroups){
  const N = currentStationCount();
  const out = {};
  const usedPasswords = new Set();
  draftMembers.forEach((members, idx)=>{
    const id = idx+1;
    const existing = existingGroups && existingGroups[id];
    const existingPass = numericLoginPassword(existing && existing.loginPassword);
    const loginPassword = existingPass && !usedPasswords.has(existingPass)
      ? (usedPasswords.add(existingPass), existingPass)
      : generateLoginPassword(usedPasswords);
    let start = StationLayout.defaultStartStation(id, N);
    const cur = Number(existing && existing.startStation);
    if(Number.isInteger(cur) && cur>=1 && cur<=N) start=cur;
    out[id] = { id, name:'Kumpulan '+id, startStation:start,
                order:StationLayout.rotationOrder(start, N), loginPassword, members: members.slice() };
  });
  return out;
}
```

- [ ] **Step 7: Fix the `((gid-1)%6)+1` fallbacks and the start-station select.** In `showLoginPasswords`, make these three replacements (lines ~1534, ~1549, ~1591) — change every `((Number(gid)-1)%6)+1` to `StationLayout.defaultStartStation(Number(gid), currentStationCount())`. And change the options builder (line ~1535) from `Array.from({length:6},(_,index)=>index+1)` to `Array.from({length:currentStationCount()},(_,index)=>index+1)`.

- [ ] **Step 8: Fix completion + finale gates.** Make these exact replacements:

`submitCompletion` (line ~2383): `const done = newIndex>=6;` → `const done = StationLayout.isJourneyDone(newIndex, currentStationCount());`

`reactToSessionForGroup` (line ~1657): `if(p.status==='won' || p.currentIndex>=6){ showGoToBoard(); return; }` → `if(p.status==='won' || StationLayout.isJourneyDone(p.currentIndex||0, currentStationCount())){ showGoToBoard(); return; }`

`watchDashboard` row (line ~1646): replace `currentIndex>=6 ? '📦 Selesai 6 Pulau'` with `StationLayout.isJourneyDone(currentIndex, currentStationCount()) ? ('📦 Selesai '+currentStationCount()+' Pulau')`.

`watchDashboard` row (line ~1647): replace `${p.currentIndex||0}/6` with `${p.currentIndex||0}/${currentStationCount()}`.

- [ ] **Step 9: Fix the mini keyrow + journey islands.** In `renderKeyrowMini` (line ~1681) change `for(let i=1;i<=6;i++){` to `for(let i=1;i<=currentStationCount();i++){`. In `renderJourneyIslandButtons` (line ~786) change `for(let position=1;position<=6;position++){` to `for(let position=1;position<=currentStationCount();position++){`.

- [ ] **Step 10: Fix the phone finale text.** In `showGoToBoard` (line ~2421-2422) change `<h2>🎉 Semua 6 Kunci Dikumpul!</h2>` to `<h2>🎉 Semua ${currentStationCount()} Kunci Dikumpul!</h2>` and change `${'<div class="key">🔑</div>'.repeat(6)}` to `${'<div class="key">🔑</div>'.repeat(currentStationCount())}`. (This template literal already uses `${...}`; if the surrounding string is not a template literal, convert that heading/keyrow line to a template literal so the interpolation works.)

- [ ] **Step 11: Fix the chest + smart board to N keyholes.** Change `chestVis` (line ~2458-2461) to take a total:

```javascript
function chestVis(litCount, opened, total){
  const n = StationLayout.clampStationCount(total==null ? 6 : total);
  const holes = KEYHOLES.slice(0, n).map((k,i)=>
    `<span class="kh${(i<litCount)?' lit':''}" style="left:${k[0]}%;top:${k[1]}%"></span>`).join('');
  return `<div class="chest-vis${opened?' opened':''}">${holes}</div>`;
}
```

In `renderSmartBoard`, add `const N = currentStationCount();` as its first line, then make these replacements in that function:
- `const keys=Math.min((p.keys||[]).length, 6);` → `const keys=Math.min((p.keys||[]).length, N);`
- `chestVis(0,true)` → `chestVis(0,true,N)`
- `if((p.currentIndex||0)>=6){` → `if(StationLayout.isJourneyDone(p.currentIndex||0, N)){`
- `chestVis(6,false)` → `chestVis(N,false,N)`
- `chestVis(keys,false)` (both occurrences) → `chestVis(keys,false,N)`
- `<div class="c-sub">${keys}/6 kunci</div>` → `<div class="c-sub">${keys}/${N} kunci</div>`
- the board-head `<b>6 kunci</b>` → `<b>${N} kunci</b>`

And in `openChestOnBoard`'s guard (line ~2543) change `(${(p.keys||[]).length}/6)` to `(${(p.keys||[]).length}/${currentStationCount()})`.

- [ ] **Step 12: Run the new tests to verify they pass**

Run: `npx playwright test tests/station-count.spec.js --reporter=line`
Expected: PASS — saving 3 stations rebuilds group orders to length 3 (startStation clamped, roster preserved); journey shows 3 islands.

- [ ] **Step 13: Run the full suite**

Run: `node --test stations/layout.test.js groups/roster.test.js run/tracker.test.js tangram/engine.test.js && npx playwright test --reporter=line`
Expected: PASS — node tests all pass; every Playwright spec passes.

- [ ] **Step 14: Commit**

```bash
git add index.html tests/station-count.spec.js
git commit -m "feat: adapt rotation, completion, map, and chest to dynamic station count"
```

---

## Self-Review

**Spec coverage:**
- Tab reorder (groups=1, setup=2, …) + relabel + step bar + default tab — Task 2. ✓
- Station count 3–6 default 3, ＋/−Stesen with bounds, preserve typed values, count label, session lock — Task 3. ✓
- `stations/layout.js` pure module (clamp/rotation/default/completion) + tests — Task 1. ✓
- Rotation over N; group orders regenerated on save (preserve password/members, clamp startStation); reset progress — Task 4 (`reindexGroupsForCount`, `pushConfig`, `collectGroups`, `buildGroupsFromDraft`). ✓
- Completion at N; journey shows N islands; chest shows first N keyholes; displays x/N — Task 4. ✓
- Start-station selects 1..N; `isValidStationId` bound to N — Task 4. ✓
- Locks during active session — Task 3 (`syncStationSetupLock`) + Task 4 (`pushConfig` guard). ✓
- Reuse existing art (first N islands/keyholes), never > 6 — `MAP_ISLANDS[1..N]`, `KEYHOLES.slice(0,N)`, `clampStationCount` cap 6. ✓
- Tests: node + Playwright (with CDN route-block) — Tasks 1-4. ✓

**Placeholder scan:** No TBD/TODO; every step has complete code or an exact old→new replacement. ✓

**Type consistency:** `StationLayout.{clampStationCount, defaultStartStation, rotationOrder, isJourneyDone}` names/signatures match across tasks. `stationCount` (UI var, Task 3) vs `currentStationCount()` (runtime, Task 3) used consistently — editing paths use `stationCount`, runtime paths use `currentStationCount()`. `reindexGroupsForCount(existingGroups, count)` (Task 4) returns the same group-object shape the app reads. `rotationFor(startStation, count?)` and `isValidStationId(value, count?)` keep backward-compatible single-arg calls via `currentStationCount()` defaults. `chestVis(litCount, opened, total?)` defaults total to 6 so any unchanged caller still renders correctly. ✓
