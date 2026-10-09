// Session lifecycle so the app is reusable across events: admin presses Mula to
// start, Tamat to end. status: 'setup' (not started) | 'active' | 'ended'.
let sessionInfo = {status:'setup'};
let cannonConfig = {
  enabled:false,
  damagePercent:CannonEngine.DEFAULT_DAMAGE,
  startingAmmo:CannonEngine.DEFAULT_STARTING_AMMO
};
let cannons = {};
const PARTICIPANT_VIEW_IDS = new Set(['view-login','view-preload','view-session','view-clue','view-game','view-result','view-chest']);

const DAILY_INTRO_KEY = 'game_station_intro_last_seen';
const DAILY_INTRO_INTERVAL_MS = 60*60*1000;
const DAILY_INTRO_PLAY_MS = 3000;
const DAILY_INTRO_FADE_MS = 1000;

function introWasShownRecently(now){
  const lastSeen=Number(localStorage.getItem(DAILY_INTRO_KEY));
  const current=now==null ? Date.now() : Number(now);
  return Number.isFinite(lastSeen) && lastSeen>0 && Number.isFinite(current) &&
    current>=lastSeen && current-lastSeen<DAILY_INTRO_INTERVAL_MS;
}

function playDailyIntro(){
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const intro = document.getElementById('dailyIntro');
  const video = document.getElementById('dailyIntroVideo');
  const now=Date.now();
  if(!intro || !video || introWasShownRecently(now)) return;

  intro.hidden = false;
  // Mark the time only when the intro is actually about to play, rather than
  // repeatedly showing it during navigation through the app.
  localStorage.setItem(DAILY_INTRO_KEY, String(now));
  video.currentTime = 0;
  video.play().catch(()=>startIntroFade());

  let faded = false;
  const startIntroFade = ()=>{
    if(faded) return;
    faded = true;
    video.pause();
    intro.classList.add('is-fading');
    window.setTimeout(()=>{
      intro.hidden = true;
      intro.classList.remove('is-fading');
    }, DAILY_INTRO_FADE_MS);
  };
  window.setTimeout(startIntroFade, DAILY_INTRO_PLAY_MS);
  video.addEventListener('error', startIntroFade, {once:true});
}

const MAP_STOPS = {
  0:{x:50,y:89}, 1:{x:57,y:78}, 2:{x:34,y:66}, 3:{x:59,y:55},
  4:{x:36,y:46}, 5:{x:62,y:36}, 6:{x:50,y:27}
};
// Ship moorings (MAP_STOPS) sit beside each island, so the click targets need
// their own centres, measured from the map art.
const MAP_ISLANDS = {
  1:{x:61.5,y:75}, 2:{x:29.5,y:62}, 3:{x:66,y:55},
  4:{x:33.5,y:43}, 5:{x:71,y:37},   6:{x:49.5,y:25}
};
// The map shows the student's own journey: Pulau 1 is always their first stop.
// Its physical station is determined by the group's rotation.
function stationIdAtPosition(position){
  const g=groups && groups[currentGroupId];
  const index=Number(position)-1;
  return g && Array.isArray(g.order) ? Number(g.order[index]) : null;
}
const SHIP_SPRITE = {frames:24, cols:6, rows:4, frameMs:82};
let journeyToken=0;
let journeyShipPosition=0;
let journeyMoving=false;

// Every group's progress, live for as long as the map is on screen. The map
// owns this listener; the cannon panel (only ever opened from the map) reads it.
let allProgress={};
let rivalProgressRef=null;
// false until the first snapshot for *this* attachment arrives. .on('value')
// fires asynchronously, so anything drawn before then comes from an older
// attachment and RivalShips.diff would read the difference as movement.
let rivalProgressReady=false;
// Last rendered gid -> island. Empty after every (re)attach, so ships appear in
// place instead of sailing in from wherever they were last seen.
let rivalPositions={};

function attachMapProgressListener(){
  if(isOffline() || rivalProgressRef) return;
  rivalProgressReady=false;
  rivalProgressRef=huntRef('progress');
  rivalProgressRef.on('value',snap=>{
    allProgress=snap.val()||{};
    rivalProgressReady=true;
    renderRivalShips();
    const panel=document.getElementById('cannonPanel');
    if(panel && !panel.hidden) renderCannonPanel();
  });
}
// Called on going offline as well as on leaving the map. A listener kept
// through an outage still holds the pre-outage snapshot; on reconnect that
// would be drawn first and the fresh snapshot read as movement. A brand-new
// listener has nothing cached to fire, so it waits for the server.
function detachMapProgressListener(){
  if(rivalProgressRef){ rivalProgressRef.off('value'); rivalProgressRef=null; }
  rivalProgressReady=false;
  rivalPositions={};
  rivalVoyageTokens={};
  rivalVoyageTargets={};
}
// Only a snapshot from the current, connected listener is trusted — for
// drawing rivals and for firing at them.
function mapProgressIsLive(){
  return rivalProgressReady && !isOffline();
}

