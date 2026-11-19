/* ============================================================
   WORKOUT CHARTS (new sub-tab)
   ============================================================ */
const WORKOUT_TYPE_COLORS = { RUNNING:'var(--spo2)', TRAIL_RUN:'var(--temp-high)', WALKING:'var(--steps)', CARDIO:'var(--distance)' };
function workoutColor(type){
  const t=String(type||'').toUpperCase();
  if(t.includes('CYCL'))return '#A78BFA';if(t.includes('SWIM'))return '#22D3EE';if(t.includes('STRENGTH'))return '#F472B6';if(t.includes('YOGA'))return '#C084FC';if(t.includes('HIIT'))return '#FB7185';if(t.includes('HIKE'))return '#84CC16';
  if(t.includes('STRENGTH'))return '#A78BFA';if(t.includes('AQUATIC'))return '#22D3EE';if(t.includes('RACKET'))return '#F59E0B';if(t.includes('TEAM &'))return '#FB7185';if(t.includes('WINTER'))return '#14B8A6';if(t.includes('MIND-BODY'))return '#C084FC';if(t.includes('MARTIAL'))return '#F97316';if(t.includes('OUTDOOR'))return '#84CC16';if(t.includes('CARDIO &'))return '#38BDF8';
  if(t.includes('TRAIL'))return WORKOUT_TYPE_COLORS.TRAIL_RUN;
  if(t.includes('RUN'))return WORKOUT_TYPE_COLORS.RUNNING;
  if(t.includes('WALK'))return WORKOUT_TYPE_COLORS.WALKING;
  return WORKOUT_TYPE_COLORS.CARDIO;
}

