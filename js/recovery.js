/* ============================================================
   HEART & RECOVERY CARDS
   ============================================================ */
function lineCard(metric,label,color,unit,dec,yMax){
  const p=dailyPts(metric),vals=p.filter(q=>q.y!=null).map(q=>q.y),avg=mean(vals);
  if(metric==='resting_hr'){
    const all=p.filter(q=>q.y!=null);
    const rolling=all.map((q,i)=>({...q,rawY:q.y,y:mean(all.slice(Math.max(0,i-6),i+1).map(v=>v.y))}));
    const band = avg==null ? null : [{y1:avg-3, y2:avg+3, color:'var(--rhr)', opacity:.07, label:'Personal range'}];
    const rawValues=all.map(q=>q.y).filter(Number.isFinite);
    const axisMin=rawValues.length?Math.max(0,Math.floor((Math.min(...rawValues)-2)/2)*2):48;
    const axisMax=rawValues.length?Math.ceil((Math.max(...rawValues)+2)/2)*2:70;
    return {kind:'line',pts:rolling,color,avg,fmtAvg:avg==null?'':avg.toFixed(0)+' '+unit,yMin:axisMin,yMax:axisMax,yTickStep:2,h:340,rawPts:all.map(q=>({x:q.x,y:q.y})),rawLinePts:all.map(q=>({x:q.x,y:q.y})),rawLineOpacity:.34,rawLineWidth:1.35,
      bands: band,
      foot:`<div class="sub">Faint connector and dots = daily values; brighter line = rolling mean over up to 7 recorded days. Soft band = period mean ±3 bpm, not a clinical range.</div>${avg==null?'':splitHtml(stats(all.map(q=>q.y),avg,'rhr'),'var(--rhr)',`of ${all.length} days · period average ${avg.toFixed(1)} bpm`,'rhr')}`, 
      fmtX:fmtDay,fmtY:v=>v.toFixed(1),label,
      tip:q=>`<b>${fmtDayLong(q.x)}</b>${tipRow('Rolling mean',q.y.toFixed(1)+' '+unit,color)}${q.rawY!=null?tipRow('Daily value',q.rawY.toFixed(1)+' '+unit):''}`,
      cols:['Date','Daily value','Rolling mean'],
      rows:all.slice().reverse().map(q=>[q.day,q.y.toFixed(1),rolling.find(z=>z.day===q.day)?.y.toFixed(1)??'–'])};
  }
  const isSpo2 = metric==='spo2';
  const spo2BelowClinical = isSpo2 ? vals.filter(v=>v<95).length : 0;
  const splitMetric=isSpo2?'spo2':metric==='resting_hr'?'rhr':metric==='hrv'?'hrv':'hr24';
  const spo2Foot = avg==null?'':`${splitHtml(stats(vals,avg,splitMetric),color,`of ${vals.length} days · ${days}-day average ${avg.toFixed(Math.max(dec,1))} ${unit}.`,splitMetric)}${isSpo2?`<div class="avg-split-note" style="color:${spo2BelowClinical?'#F43F5E':'var(--muted)'}">Clinical reference: ${spo2BelowClinical} of ${vals.length} readings below 95%. Values below 95% are highlighted as alerts; below-average readings at or above 95% are normal variation.</div>`:''}`;
  const thresholds = isSpo2 ? [{y:95, color:'var(--good)', label:'95% target threshold'}] : null;
  return {kind:'line',pts:p,color,avg,fmtAvg:avg==null?'':avg.toFixed(Math.max(dec,1))+' '+unit,
    thresholds, targetLabel:'95% clinical threshold',
    foot:spo2Foot,
    fmtX:fmtDay,fmtY:v=>+v.toFixed(1),label,yMax,
    tip:q=>`<b>${fmtDayLong(q.x)}</b>${tipRow(label,q.y.toFixed(dec)+' '+unit,color)}`,
    cols:['Day',unit],rows:p.filter(q=>q.y!=null).reverse().map(q=>[q.day,q.y.toFixed(dec)])};
}

