# Rival Ships on the Voyage Map — Design

Date: 2026-07-31

## Context

Each group sails its own voyage map between stations. The map shows one ship —
theirs — hopping island to island as they complete stations. Nothing on that
screen tells a group that thirteen other groups are racing them right now. The
cannon panel is the only place a rival is ever named, and only as a row of text
behind a button press.

Teachers want the race to be *felt* on the map: a pupil should glance at the
voyage map and see rival ships nearby, watch one pull ahead the moment it
clears a station, and know its name and how battered it is.

Decisions locked during brainstorming:

- **Rival position means race standing, not physical location.** A rival that
  has cleared 3 stations is drawn at *your* Pulau 3. Ships ahead of yours mean
  they are beating you; ships behind mean you lead. The alternative — mapping a
  rival's real station onto whichever of your islands hosts it — is
  geographically truthful but tells a pupil nothing about who is winning, and
  the map's whole visual grammar is already "further up the map = further
  along".
- **Three rivals, the nearest ones.** Fourteen ships would bury the map and
  shrink every name and HP bar past reading on a phone. The three closest in
  the standings keep the map clean and keep the pressure real: the ships you
  see are the ships you can actually catch or lose.
- **Two ahead, one behind.** Overtaking matters more than being chased, but
  being chased is what makes a group hurry. At the ends of the standings the
  selection backfills from whichever side has groups.
- **Tapping a rival ship opens the cannon panel on that target.** A pupil who
  sees an enemy HP bar in a game that has cannons *will* tap it. Leaving the
  tap dead invents a confusing non-affordance. This adds no firing logic — it
  is a shortcut into a panel that already exists.
- **No new Firebase fields and no security-rule changes.** Everything needed is
  already written to `progress/<gid>`.
- **Movement is driven by `currentIndex` changing, not by a published travel
  state.** A group's ship departs the instant they complete a station. Adding a
  `travel:{from,to,startedAt}` node would buy about one second of extra timing
  fidelity in exchange for new writes, new rules, stale-state cleanup, and an
  offline failure mode. Not worth it.
- **Rival ships vanish when offline.** Stale positions are worse than none.
  The pupil's own ship, journey and games are untouched — they already work
  fully offline.

## Data Source

`progress/<gid>` already carries every field this feature needs:

| Field | Used for |
|---|---|
| `currentIndex` | Which island the rival ship sits at |
| `hp` | The HP bar above the ship |
| `totalScore` | Tie-break when two groups have cleared the same count |
| `status === 'won'` | Rival has opened their chest — trophy instead of HP bar |

Crucially, `huntRef('progress').set(prog)` in `app/admin-groups.js:146` (and the
reset path in `app/admin-nav.js:288`) writes a node for **every configured
group** the moment an admin saves groups. So all rivals exist at
`currentIndex: 0` from the start of the hunt — rival ships are on the map from
the first moment a pupil opens it, not only once someone clears a station.

### Listener lifecycle

The live `huntRef('progress')` listener currently lives and dies with the cannon
panel (`app/cannon-ui.js:40-50`). It moves up to the **map's** lifecycle, since
the map is the only screen from which the cannon panel can be opened:

| Event | Action |
|---|---|
| `showJourneyMap()` | Attach listener, populate `allProgress`, render rivals |
| `hideJourneyMap()` | Detach listener |
| `openCannonPanel()` | Read `allProgress` — already populated, no listener work |
| `updateConnectivityBadge()` (reconnect) | Re-attach if the map is visible |

This is a net simplification: `attachCannonProgressListener` and its teardown in
`closeCannonPanel` are replaced by one listener with a clearer owner. The
existing offline requirement it documents — the panel must come alive by itself
when signal returns, because groups routinely open it offline while hunting a
cannon QR — is preserved by the reconnect row above.

## New Module: `map/rivals.js`

