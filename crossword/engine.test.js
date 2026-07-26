const test = require('node:test');
const assert = require('node:assert');
const E = require('./engine.js');

test('the fallback 11x11 board has twenty blanks and a valid solution', () => {
  assert.strictEqual(E.PUZZLE.cols, 11);
  assert.strictEqual(E.PUZZLE.rows, 11);
  assert.strictEqual(E.PUZZLE.grid.length, 11);
  assert.ok(E.PUZZLE.grid.every(row => row.length === 11));
  const entries = E.blanks(E.PUZZLE.grid);
  assert.strictEqual(entries.length, 20);
  assert.ok(entries.every(entry => Number.isInteger(entry.answer) && entry.answer >= 0 && entry.answer <= 9));
  assert.deepStrictEqual(E.verifySolution(E.PUZZLE.grid), { ok: true, failures: [] });
});

test('generatePuzzle produces a valid, solvable, nine-blank board every time', () => {
  const OPERATORS = ['+', '-', 'x', '÷'];
  for (let i = 0; i < 500; i++) {
    const puzzle = E.generatePuzzle();
    assert.strictEqual(puzzle.cols, 11);
    assert.strictEqual(puzzle.rows, 11);
    assert.deepStrictEqual(E.verifySolution(puzzle.grid), { ok: true, failures: [] });

    const entries = E.blanks(puzzle.grid);
    assert.strictEqual(entries.length, 9);
    entries.forEach(entry => {
      assert.ok(Number.isInteger(entry.answer) && entry.answer >= 0);
      assert.ok(String(entry.answer).length <= 7);
    });

    const seenOps = new Set();
    puzzle.grid.forEach(row => row.forEach(cell => {
      if (cell && cell.v && OPERATORS.includes(cell.v)) seenOps.add(cell.v);
    }));
    OPERATORS.forEach(op => assert.ok(seenOps.has(op), `missing operator ${op} in a generated board`));
  }
});

test('generatePuzzle never exceeds the 7-digit ceiling implied by the difficulty caps', () => {
  // Operand caps are +/-: 6 digits, x: 5x2 digits, ÷: 4-digit dividend. The
  // widest a *result* can get is a 6-digit+5-digit sum or a 5x2-digit
  // product, both of which top out at 7 digits.
  for (let i = 0; i < 200; i++) {
    const puzzle = E.generatePuzzle();
    const allNumbers = [];
    puzzle.grid.forEach(row => row.forEach(cell => {
      if (!cell) return;
      if (Object.prototype.hasOwnProperty.call(cell, 'a')) allNumbers.push(cell.a);
      else if (/^\d+$/.test(cell.v)) allNumbers.push(Number(cell.v));
    }));
    const maxDigits = Math.max(...allNumbers.map(n => String(n).length));
    assert.ok(maxDigits <= 7, `unexpectedly large number (${maxDigits} digits) in a generated board`);
  }
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
