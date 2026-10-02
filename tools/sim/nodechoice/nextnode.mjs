// WHICH NEXT BITNODE after BitNode 6 — every candidate, priced as the WHOLE
// remaining game, not as one node.
//
//   node tools/sim/nodechoice/nextnode.mjs [--jobs 1] [--bb-seeds 5] [--fresh]
//
// The objective is the user's standing one: finish the entire game soonest.
// "Entire game" = every Source-File to level 3 except SF15 (ruled out by the
// user) and SF12 once — the same set run.mjs used. Every one of those clears
// is owed whatever we pick, so the question is ORDER: a Source-File taken
// earlier speeds more of the clears that follow it, and a node cleared later
// is cleared with a bigger stack. So:
//
//   T(X first) = H(X | stack now) + min over orderings of the rest of
//                sum_i H(clear_i | stack before clear_i)
//
// and the recommendation is argmin_X T(X first). The ordering of the rest is
// found by local search (greedy start, then insertion moves until no single
// move improves the total); the search is printed, never hidden.
//
// H(node | stack) = min(hacking exit, Bladeburner exit where reachable)
//                   - the early-game hours the stack's non-multiplier
//                     Source-Files save (SF9.2/9.3, SF4.3)
// The hacking exit is hackexit.mjs (exitplan.bestExitPolicy from a fresh
// entry, the game's applySourceFile for SF1/SF5); the Bladeburner exit is
// bbsim.mjs (the game's own Bladeburner classes), CALIBRATED on the live BN6 run
// (bbcal6.mjs: live leg / model 0.916) — section 3.
//
// WHAT IS MEASURED vs ASSUMED is printed in the header of the output: the
// latent g of every node we have played is backed out of its measured hours;
// the Source-File effects that are not player multipliers (SF11's
// augmentation price, SF14's Go doubling, SF10's extra sleeve, SF8.2 shorts,
// SF4.3 RAM, SF9.2/9.3 early game) are each an ASSUMPTION bounded lo/mid/hi,
// except SF9.2/9.3 whose per-node hours come from tools/sim/sf-early (a
// simulation, calibrated on BN4/BN10 early game).

import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { nodeSegments, TELEMETRY } from './measure.mjs'
import { hackExitHours, backOutG, defaultProfile, nodeMults } from './hackexit.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const arg = (k, d) => {
  const i = process.argv.indexOf(k)
  return i > -1 ? process.argv[i + 1] : d
}
const JOBS = Number(arg('--jobs', 1)) // one process by default: the machine is tight
const SEEDS = Number(arg('--seeds', 9))
const FRESH = process.argv.includes('--fresh')
const CACHE = path.join(HERE, '.cache-next.json')

