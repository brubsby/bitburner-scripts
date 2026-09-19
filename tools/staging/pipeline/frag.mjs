// How many concurrent batches actually FIT, given that the hack op cannot be
// split across hosts (invariant B5, batch.js:806-813) while grow/weaken can.
// CALIBRATION: uses the live fleet block list from the save and batch.js's own
// planBatch arithmetic; CHECK 0 in plancurve.mjs shows the formula ports exact.
import '../../sim/env.mjs';
import fs from 'node:fs'; import zlib from 'node:zlib';
import { importRootScript } from '../../sim/rootimport.mjs';
import { calculateHackingTime, currentNodeMults, currentBitNode } from '../../sim/game.mjs';
const B = await importRootScript('batch.js');
const RAM = { hack: 1.7, grow: 1.75, weaken: 1.75 };
console.log('BitNode', currentBitNode(), 'ScriptHackMoney', currentNodeMults.ScriptHackMoney);

const r = JSON.parse(fs.readFileSync('tools/staging/pipeline/save2.json','utf8')).result;
const raw = r.binary ? zlib.gunzipSync(Buffer.from(r.save,'latin1')).toString('utf8') : Buffer.from(r.save,'base64').toString('utf8');
const save = JSON.parse(raw); const sect=n=>{const v=save?.data?.[n];return typeof v==='string'?JSON.parse(v):v};
const servers = sect('AllServersSave')||{}; const P=sect('PlayerSave')?.data??{};
const level=P.skills.hacking, pm=P.mults;
const M={chance:pm.hacking_chance,speed:pm.hacking_speed,money:pm.hacking_money,growth:pm.hacking_grow};
const person={skills:{hacking:level,intelligence:0},mults:pm};
const all=Object.keys(servers).map(k=>servers[k]?.data??servers[k]).filter(s=>s&&s.hasAdminRights&&s.maxRam>0);
// what batch.js sees: home minus homeReserve 56, everything else whole
const blocks=all.map(s=>s.hostname==='home'?Math.max(0,s.maxRam-56):s.maxRam).filter(x=>x>0).sort((a,b)=>b-a);
const TOT=blocks.reduce((a,b)=>a+b,0);
console.log('fleet blocks:',blocks.join(','),'\ntotal',TOT,'GB over',blocks.length,'hosts; largest',blocks[0]);

const s=all.find(x=>x.hostname==='phantasy');
const t={host:'phantasy',required:s.requiredHackingSkill,minSec:s.minDifficulty,maxMoney:s.moneyMax,growth:s.serverGrowth};
t.phi0=B.hackFraction(level,t.required,t.minSec,M); t.chance=B.hackChance(level,t.required,t.minSec,M);
t.k=B.growthK(t.minSec,t.growth,M); t.phi=t.phi0*currentNodeMults.ScriptHackMoney;
const wT=calculateHackingTime({requiredHackingSkill:s.requiredHackingSkill,minDifficulty:s.minDifficulty,hackDifficulty:s.minDifficulty,baseDifficulty:s.minDifficulty,moneyMax:s.moneyMax,moneyAvailable:s.moneyMax,serverGrowth:s.serverGrowth,hasAdminRights:true,cpuCores:1},person)*4;
console.log('phantasy level',level,'weakenTime',wT.toFixed(1),'s phi',t.phi.toExponential(3),'chance',t.chance.toFixed(4));

function plan(h){
  const f=Math.min(0.99,t.phi*h), after=Math.max(t.maxMoney*(1-f),1);
  const g=Math.max(1,Math.ceil(B.growThreads(t.maxMoney,after,t.k,t.maxMoney)*1.1));
  if(!isFinite(g))return null;
  const w1=Math.ceil((0.002*h*1.1)/0.05)+1,w2=Math.ceil((2*0.002*g*1.1)/0.05)+1;
  const gb=RAM.hack*h+RAM.grow*g+RAM.weaken*(w1+w2);
  return {h,g,w1,w2,gb,f,hackGb:RAM.hack*h,restGb:RAM.grow*g+RAM.weaken*(w1+w2),money:f*t.maxMoney*t.chance};
}
// Max concurrent batches N: pack N hack blocks of size hackGb into the fleet
// (each must be contiguous), remainder must hold N*restGb anywhere.
function fitN(p){
  let best=0;
  for(let N=1;N<=4000;N++){
    // greedy: give hack ops the largest hosts
    const b=[...blocks]; let need=N, used=0;
    for(let i=0;i<b.length&&need>0;i++){
      const c=Math.min(need,Math.floor(b[i]/p.hackGb));
      if(c<1)continue; b[i]-=c*p.hackGb; need-=c; used+=c*p.hackGb;
    }
    if(need>0)break;
    const rest=b.reduce((a,x)=>a+x,0);
    if(rest < N*p.restGb) break;
    best=N;
  }
  return best;
}
console.log('\n=== concurrent batches: RAM-only bound vs true contiguity-aware bound ===');
console.log('  h     gb   hackGB    N_ram   N_fit   lost%   income_ram/s  income_fit/s');
let bestFit=null, bestRam=null;
for(let h=1;h<=3000;h=h<8?h+1:Math.ceil(h*1.3)){
  const p=plan(h); if(!p)break;
  const Nram=Math.floor(TOT/p.gb), Nfit=fitN(p);
  if(Nram<1)break;
  const iram=Nram*p.money/wT, ifit=Nfit*p.money/wT;
  if(!bestRam||iram>bestRam.i)bestRam={h,i:iram,p,N:Nram};
  if(!bestFit||ifit>bestFit.i)bestFit={h,i:ifit,p,N:Nfit};
  console.log(`${String(h).padStart(3)} ${p.gb.toFixed(0).padStart(6)} ${p.hackGb.toFixed(0).padStart(7)} ${String(Nram).padStart(8)} ${String(Nfit).padStart(7)} ${(100*(1-Nfit/Nram)).toFixed(0).padStart(6)}% ${iram.toFixed(0).padStart(13)} ${ifit.toFixed(0).padStart(13)}`);
}
console.log(`\nRAM-only optimum:        h=${bestRam.h} gb=${bestRam.p.gb.toFixed(0)} N=${bestRam.N} -> $${bestRam.i.toFixed(0)}/s`);
console.log(`Contiguity-aware optimum: h=${bestFit.h} gb=${bestFit.p.gb.toFixed(0)} N=${bestFit.N} -> $${bestFit.i.toFixed(0)}/s`);
console.log(`Fragmentation cost at the true optimum: ${(100*(1-bestFit.i/bestRam.i)).toFixed(1)}%`);
console.log(`\nWhat batch.js's shipped loop does instead: h tracks floor(largestFREEblock/1.7),`);
console.log(`which decays as the fleet fills. Income at the h values observed live:`);
for(const h of [1,2,3,4,7,15,20,26,34,45,59,132]){
  const p=plan(h); if(!p)continue; const N=fitN(p);
  console.log(`  h=${String(h).padStart(3)} -> N_fit=${String(N).padStart(4)} income=$${(N*p.money/wT).toFixed(0).padStart(7)}/s  (${(100*N*p.money/wT/bestFit.i).toFixed(0)}% of achievable)`);
}
