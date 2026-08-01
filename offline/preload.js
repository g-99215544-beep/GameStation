// The single source of truth for everything a phone must hold before it can
// play a station with the network switched off. Both the page and the service
// worker read this list, so the two can no longer drift apart — an asset that
// index.html loads but sw.js forgot to cache is exactly the bug that used to
// break a group the moment they walked out of Wi-Fi range.
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.OfflinePreload = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  // Keep in step with the <script>, <link> and asset URLs in index.html.
  // offline/preload.test.js fails if any of them is missing from this list.
  const LOCAL_ASSETS = [
    './', 'index.html', 'app/styles.css',
    'tangram/engine.js', 'tangram/shapes.js', 'tangram/ui.js',
    'run/tracker.js', 'groups/roster.js', 'stations/layout.js', 'map/rivals.js',
    'sifir/engine.js', 'crossword/engine.js', 'battleship/engine.js',
    'cannon/engine.js', 'offline/store.js', 'offline/preload.js',
    'offline/resume.js', 'hunts/registry.js',
    'app/config.js', 'app/connectivity.js', 'app/preload-ui.js', 'app/views-map.js',
    'app/cannon-ui.js', 'app/firebase-boot.js', 'app/admin-groups.js', 'app/admin-nav.js',
    'app/admin-stations.js', 'app/group-flow.js', 'app/games.js', 'app/crossword-ui.js',
    'app/battleship-ui.js', 'app/run-and-finish.js', 'app/finale-board.js',
    'assets/ship/ship-sail-sheet.png', 'assets/chest/chest_sheet.png', 'assets/chest/chest_open.mp3',
    'assets/cannon/attack-icon.png', 'assets/cannon/fire.mp4', 'assets/cannon/hit.mp4',
    'Pixel_art_game_intro_animation_202607201130.mp4', 'map idle pingpong.mp4',
    'Kapal_berlayar_plain_cyan_backgr…_202607201223.mp4'
  ];
  const CDN_ASSETS = [
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js',
    'https://www.gstatic.com/firebasejs/9.23.0/firebase-database-compat.js',
    'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'
  ];
  const PRELOAD_ASSETS = LOCAL_ASSETS.concat(CDN_ASSETS);

  // Assets dominate the wait (tens of megabytes of video against a few hundred
  // kilobytes of JSON), so they own most of the bar.
  const WEIGHTS = { assets: 80, config: 15, session: 5 };

  function assetFraction(state) {
    const total = Number(state && state.assetsTotal) || 0;
    if (total <= 0) return state && state.assetsDone ? 1 : 0;
    const done = Math.min(total, Math.max(0, Number(state.assetsDone) || 0));
    return done / total;
  }

  function preloadPercent(state) {
    const base = state || {};
    const percent = assetFraction(base) * WEIGHTS.assets +
      (base.configDone ? WEIGHTS.config : 0) +
      (base.sessionDone ? WEIGHTS.session : 0);
    return Math.max(0, Math.min(100, Math.round(percent)));
  }

  function preloadDone(state) {
    const base = state || {};
    return assetFraction(base) >= 1 && Boolean(base.configDone) && Boolean(base.sessionDone);
  }

  function preloadLabel(state) {
    const base = state || {};
    if (base.error) return base.error;
    if (preloadDone(base)) return 'Siap! Anda boleh bermain tanpa internet.';
    if (assetFraction(base) < 1) {
      const total = Number(base.assetsTotal) || 0;
      const done = Math.min(total, Math.max(0, Number(base.assetsDone) || 0));
      return `Memuat turun kandungan permainan… ${done}/${total}`;
    }
    if (!base.configDone) return 'Menyimpan tetapan stesen pada peranti…';
    return 'Menyemak status sesi…';
  }

  // Every failure a student can hit needs an instruction, not a stack trace.
  const FAILURE_MESSAGES = {
    quota: 'Kandungan terlalu besar untuk disimpan pada peranti ini. Kosongkan ruang simpanan, kemudian log masuk semula.',
    assets: 'Sebahagian kandungan gagal dimuat turun. Pastikan internet stabil, kemudian cuba lagi.',
    config: 'Tetapan stesen gagal dimuat turun. Pastikan internet stabil, kemudian cuba lagi.',
    timeout: 'Muat turun mengambil masa terlalu lama. Anda boleh langkau, tetapi sesetengah stesen mungkin perlukan internet.'
  };
  function preloadFailureMessage(reason) {
    return FAILURE_MESSAGES[reason] || FAILURE_MESSAGES.assets;
  }

  return {
    LOCAL_ASSETS, CDN_ASSETS, PRELOAD_ASSETS, WEIGHTS,
    preloadPercent, preloadDone, preloadLabel, preloadFailureMessage
  };
});
