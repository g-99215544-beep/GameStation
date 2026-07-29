const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');
const installFakeFirebase = require('./helpers/fake-firebase.js');

const STATIONS = {
  1: { id: 1, name: 'Tangram', location: 'a', password: 'AAAAA', gameType: 'tangram', gameDataRaw: '{"tangramStages":[1,2,3]}', timeLimitMin: 10 },
  2: { id: 2, name: 'Sudoku', location: 'b', password: 'BBBBB', gameType: 'sudoku', gameDataRaw: '{"sudokuStages":[1,2,3]}', timeLimitMin: 10 },
  3: { id: 3, name: 'Lembaran', location: 'c', password: 'CCCCC', gameType: 'lembaran_kerja', gameDataRaw: '{"questions":[{"answer":"1"},{"answer":"2"},{"answer":"3"}]}', timeLimitMin: 10 },
  4: { id: 4, name: 'Crossword', location: 'd', password: 'DDDDD', gameType: 'crossword', gameDataRaw: '{}', timeLimitMin: 10 },
  5: { id: 5, name: 'Battleship', location: 'e', password: 'EEEEE', gameType: 'battleship', gameDataRaw: '{}', timeLimitMin: 10 },
  6: { id: 6, name: 'Jejak Lari', location: 'f', password: 'FFFFF', gameType: 'jejak_lari', gameDataRaw: '{"targetKm":3}', timeLimitMin: 10 }
};

function seedFor(order) {
  const groups = { 1: { id: 1, name: 'Kumpulan 1', startStation: order[0], order, loginPassword: '1001', members: [] } };
  return {
    gamestation2026: {
      config: { stations: STATIONS, groups },
      session: { status: 'active', startedAt: 1 },
      progress: { 1: { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 } }
    }
  };
}

// Boots the app as group 1 sitting at the first station of `order`, ready to
// play. Mirrors what loginAsGroup() leaves behind, without the preload screen
// (service workers do not run on file: URLs).
async function openAtStation(page, order) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(installFakeFirebase, seedFor(order));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(async () => {
    await loadConfigCache();
    currentGroupId = '1';
    sessionInfo = { status: 'active', startedAt: 1 };
    progress = { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 };
    saveSession('group', '1');
  });
}

// The student closing the tab, then coming back to a fresh page load.
async function leaveAndReturn(page, order) {
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const saved = await page.evaluate(() => localStorage.getItem(StationResume.resumeKey(currentHuntId, currentGroupId)));
  expect(saved, 'a snapshot should have been written on pagehide').not.toBeNull();
  await page.addInitScript(installFakeFirebase, seedFor(order));
  await page.reload();
  await page.evaluate(async () => {
    await loadConfigCache();
    currentGroupId = '1';
    sessionInfo = { status: 'active', startedAt: 1 };
    progress = { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 };
    loadGroupProgress();
  });
}

test('tangram resumes at 2 of 3 shapes with the clock exactly where it was left', async ({ page }) => {
  await openAtStation(page, [1, 2, 3]);
  await page.evaluate(() => { startGame(1); window._tgStart(); });

  // Solve the first two shapes, then burn some clock so the pause is measurable.
  await page.evaluate(() => window._tgCtrl.setPieces(TangramShapes.SOLUTIONS.kuda));
  await page.evaluate(() => window._tgNext());
  await page.evaluate(() => window._tgCtrl.setPieces(TangramShapes.SOLUTIONS.kucing));
  await page.evaluate(() => window._tgNext());
  await expect(page.getByText(/Stage 3 \(3\/3\): Segi Empat/)).toBeVisible();

  const before = await page.evaluate(() => { timeLeftSec = 390; return { timeLeftSec, done: gameState.tangram.done }; });
  expect(before).toEqual({ timeLeftSec: 390, done: 2 });

  await leaveAndReturn(page, [1, 2, 3]);

  await expect(page.getByRole('button', { name: /Sambung Stesen 1/ })).toBeVisible();
  await expect(page.getByText('6:30')).toBeVisible();
  await page.getByRole('button', { name: /Sambung Stesen 1/ }).click();

  // Straight back into the board, on the third shape, with two banked.
  await expect(page.getByText(/Stage 3 \(3\/3\): Segi Empat/)).toBeVisible();
  expect(await page.evaluate(() => gameState.tangram)).toEqual({ idx: 2, done: 2 });
  // The pause is the whole point: the reload gap must not cost a single second.
  expect(await page.evaluate(() => timeLeftSec)).toBe(390);
});

