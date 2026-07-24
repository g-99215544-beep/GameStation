const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function seedPage(page) {
  const stations = {
    1: { id: 1, name: 'Stesen 1', location: 'x', password: '12345', gameType: 'quiz', gameDataRaw: '{}', timeLimitMin: 10 },
    2: { id: 2, name: 'Stesen 2', location: 'x', password: '12345', gameType: 'quiz', gameDataRaw: '{}', timeLimitMin: 10 },
    3: { id: 3, name: 'Stesen 3', location: 'x', password: '12345', gameType: 'quiz', gameDataRaw: '{}', timeLimitMin: 10 }
  };
  const groups = { 1: { id: 1, name: 'Kumpulan 1', startStation: 1, order: [1, 2, 3], loginPassword: '1001', members: [] } };
  const seed = { gamestation2026: { config: { stations, groups }, session: { status: 'active', startedAt: 1 }, progress: { 1: { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 } } } };
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(data => {
    const store = structuredClone(data);
    window.__networkOnline = true;
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
        once: () => window.__networkOnline ? Promise.resolve({ val: () => structuredClone(at(key)) }) : Promise.reject(new Error('offline')),
        on: (_event, callback) => callback({ val: () => structuredClone(at(key)) }), off: () => {},
        set: value => window.__networkOnline ? (write(key, value), Promise.resolve()) : Promise.reject(new Error('offline')),
        update: value => window.__networkOnline ? (write(key, { ...at(key), ...value }), Promise.resolve()) : Promise.reject(new Error('offline'))
      }; } }; }
    };
  }, seed);
}

test('progress persists offline across reload and flushes when back online', async ({ page }) => {
  await seedPage(page);
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  expect(await page.evaluate(() => {
    browserOnline = true;
    firebaseConnected = false;
    firebaseConnectionEstablished = false;
    return isOffline();
  })).toBe(false);
  await page.evaluate(async () => {
    await loadConfigCache();
    currentGroupId = '1';
    sessionInfo = { status: 'active', startedAt: 1 };
    progress = { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 };
    saveSession('group', '1');
    persistSessionCache(sessionInfo);
    window.__networkOnline = false;
    window.dispatchEvent(new Event('offline'));
    window._curStId = 1;
    submitCompletion(true, 80, 10);
    window._curStId = 2;
    submitCompletion(true, 70, 20);
  });
  const offlineState = await page.evaluate(() => ({
    progress,
    local: JSON.parse(localStorage.getItem(OfflineStore.progressKey('1'))),
    pending: JSON.parse(localStorage.getItem(OfflineStore.PENDING_KEY)),
    remote: null
  }));
  expect(offlineState.progress).toMatchObject({ currentIndex: 2, totalScore: 150, keys: [1, 2] });
  expect(offlineState.local).toMatchObject({ currentIndex: 2, totalScore: 150 });
  expect(offlineState.pending).toHaveLength(1);
  expect(offlineState.pending[0].data.currentIndex).toBe(2);

  await page.addInitScript(() => {
    window.__networkOnline = false;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => progress.currentIndex)).toBe(2);
  await expect.poll(() => page.evaluate(() => (progress.keys || []).join(','))).toBe('1,2');

  await page.evaluate(() => {
    window.__networkOnline = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => page.evaluate(() => db.ref('gamestation2026/progress/1').once('value').then(snapshot => snapshot.val().currentIndex))).toBe(2);
  await expect.poll(() => page.evaluate(() => localStorage.getItem(OfflineStore.PENDING_KEY))).toBeNull();
});
