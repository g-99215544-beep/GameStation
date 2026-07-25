(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.CrosswordEngine = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const G = value => ({ v: String(value) });
  const A = answer => ({ a: Number(answer) });
  const X = null;

  // Four interlocking arithmetic grids. The number cells at each intersection
  // belong to both an across and a down equation.
  const grid = [
    [G(1),G('+'),G(2),G('='),A(3), X, G(1),G('x'),G(2),G('='),A(2)],
    [G('+'),X,G('+'),X,G('+'), X, G('x'),X,G('x'),X,G('x')],
    [G(3),G('+'),G(1),G('='),A(4), X, G(3),G('x'),G(1),G('='),A(3)],
    [G('='),X,G('='),X,G('='), X, G('='),X,G('='),X,G('=')],
    [A(4),G('+'),A(3),G('='),A(7), X, A(3),G('x'),A(2),G('='),A(6)],
    [X,X,X,X,X, X, X,X,X,X,X],
    [G(9),G('-'),G(3),G('='),A(6), X, G(8),G('÷'),G(2),G('='),A(4)],
    [G('-'),X,G('-'),X,G('-'), X, G('÷'),X,G('÷'),X,G('÷')],
    [G(4),G('-'),G(1),G('='),A(3), X, G(4),G('÷'),G(2),G('='),A(2)],
    [G('='),X,G('='),X,G('='), X, G('='),X,G('='),X,G('=')],
    [A(5),G('-'),A(2),G('='),A(3), X, A(2),G('x'),A(1),G('='),A(2)]
  ];

  const PUZZLE = { cols: 11, rows: 11, grid };

  function blanks(sourceGrid) {
    const out = [];
    sourceGrid.forEach((row, r) => row.forEach((cell, c) => {
      if (cell && Object.prototype.hasOwnProperty.call(cell, 'a')) {
        out.push({ r, c, answer: cell.a });
      }
    }));
    return out;
  }

  function grade(sourceGrid, answers) {
    answers = answers || {};
    let correct = 0;
    let wrong = 0;
    let empty = 0;
    const entries = blanks(sourceGrid);
    entries.forEach(entry => {
      const raw = answers[`${entry.r},${entry.c}`];
      const value = raw == null ? '' : String(raw).trim();
      if (value === '') empty++;
      else if (value === String(entry.answer)) correct++;
      else wrong++;
    });
    return {
      total: entries.length,
      correct,
      wrong,
      empty,
      solved: correct === entries.length
    };
  }

  function evaluate(tokens) {
    if (!tokens.length || tokens.length % 2 === 0) return null;
    const numbers = [];
    const operators = [];
    for (let i = 0; i < tokens.length; i++) {
      const token = String(tokens[i]).trim();
      if (i % 2 === 0) {
        if (!/^-?\d+(?:\.\d+)?$/.test(token)) return null;
        numbers.push(Number(token));
      } else {
        const operator = token === '×' ? 'x' : token;
        if (!['+', '-', 'x', '÷', '/'].includes(operator)) return null;
        operators.push(operator);
      }
    }

    // Apply multiplication and division before addition and subtraction.
    const reducedNumbers = [numbers[0]];
    const reducedOperators = [];
    for (let i = 0; i < operators.length; i++) {
      const operator = operators[i];
      const next = numbers[i + 1];
      if (operator === 'x' || operator === '÷' || operator === '/') {
        if ((operator === '÷' || operator === '/') && next === 0) return null;
        const previous = reducedNumbers.pop();
        reducedNumbers.push(operator === 'x' ? previous * next : previous / next);
      } else {
        reducedOperators.push(operator);
        reducedNumbers.push(next);
      }
    }
    let result = reducedNumbers[0];
    for (let i = 0; i < reducedOperators.length; i++) {
      result = reducedOperators[i] === '+'
        ? result + reducedNumbers[i + 1]
        : result - reducedNumbers[i + 1];
    }
    return Number.isFinite(result) ? result : null;
  }

  function verifySolution(sourceGrid) {
    const failures = [];
    const rows = sourceGrid.length;
    const cols = rows ? Math.max(...sourceGrid.map(row => row.length)) : 0;
    const valueAt = (r, c) => {
      const cell = sourceGrid[r] && sourceGrid[r][c];
      if (!cell) return null;
      if (Object.prototype.hasOwnProperty.call(cell, 'a')) return String(cell.a);
      if (Object.prototype.hasOwnProperty.call(cell, 'v')) return String(cell.v);
      return null;
    };

    function checkRun(tokens, direction, r, c) {
      const equals = tokens.reduce((count, token) => count + (token === '=' ? 1 : 0), 0);
      if (!equals) return;
      // A lone perpendicular "=" (or another fragment with no expression on
      // both sides) is part of the crossing layout, not a complete equation.
      const split = tokens.indexOf('=');
      if (equals === 1 && (split === 0 || split === tokens.length - 1)) return;
      if (equals !== 1) {
        failures.push({ direction, r, c, tokens, reason: 'equation must contain one equals sign' });
        return;
      }
      const left = evaluate(tokens.slice(0, split));
      const right = evaluate(tokens.slice(split + 1));
      if (left === null || right === null || Math.abs(left - right) > 1e-9) {
        failures.push({ direction, r, c, tokens, reason: 'equation is not true' });
      }
    }

    for (let r = 0; r < rows; r++) {
      let c = 0;
      while (c < cols) {
        while (c < cols && valueAt(r, c) === null) c++;
        const start = c;
        const tokens = [];
        while (c < cols && valueAt(r, c) !== null) tokens.push(valueAt(r, c++));
        if (tokens.length) checkRun(tokens, 'across', r, start);
      }
    }
    for (let c = 0; c < cols; c++) {
      let r = 0;
      while (r < rows) {
        while (r < rows && valueAt(r, c) === null) r++;
        const start = r;
        const tokens = [];
        while (r < rows && valueAt(r, c) !== null) tokens.push(valueAt(r++, c));
        if (tokens.length) checkRun(tokens, 'down', start, c);
      }
    }
    return { ok: failures.length === 0, failures };
  }

  return { PUZZLE, blanks, grade, verifySolution };
});
