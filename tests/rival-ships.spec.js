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
  // The daily intro overlay (z-index:1000) autoplays on first load — a fresh
  // test context has no "last seen" localStorage entry — and stays visible
  // for long enough that a fast, few-step test can still be mid-fade when it
  // runs its assertions. Matches the same dismissal other specs already use
  // (e.g. tests/asset-loading.spec.js); harmless for tests that never touch
  // it, but load-bearing for anything here that hit-tests via
  // document.elementFromPoint, which — unlike Playwright's own actionability
  // checks — does not wait out a transient overlay on its own.
  await page.evaluate(() => { const intro = document.getElementById('dailyIntro'); if (intro) intro.hidden = true; });
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

test('rivals do not sail on open before the first real snapshot arrives', async ({ page }) => {
  // Real Firebase delivers .on('value') asynchronously, but showJourneyMap()
  // calls attachMapProgressListener() and then renderRivalShips() back to
  // back with no await between them. tests/helpers/fake-firebase.js fires
  // on()'s callback SYNCHRONOUSLY (see its own header comment), so in every
  // other spec in this file `allProgress` is already fresh before that first
  // render even runs — exactly why this bug had no test before now. This
  // spec wraps just the hunt's progress-ref listener so its snapshot
  // delivery is asynchronous, like real Firebase, so the gap actually gets
  // exercised.
  //
  // Trimmed to 4 total groups (not the usual 14) so selectNearest's "3
  // nearest" always returns the SAME 3 gids regardless of standings: with a
  // stale, empty allProgress every group ranks at position 0, so a full
  // 14-group hunt would pick different (lower-id) rivals from the stale
  // render than the real one, and a mismatched gid set can never look like
  // "movement" once the real snapshot lands. Only when the same gids are
  // selected both times can a wrong stale position actually surface as a
  // recorded, animated move — which is the failure this test exists to
  // catch.
  const seed = seedHunt({ 1: { currentIndex: 4 }, 2: { currentIndex: 6 }, 3: { currentIndex: 5 }, 4: { currentIndex: 1 } });
  const cfg = seed.gamestation2026.hunts.h1.config;
  const seededProgress = seed.gamestation2026.hunts.h1.progress;
  ['5', '6', '7', '8', '9', '10', '11', '12', '13', '14'].forEach(gid => {
    delete cfg.groups[gid];
    delete seededProgress[gid];
  });

  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(installFakeFirebase, seed);
  // Patch only the 'gamestation2026/hunts/h1/progress' ref's on() to dispatch
  // asynchronously instead of synchronously. Every other ref, and every other
  // spec's own fake-firebase instance, is untouched.
  await page.addInitScript(() => {
    const realDatabase = window.firebase.database;
    window.firebase.database = (...args) => {
      const database = realDatabase(...args);
      const realRef = database.ref;
      database.ref = path => {
        const api = realRef(path);
        if (path !== 'gamestation2026/hunts/h1/progress') return api;
        const realOn = api.on;
        // A real, if generous, delay rather than setTimeout(...,0): the
        // assertion just below needs a reliable window to observe the
        // "before the first snapshot" state despite the Node<->browser
        // round-trip between page.evaluate() returning and the next
        // Playwright command actually running.
        api.on = (event, cb) => { realOn(event, snap => { setTimeout(() => cb(snap), 100); }); };
        return api;
      };
      return database;
    };
  });
  await page.goto(INDEX);
  await expect(page.locator('#view-login')).toHaveClass(/active/);
  await page.evaluate(async id => {
    currentHuntId = 'h1';
    currentGroupId = id;
    const snap = await huntRef('progress/' + id).once('value');
    progress = snap.val();
    show('view-clue');
    showJourneyMap();
  }, '1');
  await expect(page.locator('#journeyMap')).toBeVisible();

  // Before the (deliberately delayed) first snapshot arrives, the map must
  // show no rivals at all — not stale ones drawn from whatever allProgress
  // last held — exactly like the offline state.
  await expect(page.locator('#journeyRivalShips .journey-rival')).toHaveCount(0);

  // Once the real snapshot lands, each rival must appear ALREADY at its real
  // island — never sailing there, because as far as this attachment is
  // concerned it was never anywhere else.
  await expect(page.locator('#journeyRivalShips .journey-rival')).toHaveCount(3);
  const readTop = gid => page.locator(`.journey-rival[data-gid="${gid}"]`).evaluate(node => parseFloat(node.style.top));
  const destinations = await page.evaluate(() => ({
    2: RivalShips.pointAt(6, 0, MAP_STOPS).y,
    3: RivalShips.pointAt(5, 0, MAP_STOPS).y,
    4: RivalShips.pointAt(1, 0, MAP_STOPS).y
  }));
  for (const gid of ['2', '3', '4']) {
    expect(Math.abs((await readTop(gid)) - destinations[gid])).toBeLessThan(0.5);
  }
  // Confirm this isn't just early in an accidental sail that happens to pass
  // through the right spot — it must still be there well after a real
  // RIVAL_VOYAGE_MS (2700ms) sail would have finished moving it anywhere.
  await page.waitForTimeout(600);
  for (const gid of ['2', '3', '4']) {
    expect(Math.abs((await readTop(gid)) - destinations[gid])).toBeLessThan(0.5);
  }
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

  // Name + HP now live in the #journeyRivalPlates overlay, keyed by the same
  // data-gid as the ship button, not nested inside .journey-rival itself —
  // see the CSS comment on #journeyRivalPlates for why that nesting is what
  // trapped a plate under the pupil's own ship.
  await expect(page.locator('.journey-rival-plate[data-gid="5"] .journey-rival-name')).toHaveText('Kumpulan 5');
  await expect(page.locator('.journey-rival-plate[data-gid="11"] .journey-rival-hp-fill'))
    .toHaveAttribute('style', /width:\s*60%/);
});

