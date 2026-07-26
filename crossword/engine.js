(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.CrosswordEngine = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const G = value => ({ v: String(value) });
  const A = answer => ({ a: Number(answer) });
  const X = null;

  // Fallback board used only if the generator somehow fails to produce a
  // verifiable puzzle (see generatePuzzle) so the game never breaks in class.
  const FALLBACK_GRID = [
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
  const FALLBACK_PUZZLE = { cols: 11, rows: 11, grid: FALLBACK_GRID };
  // Kept for backward compatibility with code/tests that reference the
  // built-in board directly instead of calling generatePuzzle().
  const PUZZLE = FALLBACK_PUZZLE;

  // Three "T-shaped" blocks of three interlocking equations each:
  //   A  : n1 opA  n2 = n3   (across)
  //   D1 : n1 opD1 n4 = n5   (down, shares n1 with A)
  //   D2 : n2 opD2 n6 = n7   (down, shares n2 with A)
  // n1/n2 are always the LEFT operand in every equation they appear in, so
  // sharing them never forces a division-by-shared-cell edge case.
  const BLOCK_ORIGINS = [[0, 0], [0, 6], [6, 3]];

  // Digit-length caps per operator/difficulty tier, taken from the teacher's
  // brief: max 6+5 digits for +/-, max 5x2 for x, max 4-digit dividend for ÷
  // (divisor always a single digit 2-9).
  const LEN = {
    '+': { mudah: { left: 2, right: 2 }, sederhana: { left: 3, right: 3 }, susah: { left: 6, right: 5 } },
    '-': { mudah: { left: 2, right: 2 }, sederhana: { left: 3, right: 3 }, susah: { left: 6, right: 5 } },
    'x': { mudah: { left: 1, right: 1 }, sederhana: { left: 3, right: 1 }, susah: { left: 5, right: 2 } },
    '÷': { mudah: { left: 2, right: 1 }, sederhana: { left: 3, right: 1 }, susah: { left: 4, right: 1 } }
  };
  const OPERATORS = ['+', '-', 'x', '÷'];
  const TIERS = ['mudah', 'sederhana', 'susah'];

  function randInt(rng, min, max) {
    return min + Math.floor(rng() * (max - min + 1));
  }
  function randDigits(rng, len) {
    const clamped = Math.max(1, len);
    const min = Math.pow(10, clamped - 1);
    const max = Math.pow(10, clamped) - 1;
    return randInt(rng, min, max);
  }
  function shuffle(rng, arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = randInt(rng, 0, i);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
  function pick(rng, arr) {
    return arr[randInt(rng, 0, arr.length - 1)];
  }
  function applyOp(op, a, b) {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    return a * b;
  }
  // Finds a divisor 2-9 and a quotient so the dividend lands near the
  // requested digit length while dividing evenly.
  function randomDivision(rng, dividendLen) {
    const divisor = randInt(rng, 2, 9);
    const min = Math.pow(10, Math.max(0, dividendLen - 1));
    const max = Math.pow(10, dividendLen) - 1;
    let qMin = Math.ceil(min / divisor);
    let qMax = Math.floor(max / divisor);
    if (qMin > qMax) qMin = qMax = Math.max(1, qMin);
    const quotient = randInt(rng, qMin, qMax);
    return { dividend: divisor * quotient, divisor, quotient };
  }

  function assignSlots(rng) {
    const ops = shuffle(rng, OPERATORS.concat([1, 2, 3, 4, 5].map(() => pick(rng, OPERATORS))));
    const tiers = shuffle(rng, TIERS.concat(TIERS).concat(TIERS));
    const blocks = [];
    for (let b = 0; b < 3; b++) {
      const spec = {
        opA: ops[b * 3], opD1: ops[b * 3 + 1], opD2: ops[b * 3 + 2],
        tierA: tiers[b * 3], tierD1: tiers[b * 3 + 1], tierD2: tiers[b * 3 + 2]
      };
      // n1/n2 are always the left operand, never a divisor, so keep "÷" off
      // the across equation (A) to avoid a shared cell needing to be both a
      // multi-digit operand and a single-digit divisor at once.
      if (spec.opA === '÷') {
        if (spec.opD1 !== '÷') {
          [spec.opA, spec.opD1] = [spec.opD1, spec.opA];
          [spec.tierA, spec.tierD1] = [spec.tierD1, spec.tierA];
        } else if (spec.opD2 !== '÷') {
          [spec.opA, spec.opD2] = [spec.opD2, spec.opA];
          [spec.tierA, spec.tierD2] = [spec.tierD2, spec.tierA];
        } else {
          spec.opA = '+';
        }
      }
      blocks.push(spec);
    }
    return blocks;
  }

  function buildBlock(rng, spec) {
    const { opA, opD1, opD2, tierA, tierD1, tierD2 } = spec;
    const n1Len = Math.min(LEN[opA][tierA].left, LEN[opD1][tierD1].left);
    const n2Len = Math.min(LEN[opA][tierA].right, LEN[opD2][tierD2].left);

    let n1, n4, n5;
    if (opD1 === '÷') {
      ({ dividend: n1, divisor: n4, quotient: n5 } = randomDivision(rng, n1Len));
    } else {
      n1 = randDigits(rng, n1Len);
    }

    let n2, n6, n7;
    if (opD2 === '÷') {
      ({ dividend: n2, divisor: n6, quotient: n7 } = randomDivision(rng, n2Len));
    } else {
      n2 = randDigits(rng, n2Len);
    }

    if (opA === '-' && n1 < n2) {
      if (opD1 === '÷') n2 = randInt(rng, 1, n1);
      else if (opD2 === '÷') n1 = randInt(rng, n2, n2 * 9 + 9);
      else [n1, n2] = [n2, n1];
    }
    const n3 = applyOp(opA, n1, n2);

    if (opD1 !== '÷') {
      n4 = randDigits(rng, LEN[opD1][tierD1].right);
      if (opD1 === '-' && n4 > n1) n4 = randInt(rng, 1, n1);
      n5 = applyOp(opD1, n1, n4);
    }
    if (opD2 !== '÷') {
      n6 = randDigits(rng, LEN[opD2][tierD2].right);
      if (opD2 === '-' && n6 > n2) n6 = randInt(rng, 1, n2);
      n7 = applyOp(opD2, n2, n6);
    }

    return { opA, opD1, opD2, n1, n2, n3, n4, n5, n6, n7 };
  }

  function blockLayout(originR, originC) {
    return {
      n1: [originR, originC], n2: [originR, originC + 2], n3: [originR, originC + 4],
      n4: [originR + 2, originC], n5: [originR + 4, originC],
      n6: [originR + 2, originC + 2], n7: [originR + 4, originC + 2]
    };
  }
  const cellKey = ([r, c]) => `${r},${c}`;

  function chooseBlanks(rng, blocks) {
    const blanked = new Set();
    BLOCK_ORIGINS.forEach(([originR, originC], i) => {
      const pos = blockLayout(originR, originC);
      [['n1', 'n2', 'n3'], ['n1', 'n4', 'n5'], ['n2', 'n6', 'n7']].forEach(members => {
        const candidates = members.filter(m => !blanked.has(cellKey(pos[m])));
        blanked.add(cellKey(pos[pick(rng, candidates)]));
      });
    });
    return blanked;
  }

  function buildGridFromBlocks(blocks, blankSet) {
    const grid = Array.from({ length: 11 }, () => Array(11).fill(null));
    const numCell = (r, c, value) => { grid[r][c] = blankSet.has(`${r},${c}`) ? A(value) : G(value); };
    BLOCK_ORIGINS.forEach(([originR, originC], i) => {
      const b = blocks[i];
      numCell(originR, originC, b.n1);
      grid[originR][originC + 1] = G(b.opA);
      numCell(originR, originC + 2, b.n2);
      grid[originR][originC + 3] = G('=');
      numCell(originR, originC + 4, b.n3);

      grid[originR + 1][originC] = G(b.opD1);
      grid[originR + 1][originC + 2] = G(b.opD2);

      numCell(originR + 2, originC, b.n4);
      numCell(originR + 2, originC + 2, b.n6);

      grid[originR + 3][originC] = G('=');
      grid[originR + 3][originC + 2] = G('=');

      numCell(originR + 4, originC, b.n5);
      numCell(originR + 4, originC + 2, b.n7);
    });
    return grid;
  }

  function generatePuzzle(rngFn) {
    const rng = rngFn || Math.random;
    for (let attempt = 0; attempt < 50; attempt++) {
      const blocks = assignSlots(rng).map(spec => buildBlock(rng, spec));
      const blankSet = chooseBlanks(rng, blocks);
      const grid = buildGridFromBlocks(blocks, blankSet);
      if (verifySolution(grid).ok) return { cols: 11, rows: 11, grid };
    }
    return FALLBACK_PUZZLE;
  }

  function formatNumber(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  }

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

  return { PUZZLE, generatePuzzle, formatNumber, blanks, grade, verifySolution };
});