Pure logic, no DOM, UMD wrapper — matching `stations/layout.js`,
`groups/roster.js` and `hunts/registry.js`. Sibling `map/rivals.test.js` runs
under `node:test`.

```js
RivalShips.MAX_RIVALS                                  // 3
RivalShips.positionOf(entry, stationCount)             // → 0..stationCount
RivalShips.rank(allProgress, groups, stationCount)     // → ordered standings
RivalShips.selectNearest(ranked, myGid)                // → up to 3 entries
RivalShips.layout(selected, stops)                     // → [{gid,x,y,...}]
RivalShips.diff(previous, selected)                    // → [{gid,from,to}]
```

**`positionOf`** returns `currentIndex` clamped to `0..stationCount`. A group
with `status === 'won'` or a `currentIndex` past the end sits at the final
island.

**`rank`** sorts every group in the hunt's `config/groups` by `currentIndex`
descending, then `totalScore` descending, then group id ascending. The pupil's
own group is included so `selectNearest` can find their place in the standings.
A group with no `progress` entry at all is treated as `currentIndex: 0`,
`totalScore: 0`, `hp: 100` rather than being dropped, so a hunt whose progress
node has not yet been written still ranks sensibly.

**`selectNearest`** locates `myGid` in the standings and takes the two entries
above and the one below. If fewer than two exist above, the shortfall is taken
from below, and vice versa. Returns fewer than three only when the hunt has
fewer than four groups in total.

**`layout`** converts each selected rival to map coordinates. Several rivals can
share an island, and the pupil's own ship occupies the exact stop, so every
rival is nudged onto one of three fixed offsets around the mooring — left,
right, below. Slots are assigned per-island by ascending group id, so a ship
never jumps between offsets across re-renders.

**`diff`** compares the previous render's positions against the new ones and
reports which groups moved and from where, so only genuinely-moved ships are
animated.

## Rendering

```
        Kumpulan 5          ← name plate
        ▓▓▓▓▓▓░░░░ 60%      ← HP bar
            🚢               ← sprite, 16% width (own ship is 25%)
```

Rival ships reuse the existing ship sprite sheet at reduced size, slightly
reduced opacity, and a per-group hue tint derived deterministically from the
group id, so a pupil never mistakes a rival for their own ship. The name plate
and HP bar reuse the `.journey-ship-hp` visual language already on screen, with
a name line added.

### Stacking order

Deliberate, because it decides which element wins a tap where two overlap:

```
5  score popup / cannon panel
4  island buttons        ← always beat a rival ship on overlap
3  own HP bar
2  own ship              ← hero, never occluded
1  rival ships + plates
0  map video
```

Island buttons sit at the island centres (`MAP_ISLANDS`) while ships sit at the
moorings beside them (`MAP_STOPS`), so overlap is partial — but where it
happens, the island button must win. A pupil trying to sail somewhere must
never be blocked by a rival's hull.

Each rival ship is a real `<button>` with an `aria-label` naming the group and
its HP, so it is keyboard-reachable and announced by screen readers.

## Movement

When Firebase pushes a change to a rival's `currentIndex`, that ship sails from
its old island to its new one over ~2.7 seconds — the same duration, easing,
sprite-frame cycling and left/right hull mirroring as the pupil's own ship.
Because the write happens the instant a group completes a station, every other
phone sees the ship depart at that moment.

The animation driver currently embedded in `playStationJourney`
(`app/cannon-ui.js:377-419`) is extracted into a reusable function taking an
element, a start point, an end point and a duration. The pupil's ship and every
rival ship then share one implementation. `playStationJourney` keeps its own
responsibilities — audio, status text, the arrival callback and
`journeyShipPosition` bookkeeping.

Rival ships never play the sailing audio; only the pupil's own voyage does.

## Tapping a Rival

`openCannonPanel()` gains an optional target group id. When present, the panel
opens as usual and that group's row is scrolled into view and highlighted. No
change to `fireCannonAt` or any firing, ammo or damage logic.

