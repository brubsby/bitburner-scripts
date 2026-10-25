// THE WHOLE-GAME PLAN: which BitNode next, and the full order of every clear
// still owed, minimising the total hours to finish the game (every SF to 3,
// SF12 once, SF15 to --sf15 (1): BN15 played LAST, the user's decision 2026-10-25).
//
//   node tools/sim/gameplan/plan.mjs                     state + node in progress from telemetry
//   node tools/sim/gameplan/plan.mjs --state 1.3,2.1,4.2,5.1,6.1,8.1,9.1,10.1 --in-progress 4
//   node tools/sim/gameplan/plan.mjs --draws 200 --seed 7 --bb-seeds 5 --jobs 1
//   node tools/sim/gameplan/plan.mjs --build-only        build / extend the surrogate cache and stop
//   node tools/sim/gameplan/plan.mjs --observe           ingest telemetry into posterior.json first (observe.mjs)
//   flags: --in-progress none | --no-sens | --json out.json | --telemetry DIR
//          --sigma-played 0.15 | --rho 0.5 | --direct (mid world on direct sims)
//          --prior (the hand prior only, ignore posterior.json) | --posterior FILE
//          --g-model auto|hand|exch|amc|full (gmodel.mjs; auto = best by leave-one-out)
//          --no-disc (no model-discrepancy term) | --no-adapt (skip KG / bound / CVaR / multi-fidelity)
//          --no-stanek (Stanek's Gift never accepted: the pre-Stanek plan, draw for draw)
//          --no-blade-go (the Bladeburner leg without the Go farm's Tetrads combat channel: the leg before 2026-10-05)
//          --covenant5 auto|10.2|10.3|none (the user's invariant: the 5th Covenant sleeve bought in BN10.2
//          or BN10.3 — auto plans on the shorter whole game; none = the plan without it, the reference)
//          --five-sleeves (5 sleeves everywhere: SF10.2/10.3 and BN10's own extra sleeve worth nothing — the pre-fleet plan)
//          --kg-bins 5 | --mf-k 20 (draws re-priced on direct sims for the multi-fidelity check)
//          --w0-window H (the w0r1d_d43m0n window fixed at H hours: 1 = the old model)
//          --sf15 1|2|3 (SF15's target: 1 = the user's decision 2026-10-25, BN15.1 played LAST; 3 prices
//          BN15.2/15.3 after it) | --lab15 H (BN15's labyrinth leg, routes.mjs LAB15 ASSUMED; default mid)
//          --lab15-ready (price BN15's 'lab' route as if the stack could play it: routepin NODE_ROUTE_RULES[15].labReady)
//          --w0-prior lo,mid,hi (override the derived w0 prior: 0,200,1000 = the old hand one)
//          --w0-live (the w0r1d_d43m0n bonus worth only the climb's shortening L0 - L*: a final
//          life that does not anticipate it, as today's exitplan; default: the exit shift ln W/g)
//          --bn8-hack (BN8 on the hacking/stanek routes: the placeholder pricing before bn8.mjs) | --gift-uncal
//          (Stanek's Gift at the uncalibrated charge model: stanekplan.GIFT_CAL off)
//          --route-rule expected|point (expected, the default: every clear's route chosen on E[hours] under the
//          route family's measured leave-one-out error, routecal.js, and committed in every draw; point: the old
//          rule, the minimum over the points, per draw)
//          --rates fit|const (the hacking exit's exp/s and $/s: fit = rates.mjs's progress model fitted to
//          history.jsonl, the node in progress through its posterior readings; const = the old constants,
//          expRich/expPoor/incomeL1 — the regression mode, reproducing the numbers before the fit)
//
// NOT CALIBRATED as a decision model. What is and is not:
//   CALIBRATED   each played node's g (backed out of its measured hours; the
//                CHECK below re-runs the sim at that g and prints the error);
//                the Bladeburner k = 1.223 (live BN6 leg / the planner's own leg, params.BB_PARAMS).
//   NOT CALIBRATED  g on every unplayed node (the latent, lo/mid/hi over the
//                measured runs); k's spread (one node); every ASSUMED
//                Source-File effect (effects.mjs); the node-special routes
//                (BN14's is MODELLED from source + the measured BN9 Go farm
//                with one ASSUMED input, eps14, and w0 DERIVED from the payout
//                rules x uncertain inputs — go.mjs; Stanek's Gift
//                (SF13, BN13) is MODELLED from source with MEASURED home RAM and
//                four ASSUMED inputs — stanek.mjs; BN3/8's are placeholders that
//                price nothing: routes.mjs); the draw's
//                correlation structure (params.mjs RHO, SIGMA_PLAYED).
// So the output is a decision UNDER those assumptions, with the regret and the
// value-of-information tables saying how much each one could move it.
//
// PIPELINE: economy.mjs (telemetry -> g) -> surrogate.mjs (sims -> cached grid)
// -> posterior.mjs (the hand prior updated by observe.mjs's log) -> routes.mjs
// (C = min over routes) -> search.mjs (exact DP over the SF lattice) -> draws
// (params.mjs, through the posterior) -> regret, robust plan, sensitivity, explore
// -> learning (adaptive.mjs): the knowledge gradient of each first move, the
// information-relaxation bound, CVaR, and the surrogate re-priced on the
// simulation (multi-fidelity). The g prior is gmodel.mjs's covariate model when
// leave-one-out keeps it; unplayed nodes carry a model discrepancy (discrepancy.mjs).

import '../../test/gameresolve.mjs'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const argv = process.argv.slice(2)
const arg = (k, d) => {
  const i = argv.indexOf(k)
  return i > -1 ? argv[i + 1] : d
}
const has = (k) => argv.includes(k)
if (arg('--telemetry')) process.env.TELEMETRY = path.resolve(arg('--telemetry'))

const T_START = performance.now()
const phase = {}
const tick = (name, t0) => (phase[name] = (phase[name] ?? 0) + (performance.now() - t0) / 1000)

const { makeState, parseState, plus, lvl, owed, lattice, sig, clearLabel, pairsOf, NODES } = await import('./state.mjs')
const { EFFECTS, SF_PARAMS, isInert, LIVE_SFS } = await import('./effects.mjs')
// --w0-prior lo,mid,hi: replace the DERIVED w0 prior (e.g. 0,200,1000 = the old hand prior; with
// --w0-window 1 that is the model before the derived prior and the climb window — the comparison run)
if (arg('--w0-prior')) {
  const [lo, mid, hi] = arg('--w0-prior').split(',').map(Number)
  Object.assign(SF_PARAMS.w0, { lo, mid, hi, what: `${SF_PARAMS.w0.what} — OVERRIDDEN by --w0-prior to ${lo}/${mid}/${hi}` })
}
const { BB_PARAMS, RHO, SIGMA_PLAYED, rng, normal, drawZ, worldOf, paramIds } = await import('./params.mjs')
const { ROUTES, clearTime, hackParts, favorHours, favorRef, stanekParts } = await import('./routes.mjs')
const { gridOf, layoutFor, layoutText, giftAvailable } = await import('./stanek.mjs')
const { buildTable, solveDP, bestPath, firstMoves, localSearch, prefixTotal } = await import('./search.mjs')
const { GO_MEASURED, GO_REF, goScale, goMaxRep, w0PriorMC, bladeGoOf } = await import('./go.mjs')
const { POSTERIOR_FILE, loadStore, emptyStore, posteriorOf, summarise, measurability, appliedObs } = await import('./posterior.mjs')
const { runObserve, printMove, clearLegSpecs } = await import('./observe.mjs')
const { looCompare, MODEL_WHAT } = await import('./gmodel.mjs')
const { fitDiscrepancy, lnHoursMoments, PRIOR_SD } = await import('./discrepancy.mjs')
const { cvar, infoRelaxation, foldsOf, openLoop, kgOfMove, mfmc, seMean } = await import('./adaptive.mjs')
let t0 = performance.now()
const { measureEconomy } = await import('./economy.mjs')
const { buildSurrogate, loadSurrogate, LN_G, BB_INT } = await import('./surrogate.mjs')
const { hackExitHours, finalRatesOf } = await import('../nodechoice/hackexit.mjs')
const { sfMultsOf } = await import('./economy.mjs')
tick('boot (game bundle)', t0)

const DRAWS = Math.max(1, Number(arg('--draws', 100)))
const SEED = Number(arg('--seed', 1))
// 15 seeds per Bladeburner cell (nextnode used 5; GP3 reproduces it at 5). A sim is ~0.2s.
const BB_SEEDS = Number(arg('--bb-seeds', 15))
const JOBS = Number(arg('--jobs', 1))
const SIGMA_P = Number(arg('--sigma-played', SIGMA_PLAYED))
const RHO_ = Number(arg('--rho', RHO))
const G_MODEL = arg('--g-model', 'auto')
const ADAPT = !has('--no-adapt')
const KG_BINS = Number(arg('--kg-bins', 5))
const MF_K = Number(arg('--mf-k', 20))

const f1 = (x) => (x === null || x === undefined || !isFinite(x) ? '    -' : x.toFixed(1).padStart(6))
const pct = (x) => `${(100 * x).toFixed(0)}%`.padStart(4)
const quant = (xs, q) => {
  const v = [...xs].sort((a, b) => a - b)
  return v[Math.min(v.length - 1, Math.floor(q * v.length))]
}
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length

// ---------------------------------------------------------------------------
// 1. Measurements and the state
// ---------------------------------------------------------------------------
t0 = performance.now()
const RATES = arg('--rates', 'fit')
const econ0 = await measureEconomy({ rates: RATES, posteriorFile: arg('--posterior') ? path.resolve(arg('--posterior')) : undefined, inRun: has('--prior') ? [] : null })
const econ = { ...econ0, ownG: new Map(econ0.ownG) }
const econRaw = { ...econ, ownG: new Map(econ.ownG) } // the hand economy, before the posterior
tick('telemetry + g back-out', t0)
const live = econ.live
const entry = arg('--state') ? parseState(arg('--state'), live.intelligence) : makeState(live.sfOnEntry, live.intelligence)
let inProg = arg('--in-progress', arg('--state') ? 'none' : String(live.bitNode))
inProg = inProg === 'none' ? null : Number(inProg)
if (inProg && !owed(entry).includes(inProg)) inProg = null
const start = inProg ? plus(entry, inProg) : entry

// ---------------------------------------------------------------------------
// 2. The surrogate (built incrementally over the ENTRY lattice, a superset)
// ---------------------------------------------------------------------------
t0 = performance.now()
// the legs every logged Bladeburner clear is read against (observe.mjs CLEAR_LEGS: its own Go farm)
const EXTRA_BB = clearLegSpecs(await (await import('../nodechoice/measure.mjs')).nodeSegments())
// --no-blade-go: the Bladeburner grid without the Go farm's Tetrads channel (the leg before 2026-10-05; the farm's own value)
const BLADE_GO = !has('--no-blade-go')
const bstats = await buildSurrogate({ start: entry, profile: econ.profile, bbSeeds: BB_SEEDS, jobs: JOBS, extraBb: EXTRA_BB, bladeGo: BLADE_GO, log: (s) => process.stderr.write(s + '\n') })
tick('surrogate build', t0)
if (has('--build-only')) {
  console.log(JSON.stringify(bstats))
  process.exit(0)
}
t0 = performance.now()
let S = await loadSurrogate({ start: entry, profile: econ.profile, bbSeeds: BB_SEEDS, direct: has('--direct'), bladeGo: BLADE_GO })
tick('surrogate load', t0)

// ---------------------------------------------------------------------------
// 2b. The posterior: the hand prior + the observation log (posterior.mjs)
// ---------------------------------------------------------------------------
const POST_FILE = arg('--posterior') ? path.resolve(arg('--posterior')) : POSTERIOR_FILE
if (has('--observe')) {
  t0 = performance.now()
  const { TELEMETRY } = await import('../nodechoice/measure.mjs')
  await runObserve({ econ: econRaw, S, telemetry: TELEMETRY, file: POST_FILE, gModel: G_MODEL })
  console.log('')
  tick('observe', t0)
  // observe may have logged a new in-run rates reading (xr/ir of the node in progress): re-fit the
  // rates on it and rebuild that node's curves (the cache is keyed per node: only its curves move)
  if (RATES === 'fit') {
    t0 = performance.now()
    const e2 = await measureEconomy({ rates: RATES, posteriorFile: POST_FILE })
    if (JSON.stringify(e2.profile) !== JSON.stringify(econ.profile)) {
      for (const x of [econ, econRaw]) Object.assign(x, { profile: e2.profile, rates: e2.rates })
      await buildSurrogate({ start: entry, profile: econ.profile, bbSeeds: BB_SEEDS, jobs: JOBS, extraBb: EXTRA_BB, bladeGo: BLADE_GO, log: (s) => process.stderr.write(s + '\n') })
      S = await loadSurrogate({ start: entry, profile: econ.profile, bbSeeds: BB_SEEDS, direct: has('--direct'), bladeGo: BLADE_GO })
      console.log('  rates re-fitted on the new in-run reading(s); the surrogate rebuilt for the changed nodes\n')
    }
    tick('observe: rates re-fit', t0)
  }
}
let store = has('--prior') ? emptyStore() : loadStore(POST_FILE)

