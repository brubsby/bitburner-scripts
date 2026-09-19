// Fragmentation cost of planBatch's maxHackRam clamp, at LIVE conditions.
// CALIBRATION: section 0 reproduces the game's OWN calculatePercentMoneyHacked /
// calculateHackingChance / calculateServerGrowthLog from ~/Repos/bitburner and
// prints the error against batch.js's inlined ports, on every run, pass or fail.
import '../../sim/env.mjs';
import fs from 'node:fs'; import zlib from 'node:zlib';
import { importRootScript } from '../../sim/rootimport.mjs';
import { calculatePercentMoneyHacked, calculateHackingChance, calculateHackingTime,
         calculateServerGrowthLog, currentBitNode, currentNodeMults } from '../../sim/game.mjs';
const B = await importRootScript('batch.js');
const RAM = { hack: 1.7, grow: 1.75, weaken: 1.75 };
const BN = currentBitNode();
const NM = currentNodeMults;
console.log('sim BitNode:', BN, ' ScriptHackMoney =', NM.ScriptHackMoney, ' ServerGrowthRate =', NM.ServerGrowthRate, ' ServerWeakenRate =', NM.ServerWeakenRate);

const r = JSON.parse(fs.readFileSync('tools/staging/pipeline/save.json','utf8')).result;
const raw = r.binary ? zlib.gunzipSync(Buffer.from(r.save,'latin1')).toString('utf8') : Buffer.from(r.save,'base64').toString('utf8');
const save = JSON.parse(raw);
const sect = n => { const v = save?.data?.[n]; return typeof v==='string'?JSON.parse(v):v };
const servers = sect('AllServersSave')||{};
const P = sect('PlayerSave')?.data ?? {};
const level = P.skills?.hacking ?? 0;
const pm = P.mults ?? {};
// exactly what ns.getHackingMultipliers() returns (NetscriptFunctions.ts:857-863)
const M = { chance: pm.hacking_chance, speed: pm.hacking_speed, money: pm.hacking_money, growth: pm.hacking_grow };
const person = { skills:{ hacking: level, intelligence: P.skills?.intelligence??0 }, mults: pm };
const srvMock = s => ({ hostname:s.hostname, requiredHackingSkill:s.requiredHackingSkill, minDifficulty:s.minDifficulty,
  hackDifficulty:s.minDifficulty, baseDifficulty:s.minDifficulty, moneyMax:s.moneyMax, moneyAvailable:s.moneyMax,
  serverGrowth:s.serverGrowth, hasAdminRights:true, cpuCores:1 });

const list = Object.keys(servers).map(k=>servers[k]?.data??servers[k])
  .filter(s=>s&&s.moneyMax>0&&s.hasAdminRights&&s.requiredHackingSkill<=level)
  .sort((a,b)=>b.moneyMax-a.moneyMax);

console.log('\n=== CHECK 0: batch.js inlined ports vs game source (BN4) ===');
console.log('batch.js:309-315 omits currentNodeMults.ScriptHackMoney (Hacking.ts:54) by design;');
console.log('the live calibration y is supposed to supply it. So expect phi0*0.2 == game phi.');
let worst=0;
for (const s of list) {
  const m = srvMock(s);
  const bPhi = B.hackFraction(level, s.requiredHackingSkill, s.minDifficulty, M);
  const bCh  = B.hackChance(level, s.requiredHackingSkill, s.minDifficulty, M);
  const bK   = B.growthK(s.minDifficulty, s.serverGrowth, M);
  const gPhi = calculatePercentMoneyHacked(m, person);
  const gCh  = calculateHackingChance(m, person);
  const gK   = calculateServerGrowthLog(m, 1, person, 1);
  const e=(a,b)=>{const v=b?(a-b)/b*100:0; worst=Math.max(worst,Math.abs(v)); return v.toFixed(3)+'%'};
  console.log(s.hostname.padEnd(18),'phi0*SHM err',e(bPhi*NM.ScriptHackMoney,gPhi),'| chance err',e(bCh,gCh),'| k err',e(bK,gK));
}
console.log('worst abs error:', worst.toFixed(4)+'%', worst<0.01?'-> PORTS ARE EXACT':'-> DIVERGENCE');

const Y = NM.ScriptHackMoney; // what the live calibration measured (0.2)
const mk = s => { const t={host:s.hostname,required:s.requiredHackingSkill,minSec:s.minDifficulty,sec:s.hackDifficulty,
  maxMoney:s.moneyMax,money:s.moneyAvailable,growth:s.serverGrowth,level,mults:M};
  t.phi0=B.hackFraction(level,t.required,t.minSec,M); t.chance=B.hackChance(level,t.required,t.minSec,M);
  t.k=B.growthK(t.minSec,t.growth,M); t.phi=t.phi0*Y; return t };

