const test = require('node:test');
const assert = require('node:assert');
const E = require('./engine.js');

function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('generates 15 correct, distinct multiplication questions', () => {
  const questions = E.generateQuestions(seeded(1));
  assert.strictEqual(questions.length, E.SIFIR_TARGET);
  const pairs = new Set();
  questions.forEach(question => {
    assert.strictEqual(question.answer, question.a * question.b);
    const key = [question.a, question.b].sort((a, b) => a - b).join('x');
    assert.ok(!pairs.has(key), `duplicate pair ${key}`);
    pairs.add(key);
    assert.strictEqual(question.choices.length, 4);
    assert.ok(question.choices.includes(question.answer));
    assert.strictEqual(new Set(question.choices).size, 4);
  });
});

test('uses the intended easy, medium, and hard factor tiers', () => {
  const questions = E.generateQuestions(seeded(2));
  const tiers = [[2,3,4,5], [3,4,5,6,7], [6,7,8,9]];
  questions.forEach((question, index) => {
    const tier = tiers[Math.floor(index / 5)];
    assert.ok(tier.includes(question.a), `a at question ${index + 1}`);
    assert.ok(tier.includes(question.b), `b at question ${index + 1}`);
  });
});

test('different seeded generators produce different sets', () => {
  const first = E.generateQuestions(seeded(3)).map(q => [q.a, q.b]);
  const second = E.generateQuestions(seeded(4)).map(q => [q.a, q.b]);
  assert.notDeepStrictEqual(first, second);
});

test('buildChoices always creates four unique options including the answer', () => {
  const choices = E.buildChoices(42, seeded(5));
  assert.strictEqual(choices.length, 4);
  assert.ok(choices.includes(42));
  assert.strictEqual(new Set(choices).size, 4);
  choices.forEach(choice => assert.ok(choice > 0));
});

test('scoreFromTime is clamped and rounded as a percentage', () => {
  assert.strictEqual(E.scoreFromTime(600, 600), 100);
  assert.strictEqual(E.scoreFromTime(0, 600), 0);
  assert.strictEqual(E.scoreFromTime(-1, 600), 0);
  assert.strictEqual(E.scoreFromTime(300, 600), 50);
  assert.strictEqual(E.scoreFromTime(1000, 600), 100);
});