// ---------------------------------------------------------------------------
// 2a. ROUTE-LEVEL g (calib.mjs): every finished hacking-route clear's g is the one that makes the
// route it PLAYED (hack, or stanek when it accepted the gift) reproduce its hours at its own entry
// state — not the bare simulation's (the logged value, kept as gSim). --g-def sim: the old definition.
// ---------------------------------------------------------------------------
const OBS_SD_G = 0.15 // posterior.OBS_SD.g: one run's replay noise in ln g
const G_DEF = arg('--g-def', has('--phase1') ? 'sim' : 'route')
if (!['route', 'sim'].includes(G_DEF)) throw new Error(`--g-def ${G_DEF}: expected route or sim`)
let CAL = null
if (G_DEF === 'route') {
  t0 = performance.now()
  const { routeCalibrate, giftRows } = await import('./calib.mjs')
  const { latentOf } = await import('./economy.mjs')
  const { nodeSegments, TELEMETRY } = await import('../nodechoice/measure.mjs')
  const gReads = appliedObs(store.observations).filter((o) => /^g\d+$/.test(o.param))
  // every calibrated node prices its favor life against its own (world.go.played): the g's value is overridden per call
  const calEcon = { ...econRaw, ownG: new Map([...econRaw.ownG, ...gReads.map((o) => [Number(o.param.slice(1)), 1])]) }
  const calWorld = worldOf(calEcon, {}, { sigmaPlayed: SIGMA_P })
  const gifts = giftRows(TELEMETRY)
  CAL = { ...routeCalibrate({ econ: econRaw, readings: gReads, segs: await nodeSegments(), world: calWorld, S, gifts }), world: calWorld, gifts }
  const bad = CAL.items.filter((it) => !(it.gRoute > 0))
  if (bad.length) throw new Error(`plan: route-level g not backed out for ${bad.map((it) => `${it.name} (${it.why})`).join('; ')} — fix it or run --g-def sim`)
  for (const x of [econ, econRaw]) {
    x.runs = x.runs.map((r) => ({ ...r, gSim: r.g, g: CAL.items.find((it) => it.from === 'run' && it.name === r.name).gRoute }))
    const lat = latentOf(x.runs)
    Object.assign(x, { gamma: lat.gamma, gScen: lat.gScen, ownG: new Map(lat.ownG) })
    x.looRuns = CAL.items.map((it) => ({ bn: it.bn, g: it.gRoute, sd: OBS_SD_G }))
  }
  // the logged readings keep their logged (bare-simulation) value; the posterior applies the route-level one
  store = {
    ...store,
    observations: store.observations.map((o) => {
      const it = CAL.items.find((i) => i.from === 'reading' && i.key === o.key)
      return it ? { ...o, value: it.gRoute, note: `${o.note ?? ''} (route-level g; logged ${o.value.toFixed(4)})` } : o
    }),
  }
  tick('route-level g (calib.mjs)', t0)
}
const post = posteriorOf(store, econRaw, { rho: RHO_, sigmaPlayed: SIGMA_P, gModel: G_MODEL, multsOf: S.mults })
Object.assign(econ, post.applied)
const postSum = summarise(post, econRaw)
const RHO_DRAW = arg('--rho') ? RHO_ : econ.rho

// ---------------------------------------------------------------------------
// 2c. The g model's leave-one-out, and the model discrepancy fitted to it
// ---------------------------------------------------------------------------
// THE CALIBRATION CHECK (CLAUDE.md "Calibrate against the live game"): every finished hacking-route
// clear's hours predicted by the chosen g model fitted WITHOUT it (leave-one-out), through the route it
// played at its own entry state (route-level g), against the measured hours. The same residuals fit the
// discrepancy term. --g-def sim: the old check (bare simulation, the six base runs).
const looData = econ.looRuns ?? econ.runs.map((r) => ({ bn: r.bn, g: r.g, sd: OBS_SD_G }))
const loo = looCompare(looData, S.mults)
const gChosen = post.gReg?.chosen ?? 'hand'
const { routeHours } = await import('./calib.mjs')
const discRes = (CAL ? CAL.items : econ.runs).map((r, i) => {
  const p = loo.models[gChosen].per[i]
  const hoursOf = CAL ? (g) => routeHours({ node: r.bn, lv: r.lv, route: r.route, g, world: CAL.world, S: CAL.Sd }) : (g) => hackExitHours({ node: r.bn, sf: r.sfOnEntry, profile: econ.profile, g }).hours ?? Infinity
  const mom = lnHoursMoments(hoursOf, p.mean, p.sd)
  const q = (z) => hoursOf(Math.exp(p.mean + z * p.sd))
  return { bn: r.bn, name: r.clear ?? r.name, T: r.T, r: Math.log(r.T) - mom.mean, v: mom.var, predH: Math.exp(mom.mean), p10: q(1.2816), p90: q(-1.2816), gLoo: Math.exp(p.mean), g: r.gRoute ?? r.g, gSim: r.gSim, hSim: r.hSim, route: r.route ?? 'hack' }
})
const discFit = fitDiscrepancy(discRes)
if (!has('--no-disc')) econ.disc = { sd: discFit.sd, applies: (n) => !econ.ownG.has(n) }

// ---------------------------------------------------------------------------
// 2d. THE ROUTE CALIBRATION BAND (routecal.js): each route family's out-of-sample error, measured here
// every run, and the route chosen on E[hours] = point x exp(s^2/2) (routes.mjs clearTime, params.mjs
// routeErrOf). --route-rule point: the old rule (the minimum over the points), for the comparison.
// ---------------------------------------------------------------------------
const ROUTE_RULE = arg('--route-rule', has('--phase1') ? 'point' : 'expected')
if (!['expected', 'point'].includes(ROUTE_RULE)) throw new Error(`--route-rule ${ROUTE_RULE}: expected 'expected' or 'point'`)
const RC = await import('routecal.js')
const BLADE_RES = []
const BLADE_SKIP = []
{
  // THE BLADEBURNER FAMILY: every finished Bladeburner clear whose k is NOT in the posterior (observe.mjs
  // withholds them: out of sample), entered after the Go farm's combat channel (the grid prices the farm),
  // priced by the plan's own route at its entry state against its measured hours — the route it PLAYED:
  // 'bladeStanek' where it accepted Stanek's Gift (calib.mjs giftRows) and the gift's leg is tabled; where the
  // gift's leg is not tabled the plan itself prices that state by 'blade', so the clear is read against it
  const { nodeSegments, TELEMETRY } = await import('../nodechoice/measure.mjs')
  const { giftLegOf } = await import('./bladestanek.mjs')
  const gifts = CAL?.gifts ?? (await import('./calib.mjs')).giftRows(TELEMETRY)
  const { HACK_LEVEL, MIN_CLEAR_H, GO_COMBAT_SINCE } = await import('./observe.mjs')
  const { bladeHours } = await import('./routes.mjs')
  const segs = await nodeSegments()
  const kIn = new Set(appliedObs(store.observations).filter((o) => o.param === 'k').map((o) => o.key.split('|')[1]))
  const w = worldOf(econ, {}, { sigmaPlayed: SIGMA_P })
  segs.forEach((s, i) => {
    if (i === segs.length - 1 || !s.startedAt || s.startedAt < GO_COMBAT_SINCE || s.hours < MIN_CLEAR_H) return
    if (!(s.bbJoinH >= 0) || s.maxLevel >= HACK_LEVEL) return
    const sf = new Map(s.sfOnEntry ?? [])
    const lv = (n) => sf.get(n) ?? 0
    const clear = `BN${s.bitNode}.${lv(s.bitNode) + 1}`
    if (kIn.has(clear)) return BLADE_SKIP.push(`${clear} (its k is in the posterior: in sample)`)
    const gift = gifts.some((x) => x.bn === s.bitNode && x.t >= Date.parse(s.startedAt) && x.t <= Date.parse(s.endedAt))
    const leg = gift ? giftLegOf(s.bitNode, lv(13), lv(6), lv(7)) : null
    const h = bladeHours({ node: s.bitNode, lv, world: w, S }, leg)
    if (!(h > 0) || !isFinite(h)) return BLADE_SKIP.push(`${clear} (the route has no leg at SF6.${lv(6)}/SF7.${lv(7)} on the grid)`)
    BLADE_RES.push({ bn: s.bitNode, clear, T: s.hours, pred: h, r: Math.log(s.hours / h), route: leg ? 'bladeStanek' : gift ? 'blade+gift' : 'blade' })
  })
}
const rms = (xs) => (xs.length ? Math.sqrt(xs.reduce((a, x) => a + x * x, 0) / xs.length) : null)
const byNode = (res) => {
  const out = {}
  for (const bn of new Set(res.map((x) => x.bn))) out[bn] = +rms(res.filter((x) => x.bn === bn).map((x) => x.r)).toFixed(3)
  return out
}
// r = ln(measured / predicted) for both families (discRes carries ln T - E ln T_pred)
const ROUTE_MEASURED = {
  hacking: { pooled: rms(discRes.map((d) => d.r)), n: discRes.length, nodes: byNode(discRes) },
  blade: { pooled: rms(BLADE_RES.map((d) => d.r)), n: BLADE_RES.length, nodes: byNode(BLADE_RES) },
}
// k's posterior spread in ln: the part of the Bladeburner band the draws already carry
const kQ = postSum.k?.post ?? [BB_PARAMS.k.lo, BB_PARAMS.k.mid, BB_PARAMS.k.hi]
const K_SD = Math.log(kQ[2] / kQ[0]) / (2 * 1.2816)
const ROUTE_ERR = { cal: ROUTE_MEASURED, sdOf: (route, node) => RC.routeSdOf(route, node, ROUTE_MEASURED), kSd: K_SD }
if (ROUTE_RULE === 'expected') econ.routeErr = ROUTE_ERR

// --no-stanek: the gift is never accepted, and SF13 is inert again (exactly the pre-Stanek table)
const NO_STANEK = has('--no-stanek')
const live_ = (n) => !isInert(n) && !(NO_STANEK && n === 13)
const tableFor = (L, world) => {
  const T = buildTable(L, (n, lv) => clearTime(n, lv, world, S).h, live_)
  world._ct = undefined // clearTime's per-world memo (routes.mjs): the table holds what it was for
  return T
}
const lvOf = (s) => (n) => lvl(s, n)

// ---------------------------------------------------------------------------
// 3. The mid world: exact optimum, and nextnode's question from the entry
// ---------------------------------------------------------------------------
// --phase1: price as phase 1 did (no IPvGO model, no gym scale, BN14 speed 1) — the before/after comparison
// --w0-window H: the old fixed w0r1d_d43m0n window of H hours (1 = the model before the climb window; regression)
const W0_WINDOW = arg('--w0-window') !== undefined ? Number(arg('--w0-window')) : null
// --sf15 L: SF15's target level (state.mjs: 1 = the user's decision, BN15.1 last; 3 prices BN15.2/15.3 after it)
if (arg('--sf15') !== undefined) (await import('./state.mjs')).setSf15Target(Number(arg('--sf15')))
// --lab15 H: BN15's labyrinth leg over its hacking exit (routes.mjs LAB15, ASSUMED; default its mid)
const LAB15_H = arg('--lab15') !== undefined ? Number(arg('--lab15')) : null
// --five-sleeves: 5 sleeves everywhere (SF10.2/10.3 and BN10's own extra sleeve priced at nothing: the pre-fleet plan)
// --covenant5 auto|10.2|10.3|none: THE USER'S INVARIANT (2026-10-14) — the 5th Covenant sleeve WILL be
// bought, in BN10.2 or BN10.3, whichever makes the whole remaining game shortest. auto (the default)
// solves both on the mid world and plans on the shorter; 10.2/10.3 force one; none = the plan
// without it (the reference). The fleet is then 'cov2'/'cov3' (sleeves.mjs covenantOf: 5 Covenant
// sleeves from that SF10 level on, 8 sleeves at most) and the buying clear carries the purchase leg
// (routes.mjs clearTime + covLegOf below).
const { covenantLegHours, COVENANT5 } = await import('./sleeves.mjs')
const { hackSfOf } = await import('./effects.mjs')
const { freshInputs } = await import('../nodechoice/hackexit.mjs')
/** The rates model's BN10 final-window income at a state's Source-Files (rates.mjs finalRatesOf via hackexit.freshInputs, the builder the hacking clear reads). */
const bn10ModelIncomeOf = (sfPairs) => freshInputs({ node: 10, sf: sfPairs, g: 1, profile: econ.profile }).flatIncomePerSec ?? null
// THE LEG'S INCOME, CALIBRATED: the rates model's level for BN10 is its pooled-slope line through
// every window of the run, 3.6x above the run's own MEASURED final window (rates.mjs CHECK income
// BN10: $2.48e12/s at level 6368, the median 10-min window of its last 3h). The exit hours are
// logarithmic in the rate so that does not move a clear, but the purchase leg is linear in it — so
// the leg is anchored on the measured window and only the Source-File transfer is the model's:
//     I(state) = I_measured(BN10.1) x model(state's SFs) / model(BN10.1's entry SFs)
// (the ratio is hacking_money's, rates.mjs incomeOffset). No measured BN10 window (or --rates const):
// the model alone, printed NOT CALIBRATED.
// THE ANCHOR PAIR: a measured BN10 final window and ITS OWN run (the window's key), so the model ratio
// uses that run's entry Source-Files. Several BN10 runs (BN10.1, BN10.3 since 2026-10-20): the latest
// window that has its run — never a window from one run against another run's SFs.
const loos10 = (econ.rates?.channels?.income?.loo ?? []).filter((l) => l.bn === 10)
const paired10 = loos10.map((l) => ({ l, r: econ.runs.find((r) => r.bn === 10 && (String(l.key).startsWith(String(r.start)) || Math.abs(Date.parse(l.key) - Date.parse(String(r.start).length <= 16 ? r.start + ':00Z' : r.start)) <= 90 * 60e3)) })).filter((x) => x.r)
if (loos10.length && !paired10.length) throw new Error(`plan: ${loos10.length} measured BN10 final window(s) and none matches an econ.runs BN10 key — the Covenant leg has no anchor (windows ${JSON.stringify(loos10.map((l) => l.key))}; runs ${JSON.stringify(econ.runs.filter((r) => r.bn === 10).map((r) => ({ start: r.start, key: r.key })))})`)
const loo10 = paired10.at(-1)?.l ?? null
const r10 = paired10.at(-1)?.r ?? econ.runs.find((r) => r.bn === 10)
const BN10_ANCHOR = loo10 && r10 && bn10ModelIncomeOf(r10.sfOnEntry) > 0 ? { measured: loo10.measured, level: loo10.lpk, key: loo10.key, model: bn10ModelIncomeOf(r10.sfOnEntry) } : null
const bn10IncomeOf = (sfPairs) => {
  const m = bn10ModelIncomeOf(sfPairs)
  if (BN10_ANCHOR) return BN10_ANCHOR.measured * (m ?? BN10_ANCHOR.model) / BN10_ANCHOR.model
  // NOT CALIBRATED: the model alone; --rates const has no fitted window, so BN10.1's measured late lives (sleeves.mjs COVENANT5)
  return m ?? COVENANT5.income
}
const covLegMemo = new Map()
const covLegOf = (lv) => {
  const sfp = hackSfOf(lv)
  const k = JSON.stringify(sfp)
  if (!covLegMemo.has(k)) covLegMemo.set(k, covenantLegHours(bn10IncomeOf(sfp)))
  return covLegMemo.get(k)
}
const COV5 = arg('--covenant5', 'auto')
if (!['auto', '10.2', '10.3', 'none'].includes(COV5)) throw new Error(`--covenant5 ${COV5}: expected auto, 10.2, 10.3 or none`)
// BITNODE 8's OWN MODEL (bn8.mjs, routes 'stocks'): deterministic per state, memoised; --bn8-hack prices BN8 on the
// hacking/stanek routes instead (the placeholder pricing before 2026-10-23)
const BN8M = has('--bn8-hack') || has('--phase1') ? null : await import('./bn8.mjs')
// the gift both ways unless the world turns it off (--no-stanek, SF13's own value: stanekOff / stanekBn13Only)
const bn8GiftWays = (w) => (w?.stanekOff || w?.stanekBn13Only ? [false] : null)
const bn8World = BN8M ? { int: entry.int ?? 0, hoursOf: (lv, w) => BN8M.bn8RouteHours(lv, { int: entry.int ?? 0, giftWays: bn8GiftWays(w) }).hours, detailOf: (lv, w) => BN8M.bn8RouteHours(lv, { int: entry.int ?? 0, giftWays: bn8GiftWays(w) }) } : null
const wOptsBase = { sigmaPlayed: SIGMA_P, phase1: has('--phase1'), stanekOff: NO_STANEK, bladeStanekOff: has('--no-blade-stanek'), w0Window: W0_WINDOW, w0Live: has('--w0-live'), lab15: LAB15_H, lab15Ready: has('--lab15-ready'), covLegOf, ...(has('--gift-uncal') ? { giftCal: null } : {}), bn8: bn8World }
const L0 = lattice(entry)
const L1 = lattice(start)
const COV_FLEETS = { none: 'live', '10.2': 'cov2', '10.3': 'cov3' }
const covVariants = {} // variant -> { fleet, world, T, V, total, path } on the mid world
let FLEET = has('--five-sleeves') ? 'five' : 'live'
if (FLEET !== 'five' && !has('--phase1')) {
  // a level already cleared cannot buy: BN10.2 is gone once SF10 >= 2 (the start state counts the node in progress)
  const l10s = lvl(start, 10)
  for (const [v, fleet] of Object.entries(COV_FLEETS)) {
    if (v !== 'none' && Number(v.split('.')[1]) <= l10s) continue
    const world = worldOf(econ, {}, { ...wOptsBase, fleet })
    const T = tableFor(L1, world)
    const V = solveDP(L1, T)
    covVariants[v] = { fleet, world, T, V, total: V[0], path: bestPath(L1, T, V) }
  }
  // E[T] over the plan's own draws (the same seed and streams as section 4: common random numbers,
  // so the variants are compared draw for draw) — the criterion the recommendation itself uses
  {
    const r = rng(SEED)
    const rDisc = rng(SEED + 13)
    const rStanek = rng(SEED + 29)
    const ns = [...new Set(owed(start))]
    for (const x of Object.values(covVariants)) x.Ts = []
    for (let i = 0; i < DRAWS; i++) {
      const z = drawZ(r, ns, econ, { rho: RHO_DRAW, rDisc, rStanek })
      for (const x of Object.values(covVariants)) x.Ts.push(solveDP(L1, tableFor(L1, worldOf(econ, z, { ...wOptsBase, fleet: x.fleet })))[0])
    }
    for (const x of Object.values(covVariants)) x.ET = mean(x.Ts)
  }
  const buys = Object.keys(covVariants).filter((v) => v !== 'none')
  const pick = COV5 === 'auto' ? (buys.length ? buys.sort((a, b) => covVariants[a].ET - covVariants[b].ET)[0] : 'none') : COV5
  if (!covVariants[pick]) throw new Error(`--covenant5 ${COV5}: BN10.${pick.split('.')[1]} is already cleared at ${sig(start)}`)
  FLEET = covVariants[pick].fleet
}
const wOpts = { ...wOptsBase, fleet: FLEET }
const mid = worldOf(econ, {}, wOpts)
t0 = performance.now()
const T1 = tableFor(L1, mid)
const tTable = (performance.now() - t0) / 1000
t0 = performance.now()
const V1 = solveDP(L1, T1)
const tDP = (performance.now() - t0) / 1000
phase['mid world (table + DP)'] = tTable + tDP
const path1 = bestPath(L1, T1, V1)

