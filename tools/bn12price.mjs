#!/usr/bin/env node
// THE BLADEBURNER ROUTE'S PRICE PER BN12 LEVEL — measured scale x the simulated level ratio.
//
//   node tools/bn12price.mjs [--levels 2,3,5,10,15,20] [--seeds 15] [--jobs 2] [--no-write]
//
// THE MODEL (tools/sim/gameplan/bn12.mjs bladeAnchorOf): hours(L) = A x r(L), where
//   r(L)  the bbsim median hours to the 21st black op (join included) in BitNode 12 at level L — the game's
//         Bladeburner classes at BN12's multipliers for that level (BitNode.tsx:918: rank x 1/1.02^L, skill
//         cost x 1.02^L, every combat level and the gym / crime exp x 1/1.02^L), the Source-Files held now
//         (state.json), the live intelligence, the fastest sleeve fleet of bbplan.sleeveConfigs(sleeves) on
//         the selection seeds (the live chooser's rule, surrogate.pickFleet's), and the Go farm on Tetrads
//         at the rate the board measured this node (bn12-board.json; else go.mjs bladeGoOf's mid);
//   A     exp(mean ln(measured hours / r(level))) over the ANCHOR clears: every finished BN12 Bladeburner
//         clear (the node itself — CALIBRATED once one exists), else the full-Source-File Bladeburner
//         clears of nodes whose Bladeburner multipliers are all 1 (BN5.2/5.3, BN2.2/2.3 played since SF6.3,
//         SF7.3 and SF10.3: priced at level 0, where BN12's are all 1 — ASSUMED transfer, labelled).
// The simulation's absolute scale is off on this stack (BN5.2: the live exit 13.0h at entry, played 5.7h)
// and the gameplan's k posterior holds none of the recent clears (observe.mjs withholds every clear whose Go
// farm is unstated), so only bbsim's RATIO across levels is used. CALIBRATION: the anchors' leave-one-out
// (each priced from the others) is printed on every run, pass or fail.
// Writes .telemetry/bn12-price.json (plan.mjs's BN12 loop prints it beside the gameplan's routes).

import './test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEL = process.env.TELEMETRY ?? path.resolve(HERE, '../.telemetry')
const argv = process.argv.slice(2)
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d)
const has = (k) => argv.includes(k)

const { bladeAnchorOf, readJsonOr, readHistoryRows, segmentsOfRows, BLACK_OPS_TOTAL, BN12 } = await import('./sim/gameplan/bn12.mjs')
const { runBbJobs, bbKeyOf, fleetConfigs } = await import('./sim/gameplan/surrogate.mjs')
const { bladeGoOf } = await import('./sim/gameplan/go.mjs')
const { nodeMults } = await import('./sim/nodechoice/hackexit.mjs')
const bp = await import('bbplan.js')
const { nodePolicyOf } = await import('bbnodepolicy.js')

const SEEDS = Number(arg('--seeds', 15))
/** The band's floor in ln hours: the four full-SF clears at multipliers 1 spread 5.7-7.5h (sd ln ~0.11). ASSUMED. */
const SD_FLOOR = 0.1
const SEL_SEEDS = [101, 102, 103]
const JOBS = Number(arg('--jobs', 2))
const state = readJsonOr(path.join(TEL, 'state.json'))
if (!state) throw new Error(`bn12price: no state.json in ${TEL}`)
const sfNow = (state.sourceFiles?.data ?? []).map(([n, l]) => [n, l]).sort((a, b) => a[0] - b[0])
const sf = new Map(sfNow)
const INT = state.skills?.intelligence ?? 0
const SLEEVES = (state.sleeves ?? []).length || 8
const board = readJsonOr(path.join(TEL, 'bn12-board.json'))
const curLevel = (sf.get(BN12) ?? 0) + (state.bitNode === BN12 ? 1 : 0)
const levels = [...new Set([curLevel, curLevel + 1, ...String(arg('--levels', '2,3,5,10,15,20')).split(',').map(Number)])].filter((L) => Number.isInteger(L) && L >= 1).sort((a, b) => a - b)

// the Go farm: this node's measured Tetrads rate (the board's capture), else the gameplan's mid
const cap = board?.inProgress?.go
const goMeasured = cap?.np?.Tetrads > 0 && cap.hoursIn >= 0.5 ? cap.np.Tetrads / cap.hoursIn : null
const GO = bladeGoOf(1, sf.get(14) ?? 0, ...(goMeasured ? [goMeasured] : []))
const goWhy = goMeasured ? `measured: Tetrads ${cap.np.Tetrads} node power in ${cap.hoursIn}h of ${board.inProgress.label} (bn12-board.json)` : 'go.mjs bladeGoOf mid (no measured farm on the board yet: ASSUMED)'

