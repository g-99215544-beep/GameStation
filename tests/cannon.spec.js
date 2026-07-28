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

test('a perfect cannon answer awards one cannonball and no marks', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await page.evaluate(() => redeemCannonPassword('QQQQQ'));

  await expect(page.locator('#view-game')).toHaveClass(/active/);
  await page.locator('#worksheetAnswer').fill('9');
  await page.getByRole('button', { name: 'Semak Jawapan' }).click();

  await expect(page.locator('#cannonMsg')).toContainText('peluru');
  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.ammo).toBe(2);              // seeded with 1
  expect(saved.claimed.c1).toBeGreaterThan(0);
  expect(saved.totalScore).toBe(0);
  expect(saved.currentIndex).toBe(0);
  expect(saved.keys || []).toEqual([]);
});

test('an imperfect cannon answer awards nothing and allows a retry', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await page.evaluate(() => redeemCannonPassword('QQQQQ'));
  await expect(page.locator('#view-game')).toHaveClass(/active/);

  // Lembaran Kerja refuses to advance past a wrong answer, so a partial result
  // can only arrive from a type that scores a percentage — drive the shared
  // completion path directly with the score such a game would report.
  await page.evaluate(() => {
    window.gameState = { type: 'sudoku', correct: 3, total: 5 };
    submitCompletion(true, 60, 40);
  });

  await expect(page.locator('#cannonMsg')).toContainText('cuba lagi');
  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.ammo).toBe(1);              // unchanged
  expect(saved.claimed).toBeUndefined();
  expect(saved.totalScore).toBe(0);        // a cannon question never adds marks
  expect(saved.currentIndex).toBe(0);
});

// Fills every blank input of the Sudoku stage currently on screen with that
// stage's fixed solution, using real Playwright .fill() calls against the
// live DOM (not a page.evaluate value assignment), so the click on "Semak
// Stage N" that follows is checking genuine user-entered input.
async function fillSudokuStage(page) {
  const cells = await page.evaluate(() => {
    const sudoku = gameState.sudoku;
    const stage = sudoku.stages[sudoku.stageIndex];
    const list = [];
    stage.puzzle.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell) list.push({ id: `sudoku_${sudoku.stageIndex}_${r}_${c}`, value: String(stage.solution[r][c]) });
    }));
    return list;
  });
  for (const { id, value } of cells) {
    await page.locator(`#${id}`).fill(value);
  }
}

test('a cannon question of a type that bypasses finishGame never advances the journey', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.config.cannons.c1.gameType = 'sudoku';
  seed.gamestation2026.hunts.h1.config.cannons.c1.gameDataRaw = '{}';
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await page.evaluate(() => redeemCannonPassword('QQQQQ'));
  await expect(page.locator('#view-game')).toHaveClass(/active/);

  // Play all three Sudoku stages to a real finish — filling every blank cell
  // with the puzzle's fixed solution and pressing the actual "Semak Stage N"
  // / "Teruskan ke Stage N" buttons a student would press — so it is
  // finishSudoku() itself (which calls submitCompletion directly, never
  // through finishGame) that reaches the hook, not a simulated call.
  for (let stage = 1; stage <= 3; stage++) {
    await fillSudokuStage(page);
    await page.getByRole('button', { name: `Semak Stage ${stage}` }).click();
    if (stage < 3) {
      await page.getByRole('button', { name: `Teruskan ke Stage ${stage + 1}` }).click();
    }
  }

  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.ammo).toBe(2);
  expect(saved.claimed.c1).toBeGreaterThan(0);
  expect(saved.currentIndex).toBe(0);
  expect(saved.totalScore).toBe(0);
  expect(saved.keys || []).toEqual([]);
  expect(saved.completedStations).toEqual({});
});

test('rescanning a redeemed cannon says so and does not award again', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1].claimed = { c1: 111 };
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await page.evaluate(() => redeemCannonPassword('QQQQQ'));

  await expect(page.locator('#cannonMsg')).toContainText('sudah anda ambil');
  await expect(page.locator('#view-game')).not.toHaveClass(/active/);
});

