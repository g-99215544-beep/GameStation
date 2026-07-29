// ---------- BATTLESHIP: place your fleet, then trade shots with the computer ----------
// Mirrors the .bs-board CSS: 9 coordinates plus the label row/column, with a
// 2px grid gap and 5px of board padding.
const BS_BOARD_TRACKS=10, BS_BOARD_GAP=2, BS_BOARD_PAD=5;
function startBattleship(st, resumeStage){
  // Both fleets are placed randomly, so a resume must restore the fleets it was
  // played against. Re-rolling the enemy would make every shot already fired
  // meaningless.
  const saved=resumeStage||{};
  gameState.type='battleship';
  gameState.total=BattleshipEngine.FLEET_SPEC.length;
  gameState.correct=Number(saved.correct)||0;
  gameState.battleship={
    station:st,phase:saved.phase||'placing',
    playerFleet:saved.playerFleet||[],drag:null,
    enemyFleet:saved.enemyFleet||[],
    playerShotLog:{...(saved.playerShotLog||{})},enemyShotLog:{...(saved.enemyShotLog||{})},
    pendingX:'',pendingY:'',activeField:'x',busy:false,round:Number(saved.round)||1
  };
  window._battleshipTimeout=()=>finishBattleship(false);
  document.body.classList.add('battleship-mode');
  renderBattleship();
}
function bsXLabel(x){
  return String.fromCharCode(65+Number(x));
}
function renderBsBoard(fleet,shotLog,opts){
  const size=BattleshipEngine.GRID_SIZE;
  const shipAt=new Map();
  if(opts.showShips) fleet.forEach(s=>s.cells.forEach(c=>shipAt.set(`${c.x},${c.y}`,s.name)));
  let cells='';
  for(let y=size-1;y>=0;y--){
    if(opts.showLabels) cells+=`<div class="bs-row-label">${y}</div>`;
    for(let x=0;x<size;x++){
      const key=`${x},${y}`, shot=shotLog[key];
      let cls='water', mark='', state='belum ditembak';
      if(shot==='hit'){ cls='hit'; mark='X'; state='kena'; }
      else if(shot==='miss'){ cls='miss'; mark='O'; state='tidak kena'; }
      else if(shipAt.has(key)){ cls='ship'; state='kapal anda'; }
      const owner=cls==='ship'?` data-ship="${escapeHtml(shipAt.get(key))}"`:'';
      cells+=`<div id="${opts.prefix}_${x}_${y}" class="bs-cell ${cls}"${owner} aria-label="Petak (${bsXLabel(x)}, ${y}), ${state}">${mark}</div>`;
    }
  }
  if(opts.showLabels){
    cells+='<div class="bs-corner" aria-hidden="true"></div>';
    for(let x=0;x<size;x++) cells+=`<div class="bs-col-label">${bsXLabel(x)}</div>`;
  }
  return cells;
}
function renderBsFleetList(side){
  const bs=gameState.battleship;
  return bs.enemyFleet.map((ship,index)=>({ship,index})).filter(item=>side==='left'?item.index%2===0:item.index%2===1).map(({ship})=>{
    const sunk=BattleshipEngine.isShipSunk(ship,bs.playerShotLog);
    return `<div class="bs-fleet-item${sunk?' sunk':''}">
      <span class="bs-fleet-mark" aria-hidden="true">${sunk?'✕':'○'}</span>
      <span class="bs-fleet-name">${escapeHtml(ship.name)} (${ship.length})</span>
    </div>`;
  }).join('');
}
function updateBsFleetList(){
  const left=document.getElementById('bsFleetLeft');
  const right=document.getElementById('bsFleetRight');
  if(left) left.innerHTML=renderBsFleetList('left');
  if(right) right.innerHTML=renderBsFleetList('right');
}
function bsCoordRow(label,handler){
  return `<div class="bs-coord-row">
      <span>(</span>
      <input id="bsBoxX" class="bs-coord-box" type="text" inputmode="text" pattern="[A-Ia-i]" maxlength="1" placeholder="A" autocomplete="off" autocapitalize="characters" aria-label="Koordinat huruf A hingga I" oninput="bsCoordinateInput('x',this)" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('bsBoxY').focus();}">
      <span>,</span>
      <input id="bsBoxY" class="bs-coord-box" type="text" inputmode="numeric" pattern="[0-8]" maxlength="1" placeholder="0" autocomplete="off" aria-label="Koordinat nombor 0 hingga 8" oninput="bsCoordinateInput('y',this)" onkeydown="if(event.key==='Enter'&&!document.getElementById('bsActionBtn').disabled){event.preventDefault();${handler}}">
      <span>)</span>
      <button id="bsActionBtn" class="big" type="button" onclick="${handler}" disabled>${label}</button>
    </div>`;
}
function renderBattleship(){
  const bs=gameState.battleship;
  const head=`<h2>${escapeHtml(bs.station.name)}</h2>`;
  if(bs.phase==='placing'){
    document.getElementById('gameCard').innerHTML=`<div class="battleship-game placing" onpointerdown="bsPointerDown(event)">
      ${head}
      <p>Seret kapal dari bawah ke grid. Ketik kapal di grid untuk pusingkannya.</p>
      <div class="bs-board-wrap">
        <div class="bs-board">${renderBsBoard(bs.playerFleet,{},{prefix:'bsp',showShips:true,showLabels:true})}</div>
      </div>
      <div id="bsMsg" aria-live="polite"></div>
      <div id="bsDock" class="bs-dock">${renderBsDock()}</div>
      <div class="bs-place-actions">
        <button type="button" onclick="resetBsPlacement()">Susun Semula</button>
        <button id="bsStartBtn" class="big" type="button" onclick="bsStartBattle()" disabled>Sedia! Mula Menembak</button>
      </div>
    </div>`;
    updateBsStartEnabled();
    fitBsBoard();
    return;
  }
  document.getElementById('gameCard').innerHTML=`<div class="battleship-game">
    ${head}
    <p>Tembak armada komputer. Masukkan koordinat (A-I, 0-8) lalu tekan Tembak.</p>
    <div class="bs-battlefield">
      <div id="bsEnemyBoardWrap" class="bs-enemy-zone">
        <div id="bsFleetLeft" class="bs-fleet-side" aria-label="Kapal lawan">${renderBsFleetList('left')}</div>
        <div id="bsEnemyGridWrap" class="bs-board-wrap">
          <div class="bs-board">${renderBsBoard(bs.enemyFleet,bs.playerShotLog,{prefix:'bs',showShips:false,showLabels:true})}</div>
        </div>
        <div id="bsFleetRight" class="bs-fleet-side" aria-label="Kapal lawan">${renderBsFleetList('right')}</div>
      </div>
      <div id="bsMsg" aria-live="polite"></div>
      ${bsCoordRow('Tembak','fireBattleship()')}
      <div class="bs-mini-head">Armada anda</div>
      <div id="bsPlayerBoardWrap" class="bs-mini-wrap">
        <div class="bs-board plain mini">${renderBsBoard(bs.playerFleet,bs.enemyShotLog,{prefix:'bsp',showShips:true,showLabels:false})}</div>
      </div>
      <div id="bsEnemyMsg" aria-live="polite"></div>
    </div>
  </div>`;
  fitBsBoard();
}
// Shrinks the board so all 10 rows and columns (including labels) fit inside
// their frame. Every coordinate must remain visible on a phone so a student
// can check where each shot landed. Wide screens keep the larger CSS size.
// The placing screen's taller dock+actions area (added alongside this task)
// leaves .bs-board-wrap little enough room that the very first measurement,
// taken before the surrounding flex column has settled into its final size,
// can be off by a couple of pixels. A second pass one animation frame later
// re-measures the settled layout and corrects it.
function fitBsBoard(_pass){
  const wrap=document.querySelector('.bs-board-wrap');
  const board=wrap && wrap.querySelector('.bs-board:not(.mini)');
  if(!board) return;
  if(window.innerWidth>720 || !document.body.classList.contains('battleship-mode')){ board.style.removeProperty('--bs-cell'); return; }
  const cs=getComputedStyle(wrap);
  const availW=wrap.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);
  const availH=wrap.clientHeight-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
  const chrome=BS_BOARD_GAP*(BS_BOARD_TRACKS-1)+BS_BOARD_PAD*2;
  const size=Math.floor((Math.min(availW,availH)-chrome)/BS_BOARD_TRACKS);
  board.style.setProperty('--bs-cell',Math.max(14,Math.min(28,size))+'px');
  if(_pass!==true) requestAnimationFrame(()=>fitBsBoard(true));
}
// Both message lines start empty and grow when they get text, so the board has
// to be re-fitted after every message change or it outgrows the space left.
function setBsMsg(text){
  const msg=document.getElementById('bsMsg');
  if(msg) msg.textContent=text;
  fitBsBoard();
}
function setBsEnemyMsg(text){
  const msg=document.getElementById('bsEnemyMsg');
  if(msg) msg.textContent=text;
  fitBsBoard();
}
function clearBsCoords(){
  const bs=gameState.battleship;
  bs.pendingX=''; bs.pendingY='';
  const boxX=document.getElementById('bsBoxX'); if(boxX) boxX.value='';
  const boxY=document.getElementById('bsBoxY'); if(boxY) boxY.value='';
  updateBsActionEnabled();
}
function applyBsCell(prefix,x,y,result){
  const cell=document.getElementById(`${prefix}_${x}_${y}`);
  if(!cell) return;
  cell.classList.remove('water','ship');
  cell.classList.add(result==='miss'?'miss':'hit');
  cell.textContent=result==='miss'?'O':'X';
  cell.setAttribute('aria-label',`Petak (${bsXLabel(x)}, ${y}), ${result==='miss'?'tidak kena':'kena'}`);
}
// Placement is drag-driven: below this many pixels of travel a press is a tap
// (rotate), above it a drag (place/move). One code path serves finger and mouse.
const BS_DRAG_THRESHOLD=8;
function bsCellFromPoint(clientX,clientY){
  const el=document.elementFromPoint(clientX,clientY);
  const cell=el && el.closest && el.closest('.bs-cell');
  if(!cell || !cell.id.startsWith('bsp_')) return null;
  const parts=cell.id.split('_');
  return {x:Number(parts[1]),y:Number(parts[2])};
}
function bsDragOrigin(cell,grabIndex,orientation){
  return orientation==='h'?{x:cell.x-grabIndex,y:cell.y}:{x:cell.x,y:cell.y-grabIndex};
}
function clearBsPreview(){
  document.querySelectorAll('.bs-cell.preview-ok,.bs-cell.preview-bad').forEach(c=>c.classList.remove('preview-ok','preview-bad'));
}
function showBsPreview(cells,ok){
  clearBsPreview();
  cells.forEach(c=>{
    const el=document.getElementById(`bsp_${c.x}_${c.y}`);
    if(el) el.classList.add(ok?'preview-ok':'preview-bad');
  });
}
function bsMakeGhost(length,orientation){
  const ghost=document.createElement('div');
  ghost.className='bs-drag-ghost'+(orientation==='v'?' vertical':'');
  const cell=document.querySelector('.bs-board:not(.mini) .bs-cell');
  if(cell) ghost.style.setProperty('--bs-ghost-cell',cell.getBoundingClientRect().width+'px');
  for(let i=0;i<length;i++) ghost.appendChild(document.createElement('div'));
  document.body.appendChild(ghost);
  return ghost;
}
function bsMoveGhost(clientX,clientY){
  const drag=gameState.battleship.drag;
  if(!drag || !drag.ghost) return;
  const cellSize=parseFloat(getComputedStyle(drag.ghost).getPropertyValue('--bs-ghost-cell'))||22;
  const step=cellSize+BS_BOARD_GAP;
  const left=drag.orientation==='h'?clientX-(drag.grabIndex+0.5)*step:clientX-cellSize/2;
  const top=drag.orientation==='h'?clientY-cellSize/2:clientY-(drag.length-drag.grabIndex-0.5)*step;
  drag.ghost.style.left=left+'px';
  drag.ghost.style.top=top+'px';
}
function cancelBsDrag(){
  const bs=gameState && gameState.battleship;
  const drag=bs && bs.drag;
  window.removeEventListener('pointermove',bsPointerMove);
  window.removeEventListener('pointerup',bsPointerUp);
  window.removeEventListener('pointercancel',bsPointerUp);
  if(drag && drag.ghost) drag.ghost.remove();
  clearBsPreview();
  if(bs) bs.drag=null;
}
function bsPointerDown(event){
  const bs=gameState.battleship;
  if(!bs || bs.phase!=='placing' || bs.drag || event.isPrimary===false) return;
  if(event.pointerType==='mouse' && event.button!==0) return;
  const dockShip=event.target.closest && event.target.closest('.bs-dock-ship');
  const gridCell=event.target.closest && event.target.closest('.bs-cell[data-ship]');
  let name,orientation,grabIndex,fromGrid;
  if(dockShip){
    name=dockShip.dataset.ship;
    orientation='h';
    fromGrid=false;
    const cells=Array.from(dockShip.querySelectorAll('.bs-dock-cell'));
    grabIndex=Math.max(0,cells.indexOf(event.target.closest('.bs-dock-cell')));
  } else if(gridCell){
    name=gridCell.dataset.ship;
    const ship=bsShipByName(name);
    if(!ship) return;
    orientation=ship.cells.length>1 && ship.cells[1].x!==ship.cells[0].x?'h':'v';
    fromGrid=true;
    grabIndex=ship.cells.findIndex(c=>`bsp_${c.x}_${c.y}`===gridCell.id);
  } else return;
  const spec=BattleshipEngine.FLEET_SPEC.find(s=>s.name===name);
  bs.drag={name,length:spec.length,orientation,grabIndex,fromGrid,
    pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,ghost:null};
  window.addEventListener('pointermove',bsPointerMove);
  window.addEventListener('pointerup',bsPointerUp);
  window.addEventListener('pointercancel',bsPointerUp);
  event.preventDefault();
}
function bsPointerMove(event){
  const drag=gameState.battleship.drag;
  if(!drag || event.pointerId!==drag.pointerId) return;
  const travelled=Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY);
  if(!drag.ghost){
    if(travelled<BS_DRAG_THRESHOLD) return;
    drag.ghost=bsMakeGhost(drag.length,drag.orientation);
  }
  bsMoveGhost(event.clientX,event.clientY);
  const cell=bsCellFromPoint(event.clientX,event.clientY);
  if(!cell){ clearBsPreview(); return; }
  const origin=bsDragOrigin(cell,drag.grabIndex,drag.orientation);
  const cells=BattleshipEngine.shipCells(origin.x,origin.y,drag.length,drag.orientation);
  showBsPreview(cells,BattleshipEngine.canPlace(bsOccupiedCells(drag.name),origin.x,origin.y,drag.length,drag.orientation));
}
function bsPointerUp(event){
  const bs=gameState.battleship;
  const drag=bs && bs.drag;
  if(!drag || (event.pointerId!==undefined && event.pointerId!==drag.pointerId)) return;
  const dragged=!!drag.ghost;
  cancelBsDrag();
  if(event.type==='pointercancel') return;
  if(!dragged){
    if(drag.fromGrid && !rotateBsShip(drag.name)) setBsMsg('Tidak muat di situ. Cuba tempat lain.');
    return;
  }
  const cell=bsCellFromPoint(event.clientX,event.clientY);
  if(!cell){ setBsMsg('Tidak muat di situ. Cuba tempat lain.'); return; }
  const origin=bsDragOrigin(cell,drag.grabIndex,drag.orientation);
  if(placeBsShipAt(drag.name,origin.x,origin.y,drag.orientation)) setBsMsg(`${drag.name} diletakkan.`);
  else setBsMsg('Tidak muat di situ. Cuba tempat lain.');
}
function bsShipByName(name){
  return gameState.battleship.playerFleet.find(s=>s.name===name);
}
function bsOccupiedCells(exceptName){
  return gameState.battleship.playerFleet.filter(s=>s.name!==exceptName).reduce((all,s)=>all.concat(s.cells),[]);
}
// Places a ship, or moves one already on the grid. Returns false and leaves the
// fleet untouched when the target does not fit, so every caller — drop, rotate,
// move — can share one validation path.
function placeBsShipAt(name,x,y,orientation){
  const bs=gameState.battleship;
  if(!bs || bs.phase!=='placing') return false;
  const spec=BattleshipEngine.FLEET_SPEC.find(s=>s.name===name);
  if(!spec) return false;
  if(!BattleshipEngine.canPlace(bsOccupiedCells(name),x,y,spec.length,orientation)) return false;
  bs.playerFleet=bs.playerFleet.filter(s=>s.name!==name);
  bs.playerFleet.push({name:spec.name,length:spec.length,cells:BattleshipEngine.shipCells(x,y,spec.length,orientation)});
  renderBattleship();
  return true;
}
// A tap turns a ship 90° about its starting cell — the cell the student can see
// stays put, and the rest of the hull swings round it.
function rotateBsShip(name){
  const ship=bsShipByName(name);
  if(!ship) return false;
  const horizontal=ship.cells.length>1 && ship.cells[1].x!==ship.cells[0].x;
  return placeBsShipAt(name,ship.cells[0].x,ship.cells[0].y,horizontal?'v':'h');
}
function renderBsDock(){
  const placed=new Set(gameState.battleship.playerFleet.map(s=>s.name));
  return BattleshipEngine.FLEET_SPEC.map(spec=>{
    const cells=new Array(spec.length).fill('<div class="bs-dock-cell"></div>').join('');
    return `<div class="bs-dock-ship${placed.has(spec.name)?' placed':''}" data-ship="${escapeHtml(spec.name)}" data-length="${spec.length}">
      <div class="bs-dock-cells">${cells}</div>
      <div class="bs-dock-name">${escapeHtml(spec.name)} (${spec.length})</div>
    </div>`;
  }).join('');
}
function updateBsStartEnabled(){
  const btn=document.getElementById('bsStartBtn');
  if(btn) btn.disabled=gameState.battleship.playerFleet.length<BattleshipEngine.FLEET_SPEC.length;
}
function bsStartBattle(){
  const bs=gameState.battleship;
  if(!bs || bs.phase!=='placing' || bs.playerFleet.length<BattleshipEngine.FLEET_SPEC.length) return;
  cancelBsDrag();
  bs.phase='playing';
  bs.enemyFleet=BattleshipEngine.generateFleet();
  renderBattleship();
  setBsMsg('Armada sedia! Mula menembak.');
}
function resetBsPlacement(){
  const bs=gameState.battleship;
  if(!bs || bs.phase!=='placing') return;
  cancelBsDrag();
  bs.playerFleet=[];
  renderBattleship();
  setBsMsg('Susunan dikosongkan. Mula semula.');
}
function updateBsActionEnabled(){
  const bs=gameState.battleship;
  const btn=document.getElementById('bsActionBtn');
  const locked=!bs || bs.busy || window._gameOver;
  const boxX=document.getElementById('bsBoxX');
  const boxY=document.getElementById('bsBoxY');
  if(boxX) boxX.disabled=locked;
  if(boxY) boxY.disabled=locked;
  if(btn && bs) btn.disabled=locked || bs.pendingX==='' || bs.pendingY==='';
}
function bsCoordinateInput(field,input){
  const bs=gameState.battleship;
  if(!bs || window._gameOver || bs.busy || !input || (field!=='x' && field!=='y')) return;
  if(field==='x'){
    const letter=String(input.value||'').toUpperCase().replace(/[^A-I]/g,'').slice(0,1);
    input.value=letter;
    bs.pendingX=letter?String(letter.charCodeAt(0)-65):'';
  } else {
    let value=String(input.value||'').replace(/\D/g,'').slice(0,1);
    if(value!=='' && Number(value)>8) value='';
    input.value=value;
    bs.pendingY=value;
  }
  updateBsActionEnabled();
}
window.addEventListener('resize',fitBsBoard);
const BS_FLIGHT_MS=500, BS_IMPACT_MS=300;
function bsReducedMotion(){
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function bsSvg(tag,attrs){
  const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
  Object.keys(attrs||{}).forEach(k=>el.setAttribute(k,attrs[k]));
  return el;
}
// A little cannon-boat drawn at the firing edge, so the missile visibly
// launches from a ship rather than sliding in from nowhere.
function bsLauncherShape(){
  const g=bsSvg('g',{});
  g.appendChild(bsSvg('path',{d:'M-16 6 L16 6 L11 15 L-11 15 Z',fill:'#7a4a1d',stroke:'#4a2c10','stroke-width':'2'}));
  g.appendChild(bsSvg('rect',{x:'-2',y:'-12',width:'4',height:'18',fill:'#4a2c10'}));
  g.appendChild(bsSvg('path',{d:'M2 -11 L14 -3 L2 1 Z',fill:'#fff3c4',stroke:'#4a2c10','stroke-width':'1.5'}));
  return g;
}
function bsMissileShape(){
  const g=bsSvg('g',{});
  g.appendChild(bsSvg('path',{d:'M8 0 L-2 4 L-2 -4 Z',fill:'#ffcb42',stroke:'#8f342c','stroke-width':'1.5'}));
  g.appendChild(bsSvg('rect',{x:'-8',y:'-2.5',width:'8',height:'5',rx:'1.5',fill:'#c8493f'}));
  g.appendChild(bsSvg('path',{d:'M-8 -2.5 L-12 -6 L-11 -1 Z',fill:'#8f342c'}));
  g.appendChild(bsSvg('path',{d:'M-8 2.5 L-12 6 L-11 1 Z',fill:'#8f342c'}));
  return g;
}
async function bsAnimateShot(sourcePrefix,targetPrefix,x,y,result){
  if(bsReducedMotion()) return;
  const cell=document.getElementById(`${targetPrefix}_${x}_${y}`);
  const sourceBoard=document.getElementById(sourcePrefix==='bs'?'bsEnemyGridWrap':'bsPlayerBoardWrap');
  const arena=document.querySelector('.bs-battlefield');
  if(!cell || !sourceBoard || !arena) return;
  const arenaBox=arena.getBoundingClientRect();
  const sourceBox=sourceBoard.getBoundingClientRect();
  const cellBox=cell.getBoundingClientRect();
  const tx=cellBox.left-arenaBox.left+cellBox.width/2;
  const ty=cellBox.top-arenaBox.top+cellBox.height/2;
  const sx=sourceBox.left-arenaBox.left+sourceBox.width/2;
  const sy=ty<sourceBox.top-arenaBox.top
    ? sourceBox.top-arenaBox.top+6
    : sourceBox.bottom-arenaBox.top-6;

  const svg=bsSvg('svg',{class:'bs-fx','data-source':sourcePrefix,'data-target':targetPrefix});
  const launcher=bsLauncherShape();
  launcher.setAttribute('transform',`translate(${sx},${sy})`);
  const missile=bsMissileShape();
  svg.appendChild(launcher);
  svg.appendChild(missile);
  arena.appendChild(svg);

  try{
    // Arc across the gap between the two boards. The perpendicular bend sends
    // player shots around the right and computer shots around the left, while
    // both still finish at the exact receiving cell.
    const dx=tx-sx, dy=ty-sy;
    const distance=Math.max(1,Math.hypot(dx,dy));
    const bend=Math.max(42,Math.min(100,distance*.22));
    const nx=-dy/distance, ny=dx/distance;
    const at=t=>({
      x:sx+dx*t+nx*bend*4*t*(1-t),
      y:sy+dy*t+ny*bend*4*t*(1-t)
    });
    const steps=14, frames=[];
    for(let i=0;i<=steps;i++){
      const p=at(i/steps), n=at(Math.min(1,i/steps+0.02));
      const angle=Math.atan2(n.y-p.y,n.x-p.x)*180/Math.PI;
      frames.push({transform:`translate(${p.x}px,${p.y}px) rotate(${angle}deg)`});
    }
    await missile.animate(frames,{duration:BS_FLIGHT_MS,easing:'linear',fill:'forwards'}).finished;
    missile.remove();

    const impact=bsSvg('g',{transform:`translate(${tx},${ty})`});
    if(result==='miss'){
      [0,1,2].forEach(i=>impact.appendChild(bsSvg('circle',{r:'4',fill:'none',stroke:'#dff3ff','stroke-width':'2.5','data-i':i})));
      svg.appendChild(impact);
      await Promise.all(Array.from(impact.children).map((ring,i)=>ring.animate(
        [{transform:'scale(0.3)',opacity:0.9},{transform:`scale(${2.4+i*0.9})`,opacity:0}],
        {duration:BS_IMPACT_MS,delay:i*60,easing:'ease-out',fill:'forwards'}
      ).finished));
    } else {
      const burst=bsSvg('circle',{r:'6',fill:'#ffcb42',stroke:'#c8493f','stroke-width':'3'});
      impact.appendChild(burst);
      for(let i=0;i<8;i++){
        const a=i*Math.PI/4;
        impact.appendChild(bsSvg('line',{x1:Math.cos(a)*5,y1:Math.sin(a)*5,x2:Math.cos(a)*16,y2:Math.sin(a)*16,stroke:'#c8493f','stroke-width':'2.5','stroke-linecap':'round'}));
      }
      svg.appendChild(impact);
      await Promise.all(Array.from(impact.children).map(part=>part.animate(
        [{transform:'scale(0.4)',opacity:1},{transform:'scale(1.8)',opacity:0}],
        {duration:BS_IMPACT_MS,easing:'ease-out',fill:'forwards'}
      ).finished));
    }
  } catch(err) {
    // A cancelled animation (view torn down mid-flight) must never strand the
    // turn loop — bs.busy is released by fireBattleship's finally block.
  } finally {
    svg.remove();
  }
}
async function fireBattleship(){
  const bs=gameState.battleship;
  if(!bs || window._gameOver || bs.busy || bs.phase!=='playing') return;
  if(bs.pendingX==='' || bs.pendingY==='') return;
  const x=Number(bs.pendingX), y=Number(bs.pendingY);
  const shot=BattleshipEngine.fireAt(bs.enemyFleet,bs.playerShotLog,x,y);
  if(shot.result==='already-shot'){ playGameSfx('wrong'); setBsMsg('Sudah ditembak di sini.'); clearBsCoords(); return; }

  playGameSfx('bs-cannon');
  bs.busy=true;
  clearBsCoords();
  updateBsActionEnabled();
  try{
    await bsAnimateShot('bsp','bs',x,y,shot.result);
    if(window._gameOver) return;
    bs.playerShotLog=shot.shotLog;
    gameState.correct=BattleshipEngine.countSunk(bs.enemyFleet,bs.playerShotLog);
    applyBsCell('bs',x,y,shot.result);
    playGameSfx(shot.result==='sunk'?'bs-sunk':shot.result==='hit'?'bs-hit':'bs-miss');
    if(shot.result==='sunk'){
      setBsMsg(`Kapal ${shot.shipName} tenggelam!`);
      updateBsFleetList();
    } else setBsMsg(shot.result==='hit'?'Kena!':'Tidak kena.');

    if(BattleshipEngine.isFleetSunk(bs.enemyFleet,bs.playerShotLog)){ finishBattleship(!timeUp); return; }

    await bsComputerTurn();
  } finally {
    if(!window._gameOver){ bs.busy=false; updateBsActionEnabled(); }
  }
}
async function bsComputerTurn(){
  const bs=gameState.battleship;
  const pick=BattleshipEngine.nextComputerShot(bs.enemyShotLog);
  if(!pick) return;
  const res=BattleshipEngine.fireAt(bs.playerFleet,bs.enemyShotLog,pick.x,pick.y);
  playGameSfx('bs-enemy-cannon');
  await bsAnimateShot('bs','bsp',pick.x,pick.y,res.result);
  if(window._gameOver) return;
  bs.enemyShotLog=res.shotLog;
  applyBsCell('bsp',pick.x,pick.y,res.result);
  playGameSfx(res.result==='sunk'?'bs-enemy-sunk':res.result==='hit'?'bs-enemy-hit':'bs-enemy-miss');
  // The computer writes to its OWN line so the student's shot result stays readable.
  if(res.result==='sunk') setBsEnemyMsg(`Kapal anda ${res.shipName} musnah!`);
  else setBsEnemyMsg(res.result==='hit'?'Komputer kena kapal anda!':'Komputer tersasar.');
  if(BattleshipEngine.isFleetSunk(bs.playerFleet,bs.enemyShotLog)) bsResetRound();
}
function bsResetRound(){
  const bs=gameState.battleship;
  bs.round++;
  bs.enemyFleet=BattleshipEngine.generateFleet();
  bs.playerShotLog={};
  bs.enemyShotLog={};
  bs.busy=false;
  gameState.correct=0;
  renderBattleship();
  setBsMsg('Semua kapal anda musnah! Pusingan baharu bermula.');
}
function finishBattleship(onTime){
  if(window._gameOver) return;
  cancelBsDrag();
  window._gameOver=true;
  window._battleshipTimeout=null;
  clearInterval(timerInterval);
  const bs=gameState.battleship;
  const sunk=BattleshipEngine.countSunk(bs.enemyFleet,bs.playerShotLog);
  gameState.correct=sunk;
  const timeTakenSec=Math.round((Date.now()-window._startedAt)/1000);
  let score=Math.round((sunk/gameState.total)*100);
  if(!onTime) score=Math.max(0,score-20);
  if(window._testMode){ showTestResult(onTime,score,timeTakenSec); return; }
  submitCompletion(onTime,score,timeTakenSec);
}
