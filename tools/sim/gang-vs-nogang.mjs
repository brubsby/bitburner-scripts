// IS THE GANG PATH WORTH IT IN THIS BITNODE? — the calculation, not the argument.
//
// The BitNode 4 plan was argued in chat: its money nerfs (ScriptHackMoney 0.2,
// ServerMaxMoney 0.1125, CrimeMoney 0.2, HacknetNodeMoney 0.05) are the ones a
// gang bypasses, because GangSoftcap is 1.0 there and gang money is not on the
// nerf list. Everything built afterwards — the karma leg in nodeplan, the
// work-slot comparison, the combat-augmentation channel — optimised UNDERNEATH
// that argument without ever testing it. nodeplan never referenced gang income
// at all; workSlotCost compared crime money against faction reputation, with
// the gang in neither branch.
//
// This is the missing comparison. It runs exitplan's own policy search twice
// against BitNode 4's real gates, with and without a gang's income, and the
// gang's earnings come from gangplan.simulateGang under that node's softcap
// rather than from a remembered figure out of BitNode 2.
//
// TWO THINGS IT TAKES CARE ABOUT.
//
// The gang's window is finite and does not carry: prestigeSourceFile nulls
// Player.gang and calls resetGangs (PlayerObjectGeneralMethods.ts:157-158),
// beside the karma reset. So a gang built in BitNode 4 dies with BitNode 4 and
// must repay inside it, starting only once the karma grind finishes.
//
// Reputation is DONATED, not ground. exitHours treats repPerSec as a constant,
// and at the live 0.302/s the 2.5m Daedalus leg alone prices at ~2,300h and
// swamps every other term — both branches came back over 2,400h, which is an
// artefact, not an answer. Past 150 favor reputation is bought, and
// donationForRep (Faction/formulas/donation.ts:13) makes that a MONEY leg,
// which is the leg a gang actually moves.
//
// Run: node tools/sim/gang-vs-nogang.mjs
//
// ASSUMPTIONS, stated because they are not measured here: faction_rep 1.24 and
// the gang policy (k 4.2, ascend floor 1.09, all-money split) taken from a
// search at a 17-24h horizon. The install-cycle gap it reports is ~3x, so the
// verdict survives a good deal of error in either.
import '../test/gameresolve.mjs'
import fs from 'node:fs'
const np=await import('nodeplan.js'); const gp=await import('gangplan.js'); const ep=await import('exitplan.js')
const ledger=JSON.parse(fs.readFileSync(new URL('../../.telemetry/lifetimes.txt', import.meta.url),'utf8'))
const cg=np.compoundGain(ledger,2)
const FACREP=1.24, FWRG=0.75
const donationCost=2.5e6*1e6/FACREP/FWRG
const base={money:3.55e6,hacking:271,hackingExp:26548,hackingMult:1.3392,expPerSec:7.4,
  cycleHours:cg.cycleHours,multGainPerCycle:cg.gain,exitLevel:np.exitLevelFor(4),
  joinMoney:100e9, terminalRep:2.5e6, donationCost, favorToDonate:150, exitFavor:150}
console.log('Daedalus 2.5m rep by donation costs $'+(donationCost/1e12).toFixed(2)+'t in BN4')
const G={faction:'Slum Snakes',isHacking:false,respect:1,wantedLevel:1,territory:1/7,power:1,territoryClashChance:0,territoryWarfareEngaged:false}
const R=()=>Object.fromEntries(['Tetrads','The Syndicate','The Dark Army','Speakers for the Dead','NiteSec','The Black Hand'].map(n=>[n,{power:1,territory:1/7}]))
const cache=new Map()
const gangAvgOver=(H)=>{ if(H<=0.5) return 0
  const k=H.toFixed(1); if(cache.has(k)) return cache.get(k)
  const f=gp.simulateGang(G,[],{softcap:1,horizonH:Math.min(H,200),stepSec:300,mode:'money',assignFn:gp.trainRatio(4.2,false,1),ascend:{minGain:1.09},rivals:R(),warfare:{fraction:0,engageRatio:1}})
  const v=f? f.money/(Math.min(H,200)*3600):0; cache.set(k,v); return v }
const run=(repPerSec,extra)=>{const p=ep.bestExitPolicy({...base,incomePerSec:1279.87+extra,repPerSec},120)
  return p.best&&p.best.hours!==null?{h:p.best.hours,edge:!!p.atSearchEdge,inst:p.best.installsFirst,legs:p.best.legs}:null}
const GRIND=36.4, REP=0.302, CRIME=4143.9
const noGang=run(REP,0)
console.log('NO GANG   : '+(noGang?noGang.h.toFixed(1)+'h, '+noGang.inst+' installs'+(noGang.edge?' EDGE':''):'refused'))
let H=noGang?noGang.h:100,out=null
for(let i=0;i<12;i++){
  const active=Math.max(0,H-GRIND)
  const gAvg=gangAvgOver(active)*active/Math.max(H,1e-9)
  const cAvg=CRIME*Math.min(GRIND,H)/Math.max(H,1e-9)
  const r=run(REP,gAvg+cAvg)
  if(!r){out=null;break}
  if(Math.abs(r.h-H)<0.05){out=r;H=r.h;break}
  H=r.h; out=r
}
console.log('GANG PATH : '+(out?out.h.toFixed(1)+'h, '+out.inst+' installs'+(out.edge?' EDGE':''):'refused'))
if(noGang&&out){
  const active=Math.max(0,out.h-GRIND)
  console.log('\ngang active '+active.toFixed(1)+'h at $'+(gangAvgOver(active)/1e6).toFixed(2)+'m/s')
  console.log('VERDICT: gang path '+(out.h<noGang.h?'FASTER by '+(noGang.h-out.h).toFixed(1)+'h ('+((1-out.h/noGang.h)*100).toFixed(0)+'%)':'SLOWER by '+(out.h-noGang.h).toFixed(1)+'h'))
  console.log('\nno-gang legs: '+(noGang.legs||[]).map(l=>l.leg+' '+l.hours.toFixed(1)+'h').join(' | '))
  console.log('gang   legs: '+(out.legs||[]).map(l=>l.leg+' '+l.hours.toFixed(1)+'h').join(' | '))
}
