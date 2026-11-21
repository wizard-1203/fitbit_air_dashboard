function metricRow(label, value, unit, sub, delta, spark){
  return `<div class="metric-row">
    <span class="mlabel">${label}</span>
    <span class="mval">${value==null?'–':value}${unit?`<small>${unit}</small>`:''}${sub?`<span class="msub">${sub}</span>`:''}${delta||''}</span>
    <span class="spark">${spark||''}</span>
  </div>`;
}

function heartBox(){
  const hrVals=(D.hr||[]).map(r=>Number(r[1])).filter(Number.isFinite);
  const hrMean=mean(hrVals), hrMin=hrVals.length?Math.min(...hrVals):null, hrMax=hrVals.length?Math.max(...hrVals):null;
  const rhr=lastVal('resting_hr'), rhr7=avgLastN('resting_hr',7);
  const hrv=lastVal('hrv'), hrv7=avgLastN('hrv',7);
  const spo=lastVal('spo2'), spo7=avgLastN('spo2',7);
  const bt=lastVal('body_temp');
  const strainToday=dailyStrainScore(D.today), strainValue=strainToday.score==null?null:strainToday.score.toFixed(1);
  const latestHr=(D.hr||[]).slice(-1)[0], liveBpm=Number(latestHr?.[1]), reserveBase=Number(D.zone_limits?.rhr)||Number(lastVal('resting_hr'))||60, reserveMax=Number(D.zone_limits?.max_hr)||190, reservePct=Number.isFinite(liveBpm)?clamp((liveBpm-reserveBase)/Math.max(1,reserveMax-reserveBase),0,1):null;
  const liveRate=reservePct==null?null:reservePct*Math.exp((D.settings?.sex==='f'?1.67:1.92)*reservePct)*1.15;
  const rr = respRateDeviation();
  const rrSub = rr ? `baseline ${rr.base.toFixed(1)}/min` : '';
  const rrVal = rr ? `${rr.today.toFixed(1)}` : null;
  const rrDelta = rr ? `<span class="status-pill ${rr.band}">${rr.dev>=0?'+':''}${rr.dev.toFixed(1)}</span>` : '';
  const spoDelta = spo==null || spo7==null ? '' :
    (Math.abs(spo-spo7) < 0.5
      ? '<span class="delta neutral">● stable</span>'
      : spo<95
        ? `<span class="delta down">▼ ${Math.abs(spo-spo7).toFixed(1)}%</span>`
        : spo > spo7
          ? `<span class="delta up">▲ ${Math.abs(spo-spo7).toFixed(1)}%</span>`
          : `<span class="delta down">▼ ${Math.abs(spo-spo7).toFixed(1)}%</span>`);
  return `<section class="consolidated" id="box-heart">
    <h3><span class="dot" style="background:var(--rhr)"></span>Heart &amp; recovery</h3>
    ${metricRow('Mean HR (24h)', hrMean==null?null:hrMean.toFixed(0), 'bpm',
      `min ${hrMin==null?'–':Math.round(hrMin)} · max ${hrMax==null?'–':Math.round(hrMax)}`,
      '', sparkline(dailyVals('resting_hr', 14), 'var(--rhr)'))}
    ${metricRow('Resting HR', rhr==null?null:rhr.toFixed(0), 'bpm',
      rhr7==null?'':'7-day avg '+rhr7.toFixed(0), deltaText(rhr,rhr7,false,false), sparkline(dailyVals('resting_hr', 14), 'var(--rhr)'))}
    ${metricRow('HRV', hrv==null?null:hrv.toFixed(1), 'ms',
      hrv7==null?'':'7-day avg '+hrv7.toFixed(1), deltaText(hrv,hrv7,false,true), sparkline(dailyVals('hrv', 14), 'var(--hrv)'))}
    ${metricRow('SpO₂', spo==null?null:spo.toFixed(1), '%',
      spo7==null?'':'7-day avg '+spo7.toFixed(1)+(spo!=null&&spo<95?' · below 95%':''),
      spoDelta, sparkline(dailyVals('spo2', 14), 'var(--spo2)'))}
    ${metricRow('Body temp dev.', bt==null?null:bt.toFixed(2), '°C',
      'nightly derivation', '', sparkline(dailyVals('body_temp', 14), 'var(--temp-low)'))}
    ${metricRow('Resp rate', rrVal, '/min', (rrSub?rrSub+' · ':'')+'daily trend', rrDelta, sparkline(dailyVals('resp_rate', 14), 'var(--resp)'))}
    ${metricRow('Strain score', strainValue, '/21', strainToday.sampleCount ? (strainToday.sampleCount+' raw HR samples · now '+(reservePct==null?'–':Math.round(reservePct*100)+'% reserve, rate '+liveRate.toFixed(2)+'/min')+' · 7d '+(strainToday.acute==null?'–':strainToday.acute.toFixed(1))+' / 28d '+(strainToday.chronic==null?'–':strainToday.chronic.toFixed(1))) : 'no raw HR samples today', '', '')}
  </section>`;
}