test('a rival ship never covers the pupil\'s own ship', async ({ page }) => {
  // The pupil plus all three visible rivals sharing one island is the case
  // the controller actually rendered and confirmed reads badly: a rival's
  // name plate used to live inside its .journey-rival button's own stacking
  // context (z-index:1), which trapped it under the pupil's own ship
  // (z-index:2) no matter how far the hull was nudged — moving the hull far
  // enough to clear the pupil's ship just made the rival read as moored at a
  // NEIGHBOURING island instead, which is worse (a false position, not just
  // an unreadable one). The actual fix moves the plate out of the ship's
  // stacking context entirely, into its own overlay (#journeyRivalPlates,
  // app/styles.css) above the pupil's ship — so this is a stacking-order
  // check, not a geometry one.
  await openMapAs(page, seedHunt({
    1: { currentIndex: 3 }, 2: { currentIndex: 3 }, 3: { currentIndex: 3 }, 4: { currentIndex: 3 }
  }), 1);
  await expect(page.locator('#journeyRivalShips .journey-rival')).toHaveCount(3);

  // #journeyShip is deliberately pointer-events:none (app/styles.css, so it
  // can never steal a tap), which also means elementFromPoint can NEVER
  // resolve to it no matter the stacking order — so the per-rival check
  // below cannot, by itself, prove a plate paints above the pupil's ship.
  // Assert the mechanism the fix actually relies on directly: confirmed this
  // matters by temporarily dropping #journeyRivalPlates' z-index and
  // watching this assertion (and only this one) go red while every
  // elementFromPoint check below kept passing regardless.
  const zIndexes = await page.evaluate(() => ({
    plates: Number(getComputedStyle(document.getElementById('journeyRivalPlates')).zIndex),
    ship: Number(getComputedStyle(document.getElementById('journeyShip')).zIndex)
  }));
  expect(zIndexes.plates).toBeGreaterThan(zIndexes.ship);

  for (const gid of ['2', '3', '4']) {
    const plate = page.locator(`.journey-rival-plate[data-gid="${gid}"]`);
    await expect(plate).toBeVisible();
    const box = await plate.boundingBox();
    const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const resolvedGid = await page.evaluate(pt => {
      const el = document.elementFromPoint(pt.x, pt.y);
      const plateEl = el && el.closest('.journey-rival-plate');
      return plateEl ? plateEl.dataset.gid : null;
    }, centre);
    // The previous assertion here compared top-left CORNERS of boxes with
    // different widths (.journey-ship is 25% wide, .journey-rival is 16%),
    // so even a berth of {0,0} "passed" by ~17px on a 390px phone — it never
    // actually checked for overlap. This checks the real thing: the centre
    // of a rival's own name plate must resolve to that plate (or a node
    // inside it, e.g. the name text) — never to the pupil's ship (which
    // could not resolve here even by accident: #journeyShip is
    // pointer-events:none, exactly so it can never sit "on top" of anything
    // for hit-testing) and never to a DIFFERENT rival's plate drawn over it.
    expect(resolvedGid).toBe(gid);
  }
});