function buildTrainingLoad(){
  const workouts=activeWorkouts().filter(w=>w.day&&Number(w.duration_s)>0&&Number(w.avg_hr)>0);
  const rhrRows=(D.daily?.resting_hr||[]).filter(r=>r&&r[0]&&Number(r[1])>0).map(r=>({day:String(r[0]),v:Number(r[1])})).sort((a,b)=>a.day.localeCompare(b.day));
  if(!workouts.length)return {html:'<div class="empty">Training load needs recorded workouts with both duration and average heart rate. Sync more workouts or check whether Google Health supplied those fields.</div>'};
  const age=Number(D.settings?.age)||null, sex=String(D.settings?.sex||'m').toLowerCase();
  const maxHR=Number(D.zone_limits?.max_hr)||(age&&age>0?208-.7*age:190);
  const rhrVals=rhrRows.map(r=>r.v).sort((a,b)=>a-b);
  const medianRhr=rhrVals.length?(rhrVals.length%2?rhrVals[(rhrVals.length-1)/2]:(rhrVals[rhrVals.length/2-1]+rhrVals[rhrVals.length/2])/2):null;
  const rhrFor=day=>{let found=null;for(const r of rhrRows){if(r.day<=day)found=r;else break;}if(found&&dayMs(day)-dayMs(found.day)<=7*DAY)return found.v;return medianRhr;};
  const dailyLoad={};let included=0,missingRhr=0;
  for(const w of workouts){
    const dur=Number(w.duration_s)/60,hr=Number(w.avg_hr),rhr=rhrFor(String(w.day));
    if(!(dur>0&&hr>0&&rhr!=null&&maxHR>rhr)) {missingRhr++;continue;}
    const hrr=Math.max(0,Math.min(1,(hr-rhr)/(maxHR-rhr)));
    // Banister-style HRR TRIMP; coefficients differ by sex in the commonly used formulation.
    const female=sex==='f'||sex==='female'; const k=female?1.67:1.92, a=female?0.86:0.64;
    const trimp=dur*hrr*a*Math.exp(k*hrr);
    if(Number.isFinite(trimp)){dailyLoad[w.day]=(dailyLoad[w.day]||0)+trimp;included++;}
  }
  if(!included)return {html:'<div class="empty">Training load could not be estimated because usable resting-heart-rate values are unavailable. Sync resting HR data and try again.</div>'};
  const today=String(D.today||new Date().toISOString().slice(0,10));
  const visibleStart=period==='all'?(workouts.map(w=>String(w.day)).concat(rhrRows.map(r=>r.day)).filter(Boolean).sort()[0]||today):localDateKey(periodStart(period));
  const warmStart=dayMs(visibleStart)-90*DAY;
  let start=workouts.reduce((m,w)=>Math.min(m,dayMs(w.day)),warmStart);
  start=Math.min(start,warmStart);
  const first=new Date(start);first.setHours(0,0,0,0);
  let d=new Date(first),atl=0,ctl=0,series=[];
  while(localDateKey(d.getTime())<=today){
    const key=localDateKey(d.getTime());
    const load=dailyLoad[key]||0;
    atl+= (load-atl)*(1-Math.exp(-1/7));
    ctl+= (load-ctl)*(1-Math.exp(-1/28));
    if(key>=visibleStart)series.push({day:key,load,atl,ctl,tsb:ctl-atl});
    d.setDate(d.getDate()+1);
  }
  if(!series.length)return {html:'<div class="empty">No training-load dates fall inside the selected period.</div>'};
  const W=Math.max(320,Math.floor(document.querySelector('#card-trainingLoad .plot')?.clientWidth||760)),H=300,L=48,R=18,T=18,B=42;
  const vals=series.flatMap(q=>[q.atl,q.ctl,q.tsb]),lo=Math.min(0,...vals),hi=Math.max(1,...vals),pad=(hi-lo)*.08||1,ymin=lo-pad,ymax=hi+pad;
  const X=i=>L+(series.length<=1?0:i/(series.length-1))*(W-L-R),Y=v=>T+(ymax-v)/(ymax-ymin)*(H-T-B);
  const line=(key,color)=>`<polyline points="${series.map((q,i)=>`${X(i)},${Y(q[key])}`).join(' ')}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`;
  let svg=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Training load chart showing acute load, chronic load, and training stress balance" style="display:block;max-width:100%;height:auto">`;
  for(let i=0;i<=4;i++){const v=ymin+(ymax-ymin)*i/4;svg+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)" stroke-dasharray="3 5"/><text x="${L-8}" y="${Y(v)+4}" fill="var(--axis-text)" font-size="10" text-anchor="end">${v.toFixed(0)}</text>`;}
  if(ymin<0&&ymax>0)svg+=`<line x1="${L}" x2="${W-R}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--axis-text)" stroke-opacity=".55"/>`;
  svg+=line('atl','var(--neutral)')+line('ctl','var(--hrv)')+line('tsb','var(--vo2)');
  const stride=Math.max(1,Math.ceil(series.length/8));
  series.forEach((q,i)=>{if(i%stride===0||i===series.length-1)svg+=`<text x="${X(i)}" y="${H-12}" fill="var(--axis-text)" font-size="10" text-anchor="middle">${q.day.slice(5)}</text>`;svg+=`<circle cx="${X(i)}" cy="${Y(q.atl)}" r="2.3" fill="var(--neutral)"><title>${q.day} · ATL ${q.atl.toFixed(1)} · CTL ${q.ctl.toFixed(1)} · TSB ${q.tsb.toFixed(1)} · daily TRIMP ${q.load.toFixed(1)}</title></circle>`;});
  svg+='</svg>';
  const last=series[series.length-1],sumLoad=series.reduce((a,q)=>a+q.load,0),activeDays=series.filter(q=>q.load>0).length;
  const fmt=v=>Number(v).toFixed(1);
  return {html:`<div class="spo2-insights" style="margin:4px 0 12px"><div class="spo2-insight"><div class="k">Acute load · ATL</div><div class="v">${fmt(last.atl)}</div><div class="s">7-day exponential average</div></div><div class="spo2-insight"><div class="k">Chronic load · CTL</div><div class="v">${fmt(last.ctl)}</div><div class="s">28-day exponential average</div></div><div class="spo2-insight"><div class="k">Form · TSB</div><div class="v">${fmt(last.tsb)}</div><div class="s">CTL − ATL</div></div></div><div class="tablewrap" style="padding:4px">${svg}</div><div class="legend" style="margin-top:8px"><span><i style="background:var(--neutral)"></i>ATL · fatigue</span><span><i style="background:var(--hrv)"></i>CTL · fitness</span><span><i style="background:var(--vo2)"></i>TSB · form</span></div><div class="sub" style="margin-top:8px">HRR-based TRIMP estimated from workout duration, average HR, resting HR and estimated maximum HR (${Math.round(maxHR)} bpm). ${included} workout records contributed; ${missingRhr} were excluded for missing usable HR context. Maximum HR uses the rolling average of run averages that reach the peak zone; the age formula is used only when no qualifying runs exist. ${activeDays} days had recorded load in this period. These are training estimates, not medical measures.</div>`,cols:['Date','Daily TRIMP','ATL (7d)','CTL (28d)','TSB'],rows:series.map(q=>[q.day,fmt(q.load),fmt(q.atl),fmt(q.ctl),fmt(q.tsb)])};
}

