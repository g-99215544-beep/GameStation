const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

function hunt(name, status, createdAt) {
  return {
    name, createdAt,
    config: {
      stations: { 1: { id: 1, name: 'Stesen 1', location: 'Dewan', password: '12345', gameType: 'quiz', gameDataRaw: '{}', timeLimitMin: 10 } },
      groups: { 1: { id: 1, name: 'Kumpulan 1', loginPassword: '1001', startStation: 1, order: [1], members: [] } }
    },
    session: { status },
    progress: { 1: { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 } }
  };
}

test('admin lists named hunts and only allows one active hunt', async ({ page }) => {
  const seed = { gamestation2026: { activeHuntId: null, hunts: {
    tahun5: hunt('Tahun 5', 'setup', 1),
    tahun6: hunt('Tahun 6', 'setup', 2)
  } } };
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(data => {
    const store = structuredClone(data);
    const at = key => key.split('/').filter(Boolean).reduce((value, part) => value && value[part], store);
    const write = (key, value) => {
      const parts = key.split('/').filter(Boolean); const last = parts.pop();
      const parent = parts.reduce((value, part) => (value[part] ||= {}), store);
      parent[last] = structuredClone(value);
    };
    window.firebase = { apps: [], initializeApp() { this.apps.push({}); }, database() { return { ref(key) { return {
      once: () => Promise.resolve({ val: () => structuredClone(at(key)) }),
      on: (_event, callback) => callback({ val: () => structuredClone(at(key)) }), off: () => {},
      set: value => { write(key, value); return Promise.resolve(); },
      update: value => { write(key, { ...(at(key) || {}), ...value }); return Promise.resolve(); },
      push: () => ({ key: 'new-hunt' })
    }; } }; } };
  }, seed);

  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => { saveSession('admin'); show('view-admin'); selectAdminTopTab('hunts'); });
  await expect(page.locator('#huntList')).toContainText('Tahun 5');
  await expect(page.locator('#huntList')).toContainText('Tahun 6');

  await page.evaluate(async () => {
    toggleHuntSession('tahun5');
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect.poll(() => page.evaluate(() => db.ref('gamestation2026/activeHuntId').once('value').then(s => s.val()))).toBe('tahun5');
  await page.evaluate(() => { hunts.tahun5.session.status = 'active'; });
  expect(await page.evaluate(() => HuntRegistry.canStart(hunts, 'tahun6'))).toBe(false);

  await page.evaluate(async () => {
    currentHuntId='tahun5';
    await loadConfigCache();
  });
  await expect(page.locator('#groupLoginSelect')).toContainText('Kumpulan 1');
});
