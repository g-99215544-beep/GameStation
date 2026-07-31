// Registered on progress/<gid> by showGoToBoard. Held here so logout() can
// detach it — the hunt-root off() there cannot reach a child-path listener.
let chestProgressRef=null;
// Set for the duration of a single fireCannonAt() call. Firing spends ammo
// via a Firebase transaction, which guards the *count*, but nothing stopped
// a double-tap from starting two overlapping calls before the first one's
// transaction resolved — both could pass the ammo check, and since the video
// overlay/its resolver (cannonVideoDone) are singletons, the second call's
// playCannonVideo() would silently strand the first call's await forever.
let cannonShotInFlight=false;

function cannonEnabled(){
  return !!(cannonConfig && cannonConfig.enabled) && CannonEngine.isInBattle(progress);
}
function syncCannonFab(){
  const fab=document.getElementById('cannonFab');
  const count=document.getElementById('cannonFabCount');
  if(!fab) return;
  fab.hidden=!cannonEnabled();
  if(count) count.textContent=String(CannonEngine.readAmmo(progress));
}
function openCannonPanel(){
  const panel=document.getElementById('cannonPanel');
  if(!panel || !cannonEnabled()) return;
  panel.hidden=false;
  setCannonMsg('','');
  const passwordInput=document.getElementById('cannonPasswordInput');
  if(passwordInput) passwordInput.value='';
  renderCannonPanel();
}
function closeCannonPanel(){
  const panel=document.getElementById('cannonPanel');
  if(panel) panel.hidden=true;
  stopCannonScanner();
}
function setCannonMsg(kind,text){
  const box=document.getElementById('cannonMsg');
  if(!box) return;
  box.innerHTML=text ? `<div class="msg ${kind}">${escapeHtml(text)}</div>` : '';
}
function renderCannonPanel(){
  const ammoBox=document.getElementById('cannonAmmo');
  const list=document.getElementById('cannonTargets');
  if(!ammoBox || !list) return;
  const ammo=CannonEngine.readAmmo(progress);
  const offline=isOffline();
  ammoBox.innerHTML=ammo
    ? `Peluru anda: 💣 <span>(${ammo})</span>`
    : 'Peluru anda: <span>0</span><br><small class="cannon-hint">Scan QR atau masukkan password meriam untuk dapat peluru.</small>';
  const ids=Object.keys(groups||{}).filter(gid=>String(gid)!==String(currentGroupId));
  const offlineHint=offline
    ? '<p class="cannon-hint" id="cannonOfflineHint">📴 Perlu internet untuk menembak. Anda masih boleh scan QR atau masukkan password meriam.</p>'
    : '';
  // Rebuilt wholesale (not appended) on every render, including the offline
  // hint, so repeated renders — e.g. closing and reopening the panel offline,
  // or a double-tapped fab — can never stack duplicate #cannonOfflineHint
  // nodes the way a separate insertAdjacentHTML call would.
  list.innerHTML=ids.map(gid=>{
    const p=allProgress[gid]||{};
    const hp=CannonEngine.readHp(p);
    const inBattle=CannonEngine.isInBattle(p);
    const canFire=inBattle && ammo>0 && !offline && !cannonShotInFlight;
    const action=inBattle
      ? `<button type="button" ${canFire?'':'disabled'} onclick="fireCannonAt('${gid}')" aria-label="Tembak Kumpulan ${gid}">🔥</button>`
      : '<span class="cannon-target-hp-text">🏆 sudah buka peti</span>';
    const bar=inBattle
      ? `<div class="cannon-target-hp"><span class="cannon-target-hp-fill" style="width:${hp}%"></span></div><span class="cannon-target-hp-text">${hp}%</span>`
      : '';
    return `<div class="cannon-target${inBattle?'':' is-won'}" data-gid="${gid}">
      <span class="cannon-target-name">Kumpulan ${gid}</span>${bar}${action}
    </div>`;
  }).join('') + offlineHint;
}
let cannonQrCode=null;
function openCannonScanner(){
  const reader=document.getElementById('cannonReader');
  if(!reader) return;
  reader.style.display='block';
  cannonQrCode=new Html5Qrcode('cannonReader');
  const onFound=text=>{
    stopCannonScanner();
    if(navigator.vibrate) navigator.vibrate(200);
    redeemCannonPassword(text);
  };
  Html5Qrcode.getCameras().then(cams=>{
    const camId=cams.length ? (cams.find(c=>/back|rear/i.test(c.label))||cams[cams.length-1]).id : null;
    cannonQrCode.start(camId||{facingMode:'environment'},{fps:10,qrbox:220},onFound);
  }).catch(()=>{ cannonQrCode.start({facingMode:'environment'},{fps:10,qrbox:220},onFound); });
}
function stopCannonScanner(){
  const reader=document.getElementById('cannonReader');
  if(reader) reader.style.display='none';
  if(!cannonQrCode) return;
  const scanner=cannonQrCode;
  cannonQrCode=null;
  try{ scanner.stop().catch(()=>{}); }catch(_){}
}
function submitCannonPassword(){
  const input=document.getElementById('cannonPasswordInput');
  redeemCannonPassword(input&&input.value);
}
function redeemCannonPassword(raw){
  const qr=typeof parseGameStationQr==='function' ? parseGameStationQr(raw) : null;
  if(qr && qr.kind!=='C'){
    setCannonMsg('err','QR ini bukan QR Meriam.');
    return;
  }
  if(qr && String(qr.huntId)!==String(currentHuntId)){
    setCannonMsg('','Memuatkan Treasure Hunt yang sepadan dengan QR baharu...');
    refreshHuntFromQr(qr).then(()=>redeemCannonPassword(qr.password))
      .catch(error=>setCannonMsg('err',error.message));
    return;
  }
  const password=String(qr ? qr.password : raw||'').trim().replace(/[^A-Za-z0-9]/g,'').slice(0,5);
  if(!/^[A-Za-z0-9]{5}$/.test(password)){
    playGameSfx('wrong');
    setCannonMsg('err','Masukkan password meriam tepat 5 huruf atau digit.');
    return;
  }
  const cid=CannonEngine.findByPassword(cannons,password);
  if(qr && String(qr.itemId)!==String(cid||'')){
    setCannonMsg('err','QR Meriam ini tidak sepadan dengan tetapan semasa.');
    return;
  }
  if(!cid){
    playGameSfx('wrong');
    setCannonMsg('err','Password atau QR meriam tidak sah. Cuba semula.');
    return;
  }
  if(CannonEngine.hasClaimed(progress,cid)){
    setCannonMsg('','Peluru meriam ini sudah anda ambil.');
    return;
  }
  setCannonMsg('','');
  closeCannonPanel();
  window._cannonId=cid;
  startGame(cid, cannons[cid]);
}
const CANNON_VIDEO_SRC = {fire:'assets/cannon/fire.mp4', hit:'assets/cannon/hit.mp4'};
let cannonVideoDone=null;

