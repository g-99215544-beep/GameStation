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
          // status must be 'setup', not 'active', by default — an active session
          // locks every station/cannon input via syncStationSetupLock() and
          // pushConfig() refuses to save, which would make it impossible to
          // drive the admin setup UI. Tests that need a logged-in student to
          // actually reach the journey map (rather than the "waiting for
          // session" screen) pass overrides.session to opt into 'active'.
          name: 'Ujian Meriam', createdAt: 1, updatedAt: 1,
          session: overrides.session || { status: 'setup' },
          config: { stations, groups, ...(overrides.config || {}) },
          progress: overrides.progress || Object.fromEntries(
            Object.keys(groups).map(gid => [gid, {
              currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0
            }])
          )
        }
      },
      // Left null by default so admin-flow tests (which log in via #adminAccessBtn
      // and never touch #view-login) are unaffected. watchActiveHunt() only loads
      // config/groups automatically when this points at a real hunt id, so any
      // test that drives the student #view-login login form must override it to
      // 'h1' — otherwise `groups` stays undefined and loginAsGroup() throws.
      activeHuntId: overrides.activeHuntId !== undefined ? overrides.activeHuntId : null
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

// Logs in as admin and opens the Smart Board straight from the hunt list, via
// the "Peti Harta Karun" button (openHuntTreasure -> showSmartBoard). This
// stays on the same page load (no navigation), so the fake Firebase installed
// by openApp's addInitScript keeps whatever state has accumulated so far —
// unlike a second page.goto(INDEX + '?board'), which would re-run the init
// script and silently reseed window.__db from the original seed.
async function openHuntTreasureBoard(page) {
  await page.locator('#adminAccessBtn').click();
  await page.locator('#adminPin').fill('1234');
  await page.getByRole('button', { name: 'Masuk Admin' }).click();
  await page.locator('.group-card', { hasText: 'Ujian Meriam' }).getByRole('button', { name: 'Peti Harta Karun' }).click();
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

test('disabled cannons produce no cannon QR, even with a populated cannons map', async ({ page }) => {
  await openApp(page, seedHunt({
    config: {
      cannon: { enabled: false, damagePercent: 10 },
      cannons: { c1: { id: 'c1', name: 'Meriam Kubu Batu', password: 'QQQQQ', gameType: 'lembaran_kerja', gameDataRaw: '{"questions":[{"answer":"9","image":""}]}' } }
    }
  }));
  await openHuntSetup(page);
  await page.locator('#adminTabSelect').selectOption('qr');
  await page.getByRole('button', { name: 'Jana QR Stesen' }).click();

  await expect(page.locator('#qrOutput .qr-print.cannon-qr')).toHaveCount(0);
  await expect(page.locator('#qrOutput .qr-print')).toHaveCount(3);
});

test('a damaged group scores totalScore x HP plus an undamaged bonus', async ({ page }) => {
  await openApp(page, seedHunt({
    progress: {
      1: { currentIndex: 3, status: 'ready_chest', keys: [1, 2, 3], totalScore: 300, hp: 70, completedStations: {} },
      2: { currentIndex: 0, status: 'idle', keys: [], totalScore: 0, completedStations: {} },
      3: { currentIndex: 0, status: 'idle', keys: [], totalScore: 0, completedStations: {} }
    }
  }));
  await openHuntTreasureBoard(page);
  await page.locator('#chest-card-1').click();
  await expect(page.locator('#boardToast')).toContainText('Markah akhir 260');   // 300*0.7 + 50

  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.finalScore).toBe(260);
  expect(saved.finishBonus).toBe(50);
});

test('a hunt with no hp field scores exactly as before', async ({ page }) => {
  await openApp(page, seedHunt({
    progress: {
      1: { currentIndex: 3, status: 'ready_chest', keys: [1, 2, 3], totalScore: 300, completedStations: {} },
      2: { currentIndex: 0, status: 'idle', keys: [], totalScore: 0, completedStations: {} },
      3: { currentIndex: 0, status: 'idle', keys: [], totalScore: 0, completedStations: {} }
    }
  }));
  await openHuntTreasureBoard(page);
  await page.locator('#chest-card-1').click();
  // The chest-open write only lands after playChestOpen's ~1.7s animation
  // finishes, so wait for the toast (which fires in the same callback as the
  // write) before reading window.__db — otherwise the read races the write.
  await expect(page.locator('#boardToast')).toContainText('Markah akhir');
  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.finalScore).toBe(350);
});

