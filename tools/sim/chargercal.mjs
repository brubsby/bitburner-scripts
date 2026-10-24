// THE HACKING CHARGER OVER A NODE, MODEL vs MEASURED (stanekplan.hackChargerPathOf / hackChargerLnOf).
//
//   node tools/sim/chargercal.mjs [--nodes 13.1,10.3,...] [--f 0.2] [--cycle 3] [--rest 100] [--tel DIR] [--json]
//
// The route decision's hacking arm with the gift is priced on ONE charger model before and after the
// accept (stanekplan.hackChargerPathOf: home on the gameplan's ramp 2^8 -> 2^21 over the node, floored at
// the measured fleet; the per-life charge calibrated by GIFT_CAL, giftcal.mjs). The per-life charge at a
// given home is giftcal.mjs's check (43 lives, BN13.1 + BN10.3). THIS file checks the other half: the
// charger's HOST over the node — home RAM and cores — against every node in history.jsonl, on the
// quantity the decision reads: the node-average ln(hacking) of the gift (BN5.2's hacking layout at f,
// calChargeLnOf), measured home path (64 points over the node) vs the ramp at the model's own quadrature
// (ramHours = the node's measured length; the fleet's other hosts held at --rest GB in both).
//
// Gift nodes on the hacking route: BN13.1, BN10.3. Bladeburner + gift (BN11.x, BN13.2/13.3): home stays
// at its entry RAM — the ramp is the HACKING route's charger and is printed against them to show it does
// not transfer (the Bladeburner arm's charger is BLADE_HOST, stanekepoch). The error is printed for every
// node, pass or fail. TOLERANCE: the median hacking-route node within 15% on the gift factor (the BN5.2
// accept turned on ~3h of a ~16h exit, ~19%); the spread across nodes is printed, not hidden.
import '../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { REPO_ROOT } from '../test/gameresolve.mjs'
import { checkWithin, report } from './calibrate.mjs'

const sp = await import('stanekplan.js')
const { bitNodeMults } = await import('bitNodeMultipliers.js')
const argv = process.argv.slice(2)
const opt = (k, d) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d
}
const HACK_GIFT = ['13.1', '10.3']
const HACK_NOGIFT = ['1.3', '12.1', '4.2', '10.1', '9.1', '1.2', '4.1']
const BLADE_GIFT = ['11.1', '11.2', '11.3', '13.2']
const nodes = opt('nodes', null)?.split(',') ?? [...HACK_GIFT, ...BLADE_GIFT, ...HACK_NOGIFT]
const f = Number(opt('f', 0.2))
const cycleH = Number(opt('cycle', 3))
const restGB = Number(opt('rest', 100))
const histFile = path.join(opt('tel', path.join(REPO_ROOT, '.telemetry')), 'history.jsonl')
if (!fs.existsSync(histFile)) {
  console.log(`  ----  chargercal: NOT CALIBRATED — ${histFile} is absent`)
  process.exit(2)
}

// one segment per node.level (the save's SF of the node + 1), its first run only
const want = new Set(nodes)
const segs = new Map()
let curKey = null
const rl = readline.createInterface({ input: fs.createReadStream(histFile) })
for await (const line of rl) {
  let r
  try {
    r = JSON.parse(line)
  } catch {
    continue
  }
  const sf = new Map(r.sourceFiles?.data ?? [])
  const key = `${r.bitNode}.${(sf.get(r.bitNode) ?? 0) + 1}`
  if (key !== curKey && segs.has(key)) segs.get(key).closed = true
  curKey = key
  if (!want.has(key)) continue
  if (!segs.has(key)) segs.set(key, { key, rows: [], closed: false })
  const s = segs.get(key)
  if (!s.closed && r.home?.ram > 0) s.rows.push({ tp: r.totalPlaytime, ram: r.home.ram, cores: r.home.cores ?? 1 })
}

