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
  // Animations are verified in their own test; every other test runs with
  // reduced motion so shots resolve instantly and deterministically.
  await page.emulateMedia({ reducedMotion: 'reduce' });
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

async function placeFleet(page) {
  // Place all 5 ships in fixed, non-overlapping rows through the real UI:
  // rows y=0..4, each ship horizontal starting at x=0. The longest ship is 5
  // cells, so every row fits inside the 11-wide grid.
  const count = await page.evaluate(() => BattleshipEngine.FLEET_SPEC.length);
  for (let i = 0; i < count; i++) {
    await enterCoords(page, 0, i);
    await page.getByRole('button', { name: 'Letak' }).click();
  }
}

async function enterCoords(page, x, y) {
  await page.locator('#bsBoxX').click();
  for (const digit of String(x)) {
    await page.locator('#bsPad button').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  }
  await page.locator('#bsBoxY').click();
  for (const digit of String(y)) {
    await page.locator('#bsPad button').filter({ hasText: new RegExp(`^${digit}$`) }).click();
  }
}

async function fireAt(page, x, y) {
  await enterCoords(page, x, y);
  await page.getByRole('button', { name: 'Tembak' }).click();
  // On a winning shot, fireBattleship deliberately leaves bs.busy=true forever
  // (input stays locked once window._gameOver is set), so also unblock on
  // game-over rather than waiting on busy alone.
  await page.waitForFunction(() => !gameState.battleship.busy || window._gameOver);
}

