const CACHE_NAME = 'gs-shell-v6';
const LOCAL_ASSETS = [
  './', 'index.html',
  'tangram/engine.js', 'tangram/shapes.js', 'tangram/ui.js',
  'run/tracker.js', 'groups/roster.js', 'stations/layout.js',
  'sifir/engine.js', 'crossword/engine.js', 'battleship/engine.js', 'offline/store.js',
  'assets/ship/ship-sail-sheet.png', 'assets/chest/chest_sheet.png', 'assets/chest/chest_open.mp3',
  'Pixel_art_game_intro_animation_202607201130.mp4', 'map idle pingpong.mp4',
  'Kapal_berlayar_plain_cyan_backgr…_202607201223.mp4'
];
const CDN_ASSETS = [
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
  'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(LOCAL_ASSETS);
    await Promise.all(CDN_ASSETS.map(async url => {
      try { await cache.put(url, await fetch(url, { mode: 'no-cors' })); } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await Promise.all((await caches.keys()).filter(key => key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
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
