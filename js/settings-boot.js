/* ============================================================
   STATUS / BANNERS / SETTINGS
   ============================================================ */
function formatSyncDuration(seconds){
  const n=Math.max(0,Math.floor(Number(seconds)||0)),m=Math.floor(n/60),s=n%60;
  return m?`${m}m ${String(s).padStart(2,'0')}s`:`${s}s`;
}
function renderSyncLabel(status=null){
  if(status&&D){
    D.syncing=Boolean(status.syncing);
    if(Number.isFinite(Number(status.last_elapsed_seconds)))D.last_sync_elapsed_seconds=Number(status.last_elapsed_seconds);
  }
  const el=$('#synced');if(!el)return;
  const syncing=Boolean(status?status.syncing:D?.syncing);
  if(syncing){
    const elapsed=status?.elapsed_seconds??D?.sync_elapsed_seconds??0;
    el.textContent=`Syncing · ${formatSyncDuration(elapsed)} elapsed`;
  }else{
    const ago=D?.last_sync?Math.round((Date.now()-new Date(D.last_sync))/60000):null;
    const label=ago==null?'Never synced':ago<1?'Synced just now':`Synced ${ago<90?ago+' min':Math.round(ago/60)+' h'} ago`;
    const duration=Number(D?.last_sync_elapsed_seconds??D?.sync_seconds);
    el.textContent=Number.isFinite(duration)&&duration>=0?`${label} · last sync ${formatSyncDuration(duration)}`:label;
  }
  const timings=D?.sync_timings||{};
  const timingLines=Object.entries(timings).map(([name,value])=>`${name}: ${formatSyncDuration(value)}`);
  const history=(D?.sync_elapsed_history||[]).slice(-6).reverse();
  const historyLines=history.map(item=>{
    const at=item?.at?new Date(item.at).toLocaleString():'';
    return `${at?at+' · ':''}${formatSyncDuration(item?.seconds)}`;
  });
  el.title=[timingLines.length?`Latest sync stages:\n${timingLines.join('\n')}`:'',historyLines.length?`Recent total syncs:\n${historyLines.join('\n')}`:''].filter(Boolean).join('\n\n');
}
function renderStatus(){
  $('#demo').hidden = !D.demo;
  const connectButton=$('#connectGoogle');
  if(connectButton) connectButton.hidden=Boolean(D.signed_in||D.demo);
  renderSyncLabel();
  let b='';
  if(!D.signed_in) b+=`<div class="banner"><b>Google Health is not connected.</b> Use <b>Connect Google</b> to sign in to this computer's local dashboard.</div>`;
  const errs=Object.entries(D.errors||{});
  if(errs.length) b+=`<div class="banner"><b>Some data couldn't be fetched.</b> <details><summary>${errs.map(e=>e[0]).join(', ')}</summary>${errs.map(([k,v])=>`<p><b>${esc(k)}:</b> ${esc(v)}</p>`).join('')}</details></div>`;
  if(!D.settings?.age) b+=`<div class="banner">Set your <b>age and sex</b> via Settings to unlock VO₂ max, fitness age, HR zones and sleep-quality ranges.</div>`;
  try {
    const today = D.today, fresh = D.freshness || {};
    const stale = ["resting_hr","hrv","spo2","resp_rate","body_temp","active_minutes"].filter(m => fresh[m] && fresh[m] < today);
    if (stale.length >= 1) {
      b += `<div class="banner"><b>Some daily metrics are behind today (${esc(today)}).</b> Latest: ${stale.slice(0,6).map(m=>`${esc(m)}=${esc(fresh[m])}`).join(', ')}${stale.length>6?'…':''}. <button class="act" onclick="document.getElementById('sync').click()">Sync now</button></div>`;
    }
  } catch(e){}
  $('#banners').innerHTML=b;
}
function openSettings(){
  $('#setAge').value = D.settings?.age ?? '';
  $('#setSex').value = D.settings?.sex || 'm';
  $('#setSleepGoal').value = D.settings?.sleep_goal ?? 8;
  $('#setHeight').value = D.settings?.height_cm ?? '';
  $('#setWeight').value = D.settings?.weight_kg ?? '';
  $('#settingsBackdrop').classList.add('open');
}
function closeSettings(){ $('#settingsBackdrop').classList.remove('open'); }
async function saveSettings(e){
  e?.preventDefault();
  const button=$('#saveSettings'), status=$('#settingsSaveStatus');
  const s = {
    age: Number($('#setAge').value) || null,
    sex: $('#setSex').value,
    sleep_goal: Number($('#setSleepGoal').value) || 8,
    height_cm: Number($('#setHeight').value) || null,
    weight_kg: Number($('#setWeight').value) || null,
  };
  if(button.disabled)return;
  button.disabled=true;button.textContent='Saving…';if(status)status.textContent='';
  try{
    const response=await fetch('/api/settings', {method:'POST', headers:{'Content-Type':'application/json','X-Requested-With':'HealthDashboard'}, body: JSON.stringify(s)});
    if(!response.ok)throw new Error(`Save failed (${response.status})`);
    closeSettings();
    load();
  }catch(error){if(status)status.textContent='Could not save settings. Please try again.';}
  finally{button.disabled=false;button.textContent='Save';}
}
$('#openSettings').onclick = openSettings;
$('#cancelSettings').onclick = closeSettings;
$('#closeSettings').onclick = closeSettings;
$('#settingsForm').addEventListener('submit',saveSettings);
$('#settingsBackdrop').onclick = e => { if(e.target === $('#settingsBackdrop')) closeSettings(); };
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('#settingsBackdrop').classList.contains('open'))closeSettings();});