test('an unknown password is rejected', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await page.evaluate(() => redeemCannonPassword('ZZZZZ'));
  await expect(page.locator('#cannonMsg')).toContainText('bukan QR meriam');
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

// OfflineStore.enqueueWrite de-dupes the pending-write queue by path, and a
// cannon award and a station completion both write to the same progress/<gid>
// path. queueProgressMerge exists specifically so neither one silently
// clobbers the other while queued — these two tests drive that scenario in
// both possible orderings, since de-duplication-by-path is order-sensitive.
test('offline: a cannon award queued before a station completion at the same path are both flushed', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.evaluate(() => { browserOnline = false; updateConnectivityBadge(); });

  // Cannon award queued first.
  await page.locator('#cannonFab').click();
  await page.evaluate(() => redeemCannonPassword('QQQQQ'));
  await page.locator('#worksheetAnswer').fill('9');
  await page.getByRole('button', { name: 'Semak Jawapan' }).click();

  // Station completion queued second, same progress/<gid> path.
  await page.evaluate(() => {
    window._curStId = 1;
    gameState = { type: 'quiz', correct: 1, total: 1 };
    submitCompletion(true, 100, 5);
  });

  // Still offline: exactly one queued write for this path, not two — proof
  // the second enqueue merged onto the first instead of replacing it.
  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem(OfflineStore.PENDING_KEY)));
  expect(queued).toHaveLength(1);

  await page.evaluate(() => { browserOnline = true; updateConnectivityBadge(); return flushPendingWrites(); });

  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.ammo).toBe(2);
  expect(saved.claimed.c1).toBeGreaterThan(0);
  expect(saved.currentIndex).toBe(1);
  expect(saved.totalScore).toBe(100);
});

// Task 10: firing a cannonball. cannonHunt() (defined above) seeds group 1
// with 1 ammo and group 2 at hp:90, damagePercent:10 — matches the brief's
// CANNON_HUNT fixture, which does not exist in this file; cannonHunt() is
// this file's established equivalent (see its own comment for why it must
// stay a factory).
test('firing spends a cannonball and damages the target', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await page.locator('.cannon-target[data-gid="2"] button').click();

  await expect(page.locator('#cannonVideo')).toBeVisible();
  await page.locator('#cannonVideoSkip').click();

  const db = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db[1].ammo).toBe(0);
  expect(db[2].hp).toBe(80);                     // seeded at 90, damage 10
  const inbox = Object.values(db[2].incoming);
  expect(inbox).toHaveLength(1);
  expect(inbox[0].from).toBe('1');
  expect(inbox[0].damage).toBe(10);
  expect(inbox[0].hpAfter).toBe(80);
});

test('damage never pushes a target below the 50% floor', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1].ammo = 3;
  seed.gamestation2026.hunts.h1.progress[2].hp = 55;
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();

  for (let shot = 0; shot < 3; shot++) {
    await page.locator('.cannon-target[data-gid="2"] button').click();
    await page.locator('#cannonVideoSkip').click();
  }
  const db = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db[2].hp).toBe(50);
  expect(db[1].ammo).toBe(0);
});

test('firing without a cannonball is impossible', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1].ammo = 0;
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await expect(page.locator('.cannon-target[data-gid="2"] button')).toBeDisabled();
  await page.evaluate(() => fireCannonAt('2'));
  const db = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db[2].hp).toBe(90);
  expect(db[2].incoming).toBeUndefined();
});

test('a won shooter cannot fire and a won target cannot be shot', async ({ page }) => {
  // Group 3 is already 'won' in cannonHunt(); firing at it directly (bypassing
  // the UI, which already hides its button per the earlier panel-listing test)
  // must still be refused by fireCannonAt itself.
  const seed = seedHunt(cannonHunt());
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await page.evaluate(() => fireCannonAt('3'));
  let db = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db[1].ammo).toBe(1);          // unspent
  expect(db[3].incoming).toBeUndefined();

  // Now the shooter itself has already won — even a valid target must be refused.
  await page.evaluate(() => { progress = { ...progress, status: 'won' }; });
  await page.evaluate(() => fireCannonAt('2'));
  db = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db[1].ammo).toBe(1);          // still unspent
  expect(db[2].incoming).toBeUndefined();
});

