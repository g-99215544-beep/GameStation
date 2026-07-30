// ---------- ADMIN: STATION CONFIG ----------
function isValidStationPassword(password){
  return /^[A-Za-z0-9]{5}$/.test(String(password||'').trim());
}
function generateStationPassword(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let password='';
  for(let i=0;i<5;i++) password += chars[Math.floor(Math.random()*chars.length)];
  return password;
}
const WORKSHEET_IMAGE_MAX_INPUT_BYTES=12*1024*1024;
const WORKSHEET_IMAGE_MAX_BYTES=450*1024;
const WORKSHEET_IMAGE_MAX_DIMENSION=1600;
const WORKSHEET_DATA_MAX_CHARS=7800000;
function safeWorksheetImage(value){
  const image=String(value||'').trim();
  return /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image) ? image : '';
}
function worksheetQuestionsFromRaw(raw){
  let data={}; try{ data=JSON.parse(raw||'{}'); }catch(e){}
  const questions=Array.isArray(data.questions) ? data.questions : [];
  const clean=questions
    .filter(q=>q && Object.prototype.hasOwnProperty.call(q,'answer'))
    .map(q=>({answer:String(q.answer==null?'':q.answer).trim(),image:safeWorksheetImage(q.image)}));
  return clean.length ? clean : [{answer:'',image:''}];
}
function escapeHtml(value){
  return String(value==null?'':value).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function getWorksheetQuestionsFromEditor(key){
  const rows=document.querySelectorAll(`#worksheet_editor_${key} .worksheet-question-row`);
  const questions=Array.from(rows).map(row=>({
    answer:(row.querySelector('.worksheet-answer')?.value||'').trim(),
    image:safeWorksheetImage(row.querySelector('.worksheet-image-data')?.value)
  }));
  return questions.length ? questions : [{answer:'',image:''}];
}
function setWorksheetImageValue(key,index,image,status){
  const row=document.querySelector(`#worksheet_editor_${key} .worksheet-question-row[data-question-index="${index}"]`);
  if(!row) return;
  const safe=safeWorksheetImage(image);
  const data=row.querySelector('.worksheet-image-data');
  const wrap=row.querySelector('.worksheet-image-preview-wrap');
  const preview=row.querySelector('.worksheet-image-preview');
  const clear=row.querySelector('.worksheet-image-clear');
  const message=row.querySelector('.worksheet-image-status');
  if(data) data.value=safe;
  if(preview){
    if(safe) preview.src=safe;
    else preview.removeAttribute('src');
  }
  if(wrap) wrap.hidden=!safe;
  if(clear) clear.hidden=!safe;
  if(message) message.textContent=status || (safe?'Gambar sedia untuk dipaparkan kepada murid.':'Tiada gambar — soalan ini akan menggunakan lembaran bercetak.');
}
function setWorksheetImageStatus(key,index,status){
  const message=document.querySelector(`#worksheet_editor_${key} .worksheet-question-row[data-question-index="${index}"] .worksheet-image-status`);
  if(message) message.textContent=status;
}
function worksheetCanvasDataUrl(canvas,quality){
  return canvas.toDataURL('image/jpeg',quality);
}
function worksheetDataUrlBytes(dataUrl){
  const base64=String(dataUrl||'').split(',')[1]||'';
  return Math.ceil(base64.length*3/4);
}
function loadWorksheetImage(file){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(file);
    const image=new Image();
    image.onload=()=>{ URL.revokeObjectURL(url); resolve(image); };
    image.onerror=()=>{ URL.revokeObjectURL(url); reject(new Error('Fail gambar tidak dapat dibaca.')); };
    image.src=url;
  });
}
async function prepareWorksheetImage(file){
  if(!file || !['image/png','image/jpeg','image/webp'].includes(String(file.type||'').toLowerCase())) throw new Error('Pilih fail gambar PNG, JPG atau WebP.');
  if(file.size>WORKSHEET_IMAGE_MAX_INPUT_BYTES) throw new Error('Gambar terlalu besar. Pilih fail di bawah 12 MB.');
  const image=await loadWorksheetImage(file);
  if(!image.naturalWidth || !image.naturalHeight) throw new Error('Saiz gambar tidak sah.');
  let scale=Math.min(1,WORKSHEET_IMAGE_MAX_DIMENSION/Math.max(image.naturalWidth,image.naturalHeight));
  let lastDataUrl='';
  for(let sizeAttempt=0;sizeAttempt<4;sizeAttempt++){
    const width=Math.max(1,Math.round(image.naturalWidth*scale));
    const height=Math.max(1,Math.round(image.naturalHeight*scale));
    const canvas=document.createElement('canvas');
    canvas.width=width; canvas.height=height;
    const context=canvas.getContext('2d');
    context.fillStyle='#fff';
    context.fillRect(0,0,width,height);
    context.drawImage(image,0,0,width,height);
    for(const quality of [0.9,0.82,0.74,0.66,0.58]){
      lastDataUrl=worksheetCanvasDataUrl(canvas,quality);
      if(worksheetDataUrlBytes(lastDataUrl)<=WORKSHEET_IMAGE_MAX_BYTES) return lastDataUrl;
    }
    scale*=0.78;
  }
  if(lastDataUrl && worksheetDataUrlBytes(lastDataUrl)<=WORKSHEET_IMAGE_MAX_BYTES) return lastDataUrl;
  throw new Error('Gambar masih terlalu besar selepas dikecilkan. Cuba crop gambar dahulu.');
}
async function setWorksheetImageFromFile(key,index,file){
  if(!file) return;
  const row=document.querySelector(`#worksheet_editor_${key} .worksheet-question-row[data-question-index="${index}"]`);
  if(!row) return;
  const previous=safeWorksheetImage(row.querySelector('.worksheet-image-data')?.value);
  const job=`${Date.now()}-${Math.random()}`;
  row.dataset.imageJob=job;
  setWorksheetImageStatus(key,index,'Memproses gambar…');
  try{
    const image=await prepareWorksheetImage(file);
    const current=document.querySelector(`#worksheet_editor_${key} .worksheet-question-row[data-question-index="${index}"]`);
    if(!current || current.dataset.imageJob!==job) return;
    setWorksheetImageValue(key,index,image,'Gambar sedia untuk dipaparkan kepada murid.');
  }catch(error){
    const current=document.querySelector(`#worksheet_editor_${key} .worksheet-question-row[data-question-index="${index}"]`);
    if(!current || current.dataset.imageJob!==job) return;
    setWorksheetImageValue(key,index,previous,error.message||'Gambar tidak dapat diproses.');
  }
}
function pasteWorksheetImage(event,key,index){
  const items=Array.from((event.clipboardData&&event.clipboardData.items)||[]);
  const item=items.find(candidate=>candidate.kind==='file' && String(candidate.type||'').startsWith('image/'));
  const file=item&&item.getAsFile();
  event.preventDefault();
  if(!file){
    setWorksheetImageStatus(key,index,'Clipboard tidak mengandungi gambar PNG, JPG atau WebP.');
    return;
  }
  setWorksheetImageFromFile(key,index,file);
}
function clearWorksheetImage(key,index){
  const row=document.querySelector(`#worksheet_editor_${key} .worksheet-question-row[data-question-index="${index}"]`);
  if(row) delete row.dataset.imageJob;
  setWorksheetImageValue(key,index,'','Gambar dibuang. Soalan ini akan menggunakan lembaran bercetak.');
}
function renderWorksheetEditor(key,questions){
  const editor=document.getElementById('worksheet_editor_'+key);
  if(!editor) return;
  const normalized=questions.map(question=>({
    answer:String(question&&question.answer||''),
    image:safeWorksheetImage(question&&question.image)
  }));
  const rows=normalized.map((question,index)=>`<div class="worksheet-question-row" data-question-index="${index}" onpaste="pasteWorksheetImage(event,'${key}',${index})">
    <label>Soalan ${index+1} — jawapan betul</label>
    <div class="worksheet-answer-line"><input class="worksheet-answer" value="${escapeHtml(question.answer)}" placeholder="Contoh: 23440 atau sabun" autocomplete="off">${normalized.length>1?`<button type="button" class="worksheet-remove" onclick="removeWorksheetQuestion('${key}',${index})" aria-label="Buang Soalan ${index+1}">Buang</button>`:''}</div>
    <div class="worksheet-image-editor">
      <div class="worksheet-image-preview-wrap" hidden><img class="worksheet-image-preview" alt="Preview Gambar Soalan ${index+1}"></div>
      <div class="worksheet-image-tools">
        <label class="worksheet-image-pick">📎 Pilih gambar<input class="worksheet-image-input" type="file" accept="image/png,image/jpeg,image/webp" hidden onchange="setWorksheetImageFromFile('${key}',${index},this.files[0]);this.value=''"></label>
        <div class="worksheet-image-paste" role="button" tabindex="0" contenteditable="true" spellcheck="false" aria-label="Paste gambar Soalan ${index+1}">📋 Klik, kemudian Ctrl+V</div>
        <button type="button" class="worksheet-image-clear" hidden onclick="clearWorksheetImage('${key}',${index})">Buang gambar</button>
      </div>
      <input class="worksheet-image-data" type="hidden">
      <small class="worksheet-image-status" role="status"></small>
    </div>
  </div>`).join('');
  editor.innerHTML=`<p class="worksheet-help">Masukkan jawapan betul dan, jika mahu, attach atau paste gambar bagi setiap soalan. Gambar akan dipaparkan terus kepada murid di stesen.</p>${rows}<button type="button" class="secondary worksheet-add" onclick="addWorksheetQuestion('${key}')">+ Tambah Soalan</button>`;
  normalized.forEach((question,index)=>setWorksheetImageValue(key,index,question.image));
}
function addWorksheetQuestion(key){
  const questions=getWorksheetQuestionsFromEditor(key);
  questions.push({answer:'',image:''});
  renderWorksheetEditor(key,questions);
}
function removeWorksheetQuestion(key,index){
  const questions=getWorksheetQuestionsFromEditor(key);
  questions.splice(index,1);
  renderWorksheetEditor(key,questions.length?questions:[{answer:'',image:''}]);
}
function toggleWorksheetEditor(key){
  const select=document.getElementById('st_gametype_'+key);
  if(!select) return;
  const gameType=select.value;
  const isWorksheet=gameType==='lembaran_kerja';
  const isRun=gameType==='jejak_lari';
  const isSudoku=gameType==='sudoku';
  const isSifir=gameType==='sifir';
  const isTangram=gameType==='tangram';
  const editor=document.getElementById('worksheet_editor_'+key);
  const runEditor=document.getElementById('run_editor_'+key);
  const sudokuEditor=document.getElementById('sudoku_stage_editor_'+key);
  const sifirEditor=document.getElementById('sifir_target_editor_'+key);
  const tangramEditor=document.getElementById('tangram_stage_editor_'+key);
  const rawField=document.getElementById('game_data_field_'+key);
  if(editor) editor.style.display=isWorksheet?'block':'none';
  if(runEditor) runEditor.style.display=isRun?'block':'none';
  if(sudokuEditor) sudokuEditor.style.display=isSudoku?'block':'none';
  if(sifirEditor) sifirEditor.style.display=isSifir?'block':'none';
  if(tangramEditor) tangramEditor.style.display=isTangram?'block':'none';
  if(rawField) rawField.style.display='none';
}
function parseStationGameData(raw){
  try{
    const data=JSON.parse(raw||'{}');
    return data && typeof data==='object' && !Array.isArray(data) ? data : {};
  }catch(_){ return {}; }
}
function sudokuStagesFromRaw(raw){
  const data=parseStationGameData(raw);
  // Existing stations predate this setting, so they retain the original
  // three-stage experience until an admin saves a different selection.
  if(!Array.isArray(data.sudokuStages)) return [1,2,3];
  return [...new Set(data.sudokuStages.map(Number).filter(stage=>Number.isInteger(stage) && stage>=1 && stage<=3))].sort((a,b)=>a-b);
}
function sudokuStageEditorHtml(key,raw){
  const selected=new Set(sudokuStagesFromRaw(raw));
  return `<div class="sudoku-stage-editor" id="sudoku_stage_editor_${key}">
    <label>Stage Sudoku Aktif</label>
    <p>Tandakan stage yang murid perlu siapkan. Pilih sekurang-kurangnya satu stage.</p>
    <div class="sudoku-stage-options">${[1,2,3].map(stage=>`<label class="sudoku-stage-option"><input type="checkbox" value="${stage}"${selected.has(stage)?' checked':''}> Stage ${stage}</label>`).join('')}</div>
  </div>`;
}
function selectedSudokuStages(key){
  const editor=document.getElementById('sudoku_stage_editor_'+key);
  if(!editor) return [1,2,3];
  return Array.from(editor.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input=>Number(input.value)).filter(stage=>Number.isInteger(stage) && stage>=1 && stage<=3).sort((a,b)=>a-b);
}
function sifirTargetFromRaw(raw){
  const target=Number(parseStationGameData(raw).sifirTarget);
  return Number.isInteger(target) && target>=1 && target<=SifirEngine.SIFIR_TARGET ? target : SifirEngine.SIFIR_TARGET;
}
function sifirTargetEditorHtml(key,raw){
  const target=sifirTargetFromRaw(raw);
  return `<div class="sifir-target-editor" id="sifir_target_editor_${key}">
    <label>Bilangan Jawapan Betul Berturut-turut</label>
    <p>Pilih streak jawapan betul yang murid perlu capai (1 hingga ${SifirEngine.SIFIR_TARGET}). Jawapan salah akan mula semula dari Soalan 1.</p>
    <input id="st_sifir_target_${key}" type="number" min="1" max="${SifirEngine.SIFIR_TARGET}" step="1" value="${target}" inputmode="numeric">
  </div>`;
}
function selectedSifirTarget(key){
  const value=Number(document.getElementById('st_sifir_target_'+key)?.value);
  return Number.isInteger(value) && value>=1 && value<=SifirEngine.SIFIR_TARGET ? value : SifirEngine.SIFIR_TARGET;
}
function tangramStagesFromRaw(raw){
  const data=parseStationGameData(raw);
  if(!Array.isArray(data.tangramStages)) return [1,2,3];
  return [...new Set(data.tangramStages.map(Number).filter(stage=>Number.isInteger(stage) && stage>=1 && stage<=3))].sort((a,b)=>a-b);
}
function tangramStageEditorHtml(key,raw){
  const selected=new Set(tangramStagesFromRaw(raw));
  return `<div class="tangram-stage-editor" id="tangram_stage_editor_${key}">
    <label>Stage Tangram Aktif</label>
    <p>Tandakan bentuk yang murid perlu siapkan. Pilih sekurang-kurangnya satu stage.</p>
    <div class="tangram-stage-options">${[1,2,3].map(stage=>`<label class="tangram-stage-option"><input type="checkbox" value="${stage}"${selected.has(stage)?' checked':''}> Stage ${stage}</label>`).join('')}</div>
  </div>`;
}
function selectedTangramStages(key){
  const editor=document.getElementById('tangram_stage_editor_'+key);
  if(!editor) return [1,2,3];
  return Array.from(editor.querySelectorAll('input[type="checkbox"]:checked'))
    .map(input=>Number(input.value)).filter(stage=>Number.isInteger(stage) && stage>=1 && stage<=3).sort((a,b)=>a-b);
}
function updateStationButtons(){
  const label=document.getElementById('stationCountLabel');
  if(label) label.textContent=String(stationCount);
  const locked=!!(sessionInfo && sessionInfo.status==='active');
  const add=document.getElementById('btnAddStation');
  const rem=document.getElementById('btnRemoveStation');
  if(add) add.disabled=locked || stationCount>=StationLayout.MAX_STATIONS;
  if(rem) rem.disabled=locked || stationCount<=StationLayout.MIN_STATIONS;
}
function addStation(){
  if(sessionInfo && sessionInfo.status==='active' || stationCount>=StationLayout.MAX_STATIONS) return;
  const current=collectStations();
  stationCount=StationLayout.clampStationCount(stationCount+1);
  markSetupStepDirty('setup');
  buildStationsUI(current);
}
function removeStation(){
  if(sessionInfo && sessionInfo.status==='active' || stationCount<=StationLayout.MIN_STATIONS) return;
  const current=collectStations();
  delete current[stationCount];
  stationCount=StationLayout.clampStationCount(stationCount-1);
  markSetupStepDirty('setup');
  buildStationsUI(current);
}
function syncStationSetupLock(){
  const panel=document.getElementById('admin-panel-setup');
  const lock=document.getElementById('stationSetupLock');
  const locked=!!(sessionInfo && sessionInfo.status==='active');
  if(lock) lock.innerHTML=locked
    ? '<div class="msg">🔒 Sesi sedang aktif — bilangan stesen dikunci. Tekan Tamat sebelum mengubah.</div>' : '';
  updateStationButtons();
  if(panel) panel.querySelectorAll('.station-block input, .station-block select, .station-block button, .cannon-block input, .cannon-block select, .cannon-block button, #cannonEnabled, #cannonDamage, #cannonStartingAmmo').forEach(el=>{ el.disabled=locked; });
  updateCannonButtons();
}
function buildStationsUI(existing){
  const area = document.getElementById('stationsArea');
  area.innerHTML='';
  for(let i=1;i<=stationCount;i++){
    const s = existing[i] || {};
    const stationPassword = isValidStationPassword(s.password) ? s.password : generateStationPassword();
    const opts = GAME_TYPES.map(g=>`<option value="${g.id}" ${s.gameType===g.id?'selected':''}>${g.name}</option>`).join('');
    area.innerHTML += `
    <div class="station-block">
      <h3>Stesen ${i}</h3>
      <label>Nama Stesen</label><input id="st_name_${i}" value="${s.name||''}" placeholder="cth: Stesen Sifir">
      <label>Lokasi (teks clue)</label><input id="st_loc_${i}" value="${s.location||''}" placeholder="cth: Tempat membaca buku">
      <label>Password Stesen (tepat 5 huruf atau digit)</label><input id="st_pass_${i}" value="${stationPassword}" maxlength="5" pattern="[A-Za-z0-9]{5}" placeholder="cth: 14542 atau sabun" oninput="this.value=this.value.replace(/[^A-Za-z0-9]/g,'').slice(0,5)">
      <label>Jenis Game</label><select id="st_gametype_${i}" onchange="toggleWorksheetEditor('${i}')">${opts}</select>
      <div id="game_data_field_${i}"><label>Data Game (JSON)</label><input id="st_gamedata_${i}" value='${(s.gameDataRaw||"{}").replace(/'/g,"&apos;")}'></div>
      <div class="worksheet-editor" id="worksheet_editor_${i}"></div>
      ${sudokuStageEditorHtml(i,s.gameDataRaw)}
      ${sifirTargetEditorHtml(i,s.gameDataRaw)}
      ${tangramStageEditorHtml(i,s.gameDataRaw)}
      <div class="run-editor" id="run_editor_${i}">
        <label>Jarak Sasaran (km)</label>
        <input id="st_targetkm_${i}" type="number" min="0.1" step="0.1" value="${RunTracker.parseTargetKm(s.gameDataRaw)}">
      </div>
      <button class="secondary" onclick="testStation(${i})">▶️ Uji Cara Main Stesen Ini</button>
    </div>`;
    renderWorksheetEditor(i,worksheetQuestionsFromRaw(s.gameDataRaw));
    toggleWorksheetEditor(i);
  }
  syncStationSetupLock();
}
function toggleCannonSetup(){
  const on=!!document.getElementById('cannonEnabled')?.checked;
  const body=document.getElementById('cannonBody');
  if(body) body.hidden=!on;
  markSetupStepDirty('setup');
  updateCannonButtons();
}
function updateCannonButtons(){
  const locked=!!(sessionInfo && sessionInfo.status==='active');
  const add=document.getElementById('btnAddCannon');
  if(add) add.disabled=locked || document.querySelectorAll('.cannon-block').length>=CannonEngine.MAX_CANNONS;
}
function buildCannonsUI(existing){
  const area=document.getElementById('cannonsArea');
  if(!area) return;
  area.innerHTML='';
  Object.keys(existing||{}).slice(0,CannonEngine.MAX_CANNONS).forEach(cid=>{
    area.insertAdjacentHTML('beforeend', cannonBlockHtml(cid, existing[cid]||{}));
    renderWorksheetEditor(cid, worksheetQuestionsFromRaw(existing[cid]&&existing[cid].gameDataRaw));
    toggleWorksheetEditor(cid);
  });
  updateCannonButtons();
}
function cannonBlockHtml(cid, cannon){
  const password=isValidStationPassword(cannon.password)?cannon.password:generateStationPassword();
  const opts=GAME_TYPES.map(g=>`<option value="${g.id}" ${cannon.gameType===g.id?'selected':''}>${g.name}</option>`).join('');
  return `
    <div class="cannon-block" data-cannon-id="${cid}">
      <h4>Meriam ${cid.replace('c','')}</h4>
      <label>Nama Meriam</label><input id="cn_name_${cid}" value="${escapeHtml(cannon.name||'')}" placeholder="cth: Meriam Kubu Batu">
      <label>Password Meriam (tepat 5 huruf atau digit)</label>
      <input id="cn_pass_${cid}" value="${password}" maxlength="5" pattern="[A-Za-z0-9]{5}" oninput="this.value=this.value.replace(/[^A-Za-z0-9]/g,'').slice(0,5)">
      <label>Jenis Soalan</label><select id="st_gametype_${cid}" onchange="toggleWorksheetEditor('${cid}')">${opts}</select>
      <div id="game_data_field_${cid}"><label>Data Game (JSON)</label><input id="st_gamedata_${cid}" value='${String(cannon.gameDataRaw||"{}").replace(/'/g,"&apos;")}'></div>
      <div class="worksheet-editor" id="worksheet_editor_${cid}"></div>
      ${sudokuStageEditorHtml(cid,cannon.gameDataRaw)}
      ${sifirTargetEditorHtml(cid,cannon.gameDataRaw)}
      ${tangramStageEditorHtml(cid,cannon.gameDataRaw)}
      <div class="run-editor" id="run_editor_${cid}">
        <label>Jarak Sasaran (km)</label>
        <input id="st_targetkm_${cid}" type="number" min="0.1" step="0.1" value="${RunTracker.parseTargetKm(cannon.gameDataRaw)}">
      </div>
      <div class="feature-actions">
        <button type="button" class="secondary" onclick="testCannon('${cid}')">▶️ Uji Soalan Meriam Ini</button>
        <button type="button" onclick="removeCannon('${cid}')">🗑 Buang</button>
      </div>
    </div>`;
}
function addCannon(){
  if(sessionInfo && sessionInfo.status==='active') return;
  const current=collectCannons();
  const ids=Object.keys(current);
  if(ids.length>=CannonEngine.MAX_CANNONS) return;
  let next=1;
  while(current['c'+next]) next++;
  current['c'+next]={id:'c'+next,name:'',password:generateStationPassword(),gameType:GAME_TYPES[0].id,gameDataRaw:'{}'};
  markSetupStepDirty('setup');
  buildCannonsUI(current);
}
function removeCannon(cid){
  if(sessionInfo && sessionInfo.status==='active') return;
  const current=collectCannons();
  delete current[cid];
  markSetupStepDirty('setup');
  buildCannonsUI(current);
}
function collectCannonConfig(){
  return {
    enabled:!!document.getElementById('cannonEnabled')?.checked,
    damagePercent:CannonEngine.clampDamage(document.getElementById('cannonDamage')?.value),
    startingAmmo:CannonEngine.clampStartingAmmo(document.getElementById('cannonStartingAmmo')?.value)
  };
}
function collectCannons(){
  const out={};
  document.querySelectorAll('.cannon-block').forEach(block=>{
    const cid=block.dataset.cannonId;
    const gameType=document.getElementById('st_gametype_'+cid).value;
    out[cid]={
      id:cid,
      name:document.getElementById('cn_name_'+cid).value,
      password:document.getElementById('cn_pass_'+cid).value.trim(),
      gameType,
      gameDataRaw:stationGameDataRaw(cid, gameType)
    };
  });
  return out;
}
function validateCannons(stationConfig, cannonConfigValue, cannonList){
  if(!cannonConfigValue.enabled) return true;
  const ids=Object.keys(cannonList);
  if(!ids.length){
    alert('Meriam diaktifkan tetapi belum ada tugasan meriam. Tambah sekurang-kurangnya satu meriam atau matikan meriam.');
    return false;
  }
  const badPassword=ids.filter(cid=>!isValidStationPassword(cannonList[cid].password));
  if(badPassword.length){
    alert(`Password Meriam ${badPassword.join(', ')} mesti tepat 5 huruf atau digit.`);
    return false;
  }
  const conflicts=CannonEngine.passwordConflicts(stationConfig, cannonList);
  if(conflicts.length){
    alert(`Password bertindih: ${conflicts.map(c=>`${c.a} dan ${c.b} kedua-duanya guna ${c.password}`).join('; ')}. Tukar salah satu.`);
    return false;
  }
  const worksheets=ids.filter(cid=>cannonList[cid].gameType==='lembaran_kerja'
    && worksheetQuestionsFromRaw(cannonList[cid].gameDataRaw).some(q=>!q.answer));
  if(worksheets.length){
    alert(`Isi jawapan betul bagi semua soalan Lembaran Kerja di Meriam ${worksheets.join(', ')}.`);
    return false;
  }
  if(!validateSudokuStages(cannonList,'Meriam')) return false;
  if(!validateTangramStages(cannonList,'Meriam')) return false;
  // Without this, pushConfig's Promise.all commits stations, groups and
  // progress while the database rules reject the oversized config/cannons.
  // The teacher sees a raw Firebase error, the hunt looks saved, and the
  // cannons are silently missing — with retrying failing identically.
  const tooLarge=ids.filter(cid=>String(cannonList[cid].gameDataRaw||'').length>WORKSHEET_DATA_MAX_CHARS);
  if(tooLarge.length){
    alert(`Jumlah gambar terlalu besar di Meriam ${tooLarge.join(', ')}. Buang beberapa gambar atau gunakan gambar yang telah dicrop.`);
    return false;
  }
  return true;
}
function testCannon(cid){
  const gameType=document.getElementById('st_gametype_'+cid).value;
  const st={
    id:cid,
    name:document.getElementById('cn_name_'+cid).value || ('Meriam '+cid.replace('c','')),
    location:'',
    password:document.getElementById('cn_pass_'+cid).value,
    timeLimitMin:10,
    gameType,
    gameDataRaw:stationGameDataRaw(cid, gameType)
  };
  if(!isValidStationPassword(st.password)){
    alert('Password meriam mesti tepat 5 huruf atau digit sebelum diuji.');
    return;
  }
  window._testMode=true;
  startGame(st.id, st);
}
function stationGameDataRaw(i, gameType){
  if(gameType==='lembaran_kerja') return JSON.stringify({questions:getWorksheetQuestionsFromEditor(i)});
  if(gameType==='jejak_lari'){
    const km=Number(document.getElementById('st_targetkm_'+i).value);
    return JSON.stringify({targetKm:(isFinite(km)&&km>0)?km:3});
  }
  if(gameType==='sudoku'){
    const raw=document.getElementById('st_gamedata_'+i)?.value;
    return JSON.stringify({...parseStationGameData(raw),sudokuStages:selectedSudokuStages(i)});
  }
  if(gameType==='sifir'){
    const raw=document.getElementById('st_gamedata_'+i)?.value;
    return JSON.stringify({...parseStationGameData(raw),sifirTarget:selectedSifirTarget(i)});
  }
  if(gameType==='tangram'){
    const raw=document.getElementById('st_gamedata_'+i)?.value;
    return JSON.stringify({...parseStationGameData(raw),tangramStages:selectedTangramStages(i)});
  }
  return document.getElementById('st_gamedata_'+i).value;
}
function collectStations(){
  const out={};
  for(let i=1;i<=stationCount;i++){
    const gameType=document.getElementById('st_gametype_'+i).value;
    out[i]={id:i,
      name:document.getElementById('st_name_'+i).value,
      location:document.getElementById('st_loc_'+i).value,
      password:document.getElementById('st_pass_'+i).value.trim(),
      timeLimitMin:10,
      gameType,
      gameDataRaw:stationGameDataRaw(i, gameType)};
  }
  return out;
}
function validateStationPasswords(stationConfig){
  const invalid = Object.values(stationConfig).filter(st=>!isValidStationPassword(st.password));
  if(!invalid.length) return true;
  const numbers = invalid.map(st=>st.id).join(', ');
  alert(`Password Stesen ${numbers} mesti tepat 5 huruf atau digit. Contoh: 14542, sabun, atau 34gbs.`);
  return false;
}
function validateWorksheetStations(stationConfig){
  const worksheets=Object.values(stationConfig).filter(st=>st.gameType==='lembaran_kerja');
  const invalid=worksheets.filter(st=>{
    if(st.gameType!=='lembaran_kerja') return false;
    return worksheetQuestionsFromRaw(st.gameDataRaw).some(q=>!q.answer);
  });
  if(invalid.length){
    alert(`Isi jawapan betul bagi semua soalan Lembaran Kerja di Stesen ${invalid.map(st=>st.id).join(', ')}.`);
    return false;
  }
  const tooLarge=worksheets.filter(st=>String(st.gameDataRaw||'').length>WORKSHEET_DATA_MAX_CHARS);
  if(tooLarge.length){
    alert(`Jumlah gambar terlalu besar di Stesen ${tooLarge.map(st=>st.id).join(', ')}. Buang beberapa gambar atau gunakan gambar yang telah dicrop.`);
    return false;
  }
  return true;
}
function validateSudokuStages(stationConfig,label='Stesen'){
  const invalid=Object.values(stationConfig).filter(st=>st.gameType==='sudoku' && sudokuStagesFromRaw(st.gameDataRaw).length===0);
  if(!invalid.length) return true;
  alert(`Pilih sekurang-kurangnya satu stage Sudoku untuk ${label} ${invalid.map(st=>st.id).join(', ')}.`);
  return false;
}
function validateTangramStages(stationConfig,label='Stesen'){
  const invalid=Object.values(stationConfig).filter(st=>st.gameType==='tangram' && tangramStagesFromRaw(st.gameDataRaw).length===0);
  if(!invalid.length) return true;
  alert(`Pilih sekurang-kurangnya satu stage Tangram untuk ${label} ${invalid.map(st=>st.id).join(', ')}.`);
  return false;
}
function rotationFor(startStation, count){
  return StationLayout.rotationOrder(startStation, count == null ? currentStationCount() : count);
}
function isValidStationId(value, count){
  const N=count == null ? currentStationCount() : count;
  const id=Number(value);
  return Number.isInteger(id) && id>=1 && id<=N;
}
function startStationForGroup(group, fallback, count){
  return isValidStationId(group?.startStation, count) ? Number(group.startStation) : fallback;
}
const LOGIN_PASSWORD_LENGTH = 4;
function numericLoginPassword(value){
  const text=String(value||'').trim();
  if(new RegExp(`^\\d{${LOGIN_PASSWORD_LENGTH}}$`).test(text)) return text;
  // Migrates old values such as K10-5905 to their four-digit password part.
  const legacy=text.match(new RegExp(`(\\d{${LOGIN_PASSWORD_LENGTH}})$`));
  return legacy ? legacy[1] : '';
}
function generateLoginPassword(usedPasswords=new Set()){
  let password='';
  do { password=String(Math.floor(1000+Math.random()*9000)); }
  while(usedPasswords.has(password));
  usedPasswords.add(password);
  return password;
}
function collectGroups(count){
  const N=StationLayout.clampStationCount(count);
  const out={};
  const usedPasswords=new Set();
  for(let i=1;i<=NUM_GROUPS;i++){
    const defaultStart=StationLayout.defaultStartStation(i, N);
    const startStation=startStationForGroup(groups && groups[i],defaultStart,N);
    // Preserve valid numeric passwords; legacy K1-1234 values are migrated to
    // 1234, and any duplicate/invalid value gets a new unique four-digit code.
    const existingPass=numericLoginPassword(groups && groups[i] && groups[i].loginPassword);
    const loginPassword=existingPass && !usedPasswords.has(existingPass)
      ? (usedPasswords.add(existingPass),existingPass)
      : generateLoginPassword(usedPasswords);
    out[i]={id:i, name:'Kumpulan '+i, startStation, order:StationLayout.rotationOrder(startStation, N), loginPassword, members:[]};
  }
  return out;
}
function reindexGroupsForCount(existingGroups, count){
  const N=StationLayout.clampStationCount(count);
  const out={};
  Object.keys(existingGroups||{}).sort((a,b)=>Number(a)-Number(b)).forEach(gid=>{
    const g=existingGroups[gid]; const id=Number(gid);
    let start=StationLayout.defaultStartStation(id, N);
    const current=Number(g && g.startStation);
    if(Number.isInteger(current) && current>=1 && current<=N) start=current;
    out[gid]={...g, startStation:start, order:StationLayout.rotationOrder(start, N)};
  });
  return out;
}
function pushConfig(){
  const st = collectStations();
  const cn = collectCannonConfig();
  const cnList = cn.enabled ? collectCannons() : {};
  if(!validateStationPasswords(st) || !validateWorksheetStations(st) || !validateSudokuStages(st) || !validateTangramStages(st)) return;
  if(!validateCannons(st, cn, cnList)) return;
  const name=String(document.getElementById('huntName')?.value||'').trim();
  if((isHuntDraft || currentHuntId) && !name){
    document.getElementById('pushStatus').innerHTML='<div class="msg err">Masukkan nama Treasure Hunt terlebih dahulu.</div>';
    selectAdminTopTab('setup'); selectAdminTab('groups');
    return;
  }
  if(sessionInfo && sessionInfo.status==='active'){
    document.getElementById('pushStatus').innerHTML='<div class="msg err">Tidak boleh simpan semasa sesi aktif. Tekan Tamat dahulu.</div>';
    return;
  }
  const N=StationLayout.clampStationCount(Object.keys(st).length);
  // Preserve an existing roster (managed in the Kumpulan tab); only seed a
  // default set on a brand-new database.
  const hasGroups = groups && Object.keys(groups).length>0;
  const baseGroups=hasGroups ? groups : collectGroups(N);
  const gr=reindexGroupsForCount(baseGroups, N);
  const prog={};
  Object.keys(gr).forEach(gid=>{ prog[gid]=freshGroupProgress(cn); });
  if(isHuntDraft && !currentHuntId) currentHuntId=rootRef('hunts').push().key;
  const now=Date.now();
  const createdAt=currentHuntCreatedAt||now;
  const metadata=currentHuntId ? huntRef().update({name,createdAt,updatedAt:now,
    setupState:{groupsSavedAt:now,stationsSavedAt:now}}) : Promise.resolve();
  Promise.all([
    metadata,
    huntRef('config/stations').set(st),
    huntRef('config/groups').set(gr),
    huntRef('config/cannon').set(cn),
    huntRef('config/cannons').set(cnList),
    huntRef('session').set({status:'setup'}),
    huntRef('progress').set(prog)
  ]).then(()=>{
    currentHuntCreatedAt=createdAt;
    isHuntDraft=false;
    stations=st; groups=gr; cannonConfig=cn; cannons=cnList; stationCount=N; sessionInfo={status:'setup'};
    cacheConfig();
    renderGroupLoginOptions();
    markSetupStepSaved('setup');
    document.getElementById('pushStatus').innerHTML='<div class="msg ok">✅ Config di-push. Stesen dan meriam berjaya disimpan. Teruskan ke Langkah 3.</div>';
  }).catch(error=>{
    document.getElementById('pushStatus').innerHTML='<div class="msg err">Gagal menyimpan Treasure Hunt: '+escapeHtml(error.message)+'</div>';
  });
}
function showLoginPasswords(message=''){
  const area = document.getElementById('loginPassArea');
  if(!area) return;
  if(!groups || !Object.keys(groups).length){
    area.innerHTML='<div class="empty-state">Password belum dijana. Kembali ke Setup Stesen dan tekan <b>Simpan Setup &amp; Jana Password</b>.</div>';
    return;
  }
  const needsMigration=Object.values(groups).some(g=>String(g.loginPassword||'')!==numericLoginPassword(g.loginPassword));
  const startStationLocked=(sessionInfo||{}).status==='active';
  let html = `<div class="password-actions"><button onclick="regenerateAllLoginPasswords()">Jana Semula Semua Password</button><button onclick="printLoginPasswords()">Cetak Password Kumpulan</button></div>
    ${needsMigration?'<p class="password-note">Password lama akan ditukar kepada 4 digit nombor apabila anda menekan Simpan Password.</p>':''}
    <p class="password-note" id="startStationLockedNote"${startStationLocked?'':' hidden'}>Sesi sedang aktif. Stesen mula dikunci; gunakan Sesi Baru sebelum mengubahnya.</p>
    ${message?`<div class="msg ok">${message}</div>`:''}
    <h4>Password &amp; Stesen Mula Kumpulan</h4><table><tr><th>Kumpulan</th><th>Password 4 Digit</th><th>Mula di Stesen</th></tr>`;
  Object.keys(groups).sort((a,b)=>Number(a)-Number(b)).forEach(gid=>{
    const g=groups[gid]; const password=numericLoginPassword(g.loginPassword);
    const startStation=startStationForGroup(g,StationLayout.defaultStartStation(Number(gid), currentStationCount()));
    const options=Array.from({length:currentStationCount()},(_,index)=>index+1).map(stationId=>`<option value="${stationId}"${stationId===startStation?' selected':''}>Stesen ${stationId}</option>`).join('');
    html += `<tr><td>${g.name}</td><td><div class="password-edit"><input id="login_password_${gid}" value="${escapeHtml(password)}" inputmode="numeric" pattern="[0-9]*" maxlength="${LOGIN_PASSWORD_LENGTH}" aria-label="Password Kumpulan ${gid}" oninput="this.value=this.value.replace(/\\D/g,'').slice(0,${LOGIN_PASSWORD_LENGTH})"><button type="button" onclick="regenerateLoginPassword('${gid}')">Jana Semula</button></div></td><td><select id="start_station_${gid}" aria-label="Stesen mula Kumpulan ${gid}"${startStationLocked?' disabled':''}>${options}</select></td></tr>`;
  });
  html += '</table>';
  area.innerHTML = html;
}
function collectEditedGroupSettings(){
  const edited={};
  const usedPasswords=new Set();
  const invalidPasswords=[];
  const invalidStartStations=[];
  Object.keys(groups||{}).forEach(gid=>{
    const input=document.getElementById('login_password_'+gid);
    const password=String(input&&input.value||'').trim();
    const configuredStart=startStationForGroup(groups[gid],StationLayout.defaultStartStation(Number(gid), currentStationCount()));
    const select=document.getElementById('start_station_'+gid);
    const selectedStart=isValidStationId(select?.value) ? Number(select.value) : configuredStart;
    if(!new RegExp(`^\\d{${LOGIN_PASSWORD_LENGTH}}$`).test(password) || usedPasswords.has(password)) invalidPasswords.push(gid);
    if(!isValidStationId(selectedStart)) invalidStartStations.push(gid);
    usedPasswords.add(password);
    edited[gid]={loginPassword:password,startStation:selectedStart};
  });
  return {edited,invalidPasswords,invalidStartStations};
}
function regenerateLoginPassword(gid){
  const input=document.getElementById('login_password_'+gid);
  if(!input) return;
  const usedPasswords=new Set();
  Object.keys(groups||{}).forEach(id=>{
    if(id===String(gid)) return;
    const value=document.getElementById('login_password_'+id)?.value;
    if(/^\d{4}$/.test(value||'')) usedPasswords.add(value);
  });
  input.value=generateLoginPassword(usedPasswords);
  markSetupStepDirty('passwords');
}
function regenerateAllLoginPasswords(){
  if(!confirm('Jana semula semua password kumpulan? Password lama tidak boleh digunakan selepas anda menekan Simpan Password.')) return;
  const usedPasswords=new Set();
  Object.keys(groups||{}).sort((a,b)=>Number(a)-Number(b)).forEach(gid=>{
    const input=document.getElementById('login_password_'+gid);
    if(input) input.value=generateLoginPassword(usedPasswords);
  });
  markSetupStepDirty('passwords');
}
function saveLoginPasswords(){
  const {edited,invalidPasswords,invalidStartStations}=collectEditedGroupSettings();
  if(invalidPasswords.length){
    alert(`Password Kumpulan ${invalidPasswords.join(', ')} mesti 4 digit nombor unik.`);
    return;
  }
  if(invalidStartStations.length){
    alert(`Pilih stesen mula sah untuk Kumpulan ${invalidStartStations.join(', ')}.`);
    return;
  }
  const updated={};
  const startStationLocked=(sessionInfo||{}).status==='active';
  Object.keys(groups||{}).forEach(gid=>{
    const currentStart=startStationForGroup(groups[gid],StationLayout.defaultStartStation(Number(gid), currentStationCount()));
    const startStation=startStationLocked ? currentStart : edited[gid].startStation;
    updated[gid]={...groups[gid],loginPassword:edited[gid].loginPassword,startStation,order:rotationFor(startStation)};
  });
  if(isHuntDraft){
    groups=updated;
    markSetupStepSaved('passwords');
    showLoginPasswords('Tetapan kumpulan disimpan. Anda boleh teruskan ke Langkah 4.');
    return;
  }
  Promise.all([
    huntRef('config/groups').set(updated),
    huntRef('setupState').update({passwordsSavedAt:Date.now(),qrSavedAt:null})
  ]).then(()=>{
    groups=updated;
    markSetupStepSaved('passwords');
    showLoginPasswords('Tetapan kumpulan berjaya disimpan.');
  }).catch(error=>alert('Tidak dapat simpan password: '+error.message));
}
function printLoginPasswords(){
  const {edited,invalidPasswords,invalidStartStations}=collectEditedGroupSettings();
  if(invalidPasswords.length || invalidStartStations.length){
    alert('Semak password dan stesen mula setiap kumpulan sebelum mencetak.');
    return;
  }
  const output=document.getElementById('passwordPrintOutput');
  if(!output) return;
  const rows=Object.keys(groups||{}).sort((a,b)=>Number(a)-Number(b)).map(gid=>
    `<tr><td>Kumpulan ${gid}</td><td>${escapeHtml(edited[gid].loginPassword)}</td><td>Stesen ${edited[gid].startStation}</td></tr>`).join('');
  output.innerHTML=`<section class="password-print-sheet"><h1>Game Station — Password &amp; Stesen Mula</h1><p>Berikan password kepada kumpulan masing-masing sebelum permainan bermula.</p><table><thead><tr><th>Kumpulan</th><th>Password 4 Digit</th><th>Mula di Stesen</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  document.body.classList.add('printing-passwords');
  window.addEventListener('afterprint',()=>document.body.classList.remove('printing-passwords'),{once:true});
  window.print();
}
function gameStationQrPayload(kind,id,password){
  // Older sheets contained only the password. New sheets carry the hunt and
  // station identity too, allowing a phone with a stale cached hunt to reload
  // the correct configuration before it judges the scan.
  return currentHuntId ? `GS1|${currentHuntId}|${kind}|${id}|${password}` : password;
}
function saveQrStep(){
  if(!currentHuntId){
    alert('Simpan Langkah 1 hingga 3 terlebih dahulu.');
    return;
  }
  const output=document.getElementById('qrOutput');
  if(!output || !output.querySelector('.qr-print')){
    alert('Jana QR stesen terlebih dahulu sebelum menyimpan Langkah 4.');
    return;
  }
  huntRef('setupState').update({qrSavedAt:Date.now()}).then(()=>{
    markSetupStepSaved('qr');
    const message=document.getElementById('qrSaveMsg');
    if(message) message.innerHTML='<div class="msg ok">✅ Langkah 4 berjaya disimpan. Tekan Selesai untuk kembali ke senarai Treasure Hunt.</div>';
  }).catch(error=>alert('Tidak dapat menyimpan QR: '+error.message));
}
function finishSetup(){
  if(!setupStepIsReady('qr')){
    alert('Simpan Langkah 4 terlebih dahulu.');
    return;
  }
  selectAdminTopTab('hunts');
}
function generateQRs(){
  const st = collectStations();
  const cn = collectCannonConfig();
  const cnList = cn.enabled ? collectCannons() : {};
  if(!validateStationPasswords(st) || !validateWorksheetStations(st) || !validateSudokuStages(st) || !validateTangramStages(st)) return;
  if(!validateCannons(st, cn, cnList)) return;
  stations = st; cannonConfig = cn; cannons = cnList;
  const out = document.getElementById('qrOutput');
  out.innerHTML='';
  Object.values(st).forEach(s=>{
    const div=document.createElement('div');
    div.className='qr-print';
    div.innerHTML=`<div style="font-weight:700;">Stesen ${s.id}: ${escapeHtml(s.name)}</div><div id="qr_${s.id}"></div><div class="qr-pass">Password: <b>${escapeHtml(String(s.password||'').toUpperCase())}</b></div><div style="font-size:11px;color:#888;">Sorok di: ${escapeHtml(s.location)}</div>`;
    out.appendChild(div);
    setTimeout(()=>new QRCode(document.getElementById('qr_'+s.id), {text:gameStationQrPayload('S',s.id,s.password), width:130, height:130}), 0);
  });
  Object.values(cnList).forEach(c=>{
    const div=document.createElement('div');
    div.className='qr-print cannon-qr';
    div.innerHTML=`<div style="font-weight:700;">⚔️ ${escapeHtml(c.name||('Meriam '+c.id.replace('c','')))}</div><div id="qr_${c.id}"></div><div class="qr-pass">Password: <b>${escapeHtml(String(c.password||'').toUpperCase())}</b></div><div style="font-size:11px;color:#888;">QR meriam — setiap kumpulan boleh ambil satu peluru sekali sahaja.</div>`;
    out.appendChild(div);
    setTimeout(()=>new QRCode(document.getElementById('qr_'+c.id), {text:gameStationQrPayload('C',c.id,c.password), width:130, height:130}), 0);
  });
  return true;
}
function printQRCodes(){
  const output = document.getElementById('qrOutput');
  if(!output || !output.querySelector('.qr-print')){
    alert('Jana QR stesen dahulu sebelum mencetak.');
    return;
  }
  window.print();
}
function watchDashboard(){
  if(watchedDashboardRef) watchedDashboardRef.off('value');
  watchedDashboardRef=huntRef('progress');
  watchedDashboardRef.on('value', snap=>{
    const prog = snap.val()||{};
    const rows = document.getElementById('dashRows');
    rows.innerHTML='';
    Object.keys(groups).forEach(gid=>{
      const g = groups[gid];
      const p = prog[gid]||{currentIndex:0,keys:[],totalScore:0,status:'idle'};
      const currentIndex=Number(p.currentIndex)||0;
      const curSt = p.status==='won' ? '🏆 Menang' : StationLayout.isJourneyDone(currentIndex, currentStationCount()) ? `📦 Selesai ${currentStationCount()} Pulau` : `Pulau ${currentIndex+1}: ${stations[g.order[currentIndex]]?.name || '-'}`;
      const hp=CannonEngine.readHp(p);
      rows.innerHTML += `<tr><td>${gid}</td><td><span class="badge ${p.status==='idle'?'idle':'done'}">${p.status}</span></td><td>${curSt}</td><td>${p.currentIndex||0}/${currentStationCount()}</td><td>${'🔑'.repeat((p.keys||[]).length)}</td><td>${hp}%</td><td>${CannonEngine.effectiveScore(p.totalScore||0,p.hp)}</td></tr>`;
    });
  });
}

