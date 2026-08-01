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
  // Kept deliberately small (within 10 points horizontally, 7 vertically —
  // BERTH_ENVELOPE below, enforced by a test in rivals.test.js): a round-1
  // attempt widened these to guarantee a 44x44 tappable area on every island,
  // but the wider offsets moored ships closer to a NEIGHBOURING island than
  // their own — e.g. a rival actually at island 4 rendering on top of the
  // pupil's own ship at island 3's mooring. A map a pupil cannot trust to say
  // where anyone is defeats the entire feature, which is worse than a rival
  // that is sometimes hard to tap. Tapping a rival to open the cannon panel is
  // therefore explicitly best-effort — it works wherever the ship is not
  // covered by an island button, and is not guaranteed on every island. The
  // cannon FAB is the guaranteed path to the panel and already lists every
  // group, so no capability is lost.
  const BERTHS = [{ dx: -10, dy: 2 }, { dx: 10, dy: 3 }, { dx: 0, dy: 6.5 }];
  // The envelope every berth above must stay inside of — see the comment
  // above for why. Checked by a test in rivals.test.js so a future tuning
  // pass cannot quietly widen these enough to fling ships off their island
  // again.
  const BERTH_ENVELOPE = { maxDx: 10, maxDy: 7 };
  // A rival sharing the pupil's OWN island used to be handled by a second,
  // wider berth set — but widening the HULL's offset to clear the pupil's
  // ship necessarily either overlaps it (small nudge) or drifts toward a
  // NEIGHBOURING island's mooring (wide nudge): with a 25%-wide pupil ship
  // plus three 16%-wide rivals, there is no hull offset that clears one
  // without lying about the other. Confirmed by rendering it: readable names
  // came at the cost of a rival visibly mooring beside the wrong island,
  // which a pupil reads as "that group is one island ahead/behind" — false,
  // and the same failure Task 5 rejected once already. The actual fix is in
  // app/views-map.js: the name plate now lives in its own overlay layer
  // (#journeyRivalPlates) above the pupil's ship, so readability no longer
  // depends on moving the hull at all — every rival, including one sharing
  // the pupil's own island, uses the single BERTHS set above.

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

  return { MAX_RIVALS, BERTHS, BERTH_ENVELOPE, positionOf, rank, selectNearest, pointAt, layout, positions, diff };
});
