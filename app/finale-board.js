// ---------- GROUP FINALE (phone): run to the Smart Board ----------
// The chest is NOT opened on the phone. The phone tells the group to run to the
// Smart Board; once their chest is opened there, it shows their final marks.
function showGoToBoard(){
  show('view-chest');
  document.getElementById('timer').style.display='none';
  const card = document.getElementById('chestCard');
  if(chestProgressRef) chestProgressRef.off('value');
  chestProgressRef = huntRef('progress/'+currentGroupId);
  chestProgressRef.on('value', snap=>{
    const p = snap.val()||{};
    // Take only what this screen needs, never the whole snapshot. The global
    // may legitimately be *ahead* of the server — a queued offline station
    // completion lives there first — and overwriting it would regress the
    // journey, which watchPendingHit would then persist to the local cache.
    // Status and hp are the two fields this screen genuinely depends on:
    // maybeShowHitPrompt() gates on CannonEngine.isInBattle(progress), the
    // global rather than this local snapshot, so without the status the flip
    // to 'won' would never reach it and a held hit would play its video over
    // the celebration instead of being silently discarded.
    // Guarded: an empty snapshot would otherwise write undefined into both,
    // which reads back as "in battle, full health" and silently un-wins them.
    if(p.status!=null) progress = {...progress, status:p.status};
    if(p.hp!=null) progress = {...progress, hp:p.hp};
    if(p.status==='won'){
      card.innerHTML = `
        <div style="font-size:70px;">🎉📦✨</div>
        <h2 style="color:var(--green);">Peti Kumpulan ${currentGroupId} Dibuka!</h2>
        <p style="font-size:15px;">Markah stesen ${p.totalScore||0} + bonus buka awal <b>${p.finishBonus||0}</b> (kumpulan ke-${p.finishOrder||'-'} habis)</p>
        <p style="font-size:22px;">Markah akhir: <b style="color:var(--gold);font-size:30px;">${p.finalScore!=null?p.finalScore:(p.totalScore||0)}</b></p>
        <p style="color:#888;">Lihat ranking penuh di Smart Board! 🏆</p>`;
    } else {
      card.innerHTML = `
        <h2>🎉 Semua ${currentStationCount()} Kunci Dikumpul!</h2>
        <div class="keyrow">${'<div class="key">🔑</div>'.repeat(currentStationCount())}</div>
        <div style="font-size:64px;margin:14px 0;">🏃💨📦</div>
        <h2 style="color:var(--gold);margin:0;">Lari ke SMART BOARD!</h2>
        <p style="font-size:16px;">Pergi ke <b>tempat mula</b> dan tekan <b>peti Kumpulan ${currentGroupId}</b> di skrin besar untuk membuka peti &amp; mengira markah akhir anda.</p>`;
    }
    maybeShowHitPrompt();
  });
}