If the cannon feature is disabled for the hunt (`cannonConfig.enabled === false`)
the tap does nothing, matching the hidden cannon FAB.

## Edge Cases

| Situation | Behaviour |
|---|---|
| Offline | Rival ships are removed from the map; own ship and games unaffected |
| Back online | Ships reappear at current positions **without** sailing animation, so reconnecting does not trigger several ships lurching at once |
| Fewer than 4 groups | Show however many rivals exist |
| Rival opened their chest | Docked at the final island, 🏆 badge replaces the HP bar — matching the cannon panel's existing "sudah buka peti" treatment |
| Configured group never plays | Stays at the start line and reads as far behind. Accepted knowingly: excluding idle groups would leave the map empty at the start of a hunt, which is the most exciting moment |
| `prefers-reduced-motion` | Ships jump straight to their new island with no sailing animation |
| Rival's HP changes while map is open | Bar updates live — a free consequence of the listener, including when the pupil shoots them |

## Testing

**`map/rivals.test.js`** (`node:test`, run like the other module tests):

- `positionOf` clamps, and treats `status: 'won'` as the final island
- `rank` orders by index, then score, then group id
- `selectNearest` returns two ahead and one behind in the normal case
- `selectNearest` backfills when the pupil is first or last in the standings
- `selectNearest` handles hunts with fewer than four groups
- `layout` gives rivals sharing an island three distinct offsets
- `layout` is stable — the same input always yields the same slot
- `diff` reports only groups whose position actually changed

**`tests/rival-ships.spec.js`** (Playwright):

- Three rival ships render on the map with names and HP bars
- A rival's HP bar reflects a changed `hp` value
- Raising a rival's `currentIndex` moves that ship to the next island
- Tapping a rival ship opens the cannon panel with that group highlighted
- Island buttons remain clickable where a rival ship overlaps them

**`offline/preload.test.js`** must still pass unchanged — it is the guard that
catches a script added to `index.html` but not to the offline shell list.

> **The new spec must block the gstatic Firebase CDN**
> (`page.route('https://www.gstatic.com/firebasejs/**', ...)`) and install the
> fake Firebase helper, exactly as the existing specs do. Without the route
> block the test writes to the live production database.

## Files Touched

| File | Change |
|---|---|
| `map/rivals.js` | New — pure selection, layout and diff logic |
| `map/rivals.test.js` | New — unit tests |
| `tests/rival-ships.spec.js` | New — Playwright coverage |
| `app/views-map.js` | Render, update and animate rival ships; own the progress listener |
| `app/cannon-ui.js` | Drop the panel-owned listener; extract the animation driver; accept a target group id |
| `app/connectivity.js` | Re-attach the map listener on reconnect |
| `app/styles.css` | Rival ship, name plate and HP bar styling |
| `index.html` | Container element for rival ships; load `map/rivals.js` |
| `offline/preload.js` | Add `map/rivals.js` to `LOCAL_ASSETS` — **required**, see below |
| `sw.js` | Bump `CACHE_NAME` to `gs-shell-v21` |

No changes to `database.rules.json`.

## Offline Shell Registration

`offline/preload.js` holds the single `LOCAL_ASSETS` list that both the page and
the service worker precache from, and `offline/preload.test.js` **fails if any
script tag in `index.html` is missing from that list**. Adding
`<script src="map/rivals.js">` without the matching `LOCAL_ASSETS` entry breaks
that test — and, worse, would leave the file uncached, so an offline launch
would load a map that references an undefined `RivalShips`.

`sw.js` bumps `CACHE_NAME` from `gs-shell-v20` to `gs-shell-v21` so devices
returning from an earlier hunt discard the previous shell immediately instead of
serving a cached `index.html` that has no rival ships in it.

Because the map must keep working with no signal, `showJourneyMap()` treats a
missing `RivalShips` global as "no rivals" and renders the pupil's own voyage
exactly as it does today, rather than throwing.
