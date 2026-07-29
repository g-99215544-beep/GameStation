// ---------- ADMIN NAVIGATION ----------
const ADMIN_TAB_NOTES = {
  groups:'Langkah 1: tetapkan kumpulan, agih nama murid, dan urus ahli.',
  setup:'Langkah 2: lengkapkan maklumat dan permainan untuk setiap stesen.',
  passwords:'Langkah 3: semak dan agihkan password login kepada semua kumpulan.',
  qr:'Langkah 4: jana QR, cetak, dan sorokkan di lokasi yang dinyatakan.',
  session:'Langkah terakhir: mula atau tamatkan Treasure Hunt dari sini.',
  treasure:'Buka Smart Board untuk kawal peti harta karun dan bonus tamat.',
  dashboard:'Pantau status, stesen semasa, kunci, dan markah semua kumpulan.'
};
const ADMIN_STEP_MAP = {groups:1,setup:2,passwords:3,qr:4,session:5};
let adminTopTab='hunts';
function selectAdminTopTab(tab){
  adminTopTab=tab;
  const nav=document.querySelector('.admin-nav');
  if(nav) nav.hidden = tab!=='setup';
  const list=document.getElementById('admin-hunt-list');
  const setupPanels=['groups','setup','passwords','qr'];
  const huntsButton=document.getElementById('adminTopHunts');
  const setupButton=document.getElementById('adminTopSetup');
  if(huntsButton) huntsButton.classList.toggle('secondary',tab==='hunts');
  if(setupButton) setupButton.classList.toggle('secondary',tab==='setup');
  if(list) list.hidden=tab!=='hunts';
  if(tab==='hunts'){
    document.querySelectorAll('.admin-panel').forEach(panel=>panel.classList.remove('active'));
    renderHuntList();
    return;
  }
  setupPanels.forEach(name=>document.getElementById('admin-panel-'+name)?.classList.remove('active'));
  selectAdminTab('groups');
}
function watchHunts(){
  rootRef('hunts').on('value',snap=>{
    hunts=snap.val()||{};
    activeHuntId=HuntRegistry.activeHuntId(hunts);
    renderHuntList();
  });
}
function renderHuntList(){
  const holder=document.getElementById('huntList');
  if(!holder) return;
  const list=HuntRegistry.sortedHunts(hunts).filter(hunt=>hunt.name);
  if(!list.length){
    holder.innerHTML='<div class="empty-state">Belum ada Treasure Hunt. Tekan “Setup Treasure Hunt Baru” untuk mula.</div>';
    return;
  }
  holder.innerHTML=list.map(hunt=>{
    const label=HuntRegistry.statusLabel(hunt);
    const active=label==='Aktif';
    return `<div class="group-card"><div class="group-card-head"><h4>${escapeHtml(hunt.name)} <span class="badge ${active?'done':'idle'}">${label}</span></h4></div>
      <div class="feature-actions">
        <button class="secondary" onclick="toggleHuntSession('${hunt.id}')">${active?'Tamat':'Mula'} Hunt</button>
        <button onclick="editHunt('${hunt.id}')">Edit</button>
        <button onclick="openHuntDashboard('${hunt.id}')">Live Dashboard</button>
        <button onclick="openHuntTreasure('${hunt.id}')">Peti Harta Karun</button>
        <button onclick="deleteHunt('${hunt.id}')">Padam</button>
      </div></div>`;
  }).join('');
}
function beginNewHunt(){
  currentHuntId=null; currentHuntCreatedAt=null; isHuntDraft=true; stations={}; groups={}; stationCount=3; groupDraft=[]; sessionInfo={status:'setup'};
  const name=document.getElementById('huntName'); if(name) name.value='';
  buildStationsUI(stations); renderGroupManager();
  selectAdminTopTab('setup');
}
function editHunt(id){
  const hunt=hunts[id]; if(!hunt) return;
  currentHuntId=id; currentHuntCreatedAt=hunt.createdAt||null;
  isHuntDraft=false;
  loadConfigCache().then(()=>{
    const name=document.getElementById('huntName'); if(name) name.value=hunt.name||'';
    selectAdminTopTab('setup'); selectAdminTab('groups'); watchSession();
  });
}
function openHuntDashboard(id){
  const hunt=hunts[id]; if(!hunt) return;
  currentHuntId=id; currentHuntCreatedAt=hunt.createdAt||null;
  isHuntDraft=false;
  loadConfigCache().then(()=>{ selectAdminTopTab('setup'); selectAdminTab('dashboard'); watchDashboard(); });
}
function openHuntTreasure(id){
  const hunt=hunts[id]; if(!hunt) return;
  currentHuntId=id; currentHuntCreatedAt=hunt.createdAt||null;
  isHuntDraft=false;
  loadConfigCache().then(()=>showSmartBoard());
}
function toggleHuntSession(id){
  const hunt=hunts[id]; if(!hunt) return;
  if(hunt.session && hunt.session.status==='active'){
    currentHuntId=id;
    Promise.all([huntRef('session').update({status:'ended',endedAt:Date.now()}),rootRef('activeHuntId').set(null)]).catch(error=>alert('Tidak dapat tamatkan hunt: '+error.message));
    return;
  }
  if(!HuntRegistry.canStart(hunts,id) || (activeHuntId && String(activeHuntId)!==String(id))){
    alert('Treasure Hunt lain masih aktif. Tamatkan hunt tersebut dahulu.'); return;
  }
  currentHuntId=id;
  Promise.all([huntRef('session').set({status:'active',startedAt:Date.now()}),rootRef('activeHuntId').set(id)]).catch(error=>alert('Tidak dapat mulakan hunt: '+error.message));
}
function deleteHunt(id){
  if(String(activeHuntId)===String(id) || (hunts[id]&&hunts[id].session&&hunts[id].session.status==='active')){
    alert('Treasure Hunt aktif tidak boleh dipadam. Tamatkan dahulu.'); return;
  }
  if(!confirm(`Padam Treasure Hunt “${hunts[id]&&hunts[id].name||id}”?`)) return;
  rootRef('hunts/'+id).remove();
}
function selectAdminTab(tab){
  if(!document.getElementById('adminTabSelect')) return;
  const allowed = Object.prototype.hasOwnProperty.call(ADMIN_TAB_NOTES, tab) ? tab : 'setup';
  document.getElementById('adminTabSelect').value = allowed;
  document.querySelectorAll('.admin-panel').forEach(panel=>panel.classList.remove('active'));
  const panel = document.getElementById('admin-panel-'+allowed);
  if(panel) panel.classList.add('active');
  const note = document.getElementById('adminTabNote');
  if(note) note.innerText = ADMIN_TAB_NOTES[allowed];
  updateSetupSteps(ADMIN_STEP_MAP[allowed] || 0);
  if(allowed==='passwords') showLoginPasswords();
  if(allowed==='session') renderSessionControls();
  if(allowed==='groups') renderGroupManager();
}
function updateSetupSteps(activeStep){
  document.querySelectorAll('.setup-step').forEach(step=>{
    const n = Number(step.getAttribute('data-step'));
    step.classList.toggle('active', n===activeStep);
    step.classList.toggle('done', activeStep>0 && n<activeStep);
  });
}
function goToAdminStep(tab){ selectAdminTab(tab); }
function logout(){
  if(timerInterval) clearInterval(timerInterval);
  if(html5QrCode){ html5QrCode.stop().catch(()=>{}); }
  huntRef().off('value');
  stopWatchingCannonHits();
  // Registered on progress/<gid>, so the hunt-root off() above never reaches
  // it. Left attached, it would keep firing after the next group logs in on
  // this phone and overwrite their progress with the previous group's.
  if(chestProgressRef){ chestProgressRef.off('value'); chestProgressRef=null; }
  document.body.classList.remove('board-mode');
  currentGroupId = null;
  progress = {};
  clearSession();
  document.getElementById('topTitle').innerText='🎯 Game Station';
  document.getElementById('timer').style.display='none';
  show('view-login');
}

