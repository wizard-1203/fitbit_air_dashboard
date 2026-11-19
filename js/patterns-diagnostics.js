/* ============================================================
   PATTERNS / QUALITY / AVAILABLE-LATER
   ============================================================ */
function correlationHtml(){
  const choices=[
    ['Sleep duration','sleep'],['Deep sleep duration','deep'],['REM sleep duration','rem'],['Light sleep duration','light'],['Awake during sleep','awake'],
    ['Steps','steps'],['Distance','distance_m'],['Calories','calories'],['Body weight','weight'],['Systolic BP','systolic_bp'],['Diastolic BP','diastolic_bp'],['Active minutes','active_minutes'],
    ['Resting heart rate','resting_hr'],['Daily HRV','hrv'],['SpO₂','spo2'],['Respiratory rate','resp_rate'],['Body temperature','body_temp'],
    ['Zone 2 time','azm_fatburn'],['Zone 3 time','azm_cardio'],['Zone 4/5 time','azm_peak']
  ];
  const opts=choices.map(([n,k])=>`<option value="${k}">${n}</option>`).join('');
  return `<div class="workout-controls" style="display:flex;gap:7px;flex-wrap:wrap;margin-bottom:10px"><span class="sub">Presets</span><button class="act" type="button" data-corr-preset="strain">⚡ Strain vs HRV</button><button class="act" type="button" data-corr-preset="deep">🌙 Deep Sleep vs RHR</button><button class="act" type="button" data-corr-preset="aerobic">🏃 Aerobic Volume vs Deep Sleep</button><button class="act" type="button" data-corr-preset="temp">🌡️ Temp vs RHR</button></div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px"><label>X <select id="corrX">${opts}</select></label><label>Y <select id="corrY">${opts}</select></label><label>Method <select id="corrMethod"><option value="pearson">Pearson</option><option value="spearman">Spearman</option></select></label><button class="act" id="corrGo">Compare</button></div><div id="corrResult"><p class="sub">Choose two metrics and compare dates with both values available.</p></div>`;
}

