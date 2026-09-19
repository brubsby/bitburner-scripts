import fs from "fs";
const rows = JSON.parse(fs.readFileSync("/home/tbusby/Repos/bitburner-scripts/tools/staging/pipeline/income/rows.json"));
const seg = (a,b,label)=>{const s=rows[a],e=rows[b];const dt=(e.tp-s.tp)/1000;const dm=e.m-s.m;
  console.log(`${label}: n=${b-a+1} dt=${dt.toFixed(0)}s (${(dt/3600).toFixed(2)}h) dMoney=$${dm.toExponential(4)} netPerSec=$${(dm/dt).toFixed(1)}/s  m0=$${s.m.toExponential(3)} m1=$${e.m.toExponential(3)}`);};
const L=rows.length-1;
seg(8044,L,"CURRENT LIFE (post-install 23:57:46Z)");
// last 2 hours by totalPlaytime
const tEnd=rows[L].tp; let i2=0; for(let i=0;i<=L;i++) if(rows[i].tp>=tEnd-2*3600*1000){i2=i;break;}
seg(i2,L,"LAST 2h of playtime");
seg(6115,L,"BITNODE 4 (all)");
seg(0,L,"ALL TIME");
// per-30min buckets within current life
console.log("\n-- current life, 10-min playtime buckets --");
let start=8044; for(let i=8044;i<=L;i++){ if(rows[i].tp-rows[start].tp>=600000||i===L){ const dt=(rows[i].tp-rows[start].tp)/1000; const dm=rows[i].m-rows[start].m; console.log(`  ${rows[start].at} -> ${rows[i].at} dt=${dt.toFixed(0)}s net=$${dm.toExponential(3)} = $${(dm/dt).toFixed(0)}/s`); start=i; } }
// wall-clock vs playtime drift over current life
const s=rows[8044],e=rows[L];
console.log("\nwall-clock dt:",((Date.parse(e.at)-Date.parse(s.at))/1000).toFixed(0),"s ; playtime dt:",((e.tp-s.tp)/1000).toFixed(0),"s");
