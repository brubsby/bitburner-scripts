import fs from 'node:fs'; import zlib from 'node:zlib';
const r = JSON.parse(fs.readFileSync('tools/staging/pipeline/save.json','utf8')).result;
const raw = r.binary ? zlib.gunzipSync(Buffer.from(r.save,'latin1')).toString('utf8') : Buffer.from(r.save,'base64').toString('utf8');
const save = JSON.parse(raw);
const sect = n => { const v = save?.data?.[n]; return typeof v==='string'?JSON.parse(v):v };
const servers = sect('AllServersSave')||{};
const p = sect('PlayerSave')?.data ?? {};
const rows=[];
for (const k of Object.keys(servers)) {
  const s = servers[k]?.data ?? servers[k];
  if (!s || typeof s!=='object') continue;
  rows.push({host:s.hostname, maxRam:s.maxRam, ramUsed:s.ramUsed, admin:!!s.hasAdminRights,
    money:s.moneyAvailable, maxMoney:s.moneyMax, sec:s.hackDifficulty, minSec:s.minDifficulty,
    req:s.requiredHackingSkill, growth:s.serverGrowth, purchased:!!s.purchasedByPlayer, cores:s.cpuCores});
}
const rooted = rows.filter(r=>r.admin && r.maxRam>0);
rooted.sort((a,b)=>b.maxRam-a.maxRam);
const tot = rooted.reduce((a,b)=>a+b.maxRam,0);
console.log('hackingLevel', p.skills?.hacking, 'money', p.money, 'bitNode', p.bitNodeN);
console.log('rooted hosts with ram:', rooted.length, 'total maxRam GB:', tot);
console.log('--- fleet block sizes (host: maxRam / used / free) ---');
for (const s of rooted) console.log(String(s.maxRam).padStart(5), (s.maxRam-s.ramUsed).toFixed(2).padStart(8), s.host, s.cores>1?('cores='+s.cores):'');
// histogram
const hist={}; for(const s of rooted) hist[s.maxRam]=(hist[s.maxRam]||0)+1;
console.log('--- histogram maxRam -> count, aggregate GB ---');
for (const k of Object.keys(hist).map(Number).sort((a,b)=>b-a)) console.log(k, 'x', hist[k], '=', k*hist[k]);
console.log('--- free-block distribution NOW ---');
const freeb = rooted.map(s=>+(s.maxRam-s.ramUsed).toFixed(2)).sort((a,b)=>b-a);
console.log(freeb.join(' '));
console.log('totalFree', freeb.reduce((a,b)=>a+b,0).toFixed(1), 'largestFree', freeb[0]);
console.log('--- phantasy ---');
console.log(JSON.stringify(rows.find(r=>r.host==='phantasy'),null,1));
// candidate targets
const cands = rows.filter(r=>r.admin && r.maxMoney>0 && r.req<= (p.skills?.hacking??0));
cands.sort((a,b)=>b.maxMoney-a.maxMoney);
console.log('--- hackable targets by maxMoney (top 15) ---');
for(const c of cands.slice(0,15)) console.log(c.host.padEnd(20), 'maxMoney', c.maxMoney.toExponential(3), 'req', c.req, 'minSec', c.minSec, 'growth', c.growth, 'money', (c.money/c.maxMoney*100).toFixed(0)+'%');
