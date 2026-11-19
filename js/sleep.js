/* ============================================================
   SLEEP CARDS
   ============================================================ */
function sleepStageDateControls(){const sleepRows=D?.sleep||[],dates=sleepRows.map(s=>s.day).filter(Boolean).sort();if(!dates.length)return '<div class="sleep-stage-header-controls"><label>From <input id="sleepStageFrom" type="date"></label><label>To <input id="sleepStageTo" type="date"></label></div>';const first=dates[0],today=D?.today||localDateKey(Date.now()),r=window._sleepStageRange||{from:first,to:today};return `<div class="sleep-stage-header-controls"><label>From <input id="sleepStageFrom" type="date" min="${first}" max="${today}" value="${r.from||first}"></label><label>To <input id="sleepStageTo" type="date" min="${first}" max="${today}" value="${r.to||today}"></label></div>`;}
function sleepStageAverageChart(){
  const sleepRows=D?.sleep||[],today=D?.today||localDateKey(Date.now()),keys=['rem','deep','light','awake'],labels={rem:'REM',deep:'Deep',light:'Light',awake:'Awake'},colors={rem:'#06B6D4',deep:'#6366F1',light:'#3B82F6',awake:'#F59E0B'},byDay=new Map();
  for(const s of sleepRows){if(!s.day||s.day>today)continue;const row=byDay.get(s.day)||{day:s.day,rem:0,deep:0,light:0,awake:0};keys.forEach(k=>row[k]+=Math.max(0,Number(s[k])||0));byDay.set(s.day,row);}
 const days=[...byDay.values()].map(x=>({...x,total:keys.reduce((n,k)=>n+x[k],0)})).filter(x=>x.total>0);if(!days.length)return '<div class="sleep-stage-empty">Stage breakdown will appear when sleep-stage data is available.</div>';
 const firstDay=days[0].day;let range=window._sleepStageRange||{from:firstDay,to:today};range.from=range.from||firstDay;range.to=range.to||today;if(range.from<firstDay)range.from=firstDay;if(range.to>today)range.to=today;window._sleepStageRange=range;
 const allAvg={};keys.forEach(k=>allAvg[k]=mean(days.map(d=>100*d[k]/d.total)));const periodDays=days.filter(d=>d.day>=range.from&&d.day<=range.to);if(!periodDays.length)return '<div class="sleep-stage-empty">No staged sleep in this date range.</div>';
 const periodAvg={};keys.forEach(k=>periodAvg[k]=mean(periodDays.map(d=>100*d[k]/d.total)));
   const cx=310,cy=205,radius=164,inner=91;let angle=-Math.PI/2;const slices=keys.map(k=>{const pct=periodAvg[k],next=angle+Math.PI*2*pct/100,x1=cx+radius*Math.cos(angle),y1=cy+radius*Math.sin(angle),x2=cx+radius*Math.cos(next),y2=cy+radius*Math.sin(next),ix2=cx+inner*Math.cos(next),iy2=cy+inner*Math.sin(next),ix1=cx+inner*Math.cos(angle),iy1=cy+inner*Math.sin(angle),large=pct>50?1:0,d=`M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${radius} ${radius} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${ix2.toFixed(2)} ${iy2.toFixed(2)} A ${inner} ${inner} 0 ${large} 0 ${ix1.toFixed(2)} ${iy1.toFixed(2)} Z`,mid=angle+(next-angle)/2,labelR=pct<10?radius+23:(radius+inner)/2,lx=cx+labelR*Math.cos(mid),ly=cy+labelR*Math.sin(mid),delta=periodAvg[k]-allAvg[k],aria=`${labels[k]}: selected period ${pct.toFixed(1)} percent; overall average ${allAvg[k].toFixed(1)} percent; difference ${delta>0?'+':''}${delta.toFixed(1)} percentage points`;angle=next;return `<path class="sleep-stage-slice" d="${d}" fill="${colors[k]}" style="color:${colors[k]}" tabindex="0" role="img" aria-label="${aria}" data-stage="${labels[k]}" data-period="${pct.toFixed(1)}%" data-overall="${allAvg[k].toFixed(1)}%" data-delta="${delta>0?'+':''}${delta.toFixed(1)} pp" onpointerenter="window.showSleepStageTip(event,this)" onpointerleave="window.hideSleepStageTip(this)" onfocus="window.showSleepStageTip(event,this)" onblur="window.hideSleepStageTip(this)"></path><text class="sleep-stage-pct${pct<10?' outside':''}" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="${pct<10?colors[k]:'#FAFAFA'}" font-size="${pct<10?13:16}" font-weight="750">${pct.toFixed(1)}%</text>`;}).join('');
 const aria=`Average sleep-stage percentages from ${range.from} to ${range.to}: ${keys.map(k=>`${labels[k]} ${periodAvg[k].toFixed(1)} percent`).join(', ')}`;
  const meanHours=mean(periodDays.map(d=>d.rem+d.deep+d.light))/60;const legend=keys.map(k=>`<span><i style="background:${colors[k]}"></i>${labels[k]} <b>${periodAvg[k].toFixed(1)}%</b></span>`).join('');
  return `<div class="sleep-stage-average"><div class="sleep-stage-chart-wrap"><svg class="sleep-stage-chart" viewBox="0 0 620 410" role="img" aria-label="${aria}"><circle cx="310" cy="205" r="90" fill="#111113" stroke="rgba(255,255,255,.08)" stroke-width="1"/>${slices.replace(/<text class="sleep-stage-pct[\s\S]*?<\/text>/g,'')}<text x="310" y="197" text-anchor="middle" fill="#71717A" font-size="10" letter-spacing="1.5">AVG SLEEP</text><text x="310" y="224" text-anchor="middle" fill="#FFFFFF" font-size="25" font-weight="750" font-variant-numeric="tabular-nums">${Math.floor(meanHours)}h ${Math.round((meanHours%1)*60)}m</text></svg><div class="sleep-stage-tip" role="tooltip"><b data-tip-stage></b><div>Selected period: <strong data-tip-period></strong></div><div>Overall average: <strong data-tip-overall></strong></div><div>Difference: <strong data-tip-delta></strong></div></div></div><div class="sleep-stage-legend">${legend}</div><div class="sleep-stage-foot">${days.length} recorded days · hover a stage to compare this period with your overall average.</div></div>`;
}
window.showSleepStageTip=function(event,slice){const card=slice?.closest('.sleep-stage-chart-wrap'),tip=card?.querySelector('.sleep-stage-tip');if(!card||!tip)return;tip.querySelector('[data-tip-stage]').textContent=slice.dataset.stage;tip.querySelector('[data-tip-period]').textContent=slice.dataset.period;tip.querySelector('[data-tip-overall]').textContent=slice.dataset.overall;tip.querySelector('[data-tip-delta]').textContent=slice.dataset.delta;const sr=slice.getBoundingClientRect(),pointer=event?.type?.startsWith('pointer'),px=pointer&&Number.isFinite(event.clientX)?event.clientX:sr.left+sr.width/2,py=pointer&&Number.isFinite(event.clientY)?event.clientY:sr.top+sr.height/2;tip.style.position='fixed';tip.style.display='block';const tr=tip.getBoundingClientRect();tip.style.left=`${clamp(px+14,8,Math.max(8,innerWidth-tr.width-8))}px`;tip.style.top=`${clamp(py+14,8,Math.max(8,innerHeight-tr.height-8))}px`;};
window.hideSleepStageTip=function(slice){const tip=slice?.closest('.sleep-stage-chart-wrap')?.querySelector('.sleep-stage-tip');if(tip)tip.style.display='none';};
function sleepDurationCard(){
 const selectedSeries=window._sleepDurationSeries||['total'],goal=(window._sleepDurationTarget==='custom'?Number(D.settings?.sleep_goal)||8:8),targetLow=window._sleepDurationTarget==='custom'?goal-.5:7,targetHigh=window._sleepDurationTarget==='custom'?goal+.5:9,since=periodStart(period),map={};
 for(const s of D.sleep||[]){if(!s.day)continue;const x=dayMs(s.day);if(x<since)continue;map[s.day]??={day:s.day,x,night:0,nap:0};if(s.main!==false&&!s.nap)map[s.day].night+=Number(s.asleep)||0;else map[s.day].nap+=Number(s.asleep)||0;}
 const pts=Object.values(map).sort((a,b)=>a.x-b.x).map(q=>({...q,night:q.night/60,nap:q.nap/60,total:(q.night+q.nap)/60}));if(!pts.length)return {html:'<div class="empty">No sleep sessions in the selected period.</div>',cols:[],rows:[]};
 const W=Math.max(300,Math.floor(document.querySelector('#card-sleepDuration .plot')?.clientWidth||600)),H=330,L=44,R=112,T=24,B=36,pw=W-L-R,ph=H-T-B,max=Math.max(10,Math.ceil(Math.max(...pts.map(p=>p.total),goal+1))),X=i=>L+(i+.5)*pw/pts.length,Y=v=>T+ph-v/max*ph,bw=Math.min(28,pw/pts.length*.58),avN=mean(pts.map(p=>p.night)),avP=mean(pts.map(p=>p.nap)),avT=mean(pts.map(p=>p.total));let svg=`<svg class="sleep-duration-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Daily sleep and nap duration; interactive bars">`;
 for(let v=0;v<=max;v+=2)svg+=`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#27272A"/><text x="${L-7}" y="${Y(v)+4}" fill="#A1A1AA" font-size="10" text-anchor="end">${v}h</text>`;
 svg+=`<rect x="${L}" y="${Y(targetHigh)}" width="${pw}" height="${Y(targetLow)-Y(targetHigh)}" fill="#10B981" fill-opacity=".06"/><line x1="${L}" x2="${W-R}" y1="${Y(goal)}" y2="${Y(goal)}" stroke="#A1A1AA" stroke-dasharray="5 4"/><text x="${W-R-2}" y="${Y(goal)-5}" fill="#D4D4D8" font-size="10" text-anchor="end">Goal ${goal}h</text>`;
 const lineSeries=[{key:'total',label:'Total sleep + nap',color:'#22C55E'},{key:'night',label:'Sleep',color:'#6366F1'},{key:'nap',label:'Nap',color:'#06B6D4'}].filter(s=>selectedSeries.includes(s.key));
 lineSeries.forEach(s=>{const valid=pts.map((p,i)=>({p,i})).filter(q=>Number.isFinite(q.p[s.key]));if(valid.length){svg+=`<path d="${valid.map((q,i)=>(i?'L':'M')+X(q.i)+','+Y(q.p[s.key])).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;valid.forEach(q=>{const x=X(q.i),y=Y(q.p[s.key]);svg+=`<circle cx="${x}" cy="${y}" r="3.2" fill="${s.color}" stroke="#111113" stroke-width="1" tabindex="0"><title>${q.p.day} · ${s.label}: ${q.p[s.key].toFixed(2)} h</title></circle>`;});}});
 pts.forEach((p,i)=>{const x=X(i);if(i%4===0)svg+=`<text x="${x}" y="${H-12}" text-anchor="middle" fill="#A1A1AA" font-size="10" font-variant-numeric="tabular-nums">${p.day.slice(5)}</text>`;svg+=`<rect x="${x-bw/2-3}" y="${T}" width="${bw+6}" height="${ph}" fill="transparent" tabindex="0"><title>${p.day} · Night ${p.night.toFixed(2)} h · Naps ${p.nap.toFixed(2)} h · Total ${p.total.toFixed(2)} h</title></rect>`;});
 const avgLine=(v,color,dash='')=>`<line x1="${L}" x2="${W-R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${color}" stroke-width="1.5" stroke-dasharray="${dash}" filter="drop-shadow(0 0 3px ${color})"/><rect x="${W-R+6}" y="${Math.max(T,Math.min(H-B-20,Y(v)-10))}" width="96" height="20" rx="10" fill="#18181B" stroke="${color}" stroke-opacity=".4"/><text x="${W-R+54}" y="${Math.max(T+13,Math.min(H-B-7,Y(v)+3))}" fill="${color}" font-size="9.5" font-weight="700" font-variant-numeric="tabular-nums" text-anchor="middle">${v.toFixed(1)}h AVG</text>`;if(selectedSeries.includes('night'))svg+=avgLine(avN,'#818CF8','3 4');if(selectedSeries.includes('nap'))svg+=avgLine(avP,'#06B6D4','3 4');if(selectedSeries.includes('total'))svg+=avgLine(avT,'#22C55E','6 4');svg+='</svg>'; 
 const key=`<div class="sleep-duration-key"><span><i style="background:#6366F1"></i>Sleep · avg ${avN.toFixed(1)}h</span><span><i style="background:#06B6D4"></i>Nap · avg ${avP.toFixed(1)}h</span><span><i style="background:#22C55E"></i>Total sleep+nap · avg ${avT.toFixed(1)}h</span><span>Personal range ${targetLow}–${targetHigh}h · goal ${goal}h</span></div><div class="status-color-key"><div style="display:flex;width:100%;max-width:420px;height:8px;border-radius:99px;overflow:hidden"><i style="flex:1;background:#38BDF8"></i><i style="flex:1;background:#94A3B8"></i><i style="flex:1;background:#F43F5E"></i></div><span><i style="background:#F43F5E"></i>Below target</span><span><i style="background:#71717A"></i>At target / average</span><span><i style="background:#22C55E"></i>Above target (context-dependent)</span></div>`;
 return {html:`<div>${svg}${key}</div>`,cols:['Date','Night sleep (h)','Nap (h)','Total (h)'],rows:pts.slice().reverse().map(p=>[p.day,p.night.toFixed(2),p.nap.toFixed(2),p.total.toFixed(2)])};
}
function sleepStageLine(field,label,color){
  const scope=window.sleepStageScope||'total';
  const sessions=(D.sleep||[]).filter(s=>scope==='total'||(scope==='nights'?!!s.main&&!s.nap:(!s.main||!!s.nap)));
  const by={};
  for(const s of sessions){const v=Number(s[field]||0);if(!by[s.day])by[s.day]=[];by[s.day].push(v/60);}
  const pts=Object.entries(by).map(([day,vs])=>({day,x:dayMs(day),y:vs.reduce((a,b)=>a+b,0)})).filter(q=>q.x>=periodStart(period));
  const avg=mean(pts.map(q=>q.y));
  const sorted=pts.map(q=>q.y).filter(Number.isFinite).sort((a,b)=>a-b);
  const percentile=p=>{const pos=(sorted.length-1)*p,lo=Math.floor(pos),hi=Math.ceil(pos);return sorted[lo]+(sorted[hi]-sorted[lo])*(pos-lo);};
  const personalRange=sorted.length>=3?{y1:percentile(.10),y2:percentile(.90)}:null;
  if(personalRange&&personalRange.y2-personalRange.y1<.04){const mid=(personalRange.y1+personalRange.y2)/2;personalRange.y1=Math.max(0,mid-.02);personalRange.y2=mid+.02;}
  if(scope==='naps'&&!pts.some(q=>q.y>0)){
    return {kind:'line',pts:[],empty:`No nap data for ${label.toLowerCase()} in this period.`,cols:[],rows:[]};
  }
  const targetBands = (scope!=='naps' && window.sleepStagePercent === false) ? {
    deep:  [{y1:1.0,y2:1.75,color:'var(--deep)',opacity:.07,label:'1.0–1.75 h target'}],
    rem:   [{y1:1.5,y2:2.0, color:'var(--rem)', opacity:.07,label:'1.5–2.0 h target'}],
    light: [{y1:3.5,y2:5.0, color:'var(--light)',opacity:.07,label:'3.5–5.0 h target'}],
    awake: [{y1:0,y2:0.5,   color:'var(--awake)',opacity:.07,label:'<0.5 h awake'}],
  }[field] : null;
  const bands=[...(personalRange?[{...personalRange,color,opacity:.16,label:'Personal range · 10th–90th percentile',labelColor:'#E5E7EB'}]:[]),...(targetBands||[]).map(b=>({...b,opacity:.035,label:null}))];
  const scopeLabel = scope==='total'?'night sleep + naps':scope==='nights'?'night sleep only':'naps only';
  return {
    kind:'line', pts, color, avg, avgColor:'#E5E7EB', avgDash:'6 4', avgWidth:1.8, avgLabel:'Average',
    bands,
    fmtAvg:avg==null?'':avg.toFixed(2)+' h',
    fmtX:fmtDay, fmtY:v=>v.toFixed(2).replace(/0$/, '').replace(/\.$/, '')+'h', yMin:0, yTickStep:0.25,
    label,
    h: 220,
    syncGroup: 'sleep-stages',
    foot:`<div class="sub">Showing ${scopeLabel}; white dashed line = period average. ${personalRange?'Colored band = your personal 10th–90th percentile range across '+sorted.length+' days.':'Personal range needs at least 3 days of data.'} ${targetBands?'A faint tint shows the typical adult target for context.':''}</div>`,
    tip:q=>`<b>${fmtDayLong(q.x)}</b>${tipRow(label,q.y.toFixed(2)+' h',color)}${tipRow('Period avg',avg==null?'–':avg.toFixed(2)+' h')}`,
    cols:['Date',label+' (h)'],
    rows:pts.slice().reverse().map(q=>[q.day,q.y.toFixed(2)])
  };
}

function sleepDebtCard(){
  const goalH=Number(D.settings?.sleep_goal)||8,sessions=(D.sleep||[]).filter(s=>Number(s.asleep)>0),mains=sessions.filter(s=>!!s.main&&!s.nap).sort((a,b)=>new Date(a.end)-new Date(b.end));
  if(!mains.length)return {kind:'line',pts:[],empty:'No main-sleep sessions are available to chart sleep debt.',cols:[],rows:[]};
  const byDay={};
  for(const s of mains){const day=localDateKey(s.end)||s.day;if(!day)continue;byDay[day]??={nights:0,nightHours:0,napHours:0};byDay[day].nights++;byDay[day].nightHours+=(Number(s.asleep)||0)/60;}
  for(const s of sessions.filter(x=>!x.main||!!x.nap)){const day=localDateKey(s.end)||s.day||localDateKey(s.start);if(!day)continue;byDay[day]??={nights:0,nightHours:0,napHours:0};byDay[day].napHours+=(Number(s.asleep)||0)/60;}
  let nightDebt=0,netDebt=0;const history=[];
  for(const day of Object.keys(byDay).sort()){const v=byDay[day];nightDebt=Math.max(0,nightDebt+goalH*v.nights-v.nightHours);netDebt=Math.max(0,netDebt+goalH*v.nights-v.nightHours-v.napHours);history.push({day,nightDebt,netDebt,...v});}
  const last14Days=new Set(mains.slice(-14).map(s=>localDateKey(s.end)||s.day).filter(Boolean)),firstDay=[...last14Days].sort()[0],points=history.filter(p=>p.day>=firstDay);
  const mode=window._sleepDebtMode==='night'?'night':'net',nightMode=mode==='night',color=nightMode?'#F59E0B':'#38BDF8',field=nightMode?'nightDebt':'netDebt',current=history[history.length-1][field];
  const maxY=Math.max(1,Math.ceil(Math.max(...points.map(p=>p.nightDebt),...points.map(p=>p.netDebt)))),W=440,H=250,L=44,R=12,T=14,B=34,plotW=W-L-R,plotH=H-T-B,n=points.length;
  const X=i=>L+(n<2?.5:i/(n-1))*plotW,Y=v=>T+plotH-(v/maxY)*plotH;let svg=`<svg class="sleep-debt-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${nightMode?'Night-only':'Net after naps'} cumulative sleep debt">`;
  for(let i=0;i<=4;i++){const v=maxY*i/4,y=Y(v);svg+=`<line x1="${L}" x2="${W-R}" y1="${y}" y2="${y}" stroke="var(--grid)"/><text x="${L-6}" y="${y+3}" text-anchor="end" fill="var(--axis-text)" font-size="10">${v.toFixed(1)}h</text>`;}
  svg+=`<path d="${points.map((p,i)=>(i?'L':'M')+X(i)+','+Y(p[field])).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  points.forEach((p,i)=>{svg+=`<circle cx="${X(i)}" cy="${Y(p[field])}" r="3.2" fill="${color}" stroke="var(--surface)" stroke-width="1"><title>${p.day} · night ${p.nightHours.toFixed(1)} h · naps ${p.napHours.toFixed(1)} h · ${p[field].toFixed(1)} h debt</title></circle>`;if(i%Math.max(1,Math.ceil(n/7))===0||i===n-1)svg+=`<text x="${X(i)}" y="${H-10}" text-anchor="middle" fill="var(--axis-text)" font-size="10">${p.day.slice(5)}</text>`;});svg+='</svg>';
  const debtLabel=current<1?'No debt':current<3?'Low debt':current<5?'Moderate debt':'High debt',debtBand=current<1?'good':current<3?'warn':'bad';
  const html=`<div class="sleep-debt-controls"><button class="act ${nightMode?'active':''}" type="button" aria-pressed="${nightMode}" onclick="window.setSleepDebtMode('night')">Night-only debt</button><button class="act ${!nightMode?'active':''}" type="button" aria-pressed="${!nightMode}" onclick="window.setSleepDebtMode('net')">Net debt after naps</button><span class="sub">Goal ${goalH} h per night</span></div><div class="sub" style="margin:0 0 5px">${nightMode?'Night-only cumulative balance':'Cumulative balance after all recorded naps'}</div>${svg}<div class="sub" style="margin-top:5px">Current ${nightMode?'night-only':'net after naps'} debt: <b>${current.toFixed(1)} h</b></div>`;
  return {html,label:'Sleep debt balance: night-only or net after naps',foot:`<div class="split"><div class="srow"><span>Night-only: <b>${history.at(-1).nightDebt.toFixed(1)} h</b></span><span>Net after all naps: <b>${history.at(-1).netDebt.toFixed(1)} h</b></span><span class="status-pill ${debtBand}">${debtLabel}</span></div><div class="note">Balance updates as nightly goal − night sleep − naps, carrying forward across dates so later naps can repay earlier debt. The graph shows the latest 14 main-sleep nights, including intervening nap days. Debt is floored at zero. Estimate, not a clinical measure.</div></div>`,cols:['Date','Night sleep h','Nap sleep h','Night-only debt h','Net debt after naps h'],rows:points.slice().reverse().map(p=>[p.day,p.nightHours.toFixed(1),p.napHours.toFixed(1),p.nightDebt.toFixed(1),p.netDebt.toFixed(1)])};
}
window.setSleepDebtMode=function(mode){window._sleepDebtMode=mode==='night'?'night':'net';const card=document.querySelector('#card-sleepdebt');if(card)renderCardByElement(card,true);};

function sleepSessions(){
  const sessions=(D.sleep||[]).filter(x=>D.sleep_hr?.[x.id]?.length&&Number.isFinite(new Date(x.start).getTime())&&Number.isFinite(new Date(x.end).getTime())&&new Date(x.end)>new Date(x.start)).slice().sort((a,b)=>new Date(a.start)-new Date(b.start));
  const groups=[];
  for(const session of sessions){
    const start=new Date(session.start).getTime(),end=new Date(session.end).getTime(),group=groups[groups.length-1];
    if(group){const overlap=Math.max(0,Math.min(group.end,end)-Math.max(group.start,start)),union=Math.max(group.end,end)-Math.min(group.start,start);if(union>0&&overlap/union>=.9){group.items.push(session);group.end=Math.max(group.end,end);continue;}}
    groups.push({start,end,items:[session]});
  }
  return groups.map(g=>g.items.reduce((best,x)=>Number(x.asleep)>Number(best.asleep)?x:best)).reverse();
}
let sleepSel = null;

function fillSleepSelect(){
  const dateInput=$('#sleepDateSel'), sel=$('#sleepSel'); if(!dateInput||!sel) return;
  const ss=sleepSessions();
  if(!ss.some(x=>x.id===sleepSel)) sleepSel = ss.length ? ss[0].id : null;
  const active=ss.find(x=>x.id===sleepSel)||ss[0];
  const dateKey=active?sleepDateKey(active):'';
  dateInput.value=dateKey; dateInput.disabled=!ss.length;
  const same=sessionsForDate(ss,dateKey);
  sel.innerHTML=same.map(x=>`<option value="${x.id}">${x.main?'Sleep':'Nap'} · ${fmtDayLong(new Date(x.start))} · ${hm(x.asleep)}</option>`).join('');
  sel.hidden=same.length<=1; sel.disabled=same.length<=1;
  if(active&&same.some(x=>x.id===active.id))sel.value=active.id;
  const meta=$('#sleepSessionMeta');
  if(meta) meta.textContent=active?`${active.main?'Sleep':'Nap'} · ${fmtDayLong(new Date(active.start))} · ${fmtTime(new Date(active.start).getTime())}–${fmtTime(new Date(active.end).getTime())} · ${hm(active.asleep)} · ${fmtN(D.sleep_hr_stats?.[active.id]?.count || (D.sleep_hr[active.id]||[]).length)} HR samples`:'No sleep selected';
  dateInput.onchange=e=>{const matches=sessionsForDate(ss,e.target.value);if(matches.length){sleepSel=matches[0].id;renderCharts();}else{sel.innerHTML='';sel.hidden=true;}};
  sel.onchange=e=>{sleepSel=e.target.value;renderCharts();};
}
function sessionsForDate(items,dateKey){return items.filter(x=>sleepDateKey(x)===dateKey);}

const SLEEP_STAGE_COLORS=Object.freeze({DEEP:'#8B5CF6',LIGHT:'#3B82F6',REM:'#2DD4BF',AWAKE:'#F59E0B'});
function sleepStageKey(value){
  const type=String(value||'LIGHT').toUpperCase().replace(/^ASLEEP$/,'LIGHT');
  return type.includes('DEEP')?'DEEP':type.includes('REM')?'REM':type.includes('AWAKE')?'AWAKE':'LIGHT';
}

function buildSleepingHrCard(){
  const ss=sleepSessions();
  const cur=ss.find(x=>x.id===sleepSel) || ss[0];
  if(!cur) return {kind:'line',pts:[],empty:'No heart rate recorded during sleep yet.',cols:[],rows:[]};
  const raw=D.sleep_hr[cur.id]||[];
  const stageRowsForDots=D.sleep_stages_by_id?.[cur.id]||[];
  const rawPts=raw.map(([t,b])=>{const stage=sleepStageKey(stageRowsForDots.find(st=>t>=new Date(st.start).getTime()&&t<=new Date(st.end).getTime())?.type);return {x:t,y:b,stage};});
  const buckets=new Map();
  for(const p of rawPts){const k=Math.floor(p.x/(5*60000))*(5*60000);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);}
  const pts=[...buckets.entries()].sort((a,b)=>a[0]-b[0]).map(([x,vs])=>{const counts=new Map();vs.forEach(p=>counts.set(p.stage,(counts.get(p.stage)||0)+1));const values=vs.map(p=>Number(p.y));return {x,y:mean(values),min:Math.min(...values),max:Math.max(...values),stage:[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]||'LIGHT'};});
  const currentStats=D.sleep_hr_stats?.[cur.id];
  const avg=currentStats?.mean!=null?Number(currentStats.mean):mean(rawPts.map(p=>p.y));
  const rawMin=rawPts.length?Math.min(...rawPts.map(p=>Number(p.y))):null,rawMax=rawPts.length?Math.max(...rawPts.map(p=>Number(p.y))):null;
  const mine=rawPts.map(p=>p.y);
  const sessionEndMs=new Date(cur.end).getTime(),sessionDay=localDateKey(sessionEndMs),baselineStart=localDateKey(sessionEndMs-29*86400000),baselineSessions=ss.filter(x=>{const d=localDateKey(new Date(x.end).getTime());return d>=baselineStart&&d<=sessionDay;}),baselineRaw=baselineSessions.flatMap(x=>(D.sleep_hr[x.id]||[]).map(r=>Number(r[1]))).filter(Number.isFinite);
  const allStats=baselineSessions.map(x=>D.sleep_hr_stats?.[x.id]).filter(x=>x&&Number(x.count)>0),allCount=allStats.reduce((a,x)=>a+Number(x.count),0);
  const allAvg=allCount?allStats.reduce((a,x)=>a+Number(x.mean)*Number(x.count),0)/allCount:mean(baselineRaw);
  const kind = cur.main ? 'sleep' : 'nap';
  const awakeVals=rawPts.filter(p=>String(p.stage).toUpperCase().includes('AWAKE')).map(p=>Number(p.y)).filter(Number.isFinite),sleepVals=rawPts.filter(p=>!String(p.stage).toUpperCase().includes('AWAKE')).map(p=>Number(p.y)).filter(Number.isFinite),awakeMean=mean(awakeVals),sleepMean=mean(sleepVals);
  const dipPct=Number.isFinite(awakeMean)&&awakeMean>0&&Number.isFinite(sleepMean)?(awakeMean-sleepMean)/awakeMean*100:null;
  const dipScore=dipPct==null?null:dipPct>=10&&dipPct<=20?100:dipPct<10?clamp(dipPct/10*100,0,100):clamp((35-dipPct)/15*100,0,100);
  const minPoint=rawPts.reduce((best,p)=>!best||Number(p.y)<Number(best.y)?p:best,null),minStage=minPoint?.stage||'stage unavailable',minInFirstHalf=!!minPoint&&Number(minPoint.x)<=new Date(cur.start).getTime()+(sessionEndMs-new Date(cur.start).getTime())/2;
  const rhrHistory=(D.daily?.resting_hr||[]).filter(r=>String(r[0])<=sessionDay&&Number.isFinite(+r[1])&&+r[1]>0),rhrDay=rhrHistory.at(-1)||null,rhrValue=rhrDay?Number(rhrDay[1]):null,rhrBaselineRows=rhrDay?rhrHistory.filter(r=>String(r[0])<String(rhrDay[0])).slice(-30):[],rhr30=rhrBaselineRows.length?mean(rhrBaselineRows.map(r=>Number(r[1]))):null,rhrDelta=rhrValue!=null&&rhr30!=null?rhrValue-rhr30:null;
  const stageBuckets={DEEP:[],LIGHT:[],REM:[],AWAKE:[]},stageDuration={DEEP:0,LIGHT:0,REM:0,AWAKE:0},stageNames={DEEP:'Deep Sleep',LIGHT:'Light Sleep',REM:'REM Sleep',AWAKE:'Awake'};
  for(const st of stageRowsForDots){const type=sleepStageKey(st.type),key=type in stageBuckets?type:null,a=new Date(st.start).getTime(),b=new Date(st.end).getTime();if(key&&Number.isFinite(a)&&Number.isFinite(b)&&b>a)stageDuration[key]+=b-a;}
  for(const p of rawPts){const key=sleepStageKey(p.stage);if(stageBuckets[key]&&Number.isFinite(Number(p.y)))stageBuckets[key].push(Number(p.y));}
  const totalStageMs=Object.values(stageDuration).reduce((a,b)=>a+b,0),stageTableColors=SLEEP_STAGE_COLORS,stageLabel=v=>stageNames[sleepStageKey(v)]||String(v||'Unknown');
  const stageTable=`<div class="tablewrap"><table class="sleep-hr-stage-table"><thead><tr><th>Sleep stage</th><th>Avg HR</th><th>HR range</th><th>Duration</th></tr></thead><tbody>${Object.keys(stageBuckets).map(k=>{const vals=stageBuckets[k],dur=stageDuration[k],pct=totalStageMs?dur/totalStageMs*100:0;return `<tr><td><span class="sleep-hr-stage-name"><i style="--stage-color:${stageTableColors[k]}"></i>${stageNames[k]}</span></td><td>${vals.length?mean(vals).toFixed(1)+' bpm':'—'}</td><td>${vals.length?Math.min(...vals).toFixed(0)+'–'+Math.max(...vals).toFixed(0)+' bpm':'—'}</td><td>${dur?hm(dur/60000)+' ('+Math.round(pct)+'%)':'—'}</td></tr>`;}).join('')}</tbody></table></div>`;
  const insights=`<div class="sleep-hr-kpis"><div class="sleep-hr-kpi"><div class="k">Lowest HR</div><strong>${minPoint?Number(minPoint.y).toFixed(1)+' bpm':'—'}</strong><div class="s">${minPoint?`Reached at ${new Date(minPoint.x).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} · ${stageLabel(minStage)}`:'No heart-rate readings available'}</div></div><div class="sleep-hr-kpi"><div class="k">Overnight HR dip</div><strong>${dipPct==null?'—':dipPct.toFixed(1)+'%'}</strong><div class="s">${dipPct==null?'Awake-stage and sleep readings needed':`Awake-stage avg ${awakeMean.toFixed(1)} vs sleep avg ${sleepMean.toFixed(1)} bpm · reference 10–20%`}</div></div><div class="sleep-hr-kpi"><div class="k">Resting baseline</div><strong>${rhrValue==null?'—':rhrValue.toFixed(1)+' bpm'}</strong><div class="s">${rhrDelta==null?'30-day comparison unavailable':`${rhrDelta>0?'+':''}${rhrDelta.toFixed(1)} bpm vs 30-day avg ${rhr30.toFixed(1)} bpm`}</div></div><div class="sleep-hr-kpi"><div class="k">Cardiovascular recovery</div><strong>${dipScore==null?'—':Math.round(dipScore)+' / 100'}</strong><div class="s">${dipScore==null?'Insufficient awake-stage HR for estimate':'Approximate HR-dip range-fit; not a clinical score'}</div></div></div><div><h4 style="margin:0 0 6px;font-size:12px">Heart rate by sleep stage</h4>${stageTable}</div><div class="sleep-hr-insight"><b>⚡ Sleep Dip Insights</b><br>${dipPct==null?'Not enough awake-stage heart-rate data to estimate an overnight dip.':`${dipPct>=10&&dipPct<=20?'The estimated sleep-period HR dip is within the 10–20% reference range.':dipPct>0?'The estimated HR dip is outside the 10–20% reference range.':'Sleep HR was not lower than the awake-stage average.'} Lowest reading was ${minPoint?Number(minPoint.y).toFixed(1)+' bpm at '+new Date(minPoint.x).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})+' ('+stageLabel(minStage)+')'+(minInFirstHalf?' in the first half of this sleep window':''):'unavailable'}. This wearable-based comparison is descriptive, not diagnostic.`}</div>`;

  const stageRows=D.sleep_stages_by_id?.[cur.id]||[];
  const startMs=new Date(cur.start).getTime(), endMs=new Date(cur.end).getTime();
  const durMs=Math.max(1, endMs-startMs);
  const stageTrack=stageRows.map(st=>{const type=sleepStageKey(st.type);return {start:new Date(st.start).getTime(),end:new Date(st.end).getTime(),type,color:SLEEP_STAGE_COLORS[type]};});
  const stageTimeline=`<div class="sleep-hr-stage-track" role="img" aria-label="Sleep stage timeline"><span>Stage</span><div class="sleep-hr-stage-track-bar">${stageTrack.map(st=>{const left=clamp((st.start-startMs)/durMs*100,0,100),right=clamp((st.end-startMs)/durMs*100,0,100),width=Math.max(0,right-left);return width?`<i style="left:${left}%;width:${width}%;--stage-color:${st.color}" title="${stageLabel(st.type)} · ${fmtTime(st.start)}–${fmtTime(st.end)}"></i>`:'';}).join('')}</div></div>`;

  const xTicks = [];
  const t0=new Date(startMs); t0.setSeconds(0,0);
  const step = 15*60000;
  const align = Math.ceil(startMs / step) * step;
  for (let t=align; t<=endMs; t+=step) xTicks.push(t);

  const minRawPoint=rawPts.reduce((a,p)=>!a||Number(p.y)<Number(a.y)?p:a,null),maxRawPoint=rawPts.reduce((a,p)=>!a||Number(p.y)>Number(a.y)?p:a,null);
  const stageRangeFor=q=>{const bucket=pts.reduce((best,p)=>!best||Math.abs(p.x-q.x)<Math.abs(best.x-q.x)?p:best,null);return bucket;};
  return {
    kind:'line',pts,rawPts,xMin:startMs,xMax:endMs,fixedMargins:true,padLeft:36,padRight:12,axisLabelsInside:true,yMin:Math.max(20,Math.floor((rawMin??40)/20)*20),yMax:Math.max(60,Math.ceil((rawMax??100)/20)*20),yTickStep:20,axisContrast:true,gridOpacity:.04,stageCurtains:stageTrack.map(st=>({...st,opacity:.07})),
    lineGlowFilter:'drop-shadow(0 0 4px rgba(103,232,249,.42))',lineWidth:2,rawPointGlow:false,rawPointSize:2,rawPointOpacity:.45,rawColorFn:p=>SLEEP_STAGE_COLORS[sleepStageKey(p.stage)],rawPointTitle:p=>`${fmtTime(p.x)} · ${Number(p.y).toFixed(1)} bpm · ${stageLabel(p.stage)}`,
    timelineCrosshair:true,timelineTip:q=>{const bucket=stageRangeFor(q),stage=sleepStageKey(q.stage),color=SLEEP_STAGE_COLORS[stage];return `<b>${fmtTime(q.x)}</b>${tipRow('5-min mean HR',bucket?.y!=null?bucket.y.toFixed(1)+' bpm':'—','#E2E8F0')}${tipRow('Raw sample range',bucket?`${bucket.min.toFixed(1)}–${bucket.max.toFixed(1)} bpm`:'—',color)}${tipRow('Active sleep stage',stageLabel(stage),color)}`;},
    referenceLineOpacity:.15,avg,avgLineOpacity:.52,avgPill:true,avgPillInside:true,avgPillSide:'right',avgPillGlass:true,avgPillText:`${avg.toFixed(1)} BPM AVG`,avgColor:'#E2E8F0',avgDash:'2 5',
    extrema:[...(minRawPoint?[{x:minRawPoint.x,y:rawMin,type:'min',color:SLEEP_STAGE_COLORS[sleepStageKey(minRawPoint.stage)],glassBadge:true}]:[]),...(maxRawPoint?[{x:maxRawPoint.x,y:rawMax,type:'max',color:SLEEP_STAGE_COLORS[sleepStageKey(maxRawPoint.stage)],glassBadge:true,above:true}]:[])],
    color:'#E2E8F0',scatter:false,smooth:true,
    fmtAvg:avg==null?'':avg.toFixed(1)+' bpm',
    fmtX:fmtTime, fmtY:v=>Math.round(v), label:'Heart rate during sleep',
    h: 420,
    xTicks,
    tip:q=>`<b>${fmtTime(q.x)}</b>${tipRow('Heart rate',Math.round(q.y)+' bpm','var(--hr)')}${tipRow('vs average',(q.y>=avg?'▲ ':'▼ ')+Math.abs(q.y-avg).toFixed(1)+' bpm')}`,
    foot: stageTimeline+`<div class="sleep-hr-distribution-grid">`+
      splitHtml(stats(mine,avg,'sleepHr'),'var(--hr)',`This ${kind} · ${fmtN(currentStats?.count || raw.length)} stored readings.`,'sleepHr',`TONIGHT'S SAMPLES (${fmtN(currentStats?.count || raw.length)} READINGS)`,`${fmtN(mine.length)} readings compared with this session's mean.`)+
      splitHtml(stats(baselineRaw,allAvg,'sleepHr'),'var(--hr)',`Across ${baselineSessions.length} sleep sessions in the 30 days ending ${sessionDay}.`,'sleepHr',`30-DAY SESSION TREND (${baselineSessions.length} SESSIONS)`,`${baselineSessions.length} sessions compared with their 30-day mean.`)+`</div><div class="sleep-hr-analysis">${insights}</div>`,
    cols:['Time','bpm'],
    rows:raw.filter((_,i)=>i%5===0).map(r=>[fmtDay(r[0])+' '+fmtTime(r[0]),Math.round(r[1])])
  };
}

