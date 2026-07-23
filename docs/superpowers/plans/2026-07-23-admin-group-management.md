# Admin Group Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the admin a "Kumpulan & Ahli" panel to set the number of groups and members, bulk-distribute pasted student names, and move/add/delete members and groups — with the group count becoming dynamic.

**Architecture:** Pure roster math (normalize/distribute/move/add/remove) lives in a new UMD module `groups/roster.js` (`node:test`-tested, mirroring `run/tracker.js`). All UI/state/persistence lives in `index.html`: a new admin tab renders an in-memory `groupDraft` (`string[][]`), mutations call the module and re-render the cards, and **Simpan Kumpulan** commits to `config/groups` (adding a `members` field) and resets `progress`. Group creation is decoupled from station setup so `pushConfig` no longer clobbers the roster.

**Tech Stack:** Vanilla JS single-page app (`index.html`), Firebase Realtime DB (compat), `node:test`, Playwright (Firebase stubbed).

## Global Constraints

- Pure logic in `groups/roster.js` as a UMD module: `(function(root,factory){ const mod=factory(); if(typeof module!=='undefined'&&module.exports) module.exports=mod; else root.GroupRoster=mod; })(...)`. Mirror `tangram/engine.js:1-5` and `run/tracker.js`.
- Group ids are contiguous `1..N`; after any structural change the surviving groups are re-keyed `1..N` in order.
- Group config shape: `{ id, name:"Kumpulan N", startStation, order, loginPassword, members:[...] }`. `members` is always an array of non-empty trimmed strings.
- Distribution is **sequential**: group `g` (0-based) gets `names[g*M .. (g+1)*M)`; names past `N*M` are overflow (not assigned).
- Deleting a group removes its members too (with a confirm dialog). At least 1 group must remain.
- **Simpan Kumpulan** resets `progress` and is **locked while `sessionInfo.status === 'active'`**.
- The commit path must **preserve** each group's existing `loginPassword` and `startStation` by index where present (do not reset custom start stations), generating only for new groups. Reuse the existing `generateLoginPassword`, `startStationForGroup`, `rotationFor`, `numericLoginPassword` helpers.
- Members are admin-only: not shown to students, not on printouts, not used for login/scoring.
- UI copy is Malay, matching existing admin panels.
- Run `node:test` with `node --test <file>`. Playwright with `npx playwright test <path>` (installed locally, git-ignored).

## File Structure

- **Create `groups/roster.js`** — pure roster functions (no DOM/Firebase). One responsibility: transform `string[][]` member data.
- **Create `groups/roster.test.js`** — `node:test` unit tests.
- **Create `tests/group-management.spec.js`** — Playwright flow tests (Firebase stubbed).
- **Modify `index.html`** — module `<script>`, CSS, new admin tab (option + section + note), `groupDraft` state, render + mutation handlers, dynamic login dropdown, commit path, and `pushConfig` decoupling.

---

### Task 1: Pure roster module (`groups/roster.js`)

**Files:**
- Create: `groups/roster.js`
- Test: `groups/roster.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (on `window.GroupRoster` and `module.exports`), all pure (return fresh structures, never mutate input):
  - `normalizeNames(text: string) -> string[]` — split on newlines, trim, collapse internal whitespace, drop empties.
  - `distributeNames(names: string[], numGroups: number, membersPerGroup: number) -> { groups: string[][], overflow: string[] }` — `groups.length === numGroups`; group `g` = `names[g*M .. (g+1)*M)`; `overflow` = `names.slice(N*M)`.
  - `moveMember(groupsMembers: string[][], fromGroup, memberIndex, toGroup) -> string[][]`.
  - `addMember(groupsMembers, groupIndex, name) -> string[][]` — trims; ignores blank.
  - `removeMember(groupsMembers, groupIndex, memberIndex) -> string[][]`.
  - `addGroup(groupsMembers) -> string[][]` — appends `[]`.
  - `removeGroup(groupsMembers, groupIndex) -> string[][]`.

- [ ] **Step 1: Write the failing tests**

Create `groups/roster.test.js`:

```javascript
const test = require('node:test');
const assert = require('node:assert');
const G = require('./roster.js');

test('normalizeNames trims, collapses spaces, drops blanks', () => {
  assert.deepStrictEqual(
    G.normalizeNames('  Ali \n\n Siti  Binti  \n\t\n Abu\n'),
    ['Ali', 'Siti Binti', 'Abu']);
});

