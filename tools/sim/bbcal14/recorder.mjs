// BN14 recorder (tools/sim/bbcal14.mjs): every 60s the /tel files; every 5 min the save's player/bladeburner/sleeves digest, into /tmp/bbk14/cap. One process, read-only RPC (getFile, getSaveFile).
// NOT CALIBRATED: it models nothing — it only copies the live records for the replay (tools/sim/bbcal14.mjs) to price.
import fs from 'node:fs'
import zlib from 'node:zlib'
const D = '/tmp/bbk14/cap'
const rpc = async (method, params) => { const r = await fetch('http://localhost:12526/rpc', { method: 'POST', body: JSON.stringify({ method, params }) }); return (await r.json()).result }
let n = 0
async function once() {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
  if (n++ % 5 === 0) {
    try {
      const res = await rpc('getSaveFile')
      const raw = res.binary ? zlib.gunzipSync(Buffer.from(res.save, 'latin1')).toString('utf8') : Buffer.from(res.save, 'base64').toString('utf8')
      const top = JSON.parse(raw)
      const P = JSON.parse(top.data.PlayerSave).data
      const bb = P.bladeburner?.data ?? null
      const out = { at: new Date().toISOString(), player: { skills: P.skills, exp: P.exp, mults: P.mults, city: P.city, money: P.money, playtimeSinceLastAug: P.playtimeSinceLastAug }, bb, sleeves: (P.sleeves ?? []).map((s) => ({ skills: s.data.skills, mults: s.data.mults, work: s.data.currentWork?.data ?? null, workCtor: s.data.currentWork?.ctor ?? null, sync: s.data.sync, shock: s.data.shock })) }
      fs.writeFileSync(`${D}/save.${stamp}.json`, JSON.stringify(out))
    } catch (e) { fs.appendFileSync(`${D}/err.log`, `${stamp} save ${e}\n`) }
  }
  for (const f of ['bladeburner.txt', 'plan.txt', 'sleeve.txt', 'exitinputs.txt', 'installgate.txt']) {
    try { fs.writeFileSync(`${D}/${f}.${stamp}`, await rpc('getFile', { server: 'home', filename: '/tel/' + f })) } catch (e) { fs.appendFileSync(`${D}/err.log`, `${stamp} ${f} ${e}\n`) }
  }
}
for (;;) { await once(); await new Promise((r) => setTimeout(r, 60e3)) }