console.log('='.repeat(118))
console.log('THE WHOLE-GAME PLAN — every remaining clear, ordered to minimise the total hours (exact DP over the Source-File lattice)')
console.log('='.repeat(118))
console.log(`state on entry: ${sig(entry)}   intelligence ${entry.int ?? '?'}   ${inProg ? `IN PROGRESS: ${clearLabel(inProg, entry)} (${live.hours.toFixed(1)}h in, since ${live.startedAt}) — planning from the state after it` : 'nothing in progress'}`)
const ow = owed(start)
console.log(`owed from the plan's start (${sig(start)}): ${ow.length} clears  ${[...new Set(ow)].map((n) => `BN${n}x${ow.filter((x) => x === n).length}`).join(' ')}   lattice ${L1.size.toLocaleString()} states`)
console.log(`profile: life ${econ.profile.cycleHours.toFixed(2)}h | ${econ.profile.rates ? `exp/s and $/s FITTED (rates.mjs ${econ.profile.rates.version}: slope in ln progress level exp ${econ.profile.rates.b.toFixed(2)}, income ${econ.profile.rates.bI.toFixed(2)}; --rates const for the old constants)` : `exp rich ${econ.profile.expRich.toExponential(2)}/s poor ${econ.profile.expPoor.toExponential(2)}/s, income $${econ.profile.incomeL1.toExponential(1)}/s at level 1 (CONSTANTS, --rates const)`} | gamma ${econ.gamma.toFixed(3)} | latent g lo ${econ.gScen.lo.toFixed(3)} mid ${econ.gScen.mid.toFixed(3)} hi ${econ.gScen.hi.toFixed(3)}`)
if (econ.rates) printRates(econ, entry)

if (CAL) {
  console.log('\nCHECK — each finished hacking-route clear\'s ROUTE-LEVEL g reproduces its measured hours through the route it played, at its own entry state (calib.mjs, direct sims; the g IS this calibration):')
  for (const it of CAL.items) {
    const h = routeHours({ node: it.bn, lv: it.lv, route: it.route, g: it.gRoute, world: CAL.world, S: CAL.Sd })
    console.log(`  CHECK ${String(it.clear).padEnd(10)} ${it.route.padEnd(6)} measured ${f1(it.T)}h  model ${f1(h)}h  error ${(h - it.T).toFixed(2)}h   g ${it.gRoute.toFixed(4)} (bare-simulation g ${it.gSim.toFixed(4)}: the route at it ${f1(it.hSim)}h)${it.gift ? '  [accepted Stanek\'s Gift]' : ''}`)
  }
} else {
  console.log('\nCHECK — each played node\'s g reproduces its measured hours (the sim re-run at the backed-out g; the g IS this calibration):')
  for (const r of econ.runs) {
    const h = hackExitHours({ node: r.bn, sf: r.sfOnEntry, profile: econ.profile, g: r.g }).hours
    console.log(`  CHECK ${r.name.padEnd(10)} measured ${f1(r.T)}h  model ${f1(h)}h  error ${(h - r.T).toFixed(2)}h   g ${r.g.toFixed(4)}`)
  }
}
console.log(`  CHECK Bladeburner k ${BB_PARAMS.k.mid}: the live BN6 leg / bbsim median on the same fleet timing (nodechoice/bbcal6.mjs, 2026-10-02) — one node; the grid runs at intelligence ${BB_INT} (live ${entry.int ?? '?'})`)

