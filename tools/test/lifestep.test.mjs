// [LS] EVERY PLAN SECTION PRICES ITS EXITS IN SLICES — live BN14 2026-10-04.
//
// The healthcheck read PLAN BLOCKED THE PAGE: "64.8ms synchronous block —
// longest step 39.7ms in 'plan-lifeLength' (step 1 of 59)" (51.2ms / 28.5ms at
// 10:30Z). The same pattern 3fe6dc5 fixed in 'plan-install': the life length
// decision's first option's point (and every draw after it) went through
// plan.trajectoryGenOf, which sliced only the no-count 'wait' and 'never'
// kinds — the DEFAULT POLICY (no committed install: hackBasisOf is null on the
// Bladeburner route, so every BN14 hacking price is it) and every count-aware
// kind fell back to the synchronous `f`, a whole policy search per step.
//
// Now trajectoryGenOf slices every kind (the count and route kinds through
// countexit.countExitFixedGen / routeExitFixedGen over bestExitPolicyGen) and
// trajectoryOf is it drained — one definition. The audit of the other plan
// sections found the same piece in: the route decision's hacking arm (point
// and draws through the synchronous `traj`), the 4S decision's and the exit's
// draws (no simGen), the exit's point (before planDecide, outside the pacer),
// the batch choice's points (every candidate's search in one step), the count
// route decision (up to 7 afford-waits of a count search per draw), the gang
// arms (two or three searches per draw, the point arms before the pacer) and
// the count scans (a whole search per composition).
//
//   LS1 WORK UNIT  on BN14's inputs (fixture-bn14-bladeroute-2120: the hacking
//                  exit inputs of the 21:20Z pass; the later lives' lengths
//                  from lifeplan.lifeInputsOf) no step of 'plan-lifeLength'
//                  exceeds PLAN.maxBlockMs, on the default policy and with a
//                  count short — and none is a whole policy search (the old
//                  step 1): the longest step under half of one search in one piece
//   LS2 IDENTICAL  paced = drained; each length's point is the synchronous
//                  search's (exitplan.bestExitPolicy / countexit.countExitFixed)
//   LS3 EVERY KIND trajectoryGenOf yields inside the default, never, wait,
//                  count and route kinds, and returns the synchronous numbers;
//                  countExitFixedGen / routeExitFixedGen / bestCountExitGen /
//                  gangArmsGen given the generator search equal the sync forms
//   LS4 THE AUDIT  the route decision's hacking arm, the batch choice, the
//                  count route decision and a 4S-shaped decideAmong on the same
//                  inputs: every step under the budget and under half a search
//   LS5 WIRING     progress.js: the route decision gets trajGen, 4S / exit /
//                  gang options carry simGen, the exit's point is inside its
//                  planDecide, the gang's point arms and the count scans run on
//                  bestExitPolicyGen; plan.js: trajectoryOf drains trajectoryGenOf

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const P = await import('plan.js')
const X = await import('exitplan.js')
const LP = await import('lifeplan.js')
const C = await import('countexit.js')
const GW = await import('gangworth.js')
const { drain, makePacer } = await import('coop.js')
const T = await import('../sim/bbcal14.mjs')

