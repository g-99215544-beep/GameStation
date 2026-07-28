const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

const INDEX = pathToFileURL(path.join(__dirname, '..', 'index.html')).href;

// Defined in tests/helpers/fake-firebase.js.
const installFakeFirebase = require('./helpers/fake-firebase.js');

function seedHunt(overrides = {}) {
  const stations = Object.fromEntries(Array.from({ length: 3 }, (_, index) => {
    const id = index + 1;
    return [id, {
      id, name: `Stesen ${id}`, location: `Lokasi ${id}`,
      password: `PASS${id}`, timeLimitMin: 10,
      gameType: 'lembaran_kerja',
      gameDataRaw: JSON.stringify({ questions: [{ answer: String(id), image: '' }] })
    }];
  }));
  const groups = Object.fromEntries(Array.from({ length: 3 }, (_, index) => {
    const id = index + 1;
    return [id, {
      id, name: `Kumpulan ${id}`, loginPassword: String(1000 + id),
      startStation: id, order: [1, 2, 3], members: []
    }];
  }));
  return {
    gamestation2026: {
      hunts: {
        h1: {
          // status must be 'setup', not 'active' — an active session locks every
          // station/cannon input via syncStationSetupLock() and pushConfig()
          // refuses to save, which would make it impossible to drive this UI.
          name: 'Ujian Meriam', createdAt: 1, updatedAt: 1,
          session: { status: 'setup' },
          config: { stations, groups, ...(overrides.config || {}) },
          progress: overrides.progress || Object.fromEntries(
            Object.keys(groups).map(gid => [gid, {
              currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0
            }])
          )
        }
      },
      activeHuntId: null
    }
  };
}

async function openApp(page, seed) {
  // Block the real Firebase CDN scripts so the injected mock below is authoritative.
  // Without this, when network is available the real SDK loads, overwrites the mock,
  // and any writes would hit the real production database.
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(installFakeFirebase, seed);
  await page.goto(INDEX);
}

async function openHuntSetup(page) {
  await page.locator('#adminAccessBtn').click();
  await page.locator('#adminPin').fill('1234');
  await page.getByRole('button', { name: 'Masuk Admin' }).click();
  await page.locator('.group-card', { hasText: 'Ujian Meriam' }).getByRole('button', { name: 'Edit' }).click();
  await page.locator('#adminTabSelect').selectOption('setup');
}

test('admin can enable cannons, add one, and save it to config', async ({ page }) => {
  await openApp(page, seedHunt());
  await openHuntSetup(page);

  await page.locator('#cannonEnabled').check();
  await expect(page.locator('#cannonBody')).toBeVisible();
  await page.locator('#cannonDamage').fill('15');
  await page.getByRole('button', { name: '＋ Tambah Meriam' }).click();

  await page.locator('#cn_name_c1').fill('Meriam Kubu Batu');
  await page.locator('#st_gametype_c1').selectOption('lembaran_kerja');
  await page.locator('#worksheet_editor_c1 .worksheet-answer').first().fill('42');

  await page.getByRole('button', { name: 'Simpan Treasure Hunt' }).first().click();
  // #pushStatus is duplicated (a second, display:none copy lives in the legacy
  // admin view), so scope to the panel actually in use to avoid a strict-mode
  // violation.
  await expect(page.locator('#admin-panel-setup #pushStatus')).toContainText('Config di-push');

  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.config);
  expect(saved.cannon).toEqual({ enabled: true, damagePercent: 15 });
  expect(saved.cannons.c1.name).toBe('Meriam Kubu Batu');
  expect(saved.cannons.c1.password).toMatch(/^[A-Za-z0-9]{5}$/);
  expect(JSON.parse(saved.cannons.c1.gameDataRaw).questions[0].answer).toBe('42');
});

test('a cannon password that collides with a station is rejected by name', async ({ page }) => {
  await openApp(page, seedHunt());
  await openHuntSetup(page);

  await page.locator('#cannonEnabled').check();
  await page.getByRole('button', { name: '＋ Tambah Meriam' }).click();
  await page.locator('#cn_pass_c1').fill('PASS1');
  await page.locator('#worksheet_editor_c1 .worksheet-answer').first().fill('7');

  page.once('dialog', dialog => {
    expect(dialog.message()).toContain('Stesen 1');
    expect(dialog.message()).toContain('Meriam c1');
    dialog.dismiss();
  });
  await page.getByRole('button', { name: 'Simpan Treasure Hunt' }).first().click();
});

test('the seventh cannon is refused', async ({ page }) => {
  await openApp(page, seedHunt());
  await openHuntSetup(page);
  await page.locator('#cannonEnabled').check();

  const add = page.getByRole('button', { name: '＋ Tambah Meriam' });
  for (let n = 0; n < 6; n++) await add.click();
  await expect(page.locator('.cannon-block')).toHaveCount(6);
  await expect(add).toBeDisabled();
});

test('cannon QRs are generated in their own labelled section', async ({ page }) => {
  await openApp(page, seedHunt({
    config: {
      cannon: { enabled: true, damagePercent: 10 },
      cannons: { c1: { id: 'c1', name: 'Meriam Kubu Batu', password: 'QQQQQ', gameType: 'lembaran_kerja', gameDataRaw: '{"questions":[{"answer":"9","image":""}]}' } }
    }
  }));
  await openHuntSetup(page);
  await page.locator('#adminTabSelect').selectOption('qr');
  await page.getByRole('button', { name: 'Jana QR Stesen' }).click();

  await expect(page.locator('#qrOutput .qr-print')).toHaveCount(4);   // 3 stations + 1 cannon
  const cannonCard = page.locator('#qrOutput .qr-print.cannon-qr');
  await expect(cannonCard).toHaveCount(1);
  await expect(cannonCard).toContainText('Meriam Kubu Batu');
  await expect(cannonCard).toContainText('satu peluru');
});