function buildWorkoutLoad(){
  const workouts = activeWorkouts();
  if(!workouts.length) return {html:'<div class="empty">No workouts recorded.</div>'};
  const byDayType = {};
  for(const w of workouts){
    const kcal = Number(w.kcal)||0;
    const dur = (Number(w.duration_s)||0)/60;
    if(!(kcal>0 || dur>0)) continue;
    const d = w.day;
    const t = workoutKind(w);
    byDayType[d] = byDayType[d] || {};
    byDayType[d][t] = (byDayType[d][t] || 0) + (kcal>0 ? kcal : dur);
  }
  const days = Object.keys(byDayType).sort().filter(d=>dayMs(d)>=periodStart(period));
  if(!days.length) return {html:'<div class="empty">No workouts in this period.</div>'};
  const types = [...new Set(Object.values(byDayType).flatMap(o=>Object.keys(o)))];
  const W=Math.floor(document.querySelector("#card-workoutLoad .plot")?.clientWidth||640); const H=340,L=56,R=24,T=22,B=54;
  const allVals = days.map(d=>Object.values(byDayType[d]).reduce((a,b)=>a+b,0));
  const ymax = Math.max(...allVals) * 1.1;
  const slot = (W-L-R)/days.length;
  const bw = Math.max(4, slot*0.74);
  const X=i=>L+(i+0.5)*slot;
  const Y=v=>T+(ymax-v)/(ymax||1)*(H-T-B);
  let svg=`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" style="display:block;max-width:100%;height:auto">`;
  for(let i=0;i<=4;i++){const v=ymax*i/4;svg+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--grid)" stroke-dasharray="3 5"/><text x="${L-9}" y="${Y(v)+4}" fill="var(--axis-text)" font-size="11" text-anchor="end">${fmtN(v)}</text>`;}
  days.forEach((d,i)=>{
    let acc = 0;
    for(const t of types){
      const v = byDayType[d][t] || 0;
      if(!v) continue;
      const y0=Y(acc), y1=Y(acc+v);
      svg+=`<rect x="${X(i)-bw/2}" y="${y1}" width="${bw}" height="${Math.max(1,y0-y1)}" fill="${workoutColor(t)}" tabindex="0"><title>${d} · ${t}\n${fmtN(v)} kcal</title></rect>`;
      acc += v;
    }
    if (i % Math.ceil(days.length/10) === 0 || i === days.length-1) {
      svg+=`<text x="${X(i)}" y="${H-12}" fill="var(--axis-text)" font-size="11" text-anchor="middle">${fmtDay(dayMs(d))}</text>`;
    }
  });
  svg+=`<text transform="translate(18 ${(T+H-B)/2}) rotate(-90)" fill="var(--axis-text)" font-size="12" text-anchor="middle">Calories burned</text></svg>`;
  return {html:`<div class="tablewrap" style="padding:8px">${svg}</div>
    <div class="legend" style="margin-top:8px">${types.map(t=>`<span><i style="background:${workoutColor(t)}"></i>${t.replace(/_/g,' ').toLowerCase()}</span>`).join('')}</div>
    <div class="sub" style="margin-top:8px">Stack height = total calories for the day. See the effect of multiple workouts on the same day.</div>`};
}