function playCannonVideo(kind, caption){
  const overlay=document.getElementById('cannonVideo');
  const video=document.getElementById('cannonVideoEl');
  const text=document.getElementById('cannonVideoCaption');
  const skip=document.getElementById('cannonVideoSkip');
  if(!overlay||!video) return Promise.resolve();
  if(text) text.textContent=caption||'';
  overlay.hidden=false;
  if(skip){
    skip.classList.remove('is-ready');
    window.setTimeout(()=>skip.classList.add('is-ready'),2000);
  }
  // Fullscreen is requested from the pupil's gesture, but the orientation is
  // deliberately left untouched so the Game Station remains vertical.
  try{ overlay.requestFullscreen && overlay.requestFullscreen().catch(()=>{}); }catch(_){}
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    window.setTimeout(endCannonVideo,1200);
    return new Promise(resolve=>{ cannonVideoDone=resolve; });
  }
  video.src=CANNON_VIDEO_SRC[kind]||CANNON_VIDEO_SRC.fire;
  video.currentTime=0;
  video.onended=endCannonVideo;
  video.onerror=endCannonVideo;
  video.play().catch(()=>endCannonVideo());
  return new Promise(resolve=>{ cannonVideoDone=resolve; });
}
function endCannonVideo(){
  const overlay=document.getElementById('cannonVideo');
  const video=document.getElementById('cannonVideoEl');
  if(video){ video.onended=null; video.onerror=null; try{ video.pause(); }catch(_){} video.removeAttribute('src'); }
  if(overlay) overlay.hidden=true;
  try{ document.fullscreenElement && document.exitFullscreen && document.exitFullscreen().catch(()=>{}); }catch(_){}
  const resolve=cannonVideoDone;
  cannonVideoDone=null;
  resolve && resolve();
}

// ---------- RECEIVING A HIT ----------
let cannonHitRef=null;
let pendingHit=null;
let showingHit=false;