test('battleship supports coordinate entry, hit/miss feedback, sinking, and a full win', async ({ page }) => {
  await openBattleship(page);
  await placeFleet(page);

  await expect(page.locator('.bs-fleet-item')).toHaveCount(5);
  await expect(page.locator('#bsPad')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Tembak' })).toBeDisabled();

  const fleet = await page.evaluate(() => gameState.battleship.enemyFleet);

  const firstCell = fleet[0].cells[0];
  await fireAt(page, firstCell.x, firstCell.y);
  await expect(page.locator(`#bs_${firstCell.x}_${firstCell.y}`)).toHaveClass(/hit/);
  await expect(page.locator('#bsMsg')).toHaveText('Kena!');

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

  // Firing the same coordinate again must not re-mark the cell or claim a hit.
  await fireAt(page, firstCell.x, firstCell.y);
  await expect(page.locator('#bsMsg')).toHaveText('Sudah ditembak di sini.');
  await expect(page.locator(`#bs_${firstCell.x}_${firstCell.y}`)).toHaveClass(/hit/);

  // Sink the fleet's first ship (Lookout Cruiser, 2 cells) through the real UI,
  // exercising the production 'sunk' branch and fleet-list re-render.
  const secondCell = fleet[0].cells[1];
  await fireAt(page, secondCell.x, secondCell.y);
  await expect(page.locator('#bsMsg')).toContainText('tenggelam');
  await expect(page.locator('.bs-fleet-item.sunk')).toHaveCount(1);

  // Fire every remaining un-fired ship cell across the rest of the fleet
  // through the real UI, so the production auto-finish wiring (the
  // isFleetSunk check inside fireBattleship) is what ends the round.
  let remaining = await page.evaluate(() => {
    const bs = gameState.battleship;
    const cells = [];
    bs.enemyFleet.forEach(ship => ship.cells.forEach(c => {
      if (!(`${c.x},${c.y}` in bs.playerShotLog)) cells.push({ x: c.x, y: c.y });
    }));
    return cells;
  });
  for (const cell of remaining) {
    await fireAt(page, cell.x, cell.y);
  }

  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
  await expect(page.locator('#resultCard')).toContainText('Markah: 100');
});

test('battleship timeout keeps partial credit and applies the late penalty', async ({ page }) => {
  await openBattleship(page);
  await placeFleet(page);
  await page.evaluate(() => {
    const bs = gameState.battleship;
    bs.enemyFleet.slice(0, 2).forEach(ship => {
      ship.cells.forEach(c => {
        const res = BattleshipEngine.fireAt(bs.enemyFleet, bs.playerShotLog, c.x, c.y);
        bs.playerShotLog = res.shotLog;
      });
    });
    gameState.correct = BattleshipEngine.countSunk(bs.enemyFleet, bs.playerShotLog);
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
  await placeFleet(page);
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

  // fireBattleship() calls hideBsPad() on every shot, so real play triggers a
  // close/reopen reflow cycle (board grows to fill the freed space, then
  // shrinks again when the pad reopens). Fire a real shot and reopen the pad
  // to confirm that reflow doesn't break the layout on a small phone.
  await fireAt(page, 0, 0);
  await page.locator('#bsBoxX').click();
  await expect(pad).toBeVisible();

  const layoutAfter = await page.evaluate(() => {
    const padRect = document.getElementById('bsPad').getBoundingClientRect();
    const headingRect = document.querySelector('.battleship-game h2').getBoundingClientRect();
    return {
      padBottom: padRect.bottom,
      headingTop: headingRect.top,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight
    };
  });
  expect(layoutAfter.padBottom).toBeLessThanOrEqual(layoutAfter.innerHeight);
  expect(layoutAfter.headingTop).toBeGreaterThanOrEqual(0);
  expect(layoutAfter.scrollHeight).toBeLessThanOrEqual(layoutAfter.innerHeight + 1);
});

test('battleship requires placing all five ships before play begins', async ({ page }) => {
  await openBattleship(page);

  await expect(page.locator('#bsPlacePrompt')).toContainText('Lookout Cruiser');
  await expect(page.getByRole('button', { name: 'Letak' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Tembak' })).toHaveCount(0);

  // An off-grid placement is rejected and does not consume the ship.
  await enterCoords(page, 10, 0);
  await page.getByRole('button', { name: 'Letak' }).click();
  await expect(page.locator('#bsMsg')).toContainText('Tidak muat');
  await expect(page.locator('#bsPlacePrompt')).toContainText('Lookout Cruiser');

  await enterCoords(page, 0, 0);
  await page.getByRole('button', { name: 'Letak' }).click();
  await expect(page.locator('#bsPlacePrompt')).toContainText('Submarine');

  // An overlapping placement is rejected too.
  await enterCoords(page, 0, 0);
  await page.getByRole('button', { name: 'Letak' }).click();
  await expect(page.locator('#bsMsg')).toContainText('Tidak muat');
  await expect(page.locator('#bsPlacePrompt')).toContainText('Submarine');

  await page.getByRole('button', { name: 'Susun Semula' }).click();
  await expect(page.locator('#bsPlacePrompt')).toContainText('Lookout Cruiser');

  await placeFleet(page);
  await expect(page.getByRole('button', { name: 'Tembak' })).toBeVisible();
  await expect(page.locator('.bs-fleet-item')).toHaveCount(5);
  await expect(page.locator('.bs-board.mini')).toBeVisible();
});

test('a successful placement fully clears the coordinate boxes', async ({ page }) => {
  await openBattleship(page);

  await enterCoords(page, 0, 0);
  await page.getByRole('button', { name: 'Letak' }).click();
  await expect(page.locator('#bsPlacePrompt')).toContainText('Submarine');

  // Both boxes must be empty and the button dead after a successful placement.
  await expect(page.locator('#bsBoxX')).toHaveText('');
  await expect(page.locator('#bsBoxY')).toHaveText('');
  await expect(page.getByRole('button', { name: 'Letak' })).toBeDisabled();

  // Entering only an x must NOT enable the button on a stale y.
  await page.locator('#bsBoxX').click();
  await page.locator('#bsPad button').filter({ hasText: /^3$/ }).click();
  await expect(page.locator('#bsBoxY')).toHaveText('');
  await expect(page.getByRole('button', { name: 'Letak' })).toBeDisabled();
});

test('the computer fires back after every player shot', async ({ page }) => {
  await openBattleship(page);
  await placeFleet(page);

  const before = await page.evaluate(() => Object.keys(gameState.battleship.enemyShotLog).length);
  expect(before).toBe(0);

  await fireAt(page, 9, 9);

  const after = await page.evaluate(() => Object.keys(gameState.battleship.enemyShotLog).length);
  expect(after).toBe(1);

  // The computer's shot must have marked a cell on the player's own board.
  const marked = await page.evaluate(() => {
    const [key] = Object.keys(gameState.battleship.enemyShotLog);
    const [x, y] = key.split(',');
    return document.getElementById(`bsp_${x}_${y}`).className;
  });
  expect(marked).toMatch(/hit|miss/);
});

test('losing the whole fleet resets the round and keeps the placement', async ({ page }) => {
  await openBattleship(page);
  await placeFleet(page);

  const layoutBefore = await page.evaluate(() => JSON.stringify(gameState.battleship.playerFleet));

  // The AI picks uniformly among un-fired cells, so the only way to force its
  // next shot is to leave exactly one cell open: sink every player ship cell
  // but the last, then close off every other square on the board.
  await page.evaluate(() => {
    const bs = gameState.battleship;
    const cells = bs.playerFleet.flatMap(s => s.cells);
    const last = cells[cells.length - 1];
    const fire = (x, y) => {
      bs.enemyShotLog = BattleshipEngine.fireAt(bs.playerFleet, bs.enemyShotLog, x, y).shotLog;
    };
    cells.slice(0, -1).forEach(c => fire(c.x, c.y));
    for (let x = 0; x < BattleshipEngine.GRID_SIZE; x++) {
      for (let y = 0; y < BattleshipEngine.GRID_SIZE; y++) {
        if (x !== last.x || y !== last.y) fire(x, y);
      }
    }
  });

  await fireAt(page, 8, 8);

  await expect(page.locator('#bsMsg')).toContainText('Pusingan baharu');
  const after = await page.evaluate(() => ({
    layout: JSON.stringify(gameState.battleship.playerFleet),
    playerShots: Object.keys(gameState.battleship.playerShotLog).length,
    enemyShots: Object.keys(gameState.battleship.enemyShotLog).length,
    round: gameState.battleship.round,
    phase: gameState.battleship.phase
  }));
  expect(after.layout).toBe(layoutBefore);   // placement preserved
  expect(after.playerShots).toBe(0);          // both boards cleared
  expect(after.enemyShots).toBe(0);
  expect(after.round).toBe(2);
  expect(after.phase).toBe('playing');        // still playable, not finished

  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toHaveCount(0);
});

test('a shot plays a missile and impact animation when motion is allowed', async ({ page }) => {
  await openBattleship(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await placeFleet(page);

  await enterCoords(page, 9, 9);
  await page.getByRole('button', { name: 'Tembak' }).click();

  // The SVG overlay exists while the shot is in flight...
  await expect(page.locator('.bs-fx')).toHaveCount(1);
  // ...and is cleaned up once the whole turn (including the computer's reply)
  // finishes, leaving no orphaned overlays behind.
  // The winning shot leaves busy=true by design (finishBattleship sets
  // _gameOver, and the finally block deliberately does not re-enable input on
  // a finished game), so the wait must also break on _gameOver or it hangs.
  await page.waitForFunction(() => !gameState.battleship.busy || window._gameOver);
  await expect(page.locator('.bs-fx')).toHaveCount(0);
});
