import fs from 'node:fs'; import zlib from 'node:zlib';
const dec = f => { const r=JSON.parse(fs.readFileSync(f,'utf8')).result;
  const raw=r.binary?zlib.gunzipSync(Buffer.from(r.save,'latin1')).toString('utf8'):Buffer.from(r.save,'base64').toString('utf8');
  const s=JSON.parse(raw); const sect=n=>{const v=s?.data?.[n];return typeof v==='string'?JSON.parse(v):v};
  const P=sect('PlayerSave')?.data??{};
  const ms=n=>{const v=P[n]; return (typeof v==='string'?JSON.parse(v):v)?.data ?? v};
  return {t:P.playtimeSinceLastAug, tot:P.totalPlaytime, A:ms('moneySourceA'), prod:P.scriptProdSinceLastAug, lvl:P.skills?.hacking};
};
const a=dec(process.argv[2]), b=dec(process.argv[3]);
const dt=(b.t-a.t)/1000;
console.log('window', dt.toFixed(0),'s   level',a.lvl,'->',b.lvl);
for (const k of ['hacking','codingcontract','total','servers','other']) {
  const d=(b.A?.[k]??0)-(a.A?.[k]??0);
  console.log(k.padEnd(16), 'delta $'+d.toFixed(0).padStart(12), '  $/s '+(d/dt).toFixed(0).padStart(9));
}
console.log('scriptProd delta', (b.prod-a.prod).toFixed(0), '$/s', ((b.prod-a.prod)/dt).toFixed(0));
console.log('cumulative life: hacking $'+(b.A?.hacking??0).toFixed(0), 'over', (b.t/1000).toFixed(0)+'s =', ((b.A?.hacking??0)/(b.t/1000)).toFixed(0), '$/s');