function renderCorrelation(){
  const xk=$('#corrX')?.value, yk=$('#corrY')?.value, method=$('#corrMethod')?.value||'pearson', host=$('#corrResult');
  if(!host)return;
  const labels={sleep:'Sleep duration (min)',deep:'Deep sleep (min)',rem:'REM sleep (min)',light:'Light sleep (min)',awake:'Awake during sleep (min)',steps:'Steps',distance_m:'Distance',calories:'Calories',weight:'Body weight (kg)',systolic_bp:'Systolic BP (mmHg)',diastolic_bp:'Diastolic BP (mmHg)',active_minutes:'Active minutes',resting_hr:'Resting HR (bpm)',hrv:'HRV (ms)',spo2:'SpO₂ (%)',resp_rate:'Respiratory rate',body_temp:'Body temperature',azm_fatburn:'Zone 2 time',azm_cardio:'Zone 3 time',azm_peak:'Zone 4/5 time'};
  if(xk===yk){host.innerHTML='<p class="sub">Choose two different metrics.</p>';return;}
  const sleepMap={};
  for(const sl of (D.sleep||[]).filter(s=>s.main&&!s.nap)){
    const row=sleepMap[sl.day]||(sleepMap[sl.day]={});
    row.sleep=(sl.asleep||0); row.deep=sl.deep||0; row.rem=sl.rem||0; row.light=sl.light||0; row.awake=sl.awake||0;
  }
  function getMap(k){
    if(['sleep','deep','rem','light','awake'].includes(k))return Object.fromEntries(Object.entries(sleepMap).map(([d,r])=>[d,r[k]]));
    return Object.fromEntries((D.daily[k]||[]).map(r=>[r[0],r[1]]));
  }
  const a=getMap(xk), b=getMap(yk);
  const pts=Object.keys(a).filter(k=>b[k]!=null&&a[k]!=null).map(day=>({x:+a[day],y:+b[day],day})).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(pts.length<3){host.innerHTML=`<div class="empty">Only ${pts.length} matched dates — at least 3 needed.</div>`;return;}
  if(new Set(pts.map(p=>p.x)).size<2||new Set(pts.map(p=>p.y)).size<2){host.innerHTML='<div class="empty">One selected metric has no variation across matched dates.</div>';return;}
  const pearson=(xs,ys)=>{const mx=mean(xs),my=mean(ys),num=xs.reduce((z,x,i)=>z+(x-mx)*(ys[i]-my),0),den=Math.sqrt(xs.reduce((z,x)=>z+(x-mx)**2,0)*ys.reduce((z,y)=>z+(y-my)**2,0));return den?num/den:null;};
  const ranks=arr=>{const sorted=arr.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v),out=Array(arr.length);for(let i=0;i<sorted.length;){let j=i+1;while(j<sorted.length&&sorted[j].v===sorted[i].v)j++;const rank=((i+1)+j)/2;for(let k=i;k<j;k++)out[sorted[k].i]=rank;i=j;}return out;};
  const xs=pts.map(p=>p.x),ys=pts.map(p=>p.y),r=method==='spearman'?pearson(ranks(xs),ranks(ys)):pearson(xs,ys);
  const abs=Math.abs(r||0),strength=abs<.1?'negligible':abs<.3?'weak':abs<.5?'low-moderate':abs<.7?'moderate':abs<.9?'strong':'very strong';
  const direction=r>0?'positive':r<0?'negative':'no association';
  const mx=mean(xs),my=mean(ys),sxx=xs.reduce((z,x)=>z+(x-mx)**2,0),slope=sxx?xs.reduce((z,x,i)=>z+(x-mx)*(ys[i]-my),0)/sxx:0,intercept=my-slope*mx;
  const sorted=pts.slice().sort((a,b)=>a.day.localeCompare(b.day));
  const W=Math.floor(document.querySelector("#card-correlation .plot")?.clientWidth||0); if(!W)return {html:"<div class=\"skeleton\"></div>"}; const H=350,L=72,R=24,T=22,B=54;
  let xmin=Math.min(...xs),xmax=Math.max(...xs),ymin=Math.min(...ys),ymax=Math.max(...ys);if(xmin===xmax){xmin-=1;xmax+=1}if(ymin===ymax){ymin-=1;ymax+=1}const xp=(xmax-xmin)*.07,yp=(ymax-ymin)*.1;xmin-=xp;xmax+=xp;ymin-=yp;ymax+=yp;
  const X=v=>L+(v-xmin)/(xmax-xmin)*(W-L-R),Y=v=>T+(ymax-v)/(ymax-ymin)*(H-T-B);
  let svg=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Personal correlation chart" style="display:block;max-width:100%;height:auto">`;
  for(let i=0;i<5;i++){const xv=xmin+(xmax-xmin)*i/4,yv=ymin+(ymax-ymin)*i/4;svg+=`<line x1="${X(xv)}" x2="${X(xv)}" y1="${T}" y2="${H-B}" stroke="var(--grid)" stroke-dasharray="3 5"/><text x="${X(xv)}" y="${H-B+19}" fill="var(--axis-text)" font-size="11" text-anchor="middle">${xv.toLocaleString(undefined,{maximumFractionDigits:1})}</text><line x1="${L}" x2="${W-R}" y1="${Y(yv)}" y2="${Y(yv)}" stroke="var(--grid)" stroke-dasharray="3 5"/><text x="${L-9}" y="${Y(yv)+4}" fill="var(--axis-text)" font-size="11" text-anchor="end">${yv.toLocaleString(undefined,{maximumFractionDigits:1})}</text>`;}
  if(method==='pearson'){const yA=slope*xmin+intercept,yB=slope*xmax+intercept,band=Math.max((ymax-ymin)*.05,Math.abs(yB-yA)*.10);svg+=`<path d="M${X(xmin)},${Y(yA+band)} L${X(xmax)},${Y(yB+band)} L${X(xmax)},${Y(yB-band)} L${X(xmin)},${Y(yA-band)} Z" fill="#38BDF8" fill-opacity=".10"/><line x1="${X(xmin)}" y1="${Y(yA)}" x2="${X(xmax)}" y2="${Y(yB)}" stroke="#38BDF8" stroke-width="2.5"/>`;}
  const recoveryByDay=Object.fromEntries(recoveryRows().map(q=>[q.day,q]));
  pts.forEach(p=>{const rr=recoveryByDay[p.day],st=rr?recoveryStatus(rr,{rhr:mean(recoveryRows().map(q=>q.rhr)),hrv:mean(recoveryRows().map(q=>q.hrv))}).label:'Mixed',col=st==='Recovered'||st==='Good'?'#10B981':st==='Strained'?'#F43F5E':'#F59E0B';svg+=`<circle class="chart-dot" tabindex="0" role="img" onclick="openDayDetail('${p.day}','Correlation point')" cx="${X(p.x)}" cy="${Y(p.y)}" r="4.5" fill="${col}" stroke="#111113" stroke-width="1.2"><title>${p.day} · ${labels[xk]}: ${p.x.toFixed(2)} · ${labels[yk]}: ${p.y.toFixed(2)} · ${st}</title></circle>`;});
  svg+=`<text x="${(L+W-R)/2}" y="${H-12}" fill="var(--axis-text)" font-size="12" text-anchor="middle">${esc(labels[xk])}</text><text transform="translate(18 ${(T+H-B)/2}) rotate(-90)" fill="var(--axis-text)" font-size="12" text-anchor="middle">${esc(labels[yk])}</text></svg>`;
  const r2=method==='pearson'&&r!=null?r*r:null;
  host.innerHTML=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-bottom:10px">
    <div class="consolidated"><h3>Matched dates</h3><div class="mval">${pts.length}</div></div>
    <div class="consolidated"><h3>${method==='pearson'?'Pearson r':'Spearman ρ'}</h3><div class="mval">${r==null?'—':r.toFixed(3)}</div></div>
    <div class="consolidated"><h3>Direction / strength</h3><div class="msub">${strength} ${direction}</div></div>
    ${r2==null?'':`<div class="consolidated"><h3>r²</h3><div class="mval">${(r2*100).toFixed(1)}%</div></div>`}</div>
    <div class="tablewrap" style="padding:8px">${svg}</div>
    <div class="sub" style="margin-top:10px"><b>How to read this:</b> ${method==='pearson'?'Pearson measures linear association.':'Spearman measures monotonic rank association.'} ${strength} ${direction} association in the matched dates. ${r2==null?'':'r² is shared linear variance, not proof of cause.'}</div>`;
}

function baselineHtml(){
  const ms=[['Resting HR','resting_hr','bpm'],['HRV','hrv','ms'],['SpO₂','spo2','%'],['Resp rate','resp_rate','/min'],['Steps','steps','']];
  const rows=ms.map(([n,m,u])=>{
    const p=dailyPts(m).filter(x=>x.y!=null),cur=p[p.length-1]?.y,base=mean(p.slice(-8,-1).map(x=>x.y));
    return `<tr><td>${n}</td><td>${cur==null?'–':cur.toFixed(1)+' '+u}</td><td>${base==null?'–':base.toFixed(1)+' '+u}</td><td>${cur==null||base==null?'–':(cur-base>0?'+':'')+(cur-base).toFixed(1)}</td></tr>`;
  });
  return `<p class="sub">Latest value vs preceding seven readings.</p><div class="tablewrap"><table><thead><tr><th>Metric</th><th>Latest</th><th>Prev 7 mean</th><th>Δ</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}
