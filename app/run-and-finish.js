// ---------- RUN TRACKER (jejak_lari): live GPS distance ----------
function startRun(st, resumeStage){
  const targetKm = RunTracker.parseTargetKm(st.gameDataRaw);
  // Distance already run is kept, but `lastPt` deliberately is not: GPS re-locks
  // from wherever the student is standing now, so the gap they covered while the
  // app was closed is not counted as a single enormous step.
  const carriedM = Math.max(0, Number(resumeStage&&resumeStage.distanceM)||0);
  // On a fresh start the clock still holds the full limit, so it is the total.
  // On a resume it holds what is left, so the original total has to be carried.
  const totalSec = Math.max(1, Number(resumeStage&&resumeStage.totalSec)||timeLeftSec);
  gameState = { type:'jejak_lari', targetKm, distanceM:carriedM, lastPt:null,
                totalSec, started:false, total:1, correct:0 };
  window._runResumed = Boolean(resumeStage);
  window._runWatchId = null;
  window._runTimeout = null;
  const card = document.getElementById('gameCard');
  const testBanner = window._testMode
    ? `<div class="msg" style="background:#fdf3d8;margin-top:0;">🧪 <b>Mod Ujian</b> — markah tidak disimpan. <button class="linkbtn" onclick="endTest()">${testExitLabel()}</button></div>`
    : '';
  const carriedNote = carriedM > 0
    ? `<div class="msg ok" style="font-weight:700;">↩️ Sambung semula — jarak setakat ini: <b>${(carriedM/1000).toFixed(2)} km</b>. Tekan Mula Lari untuk sambung GPS.</div>`
    : '';
  card.innerHTML = `${testBanner}<h2>🏃 ${st.name}</h2>
    <div class="clue">Lari sejauh <b>${targetKm} km</b> sebelum masa tamat. GPS akan mengesan jarak larian anda.</div>
    ${carriedNote}
    <p style="color:#65513a;font-size:14px;">Markah: baki masa + <b>25 markah</b> setiap 1 km yang dilari.</p>
    <button class="big" onclick="beginRun()">▶️ Mula Lari</button>
    <div id="runMsg"></div>`;
}
function beginRun(){
  const msg = document.getElementById('runMsg');
  if(!navigator.geolocation){
    if(msg) msg.innerHTML='<div class="msg err">GPS tidak disokong pada peranti ini.</div>';
    return;
  }
  if(window._runWatchId!=null && navigator.geolocation){ navigator.geolocation.clearWatch(window._runWatchId); window._runWatchId=null; }
  if(msg) msg.innerHTML='<div class="msg">📡 Mendapatkan isyarat GPS…</div>';
  window._runWatchId = navigator.geolocation.watchPosition(
    onRunPosition, onRunError, { enableHighAccuracy:true, maximumAge:1000, timeout:15000 });
}
function onRunPosition(pos){
  const pt = { lat:pos.coords.latitude, lng:pos.coords.longitude, acc:pos.coords.accuracy };
  const carried = { targetKm: gameState.targetKm, totalSec: gameState.totalSec,
                    type:'jejak_lari', total:1, correct:0 };
  if(!gameState.started){
    gameState = Object.assign(RunTracker.accumulate(gameState, pt), carried, { started:true });
    // Only a genuine first start resets the elapsed marker; a resumed run must
    // keep the time it has already spent running.
    if(!window._runResumed) window._startedAt = Date.now();
    window._runResumed = false;
    renderRunLive();
    document.getElementById('timer').style.display='block';
    timerInterval = setInterval(tick,1000);
    window._runTimeout = ()=>finishRun(false);
    return;
  }
  gameState = Object.assign(RunTracker.accumulate(gameState, pt), carried, { started:true });
  updateRunLive();
  if(gameState.distanceM >= gameState.targetKm*1000) finishRun(true);
}
function onRunError(err){
  const msg = document.getElementById('runMsg');
  if(!msg) return;
  const why = err && err.code===1 ? 'kebenaran GPS ditolak' : 'isyarat GPS tidak diperoleh';
  msg.innerHTML = `<div class="msg err">Tidak dapat mula (${why}). Benarkan akses lokasi, kemudian <button class="linkbtn" onclick="beginRun()">cuba lagi</button>.</div>`;
}
function renderRunLive(){
  const card = document.getElementById('gameCard');
  const testBanner = window._testMode
    ? `<div class="msg" style="background:#fdf3d8;margin-top:0;">🧪 <b>Mod Ujian</b> — markah tidak disimpan. <button class="linkbtn" onclick="endTest()">${testExitLabel()}</button></div>`
    : '';
  card.innerHTML = `${testBanner}<h2>🏃 Larian Anda</h2>
    <div style="font-size:34px;font-weight:900;color:var(--navy);text-align:center;margin:10px 0;">
      <span id="runKm">0.00</span> / ${gameState.targetKm.toFixed(2)} km</div>
    <div style="height:18px;border:2px solid var(--gold);border-radius:10px;overflow:hidden;background:#fff8df;">
      <div id="runBar" style="height:100%;width:0%;background:var(--green);transition:width .3s;"></div></div>
    <p style="color:#888;font-size:13px;text-align:center;margin-top:10px;">📡 GPS aktif — teruskan berlari!</p>
    <div id="runMsg"></div>`;
}
function updateRunLive(){
  const km = gameState.distanceM/1000;
  const kmEl = document.getElementById('runKm');
  const bar = document.getElementById('runBar');
  if(kmEl) kmEl.textContent = km.toFixed(2);
  if(bar) bar.style.width = Math.min(100, km/gameState.targetKm*100) + '%';
}
function finishRun(reachedTarget){
  if(window._gameOver) return;   // guard against double-finish (target hit + timeout race)
  window._gameOver = true;
  playGameSfx(reachedTarget?'correct':'wrong');
  if(window._runWatchId!=null && navigator.geolocation){
    navigator.geolocation.clearWatch(window._runWatchId); window._runWatchId=null;
  }
  clearInterval(timerInterval);
  const onTime = reachedTarget && !timeUp;
  const timeTakenSec = Math.round((Date.now()-window._startedAt)/1000);
  const score = RunTracker.runScore({
    reachedTarget, timeUp,
    timeLeftSec: Math.max(0, timeLeftSec),
    totalSec: gameState.totalSec,
    distanceM: gameState.distanceM });
  if(window._testMode){ showTestResult(onTime, score, timeTakenSec); return; }
  submitCompletion(onTime, score, timeTakenSec);
}
function finishSudoku(onTime){
  if(window._gameOver) return;
  window._gameOver=true;
  window._sudokuTimeout=null;
  clearInterval(timerInterval);
  const completed=gameState.sudoku.completed;
  const timeTakenSec=Math.round((Date.now()-window._startedAt)/1000);
  let score=Math.round((completed/gameState.total)*100);
  if(!onTime) score=Math.max(0,score-20);
  if(window._testMode){ showTestResult(onTime,score,timeTakenSec); return; }
  submitCompletion(onTime,score,timeTakenSec);
}
// Tangram stations use the selected subset of three shapes in order. Each
// completed shape is worth 40 marks, with a time bonus once all are done.
const TG_STAGE_MARK = 40, TG_TIME_BONUS = 80;
// Automatic assist for Segi Empat only: every minute, reveal the grey target's
// internal cut-lines for five seconds. It runs regardless of how many pieces
// are already in place, so every student receives the same periodic support.
const TG_HINT_INTERVAL_MS = 60000, TG_HINT_SEC = 5;
function startTangram(st, resumeStage){
  const S = window.TangramShapes;
  const totalSec = (st.timeLimitMin||10)*60;
  const ALL_SHAPES = [
    {stage:1,id:'kuda',      name:'Kuda',       guide:false, assist:false},
    {stage:2,id:'kucing',    name:'Kucing',     guide:false, assist:false},
    {stage:3,id:'segiempat', name:'Segi Empat', guide:false, assist:true},
  ];
  const selectedStages=tangramStagesFromRaw(st.gameDataRaw);
  const SHAPES=(selectedStages.length?selectedStages:[1,2,3]).map(stage=>ALL_SHAPES[stage-1]);
  const maxScore=SHAPES.length*TG_STAGE_MARK+TG_TIME_BONUS;
  gameState.type='tangram'; gameState.total=SHAPES.length; gameState.correct=0;
  // These counters live on gameState rather than in this closure so a resume
  // snapshot can read them — "2 of 3 shapes built" is exactly what must survive
  // a student closing the tab. Clamped in case an admin removed stages since.
  const tg = gameState.tangram = {
    idx:  Math.min(SHAPES.length-1, Math.max(0, Number(resumeStage&&resumeStage.idx)||0)),   // shape currently being built
    done: Math.min(SHAPES.length,   Math.max(0, Number(resumeStage&&resumeStage.done)||0))   // shapes completed so far
  };
  const card = document.getElementById('gameCard');
  let assistTimer = null, assistCountdown = null, assistRevealing = false;
  const testBanner = () => window._demoMode
    ? '<div class="msg" style="background:#e7f0ff;margin-top:0;">🎮 <b>Demo Tangram</b> — <button class="linkbtn" onclick="startTangramDemo()">↺ Main semula</button></div>'
    : window._testMode
    ? `<div class="msg" style="background:#fdf3d8;margin-top:0;">🧪 <b>Mod Ujian</b> — markah tidak disimpan. <button class="linkbtn" onclick="endTest()">${testExitLabel()}</button></div>`
    : '';

  function showInstructions(){
    if(timerInterval) clearInterval(timerInterval);
    document.getElementById('timer').style.display='none';
    card.innerHTML = testBanner() + `
      <h2>🧩 ${st.name}</h2>
      <div class="card" style="text-align:left;box-shadow:none;border:2px solid #eee;">
        <h3 style="margin-top:0;">📋 Arahan</h3>
        <ol style="padding-left:20px;line-height:1.7;margin:0;">
          <li>Anda perlu bina <b>${SHAPES.length} bentuk</b> mengikut urutan: <b>${SHAPES.map(shape=>shape.name).join('</b> → <b>')}</b>.</li>
          <li>Bayang bentuk (kelabu) ada dalam kotak — <b>seret keping</b> ke dalam bayang; keping akan <b>melekat</b> ke tempatnya.</li>
          <li><b>Ketik</b> keping untuk pusing 45°. Bentuk siap secara <b>automatik</b> apabila lengkap.</li>
        </ol>
        <div class="msg ok" style="font-weight:700;margin-top:12px;">
          🏆 Markah penuh <b>${maxScore}</b> · Setiap bentuk siap = <b>${TG_STAGE_MARK}</b> markah · Siap semua ${SHAPES.length} = bonus masa sehingga <b>${TG_TIME_BONUS}</b> (makin cepat, makin tinggi).<br>
          ⏱️ Masa: <b>${Math.round(totalSec/60)} minit</b> — bermula bila anda tekan Mula.
        </div>
      </div>
      <button class="big" onclick="window._tgStart()">▶️ Mula Aktiviti</button>`;
  }

  // `keepClock` is set when resuming: the timer was already running when the
  // student left, and its remaining seconds must not be reset to the full limit.
  function startActivity(keepClock){
    timeUp=false; window._gameOver=false;
    if(!keepClock){ timeLeftSec = totalSec; window._startedAt = Date.now(); }
    document.getElementById('timer').style.display='block';
    if(timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(tick,1000);
    playShape();
  }

  function playShape(){
    stopAssist();
    const shp = SHAPES[tg.idx];
    card.innerHTML = testBanner() + `
      <h2>🧩 ${st.name}</h2>
      <div style="font-weight:800;color:var(--gold);background:var(--navy);display:inline-block;padding:5px 14px;border-radius:6px;">Stage ${shp.stage} (${tg.idx+1}/${SHAPES.length}): ${shp.name} · Markah: ${tg.done*TG_STAGE_MARK}</div>
      <canvas id="tgBoard" width="360" height="460" style="background:#fff;border:3px solid #d4a94e;border-radius:12px;touch-action:none;max-width:100%;display:block;margin:10px auto;"></canvas>
      <p style="color:#555;font-size:13px;">Seret keping ke dalam bayang. Ketik keping = putar.</p>
      <button id="tgFlip" class="secondary" style="display:none;" onclick="window._tgCtrl && window._tgCtrl.flipSelected()">↔ Balik</button>
      ${shp.assist ? '<div id="tgHintBar"></div>' : ''}`;
    window._tgCtrl = window.TangramUI.attachTangram(document.getElementById('tgBoard'), {
      solution: S.SOLUTIONS[shp.id], ppu: 51, targetGuideLines: shp.guide,
      onSolve: onShapeSolved,
      onSelect: (p) => { const f=document.getElementById('tgFlip'); if(f) f.style.display=(p&&p.type==='para')?'inline-block':'none'; }
    });
    if(shp.assist) startAssist();
  }

  // ---- Recurring automatic hint (Segi Empat only) ----
  function startAssist(){
    assistRevealing = false;
    setHintStatus(0);
    if(assistTimer) clearInterval(assistTimer);
    assistTimer = setInterval(revealHint, TG_HINT_INTERVAL_MS);
  }
  function stopAssist(){
    if(assistTimer){ clearInterval(assistTimer); assistTimer = null; }
    if(assistCountdown){ clearInterval(assistCountdown); assistCountdown = null; }
    if(window._tgCtrl) window._tgCtrl.setGuideAlpha(0);
    assistRevealing = false;
    setHintStatus(0);
  }
  function setHintStatus(secLeft){
    const bar = document.getElementById('tgHintBar');
    if(!bar) return;
    bar.innerHTML = secLeft > 0 ? `<span id="tgHintCountdown">💡 Bantuan · ${secLeft}s</span>` : '';
  }
  function revealHint(){
    if(assistRevealing || !window._tgCtrl) return;
    const board = document.getElementById('tgBoard');
    if(!board || !board.offsetParent){ stopAssist(); return; }
    assistRevealing = true;
    window._tgCtrl.setGuideAlpha(1);
    let secLeft = TG_HINT_SEC;
    setHintStatus(secLeft);
    assistCountdown = setInterval(() => {
      secLeft--;
      if(secLeft <= 0){ hideHint(); return; }
      setHintStatus(secLeft);
    }, 1000);
  }
  function hideHint(){
    if(assistCountdown){ clearInterval(assistCountdown); assistCountdown = null; }
    if(window._tgCtrl) window._tgCtrl.setGuideAlpha(0);
    assistRevealing = false;
    setHintStatus(0);
  }

  function onShapeSolved(){
    stopAssist();
    playGameSfx('correct');
    const solved=SHAPES[tg.idx];
    tg.done++; tg.idx++;
    if(tg.idx < SHAPES.length){
      // Bank the finished shape immediately: a student who walks off at this
      // congratulations screen must not lose the stage they just solved.
      captureStationResume();
      card.innerHTML = testBanner() + `<div class="finalbox">
        <div style="font-size:56px;">✅</div>
        <h2 style="color:var(--green);">Stage ${solved.stage} Selesai! <span style="color:var(--gold);">+${TG_STAGE_MARK} markah</span></h2>
        <p>Markah setakat ini: <b>${tg.done*TG_STAGE_MARK}</b>. Seterusnya: bina <b>${SHAPES[tg.idx].name}</b>.</p>
        <p style="color:#888;font-size:13px;">⏱️ Masa masih berjalan — teruskan cepat untuk bonus masa!</p>
        <button class="big" onclick="window._tgNext()">➡️ Bina ${SHAPES[tg.idx].name}</button>
      </div>`;
    } else {
      complete();
    }
  }

  function complete(){
    if(window._gameOver) return; window._gameOver=true;
    stopAssist();
    if(timerInterval) clearInterval(timerInterval);
    const remain = Math.max(0, timeLeftSec);
    const allDone = tg.done >= SHAPES.length;
    gameState.correct=tg.done;
    if(!allDone) playGameSfx('wrong');
    const score = tg.done*TG_STAGE_MARK + (allDone ? Math.round((remain/totalSec)*TG_TIME_BONUS) : 0);
    const timeTakenSec = Math.round((Date.now()-window._startedAt)/1000);
    if(window._testMode){ showTangramTestResult(tg.done, SHAPES.length, maxScore, score, timeTakenSec); return; }
    submitCompletion(allDone, score, timeTakenSec);
  }

  window._tgStart = startActivity;
  window._tgNext = playShape;
  window._tgTimeout = complete;   // invoked by tick() when the timer hits 0
  // A resumed station is already past the instructions and already has a clock
  // running; sending the student back to "Mula Aktiviti" would reset both.
  if(resumeStage) startActivity(true);
  else showInstructions();
}
function showTangramTestResult(done, total, maxScore, score, timeTakenSec){
  show('view-result');
  document.getElementById('timer').style.display='none';
  const msg = done>=total ? `Semua ${total} bentuk siap! 🎉` : done>0 ? `${done}/${total} bentuk siap` : 'Tiada bentuk siap';
  document.getElementById('resultCard').innerHTML=`<div class="finalbox">
    <div style="font-size:50px;">🧪</div>
    <h2>Ujian Selesai</h2>
    <p>${msg}</p>
    <p>Markah: <b>${score}</b> / ${maxScore} <span style="color:#888;">(${timeTakenSec}s)</span></p>
    <p style="color:#888;font-size:13px;">${window._demoMode ? 'Demo — tiada markah disimpan.' : 'Mod ujian — tiada markah disimpan ke Firebase.'}</p>
    ${window._demoMode ? '<button class="big" onclick="startTangramDemo()">↺ Main Semula</button>' : `<button class="big" onclick="endTest()">${testExitLabel()}</button>`}
  </div>`;
}
function finishGame(forceOk,suppressSfx){
  if(window._gameOver) return;   // guard against double-completion (e.g. solve then timeout)
  window._gameOver=true;
  if(gameState.type==='quiz'||gameState.type==='pilihan'){
    let correct=0;
    gameState.qs.forEach((q,i)=>{
      const given = gameState.type==='pilihan'? gameState.answers[i] : (document.getElementById('ans_'+i)?.value||'').trim();
      if(String(given).toLowerCase()===String(q.a).toLowerCase()) correct++;
    });
    gameState.correct=correct;
  }
  if(forceOk){ gameState.correct=gameState.total=1; }
  if(!suppressSfx) playGameSfx(gameState.correct>=gameState.total?'correct':'wrong');
  clearInterval(timerInterval);
  const onTime = !timeUp;
  const timeTakenSec = Math.round((Date.now()-window._startedAt)/1000);
  const pct = gameState.total? gameState.correct/gameState.total : 1;
  let score = Math.round(pct*100);
  if(!onTime) score -= 20;
  if(score<0) score=0;
  if(window._testMode){ showTestResult(onTime, score, timeTakenSec); return; }
  submitCompletion(onTime, score, timeTakenSec);
}
function submitCompletion(onTime, score, timeTakenSec){
  // Every game type funnels here, including the six that skip finishGame.
  if(window._cannonId){ finishCannonQuestion(onTime, score); return; }
  const stId = window._curStId;
  // The station is over; anything saved for resuming it is now a trap that
  // would send the group back into a game they have already been marked for.
  clearStationResume();
  const next=OfflineStore.advanceProgress(progress,{
    stId, score, onTime, timeTakenSec, stationCount:currentStationCount(), now:Date.now()
  });
  progress=next;
  const path=huntPath('progress/'+currentGroupId);
  writeLocalJson(progressCacheKey(currentGroupId),next);
  const done=StationLayout.isJourneyDone(next.currentIndex, currentStationCount());
  // HP, ammo and the hit inbox belong to the shooter and the server. This phone's
  // copy goes stale the moment somebody shoots it, so writing those fields back
  // would undo damage that has already landed.
  const payload=CannonEngine.stripCannonFields(next);
  // Complete the station immediately. Firebase is only a sync target, never a
  // dependency for the student journey once the group has logged in.
  if(isOffline()) queueProgressMerge(path,payload);
  else db.ref(path).update(payload).catch(()=>queueProgressMerge(path,payload));
  showResult(onTime,score,done);
}
// The offline queue de-dupes by path, so a queued cannon award and a queued
// station completion at the same progress path would otherwise clobber each
// other. Merge onto whatever is already queued for that path instead of
// replacing it outright.
function queueProgressMerge(path, data){
  const queue=readLocalJson(OfflineStore.PENDING_KEY)||[];
  const existing=queue.find(item=>item && item.path===path);
  queuePendingWrite(path, {...(existing&&existing.data||{}), ...data});
}
// A cannon question awards a cannonball, never marks — otherwise cannon QRs
// become a way to farm score without walking to a station.
function finishCannonQuestion(onTime, score){
  const cid=window._cannonId;
  window._cannonId=null;
  clearInterval(timerInterval);
  document.getElementById('timer').style.display='none';
  const perfect=CannonEngine.isPerfect(cannons[cid]&&cannons[cid].gameType, score, onTime);
  const award=perfect ? CannonEngine.claimBullet(progress,cid,Date.now()) : null;
  if(award){
    progress={...progress, ...award};
    writeLocalJson(progressCacheKey(currentGroupId),progress);
    const path=huntPath('progress/'+currentGroupId);
    if(isOffline()) queueProgressMerge(path,{ammo:award.ammo,claimed:award.claimed});
    else db.ref(path).update({ammo:award.ammo,claimed:award.claimed})
      .catch(()=>queueProgressMerge(path,{ammo:award.ammo,claimed:award.claimed}));
  }
  playGameSfx(perfect?'correct':'wrong');
  // Unlike showResult() (which calls show('view-result')), this route used to
  // leave #view-game marked active underneath the map it shows next —
  // showClueScreen()/showJourneyMap() only unhide the map overlay, they never
  // switch the active .view. hitSafeToShow() reads #view-game's active class
  // as its "still mid-game" signal, so without this the maybeShowHitPrompt()
  // call below would stay silently blocked forever, even though the question
  // has genuinely ended.
  show('view-clue');
  showClueScreen();
  openCannonPanel();
  setCannonMsg(perfect?'ok':'err', perfect
    ? `🎉 Tepat! Anda dapat 1 peluru meriam. Jumlah peluru: ${CannonEngine.readAmmo(progress)}`
    : 'Belum tepat — cuba lagi dengan scan QR atau password meriam ini.');
  syncCannonFab();
  // A cannon question is its own "the game just ended" route (it never goes
  // through showResult()), so a hit held while it was live must be flushed
  // here too — otherwise it stays hidden until some unrelated event happens
  // to re-trigger the listener, and the HP bar stays stale meanwhile.
  maybeShowHitPrompt();
}
function showResult(onTime, score, done){
  show('view-result');
  document.getElementById('timer').style.display='none';
  const g = groups[currentGroupId];
  let nextHtml='';
  if(done){ nextHtml=`<button class="big" onclick="showGoToBoard()">🏁 Selesai! Ke Peti Harta</button>`; }
  else { nextHtml=`<button class="big" onclick="showClueScreen()">Pilih Pulau Seterusnya</button>`; }
  document.getElementById('resultCard').innerHTML=`<div class="finalbox">
    <div style="font-size:50px;">🔑</div>
    <h2>${onTime?'Tepat Masa!':(gameState.type==='jejak_lari'?'Masa Tamat — Bonus Jarak Disimpan':'Masa Tamat — Markah Ditolak')}</h2>
    <p>Markah stesen ini: <b>${score}</b></p>
    ${nextHtml}
  </div>`;
  maybeShowHitPrompt();
}

