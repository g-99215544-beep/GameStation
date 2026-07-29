// ---------- FIREBASE SETUP (auto-connect, hardcoded) ----------
function connectFirebase(){
  try{
    if(!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.database();
    initApp();
  }catch(e){
    // Direct demos need no Firebase, so still launch them on connection error.
    const demoType=directGameDemoType();
    if(demoType){ startDirectGameDemo(demoType); return; }
    document.body.innerHTML = '<div class="wrap"><div class="card"><h2>❌ Ralat Sambungan Firebase</h2><p>'+e.message+'</p></div></div>';
  }
}