const f1 = (x) => (x === null || x === undefined || !isFinite(x) ? '    -' : x.toFixed(1).padStart(6))
const gm = (xs) => Math.exp(xs.reduce((s, x) => s + Math.log(x), 0) / xs.length)
const median = (xs) => {
  const v = xs.filter((x) => x !== null && isFinite(x)).sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

// ---------------------------------------------------------------------------
// The stack after BitNode 9, and what is still owed.
// ---------------------------------------------------------------------------
const S0 = new Map([[1, 3], [2, 1], [4, 2], [5, 1], [6, 1], [8, 1], [9, 1], [10, 1]])
const EXCLUDED = new Set([15])
function owed(stack) {
  const out = []
  for (let n = 1; n <= 14; n++) {
    if (EXCLUDED.has(n)) continue
    const have = stack.get(n) ?? 0
    const need = n === 12 ? (have >= 1 ? 0 : 1) : Math.max(0, 3 - have)
    for (let i = 0; i < need; i++) out.push(n)
  }
  return out
}
const sfPairs = (stack) => [...stack.entries()].filter(([, l]) => l > 0)
const sig = (stack) => [...stack.entries()].sort((a, b) => a[0] - b[0]).map(([n, l]) => `${n}.${l}`).join(',')
const plus = (stack, n) => {
  const s = new Map(stack)
  s.set(n, (s.get(n) ?? 0) + 1)
  return s
}

// ---------------------------------------------------------------------------
// 1. MEASUREMENTS — the latent g of every node played, backed out of its hours
// ---------------------------------------------------------------------------
const segs = (await nodeSegments()).filter((s) => s.hours >= 1)
const seg = (bn, i = -1) => {
  const all = segs.filter((s) => s.bitNode === bn)
  return i < 0 ? all[all.length + i] : all[i]
}
const bn9 = seg(9)
const CURRENT = [
  { name: 'BN2', s: seg(2) },
  { name: 'BN4 (2nd)', s: seg(4, -1) },
  { name: 'BN10', s: seg(10) },
  { name: 'BN8', s: seg(8) },
  { name: 'BN1 (3rd)', s: seg(1, -1) },
  { name: 'BN9', s: bn9 },
]
const profile = defaultProfile({
  cycleHours: median(CURRENT.map((c) => c.s.meanLifeH)),
  expRich: seg(10)?.expRateEnd ?? undefined,
  expPoor: seg(8)?.expRateEnd ?? undefined,
})
const intelligence = segs[segs.length - 1]?.intelligence ?? 0
for (const c of CURRENT) {
  c.bn = c.s.bitNode
  c.T = c.s.hours + (c.extra ?? 0)
  c.g = backOutG({ node: c.bn, sf: c.s.sfOnEntry, profile }, c.T).g
  c.gTraj = c.s.multFirst && c.s.multLast ? Math.log(c.s.multLast / c.s.multFirst) / c.s.hours : null
}
const AMC = (n) => nodeMults(n).AugmentationMoneyCost
const amc1 = CURRENT.filter((c) => AMC(c.bn) === 1)
const other = CURRENT.filter((c) => AMC(c.bn) !== 1)
const GAMMA = other.map((c) => Math.log(gm(amc1.map((x) => x.g)) / c.g) / Math.log(AMC(c.bn))).reduce((a, b) => a + b, 0) / other.length
const norms = CURRENT.map((c) => c.g * Math.pow(AMC(c.bn), GAMMA))
const G_SCEN = { lo: Math.min(...norms), mid: gm(norms), hi: Math.max(...norms) }
// A node we have played uses its OWN measured g in every scenario (it is a
// measurement of this code on that node); BN12 at level 1 is BN1 to within 2%
// on every multiplier, so it borrows BN1's. Everything else is the latent.
const OWN_G = new Map(CURRENT.map((c) => [c.bn, c.g]))
OWN_G.set(12, OWN_G.get(1) * Math.pow(1.02, -GAMMA))
const gNode = (n, sc) => (OWN_G.has(n) ? OWN_G.get(n) : G_SCEN[sc] * Math.pow(AMC(n), -GAMMA))

// First-time automation overhead, measured (the same node, first vs second attempt).

// ---------------------------------------------------------------------------
// 2. SOURCE-FILE EFFECTS THAT ARE NOT PLAYER MULTIPLIERS — each an assumption
// ---------------------------------------------------------------------------
// SF11: AugmentationHelpers.ts:30, price multiplier per queued aug 1.9 x
// [1, .96, .94, .93][lvl]. With a batch budget B the count bought is
// ~ln(B)/ln(r), so augs per install rise by ln1.9/ln r (+6.8% / +10.8% /
// +12.7%). g rises by that to a power phi < 1: the marginal augs are the
// weakest, some batches are reputation-bound, and the catalogue is finite.
const SF11_R = [1, 0.96, 0.94, 0.93]
const SA = {
  lo: { phi11: 0.3, d14: 0.0, d10: 0.0, d8: 0.0, e43: 0.2, e9: 'lo' },
  mid: { phi11: 0.6, d14: 0.02, d10: 0.01, d8: 0.005, e43: 0.7, e9: 'mid' },
  hi: { phi11: 1.0, d14: 0.05, d10: 0.03, d8: 0.02, e43: 1.5, e9: 'hi' },
}
// SF9.2 (128GB home at node start) and SF9.3 (a level-100 hacknet server)
// hours saved in the node's first life, MARGINAL over the level below:
// tools/sim/sf-early sensitivity table (run 2026-09-30, joint/BN4/BN10 fits x
// takeoff 128/1024): lo = min over variants, mid = joint takeoff128, hi = max.
// Nodes it did not simulate take the median of the simulated ones.
const E92 = { 4: [0.9, 3.1, 4.2], 10: [1.1, 3.3, 3.4], 6: [0.3, 0.7, 0.7], 7: [0.3, 0.7, 0.7], 11: [0.1, 0.2, 0.2], 13: [1.7, 1.9, 1.9], 14: [0.6, 3.8, 3.8], 8: [0.0, 0.3, 0.5] }
const E93 = { 4: [0.0, 0.0, 0.9], 10: [0.3, 0.3, 6.1], 6: [1.0, 1.0, 3.0], 7: [1.0, 1.0, 3.0], 11: [0.8, 0.8, 0.9], 13: [5.2, 5.4, 5.4], 14: [1.1, 1.1, 7.6], 8: [0, 0, 0] }
const DEF92 = [0.3, 1.9, 3.8]
const DEF93 = [0.3, 1.0, 3.0]
const IDX = { lo: 0, mid: 1, hi: 2 }

function phi(stack, sa) {
  const a = SA[sa]
  const l11 = Math.min(3, stack.get(11) ?? 0)
  let f = Math.pow(Math.log(1.9) / Math.log(1.9 * SF11_R[l11]), a.phi11)
  if ((stack.get(14) ?? 0) >= 1) f *= 1 + a.d14 // effect.ts:18 doubles every Go bonus
  f *= Math.pow(1 + a.d10, Math.max(0, (stack.get(10) ?? 0) - 1)) // +1 sleeve per level past 10.1
  if ((stack.get(8) ?? 0) >= 2) f *= 1 + a.d8 // shorts (StockMarket.ts:47)
  return f
}
function early(n, stack, sa) {
  const a = SA[sa]
  const i = IDX[a.e9]
  let h = 0
  const l9 = stack.get(9) ?? 0
  if (l9 >= 2) h += (E92[n] ?? DEF92)[i]
  if (l9 >= 3) h += (E93[n] ?? DEF93)[i]
  if ((stack.get(4) ?? 0) >= 3) h += a.e43
  return h
}

// ---------------------------------------------------------------------------
// 3. BLADEBURNER EXITS — bbsim.mjs (the game's classes running bladeburner.js's
//    own policy, bbplan pol.shared), CALIBRATED on the live BN6 run
// ---------------------------------------------------------------------------
// BN6 (2026-10-01 02:49Z -> ~10-02 14:30Z) is the calibration: bbcal6.mjs
// replays the run as it went (the fleet idle until join + 24.8h) and the live
// Bladeburner leg (join -> exit, 27.9h) came in at 0.916 x the model's median
// (seeds IQR 29.7-31.4h); the in-game rank posterior over 8 windows says the
// same direction (realised / model 1.078). So a clear on the Bladeburner route is
//   open + leg(node, SF6 level, SF7 level) x k  -  the early-game hours SF9.2/9.3/4.3 save (capped at open - 0.5h)
// with leg = bbsim hours after the join (5 infiltrating sleeves from the join,
// no installs: the live install decision found them worth < 0.2h with the fleet),
// open = entry -> combat 100 with the gym affordable (MEASURED BN6: 2.5h from a
// 32GB home by crime; the live join came at 7.7h because the route was not
// committed until then — a loss, not the opening).
// Bounds: pess k 1.15 / open 4h, cal k 0.916 / open 2.5h, opt k 0.80 / open 1.5h.
// The node's own Bladeburner multipliers (BladeburnerRank, BladeburnerSkillCost,
// AugmentationRepCost, combat level multipliers) are the game's
// getBitNodeMultipliers inside bbsim; SF6 (combat level/exp) and SF7
// (Bladeburner multipliers) are the game's applySourceFile, simulated per level.
const BB_K = { pess: { k: 1.15, open: 4.0 }, cal: { k: 0.916, open: 2.5 }, opt: { k: 0.8, open: 1.5 } }
const BB_NODES = []
for (let n = 1; n <= 14; n++) if (nodeMults(n).BladeburnerRank > 0 && !EXCLUDED.has(n)) BB_NODES.push(n)
const bp = await import('bbplan.js')
const BB_BASE = sfPairs(S0).filter(([n]) => n !== 6 && n !== 7)
const BB_SEEDS = Number(arg('--bb-seeds', 5))
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
    process.stderr.write(`[bb] ${todo.length} Bladeburner runs on ${JOBS} process(es)...\n`)
    const chunks = Array.from({ length: JOBS }, () => [])
    todo.forEach((j, i) => chunks[i % JOBS].push(j))
    await Promise.all(chunks.filter((c) => c.length).map((chunk, i) => new Promise((resolve, reject) => {
      const file = path.join(os.tmpdir(), `nextnode-jobs-${process.pid}-${i}.json`)
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
const SLEEVES = 5 // SF10.1 + 4 Covenant (sleeve.txt); SF10.2/10.3's extra sleeves are not simulated (conservative)
const bbSpec = (n, l6, l7, seed) => ({
  node: n, sf: [...BB_BASE, ...(l6 ? [[6, l6]] : []), ...(l7 ? [[7, l7]] : [])], g: 0, installEveryH: null, intelligence, hacking: 200, seed, maxH: 400,
  policy: { shared: true, sharedPolicy: bp.POLICY, sleeves: { infiltrate: SLEEVES }, gymTo: 100, useEst: false },
})
const L6 = [1, 2, 3]
const L7 = [0, 1, 2, 3]
await runJobs(BB_NODES.flatMap((n) => L6.flatMap((l6) => L7.flatMap((l7) => Array.from({ length: BB_SEEDS }, (_, i) => bbSpec(n, l6, l7, i + 1))))))
// The Bladeburner leg (hours after the join) — median over seeds; null if most seeds do not finish in 400h.
const BB_LEG = new Map()
for (const n of BB_NODES)
  for (const l6 of L6)
    for (const l7 of L7) {
      const rs = Array.from({ length: BB_SEEDS }, (_, i) => cache[keyOf(bbSpec(n, l6, l7, i + 1))])
      const legs = rs.map((r) => (r?.hours ? r.hours - (r.joinH ?? 0) : null)).filter((x) => x !== null).sort((a, b) => a - b)
      BB_LEG.set(`${n}|${l6}|${l7}`, legs.length > BB_SEEDS / 2 ? { median: median(legs), q1: legs[Math.floor(legs.length / 4)], q3: legs[Math.floor((3 * legs.length) / 4)] } : null)
    }
const bbLeg = (n, stack) => BB_LEG.get(`${n}|${Math.max(1, Math.min(3, stack.get(6) ?? 0))}|${Math.min(3, stack.get(7) ?? 0)}`)

// ---------------------------------------------------------------------------
// 4. H(node | stack) and the ordering search
// ---------------------------------------------------------------------------
const hackMemo = new Map()
function hackH(n, stack, sc, sa) {
  const lvl = n === 12 ? (stack.get(12) ?? 0) + 1 : 1
  const k = `${n}|${lvl}|${sig(stack)}|${sc}|${sa}`
  if (!hackMemo.has(k)) {
    const r = hackExitHours({ node: n, level: lvl, sf: sfPairs(stack), profile, g: gNode(n, sc) * phi(stack, sa) })
    hackMemo.set(k, r.hours ?? Infinity)
  }
  return hackMemo.get(k)
}
const hasBB = (n, stack) => nodeMults(n).BladeburnerRank > 0 && (n === 6 || n === 7 || (stack.get(6) ?? 0) > 0 || (stack.get(7) ?? 0) > 0)
// One clear: returns {h, via}. The Bladeburner automation exists (BN6), so no
// first-attempt overhead and no commitment: each clear takes the faster route.
function bbClearH(n, stack, cell) {
  const leg = bbLeg(n, stack)
  if (!leg) return null
  const { k, open } = BB_K[cell.bb]
  return open - Math.min(early(n, stack, cell.sa), Math.max(0, open - 0.5)) + leg.median * k
}
function clearH(n, stack, cell) {
  const hk = Math.max(0.5 * hackH(n, stack, cell.sc, cell.sa), hackH(n, stack, cell.sc, cell.sa) - early(n, stack, cell.sa))
  if (cell.bb === 'off' || !hasBB(n, stack)) return { h: hk, via: 'hack' }
  const bh = bbClearH(n, stack, cell)
  if (bh === null) return { h: hk, via: 'hack' }
  return bh < hk ? { h: bh, via: 'blade' } : { h: hk, via: 'hack' }
}
function evalSeq(seq, cell, start = S0) {
  let stack = start
  let bbBuilt = false
  let T = 0
  const steps = []
  for (const n of seq) {
    const c = clearH(n, stack, cell, bbBuilt)
    if (c.via === 'blade') bbBuilt = true
    T += c.h
    steps.push({ n, lvl: (stack.get(n) ?? 0) + 1, h: c.h, via: c.via })
    stack = plus(stack, n)
  }
  return { T, steps }
}
// Local search over orderings of `rest` after the fixed prefix.
function bestOrder(prefix, rest, cell) {
  const cost = (seq) => evalSeq([...prefix, ...seq], cell).T
  // greedy start: at each step the clear whose own hours minus what its
  // Source-File saves on everything still owed is least (run.mjs's T).
  let stack = prefix.reduce((s, n) => plus(s, n), S0)
  let bbBuilt = prefix.length ? evalSeq(prefix, cell).steps.some((s) => s.via === 'blade') : false
  const left = [...rest]
  const seq = []
  while (left.length) {
    let best = null
    for (const n of new Set(left)) {
      const own = clearH(n, stack, cell, bbBuilt)
      const s2 = plus(stack, n)
      const others = left.filter((x, i) => i !== left.indexOf(n))
      let save = 0
      for (const m of new Set(others)) save += (clearH(m, stack, cell, bbBuilt || own.via === 'blade').h - clearH(m, s2, cell, bbBuilt || own.via === 'blade').h) * others.filter((x) => x === m).length
      const score = own.h - save
      if (!best || score < best.score) best = { n, score, via: own.via }
    }
    seq.push(best.n)
    if (best.via === 'blade') bbBuilt = true
    stack = plus(stack, best.n)
    left.splice(left.indexOf(best.n), 1)
  }
  let cur = seq
  let curT = cost(cur)
  for (let pass = 0; pass < 50; pass++) {
    let improved = false
    for (let i = 0; i < cur.length; i++)
      for (let j = 0; j < cur.length; j++) {
        if (i === j || cur[i] === cur[j]) continue
        const c = [...cur]
        const [x] = c.splice(i, 1)
        c.splice(j, 0, x)
        const t = cost(c)
        if (t < curT - 1e-9) {
          cur = c
          curT = t
          improved = true
        }
      }
    if (!improved) break
  }
  return { seq: cur, T: curT }
}

// ---------------------------------------------------------------------------
// 5. OUTPUT
// ---------------------------------------------------------------------------
const OWED = owed(S0)
const CANDS = [...new Set(OWED)]
const label = (n, stack = S0) => `BN${n}${n === 12 ? '' : '.' + ((stack.get(n) ?? 0) + 1)}`

console.log('='.repeat(110))
console.log('NEXT BITNODE AFTER BN6 — every candidate priced as the whole remaining game (T = hours to finish everything owed)')
console.log('='.repeat(110))
console.log(`stack after BN6: ${sig(S0)}   owed: ${OWED.length} clears (${CANDS.map((n) => `BN${n}x${OWED.filter((x) => x === n).length}`).join(' ')})   excluded: BN15`)
console.log(`profile: life ${profile.cycleHours.toFixed(2)}h (median of current-era mean lives) | exp rich ${profile.expRich.toExponential(2)}/s poor ${profile.expPoor.toExponential(2)}/s | int ${intelligence}`)
console.log('\nMEASURED — latent g (d ln hacking mult / h) backed out of each node\'s measured hours through hackexit.mjs (BN6 is not one: it left by Bladeburner)')
for (const c of CURRENT) console.log(`  ${c.name.padEnd(10)} ${f1(c.T)}h (measured)                         g ${c.g.toFixed(4)}${c.gTraj ? `  (multiplier trajectory ${c.gTraj.toFixed(4)})` : ''}  sf on entry ${JSON.stringify(c.s.sfOnEntry)}`)
console.log(`  gamma (g ~ AMC^-gamma) ${GAMMA.toFixed(3)} | latent for unplayed nodes: lo ${G_SCEN.lo.toFixed(3)} mid ${G_SCEN.mid.toFixed(3)} hi ${G_SCEN.hi.toFixed(3)} (AMC-normalised)`)
console.log('\nASSUMED (lo / mid / hi), each a factor on g or hours off the node:')
for (const k of ['phi11', 'd14', 'd10', 'd8', 'e43']) console.log(`  ${k.padEnd(6)} ${SA.lo[k]} / ${SA.mid[k]} / ${SA.hi[k]}   ${{ phi11: 'SF11: g x (ln1.9/ln(1.9 r))^phi, r = .96/.94/.93 (source)', d14: 'SF14.1: every Go bonus doubled -> g x (1+d)', d10: 'SF10.2/10.3: +1 sleeve each -> g x (1+d)', d8: 'SF8.2 shorts -> g x (1+d)', e43: 'SF4.3: Singularity RAM 436->247GB (measured) -> hours saved in the first life' }[k]}`)
console.log('  SF9.2/9.3: hours saved per node from tools/sim/sf-early (simulated), lo/mid/hi = its variants; on the Bladeburner route they shorten the opening only')
console.log('  NOT PRICED (0h): SF2.2/2.3, SF3, SF12, SF13; SF7.3\'s Blade\'s Simulacrum (the policy holds the slot for Bladeburner and does not install, so it frees nothing);')
console.log('  SF10.2/10.3 extra sleeves on the Bladeburner route (5 infiltrators simulated); Bladeburner installs buying combat augs (the live decision: < 0.2h with the fleet).')

console.log(`\nBLADEBURNER LEG (hours after the join, bbsim median [IQR] over ${BB_SEEDS} seeds, 5 infiltrators, no installs) — CALIBRATED on BN6: live/model 0.916 (bbcal6.mjs)`)
console.log('  clear = open + leg x k - early-game savings;  pess k 1.15 open 4h | cal k 0.916 open 2.5h | opt k 0.80 open 1.5h')
console.log('  node   SF6.1 SF7.0          SF6.3 SF7.0          SF6.1 SF7.3          SF6.3 SF7.3        | cal clear now | hack mid (stack now)')
const lg = (x) => (x ? `${f1(x.median)} [${f1(x.q1)},${f1(x.q3)}]` : '   -').padEnd(21)
for (const n of BB_NODES) console.log(`  BN${String(n).padEnd(3)} ${lg(BB_LEG.get(`${n}|1|0`))}${lg(BB_LEG.get(`${n}|3|0`))}${lg(BB_LEG.get(`${n}|1|3`))}${lg(BB_LEG.get(`${n}|3|3`))}| ${f1(hasBB(n, S0) ? bbClearH(n, S0, { bb: 'cal', sa: 'mid' }) : null)}       | ${f1(hackH(n, S0, 'mid', 'mid'))}`)

console.log('\nHACKING EXIT, own hours from the stack NOW (g mid / SF-effects mid), before early-game savings:')
console.log('  ' + CANDS.map((n) => `BN${n} ${hackH(n, S0, 'mid', 'mid').toFixed(1)}`).join(' | '))

const BBS = ['off', 'pess', 'cal', 'opt']
const CELLS = []
for (const bb of BBS) for (const sc of ['lo', 'mid', 'hi']) for (const sa of ['lo', 'mid', 'hi']) CELLS.push({ bb, sc, sa })
const results = []
for (const cell of CELLS) {
  const rows = []
  for (const X of CANDS) {
    const rest = [...OWED]
    rest.splice(rest.indexOf(X), 1)
    const b = bestOrder([X], rest, cell)
    const ev = evalSeq([X, ...b.seq], cell)
    rows.push({ X, T: b.T, own: ev.steps[0].h, via: ev.steps[0].via, seq: [X, ...b.seq], steps: ev.steps, cell })
  }
  rows.sort((a, b) => a.T - b.T)
  results.push({ cell, rows })
}

// Downstream value of X: the continuation priced WITH X's Source-File vs the
// same order priced without it (X's clear moved to the very end).
function downstream(row, cell) {
  const withX = evalSeq(row.seq, cell)
  const rest = row.seq.slice(1)
  const noX = evalSeq([...rest, row.X], cell)
  const perNode = {}
  let tot = 0
  const withSteps = withX.steps.slice(1)
  const noSteps = noX.steps.slice(0, -1)
  for (let i = 0; i < withSteps.length; i++) {
    const d = noSteps[i].h - withSteps[i].h
    perNode[withSteps[i].n] = (perNode[withSteps[i].n] ?? 0) + d
    tot += d
  }
  const ownLate = noX.steps[noX.steps.length - 1].h
  return { tot, perNode, ownNow: withX.steps[0].h, ownLate }
}

const key = (c) => `${c.bb}/${c.sc}/${c.sa}`
console.log('\nWINNER PER CELL (Bladeburner bound / economy g / SF-effect assumptions): best first node, T, runner-up and gap')
for (const r of results) {
  const [a, b] = r.rows
  console.log(`  ${key(r.cell).padEnd(14)} ${label(a.X).padEnd(6)} T ${f1(a.T)}h | 2nd ${label(b.X).padEnd(6)} +${(b.T - a.T).toFixed(1)}h`)
}

for (const bb of ['off', 'cal']) {
  const cell = { bb, sc: 'mid', sa: 'mid' }
  const r = results.find((x) => key(x.cell) === key(cell))
  console.log(`\nRANKED — ${key(cell)}  (T = whole remaining game; own = the candidate's own clear now by each route; downstream = hours its SF saves on the clears after it)`)
  console.log('  rank first    blade(h) hack(h) via    T total   dT vs best  own-if-last  downstream  | dT lo..hi over g x SF-effects (same bb)  top downstream')
  r.rows.forEach((row, i) => {
    const d = downstream(row, row.cell)
    const spread = results.filter((x) => x.cell.bb === bb).map((x) => x.rows.find((y) => y.X === row.X).T - x.rows[0].T)
    const top = Object.entries(d.perNode).filter(([, v]) => Math.abs(v) >= 1).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, v]) => `BN${n} ${v.toFixed(1)}`).join(', ')
    const bh = hasBB(row.X, S0) ? bbClearH(row.X, S0, { ...cell, bb: 'cal' }) : null
    const hk = Math.max(0.5 * hackH(row.X, S0, 'mid', 'mid'), hackH(row.X, S0, 'mid', 'mid') - early(row.X, S0, 'mid'))
    console.log(`  ${String(i + 1).padStart(3)}  ${label(row.X).padEnd(7)} ${f1(bh)}  ${f1(hk)}  ${row.via.padEnd(5)} ${f1(row.T)}    +${(row.T - r.rows[0].T).toFixed(1).padStart(6)}     ${f1(d.ownLate)}    ${f1(d.tot)}     | ${Math.min(...spread).toFixed(1)}..${Math.max(...spread).toFixed(1)}   ${top}`)
  })
  const w = r.rows[0]
  console.log(`  best order: ${w.steps.map((s) => `BN${s.n}.${s.lvl}${s.via === 'blade' ? '*' : ''}(${s.h.toFixed(0)})`).join(' ')}   (* = Bladeburner exit)`)
}

console.log('\nREGRET of each first move vs the best in its world (g mid, SF-effects mid)')
const W = BBS.map((bb) => results.find((x) => key(x.cell) === `${bb}/mid/mid`))
for (const X of CANDS) console.log(`  ${label(X).padEnd(7)} ` + W.map((r) => `${r.cell.bb.padEnd(4)} +${(r.rows.find((y) => y.X === X).T - r.rows[0].T).toFixed(1).padStart(5)}h`).join('   '))
for (const set of [['pess', 'cal', 'opt'], BBS]) {
  const rs0 = results.filter((r) => set.includes(r.cell.bb))
  console.log(`\nREGRET over ${rs0.length} cells (Bladeburner ${set.join('/')} x 3 economies x 3 SF-effect sets, equal weight): mean / worst`)
  const regret = CANDS.map((X) => {
    const rs = rs0.map((r) => r.rows.find((y) => y.X === X).T - r.rows[0].T)
    return { X, mean: rs.reduce((a, b) => a + b, 0) / rs.length, worst: Math.max(...rs), wins: rs.filter((x) => x < 1e-6).length }
  }).sort((a, b) => a.mean - b.mean)
  for (const r of regret) console.log(`  ${label(r.X).padEnd(7)} mean +${r.mean.toFixed(1).padStart(5)}h   worst +${r.worst.toFixed(1).padStart(5)}h   best in ${r.wins}/${rs0.length} cells`)
}
process.exit(0)
