// ---------- OFFLINE PRELOAD ----------
// A group is held here once, straight after login, until this phone holds every
// asset and the whole hunt config. Stations must never depend on the network
// after this point — the field has no Wi-Fi.
const PRELOAD_SKIP_AFTER_MS = 20000;   // offer an escape hatch if it drags
const PRELOAD_TIMEOUT_MS = 120000;     // give up and let them through
let preloadState = null;
let preloadResolve = null;
let preloadSkipTimer = null;

function renderPreload(){
  if(!preloadState) return;
  const percent = OfflinePreload.preloadPercent(preloadState);
  const fill = document.getElementById('preloadBarFill');
  const bar = document.getElementById('preloadBar');
  const pct = document.getElementById('preloadPercent');
  const status = document.getElementById('preloadStatus');
  if(fill) fill.style.width = percent+'%';
  if(bar) bar.setAttribute('aria-valuenow', String(percent));
  if(pct) pct.textContent = percent+'%';
  if(status){
    status.textContent = OfflinePreload.preloadLabel(preloadState);
    status.classList.toggle('err', Boolean(preloadState.error));
  }
}
function showPreloadSkip(label){
  const skip = document.getElementById('preloadSkip');
  if(!skip) return;
  skip.hidden = false;
  if(label) skip.textContent = label;
}
// Any failure stops the automatic hand-off and waits for a deliberate tap, so a
// teacher sees that this phone is not fully ready before the group walks off.
function failPreload(reason){
  if(!preloadState) return;
  preloadState.error = OfflinePreload.preloadFailureMessage(reason);
  renderPreload();
  showPreloadSkip('Teruskan juga');
}
// Both the skip button and a clean finish land here, and only the first one
// counts — otherwise a late PRECACHE_DONE would push a student who already
// skipped back out of whatever screen they moved on to.
function finishPreload(result){
  if(!preloadResolve) return;
  const resolve = preloadResolve;
  preloadResolve = null;
  if(preloadSkipTimer){ clearTimeout(preloadSkipTimer); preloadSkipTimer = null; }
  // Step off this view before handing over. What comes next is usually the
  // journey map, and showJourneyMap() only unhides an overlay — it never
  // switches the active .view — so the preload card would otherwise sit active
  // underneath it for the rest of the game.
  if(document.getElementById('view-preload').classList.contains('active')) show('view-login');
  resolve(result);
}
function skipOfflinePreload(){
  finishPreload({ok:false, reason:'skipped'});
}
// Asks the service worker to cache every asset, reporting each one as it lands.
function precacheAssets(){
  return new Promise(resolve=>{
    if(!('serviceWorker' in navigator)){ resolve({ok:false, reason:'unsupported'}); return; }
    let settled=false;
    const done=value=>{ if(!settled){ settled=true; resolve(value); } };
    const timer=setTimeout(()=>done({ok:false, reason:'timeout'}), PRELOAD_TIMEOUT_MS);
    navigator.serviceWorker.ready.then(registration=>{
      const worker=registration.active;
      if(!worker){ clearTimeout(timer); done({ok:false, reason:'unsupported'}); return; }
      const channel=new MessageChannel();
      channel.port1.onmessage=event=>{
        const data=event.data||{};
        if(data.type==='PRECACHE_PROGRESS'){
          preloadState.assetsDone=data.done;
          preloadState.assetsTotal=data.total;
          renderPreload();
          return;
        }
        if(data.type==='PRECACHE_DONE'){
          clearTimeout(timer);
          preloadState.assetsDone=preloadState.assetsTotal;
          renderPreload();
          const failed=Array.isArray(data.failed)?data.failed:[];
          done(failed.length ? {ok:false, reason:'assets', failed} : {ok:true, failed:[]});
        }
      };
      worker.postMessage({type:'PRECACHE', urls:OfflinePreload.PRELOAD_ASSETS}, [channel.port2]);
    }).catch(()=>{ clearTimeout(timer); done({ok:false, reason:'unsupported'}); });
  });
}
// Resolves once the phone is ready, or once the student chooses to skip.
function runOfflinePreload(){
  // Nothing to download when there is no worker (file: protocol, or a browser
  // without support) and nothing to fetch when the network is already gone.
  if(!('serviceWorker' in navigator) || location.protocol==='file:') return Promise.resolve({ok:false, reason:'unsupported'});
  if(isOffline()) return Promise.resolve({ok:false, reason:'offline'});
  show('view-preload');
  preloadState={assetsDone:0, assetsTotal:OfflinePreload.PRELOAD_ASSETS.length, configDone:false, sessionDone:false, error:''};
  const skip=document.getElementById('preloadSkip');
  if(skip) skip.hidden=true;
  renderPreload();
  preloadSkipTimer=setTimeout(showPreloadSkip, PRELOAD_SKIP_AFTER_MS);
  const finished=new Promise(resolve=>{ preloadResolve=resolve; });
  (async ()=>{
    const assets=await precacheAssets();
    if(!preloadResolve) return;                     // skipped while downloading
    // A missing service worker is not a failure worth alarming anyone about;
    // a download that genuinely broke is.
    if(!assets.ok && assets.reason!=='unsupported') failPreload(assets.reason);
    try {
      const snapshot=await firebaseOnceWithTimeout(huntRef('config'), 15000);
      applyConfigCache(snapshot.val()||{});
      if(!cacheConfig()){ failPreload('quota'); return; }
    } catch(_) {
      // An already-cached config is good enough to play on; only a device that
      // has never downloaded one is genuinely stuck.
      if(!readLocalJson(OfflineStore.CONFIG_CACHE_KEY)){ failPreload('config'); return; }
    }
    if(!preloadResolve) return;
    preloadState.configDone=true;
    renderPreload();
    try {
      const snapshot=await firebaseOnceWithTimeout(huntRef('session'), 8000);
      sessionInfo=snapshot.val()||{status:'setup'};
    } catch(_) {
      sessionInfo=cachedSession()||{status:'setup'};
    }
    persistSessionCache(sessionInfo);
    if(!preloadResolve) return;
    preloadState.sessionDone=true;
    renderPreload();
    // Hand over on a clean run only. An earlier failure leaves the message on
    // screen and waits for the tap.
    if(!preloadState.error) finishPreload({ok:true});
  })();
  return finished;
}

