// ---------- GAME ----------
function startGame(stId, testSt, resumeSnapshot){
  if(!(window._cannonId && stId===window._cannonId)) window._cannonId=null;
  cancelBsDrag();
  if(sifirQInterval) clearInterval(sifirQInterval);
  sifirQInterval=null;
  show('view-game');
  const st = testSt || stations[stId];
  timeUp=false;
  window._gameOver=false;
  window._sudokuTimeout=null;
  window._crosswordTimeout=null;
  window._battleshipTimeout=null;
  window._sifirTimeout=null;
  timeLeftSec = (st.timeLimitMin||10)*60;
  window._startedAt = Date.now();
  window._curStId = stId;
  if(resumeSnapshot){
    timeLeftSec = resumeSnapshot.timeLeftSec;
    // Rewind the start marker by the time already played so the timeTakenSec
    // reported at the end still measures play, not the gap.
    window._startedAt = Date.now() - (resumeSnapshot.elapsedSec||0)*1000;
  }
  renderGame(st, resumeSnapshot ? resumeSnapshot.stage : null);
  // Tangram runs its own flow: instructions -> Mula -> timer -> 2 shapes, and
  // draws its own test banner, so don't start the timer / banner here for it.
  if(st.gameType==='tangram') return;
  if(st.gameType==='jejak_lari') return;
  document.getElementById('timer').style.display='block';
  timerInterval = setInterval(tick,1000);
  if(window._testMode){
    const card = document.getElementById('gameCard');
    const banner = document.createElement('div');
    banner.className='msg';
    banner.style.background='#fdf3d8';
    banner.style.marginTop='0';
    banner.innerHTML=`🧪 <b>Mod Ujian</b> — markah tidak disimpan. <button class="linkbtn" onclick="endTest()">${testExitLabel()}</button>`;
    card.insertBefore(banner, card.firstChild);
  }
}
function tick(){
  timeLeftSec--;
  // A crash net: visibilitychange covers an orderly exit, this covers a battery
  // pulled out mid-shape. Five seconds is the most a student can lose.
  if(timeLeftSec > 0 && timeLeftSec % 5 === 0) captureStationResume();
  const displaySeconds=Math.max(0,timeLeftSec);
  const m=Math.floor(displaySeconds/60), s=displaySeconds%60;
  const t=document.getElementById('timer');
  t.innerText=`${m}:${String(s).padStart(2,'0')}`;
  const sifirTimer=document.getElementById('sifirTopTimer');
  if(sifirTimer) sifirTimer.innerText=`${m}:${String(s).padStart(2,'0')}`;
  if(timeLeftSec<=30) t.classList.add('warn');
  if(timeLeftSec<=0){
    clearInterval(timerInterval); timeUp=true; t.innerText='HABIS';
    // Open-ended games (tangram) have no manual submit button, so auto-finish
    // on timeout — otherwise a student who can't solve is stranded here.
    if(gameState && gameState.type==='tangram' && window._tgTimeout){ window._tgTimeout(); }
    if(gameState && gameState.type==='sudoku' && window._sudokuTimeout){ window._sudokuTimeout(); }
    if(gameState && gameState.type==='crossword' && window._crosswordTimeout){ window._crosswordTimeout(); }
    if(gameState && gameState.type==='battleship' && window._battleshipTimeout){ window._battleshipTimeout(); }
    if(gameState && gameState.type==='sifir' && window._sifirTimeout){ window._sifirTimeout(); }
    if(gameState && gameState.type==='jejak_lari' && window._runTimeout){ window._runTimeout(); }
  }
}
// `resumeStage` is the small per-game payload saved when the student left this
// station; null on a fresh entry.
function renderGame(st, resumeStage){
  const card = document.getElementById('gameCard');
  let data={}; try{ data=JSON.parse(st.gameDataRaw||'{}'); }catch(e){ data={}; }
  gameState={type:st.gameType, correct:0, total:0, matched:0, selectedQ:null};

  if(st.gameType==='quiz' || st.gameType==='pilihan'){
    const qs = data.questions || [{q:'5 + 3',a:'8',choices:['7','8','9']}];
    gameState.total=qs.length; gameState.answers=new Array(qs.length).fill(null); gameState.qs=qs;
    let html=`<h2>${st.name}</h2>`;
    qs.forEach((q,i)=>{
      if(st.gameType==='pilihan' && q.choices){
        html+=`<div class="qitem"><b>${i+1}. ${q.q}</b><div id="choices_${i}">`;
        q.choices.forEach(c=>{ html+=`<button onclick="pickChoice(${i},'${c}')" style="margin:4px;">${c}</button>`; });
        html+=`</div></div>`;
      } else {
        html+=`<div class="qitem"><b>${i+1}. ${q.q}</b><input id="ans_${i}" placeholder="Jawapan"></div>`;
      }
    });
    html+=`<button class="big" onclick="finishGame()">Hantar Semua Jawapan</button>`;
    card.innerHTML=html;
  }
  else if(st.gameType==='susun_nombor'){
    const nums = data.numbers || [5,2,8,1,9,3];
    gameState.correctOrder=[...nums].sort((a,b)=>a-b); gameState.total=1; gameState.picked=[];
    let html=`<h2>${st.name}</h2><p>Klik nombor mengikut turutan menaik.</p><div id="chipArea">`;
    nums.forEach(n=>{ html+=`<span class="chip" onclick="pickNum(this,${n})">${n}</span>`; });
    html+=`</div><div style="margin-top:14px;">Jawapan: <span id="orderResult" style="font-weight:800;"></span></div><button class="big" onclick="checkOrder()">Semak Turutan</button>`;
    card.innerHTML=html;
  }
  else if(st.gameType==='padan' || st.gameType==='puzzle_susun'){
    const pairs = data.pairs || [{q:'5+5',a:'10'},{q:'3x3',a:'9'},{q:'10-4',a:'6'}];
    gameState.pairs=pairs; gameState.total=pairs.length;
    const answers=[...pairs.map(p=>p.a)].sort(()=>Math.random()-.5);
    let html=`<h2>${st.name}</h2><p>Padankan soalan dengan jawapan.</p><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div><b>Soalan</b>`;
    pairs.forEach((p,i)=>{ html+=`<button class="match-btn" onclick="selectQ(${i})">${p.q}</button>`; });
    html+=`</div><div><b>Jawapan</b>`;
    answers.forEach(a=>{ html+=`<button class="match-btn" onclick="selectA('${a}',this)">${a}</button>`; });
    html+=`</div></div><div id="matchMsg"></div>`;
    card.innerHTML=html;
  }
  else if(st.gameType==='grid_nombor'){
    const size=data.size||3;
    const grid=data.grid || [[1,2,null],[null,5,6],[7,null,9]];
    gameState.grid=grid; gameState.total=1; gameState.solution=data.solution||grid;
    let html=`<h2>${st.name}</h2><p>Isi ruang kosong.</p><div class="grid3" style="grid-template-columns:repeat(${size},60px);">`;
    grid.forEach((row,r)=>row.forEach((cell,c)=>{
      html += cell===null ? `<input id="cell_${r}_${c}">` : `<div class="key" style="background:#eee;color:#333;">${cell}</div>`;
    }));
    html+=`</div><button class="big" onclick="checkGrid()">Semak Grid</button>`;
    card.innerHTML=html;
  }
  else if(st.gameType==='lembaran_kerja'){
    const questions=worksheetQuestionsFromRaw(st.gameDataRaw);
    gameState.questions=questions;
    gameState.total=questions.length;
    // Resume drops the student back on the question they had reached, keeping
    // the answers they already got right.
    gameState.currentQuestion=Math.min(questions.length-1, Math.max(0, Number(resumeStage&&resumeStage.currentQuestion)||0));
    gameState.correct=Math.max(0, Number(resumeStage&&resumeStage.correct)||0);
    gameState.stationName=st.name;
    renderWorksheetQuestion();
  }
  else if(st.gameType==='sudoku'){
    startSudoku(st, resumeStage);
    return;
  }
  else if(st.gameType==='crossword'){
    startCrossword(st, resumeStage);
    return;
  }
  else if(st.gameType==='battleship'){
    startBattleship(st, resumeStage);
    return;
  }
  else if(st.gameType==='sifir'){
    startSifir(st);
    return;
  }
  else if(st.gameType==='tangram'){
    startTangram(st, resumeStage);
    return;
  }
  else if(st.gameType==='jejak_lari'){
    startRun(st, resumeStage);
    return;
  }
  else {
    card.innerHTML=`<h2>${st.name}</h2><p>Game belum dikonfigurasi.</p><button class="big" onclick="finishGame(true)">Selesai</button>`;
  }
}
function normalizeWorksheetAnswer(value){
  return String(value||'').trim().replace(/\s+/g,' ').toLocaleLowerCase();
}
function renderWorksheetQuestion(){
  const card=document.getElementById('gameCard');
  const current=gameState.currentQuestion;
  const total=gameState.total;
  const question=gameState.questions[current]||{};
  const image=safeWorksheetImage(question.image);
  const imageHtml=image?`<figure class="worksheet-question-figure"><img class="worksheet-question-image" src="${escapeHtml(image)}" alt="Gambar Soalan ${current+1}"></figure>`:'';
  card.innerHTML=`<h2>📜 ${gameState.stationName}</h2>
    <div class="clue">${image?'Rujuk gambar di bawah':'Rujuk lembaran kerja anda'} dan masukkan jawapan Soalan ${current+1}.</div>
    ${imageHtml}
    <div class="qitem" style="margin-top:16px;">
      <b>Soalan ${current+1} daripada ${total}</b>
      <input id="worksheetAnswer" type="text" autocomplete="off" placeholder="Masukkan jawapan" onkeydown="if(event.key==='Enter') submitWorksheetAnswer()">
    </div>
    <button class="big" onclick="submitWorksheetAnswer()">Semak Jawapan</button>
    <div id="worksheetMsg"></div>`;
  if(!image) setTimeout(()=>document.getElementById('worksheetAnswer')?.focus(),0);
}
function submitWorksheetAnswer(){
  if(window._gameOver) return;
  const input=document.getElementById('worksheetAnswer');
  const message=document.getElementById('worksheetMsg');
  const expected=gameState.questions[gameState.currentQuestion].answer;
  if(normalizeWorksheetAnswer(input&&input.value)!==normalizeWorksheetAnswer(expected)){
    playGameSfx('wrong');
    if(message) message.innerHTML='<div class="msg err">Jawapan belum tepat. Semak lembaran kerja dan cuba lagi.</div>';
    if(input){ input.focus(); input.select(); }
    return;
  }
  playGameSfx('correct');
  gameState.correct++;
  gameState.currentQuestion++;
  if(gameState.currentQuestion>=gameState.total){ finishGame(false,true); return; }
  renderWorksheetQuestion();
}
function pickChoice(i,c){
  gameState.answers[i]=c;
  document.querySelectorAll(`#choices_${i} button`).forEach(b=>b.style.background=b.innerText===c?'#d4a94e':'');
}
function pickNum(el,n){ gameState.picked.push(n); el.style.opacity=.3; el.onclick=null; document.getElementById('orderResult').innerText=gameState.picked.join(', '); }
function checkOrder(){ gameState.correct = JSON.stringify(gameState.picked)===JSON.stringify(gameState.correctOrder)?1:0; finishGame(); }
function selectQ(i){ gameState.selectedQ=i; document.querySelectorAll('.match-btn').forEach((b,idx)=>{ if(idx<gameState.pairs.length) b.classList.toggle('selected', idx===i); }); }
function selectA(a,el){
  if(gameState.selectedQ===null) return;
  const p = gameState.pairs[gameState.selectedQ];
  if(String(p.a)===String(a)){
    playGameSfx('correct');
    gameState.matched++;
    document.querySelectorAll('.match-btn')[gameState.selectedQ].classList.add('matched');
    el.classList.add('matched');
    if(gameState.matched===gameState.total){
      document.getElementById('matchMsg').innerHTML='<div class="msg ok">Semua padan!</div>';
      gameState.correct=gameState.total;
      setTimeout(()=>finishGame(false,true),500);
    }
  } else {
    playGameSfx('wrong');
    el.style.background='#fbe4e2'; setTimeout(()=>el.style.background='',400);
  }
  gameState.selectedQ=null;
}
function checkGrid(){
  let correct=0,total=0;
  gameState.grid.forEach((row,r)=>row.forEach((cell,c)=>{
    if(cell===null){ total++; const val=document.getElementById(`cell_${r}_${c}`).value.trim(); if(Number(val)===Number(gameState.solution[r][c])) correct++; }
  }));
  gameState.correct = correct===total?1:0; gameState.total=1;
  finishGame();
}