test('a rival that opened its chest docks at the last island with a trophy', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 5 }, 2: { currentIndex: 6, status: 'won' } }), 1);
  const rival = page.locator('.journey-rival[data-gid="2"]');
  const plate = page.locator('.journey-rival-plate[data-gid="2"]');
  await expect(rival).toHaveClass(/is-won/);
  // The bar element stays in the DOM and is hidden, so assert on visibility
  // rather than count — toHaveCount(0) would fail against a hidden element.
  await expect(plate.locator('.journey-rival-hp')).toBeHidden();
  await expect(plate.locator('.journey-rival-trophy')).toBeVisible();
  await expect(plate.locator('.journey-rival-trophy')).toHaveText('🏆');
});

test('an HP change reaches the map without a reload', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3 }, 2: { currentIndex: 4 } }), 1);
  await expect(page.locator('.journey-rival-plate[data-gid="2"] .journey-rival-hp-fill'))
    .toHaveAttribute('style', /width:\s*100%/);
  await page.evaluate(() => huntRef('progress/2/hp').set(70));
  await expect(page.locator('.journey-rival-plate[data-gid="2"] .journey-rival-hp-fill'))
    .toHaveAttribute('style', /width:\s*70%/);
});

test('island buttons stay clickable where a rival ship overlaps them', async ({ page }) => {
  // Island 4's mooring (MAP_STOPS[4] = {36,46}) sits only ~4 percentage
  // points from its own island button (MAP_ISLANDS[4] = {33.5,43}), so a
  // rival docked there (gid 2, alone at that island and therefore berth slot
  // 0) genuinely covers the button's own centre pixel — confirmed below
  // rather than assumed, so this cannot go vacuous again the way the
  // previous version of this test did. This is the exact overlap on which a
  // stacking-order regression (rival above island buttons) was previously
  // caught live: elementFromPoint at the button's centre resolved to the
  // rival, not the button, and the click below timed out instead of sailing.
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3 }, 2: { currentIndex: 4 } }), 1);
  const rival = page.locator('.journey-rival[data-gid="2"]');
  const button = page.locator('[aria-label="Pergi ke Pulau 4"]');
  await expect(rival).toBeVisible();
  await expect(button).toBeVisible();
  // Confirms the island's own centre pixel is genuinely inside the rival's
  // box before trusting the click below to mean anything — otherwise this
  // test could pass vacuously again if a future map layout moved them apart.
  const [rivalBox, buttonBox] = await Promise.all([rival.boundingBox(), button.boundingBox()]);
  const buttonCentre = { x: buttonBox.x + buttonBox.width / 2, y: buttonBox.y + buttonBox.height / 2 };
  const centreInsideRivalBox = buttonCentre.x >= rivalBox.x && buttonCentre.x <= rivalBox.x + rivalBox.width &&
    buttonCentre.y >= rivalBox.y && buttonCentre.y <= rivalBox.y + rivalBox.height;
  expect(centreInsideRivalBox).toBe(true);
  await button.click();
  await expect(page.locator('#view-clue')).toHaveClass(/active/, { timeout: 10000 });
});

