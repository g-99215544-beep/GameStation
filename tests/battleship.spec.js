const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function openBattleship(page) {
  // The placing screen (board + dock + actions, plus the test-mode banner) is
  // taller than Playwright's default 1280x720 viewport. .click() auto-scrolls
  // its target into view, which is why earlier coordinate-entry tests never
  // noticed, but dragShip below drives page.mouse directly — real pointer
  // input, deliberately not auto-scrolling — so it needs every dock row and
  // grid cell already on screen. Only bump the height of the untouched
  // default; a test that first picks its own (e.g. mobile) viewport is left
  // alone.
  const vp = page.viewportSize();
  if (vp && vp.width === 1280 && vp.height === 720) await page.setViewportSize({ width: 1280, height: 1300 });
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
  // Rows y=0..4, each ship horizontal from x=0: the longest ship is 5 cells,
  // so every row fits inside the 9-wide grid.
  const ships = await page.evaluate(() => BattleshipEngine.FLEET_SPEC.map(s => s.name));
  for (let i = 0; i < ships.length; i++) await dragShip(page, ships[i], 0, i);
  await page.getByRole('button', { name: 'Sedia! Mula Menembak' }).click();
}

async function dragShip(page, name, x, y, options) {
  // Drops the ship so that its `grabIndex`-th cell lands on grid cell (x, y).
  const grabIndex = (options && options.grabIndex) || 0;
  const from = (options && options.from) === 'grid'
    ? page.locator(`#bsp_${options.fromX}_${options.fromY}`)
    : page.locator(`.bs-dock-ship[data-ship="${name}"] .bs-dock-cell`).nth(grabIndex);
  const source = await from.boundingBox();
  const target = await page.locator(`#bsp_${x}_${y}`).boundingBox();
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}

async function enterCoords(page, x, y) {
  await page.locator('#bsBoxX').fill(String.fromCharCode(65 + x));
  await page.locator('#bsBoxY').fill(String(y));
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
  await expect(page.locator('#bsPad')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tembak' })).toBeDisabled();

  const fleet = await page.evaluate(() => gameState.battleship.enemyFleet);

  const firstCell = fleet[0].cells[0];
  await fireAt(page, firstCell.x, firstCell.y);
  await expect(page.locator(`#bs_${firstCell.x}_${firstCell.y}`)).toHaveClass(/hit/);
  await expect(page.locator('#bsMsg')).toHaveText('Kena!');

  const occupied = new Set();
  fleet.forEach(ship => ship.cells.forEach(c => occupied.add(`${c.x},${c.y}`)));
  let missCell = null;
  for (let y = 0; y < 9 && !missCell; y++) {
    for (let x = 0; x < 9 && !missCell; x++) {
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
  await expect(page.locator('.bs-fleet-item.sunk .bs-fleet-mark')).toHaveText('✕');

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

test('both battle boards and native coordinate inputs stay visible on a phone without a numpad', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBattleship(page);
  await placeFleet(page);
  await expect(page.locator('#bsPad')).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const enemyRect = document.getElementById('bsEnemyBoardWrap').getBoundingClientRect();
    const playerRect = document.getElementById('bsPlayerBoardWrap').getBoundingClientRect();
    const controlsRect = document.querySelector('.bs-coord-row').getBoundingClientRect();
    const headingRect = document.querySelector('.battleship-game h2').getBoundingClientRect();
    return {
      enemyTop: enemyRect.top,
      playerTop: playerRect.top,
      controlsBottom: controlsRect.bottom,
      headingTop: headingRect.top,
      innerHeight: window.innerHeight,
      scrollHeight: document.documentElement.scrollHeight
    };
  });
  expect(layout.enemyTop).toBeGreaterThanOrEqual(layout.headingTop);
  expect(layout.playerTop).toBeGreaterThan(layout.enemyTop);
  expect(layout.controlsBottom).toBeLessThanOrEqual(layout.innerHeight);
  expect(layout.headingTop).toBeGreaterThanOrEqual(0);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight + 1);

  await fireAt(page, 0, 0);
  await expect(page.locator('#bsBoxX')).toHaveValue('');
  await expect(page.locator('#bsBoxY')).toHaveValue('');
  await expect(page.locator('#bsPad')).toHaveCount(0);
});

