const test = require('node:test');
const assert = require('node:assert');
const E = require('./engine.js');

test('readHp treats a missing value as full health', () => {
  assert.strictEqual(E.readHp(undefined), 100);
  assert.strictEqual(E.readHp({}), 100);
  assert.strictEqual(E.readHp({ hp: null }), 100);
  assert.strictEqual(E.readHp({ hp: 'abc' }), 100);
  assert.strictEqual(E.readHp({ hp: 90 }), 90);
});

test('readHp clamps stored values into the legal range', () => {
  assert.strictEqual(E.readHp({ hp: 250 }), 100);
  assert.strictEqual(E.readHp({ hp: 10 }), 50);
  assert.strictEqual(E.readHp({ hp: -5 }), 50);
});

test('clampDamage keeps the teacher setting inside 1..50', () => {
  assert.strictEqual(E.clampDamage(10), 10);
  assert.strictEqual(E.clampDamage(0), 1);
  assert.strictEqual(E.clampDamage(80), 50);
  assert.strictEqual(E.clampDamage(10.4), 10);
  assert.strictEqual(E.clampDamage('abc'), E.DEFAULT_DAMAGE);
  assert.strictEqual(E.clampDamage(undefined), E.DEFAULT_DAMAGE);
  assert.strictEqual(E.clampDamage(null), E.DEFAULT_DAMAGE);
  assert.strictEqual(E.clampDamage(''), E.DEFAULT_DAMAGE);
  assert.strictEqual(E.clampDamage('   '), E.DEFAULT_DAMAGE);
});

test('clampStartingAmmo keeps the teacher setting inside 0..99', () => {
  assert.strictEqual(E.clampStartingAmmo(4), 4);
  assert.strictEqual(E.clampStartingAmmo(4.9), 4);
  assert.strictEqual(E.clampStartingAmmo(-2), 0);
  assert.strictEqual(E.clampStartingAmmo(120), 99);
  assert.strictEqual(E.clampStartingAmmo('abc'), E.DEFAULT_STARTING_AMMO);
  assert.strictEqual(E.clampStartingAmmo(undefined), E.DEFAULT_STARTING_AMMO);
  assert.strictEqual(E.clampStartingAmmo(''), E.DEFAULT_STARTING_AMMO);
});

test('applyDamage stops exactly at the floor and never goes below', () => {
  assert.strictEqual(E.applyDamage(100, 10), 90);
  assert.strictEqual(E.applyDamage(55, 10), 50);
  assert.strictEqual(E.applyDamage(50, 10), 50);
  // 100 shots is past the floor for every damage value: the slowest, damage 1,
  // needs 50 to walk 100 down to 50.
  for (let damage = 1; damage <= 50; damage++) {
    let hp = 100;
    for (let shot = 0; shot < 100; shot++) hp = E.applyDamage(hp, damage);
    assert.strictEqual(hp, E.MIN_HP, `damage ${damage} should settle at the floor`);
  }
});

test('effectiveScore multiplies station marks by HP and rounds', () => {
  assert.strictEqual(E.effectiveScore(300, 70), 210);
  assert.strictEqual(E.effectiveScore(0, 50), 0);
  assert.strictEqual(E.effectiveScore(255, 90), 230);   // 229.5 rounds up
  assert.strictEqual(E.effectiveScore(100, undefined), 100);
});

test('finalScore leaves the finish bonus undamaged', () => {
  assert.strictEqual(E.finalScore(300, 70, 50), 260);   // 210 + 50
  assert.strictEqual(E.finalScore(300, 100, 50), 350);
  assert.strictEqual(E.finalScore(300, 70, 0), 210);
});

test('a hunt saved before cannons existed scores exactly as before', () => {
  const legacy = { totalScore: 480 };
  assert.strictEqual(E.finalScore(legacy.totalScore, legacy.hp, 40), 520);
});

test('isInBattle excludes groups that already opened their chest', () => {
  assert.strictEqual(E.isInBattle({ status: 'idle' }), true);
  assert.strictEqual(E.isInBattle({ status: 'ready_chest' }), true);
  assert.strictEqual(E.isInBattle(undefined), true);
  assert.strictEqual(E.isInBattle({ status: 'won' }), false);
});

test('claiming the same cannon twice awards only one cannonball', () => {
  const first = E.claimBullet({ ammo: 0 }, 'c1', 111);
  assert.deepStrictEqual(first, { ammo: 1, claimed: { c1: 111 } });

  const progress = { ammo: 1, claimed: { c1: 111 } };
  assert.strictEqual(E.claimBullet(progress, 'c1', 222), null);

  const second = E.claimBullet(progress, 'c2', 222);
  assert.deepStrictEqual(second, { ammo: 2, claimed: { c1: 111, c2: 222 } });
});

