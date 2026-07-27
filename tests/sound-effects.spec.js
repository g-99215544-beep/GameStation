const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

async function openApp(page) {
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
}

test('worksheet answers play distinct wrong and correct effects', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => {
    window.__playedSfx = [];
    window.playGameSfx = name => window.__playedSfx.push(name);
    window._testMode = true;
    startGame('worksheet-sound', {
      id: 'worksheet-sound',
      name: 'Lembaran Bunyi',
      gameType: 'lembaran_kerja',
      gameDataRaw: '{"questions":[{"answer":"42"},{"answer":"laut"}]}',
      timeLimitMin: 10
    });
  });

  await page.locator('#worksheetAnswer').fill('41');
  await page.getByRole('button', { name: 'Semak Jawapan' }).click();
  await page.locator('#worksheetAnswer').fill('42');
  await page.getByRole('button', { name: 'Semak Jawapan' }).click();

  expect(await page.evaluate(() => window.__playedSfx)).toEqual(['wrong', 'correct']);
  await expect(page.locator('#gameCard')).toContainText('Soalan 2 daripada 2');
});

test('Battleship plays cannon, hit, miss, and sunk effects', async ({ page }) => {
  await openApp(page);
  const effects = await page.evaluate(async () => {
    window.__playedSfx = [];
    window.playGameSfx = name => window.__playedSfx.push(name);
    window._testMode = true;
    startGame('battleship-sound', {
      id: 'battleship-sound',
      name: 'Battleship Bunyi',
      gameType: 'battleship',
      gameDataRaw: '{}',
      timeLimitMin: 10
    });
    const bs = gameState.battleship;
    bs.phase = 'playing';
    bs.enemyFleet = BattleshipEngine.generateFleet(() => 0.25);
    bs.playerFleet = BattleshipEngine.generateFleet(() => 0.75);
    renderBattleship();
    window.bsComputerTurn = async () => {};

    const target = bs.enemyFleet[0];
    const hit = target.cells[0];
    bs.pendingX = String(hit.x);
    bs.pendingY = String(hit.y);
    await fireBattleship();

    const occupied = new Set(bs.enemyFleet.flatMap(ship => ship.cells.map(cell => `${cell.x},${cell.y}`)));
    let miss = null;
    for (let y = 0; y < BattleshipEngine.GRID_SIZE && !miss; y++) {
      for (let x = 0; x < BattleshipEngine.GRID_SIZE; x++) {
        if (!occupied.has(`${x},${y}`)) { miss = { x, y }; break; }
      }
    }
    bs.pendingX = String(miss.x);
    bs.pendingY = String(miss.y);
    await fireBattleship();

    const finalCell = target.cells[1];
    bs.pendingX = String(finalCell.x);
    bs.pendingY = String(finalCell.y);
    await fireBattleship();
    return window.__playedSfx;
  });

  expect(effects).toEqual([
    'bs-cannon', 'bs-hit',
    'bs-cannon', 'bs-miss',
    'bs-cannon', 'bs-sunk'
  ]);
});

test('other station types use the shared correct and wrong feedback', async ({ page }) => {
  await openApp(page);
  const effects = await page.evaluate(() => {
    window.__playedSfx = [];
    window.playGameSfx = name => window.__playedSfx.push(name);
    window._testMode = true;
    const play = (gameType, gameDataRaw = '{}') => startGame(`sound-${gameType}`, {
      id: `sound-${gameType}`,
      name: `Bunyi ${gameType}`,
      gameType,
      gameDataRaw,
      timeLimitMin: 10
    });

    play('quiz', '{"questions":[{"q":"1+1","a":"2"}]}');
    document.getElementById('ans_0').value = '3';
    finishGame();
    play('quiz', '{"questions":[{"q":"1+1","a":"2"}]}');
    document.getElementById('ans_0').value = '2';
    finishGame();

    play('sudoku');
    checkSudokuStage();
    const sudoku = gameState.sudoku;
    const stage = sudoku.stages[sudoku.stageIndex];
    stage.puzzle.forEach((row, r) => row.forEach((cell, c) => {
      if (!cell) document.getElementById(`sudoku_${sudoku.stageIndex}_${r}_${c}`).value = String(stage.solution[r][c]);
    }));
    checkSudokuStage();

    play('crossword');
    checkCrossword();
    gameState.crossword.entries.forEach(entry => {
      gameState.crossword.answers[`${entry.r},${entry.c}`] = String(entry.answer);
    });
    checkCrossword();

    play('sifir');
    let question = gameState.sifir.questions[gameState.sifir.qIndex];
    answerSifir(question.answer);
    question = gameState.sifir.questions[gameState.sifir.qIndex];
    answerSifir(question.answer + 1);

    play('jejak_lari', '{"targetKm":1}');
    finishRun(true);
    play('jejak_lari', '{"targetKm":1}');
    finishRun(false);

    play('tangram');
    window._tgTimeout();
    return window.__playedSfx;
  });

  expect(effects).toEqual([
    'wrong', 'correct',
    'wrong', 'correct',
    'wrong', 'correct',
    'correct', 'wrong',
    'correct', 'wrong',
    'wrong'
  ]);
});

test('sound toggle persists the mute preference', async ({ page }) => {
  await openApp(page);
  const toggle = page.locator('#soundToggle');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => localStorage.getItem('gamestation_sfx_muted'))).toBe('1');

  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toHaveAccessibleName('Hidupkan bunyi');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => !!gameAudioContext)).toBe(true);
});
