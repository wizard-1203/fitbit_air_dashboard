const CARDS = [
  {id:'hr', section:'heart', wide:true, title:'Heart rate today · 12 AM–12 AM', sub:'Calendar day · <span class="hr24-inline-legend"><i class="actual"></i> Actual HR <i class="range"></i> Historical range</span> · future hours remain blank', ctl:'<label>Date <input class="act" id="heartDayDate" type="date"></label>', build:()=>{
    const hr=((window._heartDaySamples?.length?window._heartDaySamples:D.hr)||[]).filter(([t])=>{const day=window._heartDayDate||D.today;const a=new Date(day+'T00:00:00').getTime();return t>=a&&t<a+DAY;});
    const selectedDay=window._heartDayDate||D.today, dayStart=new Date(selectedDay+'T00:00:00').getTime(),dayEnd=dayStart+DAY;
    const zoneOf=makeZoneOf();
    const pts=hr.map(([t,a,lo,hi])=>({x:t,y:a,band:Number.isFinite(Number(lo))&&Number.isFinite(Number(hi))?[Number(lo),Number(hi)]:null,zone:zoneOf(a)})).sort((a,b)=>a.x-b.x),chartPts=[];
    for(let i=0;i<pts.length;i++){if(i&&pts[i].x-pts[i-1].x>7.5*60000)chartPts.push({x:pts[i-1].x+5*60000,y:null,band:null,zone:null});chartPts.push(pts[i]);}
    const avg=mean(pts.map(p=>p.y));
    const rhrRows=(D.daily?.resting_hr||[]).filter(r=>String(r[0])<=selectedDay&&Number.isFinite(Number(r[1]))).sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    const rhrValue=rhrRows.length?Number(rhrRows[rhrRows.length-1][1]):null,rhrDate=rhrRows.length?String(rhrRows[rhrRows.length-1][0]):null;
    const zoneCfg=D.zone_limits||{},zoneAge=Number(D.settings?.age)||null,zoneMax=Number(zoneCfg.max_hr)||(zoneAge?208-.7*zoneAge:190),zoneReserve=Math.max(1,zoneMax-(Number(zoneCfg.rhr)||rhrValue||60)),zoneEdges=Array.isArray(zoneCfg.edges)&&zoneCfg.edges.length===6?zoneCfg.edges:[.5,.6,.7,.8,.9,1].map(p=>(Number(zoneCfg.rhr)||rhrValue||60)+zoneReserve*p);
    const zoneBands=[{y1:40,y2:zoneEdges[1],color:'#3B82F6',opacity:.09,dash:'4 4',label:'ZONE 1 · LIGHT',labelRight:true,labelSize:10,labelColor:'rgba(255,255,255,.35)'},{y1:zoneEdges[1],y2:zoneEdges[2],color:'#10B981',opacity:.12,dash:'4 4',label:'ZONE 2 · AEROBIC',labelRight:true,labelSize:10,labelColor:'rgba(255,255,255,.35)'},{y1:zoneEdges[2],y2:zoneEdges[3],color:'#F59E0B',opacity:.12,dash:'4 4',label:'ZONE 3 · TEMPO',labelRight:true,labelSize:10,labelColor:'rgba(255,255,255,.35)'},{y1:zoneEdges[3],y2:zoneEdges[4],color:'#FB7185',opacity:.08,dash:'4 4'},{y1:zoneEdges[4],y2:155,color:'#F43F5E',opacity:.06,dash:'4 4'}];
    const vals=pts.filter(p=>Number.isFinite(p.y)),minPt=vals.length?vals.reduce((a,b)=>a.y<b.y?a:b):null,maxPt=vals.length?vals.reduce((a,b)=>a.y>b.y?a:b):null;
    const xTicks=[];for(let t=dayStart;t<=dayEnd;t+=3*HOUR)xTicks.push(t);
    const gapBridges=[];for(let i=1;i<pts.length;i++)if(pts[i].x-pts[i-1].x>7.5*60000)gapBridges.push({a:pts[i-1].x,b:pts[i].x,ya:pts[i-1].y,yb:pts[i].y});
    const dayIsToday=selectedDay===D.today;
    return {kind:'line',pts:chartPts,color:'#E2E8F0',lineWidth:2.2,zoneColored:false,zoneGradientStops:karvonenStops(zoneEdges),bands:zoneBands,bandColor:'#94A3B8',bandOpacity:.18,avg,trendBand:false,trendLine:false,gapBridges,avgPill:true,avgPillGlass:true,avgPillInside:true,avgPillSide:'right',avgPillText:`avg ${avg==null?'':avg.toFixed(1)} bpm`,avgColor:'#2DD4BF',avgLineOpacity:1,avgWidth:2.2,avgDash:'5 4',avgLineFilter:'drop-shadow(0 0 4px rgba(45,212,191,.72))',lineGlowFilter:'drop-shadow(0 0 4px rgba(103,232,249,.42))',
      extrema:[...(minPt?[{...minPt,type:'min',label:`MIN ${minPt.y.toFixed(0)}`,glassBadge:true,color:'#2DD4BF'}]:[]),...(maxPt?[{...maxPt,type:'max',label:`MAX ${maxPt.y.toFixed(0)}`,glassBadge:true,color:'#F59E0B',above:true}]:[])],
      thresholds:rhrValue==null?[]:[{y:rhrValue,color:'#2DD4BF',dash:'5 4',label:`Resting HR ${rhrValue.toFixed(0)} bpm${rhrDate!==selectedDay?' · latest '+rhrDate:''}`,labelSide:'left'}],xMin:dayStart,xMax:dayEnd,xTicks,fmtAvg:avg==null?'':avg.toFixed(1)+' bpm',fmtX:fmtTime,fmtY:v=>Math.round(v),label:'Heart rate from midnight to midnight; future hours remain blank',yMin:40,yMax:155,yTickValues:[40,60,80,100,120,140,155],
      tip:q=>{const z=ZONE_DEFS[q.zone-1];return `<b>${fmtDayLong(q.x)}, ${fmtTime(q.x)}</b>${tipRow('HR',q.y.toFixed(1)+' bpm',z?z.color:'var(--hr)')}${q.band?tipRow('Captured range',q.band[0].toFixed(0)+'–'+q.band[1].toFixed(0)+' bpm','#94A3B8'):''}${tipRow('Zone',z?z.label+' · '+z.name:'—')}`;},cols:['Time','Mean bpm','Min','Max','Zone'],rows:hr.slice().reverse().map(r=>{const z=ZONE_DEFS[zoneOf(r[1])-1];return [fmtDay(r[0])+' '+fmtTime(r[0]),r[1],r[2],r[3],z?z.label:'–'];}),foot:avg==null?'':splitHtml(stats(pts.map(p=>p.y),avg,'hr24'),'var(--active)',`of ${pts.length} readings · average ${avg.toFixed(1)} bpm`,'hr24')};
  }},  {id:'hrdaily', section:'heart', title:'Daily heart-rate spread', sub:'Daily mean, high & low', ctl:`<div class="hrbox-controls" aria-label="Heart-rate distribution date range"><button class="act" data-hrbox-days="7">7D</button><button class="act" data-hrbox-days="14">14D</button><button class="act" data-hrbox-days="30">1M</button><button class="act" data-hrbox-days="90">3M</button><button class="act" data-hrbox-days="custom">Custom</button><span data-hrbox-custom hidden><input type="date" data-hrbox-from aria-label="Start date"><input type="date" data-hrbox-to aria-label="End date"><button class="act" data-hrbox-apply>Apply</button></span></div>`, build:()=>{
    let p=(D.hr_daily||[]).filter(r=>r&&r.length>=8&&[r[1],r[2],r[3],r[4],r[5],r[6]].every(v=>Number.isFinite(Number(v)))).map(r=>({day:String(r[0]),x:dayMs(r[0]),low:Number(r[1]),q1:Number(r[2]),median:Number(r[3]),mean:Number(r[4]),q3:Number(r[5]),high:Number(r[6]),n:Number(r[7])||0}));
    const today=String(D.today||localDateKey(Date.now())); const days=Number(window._hrBoxDays||30);
    if(window._hrBoxFrom&&window._hrBoxTo&&window._hrBoxDays==='custom')p=p.filter(q=>q.day>=window._hrBoxFrom&&q.day<=window._hrBoxTo);
    else {const cutoff=dayMs(today)-(days-1)*DAY;p=p.filter(q=>q.x>=cutoff&&q.x<=dayMs(today));}
    const maxSpreadRow=p.reduce((best,q)=>!best||q.high-q.low>best.high-best.low?q:best,null),avgDailyRange=mean(p.map(q=>q.high-q.low));
    return {html:p.length?`<div class="hrbox-summary"><div class="hrbox-kpi" style="--kpi-color:#2DD4BF"><small>Daily Mean</small><b>${mean(p.map(q=>q.mean)).toFixed(1)} bpm</b><span>Period average</span></div><div class="hrbox-kpi" style="--kpi-color:#FB7185"><small>Daily High</small><b>${mean(p.map(q=>q.high)).toFixed(1)} bpm</b><span>Peak elevation</span></div><div class="hrbox-kpi" style="--kpi-color:#38BDF8"><small>Daily Low</small><b>${mean(p.map(q=>q.low)).toFixed(1)} bpm</b><span>Resting range</span></div></div>${dailyHrSvg(p)}<div class="hrbox-footer"><div class="hrbox-legend" aria-label="Toggle chart layers"><button data-hrbox-toggle="dailyMean" aria-pressed="true"><i class="hrbox-toggle-dot mean"></i>Daily mean</button><button data-hrbox-toggle="dailyHigh" aria-pressed="true"><i class="hrbox-toggle-dot high"></i>Daily high</button><button data-hrbox-toggle="dailyLow" aria-pressed="true"><i class="hrbox-toggle-dot low"></i>Daily low</button></div><div class="hrbox-period-stats"><span><b>Max Spread:</b> ${maxSpreadRow?(maxSpreadRow.high-maxSpreadRow.low).toFixed(1):'—'} bpm${maxSpreadRow?` <em>(${fmtDay(dayMs(maxSpreadRow.day))})</em>`:''}</span><span><b>Avg Range:</b> ${avgDailyRange==null?'—':avgDailyRange.toFixed(1)} bpm</span><span class="peak-note"><i class="hrbox-peak-dot"></i>Peak &gt; 170 bpm</span></div></div>`:'<div class="empty">Historical HR samples will appear after a sync.</div>',cols:['Day','Samples','Min','Q1','Median','Mean','Q3','Max'],rows:p.slice().reverse().map(q=>[q.day,q.n,q.low,q.q1,q.median,q.mean.toFixed(1),q.q3,q.high])};
  }},
  {id:'rhr', section:'heart', title:'Resting heart rate (bpm)', build:()=>lineCard('resting_hr','Resting heart rate','var(--rhr)','bpm',0)},
  {id:'hrv', section:'heart', title:'Overnight HRV Range', sub:'Nightly values and observed overnight range', build:()=>({html:buildHrvEnvelopeLegacy()})},
  {id:'hrvscatter', section:'heart', wide:true, title:'HRV vs. Resting HR', sub:'<span class="chart-info" tabindex="0" title="Dots show daily HRV and resting heart rate. SpO₂ color indicates oxygen status; the dashed envelope shows median ±1 standard deviation.">ⓘ</span>', build:()=>hrvRhrScatterCard()},
  {id:'spo2', section:'heart', title:'Blood oxygen (SpO₂ %)', sub:'Clinical 95% reference line', build:()=>lineCard('spo2','Blood oxygen','var(--spo2)','%',1,100)},
  {id:'bodytemp', section:'heart', title:'Nightly body-temperature deviation', sub:'Diverging bars · ±0.50 °C strain thresholds', build:()=>temperatureCard()},
  {id:'trainingPlan', section:'heart', wide:true, title:'Today’s training plan', sub:'A practical prescription based on today’s recovery score', build:()=>({html:trainingPrescriptionHtml()})},

  {id:'sleep', section:'sleep', title:'Sleep stages (hours, incl. naps)', wide:true, ctl:'<div class="sleep-stage-controls"><label><input type="radio" name="sleep-awake-mode" value="include" data-sleep-awake-toggle> Show awake</label><label><input type="radio" name="sleep-awake-mode" value="exclude" data-sleep-awake-toggle> Hide awake</label><button class="act toggle-btn" type="button" data-sleep-percent-toggle>Switch to 100% split</button></div>',
    legend:[['Deep','var(--deep)'],['REM','var(--rem)'],['Light','var(--light)'],['Awake','var(--awake)']],
    build:()=>{
    const since=dayMs(D.today)-(days-1)*DAY, byDay={};
    for(const x of D.sleep){
      const g=byDay[x.day] ??= {day:x.day,deep:0,rem:0,light:0,awake:0,asleep:0,nap:0};
      g.deep+=x.deep; g.rem+=x.rem; g.light+=x.light; g.awake+=x.awake; g.asleep+=x.asleep;
      if(!x.main) g.nap+=x.asleep;
    }
    let p=Object.values(byDay).map(g=>({x:dayMs(g.day),s:g,y:(g.deep+g.rem+g.light+(window.sleepStageAwake?g.awake:0))/60,
      parts:[g.deep/60,g.rem/60,g.light/60,...(window.sleepStageAwake?[g.awake/60]:[])],
      napPart: (g.nap||0)/60})).filter(q=>q.x>=since);
    if(window.sleepStagePercent) p=p.map(q=>({...q,parts:q.parts.map(v=>q.y>0?100*v/q.y:0),y:q.y>0?100:0,napPart:q.y>0?100*(q.napPart||0)/q.y:0}));
    const avgH = window.sleepStagePercent ? null : mean(p.map(q=>q.y));
    const goal=Number(D.settings?.sleep_goal)||8, goalDays=p.filter(q=>(q.s.deep+q.s.rem+q.s.light+q.s.nap)/60>=goal).length;
    return {kind:'stack',pts:p,step:DAY,colors:['var(--deep)','var(--rem)','var(--light)',...(window.sleepStageAwake?['var(--awake)']:[])],
      bands: window.sleepStagePercent ? null : [{y1:7, y2:9, color:'var(--good)', opacity:.06, dash:'4 3', label:'7–9 h target', dash:'4 3'}],
      avg: avgH, avgPill:avgH!=null,avgPillInside:true,avgPillSide:'left',avgPillText:`avg ${avgH==null?'':avgH.toFixed(1)}h`,fmtAvg: avgH==null?'':avgH.toFixed(1)+' h',
      topHtml:`<div class="sleep-kpi-row sleep-stage-kpi-row"><div><small>Goal Attainment</small><b>${goalDays} / ${p.length} Days</b><span>${p.length?Math.round(goalDays/p.length*100):0}% met ${goal}h target</span></div><div><small>Period Average</small><b>${mean(p.map(q=>(q.s.deep+q.s.rem+q.s.light+q.s.nap)/60)).toFixed(1)+' hrs'}</b><span>${(mean(p.map(q=>(q.s.deep+q.s.rem+q.s.light+q.s.nap)/60))-goal).toFixed(1)+'h vs target'}</span></div><div><small>Nap Frequency</small><b>${(D.sleep||[]).filter(q=>q.nap&&q.day&&dayMs(q.day)>=since).length} Sessions</b><span>Across ${p.length} recorded days</span></div></div>`,
      fmtX:fmtDay,fmtY:v=>window.sleepStagePercent?Math.round(v)+'%':v.toFixed(1)+'h',label:'Sleep stages',xTicks:p.filter((q,i)=>i%5===0||i===p.length-1).map(q=>q.x),minTickGap:28,
       h: 280,
      tip:q=>{const total=q.s.asleep||0,pct=v=>total?Math.round(100*v/total):0;return `<b>${fmtDayLong(q.x)}${total/60<6?' · ⚠ Low sleep':''}</b>${tipRow('Total sleep',hm(total))}${tipRow('Deep',hm(q.s.deep)+' ('+pct(q.s.deep)+'%)','var(--deep)')}${tipRow('REM',hm(q.s.rem)+' ('+pct(q.s.rem)+'%)','var(--rem)')}${tipRow('Light',hm(q.s.light)+' ('+pct(q.s.light)+'%)','var(--light)')}${tipRow('Awake',hm(q.s.awake)+' ('+pct(q.s.awake)+'%)','var(--awake)')}${q.s.nap?tipRow('Nap time',hm(q.s.nap)):''}`;},
      cols:['Night ending','Asleep','Naps','Deep','REM','Light',...(window.sleepStageAwake?['Awake']:[])],
      rows:p.slice().reverse().map(q=>[q.s.day,hm(q.s.asleep),q.s.nap?hm(q.s.nap):'–',hm(q.s.deep),hm(q.s.rem),hm(q.s.light),...(window.sleepStageAwake?[hm(q.s.awake)]:[])])};
  }},
  {id:'sleepDuration',section:'sleep',title:'Daily sleep + nap duration',sub:'Night sleep, naps and total duration · target range and average',ctl:'<div class="sleep-duration-controls"><span class="sub">Show</span><button class="act" type="button" data-sleep-duration-series="total" aria-pressed="true">Total sleep + nap</button><button class="act" type="button" data-sleep-duration-series="night" aria-pressed="false">Sleep</button><button class="act" type="button" data-sleep-duration-series="nap" aria-pressed="false">Nap</button><label>Personal range <select class="act" id="sleepDurationTarget"><option value="adult">Adult target 7–9 h</option><option value="custom">Use sleep goal ±30 min</option></select></label></div>',build:()=>sleepDurationCard()},
  {id:'sleepStageAverage',section:'sleep',title:'Sleep stages · average to date',sub:'Stage percentages across the selected dates',ctl:()=>sleepStageDateControls(),build:()=>({html:sleepStageAverageChart()})},
  {id:'sleepdebt', section:'sleep', title:'Sleep Debt Trends', sub:'Compare night-only debt with net debt after naps', build:()=>sleepDebtCard()},
  {id:'sleephr', section:'sleep', title:'Heart rate during sleep', sub:'Layered: 5-min mean curve · raw samples · sleep stages',
    ctl:'<label class="calendar-session-picker">Date <input class="act" id="sleepDateSel" type="date" aria-label="Date"></label><select class="act" id="sleepSel" aria-label="Sleep or nap on selected date" hidden></select><span id="sleepSessionMeta" class="selection-metadata" style="font-size:12px;color:var(--ink2)"></span>',
    build:()=>buildSleepingHrCard()},
  {id:'sleepStageTrend', section:'sleep', title:'Sleep-stage duration', sub:'Select a stage · absolute duration by night', ctl:'<label>Stage <select class="act" data-sleep-stage-select><option value="deep">Deep</option><option value="rem">REM</option><option value="light">Light</option><option value="awake">Awake</option></select></label><label>Show <select class="act" data-sleep-scope><option value="total">Total (night + naps)</option><option value="nights">Night sleep only</option><option value="naps">Naps only</option></select></label>', build:()=>{const k=window._sleepStageMetric||'deep',m={deep:['Deep sleep','var(--deep)'],rem:['REM sleep','var(--rem)'],light:['Light sleep','var(--light)'],awake:['Awake time','var(--awake)']}[k];return sleepStageLine(k,m[0],m[1]);}},

  {id:'vitals', section:'activity', subtab:'daily', title:'Vitals', sub:'Weight or blood pressure - recorded measurements only', ctl:()=>vitalsControls(), build:()=>buildVitalsChart()},
  {id:'calories', section:'activity', subtab:'daily', title:'Daily calories', sub:'Google Health daily total - kcal', ctl:metricRangeSelect('calories'), build:()=>{
    const start=metricRangeStart('calories'),rows=D.daily?.calories||[],p=rows.filter(r=>dayMs(String(r[0]))>=start&&Number.isFinite(Number(r[1]))).map(r=>({day:String(r[0]),x:dayMs(String(r[0])),y:Number(r[1])})),avg=mean(p.map(q=>q.y));
    if(!p.length)return {html:'<div class="empty">No daily calorie totals are available for this period.</div>'};
    const chartStart=Number.isFinite(start)?dayMs(localDateKey(start)):(p[0]?.x??periodStart(period)),chartEnd=dayMs(D.today)+DAY;return {kind:'bar',pts:p,step:DAY,xMin:chartStart,xMax:chartEnd,xTicks:activityFourDayTicks(chartStart,chartEnd-DAY),barHeadroom:false,yTickValues:[0,1000,2000,3000,4000,5000],yMax:5000,color:'var(--calories)',avg,avgPill:true,avgPillInside:true,avgPillText:`${fmtN(avg)} KCAL AVG`,avgColor:'#E8F0F6',fmtAvg:avg==null?'':fmtN(avg)+' kcal',fmtX:fmtDay,fmtY:v=>fmtN(v)+' kcal',label:'Daily calories',yMin:0,headerKpi:avg==null?'—':`${fmtN(avg)} kcal/day`,tip:q=>`<b>${fmtDayLong(q.x)}</b>${tipRow('Calories',fmtN(q.y)+' kcal','var(--calories)')}`,cols:['Date','Calories (kcal)'],rows:p.slice().reverse().map(q=>[q.day,Math.round(q.y)])};
  }},
  {id:'steps', section:'activity', subtab:'daily', title:'Steps per day', sub:'Daily totals · 10k target', build:()=>{
    const p=dailyPts('steps');
    const vals=p.filter(q=>q.y!=null).map(q=>q.y), avg=mean(vals);
    const rawStart=periodStart(period),chartStart=Number.isFinite(rawStart)?dayMs(localDateKey(rawStart)):(p.find(q=>q.y!=null)?.x??dayMs(D.today)-29*DAY),chartEnd=dayMs(D.today)+DAY;return {kind:'bar',pts:p,color:'var(--steps)',avg,avgPill:true,avgPillInside:true,avgPillText:`${avg==null?'':fmtN(avg)} STEPS AVG`,avgColor:'#E8F0F6',barHeadroom:false,yMin:0,yMax:12000,yTickValues:[0,3000,6000,9000,12000],xMin:chartStart,xMax:chartEnd,xTicks:activityFourDayTicks(chartStart,chartEnd-DAY),target:10000,targetLabel:'10,000 GOAL',targetPill:true,targetPillInside:true,targetColor:'#85D9A5',targetDash:'5 4',targetGlow:true,headerKpi:avg==null?'—':`${fmtN(avg)} avg`,fmtAvg:avg==null?'':fmtN(avg),yMin:0,
      fmtX:fmtDay,fmtY:v=>fmtN(v),label:'Steps per day',
      tip:q=>`<b>${fmtDayLong(q.x)}</b>${tipRow('Steps',fmtN(q.y),'var(--steps)')}${tipRow('vs average',(q.y>=avg?'▲ ':'▼ ')+fmtN(Math.abs(q.y-avg)))}`,
      cols:['Day','Steps'],rows:p.filter(q=>q.y!=null).reverse().map(q=>[q.day,fmtN(q.y)])};
  }},
  {id:'distance', section:'activity', subtab:'daily', title:'Distance per day', sub:'Kilometres walked / run', build:()=>{
    const p=dailyPts('distance_m');
    const vals=p.filter(q=>q.y!=null).map(q=>q.y), avg=mean(vals);
    const rawStart=periodStart(period),chartStart=Number.isFinite(rawStart)?dayMs(localDateKey(rawStart)):(p.find(q=>q.y!=null)?.x??dayMs(D.today)-29*DAY),chartEnd=dayMs(D.today)+DAY;return {kind:'bar',pts:p,color:'var(--distance)',avg,avgPill:true,avgPillInside:true,avgPillText:`${avg==null?'':avg.toFixed(2)} KM AVG`,avgColor:'#E8F0F6',barHeadroom:false,yMin:0,xMin:chartStart,xMax:chartEnd,xTicks:activityFourDayTicks(chartStart,chartEnd-DAY),headerKpi:avg==null?'—':`${avg.toFixed(2)} km avg`,fmtAvg:avg==null?'':avg.toFixed(2)+' km',
      fmtX:fmtDay,fmtY:v=>v.toFixed(1)+'km',label:'Distance per day',
      tip:q=>`<b>${fmtDayLong(q.x)}</b>${tipRow('Distance',q.y.toFixed(2)+' km','var(--distance)')}${tipRow('vs average',(q.y>=avg?'▲ ':'▼ ')+Math.abs(q.y-avg).toFixed(2)+' km')}`,
      cols:['Day','km'],rows:p.filter(q=>q.y!=null).reverse().map(q=>[q.day,q.y.toFixed(2)])};
  }},
  {id:'sedentary', section:'activity', subtab:'daily', title:'Sedentary time per day', sub:'Hours spent seated or inactive', build:()=>{
    const p=dailyPts('sedentary_seconds').map(q=>({...q, y: q.y==null?null:q.y/3600}));
    const vals=p.filter(q=>q.y!=null).map(q=>q.y), avg=mean(vals);
    return {kind:'bar',pts:p,color:'var(--sedentary)',avg,avgPill:true,avgPillInside:true,avgPillText:`${avg==null?'':avg.toFixed(1)} H AVG`,fmtAvg:avg==null?'':avg.toFixed(1)+' h',yMin:0,target:8,targetLabel:'8 h reference',
      fmtX:fmtDay,fmtY:v=>v.toFixed(1)+'h',label:'Sedentary time',
      tip:q=>`<b>${fmtDayLong(q.x)}</b>${tipRow('Sedentary',q.y.toFixed(1)+' h','var(--sedentary)')}${tipRow('vs average',(q.y>=avg?'▲ ':'▼ ')+Math.abs(q.y-avg).toFixed(1)+' h')}`,
      cols:['Day','Hours'],rows:p.filter(q=>q.y!=null).reverse().map(q=>[q.day,q.y.toFixed(1)])};
  }},
  {id:'hourly', section:'activity', subtab:'daily', title:'Steps by hour (last 24 h)', build:()=>{
    const p=D.hourly_steps.slice(-24).map(([t,v])=>({x:new Date(t).getTime(),y:v})),avg=mean(p.map(q=>q.y)),targetPerHour=10000/24;
    return {kind:'bar',pts:p,step:HOUR,color:'var(--steps)',avg,avgPill:true,avgPillInside:true,avgPillText:`${avg==null?'':fmtN(avg)} STEPS/HR AVG`,fmtAvg:avg==null?'':fmtN(avg)+' steps/hr',target:targetPerHour,targetLabel:'10,000 steps/day pace (417/hr)',targetColor:'var(--warn)',targetDash:'1 4',fmtX:fmtHour,label:'Steps by hour',
      tip:q=>`<b>${fmtDayLong(q.x)}, ${fmtHour(q.x)}</b>${tipRow('Steps',fmtN(q.y),'var(--steps)')}${tipRow('Target pace',fmtN(targetPerHour)+' steps/hr','var(--warn)')}${Number.isFinite(avg)?tipRow('24-hour average',fmtN(avg)+' steps/hr','var(--ink2)'):''}`,
      cols:['Hour','Steps'],rows:p.slice().reverse().map(q=>[fmtDay(q.x)+' '+fmtHour(q.x),fmtN(q.y)])};
  }},
  {id:'act', section:'activity', subtab:'daily', title:'Active minutes per day', build:()=>{
    const p=dailyPts('active_minutes');
    const vals=p.filter(q=>q.y!=null).map(q=>q.y), avg=mean(vals);
    return {kind:'bar',pts:p,color:'var(--active)',avg,avgPill:true,avgPillInside:true,avgPillText:`${avg==null?'':Math.round(avg)} MIN AVG`,fmtAvg:avg==null?'':avg.toFixed(0)+' min',yMin:0,target:30,
      fmtX:fmtDay,fmtY:v=>Math.round(v),label:'Active minutes',
      tip:q=>`<b>${fmtDayLong(q.x)}</b>${tipRow('Active',Math.round(q.y)+' min','var(--active)')}${tipRow('vs average',(q.y>=avg?'▲ ':'▼ ')+Math.abs(q.y-avg).toFixed(0)+' min')}`,
      cols:['Day','Minutes'],rows:p.filter(q=>q.y!=null).reverse().map(q=>[q.day,Math.round(q.y)])};
  }},
  {id:'azm', section:'activity', subtab:'daily', title:'Active Zone Minutes', sub:'Fat burn (1×) · Cardio (2×) · Peak (2×)', build:()=>{
    const byDay = {};
    for(const [d, v] of (D.daily.azm_fatburn||[])) byDay[d] = {...(byDay[d]||{}), fb: v};
    for(const [d, v] of (D.daily.azm_cardio||[]))   byDay[d] = {...(byDay[d]||{}), ca: v};
    for(const [d, v] of (D.daily.azm_peak||[]))     byDay[d] = {...(byDay[d]||{}), pk: v};
    const since = dayMs(D.today)-(days-1)*DAY;
    const p = Object.entries(byDay).map(([day,g])=>({
      x:dayMs(day), day,
      y:(g.fb||0)+2*(g.ca||0)+2*(g.pk||0),
      parts:[g.fb||0, g.ca||0, g.pk||0]
    })).filter(q=>q.x>=since);
    if(!p.length) return {kind:'stack',pts:[],empty:'No Active Zone Minutes yet.',cols:[],rows:[]};
    return {kind:'stack',pts:p,step:DAY,colors:['#22C55E','#F59E0B','#F43F5E'],
      xTicks:p.filter((q,i)=>i%2===0||i===p.length-1).map(q=>q.x),fmtX:fmtDay,fmtY:v=>v+' AZM',label:'Active Zone Minutes',
      tip:q=>`<b>${fmtDayLong(q.x)} · ${q.y.toFixed(0)} AZM</b>${tipRow('Fat burn',q.parts[0].toFixed(0)+' min','var(--z2)')}${tipRow('Cardio',q.parts[1].toFixed(0)+' min (×2)','var(--z3)')}${tipRow('Peak',q.parts[2].toFixed(0)+' min (×2)','var(--z4)')}`,
      cols:['Day','Fat burn','Cardio','Peak','Total AZM'],
      rows:p.slice().reverse().map(q=>[q.day, q.parts[0].toFixed(0), q.parts[1].toFixed(0), q.parts[2].toFixed(0), q.y.toFixed(0)])};
  }},
  {id:'zoneDay', section:'activity', subtab:'daily', title:'Time in HR zones', sub:'Google Health zones · light time reported separately', ctl:'<label>Day <select class="act" data-zone-day><option value="last24">Last 24 h</option><option value="today">Today so far</option><option value="yesterday">Yesterday</option></select></label>', build:()=>{
    const records=workoutDataAllSorted().map(w=>({day:w.day,start:w.start,z:w._zones}));
    const daySel=window._zoneDay||'last24',now=new Date(),today=localDateKey(now),yesterday=localDateKey(new Date(now.getTime()-DAY));
    const targetDay=daySel==='yesterday'?yesterday:today;const chosen=records.filter(r=>daySel==='last24'?(Number.isFinite(new Date(r.start).getTime())&&new Date(r.start).getTime()>=Date.now()-DAY&&new Date(r.start).getTime()<=Date.now()):r.day===targetDay);
    const sums={light:0,moderate:0,vigorous:0,peak:0};for(const r of chosen)for(const k of Object.keys(sums))sums[k]+=parseFloat(r.z[k+'Time'])||0;
    const total=Object.values(sums).reduce((a,b)=>a+b,0),recorded=chosen.length>0;
    const bars=[['Moderate',sums.moderate,'var(--z2)'],['Vigorous',sums.vigorous,'var(--warn)'],['Peak',sums.peak,'var(--bad)']];
    const summary=bars.map(([n,v,c])=>`<div class="metric-row"><span class="mlabel">${n}</span><span class="mval">${v?(v/60).toFixed(1)+' min':'—'}</span><span class="msub">${v?Math.round(v/Math.max(1,total)*100)+'% of recorded zone time':'No samples'}</span></div>`).join('');
    return {html:`<div class="sub" style="margin-bottom:8px">${recorded?'Recorded workout zone durations':'No Google Health zone-duration summary is available for this selection.'}</div><div style="display:flex;height:22px;border-radius:6px;overflow:hidden;background:var(--elevated);border:1px solid var(--border)">${bars.map(([n,v,c])=>v?`<div style="width:${v/Math.max(1,total)*100}%;background:${c}" title="${n}: ${(v/60).toFixed(1)} min"></div>`:'').join('')}<div style="flex:1;background:repeating-linear-gradient(135deg,transparent,transparent 4px,rgba(148,163,184,.18) 4px,rgba(148,163,184,.18) 6px)" title="Not recorded or outside these zones"></div></div><div class="legend">${bars.map(([n,v,c])=>`<span><i style="background:${c}"></i>${n}: ${v?(v/60).toFixed(1)+' min':'—'}</span>`).join('')}<span><i style="background:repeating-linear-gradient(135deg,var(--elevated),var(--elevated) 3px,var(--light) 3px,var(--light) 4px)"></i>Not recorded / light zone</span></div><div class="metric-row"><span class="mlabel">Light zone (summary)</span><span class="mval">${sums.light?(sums.light/60).toFixed(1)+' min':'—'}</span><span class="msub">Not included in training-zone stack</span></div>${summary}<div class="sub">${total?`Total recorded HR-zone duration: ${(total/60).toFixed(1)} min.`:'Durations are not inferred from raw heart-rate samples.'} Select another day above.</div>`};}},
  {id:'zoneStack', section:'activity', subtab:'daily', title:'Training-zone time by day', sub:'Google Health moderate · vigorous · peak; missing days remain empty', build:()=>{
    const records=workoutDataAllSorted().map(w=>({day:w.day,z:w._zones})).filter(r=>r.day&&dayMs(r.day)>=periodStart(period));
    if(!records.some(r=>['moderateTime','vigorousTime','peakTime'].some(k=>(parseFloat(r.z[k])||0)>0)))return {html:'<div class="empty">Google Health workout zone-duration summaries are not present for this period. The dashboard will not substitute estimated Karvonen zones.</div>'};
    const map={};for(const r of records){map[r.day]??={moderate:0,vigorous:0,peak:0};map[r.day].moderate+=parseFloat(r.z.moderateTime)||0;map[r.day].vigorous+=parseFloat(r.z.vigorousTime)||0;map[r.day].peak+=parseFloat(r.z.peakTime)||0;}
    const allDays=Object.keys(map).sort(),start=dayMs(allDays[0]),end=dayMs(allDays[allDays.length-1]),dayCount=Math.min(30,Math.max(1,Math.round((end-start)/DAY)+1)),days=Array.from({length:dayCount},(_,i)=>localDateKey(start+(Math.max(0,Math.round((end-start)/DAY)-dayCount+1)+i)*DAY));
    const p=days.map(day=>({day,x:dayMs(day),parts:[map[day]?.moderate||0,map[day]?.vigorous||0,map[day]?.peak||0].map(v=>v/60),y:((map[day]?.moderate||0)+(map[day]?.vigorous||0)+(map[day]?.peak||0))/60}));
    return {kind:'stack',pts:p,step:DAY,colors:['var(--z2)','var(--warn)','var(--bad)'],fmtX:fmtDay,fmtY:v=>v.toFixed(1)+' min',label:'Google Health training-zone time',h:260,tip:q=>`<b>${fmtDayLong(q.x)}</b>${tipRow('Moderate',(q.parts[0]*60).toFixed(0)+' min','var(--z2)')}${tipRow('Vigorous',(q.parts[1]*60).toFixed(0)+' min','var(--warn)')}${tipRow('Peak',(q.parts[2]*60).toFixed(0)+' min','var(--bad)')}`,cols:['Day','Moderate min','Vigorous min','Peak min'],rows:p.slice().reverse().filter(q=>q.y>0).map(q=>[q.day,...q.parts.map(v=>(v*60).toFixed(0))])};}},
  {id:'zoneDetails', section:'activity', wide:true, subtab:'daily', title:'Heart-zone time · detailed table', sub:'Google Health light / moderate / vigorous / peak durations', build:()=>{
    const map={};for(const w of workoutDataAllSorted()){const z=w._zones;if(!w.day||!z)continue;if(dayMs(w.day)<periodStart(period))continue;map[w.day]??={light:0,moderate:0,vigorous:0,peak:0};for(const k of Object.keys(map[w.day]))map[w.day][k]+=parseFloat(z[k+'Time'])||0;}
    const days=Object.keys(map).sort().reverse().slice(0,14);if(!days.length)return {html:'<div class="empty">No Google Health workout zone-duration summaries are available. Estimated HR zones are intentionally not presented as Google Health zones.</div>'};
    const rows=days.map(d=>{const z=map[d],v=[z.light,z.moderate,z.vigorous,z.peak];return `<tr><td>${d}</td>${v.map((n,i)=>`<td ${n>0?`style="background:${['rgba(100,116,139,.15)','rgba(20,184,166,.15)','rgba(245,158,11,.15)','rgba(244,63,94,.15)'][i]}"`:''}>${n?formatDuration(n):'—'}</td>`).join('')}<td>${formatDuration(v.reduce((a,b)=>a+b,0))}</td></tr>`;}).join('');
    return {html:`<table class="data-table" style="width:100%;border-collapse:collapse"><thead><tr><th>Date</th><th>Light</th><th>Moderate</th><th>Vigorous</th><th>Peak</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><p class="sub">Latest 14 days with recorded workout summaries. A dash means no recorded duration for that zone, not a measured zero.</p>`};}},
  {id:'sleepinghrv', section:'activity', wide:true, subtab:'daily', title:'Overnight HRV Range', sub:'Nightly HRV trend and actual readings', ctl:'<span class="chart-info" tabindex="0" title="Google Health timestamped sleep HRV samples. Trend is smoothed for readability; points retain the recorded values.">ⓘ</span>', build:()=>({html:buildSleepingHrvExplorer()})},
  {id:'spo2samples', section:'activity', wide:true, subtab:'daily', title:'SpO₂ during sleep · raw samples', sub:'Nightly SpO₂ trend and individual readings', ctl:'<span class="chart-info" tabindex="0" title="Wrist SpO₂ is an estimate and can be affected by fit, movement, and signal quality. Isolated dips are not diagnostic.">ⓘ</span>', build:()=>{const html=buildSpo2Explorer();return {html,cols:['Time','SpO₂ (%)'],rows:(window._spo2Active||[]).map(p=>[fmtTime(p.t),p.v.toFixed(1)])};}},

  {id:'trainingLoad', section:'activity', subtab:'workouts', wide:true, title:'Training load · fitness, fatigue & form', sub:'HRR-based TRIMP · 7-day ATL / 28-day CTL / training stress balance', build:()=>buildTrainingLoad()},
  {id:'workoutLoad', section:'activity', subtab:'workouts', title:'Training load · daily calories', sub:'Stacked by workout type', build:()=>buildWorkoutLoad()},
  {id:'workoutTimeline', section:'activity', subtab:'workouts', title:'Workout timing', sub:'When you exercise · one row per day', build:()=>buildWorkoutTimeline()},

  {id:'correlation', section:'patterns', title:'Personal correlation explorer', wide:true, nobtn:true, build:()=>({html:correlationHtml()})},
  {id:'baseline', section:'patterns', title:'Personal baseline deviations', nobtn:true, build:()=>({html:baselineHtml()})},
  {id:'nights', section:'patterns', title:'Better-night vs difficult-night', nobtn:true, build:()=>({html:nightCompareHtml()})},
  {id:'available-later', section:'patterns', title:'Karvonen zones & overnight breathing', nobtn:true, build:()=>({html:additionalDataHtml()})},

  {id:'coverage', section:'quality', title:'Data coverage and freshness', nobtn:true, build:()=>({html:coverageHtml()})},
  {id:'dbStorage', section:'quality', wide:true, title:'Database storage diagnosis', sub:'Read-only row counts, object sizes, integrity and safe cleanup opportunities', nobtn:true, build:()=>({html:databaseDiagnosticsHtml()})},
  {id:'deviceHealth', section:'device-health', title:'Device health', nobtn:true, build:()=>({html:deviceHealthCardHtml()})},
];