test('distributeNames fills sequentially, exact fit', () => {
  const r = G.distributeNames(['a','b','c','d'], 2, 2);
  assert.deepStrictEqual(r.groups, [['a','b'], ['c','d']]);
  assert.deepStrictEqual(r.overflow, []);
});
test('distributeNames underflow leaves short/empty groups', () => {
  const r = G.distributeNames(['a','b','c'], 3, 2);
  assert.deepStrictEqual(r.groups, [['a','b'], ['c'], []]);
  assert.deepStrictEqual(r.overflow, []);
});
test('distributeNames overflow lists the surplus', () => {
  const r = G.distributeNames(['a','b','c','d','e'], 2, 2);
  assert.deepStrictEqual(r.groups, [['a','b'], ['c','d']]);
  assert.deepStrictEqual(r.overflow, ['e']);
});
test('distributeNames with zero names makes empty groups', () => {
  const r = G.distributeNames([], 3, 5);
  assert.deepStrictEqual(r.groups, [[], [], []]);
});

test('moveMember relocates across groups without mutating input', () => {
  const src = [['a','b'], ['c']];
  const out = G.moveMember(src, 0, 0, 1);
  assert.deepStrictEqual(out, [['b'], ['c','a']]);
  assert.deepStrictEqual(src, [['a','b'], ['c']]); // unchanged
});
test('moveMember same group is a no-op copy', () => {
  const out = G.moveMember([['a','b']], 0, 0, 0);
  assert.deepStrictEqual(out, [['a','b']]);
});

