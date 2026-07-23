const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

test.use({ permissions: ['geolocation'], geolocation: { latitude: 1.5, longitude: 110.0 } });

test('run tracker accrues GPS distance and completes at target', async ({ page, context }) => {
  // Stub the Firebase compat SDK so the page boots offline (matches student-island-journey.spec.js).
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(() => {
    window.firebase = {
      apps: [],
      initializeApp() { this.apps.push({}); },
      database() {
        return { ref() { return {
          once: () => Promise.resolve({ val: () => null }),
          on: () => {}, off: () => {},
          set: () => Promise.resolve(), update: () => Promise.resolve()
        }; } };
      }
    };
  });

  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await expect(page.locator('#view-login')).toHaveClass(/active/);

  // Start a run station in test mode: 0.05 km target (~50 m).
  await page.evaluate(() => {
    window._testMode = true;
    startGame('t', { id: 't', name: 'Lari Ujian', location: 'x', password: '12345',
      timeLimitMin: 10, gameType: 'jejak_lari', gameDataRaw: '{"targetKm":0.05}' });
  });
  await page.getByText('Mula Lari').click();
  await expect(page.locator('#runKm')).toBeVisible();

  // Move north in two ~44 m steps (each < MAX_JUMP 200 m) -> ~88 m total > 50 m target.
  await context.setGeolocation({ latitude: 1.5004, longitude: 110.0 });
  await context.setGeolocation({ latitude: 1.5008, longitude: 110.0 });

  await expect(page.locator('#view-result')).toHaveClass(/active/, { timeout: 6000 });
  await expect(page.locator('#resultCard')).toContainText('Ujian Selesai');
});