const fx = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn14-bladeroute-2120.json'), 'utf8'))
const ps = fx.plan.posteriors
// Tagged so exitplan's policy memo (keyed on every input field) holds no answer from another module's run on the
// same fixture: the step counts below must count searches, not memo hits. The simulation never reads the tag.
const base = { ...fx.exitinputs.inputs, memoTag: 'lifestep' }
const NOW = Date.parse(fx.plan.at)
const cad = { rate: { mean: Math.log(ps.cadence.lnPerHour), sd: ps.cadence.rateSdLn }, life: { mean: Math.log(ps.cadence.cycleHours), sd: ps.cadence.lifeSdLn }, own: { weight: 0 } }
const post0 = { drift: { s: ps.s, nu: ps.driftNu ?? 4, a: 2, b: 2 * ps.s * ps.s }, gymSdLn: 0.1, cadence: cad, expPost: { perSec: ps.exp.perSec, sd: ps.exp.sdLn }, income: { perSec: ps.income.perSec, mean: Math.log(ps.income.perSec), sd: ps.income.sdLn } }
const DRAWS = P.makeDraws(post0, P.PLAN.N, P.seedOf(fx.plan.lastAugReset, 14))
// The purchase model's table at BN14's hack-route rate (ln(M) 0.0264/h), a little concave in L.
const L0 = ps.cadence.lnPerHour
const ROWS = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24].map((L) => ({ L, lnMean: L0 * L * Math.pow(L / 3.6, -0.15) }))
const LPOST = { rate: { mean: Math.log(L0), sd: ps.cadence.rateSdLn, weight: 0 }, modelPrior: { lnPerHour: L0, cycleHours: 3.6 } }
const OPTIONS = ROWS.map((r) => ({ L: r.L, inputs: LP.lifeInputsOf(base, { table: ROWS }, r.L, LPOST), cad: LP.lifeCadenceAt(r, LPOST) }))
// A count one short (the count-aware kinds), one distinct augmentation in reach.
const AUG = { name: 'CRTX42-AA Gene Modification', faction: 'NiteSec', via: 'work', price: 1e5, laterPrice: 1e5, detourH: 1.5, hacking: 1.08, exp: 1.15, rep: 1 }
const AUG2 = { ...AUG, name: 'Neurotrainer II', price: 2e5, laterPrice: 2e5, detourH: 0.5, hacking: 1, exp: 1.15 }
const COUNT = { short: 1, ladder: [AUG, AUG2], nfg: null }
const MAX = P.PLAN.maxBlockMs
const strip = (d) => JSON.stringify(d, (k, v) => (k === 'ms' || k === 'alloc' || k === 'decidedAt' || k === 'pricedAt' ? undefined : v))
// One step per simulation (and per point) is what a section that runs each search in one piece takes; sliced, each
// search is ~40 policies, so a sliced section takes many times that. Deterministic, unlike a step's milliseconds.
const SLICED = 5

async function paced(gen, label) {
  const pacer = makePacer({ sliceMs: 40, yieldFn: () => new Promise((r) => setImmediate(r)), memory: new Map() })
  const d = await pacer.slices(gen, label)
  return { d, sec: pacer.stats.sections[label] }
}
// The two bases: none (the default policy — hackBasisOf on the Bladeburner route, live BN14) and a committed
// install with the count one short (the count-aware kind: the default policy ignores the count).
const COUNT_BASIS = { kind: 'wait', installAt: NOW + 0.5 * 3.6e6, waitH: 0.5, n: 1, lifeH: null, gains: null }
const VARIANTS = [
  ['default policy', null, null],
  ['count short', COUNT_BASIS, COUNT],
]
const lifeArgs = (basis, count) => ({ options: OPTIONS, basis, ctx: { count, repPoint: null }, prev: { key: 'L6', lifeH: 6, decidedAt: fx.plan.at, why: 'fixture' }, draws: DRAWS, redecide: true, budgetMs: 1e9, now: NOW, reachSd: ps.s })
/** One whole policy search in one piece on these inputs (warm, distinct inputs so the memo never answers): the median of 5. */
function oneSearchMs() {
  const t = []
  for (let i = 0; i < 5; i++) {
    const x = { ...base, cycleHours: base.cycleHours * (1.013 + i * 0.007) }
    const t0 = performance.now()
    X.bestExitPolicy(x)
    t.push(performance.now() - t0)
  }
  return t.sort((a, b) => a - b)[2]
}
/** A generator's yields and its result. */
function countYields(gen) {
  let n = 0
  for (;;) {
    const r = gen.next()
    if (r.done) return { n, value: r.value }
    n++
  }
}