function buildWorkoutVo2Trend(){
  const workouts = activeWorkouts();
  const vo2Days = (D.daily.vo2max||[]).filter(r=>dayMs(r[0])>=periodStart(period));
  const durByDay = {};
  for(const w of workouts){
    if (dayMs(w.day) < periodStart(period)) continue;
    durByDay[w.day] = (durByDay[w.day]||0) + (Number(w.duration_s)||0)/60;
  }
  const durPts = Object.entries(durByDay).sort((a,b)=>a[0].localeCompare(b[0]));
  if(!durPts.length && !vo2Days.length) return {html:'<div class="empty">No workout or VO₂ max data.</div>'};
  const W=Math.floor(document.querySelector("#card-workoutVo2 .plot")?.clientWidth||0); if(!W)return {html:"<div class=\"skeleton\"></div>"}; const H=160, L=56, R=54, T=20, B=30;
  const allDays = [...new Set([...durPts.map(d=>d[0]), ...vo2Days.map(r=>r[0])])].sort();
  if(!allDays.length) return {html:'<div class="empty">No data.</div>'};
  const x0 = dayMs(allDays[0]), x1 = dayMs(allDays[allDays.length-1]);
  const X = x => L + (x - x0) / Math.max(1, x1 - x0) * (W - L - R);
  const maxDur = Math.max(60, ...durPts.map(d=>d[1]));
  const Yd = v => T + (maxDur - v) / maxDur * (H - T - B);
  const vo2Vals = vo2Days.map(r=>r[1]);
  const vmin = vo2Vals.length ? Math.min(...vo2Vals) : 35;
  const vmax = vo2Vals.length ? Math.max(...vo2Vals) : 45;
  const Yv = v => T + (vmax - v) / Math.max(0.01, vmax - vmin) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H*2+30}" width="${W}" height="${H*2+30}" role="img" style="display:block;max-width:100%;height:auto">`;
  svg += `<g transform="translate(0,0)">`;
  for(let i=0;i<=4;i++){const v=maxDur*i/4;svg+=`<line x1="${L}" x2="${W-R}" y1="${Yd(v)}" y2="${Yd(v)}" stroke="var(--grid)" stroke-dasharray="3 5"/><text x="${L-9}" y="${Yd(v)+4}" fill="var(--axis-text)" font-size="11" text-anchor="end">${Math.round(v)}m</text>`;}
  const bw = Math.max(3, (W-L-R)/Math.max(1, allDays.length) * 0.65);
  durPts.forEach(([d,mins])=>{
    const x = X(dayMs(d));
    svg+=`<rect x="${x-bw/2}" y="${Yd(mins)}" width="${bw}" height="${Math.max(1,Yd(0)-Yd(mins))}" fill="var(--active)" fill-opacity=".55" tabindex="0"><title>${d}: ${Math.round(mins)} min exercise</title></rect>`;
  });
  svg += `<text x="${L-9}" y="${T-6}" fill="var(--active)" font-size="11">Exercise duration</text></g>`;
  svg += `<g transform="translate(0,${H+10})">`;
  for(let i=0;i<=3;i++){const v=vmin+(vmax-vmin)*i/3;svg+=`<line x1="${L}" x2="${W-R}" y1="${Yv(v)}" y2="${Yv(v)}" stroke="var(--grid)" stroke-dasharray="3 5"/><text x="${L-9}" y="${Yv(v)+4}" fill="var(--axis-text)" font-size="11" text-anchor="end">${v.toFixed(1)}</text>`;}
  if(vo2Days.length > 1){
    let d='';vo2Days.forEach((r,i)=>{const x=X(dayMs(r[0])),y=Yv(r[1]);d+=`${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;});
    svg+=`<path d="${d}" fill="none" stroke="var(--vo2)" stroke-width="2"/>`;
    vo2Days.forEach(r=>{svg+=`<circle cx="${X(dayMs(r[0]))}" cy="${Yv(r[1])}" r="2.5" fill="var(--vo2)" tabindex="0"><title>${r[0]}: VO₂ max ${r[1].toFixed(1)}</title></circle>`;});
  }
  svg += `<text x="${L-9}" y="${T-6}" fill="var(--vo2)" font-size="11">VO₂ max</text>`;
  allDays.forEach((d,i)=>{ if(i % Math.ceil(allDays.length/8) === 0 || i === allDays.length-1) svg+=`<text x="${X(dayMs(d))}" y="${H-B+12}" fill="var(--axis-text)" font-size="11" text-anchor="middle">${fmtDay(dayMs(d))}</text>`;});
  svg += `</g></svg>`;
  return {html:`<div class="tablewrap" style="padding:8px">${svg}</div>
    <div class="sub" style="margin-top:8px">Top: exercise duration per day. Bottom: daily VO₂ max (from Google Health). Watch whether rising training volume coincides with improving VO₂ max over weeks.</div>`};
}

function buildWorkoutTimeline(){
  const workouts = workoutData().filter(w=>w.start).sort((a,b)=>a.start.localeCompare(b.start));
  if(!workouts.length) return {html:'<div class="empty">No workouts recorded.</div>'};
  const byDay = {};
  for(const w of workouts){
    if(dayMs(w.day) < periodStart(period)) continue;
    byDay[w.day] = byDay[w.day] || [];
    byDay[w.day].push(w);
  }
  const days = Object.keys(byDay).sort().reverse().slice(0,30);
  if(!days.length) return {html:'<div class="empty">No workouts in this period.</div>'};
  const W=Math.floor(document.querySelector("#card-workoutTimeline .plot")?.clientWidth||0); if(!W)return {html:"<div class=\"skeleton\"></div>"}; const rowH=18, T=24, B=8, L=100, R=20;
  const H = T + rowH * days.length + B;
  const X = hr => L + (hr/24) * (W - L - R);
  let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" style="display:block;max-width:100%;height:auto">`;
  for(let h=0;h<=24;h+=3){
    const x = X(h);
    svg+=`<line x1="${x}" x2="${x}" y1="${T-6}" y2="${H-B}" stroke="var(--grid)" stroke-dasharray="3 5"/>`;
    svg+=`<text x="${x}" y="${T-10}" fill="var(--axis-text)" font-size="11" text-anchor="middle">${h}:00</text>`;
  }
  days.forEach((d, i)=>{
    const y = T + i * rowH;
    svg+=`<text x="${L-6}" y="${y+rowH-4}" fill="var(--ink2)" font-size="11" text-anchor="end">${fmtDay(dayMs(d))}</text>`;
    for(const w of byDay[d]){
      const s = new Date(w.start).getTime(), e = new Date(w.end||w.start).getTime();
      if(!Number.isFinite(s) || !Number.isFinite(e) || e<=s) continue;
      const sd = new Date(s), ed = new Date(e);
      const startHr = sd.getHours() + sd.getMinutes()/60;
      const endHr = ed.getDate() === sd.getDate() ? ed.getHours() + ed.getMinutes()/60 : 24;
      const xa = X(startHr), xb = X(Math.max(startHr+0.1, endHr));
      svg+=`<rect x="${xa}" y="${y+3}" width="${Math.max(2, xb-xa)}" height="${rowH-6}" rx="3" fill="${workoutColor(w.type)}" fill-opacity=".75" tabindex="0"><title>${w.type}\n${fmtTime(s)} – ${fmtTime(e)}</title></rect>`;
    }
  });
  svg += `</svg>`;
  const types = [...new Set(workouts.map(w=>String(w.type||'OTHER').toUpperCase()))];
  return {html:`<div class="tablewrap" style="padding:8px">${svg}</div>
    <div class="legend" style="margin-top:8px">${types.map(t=>`<span><i style="background:${workoutColor(t)}"></i>${t.replace(/_/g,' ').toLowerCase()}</span>`).join('')}</div>
    <div class="sub" style="margin-top:8px">Horizontal strip = time of day; each row is a date with a workout. See your typical workout window and its consistency.</div>`};
}

