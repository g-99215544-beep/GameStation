// ---------- GROUP FLOW ----------
function loadGroupProgress(){
  const cached=readLocalJson(progressCacheKey(currentGroupId));
  const useProgress=p=>{
    const safe=p || freshGroupProgress();
    progress=safe;
    // After the global, never before: the listener fires immediately, and
    // maybeShowHitPrompt gates on progress.status. A stale 'won' left by a
    // previous login would make it discard a genuine hit unplayed.
    watchCannonHits();
    writeLocalJson(progressCacheKey(currentGroupId),safe);
    if(safe.status==='won' || StationLayout.isJourneyDone(safe.currentIndex||0, currentStationCount())){ showGoToBoard(); return; }
    if(offerStationResume()) return;
    showClueScreen();
  };
  // A local journey is authoritative: it may contain stations not yet synced.
  if(cached){ useProgress(cached); return; }
  if(isOffline()) { useProgress(null); return; }
  huntRef('progress/'+currentGroupId).once('value').then(snap=>{
    const p = snap.val() || freshGroupProgress();
    progress = p;
    watchCannonHits();
    if(p.status==='won' || StationLayout.isJourneyDone(p.currentIndex||0, currentStationCount())){ showGoToBoard(); return; }
    writeLocalJson(progressCacheKey(currentGroupId),p);
    if(offerStationResume()) return;
    showClueScreen();
  }).catch(()=>useProgress(null));
}
// Offers to drop the student straight back into the station they left, rather
// than making them walk back to the map and re-scan a QR they already scanned.
// Returns whether the offer was shown.
function offerStationResume(){
  const snapshot=readStationResume();
  const group=groups[currentGroupId];
  if(!group || !Array.isArray(group.order)) return false;
  const stId=group.order[progress.currentIndex];
  if(!StationResume.isUsable(snapshot,{huntId:currentHuntId, groupId:currentGroupId, stId})) return false;
  const station=stations[stId];
  if(!station){ clearStationResume(); return false; }
  // A snapshot whose game type no longer matches the station config is a
  // leftover from before an admin changed the station; replaying it would load
  // the wrong game.
  if(snapshot.gameType!==station.gameType){ clearStationResume(); return false; }
  const minutes=Math.floor(snapshot.timeLeftSec/60);
  const seconds=String(snapshot.timeLeftSec%60).padStart(2,'0');
  show('view-result');
  document.getElementById('timer').style.display='none';
  document.getElementById('resultCard').innerHTML=`<div class="finalbox">
    <div style="font-size:50px;">↩️</div>
    <h2>Sambung Semula?</h2>
    <p>Anda masih di <b>Stesen ${stId}: ${escapeHtml(station.name)}</b>.</p>
    <p>Baki masa anda: <b>${minutes}:${seconds}</b> — progress anda masih tersimpan.</p>
    <button class="big" onclick="resumeStation()">▶️ Sambung Stesen ${stId}</button>
    <button class="secondary" onclick="discardStationResume()">Mula semula stesen ini</button>
  </div>`;
  return true;
}
function resumeStation(){
  const snapshot=readStationResume();
  const group=groups[currentGroupId];
  const stId=group && Array.isArray(group.order) ? group.order[progress.currentIndex] : null;
  if(!StationResume.isUsable(snapshot,{huntId:currentHuntId, groupId:currentGroupId, stId})){
    clearStationResume();
    showClueScreen();
    return;
  }
  startGame(stId, null, snapshot);
}
function discardStationResume(){
  clearStationResume();
  showClueScreen();
}
function showClueScreen(){
  showJourneyMap();
}
function openCluePopup(){
  show('view-clue');
  document.body.classList.add('map-clue-mode');
  document.getElementById('clueGroupName').innerText = 'Kumpulan '+currentGroupId;
  renderKeyrowMini();
  const g = groups[currentGroupId];
  const stId = g.order[progress.currentIndex];
  const st = stations[stId];
  document.getElementById('clueText').innerText = '📍 Pergi cari QR di: '+ st.location;
  document.getElementById('reader').style.display='none';
  document.getElementById('passInput').value='';
  document.getElementById('passMsg').innerHTML='';
}
function renderKeyrowMini(){
  const row = document.getElementById('keyrowMini');
  row.innerHTML='';
  const keys = progress.keys||[];
  for(let i=1;i<=currentStationCount();i++){
    row.innerHTML += `<div class="key ${keys.includes(i)?'':'empty'}">${keys.includes(i)?'🔑':'▫️'}</div>`;
  }
}
function openScanner(){
  document.getElementById('reader').style.display='block';
  html5QrCode = new Html5Qrcode("reader");
  Html5Qrcode.getCameras().then(cams=>{
    const camId = cams.length ? (cams.find(c=>/back|rear/i.test(c.label))||cams[cams.length-1]).id : null;
    html5QrCode.start(camId||{facingMode:"environment"}, {fps:10, qrbox:220}, onScan);
  }).catch(()=>{ html5QrCode.start({facingMode:"environment"},{fps:10,qrbox:220}, onScan); });
}
function parseGameStationQr(raw){
  const parts=String(raw||'').trim().split('|');
  if(parts.length!==5 || parts[0]!=='GS1' || !/^[SC]$/.test(parts[2]) || !parts[3] || !/^[A-Za-z0-9]{5}$/.test(parts[4])) return null;
  return {huntId:parts[1],kind:parts[2],itemId:parts[3],password:parts[4]};
}
async function refreshHuntFromQr(qr){
  if(!qr || String(qr.huntId)===String(currentHuntId)) return true;
  if(isOffline()) throw new Error('Peranti masih menggunakan tetapan lama. Sambung internet dan scan QR baharu sekali lagi.');
  const active=await firebaseOnceWithTimeout(rootRef('activeHuntId'));
  if(String(active.val()||'')!==String(qr.huntId)) throw new Error('QR ini bukan untuk Treasure Hunt yang sedang aktif.');
  currentHuntId=qr.huntId;
  const config=await firebaseOnceWithTimeout(huntRef('config'));
  applyConfigCache(config.val()||{});
  cacheConfig();
  if(!groups[currentGroupId]) throw new Error('Kumpulan ini tidak wujud dalam Treasure Hunt baharu. Sila log masuk semula.');
  const session=await firebaseOnceWithTimeout(huntRef('session'));
  sessionInfo=session.val()||{status:'setup'};
  const savedProgress=await firebaseOnceWithTimeout(huntRef('progress/'+currentGroupId));
  progress=savedProgress.val()||freshGroupProgress();
  writeLocalJson(progressCacheKey(currentGroupId),progress);
  saveSession('group',currentGroupId);
  return true;
}
function onScan(decodedText){
  const qr=parseGameStationQr(decodedText);
  html5QrCode.stop().catch(()=>{});
  document.getElementById('reader').style.display='none';
  if(navigator.vibrate) navigator.vibrate(200);
  const msg=document.getElementById('passMsg');
  const useQr=()=>{
    const g=groups[currentGroupId];
    const expected=g && g.order && g.order[progress.currentIndex];
    if(qr && (qr.kind!=='S' || String(qr.itemId)!==String(expected))){
      msg.innerHTML='<div class="msg err">QR ini bukan untuk stesen semasa kumpulan anda.</div>';
      return;
    }
    document.getElementById('passInput').value = qr ? qr.password : String(decodedText||'').trim().replace(/[^A-Za-z0-9]/g,'').slice(0,5);
    msg.innerHTML='<div class="msg ok">Password daripada QR diterima. Game bermula...</div>';
    setTimeout(checkPassword, 350);
  };
  if(qr && String(qr.huntId)!==String(currentHuntId)){
    msg.innerHTML='<div class="msg">Memuatkan Treasure Hunt yang sepadan dengan QR baharu...</div>';
    refreshHuntFromQr(qr).then(useQr).catch(error=>{ msg.innerHTML=`<div class="msg err">${escapeHtml(error.message)}</div>`; });
    return;
  }
  useQr();
}
function checkPassword(){
  const g = groups[currentGroupId];
  const stId = g.order[progress.currentIndex];
  const st = stations[stId];
  const input = document.getElementById('passInput').value.trim();
  const msg = document.getElementById('passMsg');
  if(!isValidStationPassword(input)){
    playGameSfx('wrong');
    msg.innerHTML='<div class="msg err">Masukkan password tepat 5 huruf atau digit.</div>';
    return;
  }
  if(input.toUpperCase() === String(st.password).toUpperCase()){
    playGameSfx('correct');
    msg.innerHTML='<div class="msg ok">✅ Password betul! Game bermula...</div>';
    setTimeout(()=>startGame(stId), 600);
  } else {
    playGameSfx('wrong');
    msg.innerHTML='<div class="msg err">❌ Password salah. Semak password atau QR bagi stesen ini.</div>';
  }
}

