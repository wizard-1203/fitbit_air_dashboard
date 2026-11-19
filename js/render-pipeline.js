/* ============================================================
   BUILD / RENDER CARDS
   ============================================================ */
const viewTable = {};
window._chartZoom = window._chartZoom || {};
const chartCache = new Map();
const chartObservers = new Map();
let chartFrame = 0;
let pendingChartHosts = new Set();
let dataVersion = 0;
let lastPayloadSignature = '';
let lastPayloadEtag = '';
let payloadSigs={daily:{}};let pendingPayloadSigs={daily:{}};
function hashText(text,seed=2166136261){let h=seed>>>0;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
function arraySignature(arr){if(!Array.isArray(arr))return '0';let h=2166136261;for(const row of arr){let v;if(Array.isArray(row))v=row.join('|');else if(row&&typeof row==='object'){v=Object.keys(row).sort().map(k=>k+':'+(row[k]&&typeof row[k]==='object'?JSON.stringify(row[k]):String(row[k]??''))).join('|');}else v=String(row);h=hashText(v,h);}return `${arr.length}:${h>>>0}`;}
function makePayloadSignatures(p){const daily={},recovery={};for(const [k,v] of Object.entries(p.daily||{}))daily[k]=arraySignature(v);for(const [k,v] of Object.entries(p.recovery_daily||{}))recovery[k]=arraySignature(v);const bySleep=(o)=>Object.keys(o||{}).sort().map(k=>k+':'+arraySignature(o[k])).join(',');return {daily,recovery,hr:arraySignature(p.hr),hr_daily:arraySignature(p.hr_daily),hrv_samples:arraySignature(p.hrv_samples),spo2_samples:arraySignature(p.spo2_samples),exercise:arraySignature(p.exercise),sleep:arraySignature(p.sleep),sleep_score_history:arraySignature(p.sleep_score_history),sleep_score_snapshots:hashText(JSON.stringify(p.sleep_score_snapshots||{})),hr_strain:arraySignature(p.hr_strain),sleep_hr:bySleep(p.sleep_hr),sleep_hrv:bySleep(p.sleep_hrv),stages:bySleep(p.sleep_stages_by_id),version:p.version||''};}
function cheapPayloadSignature(p){const q=makePayloadSignatures(p);pendingPayloadSigs=q;return [p.last_sync,p.today,q.version,q.hr,q.hrv_samples,q.spo2_samples,q.exercise,q.sleep,...Object.keys(q.daily).sort().map(k=>k+'='+q.daily[k])].join('|');}
function cardDataSignature(id){const d=payloadSigs.daily||{};const join=(...a)=>a.map(k=>`${k}:${d[k]||'0'}`).join('|');if(id==='hr')return payloadSigs.hr;if(id==='hrdaily')return payloadSigs.hr_daily;if(id==='rhr')return join('resting_hr');if(id==='hrv')return join('hrv','hrv_entropy')+'|'+payloadSigs.hrv_samples+'|'+payloadSigs.sleep;if(id==='trainingPlan')return join('resting_hr','hrv','spo2','resp_rate','body_temp')+'|'+Object.keys(payloadSigs.recovery||{}).sort().map(k=>k+':'+payloadSigs.recovery[k]).join('|')+'|'+payloadSigs.hr_strain+'|'+payloadSigs.sleep+'|'+payloadSigs.sleep_score_history+'|'+payloadSigs.sleep_score_snapshots+'|'+payloadSigs.exercise;if(id==='liveStress')return payloadSigs.version+'|'+payloadSigs.sleep+'|'+payloadSigs.exercise+'|'+Object.keys(payloadSigs.recovery||{}).sort().map(k=>k+':'+payloadSigs.recovery[k]).join('|');if(id==='hrvscatter')return join('resting_hr','hrv','spo2');if(id==='spo2')return join('spo2');if(id==='bodytemp')return join('body_temp');if(id==='abruptSleep')return payloadSigs.sleep+'|'+payloadSigs.stages+'|'+payloadSigs.sleep_hr+'|'+payloadSigs.sleep_hrv+'|'+payloadSigs.spo2_samples;if(id==='sleepStageAverage')return payloadSigs.sleep+'|'+payloadSigs.stages+'|'+payloadSigs.sleep_score_history;if(id==='sleep'||id==='sleepdebt'||id==='sleephr'||id==='sleepStageTrend')return payloadSigs.sleep+'|'+payloadSigs.stages+'|'+join('sleep','deep','rem','light','awake');if(id==='sleepinghrv')return payloadSigs.hrv_samples+'|'+payloadSigs.sleep_hrv+'|'+payloadSigs.sleep+'|'+payloadSigs.stages;if(id==='spo2samples')return payloadSigs.spo2_samples+'|'+payloadSigs.sleep+'|'+payloadSigs.stages;if(id==='steps')return join('steps');if(id==='distance')return join('distance_m');if(id==='sedentary')return join('sedentary_seconds');if(id==='hourly')return arraySignature(D?.hourly_steps);if(id==='act')return join('active_minutes');if(id==='azm')return join('azm_fatburn','azm_cardio','azm_peak');if(['z1','z2','z3','z4'].includes(id))return hashText(JSON.stringify(D?.zone_time||{}));if(id==='zoneDay'||id==='zoneStack'||id==='zoneDetails'||id.startsWith('workout'))return payloadSigs.exercise+'|'+payloadSigs.hr+'|'+join('vo2max','resting_hr','hrv')+'|'+hashText(JSON.stringify(D?.zone_time||{}));if(id==='nights')return Object.keys(d).sort().map(k=>k+':'+d[k]).join('|')+'|'+payloadSigs.sleep+'|'+payloadSigs.sleep_hr+'|'+payloadSigs.sleep_hrv+'|'+payloadSigs.stages+'|'+payloadSigs.spo2_samples;if(id==='correlation'||id==='baseline'||id==='available-later')return Object.keys(d).sort().map(k=>k+':'+d[k]).join('|')+'|'+payloadSigs.sleep+'|'+payloadSigs.exercise+'|'+hashText(JSON.stringify(D?.zone_time||{}));if(id==='coverage'||id==='dbStorage')return payloadSigs.version+'|'+payloadSigs.hr;return join(...Object.keys(d));}
function cardVisible(card){return !!card && !card.closest('.hidden-by-nav') && !card.closest('[hidden]') && card.getBoundingClientRect().width>0;}
function scheduleCard(card){
  if(!card)return; pendingChartHosts.add(card);
  if(chartFrame)return;
  chartFrame=requestAnimationFrame(()=>{chartFrame=0;const items=[...pendingChartHosts];pendingChartHosts.clear();for(const c of items)renderCardByElement(c);});
}
function observeChartCards(){
  for(const c of $$('#charts .card')){
    if(chartObservers.has(c))continue;
    let timer=0,lastWidth=0;
    const target=c.querySelector('.plot')||c;const ro=new ResizeObserver(entries=>{const w=Math.floor(entries[0]?.contentRect?.width||0);clearTimeout(timer);timer=setTimeout(()=>{if(w>0&&Math.abs(w-lastWidth)>8){lastWidth=w;scheduleCard(c);}},100);});
    ro.observe(target);chartObservers.set(c,ro);
    lastWidth=Math.floor(target.getBoundingClientRect().width||0);
  }
}
function buildCards(){
  $('#charts').innerHTML = CARDS.map(c=>`<section class="card${c.wide?' wide':''}" data-section="${c.section}" data-subtab="${c.subtab||''}" id="card-${c.id}">
    ${c.id==='hrdaily'?`<header class="hr-spread-header"><div class="hr-spread-title"><h2>${c.title}</h2><span class="hint">${c.sub||''}</span></div><div class="hr-spread-actions">${typeof c.ctl==='function'?c.ctl():(c.ctl||'')}<button class="act tbl" data-id="${c.id}" aria-pressed="false">Table</button><button class="act more-btn" data-expand="${c.id}" type="button">See more ↗</button></div></header>`:`<header><h2>${c.title}</h2><span class="metric-header-kpi" data-card-kpi hidden></span>${c.sub?`<span class="hint">${c.sub}</span>`:''}${typeof c.ctl==='function'?c.ctl():(c.ctl||'')}${c.nobtn?'':`<button class="act tbl" data-id="${c.id}" aria-pressed="false">Table</button>`}<button class="act more-btn" data-expand="${c.id}" type="button">See more ↗</button></header>`}
    <div class="plot"><div class="skeleton" aria-hidden="true"></div></div><div class="foot"></div>
    ${c.legend?`<div class="legend">${c.legend.map(([n,col])=>`<span><i style="background:${col}"></i>${n}</span>`).join('')}</div>`:''}</section>`).join('');
  document.querySelectorAll('.tbl').forEach(b=>b.onclick=()=>{viewTable[b.dataset.id]=!viewTable[b.dataset.id];b.setAttribute('aria-pressed',!!viewTable[b.dataset.id]);const card=document.querySelector(`#card-${b.dataset.id}`);if(card)renderCardByElement(card,true);});
  if(!window._hrvLegendDelegated){document.addEventListener('click',e=>{const b=e.target.closest?.('[data-hrv-layer]');if(!b)return;const k=b.dataset.hrvLayer;window._hrvLayers=window._hrvLayers||{provider:true,median:true,mean:false,envelope:true,entropy:false};window._hrvLayers[k]=!window._hrvLayers[k];const card=document.querySelector('#card-hrv');if(card)renderCardByElement(card,true);});window._hrvLegendDelegated=true;}
  document.querySelectorAll('[data-expand]').forEach(b=>b.onclick=()=>openCardOverlay(b.dataset.expand));
  document.querySelectorAll('[data-sleep-percent-toggle]').forEach(btn=>{btn.textContent=window.sleepStagePercent?'Switch to absolute hours':'Switch to 100% split';btn.onclick=()=>{window.sleepStagePercent=!window.sleepStagePercent;renderCharts(true);};});
  document.querySelectorAll('[data-sleep-awake-toggle]').forEach(input=>{input.checked=(window.sleepStageAwake?input.value==='include':input.value==='exclude');input.onchange=()=>{window.sleepStageAwake=input.value==='include';renderCharts(true);};});
  document.querySelectorAll('[data-sleep-scope]').forEach(sel=>{sel.value=window.sleepStageScope||'total';sel.onchange=()=>{window.sleepStageScope=sel.value;renderCharts(true);};});
  document.querySelectorAll('[data-sleep-stage-select]').forEach(sel=>{sel.value=window._sleepStageMetric||'deep';sel.onchange=()=>{window._sleepStageMetric=sel.value;renderCharts(true);};});
  document.querySelectorAll('[data-hrbox-days]').forEach(btn=>{btn.setAttribute('aria-pressed',String(String(window._hrBoxDays||30)===btn.dataset.hrboxDays));btn.onclick=()=>{window._hrBoxDays=btn.dataset.hrboxDays==='custom'?'custom':Number(btn.dataset.hrboxDays);const custom=document.querySelector('[data-hrbox-custom]');if(custom)custom.hidden=window._hrBoxDays!=='custom';if(window._hrBoxDays!=='custom'){window._hrBoxFrom=window._hrBoxTo=null;const c=document.querySelector('#card-hrdaily');if(c)renderCardByElement(c,true);}};});
  document.querySelector('[data-hrbox-apply]')?.addEventListener('click',()=>{const a=document.querySelector('[data-hrbox-from]')?.value,b=document.querySelector('[data-hrbox-to]')?.value;if(!a||!b||a>b){alert('Choose a valid start and end date.');return;}window._hrBoxDays='custom';window._hrBoxFrom=a;window._hrBoxTo=b;const c=document.querySelector('#card-hrdaily');if(c)renderCardByElement(c,true);});
  if(!window._hrboxLegendDelegated){document.addEventListener('click',e=>{const btn=e.target.closest?.('[data-hrbox-toggle]');if(!btn)return;const k=btn.dataset.hrboxToggle;window._hrBoxLayers=window._hrBoxLayers||{dailyMean:true,dailyHigh:true,dailyLow:true};window._hrBoxLayers[k]=!window._hrBoxLayers[k];btn.setAttribute('aria-pressed',String(window._hrBoxLayers[k]));const svg=document.querySelector('#card-hrdaily .hrbox-svg');svg?.querySelectorAll(`[data-hrbox-layer="${k}"]`).forEach(el=>el.style.display=window._hrBoxLayers[k]?'':'none');const envelope=svg?.querySelector('.hrbox-envelope');if(envelope)envelope.style.display=window._hrBoxLayers.dailyHigh!==false&&window._hrBoxLayers.dailyLow!==false?'':'none';});window._hrboxLegendDelegated=true;}
  document.querySelectorAll('[data-zone-day]').forEach(sel=>{sel.value=window._zoneDay||'last24';sel.onchange=()=>{window._zoneDay=sel.value;const c=document.querySelector('#card-zoneDay');if(c)renderCardByElement(c,true);};});
  observeChartCards();
}
function applyRawPinnedMarker(card,id){const kind=id==='sleepinghrv'?'hrv':'spo2',pts=kind==='hrv'?(window._hrvActive||[]):(window._spo2Active||[]),ts=kind==='hrv'?window._hrvPinnedTs:window._spo2PinnedTs;if(ts==null||!pts.length)return;const svg=card.querySelector(kind==='hrv'?'.hrv-raw-svg':'.spo2-main-svg');if(!svg)return;const p=pts.reduce((a,b)=>Math.abs(b.t-ts)<Math.abs(a.t-ts)?b:a,pts[0]),cross=svg.querySelector(kind==='hrv'?'#hrv-cross':'#spo2-cross'),dot=svg.querySelector(kind==='hrv'?'#hrv-dot':'#spo2-dot');if(cross){cross.setAttribute('x1',p.X);cross.setAttribute('x2',p.X);cross.setAttribute('opacity','1');}if(dot){dot.setAttribute('cx',p.X);dot.setAttribute('cy',p.Y);dot.setAttribute('opacity','1');}}
function renderCardByElement(card,force=false){
  const c=CARDS.find(x=>x.id===card?.id?.replace(/^card-/,'')); if(!c||!cardVisible(card)) {if(card)card.dataset.dirty='1';return;}
  const host=card.querySelector('.plot'),foot=card.querySelector('.foot'); if(!host)return;
  const width=Math.floor(host.getBoundingClientRect().width||0);if(width<=0){card.dataset.dirty='1';return;}
  const key=[cardDataSignature(c.id),width,period,!!viewTable[c.id],window._chartZoom?.[c.id]?.min,window._chartZoom?.[c.id]?.max,window.sleepStagePercent,window.sleepStageAwake,window.sleepStageScope,window._spo2Date,window._spo2SelectedId,window._spo2Mode,window._hrvDate,window._hrvSelectedId,window._sleepHrvDate,window._sleepHrvSelectedId,window._sleepHrvMode,window._zoneDay,window._metricRanges?.vitals,window._metricRanges?.calories,window._vitalsMetric,sleepSel,window._recoverySelectedDay].join('|');
  if(!force&&chartCache.get(c.id)===key&&!card.dataset.dirty)return;
  let cfg;try{cfg=c.build(width);if(cfg&&cfg.kind&&Array.isArray(cfg.pts))cfg._cardId=c.id;}catch(ex){host.innerHTML=`<div class="empty">Chart could not render: ${esc(ex.message)}. Try refreshing this section.</div>`;foot.innerHTML='';console.error('[chart '+c.id+']',ex);return;}
  const headKpi=card.querySelector('[data-card-kpi]');if(headKpi){headKpi.hidden=!cfg?.headerKpi;headKpi.textContent=cfg?.headerKpi||'';}
  foot.innerHTML=cfg?.foot||'';card.querySelector('.chart-kpi-row')?.remove();
  if(viewTable[c.id]&&Array.isArray(cfg?.cols)&&Array.isArray(cfg?.rows)){
    const html=`<div class="tablewrap"><table><thead><tr>${cfg.cols.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${cfg.rows.map(r=>`<tr>${r.map(v=>`<td>${v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    if(host.dataset.renderedHtml!==html){host.innerHTML=html;host.dataset.renderedHtml=html;host.querySelectorAll('tbody tr').forEach(row=>row.addEventListener('click',()=>{const v=row.cells[0]?.textContent?.trim()||'';const m=v.match(/\d{4}-\d{2}-\d{2}/);if(m)openDayDetail(m[0],c.title+' table');else if(c.id==='sleepinghrv'){const p=(window._hrvActive||[]).find(p=>fmtTime(p.t)===v);if(p){window._hrvPinnedTs=p.t;window._pinnedRawSample={kind:'hrv',t:p.t,v:p.v};viewTable[c.id]=false;renderCardByElement(card,true);}}else if(c.id==='spo2samples'){const p=(window._spo2Active||[]).find(p=>fmtTime(p.t)===v);if(p){window._spo2PinnedTs=p.t;window._pinnedRawSample={kind:'spo2',t:p.t,v:p.v};viewTable[c.id]=false;renderCardByElement(card,true);}}}));}
  } else if(cfg?.html!==undefined){if(host.dataset.renderedHtml!==cfg.html){host.innerHTML=cfg.html;host.dataset.renderedHtml=cfg.html;}}
  else {host.dataset.renderedHtml='';drawChart(host,cfg||{});if(cfg?.topHtml){const row=document.createElement('div');row.className='chart-kpi-row';row.innerHTML=cfg.topHtml;host.parentNode.insertBefore(row,host);}}
  if(!viewTable[c.id]&&(c.id==='sleepinghrv'||c.id==='spo2samples'))applyRawPinnedMarker(card,c.id);
  if(c.id==='hrdaily'){const layers=window._hrBoxLayers||{};card.querySelectorAll('[data-hrbox-layer]').forEach(el=>{const k=el.dataset.hrboxLayer;el.style.display=layers[k]===false?'none':'';});card.querySelectorAll('[data-hrbox-toggle]').forEach(btn=>btn.setAttribute('aria-pressed',String(layers[btn.dataset.hrboxToggle]!==false)));const envelope=card.querySelector('.hrbox-envelope');if(envelope)envelope.style.display=layers.dailyHigh===false||layers.dailyLow===false?'none':'';try{const excluded=JSON.parse(localStorage.getItem('hrBoxExcluded')||'[]');card.querySelectorAll('[data-hrbox-outlier]').forEach(el=>{const q=hrBoxMeta(el.closest('.hrbox-column'));if(q&&excluded.includes(`${q.day}:${el.dataset.hrboxOutlier}:${Number(el.getAttribute('data-value'))||(el.dataset.hrboxOutlier==='low'?q.low:q.high)}`))el.style.display='none';});}catch(_){}}

  card.dataset.dirty='';chartCache.set(c.id,key);syncZoomButton(card,c.id);
}
let overlayState=null;
function openCardOverlay(id){
  if(overlayState)return;const card=document.getElementById('card-'+id);if(!card)return;
  const parent=card.parentNode,placeholder=document.createElement('div');placeholder.style.display='none';parent.insertBefore(placeholder,card);
  const backdrop=document.createElement('div');backdrop.className='card-modal-backdrop';backdrop.setAttribute('role','dialog');backdrop.setAttribute('aria-modal','true');backdrop.setAttribute('aria-label',card.querySelector('h2')?.textContent||'Expanded chart');
  const shell=document.createElement('div');shell.className='card-modal-shell';const close=document.createElement('button');close.className='act card-modal-close';close.textContent='Close ✕';close.onclick=closeCardOverlay;
  const actions=document.createElement('div');actions.className='workout-controls';actions.style.margin='8px 0';
  const csv=document.createElement('button');csv.className='act';csv.textContent='Export CSV';csv.onclick=()=>exportCardCSV(id);
  const png=document.createElement('button');png.className='act';png.textContent='Export PNG';png.onclick=()=>exportCardPNG(id);
  actions.append(csv,png);
  shell.append(close,actions);
  if(id==='trainingLoad'){
    const guide=document.createElement('section');
    guide.className='training-load-guide';
    guide.innerHTML=`
      <h3>How to interpret training load</h3>
      <p class="sub">Use these metrics together to understand recent workload, longer-term training, and recovery. They are estimates—not medical measurements or universal performance scores.</p>
      <div class="training-load-guide-grid">
        <article><h4><span style="color:var(--neutral)">ATL · Acute load</span></h4><p><b>Recent fatigue / workload.</b> A weighted average over roughly 7 days. It responds relatively quickly to harder or more frequent workouts.</p><p><b>Read it as:</b> rising ATL means recent load is increasing; a falling ATL often reflects lighter training or rest. A high value alone does not prove overtraining.</p></article>
        <article><h4><span style="color:var(--hrv)">CTL · Chronic load</span></h4><p><b>Longer-term training base.</b> A slower weighted average over roughly 28 days, reflecting the training load you have been accumulating.</p><p><b>Read it as:</b> a gradual rise can indicate consistent training. It usually changes more slowly than ATL, so it may lag after a sudden workload change.</p></article>
        <article><h4><span style="color:var(--vo2)">TSB · Training stress balance</span></h4><p><b>Recent load compared with your training base.</b> This dashboard calculates <code>TSB = CTL − ATL</code>.</p><p><b>Read it as:</b> negative means ATL is above CTL (a more fatigue-leaning balance); positive means ATL is below CTL. Neither sign is automatically good or bad.</p></article>
      </div>
      <h4>Patterns to look for</h4>
      <ul>
        <li><b>ATL and CTL rise gradually:</b> workload is increasing while your longer-term base builds. This is more reassuring when sleep, energy, and performance remain good.</li>
        <li><b>ATL jumps well above CTL:</b> recent training has increased faster than your usual base. Consider holding off on adding intensity and check soreness, sleep, energy, and performance.</li>
        <li><b>ATL falls while CTL stays relatively high:</b> a lighter week can reduce recent fatigue while much of your longer-term training base remains.</li>
        <li><b>TSB becomes positive:</b> recent load is below your longer-term average; you may feel fresher, but a positive value does not guarantee readiness.</li>
      </ul>
      <h4>Practical decision rule</h4>
      <p>Do not chase a particular ATL, CTL, or TSB number. Combine the trend with how you feel, workout performance, sleep, and resting heart rate. A negative TSB with normal recovery can be routine; a negative TSB alongside persistent fatigue, poorer performance, disrupted sleep, or an unusually elevated resting heart rate is a stronger reason to reduce intensity and prioritize recovery.</p>
      <p class="sub"><b>Important limitations:</b> Values are based on estimated HRR-based TRIMP using workout duration, average heart rate, resting heart rate, and estimated maximum heart rate. They are relative estimates, not standardized units; 24.2 does not mean 24.2 minutes, and there is no universal dangerous threshold. Missing workout/heart-rate history can also make earlier chart values appear as zero, so check data coverage before interpreting a flat baseline.</p>`;
    shell.appendChild(guide);
  }
  shell.appendChild(card);backdrop.appendChild(shell);document.body.appendChild(backdrop);overlayState={card,parent,placeholder,backdrop};
  if(id==='spo2samples'){const matrix=card.querySelector('.spo2-matrix-accordion');if(matrix){matrix.open=true;setTimeout(()=>matrix.scrollIntoView({block:'nearest',behavior:'auto'}),0);}}
  backdrop.addEventListener('click',e=>{if(e.target===backdrop)closeCardOverlay();});document.addEventListener('keydown',overlayEsc);document.body.style.overflow='hidden';scheduleCard(card);
}
function overlayEsc(e){if(e.key==='Escape')closeCardOverlay();}
function closeCardOverlay(){if(!overlayState)return;const {card,parent,placeholder,backdrop}=overlayState;parent.insertBefore(card,placeholder);placeholder.remove();backdrop.remove();overlayState=null;document.removeEventListener('keydown',overlayEsc);document.body.style.overflow='';scheduleCard(card);}
function exportCardCSV(id){const card=document.getElementById('card-'+id);if(!card)return;const table=card.querySelector('table');let rows=[];if(table)rows=[...table.rows].map(r=>[...r.cells].map(c=>c.innerText));else{const c=CARDS.find(x=>x.id===id);try{const cfg=c?.build();if(cfg?.cols&&cfg?.rows)rows=[cfg.cols,...cfg.rows.map(r=>r.map(v=>String(v).replace(/<[^>]*>/g,'')))];}catch(e){}}
  if(!rows.length){alert('This chart does not currently expose tabular data. Use the Table toggle first.');return;}const csv=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');downloadBlob(csv,`${id}.csv`,'text/csv;charset=utf-8');}
function exportCardPNG(id){const svg=document.querySelector(`#card-${id} .plot svg`);if(!svg){alert('No SVG chart is available to export.');return;}const clone=svg.cloneNode(true);clone.setAttribute('xmlns','http://www.w3.org/2000/svg');const xml=new XMLSerializer().serializeToString(clone);const url=URL.createObjectURL(new Blob([xml],{type:'image/svg+xml;charset=utf-8'}));const img=new Image();img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=img.naturalWidth||img.width;canvas.height=img.naturalHeight||img.height;const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(document.querySelector(`#card-${id}`)).backgroundColor||'var(--surface)';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);URL.revokeObjectURL(url);canvas.toBlob(b=>{if(b)downloadBlob(b,`${id}.png`,'image/png');});};img.onerror=()=>{URL.revokeObjectURL(url);alert('PNG export failed for this SVG.');};img.src=url;}
function downloadBlob(data,name,type){const blob=data instanceof Blob?data:new Blob([data],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function syncZoomButton(card,id){let b=card.querySelector('[data-reset-zoom]');if(window._chartZoom?.[id]){if(!b){b=document.createElement('button');b.className='act';b.dataset.resetZoom='1';b.textContent='Reset zoom';const more=card.querySelector('[data-expand]');card.querySelector('header')?.insertBefore(b,more||null);}b.onclick=()=>{delete window._chartZoom[id];renderCardByElement(card,true);};}else if(b)b.remove();}
function activityCardHasData(id){
  const daily=D?.daily||{};
  const anyMetric=k=>(daily[k]||[]).some(r=>r&&r[1]!=null&&Number.isFinite(Number(r[1])));
  if(id==='card-steps')return anyMetric('steps');
  if(id==='card-distance')return anyMetric('distance_m');
  if(id==='card-sedentary')return anyMetric('sedentary_seconds');
  if(id==='card-hourly')return (D?.hourly_steps||[]).length>0;
  if(id==='card-act')return anyMetric('active_minutes');
  if(id==='card-azm')return ['azm_fatburn','azm_cardio','azm_peak'].some(anyMetric);
  if(id==='card-sleepinghrv')return (D?.sleep_hrv&&Object.values(D.sleep_hrv).some(a=>Array.isArray(a)&&a.length))||(D?.hrv_samples||[]).length>0;
  if(id==='card-spo2samples')return (D?.spo2_samples||[]).length>0;
  return true;
}
function renderCharts(force=false){
  observeChartCards();for(const card of $$('#charts .card')){
    if(['card-zoneDay','card-zoneStack','card-zoneDetails'].includes(card.id)){card.hidden=true;continue;}
    const noActivityData=card.dataset.section==='activity'&&card.dataset.subtab==='daily'&&!activityCardHasData(card.id);
    card.hidden=!!noActivityData;
    if(!noActivityData)renderCardByElement(card,force);
  }
  fillSleepSelect();
  document.querySelectorAll('[data-sleep-duration-series]').forEach(b=>{const key=b.dataset.sleepDurationSeries;const active=(window._sleepDurationSeries||['total']).includes(key);b.setAttribute('aria-pressed',String(active));b.onclick=()=>{let selected=window._sleepDurationSeries||['total'];selected=selected.includes(key)?selected.filter(x=>x!==key):[...selected,key];if(!selected.length)selected=['total'];window._sleepDurationSeries=selected;document.querySelectorAll('[data-sleep-duration-series]').forEach(x=>x.setAttribute('aria-pressed',String(selected.includes(x.dataset.sleepDurationSeries))));const c=$('#card-sleepDuration');if(c)renderCardByElement(c,true);};});const sdt=$('#sleepDurationTarget');if(sdt){sdt.onchange=()=>{window._sleepDurationTarget=sdt.value;const c=$('#card-sleepDuration');if(c)renderCardByElement(c,true);};}
  if(!window._sleepStageRangeBound){window._sleepStageRangeBound=true;document.addEventListener('change',e=>{if(!['sleepStageFrom','sleepStageTo'].includes(e.target?.id))return;const from=$('#sleepStageFrom'),to=$('#sleepStageTo');if(!from||!to)return;let a=from.value,b=to.value;if(a&&b&&a>b){if(e.target.id==='sleepStageFrom')b=a;else a=b;from.value=a;to.value=b;}window._sleepStageRange={from:a,to:b};const c=$('#card-sleepStageAverage');if(c)renderCardByElement(c,true);});}
  const heartDate=$('#heartDayDate');if(heartDate){heartDate.value=window._heartDayDate||D.today;heartDate.onchange=async()=>{window._heartDayDate=heartDate.value;let card=$('#card-hr');if(card){const plot=card.querySelector('.plot');if(plot)plot.innerHTML='<div class="skeleton"></div>';}try{const r=await fetch('/api/hr-day?date='+encodeURIComponent(heartDate.value));if(!r.ok)throw new Error('Could not load date');window._heartDaySamples=(await r.json()).samples||[];}catch(e){window._heartDaySamples=[];}card=$('#card-hr');if(card)renderCardByElement(card,true);};}
  const rtb=$('#recoveryTableToggle');if(rtb)rtb.onclick=()=>{window._recoveryTableOpen=!window._recoveryTableOpen;const c=document.querySelector('#card-combo');if(c)renderCardByElement(c,true);};
  if($('#corrGo')){ $('#corrGo').onclick=renderCorrelation; if($('#corrX'))$('#corrX').onchange=renderCorrelation; if($('#corrY'))$('#corrY').onchange=renderCorrelation; if($('#corrMethod'))$('#corrMethod').onchange=renderCorrelation; }
  document.querySelectorAll('[data-corr-preset]').forEach(b=>b.onclick=()=>{const p={strain:['azm_peak','hrv'],deep:['deep','resting_hr'],aerobic:['azm_fatburn','deep'],temp:['body_temp','resting_hr']}[b.dataset.corrPreset];if(!p)return;$('#corrX').value=p[0];$('#corrY').value=p[1];renderCorrelation();});
}

let workoutUi={type:'ALL',range:(()=>{try{return localStorage.getItem('health-workout-range')||'30'}catch(e){return '30'}})(),hideShort:(()=>{try{return localStorage.getItem('health-workout-hide-short')!=='false'}catch(e){return true}})(),minKm:0,minMinutes:0,units:(()=>{try{return localStorage.getItem('health-workout-units')||'km'}catch(e){return 'km'}})(),selected:null,collapsed:false,sort:'day',desc:true,eff5k:false};
window._workoutHrCache=window._workoutHrCache||{};window._workoutHrPending=window._workoutHrPending||new Set();