function splinePath(points, move=true){
  if(!points.length)return '';
  let d=`${move?'M':'L'}${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for(let i=0;i<points.length-1;i++){
    const p0=points[i],p1=points[i+1],before=points[i-1]||p0,after=points[i+2]||p1,k=.5/6;
    const c1={x:p0.x+(p1.x-before.x)*k,y:p0.y+(p1.y-before.y)*k};
    const c2={x:p1.x-(after.x-p0.x)*k,y:p1.y-(after.y-p0.y)*k};
    d+=`C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)}`;
  }
  return d;
}
function dailyHrSvg(rows){
  const W=Math.max(320,Math.floor(document.querySelector('#card-hrdaily .plot')?.clientWidth||640)),H=360,L=54,R=24,T=22,B=48;
  const vals=rows.flatMap(q=>[q.low,q.mean,q.high]).filter(Number.isFinite);
  if(!vals.length)return '';
  let lo=Math.floor(Math.min(...vals)/10)*10,hi=Math.ceil(Math.max(...vals)/10)*10;
  if(lo===hi){lo-=5;hi+=5;}const pad=Math.max(3,(hi-lo)*.06);lo=Math.max(0,lo-pad);hi+=pad;
  const X=i=>L+(i+.5)*(W-L-R)/Math.max(1,rows.length),Y=v=>T+(hi-v)*(H-T-B)/(hi-lo),band=(W-L-R)/Math.max(1,rows.length);
  let g='';const tick=25;
  for(let v=Math.ceil(lo/tick)*tick;v<=hi;v+=tick)g+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="rgba(255,255,255,.06)" stroke-dasharray="2 4"/><text x="${L-8}" y="${Y(v)+4}" fill="#71717A" font-size="11" text-anchor="end" font-family="var(--font-mono)" font-variant-numeric="tabular-nums">${v}</text>`;
  const highCoords=rows.map((q,i)=>({x:X(i),y:Y(q.high)})),meanCoords=rows.map((q,i)=>({x:X(i),y:Y(q.mean)})),lowCoords=rows.map((q,i)=>({x:X(i),y:Y(q.low)}));
   if(rows.length>1)g+=`<defs><linearGradient id="hr-spread-range" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#20D3C2" stop-opacity=".98"/><stop offset="100%" stop-color="#176B78" stop-opacity=".75"/></linearGradient></defs><g data-hrbox-layer="dailyMean"><path d="${splinePath(meanCoords)}" fill="none" stroke="#20D3C2" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" filter="drop-shadow(0 0 8px rgba(32,211,194,.5))"/></g>`;
  const workoutDays=new Set((D.exercise||[]).filter(w=>!w.excluded).map(w=>String(w.day)));
  rows.forEach((q,i)=>{
    const x=X(i),meta=encodeURIComponent(JSON.stringify({day:q.day,n:q.n,low:q.low,q1:q.q1,median:q.median,mean:q.mean,q3:q.q3,high:q.high})),peak=workoutDays.has(String(q.day))&&q.high>170;
    g+=`<g class="hrbox-column" data-hrbox-meta="${meta}" tabindex="0" role="button" aria-label="${q.day}: mean ${q.mean.toFixed(1)}, high ${q.high}, low ${q.low} bpm"><title>${q.day} · mean ${q.mean.toFixed(1)} bpm · high ${q.high} bpm · low ${q.low} bpm</title><rect x="${x-band*.46}" y="${T}" width="${band*.92}" height="${H-T-B}" fill="transparent" class="hrbox-hit"/><line class="hrbox-guide" x1="${x}" x2="${x}" y1="${T}" y2="${H-B}"/>`;
     g+=`<g data-hrbox-layer="dailyHigh"><rect x="${x-band*.225}" y="${Y(q.high)}" width="${Math.max(6,band*.45)}" height="${Math.max(8,Y(q.low)-Y(q.high))}" rx="${Math.min(7,band*.22)}" fill="url(#hr-spread-range)"><title>${q.day} · range ${q.low}–${q.high} bpm</title></rect><line x1="${x-band*.2}" x2="${x+band*.2}" y1="${Y(q.high)}" y2="${Y(q.high)}" stroke="#C7FFFC" stroke-width="1.4"/></g><g data-hrbox-layer="dailyLow"><line x1="${x-band*.2}" x2="${x+band*.2}" y1="${Y(q.low)}" y2="${Y(q.low)}" stroke="#65B5C0" stroke-width="1.4"/></g><g data-hrbox-layer="dailyMean"><circle class="hrbox-hover-mark" cx="${x}" cy="${Y(q.mean)}" r="2.8" fill="#111821" stroke="#E7FFFC" stroke-width="1.5"/></g>`;
     if(peak)g+=`<circle data-hrbox-layer="dailyHigh" cx="${x}" cy="${Y(q.high)}" r="5" fill="#FF6B6B" stroke="#FFF" stroke-width="1.5" filter="drop-shadow(0 0 4px rgba(255,107,107,.65))"><title>Elevated peak · ${q.high} bpm</title></circle>`;
    g+='</g>';
  });
  if(rows.length){
    const tickStart=dayMs(rows[0].day)+DAY,tickEnd=dayMs(rows[rows.length-1].day);
    for(let t=tickStart;t<=tickEnd;t+=7*DAY){const i=rows.findIndex(q=>dayMs(q.day)===t);if(i>=0)g+=`<text x="${X(i)}" y="${H-14}" fill="#71717A" font-size="11" text-anchor="middle" font-variant-numeric="tabular-nums">${fmtDay(t)}</text>`;}
  }
  return `<svg class="hrbox-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Daily heart-rate spread with selectable mean, high, and low curves">${g}<rect class="hrbox-selection" data-hrbox-selection x="0" y="${T}" width="0" height="${H-T-B}" opacity="0"/></svg>`;
}
function recoveryRows(){
  const maps={};for(const k of ['resting_hr','hrv','spo2'])maps[k]=Object.fromEntries((D.daily?.[k]||[]).map(r=>[String(r[0]),Number(r[1])]));
  const keys=[...new Set([...Object.keys(maps.resting_hr),...Object.keys(maps.hrv),...Object.keys(maps.spo2)])].sort();
  return keys.map(day=>({day,rhr:maps.resting_hr[day],hrv:maps.hrv[day],spo:maps.spo2[day]})).filter(r=>Number.isFinite(r.rhr)&&Number.isFinite(r.hrv));
}
function recoveryStatus(r,med){const oks=[r.rhr<=med.rhr,r.hrv>=med.hrv,r.spo==null?null:r.spo>=95].filter(v=>v!==null);const score=oks.filter(Boolean).length;if(score===oks.length)return {label:'Recovered',color:'var(--good)'};if(score===0)return {label:'Strained',color:'var(--bad)'};if(score===1)return {label:'Mixed',color:'var(--warn)'};return {label:'Good',color:'var(--neutral)'};}
function hrvRhrScatterCard(){
  const rows=recoveryRows();if(rows.length<5)return {html:`<div class="empty">Need at least 5 days with HRV and resting-HR measurements. Found ${rows.length}.</div>`};
  const median=a=>{const v=a.slice().sort((x,y)=>x-y);return v.length%2?v[v.length>>1]:(v[v.length/2-1]+v[v.length/2])/2;};
  const med={rhr:median(rows.map(r=>r.rhr)),hrv:median(rows.map(r=>r.hrv))},sd={rhr:std(rows.map(r=>r.rhr)),hrv:std(rows.map(r=>r.hrv))};
  const width=Math.floor(document.querySelector('#card-hrvscatter .plot')?.clientWidth||0);if(!width)return {html:'<div class="skeleton"></div>'};
  const W=width,H=Math.max(420,Math.min(500,Math.floor(document.querySelector('#card-hrvscatter .plot')?.clientHeight||460))),L=52,R=18,T=18,B=42,pw=W-L-R,ph=H-T-B;
   const xs=rows.map(r=>r.rhr),ys=rows.map(r=>r.hrv),padx=Math.max(1,(Math.max(...xs)-Math.min(...xs))*.08),pady=Math.max(2,(Math.max(...ys)-Math.min(...ys))*.08),yStep=(Math.max(...ys)-Math.min(...ys))>90?20:15;
   const xmin=Math.min(...xs)-padx,xmax=Math.max(...xs)+padx,ymin=Math.max(0,Math.floor((Math.min(...ys)-pady)/yStep)*yStep),ymax=Math.ceil((Math.max(...ys)+pady)/yStep)*yStep;
  const X=v=>L+(xmax-v)/(xmax-xmin||1)*pw,Y=v=>T+(ymax-v)/(ymax-ymin||1)*ph;
  const n=rows.length,last7=rows.slice(-7);let svg=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" tabindex="0" aria-label="Recovery map: lower resting heart rate is to the right, higher HRV is up">`;
  const mx=X(med.rhr),my=Y(med.hrv),x1=X(med.rhr+sd.rhr),x2=X(med.rhr-sd.rhr),y1=Y(med.hrv+sd.hrv),y2=Y(med.hrv-sd.hrv);
   svg+=`<rect class="normal-envelope" x="${Math.min(x1,x2)}" y="${Math.min(y1,y2)}" width="${Math.abs(x2-x1)}" height="${Math.abs(y2-y1)}" rx="8" fill="rgba(255,255,255,.03)" stroke="rgba(255,255,255,.25)" stroke-width="1" stroke-dasharray="5 4"/>`;
   const quads=[{x:L,y:T,w:mx-L,h:my-T,c:'#F59E0B',label:'Fit but strained',right:false,bottom:false},{x:mx,y:T,w:W-R-mx,h:my-T,c:'#10B981',label:'Recovered',right:true,bottom:false},{x:L,y:my,w:mx-L,h:H-B-my,c:'#F43F5E',label:'Strained',right:false,bottom:true},{x:mx,y:my,w:W-R-mx,h:H-B-my,c:'#38BDF8',label:'Low HRV, low RHR',right:true,bottom:true}];
   quads.forEach(q=>{const qx=Math.max(0,q.w),qy=Math.max(0,q.h),bw=Math.min(qx-8,Math.max(58,q.label.length*6.2+14)),bx=q.right?q.x+qx-bw-5:q.x+5,by=q.bottom?q.y+qy-24:q.y+5;svg+=`<rect x="${q.x}" y="${q.y}" width="${qx}" height="${qy}" fill="${q.c}" fill-opacity=".05"/>`;if(bw>30&&qy>24)svg+=`<g class="recovery-quadrant-badge"><rect x="${bx}" y="${by}" width="${bw}" height="19" rx="8" fill="#111113" fill-opacity=".78" stroke="${q.c}" stroke-opacity=".32"/><text x="${bx+bw/2}" y="${by+13}" text-anchor="middle" fill="${q.c}" font-size="10" font-weight="650">${q.label}</text></g>`;});
   for(let i=0;i<=4;i++){const xv=xmin+(xmax-xmin)*i/4;svg+=`<line x1="${X(xv)}" x2="${X(xv)}" y1="${T}" y2="${H-B}" stroke="#FFFFFF" stroke-opacity=".10"/><text x="${X(xv)}" y="${H-B+16}" fill="var(--axis-text)" font-size="11" text-anchor="middle">${xv.toFixed(0)}</text>`;} for(let yv=ymin;yv<=ymax+1e-6;yv+=yStep){svg+=`<line x1="${L}" x2="${W-R}" y1="${Y(yv)}" y2="${Y(yv)}" stroke="#FFFFFF" stroke-opacity=".10"/><text x="${L-7}" y="${Y(yv)+3}" fill="var(--axis-text)" font-size="11" text-anchor="end">${yv.toFixed(0)}</text>`;}
  svg+=`<line x1="${mx}" x2="${mx}" y1="${T}" y2="${H-B}" stroke="var(--ink2)" stroke-dasharray="2 4"/><line x1="${L}" x2="${W-R}" y1="${my}" y2="${my}" stroke="var(--ink2)" stroke-dasharray="2 4"/>`;
   rows.forEach((r,i)=>{const st=recoveryStatus(r,med),latest=i===n-1,rad=latest?6:2.5+3*((i+1)/n),color=r.spo==null?'#A1A1AA':r.spo>=95?'#10B981':r.spo>=94?'#F59E0B':'#F43F5E',tip=encodeURIComponent(JSON.stringify({day:r.day,rhr:r.rhr,hrv:r.hrv,spo:r.spo,status:st.label}));if(latest)svg+=`<circle class="recovery-latest-ring" cx="${X(r.rhr)}" cy="${Y(r.hrv)}" r="11" fill="none" stroke="#E0F2FE" stroke-width="2" opacity=".9"/>`;svg+=`<circle cx="${X(r.rhr)}" cy="${Y(r.hrv)}" r="${rad}" fill="${color}" fill-opacity=".8" stroke="#121212" stroke-width="1.5" tabindex="0" role="button" aria-label="${r.day}: resting heart rate ${r.rhr.toFixed(0)} bpm, HRV ${r.hrv.toFixed(1)} milliseconds" data-recovery-tip="${tip}" class="recovery-scatter-point${latest?' recovery-latest-dot':''}" onclick="window.selectRecoveryDay('${r.day}')"/>`;});
   const cur=rows[rows.length-1];svg+=`<text x="${(L+W-R)/2}" y="${H-8}" fill="var(--axis-text)" font-size="11" text-anchor="middle">Resting HR (bpm) · lower is better →</text><text transform="translate(13 ${(T+H-B)/2}) rotate(-90)" fill="var(--axis-text)" font-size="11" text-anchor="middle">HRV (ms) · higher is better</text></svg>`;
   return {html:svg,foot:`<div class="spo2-status-legend"><b>SpO₂ status</b><span><i style="background:#10B981"></i>Green ≥95%</span><span><i style="background:#F59E0B"></i>Amber 94–&lt;95%</span><span><i style="background:#F43F5E"></i>Rose &lt;94%</span><span class="sub">Latest day: ${cur.day}</span></div>`,cols:['Date','Resting HR (bpm)','HRV (ms)','SpO₂ (%)','Status'],rows:rows.slice().reverse().map(r=>[r.day,r.rhr.toFixed(0),r.hrv.toFixed(1),r.spo==null?'—':r.spo.toFixed(1),recoveryStatus(r,med).label])};
}