function buildRivalShip(rival){
  const node=document.createElement('button');
  node.type='button';
  node.className='journey-rival';
  node.dataset.gid=rival.gid;
  node.innerHTML=`<span class="journey-rival-ship"></span>`;
  node.addEventListener('click',()=>openCannonPanel(rival.gid));
  return node;
}
// The plate lives in the #journeyRivalPlates overlay rather than inside the
// ship button so it can sit above the pupil's own ship (see the CSS comment on
// #journeyRivalPlates). Decorative: the button's aria-label says the same.
function buildRivalPlate(rival){
  const node=document.createElement('div');
  node.className='journey-rival-plate';
  node.dataset.gid=rival.gid;
  node.innerHTML=`<span class="journey-rival-name"></span>
    <span class="journey-rival-hp"><span class="journey-rival-hp-fill"></span></span>
    <span class="journey-rival-trophy" hidden>🏆</span>`;
  return node;
}
function placeRivalShip(node,point){
  node.style.left=point.x+'%';
  node.style.top=point.y+'%';
}
// Where (map %) each berth slot's plate sits relative to its ship. Lifts are
// staggered per slot so three plates on one island sit at three heights and
// cannot overlap each other. Lifting further would clear the pupil's own
// #journeyShipHp badge more easily, but lands a plate beside the NEXT island,
// reading as that group being further ahead than it is — so the low slot-1
// plate is nudged sideways off the badge instead. Tuned by eye;
// tests/rival-ships.spec.js checks the overlaps on every island.
const RIVAL_PLATE_LIFTS=[15,9,16];
const RIVAL_PLATE_NUDGES=[0,4,0];
function placeRivalPlate(node,point,slot){
  const known=RIVAL_PLATE_LIFTS[slot]!=null;
  node.style.left=(point.x+(known ? RIVAL_PLATE_NUDGES[slot] : 0))+'%';
  node.style.top=(point.y-(known ? RIVAL_PLATE_LIFTS[slot] : RIVAL_PLATE_LIFTS[0]))+'%';
}
function paintRivalShip(node,plateNode,rival){
  const hp=CannonEngine.readHp(allProgress[rival.gid]);
  // With cannons off for the hunt, HP never changes and a tap opens nothing,
  // so neither the bar nor a "tap to fire" affordance is offered. The same goes
  // for the tap once the pupil's own chest is open (cannonEnabled() is false).
  const battle=Boolean(cannonConfig && cannonConfig.enabled);
  const tappable=cannonEnabled();
  node.classList.toggle('is-won',rival.finished);
  node.disabled=!tappable;
  plateNode.querySelector('.journey-rival-name').textContent=rival.name;
  plateNode.querySelector('.journey-rival-hp').hidden=rival.finished || !battle;
  plateNode.querySelector('.journey-rival-trophy').hidden=!rival.finished;
  plateNode.querySelector('.journey-rival-hp-fill').style.width=hp+'%';
  let label;
  if(rival.finished) label=`${rival.name} sudah buka peti`;
  else if(!battle) label=rival.position>0 ? `${rival.name}, di Pulau ${rival.position}` : `${rival.name}, di garisan mula`;
  else label=`${rival.name}, HP ${hp} peratus.${tappable?' Buka panel meriam.':''}`;
  node.setAttribute('aria-label',label);
}

const RIVAL_VOYAGE_MS=2700;
// One token per group: a rival whose position changes again mid-voyage cancels
// the first voyage instead of leaving two loops fighting over one element.
let rivalVoyageTokens={};
// gid -> the point an in-flight voyage is heading for. A re-render must not
// snap a sailing ship to its berth; it only needs a new voyage if that
// destination point itself changed (a new island, or a reassigned berth).
let rivalVoyageTargets={};