test('battle view uses A-I columns, centered controls, and fleet lists beside the enemy board', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBattleship(page);
  await placeFleet(page);

  await expect(page.locator('#bsEnemyGridWrap .bs-col-label')).toHaveText(
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
  );
  await page.locator('#bsBoxX').fill('c');
  await page.locator('#bsBoxY').fill('8');
  await expect(page.locator('#bsBoxX')).toHaveValue('C');
  expect(await page.evaluate(() => ({
    x: gameState.battleship.pendingX,
    y: gameState.battleship.pendingY
  }))).toEqual({ x: '2', y: '8' });
  await expect(page.getByRole('button', { name: 'Tembak' })).toBeEnabled();
  await page.locator('#bsBoxX').fill('J');
  await expect(page.locator('#bsBoxX')).toHaveValue('');
  await page.locator('#bsBoxX').fill('C');
  await page.locator('#bsBoxY').fill('9');
  await expect(page.locator('#bsBoxY')).toHaveValue('');
  await page.locator('#bsBoxY').fill('8');

  const layout = await page.evaluate(() => {
    const zone = document.getElementById('bsEnemyBoardWrap').getBoundingClientRect();
    const board = document.getElementById('bsEnemyGridWrap').getBoundingClientRect();
    const controls = document.querySelector('.bs-coord-row').getBoundingClientRect();
    const player = document.getElementById('bsPlayerBoardWrap').getBoundingClientRect();
    const left = document.getElementById('bsFleetLeft').getBoundingClientRect();
    const right = document.getElementById('bsFleetRight').getBoundingClientRect();
    return {
      zoneCenter: zone.left + zone.width / 2,
      boardCenter: board.left + board.width / 2,
      controlsBottom: controls.bottom,
      playerTop: player.top,
      leftRight: left.right,
      boardLeft: board.left,
      boardRight: board.right,
      rightLeft: right.left,
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth
    };
  });
  expect(Math.abs(layout.zoneCenter - layout.boardCenter)).toBeLessThanOrEqual(1);
  expect(layout.controlsBottom).toBeLessThanOrEqual(layout.playerTop);
  expect(layout.leftRight).toBeLessThanOrEqual(layout.boardLeft + 1);
  expect(layout.rightLeft).toBeGreaterThanOrEqual(layout.boardRight - 1);
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth + 1);
  await expect(page.locator('.bs-fleet-side .bs-fleet-item')).toHaveCount(5);
});