let recoveryScatterTooltip=null;
function showRecoveryScatterTooltip(dot){
  let q;try{q=JSON.parse(decodeURIComponent(dot.dataset.recoveryTip||''));}catch(_){return;}
  if(!recoveryScatterTooltip){recoveryScatterTooltip=document.createElement('div');recoveryScatterTooltip.className='recovery-scatter-tooltip';recoveryScatterTooltip.setAttribute('role','status');document.body.appendChild(recoveryScatterTooltip);}
  recoveryScatterTooltip.innerHTML=`<b>${new Date(q.day+'T12:00:00').toLocaleDateString([], {weekday:'short',month:'short',day:'numeric',year:'numeric'})}</b><div>Resting HR <strong>${Number(q.rhr).toFixed(0)} bpm</strong></div><div>HRV <strong>${Number(q.hrv).toFixed(1)} ms</strong></div><div>SpO₂ <strong>${q.spo==null?'—':Number(q.spo).toFixed(1)+'%'}</strong></div><div>Recovery <strong>${esc(q.status)}</strong></div>`;
  const r=dot.getBoundingClientRect(),w=248,h=118;let x=r.right+12,y=r.top-h/2;if(x+w>innerWidth-8)x=r.left-w-12;if(x<8)x=Math.max(8,Math.min(innerWidth-w-8,r.left-w/2));y=Math.max(8,Math.min(innerHeight-h-8,y));recoveryScatterTooltip.style.left=`${x}px`;recoveryScatterTooltip.style.top=`${y}px`;recoveryScatterTooltip.classList.add('visible');
}
function hideRecoveryScatterTooltip(){recoveryScatterTooltip?.classList.remove('visible');}
document.addEventListener('pointerover',e=>{const dot=e.target.closest?.('#card-hrvscatter [data-recovery-tip]');if(dot)showRecoveryScatterTooltip(dot);});
document.addEventListener('pointerout',e=>{if(e.target.closest?.('#card-hrvscatter [data-recovery-tip]')&&!e.relatedTarget?.closest?.('#card-hrvscatter [data-recovery-tip]'))hideRecoveryScatterTooltip();});
document.addEventListener('focusin',e=>{const dot=e.target.closest?.('#card-hrvscatter [data-recovery-tip]');if(dot)showRecoveryScatterTooltip(dot);});
document.addEventListener('focusout',e=>{if(e.target.closest?.('#card-hrvscatter [data-recovery-tip]'))hideRecoveryScatterTooltip();});

