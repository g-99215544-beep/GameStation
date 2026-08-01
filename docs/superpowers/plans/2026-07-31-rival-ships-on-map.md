# Rival Ships on the Voyage Map — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the three nearest competing groups as named ships with HP bars on a pupil's voyage map, sailing to the next island the moment that group clears a station.

**Architecture:** A new pure module `map/rivals.js` decides *which* rivals to show and *where* to draw them; `app/views-map.js` owns a live `huntRef('progress')` listener and renders the ships. Rival positions mean race standing (`currentIndex`), not physical location. No new Firebase fields and no security-rule changes — every value already exists under `progress/<gid>`.

**Tech Stack:** Vanilla ES2020 classic scripts (no bundler, no modules), Firebase Realtime Database compat SDK v9.23.0, `node:test` for unit tests, Playwright for browser specs.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-31-rival-ships-on-map-design.md`. Read it before Task 1.
- **No `database.rules.json` changes.** No new Firebase fields.
- **All new modules use the project's UMD wrapper** — see `stations/layout.js` for the exact shape. They must load under both `require()` and a browser `<script>` tag.
- **All classic scripts share one global lexical scope.** Top-level `let` in one file is visible to every other file. Do not add `window.` prefixes; follow the existing style.
- **Every `<script src>` added to `index.html` MUST also be added to `LOCAL_ASSETS` in `offline/preload.js`.** `offline/preload.test.js` fails otherwise, and the file would be missing from the offline cache.
- **Every Playwright spec MUST block the Firebase CDN** with `await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));` before `page.goto`. Without it the real SDK loads and the test writes to the live production database.
- **UI copy is Malay.** Group labels come from `groups[gid].name`, falling back to `'Kumpulan ' + gid`.
- **Existing pupil-ship behaviour must not change.** The pupil's own voyage animation, audio and timing stay exactly as they are today, including its deliberate disregard for `prefers-reduced-motion`.
- **Running tests:**
  - Unit: `node --test map/rivals.test.js`
  - Browser: `npx playwright test tests/rival-ships.spec.js`
  - `package.json` and `node_modules/` are gitignored and absent from a fresh clone. If `npx playwright test` cannot resolve `playwright/test`, run `npm install --no-save playwright` first. Never commit `package.json`.

## File Structure

| File | Responsibility |
|---|---|
| `map/rivals.js` | **New.** Pure logic: rank groups, select the nearest three, assign berths, diff positions. No DOM, no Firebase. |
| `map/rivals.test.js` | **New.** `node:test` unit tests for the above. |
| `tests/rival-ships.spec.js` | **New.** Playwright coverage of rendering, movement, tapping and offline. |
| `app/views-map.js` | Owns `allProgress` and the map-lifetime progress listener; renders and animates rival ships. |
| `app/cannon-ui.js` | Loses its private progress listener; gains a highlighted-target mode; its animation loop is extracted for reuse. |
| `app/connectivity.js` | Re-attaches the map listener when signal returns. |
| `app/styles.css` | Rival ship, name plate and HP bar styling. |
| `index.html` | Loads `map/rivals.js`; holds the `#journeyRivalShips` container. |
| `offline/preload.js` | Registers `map/rivals.js` in the offline shell manifest. |
| `sw.js` | `CACHE_NAME` bump so returning devices drop the old shell. |

---

### Task 1: The `map/rivals.js` selection module

Pure logic only. Nothing is wired into the page in this task, so no existing test can break.

**Files:**
- Create: `map/rivals.js`
- Test: `map/rivals.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces — the global `RivalShips` with:
  - `MAX_RIVALS: number` (3)
  - `BERTHS: Array<{dx:number, dy:number}>` (3 entries, percentage-point offsets)
  - `positionOf(entry: object|null, stationCount: number): number`
  - `rank(allProgress: object, groups: object, stationCount: number): Array<Ranked>` where `Ranked = {gid: string, name: string, position: number, score: number, finished: boolean}`
  - `selectNearest(ranked: Array<Ranked>, myGid: string|number, max?: number): Array<Ranked>`
  - `pointAt(position: number, slot: number, stops: object): {x:number, y:number}`
  - `layout(selected: Array<Ranked>, stops: object): Array<Ranked & {slot:number, x:number, y:number}>`
  - `positions(selected: Array<Ranked>): object` mapping `gid → position`
  - `diff(previous: object, selected: Array<Ranked>): Array<{gid:string, from:number, to:number}>`

- [ ] **Step 1: Write the failing test**

Create `map/rivals.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert');
const R = require('./rivals.js');

const STOPS = { 0:{x:50,y:89}, 1:{x:57,y:78}, 2:{x:34,y:66}, 3:{x:59,y:55}, 4:{x:36,y:46}, 5:{x:62,y:36}, 6:{x:50,y:27} };
const groups = ids => Object.fromEntries(ids.map(id => [String(id), { id, name: 'Kumpulan ' + id }]));

test('MAX_RIVALS is three and there are three berths', () => {
  assert.strictEqual(R.MAX_RIVALS, 3);
  assert.strictEqual(R.BERTHS.length, 3);
});

test('positionOf reads currentIndex and clamps to the island count', () => {
  assert.strictEqual(R.positionOf({ currentIndex: 2 }, 6), 2);
  assert.strictEqual(R.positionOf({ currentIndex: 0 }, 6), 0);
  assert.strictEqual(R.positionOf({ currentIndex: 9 }, 6), 6);
  assert.strictEqual(R.positionOf({ currentIndex: -3 }, 6), 0);
  assert.strictEqual(R.positionOf({}, 6), 0);
  assert.strictEqual(R.positionOf(null, 6), 0);
  assert.strictEqual(R.positionOf({ currentIndex: 'x' }, 6), 0);
});

test('positionOf docks a group that opened its chest at the last island', () => {
  assert.strictEqual(R.positionOf({ currentIndex: 1, status: 'won' }, 6), 6);
});

test('rank orders by island, then score, then group id', () => {
  const all = {
    1: { currentIndex: 1, totalScore: 500 },
    2: { currentIndex: 3, totalScore: 100 },
    3: { currentIndex: 1, totalScore: 900 },
    4: { currentIndex: 1, totalScore: 900 }
  };
  const order = R.rank(all, groups([1, 2, 3, 4]), 6).map(e => e.gid);
  assert.deepStrictEqual(order, ['2', '3', '4', '1']);
});

test('rank keeps a group with no progress entry at the start line', () => {
  const ranked = R.rank({ 1: { currentIndex: 2 } }, groups([1, 2]), 6);
  const idle = ranked.find(e => e.gid === '2');
  assert.strictEqual(idle.position, 0);
  assert.strictEqual(idle.score, 0);
  assert.strictEqual(idle.finished, false);
  assert.strictEqual(idle.name, 'Kumpulan 2');
});

test('rank falls back to a generated name when the group config has none', () => {
  const ranked = R.rank({}, { 7: { id: 7 } }, 6);
  assert.strictEqual(ranked[0].name, 'Kumpulan 7');
});