test('the whole 9x9 board fits inside its frame on a phone', async ({ page }) => {
  // The board must never need its own scroll on a phone: a student who cannot
  // see column I or row 0 cannot check where their shots landed.
  const measure = () => page.evaluate(() => {
    const wrap = document.querySelector('.bs-board-wrap');
    const wrapRect = wrap.getBoundingClientRect();
    const corners = ['0_0', '8_0', '0_8', '8_8'].map(key => {
      const cell = document.getElementById((document.getElementById('bs_0_0') ? 'bs_' : 'bsp_') + key);
      const rect = cell.getBoundingClientRect();
      return { key, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
    });
    return {
      overflowX: wrap.scrollWidth - wrap.clientWidth,
      overflowY: wrap.scrollHeight - wrap.clientHeight,
      wrap: { left: wrapRect.left, right: wrapRect.right, top: wrapRect.top, bottom: wrapRect.bottom },
      corners
    };
  });

  const expectFitsWidth = layout => {
    expect(layout.overflowX).toBeLessThanOrEqual(1);
    for (const corner of layout.corners) {
      expect(corner.left, `cell ${corner.key} left edge`).toBeGreaterThanOrEqual(layout.wrap.left - 1);
      expect(corner.right, `cell ${corner.key} right edge`).toBeLessThanOrEqual(layout.wrap.right + 1);
    }
  };

  const expectFits = layout => {
    expectFitsWidth(layout);
    expect(layout.overflowY).toBeLessThanOrEqual(1);
    for (const corner of layout.corners) {
      expect(corner.top, `cell ${corner.key} top edge`).toBeGreaterThanOrEqual(layout.wrap.top - 1);
      expect(corner.bottom, `cell ${corner.key} bottom edge`).toBeLessThanOrEqual(layout.wrap.bottom + 1);
    }
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await openBattleship(page);

  // Placement phase: every corner of the student's own board is reachable.
  expectFits(await measure());

  await placeFleet(page);

  // Battle phase: the whole grid remains visible because there is no custom
  // numpad competing with the two boards for vertical space.
  expectFits(await measure());

  // A narrower phone must still fit the whole board. The board re-fits on the
  // window's resize event, so poll rather than measure the first frame.
  await page.setViewportSize({ width: 360, height: 780 });
  await expect.poll(async () => (await measure()).overflowY).toBeLessThanOrEqual(1);
  expectFits(await measure());
});

test('a resize event during placement schedules fitBsBoard\'s corrective pass — locks scheduling, not board fit', async ({ page }) => {
  // fitBsBoard's window resize listener invokes fitBsBoard(event) directly
  // (window.addEventListener('resize', fitBsBoard)), so the immediate,
  // single-pass measurement taken on that call can be stale for the same
  // reason a fresh render's first pass can: it needs the same deferred,
  // one-animation-frame-later correction. That correction is only scheduled
  // when the call that just ran was NOT itself the corrective pass, so the
  // guard must check `_pass !== true`. A `!_pass` guard breaks silently on
  // this exact path: a resize Event is truthy, so `!_pass` is false and the
  // correction never gets scheduled — the placing-screen board can then stay
  // clipped after a real device rotation, with no self-heal.
  //
  // This asserts scheduling, not fit, on purpose: Chromium settles an
  // already-rendered board's layout synchronously on a plain resize, so a
  // fit assertion here would pass with the guard broken too — scheduling is
  // this guard's only observable effect on the resize path. Do not
  // "improve" this into a geometry check; it would silently stop locking
  // the regression. The user-visible 2px clipping this fix targets is
  // covered instead by the fresh-render fit test below (which exercises the
  // same deferred-pass mechanism via the initial-render path).
  await page.setViewportSize({ width: 390, height: 844 });
  await openBattleship(page);
  // Let the initial render's own automatic pass — and its deferred follow-up
  // — finish, so only the resize dispatch below is under test.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await expect(page.locator('.bs-dock')).toBeVisible(); // still the placing screen, dock present

  const scheduledCorrectivePass = await page.evaluate(() => {
    let scheduled = false;
    const originalRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => { scheduled = true; return originalRaf(cb); };
    window.dispatchEvent(new Event('resize'));
    window.requestAnimationFrame = originalRaf;
    return scheduled;
  });

  expect(scheduledCorrectivePass).toBe(true);
});

test('the dock lists every ship and the battle starts only when all five are placed', async ({ page }) => {
  await openBattleship(page);

  await expect(page.locator('.bs-dock-ship')).toHaveCount(5);
  await expect(page.locator('.bs-dock-ship[data-ship="Submarine"] .bs-dock-cell')).toHaveCount(3);
  await expect(page.locator('#bsPad')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Letak' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sedia! Mula Menembak' })).toBeDisabled();

  // Four ships is not enough.
  await page.evaluate(() => {
    BattleshipEngine.FLEET_SPEC.slice(0, 4).forEach((spec, i) => placeBsShipAt(spec.name, 0, i, 'h'));
  });
  await expect(page.locator('.bs-dock-ship.placed')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Sedia! Mula Menembak' })).toBeDisabled();

  // An off-grid or overlapping placement is refused and changes nothing.
  const refused = await page.evaluate(() => [
    placeBsShipAt('Pirate ship', 8, 5, 'h'),
    placeBsShipAt('Pirate ship', 0, 0, 'h')
  ]);
  expect(refused).toEqual([false, false]);
  await expect(page.locator('.bs-dock-ship.placed')).toHaveCount(4);

  await page.evaluate(() => placeBsShipAt('Pirate ship', 0, 4, 'h'));
  await expect(page.locator('.bs-dock-ship.placed')).toHaveCount(5);
  const start = page.getByRole('button', { name: 'Sedia! Mula Menembak' });
  await expect(start).toBeEnabled();

  await start.click();
  await expect(page.getByRole('button', { name: 'Tembak' })).toBeVisible();
  await expect(page.locator('.bs-dock')).toHaveCount(0);
});

test('a ship dragged from the dock lands on the cells it was dropped on', async ({ page }) => {
  await openBattleship(page);

  await dragShip(page, 'Submarine', 4, 6);

  const cells = await page.evaluate(() => bsShipByName('Submarine').cells);
  expect(cells).toEqual([{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }]);
  await expect(page.locator('.bs-dock-ship[data-ship="Submarine"]')).toHaveClass(/placed/);
  await expect(page.locator('#bsp_4_6')).toHaveClass(/ship/);
});

test('the grabbed cell is the cell that lands under the pointer', async ({ page }) => {
  await openBattleship(page);

  // Grab the Destroyer by its third cell (index 2) and drop that cell on (5,5):
  // the ship must start two cells to the left, at (3,5).
  await dragShip(page, 'Destroyer', 5, 5, { grabIndex: 2 });

  const cells = await page.evaluate(() => bsShipByName('Destroyer').cells);
  expect(cells[0]).toEqual({ x: 3, y: 5 });
  expect(cells).toHaveLength(4);
});

test('a drop that does not fit returns the ship to the dock', async ({ page }) => {
  await openBattleship(page);
  await dragShip(page, 'Submarine', 0, 0);

  // Off the right edge: a 5-cell ship starting at x=8 runs past the edge.
  await dragShip(page, 'Pirate ship', 8, 8);
  expect(await page.evaluate(() => !!bsShipByName('Pirate ship'))).toBe(false);
  await expect(page.locator('.bs-dock-ship[data-ship="Pirate ship"]')).not.toHaveClass(/placed/);
  await expect(page.locator('#bsMsg')).toContainText('Tidak muat');

  // On top of the Submarine already at (0,0)-(2,0).
  await dragShip(page, 'Battleship', 1, 0);
  expect(await page.evaluate(() => !!bsShipByName('Battleship'))).toBe(false);
  await expect(page.locator('#bsMsg')).toContainText('Tidak muat');
});

test('dragging highlights the target cells green when they fit and red when they do not', async ({ page }) => {
  await openBattleship(page);
  await dragShip(page, 'Submarine', 0, 0);

  const grab = await page.locator('.bs-dock-ship[data-ship="Battleship"] .bs-dock-cell').first().boundingBox();
  const good = await page.locator('#bsp_4_4').boundingBox();
  const bad = await page.locator('#bsp_1_0').boundingBox();

  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(good.x + good.width / 2, good.y + good.height / 2, { steps: 5 });
  await expect(page.locator('.bs-cell.preview-ok')).toHaveCount(3);
  await page.mouse.move(bad.x + bad.width / 2, bad.y + bad.height / 2, { steps: 5 });
  await expect(page.locator('.bs-cell.preview-bad')).toHaveCount(3);
  await expect(page.locator('.bs-cell.preview-ok')).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator('.bs-cell.preview-ok, .bs-cell.preview-bad')).toHaveCount(0);
});