// ---------- ADMIN: TEST A STATION ----------
// Lets admin play through any station using the current (unsaved) form values,
// without scanning a QR. Nothing is written to Firebase progress.
function testExitLabel(){
  return window._directTestMode?'↺ Uji semula':'← Kembali ke Admin';
}
function testStation(i){
  const gameType=document.getElementById('st_gametype_'+i).value;
  const st = {
    id:i,
    name:document.getElementById('st_name_'+i).value || ('Stesen '+i),
    location:document.getElementById('st_loc_'+i).value,
    password:document.getElementById('st_pass_'+i).value,
    timeLimitMin:stationTimeLimitMin(document.getElementById('st_time_'+i).value),
    gameType,
    gameDataRaw:stationGameDataRaw(i, gameType)
  };
  if(!isValidStationPassword(st.password)){
    alert('Password stesen mesti tepat 5 huruf atau digit sebelum diuji.');
    return;
  }
  if(!validateWorksheetStations({[i]:st}) || !validateSudokuStages({[i]:st}) || !validateTangramStages({[i]:st})) return;
  window._testMode = true;
  startGame(st.id, st);
}
function endTest(){
  cancelBsDrag();
  if(timerInterval) clearInterval(timerInterval);
  if(sifirQInterval) clearInterval(sifirQInterval);
  sifirQInterval=null;
  if(window._runWatchId!=null && navigator.geolocation){ navigator.geolocation.clearWatch(window._runWatchId); window._runWatchId=null; }
  if(window._directTestMode){ location.reload(); return; }
  window._testMode = false;
  document.getElementById('timer').style.display='none';
  show('view-admin');
}
function showTestResult(onTime, score, timeTakenSec){
  show('view-result');
  document.getElementById('timer').style.display='none';
  document.getElementById('resultCard').innerHTML=`<div class="finalbox">
    <div style="font-size:50px;">🧪</div>
    <h2>Ujian Selesai</h2>
    <p>${onTime?'Tepat masa':'Masa tamat'} — Markah: <b>${score}</b> <span style="color:#888;">(${timeTakenSec}s)</span></p>
    <p style="color:#888;font-size:13px;">Mod ujian — tiada markah disimpan ke Firebase.</p>
    <button class="big" onclick="endTest()">${testExitLabel()}</button>
  </div>`;
}