const specOf = (level, seed, fleet, node = BN12) => ({
  node, level, sf: sfNow, g: 0, installEveryH: null, intelligence: INT, hacking: 200, seed, maxH: 400,
  policy: { shared: true, sharedPolicy: nodePolicyOf(node, bp.POLICY), sleeves: { infiltrate: fleet.infiltrate, support: fleet.support, fa: fleet.fa, ...(fleet.gym > 0 ? { gym: fleet.gym, gymStats: Array.isArray(fleet.gymStats) && fleet.gymStats.length ? fleet.gymStats : ['agility', 'dexterity'] } : {}) }, gymTo: 100, useEst: false },
  go: GO,
})
const cache = new Map()
async function runAll(specs) {
  const todo = specs.map((spec) => ({ key: bbKeyOf(spec), spec })).filter((j) => !cache.has(j.key))
  if (todo.length) await runBbJobs(todo, JOBS, (r) => cache.set(r.key, r))
  return specs.map((s) => cache.get(bbKeyOf(s)))
}
const median = (xs) => {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

// 1. the fleet: the fastest configuration at the current level on the selection seeds (surrogate.pickFleet's rule)
const t0 = Date.now()
const configs = fleetConfigs(bp, Math.min(SLEEVES, 8))
const sel = await runAll(configs.flatMap((c) => SEL_SEEDS.map((s) => specOf(curLevel, s, c))))
let best = null
configs.forEach((c, i) => {
  const m = median(sel.slice(i * SEL_SEEDS.length, (i + 1) * SEL_SEEDS.length).map((r) => r?.hours))
  if (m !== null && (!best || m < best.m)) best = { c, m }
})
if (!best) throw new Error('bn12price: no sleeve configuration finished the selection runs')
const FLEET = best.c
console.log(`fleet: ${bp.sleeveConfigKey(FLEET)} (fastest of ${configs.length} on seeds ${SEL_SEEDS.join(',')} at BN12.${curLevel}: ${best.m.toFixed(2)}h median) | Go farm ${GO.perHour}/h on Tetrads (${goWhy}) | int ${INT} | ${SLEEVES} sleeves | ${((Date.now() - t0) / 1000).toFixed(0)}s`)

// 2. r(L) at every level priced and every anchor's level (0 = the multipliers-1 nodes)
const anchorsBn12 = (board?.clears ?? []).filter((c) => c.done && c.route === 'blade' && c.activeH > 0).map((c) => ({ label: c.label, level: c.level, hours: c.activeH }))
let anchors = anchorsBn12
let anchorWhy = `${anchorsBn12.length} finished BN12 Bladeburner clear(s) (CALIBRATED on the node)`
if (!anchors.length) {
  // the prior anchors: finished Bladeburner clears at SF6.3, SF7.3, SF10.3 of nodes whose Bladeburner multipliers are all 1
  const KEYS = ['BladeburnerRank', 'BladeburnerSkillCost', 'StrengthLevelMultiplier', 'DefenseLevelMultiplier', 'DexterityLevelMultiplier', 'AgilityLevelMultiplier', 'CharismaLevelMultiplier', 'ClassGymExpGain', 'CrimeExpGain']
  const ones = (n, lvl) => KEYS.every((k) => nodeMults(n, lvl)[k] === 1)
  const segs = segmentsOfRows(await readHistoryRows(path.join(TEL, 'history.jsonl')))
  anchors = []
  segs.forEach((s, i) => {
    const sfe = new Map(s.sfOnEntry)
    // 20 black ops seen: the 21st (Operation Daedalus) IS the destroy, often inside the last digest interval
    if (i === segs.length - 1 || s.blackOps < BLACK_OPS_TOTAL - 1 || s.bitNode === BN12) return
    if ((sfe.get(6) ?? 0) < 3 || (sfe.get(7) ?? 0) < 3 || (sfe.get(10) ?? 0) < 3 || !ones(s.bitNode, (sfe.get(s.bitNode) ?? 0) + 1)) return
    const next = segs[i + 1]
    const h = ((Number.isFinite(next.lastNodeReset) ? next.lastNodeReset : Date.parse(next.firstAt)) - (Number.isFinite(s.lastNodeReset) ? s.lastNodeReset : Date.parse(s.firstAt))) / 3.6e6
    if (h > 0) anchors.push({ label: `BN${s.bitNode}.${s.ownSF + 1}`, level: 0, hours: h })
  })
  anchorWhy = `NO BN12 Bladeburner clear finished yet: ${anchors.length} full-Source-File Bladeburner clear(s) of multipliers-1 nodes (${anchors.map((a) => a.label).join(', ')}) at BN12 level 0 — ASSUMED transfer`
}
const allLevels = [...new Set([...levels, ...anchors.map((a) => a.level)])].sort((a, b) => a - b)
const runs = await runAll(allLevels.flatMap((L) => Array.from({ length: SEEDS }, (_, i) => specOf(L, i + 1, FLEET))))
const R = new Map()
allLevels.forEach((L, j) => {
  const rs = runs.slice(j * SEEDS, (j + 1) * SEEDS)
  const hs = rs.map((r) => r?.hours)
  const joins = rs.map((r) => r?.joinH)
  R.set(L, { median: median(hs), join: median(joins), done: rs.filter((r) => r?.hours > 0).length })
})
const rOf = (L) => R.get(L)?.median ?? NaN
const fit = bladeAnchorOf(anchors, rOf)
console.log(`anchors: ${anchorWhy}`)
if (fit) {
  console.log(`  A = ${fit.A.toFixed(3)} (measured / simulated), sd ln ${fit.sdLn === null ? '- (one anchor)' : fit.sdLn.toFixed(3)} over ${fit.n}`)
  for (const l of fit.loo) console.log(`  CHECK leave-one-out ${l.label}: measured ${l.measured.toFixed(2)}h, priced from the others ${l.predicted.toFixed(2)}h, ln ${l.residLn >= 0 ? '+' : ''}${l.residLn.toFixed(3)} ${Math.abs(l.residLn) <= 0.25 ? 'PASS (25%)' : 'FAIL (25%)'}`)
  if (!fit.loo.length) console.log('  CHECK leave-one-out: one anchor — NOT CALIBRATED beyond its own scale')
}
const z = 1.2816
const rows = levels.map((L) => {
  const r = R.get(L)
  const h = fit ? fit.priceOf(L) : null
  // the band: the anchors' own spread, floored at SD_FLOOR (two clears agreeing to 1% is luck, not a 1% model)
  const s = Math.max(fit?.sdLn ?? 0.25, SD_FLOOR)
  return { level: L, inc: +Math.pow(1.02, L).toFixed(4), simH: r?.median ?? null, simJoinH: r?.join ?? null, simDone: r?.done ?? 0, ratio: r && R.get(curLevel)?.median ? +(r.median / R.get(curLevel).median).toFixed(4) : null, hours: h !== null && Number.isFinite(h) ? +h.toFixed(3) : null, p10: h ? +(h * Math.exp(-z * s)).toFixed(3) : null, p90: h ? +(h * Math.exp(z * s)).toFixed(3) : null }
})
console.log(`\nBN12 BLADEBURNER ROUTE BY LEVEL (hours to the 21st black op; ${SEEDS} seeds a level)`)
console.log('  level   inc    sim h  sim join  done  ratio vs now   PRICE h   p10-p90')
for (const r of rows) console.log(`  BN12.${String(r.level).padEnd(3)} ${r.inc.toFixed(3)} ${r.simH?.toFixed(2).padStart(7) ?? '      -'} ${r.simJoinH?.toFixed(2).padStart(8) ?? '       -'} ${String(r.simDone).padStart(5)} ${r.ratio?.toFixed(3).padStart(12) ?? '           -'} ${r.hours?.toFixed(2).padStart(9) ?? '        -'}   ${r.p10 ? `${r.p10.toFixed(1)}-${r.p90.toFixed(1)}` : '-'}`)
const out = { at: new Date().toISOString(), by: 'tools/bn12price.mjs', state: sfNow, intelligence: INT, sleeves: SLEEVES, fleet: bp.sleeveConfigKey(FLEET), go: { ...GO, why: goWhy }, seeds: SEEDS, anchors, anchorWhy, fit: fit ? { A: fit.A, sdLn: fit.sdLn, n: fit.n, loo: fit.loo } : null, sim: Object.fromEntries([...R.entries()]), rows }
if (!has('--no-write')) fs.writeFileSync(path.join(TEL, 'bn12-price.json'), JSON.stringify(out, null, 1) + '\n')
process.exit(0)