function temperatureCard(){
  const measured=dailyPts('body_temp').filter(q=>q.y!=null),rawStart=periodStart(period),firstDay=Number.isFinite(rawStart)?dayMs(localDateKey(rawStart)):(measured[0]?.x??dayMs(D.today)-29*DAY),lastDay=dayMs(D.today),byDay=new Map(measured.map(q=>[String(q.day||localDateKey(q.x)),q])),dailyValue=key=>new Map((D.daily?.[key]||[]).map(r=>[String(r[0]),Number(r[1])])),nightByDay=dailyValue('skin_temp_night'),baseByDay=dailyValue('skin_temp_base'),sdByDay=dailyValue('skin_temp_sd30');
  const calendar=[];for(let x=firstDay;x<=lastDay;x+=DAY){const day=localDateKey(x),q=byDay.get(day);calendar.push(q?{...q,x,y:Number(q.y),day,nightTemp:nightByDay.get(day),baselineTemp:baseByDay.get(day),sd30:sdByDay.get(day)}:{x,y:null,day,nightTemp:nightByDay.get(day),baselineTemp:baseByDay.get(day),sd30:sdByDay.get(day)});}
  const pts=calendar.filter(q=>q.y!=null);if(!pts.length)return {kind:'line',pts:[],empty:'No daily sleep-temperature derivation is stored.',cols:[],rows:[]};
  const vals=pts.map(q=>q.y),maxAbs=Math.max(.7,...vals.map(v=>Math.abs(v)))+.1,bodyAvg=mean(vals),hiPt=pts.reduce((a,b)=>a.y>b.y?a:b),loPt=pts.reduce((a,b)=>a.y<b.y?a:b),strainNights=pts.filter(q=>Math.abs(q.y)>=.5).length,strainColor=strainNights?'#F43F5E':'#10B981',latest=pts.at(-1),latestZ=Number.isFinite(latest.sd30)&&latest.sd30>0?latest.y/latest.sd30:null,topHtml=`<div class="sleep-kpi-row temp-kpi-row"><div><small>Period Average</small><b style="color:#E2E8F0">${bodyAvg>=0?'+':''}${bodyAvg.toFixed(2)} °C</b><span>Recovery baseline</span></div><div><small>Max Positive</small><b style="color:#FB923C">${hiPt.y>=0?'+':''}${hiPt.y.toFixed(2)} °C</b><span>${fmtDay(hiPt.x)}</span></div><div><small>Max Drop</small><b style="color:#38BDF8">${loPt.y.toFixed(2)} °C</b><span>${fmtDay(loPt.x)}${loPt.y<=-.5?' · Strain':''}</span></div><div class="temp-strain-kpi"><small>Strain Nights</small><b><span class="temp-strain-pill" style="--temp-strain-color:${strainColor}">${strainNights} ${strainNights===1?'Night':'Nights'}</span></b><span>Beyond ±0.50 °C</span></div></div><div class="temp-source-context"><span>Latest nightly skin temperature <b>${Number.isFinite(latest.nightTemp)?latest.nightTemp.toFixed(2)+' °C':'—'}</b></span><span>Google 30-day median baseline <b>${Number.isFinite(latest.baselineTemp)?latest.baselineTemp.toFixed(2)+' °C':'—'}</b></span><span>30-day relative SD <b>${Number.isFinite(latest.sd30)?latest.sd30.toFixed(2)+' °C':'—'}</b></span><span>Deviation <b>${latestZ==null?'—':`${latestZ>=0?'+':''}${latestZ.toFixed(2)} SD`}</b></span></div>`,xTicks=[];for(let x=firstDay;x<=lastDay;x+=7*DAY)xTicks.push(x);
  return {
    kind:'diverging',pts:calendar.map(q=>({...q,pos:q.y==null?false:q.y>=0})),step:DAY,xMin:firstDay,xMax:lastDay+DAY,padLeft:58,padRight:0,padBottom:34,padTop:10,fixedMargins:true,axisLabelsInside:false,yTickGap:8,barCategoryGapPct:22,xTickPadding:10,xTickDy:18,
    color:'var(--temp-high)',barColorFn:p=>p.y>=0?'var(--temp-high)':'var(--temp-low)',barRadius:3,
    yMin:-maxAbs,yMax:maxAbs,yTickValues:[-1.5,-1,-.5,0,.5,1,1.5],
    yTickColorFn:v=>Math.abs(Math.abs(v)-.5)<1e-6?'var(--bad)':'var(--axis-text)',yTickWeightFn:v=>Math.abs(Math.abs(v)-.5)<1e-6?700:400,
    fmtY:v=>v===0?'0.00°':`${v>0?'+':''}${v.toFixed(2)}°`,
    areaBands:[{y1:.5,y2:maxAbs,color:'#F97316',opacity:.05},{y1:-maxAbs,y2:-.5,color:'#06B6D4',opacity:.05}],baseline:0,baselineColor:'rgba(255,255,255,.25)',baselineWidth:1,avg:bodyAvg,avgColor:'var(--temp-high)',avgDash:'5 4',avgWidth:1.4,avgLineOpacity:.42,avgLineOnly:true,
    thresholds:[{y:.5,color:'rgba(249,115,22,.45)',dash:'3 4'},{y:-.5,color:'rgba(6,182,212,.45)',dash:'3 4'}],
    fmtX:fmtDay,label:'Nightly body-temperature deviation',xTicks,minTickGap:28,topHtml,h:340,
    tip:q=>`<b>${fmtDayLong(q.x)}</b>${tipRow('Nightly skin temperature',Number.isFinite(q.nightTemp)?q.nightTemp.toFixed(2)+' °C':'Not recorded')}${tipRow('30-day median baseline',Number.isFinite(q.baselineTemp)?q.baselineTemp.toFixed(2)+' °C':'Unavailable')}${tipRow('Deviation',(q.y>=0?'+':'')+q.y.toFixed(2)+' °C',q.y>=0?'var(--temp-high)':'var(--temp-low)')}${tipRow('30-day relative SD',Number.isFinite(q.sd30)?q.sd30.toFixed(2)+' °C':'Unavailable')}${Number.isFinite(q.sd30)&&q.sd30>0?tipRow('Normalized deviation',`${(q.y/q.sd30>=0?'+':'')}${(q.y/q.sd30).toFixed(2)} SD`):''}${Math.abs(q.y)>=.5?tipRow('Status',q.y>0?'Above +0.50 °C strain threshold':'Below −0.50 °C threshold','var(--bad)'):''}`,
    cols:['Day','Deviation °C'],rows:pts.slice().reverse().map(q=>[q.day,(q.y>=0?'+':'')+q.y.toFixed(2)])
  };
}