test('selectNearest takes two ahead and one behind', () => {
  const ranked = R.rank({
    1: { currentIndex: 5 }, 2: { currentIndex: 4 }, 3: { currentIndex: 3 },
    4: { currentIndex: 2 }, 5: { currentIndex: 1 }
  }, groups([1, 2, 3, 4, 5]), 6);
  assert.deepStrictEqual(R.selectNearest(ranked, '3').map(e => e.gid), ['2', '1', '4']);
});

test('selectNearest backfills from behind when the pupil leads', () => {
  const ranked = R.rank({
    1: { currentIndex: 5 }, 2: { currentIndex: 4 }, 3: { currentIndex: 3 }, 4: { currentIndex: 2 }
  }, groups([1, 2, 3, 4]), 6);
  assert.deepStrictEqual(R.selectNearest(ranked, '1').map(e => e.gid), ['2', '3', '4']);
});

test('selectNearest backfills from ahead when the pupil is last', () => {
  const ranked = R.rank({
    1: { currentIndex: 5 }, 2: { currentIndex: 4 }, 3: { currentIndex: 3 }, 4: { currentIndex: 2 }
  }, groups([1, 2, 3, 4]), 6);
  assert.deepStrictEqual(R.selectNearest(ranked, '4').map(e => e.gid), ['3', '2', '1']);
});

test('selectNearest returns fewer than three in a small hunt', () => {
  const ranked = R.rank({ 1: { currentIndex: 2 }, 2: { currentIndex: 1 } }, groups([1, 2]), 6);
  assert.deepStrictEqual(R.selectNearest(ranked, '1').map(e => e.gid), ['2']);
});

test('selectNearest returns the leaders when the pupil is not in the standings', () => {
  const ranked = R.rank({
    1: { currentIndex: 5 }, 2: { currentIndex: 4 }, 3: { currentIndex: 3 }, 4: { currentIndex: 2 }
  }, groups([1, 2, 3, 4]), 6);
  assert.deepStrictEqual(R.selectNearest(ranked, '99').map(e => e.gid), ['1', '2', '3']);
});

test('layout gives rivals sharing an island three distinct berths', () => {
  const ranked = R.rank({
    1: { currentIndex: 3 }, 2: { currentIndex: 3 }, 3: { currentIndex: 3 }
  }, groups([1, 2, 3]), 6);
  const placed = R.layout(ranked, STOPS);
  assert.deepStrictEqual(placed.map(e => e.slot), [0, 1, 2]);
  assert.strictEqual(new Set(placed.map(e => `${e.x},${e.y}`)).size, 3);
});

test('layout never puts a rival on the exact mooring the pupil occupies', () => {
  const ranked = R.rank({ 1: { currentIndex: 3 } }, groups([1]), 6);
  const [placed] = R.layout(ranked, STOPS);
  assert.ok(placed.x !== STOPS[3].x || placed.y !== STOPS[3].y);
});

test('layout restarts berth numbering on each island', () => {
  const ranked = R.rank({
    1: { currentIndex: 3 }, 2: { currentIndex: 3 }, 3: { currentIndex: 1 }
  }, groups([1, 2, 3]), 6);
  const placed = R.layout(ranked, STOPS);
  assert.strictEqual(placed.find(e => e.gid === '3').slot, 0);
});

test('layout is stable regardless of the order it receives rivals', () => {
  const ranked = R.rank({
    1: { currentIndex: 3 }, 2: { currentIndex: 3 }
  }, groups([1, 2]), 6);
  const forward = R.layout(ranked, STOPS);
  const backward = R.layout(ranked.slice().reverse(), STOPS);
  const slotOf = (list, gid) => list.find(e => e.gid === gid).slot;
  assert.strictEqual(slotOf(forward, '1'), slotOf(backward, '1'));
  assert.strictEqual(slotOf(forward, '2'), slotOf(backward, '2'));
});

test('pointAt applies the same berth offset at any island', () => {
  const here = R.pointAt(3, 1, STOPS);
  assert.strictEqual(here.x, STOPS[3].x + R.BERTHS[1].dx);
  assert.strictEqual(here.y, STOPS[3].y + R.BERTHS[1].dy);
});

test('pointAt falls back to the start line for an unknown island', () => {
  const point = R.pointAt(99, 0, STOPS);
  assert.strictEqual(point.x, STOPS[0].x + R.BERTHS[0].dx);
});

test('positions maps group id to island', () => {
  const ranked = R.rank({ 1: { currentIndex: 3 }, 2: { currentIndex: 1 } }, groups([1, 2]), 6);
  assert.deepStrictEqual(R.positions(ranked), { 1: 3, 2: 1 });
});

test('diff reports only groups whose island changed', () => {
  const ranked = R.rank({ 1: { currentIndex: 3 }, 2: { currentIndex: 1 } }, groups([1, 2]), 6);
  assert.deepStrictEqual(R.diff({ 1: 2, 2: 1 }, ranked), [{ gid: '1', from: 2, to: 3 }]);
});

