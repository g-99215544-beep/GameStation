(function (root, factory) {
  const layout = typeof module !== 'undefined' && module.exports
    ? require('../stations/layout.js') : root.StationLayout;
  const mod = factory(layout);
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.OfflineStore = mod;
})(typeof self !== 'undefined' ? self : this, function (StationLayout) {
  const CONFIG_CACHE_KEY = 'gs_offline_config';
  const SESSION_CACHE_KEY = 'gs_offline_session';
  const PENDING_KEY = 'gs_offline_pending';

  function progressKey(gid) {
    return `gs_offline_progress_${gid}`;
  }

  function advanceProgress(prev, options) {
    const base = prev || {};
    const currentIndex = (Number(base.currentIndex) || 0) + 1;
    const stId = Number(options.stId);
    const keys = Array.isArray(base.keys) ? base.keys.slice() : [];
    if (!keys.includes(stId)) keys.push(stId);
    const completedStations = { ...(base.completedStations || {}) };
    completedStations[stId] = {
      score: Number(options.score) || 0,
      onTime: Boolean(options.onTime),
      timeTakenSec: Number(options.timeTakenSec) || 0,
      ts: options.now == null ? Date.now() : options.now
    };
    const done = StationLayout.isJourneyDone(currentIndex, options.stationCount);
    return {
      ...base,
      currentIndex,
      keys,
      completedStations,
      totalScore: (Number(base.totalScore) || 0) + (Number(options.score) || 0),
      status: done ? 'ready_chest' : 'idle'
    };
  }

  function enqueueWrite(queue, write) {
    const existing = Array.isArray(queue) ? queue : [];
    return [...existing.filter(item => item && item.path !== write.path), {
      path: write.path,
      data: write.data,
      ts: write.ts == null ? Date.now() : write.ts
    }];
  }

  return { advanceProgress, enqueueWrite, CONFIG_CACHE_KEY, SESSION_CACHE_KEY, PENDING_KEY, progressKey };
});
