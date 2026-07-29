const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const Preload = require('./preload.js');

const ROOT = path.join(__dirname, '..');

test('every script index.html loads is in the preload manifest', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const sources = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(match => match[1]);
  assert.ok(sources.length >= 12, 'expected index.html to load its engine modules');
  sources.forEach(src => {
    assert.ok(Preload.PRELOAD_ASSETS.includes(src), `${src} is loaded by index.html but missing from PRELOAD_ASSETS`);
  });
});

test('every local asset in the manifest exists on disk', () => {
  Preload.LOCAL_ASSETS.filter(asset => asset !== './').forEach(asset => {
    assert.ok(fs.existsSync(path.join(ROOT, asset)), `${asset} is in the manifest but missing from the repository`);
  });
});

test('the percentage runs from 0 to 100 across the three phases', () => {
  assert.strictEqual(Preload.preloadPercent({ assetsDone: 0, assetsTotal: 20 }), 0);
  assert.strictEqual(Preload.preloadPercent({ assetsDone: 10, assetsTotal: 20 }), 40);
  assert.strictEqual(Preload.preloadPercent({ assetsDone: 20, assetsTotal: 20 }), 80);
  assert.strictEqual(Preload.preloadPercent({ assetsDone: 20, assetsTotal: 20, configDone: true }), 95);
  assert.strictEqual(
    Preload.preloadPercent({ assetsDone: 20, assetsTotal: 20, configDone: true, sessionDone: true }), 100);
});

test('the percentage never escapes 0..100 on nonsense input', () => {
  assert.strictEqual(Preload.preloadPercent(null), 0);
  assert.strictEqual(Preload.preloadPercent({ assetsDone: -5, assetsTotal: 10 }), 0);
  assert.strictEqual(Preload.preloadPercent({ assetsDone: 99, assetsTotal: 10, configDone: true, sessionDone: true }), 100);
});

test('preloadDone is true only once all three phases finish', () => {
  assert.strictEqual(Preload.preloadDone({ assetsDone: 20, assetsTotal: 20, configDone: true }), false);
  assert.strictEqual(Preload.preloadDone({ assetsDone: 19, assetsTotal: 20, configDone: true, sessionDone: true }), false);
  assert.strictEqual(Preload.preloadDone({ assetsDone: 20, assetsTotal: 20, configDone: true, sessionDone: true }), true);
});

test('the label names the phase the student is waiting on', () => {
  assert.strictEqual(Preload.preloadLabel({ assetsDone: 3, assetsTotal: 20 }), 'Memuat turun kandungan permainan… 3/20');
  assert.strictEqual(Preload.preloadLabel({ assetsDone: 20, assetsTotal: 20 }), 'Menyimpan tetapan stesen pada peranti…');
  assert.strictEqual(Preload.preloadLabel({ assetsDone: 20, assetsTotal: 20, configDone: true }), 'Menyemak status sesi…');
  assert.strictEqual(
    Preload.preloadLabel({ assetsDone: 20, assetsTotal: 20, configDone: true, sessionDone: true }),
    'Siap! Anda boleh bermain tanpa internet.');
});

test('an error message wins over the phase label', () => {
  const label = Preload.preloadLabel({ assetsDone: 1, assetsTotal: 20, error: 'Rangkaian terputus.' });
  assert.strictEqual(label, 'Rangkaian terputus.');
});

test('a storage-quota failure tells the student what to do about it', () => {
  assert.match(Preload.preloadFailureMessage('quota'), /terlalu besar/);
  assert.match(Preload.preloadFailureMessage('nonsense-reason'), /internet stabil/);
});