export async function run() {
  const checks = []
  X.bestExitPolicy({ ...base, cycleHours: 5 }) // JIT warm
  const searchMs = oneSearchMs()

  const c1 = new Check('LS1', `WORK UNIT: no 'plan-lifeLength' step on BN14's inputs exceeds ${MAX}ms, and no search runs in one step (>= ${SLICED} steps a search)`)
  checks.push(c1)
  const A = {}
  for (const [name, basis, count] of VARIANTS) {
    const r = await paced(P.decideLifeLengthGen(lifeArgs(basis, count)), 'plan-lifeLength')
    A[name] = r
    c1.examined(r.sec?.steps ?? 0)
    c1.note(`${name}: ${r.sec.steps} steps, longest ${r.sec.maxStepMs.toFixed(2)}ms (step ${r.sec.maxStepAt}), ${r.sec.cpuMs.toFixed(0)}ms work; one search in one piece ${searchMs.toFixed(2)}ms; decision ${r.d.key} (${(r.d.options ?? []).length} in the draws, ${r.d.screen ?? ''})`)
    if (!r.d.key) c1.fail(`${name}: the fixture must decide a length (${r.d.why})`)
    if (!(r.sec.maxStepMs <= MAX)) c1.fail(`${name}: a 'plan-lifeLength' step took ${r.sec.maxStepMs.toFixed(1)}ms (step ${r.sec.maxStepAt}) against ${MAX}ms`)
    const pieces = (r.d.table ?? []).length + (r.d.n ?? 0) * (r.d.options ?? []).length
    if (!(r.sec.steps >= SLICED * pieces)) c1.fail(`${name}: ${r.sec.steps} steps for ${pieces} searches (points + draws) — under ${SLICED} a search: they run in one piece`)
  }

  const c2 = new Check('LS2', "IDENTICAL: paced = drained, and each length's point is the synchronous search's")
  checks.push(c2)
  for (const [name, basis, count] of VARIANTS) {
    const D = drain(P.decideLifeLengthGen(lifeArgs(basis, count)))
    c2.examined(1)
    if (strip(A[name].d) !== strip(D)) c2.fail(`${name}: the paced decision differs from the drained one`, `${strip(A[name].d).slice(0, 200)} vs ${strip(D).slice(0, 200)}`)
    for (const o of OPTIONS) {
      const sync = count ? C.countExitFixed(X.bestExitPolicy, o.inputs, count, { firstInstallH: basis.waitH, n: basis.n, lifeH: null }) : P.hoursOrNull(X.bestExitPolicy(o.inputs))
      const row = (D.table ?? []).find((t) => t.L === o.L)
      c2.examined(1)
      const want = Number.isFinite(sync) ? +sync.toFixed(3) : null
      if ((row?.pointH ?? null) !== want) c2.fail(`${name} L${o.L}: point ${row?.pointH} against the synchronous search's ${want}`)
    }
  }

  const c3 = new Check('LS3', 'EVERY KIND: trajectoryGenOf yields inside every trajectory kind with the synchronous numbers; the count/route/gang generators equal their sync forms')
  checks.push(c3)
  {
    const x = OPTIONS[5].inputs
    const route = { ...AUG }
    // Perturbed inputs: the policy memo (exitplan) must not answer the generator from an earlier search.
    const xx = { ...x, cycleHours: x.cycleHours * 1.0001 }
    const kinds = [
      ['default', null, {}, (y) => P.hoursOrNull(X.bestExitPolicy(y))],
      ['never', { kind: 'never' }, {}, (y) => P.hoursOrNull(X.bestExitPolicy(y, 0, 0))],
      ['wait', { kind: 'wait', waitH: 1, gains: { hacking: 1.1 } }, {}, (y) => {
        const r = X.bestExitPolicy({ ...y, firstInstallH: 1, installGains: { hacking: 1.1 }, nextInstallGain: 1.1 }, 400, 1)
        return r.degenerate ? null : r.best?.hours ?? null
      }],
      ['wait+count', { kind: 'wait', waitH: 1, n: 1 }, { count: COUNT }, (y) => C.countExitFixed(X.bestExitPolicy, y, COUNT, { firstInstallH: 1, n: 1 })],
      ['route+count', { kind: 'route', route, extra: 0.5 }, { count: COUNT }, (y) => C.routeExitFixed(X.bestExitPolicy, y, COUNT, route, { firstInstallH: route.detourH + 0.5, detourH: route.detourH })],
    ]
    for (const [name, spec, ctx, sync] of kinds) {
      const { n, value } = countYields(P.trajectoryGenOf(spec, ctx)(xx))
      const s = P.trajectoryOf(spec, ctx)(xx)
      const direct = sync(xx)
      c3.examined(1)
      c3.note(`${name}: ${n} yields, ${value === null ? 'null' : value.toFixed(3)}h`)
      // 'never' (maxInstalls 0) is one policy: one yield after it.
      if (!(n >= (name === 'never' ? 1 : 2))) c3.fail(`${name}: the trajectory generator yielded ${n} times — it runs a whole search in one step`)
      if (value !== s) c3.fail(`${name}: the generator's ${value} is not trajectoryOf's ${s}`)
      if (value !== direct) c3.fail(`${name}: the generator's ${value} is not the synchronous pricing's ${direct}`)
    }
    // The count / route / gang generators, given the generator search, against their sync forms.
    const sched = Array.from({ length: 50 }, (_, i) => ({ atH: i, perSec: 1e5 * (1 + i / 10) }))
    const pairs = [
      ['countExitFixedGen', () => C.countExitFixedGen(X.bestExitPolicyGen, x, COUNT, { firstInstallH: 0.7, n: 1 }), () => C.countExitFixed(X.bestExitPolicy, x, COUNT, { firstInstallH: 0.7, n: 1 })],
      ['routeExitFixedGen', () => C.routeExitFixedGen(X.bestExitPolicyGen, x, COUNT, AUG2, { firstInstallH: 0.9 }), () => C.routeExitFixed(X.bestExitPolicy, x, COUNT, AUG2, { firstInstallH: 0.9 })],
      ['bestCountExitGen', () => C.bestCountExitGen(X.bestExitPolicyGen, x, COUNT, { firstInstallH: 0.3, compositions: [1] }), () => C.bestCountExit(X.bestExitPolicy, x, COUNT, { firstInstallH: 0.3, compositions: [1] })],
      ['gangArmsGen', () => GW.gangArmsGen(X.bestExitPolicyGen, x, sched, { fleet: 2, player: 1.2 }, 0.1, 400, { lower: false }), () => GW.gangArms(X.bestExitPolicy, x, sched, { fleet: 2, player: 1.2 }, 0.1, 400, { lower: false })],
    ]
    for (const [name, g, s] of pairs) {
      const { n, value } = countYields(g())
      const want = s()
      c3.examined(1)
      c3.note(`${name}: ${n} yields`)
      if (JSON.stringify(value) !== JSON.stringify(want)) c3.fail(`${name}: differs from its sync form`, `${JSON.stringify(value).slice(0, 160)} vs ${JSON.stringify(want).slice(0, 160)}`)
      if (!(n > 1)) c3.fail(`${name}: yielded ${n} times given the generator search`)
    }
  }

  const c4 = new Check('LS4', `THE AUDIT: the route decision's hacking arm, the batch choice, the count route decision and a 4S-shaped decision — every step under ${MAX}ms, no search in one step`)
  checks.push(c4)
  {
    const FX = JSON.parse(fs.readFileSync(T.FIXTURE, 'utf8'))
    const PASS = T.passesOfFixture(FX).find((p) => p.plan?.decisions?.bladeRoute?.samples?.length)
    const I = T.inputsOf(PASS)
    const tg = P.trajectoryGenOf(null, {})
    const traj = P.trajectoryOf(null, {})
    const withIn = { ...base, incomePerSec: base.incomePerSec * 1.05 }
    const cands = [1, 1.05, 1.1, 1.2].map((g, i) => ({ key: i ? `c${i}` : 'fresh', names: [`a${i}`], gains: { hacking: g, hacking_exp: g } }))
    const sections = [
      ['plan-bladeRoute', () => P.decideBladeRouteGen({ base, traj, trajGen: tg, basis: null, bladeStart: T.startOf(I, { now: Date.parse(I.at) }), prev: null, draws: DRAWS, redecide: true, budgetMs: 1e9, now: Date.parse(I.at), post: true }), (d) => `${d.key} hack ${d.hackH}h blade ${d.bladeH}h`],
      ['plan-batch', () => P.chooseBatchGen({ candidates: cands, inputs: base, waitH: 0.5, installAt: NOW + 1.8e6, draws: DRAWS.slice(0, 8), budgetMs: 1e9, now: NOW }), (d) => `${d.key} by ${d.by}`],
      ['plan-countRoute', () => P.decideRouteGen({ inputs: base, count: COUNT, routes: [AUG, AUG2], point: { tried: [{ ...AUG, hours: 100 }, { ...AUG2, hours: 110 }] }, draws: DRAWS.slice(0, 8), redecide: true, budgetMs: 1e9, now: NOW }), (d) => `${d.key}`],
      ['plan-fourS', () => (function* () {
        const a = yield* tg(base)
        yield
        const b = yield* tg(withIn)
        yield
        return yield* P.decideAmongGen({ options: [{ key: 'none', noiseKey: 'n', sim: (dr) => traj(P.applyDraw(base, dr), dr), simGen: (dr) => tg(P.applyDraw(base, dr), dr) }, { key: 'now', noiseKey: 'n', sim: (dr) => traj(P.applyDraw(withIn, dr), dr), simGen: (dr) => tg(P.applyDraw(withIn, dr), dr) }], draws: DRAWS, redecide: true, budgetMs: 1e9, pointOf: (k) => (k === 'none' ? a : b) })
      })(), (d) => `${d.key}`],
    ]
    for (const [label, mk, say] of sections) {
      const r = await paced(mk(), label)
      const D = drain(mk())
      c4.examined(r.sec?.steps ?? 0)
      c4.note(`${label}: ${r.sec.steps} steps, longest ${r.sec.maxStepMs.toFixed(2)}ms (step ${r.sec.maxStepAt}); ${say(r.d)}`)
      if (strip(r.d) !== strip(D)) {
        const a = strip(r.d)
        const b = strip(D)
        let i = 0
        while (i < a.length && a[i] === b[i]) i++
        c4.fail(`${label}: paced differs from drained`, `at ${i}: ${a.slice(Math.max(0, i - 80), i + 80)} vs ${b.slice(Math.max(0, i - 80), i + 80)}`)
      }
      if (!(r.sec.maxStepMs <= MAX)) c4.fail(`${label}: a step took ${r.sec.maxStepMs.toFixed(1)}ms (step ${r.sec.maxStepAt}) against ${MAX}ms`)
      const rowsN = (r.d.options ?? r.d.rows ?? []).length
      const pieces = rowsN + (r.d.n ?? 0) * rowsN
      if (!(r.sec.steps >= SLICED * pieces)) c4.fail(`${label}: ${r.sec.steps} steps for ${pieces} searches (points + draws) — under ${SLICED} a search: they run in one piece`)
    }
  }

  const c5 = new Check('LS5', 'WIRING: every plan section prices its exits through the generators')
  checks.push(c5)
  {
    const prog = fs.readFileSync(path.join(REPO_ROOT, 'progress.js'), 'utf8')
    const plan = fs.readFileSync(path.join(REPO_ROOT, 'plan.js'), 'utf8')
    const want = [
      [prog, /decideBladeRouteGen\(\{ base, traj: trajectoryOf\(basis, \{\}\), trajGen: trajectoryGenOf\(basis, \{\}\),/, 'progress.js: the route decision gets the hacking arm as a generator (trajGen)'],
      [prog, /\{ key: 'none', noiseKey: nk, sim: [^\n]*simGen: \(d\) => tg\(applyDraw\(base, d\), d\) \}/, "progress.js: the 4S options carry simGen"],
      [prog, /planDecide\(pc, 'exit', function\* \(\) \{\s*try \{\s*pointH = yield\* tg\(inp\)/, "progress.js: the exit's point is priced inside its planDecide, as a generator"],
      [prog, /simGen: \(dr\) => tg\(applyDraw\(inp, dr\), dr\)/, 'progress.js: the exit option carries simGen'],
      [prog, /simGen: \(dr\) => armHGen\(k, applyDraw\(b0, dr\)\)/, 'progress.js: the gang arms carry simGen (gangArmsGen)'],
      [prog, /exitCmp = await paced\(gangArmsGen\(bestExitPolicyGen, /, "progress.js: the gang's point arms run in slices"],
      [prog, /countCtx \? yield\* bestExitPolicyGen\(withIn\)/, "progress.js: the graft decision's with-run policy is a generator under a count"],
      [plan, /export function trajectoryOf\(spec, ctx = \{\}\) \{[^}]*const g = trajectoryGenOf\(spec, ctx\)\s*return \(x, d = null\) => drain\(g\(x, d\)\)/, 'plan.js: trajectoryOf is trajectoryGenOf drained'],
      [plan, /simGen: \(d\) => hackGen\(applyDraw\(base, d\), d\)/, "plan.js: the route decision's hacking arm carries simGen"],
      [plan, /pointHack = yield\* hackGen\(base\)/, "plan.js: the route decision's hacking point is a generator"],
      [plan, /pointH = yield\* o\.pointGen\(\)/, "plan.js: the batch choice's points are generators"],
      [plan, /simGen: simGen\(byKey\.get\(k\)\)/, 'plan.js: the count route options carry simGen'],
    ]
    for (const [src, re, what] of want) {
      c5.examined(1)
      if (!re.test(src)) c5.fail(`${what} — not found`)
    }
    c5.examined(1)
    if (/bestCount(Exit|Route)Gen\(bestExitPolicy,/.test(prog)) c5.fail('progress.js: a count scan still prices on the synchronous search (bestCountExitGen/bestCountRouteGen(bestExitPolicy, ...))')
    c5.examined(1)
    if (/policyOf\(basis, withIn\)/.test(prog.replace(/policyGenOf/g, ''))) c5.fail('progress.js: the 4S decision still prices its policy synchronously (policyOf)')
  }
  return checks
}
