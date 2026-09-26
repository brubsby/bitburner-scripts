// WHICH NEXT: BitNode 1 (-> SF1.3) or BitNode 6 (-> SF6.1)? — priced as
// simulated trajectories to the end of the game, not argued.
//
//   node tools/sim/nodechoice/run.mjs [--jobs 4] [--seeds 7] [--fresh]
//
// T = own-node hours + the hours the new Source-File saves across the nodes
// still to clear (every node below SF level 3 except BN15; BN12 once). Both
// components are printed separately, per economy scenario and per Bladeburner
// bound. Lower T finishes the game sooner.
//
// THE PIECES, each reusing what exists (CLAUDE.md "Decisions compare simulated
// trajectories"; one builder, same inputs, two runs):
//   hacking exit      hackexit.mjs -> exitplan.bestExitPolicy from a FRESH
//                     entry (the arriving state, not today's multiplier)
//   Bladeburner exit  bbsim.mjs -> the game's own Bladeburner/Sleeve/Player
//                     classes, bounded optimistic/pessimistic
//   measurements      measure.mjs (history.jsonl), exitplan.endpointCycleStats
//                     on the lifetimes ledger, /tel/exitinputs.txt
//
// CALIBRATION is printed FIRST, and every conclusion below it inherits its
// error. The Bladeburner half has none (no node has had Bladeburner) and is
// labelled NOT CALIBRATED wherever it appears.

import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { nodeSegments, TELEMETRY } from './measure.mjs'
import { hackExitHours, backOutG, defaultProfile, nodeMults } from './hackexit.mjs'

const ep = await import('exitplan.js')
const np = await import('nodeplan.js')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i > -1 ? process.argv[i + 1] : d
}
const JOBS = Number(arg('--jobs', Math.max(1, Math.min(4, os.cpus().length - 2))))
const SEEDS = Number(arg('--seeds', 25))
const FRESH = process.argv.includes('--fresh')
const CACHE = path.join(HERE, '.cache.json')