test('diff ignores a rival that was not on screen before', () => {
  const ranked = R.rank({ 1: { currentIndex: 3 } }, groups([1]), 6);
  assert.deepStrictEqual(R.diff({}, ranked), []);
  assert.deepStrictEqual(R.diff(null, ranked), []);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test map/rivals.test.js`
Expected: FAIL — `Cannot find module './rivals.js'`

- [ ] **Step 3: Write the implementation**

Create `map/rivals.js`:

```js
// Which rival ships a pupil sees on their voyage map, and where each one sits.
// A rival's island means race standing, not physical location: a group that has
// cleared three stations is drawn at the pupil's Pulau 3, so ships further up
// the map are simply groups that are beating them.
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.RivalShips = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_RIVALS = 3;
  // Three fixed berths around a mooring, in map percentage points. None of them
  // is {0,0}: that exact spot is where the pupil's own ship sits, and a rival
  // hiding underneath it would read as a rendering bug.
  const BERTHS = [{ dx: -10, dy: 2 }, { dx: 10, dy: 3 }, { dx: 0, dy: 6.5 }];

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  // Group ids are numeric strings ('1'..'14'), so a plain string sort would put
  // '10' before '2'. Numeric collation keeps the standings in human order.
  function byId(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  function positionOf(entry, stationCount) {
    const count = Math.max(0, Math.floor(num(stationCount, 0)));
    if (entry && entry.status === 'won') return count;
    const index = Math.floor(num(entry && entry.currentIndex, 0));
    if (index < 0) return 0;
    return index > count ? count : index;
  }

  // Every configured group is ranked, including ones with no progress entry
  // yet: they belong at the start line, not missing from the race.
  function rank(allProgress, groups, stationCount) {
    const progress = allProgress || {};
    const config = groups || {};
    return Object.keys(config).map(gid => {
      const entry = progress[gid] || {};
      return {
        gid: String(gid),
        name: (config[gid] && config[gid].name) || ('Kumpulan ' + gid),
        position: positionOf(entry, stationCount),
        score: num(entry.totalScore, 0),
        finished: entry.status === 'won'
      };
    }).sort((a, b) => {
      if (a.position !== b.position) return b.position - a.position;
      if (a.score !== b.score) return b.score - a.score;
      return byId(a.gid, b.gid);
    });
  }

  // Two ahead and one behind: overtaking is what a pupil acts on, but being
  // chased is what makes them hurry. At either end of the standings the
  // shortfall is taken from whichever side still has groups.
  function selectNearest(ranked, myGid, max) {
    const list = Array.isArray(ranked) ? ranked : [];
    const limit = max == null ? MAX_RIVALS : max;
    const me = list.findIndex(entry => String(entry.gid) === String(myGid));
    if (me < 0) return list.slice(0, limit);
    const ahead = list.slice(0, me).reverse();   // nearest ahead first
    const behind = list.slice(me + 1);           // nearest behind first
    const takeAhead = Math.min(2, ahead.length, limit);
    const takeBehind = Math.min(limit - takeAhead, behind.length);
    const picked = ahead.slice(0, takeAhead).concat(behind.slice(0, takeBehind));
    if (picked.length < limit) {
      picked.push(...ahead.slice(takeAhead, takeAhead + (limit - picked.length)));
    }
    return picked;
  }

  function pointAt(position, slot, stops) {
    const table = stops || {};
    const stop = table[position] || table[0] || { x: 50, y: 89 };
    const berth = BERTHS[num(slot, 0) % BERTHS.length];
    return { x: stop.x + berth.dx, y: stop.y + berth.dy };
  }

  // Berths are handed out per island in group-id order, never in the order
  // selectNearest happened to return, so a ship keeps the same berth across
  // re-renders instead of hopping sideways whenever the standings shuffle.
  function layout(selected, stops) {
    const used = {};
    return (Array.isArray(selected) ? selected.slice() : [])
      .sort((a, b) => byId(a.gid, b.gid))
      .map(entry => {
        const slot = used[entry.position] == null ? 0 : used[entry.position] + 1;
        used[entry.position] = slot;
        return Object.assign({}, entry, { slot }, pointAt(entry.position, slot, stops));
      });
  }

  function positions(selected) {
    const out = {};
    (Array.isArray(selected) ? selected : []).forEach(entry => { out[entry.gid] = entry.position; });
    return out;
  }

  // A rival with no previous position is new to the screen and must not sail in
  // from nowhere — it simply appears. That is also what makes reconnecting
  // quiet: the previous map is cleared when the listener detaches.
  function diff(previous, selected) {
    const before = previous || {};
    return (Array.isArray(selected) ? selected : [])
      .filter(entry => before[entry.gid] != null && before[entry.gid] !== entry.position)
      .map(entry => ({ gid: entry.gid, from: before[entry.gid], to: entry.position }));
  }

  return { MAX_RIVALS, BERTHS, positionOf, rank, selectNearest, pointAt, layout, positions, diff };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test map/rivals.test.js`
Expected: PASS — 20 tests, 0 failures

- [ ] **Step 5: Commit**

```bash
git add map/rivals.js map/rivals.test.js
git commit -m "Add rival ship selection and berth layout module"
```

---

### Task 2: Move the progress listener to the map's lifetime

The live `huntRef('progress')` listener currently belongs to the cannon panel. The map needs it too, and the map is the only screen the cannon panel opens from — so the map becomes its owner and the panel simply reads what is already there.

**Files:**
- Modify: `app/views-map.js` (add listener functions; call them from `showJourneyMap`/`hideJourneyMap`)
- Modify: `app/cannon-ui.js:1-2` (move `allProgress` out), `:24-50` (drop the private listener)
- Modify: `app/connectivity.js:33-39` (re-attach on reconnect)
- Modify: `index.html:17` (load `map/rivals.js`), `index.html:53` (rival container)
- Modify: `offline/preload.js:16` (register the new script)

**Interfaces:**
- Consumes: `RivalShips` from Task 1.
- Produces:
  - `allProgress: object` — now declared in `app/views-map.js`, live while the map is open.
  - `attachMapProgressListener(): void`
  - `detachMapProgressListener(): void`

> This task deliberately stops at the data layer. Nothing calls a rival
> renderer yet — Task 3 introduces that function **and** its call sites in one
> move, rather than leaving an empty stub behind here for a reviewer to trip
> over.

- [ ] **Step 1: Write the failing test**

Create `tests/rival-ships.spec.js`:

```js
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');
const installFakeFirebase = require('./helpers/fake-firebase.js');

const INDEX = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const STATION_COUNT = 6;

function order(startStation) {
  return Array.from({ length: STATION_COUNT }, (_, i) => ((startStation - 1 + i) % STATION_COUNT) + 1);
}

// Fourteen groups and six stations mirrors a real hunt, which is the only size
// at which "show just the three nearest" is actually doing any work.
function seedHunt(progressOverrides = {}) {
  const stations = Object.fromEntries(Array.from({ length: STATION_COUNT }, (_, i) => {
    const id = i + 1;
    return [id, { id, name: `Stesen ${id}`, location: `Lokasi ${id}`, password: `PASS${id}`,
                  timeLimitMin: 10, gameType: 'lembaran_kerja',
                  gameDataRaw: JSON.stringify({ questions: [{ answer: '1', image: '' }] }) }];
  }));
  const groups = Object.fromEntries(Array.from({ length: 14 }, (_, i) => {
    const id = i + 1;
    const startStation = ((id - 1) % STATION_COUNT) + 1;
    return [id, { id, name: `Kumpulan ${id}`, loginPassword: String(1000 + id),
                  startStation, order: order(startStation), members: [] }];
  }));
  const progress = Object.fromEntries(Object.keys(groups).map(gid => [gid, {
    currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0, hp: 100
  }]));
  Object.keys(progressOverrides).forEach(gid => {
    progress[gid] = Object.assign({}, progress[gid], progressOverrides[gid]);
  });
  return {
    gamestation2026: {
      activeHuntId: 'h1',
      hunts: { h1: { name: 'Ujian Kapal', createdAt: 1, updatedAt: 1,
                     session: { status: 'active', startedAt: 1 },
                     config: { stations, groups, cannon: { enabled: true, damagePercent: 10, startingAmmo: 2 } },
                     progress } }
    }
  };
}

// Drives the map directly rather than playing six stations to get there. The
// journey map is a plain function of currentGroupId + progress, and
// tests/student-island-journey.spec.js already establishes this approach.
async function openMapAs(page, seed, gid) {
  // Block the real Firebase CDN so the injected mock stays authoritative.
  // Without this the real SDK loads and writes to the production database.
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(installFakeFirebase, seed);
  await page.goto(INDEX);
  await expect(page.locator('#view-login')).toHaveClass(/active/);
  await page.evaluate(async id => {
    currentHuntId = 'h1';
    currentGroupId = id;
    const snap = await huntRef('progress/' + id).once('value');
    progress = snap.val();
    show('view-clue');
    showJourneyMap();
  }, String(gid));
  await expect(page.locator('#journeyMap')).toBeVisible();
}

test('the map keeps every group\'s progress live while it is open', async ({ page }) => {
  await openMapAs(page, seedHunt({ 2: { currentIndex: 4 } }), 1);

  await expect.poll(() => page.evaluate(() => allProgress && allProgress['2'] && allProgress['2'].currentIndex))
    .toBe(4);

  // A change written by another group must reach this phone without a reload.
  await page.evaluate(() => huntRef('progress/2/currentIndex').set(5));
  await expect.poll(() => page.evaluate(() => allProgress['2'].currentIndex)).toBe(5);
});

test('leaving the map detaches the progress listener', async ({ page }) => {
  await openMapAs(page, seedHunt(), 1);
  await expect.poll(() => page.evaluate(() => Boolean(rivalProgressRef))).toBe(true);
  await page.evaluate(() => hideJourneyMap());
  await expect.poll(() => page.evaluate(() => rivalProgressRef)).toBeFalsy();
});

test('map/rivals.js is registered in the offline shell manifest', async ({ page }) => {
  await openMapAs(page, seedHunt(), 1);
  const registered = await page.evaluate(() => OfflinePreload.LOCAL_ASSETS.includes('map/rivals.js'));
  expect(registered).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/rival-ships.spec.js`
Expected: FAIL — `allProgress` is `{}` because no listener is attached, and `rivalProgressRef` is not defined.

- [ ] **Step 3a: Load the module and add the container in `index.html`**

After the `stations/layout.js` line (`index.html:17`), add:

```html
<script src="map/rivals.js"></script>
```

Inside `.journey-map-canvas`, immediately **before** `<div class="journey-ship" id="journeyShip" …>` (`index.html:54`), add the container. DOM order matters: rivals come first so they paint behind the pupil's own ship.

```html
    <div id="journeyRivalShips" aria-label="Kapal kumpulan lain"></div>
```

- [ ] **Step 3b: Register the script in `offline/preload.js`**

In `LOCAL_ASSETS` (`offline/preload.js:16`), change:

```js
    'run/tracker.js', 'groups/roster.js', 'stations/layout.js',
```

to:

```js
    'run/tracker.js', 'groups/roster.js', 'stations/layout.js', 'map/rivals.js',
```

- [ ] **Step 3c: Give the listener to the map in `app/views-map.js`**

Add near the top of the file, beside the other module-level state (after `let journeyMoving=false;`, around line 73):

```js
// Every group's progress, live for as long as the map is on screen. The cannon
// panel used to own this listener, but the map needs the same data to draw
// rival ships and the panel can only ever be opened from the map — so the map
// owns it and the panel just reads what is already here.
let allProgress={};
let rivalProgressRef=null;

function attachMapProgressListener(){
  if(isOffline() || rivalProgressRef) return;
  rivalProgressRef=huntRef('progress');
  rivalProgressRef.on('value',snap=>{
    allProgress=snap.val()||{};
    const panel=document.getElementById('cannonPanel');
    if(panel && !panel.hidden) renderCannonPanel();
  });
}
function detachMapProgressListener(){
  if(rivalProgressRef){ rivalProgressRef.off('value'); rivalProgressRef=null; }
}
```

In `hideJourneyMap()` (`app/views-map.js:167`), add the detach immediately after `journeyMoving=false;`:

```js
  detachMapProgressListener();
```

In `showJourneyMap()` (`app/views-map.js:245`), add the attach immediately before `syncCannonFab();`:

```js
  attachMapProgressListener();
```

- [ ] **Step 3d: Strip the private listener from `app/cannon-ui.js`**

Delete the `let allProgress={};` on line 1 — it now lives in `app/views-map.js`.

Delete `cannonProgressRef` (line 2) and the whole `attachCannonProgressListener` function together with its comment block (lines 34-44).

In `openCannonPanel` (line 24), delete the `attachCannonProgressListener();` call. `allProgress` is already live because the panel can only be opened from the map.

In `closeCannonPanel` (line 45), delete the listener teardown line so it becomes:

```js
function closeCannonPanel(){
  const panel=document.getElementById('cannonPanel');
  if(panel) panel.hidden=true;
  stopCannonScanner();
}
```

- [ ] **Step 3e: Re-attach on reconnect in `app/connectivity.js`**

Replace the cannon-panel block at the end of `updateConnectivityBadge()` (lines 33-39) with:

```js
  // Groups routinely walk out of signal with the map open — hunting a cannon
  // QR, for instance. Connectivity returning is the moment the map can load
  // every group's progress again, and the moment the panel can finally load
  // targets and enable firing.
  const map=document.getElementById('journeyMap');
  if(map && !map.hidden) attachMapProgressListener();
  const cannonPanel=document.getElementById('cannonPanel');
  if(cannonPanel && !cannonPanel.hidden) renderCannonPanel();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/rival-ships.spec.js`
Expected: PASS — 3 tests

Run the tests this task touched shared code in, to prove nothing regressed:

```bash
node --test offline/preload.test.js
npx playwright test tests/cannon.spec.js tests/offline.spec.js tests/student-island-journey.spec.js
```

Expected: PASS. If `tests/cannon.spec.js` fails on a cannon panel opened without the map being visible, that is a real finding — the panel is only reachable from the map in the app, so fix the *test* to open the map first, not the app.

- [ ] **Step 5: Commit**

```bash
git add index.html offline/preload.js app/views-map.js app/cannon-ui.js app/connectivity.js tests/rival-ships.spec.js
git commit -m "Give the voyage map ownership of the live progress listener"
```

---

### Task 3: Draw rival ships with names and HP bars

**Files:**
- Modify: `app/views-map.js` (add `renderRivalShips` and its two call sites)
- Modify: `app/connectivity.js` (call it when signal returns)
- Modify: `app/styles.css` (add rival styles after the `.journey-ship-hp.is-hit` rule, ~line 34)
- Test: `tests/rival-ships.spec.js`

**Interfaces:**
- Consumes: `RivalShips.rank/selectNearest/layout` (Task 1); `allProgress`, `attachMapProgressListener` (Task 2); `MAP_STOPS` and `currentStationCount()` (existing); `CannonEngine.readHp(entry)` (existing, applies the 50% floor and the 100 default).
- Produces: `renderRivalShips(): void`, rendering `button.journey-rival[data-gid]` elements into `#journeyRivalShips`; plus `buildRivalShip`, `paintRivalShip`, `placeRivalShip`, `rivalHue`.

Ships are placed directly at their berth in this task. Task 4 adds the sailing
voyage and the position bookkeeping it needs; there is no movement placeholder
here.

- [ ] **Step 1: Write the failing test**

Append to `tests/rival-ships.spec.js`:

```js
test('the three nearest rivals appear with names and HP bars', async ({ page }) => {
  // Kumpulan 1 is on island 3. Ahead: 5 (island 5) and 9 (island 4).
  // Behind: 11 (island 2). Everyone else sits at the start line.
  await openMapAs(page, seedHunt({
    1: { currentIndex: 3 }, 5: { currentIndex: 5 }, 9: { currentIndex: 4 },
    11: { currentIndex: 2, hp: 60 }
  }), 1);

  await expect(page.locator('#journeyRivalShips .journey-rival')).toHaveCount(3);
  const shown = await page.locator('#journeyRivalShips .journey-rival').evaluateAll(
    nodes => nodes.map(n => n.dataset.gid).sort());
  expect(shown).toEqual(['11', '5', '9']);

  await expect(page.locator('.journey-rival[data-gid="5"] .journey-rival-name')).toHaveText('Kumpulan 5');
  await expect(page.locator('.journey-rival[data-gid="11"] .journey-rival-hp-fill'))
    .toHaveAttribute('style', /width:\s*60%/);
});

test('a rival ship never covers the pupil\'s own ship', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3 }, 2: { currentIndex: 3 } }), 1);
  const rival = page.locator('.journey-rival[data-gid="2"]');
  await expect(rival).toBeVisible();
  const [shipBox, rivalBox] = await Promise.all([
    page.locator('#journeyShip').boundingBox(),
    rival.boundingBox()
  ]);
  expect(Math.abs(shipBox.x - rivalBox.x) + Math.abs(shipBox.y - rivalBox.y)).toBeGreaterThan(5);
});

test('a rival that opened its chest docks at the last island with a trophy', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 5 }, 2: { currentIndex: 6, status: 'won' } }), 1);
  const rival = page.locator('.journey-rival[data-gid="2"]');
  await expect(rival).toHaveClass(/is-won/);
  // The bar element stays in the DOM and is hidden, so assert on visibility
  // rather than count — toHaveCount(0) would fail against a hidden element.
  await expect(rival.locator('.journey-rival-hp')).toBeHidden();
  await expect(rival.locator('.journey-rival-trophy')).toBeVisible();
  await expect(rival.locator('.journey-rival-trophy')).toHaveText('🏆');
});

test('an HP change reaches the map without a reload', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3 }, 2: { currentIndex: 4 } }), 1);
  await expect(page.locator('.journey-rival[data-gid="2"] .journey-rival-hp-fill'))
    .toHaveAttribute('style', /width:\s*100%/);
  await page.evaluate(() => huntRef('progress/2/hp').set(70));
  await expect(page.locator('.journey-rival[data-gid="2"] .journey-rival-hp-fill'))
    .toHaveAttribute('style', /width:\s*70%/);
});

test('island buttons stay clickable where a rival ship overlaps them', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 0 }, 2: { currentIndex: 1 } }), 1);
  // Island 1 is this pupil's next stop; a rival is moored beside it.
  await page.locator('[aria-label="Pergi ke Pulau 1"]').click();
  await expect(page.locator('#view-clue')).toHaveClass(/active/, { timeout: 10000 });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/rival-ships.spec.js -g "nearest rivals"`
Expected: FAIL — `#journeyRivalShips` has 0 children, because `renderRivalShips` is still the empty stub.

- [ ] **Step 3a: Add the renderer to `app/views-map.js`**

Add below `detachMapProgressListener`:

```js
// Deterministic per group so a rival keeps one colour for the whole hunt.
// 47 is coprime with 360, so consecutive group ids land far apart on the wheel.
function rivalHue(gid){ return (Number(gid)*47)%360; }

function buildRivalShip(rival){
  const node=document.createElement('button');
  node.type='button';
  node.className='journey-rival';
  node.dataset.gid=rival.gid;
  node.innerHTML=`<span class="journey-rival-plate">
      <span class="journey-rival-name"></span>
      <span class="journey-rival-hp"><span class="journey-rival-hp-fill"></span></span>
      <span class="journey-rival-trophy" hidden>🏆</span>
    </span>
    <span class="journey-rival-ship"></span>`;
  node.querySelector('.journey-rival-ship').style.filter=`hue-rotate(${rivalHue(rival.gid)}deg) saturate(.85)`;
  node.addEventListener('click',()=>openCannonPanel(rival.gid));
  return node;
}
function placeRivalShip(node,point){
  node.style.left=point.x+'%';
  node.style.top=point.y+'%';
}
function paintRivalShip(node,rival){
  const hp=CannonEngine.readHp(allProgress[rival.gid]);
  node.classList.toggle('is-won',rival.finished);
  node.querySelector('.journey-rival-name').textContent=rival.name;
  node.querySelector('.journey-rival-hp').hidden=rival.finished;
  node.querySelector('.journey-rival-trophy').hidden=!rival.finished;
  node.querySelector('.journey-rival-hp-fill').style.width=hp+'%';
  node.setAttribute('aria-label',rival.finished
    ? `${rival.name} sudah buka peti`
    : `${rival.name}, HP ${hp} peratus. Buka panel meriam.`);
}
// Elements are reused by group id rather than rebuilt, so a ship that is
// mid-voyage keeps sailing instead of snapping back when an unrelated group's
// HP changes and re-renders the map.
function renderRivalShips(){
  const holder=document.getElementById('journeyRivalShips');
  if(!holder) return;
  // A missing module or a dead connection means no trustworthy positions. The
  // pupil's own voyage is untouched — it has never needed the network.
  if(typeof RivalShips==='undefined' || isOffline() || !groups || currentGroupId==null){
    holder.innerHTML='';
    rivalPositions={};
    return;
  }
  const ranked=RivalShips.rank(allProgress,groups,currentStationCount());
  const placed=RivalShips.layout(RivalShips.selectNearest(ranked,currentGroupId),MAP_STOPS);
  const keep=new Set(placed.map(rival=>rival.gid));
  Array.from(holder.children).forEach(node=>{ if(!keep.has(node.dataset.gid)) node.remove(); });
  placed.forEach(rival=>{
    let node=holder.querySelector(`.journey-rival[data-gid="${rival.gid}"]`);
    if(!node){ node=buildRivalShip(rival); holder.appendChild(node); }
    paintRivalShip(node,rival);
    placeRivalShip(node,rival);
  });
}
```

Then clear the container in `hideJourneyMap()`, beside the existing
`detachMapProgressListener();` call, so a map reopened for a different group
never flashes the previous group's rivals:

```js
  const rivalHolder=document.getElementById('journeyRivalShips');
  if(rivalHolder) rivalHolder.innerHTML='';
```

- [ ] **Step 3b: Wire up the three call sites**

In `app/views-map.js`, inside the `attachMapProgressListener` listener callback, render on every progress change — this is what makes a rival's HP bar update live:

```js
  rivalProgressRef.on('value',snap=>{
    allProgress=snap.val()||{};
    renderRivalShips();
    const panel=document.getElementById('cannonPanel');
    if(panel && !panel.hidden) renderCannonPanel();
  });
```

In `showJourneyMap()`, render once immediately after `attachMapProgressListener();`, so a map opened offline (or before the first snapshot lands) is in a known state rather than showing whatever was left over:

```js
  renderRivalShips();
```

In `app/connectivity.js`, inside `updateConnectivityBadge()`, render whenever connectivity flips — this is both the "ships vanish offline" and the "ships come back" path:

```js
  const map=document.getElementById('journeyMap');
  if(map && !map.hidden){
    attachMapProgressListener();
    renderRivalShips();
  }
```

- [ ] **Step 3c: Add the styles to `app/styles.css`**

Insert after the `@keyframes shipHpHit` rule (line 34):

```css
  /* Scoped by id so these outrank the `.participant-mode button` pirate skin,
     the same reason #journeyIslandButtons below is scoped that way. */
  #journeyRivalShips .journey-rival{position:absolute;z-index:1;display:flex;flex-direction:column;align-items:center;gap:2px;width:16%;margin:0;padding:0;border:0;border-radius:0;background:transparent;box-shadow:none;text-shadow:none;transform:translate(-50%,-88%);cursor:pointer;opacity:.9;transition:none;touch-action:manipulation;}
  #journeyRivalShips .journey-rival:hover,#journeyRivalShips .journey-rival:focus-visible{background:transparent;opacity:1;outline:2px solid #fff3a5;outline-offset:2px;}
  .journey-rival-plate{display:flex;flex-direction:column;align-items:center;gap:1px;pointer-events:none;}
  .journey-rival-name{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9px;font-weight:800;color:#fff;text-shadow:0 1px 2px #000;}
  .journey-rival-hp{width:40px;height:5px;border-radius:3px;background:var(--red);border:1px solid #00000055;overflow:hidden;}
  .journey-rival-hp[hidden]{display:none;}
  .journey-rival-hp-fill{display:block;height:100%;background:var(--green);transition:width .35s ease;}
  .journey-rival-trophy{font-size:11px;line-height:1;}
  .journey-rival-trophy[hidden]{display:none;}
  .journey-rival-ship{display:block;width:100%;aspect-ratio:320/403;background-image:url('../assets/ship/ship-sail-sheet.png?v=ship-sail-1');background-size:600% 400%;background-repeat:no-repeat;image-rendering:pixelated;pointer-events:none;filter:drop-shadow(2px 3px 0 rgba(0,46,81,.3));}
  .journey-rival-ship.facing-left{transform:scaleX(-1);}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/rival-ships.spec.js`
Expected: PASS — 8 tests

Run: `node --test offline/preload.test.js` — it also checks every `url()` in the stylesheet resolves to a real file, and this task added one.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/views-map.js app/styles.css tests/rival-ships.spec.js
git commit -m "Draw the nearest rival ships with names and HP bars"
```

---

### Task 4: Sail rival ships between islands

One shared animation driver moves the pupil's ship and every rival ship, so they travel with identical physics.

**Files:**
- Modify: `app/cannon-ui.js:377-419` (extract the loop out of `playStationJourney`)
- Modify: `app/views-map.js` (replace the `sailRivalShip` fallback)
- Test: `tests/rival-ships.spec.js`

**Interfaces:**
- Consumes: `RivalShips.pointAt/positions/diff` (Task 1), `renderRivalShips`/`placeRivalShip` (Task 3), `SHIP_SPRITE` and `MAP_STOPS` (existing).
- Produces:
  - `animateShipAlong(options): void` where `options = {from:{x,y}, to:{x,y}, duration:number, place:(point)=>void, setFrame?:(frame:number)=>void, isCancelled?:()=>boolean, onDone?:()=>void}`
  - `sailRivalShip(node, rival, move): void`
  - `rivalPositions: object` — last rendered `gid → island`
  - `rivalVoyageTokens: object` — one cancellation token per group

- [ ] **Step 1: Write the failing test**

Append to `tests/rival-ships.spec.js`:

```js
test('a rival sails to the next island when it clears a station', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3 }, 2: { currentIndex: 2 } }), 1);
  const rival = page.locator('.journey-rival[data-gid="2"]');
  await expect(rival).toBeVisible();
  const before = await rival.boundingBox();

  await page.evaluate(() => huntRef('progress/2/currentIndex').set(3));

  // Mid-voyage: the ship has left its old berth but not yet reached the new one.
  await expect.poll(async () => {
    const box = await rival.boundingBox();
    return Math.abs(box.y - before.y) > 2;
  }, { timeout: 4000 }).toBe(true);

  // The voyage settles on the island the rival actually reached.
  await expect.poll(async () => {
    const box = await rival.boundingBox();
    const target = await page.evaluate(() => RivalShips.pointAt(3, 0, MAP_STOPS));
    const canvas = await page.locator('#journeyMapCanvas').boundingBox();
    return Math.abs((box.y + box.height) - (canvas.y + canvas.height * target.y / 100)) < 12;
  }, { timeout: 6000 }).toBe(true);
});

