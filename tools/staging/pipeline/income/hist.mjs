import fs from "fs"; import readline from "readline";
const rl = readline.createInterface({ input: fs.createReadStream("/home/tbusby/Repos/bitburner-scripts/.telemetry/history.jsonl") });
const rows = []; let bad = 0;
for await (const l of rl) { if (!l.trim()) continue; try { const r = JSON.parse(l); rows.push({at:r.at,bn:r.bitNode,m:r.money,tp:r.totalPlaytime,pa:r.playtimeSinceLastAug,hl:r.skills?.hacking,homeRam:r.home?.ram}); } catch { bad++; } }
console.log("rows",rows.length,"bad",bad);
// find resets: playtimeSinceLastAug decreases
const resets=[];
for (let i=1;i<rows.length;i++) if (rows[i].pa < rows[i-1].pa) resets.push(i);
console.log("resets at idx:", JSON.stringify(resets.map(i=>({i,at:rows[i].at,prevPa:rows[i-1].pa,pa:rows[i].pa,bnPrev:rows[i-1].bn,bn:rows[i].bn,tp:rows[i].tp}))));
const last=rows[rows.length-1];
console.log("last:",JSON.stringify(last));
console.log("first:",JSON.stringify(rows[0]));
// bitnode changes
const bnc=[]; for(let i=1;i<rows.length;i++) if(rows[i].bn!==rows[i-1].bn) bnc.push({i,at:rows[i].at,from:rows[i-1].bn,to:rows[i].bn,tp:rows[i].tp});
console.log("bitnode changes:",JSON.stringify(bnc));
fs.writeFileSync("/home/tbusby/Repos/bitburner-scripts/tools/staging/pipeline/income/rows.json",JSON.stringify(rows));
