(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.HuntRegistry = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  function statusLabel(hunt) {
    const status = hunt && hunt.session && hunt.session.status;
    if (status === 'active') return 'Aktif';
    if (status === 'ended') return 'Tamat';
    return 'Belum Mula';
  }
  function activeHuntId(hunts) {
    return Object.keys(hunts || {}).find(id => hunts[id] && hunts[id].session && hunts[id].session.status === 'active') || null;
  }
  function canStart(hunts, huntId) {
    const active = activeHuntId(hunts);
    return !active || String(active) === String(huntId);
  }
  function sortedHunts(hunts) {
    return Object.entries(hunts || {}).map(([id, hunt]) => ({ id, ...hunt }))
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  }
  return { canStart, activeHuntId, sortedHunts, statusLabel };
});