test('a rival that was not on screen before appears without sailing', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3 } }), 1);
  // Kumpulan 14 starts at the back and is not among the three nearest.
  await expect(page.locator('.journey-rival[data-gid="14"]')).toHaveCount(0);
  await page.evaluate(() => huntRef('progress/14/currentIndex').set(4));
  const rival = page.locator('.journey-rival[data-gid="14"]');
  await expect(rival).toBeVisible();
  const first = await rival.boundingBox();
  await page.waitForTimeout(600);
  const second = await rival.boundingBox();
  expect(Math.abs(first.y - second.y)).toBeLessThan(2);
});

test('the pupil\'s own voyage still animates', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 0 } }), 1);
  const ship = page.locator('#journeyShip');
  const before = await ship.boundingBox();
  await page.evaluate(() => selectJourneyIsland(1));
  await expect.poll(async () => {
    const box = await ship.boundingBox();
    return Math.abs(box.y - before.y) > 2;
  }, { timeout: 4000 }).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/rival-ships.spec.js -g "sails to the next island"`
Expected: FAIL — the ship jumps straight to its new berth, so the mid-voyage poll never sees an intermediate position.

- [ ] **Step 3a: Extract the animation driver in `app/cannon-ui.js`**

Replace the body of `playStationJourney` from `const duration=2700;` (line 399) through the closing `requestAnimationFrame(animate);` (line 418) with:

```js
  const duration=2700;
  animateShipAlong({
    from, to, duration,
    isCancelled:()=>token!==journeyToken,
    place:point=>placeJourneyShip(point),
    setFrame:frame=>setJourneyShipFrame(frame),
    onDone:()=>{
      journeyShipPosition=toPosition;
      journeyMoving=false;
      stopJourneyShipAudio();
      if(status) status.textContent=`Tiba di Pulau ${toPosition}!`;
      window.setTimeout(()=>{
        if(token!==journeyToken) return;
        onArrive && onArrive();
      },1000);
    }
  });
}