function watchCannonHits(){
  if(!currentGroupId) return;
  if(cannonHitRef) cannonHitRef.off('value');
  cannonHitRef=huntRef('progress/'+currentGroupId+'/incoming');
  cannonHitRef.on('value',snap=>{
    pendingHit=CannonEngine.summarizeIncoming(snap.val());
    maybeShowHitPrompt();
  });
}
function stopWatchingCannonHits(){
  if(cannonHitRef) cannonHitRef.off('value');
  cannonHitRef=null;
  pendingHit=null;
}
// A shot must never steal time from a station game: the timer is running and
// the student is mid-answer. Hold it until they are back on a safe screen.
function hitSafeToShow(){
  const game=document.getElementById('view-game');
  return !(game && game.classList.contains('active')) && !showingHit;
}
function clearPendingHits(ids){
  const list=ids||(pendingHit&&pendingHit.ids)||[];
  if(!list.length) return Promise.resolve();
  const updates={};
  list.forEach(id=>{ updates[id]=null; });
  pendingHit=null;
  return huntRef('progress/'+currentGroupId+'/incoming').update(updates).catch(()=>{});
}
function maybeShowHitPrompt(){
  if(!pendingHit) return;
  // Their marks are already announced and the damage is already counted, so
  // replaying a battle animation over the celebration would only confuse.
  // The prompt may already be visible (shown for this same hit before the
  // group won — e.g. while waiting on the chest screen, still "in battle"),
  // so it must be actively hidden here too, not just left for whoever last
  // rendered it: a status change can arrive on a listener that fires after
  // the one that already flipped prompt.hidden=false.
  if(!CannonEngine.isInBattle(progress)){
    const stale=document.getElementById('cannonHitPrompt');
    if(stale) stale.hidden=true;
    clearPendingHits();
    return;
  }
  if(!hitSafeToShow()) return;
  const prompt=document.getElementById('cannonHitPrompt');
  const from=document.getElementById('cannonHitFrom');
  if(!prompt) return;
  if(from) from.textContent=pendingHit.count>1
    ? `Anda ditembak ${pendingHit.count} kali! HP anda kini ${pendingHit.hpAfter}%.`
    : `oleh Kumpulan ${pendingHit.from} — HP anda kini ${pendingHit.hpAfter}%.`;
  prompt.hidden=false;
}
async function watchPendingHit(){
  const hit=pendingHit;
  const prompt=document.getElementById('cannonHitPrompt');
  if(prompt) prompt.hidden=true;
  if(!hit) return;
  showingHit=true;
  progress={...progress, hp:hit.hpAfter};
  writeLocalJson(progressCacheKey(currentGroupId),progress);
  renderShipHp();
  const caption=hit.count>1
    ? `Anda ditembak ${hit.count} kali! HP: ${hit.hpAfter}%`
    : `Ditembak Kumpulan ${hit.from}! HP: ${hit.hpAfter}%`;
  await playCannonVideo('hit',caption);
  await clearPendingHits(hit.ids);
  showingHit=false;
  renderShipHp();
  flashShipHpHit();
  renderCannonPanel();
  maybeShowHitPrompt();
}

