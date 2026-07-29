const { test, expect } = require('playwright/test');
const startStaticServer = require('./helpers/static-server.js');
const installFakeFirebase = require('./helpers/fake-firebase.js');

const SEED = {
  gamestation2026: {
    activeHuntId: 'h1',
    hunts: {
      h1: {
        name: 'Hunt 1',
        createdAt: 1,
        config: {
          stations: {
            1: {
              id: 1, name: 'Stesen 1', location: 'Dewan', password: 'AAAAA',
              gameType: 'sifir', gameDataRaw: '{}', timeLimitMin: 10
            }
          },
          groups: {
            1: {
              id: 1, name: 'Kumpulan 1', loginPassword: '1001',
              startStation: 1, order: [1], members: []
            }
          }
        },
        session: { status: 'active', startedAt: 1 },
        progress: {
          1: {
            currentIndex: 0, status: 'idle', completedStations: {},
            keys: [], totalScore: 0
          }
        }
      }
    }
  }
};

let server;
test.beforeAll(async () => { server = await startStaticServer(); });
test.afterAll(async () => { await server.close(); });

async function boot(page) {
  await page.route('https://www.gstatic.com/firebasejs/**', route => route.fulfill({ body: '' }));
  await page.route('https://unpkg.com/**', route => route.fulfill({ body: '' }));
  await page.route('https://cdnjs.cloudflare.com/**', route => route.fulfill({ body: '' }));
  await page.addInitScript(installFakeFirebase, SEED);
  await page.goto(server.origin + '/index.html');
  await page.locator('#dailyIntro').evaluate(element => { element.hidden = true; });
  await expect(page.locator('#groupLoginSelect')).toContainText('Kumpulan 1');
}

test('persistent login expires after two hours, including an open tab', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const originalSetTimeout = window.setTimeout;
    const originalClearTimeout = window.clearTimeout;
    let expiryCallback = null;
    let expiryDelay = null;
    window.setTimeout = (callback, delay) => {
      expiryCallback = callback;
      expiryDelay = delay;
      return 987654;
    };
    window.clearTimeout = () => {};
    saveSession('admin');
    window.setTimeout = originalSetTimeout;
    window.clearTimeout = originalClearTimeout;
    const originalCapture = captureStationResume;
    let captured = false;
    captureStationResume = () => { captured = true; };
    expiryCallback();
    captureStationResume = originalCapture;
    return {
      duration: SESSION_DURATION_MS,
      delay: expiryDelay,
      captured,
      stored: localStorage.getItem('gs_session'),
      loginVisible: document.getElementById('view-login').classList.contains('active')
    };
  });

  expect(result.duration).toBe(2 * 60 * 60 * 1000);
  expect(result.delay).toBeGreaterThan(2 * 60 * 60 * 1000 - 100);
  expect(result.delay).toBeLessThanOrEqual(2 * 60 * 60 * 1000);
  expect(result.captured).toBe(true);
  expect(result.stored).toBeNull();
  expect(result.loginVisible).toBe(true);
});

test('restoration accepts a login before two hours and rejects it at two hours', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const now = Date.now();
    localStorage.setItem('gs_session', JSON.stringify({
      role: 'admin', groupId: null, huntId: 'h1',
      ts: now - SESSION_DURATION_MS + 1000
    }));
    tryRestoreSession();
    const freshAccepted = document.getElementById('view-admin').classList.contains('active');

    localStorage.setItem('gs_session', JSON.stringify({
      role: 'admin', groupId: null, huntId: 'h1',
      ts: Date.now() - SESSION_DURATION_MS
    }));
    tryRestoreSession();
    return {
      freshAccepted,
      staleRemoved: localStorage.getItem('gs_session') === null,
      staleReturnedToLogin: document.getElementById('view-login').classList.contains('active')
    };
  });

  expect(result).toEqual({
    freshAccepted: true,
    staleRemoved: true,
    staleReturnedToLogin: true
  });
});

test('home intro can replay only after one hour has elapsed', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(() => {
    const intro = document.getElementById('dailyIntro');
    const video = document.getElementById('dailyIntroVideo');
    const originalNow = Date.now;
    const originalSetTimeout = window.setTimeout;
    const base = 2_000_000_000_000;
    let plays = 0;
    video.play = () => { plays += 1; return Promise.resolve(); };
    video.pause = () => {};
    window.setTimeout = () => 1;
    localStorage.removeItem(DAILY_INTRO_KEY);

    Date.now = () => base;
    intro.hidden = true;
    playDailyIntro();
    const afterFirst = plays;

    intro.hidden = true;
    playDailyIntro();
    const immediate = plays;

    Date.now = () => base + DAILY_INTRO_INTERVAL_MS - 1;
    playDailyIntro();
    const beforeHour = plays;

    Date.now = () => base + DAILY_INTRO_INTERVAL_MS;
    playDailyIntro();
    const atHour = plays;

    Date.now = originalNow;
    window.setTimeout = originalSetTimeout;
    return {
      interval: DAILY_INTRO_INTERVAL_MS,
      afterFirst,
      immediate,
      beforeHour,
      atHour,
      stored: localStorage.getItem(DAILY_INTRO_KEY)
    };
  });

  expect(result).toEqual({
    interval: 60 * 60 * 1000,
    afterFirst: 1,
    immediate: 1,
    beforeHour: 1,
    atHour: 2,
    stored: String(2_000_000_000_000 + 60 * 60 * 1000)
  });
});