test('claiming a cannon never exceeds the database ammo limit', () => {
  assert.deepStrictEqual(E.claimBullet({ ammo: 99 }, 'c1', 111), {
    ammo: 99,
    claimed: { c1: 111 }
  });
  assert.strictEqual(E.readAmmo({ ammo: 500 }), 99);
});

test('summarizeIncoming collapses several hits into one summary', () => {
  assert.strictEqual(E.summarizeIncoming(null), null);
  assert.strictEqual(E.summarizeIncoming({}), null);

  const summary = E.summarizeIncoming({
    a: { from: '3', ts: 100, damage: 10, hpAfter: 90 },
    b: { from: '7', ts: 300, damage: 10, hpAfter: 70 },
    c: { from: '5', ts: 200, damage: 10, hpAfter: 80 }
  });
  assert.strictEqual(summary.count, 3);
  assert.strictEqual(summary.from, '7');            // the most recent shooter
  assert.strictEqual(summary.hpAfter, 70);          // the lowest HP reached
  assert.deepStrictEqual(summary.ids.sort(), ['a', 'b', 'c']);
});

test('stripCannonFields removes cannon state and keeps everything else', () => {
  const payload = {
    currentIndex: 3, keys: [1, 2, 3], totalScore: 240, status: 'idle',
    completedStations: { 1: { score: 80 } },
    hp: 100, ammo: 2, claimed: { c1: 1 }, incoming: { a: {} }
  };
  const clean = E.stripCannonFields(payload);
  assert.deepStrictEqual(Object.keys(clean).sort(),
    ['completedStations', 'currentIndex', 'keys', 'status', 'totalScore']);
  assert.strictEqual(clean.totalScore, 240);
  assert.deepStrictEqual(clean.keys, [1, 2, 3]);
  assert.strictEqual(payload.hp, 100, 'the input must not be mutated');
});

test('isPerfect knows each game type\'s perfect score', () => {
  // Percentage-scored types: 100 is a clean sweep.
  ['lembaran_kerja', 'quiz', 'pilihan', 'sudoku', 'crossword', 'battleship'].forEach(type => {
    assert.strictEqual(E.isPerfect(type, 100, true), true, type);
    assert.strictEqual(E.isPerfect(type, 99, true), false, type);
    assert.strictEqual(E.isPerfect(type, 100, false), false, type + ' late');
  });

  // Tangram scores out of 200: three shapes at 40 each, plus up to 80 for speed.
  // Finishing all three is the bar; the time bonus must not be required.
  assert.strictEqual(E.isPerfect('tangram', 120, true), true);
  assert.strictEqual(E.isPerfect('tangram', 200, true), true);
  assert.strictEqual(E.isPerfect('tangram', 80, true), false);   // only two shapes

  // Sifir and Jejak Lari score from the time left, so 100 is unreachable.
  // Their success flag is the onTime argument, and a failure scores 0.
  assert.strictEqual(E.isPerfect('sifir', 45, true), true);
  assert.strictEqual(E.isPerfect('sifir', 0, true), false);
  assert.strictEqual(E.isPerfect('sifir', 45, false), false);
  assert.strictEqual(E.isPerfect('jejak_lari', 30, true), true);
  assert.strictEqual(E.isPerfect('jejak_lari', 0, true), false);

  // An unknown type falls back to the strictest bar.
  assert.strictEqual(E.isPerfect('mystery', 100, true), true);
  assert.strictEqual(E.isPerfect('mystery', 90, true), false);
});

test('findByPassword matches case-insensitively', () => {
  const cannons = { c1: { id: 'c1', password: 'K7f2M' }, c2: { id: 'c2', password: 'ABCDE' } };
  assert.strictEqual(E.findByPassword(cannons, 'k7F2m'), 'c1');
  assert.strictEqual(E.findByPassword(cannons, 'ABCDE'), 'c2');
  assert.strictEqual(E.findByPassword(cannons, 'ZZZZZ'), null);
  assert.strictEqual(E.findByPassword(null, 'ABCDE'), null);
});

test('passwordConflicts reports collisions with stations and other cannons', () => {
  const stations = { 1: { id: 1, password: 'ABCDE' }, 2: { id: 2, password: 'FGHIJ' } };
  assert.deepStrictEqual(E.passwordConflicts(stations, { c1: { id: 'c1', password: 'KLMNO' } }), []);

  const clash = E.passwordConflicts(stations, { c1: { id: 'c1', password: 'abcde' } });
  assert.strictEqual(clash.length, 1);
  assert.strictEqual(clash[0].a, 'Stesen 1');
  assert.strictEqual(clash[0].b, 'Meriam c1');

  const twins = E.passwordConflicts({}, {
    c1: { id: 'c1', password: 'KLMNO' }, c2: { id: 'c2', password: 'KLMNO' }
  });
  assert.strictEqual(twins.length, 1);
  assert.strictEqual(twins[0].a, 'Meriam c1');
  assert.strictEqual(twins[0].b, 'Meriam c2');
});
