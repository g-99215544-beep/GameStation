function currentStationCount(){ return StationLayout.clampStationCount(Object.keys(stations||{}).length); }
function freshGroupProgress(config=cannonConfig){
  const initial={currentIndex:0,status:'idle',completedStations:{},keys:[],totalScore:0};
  if(config && config.enabled) initial.ammo=CannonEngine.clampStartingAmmo(config.startingAmmo);
  return initial;
}
let browserOnline = navigator.onLine !== false;
let firebaseConnected = true;
let firebaseConnectionEstablished = false;
let syncingOfflineWrites = false;
let connectivityWatching = false;
function readLocalJson(key){
  try { const value=localStorage.getItem(key); return value ? JSON.parse(value) : null; } catch (_) { return null; }
}
// Returns whether the write actually landed. A full localStorage throws
// QuotaExceededError, and a config carrying base64 worksheet images is big
// enough to hit it — callers that depend on the offline copy (the preload
// screen) must be able to tell the student instead of failing silently.
function writeLocalJson(key, value){
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (_) { return false; }
}
function removeLocalValue(key){ try { localStorage.removeItem(key); } catch (_) {} }
// Firebase reports `.info/connected === false` briefly while its first socket
// is still opening. Until it has connected at least once, rely on the browser
// network signal so a first-ever visitor can download and cache the config.
function isOffline(){ return !browserOnline || (firebaseConnectionEstablished && !firebaseConnected); }
function updateConnectivityBadge(){
  const badge=document.getElementById('connectivityBadge');
  if(!badge) return;
  if(syncingOfflineWrites){ badge.hidden=false; badge.textContent='🔄 Menyelaras…'; return; }
  badge.hidden=!isOffline();
  if(isOffline()) badge.textContent='📴 Luar Talian';
  // The cannon panel is routinely opened offline, so connectivity returning is
  // the moment it can finally load targets and enable firing.
  const cannonPanel=document.getElementById('cannonPanel');
  if(cannonPanel && !cannonPanel.hidden){
    attachCannonProgressListener();
    renderCannonPanel();
  }
}
function cacheConfig(){
  return writeLocalJson(OfflineStore.CONFIG_CACHE_KEY,{huntId:currentHuntId,stations:stations||{},groups:groups||{},cannon:cannonConfig,cannons:cannons||{},stationCount,ts:Date.now()});
}
function applyConfigCache(cfg){
  stations=(cfg&&cfg.stations)||{};
  groups=(cfg&&cfg.groups)||{};
  cannonConfig={
    enabled:!!(cfg&&cfg.cannon&&cfg.cannon.enabled),
    damagePercent:CannonEngine.clampDamage(cfg&&cfg.cannon&&cfg.cannon.damagePercent),
    startingAmmo:CannonEngine.clampStartingAmmo(cfg&&cfg.cannon&&cfg.cannon.startingAmmo)
  };
  cannons=(cfg&&cfg.cannons)||{};
  stationCount=StationLayout.clampStationCount((cfg&&cfg.stationCount) || Object.keys(stations).length);
  renderGroupLoginOptions();
  buildStationsUI(stations);
  const enabledBox=document.getElementById('cannonEnabled');
  if(enabledBox) enabledBox.checked=cannonConfig.enabled;
  const damageBox=document.getElementById('cannonDamage');
  if(damageBox) damageBox.value=cannonConfig.damagePercent;
  const startingAmmoBox=document.getElementById('cannonStartingAmmo');
  if(startingAmmoBox) startingAmmoBox.value=cannonConfig.startingAmmo;
  const body=document.getElementById('cannonBody');
  if(body) body.hidden=!cannonConfig.enabled;
  buildCannonsUI(cannons);
}
function cachedSession(){ return readLocalJson(OfflineStore.SESSION_CACHE_KEY); }
function firebaseOnceWithTimeout(ref, timeoutMs=5000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Sambungan mengambil masa terlalu lama.')),timeoutMs);
    ref.once('value').then(value=>{ clearTimeout(timer); resolve(value); },error=>{ clearTimeout(timer); reject(error); });
  });
}
// Firebase queues a write instead of rejecting it when the socket is down, so
// the returned promise can simply never settle. Every other write in this app
// is fire-and-forget with a .catch(), but firing a cannon has to await its
// result, so it needs a deadline — otherwise an awaited write that never
// settles strands the caller and everything after it.
function firebaseWriteWithTimeout(promise, timeoutMs=6000){
  return new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('timeout')),timeoutMs);
    promise.then(value=>{ clearTimeout(timer); resolve(value); },error=>{ clearTimeout(timer); reject(error); });
  });
}
function clearCachedProgress(gid){ if(gid) removeLocalValue(progressCacheKey(gid)); }
function progressCacheKey(gid){ return currentHuntId ? OfflineStore.progressKey(`${currentHuntId}_${gid}`) : OfflineStore.progressKey(gid); }
function persistSessionCache(next){
  const previous=cachedSession();
  const freshActive=next && next.status==='active' && Number(next.startedAt||0)>Number(previous&&previous.startedAt||0);
  if(currentGroupId && (freshActive || !next || next.status==='setup' || next.status==='ended')){
    clearCachedProgress(currentGroupId);
    // A reset journey must not leave a half-played station behind to resume.
    clearStationResume();
  }
  writeLocalJson(OfflineStore.SESSION_CACHE_KEY,{...(next||{status:'setup'}),ts:Date.now()});
}
function queuePendingWrite(path, data){
  const queue=OfflineStore.enqueueWrite(readLocalJson(OfflineStore.PENDING_KEY)||[],{path,data,ts:Date.now()});
  writeLocalJson(OfflineStore.PENDING_KEY,queue);
  updateConnectivityBadge();
}
function flushPendingWrites(){
  const queue=readLocalJson(OfflineStore.PENDING_KEY)||[];
  if(!db || isOffline() || syncingOfflineWrites || !queue.length) return Promise.resolve();
  syncingOfflineWrites=true; updateConnectivityBadge();
  return Promise.all(queue.map(item=>db.ref(item.path).update(item.data)))
    .then(()=>removeLocalValue(OfflineStore.PENDING_KEY))
    .catch(()=>{})
    .finally(()=>{ syncingOfflineWrites=false; updateConnectivityBadge(); });
}
function initConnectivity(){
  if(connectivityWatching) return;
  connectivityWatching=true;
  window.addEventListener('offline',()=>{ browserOnline=false; updateConnectivityBadge(); });
  window.addEventListener('online',()=>{ browserOnline=true; updateConnectivityBadge(); flushPendingWrites(); });
  db.ref('.info/connected').on('value',snap=>{
    const value=snap.val();
    if(typeof value==='boolean'){
      firebaseConnected=value;
      if(value) firebaseConnectionEstablished=true;
    }
    updateConnectivityBadge();
    if(!isOffline()) flushPendingWrites();
  });
  updateConnectivityBadge();
  flushPendingWrites();
}
