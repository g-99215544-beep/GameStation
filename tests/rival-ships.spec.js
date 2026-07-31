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
