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

test('admin can select the Sudoku stages that a station requires', async ({ page }) => {
  await installFirebaseStub(page);
  await page.goto(APP_URL);
  await page.evaluate(() => {
    sessionInfo = { status: 'setup' };
    stationCount = 3;
    show('view-admin');
    selectAdminTopTab('setup');
    selectAdminTab('setup');
    buildStationsUI({
      1: { id: 1, name: 'Sudoku', password: '12345', gameType: 'sudoku', gameDataRaw: '{}' },
      2: {}, 3: {}
    });
  });
  const stages=page.locator('#sudoku_stage_editor_1 input[type="checkbox"]');
  await expect(stages).toHaveCount(3);
  expect(await stages.evaluateAll(inputs=>inputs.map(input=>input.checked))).toEqual([true,true,true]);
  await stages.nth(2).uncheck({ force:true });

  const saved=await page.evaluate(() => JSON.parse(stationGameDataRaw(1,'sudoku')));
  expect(saved.sudokuStages).toEqual([1,2]);

  await page.evaluate(() => {
    window._testMode=true;
    startGame('sudoku-test', {
      id: 'sudoku-test', name: 'Sudoku', gameType: 'sudoku',
      gameDataRaw: JSON.stringify({ sudokuStages: [1, 3] }), timeLimitMin: 10
    });
  });
  expect(await page.evaluate(() => gameState.sudoku.stages.map(stage => stage.id))).toEqual([1,3]);
  await expect(page.locator('.sudoku-progress span')).toHaveText(['1','3']);
  await expect(page.locator('#gameCard')).toContainText('Selesaikan 2 stage Sudoku');
});
