const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function seedPage(page, seed) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(data => {
    const store = structuredClone(data);
    const at = key => key.split('/').filter(Boolean).reduce((value, part) => value && value[part], store);
    const write = (key, value) => {
      const parts = key.split('/').filter(Boolean);
      const last = parts.pop();
      const parent = parts.reduce((value, part) => (value[part] ||= {}), store);
      parent[last] = structuredClone(value);
    };
    window.firebase = {
      apps: [], initializeApp() { this.apps.push({}); },
      database() { return { ref(key) { return {
        once: () => Promise.resolve({ val: () => structuredClone(at(key)) }),
        on: (_event, callback) => callback({ val: () => structuredClone(at(key)) }), off: () => {},
        set: value => { write(key, value); return Promise.resolve(); },
        update: value => { write(key, { ...at(key), ...value }); return Promise.resolve(); }
      }; } }; }
    };
  }, seed);
}

// The gameType must be one that still exists in GAME_TYPES. A removed type
// (this used to seed 'quiz') leaves the station form's <select> falling back to
// its first option, lembaran_kerja, whose validation then blocks pushConfig
// before it writes anything — and the failure reads as "orders were not
// regenerated" rather than "the seed is stale".
function seedWith(stationCount, groups) {
  const stations = Object.fromEntries(Array.from({ length: stationCount }, (_, index) => {
    const id = index + 1;
    return [id, { id, name: `Stesen ${id}`, location: 'x', password: '12345', gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10 }];
  }));
  return { gamestation2026: { config: { stations, groups }, session: { status: 'setup' }, progress: {} } };
}

async function openAdmin(page, tab) {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await expect(page.locator('#view-login')).toHaveClass(/active/);
  await page.evaluate(async selectedTab => {
    await loadConfigCache();
    sessionInfo = { status: 'setup' };
    show('view-admin');
    selectAdminTab(selectedTab);
  }, tab);
}

test('admin tabs put groups first and stations second', async ({ page }) => {
  await seedPage(page, seedWith(3, {}));
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  const labels = await page.locator('#adminTabSelect option').allTextContents();
  expect(labels[0]).toMatch(/Langkah 1/);
  expect(labels[0]).toMatch(/Kumpulan/);
  expect(labels[1]).toMatch(/Langkah 2/);
  expect(labels[1]).toMatch(/Stesen/);
  await expect(page.locator('#adminTabSelect option')).toHaveCount(7);
  const values = await page.locator('#adminTabSelect option').evaluateAll(options => options.map(option => option.value));
  expect(values.slice(0, 5)).toEqual(['groups', 'setup', 'passwords', 'qr', 'session']);
});

test('station setup defaults to 3 blocks and +/- respects 3..6 bounds', async ({ page }) => {
  await seedPage(page, seedWith(3, {}));
  await openAdmin(page, 'setup');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(3);
  await page.click('#btnAddStation');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(4);
  await page.click('#btnAddStation');
  await page.click('#btnAddStation');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(6);
  await expect(page.locator('#btnAddStation')).toBeDisabled();
  await page.click('#btnRemoveStation');
  await page.click('#btnRemoveStation');
  await page.click('#btnRemoveStation');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(3);
  await expect(page.locator('#btnRemoveStation')).toBeDisabled();
});

test('an existing 6-station config renders six blocks', async ({ page }) => {
  await seedPage(page, seedWith(6, {}));
  await openAdmin(page, 'setup');
  await expect(page.locator('#stationsArea .station-block')).toHaveCount(6);
});

test('saving fewer stations regenerates group orders and preserves roster', async ({ page }) => {
  const groups = {
    1: { id: 1, name: 'Kumpulan 1', startStation: 5, order: [5, 6, 1, 2, 3, 4], loginPassword: '1001', members: ['A'] },
    2: { id: 2, name: 'Kumpulan 2', startStation: 2, order: [2, 3, 4, 5, 6, 1], loginPassword: '1002', members: ['B'] }
  };
  await seedPage(page, seedWith(6, groups));
  await openAdmin(page, 'setup');
  await page.click('#btnRemoveStation');
  await page.click('#btnRemoveStation');
  await page.click('#btnRemoveStation');
  await page.evaluate(async () => { pushConfig(); await new Promise(resolve => setTimeout(resolve, 0)); });
  const saved = await page.evaluate(() => db.ref('gamestation2026/config/groups').once('value').then(snapshot => snapshot.val()));
  expect(saved['1'].order).toHaveLength(3);
  expect(saved['2'].order).toHaveLength(3);
  expect(saved['1'].startStation).toBeLessThanOrEqual(3);
  expect(saved['1'].members).toEqual(['A']);
  const stations = await page.evaluate(() => db.ref('gamestation2026/config/stations').once('value').then(snapshot => snapshot.val()));
  expect(Object.keys(stations)).toHaveLength(3);
});

test('journey map renders only N islands', async ({ page }) => {
  const groups = { 1: { id: 1, name: 'Kumpulan 1', startStation: 1, order: [1, 2, 3], loginPassword: '1001', members: [] } };
  await seedPage(page, seedWith(3, groups));
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(async () => {
    await loadConfigCache();
    currentGroupId = '1';
    progress = { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 };
    showJourneyMap();
  });
  await expect(page.locator('#journeyIslandButtons .journey-island-button')).toHaveCount(3);
});