const f1 = (x) => (x === null || x === undefined || !isFinite(x) ? '   -  ' : x.toFixed(1).padStart(6))
const pct = (x) => (x === null || !isFinite(x) ? '  -  ' : `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%`.padStart(5))
const gm = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length)
const median = (xs) => {
  const v = xs.filter((x) => x !== null && isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

// ---------------------------------------------------------------------------
// The stack after BitNode 8, and the two candidates' additions.
// ---------------------------------------------------------------------------
const S = [[1, 2], [2, 1], [4, 2], [5, 1], [8, 1], [10, 1]]
const withSF = (sf, n, lvl) => [...sf.filter(([k]) => k !== n), [n, lvl]]
const S_A = withSF(S, 1, 3) // after BN1: SF1.3
const S_B = withSF(S, 6, 1) // after BN6: SF6.1

// Clears still owed after each choice: every node below SF3 except BN15, BN12 once.
function remaining(sf) {
  const have = new Map(sf)
  const out = []
  for (let n = 1; n <= 14; n++) {
    const need = n === 12 ? ((have.get(12) ?? 0) >= 1 ? 0 : 1) : Math.max(0, 3 - (have.get(n) ?? 0))
    if (need > 0) out.push({ node: n, clears: need })
  }
  return out
}

// ---------------------------------------------------------------------------
// 1. MEASUREMENTS
// ---------------------------------------------------------------------------
const segs = (await nodeSegments()).filter((s) => s.hours >= 1)
const ledger = JSON.parse(fs.readFileSync(path.join(TELEMETRY, 'lifetimes.txt'), 'utf8'))
let exitInputs = null
try {
  exitInputs = JSON.parse(fs.readFileSync(path.join(TELEMETRY, 'exitinputs.txt'), 'utf8')).inputs
} catch {
  exitInputs = null
}
const seg = (bn, i = -1) => {
  const all = segs.filter((s) => s.bitNode === bn)
  return i < 0 ? all[all.length + i] : all[i]
}
const bn2 = seg(2)
const bn4b = seg(4, -1)
const bn4a = seg(4, 0)
const bn10 = seg(10)
const bn8 = seg(8)
const bn1a = seg(1, 0)
const bn1b = seg(1, -1)
const bn5 = seg(5, -1)
const current = [bn2, bn4b, bn10, bn8] // the current-stack era (SF4.1+, SF5.1): the user's calibration set

const profile = defaultProfile({
  cycleHours: median(current.map((s) => s.meanLifeH)),
  expRich: bn10?.expRateEnd ?? undefined,
  expPoor: bn8?.expRateEnd ?? undefined,
  capitalReturnPerSec: exitInputs?.capitalReturnPerSec,
  capitalCap: exitInputs?.capitalCap,
})
const intelligence = segs[segs.length - 1]?.intelligence ?? 0

console.log('='.repeat(100))
console.log('NEXT BITNODE: BN1 (->SF1.3) vs BN6 (->SF6.1), priced as trajectories to the end of the game')
console.log('='.repeat(100))
console.log(`telemetry: ${TELEMETRY}  (read-only)`)
console.log(`profile: life ${profile.cycleHours.toFixed(2)}h (median of BN2/4/10/8 mean lives) | final-climb exp ${profile.expRich.toExponential(2)}/s (BN10) poor ${profile.expPoor.toExponential(2)}/s (BN8) | trader r=${(profile.capitalReturnPerSec * 3600).toFixed(3)}/h cap $${(profile.capitalCap / 1e12).toFixed(2)}t (exitinputs) | int ${intelligence}`)

// ---------------------------------------------------------------------------
// 2. CALIBRATION — the hacking-exit projection against every measured node
// ---------------------------------------------------------------------------
const AMC = (bn) => nodeMults(bn).AugmentationMoneyCost
const calNodes = [
  { name: 'BN2', s: bn2 },
  { name: 'BN4 (2nd)', s: bn4b },
  { name: 'BN10', s: bn10 },
  { name: 'BN8 (so far)', s: bn8, partial: true },
]
// The latent per node: backed out of its measured hours (finished nodes), or
// its measured trajectory growth (BN8, unfinished; BN10 as a cross-check).
const trajG = (s) => (s?.multFirst && s?.multLast ? Math.log(s.multLast / s.multFirst) / s.hours : null)
for (const c of calNodes) {
  c.bn = c.s.bitNode
  c.sf = c.s.sfOnEntry
  c.T = c.s.hours
  c.gTraj = trajG(c.s)
  if (c.partial) c.g = c.gTraj
  else {
    const b = backOutG({ node: c.bn, sf: c.sf, profile }, c.T)
    c.g = b.g
    c.gWhy = b.why
  }
  const cs = ep.endpointCycleStats(ledger, c.bn)
  c.gLedger = cs?.lnPerHour ?? null
}
// Augmentation price enters as g ~ AMC^-gamma, gamma from BN10 (the one
// measured node with AMC != 1) against the others — fitted on ONE node.
const gammaFrom = (nodes) => {
  const amc1 = nodes.filter((c) => AMC(c.bn) === 1 && c.g)
  const other = nodes.filter((c) => AMC(c.bn) !== 1 && c.g)
  if (!amc1.length || !other.length) return 0
  return other.map((c) => Math.log(gm(amc1.map((x) => x.g)) / c.g) / Math.log(AMC(c.bn))).reduce((a, b) => a + b, 0) / other.length
}
const GAMMA = gammaFrom(calNodes)
const gNorm = (c, gamma) => c.g * Math.pow(AMC(c.bn), gamma)

console.log('\nCALIBRATION (hacking exit: exitplan.bestExitPolicy from a fresh entry, one latent g = d ln(mult)/dh)')
console.log('-'.repeat(100))
console.log('node          measured   g(back-out)  g(trajectory)  g(ledger)   LOO g     LOO hours   LOO error')
const loo = []
for (const c of calNodes) {
  const others = calNodes.filter((x) => x !== c && x.g)
  const gamma = AMC(c.bn) === 1 ? gammaFrom(others) : 0 // leaving BN10 out leaves nothing to fit gamma on
  const gHat = gm(others.map((x) => gNorm(x, gamma))) * Math.pow(AMC(c.bn), -gamma)
  let predH = null
  let err = null
  if (c.partial) {
    // Unfinished: the hours the prediction needs to reach the multiplier the
    // node has actually reached, against the hours it took.
    const m0 = c.s.multFirst
    predH = Math.log(c.s.multLast / m0) / gHat
    err = predH / c.T - 1
    c.note = `hours to reach its measured multiplier ${c.s.multLast.toFixed(2)} (from ${m0.toFixed(2)}): predicted ${predH.toFixed(1)}h vs measured ${c.T.toFixed(1)}h`
    const fin = hackExitHours({ node: c.bn, sf: c.sf, profile, g: c.g })
    c.note += ` | projected finish at its measured g: ${fin.hours?.toFixed(1)}h total`
  } else {
    predH = hackExitHours({ node: c.bn, sf: c.sf, profile, g: gHat }).hours
    err = predH / c.T - 1
  }
  loo.push(Math.abs(err))
  console.log(`${c.name.padEnd(13)} ${f1(c.T)}h   ${c.g ? c.g.toFixed(4) : '  -   '}       ${c.gTraj ? c.gTraj.toFixed(4) : '   -  '}        ${c.gLedger ? c.gLedger.toFixed(4) : '   -  '}    ${gHat.toFixed(4)}   ${f1(predH)}h   ${pct(err)}${c.partial ? '  (to its multiplier so far)' : ''}`)
  if (c.note) console.log(`              ${c.note}`)
}
const b10 = calNodes.find((c) => c.bn === 10)
const fin10 = hackExitHours({ node: 10, sf: b10.sf, profile, g: b10.g })
console.log(`consistency: BN10 back-out g ${b10.g.toFixed(4)} vs its measured multiplier trajectory ${b10.gTraj.toFixed(4)} (${pct(b10.g / b10.gTraj - 1)}); final multiplier ${fin10.finalMult.toFixed(2)} vs measured ${bn10.multLast.toFixed(2)} (${pct(fin10.finalMult / bn10.multLast - 1)})`)
const LOO_ERR = median(loo)
console.log(`gamma (g ~ AugmentationMoneyCost^-gamma) = ${GAMMA.toFixed(3)} — FITTED ON BN10 ALONE, not validated`)
console.log(`LEAVE-ONE-OUT projection error: median |${(LOO_ERR * 100).toFixed(0)}%|, worst |${(Math.max(...loo) * 100).toFixed(0)}%| — a node's hours are NOT predictable from multipliers`)
console.log(`to better than this; the economy latent g is carried as scenarios below, not as a point.`)
console.log('older stacks, for reference only (SF1.1/SF4.1 era):')
for (const [name, s] of [['BN1 (1st)', bn1a], ['BN1 (2nd)', bn1b], ['BN4 (1st)', bn4a], ['BN5', bn5]]) {
  if (!s) continue
  const b = backOutG({ node: s.bitNode, sf: s.sfOnEntry, profile }, s.hours)
  console.log(`  ${name.padEnd(10)} ${f1(s.hours)}h  g(back-out) ${b.g ? b.g.toFixed(4) : '-'}`)
}
// First-of-a-kind overhead, measured: the same node the first time vs the second.
const F_FIRST = bn4a && bn4b ? bn4a.hours / bn4b.hours : 2
const F_LATER = bn1a && bn1b ? bn1a.hours / bn1b.hours : 1.6
console.log(`first-time overhead, measured: BN4 1st/2nd ${F_FIRST.toFixed(2)}x, BN1 1st/2nd ${F_LATER.toFixed(2)}x (stack also changed between them: an allowance, not a measurement of Bladeburner)`)

// ---------------------------------------------------------------------------
// 3. SCENARIOS for the economy latent (AMC-normalised g), applied to every future node
// ---------------------------------------------------------------------------
const norms = calNodes.map((c) => gNorm(c, GAMMA))
const SCEN = [
  { key: 'lo', label: `g lo ${Math.min(...norms).toFixed(3)} (BN8-like)`, g: Math.min(...norms) },
  { key: 'mid', label: `g mid ${gm(norms).toFixed(3)} (GM of BN2/4/10/8)`, g: gm(norms) },
  { key: 'hi', label: `g hi ${Math.max(...norms).toFixed(3)} (BN2-like)`, g: Math.max(...norms) },
]
const gOf = (scen, n) => scen.g * Math.pow(AMC(n), -GAMMA)

// Cross-check the exit levels against the repo's own table (nodeplan.exitLevelFor).
for (let n = 1; n <= 14; n++) {
  const repo = np.exitLevelFor(n)
  const game = 3000 * nodeMults(n).WorldDaemonDifficulty
  if (repo !== null && Math.abs(repo - game) > 1e-6) console.log(`!!! exit level mismatch BN${n}: repo ${repo} vs game ${game}`)
}

// ---------------------------------------------------------------------------
// 4. HACKING EXITS, every node, both stacks, every scenario
// ---------------------------------------------------------------------------
const hack = {}
for (const sc of SCEN) {
  hack[sc.key] = {}
  for (let n = 1; n <= 14; n++) {
    const r0 = hackExitHours({ node: n, sf: S, profile, g: gOf(sc, n) })
    const rA = hackExitHours({ node: n, sf: S_A, profile, g: gOf(sc, n) })
    const rB = hackExitHours({ node: n, sf: S_B, profile, g: gOf(sc, n) })
    hack[sc.key][n] = { S: r0.hours, A: rA.hours, B: rB.hours, raw: (r0.finalMult ?? 0) / (nodeMults(n).HackingLevelMultiplier * 1.3392), edge: r0.edge }
  }
}

// ---------------------------------------------------------------------------
// 5. BLADEBURNER EXITS — NOT CALIBRATED — bounded
// ---------------------------------------------------------------------------
const BB_NODES = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14].filter((n) => nodeMults(n).BladeburnerRank > 0)
const variants = [] // {node, sfKey}
for (const n of BB_NODES) variants.push({ node: n, sfKey: 'B' })
for (const n of [6, 7]) variants.push({ node: n, sfKey: 'S' }, { node: n, sfKey: 'A' })
const SFS = { S, A: S_A, B: S_B }
const hackingFor = 300 // fixed player hacking level (weighs <= 1/7 of competence)

function policyGrid(bound) {
  const out = []
  const sleeves = [{ infiltrate: 5, gym: 0 }, { infiltrate: 3, gym: 2 }]
  for (const sl of sleeves)
    for (const thr of [0.8, 0.95]) {
      if (bound === 'opt') for (const every of [2, 4, 8]) out.push({ every, policy: { thr, blackThr: thr, sleeves: sl, gymTo: 100 } })
      // Real success chances in both bounds: deciding on the API's estimated
      // range needs an estimate-keeping policy this file does not have — random
      // events (Bladeburner.ts randomEvent) subtract real-population-sized counts
      // from the estimate and zero it, and a range-reading policy stalled for
      // 250h on Field Analysis. A policy gap is not a bound on the game.
      else for (const every of [null, 8]) out.push({ every, policy: { thr, blackThr: thr, sleeves: sl, gymTo: 100 } })
    }
  return out
}
const specOf = (v, bound, scen, pol, seed) => ({
  node: v.node,
  sf: SFS[v.sfKey],
  g: bound === 'opt' ? gOf(scen, v.node) : 0,
  installEveryH: pol.every,
  policy: pol.policy,
  intelligence,
  hacking: hackingFor,
  seed,
  maxH: 600,
})
// The cache key carries the simulator's own source and the game bundle it runs:
// a result computed by older code must never be read back as this code's
// (CLAUDE.md "a stale artifact read as current").
const CODE = crypto.createHash('sha1')
  .update(fs.readFileSync(path.join(HERE, 'bbsim.mjs')))
  .update(fs.readFileSync(path.join(HERE, 'bbjobs.mjs')))
  .update(String(fs.statSync(path.join(HERE, 'game.bundle.mjs')).size))
  .digest('hex')
const keyOf = (spec) => crypto.createHash('sha1').update(CODE).update(JSON.stringify(spec)).digest('hex')
let cache = {}
if (!FRESH && fs.existsSync(CACHE)) cache = JSON.parse(fs.readFileSync(CACHE, 'utf8'))

async function runJobs(specs) {
  const todo = specs.filter((s) => !(keyOf(s) in cache)).map((spec) => ({ key: keyOf(spec), spec }))
  if (todo.length) {
    process.stderr.write(`[bb] running ${todo.length} Bladeburner runs on ${JOBS} processes...\n`)
    const chunks = Array.from({ length: JOBS }, () => [])
    todo.forEach((j, i) => chunks[i % JOBS].push(j))
    await Promise.all(chunks.filter((c) => c.length).map((chunk, i) => new Promise((resolve, reject) => {
      const file = path.join(os.tmpdir(), `nodechoice-jobs-${process.pid}-${i}.json`)
      fs.writeFileSync(file, JSON.stringify(chunk))
      const p = spawn('nice', ['-n', '15', process.execPath, path.join(HERE, 'bbjobs.mjs'), file], { stdio: ['ignore', 'pipe', 'inherit'] })
      let buf = ''
      p.stdout.on('data', (d) => {
        buf += d
        let k
        while ((k = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, k)
          buf = buf.slice(k + 1)
          if (line.trim()) {
            const r = JSON.parse(line)
            cache[r.key] = r
          }
        }
      })
      p.on('exit', (code) => {
        fs.rmSync(file, { force: true })
        code === 0 ? resolve() : reject(new Error(`bbjobs exited ${code}`))
      })
    })))
    fs.writeFileSync(CACHE, JSON.stringify(cache))
  }
  return specs.map((s) => cache[keyOf(s)])
}

// Policy selection on 3 seeds, ONE policy per node shared by its Source-File
// variants, then that policy on SEEDS seeds — common random numbers, so a
// variant's difference from today's stack is a paired difference, not two
// independently noisy medians (a first cut chose per variant and read a 16%
// SF1.3 effect out of seed noise).
const bb = {} // bb[bound][scenKey][node][sfKey] = { median, q1, q3, policy }
async function bladeburnerBound(bound, scen) {
  const grid = policyGrid(bound)
  const sel = []
  const SEL = [101, 102, 103]
  const selVariant = (n) => variants.find((v) => v.node === n && v.sfKey === 'S') ?? variants.find((v) => v.node === n)
  const nodes = [...new Set(variants.map((v) => v.node))]
  for (const n of nodes) for (const pol of grid) for (const seed of SEL) sel.push(specOf(selVariant(n), bound, scen, pol, seed))
  await runJobs(sel)
  const chosen = new Map()
  for (const n of nodes) {
    let best = null
    for (const pol of grid) {
      const hs = SEL.map((seed) => cache[keyOf(specOf(selVariant(n), bound, scen, pol, seed))]?.hours ?? null)
      const m = hs.some((x) => x === null) ? Infinity : hs.reduce((a, b) => a + b, 0) / hs.length
      if (!best || m < best.m) best = { pol, m }
    }
    for (const v of variants.filter((x) => x.node === n)) chosen.set(`${v.node}|${v.sfKey}`, best.pol)
  }
  const evalSpecs = []
  for (const v of variants) for (let seed = 1; seed <= SEEDS; seed++) evalSpecs.push(specOf(v, bound, scen, chosen.get(`${v.node}|${v.sfKey}`), seed))
  await runJobs(evalSpecs)
  const out = {}
  for (const v of variants) {
    const pol = chosen.get(`${v.node}|${v.sfKey}`)
    const hs = Array.from({ length: SEEDS }, (_, i) => cache[keyOf(specOf(v, bound, scen, pol, i + 1))]?.hours ?? null)
    const ok = hs.filter((x) => x !== null).sort((a, b) => a - b)
    out[v.node] ??= {}
    out[v.node][v.sfKey] = {
      median: ok.length > SEEDS / 2 ? median(ok) : null,
      q1: ok.length ? ok[Math.floor(ok.length / 4)] : null,
      q3: ok.length ? ok[Math.floor((3 * ok.length) / 4)] : null,
      failed: SEEDS - ok.length,
      policy: pol,
      seeds: hs,
    }
  }
  return out
}
bb.pess = await bladeburnerBound('pess', SCEN[1]) // pessimistic: g_combat = 0, so one scenario serves all
bb.opt = {}
for (const sc of SCEN) bb.opt[sc.key] = await bladeburnerBound('opt', sc)

// Per-seed paired differences (common random numbers) for the Source-File effects on a Bladeburner exit.
const bbRaw = (bound, sc, n, k) => (bound === 'opt' ? bb.opt[sc.key] : bb.pess)[n]?.[k] ?? null
// A variant of a node that also has today's stack ('S'): its median is today's
// median plus the median PAIRED difference (same policy, same seeds).
function bbGet(bound, sc, n, k) {
  const r = bbRaw(bound, sc, n, k)
  const base = bbRaw(bound, sc, n, 'S')
  if (!r || k === 'S' || !base || base.median === null) return r
  const d = r.seeds.map((h, i) => (h !== null && base.seeds[i] !== null ? h - base.seeds[i] : null)).filter((x) => x !== null)
  if (d.length <= SEEDS / 2) return r
  return { ...r, median: base.median + median(d), paired: median(d) }
}

console.log('\nBLADEBURNER EXIT — NOT CALIBRATED (no node of this run has had Bladeburner). The game\'s own classes, the policy is ours.')
console.log('-'.repeat(100))
console.log('optimistic : combat multiplier grows at the node\'s hacking g (one economy spent on combat), Bladeburners augs bought')
console.log('             from rank-reputation at each install, x1.00 automation overhead')
console.log(`pessimistic: no general combat augs (the work slot is on Bladeburner, not faction rep), Bladeburners augs only,`)
console.log(`             x${F_FIRST.toFixed(2)} (first Bladeburner node) / x${F_LATER.toFixed(2)} (later) automation overhead, measured first-vs-second-attempt ratios`)
console.log(`seeds ${SEEDS}; median [IQR] hours; the pessimistic sim hours are shown BEFORE the overhead factor`)
console.log('node  BladeburnerRank SkillCost StrLvl |  pess(sim)            | opt lo               | opt mid              | opt hi')
for (const n of BB_NODES) {
  const m = nodeMults(n)
  const row = (x) => (x ? `${f1(x.median)} [${f1(x.q1)},${f1(x.q3)}]` : '   -   ').padEnd(21)
  for (const k of n === 6 || n === 7 ? ['S', 'A', 'B'] : ['B']) {
    const tag = { S: 'S   ', A: '+1.3', B: '+6.1' }[k]
    console.log(`BN${String(n).padEnd(3)}${tag} ${String(m.BladeburnerRank.toFixed(2)).padStart(6)} ${String(m.BladeburnerSkillCost.toFixed(2)).padStart(9)} ${String(m.StrengthLevelMultiplier.toFixed(2)).padStart(6)} | ${row(bbGet('pess', null, n, k))} | ${row(bbGet('opt', SCEN[0], n, k))} | ${row(bbGet('opt', SCEN[1], n, k))} | ${row(bbGet('opt', SCEN[2], n, k))}`)
  }
}
const pol6 = bbGet('opt', SCEN[1], 6, 'S')?.policy
console.log(`policy chosen (BN6, opt mid): installs every ${pol6?.every}h, sleeves ${pol6?.policy.sleeves.infiltrate} infiltrate/${pol6?.policy.sleeves.gym} gym, success threshold ${pol6?.policy.thr}`)

// ---------------------------------------------------------------------------
// 6. THE DECISION
// ---------------------------------------------------------------------------
// Exit of node n holding stack `key` at economy gScen (AMC-normalised g): the
// faster of the hacking exit and — where Bladeburner is reachable (BN6/7
// natively, or SF6 held) and enabled (BladeburnerRank > 0) — the Bladeburner
// exit x k (k = 1 is the simulation; the flip search moves it). Between the
// three simulated economies the optimistic Bladeburner hours are interpolated
// in ln(hours) against ln(g); the pessimistic bound does not depend on g.
const BB_FIRST_NODE = 6
const hackMemo = new Map()
function hackAt(n, key, gScen) {
  const mk = `${n}|${key}|${gScen}`
  if (!hackMemo.has(mk)) hackMemo.set(mk, hackExitHours({ node: n, sf: SFS[key], profile, g: gScen * Math.pow(AMC(n), -GAMMA) }).hours)
  return hackMemo.get(mk)
}
function bbAt(n, key, gScen, bound) {
  if (bound === 'pess') {
    const m = bbGet('pess', null, n, key)?.median ?? null
    return m === null ? null : m * (n === BB_FIRST_NODE ? F_FIRST : F_LATER)
  }
  const pts = SCEN.map((sc) => {
    const m = bbGet('opt', sc, n, key)?.median ?? null
    return { lg: Math.log(sc.g), lh: m === null ? null : Math.log(m) }
  })
  if (pts.some((p) => p.lh === null)) return null
  const x = Math.min(pts[2].lg, Math.max(pts[0].lg, Math.log(gScen)))
  const i = x <= pts[1].lg ? 0 : 1
  const t = (x - pts[i].lg) / (pts[i + 1].lg - pts[i].lg)
  return Math.exp(pts[i].lh + t * (pts[i + 1].lh - pts[i].lh))
}
function exitAt(n, key, gScen, bound, k = 1) {
  const h = hackAt(n, key, gScen)
  const hasBB = nodeMults(n).BladeburnerRank > 0 && (n === 6 || n === 7 || key === 'B')
  const b = hasBB ? bbAt(n, key, gScen, bound) : null
  if (b === null) return { hours: h, via: 'hack' }
  return b * k < h ? { hours: b * k, via: 'blade' } : { hours: h, via: 'hack' }
}

const RA = remaining(S_A)
const RB = remaining(S_B)
console.log('\nREMAINING CLEARS')
console.log(`  after BN1 (SF1.3): ${RA.map((x) => `BN${x.node}x${x.clears}`).join(' ')}  = ${RA.reduce((s, x) => s + x.clears, 0)} clears`)
console.log(`  after BN6 (SF6.1): ${RB.map((x) => `BN${x.node}x${x.clears}`).join(' ')}  = ${RB.reduce((s, x) => s + x.clears, 0)} clears`)
console.log('  (repeat clears of one node are priced alike; the Source-File levels those clears add are the same in both worlds)')

console.log('\nPER-NODE EXITS, hours (S = today\'s stack; +1.3 = with SF1.3; +6.1 = with SF6.1 = min(hacking, Bladeburner))')
for (const sc of SCEN) {
  console.log(`  ${sc.label}`)
  console.log('   node  hack(S) hack(+1.3) | opt:+6.1 via | pess:+6.1 via | hack raw mult needed')
  for (let n = 1; n <= 14; n++) {
    const hs = hack[sc.key][n]
    const o = exitAt(n, 'B', sc.g, 'opt')
    const p = exitAt(n, 'B', sc.g, 'pess')
    const flag = hs.raw > 22.9 ? ' > catalogue x22.9: hacking exit OPTIMISTIC' : ''
    console.log(`   BN${String(n).padEnd(3)} ${f1(hs.S)}  ${f1(hs.A)}    | ${f1(o.hours)} ${o.via.padEnd(5)} | ${f1(p.hours)} ${p.via.padEnd(5)} | ${hs.raw.toFixed(1)}${flag}${n === 9 ? '  (hashes not modelled: hacking exit PESSIMISTIC)' : ''}`)
  }
}

function decideAt(gScen, bound, k = 1) {
  const ex = (n, key) => exitAt(n, key, gScen, bound, k)
  const own1 = ex(1, 'S').hours
  const own6 = ex(6, 'S')
  const partsA = RA.map(({ node, clears }) => [node, (ex(node, 'S').hours - ex(node, 'A').hours) * clears])
  const partsB = RB.map(({ node, clears }) => [node, (ex(node, 'S').hours - ex(node, 'B').hours) * clears])
  const saveA = partsA.reduce((s, [, d]) => s + d, 0)
  const saveB = partsB.reduce((s, [, d]) => s + d, 0)
  // The exchange view: the next TWO nodes are BN1 and BN6 in some order, everything after holds both.
  const exch = own1 + ex(6, 'A').hours - (own6.hours + ex(1, 'B').hours)
  return { own1, own6: own6.hours, own6via: own6.via, saveA, saveB, TA: own1 - saveA, TB: own6.hours - saveB, partsA, partsB, exch }
}

console.log('\nDECISION: T = own-node hours - hours the new Source-File saves over the remaining clears (lower finishes sooner)')
console.log('-'.repeat(100))
console.log('scenario / Bladeburner bound         | BN1 own  SF1.3 saves   T(BN1 first) | BN6 own (via)   SF6.1 saves  T(BN6 first) | A-B   | exchange*')
const results = []
for (const sc of SCEN)
  for (const bound of ['opt', 'pess']) {
    const d = decideAt(sc.g, bound)
    results.push({ sc, bound, ...d })
    console.log(`${(sc.label + ' / ' + bound).padEnd(38)}| ${f1(d.own1)}  ${f1(d.saveA)}      ${f1(d.TA)}    | ${f1(d.own6)} (${d.own6via.padEnd(5)}) ${f1(d.saveB)}     ${f1(d.TB)}     | ${f1(d.TA - d.TB)} | ${f1(d.exch)}`)
  }
console.log('* exchange = [T1(S) + T6(S+SF1.3)] - [T6(S) + T1(S+SF6.1)]: if BN6 is played IMMEDIATELY after BN1 (or vice versa), everything later')
console.log('  holds both Source-Files and only these two exits differ. Positive favours BN6 first.')
for (const r of results.filter((x) => x.sc.key === 'mid')) {
  console.log(`\nwhere the SF6.1 hours come from (mid, ${r.bound}):`, r.partsB.filter(([, d]) => Math.abs(d) > 0.05).map(([n, d]) => `BN${n} ${d.toFixed(1)}`).join(', ') || 'nowhere')
  console.log(`where the SF1.3 hours come from (mid, ${r.bound}):`, r.partsA.filter(([, d]) => Math.abs(d) > 0.05).map(([n, d]) => `BN${n} ${d.toFixed(1)}`).join(', '))
}

// ---------------------------------------------------------------------------
// 7. WHAT WOULD FLIP IT
// ---------------------------------------------------------------------------
const winner = (d) => (d.TA < d.TB ? 'BN1' : 'BN6')
console.log('\nVERDICT')
console.log('-'.repeat(100))
const winners = new Set(results.map(winner))
if (winners.size === 1) console.log(`${[...winners][0]} first in EVERY cell (3 economy scenarios x 2 Bladeburner bounds).`)
else console.log(`SPLIT: ${results.map((r) => `${r.sc.key}/${r.bound}:${winner(r)}`).join(' ')}`)
// (a) the economy: where along g does the verdict change, per bound?
for (const bound of ['opt', 'pess']) {
  const lo = SCEN[0].g
  const hi = SCEN[2].g
  const N = 60
  let prev = null
  const cross = []
  for (let i = 0; i <= N; i++) {
    const gS = lo * Math.pow(hi / lo, i / N)
    const w = winner(decideAt(gS, bound))
    if (prev && w !== prev.w) cross.push(`${prev.w}->${w} between g ${prev.g.toFixed(3)} and ${gS.toFixed(3)}`)
    prev = { w, g: gS }
  }
  console.log(`  economy (${bound}): ${cross.length ? cross.join('; ') : `${prev.w} throughout g ${lo.toFixed(3)}..${hi.toFixed(3)}`}`)
}
// (b) the Bladeburner model: by what factor would every Bladeburner exit have to move?
for (const r of results) {
  const w0 = winner(r)
  let flipK = null
  const steps = w0 === 'BN6' ? Array.from({ length: 400 }, (_, i) => 1 + 0.05 * (i + 1)) : Array.from({ length: 95 }, (_, i) => 1 - 0.01 * (i + 1))
  for (const k of steps) {
    if (winner(decideAt(r.sc.g, r.bound, k)) !== w0) {
      flipK = k
      break
    }
  }
  console.log(`  ${r.sc.key}/${r.bound}: ${w0} by ${f1(Math.abs(r.TA - r.TB))}h; flips if every Bladeburner exit were ${flipK ? 'x' + flipK.toFixed(2) + (flipK > 1 ? ' (longer)' : ' (shorter)') : w0 === 'BN6' ? 'never within x21' : 'never, even at x0.05'}`)
}
console.log('\nNOT MODELLED, each named with its direction:')
console.log('  - money is never binding in the Bladeburner runs (gym, augmentations): favours BN6')
console.log('  - no team for operations/black ops: favours BN1 (Bladeburner exits pessimistic)')
console.log('  - hacking exits past the augmentation catalogue (BN13, BN14) and BN9 hashes: see flags above')
console.log('  - the SF1.3 money/rep effect on g itself (+3.2% money and rep buy augmentations faster): favours BN1 slightly')
console.log('  - later SF levels (SF6.2/6.3 +4%/+2% combat, SF1 capped at 3) and the order of the remaining nodes: the same in both worlds')
process.exit(0)
