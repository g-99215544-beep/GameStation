const test = require('node:test');
const assert = require('node:assert');
const Resume = require('./resume.js');

const CONTEXT = { huntId: 'h1', groupId: '3', stId: 5, now: 1000 };

function snapshot(overrides) {
  return Resume.buildSnapshot({
    huntId: 'h1', groupId: '3', stId: 5, gameType: 'tangram',
    timeLeftSec: 390, elapsedSec: 210, stage: { idx: 2, done: 2 }, now: 900,
    ...overrides
  });
}

test('the key is namespaced per hunt and per group', () => {
  assert.strictEqual(Resume.resumeKey('h1', '3'), 'gs_station_resume_h1_3');
  assert.strictEqual(Resume.resumeKey(null, '3'), 'gs_station_resume_3');
});

test('buildSnapshot keeps the remaining time exactly as handed in', () => {
  const snap = Resume.buildSnapshot({
    huntId: 'h1', groupId: '3', stId: 5, gameType: 'tangram',
    timeLeftSec: 390.4, elapsedSec: 209.6, stage: { idx: 2, done: 2 }, now: 42
  });
  assert.strictEqual(snap.timeLeftSec, 390);
  assert.strictEqual(snap.elapsedSec, 210);
  assert.strictEqual(snap.ts, 42);
  assert.deepStrictEqual(snap.stage, { idx: 2, done: 2 });
});

test('buildSnapshot survives missing and malformed input', () => {
  const snap = Resume.buildSnapshot({});
  assert.strictEqual(snap.timeLeftSec, 0);
  assert.deepStrictEqual(snap.stage, {});
  const bad = Resume.buildSnapshot({ timeLeftSec: -50, stage: 'not-an-object' });
  assert.strictEqual(bad.timeLeftSec, 0);
  assert.deepStrictEqual(bad.stage, {});
});

test('a matching snapshot is usable', () => {
  assert.strictEqual(Resume.isUsable(snapshot(), CONTEXT), true);
});

test('a snapshot from another group, hunt, or station is refused', () => {
  assert.strictEqual(Resume.isUsable(snapshot({ groupId: '4' }), CONTEXT), false);
  assert.strictEqual(Resume.isUsable(snapshot({ huntId: 'h2' }), CONTEXT), false);
  assert.strictEqual(Resume.isUsable(snapshot({ stId: 6 }), CONTEXT), false);
});

test('a snapshot older than twelve hours is refused', () => {
  const stale = snapshot({ now: 1 });
  assert.strictEqual(Resume.isUsable(stale, { ...CONTEXT, now: 1 + Resume.MAX_AGE_MS + 1 }), false);
  assert.strictEqual(Resume.isUsable(stale, { ...CONTEXT, now: 1 + Resume.MAX_AGE_MS - 1 }), true);
});

test('an expired timer is refused — the station is over, not paused', () => {
  assert.strictEqual(Resume.isUsable(snapshot({ timeLeftSec: 0 }), CONTEXT), false);
});

test('garbage is refused instead of throwing', () => {
  assert.strictEqual(Resume.isUsable(null, CONTEXT), false);
  assert.strictEqual(Resume.isUsable('nope', CONTEXT), false);
  assert.strictEqual(Resume.isUsable({}, CONTEXT), false);
  assert.strictEqual(Resume.isUsable(snapshot({ gameType: '' }), CONTEXT), false);
});

test('captureStage records tangram shapes completed', () => {
  assert.deepStrictEqual(
    Resume.captureStage('tangram', { tangram: { idx: 2, done: 2 } }), { idx: 2, done: 2 });
});

test('captureStage records the sudoku stage reached', () => {
  assert.deepStrictEqual(
    Resume.captureStage('sudoku', { sudoku: { stageIndex: 1, completed: 1 } }),
    { stageIndex: 1, completed: 1 });
});

test('captureStage carries the generated crossword board, not just the answers', () => {
  const puzzle = { cols: 11, rows: 11, grid: [['a']] };
  const stage = Resume.captureStage('crossword', { crossword: { puzzle, answers: { '0,0': '4' } } });
  assert.deepStrictEqual(stage.puzzle, puzzle);
  assert.deepStrictEqual(stage.answers, { '0,0': '4' });
});

test('captureStage carries both battleship fleets so the enemy is not re-rolled', () => {
  const stage = Resume.captureStage('battleship', {
    correct: 2,
    battleship: {
      phase: 'firing', playerFleet: [{ name: 'A' }], enemyFleet: [{ name: 'B' }],
      playerShotLog: { '1,1': 'hit' }, enemyShotLog: {}, round: 4
    }
  });
  assert.deepStrictEqual(stage.playerFleet, [{ name: 'A' }]);
  assert.deepStrictEqual(stage.enemyFleet, [{ name: 'B' }]);
  assert.strictEqual(stage.phase, 'firing');
  assert.strictEqual(stage.round, 4);
  assert.strictEqual(stage.correct, 2);
});

test('captureStage copies mutable state rather than aliasing it', () => {
  const live = { crossword: { puzzle: null, answers: { '0,0': '4' } } };
  const stage = Resume.captureStage('crossword', live);
  live.crossword.answers['1,1'] = '9';
  assert.deepStrictEqual(stage.answers, { '0,0': '4' });
});

test('captureStage records run distance and the original time limit', () => {
  assert.deepStrictEqual(
    Resume.captureStage('jejak_lari', { distanceM: 1200, started: true, totalSec: 600 }),
    { distanceM: 1200, started: true, totalSec: 600 });
});

// runScore divides by totalSec. Carrying the clock left on resume instead of the
// station's full limit would shrink the denominator and inflate the marks.
test('captureStage carries totalSec so a resumed run is not over-scored', () => {
  const stage = Resume.captureStage('jejak_lari', { distanceM: 500, started: true, totalSec: 600 });
  assert.strictEqual(stage.totalSec, 600);
});

test('captureStage gives sifir an empty stage — its set restarts at question 1', () => {
  assert.deepStrictEqual(Resume.captureStage('sifir', { sifir: { qIndex: 7 } }), {});
});

test('captureStage tolerates a game state that has not been built yet', () => {
  assert.deepStrictEqual(Resume.captureStage('tangram', {}), { idx: 0, done: 0 });
  assert.deepStrictEqual(Resume.captureStage('battleship', null).playerFleet, []);
});

test('captureStage produces a JSON-safe payload for every game type', () => {
  ['tangram', 'sudoku', 'lembaran_kerja', 'crossword', 'battleship', 'jejak_lari', 'sifir']
    .forEach(type => {
      const stage = Resume.captureStage(type, {});
      assert.deepStrictEqual(JSON.parse(JSON.stringify(stage)), stage, `${type} stage must survive a round-trip`);
    });
});
