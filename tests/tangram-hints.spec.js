const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function openTangram(page) {
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
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    window._testMode = true;
    const nativeSetInterval = window.setInterval.bind(window);
    window.__tgMinuteHintCallbacks = [];
    window.setInterval = (callback, delay, ...args) => {
      if (delay === 60000) {
        window.__tgMinuteHintCallbacks.push(callback);
        return 900001 + window.__tgMinuteHintCallbacks.length;
      }
      return nativeSetInterval(callback, delay, ...args);
    };
    startGame('tangram-test', {
      id: 'tangram-test',
      name: 'Tangram Ujian',
      gameType: 'tangram',
      gameDataRaw: '{}',
      timeLimitMin: 10
    });
    window._tgStart();
  });
}

async function advanceToThirdShape(page) {
  await page.evaluate(() => window._tgCtrl.setPieces(TangramShapes.SOLUTIONS.kuda));
  await page.evaluate(() => window._tgNext());
  await page.evaluate(() => window._tgCtrl.setPieces(TangramShapes.SOLUTIONS.kucing));
  await page.evaluate(() => window._tgNext());
  await expect(page.getByText(/Bentuk 3\/3: Segi Empat/)).toBeVisible();
}

test('third Tangram shape automatically reveals guide lines every minute for five seconds', async ({ page }) => {
  await openTangram(page);
  expect(await page.evaluate(() => window.__tgMinuteHintCallbacks.length)).toBe(0);

  await advanceToThirdShape(page);
  expect(await page.evaluate(() => window.__tgMinuteHintCallbacks.length)).toBe(1);

  const placed = await page.evaluate(() => {
    const solution = TangramShapes.SOLUTIONS.segiempat;
    const polygons = TangramShapes.PIECE_POLYGONS;
    const worlds = solution.map(piece =>
      TangramEngine.transformPolygon(polygons[piece.type], piece.pos, piece.angle, piece.flipped)
    );
    const xs = worlds.flat().map(point => point.x);
    const ys = worlds.flat().map(point => point.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const canvas = document.getElementById('tgBoard');
    const ppu = 51;
    const ox = canvas.width / ppu / 2 - cx;
    const oy = canvas.height / ppu * 0.56 - cy;
    const pieces = solution.map(piece => ({
      type: piece.type,
      angle: piece.angle,
      flipped: piece.flipped,
      pos: { x: piece.pos.x + ox, y: piece.pos.y + oy }
    }));
    pieces[pieces.length - 1].pos.x += 2;
    window._tgCtrl.setPieces(pieces);
    return window._tgCtrl.getPlacedCount();
  });
  expect(placed).toBeGreaterThan(0);
  expect(placed).toBeLessThan(7);
  expect(await page.evaluate(() => window._tgCtrl.getGuideAlpha())).toBe(0);
  await expect(page.locator('#tgHintBtn')).toHaveCount(0);

  await page.evaluate(() => window.__tgMinuteHintCallbacks[0]());
  expect(await page.evaluate(() => window._tgCtrl.getGuideAlpha())).toBe(1);
  await expect(page.locator('#tgHintCountdown')).toContainText('Bantuan · 5s');

  await page.waitForTimeout(5200);
  expect(await page.evaluate(() => window._tgCtrl.getGuideAlpha())).toBe(0);
  await expect(page.locator('#tgHintCountdown')).toHaveCount(0);

  await page.evaluate(() => window.__tgMinuteHintCallbacks[0]());
  expect(await page.evaluate(() => window._tgCtrl.getGuideAlpha())).toBe(1);
});