function nightCompareHtml(){
  const ss=(D.sleep||[]).filter(x=>x.main&&!x.nap&&x.asleep>0).slice().sort((a,b)=>a.day.localeCompare(b.day));let comparison='';
  if(ss.length<4)comparison='<div class="empty">Need at least four main-sleep sessions for the better-night comparison.</div>';
  else{const sorted=ss.slice().sort((a,b)=>a.asleep-b.asleep),worst=sorted.slice(0,Math.max(1,Math.floor(ss.length/3))),best=sorted.slice(-Math.max(1,Math.floor(ss.length/3))),fmt=g=>({n:g.length,sleep:mean(g.map(x=>x.asleep)),deep:mean(g.map(x=>x.deep)),rem:mean(g.map(x=>x.rem))}),a=fmt(worst),b=fmt(best),nightRows=g=>g.map(x=>`<tr><td>${esc(x.day)}</td><td>${hm(x.asleep)}</td><td>${hm(x.deep)}</td><td>${hm(x.rem)}</td></tr>`).join('');
   comparison=`<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px"><div class="consolidated"><h3>Shorter-sleep third</h3><div>${a.n} nights · ${hm(a.sleep)} asleep<br>Deep ${hm(a.deep)} · REM ${hm(a.rem)}</div></div><div class="consolidated"><h3>Longer-sleep third</h3><div>${b.n} nights · ${hm(b.sleep)} asleep<br>Deep ${hm(b.deep)} · REM ${hm(b.rem)}</div></div><div class="consolidated"><h3>Difference</h3><div>${hm(b.sleep-a.sleep)} more sleep in longer group</div></div></div><details style="margin-top:10px"><summary style="cursor:pointer">Nights in each comparison group</summary><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:8px"><div class="tablewrap"><table><thead><tr><th>Shorter night</th><th>Sleep</th><th>Deep</th><th>REM</th></tr></thead><tbody>${nightRows(worst)}</tbody></table></div><div class="tablewrap"><table><thead><tr><th>Longer night</th><th>Sleep</th><th>Deep</th><th>REM</th></tr></thead><tbody>${nightRows(best)}</tbody></table></div></div></details>`;
  }
  return `${comparison}<section style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)"><h3 style="font-size:14px;margin:0 0 8px">Abrupt Sleep Patterns</h3><div class="sub" style="margin-bottom:8px">Approximate event counts and event-level measurements; not a nightmare diagnosis.</div>${abruptSleepPatternsCard().html}</section>`;
}
function coverageHtml(){
  const names=[['Steps','steps'],['Distance','distance_m'],['Sedentary','sedentary_seconds'],['Active minutes','active_minutes'],
               ['Active Zone Minutes','azm_cardio'],['Resting HR','resting_hr'],['HRV','hrv'],['SpO₂','spo2'],
               ['Resp rate','resp_rate'],['VO₂ max','vo2max'],['Body temp','body_temp']];
  const rows=names.map(([n,m])=>{const p=D.daily[m]||[],last=p.length?p[p.length-1][0]:'–';return `<tr><td>${n}</td><td>${p.length}</td><td>${last}</td></tr>`});
  return `<p class="sub">Rows stored locally.</p><div class="tablewrap"><table><thead><tr><th>Metric</th><th>Days stored</th><th>Latest</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><p class="sub">Last sync: ${D.last_sync?new Date(D.last_sync).toLocaleString():'—'}. ${Object.keys(D.errors||{}).length?'Sync errors present — see banner.':'No sync errors.'}</p>`;
}
let dbOptimizationNotice = "";
let dbOptimizationRunning = false;
let dbOptimizationPollTimer = null;

