const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

const APP_URL = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;
const DIRECT_GAMES = ['sudoku', 'crossword', 'battleship', 'sifir', 'tangram', 'jejak_lari'];

async function installFirebaseStub(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(() => {
    window.__firebaseRefs = [];
    const snapshot = { val: () => null };
    window.firebase = {
      apps: [],
      initializeApp() { this.apps.push({}); },
      database() {
        return {
          ref(refPath) {
            window.__firebaseRefs.push(String(refPath));
            return {
              once: () => Promise.resolve(snapshot),
              on: () => {},
              off: () => {},
              set: () => Promise.resolve(),
              update: () => Promise.resolve()
            };
          }
        };
      }
    };
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

test('simple query links open every non-worksheet game directly in safe demo mode', async ({ page }) => {
  await installFirebaseStub(page);
  for (const gameType of DIRECT_GAMES) {
    await page.goto(`${APP_URL}?${gameType}`);
    await expect.poll(() => page.evaluate(() => gameState.type)).toBe(gameType);
    expect(await page.evaluate(() => ({
      testMode: window._testMode,
      directMode: window._directTestMode,
      view: document.getElementById('view-game').classList.contains('active'),
      configRefs: window.__firebaseRefs.filter(ref => ref.includes('/hunts/') || ref.includes('/config/'))
    }))).toEqual({ testMode: true, directMode: true, view: true, configRefs: [] });
  }
});

test('demo parameter remains an alias and worksheet has no direct route', async ({ page }) => {
  await installFirebaseStub(page);
  await page.goto(`${APP_URL}?demo=sudoku`);
  await expect.poll(() => page.evaluate(() => gameState.type)).toBe('sudoku');

  await page.goto(`${APP_URL}?lembaran_kerja`);
  await expect(page.locator('#view-login')).toHaveClass(/active/);
  expect(await page.evaluate(() => window._directTestMode)).not.toBe(true);
});

test('station editor contains no direct URL controls or link text', async ({ page }) => {
  await installFirebaseStub(page);
  await page.goto(APP_URL);
  await page.evaluate(() => {
    sessionInfo = { status: 'setup' };
    stationCount = 3;
    buildStationsUI({
      1: { id: 1, name: 'Sudoku', password: '12345', gameType: 'sudoku', gameDataRaw: '{}' },
      2: { id: 2, name: 'Tangram', password: '23456', gameType: 'tangram', gameDataRaw: '{}' },
      3: { id: 3, name: 'Lembaran', password: '34567', gameType: 'lembaran_kerja', gameDataRaw: '{"questions":[{"answer":"1"}]}' }
    });
  });
  await expect(page.locator('.station-direct-test')).toHaveCount(0);
  await expect(page.getByText('Pautan Ujian Terus')).toHaveCount(0);
});