test('a failed hit transaction refunds the spent ammo', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();

  // Force the victim's damage transaction to abort (as if two shots collided
  // and Firebase rejected this one) so fireCannonAt's catch block has to run
  // its refund path. Only the victim's own progress node is patched — the ammo
  // ref keeps using the real fake-firebase transaction so the refund is
  // genuine. The transaction runs on /progress/2 rather than /progress/2/hp
  // because it also has to see `status` to abort on a group that already
  // opened its chest.
  await page.evaluate(() => {
    const realRef = db.ref.bind(db);
    db.ref = path => {
      const target = realRef(path);
      if (String(path).endsWith('/progress/2')) {
        return Object.assign({}, target, {
          transaction: () => Promise.resolve({ committed: false, snapshot: { val: () => null } })
        });
      }
      return target;
    };
  });

  await page.locator('.cannon-target[data-gid="2"] button').click();
  await expect(page.locator('#cannonMsg')).toContainText('dipulangkan');

  const db2 = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db2[1].ammo).toBe(1);         // refunded back to the seeded 1
  expect(db2[2].hp).toBe(90);          // untouched — the seeded value
  expect(db2[2].incoming).toBeUndefined();
  // The video overlay must never appear on a failed shot.
  await expect(page.locator('#cannonVideo')).toBeHidden();
});

// Review follow-up: the fake-firebase transaction() in tests/helpers/fake-firebase.js
// reads and writes synchronously with no await inside (see its own source) — so two
// transaction() calls issued together against the *same* ref, without awaiting
// between them, run strictly sequentially with no interleaving: exactly the
// atomicity guarantee fireCannonAt's hp write depends on. A naive
// `.once('value').then(v => ref.set(...))` reimplementation has a microtask
// boundary between its read and its write, so two calls issued together would
// both read the pre-damage value and the second write would clobber the
// first — one hit silently lost. This test exercises the same ref+transaction
// call fireCannonAt's damage step makes (huntRef('progress/<gid>').transaction(...)
// — the whole node, because the updater must also see `status` to abort on a
// group that already opened its chest), issued twice without awaiting between
// them, standing in for two different
// groups' shots landing on the same victim at once — something a single
// logged-in page (and this fake Firebase's per-page __db) cannot represent by
// driving two independent shooters through the real UI.
test('two damage transactions issued together against the same target both land', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);

  const result = await page.evaluate(async () => {
    const nodeRef = huntRef('progress/2');    // group 2 seeded at hp:90
    const damage = CannonEngine.clampDamage(cannonConfig.damagePercent); // 10
    // Byte-for-byte the updater fireCannonAt uses, so this test moves with it.
    const applyShot = current => {
      if (current && current.status === 'won') return undefined;
      return { ...(current || {}), hp: CannonEngine.applyDamage(current && current.hp, damage) };
    };
    const [a, b] = await Promise.all([
      nodeRef.transaction(applyShot),
      nodeRef.transaction(applyShot)
    ]);
    return { aCommitted: a.committed, bCommitted: b.committed };
  });
  expect(result.aCommitted).toBe(true);
  expect(result.bCommitted).toBe(true);

  // Both damage steps landed: 90 -> 80 -> 70. A read-then-write with a
  // microtask gap between read and write would leave this at 80 (one hit lost).
  const hp = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[2].hp);
  expect(hp).toBe(70);
});

// Review follow-up, item 1: without a firing-state guard, a double-tapped fire
// button starts two overlapping fireCannonAt() calls before the first one's
// ammo transaction resolves. Both could pass the ammo check (the transaction
// only protects the *count*, not the *firing state*), and since the video
// overlay's resolver (cannonVideoDone) is a single module-level variable, the
// second call's playCannonVideo() would silently strand the first call's
// await forever — that shot's success message and re-render never happen even
// though its Firebase writes already landed. This calls fireCannonAt('2')
// twice in the same synchronous tick (bypassing Playwright's own
// click-actionability wait, which would otherwise serialize two real
// .click() calls once the button renders disabled) to reproduce the race
// exactly as a double-tap would create it.
test('a double-tap does not fire twice and does not hang the first shot', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1].ammo = 2;   // enough for two shots if the guard failed
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();

  const bothDone = page.evaluate(() =>
    Promise.all([fireCannonAt('2'), fireCannonAt('2')]).then(() => true)
  );

  // The one call that actually fires has to reach and clear its video before
  // it can resolve; skip it so bothDone can settle.
  await expect(page.locator('#cannonVideo')).toBeVisible();
  await page.locator('#cannonVideoSkip').click();

  // Neither call hangs — Promise.all resolves. (Without the in-flight guard,
  // the second call's playCannonVideo() would overwrite cannonVideoDone and
  // this await would exceed the test timeout.)
  expect(await bothDone).toBe(true);

  const db = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db[1].ammo).toBe(1);      // only one shot actually fired, from the seeded 2
  expect(db[2].hp).toBe(80);       // only one damage step landed
  expect(Object.values(db[2].incoming || {})).toHaveLength(1);
});