/* ============================================================
   LOAD
   ============================================================ */
function setPersonalGreeting(name){
  const clean=String(name||'').trim().replace(/\s+/g,' ').slice(0,40);
  if(!clean)return false;
  $('#personalGreeting').textContent=`Hi, ${clean}`;
  document.title=`Hi, ${clean} · Health dashboard`;
  return true;
}
function initializePersonalGreeting(){
  const greetingKey=window.__HEALTH_DASHBOARD_STANDALONE__?'health-dashboard-standalone-name':'health-dashboard-name';
  let name='';try{name=localStorage.getItem(greetingKey)||'';}catch(_){}
  if(setPersonalGreeting(name))return;
  const backdrop=$('#nameBackdrop'),input=$('#dashboardName');
  backdrop.classList.add('open');backdrop.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>input.focus());
  $('#nameForm').addEventListener('submit',e=>{
    e.preventDefault();const clean=input.value.trim().replace(/\s+/g,' ').slice(0,40);if(!clean){input.focus();return;}
    try{localStorage.setItem(greetingKey,clean);}catch(_){}
    setPersonalGreeting(clean);backdrop.classList.remove('open');backdrop.setAttribute('aria-hidden','true');
  });
}
async function load(){
  try{
    const headers=lastPayloadEtag?{'If-None-Match':lastPayloadEtag}:{};
    const r=await fetch(`/api/data?days=${days}`,{headers});
    if(r.status===304){renderSyncLabel();return;}
    if(!r.ok){const t=await r.text();throw new Error(`HTTP ${r.status} — ${t.slice(0,200)}`);}
    lastPayloadEtag=r.headers.get('ETag')||lastPayloadEtag;
    const payload=await r.json();if(!payload||typeof payload!=='object'||!payload.daily||!payload.today)throw new Error('Server returned an unexpected payload (missing daily/today).');
    const signature=cheapPayloadSignature(payload);const changed=signature!==lastPayloadSignature;
    if(changed){D=payload;lastPayloadSignature=signature;dataVersion++;payloadSigs=pendingPayloadSigs;}
    else {D=payload;}
    buildDataIndexes(D);
    const stageControls=$('#card-sleepStageAverage header .sleep-stage-header-controls');if(stageControls)stageControls.outerHTML=sleepStageDateControls();
    renderStatus();
    if(changed){if(activeSection==='overview')renderOverview();renderCharts();if(activeSection==='activity'&&activeSubtab==='workouts')renderWorkouts();if(activeSection==='activity')renderHeatmap();if(activeSection==='quality')refreshDatabaseDiagnostics();}
    else {renderSyncLabel();}
  }catch(ex){console.error('[load]',ex);$('#banners').innerHTML=`<div class="banner"><b>Couldn't load data.</b> ${esc(ex.message)} <button class="act" onclick="load()">Retry</button></div>`;}
}
window.addEventListener('error', e => {
  const b = document.getElementById('banners');
  if(b && !b.dataset.gotError){
    b.dataset.gotError = '1';
    b.insertAdjacentHTML('afterbegin', `<div class="banner"><b>Uncaught error:</b> ${esc(String(e.message || e))}</div>`);
  }
});