function databaseDiagnosticsHtml(){
  const r = D?.dbDiagnostics;
  if(!r) return `<div class="empty">Database diagnostics have not been loaded. <button class="act" type="button" onclick="refreshDatabaseDiagnostics()">Inspect storage now</button></div>`;
  const mib = n => (Number(n||0)/(1024*1024)).toFixed(2)+' MiB';
  const growth=r.daily_growth||{};
  const signed=n=>`${Number(n)>0?'+':''}${Number(n||0).toLocaleString()}`;
  const dailyStorage=growth.available?`${Number(growth.avg_bytes_per_day)>0?'+':''}${(Number(growth.avg_bytes_per_day||0)/(1024*1024)).toFixed(3)} MiB/day`:'Collecting daily snapshots';
  const notes=[];
  if(r.integrity!=='ok') notes.push(`<p class="status-pill bad">Integrity check needs attention: ${esc(r.integrity||'unknown')}</p>`);
  else notes.push(`<p class="status-pill good">SQLite integrity check passed</p>`);
  if(r.redundant_hr_raw_index) notes.push(`<p class="sub"><b>Storage saving available:</b> the redundant index <code>hr_raw_ts</code> can be safely removed.${r.table_size_available?` Its estimated size is ${mib((r.indexes||[]).find(x=>x.name==='hr_raw_ts')?.size_bytes)}.`:' Per-index size is unavailable in this SQLite build.'}</p>`);
  if(r.legacy_hr){
    notes.push(r.legacy_hr.safe_to_drop
      ? `<p class="sub">Legacy <code>hr</code> table: ${fmtN(r.legacy_hr.rows)} rows; ${fmtN(r.legacy_hr.missing)} timestamp(s) are missing from <code>hr_raw</code>. They can be merged before the old table is dropped.</p>`
      : `<p class="sub"><b>Legacy <code>hr</code> requires review.</b> ${fmtN(r.legacy_hr.conflicts)} conflicting BPM rows and ${fmtN(r.legacy_hr.invalid)} invalid rows mean it will be retained by safe cleanup.</p>`);
  }
  if(r.sleep_hr_rows) notes.push(`<p class="sub"><code>sleep_hr</code> contains ${fmtN(r.sleep_hr_rows)} records. It is retained because the dashboard uses it as a sleep-heart-rate fallback.</p>`);
  const tableRows=(r.tables||[]).slice().sort((a,b)=>(b.size_bytes||0)-(a.size_bytes||0)).map(t=>`<tr><td>${esc(t.name)}</td><td>${t.rows<0?'—':fmtN(t.rows)}</td><td>${t.size_bytes?mib(t.size_bytes):'—'}</td></tr>`).join('');
  const indexRows=(r.indexes||[]).slice().sort((a,b)=>(b.size_bytes||0)-(a.size_bytes||0)).map(i=>`<tr><td>${esc(i.name)}</td><td>${esc(i.table)}</td><td>${i.size_bytes?mib(i.size_bytes):'—'}</td><td>${i.redundant?'Redundant':'—'}</td></tr>`).join('');
  return `<div class="overview-grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
    <div class="consolidated"><h3>Database file</h3><div class="mval">${mib(r.file_size_bytes)}</div></div>
    <div class="consolidated"><h3>Raw HR samples</h3><div class="mval">${fmtN(r.hr_raw_rows)}</div></div>
    <div class="consolidated"><h3>Unused pages</h3><div class="mval">${mib(r.unused_bytes_estimate)}</div></div>
    <div class="consolidated"><h3>Integrity</h3><div class="mval" style="font-size:18px">${esc(r.integrity||'unknown')}</div></div>
    <div class="consolidated"><h3>Net records added per day</h3><div class="mval">${growth.available?signed(growth.avg_records_per_day):'—'}</div><div class="sub">${growth.available?`Daily average over ${fmtN(growth.tracking_days)} days`:'Starts after successful daily syncs'}</div></div>
    <div class="consolidated"><h3>Database footprint change</h3><div class="mval" style="font-size:16px">${esc(dailyStorage)}</div><div class="sub">${growth.available?`Page allocation average over ${fmtN(growth.tracking_days)} days`:'Daily snapshots begin after a successful sync'}</div></div>
  </div>
  <div class="sub" style="margin:8px 0">${notes.join('')} </div>
  <h3 style="font-size:12px;margin:16px 0 6px">Database tables · estimated storage, largest to smallest</h3>
  <div class="sub" style="margin:0 0 6px">Each table’s estimate includes its indexes. Daily growth is measured from successful-sync snapshots; record counts are net changes, while database footprint uses SQLite allocated pages and can shrink after compaction.</div>
  <div class="tablewrap"><table><thead><tr><th>Table</th><th>Rows</th><th>Estimated storage</th></tr></thead><tbody>${tableRows||'<tr><td colspan="3">Storage estimates unavailable</td></tr>'}</tbody></table></div>
  <h3 style="font-size:12px;margin:16px 0 6px">Indexes</h3>
  <div class="tablewrap"><table><thead><tr><th>Index</th><th>Table</th><th>Estimated storage</th><th>Assessment</th></tr></thead><tbody>${indexRows||'<tr><td colspan="4">No explicit indexes listed</td></tr>'}</tbody></table></div>
  <div class="sub" style="margin-top:12px">Read-only inspection · ${esc(r.path||'health.db')} · SQLite ${esc(r.sqlite_version||'')} · ${esc(r.journal_mode||'')} mode. For the full report, run <code>python gh.py diagnostics</code>.</div>
  <div id="dbOptimizeStatus" class="sub" role="status" aria-live="polite" style="margin-top:12px;min-height:18px">${dbOptimizationNotice}</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
    <button id="optimizeDatabaseButton" class="act" type="button" onclick="optimizeDatabase()" ${r.integrity!=='ok'?'disabled title="Cleanup is disabled until integrity_check passes"':''}>${dbOptimizationRunning?'Optimizing…':'Optimize database'}</button>
    <button class="act" type="button" onclick="refreshDatabaseDiagnostics()">Refresh diagnostics</button>
  </div>
  <div class="sub" style="margin-top:6px;font-size:11.5px">Optimization creates and verifies a timestamped backup first, removes only verified redundant storage, and checks integrity again. Keep the backup until you confirm the dashboard works.</div>`;
}

async function refreshDatabaseDiagnostics(){
  const host=$('#card-dbStorage .plot');
  if(host) host.innerHTML='<div class="empty">Inspecting database storage…</div>';
  try{
    const response=await fetch('/api/diagnostics');
    const report=await response.json();
    if(!response.ok) throw new Error(report.error||`HTTP ${response.status}`);
    if(D) D.dbDiagnostics=report;
    const target=$('#card-dbStorage .plot');
    if(target) target.innerHTML=databaseDiagnosticsHtml();
  }catch(ex){
    const target=$('#card-dbStorage .plot');
    if(target) target.innerHTML=`<div class="empty">Diagnostics unavailable: ${esc(ex.message)}. Run <code>python gh.py diagnostics</code> in Command Prompt.</div>`;
  }
}