// Drives one ship sprite from one map point to another. Shared by the pupil's
// own voyage and by every rival ship so they move with identical physics.
// A duration of 0 places the ship at its destination immediately, which is what
// a reduced-motion client and a reconnecting client both need.
function animateShipAlong(options){
  const {from,to,place}=options;
  const duration=Number(options.duration)||0;
  const setFrame=options.setFrame||(()=>{});
  const isCancelled=options.isCancelled||(()=>false);
  const onDone=options.onDone||(()=>{});
  place(from);
  setFrame(0);
  if(duration<=0 || (from.x===to.x && from.y===to.y)){
    place(to);
    onDone();
    return;
  }
  let startedAt=null;
  const step=now=>{
    if(isCancelled()) return;
    if(startedAt===null) startedAt=now;
    const elapsed=Math.min(1,(now-startedAt)/duration);
    const eased=elapsed<.5 ? 2*elapsed*elapsed : 1-Math.pow(-2*elapsed+2,2)/2;
    place({x:from.x+(to.x-from.x)*eased,y:from.y+(to.y-from.y)*eased});
    setFrame(Math.floor((now-startedAt)/SHIP_SPRITE.frameMs));
    if(elapsed<1){ requestAnimationFrame(step); return; }
    onDone();
  };
  requestAnimationFrame(step);
}
```

The `if(fromPosition===toPosition){…}` early return above it is unchanged — it still short-circuits before any audio plays.

- [ ] **Step 3b: Give rival ships a real voyage in `app/views-map.js`**

First add the voyage state beside `rivalProgressRef`:

```js
// Last rendered gid -> island. Cleared on detach, which is what stops several
// ships lurching across the map at once when a phone comes back online: with
// no previous position, a ship simply appears where it belongs.
let rivalPositions={};
```

Then teach `renderRivalShips` to sail a ship whose island changed. Add the diff
above the `placed.forEach(...)` loop:

```js
  const moves=RivalShips.diff(rivalPositions,placed);
