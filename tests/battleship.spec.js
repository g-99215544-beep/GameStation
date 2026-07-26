const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function openBattleship(page) {
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
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(() => {
    window._testMode = true;
    startGame('battleship-test', {
      id: 'battleship-test',
      name: 'Battleship Koordinat',
      gameType: 'battleship',
      gameDataRaw: '{}',
      timeLimitMin: 10
    });
  });
}

async function fireAt(page, x, y) {
  await page.locator('#bsBoxX').click();
  for (const digit of String(x)) {
    await page.locator('#bsPad button').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  }
  await page.locator('#bsBoxY').click();
  for (const digit of String(y)) {
    await page.locator('#bsPad button').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  }
  await page.getByRole('button', { name: 'Tembak' }).click();
}

test('battleship supports coordinate entry, hit/miss feedback, sinking, and a full win', async ({ page }) => {
  await openBattleship(page);

  await expect(page.locator('.bs-fleet-item')).toHaveCount(5);
  await expect(page.locator('#bsPad')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Tembak' })).toBeDisabled();

  const fleet = await page.evaluate(() => gameState.battleship.fleet);

  const firstCell = fleet[0].cells[0];
  await fireAt(page, firstCell.x, firstCell.y);
  await expect(page.locator(`#bs_${firstCell.x}_${firstCell.y}`)).toHaveClass(/hit/);
  await expect(page.locator('#bsMsg')).not.toHaveText('');

  const occupied = new Set();
  fleet.forEach(ship => ship.cells.forEach(c => occupied.add(`${c.x},${c.y}`)));
  let missCell = null;
  for (let y = 0; y < 11 && !missCell; y++) {
    for (let x = 0; x < 11 && !missCell; x++) {
      if (!occupied.has(`${x},${y}`)) missCell = { x, y };
    }
  }
  await fireAt(page, missCell.x, missCell.y);
  await expect(page.locator(`#bs_${missCell.x}_${missCell.y}`)).toHaveClass(/miss/);

  await page.evaluate(() => {
    const bs = gameState.battleship;
    bs.fleet.forEach(ship => {
      ship.cells.forEach(c => {
        const key = `${c.x},${c.y}`;
        if (!(key in bs.shotLog)) {
          const res = BattleshipEngine.fireAt(bs.fleet, bs.shotLog, c.x, c.y);
          bs.shotLog = res.shotLog;
        }
      });
    });
    gameState.correct = BattleshipEngine.countSunk(bs.fleet, bs.shotLog);
    if (BattleshipEngine.isFleetSunk(bs.fleet, bs.shotLog)) finishBattleship(true);
  });

  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
  await expect(page.locator('#resultCard')).toContainText('Markah: 100');
});

test('battleship timeout keeps partial credit and applies the late penalty', async ({ page }) => {
  await openBattleship(page);
  await page.evaluate(() => {
    const bs = gameState.battleship;
    bs.fleet.slice(0, 2).forEach(ship => {
      ship.cells.forEach(c => {
        const res = BattleshipEngine.fireAt(bs.fleet, bs.shotLog, c.x, c.y);
        bs.shotLog = res.shotLog;
      });
    });
    gameState.correct = BattleshipEngine.countSunk(bs.fleet, bs.shotLog);
    timeUp = true;
    window._battleshipTimeout();
  });
  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
  await expect(page.locator('#resultCard')).toContainText('Masa tamat');
  // 2 of 5 sunk -> round(2/5*100)=40, minus the 20-point late penalty.
  await expect(page.locator('#resultCard')).toContainText('Markah: 20');
});

test('battleship board, fleet panel, and coordinate pad stay visible on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBattleship(page);
  await page.locator('#bsBoxX').click();

  const pad = page.locator('#bsPad');
  await expect(pad).toBeVisible();

  const layout = await page.evaluate(() => {
    const padRect = document.getElementById('bsPad').getBoundingClientRect();
    const headingRect = document.querySelector('.battleship-game h2').getBoundingClientRect();
    return {
      padBottom: padRect.bottom,
      headingTop: headingRect.top,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight
    };
  });
  expect(layout.padBottom).toBeLessThanOrEqual(layout.innerHeight);
  expect(layout.headingTop).toBeGreaterThanOrEqual(0);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight + 1);
});
