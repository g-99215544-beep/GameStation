const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

function group(id, startStation) {
  const order = Array.from({ length: 6 }, (_, index) => ((startStation - 1 + index) % 6) + 1);
  return { id, name: `Kumpulan ${id}`, loginPassword: String(1000 + id), startStation, order };
}

test('student islands use journey positions while physical stations stay rotated', async ({ page }) => {
  const groups = Object.fromEntries(Array.from({ length: 14 }, (_, index) => {
    const id = index + 1;
    return [id, group(id, ((id - 1) % 6) + 1)];
  }));
  const stations = Object.fromEntries(Array.from({ length: 6 }, (_, index) => {
    const id = index + 1;
    return [id, { id, name: `Stesen ${id}`, location: `Lokasi Stesen ${id}` }];
  }));
  const seed = {
    gamestation2026: {
      activeHuntId: 'tahun5',
      hunts: {
        tahun5: {
          name: 'Tahun 5', createdAt: 1,
          config: { groups, stations },
          session: { status: 'active' },
          progress: {}
        }
      }
    }
  };

  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(data => {
    const store = structuredClone(data);
    const at = key => key.split('/').filter(Boolean).reduce((value, part) => value && value[part], store);
    const write = (key, value) => {
      const parts = key.split('/').filter(Boolean);
      const last = parts.pop();
      const parent = parts.reduce((value, part) => value[part] ||= {}, store);
      parent[last] = structuredClone(value);
    };
    window.firebase = {
      apps: [],
      initializeApp() { this.apps.push({}); },
      database() {
        return {
          ref(key) {
            return {
              once: () => Promise.resolve({ val: () => structuredClone(at(key)) }),
              on: (_event, callback) => callback({ val: () => structuredClone(at(key)) }),
              set: value => { write(key, value); return Promise.resolve(); },
              update: value => { write(key, { ...at(key), ...value }); return Promise.resolve(); }
            };
          }
        };
      }
    };
  }, seed);

  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await expect(page.locator('#view-login')).toHaveClass(/active/);

  await page.evaluate(() => {
    currentGroupId = '3';
    progress = { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 };
    showJourneyMap();
  });
  await expect(page.locator('#journeyMap')).toBeVisible();
  await expect(page.locator('[aria-label="Pergi ke Pulau 1"]')).toHaveCount(1);
  await expect(page.locator('[aria-label="Pergi ke Pulau 3"]')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => stationIdAtPosition(1))).toBe(3);

  await page.locator('[aria-label="Pergi ke Pulau 1"]').click();
  await expect(page.locator('#view-clue')).toHaveClass(/active/, { timeout: 6000 });
  await expect(page.locator('#clueText')).toContainText('Lokasi Stesen 3');

  await page.evaluate(() => {
    progress.keys = [3];
    renderKeyrowMini();
  });
  await expect(page.locator('#keyrowMini .key:not(.empty)')).toHaveCount(1);

  await page.evaluate(async () => {
    sessionInfo = { status: 'setup' };
    showLoginPasswords();
    document.getElementById('start_station_5').value = '4';
    saveLoginPasswords();
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  await expect.poll(() => page.evaluate(() => groups[5].order)).toEqual([4, 5, 6, 1, 2, 3]);

  await page.evaluate(() => {
    sessionInfo = { status: 'active' };
    syncStartStationControlLock();
  });
  await expect(page.locator('#start_station_5')).toBeDisabled();

  await page.evaluate(() => {
    currentGroupId = '1';
    progress = { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 };
    showJourneyMap();
  });
  await expect(page.locator('[aria-label="Pergi ke Pulau 1"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => stationIdAtPosition(1))).toBe(1);
});
