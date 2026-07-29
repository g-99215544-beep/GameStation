const { test, expect } = require('playwright/test');
const startStaticServer = require('./helpers/static-server.js');
const installFakeFirebase = require('./helpers/fake-firebase.js');

// The download that has to finish before a group walks away from the Wi-Fi.
// Served over http because service workers do not register on file:// URLs.
let server;
test.beforeAll(async () => { server = await startStaticServer(); });
test.afterAll(async () => { await server.close(); });

const STATIONS = {
  1: { id: 1, name: 'Stesen 1', location: 'x', password: 'AAAAA', gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10 },
  2: { id: 2, name: 'Stesen 2', location: 'y', password: 'BBBBB', gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10 },
  3: { id: 3, name: 'Stesen 3', location: 'z', password: 'CCCCC', gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10 }
};
const SEED = {
  gamestation2026: {
    config: { stations: STATIONS, groups: { 1: { id: 1, name: 'Kumpulan 1', startStation: 1, order: [1, 2, 3], loginPassword: '1001', members: [] } } },
    session: { status: 'active', startedAt: 1 },
    progress: { 1: { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 } }
  }
};

// A short local-only manifest. The real one carries ~15 MB of video and four
// CDN URLs; what matters here is the message protocol and the progress bar, and
// offline/preload.test.js already proves the real manifest is complete.
const TEST_ASSETS = ['index.html', 'offline/store.js', 'offline/resume.js', 'hunts/registry.js', 'stations/layout.js'];

async function openApp(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.route('https://unpkg.com/**', route => route.fulfill({ body: '' }));
  await page.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ body: 'window.QRCode=function(){};' }));
  await page.addInitScript(installFakeFirebase, SEED);
  await page.goto(server.origin + '/index.html');
  // Registration is fire-and-forget in index.html; the preload waits on ready,
  // so make sure the worker is actually installed before driving the test.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate(assets => { OfflinePreload.PRELOAD_ASSETS = assets; }, TEST_ASSETS);
}

test('logging in holds the group on a progress screen until the download finishes', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => { await loadConfigCache(); });

  await page.selectOption('#groupLoginSelect', '1');
  await page.fill('#groupLoginPass', '1001');
  await page.click('#view-login button.big');

  await expect(page.locator('#view-preload')).toHaveClass(/active/);
  await expect(page.locator('#preloadPercent')).toHaveText('100%', { timeout: 15000 });
  await expect(page.locator('#preloadStatus')).toContainText('tanpa internet');
  // Then it hands over to the journey on its own.
  await expect(page.locator('#view-preload')).not.toHaveClass(/active/, { timeout: 15000 });
});

test('the service worker really caches every asset it was asked for', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => { await loadConfigCache(); currentGroupId = '1'; });
  const result = await page.evaluate(() => runOfflinePreload());
  expect(result.ok).toBe(true);

  const cached = await page.evaluate(async assets => {
    const found = [];
    for (const asset of assets) {
      const hit = await caches.match(asset, { ignoreSearch: true });
      if (hit) found.push(asset);
    }
    return found;
  }, TEST_ASSETS);
  // hunts/registry.js is the one index.html loaded but sw.js used to forget.
  expect(cached).toEqual(expect.arrayContaining(TEST_ASSETS));
});

test('the hunt config lands in localStorage so stations work with the network off', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => { await loadConfigCache(); currentGroupId = '1'; });
  await page.evaluate(() => runOfflinePreload());

  const config = await page.evaluate(() => JSON.parse(localStorage.getItem(OfflineStore.CONFIG_CACHE_KEY)));
  expect(Object.keys(config.stations)).toEqual(['1', '2', '3']);
  expect(config.groups['1'].loginPassword).toBe('1001');
});

test('a full storage quota is reported instead of failing silently', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => { await loadConfigCache(); currentGroupId = '1'; });
  await page.evaluate(() => {
    const realSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === OfflineStore.CONFIG_CACHE_KEY) throw new DOMException('full', 'QuotaExceededError');
      return realSetItem.call(this, key, value);
    };
    runOfflinePreload();
  });

  await expect(page.locator('#preloadStatus')).toContainText('terlalu besar', { timeout: 15000 });
  await expect(page.locator('#preloadStatus')).toHaveClass(/err/);
  // It must not hand over on its own after a failure — a human decides.
  await expect(page.locator('#preloadSkip')).toBeVisible();
  await expect(page.locator('#view-preload')).toHaveClass(/active/);
});

test('skipping releases the group without waiting for the rest', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => { await loadConfigCache(); currentGroupId = '1'; });
  const outcome = await page.evaluate(() => {
    const promise = runOfflinePreload();
    skipOfflinePreload();
    return promise;
  });
  expect(outcome).toEqual({ ok: false, reason: 'skipped' });
});

test('a returning student is not made to download again', async ({ page }) => {
  await openApp(page);
  await page.evaluate(async () => { await loadConfigCache(); });
  await page.selectOption('#groupLoginSelect', '1');
  await page.fill('#groupLoginPass', '1001');
  await page.click('#view-login button.big');
  await expect(page.locator('#view-preload')).not.toHaveClass(/active/, { timeout: 20000 });

  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  // tryRestoreSession() runs on boot; the preload screen must never appear.
  await expect(page.locator('#view-preload')).not.toHaveClass(/active/);
});
