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

test('group tab renders existing groups and members', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  await expect(page.locator('#groupCards .group-card')).toHaveCount(2);
  await expect(page.locator('#groupCards .group-card').first()).toContainText('Ali');
  await expect(page.locator('#groupCards .group-card').first()).toContainText('Siti');
});

test('Agih distributes pasted names sequentially', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  await page.fill('#group_num_groups', '2');
  await page.fill('#group_members_per', '2');
  await page.fill('#group_names', 'A\nB\nC\nD');
  await page.click('text=Agih ke Kumpulan');
  await expect(page.locator('#groupCards .group-card')).toHaveCount(2);
  await expect(page.locator('#groupCards .group-card').nth(0)).toContainText('A');
  await expect(page.locator('#groupCards .group-card').nth(0)).toContainText('B');
  await expect(page.locator('#groupCards .group-card').nth(1)).toContainText('C');
  await expect(page.locator('#groupCards .group-card').nth(1)).toContainText('D');
});

test('moving a member relocates it to the target group', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  // Move member 0 of group 0 (Ali) to group 1 (index 1)
  await page.selectOption('#group_move_0_0', '1');
  await page.click('#groupCards .group-card:nth-child(1) button:has-text("Pindah")');
  await expect(page.locator('#groupCards .group-card').nth(1)).toContainText('Ali');
  await expect(page.locator('#groupCards .group-card').nth(0)).not.toContainText('Ali');
});

test('deleting a group removes it and re-keys', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  page.on('dialog', d => d.accept());
  await page.click('#groupCards .group-card:nth-child(1) button:has-text("Padam Kumpulan")');
  await expect(page.locator('#groupCards .group-card')).toHaveCount(1);
  await expect(page.locator('#groupCards .group-card').nth(0)).toContainText('Kumpulan 1');
  await expect(page.locator('#groupCards .group-card').nth(0)).toContainText('Abu');
});
