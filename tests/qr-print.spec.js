const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');
const installFakeFirebase = require('./helpers/fake-firebase.js');

// A printed QR is useless to a device whose camera is broken or blocked, so the
// same sheet has to carry the password as readable text.
function seed() {
  const stations = {
    1: { id: 1, name: 'Stesen Satu', location: 'perpustakaan', password: 'ab12c', gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10 },
    2: { id: 2, name: 'Stesen Dua', location: 'kantin', password: 'XY9Z8', gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10 },
    3: { id: 3, name: 'Stesen Tiga', location: 'padang', password: '54321', gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10 }
  };
  return {
    gamestation2026: {
      config: {
        stations, groups: {},
        cannon: { enabled: true, damagePercent: 20 },
        cannons: { c1: { id: 'c1', name: 'Meriam Merah', password: 'mr77q', gameType: 'sifir', gameDataRaw: '{}' } }
      },
      session: { status: 'setup' }, progress: {}
    }
  };
}

async function openQrTab(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.route('https://cdnjs.cloudflare.com/**', route =>
    // Stub the QR library: this spec is about the printed text, not the bitmap.
    route.fulfill({ body: 'window.QRCode = function(){};' }));
  await page.addInitScript(installFakeFirebase, seed());
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(async () => {
    await loadConfigCache();
    sessionInfo = { status: 'setup' };
    show('view-admin');
    selectAdminTab('setup');
    selectAdminTab('qr');
    generateQRs();
  });
}

test('every station QR card prints its password as text', async ({ page }) => {
  await openQrTab(page);
  const cards = page.locator('#view-admin #qrOutput .qr-print:not(.cannon-qr)');
  await expect(cards).toHaveCount(3);
  await expect(cards.nth(0)).toContainText('Password:');
  // Upper-cased on the sheet; checkPassword() compares case-insensitively.
  await expect(cards.nth(0).locator('.qr-pass b')).toHaveText('AB12C');
  await expect(cards.nth(1).locator('.qr-pass b')).toHaveText('XY9Z8');
  await expect(cards.nth(2).locator('.qr-pass b')).toHaveText('54321');
});

test('the cannon QR card prints its password too', async ({ page }) => {
  await openQrTab(page);
  const cannon = page.locator('#view-admin #qrOutput .qr-print.cannon-qr');
  await expect(cannon).toHaveCount(1);
  await expect(cannon.locator('.qr-pass b')).toHaveText('MR77Q');
});

test('the hiding location still prints below the password', async ({ page }) => {
  await openQrTab(page);
  const first = page.locator("#view-admin #qrOutput .qr-print").first();
  await expect(first).toContainText('Sorok di: perpustakaan');
  // The print stylesheet targets the location as :last-child; inserting the
  // password must not have stolen that position.
  const lastIsLocation = await first.evaluate(card =>
    card.lastElementChild.textContent.startsWith('Sorok di:'));
  expect(lastIsLocation).toBe(true);
});

test('a printed password matches what the station actually accepts', async ({ page }) => {
  await openQrTab(page);
  const printed = await page.locator('#view-admin #qrOutput .qr-print .qr-pass b').first().textContent();
  const accepted = await page.evaluate(typed => {
    currentGroupId = '1';
    groups = { 1: { id: 1, order: [1, 2, 3] } };
    progress = { currentIndex: 0 };
    show('view-clue');
    document.getElementById('passInput').value = typed;
    checkPassword();
    return document.getElementById('passMsg').innerHTML;
  }, printed);
  expect(accepted).toContain('Password betul');
});