// the decision this protects: BN5.2's hacking layout (SF13.3 grid) at f
const nm = bitNodeMults(5, 2)
const gs = sp.giftSize(nm.StaneksGiftExtraSize ?? 0, 3)
const np = nm.StaneksGiftPowerMultiplier ?? 1
const L = sp.layoutForGrid(gs.width, gs.height, np, 'hack').placed.map((p) => ({ id: p.id, x: p.x, y: p.y, rot: p.rot ?? p.rotation }))
const lnAt = (ram, cores) => {
  const hosts = [{ host: 'home', cores, maxRam: ram, capGb: ram }, ...(restGB > 0 ? [{ host: 'fleet', cores: 1, maxRam: restGB, capGb: restGB }] : [])]
  return sp.calChargeLnOf({ layout: L, nodePower: np, fleetGB: ram + restGB, hosts, f, cycleH }).lnHack
}
console.log(`THE HACKING CHARGER OVER A NODE: ramp (stanekplan.hackChargerPathOf, log2End ${sp.HACK_CHARGER_RAMP.log2End}) vs history.jsonl home paths`)
console.log(`  on BN5.2's hacking layout ${sp.layoutKeyOf(L)} (${gs.width}x${gs.height}, power ${np}) at f ${f}, ${cycleH}h lives, +${restGB}GB other fleet, GIFT_CAL kappa ${sp.GIFT_CAL.kappa} delay ${sp.GIFT_CAL.delayH}h`)
const out = []
for (const k of nodes) {
  const s = segs.get(k)
  if (!s || s.rows.length < 2) {
    console.log(`  ${k.padEnd(5)} no history`)
    continue
  }
  const t0 = s.rows[0].tp
  const T = (s.rows.at(-1).tp - t0) / 3.6e6
  let j = 0
  const at = (u) => {
    const t = t0 + u * T * 3.6e6
    while (j + 1 < s.rows.length && s.rows[j + 1].tp <= t) j++
    return s.rows[j]
  }
  const N = 64
  let meas = 0
  let lm = 0
  for (let i = 0; i < N; i++) {
    const r = at((i + 0.5) / N)
    meas += lnAt(r.ram, r.cores) / N
    lm += Math.log2(r.ram) / N
  }
  // the model: THE SAME path builder the route decision runs (entry: the measured home, no age)
  const p = sp.hackChargerPathOf({ liveGB: s.rows[0].ram + restGB, liveHome: { ram: s.rows[0].ram, cores: s.rows[0].cores }, ageH: 0, ramHours: T })
  const mod = sp.hackChargerLnOf(p, { layout: L, nodePower: np, f, cycleH }).lnHack
  const lmod = p.points.reduce((a, q) => a + Math.log2(q.hosts[0].maxRam), 0) / p.points.length
  const kind = HACK_GIFT.includes(k) ? 'hack+gift' : BLADE_GIFT.includes(k) ? 'blade+gift' : 'hack'
  const err = Math.exp(mod - meas) - 1
  out.push({ node: k, kind, T: +T.toFixed(1), log2HomeMeas: +lm.toFixed(2), log2HomeModel: +lmod.toFixed(2), lnHackMeas: +meas.toFixed(4), lnHackModel: +mod.toFixed(4), err: +err.toFixed(4) })
  console.log(`  ${k.padEnd(5)} ${kind.padEnd(10)} ${T.toFixed(1).padStart(5)}h  mean log2 home meas ${lm.toFixed(2).padStart(5)} model ${lmod.toFixed(2).padStart(5)}  gift x${Math.exp(meas).toFixed(3)} meas vs x${Math.exp(mod).toFixed(3)} model  err ${err >= 0 ? '+' : ''}${(err * 100).toFixed(1)}%`)
}
const hackRows = out.filter((r) => r.kind !== 'blade+gift')
const med = (xs) => {
  const a = [...xs].sort((x, y) => x - y)
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : NaN
}
if (hackRows.length) {
  const mMeas = Math.exp(med(hackRows.map((r) => r.lnHackMeas)))
  const mMod = Math.exp(med(hackRows.map((r) => r.lnHackModel)))
  console.log(`  hacking-route nodes ${hackRows.length}: err ${(Math.min(...hackRows.map((r) => r.err)) * 100).toFixed(1)}% .. ${(Math.max(...hackRows.map((r) => r.err)) * 100).toFixed(1)}%`)
  checkWithin('median hacking-route node: the gift factor over the node', mMod, mMeas, 0.15, (x) => `x${x.toFixed(3)}`)
  for (const r of out.filter((x) => x.kind === 'hack+gift')) checkWithin(`${r.node} (hack + gift)`, Math.exp(r.lnHackModel), Math.exp(r.lnHackMeas), 0.3, (x) => `x${x.toFixed(3)}`)
}
const bl = out.filter((r) => r.kind === 'blade+gift')
if (bl.length) console.log(`  Bladeburner + gift (${bl.map((r) => r.node).join(', ')}): home held at 2^${Math.min(...bl.map((r) => r.log2HomeMeas)).toFixed(0)}..2^${Math.max(...bl.map((r) => r.log2HomeMeas)).toFixed(0)} — the ramp is the hacking route's charger, not theirs (BLADE_HOST prices the Bladeburner arm)`)
if (argv.includes('--json')) console.log(JSON.stringify(out))
report('charger')
