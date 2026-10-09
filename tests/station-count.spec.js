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

test('step 2 shows only station cards; + adds up to 6 and a pop-up removes the last', async ({ page }) => {
  await seedPage(page, seedWith(3, {}));
  await openAdmin(page, 'setup');
  const cards = page.locator('#stationCards .setup-card[data-station]');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Stesen 1');
  // Forms are hidden until a card is tapped.
  await expect(page.locator('#st_loc_1')).toBeHidden();
  await page.click('#btnAddStation');
  // Adding opens the new station's pop-up straight away.
  await expect(page.locator('#station_modal_4')).toBeVisible();
  await page.click('#station_modal_4 .step-next');
  await expect(page.locator('#station_modal_4')).toBeHidden();
  await page.click('#btnAddStation');
  await page.click('#station_modal_5 .step-next');
  await page.click('#btnAddStation');
  await page.click('#station_modal_6 .step-next');
  await expect(cards).toHaveCount(6);
  await expect(page.locator('#btnAddStation')).toHaveCount(0);
  for (const n of [6, 5, 4]) {
    await cards.nth(n - 1).click();
    await page.click(`#station_modal_${n} .station-remove`);
  }
  await expect(cards).toHaveCount(3);
  // Stations 1-3 can never be removed.
  await cards.nth(2).click();
  await expect(page.locator('#station_modal_3 .station-remove')).toHaveCount(0);
});

test('a station pop-up has no name field and saves as "Stesen N"', async ({ page }) => {
  await seedPage(page, seedWith(3, {}));
  await openAdmin(page, 'setup');
  await page.locator('#stationCards .setup-card[data-station="2"]').click();
  await expect(page.locator('#station_modal_2')).toBeVisible();
  await expect(page.locator('#station_modal_2')).not.toContainText('Nama Stesen');
  await page.fill('#st_loc_2', 'Bawah pokok');
  await page.keyboard.press('Escape');
  await expect(page.locator('#station_modal_2')).toBeHidden();
  const collected = await page.evaluate(() => collectStations());
  expect(collected['2'].name).toBe('Stesen 2');
  expect(collected['2'].location).toBe('Bawah pokok');
});

test('an existing 6-station config renders six cards', async ({ page }) => {
  await seedPage(page, seedWith(6, {}));
  await openAdmin(page, 'setup');
  await expect(page.locator('#stationCards .setup-card[data-station]')).toHaveCount(6);
});

test('saving fewer stations regenerates group orders and preserves roster', async ({ page }) => {
  const groups = {
    1: { id: 1, name: 'Kumpulan 1', startStation: 5, order: [5, 6, 1, 2, 3, 4], loginPassword: '1001', members: ['A'] },
    2: { id: 2, name: 'Kumpulan 2', startStation: 2, order: [2, 3, 4, 5, 6, 1], loginPassword: '1002', members: ['B'] }
  };
  await seedPage(page, seedWith(6, groups));
  await openAdmin(page, 'setup');
  await page.evaluate(() => { removeStation(); removeStation(); removeStation(); });
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