// ---------- STATION RESUME ----------
// A student who leaves mid-station comes back to the same clock and the same
// stage. The clock is paused, never wound forward: time spent away is not time
// spent playing.
function resumeCacheKey(){ return StationResume.resumeKey(currentHuntId, currentGroupId); }
function clearStationResume(){ if(currentGroupId) removeLocalValue(resumeCacheKey()); }
function readStationResume(){ return currentGroupId ? readLocalJson(resumeCacheKey()) : null; }
function captureStationResume(){
  // Test drives, demos and cannon questions are not part of the journey, and a
  // finished game has nothing left to resume.
  if(window._testMode || window._demoMode || window._cannonId) return;
  if(!currentGroupId || !gameState || !gameState.type) return;
  if(window._gameOver || timeUp || !(timeLeftSec > 0)) return;
  if(window._curStId == null) return;
  const snapshot=StationResume.buildSnapshot({
    huntId:currentHuntId, groupId:currentGroupId, stId:window._curStId, gameType:gameState.type,
    timeLeftSec, elapsedSec:Math.round((Date.now()-(window._startedAt||Date.now()))/1000),
    stage:StationResume.captureStage(gameState.type, gameState)
  });
  writeLocalJson(resumeCacheKey(), snapshot);
}
// Closing the tab, locking the phone, or switching apps all land here. `pagehide`
// is the only one iOS Safari fires reliably on a real close, so both are wired.
document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') captureStationResume(); });
window.addEventListener('pagehide',()=>captureStationResume());