function sleepBox(){
  const mains=(D.sleep||[]).filter(s=>s.main).sort((a,b)=>a.start.localeCompare(b.start));
  const last = mains[mains.length-1] || null;
  window._requestedSleepSnapshots=window._requestedSleepSnapshots||new Set();
  for(const past of (D.sleep_score_history||[]).filter(s=>s.main&&!s.nap&&Number(s.asleep)>0).slice(-28)){
    const sid=String(past.id);
    if(sid!==String(last?.id||'')&&!window._requestedSleepSnapshots.has(sid)){
      window._requestedSleepSnapshots.add(sid);
      requestSleepSnapshot(past,sleepScoreComponents(past));
    }
  }
  const last7 = mains.slice(-7);
  const avgAsleep=mean(last7.map(s=>s.asleep));
  const avgDeep=mean(last7.map(s=>s.deep));
  const avgRem=mean(last7.map(s=>s.rem));
  const eff = last && last.in_bed>0 ? 100*last.asleep/last.in_bed : null;
  const debt = computeSleepDebt();
  const sleepScore=sleepScoreFor(last);
  const latency = last?.latency_min;
  const avgLatency = mean(last7.map(s=>s.latency_min).filter(Number.isFinite));
  const restless = last?.restless_min;
  const avgRestless = mean(last7.map(s=>s.restless_min).filter(Number.isFinite));

  const stages = last ? [
    ['Deep','var(--deep)', last.deep||0],
    ['REM','var(--rem)', last.rem||0],
    ['Light','var(--light)', last.light||0],
    ['Awake','var(--awake)', last.awake||0],
  ] : [];
  const stageTotal = stages.reduce((s,[,_,v])=>s+v,0) || 1;
  const archBar = last && stageTotal > 1 ? `
    <div class="sleep-arch">${stages.map(([n,c,v])=>v?`<span title="${n}: ${hm(v)}" style="width:${(v/stageTotal*100).toFixed(1)}%;background:${c}"></span>`:'').join('')}</div>
    <div class="srow" style="font-size:11px;color:var(--ink2);margin-bottom:10px">
      ${stages.filter(([,,v])=>v).map(([n,c,v])=>`<span><i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${c};margin-right:4px"></i>${n} ${Math.round(v/stageTotal*100)}%</span>`).join('')}
    </div>` : '';

  return `<section class="consolidated" id="box-sleep">
    <h3><span class="dot" style="background:var(--deep)"></span>Sleep · last night</h3>
    ${archBar}
    ${metricRow("Sleep score", sleepScore.score==null?null:sleepScore.score.toFixed(1), "/100", "", "", "")}
    ${metricRow('Asleep', last?hm(last.asleep):null, '',
      last7.length?`7-day avg ${hm(avgAsleep||0)}`:'', '', '')}
    ${metricRow('Deep sleep', last?hm(last.deep):null, '',
      avgDeep==null?'':'7-day avg '+hm(avgDeep), '', '')}
    ${metricRow('REM sleep', last?hm(last.rem):null, '',
      avgRem==null?'':'7-day avg '+hm(avgRem), '', '')}
    ${metricRow('Sleep latency', latency, 'min',
      avgLatency==null?'':'7-day avg '+avgLatency.toFixed(0)+' min', '', '')}
    ${metricRow('Restlessness', restless, 'min',
      avgRestless==null?'':'7-day avg '+avgRestless.toFixed(0)+' min', '', '')}
    ${metricRow('Efficiency', eff==null?null:eff.toFixed(0), '%',
      last?`in-bed ${hm(last.in_bed)}`:'', '', '')}
    ${metricRow('Sleep debt (14d)', debt.total.toFixed(1), 'h',
      `goal ${debt.goalH}h · ${debt.label}`,
      `<span class="status-pill ${debt.band}">${debt.label}</span>`, '')}
  </section>`;
}

function activityBox(){
  const steps=lastVal('steps'), steps7=avgLastN('steps',7);
  const act=lastVal('active_minutes'), act7=avgLastN('active_minutes',7);
  const cal=lastVal('calories');
  const dist=lastVal('distance_m'), dist7=avgLastN('distance_m',7);
  const sed=lastVal('sedentary_seconds'), sed7=avgLastN('sedentary_seconds',7);
  const googleVo2 = lastVal('vo2max');
  const vo = estimateVO2();
  const voVal = googleVo2!=null ? googleVo2 : (vo ? vo.vo2 : null);
  const voSrc = googleVo2!=null ? 'stored by Google Health' : (vo ? 'estimated from resting HR' : null);
  const fa = voVal!=null && D.settings?.age ? computeFitnessAge(voVal, D.settings?.sex||'m', Number(D.settings.age)) : null;
  const voPill = fa!=null && D.settings?.age ? `<span class="status-pill ${fa<Number(D.settings.age)?'good':fa>Number(D.settings.age)?'warn':'neutral'}">${fa<Number(D.settings.age)?'younger':fa>Number(D.settings.age)?'older':'on par'}</span>` : '';
  const workouts=activeWorkouts().slice(0,7);
  const lastWk=workouts[0];
  const lastDay = lastWk ? dayMs(lastWk.day) : null;
  const gapDays = lastDay ? Math.floor((dayMs(D.today) - lastDay) / DAY) : null;
  const gapSub = lastWk
    ? (gapDays >= 3 ? `<span class="stale-hint">⚠ ${gapDays} days since last workout</span>` : fmtDayLong(lastDay))
    : 'none in 30d';
  return `<section class="consolidated" id="box-activity">
    <h3><span class="dot" style="background:var(--steps)"></span>Activity &amp; fitness</h3>
    ${metricRow('Steps', steps==null?null:fmtN(steps), '',
      steps7==null?'':'7-day avg '+fmtN(steps7), deltaText(steps,steps7,false,true), sparkline(dailyVals('steps', 14), 'var(--steps)'))}
    ${metricRow('Distance', dist==null?null:dist.toFixed(2), 'km',
      dist7==null?'':'7-day avg '+dist7.toFixed(2)+' km', deltaText(dist,dist7,false,true), sparkline(dailyVals('distance_m', 14), 'var(--distance)'))}
    ${metricRow('Active min', act==null?null:Math.round(act), '',
      act7==null?'':'7-day avg '+Math.round(act7), deltaText(act,act7,false,true), sparkline(dailyVals('active_minutes', 14), 'var(--active)'))}
    ${metricRow('Sedentary', sed==null?null:(sed/3600).toFixed(1), 'h',
      sed7==null?'':'7-day avg '+(sed7/3600).toFixed(1)+' h', deltaText(sed,sed7,false,false), sparkline(dailyVals('sedentary_seconds', 14).map(v=>v/3600), 'var(--sedentary)'))}
    ${metricRow('Calories', cal==null?null:Math.round(cal), '',
      'daily total · recent days', '', sparkline(dailyVals('calories', 14), 'var(--calories)'))}
    ${metricRow('VO₂ max', voVal==null?null:voVal.toFixed(1), 'ml/kg/min',
      (voSrc||'set age in Settings')+' · daily trend', '', sparkline(dailyVals('vo2max', 14), 'var(--vo2)'))}
    ${metricRow('Fitness age', fa==null?null:fa, 'yr',
      D.settings?.age?`chronological ${D.settings.age}`:'', voPill, '')}
    ${metricRow('Last workout', lastWk?lastWk.type.replace(/_/g,' ').toLowerCase():null, '',
      gapSub, '', '')}
  </section>`;
}

function respRateDeviation(){
  const pts = (D.daily.resp_rate||[]).map(r=>r[1]).filter(Number.isFinite);
  if(pts.length<5) return null;
  const today = pts[pts.length-1];
  const base = mean(pts.slice(-30,-1));
  if(base==null) return null;
  const dev = today - base;
  const band = Math.abs(dev) < 0.5 ? 'good' : Math.abs(dev) < 1.0 ? 'warn' : 'bad';
  return {today, base, dev, band};
}

/* ============================================================
   OVERVIEW CHARTS
   ============================================================ */
function renderZoneSummary(){
  const host = $('#zoneSummary'); if(!host)return; const s=zoneSummary();
  if(!s){host.innerHTML='<p class="sub">No zone data yet. Set your age in Settings and sync heart-rate data.</p>';return;}
  const limits=D.zone_limits||{}, edges=Array.isArray(limits.edges)&&limits.edges.length===6?limits.edges:null;
  const hrText=v=>Number.isFinite(Number(v))?Number(v).toFixed(1).replace(/\.0$/,''):'—';
  const excludeZ1=!!window._zoneExcludeZ1, zones=ZONE_DEFS.filter(z=>!excludeZ1||z.id!=='z1');
  const total=zones.reduce((a,z)=>a+(s.today?.[z.id]||0),0);
  const cards=zones.map(z=>{const idx=ZONE_DEFS.indexOf(z),sec=Number(s.today?.[z.id]||0),pct=total?100*sec/total:0,active=sec>0;const avg=Number(s.averages[z.id]||0);const ring=active?`<div class="zone-ring" style="--ring:${z.color};--pct:${pct}%"><span>${pct.toFixed(1)}%</span></div>`:'';
    const range=edges?(idx===0?`<${hrText(edges[idx+1])} bpm`:`${hrText(edges[idx])}–${hrText(edges[idx+1])} bpm`):'';
    return `<article class="zone-bento ${active?'active':'inactive'}" style="--zone:${z.color}" tabindex="0" title="${esc(z.desc||z.name)}"><div class="zone-bento-top"><span style="color:${z.color}">${z.label} · ${z.name}</span>${active?'<span class="zone-active-pill">ACTIVE</span>':'<span class="zone-inactive-pill">INACTIVE</span>'}</div><div class="zone-bento-main"><div><strong>${formatDuration(sec)}</strong><div class="sub">${active?pct.toFixed(1)+'% of today’s zone time':'No time recorded'}</div><div class="sub">30-day avg ${formatDuration(avg)}</div></div>${ring}</div><div class="zone-bento-foot"><span>Target: ${z.range||z.desc||z.name}${range?` · ${range}`:''}</span><span class="delta ${Math.abs(sec/3600-avg/3600)<.02?'neutral':sec>avg?'up':'down'}">${sec>=avg?'▲':'▼'} ${formatDuration(Math.abs(sec-avg))} vs avg</span></div></article>`;
  }).join('');
  host.innerHTML=`<div class="zone-bento-controls"><div class="zone-legend">${zones.map(z=>`<span><i style="background:${z.color}"></i>${z.label} · ${z.name}</span>`).join('')}</div><button class="act toggle-btn" type="button" onclick="window._zoneExcludeZ1=!window._zoneExcludeZ1;renderOverview()" aria-pressed="${excludeZ1}">${excludeZ1?'Show Zone 1':'Exclude Zone 1'}</button><span class="kpi-chip">Today · total zone time <b>${formatDuration(total)}</b></span></div><div class="zone-bento-grid">${cards}</div><p class="sub" style="margin-top:12px">Each card has its own scale so inactive zones do not create empty tracks. Percentage is the share of today’s recorded zone time. Comparison uses the 30-day daily average.</p>`;
}
function zoneSummary(){
  const days = Object.keys(D.zone_time||{}).sort();
  if(!days.length) return null;
  const recent = days.slice(-30);
  const averages = {};
  for(const z of ZONE_DEFS){
    const vals = recent.map(d=>(D.zone_time[d]||{})[z.id]||0);
    averages[z.id] = mean(vals) || 0;
  }
  const today = D.zone_time[D.today] || null;
  return {today, averages, recent, n:recent.length};
}

function renderOverview(){
  renderHero();
  $('#overviewBoxes').innerHTML = heartBox()+sleepBox()+activityBox();
  $('#overviewCharts').innerHTML = `
    <section class="card wide" id="card-hr24">
      <header><h2>Heart Rate (Last 24 Hours)</h2>
        <span class="hint hr24-inline-legend">Rolling 24-hour window <span class="hr24-legend-mark actual"></span>Actual HR <span class="hr24-legend-mark range"></span>Historical Range</span>
        <button class="act toggle-btn" type="button" onclick="window._hr24ShowTypical=!window._hr24ShowTypical;renderOverview()" aria-pressed="${window._hr24ShowTypical}">Compare Historical trend</button></header>
      <div class="plot"></div>
      <div class="legend">
        ${window._hr24ShowTypical?`<span><i style="background:#94A3B8"></i>Historical trend</span>`:''}
        ${ZONE_DEFS.map(z=>`<span><i style="background:${z.color}"></i>${z.label} ${z.name}</span>`).join('')}
        <span style="color:var(--ink2)">▨ Sleep window</span>
      </div>
      </section>
    <section class="card wide" id="card-hr24-insights">
      <header><h2>Typical match &amp; sleep interruptions</h2><span class="hint">Today’s heart-rate pattern and last night’s sleep</span></header>
      <div class="foot" id="hr24foot"></div>
    </section>
    <section class="card wide" id="card-zoneSummary">
      <header><h2>Time in heart-rate zones</h2>
        <span class="hint">Today vs 30-day baseline · white tick = baseline</span></header>
      <div id="zoneSummary"></div>
    </section>
  `;
  drawHr24();
  renderZoneSummary();
}

window.selectHrDay=async function(date){if(!date)return;window._hrDayDate=date;const host=document.querySelector('#card-hr24 .plot');if(host)host.innerHTML='<div class="skeleton"></div>';try{const resp=await fetch('/api/hr-day?date='+encodeURIComponent(date));if(!resp.ok)throw new Error('Unable to load this date');const data=await resp.json();window._hrSelectedSamples=data.samples||[];drawHr24();}catch(e){if(host)host.innerHTML='<div class="empty">Could not load heart-rate readings for this date. '+esc(e.message)+'</div>';}};
function karvonenStops(edges,lo=40,hi=155){
  const colors=['#38BDF8','#10B981','#F59E0B','#F43F5E','#F43F5E'],cuts=[lo,...edges.slice(1,5),hi].map(v=>clamp(Number(v),lo,hi));
  const stops=[{value:lo,color:colors[0]}];for(let i=1;i<cuts.length-1;i++){stops.push({value:cuts[i],color:colors[i-1]},{value:cuts[i],color:colors[i]});}stops.push({value:hi,color:colors.at(-1)});return stops;
}
function drawHr24(){
  const host=$('#card-hr24 .plot'); if(!host) return;
  const hr=(D.hr||[]);
  if(!hr.length){ host.innerHTML='<div class="empty">No heart-rate readings in the current data response.</div>'; return; }
  const zoneOf = makeZoneOf();
  const actualEnd=Date.now(), actualStart=actualEnd-DAY;
  const actual = hr.filter(([t])=>Number.isFinite(Number(t))&&t>=actualStart&&t<=actualEnd).map(([t,a,lo,hi])=>({x:t,y:a,band:Number.isFinite(Number(lo))&&Number.isFinite(Number(hi))?[Number(lo),Number(hi)]:null,zone:zoneOf(a)}));
  if(!actual.length){host.innerHTML='<div class="empty">No heart-rate readings in the last 24 hours. Sync your data and try again.</div>';return;}
  actual.sort((a,b)=>a.x-b.x);
  const chartActual=[];for(let i=0;i<actual.length;i++){if(i&&actual[i].x-actual[i-1].x>7.5*60000)chartActual.push({x:actual[i-1].x+5*60000,y:null,band:null,zone:null});chartActual.push(actual[i]);}

  const wa = D.weekday_avg || {};
  const byWeekday = wa.by_weekday || {};
  const trend = [];
  const startDate = new Date(actualStart); startDate.setHours(0,0,0,0);
  const endDate = new Date(actualEnd); endDate.setHours(0,0,0,0);
  for(let dayMs=startDate.getTime(); dayMs<=endDate.getTime(); dayMs+=DAY){
    const day=new Date(dayMs), weekday=String(day.getDay()===0?6:day.getDay()-1);
    const series=byWeekday[weekday] || (day.toDateString()===new Date(D.today+'T00:00:00').toDateString()?wa.current:null);
    for(let slot=0;slot<288;slot++){
      const x=dayMs+slot*5*60000, y=series?.[String(slot)];
      if(x>=actualStart-5*60000 && x<=actualEnd+5*60000){const value=y==null?null:Number(y),sigma=Number(wa.sigma_by_weekday?.[weekday]?.[String(slot)]);trend.push({x,y:value,band:value==null||!Number.isFinite(sigma)?null:[value-sigma,value+sigma]});}
    }
    if(dayMs<endDate.getTime()) trend.push({x:dayMs+DAY-1,y:null});
  }
  const xTicks = [];
  const axisTick = new Date(actualStart); axisTick.setHours(0,0,0,0);
  while(axisTick.getTime()<actualStart) axisTick.setHours(axisTick.getHours()+4);
  while(axisTick.getTime()<actualEnd){xTicks.push(axisTick.getTime());axisTick.setHours(axisTick.getHours()+3);}
  xTicks.push(actualEnd);

  const sleepBands = [];
  for (const sl of (D.sleep||[])) {
    const a = new Date(sl.start).getTime(), b = new Date(sl.end).getTime();
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    if (b >= actualStart && a <= actualEnd) sleepBands.push([Math.max(a,actualStart), Math.min(b,actualEnd)]);
  }

  const contextWindows = [];
  for (const sl of (D.sleep||[])) {
    const a=new Date(sl.start).getTime(), b=new Date(sl.end).getTime();
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<=actualStart||a>=actualEnd) continue;
    const nap=sl.main===false||!!sl.nap, dur=Math.max(0,Math.round((b-a)/60000)), durLabel=dur>=60?`${Math.floor(dur/60)}h${dur%60?' '+dur%60+'m':''}`:`${dur}m`;
    contextWindows.push({start:Math.max(a,actualStart),end:Math.min(b,actualEnd),label:`${nap?'Nap':'Sleep'} · ${fmtTime(a)}–${fmtTime(b)} · ${durLabel}`,color:nap?'#8B5CF6':'#6366F1',opacity:.04,boundary:true,boundaryColor:'#818CF8',boundaryOpacity:.25,topLabel:`🌙 Sleep Window: ${fmtTime(a)} – ${fmtTime(b)}`});
  }
  const sessions=[];
  for(const w of activeWorkouts()){const a=new Date(w.start).getTime(),b=new Date(w.end).getTime();if(!Number.isFinite(a)||!Number.isFinite(b)||b<=actualStart||a>=actualEnd)continue;const dup=sessions.findIndex(q=>{const overlap=Math.max(0,Math.min(b,q.b)-Math.max(a,q.a)),shorter=Math.min(b-a,q.b-q.a);return Math.abs(a-q.a)<=120000&&shorter>0&&overlap/shorter>=.85;});if(dup<0)sessions.push({w,a,b});else{const old=sessions[dup],quality=x=>(String(x.type||'').toUpperCase().match(/OTHER|WORKOUT|UNKNOWN|EXERCISE/)?0:10)+(Number(x.avg_hr)?2:0)+(Number(x.duration_s)?1:0)+(Number(x.kcal||x.calories_kcal)?1:0)+(Number(x.distance_m||x.distance)?1:0);if(quality(w)>=quality(old.w))sessions[dup]={w,a,b};}}
  for(const q of sessions){const {w,a,b}=q,nap=false,dur=Math.max(0,Math.round((b-a)/60000)),type=String(w.type||'Running').replace(/_/g,' '),label=`${type.toUpperCase()} · ${fmtTime(a)}–${fmtTime(b)} · ${dur}m`;contextWindows.push({start:Math.max(a,actualStart),end:Math.min(b,actualEnd),label,color:'#F97316',opacity:.05,topLabel:`${type.toUpperCase()} · ${fmtTime(a)}`});}

  const avg = mean(actual.map(p=>p.y));
  const zoneAge = Number(D.settings?.age) || null;
  const zoneCfg = D.zone_limits || {};
  const zoneRhr = Number(zoneCfg.rhr) || Number(lastVal('resting_hr')) || 60;
  // Use the same run-aware max-HR and 30-day resting-HR values as the server.
  const zoneMax = Number(zoneCfg.max_hr) || (zoneAge ? 208 - 0.7 * zoneAge : 190);
  const zoneReserve = Math.max(1, zoneMax - zoneRhr);
  const zoneEdges = Array.isArray(zoneCfg.edges)&&zoneCfg.edges.length===6
    ? zoneCfg.edges
    : [0.50,0.60,0.70,0.80,0.90,1.00].map(p=>zoneRhr+zoneReserve*p);
  const hrDomainValues=actual.map(p=>Number(p.y)).filter(Number.isFinite);
  const dataMin=Math.min(...hrDomainValues),dataMax=Math.max(...hrDomainValues);
  const chartYMin=dataMin<42?Math.floor((dataMin-5)/5)*5:40;
  const chartYMax=Math.max(155,Math.ceil((dataMax+10)/10)*10);
  const hrYTicks=[];
  for(let t=Math.ceil(chartYMin/20)*20;t<=chartYMax;t+=20)hrYTicks.push(t);
  if(chartYMax-hrYTicks.at(-1)>=10)hrYTicks.push(chartYMax);
  const zoneBands=[
    {y1:chartYMin,y2:zoneEdges[1],color:'#3B82F6',opacity:.09,dash:'4 4',label:'ZONE 1 · LIGHT',labelRight:true,labelSize:10,labelColor:'rgba(255,255,255,.35)'},
    {y1:zoneEdges[1],y2:zoneEdges[2],color:'#10B981',opacity:.12,dash:'4 4',label:'ZONE 2 · AEROBIC',labelRight:true,labelSize:10,labelColor:'rgba(255,255,255,.35)'},
    {y1:zoneEdges[2],y2:zoneEdges[3],color:'#F59E0B',opacity:.12,dash:'4 4',label:'ZONE 3 · TEMPO',labelRight:true,labelSize:10,labelColor:'rgba(255,255,255,.35)'},
    {y1:zoneEdges[3],y2:zoneEdges[4],color:'#FB7185',opacity:.08,dash:'4 4'},
    {y1:zoneEdges[4],y2:chartYMax,color:'#F43F5E',opacity:.06,dash:'4 4'}
  ];
  const gapBridges=[];for(let i=1;i<actual.length;i++){const a=actual[i-1],b=actual[i];if(b.x-a.x>7.5*60000)gapBridges.push({a:a.x,b:b.x,ya:a.y,yb:b.y});}
  const zoneThresholds=zoneEdges.slice(1,5).map(y=>({y,color:'#94A3B8',label:null,dash:'4 5'}));
  const minPt=actual.reduce((a,p)=>p.y<a.y?p:a),maxPt=actual.reduce((a,p)=>p.y>a.y?p:a);
  drawChart(host, {
     kind:'line',pts:chartActual,color:'#E2E8F0',lineWidth:2.2,avgPillGlass:true,zoneGradientStops:karvonenStops(zoneEdges,chartYMin,chartYMax),bandColor:'#94A3B8',bandOpacity:0,trendBand:!!window._hr24ShowTypical,trendBandColor:'rgba(148,163,184,1)',trendBandOpacity:.15,trendLine:!!window._hr24ShowTypical,zoneColored:false,lineGlowFilter:'drop-shadow(0 0 4px rgba(103,232,249,.42))',thresholds:zoneThresholds.filter(t=>t.y>chartYMin&&t.y<chartYMax).map(t=>({...t,label:null})),referenceLineOpacity:.15,trendSmooth:true,avg,avgPill:true,avgPillInside:true,avgPillSide:'right',avgPillText:`avg ${avg==null?'':avg.toFixed(1)} bpm`,avgColor:'#2DD4BF',gapBridges,
     extrema:[{...minPt,type:'min',label:`MIN ${Number(minPt.y).toFixed(0)}`,above:minPt.y<chartYMin+8},{...maxPt,type:'max',label:`MAX ${Number(maxPt.y).toFixed(0)}`,above:maxPt.y<=chartYMax-8}],
    fmtAvg: avg==null?'':avg.toFixed(1)+' bpm',
    trendPts:trend.map(p=>({...p})),trendColor:'rgba(148,163,184,.48)',trendSmooth:true,
    sleepBands,contextWindows,hideContextLabels:false,bands:zoneBands,
    xTicks,xMin:actualStart,xMax:actualEnd,fixedClockTicks:true,xTickLabel:t=>{if(t>=actualEnd-1000)return '12 AM';const d=new Date(t),h=d.getHours();return `${h%12||12} ${h<12?'AM':'PM'}`;},axisLabelsInside:true,yTickValues:hrYTicks,
    fmtX:fmtTime,fmtY:v=>Math.round(v),label:'Heart rate from midnight to midnight; future hours remain blank',h:420,padTop:44,padBottom:38,yMin:chartYMin,yMax:chartYMax,areaGradient:false,areaGapMs:7.5*60000,
    scatter: false,
    tip: q => {
      const d = new Date(q.x);
      const slot = d.getHours()*12 + Math.floor(d.getMinutes()/5);
      const dow = String((d.getDay()+6)%7);
      const exp = window._hr24ShowTypical ? (wa.by_weekday?.[dow] || wa.current)?.[String(slot)] : null;
      const z = ZONE_DEFS[q.zone-1] || null;
      const expectedRow = exp==null ? '' : tipRow('Typical '+d.toLocaleDateString([], {weekday:'long'}), Number(exp).toFixed(1)+' bpm', 'var(--trend)');
      const diffRow = exp==null ? '' : tipRow('Difference', (q.y-exp>=0?'+':'')+(q.y-exp).toFixed(1)+' bpm');
      const zoneRow = z ? tipRow('Zone', z.label+' · '+z.name, z.color) : '';
      const sessions=[...(D.sleep||[]).filter(sl=>q.x>=new Date(sl.start).getTime()&&q.x<=new Date(sl.end).getTime()).map(sl=>({kind:sl.main===false||sl.nap?'Nap':'Sleep',start:new Date(sl.start).getTime(),end:new Date(sl.end).getTime(),duration:Math.max(0,(new Date(sl.end)-new Date(sl.start))/60000),details:`${sl.asleep!=null?'Asleep '+formatDuration(Number(sl.asleep)*60):''}${sl.deep!=null?' · Deep '+formatDuration(Number(sl.deep)*60):''}${sl.rem!=null?' · REM '+formatDuration(Number(sl.rem)*60):''}` })),...activeWorkouts().filter(w=>q.x>=new Date(w.start).getTime()&&q.x<=new Date(w.end).getTime()).map(w=>({kind:String(w.type||'Workout').replace(/_/g,' '),start:new Date(w.start).getTime(),end:new Date(w.end).getTime(),duration:Math.max(0,(new Date(w.end)-new Date(w.start))/60000),details:`${(()=>{let raw={};try{raw=JSON.parse(w.raw||'{}')}catch(_){}const m=Number(w.distance_m)>0?Number(w.distance_m):Number(raw.metricsSummary?.distanceMillimeters)/1000;return m>0?'Distance '+(m/1000).toFixed(2)+' km · ':''})()}${w.calories_kcal?'Calories '+Math.round(w.calories_kcal):''}` }))];
      const sessionRows=sessions.map(v=>tipRow('Session',`${v.kind} · ${fmtTime(v.start)}–${fmtTime(v.end)} · ${formatDuration(v.duration*60)}${v.details?' · '+v.details:''}`)).join('');
      return `<b>${fmtDayLong(q.x)}, ${fmtTime(q.x)}</b>${sessionRows}
              ${tipRow('Actual', q.y.toFixed(1)+' bpm', z?z.color:'var(--hr)')}
              ${q.band?tipRow('5-min spread', Math.round(q.band[0])+'–'+Math.round(q.band[1])+' bpm','var(--hr)'):''}
              ${zoneRow}${expectedRow}${diffRow}`;
    },
    cols: ['Time','Mean bpm','Min','Max','Zone'],
    rows: hr.slice().reverse().map(r=>{
      const z = ZONE_DEFS[zoneOf(r[1])-1];
      return [fmtDay(r[0])+' '+fmtTime(r[0]), r[1], r[2], r[3], z?z.label:'–'];
    })
  });

  const workouts=activeWorkouts().map(w=>[new Date(w.start).getTime(),new Date(w.end).getTime()+15*60000]).filter(w=>Number.isFinite(w[0])&&Number.isFinite(w[1]));
  const matchStart=new Date(actualEnd);matchStart.setHours(0,0,0,0);
  const bins=new Map();
  for(const p of actual){if(p.x<matchStart.getTime())continue;const d=new Date(p.x),slot=d.getHours()*12+Math.floor(d.getMinutes()/5),id=slot;const arr=bins.get(id)||[];arr.push(p);bins.set(id,arr);}
  const medianValues=values=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);return v.length%2?v[v.length>>1]:(v[v.length/2-1]+v[v.length/2])/2;};
  const paired=[];
  for(const arr of bins.values()){
    const p=arr[Math.floor(arr.length/2)],d=new Date(p.x);
    if(workouts.some(([a,b])=>p.x>=a&&p.x<=b))continue;
    const slot=d.getHours()*12+Math.floor(d.getMinutes()/5),dow=String((d.getDay()+6)%7);
    const daySeries=wa.by_weekday?.[dow]||(d.toDateString()===new Date(D.today+'T00:00:00').toDateString()?wa.current:null);
    const rawExpected=daySeries?.[String(slot)];
    // Null historical bins must be skipped; Number(null) incorrectly turns them into 0 bpm.
    if(rawExpected==null||rawExpected==='')continue;
    const exp=Number(rawExpected),sigmaRaw=wa.sigma_by_weekday?.[dow]?.[String(slot)],sigma=Number(sigmaRaw)||3;
    if(Number.isFinite(exp))paired.push({x:p.x,a:mean(arr.map(q=>q.y)),b:exp,sigma});
  }
  let foot='';
  if(paired.length>=12){
    const offset=medianValues(paired.map(p=>p.a-p.b));
    const maez=mean(paired.map(p=>Math.abs(p.a-p.b)/p.sigma));
    const match=100*Math.exp(-0.5*maez*maez);
    const inBand=100*paired.filter(p=>Math.abs((p.a-p.b)/p.sigma)<=1).length/paired.length;
    let flagged=0,run=0,runStart=null,runEnd=null,flags=[];
    for(const p of paired){
      const isOutlier=Math.abs((p.a-p.b-offset)/p.sigma)>=2;
      if(isOutlier&&(!run||p.x-runEnd<=10*60000)){if(!run)runStart=p.x;run++;runEnd=p.x;}
      else{if(run>=3)flags.push({start:runStart,end:runEnd});run=isOutlier?1:0;runStart=isOutlier?p.x:null;runEnd=isOutlier?p.x:null;}
    }
    if(run>=3)flags.push({start:runStart,end:runEnd});flagged=flags.length;
    const neff=medianValues(paired.map(p=>Number(wa.neff_by_weekday?.[String((new Date(p.x).getDay()+6)%7)]?.[String(new Date(p.x).getHours()*12+Math.floor(new Date(p.x).getMinutes()/5))]||0)));
    const confidence=neff<3?'Low':neff<=6?'Medium':'High';
    const coverage=Math.round(100*paired.length/Math.max(1,Math.ceil((actualEnd-matchStart.getTime())/(5*60000))));
    const binNote=`${paired.length} matched bins`;
    const matchTitle='Pattern similarity across all matched bins vs. your historical weekday baseline';
    const deviationDetails=flags.map((f,i)=>{const eventBins=paired.filter(p=>p.x>=f.start&&p.x<=f.end),peak=eventBins.reduce((a,b)=>Math.abs(b.a-b.b-offset)>Math.abs(a.a-a.b-offset)?b:a,eventBins[0]||{a:0,b:0}),activity=sessions.find(q=>q.a<=f.end&&q.b>=f.start);return `<li><b>${i===0?'Deviation':''} ${fmtTime(f.start)}–${fmtTime(f.end)}</b><span>${peak.a-peak.b>=0?'+':''}${(peak.a-peak.b).toFixed(0)} bpm vs baseline${activity?' · '+esc(String(activity.w.type||'Workout').replace(/_/g,' ')):''}</span></li>`;}).join('');
    foot=`<div class="hr24-kpis"><div class="hr24-kpi hr24-kpi-match" tabindex="0" title="${matchTitle}" aria-label="Typical match ${match.toFixed(1)}%. ${matchTitle}"><span class="hr24-kpi-label">Typical Match</span><span class="hr24-ring" style="--match:${match.toFixed(1)}%"><b>${match.toFixed(1)}%</b></span><span class="hr24-kpi-note">${binNote}</span></div><div class="hr24-kpi"><span class="hr24-kpi-label">Within Typical Band</span><strong>${inBand.toFixed(0)}%</strong><span class="hr24-kpi-note">±1 historical spread</span></div><div class="hr24-kpi"><span class="hr24-kpi-label">Baseline Level Offset</span><strong>${offset>=0?'+':''}${offset.toFixed(1)} bpm</strong><span class="hr24-kpi-note">${coverage}% coverage · ${confidence} confidence</span></div>${flagged?`<div class="hr24-alert"><div class="hr24-alert-head"><span>Elevated deviations</span><strong>⚠ ${flagged} · ${flags.reduce((a,f)=>a+Math.round((f.end-f.start)/60000+5),0)} min total</strong></div><ul class="hr24-event-list">${deviationDetails}</ul></div>`:''}</div>`;
  }else foot=`<div class="sub">Not enough overlapping data yet (need at least 12 valid 5-minute bins / 1 hour since local midnight). Matching resets at midnight; missing readings are not treated as zero.</div>`;
  const mainSleeps=(D.sleep||[]).filter(s=>s.main).sort((a,b)=>a.start.localeCompare(b.start)),lastSleep=mainSleeps[mainSleeps.length-1],avgInterruptions=mean(mainSleeps.slice(-7).map(s=>s.interruptions).filter(Number.isFinite)),interruptions=lastSleep?.interruptions;
  foot+=`<div class="hr24-kpis hr24-sleep-kpis"><div class="hr24-kpi"><span class="hr24-kpi-label">Total Interruptions · Last Night</span><strong>${interruptions==null?'—':Math.round(interruptions)}</strong><span class="hr24-kpi-note">${avgInterruptions==null?'':'7-night average '+avgInterruptions.toFixed(1)}</span></div></div>`;
  $('#hr24foot').innerHTML=foot;
}

function drawRespRate(){
  const host = $('#card-resprate .plot'); if(!host) return;
  const pts = dailyPts('resp_rate').filter(q=>q.y!=null);
  if(!pts.length){ host.innerHTML='<div class="empty">No respiratory-rate readings yet.</div>'; return; }
  const avg = mean(pts.map(q=>q.y));
  drawChart(host, {
    kind:'line', pts, color:'var(--resp)', avg,
    fmtAvg: avg==null?'':avg.toFixed(1)+'/min',
    fmtX: fmtDay, fmtY: v=>v.toFixed(1),
    label: 'Respiratory rate · 14 days', h: 220, scatter:true,
    tip: q => `<b>${fmtDayLong(q.x)}</b>${tipRow('Breaths/min', q.y.toFixed(1), 'var(--resp)')}${tipRow('Period mean', avg.toFixed(1))}`,
    cols:['Day','Breaths/min'],
    rows: pts.slice().reverse().map(q=>[q.day, q.y.toFixed(1)])
  });
  $('#card-resprate .foot').innerHTML = avg==null?'':`<div class="sub">Period mean: ${avg.toFixed(1)} breaths/min. Persistent deviations above your baseline are worth attention in context.</div>`;
}
