(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.SifirEngine = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const SIFIR_TARGET = 15;
  const PER_QUESTION_SEC = 4;
  const TIERS = [
    [2, 3, 4, 5],
    [3, 4, 5, 6, 7],
    [6, 7, 8, 9]
  ];

  function shuffled(values, rng) {
    const out = values.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function buildChoices(answer, rng) {
    rng = rng || Math.random;
    const options = [Number(answer)];
    const offsets = [-1, 1, -2, 2, -3, 3, -5, 5, -10, 10];
    for (const offset of shuffled(offsets, rng)) {
      const candidate = Number(answer) + offset;
      if (candidate > 0 && !options.includes(candidate)) options.push(candidate);
      if (options.length === 4) break;
    }
    // All multiplication answers here are at least four, but this keeps the
    // helper safe and deterministic if it is reused with another answer.
    for (let candidate = 1; options.length < 4; candidate++) {
      if (candidate !== Number(answer) && !options.includes(candidate)) options.push(candidate);
    }
    return shuffled(options, rng);
  }

  function pairPool(tier, used) {
    const pool = [];
    tier.forEach((a, index) => tier.slice(index).forEach(b => {
      const key = `${a}x${b}`;
      if (!used.has(key)) pool.push({ a, b, key });
    }));
    return pool;
  }

  function generateQuestions(rng) {
    rng = rng || Math.random;
    const used = new Set();
    const questions = [];
    for (let tierIndex = 0; tierIndex < TIERS.length; tierIndex++) {
      const tier = TIERS[tierIndex];
      for (let index = 0; index < 5; index++) {
        const pool = pairPool(tier, used);
        const pair = pool[Math.floor(rng() * pool.length)];
        used.add(pair.key);
        const answer = pair.a * pair.b;
        questions.push({ a: pair.a, b: pair.b, answer, choices: buildChoices(answer, rng) });
      }
    }
    return questions;
  }

  function scoreFromTime(remainingSec, totalSec) {
    const total = Number(totalSec);
    const remaining = Number(remainingSec);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(remaining) || remaining <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round(remaining / total * 100)));
  }

  return { SIFIR_TARGET, PER_QUESTION_SEC, generateQuestions, buildChoices, scoreFromTime };
});
