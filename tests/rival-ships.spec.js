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
  await openMapAs(page, seedHunt({ 1: { currentIndex: 0 } }), 1);
  const ship = page.locator('#journeyShip');
  const before = await ship.boundingBox();
  await page.evaluate(() => selectJourneyIsland(1));
  await expect.poll(async () => {
    const box = await ship.boundingBox();
    return Math.abs(box.y - before.y) > 2;
  }, { timeout: 4000 }).toBe(true);
});

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