test('a rival sails to the next island when it clears a station', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3 }, 2: { currentIndex: 2 } }), 1);
  const rival = page.locator('.journey-rival[data-gid="2"]');
  await expect(rival).toBeVisible();

  // Read the ship the same way the app positions it: a canvas-percentage
  // `top`, straight off the element's own inline style. boundingBox() would
  // return a device-pixel rect with the element's CSS transform
  // (translate(-50%,-88%), app/styles.css) already applied, which silently
  // adds a constant, canvas-size-dependent offset to every comparison.
  const readTop = () => rival.evaluate(node => parseFloat(node.style.top));
  const start = await readTop();

  await page.evaluate(() => huntRef('progress/2/currentIndex').set(3));

  // Mid-voyage: the ship has left its old berth but not yet reached the new one.
  await expect.poll(async () => Math.abs((await readTop()) - start) > 0.5, { timeout: 4000 }).toBe(true);

  const destination = await page.evaluate(() => RivalShips.pointAt(3, 0, MAP_STOPS).y);
  const totalDistance = Math.abs(destination - start);

  // A teleport lands at zero distance from the destination the instant it
  // moves; a real 2700ms sail with ease-in-out has covered only ~22% of the
  // distance at t=900ms. Demanding the ship is still at least 15% of the
  // total distance short of the destination gives real animation a wide
  // margin while failing a teleport outright — in percentage units this
  // holds at any viewport size, unlike a pixel-based comparison.
  await page.waitForTimeout(900);
  const remaining = Math.abs(destination - (await readTop()));
  expect(remaining).toBeGreaterThan(totalDistance * 0.15);

  // The voyage settles on the island the rival actually reached.
  await expect.poll(async () => Math.abs((await readTop()) - destination) < 0.5, { timeout: 6000 }).toBe(true);
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
  // Mirrors "a rival sails to the next island when it clears a station",
  // above: a >2px bounding-box check only proves the ship eventually reaches
  // somewhere near its destination, so a duration:0 regression specific to
  // the pupil's own voyage (which would teleport it there instantly) would
  // still pass — this is the branch's one automated guard on its loudest
  // global constraint, that existing pupil-ship behaviour must not change.
  await openMapAs(page, seedHunt({ 1: { currentIndex: 0 } }), 1);
  const ship = page.locator('#journeyShip');

  // Read the ship the same way the app positions it: a canvas-percentage
  // `top`, straight off the element's own inline style. boundingBox() would
  // return a device-pixel rect with the element's CSS transform
  // (translate(-50%,-88%), app/styles.css) already applied, which silently
  // adds a constant, canvas-size-dependent offset to every comparison.
  const readTop = () => ship.evaluate(node => parseFloat(node.style.top));
  const start = await readTop();

  await page.evaluate(() => selectJourneyIsland(1));

  // Mid-voyage: the ship has left its old berth but not yet reached the new one.
  await expect.poll(async () => Math.abs((await readTop()) - start) > 0.5, { timeout: 4000 }).toBe(true);

  const destination = await page.evaluate(() => MAP_STOPS[1].y);
  const totalDistance = Math.abs(destination - start);

  // A teleport lands at zero distance from the destination the instant it
  // moves; a real 2700ms sail with ease-in-out has covered only ~22% of the
  // distance at t=900ms. Demanding the ship is still at least 15% of the
  // total distance short of the destination gives real animation a wide
  // margin while failing a teleport outright — in percentage units this
  // holds at any viewport size, unlike a pixel-based comparison.
  await page.waitForTimeout(900);
  const remaining = Math.abs(destination - (await readTop()));
  expect(remaining).toBeGreaterThan(totalDistance * 0.15);

  // The voyage settles on the island the pupil actually selected.
  await expect.poll(async () => Math.abs((await readTop()) - destination) < 0.5, { timeout: 6000 }).toBe(true);
});

