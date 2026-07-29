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
    // Honour Range the way a real static host does. Without this the 206 path —
    // which is how <video> actually loads, and what broke the worker — would
    // never be exercised.
    const send = (body, type) => {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && Buffer.isBuffer(body)) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${body.length}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' });
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

// The <video> elements load with Range requests, which are answered 206. The
// Cache API rejects a 206, and because that rejection propagated out of the
// fetch handler the video request itself became a network error — the map and
// intro videos stopped playing entirely.
test('a ranged video request is served, not turned into a network error', async ({ page }) => {
  await boot(page);
  // The cache must be empty for this to bite. With a cached copy present the
  // handler returns it and never reaches the put that rejects — which is
  // exactly why the bug only appeared right after a CACHE_NAME bump wiped
  // everything.
  await page.evaluate(async () => { for (const key of await caches.keys()) await caches.delete(key); });
  const result = await page.evaluate(async origin => {
    try {
      const response = await fetch(origin + '/map idle pingpong.mp4', { headers: { Range: 'bytes=0-1023' } });
      return { status: response.status, bytes: (await response.arrayBuffer()).byteLength };
    } catch (error) {
      return { error: String(error) };
    }
  }, server.origin);
  expect(result.error).toBeUndefined();
  // 206 from the server, or 200 if it ignored the range — either is fine, an
  // exception is not.
  expect([200, 206]).toContain(result.status);
  expect(result.bytes).toBeGreaterThan(0);
});

test('the intro and map videos actually load through the worker', async ({ page }) => {
  const failed = [];
  page.on('requestfailed', request => failed.push(new URL(request.url()).pathname));
  await boot(page);
  await page.evaluate(async () => { for (const key of await caches.keys()) await caches.delete(key); });
  const states = await page.evaluate(async () => {
    const sources = [...document.querySelectorAll('video source')].map(s => s.src);
    return Promise.all(sources.map(src => new Promise(resolve => {
      const probe = document.createElement('video');
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => resolve({ src, ok: true });
      probe.onerror = () => resolve({ src, ok: false });
      probe.src = src;
      setTimeout(() => resolve({ src, ok: false, timedOut: true }), 8000);
    })));
  });
  expect(states.length).toBeGreaterThan(0);
  expect(states.filter(s => !s.ok)).toEqual([]);
  expect(failed.filter(p => p.endsWith('.mp4'))).toEqual([]);
});

// NOTE: the chrome-extension:// failures in the field are guarded by the
// scheme check in isCacheable(), but there is no test for it here. A browser
// extension cannot be loaded into this harness, and a data: URL — the obvious
// stand-in — never reaches the worker, so a test written against it passes just
// as happily on the broken code. A test that cannot fail is worse than none.

test('the cache version was bumped past the build that shipped the bad sprite paths', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const version = /CACHE_NAME = 'gs-shell-v(\d+)'/.exec(sw);
  expect(version).not.toBeNull();
  // v14 is the build whose cached app/styles.css 404'd on every sprite.
  expect(Number(version[1])).toBeGreaterThan(14);
});
