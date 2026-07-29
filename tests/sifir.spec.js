const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function seedPage(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(() => {
    const store = { gamestation2026: { progress: { 1: { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 } } } };
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
  });
}

async function answerForPrompt(page) {
  const prompt = await page.locator('#sifirPrompt').textContent();
  const match = String(prompt).match(/(\d+)\s*×\s*(\d+)/);
  if (!match) throw new Error(`Cannot parse Sifir prompt: ${prompt}`);
  return Number(match[1]) * Number(match[2]);
}

test('Sifir Challenge resets after a wrong answer and completes after 15 correct answers', async ({ page }) => {
  await seedPage(page);
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await expect(page.locator('#view-login')).toHaveClass(/active/);
  await page.locator('#dailyIntro').evaluate(element => { element.hidden = true; });
  await page.evaluate(() => {
    currentGroupId = '1';
    startGame('1', { id: 1, name: 'Sifir Ujian', location: 'x', password: '12345', timeLimitMin: 10, gameType: 'sifir', gameDataRaw: '{}' });
  });

  await expect(page.locator('.sifir-choice')).toHaveCount(4);
  await expect(page.locator('#gameCard')).toContainText('Soalan 1/15');
  await expect(page.locator('#sifirQTimer')).toHaveAttribute('aria-valuenow', '4');
  await expect(page.locator('#sifirQBar')).toBeVisible();
  await expect.poll(() => page.locator('#sifirQBar').evaluate(bar => getComputedStyle(bar).animationName))
    .toBe('sifir-question-countdown');
  const firstAnswer = await answerForPrompt(page);
  const wrong = await page.locator('.sifir-choice').evaluateAll((buttons, answer) =>
    Number(buttons.map(button => button.textContent.trim()).find(value => Number(value) !== answer)), firstAnswer);
  await page.locator('.sifir-choice').filter({ hasText: new RegExp(`^${wrong}$`) }).click();
  await expect(page.locator('#gameCard')).toContainText('Cuba Semula');
  await expect(page.locator('#gameCard')).toContainText('Soalan 1/15', { timeout: 2000 });

  for (let index = 0; index < 15; index++) {
    const answer = await answerForPrompt(page);
    await page.locator('.sifir-choice').filter({ hasText: new RegExp(`^${answer}$`) }).click();
  }
  await expect(page.locator('#view-result')).toHaveClass(/active/);
  const progress = await page.evaluate(() => db.ref('gamestation2026/progress/1').once('value').then(snapshot => snapshot.val()));
  expect(progress.totalScore).toBeGreaterThan(0);
  expect(progress.currentIndex).toBe(1);
});

test('Sifir Challenge completes after the admin-configured correct-answer streak', async ({ page }) => {
  await seedPage(page);
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.locator('#dailyIntro').evaluate(element => { element.hidden = true; });
  await page.evaluate(() => {
    currentGroupId = '1';
    startGame('1', { id: 1, name: 'Sifir Pendek', location: 'x', password: '12345', timeLimitMin: 10, gameType: 'sifir', gameDataRaw: '{"sifirTarget":3}' });
  });

  await expect(page.locator('#gameCard')).toContainText('Soalan 1/3');
  for (let index = 0; index < 3; index++) {
    const answer = await answerForPrompt(page);
    await page.locator('.sifir-choice').filter({ hasText: new RegExp(`^${answer}$`) }).click();
  }
  await expect(page.locator('#view-result')).toHaveClass(/active/);
});