console.log('\nSOURCE-FILE EFFECTS (effects.mjs) — status of every SF\'s effect on a clear:')
for (const n of Object.keys(EFFECTS).map(Number)) {
  const e = EFFECTS[n]
  console.log(`  SF${String(n).padEnd(3)} ${e.status.padEnd(14).slice(0, 52)} ${e.source.slice(0, 92)}`)
}
console.log('  ASSUMED parameters (lo / mid / hi = 10th / 50th / 90th percentile):')
for (const [k, p] of Object.entries(SF_PARAMS)) console.log(`    ${k.padEnd(6)} ${p.lo} / ${p.mid} / ${p.hi}   ${p.what}`)
for (const [k, p] of Object.entries(BB_PARAMS)) console.log(`    ${k.padEnd(6)} ${p.lo} / ${p.mid} / ${p.hi}   ${p.what}`)
console.log(`    g(node) unplayed: ${econ.gJoint ? `the ${gChosen} covariate model's joint posterior (gmodel.mjs, below)` : `ln g split-normal through the latent lo/mid/hi x AMC^-gamma, common-factor share ${RHO_}`}; played: measured x exp(${SIGMA_P} z)`)
{
  const src = has('--prior') ? 'IGNORED (--prior): every draw is the hand prior' : `${path.relative(path.resolve(HERE, '../../..'), POST_FILE)}, ${store.observations.length} logged readings, ${post.nObs} applied (the rest are inside the hand prior), updated ${store.updatedAt ?? 'never'}`
  console.log(`POSTERIOR (posterior.mjs) — the draws below use it: ${src}`)
  const moved = Object.entries(postSum).filter(([, v]) => JSON.stringify(v.prior) !== JSON.stringify(v.post) || v.n)
  if (!moved.length) console.log('  no parameter has moved off its hand prior')
  else {
    const fmt = (x) => (Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(3))
    console.log('  param        hand p10 / p50 / p90            posterior p10 / p50 / p90        readings')
    for (const [id, v] of moved) console.log(`  ${id.padEnd(12)} ${(v.prior ? v.prior.map(fmt).join(' / ') : '-').padEnd(31)} ${v.post.map(fmt).join(' / ').padEnd(32)} ${v.n ?? ''}${v.rho ? `  common share ${v.rho[0]} -> ${v.rho[1]}` : ''}`)
    for (const o of appliedObs(store.observations)) console.log(`    applied: ${o.key}  ${o.param} = ${+o.value.toPrecision(4)} (sd ${o.sd} ${o.space})  ${o.note ?? o.source}`)
  }
}
{
  // THE g MODEL (gmodel.mjs): leave-one-out over the played runs, the model kept, the unplayed nodes' new posterior
  const names = Object.keys(loo.models)
  console.log(`\nTHE g MODEL (gmodel.mjs) — leave-one-out over the ${looData.length} finished hacking-route clears (${CAL ? 'route-level g' : 'bare-simulation g'}; log predictive density of each held-out clear's ln g, reading sd ${OBS_SD_G}); --g-model ${G_MODEL} -> ${gChosen.toUpperCase()}`)
  console.log('  model   elpd     vs best (+- s.e.)   rmse ln g   standardised LOO residual per run (' + looData.map((r) => 'BN' + r.bn).join(' ') + ')')
  const bestPer = loo.models[loo.best].per
  for (const k of names.sort((a, b) => loo.models[b].elpd - loo.models[a].elpd)) {
    const m = loo.models[k]
    const d = m.per.map((p, i) => p.lp - bestPer[i].lp)
    console.log(`  ${k.padEnd(6)} ${m.elpd.toFixed(2).padStart(6)}   ${k === loo.best ? '   best        ' : `${d.reduce((a, x) => a + x, 0).toFixed(2).padStart(6)} +- ${(seMean(d) * d.length).toFixed(2)}`}     ${m.rmse.toFixed(3)}      ${m.z.map((z) => z.toFixed(2).padStart(5)).join(' ')}   ${MODEL_WHAT[k]}`)
  }
  const J = econ.gJoint
  if (J) {
    const fn = ['b0', ...J.feats]
    console.log(`  ${gChosen}: ${fn.map((f, i) => `${f} ${J.beta.mean[i].toFixed(3)} +- ${J.beta.sd[i].toFixed(3)}`).join(', ')} (standardised features; slope prior N(0, 0.3^2)); tau ${J.beta.tauMean.toFixed(3)} +- ${J.beta.tauSd.toFixed(3)} (half-normal 0.5)`)
    console.log('  unplayed node   hand latent p10 / p50 / p90      ' + gChosen.padEnd(5) + ' model p10 / p50 / p90     corr with the others (mean)')
    const lg = ['lo', 'mid', 'hi'].map((k) => Math.log(econ.gScen[k]))
    J.nodes.forEach((n, i) => {
      const hand = [-1.2816, 0, 1.2816].map((z) => Math.exp(lg[1] + (((z < 0 ? lg[1] - lg[0] : lg[2] - lg[1]) * z) / 1.2816)) * Math.pow(econ.amc[n], -econ.gamma))
      const mo = [-1.2816, 0, 1.2816].map((z) => Math.exp(J.mean.get(n) + z * J.sd.get(n)))
      const cs = J.nodes.map((_, j) => (j === i ? null : J.cov[i][j] / Math.sqrt(J.cov[i][i] * J.cov[j][j]))).filter((x) => x !== null)
      console.log(`  BN${String(n).padEnd(13)} ${hand.map((x) => x.toFixed(4)).join(' / ')}         ${mo.map((x) => x.toFixed(4)).join(' / ')}       ${(cs.reduce((a, b) => a + b, 0) / cs.length).toFixed(2)}`)
    })
  } else console.log(`  kept: ${gChosen} — the draws use economy.mjs's hand latent (common share ${RHO_DRAW})`)
  console.log(`\nCALIBRATION — every finished hacking-route clear: measured hours vs the ${CAL ? 'route it played (route-level g, its own entry state)' : 'bare simulation'} under the ${gChosen} model's leave-one-out g (fitted without that clear); residual r in ln hours, v = the predictive's own variance${CAL ? '. "old" = the route at the logged bare-simulation g: what the plan priced a replay of that clear at before 2026-10-14' : ''}:`)
  for (const d of discRes) console.log(`  CHECK ${d.name.padEnd(9)} ${d.route.padEnd(6)} measured ${d.T.toFixed(1).padStart(6)}h  predicted (LOO median) ${d.predH.toFixed(1).padStart(6)}h [p10-p90 ${d.p10.toFixed(1)}-${d.p90.toFixed(1)}]  error ${(100 * (d.predH / d.T - 1)).toFixed(0).padStart(4)}%  r/sqrt v ${(d.r / Math.sqrt(d.v)).toFixed(2).padStart(5)}${Math.abs(d.r / Math.sqrt(d.v)) > 2 ? ' OUTSIDE 2 sd' : ''}  | g own ${d.g.toFixed(4)} LOO ${d.gLoo.toFixed(4)}${CAL ? `  | old: g ${d.gSim.toFixed(4)} -> route ${d.hSim.toFixed(1)}h (${(100 * (d.hSim / d.T - 1)).toFixed(0)}%)` : ''}`)
  console.log(`  discrepancy sd (ln hours, prior half-normal ${PRIOR_SD}): posterior mean ${discFit.mean.toFixed(3)}, p10 ${discFit.p10.toFixed(3)} p90 ${discFit.p90.toFixed(3)}; the draws use sqrt E[sd^2] = ${discFit.sd.toFixed(3)} on every unplayed node's hacking-route hours${has('--no-disc') ? ' — DISABLED (--no-disc)' : ''}`)
}
console.log('ROUTES (routes.mjs):')
for (const r of ROUTES) console.log(`  ${r.id.padEnd(7)}${r.node ? `BN${r.node} `.padEnd(6) : 'all   '}${r.status}`)

console.log(`\nTHE NEXT CLEAR, every candidate from ${sig(start)} (mid world): own hours by route, and T = own + the best continuation`)
console.log('  clear     hack   blade  special   via     own     T total   dT')
const fm1 = firstMoves(L1, T1, V1).sort((a, b) => a.T - b.T)
for (const x of fm1) {
  const c = clearTime(x.n, lvOf(start), mid, S)
  const sp = ROUTES.filter((r) => r.node === x.n || ((r.id === 'stanek' || r.id === 'bladeStanek') && c.by[r.id] !== undefined)).map((r) => `${r.id}:${c.by[r.id] === undefined || c.by[r.id] === null ? '-' : c.by[r.id].toFixed(1)}`).join(' ')
  console.log(`  ${clearLabel(x.n, start).padEnd(7)} ${f1(c.by.hack)} ${f1(c.by.blade)}  ${sp.padEnd(9)} ${String(c.via).padEnd(6)} ${f1(x.own)}  ${f1(x.T)}  +${(x.T - fm1[0].T).toFixed(1)}`)
}

// ---------------------------------------------------------------------------
// The IPvGO model (go.mjs): BN14 term by term, and SF14's effect on every node
// ---------------------------------------------------------------------------
const lvWith = (s, n, l) => (m) => (m === n ? l : lvl(s, m))
{
  const w = mid
  console.log(`\nTHE IPvGO MODEL (go.mjs), mid world — MEASURED (release 3c): Daedalus ${GO_MEASURED.powerPerH}/h x goP ${w.sf.goP}, win ${GO_MEASURED.pWin}, ${GO_MEASURED.gamesPerH} games/h, rep ${w.sf.rep14}/h per level at level ${w.sf.lvl14}; abar (the farm now, mean Daedalus bonus over a ${econ.profile.cycleHours.toFixed(2)}h window, wiped at each install) ${w.go.abar.toFixed(3)} vs aref ${w.go.aref.toFixed(3)} (the measured runs' farm, ${GO_REF.powerPerH}/h); ASSUMED eps14 ${w.sf.eps14}; DERIVED w0 ${w.sf.w0.toFixed(0)}/h; cheats 0 on 5x5 (MEASURED, release 3), NOT PRICED on 19x19`)
  {
    const bg = bladeGoOf(1, lvl(start, 14))
    console.log(`  the Bladeburner leg's farm (bbsim o.go): Tetrads ${bg.perHour}/h from the node's start, combat level multipliers x effect at GoPower x ${bg.sf14 ? 2 : 1} (BN14 x${4 * (bg.sf14 ? 2 : 1)}), no install so no wipe; after 10/20/30h: ${[10, 20, 30].map((h) => `x${(1 + Math.log(bg.perHour * h + 1) * Math.pow(bg.perHour * h + 1, 0.3) * 0.002 * bg.power * (bg.sf14 ? 2 : 1)).toFixed(2)}`).join(' / ')} (BN14 ${[10, 20, 30].map((h) => `x${(1 + Math.log(bg.perHour * h + 1) * Math.pow(bg.perHour * h + 1, 0.3) * 0.002 * bg.power * 4 * (bg.sf14 ? 2 : 1)).toFixed(2)}`).join(' / ')})`)
  }
  console.log('  BN14 from the plan start, by the SF14 level it is entered with (the go route = the hacking route at GoPower 4):')
  console.log('  entry   scale  Hsim     g      x goG   W(exit)  favor life (ref)   early   go route   blade   [hack w/o Go: phase-1 pricing]')
  const p1 = worldOf(econ, {}, { ...wOpts, phase1: true })
  for (let l = lvl(start, 14); l < 3; l++) {
    const lv = lvWith(start, 14, l)
    const hp = hackParts({ node: 14, lv, world: w, S })
    const c = clearTime(14, lv, w, S)
    const c1 = clearTime(14, lv, p1, S)
    console.log(`  BN14.${l + 1}  x${goScale(S.mults(14).GoPower, l)}    ${f1(hp?.hsim)}  ${hp ? hp.g.toFixed(4) : '-'}  ${hp ? hp.goG.toFixed(3) : '-'}   ${hp ? hp.W.toFixed(2) : '-'}     ${f1(hp?.favor)}h (${f1(hp?.favorRef)}h)   ${f1(hp?.early)}  ${f1(c.by.go)}    ${f1(c.by.blade)}   [${f1(c1.by.hack)}]`)
  }
  console.log('  SF14 on every node (mid world, from the plan start): own hours of the hacking route at SF14 0/1/2/3, and the node\'s favor life at FWRG/FavorToDonate (cap 100/200/300/400k Go rep):')
  console.log('  node   FWRG  ftd  route SF14=0    =1     =2     =3   | favor life 0     1     2     3   (ref)')
  for (const n of [...new Set(owed(start))]) {
    const m = S.mults(n)
    const hs = [0, 1, 2, 3].map((l) => clearTime(n, lvWith(start, 14, l), w, S).h)
    const fs = [0, 1, 2, 3].map((l) => (n === 2 ? 0 : favorHours(n, l, w, S)))
    console.log(`  BN${String(n).padEnd(3)} ${(+m.FactionWorkRepGain.toFixed(2)).toString().padStart(5)} ${(+m.FavorToDonateToFaction.toFixed(2)).toString().padStart(4)}  ${hs.map(f1).join(' ')} | ${fs.map(f1).join(' ')}  (${f1(n === 2 ? 0 : favorRef(n, w, S))})`)
  }
  {
    // THE w0r1d_d43m0n WINDOW per node (go.mjs goWindow): the post-TRP climb L0 (phase-averaged), the
    // fixed point L* with the bonus banking, W at the exit, and what it is worth two ways — the plan's
    // exitShift (the exit level divided by W, installs re-planned: ln W / g) and the climb alone (L0 - L*,
    // what a final life that does not anticipate the bonus — today's exitplan — realises)
    const mc = w0PriorMC()
    const I = mc.inputs
    const f3 = (a) => a.map((x) => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(2))).join('/')
    console.log(`  w0 (DERIVED, go.mjs w0PriorMC, ${mc.n} draws): p10/p50/p90 ${f3([mc.q10, mc.q50, mc.q90])}/h (was 0/200/1000 ASSUMED) — win rate ${f3(I.p)}, score on a win ${f3(I.fWin.map((x) => x * 267))}, on a loss ${f3(I.fLoss.map((x) => x * 267))}, games/h ${f3(I.gamesPerH)}, power/game ${f3(I.perGame)}; rank corr with w0: ${Object.entries(mc.rank).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`)
    console.log(`  the window at this world's w0 ${w.sf.w0.toFixed(0)}/h${W0_WINDOW !== null ? ` — FIXED at ${W0_WINDOW}h (--w0-window)` : ''} (node: post-TRP climb L0 -> L* with the bonus banked per game (games), W at the exit, worth ln W/g [exit shift] / L0-L* [climb only]; priced: ${w.go.w0Live ? 'CLIMB ONLY (--w0-live)' : 'the exit shift'}):`)
    const rows = []
    for (const n of [...new Set(owed(start))]) {
      const hp = hackParts({ node: n, lv: lvOf(start), world: w, S })
      if (!hp?.win) continue
      rows.push(`BN${n} ${hp.win.L0.toFixed(2)}->${hp.win.hours.toFixed(2)}h${hp.win.games !== null && hp.win.games !== undefined ? ` (${hp.win.games}g)` : ''} W x${hp.W.toFixed(3)} ${(Math.log(hp.W) / hp.g).toFixed(1)}h/${(hp.win.L0 - hp.win.hours).toFixed(2)}h`)
    }
    for (let i = 0; i < rows.length; i += 4) console.log('    ' + rows.slice(i, i + 4).map((r) => r.padEnd(40)).join(''))
  }
}

/**
 * THE RATES MODEL (rates.mjs): the fit, every node's final-window exp/s and $/s at the SFs held on
 * entry, the node in progress's own reading, and the leave-one-out check of the transfer.
 */
function printRates(econ, st) {
  const R = econ.rates
  const sf = pairsOf(st)
  const sfm = sfMultsOf(sf)
  console.log(`\nTHE RATES (rates.mjs ${R.version}) — exp/s and $/s of the hacking route's final window, fitted to ${R.channels.exp.runs} / ${R.channels.income.runs} measured runs (history.jsonl, 10-min windows inside a life):`)
  for (const [ch, c] of Object.entries(R.channels)) {
    const fe = ch === 'exp' ? ['alpha', 'gamma ln money'] : ['alpha']
    console.log(`  ${ch.padEnd(6)} ln rate = offset + a_n + b ln(Lpk/${R.LREF}): b ${c.b.toFixed(3)} +- ${c.sdB.toFixed(3)} (pooled within-node), window scatter ${c.sdWin.toFixed(2)}; a_n = ${fe.map((f, i) => `${f} ${c.beta.mean[i].toFixed(2)} +- ${c.beta.sd[i].toFixed(2)}`).join(', ')}, node spread tau ${c.beta.tauMean.toFixed(2)} +- ${c.beta.tauSd.toFixed(2)}`)
  }
  console.log('  node  exit lvl   exp/s (final window)      a_n +- sd    readings          $/s (final window)       a_n +- sd    readings')
  for (const n of NODES) {
    const m = S.mults(n)
    const fr = finalRatesOf({ m, s: sfm, rates: econ.profile.rates, node: n })
    const cell = (ch) => {
      const v = R.channels[ch].nodes[n]
      const rd = v.readings.map((r) => (r.inRun ? 'IN RUN' : 'run')).join(',') || 'predicted'
      return `${v.mean.toFixed(2).padStart(6)} +- ${v.sd.toFixed(2)}   ${rd.padEnd(16)}`
    }
    console.log(`  BN${String(n).padEnd(3)} ${String(fr.Lx).padStart(6)}   ${fr.expPerSec.toExponential(2).padStart(10)}            ${cell('exp')}  ${fr.incomePerSec.toExponential(2).padStart(10)}            ${cell('income')}`)
  }
  if (R.liveRun) console.log(`  the node in progress BN${R.liveRun.bn} (${R.liveRun.hours.toFixed(1)}h, ${R.liveRun.windows.length} windows to level ${R.liveRun.windows.at(-1)?.lpk ?? '?'}): its own exp/income readings enter through posterior.json (xr${R.liveRun.bn}/ir${R.liveRun.bn}, observe.mjs) — ${['exp', 'income'].map((ch) => `${ch} ${R.channels[ch].nodes[R.liveRun.bn].readings.some((r) => r.inRun) ? 'APPLIED' : 'none yet'}`).join(', ')}`)
  console.log('  CHECK (leave-one-out): each measured run\'s final-window rate (median window of its last 3h, at its own progress level) vs the model fitted without its node; z = ln error / predictive sd')
  for (const [ch, c] of Object.entries(R.channels)) for (const l of c.loo) console.log(`  CHECK ${ch.padEnd(6)} BN${String(l.bn).padEnd(3)} ${l.key.slice(0, 10)} level ${String(l.lpk).padStart(6)}  measured ${l.measured.toExponential(2)}  predicted ${l.predicted.toExponential(2)}  ln error ${l.err.toFixed(2).padStart(6)}  sd ${l.sd.toFixed(2)}  z ${l.z.toFixed(2).padStart(5)}${Math.abs(l.z) > 2 ? '  OUTSIDE 2 sd' : ''}`)
}

