# Admin Group Management (Pengurusan Kumpulan & Ahli) — Design

**Date:** 2026-07-23
**Status:** Approved, ready for implementation plan

## Summary

Give the admin a dedicated panel to define how many groups exist, how many
members each has, and which named students belong to each group. Today a
"group" is only a login (name + shared 4-digit password + start station),
keyed `1..14` via a hardcoded `NUM_GROUPS`, and there is no concept of an
individual student. This feature adds a **named-member roster** per group and
makes the **group count dynamic**.

Gameplay stays group-based (one shared login per group); members are an
admin-side roster only — not shown to students, not used for login or scoring.
Treasure chests, the Smart Board, and the live dashboard already iterate over
whatever groups exist, so the chest count follows the group count automatically.

All work is in `index.html` plus a new pure, unit-tested module
`groups/roster.js` (mirroring the `run/tracker.js` / `tangram/engine.js`
UMD + `node:test` pattern).

## Terminology

- **Group** — a team with an id (`1..N`), name (`Kumpulan N`), shared
  `loginPassword`, `startStation`/`order`, and now a `members` list.
- **Member** — a named student, stored as a trimmed string inside a group's
  `members` array. No separate identity, login, or score.
- **Capacity** — `numGroups × membersPerGroup`, the number of member slots the
  bulk-distribute step fills.

## Admin workflow (as the user specified)

1. Admin opens the new **"Kumpulan & Ahli"** tab.
2. Admin sets **Bilangan Kumpulan** (e.g. 8) and **Bilangan Ahli / Kumpulan**
   (e.g. 5) **first**.
3. Admin pastes a **name list** (one name per line) into a textarea and presses
   **"Agih ke Kumpulan"**. Names fill slots **sequentially**: names 1–5 →
   Kumpulan 1, names 6–10 → Kumpulan 2, and so on.
   - Names **beyond** capacity are shown as an overflow warning (not assigned);
     admin can add groups/members and re-distribute.
   - **Fewer** names than capacity leaves trailing slots empty (fine — empty
     members are simply omitted; no blank entries are stored).
4. Admin fine-tunes with per-member and per-group controls (below).
5. Admin presses **"Simpan Kumpulan"** to commit.

## Data model

`config/groups/{gid}` gains a `members` field:

```
{ id: N, name: "Kumpulan N", startStation, order, loginPassword, members: ["Ali","Siti", ...] }
```

- Group ids are contiguous `1..N`. After any structural change (distribute /
  add group / delete group) the surviving groups are re-keyed `1..N` in order.
- Each surviving group keeps its own `loginPassword` and `members`; `startStation`
  and `order` are recomputed from the group's (possibly new) index using the
  existing `rotationFor` / start-rotation helpers.
- `members` is always an array of non-empty trimmed strings (may be empty `[]`).

## Pure module: `groups/roster.js`

UMD module exposing `window.GroupRoster` / `module.exports`. Operates purely on
member data (`string[][]` = array of per-group member arrays) — no DOM, no
passwords, no Firebase.

- `normalizeNames(text) -> string[]` — split on newlines, trim each, drop empty
  lines and collapse internal whitespace.
- `distributeNames(names, numGroups, membersPerGroup) -> { groups: string[][], overflow: string[] }`
  — `groups` has exactly `numGroups` arrays; group `g` gets
  `names[g*membersPerGroup .. (g+1)*membersPerGroup)`; `overflow` is any names
  past `numGroups*membersPerGroup`.
- `moveMember(groupsMembers, fromGroup, memberIndex, toGroup) -> string[][]` —
  returns a new array-of-arrays with the member removed from `fromGroup` and
  appended to `toGroup`. No-op-safe if indices are out of range.
- `addMember(groupsMembers, groupIndex, name) -> string[][]` — appends a trimmed
  non-empty name; ignores blank.
- `removeMember(groupsMembers, groupIndex, memberIndex) -> string[][]`.
- `addGroup(groupsMembers) -> string[][]` — appends an empty group `[]`.
- `removeGroup(groupsMembers, groupIndex) -> string[][]` — removes that group
  (and its members) entirely.

All functions are pure (return fresh structures, never mutate the input).

## UI: new admin tab "Kumpulan & Ahli"

Added to the tabbed admin panel (`#view-admin`), placed as a new step before
"Password Kumpulan" (the password tab still edits passwords/start stations for
whatever groups now exist). New `<option>` in `#adminTabSelect` and a new
`<section class="admin-panel" id="admin-panel-groups">`.

**Controls (top):**
- Number input *Bilangan Kumpulan*, number input *Bilangan Ahli / Kumpulan*.
- Textarea *Senarai Nama (satu baris satu nama)*.
- Button **"Agih ke Kumpulan"** → `normalizeNames` + `distributeNames`, load the
  result into an in-memory working draft, render the group cards, and show an
  overflow warning if any.

