// ---------- ADMIN: GROUPS (Langkah 1) ----------
// Step 1 only asks how many groups there are. Groups are numbered 1..N and
// each gets a unique four-digit login code, which is all a pupil needs.
const MAX_GROUPS = 30;
function groupSetupLocked(){ return !!(sessionInfo && sessionInfo.status==='active'); }
function renderGroupManager(){
  const count = Object.keys(groups||{}).length;
  const ng = document.getElementById('group_num_groups');
  if(ng) ng.value = count || 8;
  syncGroupManagerLock(true);
}
function syncGroupManagerLock(force){
  const panel = document.getElementById('admin-panel-groups');
  if(!panel || (!force && !panel.classList.contains('active'))) return;
  const locked = groupSetupLocked();
  const lock = document.getElementById('groupManagerLock');
  if(lock) lock.innerHTML = locked
    ? '<div class="msg">🔒 Sesi sedang aktif — bilangan kumpulan dikunci. Tekan Tamat sebelum mengubahnya.</div>' : '';
  const ng = document.getElementById('group_num_groups');
  if(ng) ng.disabled = locked;
}
function readGroupCount(){
  const value = Number(document.getElementById('group_num_groups')?.value);
  return Number.isInteger(value) && value>=1 && value<=MAX_GROUPS ? value : null;
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
  const count = readGroupCount();
  if(!count){
    if(msg) msg.innerHTML=`<div class="msg err">Masukkan bilangan kumpulan antara 1 dan ${MAX_GROUPS}.</div>`;
    return;
  }
  // Members are no longer managed here, but a hunt edited from the old UI
  // keeps whatever roster it already had for the groups that remain.
  const draft = Array.from({length:count},(_,i)=>{
    const existing = groups && groups[i+1];
    return existing && Array.isArray(existing.members) ? existing.members.slice() : [];
  });
  const gr = buildGroupsFromDraft(draft, groups);
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
    markSetupStepSaved('groups');
    if(msg) msg.innerHTML=`<div class="msg ok">✅ ${Object.keys(gr).length} kumpulan disimpan. Progress direset.</div>`;
  }).catch(err=>{
    if(msg) msg.innerHTML=`<div class="msg err">❌ Gagal menyimpan kumpulan: ${escapeHtml(err && err.message ? err.message : err)}. Cuba lagi.</div>`;
  });
}
function initApp(){
  initConnectivity();
  bindSetupDirtyTracking();
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
// A pupil types only their code; it identifies the group, since every code in
// a hunt is unique (enforced wherever codes are generated or saved).
function groupIdForLoginCode(code){
  const matches = Object.keys(groups||{}).filter(gid=>
    groups[gid] && numericLoginPassword(groups[gid].loginPassword)===code);
  return matches.length===1 ? matches[0] : matches.length ? 'duplicate' : null;
}
function loginAsGroup(){
  const inputPass = document.getElementById('groupLoginPass').value.trim();
  const msg = document.getElementById('groupLoginMsg');
  if(!groups || !Object.keys(groups).length){
    msg.innerHTML='<div class="msg err">Treasure Hunt belum disediakan oleh guru.</div>';
    return;
  }
  if(!/^\d{4}$/.test(inputPass)){
    msg.innerHTML='<div class="msg err">Masukkan kod 4 digit.</div>';
    return;
  }
  const gid = groupIdForLoginCode(inputPass);
  if(gid==='duplicate'){
    msg.innerHTML='<div class="msg err">Kod ini dikongsi lebih daripada satu kumpulan. Minta guru jana semula kod.</div>';
    return;
  }
  if(!gid){
    msg.innerHTML='<div class="msg err">❌ Kod kumpulan salah.</div>';
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