test('offline: a station completion queued before a cannon award at the same path are both flushed', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.evaluate(() => { browserOnline = false; updateConnectivityBadge(); });

  // Station completion queued first. This drives submitCompletion's own
  // showResult(), which hides the journey map (and #cannonFab with it), so
  // the cannon redemption below calls redeemCannonPassword directly rather
  // than clicking a fab that is no longer visible — the fab click is a
  // convenience in the other tests, not something redeemCannonPassword needs.
  await page.evaluate(() => {
    window._curStId = 1;
    gameState = { type: 'quiz', correct: 1, total: 1 };
    submitCompletion(true, 100, 5);
  });

  // Cannon award queued second, same progress/<gid> path.
  await page.evaluate(() => redeemCannonPassword('QQQQQ'));
  await page.locator('#worksheetAnswer').fill('9');
  await page.getByRole('button', { name: 'Semak Jawapan' }).click();

  const queued = await page.evaluate(() => JSON.parse(localStorage.getItem(OfflineStore.PENDING_KEY)));
  expect(queued).toHaveLength(1);

  await page.evaluate(() => { browserOnline = true; updateConnectivityBadge(); return flushPendingWrites(); });

  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.ammo).toBe(2);
  expect(saved.claimed.c1).toBeGreaterThan(0);
  expect(saved.currentIndex).toBe(1);
  expect(saved.totalScore).toBe(100);
});

// Task 11: receiving a hit. cannonHunt() (defined above) is this file's
// established equivalent of the brief's CANNON_HUNT fixture — see its own
// comment for why it must stay a factory rather than a shared constant.
test('a hit waiting in the inbox prompts, plays, then clears', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1].hp = 80;
  seed.gamestation2026.hunts.h1.progress[1].incoming = {
    k9: { from: '2', ts: 500, damage: 10, hpAfter: 80 }
  };
  await openApp(page, seed);
  await loginAsGroup(page, 1);

  await expect(page.locator('#cannonHitPrompt')).toBeVisible();
  await expect(page.locator('#cannonHitFrom')).toContainText('Kumpulan 2');
  await page.getByRole('button', { name: 'Ketuk untuk lihat' }).click();

  await expect(page.locator('#cannonVideo')).toBeVisible();
  await expect(page.locator('#cannonVideoCaption')).toContainText('80%');

  // Load-bearing assertion: the record must still be in Firebase while the
  // video is up and unskipped — proving the delete genuinely waits for
  // playback to finish, not just that it eventually happens. An
  // implementation that acknowledged the hit before playing the video would
  // reach the same end state and pass without this check.
  const midPlay = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(midPlay.incoming).toBeDefined();
  expect(midPlay.incoming.k9).toBeTruthy();

  await page.locator('#cannonVideoSkip').click();

  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.incoming).toBeUndefined();
  await expect(page.locator('#journeyShipHpText')).toHaveText('80%');
});

test('several waiting hits collapse into one video', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1].hp = 70;
  seed.gamestation2026.hunts.h1.progress[1].incoming = {
    k1: { from: '2', ts: 500, damage: 10, hpAfter: 80 },
    k2: { from: '3', ts: 600, damage: 10, hpAfter: 70 }
  };
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await expect(page.locator('#cannonHitPrompt')).toContainText('2 kali');
  await page.getByRole('button', { name: 'Ketuk untuk lihat' }).click();
  await expect(page.locator('#cannonVideoCaption')).toContainText('70%');

  // Same load-bearing check as the single-hit test: both records are still
  // present while the combined video is up, unskipped.
  const midPlay = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(midPlay.incoming).toBeDefined();
  expect(Object.keys(midPlay.incoming).sort()).toEqual(['k1', 'k2']);

  await page.locator('#cannonVideoSkip').click();
  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.incoming).toBeUndefined();
});