const sectionInfo = {
  overview:['Overview','Recovery, sleep-quality 7-day averages, sleep debt, fitness age and your 24-hour heart rate with same-weekday overlay.'],
  heart:['Heart & recovery','Resting HR, HRV envelope, 4-quadrant HRV↔RHR scatter, SpO₂ with clinical threshold, body-temperature deviation and daily HR distribution.'],
  sleep:['Sleep','Sleep stages, sleep debt, overnight heart rate patterns and per-stage trends.'],
  activity:['Activity & fitness','Steps, distance, sedentary time, Active Zone Minutes, raw sleeping HRV and SpO₂, and workouts. Sub-tabs: Daily and Workouts.'],
  patterns:['Personal patterns','Correlations, personal baselines, better-night comparisons, Karvonen heart-rate thresholds and overnight SpO₂ signals.'],
  quality:['Data quality','Coverage and sync freshness.'],
  'device-health':['Device health','Fitbit Air battery history and estimated heart-rate wear coverage.'],
};

function applySection(section, subtab){
  activeSection = section;
  activeSubtab = subtab || (section === 'activity' ? (activeSubtab || 'daily') : null);
  document.querySelectorAll('.navbtn').forEach(b=>b.classList.toggle('active', b.dataset.section === section));
  $('#sectionTitle').textContent = sectionInfo[section][0];
  $('#sectionDesc').textContent = sectionInfo[section][1];
  const isOverview = section === 'overview';
  $('#overviewView').hidden = !isOverview;
  if(isOverview&&D)renderOverview();
  $('#detailView').hidden = isOverview;

  const atSub = $('#activitySubtabs');
  if (atSub) {
    atSub.hidden = section !== 'activity';
    atSub.querySelectorAll('.subtab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.atab === activeSubtab)));
  }

  const hmCard = $('#heatmapCard');
  if (hmCard) hmCard.hidden = !(section === 'activity' && activeSubtab === 'daily');
  if(section==='activity'&&activeSubtab==='daily'&&D)renderHeatmap();
  const workoutsCard = $('#workoutsCard');
  if (workoutsCard) workoutsCard.classList.toggle('hidden-by-nav', !(section === 'activity' && activeSubtab === 'workouts'));

  $$('#charts .card').forEach(c => {
    const cSection = c.dataset.section;
    const cSubtab = c.dataset.subtab;
    let show = cSection === section;
    if (show && cSubtab && activeSubtab) show = cSubtab === activeSubtab;
    c.classList.toggle('hidden-by-nav', !show);
  });
  $('#kpis').classList.toggle('hidden-by-nav', true);
  requestAnimationFrame(()=>{for(const card of $$('#charts .card'))if(cardVisible(card)&&(card.dataset.dirty||!chartCache.has(card.id.replace(/^card-/,''))))scheduleCard(card);if(D&&section==='activity'&&activeSubtab==='workouts')renderWorkouts();});
}
document.querySelectorAll('.navbtn').forEach(b=>b.addEventListener('click',()=>{applySection(b.dataset.section);if(b.dataset.section==='quality')setTimeout(refreshDatabaseDiagnostics,0);if(b.dataset.section==='device-health')loadDeviceHealth();}));
document.querySelector('#overviewBoxes')?.addEventListener('click',e=>{const row=e.target.closest('.metric-row');if(!row)return;const label=row.querySelector('.mlabel')?.textContent?.trim().toLowerCase()||'';const map=[[/mean hr|heart rate/,'overview',null,'#card-hr24'],[/resting hr/,'heart',null,'#card-rhr'],[/hrv/,'heart',null,'#card-hrv'],[/spo₂|spo2/,'heart',null,'#card-spo2'],[/body temp/,'heart',null,'#card-bodytemp'],[/sleep debt/,'sleep',null,'#card-sleepdebt'],[/deep sleep|rem sleep/,'sleep',null,'#card-sleepStageTrend'],[/asleep|latency|restlessness|interruptions|efficiency/,'sleep',null,'#card-sleep'],[/steps/,'activity','daily','#card-steps'],[/distance/,'activity','daily','#card-distance'],[/active min/,'activity','daily','#card-act'],[/sedentary/,'activity','daily','#card-sedentary'],[/calories/,'activity','daily','#card-calories'],[/vo₂ max/,'activity','workouts','#card-workoutVo2'],[/last workout/,'activity','workouts','#workouts']];const m=map.find(([re])=>re.test(label));if(!m)return;applySection(m[1],m[2]);requestAnimationFrame(()=>{const target=document.querySelector(m[3]);if(target){target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'center'});target.classList.add('metric-highlight');setTimeout(()=>target.classList.remove('metric-highlight'),1200);}});});
document.addEventListener('click', e => {
  const sub = e.target.closest('.subtab');
  if (sub) applySection('activity', sub.dataset.atab);
});
let hrBoxTip=null,hrBoxPopover=null,hrBoxDrag=null;
function hrBoxTooltip(){if(!hrBoxTip){hrBoxTip=document.createElement('div');hrBoxTip.className='hrbox-tooltip';hrBoxTip.setAttribute('role','status');document.body.appendChild(hrBoxTip);}return hrBoxTip;}
function hrBoxMeta(el){try{return JSON.parse(decodeURIComponent(el.closest('[data-hrbox-meta]')?.dataset.hrboxMeta||''));}catch(_){return null;}}
function showHrBoxTip(el,e){const q=hrBoxMeta(el);if(!q)return;const tip=hrBoxTooltip(),spread=q.high-q.low;tip.innerHTML=`<b>${new Date(q.day+'T12:00:00').toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'})}</b><div>High <b>${q.high} bpm</b> · Mean <b>${q.mean.toFixed(1)} bpm</b></div><div>Low <b>${q.low} bpm</b> · Daily spread <b>${spread.toFixed(1)} bpm</b></div><div>Middle 50%: ${q.q1}–${q.q3} bpm · ${q.n} samples</div>${q.high>170?'<div style="color:#FF8B8B;font-weight:700">Elevated peak</div>':''}`;tip.style.display='block';tip.style.left=Math.max(8,Math.min(innerWidth-315,(e?.clientX||el.getBoundingClientRect().left)+14))+'px';tip.style.top=Math.max(8,Math.min(innerHeight-180,(e?.clientY||el.getBoundingClientRect().top)+14))+'px';}
function closeHrBoxPopover(){hrBoxPopover?.remove();hrBoxPopover=null;}
function openHrBoxOutlier(el,e){const q=hrBoxMeta(el);if(!q)return;closeHrBoxPopover();const kind=el.dataset.hrboxOutlier||'high',value=Number(el.getAttribute('data-value'))||(kind==='low'?q.low:q.high);const pop=document.createElement('div');pop.className='hrbox-popover';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Heart-rate outlier details');pop.innerHTML=`<button class="act" data-hrbox-popclose style="float:right">Close ✕</button><h3>${kind==='low'?'Low':'High'} heart-rate extreme</h3><div><b>${esc(q.day)}</b> · ${value} bpm</div><p class="sub">Daily rollups do not store the exact timestamp or activity context. The value is an extreme for this day; inspect the day's raw readings for context.</p><label for="hrbox-label">Add a label</label><input id="hrbox-label" maxlength="80" placeholder="e.g. HIIT workout, stairs, sensor artefact"><div class="row"><button class="act" data-hrbox-save>Save label</button><button class="act" data-hrbox-exclude>Exclude from this chart</button><button class="act" data-hrbox-day>View day detail</button></div><div class="sub" data-hrbox-status style="margin-top:8px"></div>`;document.body.appendChild(pop);hrBoxPopover=pop;const x=e?.clientX??el.getBoundingClientRect().left,y=e?.clientY??el.getBoundingClientRect().top;pop.style.left=Math.max(8,Math.min(innerWidth-340,x+8))+'px';pop.style.top=Math.max(8,Math.min(innerHeight-260,y+8))+'px';const key=`${q.day}:${kind}:${value}`;pop.querySelector('[data-hrbox-popclose]').onclick=closeHrBoxPopover;pop.querySelector('[data-hrbox-save]').onclick=()=>{const label=pop.querySelector('#hrbox-label').value.trim();if(!label){pop.querySelector('[data-hrbox-status]').textContent='Enter a label first.';return;}const all=JSON.parse(localStorage.getItem('hrBoxOutlierLabels')||'{}');all[key]=label;localStorage.setItem('hrBoxOutlierLabels',JSON.stringify(all));pop.querySelector('[data-hrbox-status]').textContent='Label saved in this browser.';};pop.querySelector('[data-hrbox-exclude]').onclick=()=>{const all=JSON.parse(localStorage.getItem('hrBoxExcluded')||'[]');if(!all.includes(key))all.push(key);localStorage.setItem('hrBoxExcluded',JSON.stringify(all));pop.querySelector('[data-hrbox-status]').textContent='This extreme is hidden from the chart on this browser.';const card=document.querySelector('#card-hrdaily');if(card)renderCardByElement(card,true);};pop.querySelector('[data-hrbox-day]').onclick=()=>{closeHrBoxPopover();openDayDetail(q.day,'Daily heart-rate outlier');};}
document.addEventListener('pointerover',e=>{const col=e.target.closest?.('.hrbox-column');if(col)showHrBoxTip(col,e);});
document.addEventListener('pointermove',e=>{if(hrBoxDrag){const svg=hrBoxDrag.svg,r=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal,x=(e.clientX-r.left)/r.width*vb.width,sel=svg.querySelector('[data-hrbox-selection]');if(sel){const left=Math.min(hrBoxDrag.start,x),right=Math.max(hrBoxDrag.start,x);sel.setAttribute('x',left);sel.setAttribute('width',right-left);sel.setAttribute('opacity','.9');}return;}const col=e.target.closest?.('.hrbox-column');if(col&&hrBoxTip?.style.display==='block'){hrBoxTip.style.left=Math.max(8,Math.min(innerWidth-315,e.clientX+14))+'px';hrBoxTip.style.top=Math.max(8,Math.min(innerHeight-180,e.clientY+14))+'px';}});
document.addEventListener('pointerout',e=>{if(e.target.closest?.('.hrbox-column')&&!e.relatedTarget?.closest?.('.hrbox-column')&&!hrBoxDrag&&hrBoxTip)hrBoxTip.style.display='none';});
document.addEventListener('click',e=>{const out=e.target.closest?.('[data-hrbox-outlier]');if(out){e.stopPropagation();openHrBoxOutlier(out,e);return;}const col=e.target.closest?.('.hrbox-column');if(col&&e.detail!==0){const q=hrBoxMeta(col);if(q)openDayDetail(q.day,'Daily heart-rate distribution');}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeHrBoxPopover();if(hrBoxTip)hrBoxTip.style.display='none';}const el=e.target.closest?.('.hrbox-mark');if(el&&(e.key==='Enter'||e.key===' ')){e.preventDefault();if(el.dataset.hrboxOutlier)openHrBoxOutlier(el,e);else showHrBoxTip(el,e);}});
document.addEventListener('pointerdown',e=>{const svg=e.target.closest?.('.hrbox-svg');if(!svg||e.target.closest('[data-hrbox-outlier]'))return;const r=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal;hrBoxDrag={svg,start:(e.clientX-r.left)/r.width*vb.width,clientX:e.clientX};});
document.addEventListener('pointerup',e=>{if(!hrBoxDrag)return;const d=hrBoxDrag;hrBoxDrag=null;const svg=d.svg,sel=svg.querySelector('[data-hrbox-selection]'),r=svg.getBoundingClientRect(),vb=svg.viewBox.baseVal,end=(e.clientX-r.left)/r.width*vb.width;if(sel){sel.setAttribute('opacity','0');sel.setAttribute('width','0');}if(Math.abs(end-d.start)<12)return;const lo=Math.min(end,d.start),hi=Math.max(end,d.start),cols=[...svg.querySelectorAll('.hrbox-column')],chosen=cols.filter(c=>{const rect=c.querySelector('.hrbox-hit')?.getBBox();return rect&&rect.x+rect.width/2>=lo&&rect.x+rect.width/2<=hi;}).map(hrBoxMeta).filter(Boolean);if(!chosen.length)return;const avg=key=>chosen.reduce((a,q)=>a+q[key],0)/chosen.length;const box=document.createElement('div');box.className='hrbox-popover';box.setAttribute('role','dialog');box.innerHTML=`<button class="act" data-hrbox-popclose style="float:right">Close ✕</button><h3>Selected date range</h3><div>${esc(chosen[0].day)} – ${esc(chosen[chosen.length-1].day)}</div><p>${chosen.length} days · Mean HR ${avg('mean').toFixed(1)} bpm · Median ${avg('median').toFixed(1)} bpm</p><p>Range across selected days: ${Math.min(...chosen.map(q=>q.low))}–${Math.max(...chosen.map(q=>q.high))} bpm</p>`;document.body.appendChild(box);hrBoxPopover=box;box.style.left=Math.max(8,Math.min(innerWidth-340,e.clientX+8))+'px';box.style.top=Math.max(8,Math.min(innerHeight-200,e.clientY+8))+'px';box.querySelector('[data-hrbox-popclose]').onclick=closeHrBoxPopover;});


