const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('playwright/test');

// A server whose file contents can be swapped between page loads, so a spec can
// simulate a deploy landing under a device that already cached the old build.
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg' };

function startMutableServer() {
  const overrides = new Map();
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const send = (body, type) => {
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    if (overrides.has(rel)) { send(overrides.get(rel), TYPES[path.extname(rel)] || 'text/plain'); return; }
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (error, body) => {
      if (error) { res.writeHead(404).end('not found'); return; }
      send(body, TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({
    origin: `http://127.0.0.1:${server.address().port}`,
    override: (file, body) => overrides.set(file, body),
    reset: () => overrides.clear(),
    close: () => new Promise(done => server.close(done))
  })));
}

let server;
test.beforeAll(async () => { server = await startMutableServer(); });
// The override map outlives a single test, so clear it or one test's simulated
// deploy leaks into the next one's expectations.
test.beforeEach(() => server.reset());
test.afterAll(async () => { await server.close(); });

async function boot(page) {
  await page.route('https://**', route => route.fulfill({ body: '' }));
  await page.goto(server.origin + '/index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
}

const probe = origin => `${origin}/app/styles.css`;

test('a cached file is refreshed in the background after a deploy', async ({ page }) => {
  await boot(page);
  // Warm the cache with the current build.
  await page.evaluate(async url => { await fetch(url); }, probe(server.origin));

  // A new build lands on the server.
  server.override('app/styles.css', '/* redeployed */ .probe{color:red}');

  // The first read still serves the cached copy — that is the "stale" half, and
  // it is what keeps the app instant and offline-safe.
  const stale = await page.evaluate(async url => (await fetch(url)).text(), probe(server.origin));
  expect(stale).not.toContain('redeployed');

  // The revalidate half then replaces it, with no CACHE_NAME bump involved.
  await expect.poll(async () => page.evaluate(async url => {
    const hit = await caches.match(url, { ignoreSearch: true });
    return hit ? hit.text() : '';
  }, probe(server.origin)), { timeout: 10000 }).toContain('redeployed');
});

test('the cached copy is still served with the network gone', async ({ page, context }) => {
  await boot(page);
  await page.evaluate(async url => { await fetch(url); }, probe(server.origin));

  await context.setOffline(true);
  const body = await page.evaluate(async url => {
    try { return (await fetch(url)).text(); } catch (error) { return 'FETCH FAILED: ' + error.message; }
  }, probe(server.origin));
  await context.setOffline(false);

  // Offline must not degrade: the station still gets its stylesheet.
  expect(body).toContain('.chest-vis');
  expect(body).not.toContain('FETCH FAILED');
});

test('a failed revalidation never destroys the good cached copy', async ({ page }) => {
  await boot(page);
  await page.evaluate(async url => { await fetch(url); }, probe(server.origin));

  // The server starts answering with an error for this file.
  await page.route('**/app/styles.css', route => route.fulfill({ status: 500, body: 'boom' }));
  await page.evaluate(async url => { try { await fetch(url); } catch (_) {} }, probe(server.origin));
  await page.waitForTimeout(500);

  const cached = await page.evaluate(async url => {
    const hit = await caches.match(url, { ignoreSearch: true });
    return hit ? hit.text() : '(nothing cached)';
  }, probe(server.origin));
  expect(cached).toContain('.chest-vis');
  expect(cached).not.toContain('boom');
});

test('the cache version was bumped past the build that shipped the bad sprite paths', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const version = /CACHE_NAME = 'gs-shell-v(\d+)'/.exec(sw);
  expect(version).not.toBeNull();
  // v14 is the build whose cached app/styles.css 404'd on every sprite.
  expect(Number(version[1])).toBeGreaterThan(14);
});
