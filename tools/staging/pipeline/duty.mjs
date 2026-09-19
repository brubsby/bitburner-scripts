// Does the observed h-oscillation quantitatively explain the measured income?
// Time-weight income_fit(h) over the observed plan.h trace and compare to the
// live moneySourceA.hacking rate. This is the CALIBRATION of the whole diagnosis.
import fs from 'node:fs';
const inc = { 1:36264,2:63620,3:84933,4:92886,5:106564,6:118334,7:119129,8:128513,11:139965,15:152689,
              20:162232,26:161278,34:162232,45:128831,59:131376,77:97975,101:96385,132:125968,172:54714,224:71255 };
const keys = Object.keys(inc).map(Number).sort((a,b)=>a-b);
const at = h => { let best=keys[0]; for(const k of keys) if(k<=h) best=k; return inc[best] };
const parts = fs.readFileSync('tools/staging/pipeline/batch-series.jsonl','utf8').split(/\n(?=\{)/).map(s=>s.trim()).filter(Boolean);
const rows=[];
for(const p of parts){let o,b;try{o=JSON.parse(p);b=JSON.parse(o.result)}catch(e){continue}
  const t=b.targets&&b.targets[0]; if(!t||!t.plan)continue;
  rows.push({up:b.uptimeSec,h:t.plan.h,gb:t.plan.gb,util:b.ram.utilPct,pf:t.placeFails});}
rows.sort((a,b)=>a.up-b.up);
let tw=0, dt=0, hist={};
for(let i=1;i<rows.length;i++){
  const d=rows[i].up-rows[i-1].up; if(d<=0||d>120)continue;
  tw += at(rows[i-1].h)*d; dt += d;
  const bucket = rows[i-1].h<=4?'h<=4':rows[i-1].h<=10?'h 5-10':rows[i-1].h<=45?'h 11-45 (GOOD)':'h>45';
  hist[bucket]=(hist[bucket]||0)+d;
}
console.log('observed trace spans', dt, 's over', rows.length, 'samples');
console.log('\ntime spent in each plan regime:');
for(const k of Object.keys(hist).sort()) console.log('  '+k.padEnd(16), (hist[k]/dt*100).toFixed(1)+'%', `(${hist[k]}s)`);
console.log('\nduty-cycle-weighted predicted income = $'+(tw/dt).toFixed(0)+'/s');
console.log('pinned at h=20..34 (contiguity-aware optimum) = $162232/s');
console.log('=> oscillation costs '+(100*(1-(tw/dt)/162232)).toFixed(0)+'% of achievable income');
console.log('\nCHECK against the live game (moneySourceA.hacking, the game\'s own attribution):');
console.log('  window 1 (692s, lvl 170->186): $82062/s');
console.log('  window 2 (198s, lvl 186->190): $93403/s');
console.log('  model (duty-weighted):         $'+(tw/dt).toFixed(0)+'/s');
const m=tw/dt;
console.log('  error vs window1: '+((m-82062)/82062*100).toFixed(1)+'%   vs window2: '+((m-93403)/93403*100).toFixed(1)+'%');
console.log('\n(The model ALSO ignores placement failure during the h<=4 phases, so it should');
console.log(' read HIGH. It does, by the amount above. Tolerance that matters: the decision is');
console.log(' "is there ~2x on the table", and both measurements and the model agree there is.)');
