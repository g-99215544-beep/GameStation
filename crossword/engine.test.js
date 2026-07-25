const test = require('node:test');
const assert = require('node:assert');
const E = require('./engine.js');

test('the shipped 11x11 puzzle has twenty blanks and a valid solution', () => {
  assert.strictEqual(E.PUZZLE.cols, 11);
  assert.strictEqual(E.PUZZLE.rows, 11);
  assert.strictEqual(E.PUZZLE.grid.length, 11);
  assert.ok(E.PUZZLE.grid.every(row => row.length === 11));
  const entries = E.blanks(E.PUZZLE.grid);
  assert.strictEqual(entries.length, 20);
  assert.ok(entries.every(entry => Number.isInteger(entry.answer) && entry.answer >= 0 && entry.answer <= 9));
  assert.deepStrictEqual(E.verifySolution(E.PUZZLE.grid), { ok: true, failures: [] });
});

test('blanks returns each fillable cell once in row-major order', () => {
  const grid = [
    [{ a: 6 }, null, { v: '+' }],
    [{ v: '2' }, { a: 0 }, { a: 9 }]
  ];
  assert.deepStrictEqual(E.blanks(grid), [
    { r: 0, c: 0, answer: 6 },
    { r: 1, c: 1, answer: 0 },
    { r: 1, c: 2, answer: 9 }
  ]);
});

test('grade counts correct, wrong, and empty answers', () => {
  const grid = [[{ a: 6 }, { a: 0 }, { a: 9 }]];
  assert.deepStrictEqual(E.grade(grid, {
    '0,0': '6',
    '0,1': '7',
    '0,2': ''
  }), {
    total: 3,
    correct: 1,
    wrong: 1,
    empty: 1,
    solved: false
  });
});

test('grade only reports solved for the complete answer key', () => {
  const entries = E.blanks(E.PUZZLE.grid);
  const answers = Object.fromEntries(entries.map(cell => [`${cell.r},${cell.c}`, String(cell.answer)]));
  const result = E.grade(E.PUZZLE.grid, answers);
  assert.deepStrictEqual(result, {
    total: entries.length,
    correct: entries.length,
    wrong: 0,
    empty: 0,
    solved: true
  });
  delete answers[`${entries[0].r},${entries[0].c}`];
  assert.strictEqual(E.grade(E.PUZZLE.grid, answers).solved, false);
});

test('verifySolution reports a false across or down equation', () => {
  const invalid = [[{ v: '2' }, { v: '+' }, { a: 3 }, { v: '=' }, { v: '9' }]];
  const result = E.verifySolution(invalid);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.failures.length, 1);
  assert.strictEqual(result.failures[0].direction, 'across');
});