function setDatabaseOptimizeNotice(html){
  dbOptimizationNotice=html;
  const host=$('#dbOptimizeStatus');
  if(host) host.innerHTML=html;
  const button=$('#optimizeDatabaseButton');
  if(button){ button.disabled=dbOptimizationRunning || D?.dbDiagnostics?.integrity!=='ok'; button.textContent=dbOptimizationRunning?'Optimizing…':'Optimize database'; }
}

async function optimizeDatabase(){
  const report=D?.dbDiagnostics;
  if(!report){ await refreshDatabaseDiagnostics(); }
  if(D?.dbDiagnostics?.integrity!=='ok'){
    setDatabaseOptimizeNotice('<span class="status-pill bad">Cleanup blocked: SQLite integrity check must be OK first.</span>');
    return;
  }
  if(dbOptimizationRunning) return;
  const before=(Number(D.dbDiagnostics.file_size_bytes||0)/(1024*1024)).toFixed(2);
  const message=`Optimize the personal health database?\n\nCurrent size: ${before} MiB.\n\nThe dashboard will create and verify a timestamped backup, safely remove the redundant index and remove the legacy hr table only if its rows are verified safe. sleep_hr will be retained. SQLite will then compact the database and run an integrity check.\n\nKeep the backup until you have confirmed all charts still work. Continue?`;
  if(!window.confirm(message)) return;
  dbOptimizationRunning=true;
  const button=$('#optimizeDatabaseButton');
  if(button){button.disabled=true;button.textContent='Starting…';}
  setDatabaseOptimizeNotice('Starting database optimization… The dashboard may respond more slowly while SQLite compacts the file.');
  try{
    const res=await fetch('/api/database/optimize',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'HealthDashboard'},body:JSON.stringify({confirmed:true})});
    const data=await res.json();
    if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
    setDatabaseOptimizeNotice('Backup and cleanup job starting…');
    pollDatabaseOptimization();
  }catch(ex){
    dbOptimizationRunning=false;
    setDatabaseOptimizeNotice(`<span class="status-pill bad">Optimization did not start: ${esc(ex.message)}</span>`);
    const b=$('#optimizeDatabaseButton'); if(b){b.disabled=false;b.textContent='Optimize database';}
  }
}

async function pollDatabaseOptimization(){
  try{
    const res=await fetch('/api/database/optimize/status',{cache:'no-store'});
    const state=await res.json();
    if(!res.ok) throw new Error(state.error||`HTTP ${res.status}`);
    if(state.running){
      dbOptimizationRunning=true;
      const last=(state.log||[]).slice(-1)[0]||state.stage||'Working…';
      setDatabaseOptimizeNotice(`<span>Optimizing database — ${esc(state.stage||'working')}.</span> <span class="sub">${esc(last)}</span>`);
      dbOptimizationPollTimer=setTimeout(pollDatabaseOptimization,1200);
      return;
    }
    dbOptimizationRunning=false;
    const b=$('#optimizeDatabaseButton'); if(b){b.disabled=false;b.textContent='Optimize database';}
    if(state.result?.ok){
      const result=state.result;
      const from=(Number(result.before_bytes||0)/(1024*1024)).toFixed(2);
      const to=(Number(result.after_bytes||0)/(1024*1024)).toFixed(2);
      const saved=(Number(result.bytes_saved||0)/(1024*1024)).toFixed(2);
      const backup=result.backup_path||'';
      setDatabaseOptimizeNotice(`<span class="status-pill good">Optimization complete · integrity ${esc(result.integrity_after||'unknown')}</span><p class="sub" style="margin:8px 0">Database size: <b>${from} MiB → ${to} MiB</b> · reclaimed <b>${saved} MiB</b>. ${Number(result.legacy_rows_merged||0)?`${fmtN(result.legacy_rows_merged)} legacy HR rows merged. `:''}${result.legacy_hr_dropped?'Legacy hr table removed. ':''}sleep_hr retained.</p><p class="sub" style="overflow-wrap:anywhere;margin:4px 0">Verified backup: <code>${esc(backup)}</code></p>`);
      await refreshDatabaseDiagnostics();
      setDatabaseOptimizeNotice(`<span class="status-pill good">Optimization complete · integrity ${esc(result.integrity_after||'unknown')}</span><p class="sub" style="margin:8px 0">Database size: <b>${from} MiB → ${to} MiB</b> · reclaimed <b>${saved} MiB</b>. ${Number(result.legacy_rows_merged||0)?`${fmtN(result.legacy_rows_merged)} legacy HR rows merged. `:''}${result.legacy_hr_dropped?'Legacy hr table removed. ':''}sleep_hr retained.</p><p class="sub" style="overflow-wrap:anywhere;margin:4px 0">Verified backup: <code>${esc(backup)}</code></p>`);
    }else{
      const err=state.error||'Unknown optimization error';
      setDatabaseOptimizeNotice(`<span class="status-pill bad">Optimization failed: ${esc(err)}</span><p class="sub">Check the server Command Prompt. A verified backup is retained if one was created.</p>`);
      await refreshDatabaseDiagnostics();
      setDatabaseOptimizeNotice(`<span class="status-pill bad">Optimization failed: ${esc(err)}</span><p class="sub">Check the server Command Prompt. A verified backup is retained if one was created.</p>`);
    }
  }catch(ex){
    dbOptimizationRunning=false;
    setDatabaseOptimizeNotice(`<span class="status-pill bad">Could not read optimization status: ${esc(ex.message)}</span>`);
    const b=$('#optimizeDatabaseButton'); if(b){b.disabled=false;b.textContent='Optimize database';}
  }
}