function rivalWantsInstantMove(){
  return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
function setRivalShipDirection(node,from,to){
  const sprite=node.querySelector('.journey-rival-ship');
  if(!sprite || Math.abs(to.x-from.x)<.5) return;
  // The source sprite faces right; mirror it only while travelling left.
  sprite.classList.toggle('facing-left',to.x<from.x);
}
function setRivalShipFrame(node,frame){
  const sprite=node.querySelector('.journey-rival-ship');
  if(!sprite) return;
  const current=frame%SHIP_SPRITE.frames;
  const col=current%SHIP_SPRITE.cols;
  const row=Math.floor(current/SHIP_SPRITE.cols);
  sprite.style.backgroundPosition=`${col/(SHIP_SPRITE.cols-1)*100}% ${row/(SHIP_SPRITE.rows-1)*100}%`;
}
// Sail from where the ship is actually drawn, not from its old island's berth:
// berths are reassigned as rivals come and go, and a ship re-routed
// mid-voyage should carry on from wherever it got to.
function readRivalShipPoint(node){
  const x=parseFloat(node.style.left);
  const y=parseFloat(node.style.top);
  return Number.isFinite(x) && Number.isFinite(y) ? {x,y} : null;
}
function samePoint(a,b){
  return Math.abs(a.x-b.x)<.01 && Math.abs(a.y-b.y)<.01;
}
// Rival voyages are deliberately silent: only the pupil's own ship plays the
// sailing audio, or three ships moving at once would be a wall of noise.
function sailRivalShip(node,plateNode,rival,fromIsland){
  const from=readRivalShipPoint(node) || RivalShips.pointAt(fromIsland,rival.slot,MAP_STOPS);
  const to={x:rival.x,y:rival.y};
  const {gid,slot}=rival;
  const token=(rivalVoyageTokens[gid]||0)+1;
  rivalVoyageTokens[gid]=token;
  rivalVoyageTargets[gid]=to;
  setRivalShipDirection(node,from,to);
  animateShipAlong({
    from, to,
    duration:rivalWantsInstantMove() ? 0 : RIVAL_VOYAGE_MS,
    isCancelled:()=>rivalVoyageTokens[gid]!==token || !node.isConnected,
    // Ship and plate move together frame by frame, so the name keeps
    // pointing at its own ship mid-voyage.
    place:point=>{ placeRivalShip(node,point); placeRivalPlate(plateNode,point,slot); },
    setFrame:frame=>setRivalShipFrame(node,frame),
    onDone:()=>{ if(rivalVoyageTokens[gid]===token) delete rivalVoyageTargets[gid]; }
  });
}

// Elements are reused by group id rather than rebuilt, so a ship that is
// mid-voyage keeps sailing when an unrelated group's HP re-renders the map.
function renderRivalShips(){
  const holder=document.getElementById('journeyRivalShips');
  const plateHolder=document.getElementById('journeyRivalPlates');
  if(!holder || !plateHolder) return;
  // A missing module, a dead connection, or no confirmed-fresh snapshot yet
  // means no trustworthy positions. The pupil's own voyage is untouched — it
  // has never needed the network.
  if(typeof RivalShips==='undefined' || !mapProgressIsLive() || !groups || currentGroupId==null){
    holder.innerHTML='';
    plateHolder.innerHTML='';
    rivalPositions={};
    rivalVoyageTargets={};
    return;
  }
  const ranked=RivalShips.rank(allProgress,groups,currentStationCount());
  const placed=RivalShips.layout(RivalShips.selectNearest(ranked,currentGroupId),MAP_STOPS);
  const keep=new Set(placed.map(rival=>rival.gid));
  Array.from(holder.children).forEach(node=>{
    if(keep.has(node.dataset.gid)) return;
    delete rivalVoyageTargets[node.dataset.gid];
    node.remove();
  });
  Array.from(plateHolder.children).forEach(node=>{ if(!keep.has(node.dataset.gid)) node.remove(); });
  const moves=RivalShips.diff(rivalPositions,placed);
  placed.forEach(rival=>{
    let node=holder.querySelector(`.journey-rival[data-gid="${rival.gid}"]`);
    if(!node){ node=buildRivalShip(rival); holder.appendChild(node); }
    let plateNode=plateHolder.querySelector(`.journey-rival-plate[data-gid="${rival.gid}"]`);
    if(!plateNode){ plateNode=buildRivalPlate(rival); plateHolder.appendChild(plateNode); }
    paintRivalShip(node,plateNode,rival);
    const move=moves.find(entry=>entry.gid===rival.gid);
    const sailingTo=rivalVoyageTargets[rival.gid];
    if(move) sailRivalShip(node,plateNode,rival,move.from);
    // Mid-voyage: leave it sailing, unless its berth at the destination was
    // reassigned, in which case re-route it there from where it has got to.
    else if(sailingTo){ if(!samePoint(sailingTo,rival)) sailRivalShip(node,plateNode,rival,rival.position); }
    else { placeRivalShip(node,rival); placeRivalPlate(plateNode,rival,rival.slot); }
  });
  rivalPositions=RivalShips.positions(placed);
}

function setJourneyShipFrame(frame){
  const ship=document.getElementById('journeyShip');
  if(!ship) return;
  const current=frame%SHIP_SPRITE.frames;
  const col=current%SHIP_SPRITE.cols;
  const row=Math.floor(current/SHIP_SPRITE.cols);
  ship.style.backgroundPosition=`${col/(SHIP_SPRITE.cols-1)*100}% ${row/(SHIP_SPRITE.rows-1)*100}%`;
}
function placeJourneyShip(point){
  const ship=document.getElementById('journeyShip');
  const hp=document.getElementById('journeyShipHp');
  if(hp){
    hp.style.left=point.x+'%';
    hp.style.top=(point.y-4)+'%';
  }
  if(!ship) return;
  ship.style.left=point.x+'%';
  ship.style.top=point.y+'%';
}
function renderShipHp(){
  const wrap=document.getElementById('journeyShipHp');
  const fill=document.getElementById('journeyShipHpFill');
  const text=document.getElementById('journeyShipHpText');
  if(!wrap||!fill||!text) return;
  const hp=CannonEngine.readHp(progress);
  wrap.hidden=false;
  fill.style.width=hp+'%';
  text.textContent=hp+'%';
}
function flashShipHpHit(){
  const wrap=document.getElementById('journeyShipHp');
  if(!wrap) return;
  wrap.classList.remove('is-hit');
  void wrap.offsetWidth;            // restart the animation
  wrap.classList.add('is-hit');
}
function setJourneyShipDirection(from,to){
  const ship=document.getElementById('journeyShip');
  if(!ship || Math.abs(to.x-from.x)<.5) return;
  // The source sprite faces right; mirror it only while travelling left.
  ship.classList.toggle('facing-left',to.x<from.x);
}
function stopJourneyShipAudio(){
  const audio=document.getElementById('journeyShipAudio');
  if(!audio) return;
  audio.pause();
  try{ audio.currentTime=0; }catch(_){}
}
function playJourneyShipAudio(){
  const audio=document.getElementById('journeyShipAudio');
  if(!audio) return;
  stopJourneyShipAudio();
  audio.volume=.42;
  audio.play().catch(()=>{});
}
function unlockJourneyShipAudio(){
  const audio=document.getElementById('journeyShipAudio');
  if(!audio) return;
  audio.muted=true;
  audio.play().then(()=>{
    audio.pause();
    audio.currentTime=0;
    audio.muted=false;
  }).catch(()=>{ audio.muted=false; });
}
// "map idle pingpong.mp4" already contains forward + reversed frames, so a plain
// native loop gives the ping-pong effect without ever seeking backwards.
// (Reversing with currentTime stalled: the source clip is one long GOP, so every
// backward seek forced a decode from frame 0.)
function setupJourneyMapVideo(video){
  if(!video || video.dataset.pingPongBound) return;
  video.dataset.pingPongBound='1';
  video.loop=true;
  video.playbackRate=1;
  video.addEventListener('loadedmetadata',()=>{ video.loop=true; });
}
function playJourneyMapPingPong(){
  const video=document.getElementById('journeyMapVideo');
  if(!video) return;
  setupJourneyMapVideo(video);
  video.loop=true;
  video.playbackRate=1;
  // A newly activated service worker can fix the request after this element's
  // eager preload already failed. Reset the media state so opening the map
  // retries through the current worker instead of keeping the old error.
  if(video.error) video.load();
  if(video.paused) video.play().catch(()=>{});
}
function pauseJourneyMapPingPong(){
  const video=document.getElementById('journeyMapVideo');
  if(video) video.pause();
}
function hideJourneyMap(){
  journeyToken++;
  journeyMoving=false;
  detachMapProgressListener();
  // Kept through an outage (the offline panel still shows last-known HP), but
  // not across map visits, where it could be many minutes out of date.
  allProgress={};
  const rivalHolder=document.getElementById('journeyRivalShips');
  if(rivalHolder) rivalHolder.innerHTML='';
  const rivalPlateHolder=document.getElementById('journeyRivalPlates');
  if(rivalPlateHolder) rivalPlateHolder.innerHTML='';
  const map=document.getElementById('journeyMap');
  const popup=document.getElementById('journeyScorePopup');
  if(map) map.hidden=true;
  pauseJourneyMapPingPong();
  if(popup) popup.hidden=true;
  stopJourneyShipAudio();
  document.body.classList.remove('map-clue-mode');
  const shipHp=document.getElementById('journeyShipHp');
  if(shipHp) shipHp.hidden=true;
  closeCannonPanel();
  const fab=document.getElementById('cannonFab');
  if(fab) fab.hidden=true;
}
function renderJourneyIslandButtons(){
  const holder=document.getElementById('journeyIslandButtons');
  if(!holder || !groups || !groups[currentGroupId]) return;
  const currentIndex=Number(progress.currentIndex)||0;
  const completedStations=progress.completedStations||{};
  holder.innerHTML='';
  for(let position=1;position<=currentStationCount();position++){
    const point=MAP_ISLANDS[position];
    const stationId=stationIdAtPosition(position);
    const isComplete=Boolean(completedStations[stationId]);
    const isNext=position===currentIndex+1;
    const button=document.createElement('button');
    button.type='button';
    button.className='journey-island-button';
    button.style.left=point.x+'%';
    button.style.top=point.y+'%';
    button.disabled=!isComplete&&!isNext;
    button.setAttribute('aria-label',isNext ? `Pergi ke Pulau ${position}` : isComplete ? `Lihat markah Pulau ${position}` : `Pulau ${position} masih terkunci`);
    if(isNext) button.setAttribute('aria-current','step');
    if(isComplete||isNext) button.addEventListener('click',()=>selectJourneyIsland(position));
    holder.appendChild(button);
  }
}
function closeJourneyScorePopup(){
  const popup=document.getElementById('journeyScorePopup');
  const status=document.getElementById('journeyStatus');
  if(popup) popup.hidden=true;
  if(status) status.textContent='Pilih pulau seterusnya atau pulau yang sudah selesai.';
}
function stopClueScanner(){
  const reader=document.getElementById('reader');
  if(reader) reader.style.display='none';
  if(!html5QrCode) return;
  const scanner=html5QrCode;
  html5QrCode=null;
  try{ scanner.stop().catch(()=>{}); }catch(_){}
}
function closeClueToMap(){
  const map=document.getElementById('journeyMap');
  const clue=document.getElementById('view-clue');
  const status=document.getElementById('journeyStatus');
  stopClueScanner();
  if(clue) clue.classList.remove('active');
  if(map) map.hidden=false;
  playJourneyMapPingPong();
  document.body.classList.remove('map-clue-mode');
  if(status) status.textContent='Pilih pulau seterusnya atau pulau yang sudah selesai.';
  renderJourneyIslandButtons();
}
function showJourneyScore(position){
  const popup=document.getElementById('journeyScorePopup');
  const title=document.getElementById('journeyScoreTitle');
  const text=document.getElementById('journeyScoreText');
  const status=document.getElementById('journeyStatus');
  const stationId=stationIdAtPosition(position);
  const score=(progress.completedStations||{})[stationId]?.score;
  if(!popup || score==null) return;
  if(title) title.textContent=`Pulau ${position} sudah selesai`;
  if(text) text.textContent=`Markah diperoleh: ${score}`;
  if(status) status.textContent=`Pulau ${position} sudah selesai.`;
  popup.hidden=false;
}
function showJourneyMap(){
  const map=document.getElementById('journeyMap');
  const status=document.getElementById('journeyStatus');
  const g=groups && groups[currentGroupId];
  if(!map || !g) return;
  const currentIndex=Number(progress.currentIndex)||0;
  journeyShipPosition=currentIndex;
  const shipPoint=MAP_STOPS[journeyShipPosition]||MAP_STOPS[0];
  journeyMoving=false;
  map.hidden=false;
  closeJourneyScorePopup();
  placeJourneyShip(shipPoint);
  setJourneyShipFrame(0);
  renderShipHp();
  if(status) status.textContent='Pilih pulau seterusnya atau pulau yang sudah selesai.';
  renderJourneyIslandButtons();
  playJourneyMapPingPong();
  attachMapProgressListener();
  renderRivalShips();
  syncCannonFab();
}