document.querySelectorAll('#range button').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.d===period));b.onclick=()=>{
  period=b.dataset.d; days=rangeDays(period);if(D)renderHero();window._chartZoom={};window.workoutScatterSelection=null;try{localStorage.setItem('health-dashboard-range',period);if(typeof workoutUi!=='undefined'){const map={'1':'1d','7':'7d','30':'30','ytd':'ytd','all':'all'};if(map[period]){workoutUi.range=map[period];localStorage.setItem('health-workout-range',workoutUi.range);}}}catch(e){}
  document.querySelectorAll('#range button').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));
  load().finally(()=>{const card=document.querySelector('#card-available-later');if(card)renderCardByElement(card,true);});
};});
$('#sync').onclick = async () => {
  const btn=$('#sync'); btn.disabled=true; $('#synced').textContent='Syncing…';
  try {
    const r=await fetch('/api/sync',{method:'POST',headers:{'X-Requested-With':'HealthDashboard'}});
    if(!r.ok) throw new Error('Sync request failed ('+r.status+')');
    for(let i=0;i<180;i++){
      await new Promise(resolve=>setTimeout(resolve,1000));
      const sr=await fetch('/api/status');
      if(sr.ok){const st=await sr.json();if(!st.syncing){await load();break;}}
      if(i===179){await load();$('#banners').insertAdjacentHTML('afterbegin','<div class="banner"><b>Sync is taking longer than expected.</b> The dashboard has refreshed with the data currently stored.</div>');}
    }
  } catch(ex) { $('#banners').insertAdjacentHTML('afterbegin',`<div class="banner"><b>Sync could not be completed.</b> ${esc(ex.message)}</div>`); await load(); }
  finally {btn.disabled=false;}
};
$('#connectGoogle').onclick = () => {
  const btn=$('#connectGoogle');
  btn.disabled=true; btn.textContent='Opening Google…';
  window.location.assign('/oauth/start');
};
let resizeFrame = 0;
window.addEventListener('resize', () => { if(!D||resizeFrame)return; resizeFrame=requestAnimationFrame(()=>{resizeFrame=0; if(activeSection==='overview')renderOverview(); if(activeSection==='activity')renderHeatmap(); }); });
document.addEventListener('visibilitychange',()=>{if(!document.hidden)requestAnimationFrame(()=>renderCharts());});
if('IntersectionObserver' in window){const chartVisibilityObserver=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting&&e.target.dataset.dirty)scheduleCard(e.target);},{rootMargin:'180px'});document.addEventListener('DOMContentLoaded',()=>$$('#charts .card').forEach(c=>chartVisibilityObserver.observe(c)));}

initializePersonalGreeting();
buildCards();
load();
setInterval(load, 60000);
async function pollSyncClock(){
  try{
    const response=await fetch('/api/status',{cache:'no-store'});if(!response.ok)return;
    const status=await response.json(),wasSyncing=Boolean(D?.syncing);
    renderSyncLabel(status);
    if(wasSyncing&&!status.syncing)await load();
  }catch(_){}
}
pollSyncClock();
setInterval(pollSyncClock,1000);