// Tapping a rival is best-effort by design (app/styles.css keeps island
// buttons on top of rival ships so a pupil is never blocked from sailing —
// see "island buttons stay clickable...", above), so these four tests seed a
// position where the rival is NOT covered by its island's button, rather
// than the position used elsewhere in this file. At {1: idx 0, 2: idx 3},
// gid 2 moors at berth slot 0 of island 3, which sits clear of island 3's
// button; do not read this seed choice as a bug or "fix" it to match the
// other tests' seed — island 4 (used elsewhere) is exactly the case where a
// rival is legitimately un-clickable, and that is expected, not a defect.
test('tapping a rival opens the cannon panel with that group highlighted', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 0, ammo: 2 }, 2: { currentIndex: 3 } }), 1);
  await page.locator('.journey-rival[data-gid="2"]').click();

  await expect(page.locator('#cannonPanel')).toBeVisible();
  await expect(page.locator('.cannon-target[data-gid="2"]')).toHaveClass(/is-targeted/);
  await expect(page.locator('.cannon-target[data-gid="5"]')).not.toHaveClass(/is-targeted/);
});

test('the highlight survives a live progress update while the panel is open', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 0, ammo: 2 }, 2: { currentIndex: 3 } }), 1);
  await page.locator('.journey-rival[data-gid="2"]').click();
  await expect(page.locator('.cannon-target[data-gid="2"]')).toHaveClass(/is-targeted/);

  await page.evaluate(() => huntRef('progress/2/hp').set(80));
  await expect(page.locator('.cannon-target[data-gid="2"]')).toHaveClass(/is-targeted/);
});

test('scrolling the cannon panel survives an unrelated progress update while a target is set', async ({ page }) => {
  // .cannon-panel itself is the overflow-y:auto element (not a separate inner
  // list), and the map's progress listener re-renders the open panel on
  // every write anywhere in the hunt — roughly once every 30s in a live
  // 14-group session. renderCannonPanel() used to call scrollIntoView() on
  // the targeted row on every one of those re-renders, snapping a child's own
  // in-progress scroll (e.g. scrolling down to reach a different group) back
  // toward row 2 each time.
  await openMapAs(page, seedHunt({ 1: { currentIndex: 0, ammo: 2 }, 2: { currentIndex: 3 } }), 1);
  await page.locator('.journey-rival[data-gid="2"]').click();
  await expect(page.locator('.cannon-target[data-gid="2"]')).toHaveClass(/is-targeted/);

  const panel = page.locator('#cannonPanel');
  const scrolled = await panel.evaluate(node => {
    node.scrollTop = node.scrollHeight;   // scroll all the way past the targeted row
    return node.scrollTop;
  });
  // Guards against a panel that never actually overflows (13 other groups at
  // ~40px/row inside a fixed inset comfortably does) — a scrollTop of 0 here
  // would make the assertion below vacuously true no matter what the code did.
  expect(scrolled).toBeGreaterThan(0);

  // A write to a DIFFERENT group's progress — not group 2, the one targeted —
  // still re-renders the panel, because attachMapProgressListener() listens
  // on the whole 'progress' node, not per-child.
  await page.evaluate(() => huntRef('progress/8/hp').set(70));
  // Confirms the re-render actually happened, so a no-op write can't make
  // this assertion pass vacuously either.
  await expect(page.locator('.cannon-target[data-gid="8"] .cannon-target-hp-fill'))
    .toHaveAttribute('style', /width:\s*70%/);

  await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBe(scrolled);
});