function printPath(steps, from, world, title) {
  console.log(`\n${title}`)
  let s = from
  let cum = 0
  const cells = []
  for (const st of steps) {
    const c = clearTime(st.n, lvOf(s), world, S)
    cum += st.h
    cells.push(`${clearLabel(st.n, s)}${c.via === 'blade' ? '*' : c.via === 'hack' ? '' : `[${c.via}]`} ${st.h.toFixed(1)}h`)
    s = plus(s, st.n)
  }
  for (let i = 0; i < cells.length; i += 6) console.log('  ' + cells.slice(i, i + 6).map((x, j) => `${String(i + j + 1).padStart(2)}. ${x}`.padEnd(19)).join(''))
  console.log(`  total ${cum.toFixed(1)}h   (* = Bladeburner exit; unmarked = hacking exit)`)
  return cum
}
// ---------------------------------------------------------------------------
// Stanek's Gift (stanek.mjs): accept or never, per node and SF13 level, and SF13's value
// ---------------------------------------------------------------------------
if (!NO_STANEK && !has('--phase1')) {
  t0 = performance.now()
  const w = mid
  const sp = (k) => `${k} ${+w.sf[k].toFixed(3)}`
  console.log(`\nSTANEK'S GIFT (stanekplan.js, stanek.mjs), mid world — MEASURED ${sp('stRam')} (log2 home GB at a no-gift exit); ASSUMED ${sp('stEpsM')}, ${sp('stEpsR')}, ${sp('stFr')}, ${sp('stDuty')}; layout chosen at Hg 2.5, f 0.2`)
  console.log('  the gift accepted at the node\'s start vs never: own hours from the plan start with SF13 held at each level (BN13.k: the level on entry); f = home RAM charging, W = exit divisor, gMul = g factor, favor = favor-life factor, Aw/Se = the life Awakening / Serenity install after')
  console.log('  clear     SF13 grid  power  layout                                     f      W    gMul  favor  Aw/Se   never   accept  saved  verdict')
  for (const n of [...new Set(owed(start))]) {
    const m = S.mults(n)
    const from = lvl(start, 13)
    const levels = n === 13 ? [0, 1, 2].filter((l) => l >= from) : [1, 2, 3].filter((l) => l >= from)
    for (const l13 of levels) {
      const lv = lvWith(start, 13, l13)
      const c = clearTime(n, lv, w, S)
      let never = Math.min(...Object.entries(c.by).filter(([k, v]) => k !== 'stanek' && k !== 'bladeStanek' && v !== null && isFinite(v)).map(([, v]) => v))
      const p = stanekParts({ node: n, lv, world: w, S })
      const g = gridOf(m, l13)
      const lay = layoutFor(m, l13)
      let acc = p ? p.h : null
      // BN8: the gift is priced INSIDE the stock-only model (bn8.mjs, both ways); the f/W/gMul columns stay the hacking model's
      if (n === 8 && bn8World) {
        const d = bn8World.detailOf(lv, w).byGift
        never = d.never?.hours ?? null
        acc = d.accept?.hours ?? null
      }
      const label = n === 13 ? `BN13.${l13 + 1}` : `BN${n}`
      console.log(`  ${label.padEnd(8)}  ${l13}  ${`${g.width}x${g.height}`.padEnd(5)} ${m.StaneksGiftPowerMultiplier.toFixed(2).padStart(5)}  ${(layoutText(lay.placed) + (lay.exact ? '' : ' ~')).padEnd(42)} ${p ? p.st.f.toFixed(3).padStart(5) : '    -'} ${p ? p.st.W.toFixed(2).padStart(5) : '    -'} ${p ? p.st.gMul.toFixed(3) : '    -'} ${p ? p.st.favorMul.toFixed(2).padStart(5) : '    -'}  ${p ? `${p.st.giftAt[2] ?? '-'}/${p.st.giftAt[3] ?? '-'}`.padEnd(6) : '-     '} ${f1(never)}  ${f1(acc)} ${f1(acc === null ? null : never - acc)}  ${acc !== null && acc < never ? 'ACCEPT' : 'never'}`)
    }
  }
  console.log('  (~ = the layout search hit its node budget: the best layout found, not proven optimal)')
  // SF13's value: the mid-world optimum with the gift everywhere, in BN13 only, and never
  const totalOf = (opts) => {
    const ww = worldOf(econ, {}, { ...wOpts, ...opts })
    const TT = tableFor(L1, ww)
    return solveDP(L1, TT)[0]
  }
  const tOnly = totalOf({ stanekBn13Only: true })
  const tOff = totalOf({ stanekOff: true })
  const tAll = V1[0]
  console.log(`  SF13's VALUE (mid world, optimal order from ${sig(start)}): the gift everywhere ${tAll.toFixed(1)}h; in BN13 only (SF13 grants nothing elsewhere) ${tOnly.toFixed(1)}h; never ${tOff.toFixed(1)}h`)
  console.log(`    -> SF13's own value ${(tOnly - tAll).toFixed(1)}h; BN13's gift (inside BN13) ${(tOff - tOnly).toFixed(1)}h; the gift in total ${(tOff - tAll).toFixed(1)}h`)
  // THE GIFT ON THE BLADEBURNER ROUTE (routes.mjs 'bladeStanek', bladestanek.mjs): per node, blade vs blade + gift
  // on the same world and state, and the plan's total without that route (draw for draw at the mid world)
  {
    const { MISSING_BLADE_GIFT } = await import('./routes.mjs')
    const { giftLegOf } = await import('./bladestanek.mjs')
    console.log("  ON THE BLADEBURNER ROUTE ('bladeStanek', NOT CALIBRATED: bbsim both arms on shared seeds, combat layout stanekplan.BLADE_LAYOUTS, charger BLADE_HOST mid): own hours at the start's state with SF13 at each level")
    console.log('  clear     SF13  layout     blade   +gift   d(h)    leg ratio  join d   verdict')
    for (const n of [...new Set(owed(start))]) {
      const from = lvl(start, 13)
      const levels = n === 13 ? [0, 1, 2].filter((l) => l >= from) : [1, 2, 3].filter((l) => l >= from)
      for (const l13 of levels) {
        const lv = lvWith(start, 13, l13)
        const c = clearTime(n, lv, w, S)
        if (c.by.blade === undefined) continue
        const gl = giftLegOf(n, l13, lv(6), lv(7))
        const bs = c.by.bladeStanek
        const label = n === 13 ? `BN13.${l13 + 1}` : `BN${n}`
        console.log(`  ${label.padEnd(8)}  ${String(l13).padEnd(4)}  ${(gl?.layout ?? '-').padEnd(9)}  ${f1(c.by.blade)}  ${f1(bs)}  ${bs == null || c.by.blade == null ? '    -' : (bs - c.by.blade).toFixed(2).padStart(6)}  ${gl ? gl.ratio.toFixed(4).padStart(9) : '        -'}  ${gl ? gl.joinD.toFixed(2).padStart(6) : '     -'}   ${bs == null ? 'NOT PRICED (no table entry)' : bs < c.by.blade ? 'ACCEPT' : 'never'}`)
      }
    }
    const tNoBlade = totalOf({ bladeStanekOff: true })
    console.log(`  -> the plan with the gift on the Bladeburner route ${tAll.toFixed(1)}h, without it ${tNoBlade.toFixed(1)}h: its value ${(tNoBlade - tAll).toFixed(1)}h`)
    if (MISSING_BLADE_GIFT.size) console.log(`  !! bladeStanek NOT PRICED (no table entry; build: node tools/sim/bbstanek.mjs --table): ${[...MISSING_BLADE_GIFT].slice(0, 12).join(', ')}${MISSING_BLADE_GIFT.size > 12 ? ` (+${MISSING_BLADE_GIFT.size - 12})` : ''}`)
  }
  tick("Stanek's Gift (section)", t0)
}

// ---------------------------------------------------------------------------
// The sleeve fleet (sleeves.mjs): SF10.2/10.3's extra sleeves and BN10's own, on both routes
// ---------------------------------------------------------------------------
if (!has('--phase1') && FLEET !== 'five') {
  t0 = performance.now()
  const { sleeveCount, D10, COVENANT5 } = await import('./sleeves.mjs')
  const { BB_FLEET_N } = await import('./surrogate.mjs')
  const w = mid
  const l10 = lvl(start, 10)
  console.log(`\nTHE SLEEVE FLEET (sleeves.mjs) — sleeves = min(3, SF10 + (BN10 ? 1 : 0)) + 4 Covenant: SF10.1 ${sleeveCount(1, 1)} (BN10 ${sleeveCount(1, 10)}), SF10.2 ${sleeveCount(2, 1)} (BN10 ${sleeveCount(2, 10)}), SF10.3 ${sleeveCount(3, 1)}`)
  console.log(`  hacking route: g x (1 + d10 x CrimeMoney) per sleeve past 5, d10 DERIVED ${D10.lo.toExponential(1)} / ${D10.mid.toExponential(1)} / ${D10.hi.toExponential(1)} (mid world ${w.sf.d10.toExponential(2)}): the extra sleeve's money crime x the measured lives (one sleeve per faction: the rep slot is taken)`)
  console.log('  Bladeburner route: the leg x leg(live pick, n) / leg(live pick, 5) — the pick = the fastest of sleeveConfigs(n) on the game\'s classes (selection seeds 101-105, SF6.1/SF7.0)')
  console.log(`  own hours from the plan start at SF10 = 1 / 2 / 3 (other SFs as at the start), each route; the Bladeburner pick per fleet size (i/s/f = infiltrate/support/field analysis), the leg ratio at the start's SF6/SF7`)
  console.log('  clear     CM    hack  @10.1   10.2   10.3 | blade @10.1  10.2   10.3 | pick 5        6         7          ratio 6   7')
  const l6 = Math.max(1, Math.min(3, lvl(start, 6)))
  const l7 = Math.min(3, lvl(start, 7))
  const ck = (c) => (c ? `i${c.infiltrate}s${c.support}f${c.fa}${c.gym > 0 ? `g${c.gym}` : ''}` : '-')
  for (const n of [...new Set(owed(start))].sort((a, b) => a - b)) {
    const row = [1, 2, 3].map((l) => clearTime(n, lvWith(start, 10, l), w, S).by)
    const hk = row.map((b) => f1(b.hack ?? b.go ?? null))
    const bl = row.map((b) => f1(b.blade ?? null))
    const bb = S.bbRank(n) > 0
    const picks = bb ? BB_FLEET_N.map((k) => ck(S.bbFleet(n, k)?.config).padEnd(9)).join(' ') : '-'.padEnd(29)
    const rt = bb ? BB_FLEET_N.slice(1).map((k) => (S.bbFleetRatio(n, l6, l7, k)?.ratio ?? NaN).toFixed(3)).join(' ') : '  -'
    const label = n === 10 ? `BN10.${l10 + 1}*` : `BN${n}`
    console.log(`  ${label.padEnd(8)} ${S.mults(n).CrimeMoney.toFixed(2).padStart(4)}  ${hk.join(' ')} | ${bl.join(' ')} | ${picks}  ${rt}`)
  }
  console.log(`  (* BN10 runs one sleeve more than the state outside it: its own clear at SF10.${l10} has ${sleeveCount(l10, 10)} sleeves)`)
  // the values: the mid-world optimum with the fleet as it is, without BN10's own sleeve, and with 5 sleeves everywhere
  const totalOf = (opts) => solveDP(L1, tableFor(L1, worldOf(econ, {}, { ...wOpts, ...opts })))[0]
  // the fleet's own value is measured without the Covenant purchase (its cost is the variants' table below)
  const tLive = FLEET === 'live' ? V1[0] : totalOf({ fleet: 'live' })
  const tNoBn10 = totalOf({ fleet: 'noBn10' })
  const tFive = totalOf({ fleet: 'five' })
  console.log(`  SF10's VALUE (mid world, optimal order from ${sig(start)}): the fleet as the game counts it ${tLive.toFixed(1)}h; without BN10's own extra sleeve ${tNoBn10.toFixed(1)}h; 5 sleeves everywhere (the old pricing of the Bladeburner route) ${tFive.toFixed(1)}h`)
  console.log(`    -> SF10.2/10.3's extra sleeves ${(tFive - tNoBn10).toFixed(1)}h; BN10's own temporary sleeve ${(tNoBn10 - tLive).toFixed(1)}h; together ${(tFive - tLive).toFixed(1)}h`)
  {
    // THE 5TH COVENANT SLEEVE AS A COMMITTED MOVE (the user's invariant): each variant solved on the mid world
    console.log(`  THE 5TH COVENANT SLEEVE — BOUGHT (user's invariant, --covenant5 ${COV5}): the buying BN10 clear = its hacking route (or Stanek's) + the purchase leg $1e17 / BN10's final-window income (sleeves.mjs covenantLegHours); 5 Covenant sleeves from that SF10 on (8 at SF10.3; the 8th's Bladeburner leg EXTRAPOLATED at the 7-sleeve ratio)`)
    if (BN10_ANCHOR) {
      const lv0 = lvOf(start)
      const iS = bn10IncomeOf(hackSfOf(lv0))
      console.log(`  CHECK the leg's income (CALIBRATED on one run, BN10.1): the MEASURED final window $${BN10_ANCHOR.measured.toExponential(2)}/s (rates.mjs, ${BN10_ANCHOR.key.slice(0, 10)}, level ${BN10_ANCHOR.level}) vs the rates model's line at BN10.1's entry SFs $${BN10_ANCHOR.model.toExponential(2)}/s: model error ${(100 * (BN10_ANCHOR.model / BN10_ANCHOR.measured - 1)).toFixed(0)}% — the leg is anchored on the measurement (x model SF ratio); cross-check, BN10.1's late lives (peak/length, a lower bound) $${COVENANT5.income.toExponential(2)}/s`)
      console.log(`    the leg from the plan start's SFs: $${iS.toExponential(2)}/s (SF ratio x${(iS / BN10_ANCHOR.measured).toFixed(2)}) -> ${covenantLegHours(iS).toFixed(1)}h; MEASURED in BN10.1: the 850 combat 457 -> 1441 inside one 2.4h life (fits inside the leg)`)
      {
        // THE STOCK TRADER beside the leg: NOT PRICED, bounded (sleeves.mjs COVENANT5_TRADER)
        const { COVENANT5_TRADER: T, covenantTraderBoundH } = await import('./sleeves.mjs')
        console.log(`    the stock trader beside the leg: NOT PRICED (immaterial, bounded): the market's capacity caps any trader at the perfect-foresight long+short $${T.pfCum[24].toExponential(1)} by a 24h-old market (${covenantTraderBoundH(iS, 24).toFixed(2)}h of the leg), $${T.pfCum[61].toExponential(1)} by 61h; the shipped 4S trader x${T.liveFactor} (live calibration) $${(T.shipCum[24] * T.liveFactor).toExponential(1)} by 24h. A trader-funded $1e17 needs >= ~100-200h of one market life (${T.source})`)
      }
    } else console.log(`  the leg's income: NOT CALIBRATED (no measured BN10 final window in the rates fit) — the model's line alone`)
    {
      // the live game carries out ONE committed choice (sleeves.mjs COVENANT5_PLANNED -> sleeveplan.js
      // COVENANT_MANDATE.targetBySf10: BN10.b is played at SF10 b-1, so the target there is 5)
      const { covenantTarget } = await import('sleeveplan.js')
      const { COVENANT5_PLANNED, COVENANT_BUY } = await import('./sleeves.mjs')
      const liveLv = [1, 2].find((l) => covenantTarget(l) >= 5)
      const liveBuy = liveLv ? `10.${liveLv + 1}` : 'none'
      const planned = `10.${COVENANT_BUY[COVENANT5_PLANNED]}`
      const pickV = Object.keys(COV_FLEETS).find((k) => COV_FLEETS[k] === FLEET)
      const ok = liveBuy === planned && (COV5 !== 'auto' || pickV === planned || !covVariants[planned])
      console.log(`  CHECK the live mandate (sleeveplan.js covenantTarget) buys in BN${liveBuy}, the committed choice (sleeves.mjs COVENANT5_PLANNED) BN${planned}, this run plans BN${pickV}: ${ok ? 'PASS' : `FAIL — ${liveBuy !== planned ? 'the live game would buy elsewhere than committed' : 'this run picks another level: re-decide, then move COVENANT5_PLANNED and COVENANT_MANDATE.targetBySf10 together'}`}`)
    }
    {
      // THE 8TH SLEEVE, PRICED IN EVERY NODE (after the purchase in BN10.3 every later clear runs 8 at
      // SF10.3): each owed node's clear at SF10.3 with 7 sleeves (no purchase) vs 8 (cov3), per route
      const { D10_ORDINAL, BASE_SLEEVES } = await import('./sleeves.mjs')
      const { BB_FLEET_N } = await import('./surrogate.mjs')
      const w7 = covVariants.none?.world
      const w8 = covVariants['10.3']?.world ?? covVariants['10.2']?.world
      if (w7 && w8) {
        const lv3 = lvWith(start, 10, 3)
        const l6 = Math.max(1, Math.min(3, lvl(start, 6)))
        const l7 = Math.min(3, lvl(start, 7))
        console.log(`  THE 8TH SLEEVE in every owed node (SF10.3, other SFs as at the start; mid world): hacking-family routes (hack, stanek, go) price it through sleeves.mjs — its own money-crime trajectory with 7 others, the marginal lift on the measured lives: d10 x shape ${D10_ORDINAL[8]} (6th 1, 7th ${D10_ORDINAL[7]}; DERIVED) x CrimeMoney on g; Bladeburner: the fleet axis has 5-7 SIMULATED, the 8th EXTRAPOLATED at the 7-sleeve ratio (priced at zero, labelled)`)
        console.log('    node   CM     7 sleeves  8 sleeves   8th saves   route(8)       hack g x(8th)   blade ratio 7 -> 8')
        for (const n of [...new Set(owed(start))].filter((m) => m !== 10).sort((a, b) => a - b)) {
          const c7 = clearTime(n, lv3, w7, S)
          const c8 = clearTime(n, lv3, w8, S)
          const cm = S.mults(n).CrimeMoney
          const bb = S.bbRank(n) > 0 ? S.bbFleetRatio(n, l6, l7, BB_FLEET_N[BB_FLEET_N.length - 1])?.ratio : null
          console.log(`    BN${String(n).padEnd(4)} ${cm.toFixed(2).padStart(4)}  ${f1(c7.h)}h    ${f1(c8.h)}h    ${(c7.h - c8.h).toFixed(2).padStart(6)}h    ${String(c8.via).padEnd(13)}  x${(1 + w8.sf.d10 * D10_ORDINAL[8] * cm).toFixed(5)}        ${bb ? `${bb.toFixed(3)} -> ${bb.toFixed(3)} EXTRAPOLATED` : '- (no Bladeburner route)'}`)
        }
        console.log(`    NOT PRICED for any sleeve past ${BASE_SLEEVES} (stated, never folded in): the exp transfer (<= 16 exp/s x sync; a new sleeve starts at sync 1), a 2nd faction's rep (the live policy gives one sleeve a faction), karma (no gameplan route has a karma leg: BN2's gang is inside its measured g), the stocks (BN8) and corp (BN3) routes (placeholders that price nothing)`)
      }
    }
    for (const [v, x] of Object.entries(covVariants)) {
      let st = start
      const cells = []
      for (const p of x.path) {
        const c = clearTime(p.n, lvOf(st), x.world, S)
        cells.push(`${clearLabel(p.n, st)}${c.via === 'blade' ? '*' : c.via === 'hack' ? '' : `[${c.via}]`}${c.by.cov5 !== undefined ? `(leg ${c.by.cov5.toFixed(1)}h)` : ''}`)
        st = plus(st, p.n)
      }
      const sg = (d) => `${d >= 0 ? '+' : ''}${d.toFixed(1)}`
      const dE = x.Ts.map((t, i) => t - covVariants.none.Ts[i])
      console.log(`    ${(v === 'none' ? 'no purchase (reference)' : `buy in BN${v}`).padEnd(24)} E[T] ${x.ET.toFixed(1)}h over ${DRAWS} draws (each draw's optimum)${v === 'none' ? '' : ` ${sg(x.ET - covVariants.none.ET)}h vs none, paired s.e. ${seMean(dE).toFixed(2)}`} | mid world ${x.total.toFixed(1)}h${x.fleet === FLEET ? '  <- PLANNED' : ''}`)
      console.log(`      ${cells.join(' ')}`)
    }
  }
  if (FLEET === 'live') console.log(`  THE 5TH COVENANT SLEEVE: $${COVENANT5.cost.toExponential(0)} (10^4 x $10t), BN10 only, Covenant membership (hacking and every combat stat 850, 20 augs) in the same install window: ${COVENANT5.hours.toFixed(1)}h of BN10's measured late-life income ($${COVENANT5.income.toExponential(2)}/s) — NOT a move the plan searches (no Covenant axis); a 6th sleeve is worth ~${((tFive - tNoBn10) / 2).toFixed(1)}h over the rest of the game here (half SF10.2/10.3's), so it does not repay the hold`)
  tick('the sleeve fleet (section)', t0)
}

