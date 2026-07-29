importScripts('offline/preload.js');

const CACHE_NAME = 'gs-shell-v14';
// Both lists live in offline/preload.js so the page and this worker cache
// exactly the same things. Editing them here would reintroduce the drift.
const LOCAL_ASSETS = self.OfflinePreload.LOCAL_ASSETS;
const CDN_ASSETS = self.OfflinePreload.CDN_ASSETS;

// Cache one URL at a time and report which ones failed. `cache.addAll` rejects
// the whole batch on a single 404, which used to fail the install silently and
// leave a phone with no offline copy at all.
async function cacheEach(cache, urls, onProgress) {
  const failed = [];
  let done = 0;
  for (const url of urls) {
    try {
      const request = CDN_ASSETS.includes(url) ? new Request(url, { mode: 'no-cors' }) : url;
      const response = await fetch(request, { cache: 'reload' });
      // An opaque CDN response has status 0; anything else must be a real hit.
      if (response.type !== 'opaque' && !response.ok) throw new Error(String(response.status));
      await cache.put(url, response);
    } catch (_) {
      failed.push(url);
    }
    done++;
    if (onProgress) onProgress(done, urls.length, failed);
  }
  return failed;
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cacheEach(cache, LOCAL_ASSETS.concat(CDN_ASSETS));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

// The page asks for a precache after a group logs in and waits on the progress
// it reports back, so a student never walks away from Wi-Fi mid-download.
self.addEventListener('message', event => {
  const data = event.data || {};
  if (data.type !== 'PRECACHE') return;
  // A MessageChannel port keeps this reply private to the caller; fall back to
  // the client itself when the page did not open one.
  const port = event.ports && event.ports[0];
  const source = event.source;
  const post = message => {
    if (port) port.postMessage(message);
    else if (source) source.postMessage(message);
  };
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE_NAME);
      const urls = Array.isArray(data.urls) && data.urls.length
        ? data.urls : LOCAL_ASSETS.concat(CDN_ASSETS);
      const failed = await cacheEach(cache, urls, (done, total) =>
        post({ type: 'PRECACHE_PROGRESS', done, total }));
      post({ type: 'PRECACHE_DONE', failed });
    } catch (error) {
      post({ type: 'PRECACHE_DONE', failed: ['*'], error: String(error && error.message || error) });
    }
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Realtime Database uses WebSockets; never intercept its network traffic.
  if (url.hostname.includes('firebaseio.com')) return;
  event.respondWith((async () => {
    // Always refresh the HTML shell when online. This prevents an older
    // cache-first index.html from keeping a broken bootstrap indefinitely.
    if (event.request.mode === 'navigate') {
      try {
        const response = await fetch(event.request);
        const cache = await caches.open(CACHE_NAME);
        cache.put('index.html', response.clone());
        return response;
      } catch (_) {
        return caches.match('index.html');
      }
    }
    const cached = await caches.match(event.request, { ignoreSearch: true });
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (error) { throw error; }
  })());
});
