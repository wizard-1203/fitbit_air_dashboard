/* ============================================================
   RECOVERY / FITNESS / SLEEP HELPERS
   ============================================================ */
/* Dashboard estimates use fixed weights; missing signals receive a neutral placeholder and remain visible in coverage. */
function buildDataIndexes(data){
  const rows=(data.hr_strain||[]).map(r=>({day:String(r?.[0]||''),score:Number(r?.[1]),count:Number(r?.[3])||0}))
    .filter(r=>r.day).sort((a,b)=>a.day.localeCompare(b.day));
  const firstByDay=new Map(),sum=[0],count=[0];
  for(let i=0;i<rows.length;i++){
    if(!firstByDay.has(rows[i].day))firstByDay.set(rows[i].day,rows[i]);
    const valid=Number.isFinite(rows[i].score);sum.push(sum[i]+(valid?rows[i].score:0));count.push(count[i]+(valid?1:0));
  }
  data._idx={strainRows:rows,strainByDay:firstByDay,strainSum:sum,strainCount:count,recoveryCache:new Map(),sleepDebtCache:new Map()};
}
function dailyStrainScore(day){
  const idx=D?._idx;
  if(idx?.strainRows){
    const key=String(day),row=idx.strainByDay.get(key);let lo=0,hi=idx.strainRows.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(idx.strainRows[mid].day<=key)lo=mid+1;else hi=mid;}
    const average=width=>{const start=Math.max(0,lo-width),n=idx.strainCount[lo]-idx.strainCount[start];return n?(idx.strainSum[lo]-idx.strainSum[start])/n:null;};
    const score=row?row.score:(D.today===key?0:null),count=row?.count||0;
    return {score:Number.isFinite(score)?score:null,count,sampleCount:count,acute:average(7),chronic:average(28)};
  }
  const row=(D.hr_strain||[]).find(r=>String(r[0])===String(day));
  const count=Number(row?.[3])||0,score=row?Number(row[1]):(D.today===day?0:null);
  const history=(D.hr_strain||[]).filter(r=>String(r[0])<=String(day)).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  const daily=history.map(r=>Number(r[1])).filter(Number.isFinite);
  return {score:Number.isFinite(score)?score:null,count,sampleCount:count,acute:daily.slice(-7).length?mean(daily.slice(-7)):null,chronic:daily.slice(-28).length?mean(daily.slice(-28)):null};
}function computeNetSleepDebt(asOfDay=null){
  const cache=D?._idx?.sleepDebtCache,key=asOfDay||'__all__';
  if(cache?.has(key))return cache.get(key);
  const goalH=Number(D.settings?.sleep_goal)||8,dateOf=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?localDateKey(d.getTime()):null;},all=(D.sleep_score_history||D.sleep||[]).filter(s=>Number(s.asleep)>0&&(!asOfDay||(dateOf(s.end)||s.day)<=asOfDay));
  const mains=all.filter(s=>s.main&&!s.nap).sort((a,b)=>new Date(a.end)-new Date(b.end)).slice(-14);
  if(!mains.length){const empty={goalH,total:0,days:[],n:0};cache?.set(key,empty);return empty;}
  const cutoff=dateOf(mains[0].end)||mains[0].day,byDay=new Map();
  for(const sl of all){const day=dateOf(sl.end)||sl.day;if(!day||day<cutoff)continue;const row=byDay.get(day)||{day,nights:0,nightHours:0,napHours:0};if(sl.main&&!sl.nap){row.nights++;row.nightHours+=(Number(sl.asleep)||0)/60;}else row.napHours+=(Number(sl.asleep)||0)/60;byDay.set(day,row);}
  let total=0,previous=null;const days=[...byDay.values()].sort((a,b)=>a.day.localeCompare(b.day)).map(row=>{
    if(previous){const elapsed=Math.max(1,(Date.parse(row.day+'T12:00:00')-Date.parse(previous+'T12:00:00'))/86400000);total*=Math.pow(.5,elapsed/3.5);}
    const nightNeed=goalH*row.nights,delta=nightNeed-row.nightHours;
    total=delta>=0?total+delta:Math.max(0,total+delta*.75);
    total=Math.max(0,total-row.napHours);
    previous=row.day;return {...row,hours:row.nightHours+row.napHours,gap:Math.max(0,delta-row.napHours),cum:total};
  });
  const result={goalH,total,days,n:mains.length};cache?.set(key,result);return result;
}
function scoreBand(pct,lo,hi,lowZero,highZero){
  if(!Number.isFinite(pct))return null;if(pct>=lo&&pct<=hi)return 100;
  if(pct<lo)return pct<=lowZero?0:100*(pct-lowZero)/(lo-lowZero);
  return pct>=highZero?0:100*(highZero-pct)/(highZero-hi);
}
function sleepScoreComponents(main){
  if(!main)return null;
  const all=(D.sleep_score_history||D.sleep||[]).filter(s=>s.main&&!s.nap&&Number(s.asleep)>0),goal=Number(D.settings?.sleep_goal)||8,asleepMin=Number(main.asleep),inBed=Number(main.in_bed);
  if(!(asleepMin>0)||!(inBed>0))return null;
  const endDay=localDateKey(new Date(main.end).getTime()),startDay=localDateKey(new Date(main.start).getTime()),loadRow=(D.hr_strain||[]).find(r=>String(r[0])===startDay),need=clamp(goal+.05*(Number(loadRow?.[1])||0),Math.max(6,goal-1),12),ratio=asleepMin/(60*need);
  const duration=ratio<1?100*Math.exp(-4.5*(1-ratio)**2):100*Math.exp(-1.2*(ratio-1)**2),eff=asleepMin/inBed*100,efficiency=eff<50?0:eff>=85?100:(eff-50)/(35)*100;
  let awakeAfter=0,awakeningCount=0,stageAvailable=false;
  const stages=(D.sleep_stages_by_id?.[main.id]||[]).map(q=>({a:+q.start,b:+q.end,type:String(q.type||'').toUpperCase()})).filter(q=>q.b>q.a).sort((a,b)=>a.a-b.a);
  if(stages.length){
    stageAvailable=true;const firstSleep=stages.find(q=>q.type!=='AWAKE')?.a;
    if(firstSleep!=null)for(const q of stages){if(q.type!=='AWAKE'||q.b<=firstSleep)continue;const mins=(q.b-Math.max(q.a,firstSleep))/60000;if(mins>0){awakeAfter+=mins;if(mins>5)awakeningCount++;}}
  }else if(Number.isFinite(Number(main.restless_min)))awakeAfter=Number(main.restless_min);
  const waso=awakeAfter<=20?100:awakeAfter>=90?0:(90-awakeAfter)/(70)*100,awakening=stageAvailable?(awakeningCount<=1?100:awakeningCount===2?70:awakeningCount===3?40:0):null;
  const continuity=stageAvailable ? .5*efficiency+.3*waso+.2*awakening : efficiency;
  const deepPct=asleepMin>0?Number(main.deep||0)/asleepMin*100:null,remPct=asleepMin>0?Number(main.rem||0)/asleepMin*100:null;
  const deepScore=main.has_stages?scoreBand(deepPct,13,23,8,35):null,remScore=main.has_stages?scoreBand(remPct,20,25,10,40):null,architecture=deepScore==null||remScore==null?null:(deepScore+remScore)/2;
  const latencyMin=Number(main.latency_min),latency=Number.isFinite(latencyMin)&&latencyMin>=0?(latencyMin<=20?100:latencyMin<=60?100-(latencyMin-20)*2.5:0):null;
  const nights=all.filter(n=>new Date(n.end)<=new Date(main.end)).sort((a,b)=>new Date(a.end)-new Date(b.end)).slice(-28);
  const circularSpread=vals=>{const ang=vals.map(v=>v/1440*2*Math.PI),c=mean(ang.map(Math.cos)),si=mean(ang.map(Math.sin)),R=Math.max(1e-6,Math.sqrt(c*c+si*si));return Math.sqrt(-2*Math.log(R))*1440/(2*Math.PI);};
  let regularity=null;if(nights.length>=4){const times=fn=>nights.map(n=>{const d=new Date(n[fn]);return d.getHours()*60+d.getMinutes();}),bed=times('start'),wake=times('end'),sb=circularSpread(bed),sw=circularSpread(wake);regularity=(100*Math.exp(-((sb/30)**1.5))+100*Math.exp(-((sw/30)**1.5)))/2;}
  const weights={duration:.40,continuity:.25,architecture:.15,regularity:.15,latency:.05},vals={duration,continuity,architecture,regularity,latency},coverage=Object.values(vals).filter(v=>v!=null).length;
  const raw=Object.entries(weights).reduce((sum,[k,w])=>sum+w*(vals[k]==null?50:vals[k]),0),score=Math.min(raw,40+.6*duration);
  return {score:Math.round(score*10)/10,subscores:{duration:Math.round(duration),efficiency:Math.round(efficiency),continuity:Math.round(continuity),awakeAfter:Math.round(awakeAfter),longAwakenings:awakeningCount,architecture:architecture==null?null:Math.round(architecture),deepPct,remPct,regularity:regularity==null?null:Math.round(regularity),latency:latency==null?null:Math.round(latency)},need,napHours:(D.sleep||[]).filter(s=>(!s.main||s.nap)&&localDateKey(new Date(s.end).getTime())===endDay).reduce((n,s)=>n+(Number(s.asleep)||0),0)/60,coverage,components:5,partial:coverage<5,netDebt:computeNetSleepDebt(endDay).total,reason:'Duration and efficiency are required; missing other components use a neutral 50-point placeholder.'};
}
let sleepSnapshotPending=new Set(),sleepSnapshotQueue=new Map(),sleepSnapshotTimer=null;
function flushSleepSnapshots(){
  sleepSnapshotTimer=null;const batch=[...sleepSnapshotQueue.values()].slice(0,40);if(!batch.length)return;
  for(const item of batch)sleepSnapshotQueue.delete(item.id);
  fetch('/api/sleep-score-snapshots',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'HealthDashboard'},body:JSON.stringify({snapshots:batch})})
    .then(r=>r.ok?r.json():null).then(x=>{if(x?.saved){D.sleep_score_snapshots=D.sleep_score_snapshots||{};for(const id of x.ids||[]){const item=batch.find(q=>q.id===id);if(item)D.sleep_score_snapshots[id]=item.snapshot;}}})
    .catch(()=>{}).finally(()=>{for(const item of batch)sleepSnapshotPending.delete(item.id);if(sleepSnapshotQueue.size&&!sleepSnapshotTimer)sleepSnapshotTimer=setTimeout(flushSleepSnapshots,0);});
}
function requestSleepSnapshot(main,result){
  const id=String(main?.id||''),end=Date.parse(main?.end||'');
  if(!id||!result||!Number.isFinite(end)||Date.now()-end<6*3600000||D.sleep_score_snapshots?.[id]||sleepSnapshotPending.has(id))return;
  sleepSnapshotPending.add(id);sleepSnapshotQueue.set(id,{id,snapshot:result});
  if(!sleepSnapshotTimer)sleepSnapshotTimer=setTimeout(flushSleepSnapshots,60);
}
function sleepScoreFor(main){
  if(!main)return {score:null,subscores:{},need:null,coverage:0,components:5,reason:'No main sleep recorded'};
  const saved=D.sleep_score_snapshots?.[String(main.id)];if(saved&&Number.isFinite(Number(saved.score)))return {...saved,frozen:true};
  const result=sleepScoreComponents(main);requestSleepSnapshot(main,result);return result||{score:null,subscores:{},need:null,coverage:0,components:5,reason:'Duration and time in bed are required'};
}
function normalCdf(z){
  const x=Math.abs(z)/Math.sqrt(2),t=1/(1+.3275911*x),erf=1-(((((1.061405429*t-1.453152027)*t+1.421413741)*t-.284496736)*t+.254829592)*t)*Math.exp(-x*x);return .5*(1+Math.sign(z)*erf);
}
function inverseNormalCdf(p){
 p=clamp(p,1e-8,1-1e-8);const a=[-39.6968302866538,220.946098424521,-275.928510446969,138.357751867269,-30.6647980661472,2.50662827745924],b=[-54.4760987982241,161.585836858041,-155.698979859887,66.8013118877197,-13.2806815528857],c=[-.00778489400243029,-.322396458041136,-2.40075827716184,-2.54973253934373,4.37466414146497,2.93816398269878],d=[.00778469570904146,.32246712907004,2.445134137143,3.75440866190742],lo=.02425,hi=1-lo;let q,r;if(p<lo){q=Math.sqrt(-2*Math.log(p));return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}if(p>hi){q=Math.sqrt(-2*Math.log(1-p));return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5])/((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);}q=p-.5;r=q*q;return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q/(((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
}
function robustZ(value,base){
  if(!Number.isFinite(value)||base.length<14)return null;const m=median(base),mad=median(base.map(x=>Math.abs(x-m)));return (value-m)/Math.max(1.4826*mad,0.05);
}
function restingHrRecoveryScore(value, baseline){
  // Compare with the recent personal baseline. Positive deviations begin to
  // reduce the score at +3 bpm; modest negative variation remains tolerated.
  if(!Number.isFinite(value)||value<=0||!Array.isArray(baseline)||baseline.length<14)return null;
  const base=baseline.filter(v=>Number.isFinite(v)&&v>0), center=median(base);
  if(!Number.isFinite(center))return null;
  const mad=median(base.map(v=>Math.abs(v-center))), robustSigma=mad>0?1.4826*mad:0;
  const delta=value-center;
  if(delta>=3)return clamp(100-(delta-2)*5,0,100);
  const lowSafe=Math.max(6,1.5*robustSigma), lowSevere=Math.max(18,4*robustSigma), below=Math.max(0,-delta-lowSafe);
  return below===0?100:clamp(100*(1-below/(lowSevere-lowSafe)),0,100);
}
function computeRecovery(forDay=null){
  const today=forDay||D.today||localDateKey(Date.now()),cache=D?._idx?.recoveryCache;
  if(cache?.has(today))return cache.get(today);
  const sleepBalance=computeNetSleepDebt(today);
  const recoveryDaily=D.recovery_daily||D.daily||{},hrvs=(D.daily?.hrv||[]).filter(r=>Number.isFinite(+r[1])&&+r[1]>0),rhrs=(recoveryDaily.resting_hr||[]).filter(r=>Number.isFinite(+r[1])&&+r[1]>0),hrvRow=hrvs.find(r=>String(r[0])===today),rhrRow=rhrs.find(r=>String(r[0])===today);
  const hrvBase=hrvs.filter(r=>String(r[0])<today).slice(-60).map(r=>Math.log(+r[1])).filter(Number.isFinite),rhrBase=rhrs.filter(r=>String(r[0])<today).slice(-30).map(r=>+r[1]).filter(Number.isFinite);
  const todayHrv=hrvRow?+hrvRow[1]:null,todayRhr=rhrRow?+rhrRow[1]:null,zHrv=todayHrv==null?null:robustZ(Math.log(todayHrv),hrvBase),zRhr=todayRhr==null?null:robustZ(todayRhr,rhrBase);
   const hrvComp=zHrv==null?null:100*normalCdf(clamp(zHrv,-3,3)),rhrComp=restingHrRecoveryScore(todayRhr,rhrBase),autonomic=mean([hrvComp==null?50:hrvComp,rhrComp==null?50:rhrComp]);
  const mains=(D.sleep_score_history||D.sleep||[]).filter(s=>s.main&&!s.nap&&Number(s.asleep)>0&&new Date(s.end)<=new Date(today+'T23:59:59')).sort((a,b)=>new Date(a.end)-new Date(b.end)),lastSleep=mains[mains.length-1]||null,sleepDetail=sleepScoreFor(lastSleep),sleepScore=sleepDetail.score;
  const debtComp=Math.max(15,100*Math.exp(-sleepBalance.total/10)),sleepRestComp=sleepScore==null?null:100*Math.pow(sleepScore/100,.8)*Math.pow(debtComp/100,.2);
  const resp=(recoveryDaily.resp_rate||[]).filter(r=>Number.isFinite(+r[1])&&+r[1]>0),respToday=resp.find(r=>String(r[0])===today),respBase=resp.filter(r=>String(r[0])<today).slice(-60).map(r=>+r[1]),respDelta=respToday&&respBase.length>=14?+respToday[1]-median(respBase):null,respMad=respBase.length>=14?median(respBase.map(v=>Math.abs(v-median(respBase)))):null,respScale=respMad==null?null:Math.max(1,1.4826*respMad);
  const temp=(recoveryDaily.body_temp||[]).find(r=>String(r[0])===today),healthFlags=[];if(respToday&&+respToday[1]<12)healthFlags.push('Respiratory rate is below 12 breaths/min');else if(respDelta!=null&&respScale!=null&&respDelta>2*respScale)healthFlags.push('Respiratory rate is >2 robust SD above baseline');if(temp&&+temp[1]>.5)healthFlags.push('Skin temperature is >0.5 °C above baseline');
  const hasAny=hrvComp!=null||rhrComp!=null||sleepRestComp!=null,partial=hrvComp==null||rhrComp==null||sleepRestComp==null;
  let score=hasAny?Math.round(autonomic*.60+(sleepRestComp==null?50:sleepRestComp)*.40):null;if(score!=null&&healthFlags.length)score=Math.min(score,66);
  const todaySleep=(D.sleep||[]).filter(s=>Number(s.asleep)>0),todayMains=todaySleep.filter(s=>s.main&&!s.nap).sort((a,b)=>new Date(a.end)-new Date(b.end)),last= todayMains[todayMains.length-1]||null;
  const napMinutes=todaySleep.filter(s=>(!s.main||s.nap)&&localDateKey(new Date(s.end).getTime())===today).reduce((a,s)=>a+(Number(s.asleep)||0),0),sleepTodayMinutes=(last?Number(last.asleep)||0:0)+napMinutes;
  const load=dailyStrainScore(today),strainScore=load.score;
  const result={score,hrvComp,rhrComp,autonomic,sleepScore,sleepScoreDetail:sleepDetail,sleepRestComp,debtComp,strainScore,strainCount:load.count,zHrv,zRhr,todayHrv,hrvEstimated:false,baseHrv:hrvBase.length?Math.exp(median(hrvBase)):null,todayRhr,baseRhr:rhrBase.length?median(rhrBase):null,sleepEff:last&&Number(last.in_bed)>0?Number(last.asleep)/Number(last.in_bed):null,lastSleep,sleepDebt:sleepBalance.total,sleepTodayMinutes,napMinutes,healthFlags,partial,coverage:{hrv:hrvComp!=null,rhr:rhrComp!=null,sleep:sleepRestComp!=null},band:score==null?'neutral':score>=67?'good':score>=34?'warn':'bad',label:score==null?'More data needed':score>=85?'Peak recovery':score>=70?'Primed to perform':score>=55?'Moderate recovery':score>=40?'Take it easy':'Prioritise rest',hasData:score!=null};
  cache?.set(today,result);return result;
}function recoveryComponent(label, comp, sub, detail, spark, color){
  const c = comp==null ? 'var(--muted)' : comp>=67?'var(--good)':comp>=34?'var(--warn)':'var(--bad)';
  return `<div class="rec-comp" onclick="this.classList.toggle('open')" role="button" tabindex="0">
    <div>
      <div class="rc-label">${label}</div>
      <div class="rc-sub">${sub}</div>
    </div>
    <div class="rc-val" style="color:${c}">${comp==null?'–':Math.round(comp)}</div>
    <div class="rc-bar"><div class="rc-fill" style="width:${comp==null?0:comp}%;background:${comp==null?'transparent':c}"></div></div>
    <div class="rec-detail">${detail}</div>
  </div>`;
}

function recoveryTrendChart(today){
  const daily=D.recovery_daily||D.daily||{},hrvRows=D.daily?.hrv||daily.hrv_deep||[],rows=[...hrvRows,...(daily.resting_hr||[])],available=[...new Set(rows.map(r=>String(r?.[0]||'')).filter(d=>d&&d<=today))].sort(),first=available[0],startDay=period==='all'?(first||today):localDateKey(periodStart(period)),days=available.filter(d=>d>=startDay),rangeName=({1:'1 day',7:'1 week',30:'30 days',ytd:'year to date',all:'all time'})[period]||'selected range';
  const points=days.map(day=>({day,result:computeRecovery(day)})),valid=points.filter(p=>Number.isFinite(p.result?.score));
  if(!valid.length)return `<div class="recovery-trend"><div class="recovery-trend-head"><span class="recovery-trend-title">Recovery trend · ${rangeName}</span></div><div class="recovery-trend-empty">No recovery scores are available in this date range.</div></div>`;
  const W=440,H=158,L=28,R=25,T=9,B=24,pw=W-L-R,ph=H-T-B,startMs=dayMs(startDay),endMs=Math.max(startMs,dayMs(today)),span=Math.max(DAY,endMs-startMs),X=p=>L+((dayMs(p.day)-startMs)/span)*pw,Y=v=>T+ph-(Math.max(0,Math.min(100,v))/100)*ph,bandColor=v=>v>=65?'#22C55E':v>=30?'#8AB4F8':'#FB8C5A',avg=mean(valid.map(p=>p.result.score)),label=avg>=65?'Mostly high':avg>=30?'Mostly moderate':'Mostly low';
  const y100=Y(100),y65=Y(65),y30=Y(30),y1=Y(1);let svg=`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Recovery score trend for ${rangeName}, with low, moderate, and high score bands"><rect x="${L}" y="${y100}" width="${pw}" height="${y65-y100}" rx="4" fill="#22C55E" fill-opacity=".13"/><rect x="${L}" y="${y65}" width="${pw}" height="${y30-y65}" fill="#8AB4F8" fill-opacity=".13"/><rect x="${L}" y="${y30}" width="${pw}" height="${y1-y30}" rx="4" fill="#FB8C5A" fill-opacity=".14"/>`;
  for(const [v,c] of [[65,'#22C55E'],[30,'#8AB4F8']])svg+=`<line x1="${L}" y1="${Y(v)}" x2="${W-R}" y2="${Y(v)}" stroke="${c}" stroke-opacity=".6" stroke-dasharray="1 6" stroke-linecap="round"/><text x="${W-R+3}" y="${Y(v)+3}" class="trend-band-label">${v}</text>`;
  svg+=`<text x="${W-R+3}" y="${Y(100)+4}" class="trend-band-label">100</text><text x="${W-R+3}" y="${Y(1)+3}" class="trend-band-label">1</text>`;
  let segment=[];const flush=()=>{if(segment.length>1)svg+=`<path d="${segment.map((p,i)=>`${i?'L':'M'} ${X(p)} ${Y(p.result.score)}`).join(' ')}" fill="none" stroke="#8AB4F8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;segment=[];};let prev=null;
  for(const p of points){if(!Number.isFinite(p.result?.score)){flush();prev=null;continue;}if(prev&&(dayMs(p.day)-dayMs(prev.day)>DAY*1.5))flush();segment.push(p);prev=p;}flush();
  valid.forEach(p=>{const x=X(p),y=Y(p.result.score),c=bandColor(p.result.score);svg+=`<circle class="trend-point" cx="${x}" cy="${y}" r="4.5" fill="${c}"><title>${p.day} · Recovery ${p.result.score}/100${p.result.partial?' · partial data':''}</title></circle>`;});
  const ticks=valid.length<=5?valid:[valid[0],valid[Math.round((valid.length-1)/3)],valid[Math.round(2*(valid.length-1)/3)],valid[valid.length-1]];for(const p of [...new Map(ticks.map(q=>[q.day,q])).values()])svg+=`<text x="${X(p)}" y="${H-6}" text-anchor="middle" class="trend-date">${p.day.slice(5)}</text>`;svg+='</svg>';
  return `<div class="recovery-trend"><div class="recovery-trend-head"><span class="recovery-trend-title">Recovery trend · ${rangeName}</span><span class="recovery-trend-average" style="color:${bandColor(avg)}">${label} · ${avg.toFixed(0)}</span></div>${svg}<div class="legend" style="font-size:9px;margin-top:2px"><span><i style="background:#FB8C5A"></i>1–29 low</span><span><i style="background:#8AB4F8"></i>30–64 moderate</span><span><i style="background:#22C55E"></i>65–100 high</span></div></div>`;
}
function renderHero(){
  const r = computeRecovery();
  const host = $('#heroCard');
  if(!r || !r.hasData){
    host.innerHTML = `<div style="grid-column:1/-1"><div class="eyebrow" style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted)">Today · recovery</div>
      <div class="hero-label" style="font-size:26px;font-weight:650;margin:6px 0 8px">${r?.reason || 'Not enough data yet'}</div>
      <div class="hero-sub" style="color:var(--ink2)">Set your age and sex in Settings and sync your Google Health data to unlock recovery, VO₂ max and sleep debt.</div></div>`;
    return;
  }
  const circ = 2*Math.PI*70;
  const dash = circ * (1 - r.score/100);
  const color = r.band==='good' ? 'var(--good)' : r.band==='warn' ? 'var(--warn)' : 'var(--bad)';
  const zText = z => z==null ? '' : `${z>=0?'+':''}${z.toFixed(2)}σ vs your 30-day baseline`;
  const sparkHrv = sparkline((D.daily.hrv||[]).slice(-14).map(r=>r[1]), 'var(--hrv)');
  const sparkRhr = sparkline((D.daily.resting_hr||[]).slice(-14).map(r=>r[1]), 'var(--rhr)');
  const sparkSleep = sparkline((D.sleep||[]).filter(s=>s.main).slice(-14).map(s=>s.asleep/60), 'var(--deep)');
  host.innerHTML = `
    <div class="hero-ring">
      <svg viewBox="0 0 160 160" aria-hidden="true">
        <circle class="bg" cx="80" cy="80" r="70"/>
        <circle class="fg" cx="80" cy="80" r="70" stroke="${color}"
          stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${dash.toFixed(1)}"/>
      </svg>
      <div class="center">
        <div class="score" style="color:${color}">${r.score}</div>
        <div class="of">/ 100</div>
      </div>
    </div>
    <div class="hero-info">
      <div class="hero-summary"><div class="eyebrow">Today · recovery</div>
      <div class="hero-label">${r.label}</div>
      <div class="hero-sub">Uses current-day HRV and resting HR, plus sleep/rest. Missing components are shown as a partial score. Workout load is tracked separately.</div></div>
      ${recoveryTrendChart(D.today)}
      <div class="hero-components">
        ${recoveryComponent('HRV', r.hrvComp,
          `${r.todayHrv==null?'–':r.todayHrv.toFixed(1)+' ms'} ${r.hrvEstimated?'unavailable':'today'} · baseline ${r.baseHrv==null?'–':r.baseHrv.toFixed(1)+' ms'}`,
          `This score uses the same daily HRV series shown in the HRV card. Heart-rate variability measures how much the gap between heartbeats varies. Higher generally means your nervous system is recovered. ${r.hrvEstimated?'Today’s HRV is unavailable; no stale reading is substituted.':''} Score: <b>${r.hrvComp==null?'–':Math.round(r.hrvComp)}/100</b>, ${zText(r.zHrv)}.`,
          sparkHrv, 'var(--hrv)')}
        ${recoveryComponent('Resting HR', r.rhrComp,
          `${r.todayRhr==null?'–':r.todayRhr.toFixed(0)+' bpm'} today · baseline ${r.baseRhr==null?'–':r.baseRhr.toFixed(0)+' bpm'}`,
          `Resting HR is compared with the recent personal baseline. Positive deviations begin to reduce the score at +3 bpm (5 points per additional bpm); modest lower readings are tolerated. RHR alone is not a diagnosis. Score: <b>${r.rhrComp==null?'–':Math.round(r.rhrComp)+'/100'}</b>${r.zRhr==null?'':`, ${r.zRhr>=0?'+':''}${r.zRhr.toFixed(2)}σ vs personal baseline`}.`,
          sparkRhr, 'var(--rhr)')}
        ${recoveryComponent('Sleep / rest', r.sleepRestComp,
          `Sleep/rest combines the ${r.sleepScore==null?'unavailable':r.sleepScore.toFixed(1)} sleep score and ${r.debtComp.toFixed(0)} debt score with a weighted geometric mean (80% sleep score, 20% net-debt score). Net debt carries forward and is reduced by all recorded naps. Sleep score uses duration, architecture, continuity, latency, and bedtime regularity; physiology is reserved for recovery. Combined score: <b>${r.sleepRestComp==null?'—':Math.round(r.sleepRestComp)+'/100'}</b>.`,
          `Sleep/rest combines the nightly sleep score with a nap-adjusted debt score using an 80/20 weighted geometric mean. Open this row for the component details and current combined score.`,
          sparkSleep, 'var(--deep)')}
        ${recoveryComponent('Workout strain · separate load',
          r.strainScore,
          r.strainScore==null?'No raw-HR strain data':'Daily raw-HR strain '+r.strainScore.toFixed(1)+' / 21 · 7d '+(dailyStrainScore(D.today).acute==null?'–':dailyStrainScore(D.today).acute.toFixed(1))+' · 28d '+(dailyStrainScore(D.today).chronic==null?'–':dailyStrainScore(D.today).chronic.toFixed(1)),
          `Daily strain counts only raw-HR intervals at or above 30% heart-rate reserve, weights higher intensities exponentially, and resets daily. Each sample contributes no more than five minutes; 7- and 28-day summaries include zero-load rest days. This is a load estimate, not MET-calibrated energy.`,
          '', 'var(--good)')}
      </div>
    </div>`;
}

function estimateVO2(){
  const age = Number(D.settings?.age);
  const rhr = lastVal('resting_hr');
  if(!age || !rhr || rhr<=0) return null;
  const maxHR = 208 - 0.7*age;
  const vo2 = 15.3 * (maxHR / rhr);
  return { vo2, maxHR, rhr, age, sex: D.settings?.sex || 'm' };
}
function computeFitnessAge(vo2, sex, chronologicalAge){
  if(vo2==null) return null;
  const intercept = sex==='f' ? 44.6 : 49.6;
  const slope = 0.28;
  let fa = (intercept - vo2) / slope;
  fa = clamp(fa, 18, 90);
  if(chronologicalAge) fa = clamp(fa, chronologicalAge-20, chronologicalAge+20);
  return Math.round(fa);
}
function computeSleepDebt(){
  const balance=computeNetSleepDebt(),total=balance.total,band=total<1?'good':total<3?'warn':'bad',label=total<1?'No debt':total<3?'Low debt':total<5?'Moderate debt':'High debt';
  return {days:balance.days,total,goalH:balance.goalH,band,label,n:balance.n};
}/* ============================================================
   OVERVIEW BOXES
   ============================================================ */