// Sifir Challenge: 15 multiplication questions must be cleared consecutively.
// A wrong answer (or four-second timeout) creates a new set and restarts at Q1.
function startSifir(st){
  const totalSec=(st.timeLimitMin||10)*60;
  const target=sifirTargetFromRaw(st.gameDataRaw);
  gameState={
    type:'sifir', total:target, correct:0,
    sifir:{stationName:st.name, totalSec, target, questions:SifirEngine.generateQuestions(), qIndex:0, restartToken:0}
  };
  window._sifirTimeout=()=>finishSifir(0);
  renderSifirQuestion();
}
function sifirClockText(seconds){
  const safe=Math.max(0,Number(seconds)||0);
  return `${Math.floor(safe/60)}:${String(safe%60).padStart(2,'0')}`;
}
function renderSifirQuestion(){
  if(window._gameOver) return;
  if(sifirQInterval) clearInterval(sifirQInterval);
  const sifir=gameState.sifir;
  const question=sifir.questions[sifir.qIndex];
  const card=document.getElementById('gameCard');
  card.innerHTML=`<div class="sifir-game" style="max-width:600px;margin:auto;text-align:center;">
    <h2>${sifir.stationName}</h2>
    <div id="sifirTopTimer" style="font-size:42px;font-weight:900;color:var(--red);margin:8px 0;">${sifirClockText(timeLeftSec)}</div>
    <p style="margin:0 0 8px;color:#65513a;">Masa stesen berbaki</p>
    <div style="font-size:20px;font-weight:800;margin:20px 0 6px;">Soalan ${sifir.qIndex+1}/${sifir.target}</div>
    <div id="sifirQCountdown" style="font-size:18px;font-weight:800;color:var(--navy);margin-bottom:8px;">⏱️ 4 saat</div>
    <div id="sifirQTimer" role="progressbar" aria-label="Masa menjawab soalan" aria-valuemin="0" aria-valuemax="4" aria-valuenow="4" style="height:16px;max-width:360px;margin:0 auto 18px;border:2px solid var(--navy);border-radius:999px;overflow:hidden;background:#fff8df;box-shadow:inset 0 1px 2px #0002;">
      <div id="sifirQBar" style="height:100%;width:100%;transform-origin:left center;animation:sifir-question-countdown ${SifirEngine.PER_QUESTION_SEC}s linear forwards;"></div>
    </div>
    <div id="sifirPrompt" style="font-size:52px;font-weight:900;margin:10px 0 22px;">${question.a} × ${question.b}</div>
    <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;">
      ${question.choices.map(choice=>`<button class="big sifir-choice" style="margin:0;min-height:62px;" onclick="answerSifir(${choice})">${choice}</button>`).join('')}
    </div>
    <div id="sifirMsg" aria-live="polite"></div>
  </div>`;
  let remaining=SifirEngine.PER_QUESTION_SEC;
  sifirQInterval=setInterval(()=>{
    remaining--;
    const countdown=document.getElementById('sifirQCountdown');
    if(countdown) countdown.textContent=`⏱️ ${Math.max(0,remaining)} saat`;
    const timer=document.getElementById('sifirQTimer');
    if(timer) timer.setAttribute('aria-valuenow',String(Math.max(0,remaining)));
    if(remaining<=0){
      clearInterval(sifirQInterval); sifirQInterval=null;
      restartSifir('Masa 4 saat tamat. Set baharu bermula semula dari Soalan 1.');
    }
  },1000);
}
function answerSifir(choice){
  if(window._gameOver) return;
  if(sifirQInterval) clearInterval(sifirQInterval);
  sifirQInterval=null;
  const sifir=gameState.sifir;
  const question=sifir.questions[sifir.qIndex];
  if(Number(choice)===Number(question.answer)){
    playGameSfx('correct');
    sifir.qIndex++;
    gameState.correct=sifir.qIndex;
    if(sifir.qIndex>=sifir.target){
      finishSifir(SifirEngine.scoreFromTime(timeLeftSec,sifir.totalSec));
      return;
    }
    renderSifirQuestion();
    return;
  }
  restartSifir('Jawapan belum tepat. Set baharu bermula semula dari Soalan 1.');
}
function restartSifir(message){
  if(window._gameOver) return;
  playGameSfx('wrong');
  if(sifirQInterval) clearInterval(sifirQInterval);
  sifirQInterval=null;
  const sifir=gameState.sifir;
  const token=++sifir.restartToken;
  const card=document.getElementById('gameCard');
  card.innerHTML=`<div class="finalbox"><div style="font-size:48px;">↻</div><h2>Cuba Semula</h2><p>${message}</p></div>`;
  setTimeout(()=>{
    if(window._gameOver || !gameState.sifir || gameState.sifir.restartToken!==token) return;
    gameState.sifir.questions=SifirEngine.generateQuestions();
    gameState.sifir.qIndex=0;
    gameState.correct=0;
    renderSifirQuestion();
  },350);
}
function finishSifir(score){
  if(window._gameOver) return;
  window._gameOver=true;
  if(sifirQInterval) clearInterval(sifirQInterval);
  sifirQInterval=null;
  window._sifirTimeout=null;
  clearInterval(timerInterval);
  const onTime=!timeUp;
  const timeTakenSec=Math.round((Date.now()-window._startedAt)/1000);
  if(window._testMode){ showTestResult(onTime,score,timeTakenSec); return; }
  submitCompletion(onTime,score,timeTakenSec);
}

