// ---------- MATH CROSSWORD: a fresh randomly-generated puzzle each round ----------
function startCrossword(st, resumeStage){
  // The board is generated fresh each round, so a resume has to bring its own
  // board back with it — regenerating would hand the student a different puzzle
  // and silently discard every answer they had already typed.
  const puzzle=(resumeStage && resumeStage.puzzle) || CrosswordEngine.generatePuzzle();
  const grid=puzzle.grid;
  const entries=CrosswordEngine.blanks(grid);
  gameState.type='crossword';
  gameState.total=entries.length;
  gameState.correct=0;
  gameState.crossword={station:st,puzzle,grid,entries,answers:{...(resumeStage&&resumeStage.answers||{})},selected:null,zoom:44};
  window._crosswordTimeout=()=>finishCrossword(false);
  document.body.classList.add('crossword-mode');
  renderCrossword();
}
function renderCrossword(){
  const crossword=gameState.crossword;
  const puzzle=crossword.puzzle;
  let cells='';
  crossword.grid.forEach((row,r)=>row.forEach((cell,c)=>{
    if(!cell){
      cells+='<div class="cw-gap" aria-hidden="true"></div>';
      return;
    }
    if(Object.prototype.hasOwnProperty.call(cell,'a')){
      const key=`${r},${c}`;
      const value=crossword.answers[key]||'';
      const selected=crossword.selected && crossword.selected.r===r && crossword.selected.c===c;
      cells+=`<div id="cw_${r}_${c}" class="cw-cell blank${selected?' selected':''}" role="button" tabindex="0" aria-label="Kotak kosong baris ${r+1}, lajur ${c+1}${value?`, nilai ${value}`:''}" onclick="selectCwCell(${r},${c})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectCwCell(${r},${c});}">${value}</div>`;
    } else {
      const display=/^\d+$/.test(cell.v)?CrosswordEngine.formatNumber(cell.v):cell.v;
      cells+=`<div class="cw-cell given">${escapeHtml(display)}</div>`;
    }
  }));
  document.getElementById('gameCard').innerHTML=`<div class="crossword-game">
    <h2>${escapeHtml(crossword.station.name)}</h2>
    <p>Lengkapkan semua persamaan melintang dan menegak. Tekan kotak kosong, taip jawapan, lalu tekan &rarr; untuk kotak seterusnya.</p>
    <div class="cw-toolbar">
      <p>Leret untuk melihat seluruh papan.</p>
      <div class="cw-zoom" aria-label="Zum papan">
        <button type="button" onclick="cwZoom(-4)" aria-label="Zum keluar">&#128269;&minus;</button>
        <button type="button" onclick="cwZoom(4)" aria-label="Zum masuk">&#128269;+</button>
      </div>
    </div>
    <div class="crossword-viewport">
      <div id="crosswordBoard" class="crossword-board" style="--cw-cell:${crossword.zoom}px;grid-template-rows:repeat(${puzzle.rows},var(--cw-cell));">${cells}</div>
    </div>
    <div id="crosswordMsg" aria-live="polite"></div>
    <button class="big" type="button" onclick="checkCrossword()">Semak</button>
    <div id="cwPad" class="cw-pad" hidden>
      ${[1,2,3,4,5,6,7,8,9].map(digit=>`<button type="button" onclick="cwInput(${digit})">${digit}</button>`).join('')}
      <button type="button" onclick="cwBackspace()" aria-label="Padam">&#9003;</button>
      <button type="button" onclick="cwInput(0)">0</button>
      <button type="button" onclick="cwNext()" aria-label="Kotak kosong seterusnya">&rarr;</button>
      <button class="cw-pad-close" type="button" onclick="hideCwPad()">Selesai</button>
    </div>
  </div>`;
}
function cwZoom(change){
  const crossword=gameState.crossword;
  if(!crossword) return;
  crossword.zoom=Math.max(30,Math.min(64,crossword.zoom+change));
  const board=document.getElementById('crosswordBoard');
  if(board) board.style.setProperty('--cw-cell',`${crossword.zoom}px`);
}
function selectCwCell(r,c){
  const crossword=gameState.crossword;
  if(!crossword || !crossword.grid[r] || !crossword.grid[r][c] || !Object.prototype.hasOwnProperty.call(crossword.grid[r][c],'a')) return;
  const old=document.querySelector('.cw-cell.selected');
  if(old) old.classList.remove('selected');
  crossword.selected={r,c};
  const cell=document.getElementById(`cw_${r}_${c}`);
  if(cell){ cell.classList.add('selected'); cell.focus({preventScroll:true}); }
  const pad=document.getElementById('cwPad');
  if(pad) pad.hidden=false;
  const viewport=document.querySelector('.crossword-viewport');
  if(viewport && cell){
    viewport.scrollTo({
      left:cell.offsetLeft-(viewport.clientWidth-cell.offsetWidth)/2,
      top:cell.offsetTop-(viewport.clientHeight-cell.offsetHeight)/2,
      behavior:'smooth'
    });
  }
}
const CW_MAX_INPUT_DIGITS=7;
function cwInput(digit){
  const crossword=gameState.crossword;
  if(!crossword || !crossword.selected || !Number.isInteger(digit) || digit<0 || digit>9) return;
  const key=`${crossword.selected.r},${crossword.selected.c}`;
  const current=crossword.answers[key]||'';
  if(current==='0' || current.length>=CW_MAX_INPUT_DIGITS) return;
  if(current==='' && digit===0) return;
  const next=current+String(digit);
  crossword.answers[key]=next;
  const cell=document.getElementById(`cw_${crossword.selected.r}_${crossword.selected.c}`);
  if(cell){
    cell.textContent=CrosswordEngine.formatNumber(next);
    cell.setAttribute('aria-label',`Kotak kosong baris ${crossword.selected.r+1}, lajur ${crossword.selected.c+1}, nilai ${next}`);
  }
}
function cwBackspace(){
  const crossword=gameState.crossword;
  if(!crossword || !crossword.selected) return;
  const key=`${crossword.selected.r},${crossword.selected.c}`;
  const next=(crossword.answers[key]||'').slice(0,-1);
  if(next) crossword.answers[key]=next;
  else delete crossword.answers[key];
  const cell=document.getElementById(`cw_${crossword.selected.r}_${crossword.selected.c}`);
  if(cell){
    cell.textContent=next?CrosswordEngine.formatNumber(next):'';
    cell.setAttribute('aria-label',`Kotak kosong baris ${crossword.selected.r+1}, lajur ${crossword.selected.c+1}${next?`, nilai ${next}`:''}`);
  }
}
function nextEmptyCwEntry(){
  const crossword=gameState.crossword;
  if(!crossword || !crossword.entries.length) return null;
  const selectedIndex=crossword.selected
    ? crossword.entries.findIndex(entry=>entry.r===crossword.selected.r && entry.c===crossword.selected.c)
    : -1;
  for(let offset=1;offset<=crossword.entries.length;offset++){
    const entry=crossword.entries[(selectedIndex+offset+crossword.entries.length)%crossword.entries.length];
    if(!Object.prototype.hasOwnProperty.call(crossword.answers,`${entry.r},${entry.c}`)) return entry;
  }
  return null;
}
function cwNext(){
  const next=nextEmptyCwEntry();
  if(next) selectCwCell(next.r,next.c);
}
function hideCwPad(){
  const pad=document.getElementById('cwPad');
  if(pad) pad.hidden=true;
}
function checkCrossword(){
  const crossword=gameState.crossword;
  if(!crossword || window._gameOver) return;
  const result=CrosswordEngine.grade(crossword.grid,crossword.answers);
  gameState.correct=result.correct;
  if(result.solved){
    playGameSfx('correct');
    finishCrossword(!timeUp);
    return;
  }
  playGameSfx('wrong');
  const msg=document.getElementById('crosswordMsg');
  if(msg) msg.innerHTML=`<div class="msg err">${result.empty} kotak belum diisi dan ${result.wrong} jawapan perlu disemak.</div>`;
}
function finishCrossword(onTime){
  if(window._gameOver) return;
  window._gameOver=true;
  window._crosswordTimeout=null;
  clearInterval(timerInterval);
  const crossword=gameState.crossword;
  const result=CrosswordEngine.grade(crossword.grid,crossword.answers);
  gameState.correct=result.correct;
  const timeTakenSec=Math.round((Date.now()-window._startedAt)/1000);
  let score=Math.round((result.correct/result.total)*100);
  if(!onTime) score=Math.max(0,score-20);
  if(window._testMode){ showTestResult(onTime,score,timeTakenSec); return; }
  submitCompletion(onTime,score,timeTakenSec);
}