**Group cards (one per group):**
- Heading `Kumpulan N` + **"Padam Kumpulan"** (confirm dialog; removes the group
  and its members — per the approved "buang terus dengan amaran" choice).
- Member rows: the name, a **"Pindah"** control (a `<select>` of the other group
  numbers + a move action) invoking `moveMember`, and **"Buang"** invoking
  `removeMember`.
- **"＋ Tambah Ahli"**: a small name input + button invoking `addMember`.

**Footer:**
- **"＋ Tambah Kumpulan"** invoking `addGroup`.
- **"Simpan Kumpulan"** invoking the commit path.

All of Agih/Pindah/Buang/Tambah/Padam mutate the in-memory draft and re-render;
nothing is written to Firebase until **Simpan Kumpulan**.

**Locking:** while `sessionInfo.status === 'active'`, the whole tab's inputs and
buttons are disabled (same principle as the existing start-station lock via
`syncStartStationControlLock`), because committing resets progress.

## Commit path (index.html, touches globals/Firebase)

`buildGroupsFromDraft(draftMembers, existingGroups)`:
- For each index `g` (`0..N-1`) produce group id `g+1`:
  - `members` = the draft's member array for `g`.
  - `loginPassword` = preserve `existingGroups[g+1]`'s valid numeric password if
    present and unique; else generate via the existing `generateLoginPassword`.
  - `startStation` = `startStationForGroup` default for the new index; `order` =
    `rotationFor(startStation)`.
  - `name` = `"Kumpulan " + (g+1)`.
- Write `config/groups`, rebuild `config` group-derived UI, and reset
  `progress` to a fresh idle entry per group (same shape `pushConfig` writes).
  Set `session` to `setup` if it was not already active (mirrors the existing
  "fresh config" behavior). Update the in-memory `groups` global.

## Decoupling from `pushConfig` (station setup)

Today `pushConfig()` calls `collectGroups()` (a `1..NUM_GROUPS` loop) and
overwrites `config/groups` + `progress`. That would wipe the roster whenever the
admin re-saves stations. Change:

- `pushConfig()` **no longer regenerates groups**. It pushes `config/stations`,
  then rebuilds `progress` for the **existing** group ids, and preserves
  `config/groups` as-is.
- If `config/groups` is empty (true first run), `pushConfig` seeds a default set
  using `NUM_GROUPS` (unchanged behavior for a brand-new database) so existing
  first-time setup still works. Once the group tab has been used, that roster is
  authoritative.

## Dynamic group count (replace hardcoded `NUM_GROUPS`)

`NUM_GROUPS` stays as the **default seed count** only. Everywhere that currently
assumes 14 groups switches to the actual configured groups:

- Student join dropdown (currently `for i=1..NUM_GROUPS`): build `<option>`s from
  `Object.keys(groups)` sorted numerically.
- Smart Board fallback (`Array.from({length:NUM_GROUPS})`): unchanged — only used
  when no groups are configured yet.
- Dashboard heading "Dashboard Live (14 Kumpulan)": show the live group count.
- `collectGroups()` is retained only for the first-run default seed inside
  `pushConfig`; the new tab owns all subsequent group creation.

## Error handling / edge cases

- Non-numeric or `< 1` group/member counts on "Agih": show an inline error, do
  nothing.
- Empty name list on "Agih": create the groups with all-empty member slots.
- Duplicate names: allowed (two students may share a name); no dedupe.
- Delete the last remaining group: blocked with a message (must have ≥ 1 group).
- Move target equal to source: no-op.
- Committing while a session is active: prevented by the lock; if somehow
  triggered, the commit path re-checks `sessionInfo.status` and aborts with a
  message.

## Testing

- **`groups/roster.test.js`** (`node:test`): `normalizeNames` (trim/blank/dupes),
  `distributeNames` (even fill, underflow leaves short arrays, overflow list,
  invalid counts), `moveMember` (cross-group move + immutability), `addMember`
  (blank ignored), `removeMember`, `addGroup`, `removeGroup`.
- **`tests/group-management.spec.js`** (Playwright, Firebase stubbed like the
  existing specs): drive the tab — set counts, paste names, Agih, assert cards
  render with the right members; move a member and assert it relocates; delete a
  group and assert re-keying; Simpan and assert `config/groups` written with
  `members` and `progress` reset.

## Non-goals / assumptions

- Members are admin-only: no per-student login, no per-student scoring, not shown
  to students or on the Smart Board.
- Member names are NOT added to the password printout (kept out per the approved
  scope).
- No CSV/file import — bulk paste only.
- No drag-and-drop; moving a member uses a select + button.
- Reasonable upper bound on group count is not enforced beyond `≥ 1`; start
  stations rotate over the 6 stations as today.