function karvonenThresholdChart(){
 const age=Number(D.settings?.age),fallback=age>0?208-.7*age:190,start=periodStart(period),daily=(D.daily?.resting_hr||[]).filter(r=>r&&r[0]&&Number.isFinite(Number(r[1]))&&Number(r[1])>0).map(r=>({day:String(r[0]),x:dayMs(String(r[0])),rhr:Number(r[1])})).sort((a,b)=>a.x-b.x),runs=(D.exercise||[]).filter(w=>!w.excluded&&String(w.type||'').toUpperCase().includes('RUN')&&Number.isFinite(Number(w.avg_hr))&&Number(w.avg_hr)>0),rows=daily.filter(r=>r.x>=start),fractions=[.5,.6,.7,.8,.9,1],levels=['50%','60%','70%','80%','90%'],colors=['#38BDF8','#22C55E','#F59E0B','#F97316','#F43F5E'];
 if(!rows.length)return '<div class="empty">No daily resting-heart-rate data in this date range.</div>';
 for(const q of rows){const cutoff=q.x-30*86400000,rhrWindow=daily.filter(d=>d.x>=cutoff&&d.x<=q.x),rollingRhr=rhrWindow.length?mean(rhrWindow.map(d=>d.rhr)):q.rhr,peakThreshold=rollingRhr+.9*(fallback-rollingRhr),peakRuns=runs.filter(w=>{const x=dayMs(String(w.day||''));return x>=cutoff&&x<=q.x&&Number(w.avg_hr)>=peakThreshold;}),maxHR=peakRuns.length?mean(peakRuns.map(w=>Number(w.avg_hr))):fallback;q.maxHR=maxHR;q.runCount=peakRuns.length;q.edges=fractions.map(f=>q.rhr+(maxHR-q.rhr)*f);}
 for(const q of rows){const prior=rows.filter(d=>d.x>=q.x-6*86400000&&d.x<=q.x);q.smoothRhr=mean(prior.map(d=>d.rhr));q.smoothEdges=fractions.map((_,j)=>mean(prior.map(d=>d.edges[j])));}
 const base=rows[0].edges,changes=rows.map(q=>q.edges.map((v,i)=>v-base[i])),smoothChanges=rows.map(q=>q.smoothEdges.map((v,i)=>v-rows[0].smoothEdges[i])),rhrChanges=rows.map(q=>q.rhr-rows[0].rhr),smoothRhrChanges=rows.map(q=>q.smoothRhr-rows[0].smoothRhr),W=1120,H=400,L=78,R=74,T=18,B=30,plotW=W-L-R,x0=rows[0].x,x1=rows.at(-1).x,X=x=>L+(x1===x0?.5:(x-x0)/(x1-x0))*plotW,step=rows.length>1?plotW/(rows.length-1):plotW,cellW=Math.max(2,Math.min(20,step*.78)),heatTop=T,heatRowH=10,sparkTop=T+6*heatRowH+23,sparkRowH=39,sparkSpan=32,right=W-R;
 const color=(v,scale)=>{const strength=Math.min(1,Math.abs(v)/scale);if(Math.abs(v)<.05)return 'rgba(161,161,170,.28)';return v<0?`rgba(249,115,22,${(.16+.80*strength).toFixed(2)})`:`rgba(56,189,248,${(.16+.80*strength).toFixed(2)})`;},rawFor=j=>j<5?changes.map(a=>a[j]):rhrChanges,smoothFor=j=>j<5?smoothChanges.map(a=>a[j]):smoothRhrChanges,heatScaleMode=window._karvonenHeatScale||'global';
 let plateauIndex=-1;for(let i=3;i<=rows.length-3;i++){const stable=rows.slice(i,i+3).map(q=>q.smoothRhr),before=rows.slice(Math.max(0,i-7),i).map(q=>q.smoothRhr);if(stable.length===3&&before.length>=2&&Math.max(...stable)-Math.min(...stable)<=.6&&mean(before)-mean(stable)>=1){plateauIndex=i;break;}}
 let svg=`<svg class="karvonen-threshold-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Karvonen deviation heatmap strip and shared-scale small-multiple sparklines with resting heart rate" onpointermove="window.karvonenChartMove(event)" onpointerleave="window.karvonenChartLeave(event)">`;
 const tickCount=Math.min(7,rows.length),tickIndices=[...new Set(Array.from({length:tickCount},(_,i)=>Math.round(i*(rows.length-1)/Math.max(1,tickCount-1))))];for(const i of tickIndices){const q=rows[i];svg+=`<text x="${X(q.x)}" y="${H-8}" text-anchor="middle" fill="var(--axis-text)" font-size="10">${esc(fmtDay(q.x))}</text>`;}
 const heatLabels=[...levels,'RHR'];for(let j=0;j<6;j++){const y=heatTop+j*heatRowH,label=heatLabels[j],vals=rawFor(j),rowScale=heatScaleMode==='row'?Math.max(1,...vals.map(Math.abs)):10;svg+=`<text x="${L-9}" y="${y+8}" text-anchor="end" fill="var(--axis-text)" font-size="9">${label}</text>`;for(let i=0;i<rows.length;i++){const x=X(rows[i].x),v=vals[i];svg+=`<rect x="${(x-cellW/2).toFixed(1)}" y="${y}" width="${cellW.toFixed(1)}" height="8" rx="1.5" fill="${color(v,rowScale)}"><title>${rows[i].day} · ${label} deviation ${v>=0?'+':''}${v.toFixed(1)} bpm</title></rect>`;}}
 const sparkRows=6;for(let j=0;j<sparkRows;j++){const y=sparkTop+j*sparkRowH,label=j<5?`${levels[j]} boundary`:'Resting HR',vals=rawFor(j),smoothed=smoothFor(j),stroke=j<5?colors[j]:'#14B8A6',cy=y+sparkRowH/2,yy=v=>cy-Math.max(-10,Math.min(10,v))/10*(sparkSpan/2),sx=i=>X(rows[i].x);svg+=`<text x="${L-9}" y="${cy+3}" text-anchor="end" fill="var(--axis-text)" font-size="10">${label}</text><line x1="${L}" x2="${right}" y1="${cy}" y2="${cy}" stroke="var(--grid)" stroke-opacity=".55"/>`;
 const rawPts=vals.map((v,i)=>`${sx(i).toFixed(1)},${yy(v).toFixed(1)}`).join(' '),smoothPts=smoothed.map((v,i)=>`${sx(i).toFixed(1)},${yy(v).toFixed(1)}`).join(' ');svg+=`<polyline points="${rawPts}" fill="none" stroke="#A1A1AA" stroke-opacity=".42" stroke-width="1"/><polyline points="${smoothPts}" fill="none" stroke="${stroke}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><text x="${right+7}" y="${cy+3}" fill="${stroke}" font-size="10" font-weight="700">${smoothed.at(-1)>=0?'+':''}${smoothed.at(-1).toFixed(1)}</text>`;}
 if(plateauIndex>=0){const x=X(rows[plateauIndex].x);svg+=`<line x1="${x}" x2="${x}" y1="${heatTop-2}" y2="${sparkTop+sparkRows*sparkRowH-4}" stroke="#E4E4E7" stroke-opacity=".8" stroke-dasharray="3 4"/><rect x="${Math.min(right-120,x+5)}" y="${sparkTop-15}" width="112" height="14" rx="4" fill="#18181B" stroke="#52525B"/><text x="${Math.min(right-64,x+61)}" y="${sparkTop-5}" text-anchor="middle" fill="#E4E4E7" font-size="9">RHR stabilizes</text>`;}
 for(let i=0;i<rows.length;i++){const q=rows[i],x=X(q.x);svg+=`<g class="karvonen-day" data-x="${x}" data-day="${esc(q.day)}" data-rhr="${q.rhr.toFixed(1)}" data-smooth-rhr="${q.smoothRhr.toFixed(1)}" data-max="${q.maxHR.toFixed(1)}" data-runs="${q.runCount}" data-dev="${changes[i].slice(0,5).map(v=>v.toFixed(1)).join(',')}" data-smooth="${smoothChanges[i].slice(0,5).map(v=>v.toFixed(1)).join(',')}" data-rhr-dev="${rhrChanges[i].toFixed(1)}" data-smooth-rhr-dev="${smoothRhrChanges[i].toFixed(1)}"><rect x="${x-cellW/2}" y="${heatTop-3}" width="${cellW}" height="${H-heatTop-B}" fill="transparent"/><line class="karvonen-active-guide" x1="${x}" x2="${x}" y1="${heatTop-2}" y2="${H-B}" visibility="hidden" stroke="#E4E4E7" stroke-opacity=".72" stroke-dasharray="3 4" pointer-events="none"/></g>`;}
 svg+='</svg>';const scaleButton=`<button class="act" type="button" onclick="window.toggleKarvonenScale()" aria-pressed="${heatScaleMode==='row'}">Heatmap: ${heatScaleMode==='row'?'per row':'global ±10 bpm'}</button>`,legend=`<div class="legend karvonen-legend"><span><i style="background:#F97316"></i>Below baseline</span><span><i style="background:#A1A1AA"></i>Near zero</span><span><i style="background:#38BDF8"></i>Above baseline</span><span><i style="background:#14B8A6"></i>7-day average</span><span><i style="background:#A1A1AA;opacity:.45"></i>Raw values</span></div>`;
 return `<div class="karvonen-chart-wrap"><div class="karvonen-chart-meta"><span>Deviation from ${esc(fmtDay(rows[0].x))}</span><span>Latest: ${esc(fmtDay(rows.at(-1).x))}</span>${scaleButton}</div>${svg}<div class="karvonen-floater" role="status" aria-live="polite"></div>${legend}<div class="sub">The narrow strip shows daily deviations; the sparklines are the main view and share a fixed ±10 bpm vertical scale. Values at the right are latest 7-day averages; raw values are faint behind each line. The 100% row is omitted. ${plateauIndex>=0?'A vertical marker identifies a detected resting-HR plateau.':'No sustained resting-HR plateau was detected in this period.'}</div></div>`;
}window.karvonenChartMove=function(e){const svg=e.currentTarget,wrap=svg.closest('.karvonen-chart-wrap'),days=[...svg.querySelectorAll('.karvonen-day')];if(!wrap||!days.length)return;const rect=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal,x=(e.clientX-rect.left)/rect.width*vb.width,near=days.reduce((a,b)=>Math.abs(+b.dataset.x-x)<Math.abs(+a.dataset.x-x)?b:a,days[0]),guide=svg.querySelectorAll('.karvonen-active-guide');guide.forEach(g=>{g.setAttribute('x1',near.dataset.x);g.setAttribute('x2',near.dataset.x);g.setAttribute('visibility','visible');});const dev=near.dataset.dev.split(',').map(Number),smooth=near.dataset.smooth.split(',').map(Number),levels=['50%','60%','70%','80%','90%'],colors=['#38BDF8','#22C55E','#F59E0B','#F97316','#F43F5E'],fmt=v=>`${v>=0?'+':''}${v.toFixed(1)} bpm`,tip=wrap.querySelector('.karvonen-floater');tip.innerHTML=`<b>${new Date(near.dataset.day+'T12:00:00').toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'})}</b><div class="karvonen-floater-meta">Daily RHR ${near.dataset.rhr} bpm · 7-day avg ${near.dataset.smoothRhr} bpm · Max HR ${near.dataset.max} bpm · ${near.dataset.runs} qualifying runs</div>${levels.map((v,i)=>`<div class="karvonen-floater-row"><span><i style="background:${colors[i]}"></i>${v} boundary</span><b>raw ${fmt(dev[i])} · 7d ${fmt(smooth[i])}</b></div>`).join('')}<div class="karvonen-floater-row"><span><i style="background:#14B8A6"></i>Resting HR</span><b>raw ${fmt(Number(near.dataset.rhrDev))} · 7d ${fmt(Number(near.dataset.smoothRhrDev))}</b></div>`;tip.style.display='block';const wr=wrap.getBoundingClientRect(),left=Math.max(6,Math.min(wrap.clientWidth-tip.offsetWidth-6,e.clientX-wr.left+14)),top=Math.max(6,Math.min(wrap.clientHeight-tip.offsetHeight-6,e.clientY-wr.top+12));tip.style.left=left+'px';tip.style.top=top+'px';};
window.karvonenChartLeave=function(e){const wrap=e.currentTarget.closest('.karvonen-chart-wrap');if(!wrap)return;const tip=wrap.querySelector('.karvonen-floater');if(tip)tip.style.display='none';wrap.querySelectorAll('.karvonen-active-guide').forEach(g=>g.setAttribute('visibility','hidden'));};window.toggleKarvonenScale=function(){window._karvonenHeatScale=window._karvonenHeatScale==='row'?'global':'row';const card=document.querySelector('#card-available-later');if(card&&typeof renderCardByElement==='function')renderCardByElement(card,true);};function additionalDataHtml(){
  const age=Number(D.settings?.age),zoneCfg=D.zone_limits||{},rhr=Number(zoneCfg.rhr)||Number(lastVal('resting_hr'))||60,max=Number(zoneCfg.max_hr)||(age>0?208-.7*age:190),reserve=max-rhr,edges=Array.isArray(zoneCfg.edges)&&zoneCfg.edges.length===6?zoneCfg.edges:[.5,.6,.7,.8,.9,1].map(p=>rhr+reserve*p),runBased=max!== (age>0?208-.7*age:190),calcRows=[['Resting HR baseline','30-day mean',`${rhr.toFixed(1)} bpm`],['Maximum HR',runBased?'Observed workout HR peak / run average':'208 − 0.7 × age / fallback',`${max.toFixed(1)} bpm`],['Heart-rate reserve','Maximum HR − resting HR',`${reserve.toFixed(1)} bpm`],...ZONE_DEFS.map((z,i)=>[`${z.label} · ${z.name}`,i===0?'Below 60% HRR':`${[60,70,80,90][i-1]}–${[70,80,90,100][i-1]}% HRR`,i===0?`Below ${edges[i+1].toFixed(1)} bpm`:`${edges[i].toFixed(1)}–${edges[i+1].toFixed(1)} bpm`])],todayCalculations=`<h3 style="font-size:13px;margin:12px 0 6px">Today’s Karvonen calculations</h3><div class="tablewrap"><table><thead><tr><th>Calculation</th><th>Basis</th><th>Today</th></tr></thead><tbody>${calcRows.map(r=>`<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</tbody></table></div>`;
  const spo=(D.spo2_samples||[]).filter(r=>Number.isFinite(Number(r[1]))),byDay=new Map();for(const [ts,v] of spo){const day=localDateKey(+ts);if(!day)continue;const a=byDay.get(day)||[];a.push(+v);byDay.set(day,a);}const overnight=[...byDay].sort((a,b)=>a[0].localeCompare(b[0])).slice(-14).map(([day,vals])=>({day,n:vals.length,min:Math.min(...vals),avg:mean(vals)}));
  const apnea=overnight.length?`<p class="sub">Overnight SpO₂ coverage: ${overnight.length} nights with measurements.</p><div class="tablewrap"><table><thead><tr><th>Date</th><th>Samples</th><th>Lowest</th><th>Mean</th></tr></thead><tbody>${overnight.map(x=>`<tr><td>${x.day}</td><td>${x.n}</td><td>${x.min.toFixed(1)}%</td><td>${x.avg.toFixed(1)}%</td></tr>`).join('')}</tbody></table></div>`:`<p class="sub">No timestamped SpO₂ readings are available for this period.</p>`;
  return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px"><section class="consolidated"><h3>Karvonen threshold deviation heatmap</h3>${karvonenThresholdChart()}${todayCalculations}</section><section class="consolidated"><h3>Overnight SpO₂ · breathing signals</h3>${apnea}<p class="sub">Descriptive context, not an apnea diagnosis. Consider clinical assessment for symptoms such as loud snoring, witnessed pauses or daytime sleepiness.</p></section></div>`;
}

