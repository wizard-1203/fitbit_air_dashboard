/* ============================================================
   CROSS-CHART SYNC HOVER (sleep stage charts)
   ============================================================ */
window._syncRegistry = window._syncRegistry || {};
window._broadcastSync = function(group, norm){
  const list = window._syncRegistry[group] || [];
  for (const c of list) {
    const line = c.svg.querySelector('.sync-line');
    if (!line) continue;
    if (norm < 0 || norm > 1) { line.setAttribute('opacity','0'); continue; }
    const x = c.m.l + norm * c.pw;
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('opacity', '1');
  }
};
window._clearSync = function(group){
  const list = window._syncRegistry[group] || [];
  for (const c of list) {
    const line = c.svg.querySelector('.sync-line');
    if (line) line.setAttribute('opacity','0');
  }
};

/* ============================================================
   CHART ENGINE
   ============================================================ */
function openDayDetail(day, source='Chart'){
  if(!day)return;const old=document.getElementById('day-detail-backdrop');if(old)old.remove();
  const metrics=[['Steps','steps','steps'],['Distance','distance_m','km'],['Calories','calories','kcal'],['Active minutes','active_minutes','min'],['Resting HR','resting_hr','bpm'],['HRV','hrv','ms'],['SpO₂','spo2','%'],['Respiratory rate','resp_rate','/min'],['VO₂ max','vo2max','']];
  const values=metrics.map(([label,key,unit])=>{const v=(D.daily?.[key]||[]).find(r=>String(r[0])===day)?.[1];return v==null?`<tr><td>${label}</td><td>—</td></tr>`:`<tr><td>${label}</td><td>${Number(v).toFixed(key==='body_temp'?2:1)} ${unit}</td></tr>`;}).join('');
  const hrDay=(D.hr||[]).filter(p=>localDateKey(+p[0])===day),hrVals=hrDay.map(p=>+p[1]),hrMin=hrVals.length?Math.min(...hrVals):0,hrMax=hrVals.length?Math.max(...hrVals):1;const mini=hrVals.length>1?`<svg viewBox="0 0 500 72" width="500" height="72" role="img" aria-label="Heart-rate mini timeline for ${day}" style="max-width:100%;height:auto"><path d="${hrVals.map((v,i)=>(i?'L':'M')+(i/(hrVals.length-1)*496+2)+','+(8+(hrMax-v)/(hrMax-hrMin||1)*56)).join(' ')}" fill="none" stroke="var(--hr)" stroke-width="2"/></svg>`:'<div class="sub">No high-frequency HR samples are available for this date in the current response.</div>';
  const d=new Date(day+'T12:00:00');const shift=n=>{const x=new Date(d);x.setDate(x.getDate()+n);return localDateKey(x);};
  const back=document.createElement('div');back.id='day-detail-backdrop';back.className='card-modal-backdrop';back.setAttribute('role','dialog');back.setAttribute('aria-modal','true');back.innerHTML=`<div class="card-modal-shell" style="max-width:560px"><button class="act" id="dayDetailClose" style="float:right">Close ✕</button><h2 style="margin:4px 0 8px">${day} · Daily detail</h2><div class="sub">Opened from ${esc(source)}. Missing metrics are shown as —, not zero.</div><div class="workout-feature" style="margin-top:12px"><h3>Heart-rate mini timeline</h3>${mini}</div><div class="tablewrap" style="margin-top:12px"><table><tbody>${values}</tbody></table></div><div class="workout-controls" style="margin-top:12px"><button class="act" id="dayPrev">← Previous day</button><button class="act" id="dayNext">Next day →</button></div></div>`;
  document.body.appendChild(back);document.body.style.overflow='hidden';back.querySelector('#dayDetailClose').onclick=()=>{back.remove();document.body.style.overflow='';};back.addEventListener('click',e=>{if(e.target===back){back.remove();document.body.style.overflow='';}});back.querySelector('#dayPrev').onclick=()=>{back.remove();document.body.style.overflow='';openDayDetail(shift(-1),source);};back.querySelector('#dayNext').onclick=()=>{back.remove();document.body.style.overflow='';openDayDetail(shift(1),source);};
}
function monotoneSplinePath(points,move=true){
  if(!points.length)return '';
  if(points.length===1)return `${move?'M':'L'}${points[0].x},${points[0].y}`;
  const n=points.length,dx=[],h=[],delta=[],m=Array(n).fill(0);
  for(let i=0;i<n-1;i++){dx[i]=points[i+1].x-points[i].x;h[i]=Math.abs(dx[i])||1;delta[i]=(points[i+1].y-points[i].y)/(dx[i]||1);}
  if(n===2)m[0]=m[1]=delta[0];
  else{
    for(let i=1;i<n-1;i++){
      if(delta[i-1]===0||delta[i]===0||Math.sign(delta[i-1])!==Math.sign(delta[i]))m[i]=0;
      else{const w1=2*h[i]+h[i-1],w2=h[i]+2*h[i-1];m[i]=(w1+w2)/(w1/delta[i-1]+w2/delta[i]);}
    }
    const endpoint=(h0,h1,d0,d1)=>{let v=((2*h0+h1)*d0-h0*d1)/(h0+h1);if(Math.sign(v)!==Math.sign(d0))return 0;if(Math.sign(d0)!==Math.sign(d1)&&Math.abs(v)>3*Math.abs(d0))v=3*d0;return v;};
    m[0]=endpoint(h[0],h[1],delta[0],delta[1]);m[n-1]=endpoint(h[n-2],h[n-3],delta[n-2],delta[n-3]);
  }
  let d=`${move?'M':'L'}${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`;
  for(let i=0;i<n-1;i++){const a=points[i],b=points[i+1],step=(b.x-a.x)/3;d+=`C${(a.x+step).toFixed(1)},${(a.y+m[i]*step).toFixed(1)} ${(b.x-step).toFixed(1)},${(b.y-m[i+1]*step).toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;}
  return d;
}

function drawChart(host, cfg){
  if(!host || !host.isConnected) return;
  const measuredWidth = Math.floor(host.getBoundingClientRect().width || host.clientWidth || 0);
  if(measuredWidth <= 0 || host.closest('.hidden-by-nav') || host.closest('[hidden]')) { host._chartDirty = true; return; }
  if (host._syncGroup) {
    const list = window._syncRegistry[host._syncGroup] || [];
    const idx = list.findIndex(c => c.host === host);
    if (idx >= 0) list.splice(idx, 1);
  }
  host.innerHTML='';
  host._chartDirty = false;
  let pts=Array.isArray(cfg.pts)?cfg.pts.filter(p=>p && p.x!==null && p.x!==undefined && Number.isFinite(Number(p.x)) && (p.y==null || Number.isFinite(Number(p.y)))):[];
  const zoom=window._chartZoom?.[cfg._cardId];if(zoom)pts=pts.filter(p=>Number(p.x)>=zoom.min&&Number(p.x)<=zoom.max);
  if(!pts.some(p=>p.y!=null && !isNaN(p.y))){host.innerHTML=`<div class="empty">${cfg.empty||'No data in this range'}</div>`;return;}
  const W=measuredWidth, H=cfg.h||220, compact=W<480, tiny=W<320, m={l:46,r:16,t:cfg.contextWindows?.length&&!cfg.hideContextLabels?42:12,b:cfg.stageTrack?44:(cfg.xLabel?46:32)};
  if (cfg.padLeft != null) m.l = cfg.padLeft;
  if (cfg.padRight != null) m.r = cfg.padRight;
  if (cfg.padTop != null) m.t = cfg.padTop;
  if (cfg.padBottom != null) m.b = cfg.padBottom;
  const tickVals=niceTicks(Math.min(...pts.filter(p=>p.y!=null).map(p=>+p.y)),Math.max(...pts.filter(p=>p.y!=null).map(p=>+p.y)));
  const widestY=Math.max(3,...tickVals.map(v=>String(cfg.fmtY?cfg.fmtY(v):fmtN(v)).length));
  if(!cfg.fixedMargins)m.l=Math.max(m.l,Math.min(88,widestY*6.6+14));
  const pw=Math.max(1,W-m.l-m.r), ph=Math.max(1,H-m.t-m.b);
  const bars=cfg.kind!=='line' && cfg.kind!=='scatter';
  const xs=pts.map(p=>p.x).filter(v=>Number.isFinite(Number(v))).map(Number);
  if(cfg.trendPts) for(const p of cfg.trendPts) if(p.y!=null && Number.isFinite(Number(p.x))) xs.push(Number(p.x));
  if(!xs.length){host.innerHTML=`<div class="empty">No plottable timestamps in this range</div>`;return;}
  const x0=Number.isFinite(Number(cfg.xMin))?Number(cfg.xMin):Math.min(...xs);
  const orderedX=[...new Set(xs)].sort((a,b)=>a-b);
  const positiveSteps=orderedX.slice(1).map((v,i)=>v-orderedX[i]).filter(v=>Number.isFinite(v)&&v>0);
  const inferredStep=positiveSteps.length?Math.min(...positiveSteps):(Math.abs(x0)>1e10?DAY:1);
  const barStep=bars?(Number.isFinite(Number(cfg.step))&&Number(cfg.step)>0?Number(cfg.step):inferredStep):0;
  const x1=Number.isFinite(Number(cfg.xMax))?Number(cfg.xMax):Math.max(...xs)+(bars?barStep:0);
  const X=x=>m.l+(x-x0)/((x1-x0)||barStep||1)*pw;
  const ys=pts.flatMap(p=>p.band?[p.band[0],p.band[1]]:[p.y]).filter(v=>v!=null&&!isNaN(v));
  if(cfg.rawPts)for(const p of cfg.rawPts)if(p&&p.y!=null&&Number.isFinite(Number(p.y)))ys.push(Number(p.y));
  if(cfg.avg!=null)ys.push(cfg.avg);
  if(cfg.trendPts) for(const p of cfg.trendPts) if(p.y!=null){ys.push(p.y);if(p.band)ys.push(p.band[0],p.band[1]);}
  if(cfg.bands) for(const b of cfg.bands){ ys.push(b.y1); ys.push(b.y2); }
  if(cfg.thresholds) for(const t of cfg.thresholds){ ys.push(t.y); }
  if(cfg.quadrants){ ys.push(cfg.quadrants.ySplit); }
  let lo=bars?(cfg.yMin!=null?cfg.yMin:0):Math.min(...ys), hi=Math.max(...ys);
  if(cfg.kind==='line' && cfg.yCrop !== false){
    const pad=(hi-lo)*0.08||1; lo-=pad; hi+=pad;
  }
  if(cfg.yMin!=null)lo=cfg.yMin;
  if(cfg.yMax!=null)hi=cfg.yMax;
  if(cfg.target!=null)hi=Math.max(hi,cfg.target);
  if(bars&&cfg.barHeadroom!==false)hi += Math.max((hi-(cfg.yMin??0))*.08, .5);
  if(cfg.negativeTarget!=null)lo=Math.min(lo,cfg.negativeTarget);
  let ticks;
  if(Array.isArray(cfg.yTickValues)&&cfg.yTickValues.length){ticks=cfg.yTickValues.filter(v=>v>=lo&&v<=hi);}
  else if(Number.isFinite(Number(cfg.yTickStep)) && Number(cfg.yTickStep)>0){
    const step=Number(cfg.yTickStep), start=Math.floor(lo/step)*step, end=Math.ceil(hi/step)*step;
    ticks=[]; for(let v=start;v<=end+step*1e-6;v+=step) ticks.push(+v.toFixed(6));
    if(ticks.length<2) ticks=[start,start+step]; lo=ticks[0];hi=ticks[ticks.length-1];
  } else if(!Array.isArray(cfg.yTickValues)||!cfg.yTickValues.length) { ticks=niceTicks(lo,hi);lo=ticks[0];hi=ticks[ticks.length-1]; }
  const Y=v=>m.t+ph-(v-lo)/((hi-lo)||1)*ph;
  const clipId='plot-clip-'+(window._plotClipSeq=(window._plotClipSeq||0)+1),zoneGradientId='karvonenLineGradient-'+window._plotClipSeq;
  let g=cfg.zoneGradientStops?.length?`<defs><linearGradient id="${zoneGradientId}" gradientUnits="userSpaceOnUse" x1="0" y1="${Y(lo)}" x2="0" y2="${Y(hi)}">${cfg.zoneGradientStops.map(st=>`<stop offset="${clamp((Number(st.value)-lo)/Math.max(1e-9,hi-lo),0,1)*100}%" stop-color="${st.color}"/>`).join('')}</linearGradient></defs>`:'';
  if(cfg.stageCurtains?.length){for(const st of cfg.stageCurtains){const a=Math.max(x0,Number(st.start)),b=Math.min(x1,Number(st.end));if(!(b>a))continue;g+=`<rect class="sleep-stage-curtain" clip-path="url(#${clipId})" x="${X(a)}" y="${m.t}" width="${Math.max(0,X(b)-X(a))}" height="${ph}" fill="${st.color}" fill-opacity="${st.opacity??.07}"/>`;} }
  if(cfg.areaBands?.length){for(const area of cfg.areaBands){const a=Math.max(lo,Number(area.y1)),b=Math.min(hi,Number(area.y2));if(!(b>a))continue;g+=`<rect class="chart-reference-area" clip-path="url(#${clipId})" x="${m.l}" y="${Y(b)}" width="${pw}" height="${Math.max(0,Y(a)-Y(b))}" fill="${area.color||'#FB7185'}" fill-opacity="${area.opacity??.035}"/>`;}}
  if(cfg.bands){for(const b of cfg.bands){const bandLo=Math.max(lo,Number(b.y1)),bandHi=Math.min(hi,Number(b.y2));if(!(bandHi>bandLo))continue;g+=`<rect x="${m.l}" y="${Y(bandHi)}" width="${pw}" height="${Math.max(0,Y(bandLo)-Y(bandHi))}" fill="${b.color||'var(--good)'}" fill-opacity="${b.opacity??.08}"/>`;for(const bv of [bandLo,bandHi])g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${Y(bv)}" y2="${Y(bv)}" stroke="${b.color||'var(--good)'}" stroke-opacity=".32" stroke-width="1" stroke-dasharray="${typeof b.dash==='string'?b.dash:(b.dash?.pattern||'4 4')}"/>`;if(b.label){const ly=Y((bandLo+bandHi)/2)+3,lx=b.labelRight?W-m.r-6:m.l+6;g+=`<text x="${lx}" y="${ly}" text-anchor="${b.labelRight?'end':'start'}" fill="${b.labelColor||'rgba(255,255,255,.35)'}" font-size="${b.labelSize||10}" font-weight="${b.labelWeight||600}" letter-spacing=".6">${esc(b.label)}</text>`;}}}
  g+=`<g class="axis">`;
  for(let ti=0;ti<ticks.length;ti++){const t=ticks[ti];if(compact&&ti%2===1&&!cfg.yTickValues)continue;const tickFill=cfg.yTickColorFn?cfg.yTickColorFn(t):(cfg.axisContrast?'rgba(220,225,235,var(--glass-label-opacity,.9))':'var(--axis-text)'),tickWeight=cfg.yTickWeightFn?cfg.yTickWeightFn(t):400;g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${Y(t)}" y2="${Y(t)}" style="stroke:var(--grid);stroke-opacity:${cfg.gridOpacity??1}" stroke-width="1"/><text class="${cfg.axisContrast?'sleep-hr-axis':''}" x="${cfg.axisLabelsInside?m.l+6:m.l-(cfg.yTickGap??8)}" y="${Y(t)+4}" text-anchor="${cfg.axisLabelsInside?'start':'end'}" style="fill:${tickFill};font-size:11px;font-weight:${tickWeight};font-variant-numeric:tabular-nums">${cfg.fmtY?cfg.fmtY(t):fmtN(t)}</text>`;}
  g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${Y(lo)}" y2="${Y(lo)}" style="stroke:var(--axis)"/>`;
  if (cfg.xTicks && cfg.xTicks.length) {
    const isClockAxis = Math.abs(x1-x0) >= 30*60000 && Math.abs(x1-x0) <= 2*DAY && typeof cfg.fmtX === 'function';
    if (isClockAxis && !cfg.fixedClockTicks) {
      const candidateSteps=[15,30,60,120], formatClock=t=>{const d=new Date(t),h=d.getHours()%12||12;return `${h}:${String(d.getMinutes()).padStart(2,'0')}`;};
      const stepMin=candidateSteps.find(mins=>{const step=mins*60000,count=Math.max(1,Math.floor((x1-x0)/step)+1);return pw/count >= formatClock(x0).length*7+16;})||120;
      const step=stepMin*60000,first=Math.ceil(x0/step)*step,ticks=[];
      for(let t=first;t<=x1;t+=step)ticks.push(t);
      let lastPeriod=null;
      for(let i=0;i<ticks.length;i++){const xt=ticks[i],d=new Date(xt),periodLabel=d.getHours()<12?'AM':'PM',change=periodLabel!==lastPeriod,label=formatClock(xt)+(i===0||change?` ${periodLabel}`:'');lastPeriod=periodLabel;g+=`<text x="${X(xt)}" y="${H-8}" text-anchor="middle" style="fill:var(--axis-text);font-size:11px">${label}</text>`;}
    } else {
      const shownTicks=cfg.xTicks.filter(xt=>xt>=x0&&xt<=x1),minGap=Number(cfg.minTickGap)||0;let lastTickX=-Infinity;for(let i=0;i<shownTicks.length;i++){const xt=shownTicks[i],label=cfg.xTickLabel?cfg.xTickLabel(xt):cfg.fmtX(xt),px=X(xt+(bars?barStep/2:0)),labelY=H-m.b+(cfg.xTickDy??24),pad=Number(cfg.xTickPadding)||0,alignedPx=i===0?Math.max(px,m.l+pad):i===shownTicks.length-1?Math.min(px,W-m.r-pad):px;if(minGap&&alignedPx-lastTickX<minGap&&i!==shownTicks.length-1)continue;if(minGap&&i===shownTicks.length-1&&alignedPx-lastTickX<minGap)lastTickX=alignedPx-minGap;g+=`<text x="${alignedPx}" y="${labelY}" text-anchor="middle" style="fill:rgba(200,210,222,var(--glass-label-opacity,.85));font-size:12px;font-variant-numeric:tabular-nums">${esc(label)}</text>`;lastTickX=alignedPx;}
    }
  } else {
    const sampleLabels=[cfg.fmtX?String(cfg.fmtX(x0)):String(x0),cfg.fmtX?String(cfg.fmtX(x1)):String(x1)];const longest=Math.max(4,...sampleLabels.map(v=>v.length));const nx=Math.max(tiny?1:2,Math.floor(pw/(longest*7+16)));
    for(let i=0;i<nx;i++){
      let x=x0+(x1-x0)*(i/(nx-1||1))*(bars?(pts.length-1)/pts.length:1);
      if(bars)x=x0+Math.round((x-x0)/barStep)*barStep+barStep/2;
      g+=`<text x="${X(x)}" y="${H-8}" text-anchor="${i===0?'start':i===nx-1?'end':'middle'}" style="fill:var(--axis-text);font-size:11px">${cfg.fmtX(x-(bars?barStep/2:0))}</text>`;
    }
  }
  g+=`</g><g>`;

  if (cfg.contextWindows?.length) {
    const contextBadgeRows=[[],[]];
    for (const win of cfg.contextWindows) {
      if (win.end < x0 || win.start > x1) continue;
      const xa=X(Math.max(win.start,x0)), xb=X(Math.min(win.end,x1)), ww=Math.max(1,xb-xa);
      g+=`<rect x="${xa}" y="${m.t}" width="${ww}" height="${ph}" fill="${win.color}" fill-opacity="${win.opacity}"/>`;
      const boundaryStroke=win.boundaryColor||win.color,boundaryOpacity=win.boundary===false?0:(win.boundaryOpacity??.22);
      g+=`<line x1="${xa}" x2="${xa}" y1="${m.t-3}" y2="${m.t+ph}" stroke="${boundaryStroke}" stroke-opacity="${boundaryOpacity}" stroke-dasharray="3 4" stroke-width="1"/>`;
      g+=`<line x1="${xb}" x2="${xb}" y1="${m.t-3}" y2="${m.t+ph}" stroke="${boundaryStroke}" stroke-opacity="${boundaryOpacity}" stroke-dasharray="3 4" stroke-width="1"/>`;
      if(!cfg.hideContextLabels){const badgeText=win.topLabel||win.label||'Event',badgeW=Math.min(Math.max(96,badgeText.length*5.8+18),Math.max(96,W-m.l-m.r));
      const bx=Math.max(m.l,Math.min(W-m.r-badgeW,(xa+xb-badgeW)/2));
      g+=`<rect x="${bx}" y="${m.t+3}" width="${badgeW}" height="23" rx="11" fill="#18181B" fill-opacity=".86" stroke="${win.color}" stroke-opacity=".5"/>`;
      g+=`<text class="chart-context-badge" x="${bx+badgeW/2}" y="${m.t+18}" text-anchor="middle" fill="#F4F4F5">${esc(badgeText)}</text>`;}
    }
  } else if (cfg.sleepBands) {
    for (const [a,b] of cfg.sleepBands) {
      if (b < x0 || a > x1) continue;
      const xa = X(Math.max(a,x0)), xb = X(Math.min(b,x1));
      g+=`<rect x="${xa}" y="${m.t}" width="${Math.max(0,xb-xa)}" height="${ph}" fill="#6366F1" fill-opacity=".12"/>`;
    }
  }

  if (cfg.quadrants) {
    const { xSplit, ySplit, fills, labels } = cfg.quadrants;
    const xm = X(xSplit), ym = Y(ySplit);
    const qs = [
      {key:'tl', x:m.l,      y:m.t,       w:xm-m.l,    h:ym-m.t},
      {key:'tr', x:xm,       y:m.t,       w:W-m.r-xm,  h:ym-m.t},
      {key:'bl', x:m.l,      y:ym,        w:xm-m.l,    h:H-m.b-ym},
      {key:'br', x:xm,       y:ym,        w:W-m.r-xm,  h:H-m.b-ym},
    ];
    for (const q of qs) {
      const col = fills?.[q.key];
      if (col) g+=`<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" fill="${col}" fill-opacity=".10"/>`;
    }
    if (labels) {
      if (labels.tl) g+=`<text x="${m.l+8}" y="${m.t+16}" fill="var(--good)" font-size="11" font-weight="600">${labels.tl}</text>`;
      if (labels.br) g+=`<text x="${W-m.r-8}" y="${H-m.b-10}" text-anchor="end" fill="var(--bad)" font-size="11" font-weight="600">${labels.br}</text>`;
    }
    g+=`<line x1="${xm}" x2="${xm}" y1="${m.t}" y2="${H-m.b}" stroke="var(--ink2)" stroke-dasharray="2 4"/>`;
    g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${ym}" y2="${ym}" stroke="var(--ink2)" stroke-dasharray="2 4"/>`;
  }

  const slot=bars?pw*barStep/((x1-x0)||barStep||1):0, bw=Math.min(40,Math.max(2,slot*(1-(Number(cfg.barCategoryGapPct??26)/100))));

  if(cfg.kind==='bar' || cfg.kind==='diverging'){
    const zeroY = cfg.baseline!=null ? Y(cfg.baseline) : Y(lo);
    const barPalette={calories:['#FB923C','#F59E0B'],steps:['#34D399','#10B981'],distance:['#38BDF8','#06B6D4'],act:['#34D399','#10B981'],sedentary:['#7AAEFF','#4B6478'],hourly:['#34D399','#10B981']};
    const barGradient=cfg.barGradient||barPalette[cfg._cardId],barGradientId='bar-fill-'+clipId;
    if(barGradient)g+=`<defs><linearGradient id="${barGradientId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${barGradient[0]}" stop-opacity=".30"/><stop offset="100%" stop-color="${barGradient[1]}" stop-opacity=".05"/></linearGradient></defs>`;
    for(const p of pts) if(p.y!=null && !isNaN(p.y)){
      const x=X(p.x)+(slot-bw)/2;
      const top = Math.min(Y(p.y), zeroY);
      const h = Math.abs(Y(p.y) - zeroY);
      const fill=cfg.barColorFn?cfg.barColorFn(p):cfg.color,gradId=p.y>=0?'temp-positive-gradient':'temp-negative-gradient';
      const barFill=cfg.kind==='diverging'?`url(#${gradId})`:barGradient?`url(#${barGradientId})`:fill;
      if(h>0.3)g+=`<path d="${barPath(x,top,bw,h,cfg.barRadius||4)}" fill="${barFill}" stroke="${cfg.kind==='diverging'||barGradient?'none':fill}" stroke-width="${cfg.kind==='diverging'||barGradient?0:0.7}"/>`;
    }
    if(cfg.kind==='diverging')g=`<defs><linearGradient id="temp-positive-gradient" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#F97316"/><stop offset="1" stop-color="#F59E0B"/></linearGradient><linearGradient id="temp-negative-gradient" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#06B6D4"/><stop offset="1" stop-color="#38BDF8"/></linearGradient></defs>`+g;
    if (cfg.baseline!=null) {
      g+=`<line x1="${m.l}" x2="${W-m.r}" y1="${zeroY}" y2="${zeroY}" style="stroke:${cfg.baselineColor||'rgba(255,255,255,.4)'}" stroke-width="${cfg.baselineWidth||1.5}"/>`;
    }
    if(cfg.baselineMarkers){for(const p of pts.filter(q=>q.y==null)){const cx=X(p.x)+(slot-bw)/2+bw/2;g+=`<circle cx="${cx}" cy="${zeroY}" r="2.2" fill="var(--surface)" stroke="rgba(200,210,222,.5)" stroke-width="1"><title>${esc(p.day||fmtDay(p.x))} · no temperature reading</title></circle>`;}}
  } else if(cfg.kind==='stack'){
    const defsId='nap-hatch-'+Math.random().toString(36).slice(2,7);
    g+=`<defs><pattern id="${defsId}" patternUnits="userSpaceOnUse" width="3" height="3" patternTransform="rotate(45)"><rect width="3" height="3" fill="transparent"/><line x1="0" y1="0" x2="0" y2="3" stroke="var(--page)" stroke-opacity=".25" stroke-width=".7"/></pattern></defs>`;
    for(const p of pts) if(p.parts){
      let acc=0;
      p.parts.forEach((v,i)=>{
        if(!v)return;
        const top=acc+v, x=X(p.x)+(slot-bw)/2;
        const last = i===p.parts.length-1 || p.parts.slice(i+1).every(q=>!q);
        const d = last ? barPath(x,Y(top),bw,Y(acc)-Y(top),4) : `M${x},${Y(acc)}V${Y(top)}H${x+bw}V${Y(acc)}Z`;
        g+=`<path d="${d}" style="fill:${cfg.colors[i]};stroke:var(--surface);stroke-width:2;paint-order:stroke"/>`;
        acc=top;
      });
      if (p.napPart && p.napPart > 0.05) {
        const x=X(p.x)+(slot-bw)/2;
        const yTop=Y(p.y);
        const yBottom=Y(Math.max(0, p.y - p.napPart));
        g+=`<rect x="${x}" y="${yTop}" width="${bw}" height="${Math.max(0,yBottom-yTop)}" fill="url(#${defsId})"/>`;
      }
    }
  } else if(cfg.kind==='scatter'){
    for(const p of pts) if(p.y!=null && !isNaN(p.y) && !isNaN(p.x)){
      const sz = p.size || (cfg.pointSize || 3);
      g+=`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${sz}" style="fill:${p.color||cfg.color};fill-opacity:.65;stroke:var(--surface)" stroke-width="1"><title>${esc(cfg.pointTitle?cfg.pointTitle(p):'')}</title></circle>`;
    }
    if(cfg.fitLine){
      const d=`M${X(cfg.fitLine.x0)},${Y(cfg.fitLine.y0)}L${X(cfg.fitLine.x1)},${Y(cfg.fitLine.y1)}`;
      g+=`<path d="${d}" fill="none" style="stroke:var(--ink2);stroke-width:1.6;stroke-dasharray:4 4"/>`;
    }
  } else {
    if(cfg.areaGradient&&pts.length){const areaId='area-fill-'+clipId,color=cfg.areaColor||'#F43F5E',validArea=pts.filter(p=>p.y!=null&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))),gap=Number(cfg.areaGapMs)||Infinity;let groups=[],group=[];for(const p of validArea){if(group.length&&Number(p.x)-Number(group.at(-1).x)>gap){groups.push(group);group=[];}group.push(p);}if(group.length)groups.push(group);g+=`<defs><linearGradient id="${areaId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="${cfg.areaOpacity??.15}"/><stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>`;for(const run of groups){if(!run.length)continue;const base=Y(lo),coords=run.map(p=>({x:X(p.x),y:Y(p.y)})),curve=cfg.smooth&&coords.length>2?catmullRom(coords,.3):coords,d=`M${coords[0].x},${base}L${curve.map(p=>`${p.x},${p.y}`).join('L')}L${coords.at(-1).x},${base}Z`;g+=`<path class="trend-area-fill" clip-path="url(#${clipId})" d="${d}" fill="url(#${areaId})"/>`;}}
    if(cfg.rawLinePts?.length>1){
      let rawLine='', rawPen=false;
      for(const p of cfg.rawLinePts){ if(p.y==null||!Number.isFinite(Number(p.x))||!Number.isFinite(Number(p.y))){rawPen=false;continue;} rawLine+=`${rawPen?'L':'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`; rawPen=true; }
      g+=`<path class="raw-value-line" clip-path="url(#${clipId})" d="${rawLine}" fill="none" stroke="${cfg.rawLineColor||cfg.color}" stroke-opacity="${cfg.rawLineOpacity??.34}" stroke-width="${cfg.rawLineWidth||1.35}" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
    if(cfg.rawPts && cfg.rawPts.length){
      const stride=Math.max(1,Math.ceil(cfg.rawPts.length/1400));
      const rawDotPaths=new Map();
      for(let i=0;i<cfg.rawPts.length;i+=stride){
        const p=cfg.rawPts[i];
        if(p.y!=null&&Number.isFinite(+p.y)){const stage=String(p.stage||'LIGHT').toUpperCase(),sc=cfg.rawColorFn?cfg.rawColorFn(p):(stage.includes('DEEP')?'#6366F1':stage.includes('REM')?'#38BDF8':stage.includes('AWAKE')?'#F59E0B':'#94A3B8'),radius=Number(cfg.rawPointSize|| (stage.includes('AWAKE')?2:1.5)),opacity=Number(cfg.rawPointOpacity??(stage.includes('AWAKE')?.60:.35)),key=`${sc}|${radius}|${opacity}`;if(!rawDotPaths.has(key))rawDotPaths.set(key,[]);rawDotPaths.get(key).push(`M${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}h0.01`);}
      }
      for(const [key,commands] of rawDotPaths){const [color,radius,opacity]=key.split('|'),glow=cfg.rawPointGlow?` filter="drop-shadow(0 0 3px ${color})"`:'';g+=`<path class="chart-dot ${cfg.rawPointGlow?'sleep-hr-raw-dot':''}" clip-path="url(#${clipId})" d="${commands.join('')}" fill="none" stroke="${color}" stroke-opacity="${opacity}" stroke-width="${Number(radius)*2}" stroke-linecap="round"${glow} pointer-events="none"/>`;}
    }
    if(cfg.gapBridges?.length){for(const gap of cfg.gapBridges){if(!gap||gap.a<x0||gap.b>x1)continue;g+=`<line class="off-wrist-bridge" clip-path="url(#${clipId})" x1="${X(gap.a)}" y1="${Y(gap.ya)}" x2="${X(gap.b)}" y2="${Y(gap.yb)}" stroke="rgba(255,255,255,.22)" stroke-width="1" stroke-dasharray="1 4" stroke-linecap="round"/>`;}}
    if(pts.some(p=>p.band)){
      let up=[],dn=[],runs=[];
      const flush=()=>{ if(up.length>1) runs.push(`M${up.join('L')}L${dn.reverse().join('L')}Z`); up=[]; dn=[]; };
      for(const p of pts){
        if(p.band){ up.push(`${X(p.x)},${Y(p.band[1])}`); dn.push(`${X(p.x)},${Y(p.band[0])}`); }
        else flush();
      }
      flush();
      g+=`<path clip-path="url(#${clipId})" d="${runs.join('')}" style="fill:${cfg.bandColor||cfg.color};opacity:${cfg.bandOpacity??.12}"/>`;
    }
    if(cfg.trendBand!==false&&cfg.trendPts?.some(p=>p.band)){
      let run=[];
      const flushTrendBand=()=>{if(run.length>2){const upper=run.map(p=>({x:X(p.x),y:Y(p.band[1])})),lower=run.slice().reverse().map(p=>({x:X(p.x),y:Y(p.band[0])})),d=monotoneSplinePath(upper)+monotoneSplinePath(lower,false)+'Z';g+=`<path class="historical-range-ribbon" clip-path="url(#${clipId})" d="${d}" fill="${cfg.trendBandColor||'#818CF8'}" fill-opacity="${cfg.trendBandOpacity??.07}"/>`;}run=[];};
      for(const p of cfg.trendPts){if(p.y==null||!p.band){flushTrendBand();continue;}run.push(p);}flushTrendBand();
    }
    if(cfg.trendPts && cfg.trendPts.length>1 && cfg.trendLine!==false){
      let run=[];const flushTrend=()=>{if(run.length>1){const coords=run.map(p=>({x:X(p.x),y:Y(p.y)})),curve=cfg.trendSmooth&&coords.length>2?catmullRom(coords,.3):coords,td=curve.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');g+=`<path clip-path="url(#${clipId})" d="${td}" fill="none" style="stroke:${cfg.trendColor||'var(--trend)'};stroke-width:1.7;stroke-dasharray:6 4;stroke-linecap:round"/>`;}run=[];};
      for(const p of cfg.trendPts){if(p.y==null||!Number.isFinite(Number(p.y))){flushTrend();continue;}run.push(p);}flushTrend();
    }
    const valid = pts.filter(p=>p.y!=null && !isNaN(p.y)).map(p=>({x:X(p.x), y:Y(p.y)}));
    const lineStroke=cfg.zoneGradientStops?.length?`url(#${zoneGradientId})`:cfg.color;
    if(cfg.zoneColored){
      for(let i=1;i<pts.length;i++){
        const a=pts[i-1], b=pts[i];
        if(a.y==null || b.y==null || !Number.isFinite(Number(a.y)) || !Number.isFinite(Number(b.y))) continue;
        const z=ZONE_DEFS[(b.zone||1)-1] || ZONE_DEFS[0];
        g+=`<line x1="${X(a.x).toFixed(1)}" y1="${Y(a.y).toFixed(1)}" x2="${X(b.x).toFixed(1)}" y2="${Y(b.y).toFixed(1)}" stroke="${z.color}" stroke-width="2.4" stroke-linecap="round" ${cfg.lineGlowFilter?`filter="${cfg.lineGlowFilter}"`:''}/>`;
      }
    }
    else if(cfg.smooth && valid.length > 2){
      const smoothPts = catmullRom(valid, 0.3);
      let d = smoothPts.map((p,i)=>`${i?'L':'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('');
      const glowAttr = cfg.lineGlowFilter ? `filter="${cfg.lineGlowFilter}"` : 'filter="drop-shadow(0px 2px 6px rgba(244,63,94,.4))"';
      g+=`<path class="main-trend-line" d="${d}" fill="none" style="stroke:${lineStroke}" stroke-width="${cfg.lineWidth||2.5}" stroke-linejoin="round" stroke-linecap="round" ${glowAttr}/>`;
    } else if(!cfg.zoneColored) {
      let d='',pen=false;
      for(const p of pts){ if(p.y==null||isNaN(p.y)){pen=false;continue;} d+=`${pen?'L':'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`; pen=true; }
      const glowAttr = cfg.lineGlowFilter ? `filter="${cfg.lineGlowFilter}"` : 'filter="drop-shadow(0px 2px 6px rgba(244,63,94,.4))"';
      g+=`<path class="main-trend-line" d="${d}" fill="none" style="stroke:${lineStroke}" stroke-width="${cfg.lineWidth||2.5}" stroke-linejoin="round" stroke-linecap="round" ${glowAttr}/>`;
    }
    const drawScatter = cfg.scatter || pts.filter(p=>p.y!=null).length <= 60;
    if(drawScatter && !cfg.zoneColored) for(const p of pts) if(p.y!=null && !isNaN(p.y)){
      const stage=String(p.stage||'').toUpperCase(),pointColor=stage.includes('REM')?'#38BDF8':stage.includes('LIGHT')?'#94A3B8':stage.includes('DEEP')?'#6366F1':stage.includes('AWAKE')?'#F59E0B':cfg.color;
      g+=`<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${cfg.scatter ? 2 : 3}" style="fill:${pointColor};fill-opacity:${cfg.scatter?'.55':'1'};stroke:var(--surface)" stroke-width="${cfg.scatter?'.35':'1.5'}"><title>${esc(cfg.pointTitle ? cfg.pointTitle(p) : `${fmtTime(p.x)}: ${p.y}`)}</title></circle>`;
    }
  }

  if (cfg.thresholds) {
    for (const t of cfg.thresholds) {
      const yy = Y(t.y);
      g+=`<g style="pointer-events:none"><line x1="${m.l}" x2="${W-m.r}" y1="${yy}" y2="${yy}" stroke="${t.color||'var(--warn)'}" stroke-opacity="${cfg.referenceLineOpacity??1}" class="thr-line" ${t.dash?`stroke-dasharray="${t.dash}"`:''}/>`;
      if(cfg.thresholdPills&&t.label){const pillW=104,pillH=20,px=t.pillSide==='left'?m.l+6:W-m.r-pillW-6,py=Math.max(m.t+2,Math.min(m.t+ph-pillH,yy-pillH/2)),text=t.pillText||t.label,fill=t.color||'#A1A1AA';g+=`<rect x="${px}" y="${py}" width="${pillW}" height="${pillH}" rx="9" fill="${fill}" fill-opacity=".10" stroke="${fill}" stroke-opacity=".30" stroke-width="1"/><text x="${px+pillW/2}" y="${py+13.5}" text-anchor="middle" fill="${fill}" font-size="9.5" font-weight="700" font-variant-numeric="tabular-nums">${esc(text)}</text>`;}
      else if (t.label && !compact){const tx=t.labelSide==='left'?m.l+4:W-m.r-2;g+=`<text x="${tx}" y="${Math.max(m.t+10,yy-4)}" text-anchor="${t.labelSide==='left'?'start':'end'}" fill="${t.color||'var(--warn)'}" font-size="${t.labelSize||11}" font-weight="${t.labelWeight||600}">${esc(t.label)}</text>`;}
      g+=`</g>`;
    }
  }
  if(cfg.target!=null && !cfg.thresholds){
    const yy=Y(cfg.target),targetLabel=cfg.targetLabel||'target '+cfg.fmtY(cfg.target),px=cfg.targetPillInside?W-m.r-110:W-m.r+6;
    const badge=cfg.targetPill?`<rect x="${px}" y="${Math.max(m.t+2,Math.min(m.t+ph-20,yy-10))}" width="104" height="20" rx="10" fill="rgba(21,31,41,.92)" stroke="${cfg.targetColor||'var(--good)'}" stroke-opacity=".52" filter="drop-shadow(0 0 6px rgba(133,217,165,.32))"/><text x="${px+52}" y="${Math.max(m.t+15,Math.min(m.t+ph-6,yy+3))}" text-anchor="middle" fill="${cfg.targetColor||'var(--good)'}" font-size="9.5" font-weight="700" font-variant-numeric="tabular-nums">${esc(targetLabel)}</text>`:'';
    g+=`<g style="pointer-events:none"><line x1="${m.l}" x2="${W-m.r}" y1="${yy}" y2="${yy}" stroke="${cfg.targetColor||'var(--good)'}" stroke-width="1.3" stroke-dasharray="${cfg.targetDash||'5 4'}" ${cfg.targetGlow?'filter="drop-shadow(0 0 5px rgba(133,217,165,.48))"':''}/>${cfg.targetPill?badge:compact?'':`<text x="${W-m.r-2}" y="${Math.max(m.t+10,yy-4)}" text-anchor="end" fill="${cfg.targetColor||'var(--good)'}" font-size="11">${esc(targetLabel)}</text>`}</g>`;
  }
  if(cfg.negativeTarget!=null){
    const yy=Y(cfg.negativeTarget);
    g+=`<g style="pointer-events:none"><line x1="${m.l}" x2="${W-m.r}" y1="${yy}" y2="${yy}" stroke="var(--bad)" stroke-width="1.2" stroke-dasharray="5 4"/><text x="${W-m.r-2}" y="${yy+12}" text-anchor="end" fill="var(--bad)" font-size="11">${esc(cfg.negativeTargetLabel||('−'+Math.abs(cfg.negativeTarget).toFixed(2))) }</text></g>`;
  }
  g+=`</g>`;

  if(cfg.avg!=null && cfg.kind!=='scatter'){
    const avgY = Math.max(m.t+12, Math.min(Y(cfg.avg)-6, m.t+ph-4));
    const avgColor=cfg.avgColor||'var(--ink2)',avgLabel=cfg.avgLabel||'avg';
    const avgPillX=cfg.avgPillInside?(cfg.avgPillSide==='left'?m.l+6:W-m.r-110):W-m.r+6,avgPillY=cfg.avgPillTop?m.t+4:Math.max(m.t+2,Math.min(m.t+ph-20,Y(cfg.avg)-32));
    const avgPillFill=cfg.avgPillGlass?'rgba(15,20,28,.76)':'rgba(21,31,41,.92)';
    const avgPill=cfg.avgPill?`<rect x="${avgPillX}" y="${avgPillY}" width="104" height="20" rx="10" fill="${avgPillFill}" stroke="${avgColor}" stroke-opacity=".65" stroke-width="1" filter="drop-shadow(0 0 5px rgba(103,232,249,.22))"/><circle cx="${avgPillX+10}" cy="${avgPillY+10}" r="3" fill="${avgColor}"/><text x="${avgPillX+57}" y="${avgPillY+13.5}" text-anchor="middle" fill="#F4F4F5" font-size="9.5" font-weight="700" font-variant-numeric="tabular-nums">${esc(cfg.avgPillText||`${Number(cfg.avg).toFixed(1)} BPM AVG`)}</text>`:'';
    g+=`<g style="pointer-events:none"><line x1="${m.l}" x2="${W-m.r}" y1="${Y(cfg.avg)}" y2="${Y(cfg.avg)}" stroke="${avgColor}" stroke-opacity="${cfg.avgLineOpacity??cfg.referenceLineOpacity??1}" stroke-width="${cfg.avgWidth||1.2}" stroke-dasharray="${cfg.avgDash||'1 4.5'}" stroke-linecap="round" ${cfg.avgLineFilter?`filter="${cfg.avgLineFilter}"`: ''}/>${cfg.avgPill?avgPill:(cfg.avgLineOnly?'':compact?'':`<text x="${W-m.r}" y="${avgY}" text-anchor="end" style="fill:${avgColor};font-size:11px;font-family:var(--font-mono);stroke:var(--surface);stroke-width:3px;paint-order:stroke">${esc(avgLabel)} ${cfg.fmtAvg}</text>`)}</g>`;
  }

  if (cfg.extrema) {
    for (const ex of cfg.extrema) {
      if (!ex || !Number.isFinite(Number(ex.x)) || !Number.isFinite(Number(ex.y))) continue;
      const xx=X(ex.x), yy=Y(ex.y), color=ex.color||(ex.type==='max'?'#EF4444':'#22D3EE');
      const label=ex.label||`${ex.type==='max'?'MAX':'MIN'} ${Number(ex.y).toFixed(0)}`,bw=ex.glassBadge?70:68,bh=20,bx=Math.max(m.l,Math.min(W-m.r-bw,xx-bw/2)),by=ex.above?Math.max(m.t+2,yy-bh-10):Math.max(m.t+2,Math.min(m.t+ph-bh,yy+10));
      if(ex.glassBadge){const stemY=ex.above?by+bh:by;g+=`<line x1="${xx}" x2="${xx}" y1="${ex.above?stemY:yy+5}" y2="${ex.above?yy-5:stemY}" stroke="${color}" stroke-width="1.2"/><circle cx="${xx}" cy="${yy}" r="5.5" fill="rgba(15,20,28,.95)" stroke="${color}" stroke-width="3" tabindex="0"><title>${ex.type==='max'?'Highest':'Lowest'} heart rate: ${Number(ex.y).toFixed(1)} bpm · ${fmtTime(ex.x)}</title></circle><circle cx="${xx}" cy="${yy}" r="2" fill="#FFFFFF"/>`;
      }else g+=`<circle cx="${xx}" cy="${yy}" r="4.5" fill="${color}" stroke="#FFFFFF" stroke-width="1.4" tabindex="0"><title>${ex.type==='max'?'Highest':'Lowest'} heart rate: ${Number(ex.y).toFixed(1)} bpm · ${fmtTime(ex.x)}</title></circle>`;
      g+=`<rect class="peak-badge-${ex.type}" x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="10" fill="${ex.glassBadge?'rgba(15,20,28,.76)':color}" fill-opacity="${ex.glassBadge?1:.20}" stroke="${color}" stroke-opacity=".8" stroke-width="1" filter="drop-shadow(0 3px 8px rgba(0,0,0,.25))"/><text x="${bx+bw/2}" y="${by+13.5}" text-anchor="middle" fill="#FFFFFF" font-size="9.5" font-weight="700">${esc(label)}</text>`;
    }
  }
  if(Number.isFinite(Number(cfg.nowX))&&cfg.nowX>=x0&&cfg.nowX<=x1){const nx=X(cfg.nowX),label=cfg.nowLabel||'NOW',w=38;g+=`<g class="now-cursor" pointer-events="none"><line x1="${nx}" x2="${nx}" y1="${m.t}" y2="${m.t+ph}" stroke="#67E8F9" stroke-width="1.2" stroke-opacity=".82" filter="drop-shadow(0 0 4px rgba(103,232,249,.7))"/><rect x="${Math.max(m.l,Math.min(W-m.r-w,nx-w/2))}" y="${Math.max(1,m.t-24)}" width="${w}" height="18" rx="9" fill="rgba(15,20,28,.82)" stroke="rgba(103,232,249,.55)"/><text x="${Math.max(m.l,Math.min(W-m.r-w,nx-w/2))+w/2}" y="${Math.max(1,m.t-12)}" text-anchor="middle" fill="#CFFAFE" font-size="9" font-weight="700">${esc(label)}</text></g>`;}
  if (cfg.eventMarkers) {
    for (const ev of cfg.eventMarkers) {
      if (ev.x < x0 || ev.x > x1) continue;
      const xx = X(ev.x);
      g+=`<circle cx="${xx}" cy="${m.t-4}" r="4" fill="${ev.color||'var(--ink2)'}" stroke="var(--surface)" stroke-width="1"><title>${esc(ev.label)}</title></circle>`;
    }
  }

  if(cfg.stageTrack?.length){const sy=m.t+ph+6,sh=8;g+=`<text x="${m.l-8}" y="${sy+7}" text-anchor="end" fill="#A1A1AA" font-size="9">Stage</text><rect x="${m.l}" y="${sy}" width="${pw}" height="${sh}" rx="4" fill="#18181B"/>`;for(const st of cfg.stageTrack){const a=Math.max(x0,Number(st.start)),b=Math.min(x1,Number(st.end));if(!(b>a))continue;const xx=X(a),ww=Math.max(0,X(b)-xx-1);if(ww>0)g+=`<rect x="${xx+.5}" y="${sy}" width="${ww}" height="${sh}" rx="4" fill="${st.color}" stroke="#111113" stroke-width="1"><title>${esc(st.type||'Sleep stage')}</title></rect>`;}}

  if (cfg.syncGroup) {
    g+=`<line class="sync-line" x1="0" x2="0" y1="${m.t}" y2="${m.t+ph}"/>`;
  }

  g+=`<g id="hv"></g><rect id="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
  host.insertAdjacentHTML('beforeend',`<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="overflow:hidden" role="img" tabindex="0" aria-label="${esc(cfg.label||'Health chart')}"><defs><clipPath id="${clipId}"><rect x="${m.l}" y="${m.t}" width="${pw}" height="${ph}"/></clipPath></defs>${g}</svg>`);

  const svg=host.querySelector('svg'), hv=svg.querySelector('#hv'), card=host.closest('.card');
  let tip=card ? card.querySelector('.tip') : null;
  if (!tip && card) { tip=document.createElement('div'); tip.className='tip'; card.appendChild(tip); }
  const valid=pts.filter(p=>(p.y!=null&&!isNaN(p.y))||p.parts);

  if (cfg.syncGroup) {
    window._syncRegistry[cfg.syncGroup] = window._syncRegistry[cfg.syncGroup] || [];
    window._syncRegistry[cfg.syncGroup].push({ svg, m, pw, host });
    host._syncGroup = cfg.syncGroup;
  }

  svg.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End','Enter'].includes(e.key))return;const items=valid;if(!items.length)return;e.preventDefault();let i=Number(svg.dataset.focusIndex||0);if(e.key==='Home')i=0;else if(e.key==='End')i=items.length-1;else if(e.key==='ArrowLeft')i=Math.max(0,i-1);else if(e.key==='ArrowRight')i=Math.min(items.length-1,i+1);svg.dataset.focusIndex=String(i);const p=items[i];const live=document.getElementById('srAnnounce');if(live)live.textContent=cfg.tip?cfg.tip(p).replace(/<[^>]+>/g,' '):`${cfg.label||'Chart point'} ${cfg.fmtX?cfg.fmtX(p.x):p.x}: ${p.y}`;if(e.key==='Enter'&&p.day){window._selectedDetailDay=p.day;const d=document.getElementById('srAnnounce');if(d)d.textContent+='; selected day '+p.day;}});
    svg.querySelector('#hit').addEventListener('click',e=>{if(e.detail>1)return;const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)*(W/r.width);let best=null,bd=Infinity;for(const p of valid){const d=Math.abs(X(p.x)+slot/2-px);if(d<bd){bd=d;best=p;}}if(!best)return;let day=best.day;if(!day&&Number(best.x)>1e11)day=localDateKey(Number(best.x));if(day)openDayDetail(day,cfg.label||'Chart');});
  let dragStart=null;
  const hit=svg.querySelector('#hit');
  hit.addEventListener('pointerdown',e=>{if(e.button!==0)return;const r=svg.getBoundingClientRect();dragStart={px:(e.clientX-r.left)*(W/r.width),clientX:e.clientX};try{hit.setPointerCapture(e.pointerId);}catch(_){};});
  hit.addEventListener('pointermove',e=>{if(!dragStart)return;const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)*(W/r.width),left=Math.min(dragStart.px,px),width=Math.abs(px-dragStart.px);hv.innerHTML=`<rect x="${left}" y="${m.t}" width="${Math.max(1,width)}" height="${ph}" fill="var(--accent)" fill-opacity=".14" stroke="var(--accent)" stroke-dasharray="4 3"/>`;});
  hit.addEventListener('pointerup',e=>{if(!dragStart)return;const r=svg.getBoundingClientRect(),px=(e.clientX-r.left)*(W/r.width),a=Math.min(dragStart.px,px),b=Math.max(dragStart.px,px),minX=x0+((a-m.l)/pw)*(x1-x0),maxX=x0+((b-m.l)/pw)*(x1-x0);dragStart=null;hv.innerHTML='';if(b-a>16&&Number.isFinite(minX)&&Number.isFinite(maxX)&&maxX>minX){window._chartZoom=window._chartZoom||{};window._chartZoom[cfg._cardId]={min:minX,max:maxX};renderCardByElement(card,true);}});
  svg.addEventListener('dblclick',e=>{if(window._chartZoom?.[cfg._cardId]){delete window._chartZoom[cfg._cardId];e.preventDefault();renderCardByElement(card,true);}});
  let selectorTimer=null;
  const byScreenX=(items,x)=>{let lo=0,hi=items.length;while(lo<hi){const mid=(lo+hi)>>1;if(items[mid].sx<x)lo=mid+1;else hi=mid;}return lo;};
  const hoverData=valid.filter(p=>p.y!=null&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))).map(p=>({p,sx:X(p.x)+slot/2})).sort((a,b)=>a.sx-b.sx);
  const hoverRaw=(cfg.rawPts||[]).filter(p=>p.y!=null&&Number.isFinite(Number(p.x))&&Number.isFinite(Number(p.y))).map(p=>({p,sx:X(p.x),sy:Y(p.y)})).sort((a,b)=>a.sx-b.sx);
  let lastHoveredPoint=null,scheduledPointer=null,selectorFrame=0;
  const updateSelector=(clientX,clientY)=>{
    const r=svg.getBoundingClientRect(),px=(clientX-r.left)*(W/r.width),py=(clientY-r.top)*(H/r.height);
    const dataIndex=byScreenX(hoverData,px);let bestEntry=hoverData[Math.min(dataIndex,hoverData.length-1)];
    if(dataIndex>0&&bestEntry&&Math.abs(hoverData[dataIndex-1].sx-px)<=Math.abs(bestEntry.sx-px))bestEntry=hoverData[dataIndex-1];
    let best=bestEntry?.p||null,rawBest=null,rawDist=1e18;
    if(hoverRaw.length){const rawIndex=byScreenX(hoverRaw,px);if(cfg.timelineCrosshair){let entry=hoverRaw[Math.min(rawIndex,hoverRaw.length-1)];if(rawIndex>0&&entry&&Math.abs(hoverRaw[rawIndex-1].sx-px)<=Math.abs(entry.sx-px))entry=hoverRaw[rawIndex-1];rawBest=entry?.p||null;}else{const radius=12*W/r.width;for(let i=rawIndex-1;i>=0&&px-hoverRaw[i].sx<=radius;i--){const q=hoverRaw[i],dx=q.sx-px,dy=q.sy-py,d=dx*dx+dy*dy;if(d<rawDist){rawDist=d;rawBest=q.p;}}for(let i=rawIndex;i<hoverRaw.length&&hoverRaw[i].sx-px<=radius;i++){const q=hoverRaw[i],dx=q.sx-px,dy=q.sy-py,d=dx*dx+dy*dy;if(d<rawDist){rawDist=d;rawBest=q.p;}}if(rawDist>radius*radius)rawBest=null;}}
    if(cfg.rawPointHoverOnly&&!rawBest){hv.innerHTML='';if(tip)tip.style.display='none';return;}
    if(rawBest){best={...rawBest,x:rawBest.x,y:rawBest.y,_rawPoint:true};if(cfg.timelineCrosshair){const meanX=X(rawBest.x)+slot/2,meanIndex=byScreenX(hoverData,meanX);let entry=hoverData[Math.min(meanIndex,hoverData.length-1)];if(meanIndex>0&&entry&&Math.abs(hoverData[meanIndex-1].sx-meanX)<=Math.abs(entry.sx-meanX))entry=hoverData[meanIndex-1];best._timelineMean=entry?.p||null;}}
    if(!best)return;
    const identity=rawBest||best;if(identity===lastHoveredPoint&&(!tip||tip.style.display==='block'))return;lastHoveredPoint=identity;
    const cx=X(best.x)+slot/2;
    if(bars){
      hv.innerHTML=`<rect x="${X(best.x)}" y="${m.t}" width="${slot}" height="${ph}" style="fill:var(--wash)"/>`;
    } else if(cfg.timelineCrosshair){
      const meanPoint=best._timelineMean,meanY=meanPoint?.y!=null?Y(meanPoint.y):Y(best.y),stageColor=cfg.rawColorFn?cfg.rawColorFn(best):'#67E8F9';
      hv.innerHTML=`<line x1="${X(best.x)}" x2="${X(best.x)}" y1="${m.t}" y2="${m.t+ph}" stroke="rgba(226,232,240,.58)" stroke-width="1" stroke-dasharray="2 4"/><circle cx="${X(best.x)}" cy="${meanY}" r="5" fill="rgba(15,20,28,.92)" stroke="${stageColor}" stroke-width="2.5"/><circle cx="${X(best.x)}" cy="${meanY}" r="2" fill="#E2E8F0"/>`;
    } else if(best.y!=null && !isNaN(best.y)){
      hv.innerHTML=`<line x1="${X(best.x)}" x2="${X(best.x)}" y1="${m.t}" y2="${m.t+ph}" style="stroke:#FAFAFA;stroke-opacity:.3;stroke-dasharray:3 4"/><line x1="${m.l}" x2="${W-m.r}" y1="${Y(best.y)}" y2="${Y(best.y)}" style="stroke:#FAFAFA;stroke-opacity:.3;stroke-dasharray:3 4"/><circle cx="${X(best.x)}" cy="${Y(best.y)}" r="${best._rawPoint?5:4.5}" style="fill:${best._rawPoint?'#F59E0B':cfg.color};stroke:#FAFAFA" stroke-width="1.5"/>`;
    } else { hv.innerHTML=''; }
    if (tip) {
      tip.classList.toggle('sleep-hr-glass-tip',!!cfg.timelineCrosshair);
      tip.innerHTML=cfg.timelineCrosshair&&cfg.timelineTip?cfg.timelineTip(best):(best._rawPoint?(cfg.rawTip?cfg.rawTip(best):`<b>${fmtDayLong(best.x)}, ${fmtTime(best.x)}</b>${tipRow('Raw reading',Number(best.y).toFixed(1)+(cfg.rawUnit||''))}`):(cfg.tip?cfg.tip(best):''));
      tip.style.display='block';
      const cr=card.getBoundingClientRect(), sr=svg.getBoundingClientRect();
      let left=sr.left-cr.left+cx*(sr.width/W)+14;
      if(left+tip.offsetWidth>cr.width-8)left=left-tip.offsetWidth-28;
      tip.style.left=Math.max(8,left)+'px';
      tip.style.top=Math.max(6,Math.min(card.clientHeight-tip.offsetHeight-6,sr.top-cr.top+m.t+6))+'px';
    }
    if (cfg.syncGroup) {
      const norm = (best.x - x0) / ((x1 - x0) || 1);
      window._broadcastSync(cfg.syncGroup, norm);
    }
    const sr2=$('#srAnnounce'); if(sr2 && best.y!=null) sr2.textContent=cfg.timelineCrosshair?`${fmtTime(best.x)}: ${best._timelineMean?.y?.toFixed(1)||'—'} bpm, ${sleepStageKey(best.stage)} stage`:`${fmtDayLong(best.x)}, ${fmtTime(best.x)}: ${best.y}`;
  };
  const pointerHit=svg.querySelector('#hit');
  pointerHit.addEventListener('pointermove',e=>{
    scheduledPointer={x:e.clientX,y:e.clientY};
    if(selectorFrame)return;
    selectorFrame=requestAnimationFrame(()=>{
      selectorFrame=0;const point=scheduledPointer;scheduledPointer=null;if(!point)return;
      if(cfg.selectorDelayMs){clearTimeout(selectorTimer);selectorTimer=setTimeout(()=>{if(pointerHit.matches(':hover'))updateSelector(point.x,point.y);},cfg.selectorDelayMs);return;}
      updateSelector(point.x,point.y);
    });
  });
  pointerHit.addEventListener('pointerleave',()=>{
    if(selectorFrame)cancelAnimationFrame(selectorFrame);selectorFrame=0;scheduledPointer=null;lastHoveredPoint=null;
    clearTimeout(selectorTimer);
    hv.innerHTML='';
    if (tip) tip.style.display='none';
    if (cfg.syncGroup) window._clearSync(cfg.syncGroup);
  });
}

/* Workout charts: floating metadata for every SVG point/bar/interval with a <title>. */
(function installWorkoutHoverTooltips(){
  let tip;
  const getTip=()=>{if(!tip){tip=document.createElement('div');tip.className='workout-hover-tip';tip.setAttribute('role','status');document.body.appendChild(tip);}return tip;};
  const pointTitle=el=>{
    if(!el)return '';
    const direct=el.querySelector?.(':scope > title')?.textContent;
    if(direct)return direct.trim();
    const parent=el.closest?.('g');
    return parent?.querySelector?.(':scope > title')?.textContent?.trim()||'';
  };
  const isWorkoutChart=el=>!!el?.closest?.('#charts #card-workoutEfficiency, #charts #card-workoutLoad, #charts #card-workoutVo2, #charts #card-workoutTimeline, #workouts #card-workoutLoad, #workouts .workout-visual-grid .workout-feature');
  document.addEventListener('pointerover',e=>{
    const mark=e.target.closest?.('circle,rect,path,line');if(!mark||!isWorkoutChart(mark))return;
    const text=pointTitle(mark);if(!text)return;
    const t=getTip(),lines=text.split('\n');
    t.innerHTML='<strong>'+esc(lines.shift()||'Workout detail')+'</strong><div class="tip-meta">'+esc(lines.join('\n'))+'</div>';
    t.style.display='block';
    const x=Math.min(e.clientX+14,window.innerWidth-t.offsetWidth-10),y=Math.min(e.clientY+14,window.innerHeight-t.offsetHeight-10);
    t.style.left=Math.max(10,x)+'px';t.style.top=Math.max(10,y)+'px';
  });
  document.addEventListener('pointermove',e=>{if(!tip||tip.style.display!=='block')return;const x=Math.min(e.clientX+14,window.innerWidth-tip.offsetWidth-10),y=Math.min(e.clientY+14,window.innerHeight-tip.offsetHeight-10);tip.style.left=Math.max(10,x)+'px';tip.style.top=Math.max(10,y)+'px';});
  document.addEventListener('pointerout',e=>{if(!isWorkoutChart(e.target))return;const related=e.relatedTarget;if(related&&isWorkoutChart(related)&&e.target.closest('svg')===related.closest?.('svg'))return;if(tip)tip.style.display='none';});
})();