async function fireCannonAt(targetGid){
  // Guards the *firing state*, not the ammo count — the ammo transaction below
  // already guards the count. Without this, a double-tap starts two overlapping
  // calls before the first's transaction resolves; both can pass the ammo
  // check, and since the video overlay's resolver (cannonVideoDone) is a
  // single module-level variable, the second call's playCannonVideo()
  // silently strands the first call's await forever.
  if(cannonShotInFlight) return;
  if(isOffline()){ setCannonMsg('err','Perlu internet untuk menembak.'); return; }
  if(!CannonEngine.isInBattle(progress)){ setCannonMsg('err','Peti anda sudah dibuka — pertempuran tamat.'); return; }
  const target=allProgress[targetGid];
  if(!CannonEngine.isInBattle(target)){ setCannonMsg('err',`Kumpulan ${targetGid} sudah buka peti.`); return; }
  const damage=CannonEngine.clampDamage(cannonConfig.damagePercent);
  const ammoRef=huntRef('progress/'+currentGroupId+'/ammo');
  cannonShotInFlight=true;
  try{
    let spend;
    try{
      spend=await firebaseWriteWithTimeout(ammoRef.transaction(current=>{
        const have=CannonEngine.readAmmo({ammo:current});
        return have<1 ? undefined : have-1;    // undefined aborts the transaction
      }));
    }catch(_spendErr){
      // The write never settled, so we do not know whether Firebase will
      // eventually commit it. Leave the local count alone and let the child
      // retry: if the queued write does land later, the panel's own listener
      // corrects the count, and a retry in the meantime simply aborts on an
      // empty magazine rather than spending a second cannonball.
      setCannonMsg('err','Tembakan gagal — cuba lagi.');
      return;
    }
    if(!spend.committed){ setCannonMsg('err','Tiada peluru meriam.'); renderCannonPanel(); return; }
    // Mirror what Firebase actually committed, not a parallel guess recomputed
    // from the (possibly stale) local `progress` cache.
    progress={...progress, ammo:CannonEngine.readAmmo({ammo:spend.snapshot.val()})};
    syncCannonFab();
    renderCannonPanel();

    let hpAfter=null;
    try{
      // Scoped to only the Firebase writes that must succeed together for the
      // shot to have "landed" — the hp transaction and the incoming push.
      // playCannonVideo() below is deliberately outside this try: by the time
      // it runs, the hit has already landed and is visible to the victim, so
      // a video-playback failure must never be treated as "the shot failed"
      // and trigger a refund for a shot that really connected.
      // Runs on the whole progress node rather than just hp, because the abort
      // condition the design calls for — "do not shoot a group that already
      // opened its chest" — lives in a sibling field the hp node cannot see.
      // Checking the shooter's cached copy beforehand is not enough: a chest
      // opened in the moment between that read and this write would otherwise
      // take damage its already-frozen final score can never reflect.
      const hit=await firebaseWriteWithTimeout(huntRef('progress/'+targetGid)
        .transaction(current=>{
          if(current && current.status==='won') return undefined;   // aborts
          return {...(current||{}), hp:CannonEngine.applyDamage(current&&current.hp, damage)};
        }));
      // The updater aborts for exactly one reason, so an uncommitted result
      // means the target opened their chest between the shooter's cached read
      // and this write. Worth saying plainly — "tembakan gagal" would leave a
      // child thinking the app broke.
      if(!hit.committed) throw new Error('won');
      hpAfter=CannonEngine.readHp(hit.snapshot.val());
      await firebaseWriteWithTimeout(huntRef('progress/'+targetGid+'/incoming')
        .push({from:String(currentGroupId), ts:Date.now(), damage, hpAfter}));
    }catch(hitErr){
      // The refund is itself a network write and can itself fail. If it
      // throws, the ammo stays spent in Firebase with nothing landed for it —
      // exactly what a child must not be left with — so contain the failure:
      // the child still gets a message and a fresh panel even though the
      // local ammo count may now be stale until the next sync.
      try{
        const refund=await firebaseWriteWithTimeout(ammoRef.transaction(current=>CannonEngine.readAmmo({ammo:current})+1));
        if(refund.committed) progress={...progress, ammo:CannonEngine.readAmmo({ammo:refund.snapshot.val()})};
      }catch(_refundErr){}
      syncCannonFab();
      setCannonMsg('err', hitErr && hitErr.message==='won'
        ? `Kumpulan ${targetGid} sudah buka peti — peluru dipulangkan.`
        : 'Tembakan gagal — peluru dipulangkan.');
      renderCannonPanel();
      return;
    }
    await playCannonVideo('fire',`Tembakan tepat! Kumpulan ${targetGid} → ${hpAfter}%`);
    setCannonMsg('ok',`Kumpulan ${targetGid} kena tembak. HP mereka kini ${hpAfter}%.`);
    renderCannonPanel();
  } finally {
    cannonShotInFlight=false;
    // The in-flight flag only affects rendering (disabling the fire buttons);
    // flipping it back without a matching render would leave a just-fired
    // target's button looking disabled until some unrelated write happens to
    // trigger the panel's live listener.
    renderCannonPanel();
  }
}
function selectJourneyIsland(position){
  if(journeyMoving || !document.getElementById('journeyScorePopup')?.hidden) return;
  const currentIndex=Number(progress.currentIndex)||0;
  const stationId=stationIdAtPosition(position);
  const completed=(progress.completedStations||{})[stationId];
  if(position===currentIndex+1){
    playStationJourney(journeyShipPosition,position,openCluePopup);
  }else if(completed){
    playStationJourney(journeyShipPosition,position,()=>showJourneyScore(position));
  }
}
function playStationJourney(fromPosition,toPosition,onArrive){
  const map=document.getElementById('journeyMap');
  const status=document.getElementById('journeyStatus');
  const from=MAP_STOPS[fromPosition]||MAP_STOPS[0];
  const to=MAP_STOPS[toPosition]||MAP_STOPS[1];
  const ship=document.getElementById('journeyShip');
  const token=++journeyToken;
  journeyMoving=true;
  document.body.classList.remove('map-clue-mode');
  map.hidden=false;
  setJourneyShipDirection(from,to);
  placeJourneyShip(from);
  setJourneyShipFrame(0);
  if(fromPosition===toPosition){
    journeyMoving=false;
    if(status) status.textContent=`Tiba di Pulau ${toPosition}!`;
    onArrive && onArrive();
    return;
  }
  playJourneyShipAudio();
  if(status) status.textContent=`Berlayar ke Pulau ${toPosition}...`;
  playJourneyMapPingPong();
  const duration=2700;
  animateShipAlong({
    from, to, duration,
    isCancelled:()=>token!==journeyToken,
    place:point=>placeJourneyShip(point),
    setFrame:frame=>setJourneyShipFrame(frame),
    onDone:()=>{
      journeyShipPosition=toPosition;
      journeyMoving=false;
      stopJourneyShipAudio();
      if(status) status.textContent=`Tiba di Pulau ${toPosition}!`;
      window.setTimeout(()=>{
        if(token!==journeyToken) return;
        onArrive && onArrive();
      },1000);
    }
  });
}