// ---------- SMART BOARD (big screen): all groups' chests + live ranking ----------
function showSmartBoard(){
  show('view-board');
  document.body.classList.add('board-mode');
  document.getElementById('topTitle').innerText='🏴‍☠️ Peti Harta Karun';
  document.getElementById('timer').style.display='none';
  huntRef().off('value');           // avoid stacking listeners on re-entry
  huntRef().on('value', snap=>{
    const data = snap.val()||{};
    const grps = (data.config && data.config.groups) || groups || {};
    renderSmartBoard(grps, data.progress||{});
  });
}
// Leave the board: detach the live listener and return to admin (or login). The
// board is fully live — re-opening it re-subscribes and shows current progress.
function leaveSmartBoard(){
  huntRef().off('value');
  document.body.classList.remove('board-mode');
  let role=null; try{ role=(JSON.parse(localStorage.getItem('gs_session'))||{}).role; }catch(e){}
  if(role==='admin'){ show('view-admin'); document.getElementById('topTitle').innerText='⚙️ Admin Panel'; }
  else { show('view-login'); document.getElementById('topTitle').innerText='🎯 Game Station'; }
}
// The 6 keyholes (2 rows x 3), as % of the chest sprite frame. Index 0..5 =
// key-collection order (top row left->right, then bottom row) so key N lights
// the first N keyholes.
const KEYHOLES = [[25.1,47.0],[49.9,46.9],[74.7,46.9],[25.1,67.9],[49.9,67.9],[74.8,67.9]];
const CHEST_ANIM = { N:40, COLS:8, ROWS:5, DUR:1700 };
const animatingGids = new Set();
function chestVis(litCount, opened, total){
  const n = StationLayout.clampStationCount(total==null ? 6 : total);
  const holes = KEYHOLES.slice(0,n).map((k,i)=>
    `<span class="kh${(i<litCount)?' lit':''}" style="left:${k[0]}%;top:${k[1]}%"></span>`).join('');
  return `<div class="chest-vis${opened?' opened':''}">${holes}</div>`;
}
function renderSmartBoard(grps, prog){
  const N=currentStationCount();
  const ids = Object.keys(grps).length ? Object.keys(grps) : Array.from({length:NUM_GROUPS},(_,i)=>String(i+1));
  const opened = ids.map(gid=>({gid, p:prog[gid]||{}}))
    .filter(x=>x.p.status==='won')
    .sort((a,b)=>(b.p.finalScore||0)-(a.p.finalScore||0));
  const rankOf={}; opened.forEach((x,i)=>rankOf[x.gid]=i+1);
  const medal=['🥇','🥈','🥉'];
  const rankHtml = opened.length
    ? opened.map((x,i)=>`<div class="rank-row"><span class="rank-pos">${medal[i]||('#'+(i+1))}</span><span class="rank-name">Kumpulan ${x.gid}</span><span class="rank-score">${x.p.finalScore}</span></div>`).join('')
    : '<p style="text-align:center;color:#ffffffaa;padding:14px;">Belum ada kumpulan buka peti…</p>';
  const chestsHtml = ids.map(gid=>{
    const p = prog[gid]||{currentIndex:0,keys:[],status:'idle'};
    const keys=Math.min((p.keys||[]).length, N);
    const hp=CannonEngine.readHp(p);
    const hpHtml=hp<CannonEngine.MAX_HP
      ? `<div class="c-hp"><span class="c-hp-fill" style="width:${hp}%"></span></div><div class="c-hp-text">HP ${hp}%</div>`
      : '';
    const id=`chest-card-${gid}`;
    if(p.status==='won'){
      return `<div class="chest-card won" id="${id}">${chestVis(0,true,N)}<div class="c-grp">Kumpulan ${gid}</div><div class="c-score">${p.finalScore} mkh</div>${hpHtml}<div class="c-sub">#${rankOf[gid]} · buka ke-${p.finishOrder}</div></div>`;
    }
    if(StationLayout.isJourneyDone(p.currentIndex||0, N)){
      return `<div class="chest-card ready" id="${id}" onclick="openChestOnBoard('${gid}')">${chestVis(N,false,N)}<div class="c-grp">Kumpulan ${gid}</div>${hpHtml}<div class="c-sub" style="color:var(--gold);font-weight:800;">SEDIA! Tekan</div></div>`;
    }
    return `<div class="chest-card locked" id="${id}" onclick="openChestOnBoard('${gid}')">${chestVis(keys,false,N)}<div class="c-grp">Kumpulan ${gid}</div>${hpHtml}<div class="c-sub">${keys}/${N} kunci · ${CannonEngine.effectiveScore(p.totalScore||0,p.hp)} mkh</div></div>`;
  }).join('');
  document.getElementById('boardWrap').innerHTML = `
    <div class="board-head">
      <button class="board-back" onclick="leaveSmartBoard()">← Kembali</button>
      <h1>🏴‍☠️ Peti Harta Karun</h1>
      <p>Kumpulan yang sudah kumpul <b>${N} kunci</b> — tekan peti kumpulan anda untuk buka!</p>
    </div>
    <div class="board-cols">
      <div class="chest-grid">${chestsHtml}</div>
      <div class="rank-panel"><h2>🏆 Ranking</h2>${rankHtml}</div>
    </div>`;
}
// Play the opening animation on a floating overlay above the tapped card, plus
// the chest sound. Runs independently of the grid so live DB re-renders under
// it don't interrupt. Calls done(removeOverlay) on the final (open) frame.
function playChestOpen(cardEl, done){
  const vis = cardEl && cardEl.querySelector('.chest-vis');
  if(!vis){ done && done(()=>{}); return; }
  const r = vis.getBoundingClientRect();
  const ov = document.createElement('div');
  ov.className = 'chest-vis chest-anim';
  ov.style.left=r.left+'px'; ov.style.top=r.top+'px';
  ov.style.width=r.width+'px'; ov.style.height=r.height+'px';
  ov.style.margin='0'; ov.style.maxWidth='none';
  document.body.appendChild(ov);
  try{
    const au=new Audio('assets/chest/chest_open.mp3?v=2');
    au.volume=1;
    const playFromOpening=()=>{
      au.currentTime=Math.min(5,Number.isFinite(au.duration)?au.duration:5);
      au.play().catch(()=>{});
    };
    if(au.readyState>=1) playFromOpening();
    else au.addEventListener('loadedmetadata',playFromOpening,{once:true});
  }catch(_){}
  const {N,COLS,ROWS,DUR}=CHEST_ANIM, t0=performance.now();
  (function step(t){
    const f=Math.min(N-1, Math.floor((t-t0)/DUR*N));
    ov.style.backgroundPosition=`${(f%COLS)/(COLS-1)*100}% ${Math.floor(f/COLS)/(ROWS-1)*100}%`;
    if(f<N-1) requestAnimationFrame(step);
    else done && done(()=>ov.remove());
  })(performance.now());
}
function showChestWinCelebration(gid,finalScore,done){
  const celebration=document.createElement('div');
  celebration.className='chest-win-celebration';
  celebration.innerHTML=`<div class="chest-win-card"><p class="win-kicker">Peti Harta Dibuka!</p><h1>Kumpulan ${gid}</h1><p class="win-score">${finalScore} Markah</p></div>`;
  document.body.appendChild(celebration);
  window.setTimeout(()=>{
    celebration.remove();
    done && done();
  },5000);
}
function openChestOnBoard(gid){
  if(animatingGids.has(gid)) return;
  huntRef('progress/'+gid).once('value').then(snap=>{
    const p = snap.val()||{};
    if(p.status==='won') return; // already opened
    if(!StationLayout.isJourneyDone(p.currentIndex||0, currentStationCount())){
      flashBoardMsg(`🔒 Kumpulan ${gid} belum cukup kunci (${(p.keys||[]).length}/${currentStationCount()}) — belum boleh buka!`);
      return;
    }
    animatingGids.add(gid);
    const card = document.getElementById('chest-card-'+gid);
    playChestOpen(card, (removeOverlay)=>{
      huntRef('progress').once('value').then(all=>{
        const prog = all.val()||{};
        const order = Object.values(prog).filter(x=>x&&x.status==='won').length + 1;
        const bonus = CHEST_BONUS[Math.min(order-1, CHEST_BONUS.length-1)];
        const finalScore = CannonEngine.finalScore(p.totalScore||0, p.hp, bonus);
        huntRef('progress/'+gid).update({status:'won', finishOrder:order, finishBonus:bonus, finalScore, openedAt:Date.now()})
          .then(()=>{
            showChestWinCelebration(gid,finalScore,()=>{
              removeOverlay();
              animatingGids.delete(gid);
            });
          })
          .catch(()=>{ removeOverlay(); animatingGids.delete(gid); });
        flashBoardMsg(`🎉 Kumpulan ${gid} buka peti! +${bonus} bonus (buka ke-${order}) · Markah akhir ${finalScore}`);
      }).catch(()=>{ removeOverlay(); animatingGids.delete(gid); });
    });
  });
}
function flashBoardMsg(msg){
  let t = document.getElementById('boardToast');
  if(!t){ t=document.createElement('div'); t.id='boardToast'; t.className='board-toast'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity='1';
  clearTimeout(window._boardToastT); window._boardToastT = setTimeout(()=>{ t.style.opacity='0'; }, 3800);
}

window.onload=()=>{
  document.addEventListener('pointerdown', unlockJourneyShipAudio, {once:true, passive:true});
  playDailyIntro();
  if('serviceWorker' in navigator && location.protocol!=='file:'){
    navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).catch(()=>{});
  }
  connectFirebase();
};