test('finishing a station never writes hp, ammo, claimed or incoming', async ({ page }) => {
  await openApp(page, seedHunt());
  // currentGroupId, currentHuntId, progress and gameState are declared with
  // `let` at the top of index.html's script, so they are script-scope global
  // bindings, not properties of `window`. Assigning window.currentGroupId (as
  // an earlier draft of this test did) would silently create an unrelated
  // property and leave the real binding untouched, so submitCompletion below
  // would resolve an empty currentGroupId/huntPath. Bare assignment inside
  // page.evaluate resolves against the same global lexical scope the app's
  // functions close over, so it reaches the real bindings.
  await page.evaluate(() => {
    currentGroupId = '1';
    currentHuntId = 'h1';
    // showResult() (called at the end of submitCompletion) reads
    // groups[currentGroupId]; a real session would have this populated via
    // group login, which this test bypasses, so seed the minimum needed to
    // avoid a TypeError on undefined.
    groups = {};
    progress = {
      currentIndex: 0, status: 'idle', keys: [], totalScore: 0, completedStations: {},
      hp: 100, ammo: 2, claimed: { c1: 1 }, incoming: { k1: { from: '2' } }
    };
    window._curStId = 1;
    gameState = { type: 'quiz' };
    submitCompletion(true, 80, 30);
  });
  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.totalScore).toBe(80);
  expect(saved).not.toHaveProperty('hp');
  expect(saved).not.toHaveProperty('ammo');
  expect(saved).not.toHaveProperty('claimed');
  expect(saved).not.toHaveProperty('incoming');
});

// Logs a student in as the given group id via the login view. Seeded groups
// use login password `1000 + <group id>` (see seedHunt above).
async function loginAsGroup(page, groupId) {
  await page.locator('#groupLoginSelect').selectOption(String(groupId));
  await page.locator('#groupLoginPass').fill(String(1000 + Number(groupId)));
  await page.getByRole('button', { name: 'Masuk sebagai Kumpulan' }).click();
}

test('the ship carries an HP bar sized to the group HP', async ({ page }) => {
  await openApp(page, seedHunt({
    activeHuntId: 'h1',
    session: { status: 'active' },
    config: { cannon: { enabled: true, damagePercent: 10 }, cannons: {} },
    progress: {
      1: { currentIndex: 1, status: 'idle', keys: [1], totalScore: 80, hp: 90, completedStations: { 1: { score: 80 } } },
      2: { currentIndex: 0, status: 'idle', keys: [], totalScore: 0, completedStations: {} },
      3: { currentIndex: 0, status: 'idle', keys: [], totalScore: 0, completedStations: {} }
    }
  }));
  await loginAsGroup(page, 1);

  await expect(page.locator('#journeyShipHp')).toBeVisible();
  await expect(page.locator('#journeyShipHpText')).toHaveText('90%');
  await expect(page.locator('#journeyShipHpFill')).toHaveCSS('width', /.+/);
  const width = await page.locator('#journeyShipHpFill').evaluate(el => el.style.width);
  expect(width).toBe('90%');
});

test('a group at full health shows a full green bar', async ({ page }) => {
  await openApp(page, seedHunt({
    activeHuntId: 'h1',
    session: { status: 'active' },
    config: { cannon: { enabled: true, damagePercent: 10 }, cannons: {} }
  }));
  await loginAsGroup(page, 2);
  const width = await page.locator('#journeyShipHpFill').evaluate(el => el.style.width);
  expect(width).toBe('100%');
});

