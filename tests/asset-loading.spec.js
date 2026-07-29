const { test, expect } = require('playwright/test');
const startStaticServer = require('./helpers/static-server.js');
const installFakeFirebase = require('./helpers/fake-firebase.js');

// Sprite sheets are CSS background-images, so a browser only requests them once
// the element is actually on screen. That is why a broken path survived a
// console-error smoke check: the chest cards were never rendered. These tests
// render the screens that use them and watch the network.
let server;
test.beforeAll(async () => { server = await startStaticServer(); });
test.afterAll(async () => { await server.close(); });

const stations = { 1: { id: 1, name: 'S1', location: 'x', password: 'AAAAA', gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10 },
                   2: { id: 2, name: 'S2', location: 'y', password: 'BBBBB', gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10 },
                   3: { id: 3, name: 'S3', location: 'z', password: 'CCCCC', gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10 } };
const groups = { 1: { id: 1, name: 'Kumpulan 1', startStation: 1, order: [1, 2, 3], loginPassword: '1001', members: [] },
                 2: { id: 2, name: 'Kumpulan 2', startStation: 2, order: [2, 3, 1], loginPassword: '1002', members: [] } };
const SEED = { gamestation2026: { config: { stations, groups }, session: { status: 'active', startedAt: 1 },
  progress: { 1: { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 },
              2: { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 } } } };

// Collects any request the server answered with 4xx/5xx.
async function boot(page, failures) {
  page.on('response', response => {
    if (response.status() >= 400) failures.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.route('https://unpkg.com/**', route => route.fulfill({ body: '' }));
  await page.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ body: 'window.QRCode=function(){};' }));
  await page.addInitScript(installFakeFirebase, SEED);
  await page.goto(server.origin + '/index.html');
  await page.evaluate(() => { const intro = document.getElementById('dailyIntro'); if (intro) intro.hidden = true; });
  await page.evaluate(async () => { await loadConfigCache(); });
}

test('the Smart Board chest sprite loads', async ({ page }) => {
  const failures = [];
  await boot(page, failures);
  await page.evaluate(() => { sessionInfo = { status: 'active', startedAt: 1 }; showSmartBoard(); });
  await expect(page.locator('.chest-vis').first()).toBeVisible();
  await page.waitForTimeout(400);
  expect(failures).toEqual([]);
});

test('the journey map ship sprite loads', async ({ page }) => {
  const failures = [];
  await boot(page, failures);
  await page.evaluate(() => {
    currentGroupId = '1';
    progress = { currentIndex: 0, status: 'idle', completedStations: {}, keys: [], totalScore: 0 };
    showJourneyMap();
  });
  await expect(page.locator('#journeyShip')).toBeVisible();
  await page.waitForTimeout(400);
  expect(failures).toEqual([]);
});

// Belt and braces: ask the browser what URL it actually resolved each sprite to
// and fetch it. Computed style reports the absolute URL after the stylesheet's
// own base has been applied, which is exactly where the app/ move went wrong.
test('the sprite URLs the browser resolves are all fetchable', async ({ page }) => {
  await boot(page, []);
  const results = await page.evaluate(async () => {
    const probes = [
      { name: 'ship', el: document.getElementById('journeyShip') },
      { name: 'chest', el: Object.assign(document.body.appendChild(document.createElement('div')), { className: 'chest-vis' }) }
    ];
    const out = [];
    for (const probe of probes) {
      const background = getComputedStyle(probe.el).backgroundImage;
      const match = /url\("?([^")]+)"?\)/.exec(background);
      if (!match) { out.push({ name: probe.name, url: null, status: 'no background-image' }); continue; }
      out.push({ name: probe.name, url: match[1], status: (await fetch(match[1])).status });
    }
    return out;
  });
  expect(results).toHaveLength(2);
  // A wrong relative path shows up here as 404 on /app/assets/... instead of 200.
  expect(results.filter(r => r.status !== 200)).toEqual([]);
});

test('the journey map retries a video whose initial preload failed', async ({ page }) => {
  await boot(page);
  const calls = await page.evaluate(() => {
    const video = document.getElementById('journeyMapVideo');
    const invoked = [];
    Object.defineProperty(video, 'error', { configurable: true, value: { code: 2 } });
    Object.defineProperty(video, 'paused', { configurable: true, value: true });
    video.load = () => invoked.push('load');
    video.play = () => {
      invoked.push('play');
      return Promise.resolve();
    };
    playJourneyMapPingPong();
    return invoked;
  });
  expect(calls).toEqual(['load', 'play']);
});