// Drives one ship sprite from one map point to another. Shared by the pupil's
// own voyage and by every rival ship so they move with identical physics.
// A duration of 0 places the ship at its destination immediately, which is
// what a rival ship sailing under prefers-reduced-motion needs.
function animateShipAlong(options){
  const {from,to,place}=options;
  const duration=Number(options.duration)||0;
  const setFrame=options.setFrame||(()=>{});
  const isCancelled=options.isCancelled||(()=>false);
  const onDone=options.onDone||(()=>{});
  place(from);
  setFrame(0);
  if(duration<=0 || (from.x===to.x && from.y===to.y)){
    place(to);
    onDone();
    return;
  }
  let startedAt=null;
  const step=now=>{
    if(isCancelled()) return;
    if(startedAt===null) startedAt=now;
    const elapsed=Math.min(1,(now-startedAt)/duration);
    const eased=elapsed<.5 ? 2*elapsed*elapsed : 1-Math.pow(-2*elapsed+2,2)/2;
    place({x:from.x+(to.x-from.x)*eased,y:from.y+(to.y-from.y)*eased});
    setFrame(Math.floor((now-startedAt)/SHIP_SPRITE.frameMs));
    if(elapsed<1){ requestAnimationFrame(step); return; }
    onDone();
  };
  requestAnimationFrame(step);
}

function show(id){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.body.classList.toggle('participant-mode', PARTICIPANT_VIEW_IDS.has(id));
  if(id!=='view-game' || gameState.type!=='crossword') document.body.classList.remove('crossword-mode');
  if(id!=='view-game' || gameState.type!=='battleship') document.body.classList.remove('battleship-mode');
  if(id!=='view-clue') hideJourneyMap();
  const wrap = document.querySelector('.wrap');
  if(wrap) wrap.classList.toggle('admin-wrap', id==='view-admin');
  const adminBtn = document.getElementById('adminAccessBtn');
  if(adminBtn) adminBtn.style.display = (id==='view-login' || id==='view-chest') ? 'inline-flex' : 'none';
  if(id!=='view-login') hideAdminLogin();
}

// Bonus marks for the order in which a group opens its chest at the Smart Board
// (running back to finish first is rewarded). Index 0 = the 1st group to open.
const CHEST_BONUS = [50,40,30,25,20,15,12,10,8,6,5,4,3,2];

// Simple direct demo links such as ?tangram or ?battleship launch a game with
// safe default data. They are intentionally not displayed inside the app.
const DIRECT_GAME_DEMOS={
  sudoku:{name:'Sudoku Challenge',gameType:'sudoku',gameDataRaw:'{}'},
  crossword:{name:'Crossword Puzzle',gameType:'crossword',gameDataRaw:'{}'},
  battleship:{name:'Battleship Koordinat',gameType:'battleship',gameDataRaw:'{}'},
  sifir:{name:'Sifir Challenge',gameType:'sifir',gameDataRaw:'{}'},
  tangram:{name:'Tangram Challenge',gameType:'tangram',gameDataRaw:'{}'},
  jejak_lari:{name:'Jejak Lari GPS',gameType:'jejak_lari',gameDataRaw:'{"targetKm":1}'}
};
function directGameDemoType(){
  const q = new URLSearchParams(location.search);
  const named=String(q.get('demo')||'').trim();
  if(DIRECT_GAME_DEMOS[named]) return named;
  return Object.keys(DIRECT_GAME_DEMOS).find(type=>q.has(type))||null;
}
// index.html?board opens the big-screen Smart Board finale (for the projector).
function isSmartBoard(){
  const q = new URLSearchParams(location.search);
  return q.has('board') || q.get('view')==='board';
}