```

replace the unconditional `placeRivalShip(node,rival);` inside that loop with:

```js
    const move=moves.find(entry=>entry.gid===rival.gid);
    if(move) sailRivalShip(node,rival,move);
    else placeRivalShip(node,rival);
```

and record the new positions as the loop's last line, inside `renderRivalShips`
but after the `forEach`:

```js
  rivalPositions=RivalShips.positions(placed);
```

The early return for the offline/no-module case must clear them too — add
`rivalPositions={};` beside its existing `holder.innerHTML='';`.

Then add the voyage itself:

```js
const RIVAL_VOYAGE_MS=2700;
// One token per group: a rival whose position changes again mid-voyage cancels
// the first voyage instead of leaving two loops fighting over one element.
let rivalVoyageTokens={};

function rivalWantsInstantMove(){
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function setRivalShipDirection(node,from,to){
  const sprite=node.querySelector('.journey-rival-ship');
  if(!sprite || Math.abs(to.x-from.x)<.5) return;
  // The source sprite faces right; mirror it only while travelling left.
  sprite.classList.toggle('facing-left',to.x<from.x);
}
function setRivalShipFrame(node,frame){
  const sprite=node.querySelector('.journey-rival-ship');
  if(!sprite) return;
  const current=frame%SHIP_SPRITE.frames;
  const col=current%SHIP_SPRITE.cols;
  const row=Math.floor(current/SHIP_SPRITE.cols);
  sprite.style.backgroundPosition=`${col/(SHIP_SPRITE.cols-1)*100}% ${row/(SHIP_SPRITE.rows-1)*100}%`;
}
// Rival voyages are deliberately silent: only the pupil's own ship plays the
// sailing audio, or three ships moving at once would be a wall of noise.
function sailRivalShip(node,rival,move){
  const from=RivalShips.pointAt(move.from,rival.slot,MAP_STOPS);
  const to={x:rival.x,y:rival.y};
  const token=(rivalVoyageTokens[rival.gid]||0)+1;
  rivalVoyageTokens[rival.gid]=token;
  setRivalShipDirection(node,from,to);
  animateShipAlong({
    from, to,
    duration:rivalWantsInstantMove() ? 0 : RIVAL_VOYAGE_MS,
    isCancelled:()=>rivalVoyageTokens[rival.gid]!==token || !node.isConnected,
    place:point=>placeRivalShip(node,point),
    setFrame:frame=>setRivalShipFrame(node,frame)
  });
}
```

Finally, clear both in `detachMapProgressListener()` so a reattach starts clean and no ship sails on the first snapshot after reconnecting:

```js
  rivalPositions={};
  rivalVoyageTokens={};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/rival-ships.spec.js`
Expected: PASS — 11 tests

Run: `npx playwright test tests/student-island-journey.spec.js tests/cannon.spec.js`
Expected: PASS — the extracted driver must not have changed the pupil's own voyage.

- [ ] **Step 5: Commit**

```bash
git add app/cannon-ui.js app/views-map.js tests/rival-ships.spec.js
git commit -m "Sail rival ships between islands on a shared animation driver"
```

---

### Task 5: Tapping a rival opens the cannon panel on that target

The click handler is already wired from Task 3. This task makes the panel act on the group id it is handed.

**Files:**
- Modify: `app/cannon-ui.js:24-33` (`openCannonPanel`), `:45-50` (`closeCannonPanel`), `:56-88` (`renderCannonPanel`)
- Modify: `app/styles.css` (highlight rule, beside the other `.cannon-target` rules)
- Test: `tests/rival-ships.spec.js`

**Interfaces:**
- Consumes: `openCannonPanel(gid)` called from `buildRivalShip` (Task 3).
- Produces: `openCannonPanel(targetGid?: string)`; `cannonTargetGid: string|null`; a `.cannon-target.is-targeted` class on the matching row.

- [ ] **Step 1: Write the failing test**

Append to `tests/rival-ships.spec.js`:

```js
test('tapping a rival opens the cannon panel with that group highlighted', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3, ammo: 2 }, 2: { currentIndex: 4 } }), 1);
  await page.locator('.journey-rival[data-gid="2"]').click();

  await expect(page.locator('#cannonPanel')).toBeVisible();
  await expect(page.locator('.cannon-target[data-gid="2"]')).toHaveClass(/is-targeted/);
  await expect(page.locator('.cannon-target[data-gid="5"]')).not.toHaveClass(/is-targeted/);
});