test('a hit landing during a station game waits until the game ends', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  // Reach the station-1 clue screen the way a student would: tap the island
  // marker on the journey map (playStationJourney animates the ship there),
  // then submit the password to enter the game itself.
  await page.locator('[aria-label="Pergi ke Pulau 1"]').click();
  await expect(page.locator('#view-clue')).toHaveClass(/active/, { timeout: 6000 });
  await page.locator('#passInput').fill('PASS1');
  await page.getByRole('button', { name: 'Sahkan Password' }).click();
  await expect(page.locator('#view-game')).toHaveClass(/active/);

  // The fake Firebase's notify() re-fires every registered listener on any
  // write anywhere in the store (unlike real Firebase, which only refires a
  // listener when its own ref's value changes) — see tests/helpers/fake-firebase.js.
  // watchActiveHunt()'s long-lived listener on activeHuntId is one such
  // listener; refiring it re-enters tryRestoreSession() -> loadGroupProgress()
  // -> showJourneyMap(), which flips the (still-mounted, fixed, full-viewport)
  // #journeyMap section back to visible behind the still-active #view-game and
  // silently eats every subsequent click. That cascade is a fake-firebase
  // over-notification artifact, not something a real Firebase connection would
  // ever trigger from an unrelated progress/<gid>/incoming write, so it is
  // switched off here rather than in index.html.
  await page.evaluate(() => { if (activeHuntWatcherRef) activeHuntWatcherRef.off('value'); });

  await page.evaluate(() => {
    window.__db.gamestation2026.hunts.h1.progress[1].hp = 90;
    huntRef('progress/1/incoming').push({ from: '2', ts: 700, damage: 10, hpAfter: 90 });
  });
  await expect(page.locator('#cannonHitPrompt')).toBeHidden();

  await page.locator('#worksheetAnswer').fill('1');
  await page.getByRole('button', { name: 'Semak Jawapan' }).click();
  await expect(page.locator('#cannonHitPrompt')).toBeVisible();
});

test('unwatched hits are discarded once the chest is opened', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1] = {
    currentIndex: 3, status: 'won', keys: [1, 2, 3], totalScore: 300,
    finalScore: 260, hp: 70, completedStations: {},
    incoming: { k1: { from: '2', ts: 500, damage: 10, hpAfter: 70 } }
  };
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await expect(page.locator('#cannonHitPrompt')).toBeHidden();
  await expect.poll(async () =>
    page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1].incoming)
  ).toBeUndefined();
});

// Review follow-up (finding 1): showGoToBoard()'s listener only reads its
// snapshot into a local `const p`, never into the global `progress`. Since
// maybeShowHitPrompt() gates on CannonEngine.isInBattle(progress) — the
// global — a chest opened live (by the Smart Board) while the group is
// sitting on the chest screen used to never flip that global to 'won', so a
// hit already waiting there would play its video over the celebration
// instead of being discarded. Unlike the already-won-at-load test above,
// this drives the transition live: the group is not yet won when the hit
// lands (still genuinely "in battle", so the prompt legitimately appears —
// that part is correct, pre-existing behaviour), and only then is the chest
// opened, the way openChestOnBoard() would (a plain progress/<gid> update to
// status:'won').
test('a chest opened live while a hit is waiting discards it without playing', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1] = {
    currentIndex: 3, status: 'idle', keys: [1, 2, 3], totalScore: 300, hp: 70, completedStations: {}
  };
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await expect(page.locator('#view-chest')).toHaveClass(/active/);

  await page.evaluate(() => {
    huntRef('progress/1/incoming').push({ from: '2', ts: 500, damage: 10, hpAfter: 70 });
  });
  await expect(page.locator('#cannonHitPrompt')).toBeVisible();

  // The Smart Board opens the chest while the prompt is still up, unwatched.
  await page.evaluate(() => {
    huntRef('progress/1').update({ status: 'won', finalScore: 260, finishBonus: 50, finishOrder: 1 });
  });

  // The hit must never play over the celebration: the prompt is dismissed
  // (not left dangling open) and the inbox is cleared, exactly as an
  // already-won-at-load hit is discarded.
  await expect(page.locator('#cannonHitPrompt')).toBeHidden();
  await expect(page.locator('#cannonVideo')).toBeHidden();
  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[1]);
  expect(saved.incoming).toBeUndefined();
});

