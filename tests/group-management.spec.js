const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function seedPage(page, seed) {
  // Block the real Firebase CDN scripts so the injected mock below is authoritative.
  // Without this, when network is available the real SDK loads, overwrites the mock,
  // and db.ref().set() would hit the real production database.
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(data => {
    const store = structuredClone(data);
    const at = key => key.split('/').filter(Boolean).reduce((v, p) => v && v[p], store);
    const write = (key, value) => {
      const parts = key.split('/').filter(Boolean);
      const last = parts.pop();
      const parent = parts.reduce((v, p) => (v[p] ||= {}), store);
      parent[last] = structuredClone(value);
    };
    window.firebase = {
      apps: [], initializeApp() { this.apps.push({}); },
      database() { return { ref(key) { return {
        once: () => Promise.resolve({ val: () => structuredClone(at(key)) }),
        on: (_e, cb) => cb({ val: () => structuredClone(at(key)) }), off: () => {},
        set: value => { write(key, value); return Promise.resolve(); },
        update: value => { write(key, { ...at(key), ...value }); return Promise.resolve(); }
      }; } }; }
    };
  }, seed);
}

function baseSeed() {
  const stations = Object.fromEntries(Array.from({ length: 6 }, (_, i) =>
    [i + 1, { id: i + 1, name: `Stesen ${i + 1}`, location: 'x', password: '12345', gameType: 'quiz', gameDataRaw: '{}', timeLimitMin: 10 }]));
  const groups = {
    1: { id: 1, name: 'Kumpulan 1', startStation: 1, order: [1,2,3,4,5,6], loginPassword: '1001', members: ['Ali','Siti'] },
    2: { id: 2, name: 'Kumpulan 2', startStation: 2, order: [2,3,4,5,6,1], loginPassword: '1002', members: ['Abu'] }
  };
  return { gamestation2026: { config: { stations, groups }, session: { status: 'setup' }, progress: {} } };
}

async function openGroupTab(page) {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await expect(page.locator('#view-login')).toHaveClass(/active/);
  await page.evaluate(async () => {
    await loadConfigCache();
    sessionInfo = { status: 'setup' };
    show('view-admin');
    selectAdminTab('groups');
  });
}

test('step 1 asks only for the hunt name and the number of groups', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  await expect(page.locator('#group_num_groups')).toHaveValue('2');
  await expect(page.locator('#admin-panel-groups textarea')).toHaveCount(0);
  await expect(page.locator('#admin-panel-groups')).not.toContainText('Agih');
  await expect(page.locator('#admin-panel-groups')).not.toContainText('Ahli');
});

test('saving 9 groups creates groups 1-9 with unique 4-digit codes and fresh progress', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  await page.fill('#group_num_groups', '9');
  await page.evaluate(() => saveGroupManager());
  const saved = await page.evaluate(() =>
    db.ref('gamestation2026/config/groups').once('value').then(s => s.val()));
  expect(Object.keys(saved).sort((a, b) => a - b)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  const codes = Object.values(saved).map(g => g.loginPassword);
  codes.forEach(code => expect(code).toMatch(/^\d{4}$/));
  expect(new Set(codes).size).toBe(9);
  expect(saved['1'].loginPassword).toBe('1001');       // existing codes kept
  expect(saved['2'].loginPassword).toBe('1002');
  expect(saved['1'].members).toEqual(['Ali', 'Siti']); // an old roster is not thrown away
  const prog = await page.evaluate(() =>
    db.ref('gamestation2026/progress').once('value').then(s => s.val()));
  expect(Object.keys(prog)).toHaveLength(9);
  expect(prog['9']).toMatchObject({ currentIndex: 0, status: 'idle', totalScore: 0 });
});

test('an out-of-range group count is refused without writing', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  for (const value of ['0', '31', '']) {
    await page.fill('#group_num_groups', value);
    await page.evaluate(() => saveGroupManager());
    await expect(page.locator('#groupSaveMsg .msg.err')).toBeVisible();
  }
  const saved = await page.evaluate(() =>
    db.ref('gamestation2026/config/groups').once('value').then(s => s.val()));
  expect(Object.keys(saved)).toEqual(['1', '2']);
});

test('pushConfig preserves an existing roster (does not regenerate groups)', async ({ page }) => {
  await seedPage(page, baseSeed());
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(async () => {
    await loadConfigCache();
    sessionInfo = { status: 'setup' };
    show('view-admin');
    selectAdminTab('setup');
    pushConfig();
    await new Promise(r => setTimeout(r, 0));
  });
  const saved = await page.evaluate(() =>
    db.ref('gamestation2026/config/groups').once('value').then(s => s.val()));
  expect(Object.keys(saved)).toEqual(['1', '2']);          // still 2 groups, not 14
  expect(saved['1'].members).toEqual(['Ali', 'Siti']);     // roster preserved
});

async function openLogin(page, seed) {
  await seedPage(page, seed);
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await expect(page.locator('#view-login')).toHaveClass(/active/);
  await page.evaluate(async () => { await loadConfigCache(); });
}

test('the login screen asks only for a code and works out the group from it', async ({ page }) => {
  await openLogin(page, baseSeed());
  await expect(page.locator('#view-login select')).toHaveCount(0);
  await page.fill('#groupLoginPass', '1002');
  await page.click('#view-login button.big');
  await expect.poll(() => page.evaluate(() => currentGroupId)).toBe('2');
  await expect(page.locator('#topTitle')).toHaveText('Kumpulan 2');
});

test('a wrong code is rejected and logs no one in', async ({ page }) => {
  await openLogin(page, baseSeed());
  await page.fill('#groupLoginPass', '9999');
  await page.click('#view-login button.big');
  await expect(page.locator('#groupLoginMsg')).toContainText('Kod kumpulan salah');
  expect(await page.evaluate(() => currentGroupId)).toBeFalsy();
});

test('a code shared by two groups (old data) is refused instead of guessing', async ({ page }) => {
  const seed = baseSeed();
  seed.gamestation2026.config.groups['2'].loginPassword = '1001';
  await openLogin(page, seed);
  await page.fill('#groupLoginPass', '1001');
  await page.click('#view-login button.big');
  await expect(page.locator('#groupLoginMsg')).toContainText('lebih daripada satu kumpulan');
  expect(await page.evaluate(() => currentGroupId)).toBeFalsy();
});

test('step 3 refuses to save two groups with the same code', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  await page.evaluate(() => selectAdminTab('passwords'));
  await page.fill('#login_password_2', '1001');
  const message = new Promise(resolve => page.once('dialog', dialog => { resolve(dialog.message()); dialog.dismiss(); }));
  await page.evaluate(() => saveLoginPasswords());
  expect(await message).toContain('unik');
});
