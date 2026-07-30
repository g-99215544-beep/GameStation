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
function syncGroupManagerLock(){
  const panel = document.getElementById('admin-panel-groups');
  if(!panel || !panel.classList.contains('active')) return; // only act when the tab is open
  const locked = !!(sessionInfo && sessionInfo.status==='active');
  const lock = document.getElementById('groupManagerLock');
  if(lock) lock.innerHTML = locked
    ? '<div class="msg">🔒 Sesi sedang aktif — pengurusan kumpulan dikunci. Tekan Tamat sebelum mengubah kumpulan.</div>' : '';
  panel.querySelectorAll('.group-setup input, .group-setup textarea, .group-setup button, .feature-actions button, #groupCards select, #groupCards button, #groupCards input')
    .forEach(el=>{ el.disabled = locked; });
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
  markSetupStepDirty('groups');
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
  markSetupStepDirty('groups');
  renderGroupCards();
}
function groupRemoveMember(gIdx, mIdx){
  groupDraft = GroupRoster.removeMember(groupDraft, gIdx, mIdx);
  markSetupStepDirty('groups');
  renderGroupCards();
}
function groupAddMember(gIdx){
  const input = document.getElementById('group_add_'+gIdx);
  if(!input) return;
  groupDraft = GroupRoster.addMember(groupDraft, gIdx, input.value);
  markSetupStepDirty('groups');
  renderGroupCards();
}
function groupAddGroup(){
  groupDraft = GroupRoster.addGroup(groupDraft);
  markSetupStepDirty('groups');
  renderGroupCards();
}
function groupRemoveGroup(gIdx){
  if(groupDraft.length<=1){ alert('Mesti ada sekurang-kurangnya satu kumpulan.'); return; }
  const count = (groupDraft[gIdx]||[]).length;
  if(!confirm(`Padam Kumpulan ${gIdx+1}${count?` dan ${count} ahlinya`:''}?`)) return;
  groupDraft = GroupRoster.removeGroup(groupDraft, gIdx);
  markSetupStepDirty('groups');
  renderGroupCards();
}
function buildGroupsFromDraft(draftMembers, existingGroups){
  const N = currentStationCount();
  const out = {};
  const usedPasswords = new Set();
  draftMembers.forEach((members, idx)=>{
    const id = idx+1;
    const existing = existingGroups && existingGroups[id];
    const existingPass = numericLoginPassword(existing && existing.loginPassword);
    const loginPassword = existingPass && !usedPasswords.has(existingPass)
      ? (usedPasswords.add(existingPass), existingPass)
      : generateLoginPassword(usedPasswords);
    let startStation = StationLayout.defaultStartStation(id, N);
    const currentStart = Number(existing && existing.startStation);
    if(Number.isInteger(currentStart) && currentStart>=1 && currentStart<=N) startStation=currentStart;
    out[id] = { id, name:'Kumpulan '+id, startStation, order:StationLayout.rotationOrder(startStation, N),
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
  Object.keys(gr).forEach(gid=>{ prog[gid]=freshGroupProgress(); });
  const name=String(document.getElementById('huntName')?.value||'').trim();
  if(isHuntDraft && !currentHuntId && !name){
    if(msg) msg.innerHTML='<div class="msg err">Masukkan nama Treasure Hunt sebelum menyimpan Langkah 1.</div>';
    return;
  }
  if(isHuntDraft && !currentHuntId){
    currentHuntId=rootRef('hunts').push().key;
    currentHuntCreatedAt=Date.now();
  }
  if(isHuntDraft){
    const metadata={name,createdAt:currentHuntCreatedAt||Date.now(),updatedAt:Date.now(),setupState:{groupsSavedAt:Date.now()}};
    Promise.all([
      huntRef().update(metadata),
      huntRef('config/groups').set(gr),
      huntRef('progress').set(prog),
      huntRef('session').set({status:'setup'})
    ]).then(()=>{
      isHuntDraft=false;
      groups=gr;
      sessionInfo={status:'setup'};
      renderGroupLoginOptions();
      markSetupStepSaved('groups');
      if(msg) msg.innerHTML=`<div class="msg ok">${Object.keys(gr).length} kumpulan disimpan. Anda boleh teruskan ke Langkah 2.</div>`;
    }).catch(err=>{
      if(msg) msg.innerHTML=`<div class="msg err">Gagal menyimpan kumpulan: ${escapeHtml(err && err.message ? err.message : err)}. Cuba lagi.</div>`;
    });
    return;
  }
  Promise.all([
    huntRef('config/groups').set(gr),
    huntRef('progress').set(prog),
    huntRef('session').set({status:'setup'}),
    huntRef('setupState').set({groupsSavedAt:Date.now()})
  ]).then(()=>{
    groups = gr;
    sessionInfo = {status:'setup'};
    renderGroupLoginOptions();
    markSetupStepSaved('groups');
    if(msg) msg.innerHTML=`<div class="msg ok">✅ ${Object.keys(gr).length} kumpulan disimpan. Progress direset.</div>`;
  }).catch(err=>{
    if(msg) msg.innerHTML=`<div class="msg err">❌ Gagal menyimpan kumpulan: ${escapeHtml(err && err.message ? err.message : err)}. Cuba lagi.</div>`;
  });
}
function renderGroupLoginOptions(){
  const sel = document.getElementById('groupLoginSelect');
  if(!sel) return;
  const ids = Object.keys(groups||{}).sort((a,b)=>Number(a)-Number(b));
  const list = ids.length ? ids : Array.from({length:NUM_GROUPS},(_,i)=>String(i+1));
  sel.innerHTML = list.map(id=>`<option value="${id}">Kumpulan ${id}</option>`).join('');
}

function initApp(){
  initConnectivity();
  bindSetupDirtyTracking();
  renderGroupLoginOptions();
  const demoType=directGameDemoType();
  if(demoType){ startDirectGameDemo(demoType); return; }
  watchHunts();
  const saved=readLocalJson('gs_session');
  if(saved && saved.role==='admin'){
    tryRestoreSession();
    return;
  }
  if(!isSmartBoard()) show('view-login');
  watchActiveHunt();
}

function showNoActiveHunt(){
  if(isSmartBoard()) document.getElementById('topTitle').innerText='Peti Harta Karun';
  document.getElementById('timer').style.display='none';
  if(isSmartBoard()){
    show('view-session');
    const card=document.getElementById('sessionMsgCard');
    if(card) card.innerHTML='<div style="font-size:64px;">⌛</div><h2>Belum Ada Treasure Hunt Aktif</h2><p>Guru belum memulakan Treasure Hunt. Halaman ini akan bersedia secara automatik apabila sesi dimulakan.</p>';
    return;
  }
  // Same reasoning as logout(): this drops a group back to the login screen
  // without going through it, so a chest-screen listener left attached would
  // keep writing the previous group's status and hp into the global.
  if(chestProgressRef){ chestProgressRef.off('value'); chestProgressRef=null; }
  stopWatchingCannonHits();
  show('view-login');
  const msg=document.getElementById('groupLoginMsg');
  if(msg) msg.innerHTML='<div class="msg">Belum ada Treasure Hunt aktif. Tunggu guru tekan Mula.</div>';
}
function watchActiveHunt(){
  if(activeHuntWatcherRef) return;
  activeHuntWatcherRef=rootRef('activeHuntId');
  activeHuntWatcherRef.on('value',snap=>{
    const id=snap.val()||null;
    activeHuntId=id;
    const saved=readLocalJson('gs_session');
    if(saved && saved.role==='admin') return;
    if(!id){
      if(saved && saved.role==='group' && !saved.huntId){
        loadConfigCache().then(()=>{ watchSession(); tryRestoreSession(); }).catch(showNoActiveHunt);
        return;
      }
      showNoActiveHunt();
      return;
    }
    if(String(currentHuntId)===String(id) && stations && Object.keys(stations).length){
      if(isSmartBoard()) showSmartBoard();
      else if(saved && saved.role==='group') tryRestoreSession();
      else show('view-login');
      return;
    }
    currentHuntId=id;
    currentHuntCreatedAt=(hunts[id]||{}).createdAt||null;
    loadConfigCache().then(()=>{
      watchSession();
      if(isSmartBoard()) showSmartBoard();
      else if(saved && saved.role==='group') tryRestoreSession();
      else show('view-login');
    }).catch(error=>{
      console.warn(error.message);
      showNoActiveHunt();
    });
  });
}

// Launch any supported station directly in demo mode (no Firebase writes).
function startDirectGameDemo(type){
  const demo=DIRECT_GAME_DEMOS[type];
  if(!demo) return;
  window._testMode=true;
  window._directTestMode=true;
  window._demoMode=type==='tangram';
  document.getElementById('topTitle').innerText=`🧪 ${demo.name}`;
  startGame('demo',{...demo,id:'demo',timeLimitMin:10});
}
function startTangramDemo(){
  startDirectGameDemo('tangram');
}

const SESSION_DURATION_MS = 2*60*60*1000;
let sessionExpiryTimer=null;

function saveSession(role, gid){
  const session={role, groupId:gid||null, huntId:currentHuntId||null, ts:Date.now()};
  localStorage.setItem('gs_session', JSON.stringify(session));
  scheduleSessionExpiry(session);
}
function clearSession(){
  if(sessionExpiryTimer!==null){
    window.clearTimeout(sessionExpiryTimer);
    sessionExpiryTimer=null;
  }
  localStorage.removeItem('gs_session');
}
function isSessionCurrent(session, now){
  const ts=Number(session && session.ts);
  const current=now==null ? Date.now() : Number(now);
  return Number.isFinite(ts) && ts>0 && Number.isFinite(current) &&
    current>=ts && current-ts<SESSION_DURATION_MS;
}
function expirePersistentSession(){
  sessionExpiryTimer=null;
  if(typeof captureStationResume==='function') captureStationResume();
  logout();
}
function scheduleSessionExpiry(session){
  if(sessionExpiryTimer!==null) window.clearTimeout(sessionExpiryTimer);
  sessionExpiryTimer=null;
  if(!isSessionCurrent(session)) return false;
  const remaining=SESSION_DURATION_MS-(Date.now()-Number(session.ts));
  sessionExpiryTimer=window.setTimeout(expirePersistentSession,Math.max(0,remaining));
  return true;
}
// Gate on the session: an already-cached active session also permits offline play.
function resolveSessionThenEnter(){
  const cached=cachedSession();
  if(isOffline()){
    sessionInfo=cached||{status:'setup'};
    enterGroupBySession();
    return;
  }
  huntRef('session').once('value').then(s=>{
    sessionInfo=s.val()||{status:'setup'}; persistSessionCache(sessionInfo); enterGroupBySession();
  }).catch(()=>{ sessionInfo=cached||{status:'setup'}; enterGroupBySession(); });
}
function tryRestoreSession(){
  const raw = localStorage.getItem('gs_session');
  if(!raw){ show('view-login'); return; }
  let session;
  try{ session = JSON.parse(raw); }catch(e){
    clearSession();
    show('view-login');
    return;
  }
  if(!scheduleSessionExpiry(session)){
    clearSession();
    show('view-login');
    return;
  }
  if(session.role==='admin'){
    show('view-admin');
    document.getElementById('topTitle').innerText='⚙️ Admin Panel';
    selectAdminTopTab('hunts');
  } else if(session.role==='group' && session.groupId && groups[session.groupId]){
    currentGroupId = session.groupId;
    document.getElementById('topTitle').innerText='Kumpulan '+currentGroupId;
    // Deliberately no preload here: a returning student already downloaded
    // everything at login and must not be made to wait a second time.
    resolveSessionThenEnter();
  } else {
    clearSession();
    show('view-login');
  }
}

function loadConfigCache(){
  const loadLocal=()=>{
    const cached=readLocalJson(OfflineStore.CONFIG_CACHE_KEY);
    if(!cached || (currentHuntId && cached.huntId && String(cached.huntId)!==String(currentHuntId))) throw new Error('Config belum disimpan pada peranti ini. Sambung internet sekali untuk log masuk.');
    applyConfigCache(cached);
  };
  // Use the already-saved copy immediately when it exists offline. If this is
  // a first visit with no cache, still try Firebase once: `.info/connected`
  // and `navigator.onLine` can both be briefly stale while a page is opening.
  if(isOffline() && readLocalJson(OfflineStore.CONFIG_CACHE_KEY)){
    loadLocal();
    return Promise.resolve();
  }
  return firebaseOnceWithTimeout(huntRef('config')).then(snap=>{
    applyConfigCache(snap.val()||{});
    cacheConfig();
  }).catch(()=>{ loadLocal(); });
}

// ---------- LOGIN ----------
function showAdminLogin(){
  const card = document.getElementById('adminLoginCard');
  if(!card) return;
  card.classList.add('open');
  card.setAttribute('aria-hidden','false');
  const msg = document.getElementById('adminLoginMsg');
  if(msg) msg.innerHTML='';
  const pin = document.getElementById('adminPin');
  if(pin){ pin.value=''; setTimeout(()=>pin.focus(), 0); }
}
function hideAdminLogin(){
  const card = document.getElementById('adminLoginCard');
  if(card){
    // Move focus out before hiding. Leaving the PIN field focused inside an
    // aria-hidden dialog hides a focused control from screen readers, which the
    // browser rejects outright and logs about.
    if(card.contains(document.activeElement)) document.activeElement.blur();
    card.classList.remove('open');
    card.setAttribute('aria-hidden','true');
  }
}
document.addEventListener('keydown', event=>{
  if(event.key==='Escape') hideAdminLogin();
});
function loginAsAdmin(){
  if(document.getElementById('adminPin').value === ADMIN_PIN){
    hideAdminLogin();
    saveSession('admin');
    show('view-admin');
    document.getElementById('topTitle').innerText='⚙️ Admin Panel';
    watchHunts();
    selectAdminTopTab('hunts');
  } else {
    document.getElementById('adminLoginMsg').innerHTML='<div class="msg err">PIN salah</div>';
  }
}
function loginAsGroup(){
  const gid = document.getElementById('groupLoginSelect').value;
  const inputPass = document.getElementById('groupLoginPass').value.trim();
  const g = groups[gid];
  const msg = document.getElementById('groupLoginMsg');
  if(!g || !g.loginPassword){
    msg.innerHTML='<div class="msg err">Config kumpulan belum di-push oleh admin.</div>';
    return;
  }
  if(inputPass !== numericLoginPassword(g.loginPassword)){
    msg.innerHTML='<div class="msg err">❌ Password kumpulan salah.</div>';
    return;
  }
  msg.innerHTML='';
  currentGroupId = gid;
  saveSession('group', gid);
  document.getElementById('topTitle').innerText='Kumpulan '+currentGroupId;
  // Download everything before the group walks away from the Wi-Fi. A clean
  // preload has already fetched and cached the session, so it can enter
  // directly; every other outcome falls back to the normal lookup.
  runOfflinePreload().then(result=>{
    if(result && result.ok) enterGroupBySession();
    else resolveSessionThenEnter();
  });
}