test('a resumed tangram keeps its banked marks when the timer runs out', async ({ page }) => {
  await openAtStation(page, [1, 2, 3]);
  await page.evaluate(() => { startGame(1); window._tgStart(); });
  await page.evaluate(() => window._tgCtrl.setPieces(TangramShapes.SOLUTIONS.kuda));
  await page.evaluate(() => window._tgNext());
  await page.evaluate(() => { timeLeftSec = 120; });
  await leaveAndReturn(page, [1, 2, 3]);
  await page.getByRole('button', { name: /Sambung Stesen 1/ }).click();

  await page.evaluate(() => { timeLeftSec = 1; tick(); });
  // 1 shape x 40 marks, no time bonus because not every shape was built.
  await expect.poll(() => page.evaluate(() => progress.completedStations['1'].score)).toBe(40);
});

test('sudoku resumes on the stage after the one already solved', async ({ page }) => {
  await openAtStation(page, [2, 1, 3]);
  await page.evaluate(() => {
    startGame(2);
    // Solve stage 1 the way checkSudokuStage() does, then stop before tapping
    // Teruskan — the exact spot where completed and stageIndex disagree.
    gameState.sudoku.completed = 1;
    gameState.correct = 1;
    timeLeftSec = 300;
  });
  await leaveAndReturn(page, [2, 1, 3]);
  await page.getByRole('button', { name: /Sambung Stesen 2/ }).click();

  const state = await page.evaluate(() => ({
    completed: gameState.sudoku.completed,
    stageIndex: gameState.sudoku.stageIndex,
    timeLeftSec
  }));
  // stageIndex moved to 1: the solved stage is not replayed.
  expect(state).toEqual({ completed: 1, stageIndex: 1, timeLeftSec: 300 });
});

test('a worksheet resumes on the question reached, keeping earlier answers', async ({ page }) => {
  await openAtStation(page, [3, 1, 2]);
  await page.evaluate(() => {
    startGame(3);
    document.getElementById('worksheetAnswer').value = '1';
    submitWorksheetAnswer();
    timeLeftSec = 480;
  });
  await leaveAndReturn(page, [3, 1, 2]);
  await page.getByRole('button', { name: /Sambung Stesen 3/ }).click();

  expect(await page.evaluate(() => ({
    currentQuestion: gameState.currentQuestion, correct: gameState.correct, timeLeftSec
  }))).toEqual({ currentQuestion: 1, correct: 1, timeLeftSec: 480 });
  await expect(page.getByText('Soalan 2 daripada 3')).toBeVisible();
});

test('a resumed crossword is the same board, not a freshly generated one', async ({ page }) => {
  await openAtStation(page, [4, 1, 2]);
  const before = await page.evaluate(() => {
    startGame(4);
    gameState.crossword.answers['__probe'] = '7';
    timeLeftSec = 500;
    return JSON.stringify(gameState.crossword.puzzle);
  });
  await leaveAndReturn(page, [4, 1, 2]);
  await page.getByRole('button', { name: /Sambung Stesen 4/ }).click();

  const after = await page.evaluate(() => ({
    puzzle: JSON.stringify(gameState.crossword.puzzle),
    probe: gameState.crossword.answers['__probe'],
    timeLeftSec
  }));
  expect(after.puzzle).toBe(before);
  expect(after.probe).toBe('7');
  expect(after.timeLeftSec).toBe(500);
});

test('a resumed battleship keeps both fleets and every shot already fired', async ({ page }) => {
  await openAtStation(page, [5, 1, 2]);
  const before = await page.evaluate(() => {
    startGame(5);
    const bs = gameState.battleship;
    bs.phase = 'firing';
    bs.playerFleet = BattleshipEngine.generateFleet();
    bs.enemyFleet = BattleshipEngine.generateFleet();
    bs.playerShotLog = { '1,1': 'hit' };
    bs.round = 3;
    timeLeftSec = 420;
    return JSON.stringify({ player: bs.playerFleet, enemy: bs.enemyFleet });
  });
  await leaveAndReturn(page, [5, 1, 2]);
  await page.getByRole('button', { name: /Sambung Stesen 5/ }).click();

  const after = await page.evaluate(() => ({
    fleets: JSON.stringify({ player: gameState.battleship.playerFleet, enemy: gameState.battleship.enemyFleet }),
    shots: gameState.battleship.playerShotLog,
    phase: gameState.battleship.phase,
    round: gameState.battleship.round,
    timeLeftSec
  }));
  expect(after.fleets).toBe(before);
  expect(after.shots).toEqual({ '1,1': 'hit' });
  expect(after.phase).toBe('firing');
  expect(after.round).toBe(3);
  expect(after.timeLeftSec).toBe(420);
});

