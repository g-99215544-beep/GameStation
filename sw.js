importScripts('offline/preload.js');

// Bump this whenever a cached file changes in a way returning devices must pick
// up immediately. activate() deletes every other cache, so a bump forces a full
// refetch. v15: app/styles.css shipped with sprite paths that 404'd, and
// cache-first had no way to ever replace it. v18 ships the transparent cannon
// icon together with the shorter login and intro replay windows. v19 forces
// returning admin devices to discard the pre-step-flow JavaScript immediately.
const CACHE_NAME = 'gs-shell-v19';
// Both lists live in offline/preload.js so the page and this worker cache
// exactly the same things. Editing them here would reintroduce the drift.
const LOCAL_ASSETS = self.OfflinePreload.LOCAL_ASSETS;
const CDN_ASSETS = self.OfflinePreload.CDN_ASSETS;
// Keep installation quick. The login preload below owns the full manifest and
// reports every completed asset to the student; downloading all videos here
// first leaves that visible progress screen stuck at 0 until install finishes.
const INSTALL_ASSETS = ['index.html', 'app/styles.css'];

// Cache one URL at a time and report which ones failed. `cache.addAll` rejects
// the whole batch on a single 404, which used to fail the install silently and
// leave a phone with no offline copy at all.
async function cacheEach(cache, urls, onProgress) {
  const failed = [];
  let done = 0;
  for (const url of urls) {
    try {
      // Download only what is missing. This used to fetch with cache:'reload',
      // which bypasses every cache — so a group logging in a second time
      // re-downloaded all ~15 MB of video over the school Wi-Fi. Freshness is
      // the fetch handler's job now: it revalidates in the background.
      const existing = await cache.match(url, { ignoreSearch: true });
      if (!existing) {
        const request = CDN_ASSETS.includes(url) ? new Request(url, { mode: 'no-cors' }) : url;
        const response = await fetch(request);
        // Only a complete resource may be stored. `ok` spans 200-299, so it
        // would wave through a 206 that the Cache API then rejects.
        if (!isStorable(response)) throw new Error(String(response.status));
        await cache.put(url, response);
      }
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
    await cacheEach(cache, INSTALL_ASSETS);
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

// Only a plain http(s) GET can go through the Cache API at all. Anything else
// must be left to the browser untouched — intercepting it and failing turns a
// working request into a network error.
function isCacheable(request, url) {
  if (request.method !== 'GET') return false;
  // chrome-extension:, blob:, data: … the Cache API rejects every one of them.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  return true;
}

// A response is only worth storing if it is the complete resource. `ok` spans
// 200-299, which wrongly includes 206.
function isStorable(response) {
  return response.type === 'opaque' || response.status === 200;
}

// Never let a cache write break the response being delivered. The Cache API
// throws on inputs it does not accept, and the page still needs its bytes.
async function cacheQuietly(request, response) {
  if (!isStorable(response)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (_) { /* unsupported for the cache — serving it is what matters */ }
}

function rangeNotSatisfiable(size) {
  return new Response(null, {
    status: 416,
    statusText: 'Range Not Satisfiable',
    headers: { 'Content-Range': `bytes */${size}` }
  });
}

// Videos are precached as complete responses, but browsers normally read them
// with byte-range requests. Build the requested 206 from that full cached copy
// so playback keeps working after the group leaves Wi-Fi.
async function cachedRangeResponse(request) {
  const cached = await caches.match(request.url, { ignoreSearch: true });
  if (!cached || cached.type === 'opaque') return null;

  const bytes = await cached.arrayBuffer();
  const size = bytes.byteLength;
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') || '');
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return rangeNotSatisfiable(size);
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) {
      return rangeNotSatisfiable(size);
    }
    end = Math.min(end, size - 1);
  }

  const headers = new Headers(cached.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  return new Response(bytes.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers
  });
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Realtime Database uses WebSockets; never intercept its network traffic.
  if (url.hostname.includes('firebaseio.com')) return;
  if (!isCacheable(event.request, url)) return;

  // Never put a 206 in Cache Storage. Serve it from the already-precached full
  // response when possible; otherwise let the host answer the range directly.
  if (event.request.headers.has('range')) {
    event.respondWith((async () => {
      const cached = await cachedRangeResponse(event.request);
      return cached || fetch(event.request);
    })());
    return;
  }

  event.respondWith((async () => {
    // Always refresh the HTML shell when online. This prevents an older
    // cache-first index.html from keeping a broken bootstrap indefinitely.
    if (event.request.mode === 'navigate') {
      try {
        const response = await fetch(event.request);
        await cacheQuietly('index.html', response);
        return response;
      } catch (_) {
        return caches.match('index.html');
      }
    }
    // Stale-while-revalidate. Pure cache-first was a trap: a file cached with a
    // bug stayed served forever, because nothing ever went back to the network
    // to replace it. Serving the cached copy first keeps the field behaviour
    // (instant, works with no signal); refreshing it in the background means the
    // next launch is current without anyone hand-bumping CACHE_NAME.
    const cached = await caches.match(event.request, { ignoreSearch: true });
    const fromNetwork = fetch(event.request).then(async response => {
      await cacheQuietly(event.request, response);
      return response;
    });
    if (cached) {
      // Offline, this rejects and there is nothing to do about it — the cached
      // copy has already been returned.
      event.waitUntil(fromNetwork.catch(() => {}));
      return cached;
    }
    return fromNetwork;
  })());
});