// Review follow-up (finding 2): finishCannonQuestion() is a second "the game
// just ended" route — a cannon ammo question runs inside #view-game with a
// live timer, exactly like a station, so hitSafeToShow() correctly holds a
// hit while it's live. But unlike showResult(), it used to return without
// ever calling maybeShowHitPrompt(), so a hit landing mid-question stayed
// hidden (and the HP bar stayed stale) until some unrelated event happened
// to re-trigger the listener.
// Final review, important 3: openCannonPanel() attaches its progress listener
// only when online, and nothing ever attached it later. A group that opened the
// panel while offline — the documented, expected case, since the Scan button is
// meant to stay live while they walk the school grounds hunting a cannon QR —
// was left with a dead panel after signal returned: the offline hint still up,
// every fire button disabled, and every target at 100% because `allProgress`
// had never been populated. Nothing on screen told them to close and reopen.
test('the cannon panel becomes usable when the network returns while it is open', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.evaluate(() => { browserOnline = false; updateConnectivityBadge(); });
  await page.locator('#cannonFab').click();

  await expect(page.locator('#cannonOfflineHint')).toHaveCount(1);
  await expect(page.locator('.cannon-target[data-gid="2"] button')).toBeDisabled();
  // No listener ran, so every target renders at the readHp() default.
  await expect(page.locator('.cannon-target[data-gid="2"] .cannon-target-hp-text')).toHaveText('100%');

  // Signal returns. The panel is never closed and reopened.
  await page.evaluate(() => { browserOnline = true; updateConnectivityBadge(); });

  await expect(page.locator('#cannonOfflineHint')).toHaveCount(0);
  await expect(page.locator('.cannon-target[data-gid="2"] button')).toBeEnabled();
  // Real HP now, proving the listener attached and populated allProgress —
  // and group 3's won state is visible again, so it can no longer be shot.
  await expect(page.locator('.cannon-target[data-gid="2"] .cannon-target-hp-text')).toHaveText('90%');
  await expect(page.locator('.cannon-target[data-gid="3"]')).toContainText('sudah buka peti');

  // And the shot actually lands.
  await page.locator('.cannon-target[data-gid="2"] button').click();
  await expect(page.locator('#cannonVideo')).toBeVisible();
  await page.locator('#cannonVideoSkip').click();
  const db = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db[2].hp).toBe(80);
  expect(db[1].ammo).toBe(0);
});

// Final review, critical 1: isOffline() reports *online* until Firebase has
// connected at least once, so on school WiFi with a dead uplink fireCannonAt
// passes its offline guard and awaits a Firebase write that Firebase simply
// queues — a promise that never settles. Nothing after it ever ran, including
// the `finally` that clears cannonShotInFlight, so every later shot returned at
// the in-flight guard and every 🔥 rendered disabled: the cannon was dead on
// that phone until the page was reloaded, even after the network came back.
// Same technique as the abort test above, with a promise that never settles.
test('a Firebase write that never settles releases the fire button instead of killing it', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();

  await page.evaluate(() => {
    window.__realRef = db.ref.bind(db);
    db.ref = path => {
      const target = window.__realRef(path);
      if (String(path).endsWith('/progress/1/ammo')) {
        return Object.assign({}, target, { transaction: () => new Promise(() => {}) });
      }
      return target;
    };
  });

  await page.locator('.cannon-target[data-gid="2"] button').click();
  // The timeout is ~6s of real time, so this deliberately outwaits the default.
  await expect(page.locator('#cannonMsg')).toContainText('cuba lagi', { timeout: 15000 });

  // The button is alive again — this is the whole point: the finally ran.
  await expect(page.locator('.cannon-target[data-gid="2"] button')).toBeEnabled();
  let db = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db[2].hp).toBe(90);                 // nothing landed
  expect(db[2].incoming).toBeUndefined();

  // Network behaves again: the very next tap must fire for real, with no reload.
  await page.evaluate(() => { db.ref = window.__realRef; });
  await page.locator('.cannon-target[data-gid="2"] button').click();
  await expect(page.locator('#cannonVideo')).toBeVisible();
  await page.locator('#cannonVideoSkip').click();
  db = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db[2].hp).toBe(80);
  expect(db[1].ammo).toBe(0);
});