window.recoveryHover=function(evt,svg){
  const rect=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal,px=(evt.clientX-rect.left)/rect.width*vb.width;
  const dots=[...svg.querySelectorAll('circle[data-recovery-day]')];if(!dots.length)return;
  let best=null,dist=Infinity;for(const d of dots){const x=+d.getAttribute('cx'),dd=Math.abs(x-px);if(dd<dist){dist=dd;best=d;}}if(!best)return;
  const day=best.dataset.recoveryDay,idx=best.dataset.recoveryIndex,related=dots.filter(d=>d.dataset.recoveryDay===day),cross=svg.querySelector('#recovery-crosshair');
  const x=+best.getAttribute('cx');if(cross){cross.setAttribute('x1',x);cross.setAttribute('x2',x);cross.setAttribute('opacity','1');}
  related.forEach(d=>{d.setAttribute('r','5.5');d.setAttribute('stroke','#FAFAFA');d.setAttribute('stroke-width','1.5');});dots.filter(d=>d.dataset.recoveryDay!==day).forEach(d=>{d.setAttribute('r','3');d.setAttribute('stroke',d.dataset.recoveryDay===window._recoverySelectedDay?'#FAFAFA':'var(--surface)');d.setAttribute('stroke-width',d.dataset.recoveryDay===window._recoverySelectedDay?'2':'1');});
  const row=(recoveryRows()||[]).find(r=>r.day===day);if(!row)return;const med={rhr:mean(recoveryRows().map(r=>r.rhr)),hrv:mean(recoveryRows().map(r=>r.hrv))},st=recoveryStatus(row,med);
  let tip=svg.parentElement.querySelector('.recovery-hover-tip');if(!tip){tip=document.createElement('div');tip.className='spo2-tip recovery-hover-tip';svg.parentElement.appendChild(tip);}tip.innerHTML=`<b>📅 ${day} · ${st.label}</b><div>Resting HR: <b>${row.rhr.toFixed(1)} bpm</b> (baseline ${med.rhr.toFixed(1)})</div><div>HRV: <b>${row.hrv.toFixed(1)} ms</b> (baseline ${med.hrv.toFixed(1)})</div><div>SpO₂: <b>${row.spo==null?'—':row.spo.toFixed(1)+'%'}</b></div>`;tip.style.display='block';const pr=svg.parentElement.getBoundingClientRect();tip.style.left=Math.max(4,Math.min(pr.width-250,(evt.clientX-pr.left)+12))+'px';tip.style.top='8px';
};
window.recoveryHoverLeave=function(svg){const c=svg.querySelector('#recovery-crosshair');if(c)c.setAttribute('opacity','0');const tip=svg.parentElement.querySelector('.recovery-hover-tip');if(tip)tip.style.display='none';};
window.selectRecoveryDay=function(day){window._recoverySelectedDay=day;const a=document.querySelector('#card-hrvscatter'),b=document.querySelector('#card-combo');if(a)renderCardByElement(a,true);if(b)renderCardByElement(b,true);openDayDetail(day,'Recovery chart');};
function liveStressHtml(){
 const median=a=>{const v=[...a].sort((x,y)=>x-y);return v.length%2?v[v.length>>1]:(v[v.length/2-1]+v[v.length/2])/2;},now=Date.now(),raw=(D.stress_hr_minutes||[]).filter(r=>Number.isFinite(+r[0])&&Number.isFinite(+r[1])).map(r=>({t:Math.floor(+r[0]/60000)*60000,x:+r[1],n:+r[2]||0})).sort((a,b)=>a.t-b.t),steps=D.steps_5m||[],stepMap=new Map(steps.map(r=>[Math.floor(+r[0]/300000),Number(r[1])||0])),sleeps=D.sleep||[],workouts=activeWorkouts();
 const asleep=t=>sleeps.some(s=>{const a=Date.parse(s.start),b=Date.parse(s.end);return Number.isFinite(a)&&Number.isFinite(b)&&t>=a&&t<b;}),working=t=>workouts.some(w=>{const a=Date.parse(w.start),b=Date.parse(w.end);return Number.isFinite(a)&&Number.isFinite(b)&&t>=a&&t<b+15*60000;}),hasSteps=t=>stepMap.has(Math.floor(t/300000)),moving=t=>(stepMap.get(Math.floor(t/300000))||0)>0;
 const eligible=p=>!asleep(p.t)&&!working(p.t)&&!moving(p.t),localClock=t=>{const d=new Date(t);return d.getHours()*60+d.getMinutes();};
 if(!raw.length)return '<div class="live-stress"><div class="live-stress-empty">No minute-level heart-rate history is available yet. Sync data to begin building your personal baseline.</div></div>';
 const clockBins=Array.from({length:1440},()=>[]);raw.forEach(p=>{if(eligible(p))clockBins[localClock(p.t)].push(p);});const baseFor=p=>{const clock=localClock(p.t),vals=[];for(let delta=-30;delta<=30;delta++){const slot=(clock+delta+1440)%1440;for(const q of clockBins[slot]){const age=p.t-q.t;if(age>=28*86400000&&age<=60*86400000)vals.push(q.x);}}if(vals.length<14)return null;const med=median(vals),mad=median(vals.map(v=>Math.abs(v-med)));return {med,sigma:Math.max(4,1.4826*mad),n:vals.length};},zCache=new WeakMap();
 const zFor=p=>{if(zCache.has(p))return zCache.get(p);const b=baseFor(p),v=b?{z:clamp((p.x-b.med)/b.sigma,-3,4),base:b}:null;zCache.set(p,v);return v;};
 const latest=[...raw].reverse().find(p=>p.t<=now&&now-p.t<=2*60000);if(!latest)return '<div class="live-stress"><div class="live-stress-empty">Waiting for a recent heart-rate sample. The score appears when fresh data arrives.</div></div>';
 const minute=latest.t,coverage=Array.from({length:15},(_,i)=>raw.some(p=>p.t===minute-i*60000&&eligible(p))).filter(Boolean).length/15,conf=Math.round(coverage*100),resting=eligible(latest),lastWorkout=workouts.some(w=>{const b=Date.parse(w.end);return Number.isFinite(b)&&minute>=b&&minute<b+15*60000;});
 if(asleep(minute)||lastWorkout||!resting)return '<div class="live-stress"><div class="live-stress-empty">Live score paused during sleep, exercise, or detected movement. It resumes when you are awake and still.</div></div>';
 if(coverage<.5)return `<div class="live-stress"><div class="live-stress-empty">Not enough still heart-rate coverage for a score (${conf}% of the last 15 minutes; need at least 50%).</div></div>`;
 const currentZ=zFor(latest);if(!currentZ)return `<div class="live-stress"><div class="live-stress-empty">Building your time-of-day baseline. At least 14 valid comparison samples are needed for this clock window; current coverage is ${conf}%.</div></div>`;
 const short=[];for(let k=0;k<15;k++){const p=raw.find(q=>q.t===minute-k*60000);if(!p||!eligible(p))continue;const z=zFor(p);if(z)short.push({k,z:z.z});}const sw=short.reduce((a,p)=>a+Math.pow(.5,p.k/5),0),S=sw?short.reduce((a,p)=>a+p.z*Math.pow(.5,p.k/5),0)/sw:0,old=raw.filter(p=>p.t>=minute-75*60000&&p.t<=minute-15*60000&&eligible(p)).map(p=>p.x),R=old.length?(latest.x-median(old))/currentZ.base.sigma:0,A=.75*S+.25*R;
 const loadAt=end=>{let sum=0;for(const p of raw){const age=end-p.t;if(age<0||age>24*3600000||localClock(p.t)%5!==0||!eligible(p))continue;const z=zFor(p);if(!z)continue;sum+=5*Math.pow(.5,age/(8*3600000))*Math.max(0,z.z-.5);}return sum/60;};
 const L=loadAt(minute),histL=[];for(let d=1;d<=30;d++){const target=minute-d*86400000,p=[...raw].reverse().find(q=>q.t<=target&&target-q.t<6*60000&&eligible(q));if(p){const l=loadAt(p.t);if(Number.isFinite(l))histL.push(l);}}if(histL.length<7)return `<div class="live-stress"><div class="live-stress-empty">Personal 24-hour load baseline is still forming (${histL.length}/7 comparable days). The instantaneous score is withheld until enough history exists.</div></div>`;
 const lmed=median(histL),lmad=median(histL.map(v=>Math.abs(v-lmed))),Lz=(L-lmed)/Math.max(.05,1.4826*lmad);
 const recovery=computeRecovery().score,Drec=recovery==null?0:-inverseNormalCdf(clamp(recovery/100,.001,.999));
 const daily=(D.hr_strain||[]).filter(r=>r[0]<=D.today).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),vals=daily.slice(-28).map(r=>+r[1]).filter(Number.isFinite),strainToday=vals.length?vals[vals.length-1]:0,strainBase=median(vals),strainMad=median(vals.map(v=>Math.abs(v-strainBase))),X=(strainToday-strainBase)/Math.max(1,1.4826*strainMad),Lc=.6*Lz+.25*Drec+.15*X,zs=A*(1+.25*Math.tanh(Lc))+.35*Lc;
 const cdf=normalCdf(zs/1.2),instant=clamp(100*cdf,0,100),prior=window._liveStressSmooth,elapsed=prior?Math.max(0,(minute-prior.t)/60000):3,alpha=1-Math.pow(.5,elapsed/3),score=prior?prior.value+alpha*(instant-prior.value):instant;window._liveStressSmooth={t:minute,value:score};
 const label=score<=25?'Resting':score<=50?'Low':score<=75?'Medium':'High',color=score<=25?'#22C55E':score<=50?'#8AB4F8':score<=75?'#F59E0B':'#FB7185',base=currentZ.base;
 return `<div class="live-stress"><div class="live-stress-head"><div><div class="sub">Current · ${new Date(minute).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}</div><div class="live-stress-score" style="color:${color}">${Math.round(score)}<small> / 100</small></div><div class="live-stress-label" style="color:${color}">${label} arousal</div></div><div class="live-stress-confidence">${conf}%<span>15-minute coverage</span></div></div><div class="live-stress-meter"><i style="width:${score}%;background:${color}"></i></div><div class="live-stress-bands"><span>Resting</span><span>Low</span><span>Medium</span><span>High</span></div><div class="live-stress-detail">Current HR floor <b>${latest.x.toFixed(1)} bpm</b> · clock-time baseline <b>${base.med.toFixed(1)} ± ${base.sigma.toFixed(1)} bpm</b> · ${base.n} still samples in the comparison window.</div><div class="live-stress-note">Arousal estimate only; movement is excluded using 5-minute step totals. Stress score is separate from workout strain and cannot identify its cause.</div></div>`;
}

