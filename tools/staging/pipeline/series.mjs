import fs from 'node:fs';
const txt = fs.readFileSync('tools/staging/pipeline/batch-series.jsonl','utf8');
const parts = txt.split(/\n(?=\{)/).map(s=>s.trim()).filter(Boolean);
let prev=null;
for (const p of parts) {
  let o,b; try{o=JSON.parse(p); b=JSON.parse(o.result)}catch(e){continue}
  const t=b.targets&&b.targets[0]; if(!t) continue;
  let d='';
  if(prev){const dt=b.uptimeSec-prev.up, db=b.totals.batches-prev.ba, dpf=t.placeFails-prev.pf, de=b.totals.earned-prev.ea, dus=t.unsafeSkips-prev.us;
    d=` | dt=${dt}s dB=${db} dPF=${dpf} dUS=${dus} rate=${dt?(db/dt*60).toFixed(1):0}/min vs implied ${(60/t.periodSec).toFixed(1)}/min  d$=${(de/1e6).toFixed(2)}m ${dt?(de/dt).toFixed(0):0}/s`}
  console.log(`${b.at.slice(11,19)} up=${b.uptimeSec} util=${b.ram.utilPct}% ${b.ram.used}/${b.ram.total} resv=${b.ram.reservedForPipelines} hosts=${b.hostsUsed} lvl=${b.hackingLevel} plan h=${t.plan.h}/g=${t.plan.g} gb=${t.plan.gb} per=${t.periodSec}s inFl=${t.cal.inFlight} pvr=${t.cal.planVsReal} m%=${t.moneyPct} sec=${t.sec}/${t.minSec}${d}`);
  prev={up:b.uptimeSec,ba:b.totals.batches,pf:t.placeFails,ea:b.totals.earned,us:t.unsafeSkips};
}
