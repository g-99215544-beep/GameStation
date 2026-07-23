(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.RunTracker = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const ACC_MAX = 30;      // metres — ignore fixes with worse reported accuracy
  const MIN_STEP = 1;      // metres — ignore sub-metre GPS noise
  const MAX_JUMP = 200;    // metres — a single delta larger than this is a glitch
  const BONUS_PER_KM = 25; // marks per full kilometre run

  function parseTargetKm(raw) {
    let data = {};
    try { data = JSON.parse(raw || '{}'); } catch (e) { data = {}; }
    const km = Number(data.targetKm);
    return (isFinite(km) && km > 0) ? km : 3;
  }

  function haversineMeters(a, b) {
    const R = 6371000, toRad = x => x * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
  }

  // state: { distanceM, lastPt: {lat,lng}|null }; pt: {lat,lng,acc}
  function accumulate(state, pt) {
    const here = { lat: pt.lat, lng: pt.lng };
    if (!state.lastPt) return { distanceM: state.distanceM || 0, lastPt: here };
    if (pt.acc != null && pt.acc > ACC_MAX) return state;      // too noisy — ignore
    const d = haversineMeters(state.lastPt, here);
    if (d < MIN_STEP) return state;                            // jitter — ignore
    if (d > MAX_JUMP) return { distanceM: state.distanceM, lastPt: here }; // glitch — resync only
    return { distanceM: state.distanceM + d, lastPt: here };
  }

  function runScore({ reachedTarget, timeUp, timeLeftSec, totalSec, distanceM }) {
    const base = (reachedTarget && !timeUp)
      ? Math.round(Math.max(0, timeLeftSec) / totalSec * 100) : 0;
    const bonus = BONUS_PER_KM * Math.floor(distanceM / 1000);
    return base + bonus;
  }

  return { parseTargetKm, haversineMeters, accumulate, runScore,
    ACC_MAX, MIN_STEP, MAX_JUMP, BONUS_PER_KM };
});
