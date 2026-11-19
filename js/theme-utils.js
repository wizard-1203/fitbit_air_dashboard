/* ============================================================
   CONSTANTS & UTILITIES
   ============================================================ */
const $ = s => document.querySelector(s);
let glassTranslucency=(()=>{try{const n=Number(localStorage.getItem('health-glass-translucency'));return Number.isFinite(n)?Math.max(0,Math.min(100,n)):60}catch(_){return 60}})();
function setGlassTranslucency(value){glassTranslucency=Math.max(0,Math.min(100,Number(value)||0));const t=glassTranslucency/100,opacity=.94-.8*Math.pow(t,0.65),blur=4+24*t,chrome=Math.min(1,opacity+.08),label=.78+.22*t,root=document.documentElement;root.style.setProperty('--glass-bg-opacity',opacity.toFixed(3));root.style.setProperty('--glass-chrome-opacity',chrome.toFixed(3));root.style.setProperty('--glass-blur',blur.toFixed(1)+'px');root.style.setProperty('--glass-saturate','180%');root.style.setProperty('--glass-border-top','rgba(255,255,255,.18)');root.style.setProperty('--glass-border-subtle','rgba(255,255,255,.08)');root.style.setProperty('--glass-label-opacity',label.toFixed(3));root.style.setProperty('--glass-range-fill',glassTranslucency+'%');try{localStorage.setItem('health-glass-translucency',String(glassTranslucency))}catch(_){}document.querySelectorAll('#glassSettingsRange').forEach(el=>{if(el.value!==String(glassTranslucency))el.value=glassTranslucency});document.querySelectorAll('#glassSettingsValue').forEach(el=>el.textContent=glassTranslucency+'%');document.querySelectorAll('[data-glass-preset]').forEach(btn=>btn.setAttribute('aria-pressed',String(Number(btn.dataset.glassPreset)===glassTranslucency)));}
setGlassTranslucency(glassTranslucency);
const GLASS_BG_PALETTES={
  ocean:['30,190,170','80,110,235','40,175,205','220,165,70','60,175,130'],
  aurora:['120,80,205','65,110,215','55,180,210','205,110,145','55,175,145'],
  arctic:['45,135,200','75,105,215','40,185,215','180,155,95','50,165,150'],
  ember:['165,70,95','110,70,165','200,100,110','235,165,70','130,145,100'],
  sage:['60,150,110','85,135,155','75,175,150','195,160,90','75,165,125']
};
function setBackgroundPalette(name){const key=GLASS_BG_PALETTES[name]?name:'ocean',vars=['--ambient-emerald','--ambient-sapphire','--ambient-cyan','--ambient-amber','--ambient-forest'];GLASS_BG_PALETTES[key].forEach((rgb,i)=>document.documentElement.style.setProperty(vars[i],rgb));try{localStorage.setItem('health-glass-background',key)}catch(_){}document.querySelectorAll('[data-bg-palette]').forEach(btn=>btn.setAttribute('aria-pressed',String(btn.dataset.bgPalette===key)));}
let glassBackground='ocean';try{glassBackground=localStorage.getItem('health-glass-background')||'ocean'}catch(_){}setBackgroundPalette(glassBackground);
document.addEventListener('click',e=>{const palette=e.target.closest?.('[data-bg-palette]');if(palette)setBackgroundPalette(palette.dataset.bgPalette)});
document.addEventListener('input',e=>{if(e.target?.matches('#glassSettingsRange'))setGlassTranslucency(e.target.value)});
document.addEventListener('click',e=>{const preset=e.target.closest?.('[data-glass-preset]');if(preset)setGlassTranslucency(preset.dataset.glassPreset)});
const $$ = s => Array.from(document.querySelectorAll(s));
const DAY = 86400000, HOUR = 3600000;
let D = null, days = 30, period = (()=>{try{const p=localStorage.getItem('health-dashboard-range');return ['1','7','30','ytd','all'].includes(p)?p:'30';}catch(e){return '30';}})(); days=rangeDays(period);
window.sleepStagePercent = window.sleepStagePercent || false;
window.sleepStageAwake = window.sleepStageAwake ?? true;
window.sleepStageScope   = window.sleepStageScope   || 'total';
let activeSection = 'overview';
let activeSubtab  = null;
window._hr24ShowTypical = window._hr24ShowTypical === true;
window._zoneExcludeZ1   = !!window._zoneExcludeZ1;

