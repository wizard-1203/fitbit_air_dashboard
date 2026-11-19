/* ============================================================
   DATA HELPERS
   ============================================================ */
function dailyPts(metric){
  const rows=D.daily[metric]||[], byDay=Object.fromEntries(rows);
  const out=[], end=dayMs(D.today);
  for(let x=end-(days-1)*DAY;x<=end;x+=DAY){
    const d=new Date(x), key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    out.push({x, day:key, y:byDay[key]??null});
  }
  return out;
}
function lastVal(metric){
  const rows=D.daily[metric]||[];
  return rows.length ? rows[rows.length-1][1] : null;
}
function avgLastN(metric,n=7){
  const rows=D.daily[metric]||[];
  if(!rows.length) return null;
  return mean(rows.slice(-n).map(r=>r[1]));
}
function dailyVals(metric, n=30){
  return (D.daily[metric]||[]).slice(-n).map(r=>r[1]).filter(Number.isFinite);
}
function splitHtml(st,color,note,metric='hr24',title='',takeaway=''){
  if(!st||!st.n)return '';
  const cfg=AVERAGE_SPLIT_CONFIG[metric]||AVERAGE_SPLIT_CONFIG.hr24;
  const pb=st.b/st.n*100,pe=st.e/st.n*100,pa=st.a/st.n*100;
  const pct=v=>`${Math.round(v)}%`;
  const belowColor=cfg.polarity==='neutral'?'#A1A1AA':cfg.polarity==='lower'?'#10B981':'#F59E0B';
  const aboveColor=cfg.polarity==='neutral'?'#D4D4D8':cfg.polarity==='lower'?'#F59E0B':'#10B981';
  const belowValues=st.values.filter(v=>v<st.avg-st.tolerance).length, onValues=st.e, aboveValues=st.values.filter(v=>v>st.avg+st.tolerance).length;
  const timeBased=metric==='hr24'||metric==='sleepHr';
  const duration=count=>timeBased&&st.n?` · approx ${hm(count/st.n*(Number(note.match(/(\d+(?:\.\d+)?) hours?/)?.[1]||24)*60))}`:'';
  const judgment=cfg.polarity==='neutral'?'Heart rate includes activity, so the split is descriptive rather than good or bad.':(pb>=pa?(cfg.polarity==='lower'?'Mostly below average, which is generally favorable for this metric.':'Mostly below average; higher HRV/SpO₂ is generally preferred.'): (cfg.polarity==='lower'?'Mostly above average, worth monitoring in context.':'Mostly above average, generally favorable for this metric.'));
  const tip=(label,percent,count)=>`${label}: ${percent.toFixed(1)}% · ${count} of ${st.n} readings`;
  return `<div class="avg-split" data-average-split="${metric}" data-below="${belowValues}" data-on="${onValues}" data-above="${aboveValues}" data-n="${st.n}">
    ${title?`<h4 class="avg-split-title">${esc(title)}</h4>`:''}
    <div class="avg-split-bar" role="group" aria-label="${esc(cfg.label)} readings relative to average">
      <button type="button" class="avg-segment below" data-split="below" style="width:${pb}%;--seg:${belowColor}" aria-label="Below average, ${pct(pb)}" title="${esc(tip('Below average',pb,belowValues))}"><span>${pb>=8?pct(pb):''}</span></button>
      <button type="button" class="avg-segment on" data-split="on" style="width:${pe}%;--seg:#8A8A8A" aria-label="On average, ${pct(pe)}" title="${esc(tip('On average',pe,onValues))}"><span>${pe>=8?pct(pe):''}</span></button>
      <button type="button" class="avg-segment above" data-split="above" style="width:${pa}%;--seg:${aboveColor}" aria-label="Above average, ${pct(pa)}" title="${esc(tip('Above average',pa,aboveValues))}"><span>${pa>=8?pct(pa):''}</span></button>
    </div>
    <div class="avg-split-labels"><span>▼ Below <b>${pct(pb)}</b></span><span>● On avg <b>${pct(pe)}</b></span><span>▲ Above <b>${pct(pa)}</b></span></div>
    <div class="avg-split-summary">${takeaway||judgment}</div><div class="avg-split-note">${note||''}</div>
  </div>`;
}

const deltaText = (cur, avg, abs=false, higherIsBetter=true)=>{
  if(cur==null||avg==null)return '';
  const diff = abs ? cur-avg : (cur-avg)/avg*100;
  const significant = Math.abs(diff) >= (abs?0.5:1);
  let cls = 'neutral';
  if (significant) {
    const favorable = higherIsBetter ? diff > 0 : diff < 0;
    cls = favorable ? 'up' : 'down';
  }
  return `<span class="delta ${cls}">${diff>0?'▲':'▼'} ${Math.abs(diff).toFixed(0)}${abs?'':'%'}</span>`;
};

/* ============================================================
   ZONES
   ============================================================ */
const ZONE_DEFS = [
  {id:'z1', label:'Zone 1', name:'Recovery / Light', color:'var(--z1)', desc:'Below 60% heart-rate reserve'},
  {id:'z2', label:'Zone 2', name:'Aerobic / Moderate', color:'var(--z2)', desc:'60–70% heart-rate reserve'},
  {id:'z3', label:'Zone 3', name:'Tempo', color:'var(--z3)', desc:'70–80% heart-rate reserve'},
  {id:'z4', label:'Zone 4', name:'Threshold', color:'var(--z4)', desc:'80–90% heart-rate reserve'},
  {id:'z5', label:'Zone 5', name:'Peak', color:'var(--z5)', desc:'90–100% heart-rate reserve'},
];
function makeZoneOf(){
  const age = Number(D.settings?.age) || null;
  const zone = D.zone_limits || {};
  const rhr = Number(zone.rhr) || lastVal('resting_hr') || 60;
  // Prefer the server's personalized run-aware max-HR value; retain a fallback for older payloads.
  const hrMax = Number(zone.max_hr) || (age ? 208 - 0.7*age : 190);
  const hrr = hrMax - rhr;
  const thresh = [0.60, 0.70, 0.80, 0.90];
  return function(bpm){
    const pct = (bpm - rhr) / (hrr || 1);
    for (let i = 0; i < thresh.length; i++) if (pct < thresh[i]) return i + 1;
    return 5;
  };
}