printPath(path1, start, mid, `OPTIMAL ORDER — mid world (every parameter at its median), from ${sig(start)}:`)

// ---------------------------------------------------------------------------
// THE ROUTE CALIBRATION BAND (routecal.js): the measured errors, the live table's CHECK, and every owed
// clear's routes as distributions — the old rule (min point) against the new (min expected hours)
// ---------------------------------------------------------------------------
{
  const f2 = (x) => (x === null || x === undefined || !isFinite(x) ? '   -' : x.toFixed(2))
  console.log(`\nROUTE CHOICE UNDER MODEL ERROR (routecal.js) — rule ${ROUTE_RULE === 'expected' ? 'EXPECTED' : 'POINT (--route-rule point: the old rule)'}: ${RC.ROUTE_RULE_TEXT}`)
  console.log(`  hacking family (hack, stanek, go): the ${discRes.length} CALIBRATION residuals above (the g model's leave-one-out, ln measured/predicted): pooled RMS ${f2(ROUTE_MEASURED.hacking.pooled)}; own ${Object.entries(ROUTE_MEASURED.hacking.nodes).map(([n, s]) => `BN${n} ${s.toFixed(2)}`).join(', ')}`)
  console.log(`  Bladeburner family (blade, bladeStanek): ${BLADE_RES.length} clears out of sample (k withheld) since the Go farm's combat channel, the plan's route at each clear's entry state vs its hours (k ${BB_PARAMS.k.mid} mid, posterior p10/p90 ${kQ[0]}/${kQ[2]}: ${f2(K_SD)} in ln already drawn): pooled RMS ${f2(ROUTE_MEASURED.blade.pooled)}`)
  console.log("    (blade+gift: accepted Stanek's Gift with no bladeStanek leg tabled at its SF13 — read against 'blade', the route the plan prices that state by)")
  for (const b of BLADE_RES) console.log(`    ${b.clear.padEnd(8)} ${b.route.padEnd(11)} measured ${f1(b.T)}h  route ${f1(b.pred)}h  ln(measured/route) ${b.r >= 0 ? '+' : ''}${b.r.toFixed(2)}`)
  if (BLADE_SKIP.length) console.log(`    not used: ${BLADE_SKIP.join('; ')}`)
  {
    // the live game decides on routecal.js's ROUTE_CAL: it must agree with this run's measurement
    const tol = 0.05
    const bad = []
    for (const fam of ['hacking', 'blade']) {
      const m = ROUTE_MEASURED[fam]
      const t = RC.ROUTE_CAL[fam]
      if (!(Math.abs((m.pooled ?? 0) - (t?.pooled ?? 0)) <= tol)) bad.push(`${fam} pooled ${f2(m.pooled)} vs table ${f2(t?.pooled)}`)
      for (const n of new Set([...Object.keys(m.nodes), ...Object.keys(t?.nodes ?? {})])) {
        const sm = RC.routeSdOf(fam, Number(n), ROUTE_MEASURED)
        const st = RC.routeSdOf(fam, Number(n), RC.ROUTE_CAL)
        if (!(Math.abs(sm - st) <= tol)) bad.push(`${fam} BN${n} s ${f2(sm)} vs table ${f2(st)}`)
      }
    }
    console.log(`  CHECK the live table (routecal.js ROUTE_CAL, ${RC.ROUTE_CAL.measuredAt}) vs this run, every s within ${tol}: ${bad.length ? `FAIL — ${bad.join('; ')}: update ROUTE_CAL from these numbers (plan.decideBladeRouteGen decides on it)` : 'PASS'}`)
  }
  // the old rule on the same mid world, for the comparison (no band: min over the points)
  const midOld = worldOf({ ...econ, routeErr: null }, {}, wOpts)
  const Told = tableFor(L1, midOld)
  const Vold = solveDP(L1, Told)
  const pathOld = bestPath(L1, Told, Vold)
  console.log(`  mid-world optimum: the expected-hours rule ${V1[0].toFixed(1)}h (E over each route's band) | the point rule ${Vold[0].toFixed(1)}h (its points, no band)`)
  console.log('  every owed clear along the planned order (mid world, the state the order reaches it at): each route\'s point (the median), s, E = point x exp(s^2/2), p10-p90; the old rule took the min point, the new takes the min E')
  console.log('    clear     route        point     s      E      p10 - p90        old    new')
  let s = start
  for (const st of path1) {
    const lv = lvOf(s)
    const c = clearTime(st.n, lv, mid, S)
    const co = clearTime(st.n, lv, midOld, S)
    const rows = Object.entries(c.by).filter(([id, h]) => id !== 'cov5' && h !== null && h !== undefined && isFinite(h))
    const oldId = co.choice
    rows.forEach(([id, h], j) => {
      const sd = RC.routeSdOf(id, st.n, ROUTE_MEASURED)
      const [lo, hi] = RC.bandOf(h, sd)
      console.log(`    ${(j ? '' : clearLabel(st.n, s)).padEnd(9)} ${id.padEnd(11)} ${f1(h)}h  ${f2(sd)}  ${f1(h * RC.expectedFactorOf(sd))}h  ${f1(lo)} -${f1(hi)}h  ${id === oldId ? ' <-  ' : '     '}  ${id === c.choice ? ' <-' : ''}`)
    })
    if (c.by.cov5 !== undefined) console.log(`    ${''.padEnd(9)} + the 5th Covenant sleeve's purchase leg ${c.by.cov5.toFixed(1)}h (not banded)`)
    s = plus(s, st.n)
  }
  printPath(pathOld, start, midOld, `  the POINT rule's order (the plan before 2026-10-23), mid world:`)
}

// nextnode's question, from the entry state, and the CHECK against its local search
t0 = performance.now()
const T0 = tableFor(L0, mid)
const V0 = solveDP(L0, T0)
const fm0 = firstMoves(L0, T0, V0).sort((a, b) => a.T - b.T)
let lsWorse = 0
let lsBelow = 0
const lsRows = fm0.map((x) => {
  const ls = localSearch(L0, T0, x.n)
  if (ls.T < x.T - 1e-6) lsBelow++
  lsWorse = Math.max(lsWorse, ls.T - x.T)
  return { ...x, ls: ls.T }
})
tick('entry-state comparison + local search', t0)
console.log(`\nFROM THE ENTRY STATE ${sig(entry)} (nextnode.mjs's question, mid world = its cal/mid/mid cell): exact DP vs nextnode's local search`)
console.log('  first     T (DP)   T (local search)   LS excess')
for (const r of lsRows) console.log(`  ${clearLabel(r.n, entry).padEnd(7)} ${f1(r.T)}   ${f1(r.ls)}            +${(r.ls - r.T).toFixed(2)}`)
console.log(`  CHECK the DP is <= the local search for every first move: ${lsBelow ? `FAIL (${lsBelow} below)` : 'PASS'}; the local search's worst excess ${lsWorse.toFixed(2)}h`)

// ---------------------------------------------------------------------------
// 4. Uncertainty: draws on common random numbers
// ---------------------------------------------------------------------------
const nodes = [...new Set(owed(start))]
const r = rng(SEED)
const rDisc = rng(SEED + 13) // the discrepancy's own stream: --no-disc leaves every other draw unchanged
const rStanek = rng(SEED + 29) // Stanek's parameters' own stream: adding them left every other draw unchanged
const moves = L1.dims.map((d) => d.n)
const Ts = [] // [draw][move index]
const tabs = [] // [draw] the clear-time table (Float32), for the adaptive analyses (KG, bound, CVaR)
// THE USER'S PLAN "one node, then BN14 x (all owed)": for each first node n, the
// total with [n, 14, 14, 14] fixed and the optimal continuation after; [14 x3]
// alone as the n = 14 row. Priced on the same draws as the regret table.
const k14 = owed(start).filter((n) => n === 14).length
const patterns = k14 ? moves.map((n) => ({ n, seq: n === 14 ? Array(k14).fill(14) : [n, ...Array(k14).fill(14)] })) : []
const Ps = [] // [draw][pattern index]
const Zs = []
const Vstart = []
let sumC = null
t0 = performance.now()
for (let i = 0; i < DRAWS; i++) {
  const z = drawZ(r, nodes, econ, { rho: RHO_DRAW, rDisc, rStanek })
  const w = worldOf(econ, z, wOpts)
  const T = tableFor(L1, w)
  const V = solveDP(L1, T)
  const fm = firstMoves(L1, T, V)
  Ts.push(moves.map((n) => fm.find((x) => x.n === n).T))
  Ps.push(patterns.map((pt) => prefixTotal(L1, T, V, pt.seq)))
  Zs.push(z)
  Vstart.push(V[0])
  if (ADAPT) tabs.push(Float32Array.from(T.C))
  if (!sumC) sumC = new Float64Array(T.C.length)
  for (let j = 0; j < T.C.length; j++) sumC[j] += T.C[j]
  if ((i + 1) % 20 === 0) process.stderr.write(`[draws] ${i + 1}/${DRAWS} (${((performance.now() - t0) / 1000 / (i + 1)).toFixed(2)}s/draw)\n`)
}
const tDraws = (performance.now() - t0) / 1000
tick('draws', t0)