function rangeDays(p){
  if(p==='ytd'){const n=new Date();return Math.floor((Date.now()-new Date(n.getFullYear(),0,1).getTime())/DAY)+1;}
  if(p==='all')return 3650;
  return Number(p);
}
function periodStart(p){
  if(p==='all')return -Infinity;
  if(p==='ytd'){const n=new Date();return new Date(n.getFullYear(),0,1).getTime();}
  return Date.now()-(Number(p)-1)*DAY;
}
const fmtN   = n => Math.round(n).toLocaleString();
const dayMs  = s => new Date(s+'T00:00:00').getTime();
const fmtDay = x => new Date(x).toLocaleDateString([], {month:'short',day:'numeric'});
const fmtDayLong = x => new Date(x).toLocaleDateString([], {weekday:'short',month:'short',day:'numeric'});
const fmtTime = x => new Date(x).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
const fmtHour = x => new Date(x).toLocaleTimeString([], {hour:'numeric'});
const hm = m => `${Math.floor(m/60)}h ${String(Math.round(m%60)).padStart(2,'0')}m`;
const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : null;
const std  = a => { if(a.length<2) return 0; const m=mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2))); };
const median = a => { const v=(a||[]).filter(Number.isFinite).slice().sort((x,y)=>x-y); return v.length ? (v.length%2 ? v[v.length>>1] : (v[v.length/2-1]+v[v.length/2])/2) : null; };
function activeWorkouts(){return (D.exercise||[]).filter(w=>!w.excluded);}
const esc  = s => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;',"\"":'&quot;'}[c]));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const AVERAGE_SPLIT_CONFIG={
  hr24:{label:'Heart rate · 24 h',polarity:'neutral',tolerance:2,unit:'bpm'},
  rhr:{label:'Resting heart rate',polarity:'lower',tolerance:1,unit:'bpm'},
  sleepHr:{label:'Heart rate during sleep',polarity:'lower',tolerance:2,unit:'bpm'},
  hrv:{label:'HRV',polarity:'higher',tolerance:'sd',unit:'ms'},
  spo2:{label:'SpO₂',polarity:'higher',tolerance:.5,unit:'%' }
};
const stats = (vals,avg,metric='hr24')=>{const cfg=AVERAGE_SPLIT_CONFIG[metric]||AVERAGE_SPLIT_CONFIG.hr24,clean=vals.map(Number).filter(Number.isFinite);let tol=cfg.tolerance;if(tol==='sd')tol=.25*std(clean);let b=0,a=0,e=0;for(const v of clean){if(Math.abs(v-avg)<=tol)e++;else if(v<avg)b++;else a++;}return {n:clean.length,b,a,e,values:clean,avg,tolerance:tol,metric};};
const localDateKey = value => {
  const d = value instanceof Date ? value : new Date(value);
  if(!Number.isFinite(d.getTime()))return '';
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
};
const sleepDateKey = x => localDateKey(x.end || x.start);

function formatDuration(sec){
  sec = Math.round(Number(sec) || 0);
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function sparkline(values, color='var(--ink2)', w=60, h=22){
  if(!values || values.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const v = values.filter(x=>Number.isFinite(x));
  if(v.length<2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;
  const lo = Math.min(...v), hi = Math.max(...v);
  const range = hi-lo || 1;
  const d = v.map((y,i)=>{ const x=(i/(v.length-1))*(w-2)+1; const yy=h-2-((y-lo)/range)*(h-4); return `${i?'L':'M'}${x.toFixed(1)},${yy.toFixed(1)}`; }).join('');
  const last = v[v.length-1], lastY = h-2-((last-lo)/range)*(h-4);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${w-1}" cy="${lastY.toFixed(1)}" r="1.8" fill="${color}"/>
  </svg>`;
}

function niceTicks(lo,hi,n=4){
  const span=(hi-lo)||1, raw=span/n, mag=10**Math.floor(Math.log10(raw)), f=raw/mag;
  const step=(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*mag;
  const t=[]; for(let v=Math.floor(lo/step)*step; v<=Math.ceil(hi/step)*step+1e-9; v+=step) t.push(+v.toFixed(6));
  return t;
}
function barPath(x,y,w,h,r){
  if(h<=0)return '';
  r=Math.min(r,w/2,h);
  return `M${x},${y+h}V${y+r}Q${x},${y} ${x+r},${y}H${x+w-r}Q${x+w},${y} ${x+w},${y+r}V${y+h}Z`;
}
const tipRow = (label,val,color)=>`<div class="r"><span>${color?`<i style="background:${color}"></i>`:''}${label}</span><span>${val}</span></div>`;

function catmullRom(pts, tension = 0.5){
  if(pts.length < 3) return pts;
  const out = [];
  for(let i = 0; i < pts.length - 1; i++){
    const p0 = pts[Math.max(0, i-1)], p1 = pts[i], p2 = pts[i+1], p3 = pts[Math.min(pts.length-1, i+2)];
    const t = tension;
    for(let s = 0; s <= 1; s += 0.1){
      const s2 = s*s, s3 = s2*s;
      const x = 0.5 * ((2*p1.x) + (-p0.x + p2.x)*s + (2*p0.x - 5*p1.x + 4*p2.x - p3.x)*s2 + (-p0.x + 3*p1.x - 3*p2.x + p3.x)*s3);
      const y = 0.5 * ((2*p1.y) + (-p0.y + p2.y)*s + (2*p0.y - 5*p1.y + 4*p2.y - p3.y)*s2 + (-p0.y + 3*p1.y - 3*p2.y + p3.y)*s3);
      out.push({x, y});
    }
  }
  return out;
}

