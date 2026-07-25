const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function openCrossword(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(() => {
    const snapshot = { val: () => null };
    window.firebase = {
      apps: [],
      initializeApp() { this.apps.push({}); },
      database() {
        return {
          ref() {
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
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    window._testMode = true;
    startGame('crossword-test', {
      id: 'crossword-test',
      name: 'Silang Kata Matematik',
      gameType: 'crossword',
      gameDataRaw: '{}',
      timeLimitMin: 10
    });
  });
}

test('crossword supports numpad entry, zoom, count-only feedback, and completion', async ({ page }) => {
  await openCrossword(page);

  await expect(page.locator('.cw-cell.blank')).toHaveCount(20);
  await expect(page.locator('#cwPad')).toBeHidden();
  await page.locator('.cw-cell.blank').first().click();
  await expect(page.locator('#cwPad')).toBeVisible();
  await page.locator('#cwPad button').filter({ hasText: /^9$/ }).click();

  await page.getByRole('button', { name: 'Semak', exact: true }).click();
  await expect(page.locator('#crosswordMsg')).toHaveText('19 kotak belum diisi dan 1 jawapan perlu disemak.');
  await expect(page.locator('.cw-cell.error')).toHaveCount(0);

  const initialCellSize = await page.locator('#crosswordBoard').evaluate(el => getComputedStyle(el).getPropertyValue('--cw-cell').trim());
  await page.getByRole('button', { name: 'Zum masuk' }).click();
  const zoomedCellSize = await page.locator('#crosswordBoard').evaluate(el => getComputedStyle(el).getPropertyValue('--cw-cell').trim());
  expect(initialCellSize).toBe('44px');
  expect(zoomedCellSize).toBe('48px');
  expect(await page.locator('.crossword-viewport').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);

  await page.evaluate(() => {
    CrosswordEngine.blanks(CrosswordEngine.PUZZLE.grid).forEach(entry => {
      selectCwCell(entry.r, entry.c);
      cwInput(entry.answer);
    });
  });
  await page.getByRole('button', { name: 'Semak', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
  await expect(page.locator('#resultCard')).toContainText('Markah: 100');
});

test('crossword timeout keeps partial credit and applies the late penalty', async ({ page }) => {
  await openCrossword(page);
  await page.evaluate(() => {
    CrosswordEngine.blanks(CrosswordEngine.PUZZLE.grid).slice(0, 10).forEach(entry => {
      gameState.crossword.answers[`${entry.r},${entry.c}`] = String(entry.answer);
    });
    timeUp = true;
    window._crosswordTimeout();
  });
  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
  await expect(page.locator('#resultCard')).toContainText('Masa tamat');
  await expect(page.locator('#resultCard')).toContainText('Markah: 30');
});

test('crossword numpad stays fully visible in a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCrossword(page);
  await page.locator('.cw-cell.blank').first().click();

  const pad = page.locator('#cwPad');
  await expect(pad).toBeVisible();
  await expect(page.locator('.crossword-game')).toHaveClass(/cw-pad-open/);
  const layout = await pad.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return {
      position: getComputedStyle(element).position,
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
  expect(layout.position).toBe('fixed');
  expect(layout.left).toBeGreaterThanOrEqual(0);
  expect(layout.top).toBeGreaterThanOrEqual(0);
  expect(layout.right).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);

  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(pad).toBeHidden();
  await expect(page.locator('.crossword-game')).not.toHaveClass(/cw-pad-open/);
});
