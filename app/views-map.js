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
const DAILY_INTRO_PLAY_MS = 3000;
const DAILY_INTRO_FADE_MS = 1000;

function localDayStamp(){
  const now = new Date();
  const month = String(now.getMonth()+1).padStart(2,'0');
  const day = String(now.getDate()).padStart(2,'0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function playDailyIntro(){
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const intro = document.getElementById('dailyIntro');
  const video = document.getElementById('dailyIntroVideo');
  const today = localDayStamp();
  if(!intro || !video || localStorage.getItem(DAILY_INTRO_KEY)===today) return;

  intro.hidden = false;
  // Mark the day only when the intro is actually about to play, rather than
  // repeatedly showing it during navigation through the app.
  localStorage.setItem(DAILY_INTRO_KEY, today);
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
  syncCannonFab();
}