let patternRows = null
const stats = moves.map((n, j) => {
  const regret = Ts.map((row) => row[j] - Math.min(...row))
  return { n, ET: mean(Ts.map((row) => row[j])), pBest: regret.filter((x) => x < 1e-9).length / DRAWS, r50: quant(regret, 0.5), r90: quant(regret, 0.9), rMax: Math.max(...regret), Er: mean(regret) }
}).sort((a, b) => a.ET - b.ET)
const rec = stats[0]
const jRec = moves.indexOf(rec.n)
for (const s of stats) {
  // paired difference to the recommendation, with its Monte Carlo standard error
  const j = moves.indexOf(s.n)
  const d = Ts.map((row) => row[j] - row[jRec])
  s.dRec = mean(d)
  s.seRec = DRAWS > 1 ? Math.sqrt(d.reduce((a, x) => a + (x - s.dRec) ** 2, 0) / (DRAWS - 1) / DRAWS) : NaN
}
console.log(`\nREGRET — ${DRAWS} draws (seed ${SEED}), every first move priced on the same draws, each followed by that draw's optimal continuation`)
console.log('  first     E[T]     P(best)  E[regret]  regret p50   p90    max    E[T] - E[T best] (paired, +- 1 s.e.)')
for (const s of stats) console.log(`  ${clearLabel(s.n, start).padEnd(7)} ${f1(s.ET)}    ${pct(s.pBest)}    ${f1(s.Er)}    ${f1(s.r50)}  ${f1(s.r90)} ${f1(s.rMax)}    +${s.dRec.toFixed(2)} +- ${s.seRec.toFixed(2)}`)
console.log(`  E[T] with perfect information (each draw's own optimum): ${mean(Vstart).toFixed(1)}h; T spread over draws p10 ${quant(Vstart, 0.1).toFixed(0)}h p50 ${quant(Vstart, 0.5).toFixed(0)}h p90 ${quant(Vstart, 0.9).toFixed(0)}h`)

// Robust open-loop plan: E[sum C] = sum E[C] along a fixed order, so the DP on the mean table is the exact best FIXED order.
const Tmean = { ...T1, C: Float64Array.from(sumC, (x) => x / DRAWS) }
const Vmean = solveDP(L1, Tmean)
const robust = bestPath(L1, Tmean, Vmean)
console.log(`\nROBUST ORDER — the best FIXED order in expectation over the ${DRAWS} draws (DP on the mean clear-time table): E[T] ${Vmean[0].toFixed(1)}h`)
{
  let s = start
  const cells = robust.map((st) => {
    const lab = clearLabel(st.n, s)
    s = plus(s, st.n)
    return `${lab} ${st.h.toFixed(1)}h`
  })
  for (let i = 0; i < cells.length; i += 6) console.log('  ' + cells.slice(i, i + 6).map((x, j) => `${String(i + j + 1).padStart(2)}. ${x}`.padEnd(19)).join(''))
}
const midSeq = path1.map((s) => s.n)
console.log(`  the mid-world order priced on the mean table: ${(() => {
  let s = 0
  const di = new Map(L1.dims.map((d, i) => [d.n, i]))
  const dg = L1.dims.map(() => 0)
  for (const n of midSeq) {
    const d = di.get(n)
    s += Tmean.C[d * Tmean.F + dg.reduce((a, x, k) => a + x * Tmean.fstride[k], 0)]
    dg[d]++
  }
  return s.toFixed(1)
})()}h (re-planning after each clear recovers part of the gap to ${mean(Vstart).toFixed(1)}h)`)

if (patterns.length) {
  const midP = patterns.map((pt) => prefixTotal(L1, T1, V1, pt.seq))
  const rows = patterns.map((pt, j) => {
    const ex = Ps.map((row, i) => row[j] - Vstart[i])
    const vs = Ps.map((row, i) => row[j] - Ts[i][jRec])
    return { ...pt, mid: midP[j], E: mean(Ps.map((row) => row[j])), exE: mean(ex), ex90: quant(ex, 0.9), vsRec: mean(vs) }
  }).sort((a, b) => a.E - b.E)
  console.log(`\n"ONE NODE, THEN BN14 x${k14}" — the first ${k14 + 1} clears fixed to [n, ${Array(k14).fill('14').join(', ')}], optimal after (same ${DRAWS} draws):`)
  console.log('  plan                 T mid    E[T]    E[T] - E[best plan]   excess over each draw\'s optimum: mean   p90')
  for (const r of rows) console.log(`  ${(r.n === 14 ? `BN14 x${k14} first` : `BN${r.n} then BN14 x${k14}`).padEnd(19)} ${f1(r.mid)}  ${f1(r.E)}      +${r.vsRec.toFixed(1)}                         ${r.exE.toFixed(1).padStart(6)}  ${r.ex90.toFixed(1).padStart(6)}`)
  patternRows = rows
}

// ---------------------------------------------------------------------------
// 5. Sensitivity / value of information
// ---------------------------------------------------------------------------
const ids = paramIds(nodes, econ)
const BINS = 5
function evppi(zOf) {
  const order = Ts.map((_, i) => i).sort((a, b) => zOf(a) - zOf(b))
  const base = Math.min(...moves.map((_, j) => mean(Ts.map((row) => row[j]))))
  let acc = 0
  const flips = []
  for (let b = 0; b < BINS; b++) {
    const idx = order.slice(Math.floor((b * DRAWS) / BINS), Math.floor(((b + 1) * DRAWS) / BINS))
    if (!idx.length) continue
    const ms = moves.map((_, j) => mean(idx.map((i) => Ts[i][j])))
    const k = ms.indexOf(Math.min(...ms))
    acc += (Math.min(...ms) * idx.length) / DRAWS
    flips.push(moves[k])
  }
  return { v: base - acc, flips }
}
const placebo = rng(SEED + 99)
const pz = Ts.map(() => placebo())
const floor = evppi((i) => pz[i]).v
const voi = ids.map((id) => ({ id, ...evppi((i) => Zs[i][id] ?? 0) })).sort((a, b) => b.v - a.v)

let oat = []
if (!has('--no-sens')) {
  t0 = performance.now()
  const recMid = fm1[0].n
  for (const id of ids)
    for (const zv of [-1.2816, 1.2816]) {
      const w = worldOf(econ, { [id]: zv }, wOpts)
      const T = tableFor(L1, w)
      const V = solveDP(L1, T)
      const fm = firstMoves(L1, T, V).sort((a, b) => a.T - b.T)
      const regret = fm.find((x) => x.n === recMid).T - fm[0].T
      // where the first BN14 clear sits in that world's optimal order, and the
      // "one node, then BN14 x3" plans' best excess there (phase 2b's question)
      const pth = bestPath(L1, T, V)
      const pos14 = pth.findIndex((st) => st.n === 14) + 1
      const pat = patterns.length ? Math.min(...patterns.map((pt) => prefixTotal(L1, T, V, pt.seq))) - V[0] : null
      oat.push({ id, zv, best: fm[0].n, regret, T: fm[0].T, pos14, pat })
    }
  tick('one-at-a-time sweep', t0)
}
const lab = (n) => clearLabel(n, start)
console.log(`\nSENSITIVITY — value of information: the hours a perfect reading of ONE parameter would save in expectation (EVPPI, ${BINS} quantile bins over the draws; noise floor from a placebo parameter ${floor.toFixed(2)}h)`)
console.log('  and one-at-a-time: that parameter at its 10th / 90th percentile, all else median — the best first move then, and the regret of the mid recommendation there')
console.log(`  param    EVPPI    best first move per bin (low z -> high z)            at p10                  at p90`)
for (const v of voi) {
  const o = oat.filter((x) => x.id === v.id)
  const os = o.map((x) => `${lab(x.best).padEnd(7)}${x.regret > 1e-6 ? ` (+${x.regret.toFixed(1)}h)` : ''}`.padEnd(22))
  const desc = /^g\d+$/.test(v.id) ? `g of BN${v.id.slice(1)}${econ.ownG.has(Number(v.id.slice(1))) ? ' (played)' : ''}` : v.id
  console.log(`  ${desc.padEnd(17).slice(0, 17)} ${v.v.toFixed(2).padStart(5)}h  ${v.flips.map(lab).join(' ').padEnd(44)} ${os.join(' ')}`)
}
if (oat.length) {
  // THE WHOLE ORDER, not just the first move (phase 2b's list): each parameter's
  // p10 -> p90 swing of the optimal total, where BN14's first clear lands, and
  // the best "one node, then BN14 x3" plan's excess over the optimum.
  const pos0 = path1.findIndex((st) => st.n === 14) + 1
  const pat0 = patterns.length ? Math.min(...patterns.map((pt) => prefixTotal(L1, T1, V1, pt.seq))) - V1[0] : null
  const rows = ids.map((id) => {
    const [lo, hi] = [-1.2816, 1.2816].map((zv) => oat.find((x) => x.id === id && x.zv === zv))
    return { id, lo, hi, swing: Math.abs(hi.T - lo.T) }
  }).sort((a, b) => b.swing - a.swing)
  console.log(`\nSENSITIVITY OF THE WHOLE PLAN — one at a time, p10 / p90 (all else median): the optimal total, BN14's first slot in the optimal order (mid: ${pos0}), and the best "n then BN14 x${k14}" plan's excess over the optimum (mid: +${pat0 === null ? '-' : pat0.toFixed(1)}h)`)
  console.log('  param             swing     T at p10   T at p90   BN14 slot p10/p90   "then BN14" excess p10/p90')
  for (const r of rows.slice(0, 16)) {
    const desc = /^g\d+$/.test(r.id) ? `g of BN${r.id.slice(1)}` : r.id
    console.log(`  ${desc.padEnd(17).slice(0, 17)} ${r.swing.toFixed(1).padStart(6)}h  ${f1(r.lo.T)}    ${f1(r.hi.T)}       ${String(r.lo.pos14).padStart(2)} / ${String(r.hi.pos14).padEnd(2)}            +${r.lo.pat === null ? '-' : r.lo.pat.toFixed(1)} / +${r.hi.pat === null ? '-' : r.hi.pat.toFixed(1)}`)
  }
}
const flippers = oat.filter((x) => x.best !== fm1[0].n)
console.log(`  one-at-a-time flips of the mid recommendation ${lab(fm1[0].n)}: ${flippers.length ? flippers.map((x) => `${x.id}@${x.zv < 0 ? 'p10' : 'p90'} -> ${lab(x.best)} (+${x.regret.toFixed(1)}h)`).join('; ') : 'none'}`)

// EXPLORE: is measuring a parameter before the next decision worth its cost?
// value = its EVPPI (hours a perfect reading saves on this decision, net of the
// placebo floor); cost = posterior.measurability (hours of game time, or not
// measurable before the decision). Worth taking when it can happen before the
// decision and value > cost.
const liveRoute = inProg ? (live.bbJoinH !== null && live.bbJoinH !== undefined && !(live.maxLevel >= 1000) ? 'blade' : 'hack') : null
const ctx = { node: inProg, route: liveRoute, rec: rec.n, dRec: (n) => stats.find((x) => x.n === n)?.dRec ?? null }
const explore = voi.map((v) => ({ ...v, net: Math.max(0, v.v - Math.max(0, floor)), m: measurability(v.id, ctx) }))
console.log(`\nEXPLORE — per parameter: the hours learning it before the next decision would save (EVPPI net of the placebo floor ${floor.toFixed(2)}h) vs what measuring it costs; node in progress ${inProg ? `${clearLabel(inProg, entry)} (${liveRoute} route)` : 'none'}`)
console.log('  param             value    cost     before the decision?   worth it?   how / why')
for (const e of explore) {
  const desc = /^g\d+$/.test(e.id) ? `g of BN${e.id.slice(1)}` : e.id
  const worth = e.m.before && e.net > (e.m.cost ?? Infinity) && e.net > 0.05
  e.worth = worth
  console.log(`  ${desc.padEnd(17)} ${e.net.toFixed(2).padStart(5)}h  ${e.m.cost === null ? '   -  ' : `${e.m.cost.toFixed(2).padStart(5)}h`}  ${(e.m.before ? 'yes' : 'no').padEnd(22)} ${(worth ? 'YES' : 'no').padEnd(10)}  ${e.m.how}: ${e.m.why}`)
}
const worthIt = explore.filter((e) => e.worth)
console.log(`  EXPLORATION: ${worthIt.length ? worthIt.map((e) => `measure ${e.id} (${e.m.how}) — saves ${e.net.toFixed(2)}h for ${e.m.cost.toFixed(2)}h`).join('; ') : 'no measurement is worth taking before the next decision — every parameter that could move it is either measured for free by what is already running or measurable only after it'}`)