// cannonHunt() is a factory, not a shared constant object, and is passed
// straight into seedHunt(overrides) (not nested under gamestation2026).
// activeHuntId and session:{status:'active'} are required here (unlike the
// brief's original draft, which omitted them) because loginAsGroup drives the
// real #view-login form: watchActiveHunt() only populates `groups`/`stations`
// when activeHuntId points at a real hunt, and an inactive session shows the
// "waiting for session" screen instead of the journey map where #cannonFab
// lives. See seedHunt's own comments above.
//
// This must stay a factory (fresh object graph per call), not a shared
// constant: seedHunt() does `progress: overrides.progress || ...` — a bare
// reference assignment, not a clone. A shared CANNON_HUNT constant would mean
// every test's `seed.gamestation2026.hunts.h1.progress` is the *same* object,
// so a test that mutates it (e.g. the "opened its chest" test overwriting
// progress[1] to a won state) permanently corrupts it for every later test
// that reuses the constant — which is exactly what happened here: with a
// shared constant, the offline test below silently inherited a WON group 1
// from the "opened its chest" test that runs immediately before it, so its
// journey map (and #cannonFab) never rendered. A factory sidesteps this
// entirely since each call builds brand-new nested objects.
function cannonHunt() {
  return {
    activeHuntId: 'h1',
    session: { status: 'active' },
    config: {
      cannon: { enabled: true, damagePercent: 10 },
      cannons: { c1: { id: 'c1', name: 'Meriam A', password: 'QQQQQ', gameType: 'lembaran_kerja', gameDataRaw: '{"questions":[{"answer":"9","image":""}]}' } }
    },
    progress: {
      1: { currentIndex: 0, status: 'idle', keys: [], totalScore: 0, completedStations: {}, ammo: 1 },
      2: { currentIndex: 0, status: 'idle', keys: [], totalScore: 0, completedStations: {}, hp: 90 },
      3: { currentIndex: 3, status: 'won', keys: [1, 2, 3], totalScore: 300, finalScore: 350, completedStations: {} }
    }
  };
}

test('the cannon panel lists other groups with HP and hides your own', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();

  await expect(page.locator('#cannonPanel')).toBeVisible();
  await expect(page.locator('#cannonAmmo')).toContainText('1');
  await expect(page.locator('.cannon-target')).toHaveCount(2);
  await expect(page.locator('.cannon-target[data-gid="1"]')).toHaveCount(0);
  await expect(page.locator('.cannon-target[data-gid="2"] .cannon-target-hp-text')).toHaveText('90%');
  await expect(page.locator('.cannon-target[data-gid="2"] button')).toBeEnabled();
  await expect(page.locator('.cannon-target[data-gid="3"]')).toContainText('sudah buka peti');
  await expect(page.locator('.cannon-target[data-gid="3"] button')).toHaveCount(0);
});

test('with no cannonballs the targets are shown but not firable', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1].ammo = 0;
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await expect(page.locator('#cannonPanel')).toContainText('Cari QR meriam');
  await expect(page.locator('.cannon-target[data-gid="2"] button')).toBeDisabled();
});

test('the cannon icon is absent when the teacher did not enable cannons', async ({ page }) => {
  await openApp(page, seedHunt({ activeHuntId: 'h1', session: { status: 'active' } }));
  await loginAsGroup(page, 1);
  await expect(page.locator('#cannonFab')).toBeHidden();
});

test('a group that opened its chest cannot fire either', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1] = {
    currentIndex: 3, status: 'won', keys: [1, 2, 3], totalScore: 300, finalScore: 350, ammo: 2, completedStations: {}
  };
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await expect(page.locator('#cannonFab')).toBeHidden();
});

test('offline, firing is blocked but scanning stays available', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  // browserOnline is a script-scope `let` in index.html, not a window property
  // (see the comment on the "finishing a station" test above for why bare
  // assignment inside page.evaluate is what actually reaches it). The brief's
  // original draft set window.browserOnline, which isOffline() never reads.
  await page.evaluate(() => { browserOnline = false; updateConnectivityBadge(); });
  await page.locator('#cannonFab').click();
  await expect(page.locator('.cannon-target[data-gid="2"] button')).toBeDisabled();
  await expect(page.locator('#cannonScanBtn')).toBeEnabled();
  await expect(page.locator('#cannonPanel')).toContainText('Perlu internet untuk menembak');
});

test('the offline hint does not duplicate across repeated renders', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.evaluate(() => { browserOnline = false; updateConnectivityBadge(); });
  const fab = page.locator('#cannonFab');
  const closeBtn = page.getByRole('button', { name: 'Tutup panel meriam' });

  // A double-tapped fab (children do this constantly) calls openCannonPanel
  // — and therefore renderCannonPanel — twice while the panel is already
  // open, offline both times.
  await fab.click();
  await fab.click();
  await expect(page.locator('#cannonOfflineHint')).toHaveCount(1);

  // Closing and reopening re-renders again, still offline.
  await closeBtn.click();
  await fab.click();
  await expect(page.locator('#cannonOfflineHint')).toHaveCount(1);

  // Coming back online and re-rendering must remove the hint entirely, not
  // just the first of several stacked copies (getElementById would only
  // find one even if duplicates existed).
  await page.evaluate(() => { browserOnline = true; updateConnectivityBadge(); renderCannonPanel(); });
  await expect(page.locator('#cannonOfflineHint')).toHaveCount(0);
});