test('addMember appends trimmed name, ignores blank', () => {
  assert.deepStrictEqual(G.addMember([['a']], 0, '  Bob '), [['a','Bob']]);
  assert.deepStrictEqual(G.addMember([['a']], 0, '   '), [['a']]);
});
test('removeMember drops the entry', () => {
  assert.deepStrictEqual(G.removeMember([['a','b','c']], 0, 1), [['a','c']]);
});
test('addGroup appends an empty group', () => {
  assert.deepStrictEqual(G.addGroup([['a']]), [['a'], []]);
});
test('removeGroup removes group and members', () => {
  assert.deepStrictEqual(G.removeGroup([['a'], ['b'], ['c']], 1), [['a'], ['c']]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test groups/roster.test.js`
Expected: FAIL — `Cannot find module './roster.js'`.

- [ ] **Step 3: Write the module**

Create `groups/roster.js`:

```javascript
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  else root.GroupRoster = mod;
})(typeof self !== 'undefined' ? self : this, function () {
  function clean(name) { return String(name == null ? '' : name).trim().replace(/\s+/g, ' '); }
  function copy(groupsMembers) { return groupsMembers.map(a => a.slice()); }

  function normalizeNames(text) {
    return String(text || '').split(/\r?\n/).map(clean).filter(s => s.length > 0);
  }
  function distributeNames(names, numGroups, membersPerGroup) {
    const n = Math.max(0, Math.floor(Number(numGroups) || 0));
    const m = Math.max(0, Math.floor(Number(membersPerGroup) || 0));
    const groups = [];
    for (let g = 0; g < n; g++) groups.push(names.slice(g * m, g * m + m));
    return { groups, overflow: names.slice(n * m) };
  }
  function moveMember(groupsMembers, fromGroup, memberIndex, toGroup) {
    const next = copy(groupsMembers);
    if (!next[fromGroup] || !next[toGroup] || fromGroup === toGroup) return next;
    if (memberIndex < 0 || memberIndex >= next[fromGroup].length) return next;
    const [name] = next[fromGroup].splice(memberIndex, 1);
    next[toGroup].push(name);
    return next;
  }
  function addMember(groupsMembers, groupIndex, name) {
    const next = copy(groupsMembers);
    const c = clean(name);
    if (next[groupIndex] && c) next[groupIndex].push(c);
    return next;
  }
  function removeMember(groupsMembers, groupIndex, memberIndex) {
    const next = copy(groupsMembers);
    if (next[groupIndex]) next[groupIndex].splice(memberIndex, 1);
    return next;
  }
  function addGroup(groupsMembers) {
    const next = copy(groupsMembers);
    next.push([]);
    return next;
  }
  function removeGroup(groupsMembers, groupIndex) {
    const next = copy(groupsMembers);
    if (groupIndex >= 0 && groupIndex < next.length) next.splice(groupIndex, 1);
    return next;
  }
  return { normalizeNames, distributeNames, moveMember, addMember, removeMember, addGroup, removeGroup };
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test groups/roster.test.js`
Expected: PASS — 11 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add groups/roster.js groups/roster.test.js
git commit -m "feat: add group roster distribution module"
```

---

### Task 2: Group manager tab + UI (`index.html`)

**Files:**
- Modify: `index.html` — script include (after the `run/tracker.js` tag near line 14); CSS (after the run-editor rules near line 235); `#adminTabSelect` option (line 383-390); new `<section id="admin-panel-groups">` (after the setup section, before `#admin-panel-passwords` at line 417); `ADMIN_TAB_NOTES` (line 1031); `selectAdminTab` (line 1040); state global (near line 596); `initApp` login-dropdown loop (line 916-918); `loadConfigCache` (line 967-974).
- Test: `tests/group-management.spec.js`

**Interfaces:**
- Consumes from Task 1: `window.GroupRoster.{normalizeNames, distributeNames, moveMember, addMember, removeMember, addGroup, removeGroup}`. Existing globals: `groups`, `sessionInfo`, `escapeHtml`, `NUM_GROUPS`, `selectAdminTab`.
- Produces (used by Task 3): global `let groupDraft` (`string[][]`); `renderGroupManager()`, `renderGroupCards()`, `renderGroupLoginOptions()`; handlers `groupAgih()`, `groupMoveMember(f,m)`, `groupRemoveMember(g,m)`, `groupAddMember(g)`, `groupAddGroup()`, `groupRemoveGroup(g)`. Task 3 defines `saveGroupManager()` (referenced by the Simpan button added here).

- [ ] **Step 1: Write the failing Playwright test.** Create `tests/group-management.spec.js`:

```javascript
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { test, expect } = require('playwright/test');

function seedPage(page, seed) {
  return page.addInitScript(data => {
    const store = structuredClone(data);
    const at = key => key.split('/').filter(Boolean).reduce((v, p) => v && v[p], store);
    const write = (key, value) => {
      const parts = key.split('/').filter(Boolean);
      const last = parts.pop();
      const parent = parts.reduce((v, p) => (v[p] ||= {}), store);
      parent[last] = structuredClone(value);
    };
    window.firebase = {
      apps: [], initializeApp() { this.apps.push({}); },
      database() { return { ref(key) { return {
        once: () => Promise.resolve({ val: () => structuredClone(at(key)) }),
        on: (_e, cb) => cb({ val: () => structuredClone(at(key)) }), off: () => {},
        set: value => { write(key, value); return Promise.resolve(); },
        update: value => { write(key, { ...at(key), ...value }); return Promise.resolve(); }
      }; } }; }
    };
  }, seed);
}

function baseSeed() {
  const stations = Object.fromEntries(Array.from({ length: 6 }, (_, i) =>
    [i + 1, { id: i + 1, name: `Stesen ${i + 1}`, location: 'x', password: '12345', gameType: 'quiz', gameDataRaw: '{}', timeLimitMin: 10 }]));
  const groups = {
    1: { id: 1, name: 'Kumpulan 1', startStation: 1, order: [1,2,3,4,5,6], loginPassword: '1001', members: ['Ali','Siti'] },
    2: { id: 2, name: 'Kumpulan 2', startStation: 2, order: [2,3,4,5,6,1], loginPassword: '1002', members: ['Abu'] }
  };
  return { gamestation2026: { config: { stations, groups }, session: { status: 'setup' }, progress: {} } };
}

async function openGroupTab(page) {
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await expect(page.locator('#view-login')).toHaveClass(/active/);
  await page.evaluate(async () => {
    await loadConfigCache();
    sessionInfo = { status: 'setup' };
    show('view-admin');
    selectAdminTab('groups');
  });
}

test('group tab renders existing groups and members', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  await expect(page.locator('#groupCards .group-card')).toHaveCount(2);
  await expect(page.locator('#groupCards .group-card').first()).toContainText('Ali');
  await expect(page.locator('#groupCards .group-card').first()).toContainText('Siti');
});

test('Agih distributes pasted names sequentially', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  await page.fill('#group_num_groups', '2');
  await page.fill('#group_members_per', '2');
  await page.fill('#group_names', 'A\nB\nC\nD');
  await page.click('text=Agih ke Kumpulan');
  await expect(page.locator('#groupCards .group-card')).toHaveCount(2);
  await expect(page.locator('#groupCards .group-card').nth(0)).toContainText('A');
  await expect(page.locator('#groupCards .group-card').nth(0)).toContainText('B');
  await expect(page.locator('#groupCards .group-card').nth(1)).toContainText('C');
  await expect(page.locator('#groupCards .group-card').nth(1)).toContainText('D');
});

test('moving a member relocates it to the target group', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  // Move member 0 of group 0 (Ali) to group 1 (index 1)
  await page.selectOption('#group_move_0_0', '1');
  await page.click('#groupCards .group-card:nth-child(1) button:has-text("Pindah")');
  await expect(page.locator('#groupCards .group-card').nth(1)).toContainText('Ali');
  await expect(page.locator('#groupCards .group-card').nth(0)).not.toContainText('Ali');
});

test('deleting a group removes it and re-keys', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  page.on('dialog', d => d.accept());
  await page.click('#groupCards .group-card:nth-child(1) button:has-text("Padam Kumpulan")');
  await expect(page.locator('#groupCards .group-card')).toHaveCount(1);
  await expect(page.locator('#groupCards .group-card').nth(0)).toContainText('Kumpulan 1');
  await expect(page.locator('#groupCards .group-card').nth(0)).toContainText('Abu');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/group-management.spec.js --reporter=line`
Expected: FAIL — `#groupCards` / the group tab does not exist yet.

- [ ] **Step 3: Load the module.** In `index.html` after the `run/tracker.js` script tag (near line 14), add:

```html
<script src="groups/roster.js"></script>
```

- [ ] **Step 4: Add CSS.** After the `.run-editor` rules (near line 235), add:

```css
  .group-setup{display:flex;flex-direction:column;gap:6px;margin-bottom:16px;}
  .group-setup textarea{width:100%;font-family:inherit;}
  .group-card{border:2px solid var(--gold);border-radius:10px;padding:12px;margin:10px 0;background:#fff8df;}
  .group-card-head{display:flex;justify-content:space-between;align-items:center;gap:8px;}
  .group-card-head h4{margin:0;color:var(--navy);}
  .group-card .member-count{color:#888;font-weight:400;font-size:13px;}
  .member-list{list-style:none;margin:8px 0;padding:0;}
  .member-list li{display:flex;gap:6px;align-items:center;padding:4px 0;border-top:1px solid #ead7aa;}
  .member-list li:first-child{border-top:0;}
  .member-list .member-name{flex:1;color:var(--navy);}
  .member-add{display:flex;gap:6px;margin-top:6px;}
  .member-add input{flex:1;}
```

- [ ] **Step 5: Add the admin tab option.** In `#adminTabSelect` (line 384-389), insert after the `setup` option:

```html
          <option value="setup">Langkah 1: Setup Stesen</option>
          <option value="groups">Kumpulan &amp; Ahli</option>
```

- [ ] **Step 6: Add the tab section.** Immediately after the `#admin-panel-setup` section closes (`</section>` before `<section class="admin-panel" id="admin-panel-passwords">` at line 417), insert:

```html
      <section class="admin-panel" id="admin-panel-groups">
        <div class="card">
          <h3>Kumpulan &amp; Ahli</h3>
          <p class="admin-panel-intro">Tetapkan bilangan kumpulan dan ahli, kemudian tampal senarai nama untuk mengagihkan murid. Anda boleh pindah, tambah, atau padam ahli dan kumpulan.</p>
          <div id="groupManagerLock"></div>
          <div class="group-setup">
            <label>Bilangan Kumpulan</label>
            <input id="group_num_groups" type="number" min="1" value="8">
            <label>Bilangan Ahli / Kumpulan</label>
            <input id="group_members_per" type="number" min="1" value="5">
            <label>Senarai Nama (satu baris satu nama)</label>
            <textarea id="group_names" rows="6" placeholder="Ali&#10;Siti&#10;Abu"></textarea>
            <button class="secondary" onclick="groupAgih()">Agih ke Kumpulan</button>
            <div id="groupAgihMsg"></div>
          </div>
          <div id="groupCards"></div>
          <div class="feature-actions">
            <button onclick="groupAddGroup()">&#65291; Tambah Kumpulan</button>
            <button class="secondary" onclick="saveGroupManager()">Simpan Kumpulan</button>
          </div>
          <div id="groupSaveMsg"></div>
        </div>
      </section>
```

- [ ] **Step 7: Register the tab note + render hook.** In `ADMIN_TAB_NOTES` (line 1031-1038) add a `groups` entry after `setup`:

```javascript
  setup:'Langkah pertama: lengkapkan maklumat dan permainan untuk enam stesen.',
  groups:'Urus kumpulan: tetapkan bilangan, agih nama murid, dan pindah/tambah/padam ahli.',
```

In `selectAdminTab` (line 1050, alongside the other `if(allowed===...)` lines), add:

```javascript
  if(allowed==='groups') renderGroupManager();
```

- [ ] **Step 8: Add the `groupDraft` state global.** On the line after the main state declaration (`let db, stations, groups, ...` around line 596), add:

```javascript
let groupDraft = [];
```

- [ ] **Step 9: Add the dynamic login-dropdown helper and wire it in.** Add this function immediately before `function initApp(){` (line 915):

```javascript
function renderGroupLoginOptions(){
  const sel = document.getElementById('groupLoginSelect');
  if(!sel) return;
  const ids = Object.keys(groups||{}).sort((a,b)=>Number(a)-Number(b));
  const list = ids.length ? ids : Array.from({length:NUM_GROUPS},(_,i)=>String(i+1));
  sel.innerHTML = list.map(id=>`<option value="${id}">Kumpulan ${id}</option>`).join('');
}
```

Replace the `initApp` dropdown loop (lines 916-918):

```javascript
  const sel = document.getElementById('groupLoginSelect');
  sel.innerHTML='';
  for(let i=1;i<=NUM_GROUPS;i++) sel.innerHTML += `<option value="${i}">Kumpulan ${i}</option>`;
```

with:

```javascript
  renderGroupLoginOptions();
```

In `loadConfigCache` (lines 968-973), add `renderGroupLoginOptions()` after `groups = cfg.groups || {};`:

```javascript
    stations = cfg.stations || {};
    groups = cfg.groups || {};
    renderGroupLoginOptions();
    buildStationsUI(stations);
```

- [ ] **Step 10: Add the render + mutation handlers.** Add these functions immediately before `function renderGroupLoginOptions(){` (from Step 9):

```javascript
// ---------- ADMIN: GROUP & MEMBER MANAGER ----------
function renderGroupManager(){
  const ids = Object.keys(groups||{}).sort((a,b)=>Number(a)-Number(b));
  groupDraft = ids.map(gid=>Array.isArray(groups[gid].members)?groups[gid].members.slice():[]);
  const locked = !!(sessionInfo && sessionInfo.status==='active');
  const lock = document.getElementById('groupManagerLock');
  if(lock) lock.innerHTML = locked
    ? '<div class="msg">🔒 Sesi sedang aktif — pengurusan kumpulan dikunci. Tekan Tamat sebelum mengubah kumpulan.</div>' : '';
  const ng = document.getElementById('group_num_groups');
  if(ng && ids.length) ng.value = ids.length;
  renderGroupCards();
  document.querySelectorAll('#admin-panel-groups .group-setup input, #admin-panel-groups .group-setup textarea, #admin-panel-groups .group-setup button, #admin-panel-groups .feature-actions button')
    .forEach(el=>{ el.disabled = locked; });
}
function renderGroupCards(){
  const wrap = document.getElementById('groupCards');
  if(!wrap) return;
  const locked = !!(sessionInfo && sessionInfo.status==='active');
  const dis = locked ? ' disabled' : '';
  if(!groupDraft.length){
    wrap.innerHTML = '<div class="empty-state">Tiada kumpulan lagi. Tetapkan bilangan dan tekan “Agih ke Kumpulan”, atau tekan “＋ Tambah Kumpulan”.</div>';
    return;
  }
  wrap.innerHTML = groupDraft.map((members,gIdx)=>{
    const rows = members.map((name,mIdx)=>{
      const opts = groupDraft.map((_,j)=> j===gIdx ? '' : `<option value="${j}">Kumpulan ${j+1}</option>`).join('');
      const move = groupDraft.length>1
        ? `<select id="group_move_${gIdx}_${mIdx}"${dis}>${opts}</select><button onclick="groupMoveMember(${gIdx},${mIdx})"${dis}>Pindah</button>` : '';
      return `<li><span class="member-name">${escapeHtml(name)}</span>${move}<button onclick="groupRemoveMember(${gIdx},${mIdx})"${dis}>Buang</button></li>`;
    }).join('');
    return `<div class="group-card">
      <div class="group-card-head"><h4>Kumpulan ${gIdx+1} <span class="member-count">(${members.length})</span></h4>
      <button onclick="groupRemoveGroup(${gIdx})"${dis}>Padam Kumpulan</button></div>
      <ul class="member-list">${rows || '<li class="empty-state">Tiada ahli</li>'}</ul>
      <div class="member-add"><input id="group_add_${gIdx}" placeholder="Nama ahli baharu"${dis}><button onclick="groupAddMember(${gIdx})"${dis}>＋ Tambah Ahli</button></div>
    </div>`;
  }).join('');
}
function groupAgih(){
  const ng = parseInt(document.getElementById('group_num_groups').value,10);
  const mp = parseInt(document.getElementById('group_members_per').value,10);
  const msg = document.getElementById('groupAgihMsg');
  if(!(ng>=1) || !(mp>=1)){
    if(msg) msg.innerHTML='<div class="msg err">Masukkan bilangan kumpulan dan ahli yang sah (≥ 1).</div>';
    return;
  }
  const names = GroupRoster.normalizeNames(document.getElementById('group_names').value);
  const res = GroupRoster.distributeNames(names, ng, mp);
  groupDraft = res.groups;
  renderGroupCards();
  if(msg) msg.innerHTML = res.overflow.length
    ? `<div class="msg">⚠️ ${res.overflow.length} nama berlebihan tidak diagihkan: ${res.overflow.map(escapeHtml).join(', ')}. Tambah kumpulan/ahli untuk memuatkannya.</div>`
    : `<div class="msg ok">✅ ${names.length} nama diagihkan ke ${ng} kumpulan.</div>`;
}
function groupMoveMember(fromIdx, memberIdx){
  const sel = document.getElementById(`group_move_${fromIdx}_${memberIdx}`);
  if(!sel) return;
  const toIdx = parseInt(sel.value,10);
  if(isNaN(toIdx)) return;
  groupDraft = GroupRoster.moveMember(groupDraft, fromIdx, memberIdx, toIdx);
  renderGroupCards();
}
function groupRemoveMember(gIdx, mIdx){
  groupDraft = GroupRoster.removeMember(groupDraft, gIdx, mIdx);
  renderGroupCards();
}
function groupAddMember(gIdx){
  const input = document.getElementById('group_add_'+gIdx);
  if(!input) return;
  groupDraft = GroupRoster.addMember(groupDraft, gIdx, input.value);
  renderGroupCards();
}
function groupAddGroup(){
  groupDraft = GroupRoster.addGroup(groupDraft);
  renderGroupCards();
}
function groupRemoveGroup(gIdx){
  if(groupDraft.length<=1){ alert('Mesti ada sekurang-kurangnya satu kumpulan.'); return; }
  const count = (groupDraft[gIdx]||[]).length;
  if(!confirm(`Padam Kumpulan ${gIdx+1}${count?` dan ${count} ahlinya`:''}?`)) return;
  groupDraft = GroupRoster.removeGroup(groupDraft, gIdx);
  renderGroupCards();
}
```

- [ ] **Step 11: Run the Playwright test to verify it passes**

Run: `npx playwright test tests/group-management.spec.js --reporter=line`
Expected: PASS — all 4 tests pass. (The `saveGroupManager` button is present but not exercised by these tests; its handler lands in Task 3.)

- [ ] **Step 12: Run regressions**

Run: `npx playwright test tests/student-island-journey.spec.js tests/run-tracker.spec.js --reporter=line`
Expected: PASS — 2 tests pass (login dropdown change did not break existing flows).

- [ ] **Step 13: Commit**

```bash
git add index.html tests/group-management.spec.js
git commit -m "feat: add admin group and member manager tab"
```

---

### Task 3: Commit path + decouple pushConfig (`index.html`)

**Files:**
- Modify: `index.html` — add `buildGroupsFromDraft` + `saveGroupManager` (near the other group functions); `collectGroups` (line 1296-1311) to include `members:[]`; `pushConfig` (line 1312-1327) to preserve an existing roster and use a dynamic count.
- Test: `tests/group-management.spec.js` (append two tests).

**Interfaces:**
- Consumes from Task 2: global `groupDraft`, `renderGroupLoginOptions()`. Existing: `groups`, `sessionInfo`, `generateLoginPassword`, `startStationForGroup`, `rotationFor`, `numericLoginPassword`, `collectStations`, `validateStationPasswords`, `validateWorksheetStations`, `db`, `PATH`.
- Produces: `buildGroupsFromDraft(draftMembers, existingGroups) -> {gid: groupObj}`; `saveGroupManager()`.

- [ ] **Step 1: Append the failing persistence + preservation tests** to `tests/group-management.spec.js` (reuse the `seedPage`, `baseSeed`, `openGroupTab` helpers already in the file):

```javascript
test('Simpan writes members to config/groups and resets progress', async ({ page }) => {
  await seedPage(page, baseSeed());
  await openGroupTab(page);
  await page.evaluate(() => saveGroupManager());
  const saved = await page.evaluate(() =>
    db.ref('gamestation2026/config/groups').once('value').then(s => s.val()));
  expect(saved['1'].members).toEqual(['Ali', 'Siti']);
  expect(saved['1'].loginPassword).toBe('1001');       // preserved by index
  expect(saved['2'].members).toEqual(['Abu']);
  const prog = await page.evaluate(() =>
    db.ref('gamestation2026/progress').once('value').then(s => s.val()));
  expect(prog['1']).toMatchObject({ currentIndex: 0, status: 'idle', totalScore: 0 });
});

test('pushConfig preserves an existing roster (does not regenerate groups)', async ({ page }) => {
  await seedPage(page, baseSeed());
  await page.goto(pathToFileURL(path.join(__dirname, '..', 'index.html')).href);
  await page.evaluate(async () => {
    await loadConfigCache();
    sessionInfo = { status: 'setup' };
    show('view-admin');
    selectAdminTab('setup');
    pushConfig();
    await new Promise(r => setTimeout(r, 0));
  });
  const saved = await page.evaluate(() =>
    db.ref('gamestation2026/config/groups').once('value').then(s => s.val()));
  expect(Object.keys(saved)).toEqual(['1', '2']);          // still 2 groups, not 14
  expect(saved['1'].members).toEqual(['Ali', 'Siti']);     // roster preserved
});
```

- [ ] **Step 2: Run the appended tests to verify they fail**

Run: `npx playwright test tests/group-management.spec.js --reporter=line`
Expected: FAIL — `saveGroupManager is not defined` and `pushConfig` still regenerates 14 groups.

- [ ] **Step 3: Add `buildGroupsFromDraft` and `saveGroupManager`.** Add immediately after `groupRemoveGroup` (from Task 2, Step 10):

```javascript
function buildGroupsFromDraft(draftMembers, existingGroups){
  const out = {};
  const usedPasswords = new Set();
  draftMembers.forEach((members, idx)=>{
    const id = idx+1;
    const defaultStart = ((id-1)%6)+1;
    const existing = existingGroups && existingGroups[id];
    const existingPass = numericLoginPassword(existing && existing.loginPassword);
    const loginPassword = existingPass && !usedPasswords.has(existingPass)
      ? (usedPasswords.add(existingPass), existingPass)
      : generateLoginPassword(usedPasswords);
    const startStation = startStationForGroup(existing, defaultStart);
    out[id] = { id, name:'Kumpulan '+id, startStation, order:rotationFor(startStation),
                loginPassword, members: members.slice() };
  });
  return out;
}
function saveGroupManager(){
  const msg = document.getElementById('groupSaveMsg');
  if(sessionInfo && sessionInfo.status==='active'){
    if(msg) msg.innerHTML='<div class="msg err">Tidak boleh simpan semasa sesi aktif. Tekan Tamat dahulu.</div>';
    return;
  }
  if(!groupDraft.length){
    if(msg) msg.innerHTML='<div class="msg err">Mesti ada sekurang-kurangnya satu kumpulan.</div>';
    return;
  }
  const gr = buildGroupsFromDraft(groupDraft, groups);
  const prog = {};
  Object.keys(gr).forEach(gid=>{ prog[gid]={currentIndex:0,status:'idle',completedStations:{},keys:[],totalScore:0}; });
  Promise.all([
    db.ref(PATH+'/config/groups').set(gr),
    db.ref(PATH+'/progress').set(prog),
    db.ref(PATH+'/session').set({status:'setup'})
  ]).then(()=>{
    groups = gr;
    sessionInfo = {status:'setup'};
    renderGroupLoginOptions();
    if(msg) msg.innerHTML=`<div class="msg ok">✅ ${Object.keys(gr).length} kumpulan disimpan. Progress direset.</div>`;
  });
}
```

- [ ] **Step 4: Add `members:[]` to the first-run seed.** In `collectGroups` (line 1308), change the output object to include `members`:

```javascript
    out[i]={id:i, name:'Kumpulan '+i, startStation, order:rotationFor(startStation), loginPassword, members:[]};
```

- [ ] **Step 5: Decouple `pushConfig` from group regeneration.** Replace the body of `pushConfig` (lines 1312-1327) with:

```javascript
function pushConfig(){
  const st = collectStations();
  if(!validateStationPasswords(st) || !validateWorksheetStations(st)) return;
  // Preserve an existing roster (managed in the Kumpulan tab); only seed a
  // default set on a brand-new database.
  const hasGroups = groups && Object.keys(groups).length>0;
  const gr = hasGroups ? groups : collectGroups();
  const prog={};
  Object.keys(gr).forEach(gid=>{ prog[gid]={currentIndex:0,status:'idle',completedStations:{},keys:[],totalScore:0}; });
  db.ref(PATH+'/config/stations').set(st);
  db.ref(PATH+'/config/groups').set(gr);
  db.ref(PATH+'/session').set({status:'setup'}); // fresh config -> not started yet
  db.ref(PATH+'/progress').set(prog).then(()=>{
    stations=st; groups=gr;
    renderGroupLoginOptions();
    let listHtml = '<h4>Password Login Kumpulan (beri kepada setiap kumpulan)</h4><table><tr><th>Kumpulan</th><th>Password</th><th>Mula di Stesen</th></tr>';
    Object.values(gr).forEach(g=>{ listHtml += `<tr><td>${g.name}</td><td><b>${g.loginPassword}</b></td><td>${g.startStation}</td></tr>`; });
    listHtml += '</table>';
    document.getElementById('pushStatus').innerHTML='<div class="msg ok">✅ Config di-push. '+Object.keys(gr).length+' kumpulan sedia.</div>'+listHtml;
  });
}
```

- [ ] **Step 6: Run the group-management tests to verify they pass**

Run: `npx playwright test tests/group-management.spec.js --reporter=line`
Expected: PASS — all 6 tests pass.

- [ ] **Step 7: Run full regression suite**

Run: `node --test groups/roster.test.js run/tracker.test.js tangram/engine.test.js && npx playwright test --reporter=line`
Expected: PASS — node tests all pass; all Playwright specs pass.

- [ ] **Step 8: Commit**

```bash
git add index.html tests/group-management.spec.js
git commit -m "feat: persist group roster and decouple station setup from groups"
```

---

## Self-Review

**Spec coverage:**
- Named-member roster per group (`members` field) — Task 1 data + Task 3 `buildGroupsFromDraft`. ✓
- Admin sets group count + members-per-group first, then paste + distribute sequentially — Task 2 tab + `groupAgih` using `distributeNames`. ✓
- Overflow warning / underflow empty slots — Task 1 `distributeNames` + Task 2 `groupAgih` message. ✓
- Move member (special button), add member, remove member — Task 2 handlers. ✓
- Add group, delete group (removes members, confirm, ≥1 remains) — Task 2 `groupAddGroup`/`groupRemoveGroup`. ✓
- Dynamic group count → chests/board/dropdown follow — Task 2 `renderGroupLoginOptions`; board/dashboard already iterate groups (no hardcoded count in the active admin view). ✓
- Simpan commits `config/groups` + resets progress; preserves password & start station by index; generates for new — Task 3 `buildGroupsFromDraft`/`saveGroupManager`. ✓
- Locked while session active — Task 2 `renderGroupManager` disables controls; Task 3 `saveGroupManager` re-checks. ✓
- Decouple `pushConfig` so saving stations preserves the roster — Task 3 Step 5 + test. ✓
- Members not shown to students / not on printouts — nothing renders members outside the admin tab. ✓
- Pure module + node tests; Playwright UI/persistence tests — Tasks 1-3. ✓

**Placeholder scan:** No TBD/TODO; every step has complete code. The Task 3 Step 1 test has an interim-then-final form explicitly resolved to the final version (implementer uses the final block). ✓

**Type consistency:** `GroupRoster.*` names and the `string[][]` shape are consistent across Tasks 1-3. `groupDraft` (declared Task 2 Step 8) is used by all handlers and `saveGroupManager`. `renderGroupLoginOptions` (Task 2 Step 9) is called from `initApp`, `loadConfigCache`, `saveGroupManager`, and `pushConfig`. `buildGroupsFromDraft` return shape (`{gid: {id,name,startStation,order,loginPassword,members}}`) matches the config shape the rest of the app reads. Group objects preserve `startStation` via `startStationForGroup`, honoring the existing configurable-start-station feature. ✓
