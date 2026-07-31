// Which rival ships a pupil sees on their voyage map, and where each one sits.
// A rival's island means race standing, not physical location: a group that has
// cleared three stations is drawn at the pupil's Pulau 3, so ships further up
// the map are simply groups that are beating them.
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.RivalShips = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_RIVALS = 3;
  // Three fixed berths around a mooring, in map percentage points. None of them
  // is {0,0}: that exact spot is where the pupil's own ship sits, and a rival
  // hiding underneath it would read as a rendering bug.
  //
  // These offsets are larger than they look because an island's clickable
  // button is a much bigger target than its drawn icon (24%-wide hit circle,
  // MAP_ISLANDS in views-map.js) and a mooring in MAP_STOPS sits only a few
  // percentage points from its own island's button centre. Every value below
  // was chosen empirically (elementFromPoint sweep over all 6 islands x all 3
  // berths, at 1280x720 and 390x640) so that: an island button's centre is
  // never covered by a rival, and every rival keeps a real, contiguous
  // >=44x44 CSS px tappable area clear of every island button. See
  // task-5-report.md, "Fix round 1", for the search and the numbers it ruled
  // out.
  const BERTHS = [{ dx: -6, dy: 10 }, { dx: 22, dy: 2 }, { dx: 0, dy: 12 }];

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  // Group ids are numeric strings ('1'..'14'), so a plain string sort would put
  // '10' before '2'. Numeric collation keeps the standings in human order.
  function byId(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  function positionOf(entry, stationCount) {
    const count = Math.max(0, Math.floor(num(stationCount, 0)));
    if (entry && entry.status === 'won') return count;
    const index = Math.floor(num(entry && entry.currentIndex, 0));
    if (index < 0) return 0;
    return index > count ? count : index;
  }

  // Every configured group is ranked, including ones with no progress entry
  // yet: they belong at the start line, not missing from the race.
  function rank(allProgress, groups, stationCount) {
    const progress = allProgress || {};
    const config = groups || {};
    return Object.keys(config).map(gid => {
      const entry = progress[gid] || {};
      return {
        gid: String(gid),
        name: (config[gid] && config[gid].name) || ('Kumpulan ' + gid),
        position: positionOf(entry, stationCount),
        score: num(entry.totalScore, 0),
        finished: entry.status === 'won'
      };
    }).sort((a, b) => {
      if (a.position !== b.position) return b.position - a.position;
      if (a.score !== b.score) return b.score - a.score;
      return byId(a.gid, b.gid);
    });
  }

  // Two ahead and one behind: overtaking is what a pupil acts on, but being
  // chased is what makes them hurry. At either end of the standings the
  // shortfall is taken from whichever side still has groups.
  function selectNearest(ranked, myGid, max) {
    const list = Array.isArray(ranked) ? ranked : [];
    const limit = max == null ? MAX_RIVALS : max;
    const me = list.findIndex(entry => String(entry.gid) === String(myGid));
    if (me < 0) return list.slice(0, limit);
    const ahead = list.slice(0, me).reverse();   // nearest ahead first
    const behind = list.slice(me + 1);           // nearest behind first
    const takeAhead = Math.min(2, ahead.length, limit);
    const takeBehind = Math.min(limit - takeAhead, behind.length);
    const picked = ahead.slice(0, takeAhead).concat(behind.slice(0, takeBehind));
    if (picked.length < limit) {
      picked.push(...ahead.slice(takeAhead, takeAhead + (limit - picked.length)));
    }
    return picked;
  }

  function pointAt(position, slot, stops) {
    const table = stops || {};
    const stop = table[position] || table[0] || { x: 50, y: 89 };
    const berth = BERTHS[num(slot, 0) % BERTHS.length];
    return { x: stop.x + berth.dx, y: stop.y + berth.dy };
  }

  // Berths are handed out per island in group-id order, never in the order
  // selectNearest happened to return, so a ship keeps the same berth across
  // re-renders instead of hopping sideways whenever the standings shuffle.
  function layout(selected, stops) {
    const used = {};
    return (Array.isArray(selected) ? selected.slice() : [])
      .sort((a, b) => byId(a.gid, b.gid))
      .map(entry => {
        const slot = used[entry.position] == null ? 0 : used[entry.position] + 1;
        used[entry.position] = slot;
        return Object.assign({}, entry, { slot }, pointAt(entry.position, slot, stops));
      });
  }

  function positions(selected) {
    const out = {};
    (Array.isArray(selected) ? selected : []).forEach(entry => { out[entry.gid] = entry.position; });
    return out;
  }

  // A rival with no previous position is new to the screen and must not sail in
  // from nowhere — it simply appears. That is also what makes reconnecting
  // quiet: the previous map is cleared when the listener detaches.
  function diff(previous, selected) {
    const before = previous || {};
    return (Array.isArray(selected) ? selected : [])
      .filter(entry => before[entry.gid] != null && before[entry.gid] !== entry.position)
      .map(entry => ({ gid: entry.gid, from: before[entry.gid], to: entry.position }));
  }

  return { MAX_RIVALS, BERTHS, positionOf, rank, selectNearest, pointAt, layout, positions, diff };
});
