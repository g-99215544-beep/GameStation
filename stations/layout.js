(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.StationLayout = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const MIN_STATIONS = 3;
  const MAX_STATIONS = 6;

  function clampStationCount(n) {
    const v = Math.floor(Number(n));
    if (!Number.isFinite(v)) return MIN_STATIONS;
    if (v < MIN_STATIONS) return MIN_STATIONS;
    if (v > MAX_STATIONS) return MAX_STATIONS;
    return v;
  }
  function defaultStartStation(groupId, count) {
    const c = clampStationCount(count);
    return ((Number(groupId) - 1) % c) + 1;
  }
  function rotationOrder(startStation, count) {
    const c = clampStationCount(count);
    const start = Number(startStation);
    const order = [];
    for (let k = 0; k < c; k++) order.push(((start - 1 + k) % c) + 1);
    return order;
  }
  function isJourneyDone(currentIndex, count) {
    return Number(currentIndex) >= clampStationCount(count);
  }
  return { MIN_STATIONS, MAX_STATIONS, clampStationCount, defaultStartStation, rotationOrder, isJourneyDone };
});