// Sudoku uses fixed, verified puzzles. The admin chooses which of the three
// stages a station includes: 4x4, guided 9x9, and harder 9x9.
function startSudoku(st, resumeStage){
  const allStages = [
    {id:1,size:4,label:'4 x 4',hint:'Mulakan dengan Sudoku 4 x 4. Setiap kotak 2 x 2 juga perlu lengkap.',puzzle:[
      [1,0,0,4],
      [0,4,1,0],
      [2,0,0,3],
      [0,3,2,0]
    ],solution:[
      [1,2,3,4],
      [3,4,1,2],
      [2,1,4,3],
      [4,3,2,1]
    ]},
    {id:2,size:9,label:'9 x 9 - Banyak Hint',hint:'Setiap kotak 3 x 3 hanya mempunyai 2 ruang kosong.',puzzle:[
      [5,0,4,0,7,8,9,1,2],
      [6,7,0,1,9,5,3,0,8],
      [1,9,8,3,0,2,5,6,0],
      [0,5,9,7,6,1,0,2,3],
      [4,0,6,8,0,3,7,9,1],
      [7,1,3,9,2,0,8,5,0],
      [9,6,0,5,3,7,2,0,4],
      [0,8,7,0,1,9,6,3,5],
      [3,4,5,2,8,0,0,7,9]
    ],solution:[
      [5,3,4,6,7,8,9,1,2],
      [6,7,2,1,9,5,3,4,8],
      [1,9,8,3,4,2,5,6,7],
      [8,5,9,7,6,1,4,2,3],
      [4,2,6,8,5,3,7,9,1],
      [7,1,3,9,2,4,8,5,6],
      [9,6,1,5,3,7,2,8,4],
      [2,8,7,4,1,9,6,3,5],
      [3,4,5,2,8,6,1,7,9]
    ]},
    {id:3,size:9,label:'9 x 9 - Cabaran',hint:'Setiap kotak 3 x 3 mempunyai sehingga 5 ruang kosong.',puzzle:[
      [0,3,4,0,0,8,9,0,0],
      [6,7,0,0,0,5,3,4,0],
      [0,0,0,3,4,0,0,6,0],
      [8,0,9,7,6,1,0,0,0],
      [0,2,0,0,5,0,0,0,1],
      [0,0,3,0,0,0,8,5,6],
      [9,0,0,0,3,0,0,8,0],
      [0,8,0,4,0,9,6,0,5],
      [0,4,5,2,0,0,1,0,0]
    ],solution:[
      [5,3,4,6,7,8,9,1,2],
      [6,7,2,1,9,5,3,4,8],
      [1,9,8,3,4,2,5,6,7],
      [8,5,9,7,6,1,4,2,3],
      [4,2,6,8,5,3,7,9,1],
      [7,1,3,9,2,4,8,5,6],
      [9,6,1,5,3,7,2,8,4],
      [2,8,7,4,1,9,6,3,5],
      [3,4,5,2,8,6,1,7,9]
    ]}
  ];
  const selectedStages=sudokuStagesFromRaw(st.gameDataRaw);
  const stages=(selectedStages.length?selectedStages:[1,2,3]).map(id=>allStages[id-1]);
  gameState.type='sudoku';
  gameState.total=stages.length;
  // The stage list is rebuilt from config, so a resume only has to restore how
  // far through it the student had got. Clamp in case an admin has since
  // removed stages from this station.
  const completed=Math.min(stages.length, Math.max(0, Number(resumeStage&&resumeStage.completed)||0));
  // checkSudokuStage() bumps `completed` but leaves `stageIndex` on the finished
  // stage until the student taps Teruskan. Leaving mid-way through that pause
  // would otherwise replay a stage they had already solved, so skip forward.
  const stageIndex=Math.min(stages.length-1,
    Math.max(completed, Math.max(0, Number(resumeStage&&resumeStage.stageIndex)||0)));
  gameState.correct=completed;
  gameState.sudoku={station:st,stages,stageIndex,completed};
  window._sudokuTimeout=()=>finishSudoku(false);
  showSudokuStage();
}
function sudokuCellBorderStyle(size,row,col){
  const boxSize=size===4 ? 2 : size===9 ? 3 : 0;
  if(!boxSize) return '';
  const styles=[];
  if((col+1)%boxSize===0 && col<size-1) styles.push('border-right:3px solid var(--navy)!important');
  if((row+1)%boxSize===0 && row<size-1) styles.push('border-bottom:3px solid var(--navy)!important');
  return styles.join(';');
}
function showSudokuStage(){
  const sudoku=gameState.sudoku;
  const stage=sudoku.stages[sudoku.stageIndex];
  const card=document.getElementById('gameCard');
  const progress=sudoku.stages.map((item,i)=>`<span class="${i<sudoku.completed?'done':i===sudoku.stageIndex?'active':''}">${item.id}</span>`).join('');
  const blockRule=stage.size===9 ? ' Setiap kotak 3 x 3 juga mesti lengkap.' : stage.size===4 ? ' Setiap kotak 2 x 2 juga mesti lengkap.' : '';
  let html=`<div class="sudoku-game"><h2>${sudoku.station.name}</h2><p>Selesaikan ${sudoku.stages.length} stage Sudoku yang dipilih mengikut urutan.</p><div class="sudoku-progress">${progress}</div><h3 style="margin:0;">Stage ${stage.id} (${sudoku.stageIndex+1}/${sudoku.stages.length}): ${stage.label}</h3><p style="color:#666;font-size:14px;">${stage.hint}</p><p style="color:#666;font-size:14px;">Isi nombor 1 hingga ${stage.size} sekali bagi setiap baris dan lajur.${blockRule}</p><div class="sudoku-board size-${stage.size}" style="grid-template-columns:repeat(${stage.size},minmax(0,1fr));">`;
  stage.puzzle.forEach((row,r)=>row.forEach((cell,c)=>{
    const style=sudokuCellBorderStyle(stage.size,r,c);
    if(cell){
      html+=`<div class="sudoku-cell given" style="${style}">${cell}</div>`;
    } else {
      html+=`<input class="sudoku-cell" id="sudoku_${sudoku.stageIndex}_${r}_${c}" inputmode="numeric" maxlength="1" aria-label="Baris ${r+1}, lajur ${c+1}" style="${style}" oninput="sanitizeSudokuInput(this,${stage.size})">`;
    }
  }));
  html+=`</div><div id="sudokuMsg"></div><button class="big" onclick="checkSudokuStage()">Semak Stage ${stage.id}</button></div>`;
  card.innerHTML=html;
}
function sanitizeSudokuInput(input,size){
  const value=String(input.value||'').replace(/[^0-9]/g,'').slice(0,1);
  input.value=Number(value)>0 && Number(value)<=size ? value : '';
  input.classList.remove('error');
}
function checkSudokuStage(){
  const sudoku=gameState.sudoku;
  const stage=sudoku.stages[sudoku.stageIndex];
  let empty=0,wrong=0;
  stage.puzzle.forEach((row,r)=>row.forEach((cell,c)=>{
    if(cell) return;
    const input=document.getElementById(`sudoku_${sudoku.stageIndex}_${r}_${c}`);
    const value=Number(input.value);
    input.classList.remove('error');
    if(!value){ empty++; return; }
    if(value!==stage.solution[r][c]){ wrong++; }
  }));
  const msg=document.getElementById('sudokuMsg');
  if(empty || wrong){
    playGameSfx('wrong');
    const parts=[];
    if(empty) parts.push(`${empty} kotak belum diisi`);
    if(wrong) parts.push(`${wrong} jawapan perlu disemak`);
    msg.innerHTML=`<div class="msg err">${parts.join(' dan ')}.</div>`;
    return;
  }
  playGameSfx('correct');
  sudoku.completed++;
  gameState.correct=sudoku.completed;
  if(sudoku.completed>=sudoku.stages.length){
    finishSudoku(!timeUp);
    return;
  }
  const next=sudoku.stages[sudoku.stageIndex+1];
  document.getElementById('gameCard').innerHTML=`<div class="finalbox"><div style="font-size:52px;">&#10003;</div><h2 style="color:var(--green);">Stage ${stage.id} Selesai!</h2><p>Seterusnya: Sudoku ${next.label}.</p><button class="big" onclick="nextSudokuStage()">Teruskan ke Stage ${next.id}</button></div>`;
}
function nextSudokuStage(){
  gameState.sudoku.stageIndex++;
  showSudokuStage();
}