test('the highlight survives a live progress update while the panel is open', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3, ammo: 2 }, 2: { currentIndex: 4 } }), 1);
  await page.locator('.journey-rival[data-gid="2"]').click();
  await expect(page.locator('.cannon-target[data-gid="2"]')).toHaveClass(/is-targeted/);

  await page.evaluate(() => huntRef('progress/2/hp').set(80));
  await expect(page.locator('.cannon-target[data-gid="2"]')).toHaveClass(/is-targeted/);
});

test('closing the panel clears the target', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3, ammo: 2 }, 2: { currentIndex: 4 } }), 1);
  await page.locator('.journey-rival[data-gid="2"]').click();
  await page.locator('#cannonPanel .journey-popup-close').click();
  await page.locator('#cannonFab').click();
  await expect(page.locator('.cannon-target[data-gid="2"]')).not.toHaveClass(/is-targeted/);
});

test('tapping a rival does nothing when cannons are disabled', async ({ page }) => {
  const seed = seedHunt({ 1: { currentIndex: 3 }, 2: { currentIndex: 4 } });
  seed.gamestation2026.hunts.h1.config.cannon = { enabled: false, damagePercent: 10, startingAmmo: 0 };
  await openMapAs(page, seed, 1);
  await page.locator('.journey-rival[data-gid="2"]').click();
  await expect(page.locator('#cannonPanel')).toBeHidden();
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/rival-ships.spec.js -g "highlighted"`
Expected: FAIL — the panel opens but no row carries `is-targeted`.

- [ ] **Step 3a: Track the target in `app/cannon-ui.js`**

Add beside the other module-level state at the top of the file:

```js
// The group a pupil tapped on the map. Held here rather than passed through
// renderCannonPanel's many call sites, so the highlight survives the live
// re-renders the progress listener triggers while the panel is open.
let cannonTargetGid=null;
```

Change `openCannonPanel` to accept and store it:

```js
function openCannonPanel(targetGid){
  const panel=document.getElementById('cannonPanel');
  if(!panel || !cannonEnabled()) return;
  cannonTargetGid=targetGid==null ? null : String(targetGid);
  panel.hidden=false;
  setCannonMsg('','');
  const passwordInput=document.getElementById('cannonPasswordInput');
  if(passwordInput) passwordInput.value='';
  renderCannonPanel();
}
```

Clear it in `closeCannonPanel`:

```js
function closeCannonPanel(){
  const panel=document.getElementById('cannonPanel');
  if(panel) panel.hidden=true;
  cannonTargetGid=null;
  stopCannonScanner();
}
```

- [ ] **Step 3b: Mark and reveal the row in `renderCannonPanel`**

In the `list.innerHTML=ids.map(...)` template, change the opening div so the targeted row carries the class:

```js
    return `<div class="cannon-target${inBattle?'':' is-won'}${String(gid)===cannonTargetGid?' is-targeted':''}" data-gid="${gid}">
      <span class="cannon-target-name">Kumpulan ${gid}</span>${bar}${action}
    </div>`;
```

Immediately after the `list.innerHTML=…` assignment, scroll the target into view:

```js
  // The panel's target list scrolls, and a tapped group can be well below the
  // fold — opening on a list that does not show the group the pupil just tapped
  // would read as the tap having done nothing.
  const targeted=cannonTargetGid && list.querySelector(`.cannon-target[data-gid="${cannonTargetGid}"]`);
  if(targeted) targeted.scrollIntoView({block:'nearest'});
```

- [ ] **Step 3c: Add the highlight style to `app/styles.css`**

Add beside the other `.cannon-target` rules:

```css
  .cannon-target.is-targeted{outline:2px solid var(--gold);outline-offset:1px;background:rgba(255,243,165,.16);}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/rival-ships.spec.js`
Expected: PASS — 15 tests

Run: `npx playwright test tests/cannon.spec.js`
Expected: PASS — firing, ammo and refunds are untouched.

- [ ] **Step 5: Commit**

```bash
git add app/cannon-ui.js app/styles.css tests/rival-ships.spec.js
git commit -m "Open the cannon panel on the rival a pupil taps"
```

---

### Task 6: Offline behaviour and shipping the new shell

**Files:**
- Modify: `sw.js:10` (`CACHE_NAME`), `sw.js:1-9` (the version log comment)
- Test: `tests/rival-ships.spec.js`

**Interfaces:**
- Consumes: everything from Tasks 1-5.
- Produces: no new functions. `CACHE_NAME` becomes `'gs-shell-v21'`.

- [ ] **Step 1: Write the failing test**

Append to `tests/rival-ships.spec.js`:

```js
test('rival ships disappear offline and come back without sailing', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3 }, 2: { currentIndex: 4 } }), 1);
  await expect(page.locator('#journeyRivalShips .journey-rival')).toHaveCount(3);

  // Stale positions are worse than none, so the ships are removed outright.
  await page.evaluate(() => { browserOnline = false; updateConnectivityBadge(); });
  await expect(page.locator('#journeyRivalShips .journey-rival')).toHaveCount(0);

  // The pupil's own voyage never depended on the network.
  await expect(page.locator('#journeyShip')).toBeVisible();
  await expect(page.locator('[aria-label="Pergi ke Pulau 4"]')).toHaveCount(1);

  await page.evaluate(() => { browserOnline = true; updateConnectivityBadge(); });
  const rival = page.locator('.journey-rival[data-gid="2"]');
  await expect(rival).toBeVisible();
  // Reconnecting must not launch three ships across the map at once.
  const first = await rival.boundingBox();
  await page.waitForTimeout(600);
  const second = await rival.boundingBox();
  expect(Math.abs(first.y - second.y)).toBeLessThan(2);
});