// ---------------------------------------------------------------------------
// 5b. Learning as we play: the knowledge gradient, the information-relaxation
//     bound, the tails, and the surrogate checked against the simulation
//     (adaptive.mjs; every policy chosen on one half of the draws, charged on the other)
// ---------------------------------------------------------------------------
let adaptOut = null
if (ADAPT && DRAWS >= 10) {
  t0 = performance.now()
  const folds = foldsOf(DRAWS)
  const ol = openLoop(L1, T1, tabs, moves, folds)
  // what playing A next reveals: its g on the hacking route, k on the Bladeburner route (mid world's route)
  const Z90_ = 1.2816
  const kScale = (Math.log(BB_PARAMS.k.hi) - Math.log(BB_PARAMS.k.lo)) / (2 * Z90_)
  const gScaleOf = (n) => (econ.gJoint?.sd.has(n) ? econ.gJoint.sd.get(n) : econ.ownG.has(n) ? econ.gSd?.get(n) ?? SIGMA_P : ((Math.log(econ.gScen.hi) - Math.log(econ.gScen.lo)) / (2 * Z90_)) * (econ.gScale ?? 1))
  const er = rng(SEED + 7)
  const eps = Zs.map(() => new Map(moves.map((n) => [n, normal(er)])))
  const owedOf = (n) => owed(start).filter((x) => x === n).length
  const kgRows = moves.map((A) => {
    const via = clearTime(A, lvOf(start), mid, S).via
    const param = via === 'blade' || via === 'bladeStanek' ? 'k' : `g${A}`
    const noise = via === 'blade' || via === 'bladeStanek' ? 0.1 / kScale : OBS_SD_G / gScaleOf(A) // one reading's sd in z units (OBS_SD k 0.1, g 0.15)
    const ms = [...new Set([1, owedOf(A)])]
    const byM = new Map()
    for (const m of [...ms, Infinity]) {
      const sig = Zs.map((z, i) => (z[param] ?? 0) + (m === Infinity ? 0 : (noise / Math.sqrt(m)) * eps[i].get(A)))
      byM.set(m, kgOfMove(L1, T1, tabs, sig, A, { bins: KG_BINS, folds, ol }))
    }
    const k1 = byM.get(1)
    const kstar = Math.max(...ms.map((m) => byM.get(m).kg / m))
    return { n: A, via, param, noise, ms, kg1: k1.kg, se1: k1.se, kgOwed: byM.get(ms[ms.length - 1]).kg, kgInf: byM.get(Infinity).kg, kstar, myopic: kstar > k1.kg + 1e-9, J: k1.J, J0: k1.J0, EJ: mean(k1.J), EJ0: mean(k1.J0), cv: cvar(k1.J0, 0.9), cvJ: cvar(k1.J, 0.9), cvPI: cvar(Ts.map((row) => row[moves.indexOf(A)]), 0.9) }
  })
  kgRows.sort((a, b) => a.EJ - b.EJ)
  const rowRec = kgRows.find((r) => r.n === rec.n)
  const learnBest = kgRows[0]
  console.log(`\nEXPLORE BY THE KNOWLEDGE GRADIENT — playing A next reveals its g (hacking route) or k (Bladeburner route); the reading moves every correlated parameter${econ.gJoint ? ` (the ${gChosen} model: shared beta and tau)` : ` (the hand latent's common factor, share ${RHO_DRAW})`}, and the order after A is re-chosen on the CONDITIONAL mean table (cross-fitted, ${KG_BINS} signal bins)`)
  console.log("  J0 = E[total] playing A then the best fixed order (no learning); J = with the one update; KG = J0 - J; KG(m) = m readings (A's owed levels), KG(inf) = a perfect reading; KG* = max_m KG(m)/m (Frazier-Powell KG(*); '!' = above KG(1): one step is myopically low)")
  console.log('  first     reads    E[J0]     E[J]    KG(1) +- se    KG(m)   KG(inf)   KG*    J - J(rec)   EVPPI of the read param (old EXPLORE)')
  for (const r of kgRows) {
    const ev = voi.find((v) => v.id === r.param)?.v ?? 0
    console.log(`  ${lab(r.n).padEnd(7)} ${r.param.padEnd(5)} ${f1(r.EJ0)}  ${f1(r.EJ)}   ${r.kg1.toFixed(2).padStart(6)} +- ${r.se1.toFixed(2)}  ${r.kgOwed.toFixed(2).padStart(6)}  ${r.kgInf.toFixed(2).padStart(6)}  ${r.kstar.toFixed(2).padStart(6)}${r.myopic ? '!' : ' '}  ${(r.EJ - rowRec.EJ >= 0 ? '+' : '') + (r.EJ - rowRec.EJ).toFixed(2).padStart(6)}        ${ev.toFixed(2)}h`)
  }
  const dLearn = learnBest.J.map((x, i) => x - rowRec.J[i])
  const better = kgRows.filter((r) => r.n !== rec.n && r.EJ < rowRec.EJ - 2 * seMean(r.J.map((x, i) => x - rowRec.J[i])))
  console.log(`  learning-aware next clear: ${lab(learnBest.n)} (E[J] ${learnBest.EJ.toFixed(1)}h)${learnBest.n === rec.n ? ' = the recommendation' : `; vs ${lab(rec.n)} ${mean(dLearn).toFixed(2)} +- ${seMean(dLearn).toFixed(2)}h (paired)`}. Playing a node out of order to learn is worth it only when J(A) < J(rec) beyond noise: ${better.map((r) => lab(r.n)).join(', ') || 'none beyond 2 s.e.'}`)
  console.log("  (the k reading of BN4.3 in progress arrives before this decision at no cost, so the Bladeburner rows' KG is partly in hand already)")

  // the information-relaxation bound
  const irOL = infoRelaxation(Vstart, ol.robust)
  const irKG = infoRelaxation(Vstart, rowRec.J)
  const irBest = irKG.policy <= irOL.policy ? irKG : irOL
  console.log(`\nINFORMATION-RELAXATION BOUND (Brown, Smith & Sun 2010, zero penalty) — the mean over the ${DRAWS} draws of each draw's own perfect-information optimum: ${irOL.bound.toFixed(1)}h. No policy that learns as it plays beats it in expectation.`)
  console.log('  our policies, charged on held-out draws (paired with the bound):')
  console.log(`    open loop, the best fixed order:                  ${irOL.policy.toFixed(1)}h   gap ${irOL.gap.toFixed(2)} +- ${irOL.se.toFixed(2)}h   (draws below the bound: ${irOL.violations})`)
  console.log(`    ${lab(rec.n).padEnd(7)} then re-plan once on its reading:     ${irKG.policy.toFixed(1)}h   gap ${irKG.gap.toFixed(2)} +- ${irKG.se.toFixed(2)}h   (draws below the bound: ${irKG.violations})`)
  const gapV = irBest.gap
  console.log(`  => the most ANY learning scheme could still save over our best policy: ${gapV.toFixed(1)}h (${((100 * gapV) / irBest.policy).toFixed(1)}% of the total). ${gapV < 1 ? 'Under 1h: a Bayes-adaptive outer loop is not worth building.' : 'Over 1h: a Bayes-adaptive outer loop could pay, up to this much — the zero-penalty bound credits foresight of every parameter, including SF effects nothing measures before their SF is held, so it is an upper limit; README "Learning as we play" sketches the belief-state DP.'}`)

  // the tails
  const robustCv = cvar(ol.robust, 0.9)
  const ru = kgRows.filter((r) => r.n !== learnBest.n)[0]
  console.log('\nRISK — CVaR(0.9) = the mean of the worst 10% of draws (Lin, Ren & Zhou 2022); the objective stays the expectation. Per first move: playing it then the best fixed order (held-out), with the one update, and with each draw\'s own optimum after it (the regret table\'s, anticipative):')
  console.log('  first     E[T]     CVaR.9   CVaR.9 (learning)   CVaR.9 (perfect info after)')
  for (const r of kgRows) console.log(`  ${lab(r.n).padEnd(7)} ${f1(r.EJ0)}   ${f1(r.cv)}       ${f1(r.cvJ)}             ${f1(r.cvPI)}`)
  console.log(`  the robust fixed order (held-out): E[T] ${mean(ol.robust).toFixed(1)}h, CVaR.9 ${robustCv.toFixed(1)}h`)
  // ONE first move left (2026-10-25: only BN8 after BN2.3) has no runner-up: the tail and the multi-fidelity
  // comparisons are between first moves, so they are skipped, said so, never crashed on.
  const tailGap = ru ? learnBest.cv - ru.cv : 0
  const tailFlag = tailGap > 5
  if (ru) console.log(`  ${tailFlag ? 'FLAG' : 'ok  '}: the risk-neutral choice ${lab(learnBest.n)} has CVaR.9 ${learnBest.cv.toFixed(1)}h vs the runner-up ${lab(ru.n)}'s ${ru.cv.toFixed(1)}h (${tailGap >= 0 ? '+' : ''}${tailGap.toFixed(1)}h; flagged when > +5h)`)
  else console.log(`  ok  : one first move left (${lab(learnBest.n)}): no runner-up to compare tails with`)

  // the surrogate against the simulation: multi-fidelity Monte Carlo on two fixed orders
  const Sd = await loadSurrogate({ start: entry, profile: econ.profile, bbSeeds: BB_SEEDS, direct: true })
  const orderTotal = (seq, w, SS) => {
    let st = start
    let tot = 0
    for (const n of seq) {
      tot += clearTime(n, lvOf(st), w, SS).h
      st = plus(st, n)
    }
    return tot
  }
  const K = Math.min(MF_K, DRAWS)
  const mfOrders = [
    { name: `the robust order (${lab(robust[0].n)} first)`, seq: robust.map((x) => x.n) },
    ...(ru ? [{ name: `${lab(ru.n)} first, then the best fixed order`, seq: ol.fits[0].cont.get(ru.n) }] : []),
  ]
  const mfRows = mfOrders.map((o) => {
    const lfN = Zs.map((z) => orderTotal(o.seq, worldOf(econ, z, wOpts), S))
    const hf = Zs.slice(0, K).map((z) => orderTotal(o.seq, worldOf(econ, z, wOpts), Sd))
    return { ...o, ...mfmc(hf, lfN.slice(0, K), lfN) }
  })
  console.log(`\nMULTI-FIDELITY CHECK (Peherstorfer et al. 2018) — ${K} draws re-priced on the simulation itself (hackexit called directly, no interpolation) as the high fidelity, the surrogate on all ${DRAWS} as the control variate:`)
  for (const m of mfRows) console.log(`  ${m.name.padEnd(46)} surrogate E[T] ${m.lfMean.toFixed(2)}h   multi-fidelity ${m.est.toFixed(2)}h   surrogate bias ${m.bias >= 0 ? '+' : ''}${m.bias.toFixed(3)} +- ${m.biasSe.toFixed(3)}h (corr ${m.rho.toFixed(4)}, alpha ${m.alpha.toFixed(3)})`)
  const dLF = mfRows[1] ? mfRows[0].lfMean - mfRows[1].lfMean : 0
  const dMF = mfRows[1] ? mfRows[0].est - mfRows[1].est : 0
  if (mfRows[1]) console.log(`  robust minus runner-up: surrogate ${dLF.toFixed(2)}h, corrected ${dMF.toFixed(2)}h — the correction ${Math.sign(dLF) === Math.sign(dMF) ? 'does not change' : 'CHANGES'} which is better`)
  tick('adaptive (KG, bound, CVaR, multi-fidelity)', t0)
  adaptOut = { kg: kgRows.map(({ J, J0, ...r }) => r), ir: { openLoop: irOL, kgPolicy: irKG, gap: gapV }, risk: { robustCvar: robustCv, tailFlag, tailGap }, mfmc: mfRows, learnBest: learnBest.n }
}
// ---------------------------------------------------------------------------
// 6. Verdict and cost
// ---------------------------------------------------------------------------
console.log('\nRECOMMENDATION')
console.log(`  next: ${lab(rec.n)}  (lowest expected total ${rec.ET.toFixed(1)}h over ${DRAWS} draws; best in ${pct(rec.pBest).trim()} of draws; regret p90 ${rec.r90.toFixed(1)}h)`)
console.log(`  mid-world optimum: ${lab(fm1[0].n)} (T ${fm1[0].T.toFixed(1)}h); robust fixed order starts ${lab(robust[0].n)}`)
// THE WATCHDOG'S --next (watchdog.js nextNodeArgsOf): the recommendation as a root .txt the daemon pushes to
// home as /next-node.txt. Hand-set --next went stale twice (BN3 replayed 9h, 10-22; BN13.3 out of order, 10-23).
// --no-next-file for experiments that must not steer the live game.
if (!has('--no-next-file')) {
  const m = /BN(\d+)\.(\d+)/.exec(String(lab(rec.n)))
  if (m) {
    fs.writeFileSync(new URL('../../../next-node.txt', import.meta.url), JSON.stringify({ at: new Date().toISOString(), next: Number(m[1]), level: Number(m[2]), label: m[0], from: inProg ?? null, fromSF: inProg ? (Object.fromEntries(pairsOf(entry))[inProg] ?? 0) : null, ET: +rec.ET.toFixed(1), pBest: rec.pBest, by: 'tools/sim/gameplan/plan.mjs' }) + '\n')
    console.log(`  next-node.txt: ${m[0]}${inProg ? ` after BN${inProg} (in progress)` : ''} (the watchdog's endgame --next)`)
  }
}
const ru = process.resourceUsage()
console.log(`\nCOST: wall ${((performance.now() - T_START) / 1000).toFixed(1)}s | peak RSS ${(ru.maxRSS / 1024).toFixed(0)}MB | ` + Object.entries(phase).map(([k, v]) => `${k} ${v.toFixed(1)}s`).join(' | '))
console.log(`  per draw: ${(tDraws / Math.max(1, DRAWS)).toFixed(2)}s (table ${T1.C.length.toLocaleString()} clear times over ${T1.F.toLocaleString()} live feature combos + DP over ${L1.size.toLocaleString()} states); mid table ${tTable.toFixed(2)}s, DP ${tDP.toFixed(2)}s`)
console.log(`  surrogate: ${S.meta.curves} hack curves x ${LN_G.length} = ${S.meta.gridPoints} sim points (${bstats.hack.computed} computed this run${bstats.hack.computed ? `, ${(bstats.hack.ms / bstats.hack.computed).toFixed(1)}ms each` : ''}); ${S.meta.bbCells} Bladeburner cells x ${BB_SEEDS} seeds = ${bstats.bb.needed} sims (${bstats.bb.computed} computed this run${bstats.bb.computed ? `, ${(bstats.bb.ms / bstats.bb.computed / 1000).toFixed(2)}s each` : ''}, ${bstats.bb.seeded} seeded from nextnode's cache)`)

if (arg('--json')) {
  fs.writeFileSync(arg('--json'), JSON.stringify({ at: new Date().toISOString(), entry: pairsOf(entry), inProgress: inProg, start: pairsOf(start), recommended: rec.n, midOrder: path1, robustOrder: robust, regret: stats, voi, oat, patterns: patternRows, explore: explore.map(({ id, v, net, m, worth }) => ({ id, evppi: v, net, ...m, worth })), posterior: postSum, gModel: { chosen: gChosen, loo: Object.fromEntries(Object.entries(loo.models).map(([k, v]) => [k, { elpd: v.elpd, rmse: v.rmse, z: v.z }])) }, discrepancy: { ...discFit, residuals: discRes, enabled: !has('--no-disc') }, adaptive: adaptOut }, null, 1))
}
process.exit(0)