// Final review, critical 2: showGoToBoard() attaches a listener on
// progress/<gid> and used to assign the whole snapshot into the global
// `progress`. logout() detached only the hunt root, which never touches a
// listener registered on a child path, and never reset the global — so after
// group 3 finished and logged out, the next group logging in on that phone
// inherited group 3's journey and wrote it back under their own id. Silent
// cross-group marks corruption, invisible until the Smart Board.
test('logging out detaches the chest-screen listener so the next group is not corrupted', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));   // group 3 is seeded 'won' with currentIndex 3
  await loginAsGroup(page, 3);
  await expect(page.locator('#view-chest')).toHaveClass(/active/);

  await page.evaluate(() => logout());
  await expect(page.locator('#view-login')).toHaveClass(/active/);
  await loginAsGroup(page, 2);

  // Any write under group 3's progress fires a listener that should be gone.
  await page.evaluate(() => huntRef('progress/3').update({ totalScore: 300 }));
  const leaked = await page.evaluate(() => ({ index: progress.currentIndex, score: progress.totalScore, gid: currentGroupId }));
  expect(leaked.gid).toBe('2');
  expect(leaked.index).toBe(0);
  expect(leaked.score).toBe(0);

  // The damage this actually causes: group 2's next completion writes group
  // 3's journey into progress/2.
  await page.evaluate(() => {
    window._curStId = 1;
    gameState = { type: 'quiz', correct: 1, total: 1 };
    submitCompletion(true, 100, 5);
  });
  const saved = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress[2]);
  expect(saved.totalScore).toBe(100);
  expect(saved.currentIndex).toBe(1);
  expect(saved.status).not.toBe('won');
});

// Final review, critical 2 (second part): the chest screen needs the live
// status flip and the live HP, and nothing else. Assigning the whole snapshot
// also replaced a local `progress` that can be *ahead* of the server (queued
// offline completions) with the server's older copy — which watchPendingHit()
// then persists to the local cache, so a reload restarts the journey.
test('the chest-screen listener refreshes only status and hp, never the whole journey', async ({ page }) => {
  const seed = seedHunt(cannonHunt());
  seed.gamestation2026.hunts.h1.progress[1] = {
    currentIndex: 3, status: 'idle', keys: [1, 2, 3], totalScore: 300, hp: 70, completedStations: {}
  };
  await openApp(page, seed);
  await loginAsGroup(page, 1);
  await expect(page.locator('#view-chest')).toHaveClass(/active/);

  // Same fake-firebase over-notification artifact the two tests above work
  // around: notify() re-fires every listener on any write, so the unrelated
  // progress/1 update below would re-enter watchActiveHunt() ->
  // tryRestoreSession() -> loadGroupProgress(), whose `progress = p` would
  // overwrite the local copy this test exists to protect. A real Firebase
  // connection never fires the active-hunt listener for a progress write.
  await page.evaluate(() => { if (activeHuntWatcherRef) activeHuntWatcherRef.off('value'); });

  // A local copy that is ahead of the server, as queued offline completions leave it.
  await page.evaluate(() => {
    progress = { ...progress, totalScore: 999, keys: [1, 2, 3, 4], completedStations: { 9: { score: 1 } } };
    huntRef('progress/1').update({ hp: 60, status: 'won', finalScore: 260 });
  });

  const live = await page.evaluate(() => ({
    score: progress.totalScore, keys: (progress.keys || []).length,
    stations: Object.keys(progress.completedStations || {}).length,
    hp: progress.hp, status: progress.status
  }));
  expect(live.score).toBe(999);        // the local journey survives
  expect(live.keys).toBe(4);
  expect(live.stations).toBe(1);
  expect(live.hp).toBe(60);            // but status and hp are live
  expect(live.status).toBe('won');
});

// Final review, important 4: validateWorksheetStations rejects an oversized
// worksheet payload, but validateCannons never did. pushConfig issues all seven
// writes in one Promise.all, so stations, groups and progress commit while
// config/cannons is rejected by the database rules: the teacher sees a raw
// Firebase error, the hunt looks saved, and the cannons are silently absent.
test('an oversized cannon worksheet is refused before anything is written', async ({ page }) => {
  await openApp(page, seedHunt());
  await openHuntSetup(page);
  await page.locator('#cannonEnabled').check();
  await page.getByRole('button', { name: '＋ Tambah Meriam' }).click();
  await page.locator('#worksheet_editor_c1 .worksheet-answer').first().fill('42');

  // A pasted photo far past the limit. The hidden input is exactly where
  // setWorksheetImageValue() puts a real paste, so getWorksheetQuestionsFromEditor
  // collects it the same way.
  await page.evaluate(() => {
    document.querySelector('#worksheet_editor_c1 .worksheet-image-data').value =
      'data:image/jpeg;base64,' + 'A'.repeat(WORKSHEET_DATA_MAX_CHARS);
  });

  const dialogMessage = new Promise(resolve => {
    page.once('dialog', dialog => { resolve(dialog.message()); dialog.dismiss(); });
  });
  await page.getByRole('button', { name: 'Simpan Treasure Hunt' }).first().click();
  const message = await dialogMessage;
  expect(message).toContain('Meriam c1');
  expect(message).toContain('terlalu besar');

  // Nothing was written: the seven-write Promise.all never started.
  const config = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.config);
  expect(config.cannons).toBeUndefined();
  expect(config.cannon).toBeUndefined();
});