// ---------- SESSION LIFECYCLE (reusable across events) ----------
function watchSession(){
  const path=huntPath('session');
  if(watchedSessionPath===path) return;
  if(watchedSessionRef) watchedSessionRef.off('value');
  watchedSessionPath=path;
  watchedSessionRef=huntRef('session');
  watchedSessionRef.on('value', snap=>{
    sessionInfo = snap.val() || {status:'setup'};
    persistSessionCache(sessionInfo);
    renderSessionControls();      // admin card (no-op when not on admin)
    syncStartStationControlLock();
    syncGroupManagerLock();
    syncStationSetupLock();
    reactToSessionForGroup();     // group waiting/ended/enter
  });
}
function syncStartStationControlLock(){
  const locked=(sessionInfo||{}).status==='active';
  document.querySelectorAll('[id^="start_station_"]').forEach(select=>{ select.disabled=locked; });
  const note=document.getElementById('startStationLockedNote');
  if(note) note.hidden=!locked;
}
// Admin: reflect status and show only the relevant button(s).
function renderSessionControls(){
  const el = document.getElementById('sessionStatus');
  if(!el) return;
  const st = (sessionInfo||{}).status || 'setup';
  const map = {setup:['⚪ Belum Bermula','#8a6d1a'], active:['🟢 SESI AKTIF','var(--green)'], ended:['🔴 SESI TAMAT','var(--red)']};
  const [label,color] = map[st] || map.setup;
  el.innerHTML = `<div style="font-size:22px;font-weight:800;color:${color};margin:6px 0 2px;">${label}</div>`;
  const start=document.getElementById('btnStart'), end=document.getElementById('btnEnd'), nw=document.getElementById('btnNew');
  if(start) start.style.display = (st==='active') ? 'none' : 'inline-block';
  if(end)   end.style.display   = (st==='active') ? 'inline-block' : 'none';
  if(nw)    nw.style.display    = (st==='ended')  ? 'inline-block' : 'none';
}
function startSession(){
  if(!currentHuntId){ alert('Pilih Treasure Hunt daripada senarai dahulu.'); return; }
  if(!HuntRegistry.canStart(hunts,currentHuntId)){ alert('Treasure Hunt lain masih aktif.'); return; }
  Promise.all([huntRef('session').set({status:'active', startedAt:Date.now()}),rootRef('activeHuntId').set(currentHuntId)]);
}
function endSession(){
  if(!confirm('Tamatkan sesi sekarang? Kumpulan tidak boleh main lagi.')) return;
  Promise.all([huntRef('session').update({status:'ended', endedAt:Date.now()}),rootRef('activeHuntId').set(null)]);
}
function newSession(){
  if(!confirm('Mula sesi BARU dengan murid baru?\n\nSemua progress & peti harta akan direset. Stesen & password login kekal.')) return;
  const prog={};
  Object.keys(groups||{}).forEach(gid=>{ prog[gid]=freshGroupProgress(); });
  huntRef('progress').set(prog);
  huntRef('session').set({status:'setup'});
}
// Group side: route to game / waiting / ended based on live session status.
function enterGroupBySession(){
  const st = (sessionInfo||{}).status || 'setup';
  if(st==='active') loadGroupProgress();
  else showSessionMsg(st==='ended' ? 'ended' : 'waiting');
}
function reactToSessionForGroup(){
  if(!currentGroupId) return;              // only for a logged-in group
  const st = (sessionInfo||{}).status || 'setup';
  const onMsg = document.getElementById('view-session').classList.contains('active');
  if(st!=='active'){ showSessionMsg(st==='ended' ? 'ended' : 'waiting'); }
  else if(onMsg){ loadGroupProgress(); }   // session (re)started while waiting -> enter
}
function showSessionMsg(kind){
  if(timerInterval) clearInterval(timerInterval);
  if(html5QrCode){ html5QrCode.stop().catch(()=>{}); }
  document.getElementById('timer').style.display='none';
  show('view-session');
  const card = document.getElementById('sessionMsgCard');
  if(kind==='waiting'){
    card.innerHTML = `<div style="font-size:64px;">⏳</div>
      <h2>Menunggu Guru Mula Sesi</h2>
      <p>Kumpulan ${currentGroupId} sudah log masuk.<br>Sesi belum bermula — tunggu guru tekan <b>Mula</b>.</p>
      <button class="linkbtn" onclick="logout()">← Log keluar</button>`;
  } else {
    card.innerHTML = `<div style="font-size:64px;">🏁</div><h2>Sesi Tamat</h2><p>Terima kasih, Kumpulan ${currentGroupId}!</p><div id="sessFinal" style="font-size:34px;font-weight:800;color:var(--gold);margin:8px 0;">…</div><button class="linkbtn" onclick="logout()">← Log keluar</button>`;
    huntRef('progress/'+currentGroupId).once('value').then(s=>{
      const p=s.val()||{}; const sc = (p.finalScore!=null ? p.finalScore : (p.totalScore||0));
      const el=document.getElementById('sessFinal'); if(el) el.innerText = sc + ' markah';
    });
  }
}

