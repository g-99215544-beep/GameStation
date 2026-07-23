const test = require('node:test');
const assert = require('node:assert');
const R = require('./tracker.js');

test('parseTargetKm reads targetKm', () => {
  assert.strictEqual(R.parseTargetKm('{"targetKm":5}'), 5);
});
test('parseTargetKm defaults to 3 on junk / missing / non-positive', () => {
  assert.strictEqual(R.parseTargetKm(''), 3);
  assert.strictEqual(R.parseTargetKm('not json'), 3);
  assert.strictEqual(R.parseTargetKm('{"targetKm":0}'), 3);
  assert.strictEqual(R.parseTargetKm('{"targetKm":-2}'), 3);
});

test('haversineMeters ~111.32m per 0.001 deg latitude', () => {
  const d = R.haversineMeters({lat:1.5, lng:110}, {lat:1.501, lng:110});
  assert.ok(Math.abs(d - 111.32) < 1.0, `got ${d}`);
});

test('accumulate seeds lastPt on first point, adds no distance', () => {
  const s = R.accumulate({distanceM:0, lastPt:null}, {lat:1.5, lng:110, acc:5});
  assert.strictEqual(s.distanceM, 0);
  assert.deepStrictEqual(s.lastPt, {lat:1.5, lng:110});
});
test('accumulate adds a normal step', () => {
  let s = {distanceM:0, lastPt:{lat:1.5, lng:110}};
  s = R.accumulate(s, {lat:1.5004, lng:110, acc:5}); // ~44m
  assert.ok(s.distanceM > 40 && s.distanceM < 50, `got ${s.distanceM}`);
});
test('accumulate ignores low-accuracy fixes', () => {
  const before = {distanceM:10, lastPt:{lat:1.5, lng:110}};
  const s = R.accumulate(before, {lat:1.5004, lng:110, acc:99});
  assert.strictEqual(s.distanceM, 10);
});
test('accumulate ignores sub-metre noise', () => {
  const before = {distanceM:10, lastPt:{lat:1.5, lng:110}};
  const s = R.accumulate(before, {lat:1.500001, lng:110, acc:5});
  assert.strictEqual(s.distanceM, 10);
});
test('accumulate treats a >200m jump as a glitch: resync, no distance added', () => {
  const before = {distanceM:10, lastPt:{lat:1.5, lng:110}};
  const s = R.accumulate(before, {lat:1.505, lng:110, acc:5}); // ~556m
  assert.strictEqual(s.distanceM, 10);
  assert.deepStrictEqual(s.lastPt, {lat:1.505, lng:110});
});

test('runScore: reached target on time = time-left% + 25/km', () => {
  const score = R.runScore({reachedTarget:true, timeUp:false, timeLeftSec:300, totalSec:600, distanceM:3000});
  assert.strictEqual(score, 50 + 75); // 125
});
test('runScore: timed out = 0 base but keeps km bonus', () => {
  const score = R.runScore({reachedTarget:false, timeUp:true, timeLeftSec:0, totalSec:600, distanceM:2000});
  assert.strictEqual(score, 50); // 0 + 2*25
});
test('runScore: partial km rounds down', () => {
  const score = R.runScore({reachedTarget:false, timeUp:true, timeLeftSec:0, totalSec:600, distanceM:2999});
  assert.strictEqual(score, 50); // floor(2.999)=2 -> 50
});