test('a resumed run keeps its distance and its original scoring denominator', async ({ page }) => {
  await openAtStation(page, [6, 1, 2]);
  await page.evaluate(() => {
    startGame(6);
    gameState.distanceM = 1200;
    gameState.started = true;
    timeLeftSec = 240;
  });
  await leaveAndReturn(page, [6, 1, 2]);
  await page.getByRole('button', { name: /Sambung Stesen 6/ }).click();

  expect(await page.evaluate(() => ({
    distanceM: gameState.distanceM,
    // 600, not the 240 left on the clock — otherwise the time score inflates.
    totalSec: gameState.totalSec,
    timeLeftSec
  }))).toEqual({ distanceM: 1200, totalSec: 600, timeLeftSec: 240 });
  await expect(page.getByText(/jarak setakat ini/)).toBeVisible();
});

test('finishing a station clears its snapshot so it is never replayed', async ({ page }) => {
  await openAtStation(page, [3, 1, 2]);
  await page.evaluate(() => {
    startGame(3);
    timeLeftSec = 300;
    captureStationResume();
  });
  expect(await page.evaluate(() =>
    localStorage.getItem(StationResume.resumeKey(currentHuntId, currentGroupId)))).not.toBeNull();

  await page.evaluate(() => submitCompletion(true, 100, 30));
  expect(await page.evaluate(() =>
    localStorage.getItem(StationResume.resumeKey(currentHuntId, currentGroupId)))).toBeNull();
});

test('a snapshot belonging to another group is ignored', async ({ page }) => {
  await openAtStation(page, [1, 2, 3]);
  await page.evaluate(() => {
    localStorage.setItem(StationResume.resumeKey(currentHuntId, currentGroupId), JSON.stringify(
      StationResume.buildSnapshot({
        huntId: currentHuntId, groupId: '9', stId: 1, gameType: 'tangram',
        timeLeftSec: 300, elapsedSec: 100, stage: { idx: 2, done: 2 }
      })));
    loadGroupProgress();
  });
  await expect(page.getByRole('button', { name: /Sambung Stesen/ })).toHaveCount(0);
});

test('a snapshot older than the login window is ignored', async ({ page }) => {
  await openAtStation(page, [1, 2, 3]);
  await page.evaluate(() => {
    localStorage.setItem(StationResume.resumeKey(currentHuntId, currentGroupId), JSON.stringify(
      StationResume.buildSnapshot({
        huntId: currentHuntId, groupId: currentGroupId, stId: 1, gameType: 'tangram',
        timeLeftSec: 300, elapsedSec: 100, stage: { idx: 2, done: 2 },
        now: Date.now() - StationResume.MAX_AGE_MS - 1000
      })));
    loadGroupProgress();
  });
  await expect(page.getByRole('button', { name: /Sambung Stesen/ })).toHaveCount(0);
});

test('a snapshot whose game type no longer matches the station is discarded', async ({ page }) => {
  await openAtStation(page, [1, 2, 3]);
  await page.evaluate(() => {
    localStorage.setItem(StationResume.resumeKey(currentHuntId, currentGroupId), JSON.stringify(
      StationResume.buildSnapshot({
        huntId: currentHuntId, groupId: currentGroupId, stId: 1, gameType: 'sudoku',
        timeLeftSec: 300, elapsedSec: 100, stage: { stageIndex: 1, completed: 1 }
      })));
    loadGroupProgress();
  });
  await expect(page.getByRole('button', { name: /Sambung Stesen/ })).toHaveCount(0);
  expect(await page.evaluate(() =>
    localStorage.getItem(StationResume.resumeKey(currentHuntId, currentGroupId)))).toBeNull();
});

test('choosing to start over discards the snapshot and returns to the map', async ({ page }) => {
  await openAtStation(page, [1, 2, 3]);
  await page.evaluate(() => { startGame(1); window._tgStart(); timeLeftSec = 300; });
  await leaveAndReturn(page, [1, 2, 3]);
  await page.getByRole('button', { name: /Mula semula stesen ini/ }).click();
  expect(await page.evaluate(() =>
    localStorage.getItem(StationResume.resumeKey(currentHuntId, currentGroupId)))).toBeNull();
});

test('a test drive never writes a resume snapshot', async ({ page }) => {
  await openAtStation(page, [1, 2, 3]);
  await page.evaluate(() => {
    window._testMode = true;
    startGame(1);
    window._tgStart();
    timeLeftSec = 300;
    captureStationResume();
  });
  expect(await page.evaluate(() =>
    localStorage.getItem(StationResume.resumeKey(currentHuntId, currentGroupId)))).toBeNull();
});
