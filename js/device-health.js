/* ============================================================
   CARDS ARRAY
   ============================================================ */
function metricRangeState(){if(!window._metricRanges){try{window._metricRanges=JSON.parse(localStorage.getItem('health-metric-ranges')||'{}');}catch(_){window._metricRanges={};}}return window._metricRanges;}
function metricRangeStart(key){
 const range=metricRangeState()[key]||'dashboard';
 if(range==='dashboard')return periodStart(period);
 if(range==='all')return -Infinity;
 return dayMs(localDateKey(Date.now()))-(Number(range)-1)*DAY;
}
window.setMetricRange=function(key,value){window._metricRanges=window._metricRanges||{};window._metricRanges[key]=value;try{localStorage.setItem('health-metric-ranges',JSON.stringify(window._metricRanges));}catch(_){}const card=document.querySelector('#card-'+key);if(card)renderCardByElement(card,true);};
function activityFourDayTicks(start,end){
 const dayStart=dayMs(localDateKey(start));if(!Number.isFinite(dayStart)||!Number.isFinite(end))return [];
 const span=end-dayStart,stepDays=span<=35*DAY?4:Math.max(4,Math.ceil(span/(8*DAY)/4)*4),step=stepDays*DAY;
 const d=new Date(dayStart);let tick=new Date(d.getFullYear(),d.getMonth(),6).getTime();if(tick<dayStart)tick+=Math.ceil((dayStart-tick)/step)*step;
 const out=[];for(;tick<=end;tick+=step)out.push(tick);return out;
}
function metricRangeSelect(key){const range=metricRangeState()[key]||'dashboard';return `<label>Period <select class="act" aria-label="${key==='vitals'?'Vitals':'Calories'} chart period" onchange="window.setMetricRange('${key}',this.value)"><option value="dashboard" ${range==='dashboard'?'selected':''}>Dashboard range</option><option value="7" ${range==='7'?'selected':''}>7 days</option><option value="30" ${range==='30'?'selected':''}>30 days</option><option value="90" ${range==='90'?'selected':''}>90 days</option><option value="360" ${range==='360'?'selected':''}>360 days</option><option value="all" ${range==='all'?'selected':''}>All loaded history</option></select></label>`;}
function vitalsControls(){
 const metric=window._vitalsMetric||'weight';
 return `<div class="workout-controls"><label>Metric <select aria-label="Vitals graph metric" onchange="window.setVitalsMetric(this.value)"><option value="weight" ${metric==='weight'?'selected':''}>Weight</option><option value="bp" ${metric==='bp'?'selected':''}>Blood pressure</option></select></label>${metricRangeSelect('vitals')}<span class="sub">${metric==='weight'?'kg':'mmHg'}</span></div>`;
}
function buildVitalsChart(){
 const metric=window._vitalsMetric||'weight',start=metricRangeStart('vitals'),dateRows=metric==='weight'?(D.daily?.weight||[]).map(r=>({day:String(r[0]),a:+r[1]})):(()=>{const s=Object.fromEntries((D.daily?.systolic_bp||[]).map(r=>[String(r[0]),+r[1]])),d=Object.fromEntries((D.daily?.diastolic_bp||[]).map(r=>[String(r[0]),+r[1]]));return [...new Set([...Object.keys(s),...Object.keys(d)])].map(day=>({day,a:s[day],b:d[day]}));})(),pts=dateRows.filter(q=>dayMs(q.day)>=start&&(metric==='weight'?Number.isFinite(q.a)&&q.a>=20&&q.a<=400:Number.isFinite(q.a)||Number.isFinite(q.b))).sort((a,b)=>a.day.localeCompare(b.day));

 if(!pts.length)return {html:`<div class="empty">No ${metric==='weight'?'weight':'blood-pressure'} measurements are available for this period.</div>`,headerKpi:'—'};
 const vals=pts.flatMap(q=>metric==='weight'?[q.a]:[q.a,q.b]).filter(Number.isFinite),lo=metric==='weight'?Math.floor((Math.min(...vals)-2)/5)*5:Math.floor((Math.min(...vals)-10)/10)*10,hi=metric==='weight'?Math.ceil((Math.max(...vals)+2)/5)*5:Math.ceil((Math.max(...vals)+10)/10)*10,W=760,H=260,L=52,R=116,T=16,B=34,rangeStart=Number.isFinite(start)?dayMs(localDateKey(start)):dayMs(pts[0].day),rangeEnd=dayMs(D.today),x0=localDateKey(rangeStart),x1=localDateKey(rangeEnd+DAY),X=d=>L+(x1===x0?.5:(dayMs(d)-dayMs(x0))/(dayMs(x1)-dayMs(x0)))*(W-L-R),Y=v=>T+(hi-v)/(hi-lo||1)*(H-T-B);
 let svg=`<svg class="vitals-interactive-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Vitals ${metric==='weight'?'weight in kilograms':'blood pressure in millimeters of mercury'}" onpointermove="window.vitalsHover(event)" onpointerleave="window.vitalsHoverLeave(event)" style="display:block;width:100%;height:auto;touch-action:pan-y">`;for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,y=Y(v);svg+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="var(--grid)" stroke-dasharray="3 4"/><text class="activity-chart-axis" x="${L-7}" y="${y+4}" text-anchor="end" fill="var(--axis-text)" font-size="10" font-variant-numeric="tabular-nums">${v.toFixed(0)} ${metric==='weight'?'kg':''}</text>`;}
 if(metric==='weight'){const average=mean(pts.map(q=>q.a)),badgeY=Math.max(T+2,Math.min(H-B-22,Y(average)-10));if(Number.isFinite(average))svg+=`<line x1="${L}" x2="${W-R}" y1="${Y(average)}" y2="${Y(average)}" stroke="#C084FC" stroke-width="1.5" stroke-dasharray="5 4"/><rect x="${W-R+6}" y="${badgeY}" width="102" height="20" rx="10" fill="rgba(21,31,41,.92)" stroke="#C084FC" stroke-opacity=".48"/><text x="${W-R+57}" y="${badgeY+13.5}" text-anchor="middle" fill="#E8D5FF" font-size="9.5" font-weight="700" font-variant-numeric="tabular-nums">${average.toFixed(1)} KG AVG</text>`;}
 const series=(key,col,label)=>{const a=pts.filter(q=>Number.isFinite(q[key]));if(!a.length)return '';const coords=a.map(q=>({x:X(q.day),y:Y(q[key])}));let marks;if(metric==='weight'&&coords.length>1){const curve=catmullRom(coords,.3),lineD=curve.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(''),areaD=`M${coords[0].x.toFixed(1)},${H-B}L${curve.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}L${coords.at(-1).x.toFixed(1)},${H-B}Z`;marks=`<defs><linearGradient id="weight-area-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#C084FC" stop-opacity=".12"/><stop offset="100%" stop-color="#C084FC" stop-opacity="0"/></linearGradient></defs><path d="${areaD}" fill="url(#weight-area-gradient)"/><path d="${lineD}" fill="none" stroke="${col}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" filter="drop-shadow(0 0 8px rgba(192, 132, 252, 0.65))"/>`;}else marks=`<polyline fill="none" stroke="${col}" stroke-width="2.5" points="${a.map(q=>`${X(q.day).toFixed(1)},${Y(q[key]).toFixed(1)}`).join(' ')}"/>`;return marks+a.map(q=>`<circle class="vitals-point" data-day="${q.day}" data-cx="${X(q.day)}" data-value="${q[key]}" data-label="${label}" cx="${X(q.day)}" cy="${Y(q[key])}" r="4" fill="${col}" tabindex="0"><title>${q.day}: ${label} ${q[key].toFixed(1)}${metric==='weight'?' kg':' mmHg'}</title></circle>`).join('');};
 for(const tick of activityFourDayTicks(rangeStart,rangeEnd)){const labelDate=localDateKey(tick);if(dayMs(labelDate)<rangeStart||dayMs(labelDate)>rangeEnd)continue;svg+=`<text class="activity-chart-axis" x="${X(labelDate)}" y="${H-9}" text-anchor="middle" fill="var(--axis-text)" font-size="10">${fmtDay(tick)}</text>`;}
 svg+=metric==='weight'?series('a','#A78BFA','Weight'):series('a','#F97316','Systolic')+series('b','#38BDF8','Diastolic');svg+=`<line class="vitals-crosshair" x1="0" x2="0" y1="${T}" y2="${H-B}" stroke="var(--ink2)" stroke-dasharray="3 4" visibility="hidden"/></svg>`;
 return {html:`<div class="vitals-chart-wrap" style="position:relative">${svg}<div class="hrv-hover-tip vitals-hover-tip" role="status" aria-live="polite"></div></div><div class="legend">${metric==='weight'?'<span><i style="background:#C084FC"></i>Weight</span>':'<span><i style="background:#FB923C"></i>Systolic</span><span><i style="background:#38BDF8"></i>Diastolic</span>'}</div><div class="sub">${pts.length} measurement dates shown · hover or focus to snap to recorded values.</div>`,headerKpi:metric==='weight'?`${mean(pts.map(q=>q.a)).toFixed(1)} kg avg`:`${Number.isFinite(mean(pts.map(q=>q.a).filter(Number.isFinite)))?mean(pts.map(q=>q.a).filter(Number.isFinite)).toFixed(0):'—'}/${Number.isFinite(mean(pts.map(q=>q.b).filter(Number.isFinite)))?mean(pts.map(q=>q.b).filter(Number.isFinite)).toFixed(0):'—'} mmHg avg`};
}
window.vitalsHover=function(e){const svg=e.currentTarget,wrap=svg.closest('.vitals-chart-wrap'),marks=[...svg.querySelectorAll('.vitals-point')];if(!wrap||!marks.length)return;const r=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal,x=(e.clientX-r.left)/r.width*vb.width,near=marks.reduce((a,b)=>Math.abs(+a.dataset.cx-x)<=Math.abs(+b.dataset.cx-x)?a:b,marks[0]),day=near.dataset.day,at=marks.filter(p=>p.dataset.day===day),cross=svg.querySelector('.vitals-crosshair');cross?.setAttribute('x1',near.dataset.cx);cross?.setAttribute('x2',near.dataset.cx);cross?.setAttribute('visibility','visible');const tip=wrap.querySelector('.vitals-hover-tip');tip.innerHTML=`<b>${new Date(day+'T12:00:00').toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'})}</b>${at.map(p=>`<div>${p.dataset.label}: <strong>${Number(p.dataset.value).toFixed(1)} ${window._vitalsMetric==='weight'?'kg':'mmHg'}</strong></div>`).join('')}`;tip.style.display='block';const wr=wrap.getBoundingClientRect(),left=Math.max(4,Math.min(wrap.clientWidth-tip.offsetWidth-4,e.clientX-wr.left+12)),top=Math.max(4,Math.min(wrap.clientHeight-tip.offsetHeight-4,e.clientY-wr.top+12));tip.style.left=left+'px';tip.style.top=top+'px';};
window.vitalsHoverLeave=function(e){const wrap=e.currentTarget.closest('.vitals-chart-wrap');if(wrap){const tip=wrap.querySelector('.vitals-hover-tip');if(tip)tip.style.display='none';const cross=wrap.querySelector('.vitals-crosshair');cross?.setAttribute('visibility','hidden');}};
window.setVitalsMetric=value=>{window._vitalsMetric=value;const c=document.querySelector('#card-vitals');if(c)renderCardByElement(c,true);};
function quickDrain(m){const v=(m.valid||[]).slice(-40);if(v.length<4)return null;const hrs=(Number(v[v.length-1].time)-Number(v[0].time))/3600,drop=Number(v[0].level)-Number(v[v.length-1].level);if(hrs<6||drop<=0)return null;for(let i=1;i<v.length;i++)if(Number(v[i].level)-Number(v[i-1].level)>=5)return null;const rate=drop/hrs;return {rate,days:Number(m.level)/(rate*24),rough:true};}
function deviceInsightLine(m,kind){if(!m||!m.device)return '';const parts=[];if(kind==='battery'&&m.level!=null){const quick=quickDrain(m);if(quick){const emptyAt=new Date(Date.now()+quick.days*86400000);parts.push(`${m.level}% battery · likely empty around ${emptyAt.toLocaleString([], {weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'})}`);}else{parts.push(`${m.level}% battery · still learning your drain rate`);}}if(kind==='wear'){if(m.avgWear!=null)parts.push(`Worn ${Math.round(m.avgWear/24*100)}% of the last 14 days`);if(m.avgGaps!=null)parts.push(`${m.avgGaps.toFixed(1)} h/day without heart-rate data`);}if(!parts.length)return '';return `<p class="dh-insight">${parts.join(' · ')}.</p>`;}
function abruptSleepPatternsCard(){
 const since=periodStart(period),sessions=(D.sleep||[]).filter(s=>s.main&&!s.nap&&s.start&&s.end&&new Date(s.end).getTime()>=since),counts={stage:[0,0],hr:[0,0],spo2:[0,0],aligned:[0,0]},eventDetails=[];
 const median=a=>{a=a.filter(Number.isFinite).sort((x,y)=>x-y);return a.length?(a.length%2?a[a>>1]:(a[a.length/2-1]+a[a.length/2])/2):0;};
 const classify=(arr,key,signal,describe)=>{const sorted=arr.slice().sort((a,b)=>a.t-b.t),seen=new Set();for(const e of sorted){if(seen.has(e))continue;let group=[e],last=e.t;seen.add(e);for(const q of sorted){if(!seen.has(q)&&q.t-last<=5*60000){group.push(q);seen.add(q);last=q.t;}}const span=Math.max(group[group.length-1].t-group[0].t,...group.map(q=>(q.end||q.t)-q.t)),sustained=group.length>=3||span>=2*60000?1:0;counts[key][sustained]++;const strongest=group.reduce((x,y)=>(y.score||0)>(x.score||0)?y:x,group[0]);eventDetails.push({t:group[0].t,signal,duration:Math.max(span,...group.map(q=>q.end?q.end-q.t:0)),type:sustained?'Sustained':'Momentary',evidence:describe(strongest,group)});}};
 for(const s of sessions){const a=new Date(s.start).getTime(),b=new Date(s.end).getTime();if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)continue;const stages=(D.sleep_stages_by_id?.[s.id]||[]).map(q=>({a:+q.start,b:+q.end,type:String(q.type||'').toUpperCase()})).filter(q=>q.b>q.a).sort((x,y)=>x.a-y.a);
  const awake=[];for(const q of stages)if(q.type==='AWAKE'){const prev=stages.slice().reverse().find(p=>p.b<=q.a&&p.type==='REM');if(prev&&q.a-prev.b<=5*60000)awake.push({t:q.a,end:q.b,score:q.b-q.a});}classify(awake,'stage','REM → awake',q=>`Awake stage ${Math.max(1,Math.round(q.score/60000))} min`);
  const hr=(D.sleep_hr?.[s.id]||[]).map(r=>({t:+r[0],v:+r[1]})).filter(q=>q.t>=a&&q.t<=b&&Number.isFinite(q.v)&&!stages.some(z=>z.type==='AWAKE'&&q.t>=z.a&&q.t<z.b)).sort((x,y)=>x.t-y.t),sp=(D.spo2_samples||[]).map(r=>({t:+r[0],v:+r[1]})).filter(q=>q.t>=a&&q.t<=b&&Number.isFinite(q.v)&&q.v>=50&&q.v<=100).sort((x,y)=>x.t-y.t),hv=(D.sleep_hrv?.[s.id]||[]).map(r=>({t:+r[0],v:+r[1]})).filter(q=>q.t>=a&&q.t<=b&&Number.isFinite(q.v)).sort((x,y)=>x.t-y.t);
  const hrEvents=[];for(let i=4;i<hr.length;i++){const base=hr.slice(Math.max(0,i-10),i).filter(q=>hr[i].t-q.t<=12*60000).map(q=>q.v);if(base.length<4)continue;const m=median(base),mad=median(base.map(v=>Math.abs(v-m))),threshold=m+Math.max(12,4.45*mad);if(hr[i].v>=threshold)hrEvents.push({t:hr[i].t,v:hr[i].v,base:m,score:hr[i].v-threshold});}classify(hrEvents,'hr','Sleeping HR spike',q=>`Peak ${q.v.toFixed(0)} bpm; local baseline ${q.base.toFixed(0)} bpm; +${(q.v-q.base).toFixed(0)} bpm`);
  const spoEvents=[];for(let i=2;i<sp.length;i++){const local=sp.filter(q=>Math.abs(q.t-sp[i].t)<=5*60000);if(local.length<3)continue;const vals=local.map(q=>q.v),low=Math.min(...vals),high=Math.max(...vals);if(high-low>=3)spoEvents.push({t:sp[i].t,low,high,score:high-low});}classify(spoEvents,'spo2','SpO₂ variation',q=>`Local range ${q.low.toFixed(1)}–${q.high.toFixed(1)}% (${(q.high-q.low).toFixed(1)} point spread)`);
  const spoMid=median(sp.map(x=>x.v)),hrvMid=median(hv.map(x=>x.v)),hrvMad=median(hv.map(x=>Math.abs(x.v-hrvMid))),localSpo=sp.filter(q=>q.v<=Math.min(94,spoMid-2)),localHrv=hv.filter(q=>q.v<hrvMid-Math.max(2,2*1.4826*hrvMad)),aligned=localSpo.filter(q=>localHrv.some(x=>Math.abs(x.t-q.t)<=10*60000)).map(q=>{const near=localHrv.reduce((best,x)=>Math.abs(x.t-q.t)<Math.abs(best.t-q.t)?x:best,localHrv[0]);return {t:q.t,v:q.v,hrv:near.v,score:spoMid-q.v};});classify(aligned,'aligned','SpO₂ + low HRV',q=>`SpO₂ ${q.v.toFixed(1)}%; nearby HRV ${q.hrv.toFixed(1)} ms (within 10 min)`);
 }
 const rows=[['REM followed by awake stage',...counts.stage],['Sleeping heart-rate spike',...counts.hr],['SpO₂ high-variation episode',...counts.spo2],['SpO₂ variation with low HRV nearby',...counts.aligned]],label=period==='all'?'All available data':period==='ytd'?'Year to date':`Selected ${days}-day period`,dateTime=t=>new Date(t).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 eventDetails.sort((a,b)=>b.t-a.t);const details=eventDetails.length?`<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:650">Event details · ${eventDetails.length} flagged events</summary><div class="tablewrap" style="margin-top:8px;max-height:420px;overflow:auto"><table><thead><tr><th>Date / time</th><th>Pattern</th><th>Duration</th><th>Measurement context</th></tr></thead><tbody>${eventDetails.slice(0,250).map(e=>`<tr><td>${esc(dateTime(e.t))}</td><td>${esc(e.signal)} · ${e.type}</td><td>${e.duration?`${Math.max(1,Math.round(e.duration/60000))} min`:'Momentary'}</td><td>${esc(e.evidence)}</td></tr>`).join('')}</tbody></table></div>${eventDetails.length>250?'<div class="sub">Showing the newest 250 events.</div>':''}</details>`:'<p class="sub" style="margin:10px 0 0">No events met these approximate thresholds in the selected period.</p>';
 const html=`<div class="sub" style="margin:0 0 10px">${label} · Main sleep sessions only · counts are sensor-pattern flags</div><div class="tablewrap"><table><thead><tr><th>Signal</th><th>Momentary events</th><th>Sustained events</th></tr></thead><tbody>${rows.map(r=>`<tr>${r.map((v,i)=>`<td>${i===0?esc(v):v}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${details}<p class="sub" style="margin:10px 0 0">Approximate arousal screening only; these signals cannot determine dream content or diagnose nightmares. Missing stage/sample data is not counted. No movement/accelerometer stream is available here.</p>`;
 return {html,cols:['Signal','Momentary events','Sustained events'],rows};
}
function deviceActivitySummary(range='month'){
  const count=range==='day'?1:range==='week'?7:30,rows=(window._deviceHealthData?.coverage_grid||[]).slice(-count),start=rows.length?new Date(`${rows[0].day}T00:00:00`).getTime():Date.now(),last=rows.at(-1)?.day,end=last?Math.min(Date.now(),(()=>{const d=new Date(`${last}T00:00:00`);d.setDate(d.getDate()+1);return d.getTime();})()):Date.now(),sum=(items,whole=false)=>(items||[]).reduce((n,q)=>{const a=Date.parse(q.start),b=Date.parse(q.end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=start||a>=end)return n;return n+(whole&&b<=end?b-a:Math.max(0,Math.min(b,end)-Math.max(a,start)))/60000;},0),fmt=m=>{const v=Math.round(m),d=Math.floor(v/1440),h=Math.floor(v%1440/60),r=v%60;return d?`${d}d ${h}h`:h?`${h}h ${r}m`:`${r}m`;};
  return {sleep:fmt(sum(window._deviceHealthData?.sleep_sessions,true)),exercise:fmt(sum(window._deviceHealthData?.exercise_sessions)),label:range==='day'?'Daily':range==='week'?'Weekly':'Monthly'};
}
function deviceBatteryActivityBands(X,start,end,T,bottom){
  const data=window._deviceHealthData||{},now=Date.now(),fmtDuration=ms=>{const n=Math.max(1,Math.round(ms/60000));return n>=60?`${Math.floor(n/60)} h ${n%60?`${n%60} min`:''}`:`${n} min`;};let out='';
  for(const [kind,items] of [['sleep',data.sleep_sessions||[]],['exercise',data.exercise_sessions||[]]])for(const ev of items){const a=Date.parse(ev.start),b=Date.parse(ev.end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)continue;const lo=Math.max(a,start*1000),hi=Math.min(b,end*1000,now);if(hi<=lo)continue;const x1=X(lo/1000),x2=X(hi/1000),name=kind==='sleep'?(ev.nap?'Nap':'Sleep'):(ev.name||String(ev.type||'Exercise').replace(/_/g,' ')),date=new Date(lo).toLocaleDateString([], {month:'short',day:'numeric'}),from=new Date(lo).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),to=new Date(hi).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}),duration=fmtDuration(b-a),tip=`${date} · ${name} · ${from}–${to} · ${duration}`;out+=`<rect class="battery-activity-band ${kind}" x="${x1}" y="${T}" width="${Math.max(1,x2-x1)}" height="${bottom-T}" data-device-tip="${esc(tip)}" data-x="${((x1+x2)/2).toFixed(1)}"/>`;}
  return out;
}
function deviceBatteryChart(samples, deviceLabel, measuredWidth=900, range='month', opts={}){
  const points=(samples||[]).filter(q=>Number.isFinite(Number(q.time))&&q.level!==null&&q.level!==undefined&&Number.isFinite(Number(q.level))).map(q=>({t:Number(q.time),v:Number(q.level),status:q.status||'',lastSync:q.last_sync||''})).sort((a,b)=>a.t-b.t);
  if(!points.length)return '<div class="device-health-empty">No battery percentage has been returned for this device yet.</div>';
  const now=Date.now()/1000,days=range==='day'?1:range==='week'?7:30,start=now-days*86400,chartPoints=points.filter(p=>p.t>=start&&p.t<=now),W=Math.max(180,Math.round(Number(measuredWidth)||900)),H=Math.max(140,Math.round(Number((opts||{}).height)||168)),L=46,R=30,T=15,B=30,plotW=W-L-R,plotH=H-T-B,projDays=Math.max(0,Number((opts||{}).projectionDays)||0),pad=projDays>0?Math.min(days*86400*.5,projDays*86400):0,chartEnd=now+pad,span=(chartEnd-start)||days*86400;
  let yMin=0,yMax=100;
  if(range!=='month'&&chartPoints.length){const minV=Math.min(...chartPoints.map(p=>p.v));yMin=Math.max(0,Math.floor((minV-10)/10)*10);}
  const yRange=yMax-yMin||1;
  const X=t=>L+(t-start)/span*(W-L-R),Y=v=>T+(yMax-v)/yRange*(H-T-B),baseY=H-B;
  const axis=()=>{
    let s='';
    if(range==='day'){
      const startSec=Math.floor(start/3600)*3600,stepSec=6*3600;
      for(let t=startSec;t<=chartEnd;t+=stepSec){const x=X(t),when=new Date(t*1000),label=when.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});s+=`<line x1="${x}" x2="${x}" y1="${T}" y2="${baseY}" stroke="rgba(255,255,255,.045)"/><text x="${x}" y="${H-7}" text-anchor="middle" fill="var(--axis-text)" font-size="10">${label}</text>`;}
    } else if(range==='week'){
      const startDay=new Date(start*1000);startDay.setHours(0,0,0,0);
      for(let i=0;i<8;i++){const t=(startDay.getTime()/1000)+i*86400;if(t>chartEnd+3600)break;const x=X(t),when=new Date(t*1000),label=when.toLocaleDateString([], {weekday:'short'});s+=`<line x1="${x}" x2="${x}" y1="${T}" y2="${baseY}" stroke="rgba(255,255,255,.045)"/><text x="${x}" y="${H-7}" text-anchor="middle" fill="var(--axis-text)" font-size="10">${label}</text>`;}
    } else {
      for(let i=0;i<7;i++){const t=start+span*i/6,x=L+i*(W-L-R)/6,when=new Date(t*1000),label=(i===6&&pad<=0)?'Now':when.toLocaleDateString([], {month:'short',day:'numeric'});s+=`<line x1="${x}" x2="${x}" y1="${T}" y2="${baseY}" stroke="rgba(255,255,255,.045)"/><text x="${x}" y="${H-7}" text-anchor="middle" fill="var(--axis-text)" font-size="10">${label}</text>`;}
    }
    for(const v of [0,25,50,75,100]){if(v<yMin||v>yMax)continue;const y=Y(v);s+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="var(--glass-grid,rgba(255,255,255,.07))" stroke-dasharray="3 5"/><text x="${L-8}" y="${y+4}" text-anchor="end" fill="var(--axis-text)" font-size="10">${v}%</text>`;}
    return s;
  };
  if(!chartPoints.length){
    let empty=`<svg class="device-battery-svg" viewBox="0 0 ${W} ${H}" role="img" data-dh-state="empty" aria-label="${esc(deviceLabel)} battery history for the last ${days} days">${axis()}`;
    const cx=(L+W-R)/2,cy=T+plotH/2;
    
    if(yMin<=20&&yMax>=20)empty+=`<line x1="${L}" x2="${W-R}" y1="${Y(20)}" y2="${Y(20)}" stroke="rgba(244,63,94,.4)" stroke-dasharray="4 5"/>`;
    empty+=deviceBatteryActivityBands(X,start,now,T,baseY);
    return empty+'</svg>';
  }
  const level=chartPoints.at(-1).v,color=level<20?'#F43F5E':level<40?'#F59E0B':'var(--teal,#2DD4BF)';
  let out=`<svg class="device-battery-svg" viewBox="0 0 ${W} ${H}" role="img" data-dh-state="ok" aria-label="${esc(deviceLabel)} battery level during the last ${days} days"><defs><linearGradient id="batteryAreaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity=".14"/><stop offset="100%" stop-color="${color}" stop-opacity=".01"/></linearGradient></defs>`;
  const firstX=X(chartPoints[0].t);
  if(firstX-L>plotW*.25){const cx=(L+firstX)/2,cy=T+plotH/2;out+=`<rect x="${L}" y="${T}" width="${Math.max(0,firstX-L)}" height="${plotH}" fill="rgba(255,255,255,.018)"/>`;}
  out+=axis();
  out+=deviceBatteryActivityBands(X,start,now,T,baseY);
  if(yMin<=20&&yMax>=20)out+=`<line x1="${L}" x2="${W-R}" y1="${Y(20)}" y2="${Y(20)}" stroke="rgba(244,63,94,.4)" stroke-dasharray="4 5"/><text x="${W-R-3}" y="${Y(20)-4}" text-anchor="end" fill="rgba(244,130,145,.72)" font-size="9">LOW · 20%</text>`;
  const charges=[];for(let i=1;i<chartPoints.length;i++)if(chartPoints[i].v-chartPoints[i-1].v>=5)charges.push({from:chartPoints[i-1],to:chartPoints[i]});
  for(const c of charges){const x=X(c.from.t),w=Math.max(2,X(c.to.t)-x);out+=`<rect x="${x}" y="${T}" width="${w}" height="${plotH}" fill="rgba(245,158,11,.12)"/>`;}
  const segments=[];for(const p of chartPoints){const s=segments.at(-1);if(!s||p.t-s.at(-1).t>3*3600)segments.push([p]);else s.push(p);}
  for(const seg of segments){if(!seg.length)continue;const d=seg.map((p,i)=>`${i?'L':'M'}${X(p.t).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' '),area=`${d} L${X(seg.at(-1).t).toFixed(1)},${baseY} L${X(seg[0].t).toFixed(1)},${baseY} Z`;out+=`<path d="${area}" fill="url(#batteryAreaGradient)"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;}
  const lp=chartPoints.at(-1);
  if(lp&&now-lp.t>1800){const lx=X(lp.t),ly=Y(lp.v),nx=X(now),ny=Y(lp.v),lastTime=new Date(lp.t*1000).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}),syncAgo=lp.lastSync?Math.max(0,Math.floor((Date.now()-new Date(lp.lastSync).getTime())/60000)):null,tipText=`No new reading since ${lastTime}${syncAgo!=null?` · last sync ${syncAgo<60?syncAgo+' min ago':Math.floor(syncAgo/60)+' hr ago'}`:''}`;out+=`<line x1="${lx}" x2="${nx}" y1="${ly}" y2="${ny}" stroke="${color}" stroke-opacity=".35" stroke-width="1.5" stroke-dasharray="3 4" data-device-tip="${esc(tipText)}" data-x="${((lx+nx)/2).toFixed(1)}" style="cursor:help;pointer-events:stroke"/>`;}
  chartPoints.forEach((p,i)=>{const when=new Date(p.t*1000),at=when.toLocaleString([], {weekday:'short',hour:'numeric',minute:'2-digit'}),previous=chartPoints[i-1],delta=previous?p.v-previous.v:null,isLatest=i===chartPoints.length-1,status=p.status||(p.v<20?'Low':p.v<50?'Fair':'Good'),sync=p.lastSync?new Date(p.lastSync).toLocaleString([], {dateStyle:'medium',timeStyle:'medium'}):when.toLocaleString([], {dateStyle:'medium',timeStyle:'medium'}),tip=isLatest?`Fitbit sync · ${sync}\n${p.v}% · ${status}`:`${at} · ${p.v}%${delta!==null?` · ${delta>=0?'+':''}${delta} pts since last reading`:''}${p.lastSync?`\nFitbit last synced ${new Date(p.lastSync).toLocaleString([], {hour:'numeric',minute:'2-digit'})}`:''}${p.status?'\nStatus: '+p.status:''}`;out+=`<circle class="device-chart-hit" data-device-tip="${esc(tip)}" data-x="${X(p.t).toFixed(1)}" cx="${X(p.t)}" cy="${Y(p.v)}" r="9" fill="transparent"/>`;if(previous&&p.v-previous.v>=5)out+=`<circle class="battery-charge-dot" cx="${X(p.t)}" cy="${Y(p.v)}" r="5"/><text x="${X(p.t)}" y="${Y(p.v)-11}" text-anchor="middle" fill="#FCD34D" font-size="13">⚡</text>`;});
  const latest=chartPoints.at(-1),latestX=X(latest.t),latestY=Y(latest.v);
  out+=`<line x1="${latestX-4}" x2="${latestX+4}" y1="${latestY}" y2="${latestY}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/><circle cx="${latestX}" cy="${latestY}" r="8" fill="none" stroke="${color}" stroke-opacity=".3" stroke-width="4"/><circle cx="${latestX}" cy="${latestY}" r="4" fill="${color}" stroke="#E6FFFB" stroke-width="1.5"/><text x="${latestX-9}" y="${latestY+4}" text-anchor="end" fill="var(--ink)" font-size="11" font-weight="700">${latest.v}%</text><line class="device-chart-crosshair" visibility="hidden" x1="0" x2="0" y1="${T}" y2="${baseY}"/>`;
  if(projDays>0){const lp0=chartPoints.at(-1),etaT=lp0.t+projDays*86400,tZero=lp0.t+projDays*86400*((lp0.v-yMin)/Math.max(1e-6,lp0.v)),endT=Math.min(etaT,chartEnd,tZero);if(endT>lp0.t){const frac=(endT-lp0.t)/(etaT-lp0.t||1),yEnd=Math.max(yMin,lp0.v*(1-frac)),etaText=new Date(etaT*1000).toLocaleString([], {weekday:'short',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'});out+=`<line class="dh-projection" x1="${X(lp0.t).toFixed(1)}" y1="${Y(lp0.v).toFixed(1)}" x2="${X(endT).toFixed(1)}" y2="${Y(yEnd).toFixed(1)}" stroke="${color}" stroke-opacity=".55" stroke-width="1.6" stroke-dasharray="2 5" data-device-tip="${esc('Projected empty around '+etaText+' · estimate from your recent drain rate')}" data-x="${((X(lp0.t)+X(endT))/2).toFixed(1)}" style="cursor:help;pointer-events:stroke"/>`;}}
if(pad>0){const nx=X(now);out+=`<line class="dh-now-line" x1="${nx.toFixed(1)}" x2="${nx.toFixed(1)}" y1="${T}" y2="${baseY}" stroke="rgba(255,255,255,.32)" stroke-dasharray="2 4"/><text x="${nx.toFixed(1)}" y="${T-4}" text-anchor="middle" fill="var(--axis-text)" font-size="10">NOW</text>`;}
out+='</svg>';
  return out;
}
function deviceWearChart(wear,avg14,measuredWidth=900,range='month'){
  const count=range==='day'?1:range==='week'?7:30,rows=(window._deviceHealthData?.coverage_grid||[]).slice(-count).reverse();if(!rows.length)return '<div class="device-health-empty">No heart-rate coverage history is available.</div>';
  const now=new Date(),todayKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`,ticks=['12a','3a','6a','9a','12p','3p','6p','9p','12a'],battery=((window._deviceHealthData?.devices||[]).find(d=>/fitbit air/i.test(String(d.version||'')))?.samples||[]).slice().sort((x,y)=>Number(x.time)-Number(y.time)),sleep=window._deviceHealthData?.sleep_window,sleepSessions=window._deviceHealthData?.sleep_sessions||[],exerciseSessions=window._deviceHealthData?.exercise_sessions||[];
  let out=`<div class="wear-heatmap${rows.length<=7?' roomy':''}" role="img" aria-label="Heart-rate coverage over the last ${rows.length} day${rows.length===1?'':'s'} in fifteen-minute intervals"><div class="wear-grid-scroll"><div class="wear-time-axis"><span></span><div>`+ticks.map(x=>`<b>${x}</b>`).join('')+`</div></div><div class="wear-grid-body">`;
  for(const [rowIndex,row] of rows.entries()){const today=row.day===todayKey,date=new Date(`${row.day}T12:00:00`),weekday=date.getDay(),day=date.getDate(),mondayNear=rows.some((other,j)=>Math.abs(j-rowIndex)<=2&&new Date(`${other.day}T12:00:00`).getDay()===1),label=today?'Today':(rows.length<=7||weekday===1||(day===1&&!mondayNear))?date.toLocaleDateString([], {weekday:'short',day:'numeric'}):'',cells=String(row.cells||'').padEnd(96,'.').slice(0,96),elapsed=Math.min(1,Math.max(0,Number(row.elapsed_fraction)||0)),elapsedCount=today?Math.min(96,Math.ceil(elapsed*96)):96;let gaps=[];for(let i=0;i<elapsedCount;){if(cells[i]!=='0'){i++;continue;}let j=i+1;while(j<elapsedCount&&cells[j]==='0')j++;gaps.push([i,j]);i=j;}
    const dayStart=new Date(`${row.day}T00:00:00`).getTime(),coveredCount=cells.slice(0,elapsedCount).split('').filter(x=>x==='1').length,trackTip=`${today?'Today · ':''}${date.toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}\n${(coveredCount*.25).toFixed(1)} h with HR data${today?' · partial day':''}`;let overlays='';
    for(const [a,b] of gaps){const duration=(b-a)*.25,start=dayStart+a*15*60000,end=dayStart+b*15*60000,cls=duration>=1?'long':'short',durationText=duration<1?`${Math.round(duration*60)} min`:`${duration.toFixed(1)} h`,tip=`${date.toLocaleDateString([], {month:'short',day:'numeric'})} · ${String(Math.floor(a/4)).padStart(2,'0')}:${String(a%4*15).padStart(2,'0')}–${String(Math.floor(b/4)%24).padStart(2,'0')}:${String(b%4*15).padStart(2,'0')} · ${durationText}`;let charge=false,chargeDelta=0;for(let i=1;i<battery.length;i++){const sample=battery[i],delta=Number(sample.level)-Number(battery[i-1].level);if(sample.level!=null&&battery[i-1].level!=null&&Number(sample.time)*1000>=start&&Number(sample.time)*1000<end&&Number.isFinite(delta)&&delta>0){charge=true;chargeDelta=Math.max(chargeDelta,delta);}}const marker=charge?`<b class="wear-charge-bolt" title="Battery increased by ${chargeDelta} points during this gap">⚡</b>`:'';overlays+=`<i class="wear-gap ${cls}${charge?' charge-confirmed':''}" style="--gap-left:${a/96*100}%;--gap-width:${(b-a)/96*100}%" data-device-tip="${esc(`${tip}${charge?`\nBattery rose by ${chargeDelta} points in this window`:''}`)}" data-x="${(a+b)/192}">${marker}</i>`;}
    const trackWidth=today?elapsed*100:100,nowMark=today?`<i class="wear-now-marker" style="--now-x:${trackWidth}%" aria-label="Current time"></i>`:'',sep=weekday===1||day===1&&!mondayNear?' wear-week-separator':'';
    const sa=Number(sleep?.start_minute),sb=Number(sleep?.end_minute),sleepClass=!today&&sleep&&Number.isFinite(sa)&&Number.isFinite(sb)?(sb>1440?' sleep-window sleep-wrap':' sleep-window'):'',sleepStyle=sleepClass?`--sleep-start:${sa/1440*100}%;--sleep-end:${Math.min(100,sb/1440*100)}%;--sleep-wrap-end:${Math.max(0,(sb-1440)/1440*100)}%;`:'';
    const eventMarkup=(items,kind)=>items.map(ev=>{const a=Date.parse(ev.start),b=Date.parse(ev.end);if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a)return '';const rowStart=dayStart,rowEnd=new Date(`${row.day}T00:00:00`);rowEnd.setDate(rowEnd.getDate()+1);const lo=Math.max(a,rowStart),hi=Math.min(b,rowEnd.getTime(),today?Date.now():Infinity);if(hi<=lo)return '';const left=(lo-rowStart)/(rowEnd.getTime()-rowStart)*100,width=(hi-lo)/(rowEnd.getTime()-rowStart)*100,duration=Math.max(1,Math.round((b-a)/60000)),durationLabel=duration>=60?`${Math.floor(duration/60)} h ${duration%60?`${duration%60} min`:''}`:`${duration} min`,name=kind==='sleep'?(ev.nap?'Nap':'Sleep'):(ev.name||String(ev.type||'Exercise').replace(/_/g,' ')),from=new Date(lo).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false}),to=new Date(hi).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false}),tip=`${date.toLocaleDateString([], {month:'short',day:'numeric'})} · ${name} · ${from}–${to} · ${durationLabel}`;return `<i class="wear-event ${kind}" style="--event-left:${left}%;--event-width:${width}%" data-device-tip="${esc(tip)}" data-x="${left+width/2}"></i>`;}).join('');
    const actualSleep=eventMarkup(sleepSessions,'sleep'),actualExercise=eventMarkup(exerciseSessions,'exercise');
    out+=`<div class="wear-day-row${sep}"><span class="wear-day-label" title="${date.toLocaleDateString([], {weekday:'long',month:'long',day:'numeric'})}">${label}</span><div class="wear-day-track${sleepClass}" style="--track-width:${trackWidth}%;${sleepStyle}" data-device-tip="${esc(trackTip)}" data-x="0.5">${actualSleep}${actualExercise}${overlays}${nowMark}</div></div>`;
  }
  out+=`</div></div><div class="wear-grid-legend"><span><i class="covered"></i>HR recorded</span><span><i class="gap-short"></i>Short gap · 15–59 min</span><span><i class="gap-long"></i>Gap ≥ 1 h</span><span><i class="sleep-event"></i>Sleep</span><span><i class="exercise-event"></i>Exercise</span>${sleep?'<span><i class="sleep"></i>Usual sleep</span>':''}<small>15-minute bins · recorded at ≥50% coverage</small></div><i class="wear-crosshair" aria-hidden="true"></i></div>`;return out;
}
function setupDeviceHealthTooltips(card){
  card.querySelectorAll('.device-health-chart').forEach(host=>{
    if(host.dataset.tooltipReady)return;
    host.dataset.tooltipReady='1';
    const tip=document.createElement('div');
    tip.className='device-chart-tooltip';tip.setAttribute('role','status');
    host.appendChild(tip);
    const svg=host.querySelector('svg'),cross=svg?.querySelector('.device-chart-crosshair'),htmlCross=host.querySelector('.wear-crosshair');
    const marks=()=>[...host.querySelectorAll('[data-device-tip]')];
    let index=-1;

    const hide=()=>{
      tip.classList.remove('visible');
      if(cross)cross.setAttribute('visibility','hidden');
      if(htmlCross)htmlCross.style.display='none';
    };
    const show=(mark,clientX)=>{
      tip.textContent=mark.dataset.deviceTip||'';
      tip.classList.add('visible');
      const box=host.getBoundingClientRect(),px=clientX-box.left;
      if(px>box.width-135){tip.style.left='auto';tip.style.right=`${Math.max(4,box.width-px+12)}px`;tip.style.transform='none';}
      else if(px<95){tip.style.right='auto';tip.style.left=`${Math.max(4,px+12)}px`;tip.style.transform='none';}
      else{tip.style.right='auto';tip.style.left=`${px}px`;tip.style.transform='translateX(-50%)';}
      if(cross){const x=Number(mark.dataset.x);cross.setAttribute('x1',String(x));cross.setAttribute('x2',String(x));cross.setAttribute('visibility','visible');}
      if(htmlCross){
        const track=mark.closest('.wear-day-track');
        if(track){
          const r=track.getBoundingClientRect(),x=Number(mark.dataset.x);
          htmlCross.style.left=`${r.left-box.left+x*r.width}px`;
          htmlCross.style.top=`${r.top-box.top}px`;
          htmlCross.style.height=`${r.height}px`;
          htmlCross.style.display='block';
        }
      }
    };
    const showAtFocus=(mark)=>{
      const r=mark.getBoundingClientRect();
      show(mark,r.left+r.width/2);
    };

    host.addEventListener('pointermove',event=>{
      const mark=event.target.closest?.('[data-device-tip]');
      if(!mark||!host.contains(mark)){hide();return;}
      index=marks().indexOf(mark);
      show(mark,event.clientX);
    });
    host.addEventListener('pointerleave',hide);

    /* Keyboard: the chart is one tab stop; ←/→ walk the marks and read them out. */
    if(!host.hasAttribute('tabindex'))host.tabIndex=0;
    if(!host.getAttribute('aria-label'))host.setAttribute('aria-label','Device chart. Use the left and right arrow keys to read values, Escape to close.');
    host.addEventListener('focus',()=>{
      const list=marks();
      if(!list.length)return;
      if(index<0||index>=list.length)index=list.length-1;
      showAtFocus(list[index]);
    });
    host.addEventListener('blur',hide);
    host.addEventListener('keydown',event=>{
      if(event.key==='Escape'){hide();return;}
      if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
      const list=marks();
      if(!list.length)return;
      event.preventDefault();
      index=(index+(event.key==='ArrowRight'?1:-1)+list.length)%list.length;
      showAtFocus(list[index]);
    });
  });
}
function deviceHealthModel(){
  const data=window._deviceHealthData,devices=(data?.devices||[]).filter(d=>!/^mobiletrack$/i.test(String(d.version||'').trim())),device=devices.find(d=>/fitbit air/i.test(String(d.version||'')))||devices[0],wear=data?.wear||[],full=wear.filter(q=>Number(q.day_minutes)>=1440).slice(-14),avgWear=full.length?mean(full.map(q=>Number(q.worn_minutes)/60)):null,avgGaps=full.length?mean(full.map(q=>Number(q.no_hr_minutes)/60)):null;
  if(!device)return {data,device:null,wear,avgWear,avgGaps,inferredCharge:null};
  const samples=(device.samples||[]).slice().sort((a,b)=>Number(a.time)-Number(b.time)),valid=samples.filter(q=>q.level!==null&&q.level!==undefined&&Number.isFinite(Number(q.level))),latest=valid.at(-1)||null,wearMap=new Map(wear.map(q=>[q.day,Number(q.worn_minutes)/60])),groups=new Map();
  for(const q of valid){const d=new Date(Number(q.time)*1000),day=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;if(!groups.has(day))groups.set(day,[]);groups.get(day).push(q);}
  const daily=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([day,vals])=>{const span=(Number(vals.at(-1).time)-Number(vals[0].time))/3600,charged=vals.some((q,i)=>i>0&&Number(q.level)>Number(vals[i-1].level)),loss=Number(vals[0].level)-Number(vals.at(-1).level),worn=wearMap.get(day)||0;return {day,span,charged,loss,worn,rate:worn>=6&&span>=12&&!charged&&loss>=.5?loss/worn:null};}),usable=daily.filter(q=>q.rate!=null),spanDays=usable.length?Math.max(0,Math.round((Date.parse(usable.at(-1).day)-Date.parse(usable[0].day))/86400000)):0,ready=usable.length>=7&&spanDays>=14,rateHour=ready?median(usable.map(q=>q.rate)):null,eta=rateHour>0&&latest?Number(latest.level)/(rateHour*24):null;
  const now=new Date(),midnight=new Date(now);midnight.setHours(0,0,0,0);const prev=new Date(midnight);prev.setDate(prev.getDate()-14);const old=new Date(midnight);old.setDate(old.getDate()-28);const key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`,recent=usable.filter(q=>q.day>=key(prev)),baseline=usable.filter(q=>q.day<key(prev)&&q.day>=key(old)),base=baseline.length>=5?median(baseline.map(q=>q.rate)):null,recentRate=recent.length>=5?median(recent.map(q=>q.rate)):null,change=base>0&&recentRate!=null?(recentRate/base-1)*100:null;
  let lastCharge=null;for(let i=1;i<valid.length;i++)if(Number(valid[i].level)-Number(valid[i-1].level)>=5)lastCharge=valid[i];
  // Reconcile charge info between battery and wear cards: find the likely charging window from
  // recurring long gaps, then the most recent instance (preferring one where battery actually rose).
  const todayK=key(now),longGaps=[];
  for(const row of (data?.coverage_grid||[])){const cells=String(row.cells||'').padEnd(96,'.'),dayStart=new Date(`${row.day}T00:00:00`).getTime(),elapsedFrac=Math.min(1,Math.max(0,Number(row.elapsed_fraction)||0)),elapsedCount=row.day===todayK?Math.ceil(elapsedFrac*96):96;for(let i=0;i<elapsedCount;){if(cells[i]!=='0'){i++;continue;}let j=i+1;while(j<elapsedCount&&cells[j]==='0')j++;if(j-i>=4)longGaps.push({day:row.day,start:i,end:j,dayStart});i=j;}}
  const byStartHour=new Map();
  for(const g of longGaps){const k=Math.round(g.start/4);if(!byStartHour.has(k))byStartHour.set(k,[]);byStartHour.get(k).push(g);}
  const likelyGroup=[...byStartHour.values()].sort((a,b)=>b.length-a.length)[0]||[];
  let inferredCharge=null;
  if(likelyGroup.length>=2){const sorted=[...likelyGroup].sort((a,b)=>b.day.localeCompare(a.day));for(const g of sorted){const gapStart=g.dayStart+g.start*15*60000,gapEnd=g.dayStart+g.end*15*60000;let rose=false,lvl=null;for(let i=1;i<valid.length;i++){const t=Number(valid[i].time)*1000;if(t>=gapStart&&t<gapEnd&&Number(valid[i].level)-Number(valid[i-1].level)>0){rose=true;lvl=Number(valid[i].level);}}if(rose){inferredCharge={time:gapStart,endTime:gapEnd,level:lvl,day:g.day,start:g.start,end:g.end};break;}}if(!inferredCharge&&sorted.length){const g=sorted[0];inferredCharge={time:g.dayStart+g.start*15*60000,endTime:g.dayStart+g.end*15*60000,level:null,day:g.day,start:g.start,end:g.end};}}
  const lastSync=device.last_sync?new Date(device.last_sync):null,minutesAgo=lastSync?Math.max(0,Math.floor((now-lastSync)/60000)):null,updated=minutesAgo==null?'Update time unavailable':minutesAgo<1?'Updated just now':minutesAgo<60?`Updated ${minutesAgo} min ago`:minutesAgo<1440?`Updated ${Math.floor(minutesAgo/60)} hr ago`:`Updated ${Math.floor(minutesAgo/1440)} days ago`,level=latest?Number(latest.level):null,rawStatus=String(device.battery_status||'').toLowerCase(),color=level==null?'var(--teal,#2DD4BF)':level<20?'#F43F5E':level<40?'#F59E0B':'var(--teal,#2DD4BF)';
  const status=rawStatus.includes('charg')||(lastCharge&&Number(latest?.time)-Number(lastCharge.time)<20*60)?'Charging':level==null?'Unavailable':level<20?'Low':level<40?'Medium':'High';
  const ago=t=>{const m=Math.max(0,Math.floor((now.getTime()-Number(t)*1000)/60000));return m<60?`${m} min ago`:m<1440?`${Math.floor(m/60)} hr ago`:`${Math.floor(m/1440)} days ago`;};
  return {data,device,wear,avgWear,avgGaps,samples,valid,latest,usable,spanDays,ready,eta,change,lastCharge,inferredCharge,lastSync,minutesAgo,updated,level,status,color,ago};
}
function deviceHealthErrorHtml(error){
  const message=String(error||'');
  if(/pairedDevices.*403|insufficient authentication scopes|googlehealth\.settings\.readonly/i.test(message))return '<div class="device-health-empty"><b>Fitbit Air battery access needs approval</b><br>Google Health has not granted this dashboard the device settings permission. In the Dad dashboard folder, run <code>python gh.py auth</code>, approve the requested access, then choose Sync now. Wear-time estimates remain available from heart-rate data.</div>';
  return `<div class="device-health-empty">Battery data could not be fetched: ${esc(message)}</div>`;
}
/* ============================================================
   UNIFIED DEVICE-HEALTH CARD — Battery / Wear time
   One card, one header, one KPI strip, one chart area.
   ============================================================ */

const DH_TABS=['battery','wear'];
const DH_PERIODS=[['day','Day'],['week','Week'],['month','Month']];

function dhTab(){
  const t=window._deviceHealthTab;
  return t==='wear'?'wear':'battery';
}
function dhRestoreTab(){
  if(window._deviceHealthTab==='battery'||window._deviceHealthTab==='wear')return;
  let saved=null;
  try{saved=localStorage.getItem('health-device-tab');}catch(_){saved=null;}
  window._deviceHealthTab=(saved==='wear'||saved==='battery')?saved:'battery';
}
function dhStoreTab(tab){
  try{localStorage.setItem('health-device-tab',tab);}catch(_){}
}
function dhRange(){return window._deviceBatteryRange||window._deviceWearRange||'week';}
function dhRangeLabel(range){return range==='day'?'Daily':range==='week'?'Weekly':'Monthly';}
function dhClock(ms){return new Date(ms).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',hour12:false});}
function dhChartWidth(){
  const plot=document.querySelector('#card-deviceHealth .plot');
  return Math.max(320,Math.round(plot?.clientWidth||900));
}
function dhKpi(label,value,sub,cls){
  return `<div class="dh-kpi${cls?' '+cls:''}"><small>${label}</small><b>${value}</b><span class="dh-kpi-sub">${sub}</span></div>`;
}

/* a. HEADER ROW — title, sync age, tab + period selectors. */
function dhHeaderHtml(m){
  const tab=dhTab(),range=dhRange();
  const stale=!!(m&&m.minutesAgo!=null&&m.minutesAgo>=180);
  const deviceName=esc(m?.device?.version||'Fitbit Air');
  const updated=m?esc(m.updated):'Loading device data';
  const syncTitle=esc(m?.lastSync?m.lastSync.toLocaleString():'Fitbit sync time unavailable');
  const tabs=DH_TABS.map(t=>`<button type="button" role="tab" id="dh-tab-${t}" aria-selected="${tab===t}" aria-controls="dh-panel" tabindex="${tab===t?0:-1}" onclick="setDeviceTab('${t}')">${t==='wear'?'Wear time':'Battery'}</button>`).join('');
  const periods=DH_PERIODS.map(([v,label])=>`<button type="button" aria-pressed="${range===v}" onclick="setDeviceRange('${v}')">${label}</button>`).join('');
  return `<div class="dh-head">
    <div class="dh-title">
      <h2>Device health</h2>
      <p class="dh-sub"><span>${deviceName}</span><span class="dh-sep" aria-hidden="true">·</span><span class="dh-updated${stale?' stale':''}" title="${syncTitle}">${stale?'<span class="dh-warn" aria-hidden="true">⚠</span>':''}${updated}</span></p>
    </div>
    <div class="dh-controls">
      <div class="dh-seg dh-tabs" role="tablist" aria-label="Device health view" onkeydown="dhTabKey(event)">${tabs}</div>
      <div class="dh-seg dh-period" role="group" aria-label="Chart period">${periods}</div>
    </div>
  </div>`;
}

/* b–e. BATTERY tab content (no card chrome: KPI strip, insight, chart, legend, footer). */
function deviceBatteryCardHtml(m){
  const quick=quickDrain(m),range=dhRange(),activity=deviceActivitySummary(range);
  const statusClass=m.status==='Low'?'low':m.status==='Medium'?'medium':'good';
  const pill=m.status?`<span class="dh-pill ${statusClass}">${m.status==='Charging'?'⚡ ':''}${esc(m.status)}</span>`:'';
  const latestAt=m.latest?new Date(Number(m.latest.time)*1000):null;
  const levelHtml=`${m.level==null?'—':m.level+'%'}${pill}`;
  const levelSub=latestAt?`Latest reading ${dhClock(latestAt.getTime())}`:'No timestamped reading yet';
  let timeLeft;
  if(quick&&m.level!=null){
    const days=quick.days,when=new Date(Date.now()+days*86400000);
    timeLeft=dhKpi('Time left',days<1?`${Math.max(1,Math.round(days*24))} h`:`${days.toFixed(1)} days`,
      `Likely empty ${when.toLocaleDateString([], {weekday:'short',day:'numeric',month:'short'})} · rough`);
  } else {
    const done=Math.min(7,m.usable.length),pct=Math.round(done/7*100);
    timeLeft=dhKpi('Time left','<span class="dh-muted">Learning</span>',
      `<span class="dh-learn">day ${done} of 7<i class="dh-bar" aria-hidden="true"><b style="width:${pct}%"></b></i></span>`);
  }
  const trend=m.ready&&m.change!=null?`${m.change>=0?'+':''}${m.change.toFixed(0)}%`:'—';
  const shortDays=Math.max(0,7-m.usable.length);
  const trendSub=m.ready?'vs the previous 14 days':`Needs ${shortDays} more usable day${shortDays===1?'':'s'}`;
  let lastVal,lastSub;
  if(m.lastCharge){
    lastVal=m.ago(m.lastCharge.time);
    lastSub=`Charged to ${m.lastCharge.level}%`;
  } else if(m.inferredCharge){
    lastVal='<span class="dh-muted">Inferred</span>';
    lastSub=`Usually ${dhClock(m.inferredCharge.time)}–${dhClock(m.inferredCharge.endTime)} (inferred)`;
  } else {
    lastVal='—';
    lastSub='No charge logged yet';
  }
  const kpis=`<div class="dh-kpis">${dhKpi('Battery level',levelHtml,levelSub)}${timeLeft}${dhKpi('Drain trend',trend,trendSub)}${dhKpi('Last charge',lastVal,lastSub)}</div>`;

  const chartW=dhChartWidth();
  const svg=deviceBatteryChart(m.samples,m.device.version||'Fitbit Air',chartW,range,{height:280,projectionDays:quick?quick.days:0});
  const empty=/data-dh-state="empty"/.test(svg);
  const chart=`<div class="device-health-chart dh-chart" data-chart="battery">${svg}${empty?'<div class="dh-note" aria-hidden="true"><span>Daily battery curve builds automatically<small>as Fitbit Air syncs new readings</small></span></div>':''}</div>`;

  const charging=m.inferredCharge?` Likely charging window ${dhClock(m.inferredCharge.time)}–${dhClock(m.inferredCharge.endTime)} (inferred).`:'';
  const legend=`<div class="dh-legend">
      <span><i class="dh-sw sleep"></i>Sleep <b>${activity.sleep}</b></span>
      <span><i class="dh-sw exercise"></i>Exercise <b>${activity.exercise}</b></span>
      <span><i class="dh-sw charge"></i>Charge</span>
      <span class="dh-legend-note">Shading marks recorded sleep and exercise</span>
    </div>`;
  const footnote=`<p class="dh-footnote">Battery capacity and mAh draw are not provided by Google Health. Gaps over three hours break the line; a rise of five points or more marks a possible charge.${charging}</p>`;
  const details=`<details class="dh-details"><summary>How this is calculated</summary><p>The battery chart uses a 0–100% axis in the monthly view and an adaptive axis (top set to 100%) in the daily and weekly views. Sleep and exercise intervals are drawn as translucent bands behind the line. “Updated” uses Fitbit’s reported last-sync time; chart tooltips also show when this dashboard sampled the value. Time left, drain trend and the projection to 0% appear only after enough discharge history: they are normalised by estimated heart-rate-covered wear time, with a median to reduce workout-day spikes. Wear coverage counts heart-rate intervals up to 10 minutes; longer gaps count as no recorded heart rate, not confirmed off-wrist time. The current partial day is excluded from the 14-day average.</p></details>`;

  return `${kpis}${deviceInsightLine(m,'battery')}${chart}${legend}${footnote}${details}`;
}

/* b–e. WEAR tab content (same skeleton, same order). */
function deviceWearCardHtml(m){
  const range=dhRange(),rangeCount=range==='day'?1:range==='week'?7:30,rangeLabel=dhRangeLabel(range),
    allDays=(m.data?.coverage_grid||[]).slice(-30),days=allDays.slice(-30),
    coverage=m.avgWear==null?null:Math.round(m.avgWear/24*100),runs=[];
  let longGapDays=0;
  for(const row of days){
    const c=String(row.cells||''),g=[];
    for(let i=0;i<c.length;){if(c[i]!=='0'){i++;continue;}let j=i+1;while(j<c.length&&c[j]==='0')j++;g.push([i,j]);i=j;}
    if(g.some(([a,b])=>b-a>=4))longGapDays++;
    for(const [a,b] of g)if(b-a>=2)runs.push({start:a,end:b,day:row.day});
  }
  const longGaps=runs.filter(q=>q.end-q.start>=4),byStart=new Map();
  for(const run of longGaps){const key=Math.round(run.start/4);if(!byStart.has(key))byStart.set(key,[]);byStart.get(key).push(run);}
  const likely=[...byStart.entries()].sort((a,b)=>b[1].length-a[1].length)[0]?.[1]||[],
    fmtMin=i=>`${String(Math.floor(i/4)).padStart(2,'0')}:${String((i%4)*15).padStart(2,'0')}`,
    likelyText=likely.length>=2?`${fmtMin(likely[0].start)}–${fmtMin(likely[0].end)}`:'Building pattern',
    longest=runs.slice().sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0],
    longestHours=longest?`${((longest.end-longest.start)/4).toFixed(1)} h`:'—',
    longestDay=longest?new Date(`${longest.day}T12:00:00`).toLocaleDateString([], {month:'short',day:'numeric'}):null;
  const activity=deviceActivitySummary(range);
  const kpis=`<div class="dh-kpis">
      ${dhKpi('Worn',coverage==null?'—':`${coverage}%`,'Last 14 full days','dh-kpi-hero')}
      ${dhKpi('No-HR',m.avgGaps==null?'—':`${m.avgGaps.toFixed(1)} h/day`,'Without heart-rate data')}
      ${dhKpi('Longest gap',longestHours,`${longestDay?'In the last 30 days · '+longestDay:'In the last 30 days'}`)}
      ${dhKpi('Days with gap ≥1 h',`${longGapDays} / ${days.length||0}`,'Days with a gap of 1 h or more')}
    </div>`;

  const chartW=dhChartWidth();
  const chart=`<div class="device-health-chart dh-chart" data-chart="wear">${deviceWearChart(m.wear,m.avgWear,chartW,range)}</div>`;
  const legend=`<div class="dh-legend">
      <span><i class="dh-sw covered"></i>HR recorded</span>
      <span><i class="dh-sw gap-short"></i>Short gap · 15–59 min</span>
      <span><i class="dh-sw gap-long"></i>Gap ≥ 1 h</span>
      <span><i class="dh-sw sleep"></i>Sleep <b>${activity.sleep}</b></span>
      <span><i class="dh-sw exercise"></i>Exercise <b>${activity.exercise}</b></span>
      <span class="dh-legend-note">15-minute bins · recorded at ≥50% coverage</span>
    </div>`;
  const footnote=`<p class="dh-footnote">Likely charging window ${likelyText} · ${likely.length} of ${longGaps.length} long gaps. Charging is inferred from recurring gaps; off-wrist time or sync drops can look similar. ⚡ marks a battery rise inside a gap.</p>`;
  const details=`<details class="dh-details"><summary>How this is calculated</summary><p>${rangeLabel} heart-rate coverage from 15-minute bins: a bin counts as covered when at least half of its samples contain heart rate. Wear percentage uses the last 14 complete days. Gaps between 15 and 59 minutes are drawn as short gaps; an hour or more is a long gap, hatched so the colour is not the only cue. Recurring long gaps at a similar time of day are read as the likely charging window; the battery line confirms it when percentage rose inside the gap.</p></details>`;

  return `${kpis}${deviceInsightLine(m,'wear')}${chart}${legend}${footnote}${details}`;
}

/* Card body for the active tab. Keeps every existing load/error/empty state. */
function deviceHealthCardHtml(){
  const tab=dhTab(),data=window._deviceHealthData;
  let m=null,body;
  if(!window._deviceHealthLoading&&!window._deviceHealthError&&data){
    try{m=deviceHealthModel();}catch(_){m=null;}
  }
  if(window._deviceHealthLoading){
    body='<div class="dh-state">Loading Fitbit Air device data…</div>';
  } else if(window._deviceHealthError){
    body=`<div class="dh-state">${esc(window._deviceHealthError)}</div>`;
  } else if(!data){
    body='<div class="dh-state">Open Device health to load battery and wear history.</div>';
  } else if(!m||!m.device){
    body=`<div class="dh-state">${m&&m.data?.sync_error?deviceHealthErrorHtml(m.data.sync_error):'No physical Fitbit tracker battery readings are available yet.'}</div>`;
  } else {
    body=tab==='wear'?deviceWearCardHtml(m):deviceBatteryCardHtml(m);
  }
  return `${dhHeaderHtml(m)}<div class="dh-body" id="dh-panel" role="tabpanel" aria-labelledby="dh-tab-${tab}">${body}</div>`;
}

/* Selector + period state. Both re-render the one card in place. */
window.setDeviceTab=function(tab,opts){
  if(!DH_TABS.includes(tab))return;
  window._deviceHealthTab=tab;
  dhStoreTab(tab);
  const card=document.querySelector('#card-deviceHealth');
  if(!card)return;
  renderCardByElement(card,true);
  setupDeviceHealthTooltips(card);
  if(opts&&opts.focus){const el=card.querySelector(`#dh-tab-${tab}`);if(el)el.focus();}
};
window.dhTabKey=function(event){
  const k=event.key;
  if(k!=='ArrowRight'&&k!=='ArrowLeft'&&k!=='Home'&&k!=='End')return;
  event.preventDefault();
  const cur=dhTab();
  const next=k==='Home'?'battery':k==='End'?'wear':cur==='battery'?'wear':'battery';
  window.setDeviceTab(next,{focus:true});
};

window.setDeviceRange=function(range){
  if(!['day','week','month'].includes(range))return;
  window._deviceBatteryRange=window._deviceWearRange=range;
  const card=document.querySelector('#card-deviceHealth');
  if(!card)return;
  renderCardByElement(card,true);
  setupDeviceHealthTooltips(card);
};
window.setDeviceBatteryRange=window.setDeviceRange;window.setDeviceWearRange=window.setDeviceRange;

async function loadDeviceHealth(){
  const cards=[...document.querySelectorAll('#card-deviceHealth')];
  if(!cards.length)return;
  window._deviceHealthLoading=true;window._deviceHealthError='';
  cards.forEach(card=>renderCardByElement(card,true));
  try{
    const response=await fetch('/api/device-health?days=90',{cache:'no-store'}),data=await response.json();
    if(!response.ok)throw new Error(data.error||`Request failed (${response.status})`);
    window._deviceHealthData=data;window._deviceHealthError='';
  }
  catch(ex){window._deviceHealthError=`Device health could not load: ${ex.message}`;}
  finally{
    window._deviceHealthLoading=false;
    cards.forEach(card=>{renderCardByElement(card,true);setupDeviceHealthTooltips(card);});
  }
}
dhRestoreTab();