test('a touch drag places a ship, so the phone path works', async ({ page }) => {
  await openBattleship(page);

  // page.mouse produces mouse-type pointer events; this drives the same
  // handlers with pointerType 'touch', which is what a student's finger sends.
  await page.evaluate(() => {
    const dock = document.querySelector('.bs-dock-ship[data-ship="Submarine"] .bs-dock-cell');
    const target = document.getElementById('bsp_2_3');
    const at = el => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
    const from = at(dock), to = at(target);
    const fire = (type, node, point) => node.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, pointerId: 1, pointerType: 'touch', isPrimary: true,
      clientX: point.x, clientY: point.y
    }));
    fire('pointerdown', dock, from);
    fire('pointermove', window, { x: from.x + 20, y: from.y - 20 });
    fire('pointermove', window, to);
    fire('pointerup', window, to);
  });

  const cells = await page.evaluate(() => bsShipByName('Submarine').cells);
  expect(cells[0]).toEqual({ x: 2, y: 3 });
});

test('the computer fires back after every player shot', async ({ page }) => {
  await openBattleship(page);
  await placeFleet(page);

  const before = await page.evaluate(() => Object.keys(gameState.battleship.enemyShotLog).length);
  expect(before).toBe(0);

  await fireAt(page, 8, 8);

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

test('projectiles travel from the firing board to the receiving board', async ({ page }) => {
  await openBattleship(page);
  await placeFleet(page);
  await page.evaluate(() => {
    window.__bsShotRoutes = [];
    const animate = window.bsAnimateShot;
    window.bsAnimateShot = async (sourcePrefix, targetPrefix, x, y, result) => {
      window.__bsShotRoutes.push({ sourcePrefix, targetPrefix });
      return animate(sourcePrefix, targetPrefix, x, y, result);
    };
  });

  await fireAt(page, 8, 8);
  expect(await page.evaluate(() => window.__bsShotRoutes)).toEqual([
    { sourcePrefix: 'bsp', targetPrefix: 'bs' },
    { sourcePrefix: 'bs', targetPrefix: 'bsp' }
  ]);
});

test('a shot plays a missile and impact animation when motion is allowed', async ({ page }) => {
  await openBattleship(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await placeFleet(page);

  await enterCoords(page, 8, 8);
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

test('tapping a placed ship rotates it about its starting cell', async ({ page }) => {
  await openBattleship(page);
  await dragShip(page, 'Submarine', 4, 2);

  await page.locator('#bsp_4_2').click();

  // Horizontal (4,2)-(6,2) becomes vertical (4,2)-(4,4): y grows upward.
  const cells = await page.evaluate(() => bsShipByName('Submarine').cells);
  expect(cells).toEqual([{ x: 4, y: 2 }, { x: 4, y: 3 }, { x: 4, y: 4 }]);
  await expect(page.locator('#bsp_4_4')).toHaveClass(/ship/);
  await expect(page.locator('#bsp_6_2')).not.toHaveClass(/ship/);

  // Tapping again turns it back.
  await page.locator('#bsp_4_2').click();
  expect(await page.evaluate(() => bsShipByName('Submarine').cells)).toEqual([
    { x: 4, y: 2 }, { x: 5, y: 2 }, { x: 6, y: 2 }
  ]);
});

test('a rotation that would not fit is refused and the ship keeps its cells', async ({ page }) => {
  await openBattleship(page);
  // Starting at y=8, a 5-cell vertical ship would need y=8..12 — off the grid.
  await dragShip(page, 'Pirate ship', 0, 8);

  await page.locator('#bsp_0_8').click();

  expect(await page.evaluate(() => bsShipByName('Pirate ship').cells)).toEqual([
    { x: 0, y: 8 }, { x: 1, y: 8 }, { x: 2, y: 8 }, { x: 3, y: 8 }, { x: 4, y: 8 }
  ]);
  await expect(page.locator('#bsMsg')).toContainText('Tidak muat');
});

test('dragging a placed ship moves it and frees the cells it left', async ({ page }) => {
  await openBattleship(page);
  await dragShip(page, 'Submarine', 0, 0);

  await dragShip(page, 'Submarine', 6, 7, { from: 'grid', fromX: 0, fromY: 0 });

  expect(await page.evaluate(() => bsShipByName('Submarine').cells)).toEqual([
    { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 8, y: 7 }
  ]);
  await expect(page.locator('#bsp_0_0')).toHaveClass(/water/);
  await expect(page.locator('#bsp_6_7')).toHaveClass(/ship/);
});

test('a placed ship may be moved onto cells it currently occupies', async ({ page }) => {
  await openBattleship(page);
  await dragShip(page, 'Destroyer', 3, 3);

  // Shift one cell right: the target overlaps the ship's own old cells, which
  // must not count as a collision.
  await dragShip(page, 'Destroyer', 4, 3, { from: 'grid', fromX: 3, fromY: 3 });

  expect(await page.evaluate(() => bsShipByName('Destroyer').cells[0])).toEqual({ x: 4, y: 3 });
});

test('tapping a ship in the dock does nothing', async ({ page }) => {
  await openBattleship(page);

  await page.locator('.bs-dock-ship[data-ship="Submarine"] .bs-dock-cell').first().click();

  expect(await page.evaluate(() => bsShipByName('Submarine'))).toBeUndefined();
  await expect(page.locator('.bs-dock-ship[data-ship="Submarine"]')).not.toHaveClass(/placed/);
  // The two assertions above hold even if the fromGrid gate in bsPointerUp were
  // broken: rotateBsShip('Submarine') would still find no such ship in
  // playerFleet and early-return false, changing nothing. What only a working
  // gate keeps quiet is bsMsg — a broken gate calls rotateBsShip for the dock
  // tap too, and its false return trips the "Tidak muat" refusal message.
  await expect(page.locator('#bsMsg')).toHaveText('');
});

test('the placement screen fits a phone and drags work at phone size', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openBattleship(page);

  const layout = await page.evaluate(() => ({
    dockBottom: document.querySelector('.bs-dock').getBoundingClientRect().bottom,
    startBottom: document.getElementById('bsStartBtn').getBoundingClientRect().bottom,
    headingTop: document.querySelector('.battleship-game h2').getBoundingClientRect().top,
    innerHeight: window.innerHeight,
    scrollHeight: document.documentElement.scrollHeight
  }));
  expect(layout.headingTop).toBeGreaterThanOrEqual(0);
  expect(layout.dockBottom).toBeLessThanOrEqual(layout.innerHeight);
  expect(layout.startBottom).toBeLessThanOrEqual(layout.innerHeight);
  expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight + 1);

  // A drag must still hit the right cell at phone cell sizes.
  await dragShip(page, 'Submarine', 6, 8);
  expect(await page.evaluate(() => bsShipByName('Submarine').cells[0])).toEqual({ x: 6, y: 8 });
});

test('resetting during a drag removes its ghost, preview, and stale pointer state', async ({ page }) => {
  await openBattleship(page);
  const source = await page.locator('.bs-dock-ship[data-ship="Submarine"] .bs-dock-cell').first().boundingBox();
  const target = await page.locator('#bsp_4_4').boundingBox();

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await expect(page.locator('.bs-drag-ghost')).toHaveCount(1);
  await expect(page.locator('.bs-cell.preview-ok')).toHaveCount(3);

  await page.evaluate(() => resetBsPlacement());
  await expect(page.locator('.bs-drag-ghost')).toHaveCount(0);
  await expect(page.locator('.bs-cell.preview-ok, .bs-cell.preview-bad')).toHaveCount(0);
  expect(await page.evaluate(() => gameState.battleship.drag)).toBeNull();

  // A later pointerup must not revive the cancelled drop through a stale
  // window listener.
  await page.mouse.up();
  expect(await page.evaluate(() => bsShipByName('Submarine'))).toBeUndefined();
});

test('non-primary touch pointers and non-left mouse buttons cannot start a drag', async ({ page }) => {
  await openBattleship(page);
  const states = await page.evaluate(() => {
    const dock = document.querySelector('.bs-dock-ship[data-ship="Submarine"] .bs-dock-cell');
    const rect = dock.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };
    dock.dispatchEvent(new PointerEvent('pointerdown', {
      ...init, pointerId: 2, pointerType: 'touch', isPrimary: false
    }));
    const afterSecondTouch = gameState.battleship.drag;
    if (afterSecondTouch) {
      window.dispatchEvent(new PointerEvent('pointercancel', {
        ...init, pointerId: 2, pointerType: 'touch', isPrimary: false
      }));
    }
    dock.dispatchEvent(new PointerEvent('pointerdown', {
      ...init, pointerId: 3, pointerType: 'mouse', button: 2, isPrimary: true
    }));
    return { afterSecondTouch, afterRightClick: gameState.battleship.drag };
  });
  expect(states).toEqual({ afterSecondTouch: null, afterRightClick: null });
});

test('a timeout during a drag clears pointer artifacts before showing the result', async ({ page }) => {
  await openBattleship(page);
  const source = await page.locator('.bs-dock-ship[data-ship="Submarine"] .bs-dock-cell').first().boundingBox();
  const target = await page.locator('#bsp_4_4').boundingBox();

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await expect(page.locator('.bs-drag-ghost')).toHaveCount(1);

  await page.evaluate(() => finishBattleship(false));
  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
  await expect(page.locator('.bs-drag-ghost')).toHaveCount(0);
  expect(await page.evaluate(() => gameState.battleship.drag)).toBeNull();

  // The physical pointer can be released after the timeout without invoking
  // a stale placement callback on the result screen.
  await page.mouse.up();
  await expect(page.getByRole('heading', { name: 'Ujian Selesai' })).toBeVisible();
});

test('leaving test mode during a drag clears pointer artifacts', async ({ page }) => {
  await openBattleship(page);
  const source = await page.locator('.bs-dock-ship[data-ship="Submarine"] .bs-dock-cell').first().boundingBox();
  const target = await page.locator('#bsp_4_4').boundingBox();

  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 5 });
  await expect(page.locator('.bs-drag-ghost')).toHaveCount(1);

  await page.evaluate(() => endTest());
  await expect(page.locator('#view-admin')).toHaveClass(/\bactive\b/);
  await expect(page.locator('.bs-drag-ghost')).toHaveCount(0);
  expect(await page.evaluate(() => gameState.battleship.drag)).toBeNull();

  await page.mouse.up();
  await expect(page.locator('#view-admin')).toHaveClass(/\bactive\b/);
});