test('the service worker shell version was bumped for this release', async () => {
  const fs = require('node:fs');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  expect(sw).toContain("const CACHE_NAME = 'gs-shell-v21';");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/rival-ships.spec.js -g "shell version"`
Expected: FAIL — `sw.js` still reads `gs-shell-v20`.

Run: `npx playwright test tests/rival-ships.spec.js -g "disappear offline"`
Expected: PASS already. `renderRivalShips` gained its `isOffline()` guard in Task 3 and `updateConnectivityBadge` gained its re-render in Task 2 — this test exists to lock that behaviour down, not to drive new code. If it fails, the bug is real: fix it before continuing.

- [ ] **Step 3: Bump the shell version in `sw.js`**

Change line 10:

```js
const CACHE_NAME = 'gs-shell-v21';
```

Add to the version log comment above it, following the existing style:

```js
// v21 adds rival ships to the voyage map and ships map/rivals.js.
```

- [ ] **Step 4: Run the whole suite**

```bash
node --test map/rivals.test.js offline/preload.test.js
npx playwright test
```

Expected: PASS across the board. Report any pre-existing failure rather than fixing unrelated tests inside this task.

- [ ] **Step 5: Commit**

```bash
git add sw.js tests/rival-ships.spec.js
git commit -m "Ship rival ships in a new offline shell version"
```

---

## Self-Review Notes

Checked against the spec section by section:

- **Data Source / listener lifecycle** → Task 2.
- **`map/rivals.js` API** (all nine exports) → Task 1. `pointAt` and `positions` were added to the spec's list during planning because Task 4 needs a from-point and Task 3 needs to record positions; both are covered by unit tests.
- **Rendering, stacking order, name plate, HP bar, trophy** → Task 3. Stacking is enforced by `z-index:1` on `.journey-rival` against the island buttons' existing `z-index:4`, and verified by the "island buttons stay clickable" test.
- **Movement, shared driver, silent rival voyages** → Task 4.
- **Tapping a rival, cannons-disabled case** → Task 5.
- **Offline, reconnect-without-sailing, `prefers-reduced-motion`** → Tasks 3, 4 and 6. Reduced motion is handled in `sailRivalShip` via `duration: 0`; it deliberately does not touch the pupil's own voyage.
- **Fewer than four groups, idle groups, missing progress entries** → Task 1 unit tests.
- **Offline shell registration and `CACHE_NAME`** → Tasks 2 and 6.

Name consistency verified across tasks: `attachMapProgressListener`/`detachMapProgressListener`, `renderRivalShips`, `sailRivalShip`, `placeRivalShip`, `paintRivalShip`, `buildRivalShip`, `animateShipAlong`, `rivalProgressRef`, `rivalPositions`, `rivalVoyageTokens`, `cannonTargetGid`.

One known trade-off carried from the spec: a configured group that never plays sits at the start line and can occupy the "one behind" slot for the whole hunt. Excluding idle groups would leave the map empty at the moment a hunt begins, which is worse.