function trainingPrescriptionHtml(){
 const r=computeRecovery(),score=r.score,day=D.today||localDateKey(Date.now());
 if(score==null)return `<div class="training-plan"><div class="training-plan-top"><div><div class="sub">Today · ${day}</div><h3 style="margin:6px 0">Recovery score unavailable</h3><div class="training-plan-muted">There is not enough current biometric and sleep data to set a score-based load.</div></div></div><div class="training-plan-callout">Choose rest or an easy walk while data recovers. Avoid using a stale score to justify hard training.</div></div>`;
 const bands=[
 {lo:0,hi:20,label:'Rest / reset',strain:'0–3 / 21',cardio:'Rest, or an easy outdoor walk for 20–30 minutes. Keep heart rate below 108 bpm; add 10–15 minutes of gentle mobility.',strength:'No loaded strength work today.',timing:'Any time; get daylight within 6 hours of waking.',avoid:'Skip running, lifting, intervals and prolonged heat.'},
 {lo:21,hi:33,label:'Easy movement',strain:'3–6 / 21',cardio:'Walk, cycle or elliptical for 30–40 minutes at 112–125 bpm (cycling about 105–118). Alternative: 15–20 minutes gentle mobility and core activation.',strength:'Core activation only: dead bug, bird dog, side plank and glute bridge; easy sets, no added load.',timing:'Start 2–8 hours after waking.',avoid:'Skip running above 125 bpm and loaded lifting.'},
 {lo:34,hi:45,label:'Light aerobic / technique',strain:'5–8 / 21',cardio:'35–40 minutes easy aerobic work at 125–138 bpm. A run/walk pattern is fine.',strength:'Alternative: 25–35 minutes full-body technique work, about 2 sets per move, with at least 4 reps in reserve.',timing:'Start 3–10 hours after waking.',avoid:'Stay at or below 138 bpm; skip intervals and hard sets.'},
 {lo:46,hi:55,label:'Steady / moderate',strain:'8–11 / 21',cardio:'40–45 minutes steady in Z2 at 138–148 bpm.',strength:'Alternative: 45–55 minutes full body, about 3 sets per move, stopping with 3 reps in reserve.',timing:'Start 3–10 hours after waking.',avoid:'Skip Z4+, heavy singles/triples and failure.'},
 {lo:56,hi:66,label:'Controlled quality',strain:'9–12 / 21',cardio:'33–42 minutes total: warm up, 15–20 minutes tempo at 152–162 bpm, then cool down.',strength:'Alternative: 50–60 minutes upper or lower body, 2 reps in reserve. Pick one focus; avoid hard legs after a recent quality run.',timing:'Start 5–10 hours after waking.',avoid:'No Z4+, sprints or lower-body failure work.'},
 {lo:67,hi:77,label:'Quality session',strain:'11–14 / 21',cardio:'Choose one: 45–52 minute threshold run with 25–30 minutes at 160–168 bpm, or 45–60 minutes tempo cycling at 145–155 bpm.',strength:'Alternative: 60–70 minutes hypertrophy work for two muscle groups, 1–2 reps in reserve. Avoid hard legs within 48 hours of quality running.',timing:'Start 6–11 hours after waking; finish hard work 3–4 hours before bed.',avoid:'Save maximal efforts for a higher band; limit quality sessions.'},
 {lo:78,hi:88,label:'Hard session',strain:'13–16 / 21',cardio:'Choose one: 5 × 4-minute intervals (about 57 minutes total) or a 70–85 minute long Z2 run at 138–150 bpm.',strength:'Alternative: 60–75 minutes heavy strength, 1–2 reps in reserve. Do not pair heavy legs with intervals.',timing:'Start 7–11 hours after waking; finish 3–4 hours before bed.',avoid:'No second hard session within 48 hours; avoid hard sessions on consecutive days.'},
 {lo:89,hi:100,label:'Peak capacity',strain:'14–18 / 21',cardio:'Choose one: 6 × 3-minute VO₂ intervals (about 56 minutes), or 8–10 short uphill sprints with full walking recovery.',strength:'Alternative: heavy strength focused on a few compound lifts, stopping 1–2 reps before failure.',timing:'Start 7–11 hours after waking; finish 3–4 hours before bed.',avoid:'No second hard session within 48 hours or hard training on consecutive days.'}
 ];
 let idx=bands.findIndex(b=>score>=b.lo&&score<=b.hi),overrides=[];if(idx<0)idx=0;
 const sleepMins=Number(r.lastSleep?.asleep)||0;if(sleepMins>0&&sleepMins<240){idx=Math.min(idx,2);overrides.push('Under 4 hours sleep: cap at the 34–45 plan.');}else if(sleepMins>0&&sleepMins<300){idx=Math.min(idx,4);overrides.push('Under 5 hours sleep: cap at the 56–66 plan; no Z4+ or near-failure sets.');}
 if(r.healthFlags?.length){idx=Math.min(idx,1);overrides.push('Wearable health flag: cap at the 21–33 easy plan. Fever, chest symptoms or palpitations mean rest and medical advice.');}
 if(Number.isFinite(r.todayRhr)&&Number.isFinite(r.baseRhr)&&r.todayRhr>=r.baseRhr+5){idx=Math.max(0,idx-1);overrides.push('Resting HR is at least 5 bpm above baseline: drop one band.');}
 const d=D.recovery_daily||D.daily||{},hrv=(D.daily?.hrv||[]).filter(x=>x[0]<=day&&Number(x[1])>0).sort((a,b)=>a[0].localeCompare(b[0])),baseRows=hrv.filter(x=>x[0]<day).slice(-30).map(x=>Number(x[1])),base=mean(baseRows),recent=hrv.filter(x=>x[0]<day).slice(-3);if(base!=null&&recent.length===3&&recent.every(x=>Number(x[1])<base)){idx=Math.min(idx,3);overrides.push('HRV is below recent baseline for 3 readings: skip intensity and stay easy.');}
 const load=dailyStrainScore(day);if(Number.isFinite(load.acute)&&Number.isFinite(load.chronic)&&load.chronic>0&&load.acute/load.chronic>1.3){idx=Math.max(0,idx-1);overrides.push('Recent 7-day load is high versus 28-day load: drop one band.');}
 const b=bands[idx],color=score>=67?'#22C55E':score>=34?'#8AB4F8':'#FB8C5A',actual=Number.isFinite(r.strainScore)?`${r.strainScore.toFixed(1)} / 21 recorded today`:'No strain recorded yet today',rules=[...overrides,'Keep at least one rest or walk-only day each week; cap hard sessions at two per week and never on consecutive days.','Increase weekly training time by no more than 10%; stop for sharp pain and skip sore or painful muscle groups.'];
 return `<div class="training-plan"><div class="training-plan-top"><div><div class="sub">Today · ${day}</div><div class="training-plan-score" style="color:${color}">${score}<small> / 100 · ${b.label}</small></div></div><span class="training-plan-tag">Target strain ${b.strain}</span></div><div class="training-plan-grid"><div class="training-plan-item"><h4>Cardio plan</h4><p>${b.cardio}</p></div><div class="training-plan-item"><h4>Strength alternative</h4><p>${b.strength}</p></div><div class="training-plan-item"><h4>When to train</h4><p>${b.timing}</p></div><div class="training-plan-item"><h4>Keep it in bounds</h4><p>${b.avoid}</p></div></div><div class="training-plan-callout"><b>Today’s load:</b> ${actual}. Strain is estimated separately from recovery; use the target as a guide and don’t add work just to reach it.</div><div class="training-plan-rules">${rules.map(x=>`<div><span aria-hidden="true">•</span><span>${x}</span></div>`).join('')}</div><div class="training-plan-muted">Personalized from the supplied training reference. HR zones and wearable strain are estimates; symptoms and how you feel should take priority.</div></div>`;
}