test('closing the panel clears the target', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 0, ammo: 2 }, 2: { currentIndex: 3 } }), 1);
  await page.locator('.journey-rival[data-gid="2"]').click();
  await page.locator('#cannonPanel .journey-popup-close').click();
  await page.locator('#cannonFab').click();
  await expect(page.locator('.cannon-target[data-gid="2"]')).not.toHaveClass(/is-targeted/);
});

test('tapping a rival does nothing when cannons are disabled', async ({ page }) => {
  const seed = seedHunt({ 1: { currentIndex: 0 }, 2: { currentIndex: 3 } });
  seed.gamestation2026.hunts.h1.config.cannon = { enabled: false, damagePercent: 10, startingAmmo: 0 };
  await openMapAs(page, seed, 1);
  await page.locator('.journey-rival[data-gid="2"]').click();
  await expect(page.locator('#cannonPanel')).toBeHidden();
});

test('rival ships disappear offline and come back without sailing', async ({ page }) => {
  await openMapAs(page, seedHunt({ 1: { currentIndex: 3 }, 2: { currentIndex: 4 } }), 1);
  await expect(page.locator('#journeyRivalShips .journey-rival')).toHaveCount(3);

  // Drive real browser connectivity events rather than poking browserOnline
  // and updateConnectivityBadge() directly, so a broken 'offline'/'online'
  // listener registration (app/connectivity.js) would fail this test too.
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));

  // Stale positions are worse than none, so the ships are removed outright.
  await expect(page.locator('#journeyRivalShips .journey-rival')).toHaveCount(0);

  // The pupil's own voyage never depended on the network.
  await expect(page.locator('#journeyShip')).toBeVisible();
  await expect(page.locator('[aria-label="Pergi ke Pulau 4"]')).toHaveCount(1);

  // Move a rival WHILE offline. The seed keeps every position identical
  // across the offline window, `RivalShips.diff()` never sees a change, and
  // "no sail" is trivially true whether or not `rivalPositions` was reset —
  // this write is what actually exercises the guard: gid 2 goes from island
  // 4 to island 5 while the map cannot render anyone.
  await page.evaluate(() => huntRef('progress/2/currentIndex').set(5));

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const rival = page.locator('.journey-rival[data-gid="2"]');
  await expect(rival).toBeVisible();

  // Read the ship the same way the app positions it: a canvas-percentage
  // `top` straight off the element's own inline style, as the "sails to the
  // next island" test above does. boundingBox() would apply the element's
  // CSS transform and viewport-dependent pixel scaling on top, which is
  // exactly what let the previous version of this assertion pass no matter
  // what the code did.
  const readTop = () => rival.evaluate(node => parseFloat(node.style.top));
  // Group 2 is alone at island 5 among the three rendered rivals, so it
  // takes berth slot 0 there (map/rivals.js's layout()).
  const destination = await page.evaluate(() => RivalShips.pointAt(5, 0, MAP_STOPS).y);

  // If the offline guard in renderRivalShips() (app/views-map.js:195-198)
  // did not reset rivalPositions, RivalShips.diff() would still hold gid 2
  // at island 4 from before the outage. On reconnect that reads as a move
  // (4 -> 5), so renderRivalShips would call sailRivalShip instead of
  // placeRivalShip, and animateShipAlong (app/cannon-ui.js) places the ship
  // at its *old* island synchronously before the ~2700ms voyage even starts
  // animating. The very first read below would then land near island 4's y,
  // nowhere close to `destination`, and this assertion would fail.
  expect(Math.abs((await readTop()) - destination)).toBeLessThan(0.5);
  // Confirm it is not merely early in a voyage that happens to pass through
  // the destination — it must still be there after the voyage would have
  // long finished.
  await page.waitForTimeout(600);
  expect(Math.abs((await readTop()) - destination)).toBeLessThan(0.5);
});

test('the service worker shell version was bumped for this release', async () => {
  const fs = require('node:fs');
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  expect(sw).toContain("const CACHE_NAME = 'gs-shell-v21';");
});
