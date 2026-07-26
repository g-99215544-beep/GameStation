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

test('crossword supports multi-digit numpad entry, zoom, count-only feedback, and completion', async ({ page }) => {
  await openCrossword(page);

  await expect(page.locator('.cw-cell.blank')).toHaveCount(9);
  await expect(page.locator('#cwPad')).toBeHidden();

  const firstEntry = await page.evaluate(() => CrosswordEngine.blanks(gameState.crossword.grid)[0]);
  await page.locator('.cw-cell.blank').first().click();
  await expect(page.locator('#cwPad')).toBeVisible();
  for (const digit of String(firstEntry.answer)) {
    await page.locator('#cwPad button').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  }
  await page.getByRole('button', { name: 'Kotak kosong seterusnya' }).click();

  await page.getByRole('button', { name: 'Semak', exact: true }).click();
  await expect(page.locator('#crosswordMsg')).toHaveText('8 kotak belum diisi dan 0 jawapan perlu disemak.');
  await expect(page.locator('.cw-cell.error')).toHaveCount(0);

  const initialCellSize = await page.locator('#crosswordBoard').evaluate(el => getComputedStyle(el).getPropertyValue('--cw-cell').trim());
  await page.getByRole('button', { name: 'Zum masuk' }).click();
  const zoomedCellSize = await page.locator('#crosswordBoard').evaluate(el => getComputedStyle(el).getPropertyValue('--cw-cell').trim());
  expect(initialCellSize).toBe('44px');
  expect(zoomedCellSize).toBe('48px');
  expect(await page.locator('.crossword-viewport').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);

  await page.evaluate(() => {
    gameState.crossword.answers = {};
    CrosswordEngine.blanks(gameState.crossword.grid).forEach(entry => {
      selectCwCell(entry.r, entry.c);
      String(entry.answer).split('').forEach(d => cwInput(Number(d)));
    });
  });
  await page.getByRole('button', { name: 'Semak', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
  await expect(page.locator('#resultCard')).toContainText('Markah: 100');
});

test('crossword timeout keeps partial credit and applies the late penalty', async ({ page }) => {
  await openCrossword(page);
  await page.evaluate(() => {
    CrosswordEngine.blanks(gameState.crossword.grid).slice(0, 5).forEach(entry => {
      gameState.crossword.answers[`${entry.r},${entry.c}`] = String(entry.answer);
    });
    timeUp = true;
    window._crosswordTimeout();
  });
  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
  await expect(page.locator('#resultCard')).toContainText('Masa tamat');
  // 5 of 9 correct -> round(5/9*100)=56, minus the 20-point late penalty.
  await expect(page.locator('#resultCard')).toContainText('Markah: 36');
});

test('crossword numpad and heading stay visible on a phone, and Semak does not scroll the page', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openCrossword(page);
  await page.locator('.cw-cell.blank').first().click();

  const pad = page.locator('#cwPad');
  await expect(pad).toBeVisible();

  const before = await page.evaluate(() => {
    const padRect = document.getElementById('cwPad').getBoundingClientRect();
    const headingRect = document.querySelector('.crossword-game h2').getBoundingClientRect();
    return {
      padBottom: padRect.bottom,
      headingTop: headingRect.top,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight
    };
  });
  expect(before.padBottom).toBeLessThanOrEqual(before.innerHeight);
  expect(before.headingTop).toBeGreaterThanOrEqual(0);
  expect(before.scrollHeight).toBeLessThanOrEqual(before.innerHeight + 1);

  await page.getByRole('button', { name: 'Semak', exact: true }).click();

  const after = await page.evaluate(() => ({
    scrollY: window.scrollY,
    headingTop: document.querySelector('.crossword-game h2').getBoundingClientRect().top
  }));
  expect(after.scrollY).toBe(0);
  expect(after.headingTop).toBeGreaterThanOrEqual(0);

  await page.getByRole('button', { name: 'Selesai' }).click();
  await expect(pad).toBeHidden();
});