console.log('\n=== CHECK 1: does planBatch score increase monotonically in h? ===');
console.log('If yes, hFit=floor(largestBlock/1.7) is ALWAYS binding and the plan tracks fleet fill.');
const ph = mk(list.find(s=>s.hostname==='phantasy'));
const hackTime = calculateHackingTime(srvMock(list.find(s=>s.hostname==='phantasy')), person)*1000;
const weakenTime = hackTime*4;
console.log(`phantasy: hackTime ${(hackTime/1000).toFixed(1)}s weakenTime ${(weakenTime/1000).toFixed(1)}s phi(cal) ${ph.phi.toExponential(3)} chance ${ph.chance.toFixed(4)} k ${ph.k.toExponential(3)}`);
console.log('  h     g   w1   w2      gb     f%   $/batch     $/GB  blockNeeded  maxInFlight@2124  period');
const rows=[];
for (let h=1;h<=Math.ceil(0.99/ph.phi);h=h<8?h+1:Math.ceil(h*1.3)) {
  const f=Math.min(0.99,ph.phi*h), after=Math.max(ph.maxMoney*(1-f),1);
  const g=Math.max(1,Math.ceil(B.growThreads(ph.maxMoney,after,ph.k,ph.maxMoney)*1.1));
  if(!isFinite(g)) break;
  const w1=Math.ceil((0.002*h*1.1)/0.05)+1, w2=Math.ceil((2*0.002*g*1.1)/0.05)+1;
  const gb=RAM.hack*h+RAM.grow*g+RAM.weaken*(w1+w2);
  const money=f*ph.maxMoney*ph.chance, perGB=money/gb;
  const mif=Math.max(1,Math.floor(2124/gb)), per=Math.max(0.8,weakenTime/1000/mif);
  rows.push({h,g,gb,f,money,perGB,per,mif,block:RAM.hack*h});
  console.log(`${String(h).padStart(3)} ${String(g).padStart(5)} ${String(w1).padStart(4)} ${String(w2).padStart(4)} ${gb.toFixed(1).padStart(8)} ${(f*100).toFixed(1).padStart(6)} ${(money/1e3).toFixed(1).padStart(9)}k ${perGB.toFixed(0).padStart(8)} ${(RAM.hack*h).toFixed(1).padStart(8)}GB ${String(mif).padStart(10)} ${per.toFixed(2).padStart(8)}s`);
}
const best=rows.reduce((a,b)=>b.perGB>a.perGB?b:a);
console.log(`\nargmax of score(=$/GB, what planBatch maximises): h=${best.h} gb=${best.gb.toFixed(1)} $/GB=${best.perGB.toFixed(0)} needs a ${best.block.toFixed(1)}GB contiguous block`);
console.log('largest block on this fleet = 512GB (home) -> hFit = 301. Fleet blocks: 512,256,256,128,64x5,32x7,16x21,8x13,4');

console.log('\n=== CHECK 2: steady-state income vs h, at fleet 2124GB, n=1 ===');
console.log('income = (RAM/gb) batches in flight * $/batch / weakenTime  ==  RAM * $/GB / weakenTime');
console.log('(identical to $/GB up to a constant -> planBatch objective is CORRECT under RAM saturation)');
for (const r of rows) {
  const inc = 2124*r.perGB/(weakenTime/1000);
  console.log(`h=${String(r.h).padStart(3)} gb=${r.gb.toFixed(0).padStart(6)} inFlight=${String(r.mif).padStart(4)} period=${r.per.toFixed(2).padStart(6)}s  income=$${(inc).toFixed(0).padStart(8)}/s  ${r.per<=0.8?'<-- CADENCE FLOOR BINDS':''}`);
}

console.log('\n=== CHECK 3: per-target economics, unconstrained h, all hackable targets ===');
console.log('host                maxM    wT(s)   bestH   gb    $/GB   income@2124GB/s   blockNeeded');
const per=[];
for (const s of list) {
  const t=mk(s); const wT=calculateHackingTime(srvMock(s),person)*4;
  let bb=null;
  for(let h=1;h<=Math.ceil(0.99/t.phi);h=h<8?h+1:Math.ceil(h*1.3)){
    const f=Math.min(0.99,t.phi*h),after=Math.max(t.maxMoney*(1-f),1);
    const g=Math.max(1,Math.ceil(B.growThreads(t.maxMoney,after,t.k,t.maxMoney)*1.1));
    if(!isFinite(g))break;
    const w1=Math.ceil((0.002*h*1.1)/0.05)+1,w2=Math.ceil((2*0.002*g*1.1)/0.05)+1;
    const gb=RAM.hack*h+RAM.grow*g+RAM.weaken*(w1+w2);
    const money=f*t.maxMoney*t.chance, sc=money/gb;
    if(!bb||sc>bb.sc)bb={h,gb,sc,money};
  }
  if(!bb)continue;
  const inc=2124*bb.sc/wT;
  per.push({host:s.hostname,inc,wT,bb});
  console.log(`${s.hostname.padEnd(18)} ${(s.moneyMax/1e6).toFixed(1).padStart(7)}m ${wT.toFixed(0).padStart(6)} ${String(bb.h).padStart(6)} ${bb.gb.toFixed(0).padStart(6)} ${bb.sc.toFixed(0).padStart(7)} ${inc.toFixed(0).padStart(14)} ${(bb.h*1.7).toFixed(0).padStart(10)}GB`);
}
per.sort((a,b)=>b.inc-a.inc);
console.log('\nIf the fleet is split n ways, each target gets 2124/n and income scales linearly per target:');
console.log(' n   targets                                     total $/s   vs n=1');
for(let n=1;n<=8&&n<=per.length;n++){
  const tot=per.slice(0,n).reduce((a,t)=>a+t.inc/n,0);
  console.log(` ${n}   ${per.slice(0,n).map(t=>t.host).join(',').padEnd(42).slice(0,42)} ${tot.toFixed(0).padStart(9)}   ${(tot/(per[0].inc)).toFixed(3)}x`);
}
