const GAME_TYPES = [
  {id:'lembaran_kerja', name:'Lembaran Kerja'},
  {id:'sudoku', name:'Sudoku Challenge (1–3 Stage)'},
  {id:'crossword', name:'Crossword Puzzle'},
  {id:'battleship', name:'Battleship Koordinat'},
  {id:'sifir', name:'Sifir Challenge'},
  {id:'tangram', name:'Tangram Challenge'},
  {id:'jejak_lari', name:'Jejak Lari GPS'}
];
const NUM_GROUPS = 14;
const ADMIN_PIN = 'admin123';
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBSWbXoKgQt1E8xvJa9zaKyw3e9V_EMxAE",
  authDomain: "sk-sri-aman-database.firebaseapp.com",
  databaseURL: "https://sk-sri-aman-database-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sk-sri-aman-database",
  storageBucket: "sk-sri-aman-database.firebasestorage.app",
  messagingSenderId: "810640165554",
  appId: "1:810640165554:web:b3ad2dc6f1583ec2a657ab"
};
const ROOT_PATH = 'gamestation2026';
let currentHuntId = null;
let activeHuntId = null;
let hunts = {};
let currentHuntCreatedAt = null;
let isHuntDraft = false;
let db, stations, groups, currentGroupId, progress={}, timerInterval, timeLeftSec, timeUp=false, gameState={}, html5QrCode;
let activeHuntWatcherRef=null, watchedSessionRef=null, watchedSessionPath=null, watchedDashboardRef=null;
function huntPath(sub=''){
  // The empty-context fallback preserves direct test-station usage. Normal app
  // flows always set currentHuntId from the list or activeHuntId first.
  const base=currentHuntId ? `${ROOT_PATH}/hunts/${currentHuntId}` : ROOT_PATH;
  return sub ? `${base}/${sub}` : base;
}
function huntRef(sub=''){ return db.ref(huntPath(sub)); }
function rootRef(sub=''){ return db.ref(sub ? `${ROOT_PATH}/${sub}` : ROOT_PATH); }
let groupDraft = [];
let sifirQInterval = null;
let stationCount = 3;
const GAME_SFX_MUTED_KEY='gamestation_sfx_muted';
let gameAudioContext=null;
let gameSfxMuted=(()=>{ try{return localStorage.getItem(GAME_SFX_MUTED_KEY)==='1';}catch(_){return false;} })();
function updateSoundToggle(){
  const button=document.getElementById('soundToggle');
  if(!button) return;
  button.textContent=gameSfxMuted?'🔇':'🔊';
  button.setAttribute('aria-pressed',String(gameSfxMuted));
  button.setAttribute('aria-label',gameSfxMuted?'Hidupkan bunyi':'Matikan bunyi');
  button.title=gameSfxMuted?'Hidupkan bunyi':'Matikan bunyi';
}
function toggleGameSfx(){
  gameSfxMuted=!gameSfxMuted;
  try{ localStorage.setItem(GAME_SFX_MUTED_KEY,gameSfxMuted?'1':'0'); }catch(_){}
  updateSoundToggle();
  if(!gameSfxMuted) playGameSfx('correct');
}
function getGameAudioContext(){
  if(gameSfxMuted) return null;
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass) return null;
  if(!gameAudioContext) gameAudioContext=new AudioContextClass();
  if(gameAudioContext.state==='suspended') gameAudioContext.resume().catch(()=>{});
  return gameAudioContext;
}
function scheduleGameTone(context,start,frequency,duration,options={}){
  const oscillator=context.createOscillator();
  const gain=context.createGain();
  oscillator.type=options.type||'sine';
  oscillator.frequency.setValueAtTime(frequency,start);
  if(options.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1,options.endFrequency),start+duration);
  const volume=options.volume==null ? .1 : options.volume;
  gain.gain.setValueAtTime(.0001,start);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0001,volume),start+.012);
  gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start+duration+.02);
}
function scheduleGameNoise(context,start,duration,volume=.12,filterFrequency=900){
  const frames=Math.max(1,Math.floor(context.sampleRate*duration));
  const buffer=context.createBuffer(1,frames,context.sampleRate);
  const channel=buffer.getChannelData(0);
  for(let i=0;i<frames;i++) channel[i]=(Math.random()*2-1)*(1-i/frames);
  const source=context.createBufferSource();
  const filter=context.createBiquadFilter();
  const gain=context.createGain();
  source.buffer=buffer;
  filter.type='lowpass';
  filter.frequency.setValueAtTime(filterFrequency,start);
  gain.gain.setValueAtTime(volume,start);
  gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start(start);
  source.stop(start+duration+.02);
}
function playGameSfx(name){
  const context=getGameAudioContext();
  if(!context) return;
  const now=context.currentTime+.01;
  try{
    if(name==='correct'){
      scheduleGameTone(context,now,523,.12,{volume:.08});
      scheduleGameTone(context,now+.09,659,.13,{volume:.085});
      scheduleGameTone(context,now+.18,784,.18,{volume:.09});
    }else if(name==='wrong'){
      scheduleGameTone(context,now,230,.18,{type:'sawtooth',endFrequency:170,volume:.065});
      scheduleGameTone(context,now+.13,155,.2,{type:'sawtooth',endFrequency:115,volume:.055});
    }else if(name==='bs-cannon' || name==='bs-enemy-cannon'){
      scheduleGameNoise(context,now,.2,name==='bs-cannon' ? .16 : .11,520);
      scheduleGameTone(context,now,105,.24,{type:'triangle',endFrequency:48,volume:name==='bs-cannon' ? .13 : .09});
    }else if(name==='bs-hit' || name==='bs-enemy-hit'){
      scheduleGameNoise(context,now,.18,name==='bs-hit' ? .14 : .1,1250);
      scheduleGameTone(context,now,190,.2,{type:'square',endFrequency:95,volume:.075});
    }else if(name==='bs-miss' || name==='bs-enemy-miss'){
      scheduleGameNoise(context,now,.28,.09,2400);
      scheduleGameTone(context,now,680,.3,{endFrequency:260,volume:.045});
    }else if(name==='bs-sunk' || name==='bs-enemy-sunk'){
      scheduleGameNoise(context,now,.32,.15,700);
      scheduleGameTone(context,now,185,.22,{type:'sawtooth',endFrequency:125,volume:.075});
      scheduleGameTone(context,now+.15,125,.3,{type:'sawtooth',endFrequency:62,volume:.07});
    }
  }catch(_){}
}
updateSoundToggle();
window.addEventListener('pointerdown',()=>{ getGameAudioContext(); },{once:true,capture:true});