// Final review, important 5: the design spec's firing step says to abort if the
// victim's status is already 'won', but the hp transaction ran on
// progress/<victim>/hp, which cannot see status — the only check was the
// shooter's cached allProgress. A shot fired in the window before the shooter's
// listener sees the flip used to land anyway: ammo spent, HP reduced, incoming
// pushed, on a group whose finalScore is already frozen. The Smart Board then
// shows a won card with a reduced HP bar beside a finalScore that ignores it.
test('a target that opened its chest mid-shot aborts the transaction and keeps the ammo', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await expect(page.locator('.cannon-target[data-gid="2"] button')).toBeEnabled();

  // The shooter's cached view must still say group 2 is in battle — that stale
  // window, between the Smart Board opening the chest and this phone hearing
  // about it, is the whole point of moving the abort into the transaction.
  //
  // The deep copy is essential and not incidental: the fake shim's
  // snapshot.val() hands back the live store object rather than a clone (see
  // tests/helpers/fake-firebase.js), so `allProgress` is an *alias* of __db.
  // Without the copy, flipping the store below also flips the cached view, and
  // fireCannonAt bails at its pre-flight guard having never reached the
  // transaction — the test would then pass just as happily against code with
  // no transaction-level abort at all.
  await page.evaluate(() => {
    if (cannonProgressRef) cannonProgressRef.off('value');
    allProgress = JSON.parse(JSON.stringify(allProgress));
    window.__db.gamestation2026.hunts.h1.progress[2].status = 'won';
    window.__db.gamestation2026.hunts.h1.progress[2].finalScore = 270;
  });

  await page.evaluate(() => fireCannonAt('2'));
  // Reaches the transaction, which aborts, refunds, and names the real reason.
  await expect(page.locator('#cannonMsg')).toContainText('sudah buka peti');
  await expect(page.locator('#cannonMsg')).toContainText('dipulangkan');
  await expect(page.locator('#cannonVideo')).toBeHidden();

  const db = await page.evaluate(() => window.__db.gamestation2026.hunts.h1.progress);
  expect(db[2].hp).toBe(90);                 // untouched
  expect(db[2].incoming).toBeUndefined();
  expect(db[2].finalScore).toBe(270);        // their frozen marks still add up
  expect(db[1].ammo).toBe(1);                // the cannonball is not wasted
});

test('a hit landing during a cannon question is flushed once the question ends', async ({ page }) => {
  await openApp(page, seedHunt(cannonHunt()));
  await loginAsGroup(page, 1);
  await page.locator('#cannonFab').click();
  await page.evaluate(() => redeemCannonPassword('QQQQQ'));
  await expect(page.locator('#view-game')).toHaveClass(/active/);

  // Same fake-firebase over-notification workaround as the station-game
  // test above: the simulated opponent shot below is a write to an unrelated
  // path, but the fake's notify() re-fires every listener regardless, and
  // watchActiveHunt()'s long-lived listener would otherwise re-enter
  // tryRestoreSession() -> showJourneyMap() and silently swallow the click
  // that follows. Not a production concern — see that test's own comment.
  await page.evaluate(() => { if (activeHuntWatcherRef) activeHuntWatcherRef.off('value'); });

  await page.evaluate(() => {
    window.__db.gamestation2026.hunts.h1.progress[1].hp = 90;
    huntRef('progress/1/incoming').push({ from: '2', ts: 700, damage: 10, hpAfter: 90 });
  });
  await expect(page.locator('#cannonHitPrompt')).toBeHidden();

  await page.locator('#worksheetAnswer').fill('9');
  await page.getByRole('button', { name: 'Semak Jawapan' }).click();
  await expect(page.locator('#cannonHitPrompt')).toBeVisible();
});
