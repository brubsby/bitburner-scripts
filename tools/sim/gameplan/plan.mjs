// THE WHOLE-GAME PLAN: which BitNode next, and the full order of every clear
// still owed, minimising the total hours to finish the game (every SF to 3,
// SF12 once, BN15 excluded by the user).
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
//          --kg-bins 5 | --mf-k 20 (draws re-priced on direct sims for the multi-fidelity check)
//          --w0-window H (the w0r1d_d43m0n window fixed at H hours: 1 = the old model)
//          --w0-prior lo,mid,hi (override the derived w0 prior: 0,200,1000 = the old hand one)
//          --w0-live (the w0r1d_d43m0n bonus worth only the climb's shortening L0 - L*: a final
//          life that does not anticipate it, as today's exitplan; default: the exit shift ln W/g)
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

const { makeState, parseState, plus, lvl, owed, lattice, sig, clearLabel, pairsOf } = await import('./state.mjs')
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
const { GO_MEASURED, goScale, goMaxRep, w0PriorMC } = await import('./go.mjs')
const { POSTERIOR_FILE, loadStore, emptyStore, posteriorOf, summarise, measurability, appliedObs } = await import('./posterior.mjs')
const { runObserve, printMove } = await import('./observe.mjs')
const { looCompare, MODEL_WHAT } = await import('./gmodel.mjs')
const { fitDiscrepancy, lnHoursMoments, PRIOR_SD } = await import('./discrepancy.mjs')
const { cvar, infoRelaxation, foldsOf, openLoop, kgOfMove, mfmc, seMean } = await import('./adaptive.mjs')
let t0 = performance.now()
const { measureEconomy } = await import('./economy.mjs')
const { buildSurrogate, loadSurrogate, LN_G, BB_INT } = await import('./surrogate.mjs')
const { hackExitHours } = await import('../nodechoice/hackexit.mjs')
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
const econ0 = await measureEconomy()
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
const bstats = await buildSurrogate({ start: entry, profile: econ.profile, bbSeeds: BB_SEEDS, jobs: JOBS, log: (s) => process.stderr.write(s + '\n') })
tick('surrogate build', t0)
if (has('--build-only')) {
  console.log(JSON.stringify(bstats))
  process.exit(0)
}
t0 = performance.now()
const S = await loadSurrogate({ start: entry, profile: econ.profile, bbSeeds: BB_SEEDS, direct: has('--direct') })
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
}
const store = has('--prior') ? emptyStore() : loadStore(POST_FILE)
const post = posteriorOf(store, econRaw, { rho: RHO_, sigmaPlayed: SIGMA_P, gModel: G_MODEL, multsOf: S.mults })
Object.assign(econ, post.applied)
const postSum = summarise(post, econRaw)
const RHO_DRAW = arg('--rho') ? RHO_ : econ.rho

// ---------------------------------------------------------------------------
// 2c. The g model's leave-one-out, and the model discrepancy fitted to it
// ---------------------------------------------------------------------------
const OBS_SD_G = 0.15
const loo = looCompare(econ.runs.map((r) => ({ bn: r.bn, g: r.g, sd: OBS_SD_G })), S.mults)
const gChosen = post.gReg?.chosen ?? 'hand'
const discRes = econ.runs.map((r, i) => {
  const p = loo.models[gChosen].per[i]
  const mom = lnHoursMoments((g) => hackExitHours({ node: r.bn, sf: r.sfOnEntry, profile: econ.profile, g }).hours ?? Infinity, p.mean, p.sd)
  return { bn: r.bn, name: r.name, T: r.T, r: Math.log(r.T) - mom.mean, v: mom.var, predH: Math.exp(mom.mean) }
})
const discFit = fitDiscrepancy(discRes)
if (!has('--no-disc')) econ.disc = { sd: discFit.sd, applies: (n) => !econ.ownG.has(n) }

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
const wOpts = { sigmaPlayed: SIGMA_P, phase1: has('--phase1'), stanekOff: NO_STANEK, w0Window: W0_WINDOW, w0Live: has('--w0-live') }
const mid = worldOf(econ, {}, wOpts)
const L0 = lattice(entry)
const L1 = lattice(start)
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
console.log(`profile: life ${econ.profile.cycleHours.toFixed(2)}h | exp rich ${econ.profile.expRich.toExponential(2)}/s poor ${econ.profile.expPoor.toExponential(2)}/s | gamma ${econ.gamma.toFixed(3)} | latent g lo ${econ.gScen.lo.toFixed(3)} mid ${econ.gScen.mid.toFixed(3)} hi ${econ.gScen.hi.toFixed(3)}`)

console.log('\nCHECK — each played node\'s g reproduces its measured hours (the sim re-run at the backed-out g; the g IS this calibration):')
let worstCal = 0
for (const r of econ.runs) {
  const h = hackExitHours({ node: r.bn, sf: r.sfOnEntry, profile: econ.profile, g: r.g }).hours
  worstCal = Math.max(worstCal, Math.abs(h - r.T))
  console.log(`  CHECK ${r.name.padEnd(10)} measured ${f1(r.T)}h  model ${f1(h)}h  error ${(h - r.T).toFixed(2)}h   g ${r.g.toFixed(4)}`)
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
  console.log(`\nTHE g MODEL (gmodel.mjs) — leave-one-out over the ${econ.runs.length} played runs (log predictive density of each held-out run's ln g, reading sd ${OBS_SD_G}); --g-model ${G_MODEL} -> ${gChosen.toUpperCase()}`)
  console.log('  model   elpd     vs best (+- s.e.)   rmse ln g   standardised LOO residual per run (' + econ.runs.map((r) => 'BN' + r.bn).join(' ') + ')')
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
  console.log(`\nMODEL DISCREPANCY (discrepancy.mjs) — each played run's measured hours vs the simulated hours under the ${gChosen} model's leave-one-out g (residual r in ln hours, v = the predictive's own variance):`)
  for (const d of discRes) console.log(`  BN${String(d.bn).padEnd(3)} measured ${d.T.toFixed(1).padStart(6)}h  predicted (median) ${d.predH.toFixed(1).padStart(6)}h  r ${d.r.toFixed(3).padStart(7)}  sqrt v ${Math.sqrt(d.v).toFixed(3)}  r/sqrt v ${(d.r / Math.sqrt(d.v)).toFixed(2)}`)
  console.log(`  discrepancy sd (ln hours, prior half-normal ${PRIOR_SD}): posterior mean ${discFit.mean.toFixed(3)}, p10 ${discFit.p10.toFixed(3)} p90 ${discFit.p90.toFixed(3)}; the draws use sqrt E[sd^2] = ${discFit.sd.toFixed(3)} on every unplayed node's hacking-route hours${has('--no-disc') ? ' — DISABLED (--no-disc)' : ''}`)
}
console.log('ROUTES (routes.mjs):')
for (const r of ROUTES) console.log(`  ${r.id.padEnd(7)}${r.node ? `BN${r.node} `.padEnd(6) : 'all   '}${r.status}`)

console.log(`\nTHE NEXT CLEAR, every candidate from ${sig(start)} (mid world): own hours by route, and T = own + the best continuation`)
console.log('  clear     hack   blade  special   via     own     T total   dT')
const fm1 = firstMoves(L1, T1, V1).sort((a, b) => a.T - b.T)
for (const x of fm1) {
  const c = clearTime(x.n, lvOf(start), mid, S)
  const sp = ROUTES.filter((r) => r.node === x.n || (r.id === 'stanek' && c.by.stanek !== undefined)).map((r) => `${r.id}:${c.by[r.id] === undefined || c.by[r.id] === null ? '-' : c.by[r.id].toFixed(1)}`).join(' ')
  console.log(`  ${clearLabel(x.n, start).padEnd(7)} ${f1(c.by.hack)} ${f1(c.by.blade)}  ${sp.padEnd(9)} ${String(c.via).padEnd(6)} ${f1(x.own)}  ${f1(x.T)}  +${(x.T - fm1[0].T).toFixed(1)}`)
}

// ---------------------------------------------------------------------------
// The IPvGO model (go.mjs): BN14 term by term, and SF14's effect on every node
// ---------------------------------------------------------------------------
const lvWith = (s, n, l) => (m) => (m === n ? l : lvl(s, m))
{
  const w = mid
  console.log(`\nTHE IPvGO MODEL (go.mjs), mid world — MEASURED: Daedalus ${GO_MEASURED.powerPerH}/h x goP ${w.sf.goP}, win ${GO_MEASURED.pWin}, ${GO_MEASURED.gamesPerH} games/h, rep ${w.sf.rep14}/h per level at level ${w.sf.lvl14}; abar (the measured runs' mean Daedalus bonus over a ${econ.profile.cycleHours.toFixed(2)}h window) ${w.go.abar.toFixed(3)}; ASSUMED eps14 ${w.sf.eps14}; DERIVED w0 ${w.sf.w0.toFixed(0)}/h`)
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
      const never = Math.min(...Object.entries(c.by).filter(([k, v]) => k !== 'stanek' && v !== null && isFinite(v)).map(([, v]) => v))
      const p = stanekParts({ node: n, lv, world: w, S })
      const g = gridOf(m, l13)
      const lay = layoutFor(m, l13)
      const acc = p ? p.h : null
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
  tick("Stanek's Gift (section)", t0)
}

printPath(path1, start, mid, `OPTIMAL ORDER — mid world (every parameter at its median), from ${sig(start)}:`)

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
    const param = via === 'blade' ? 'k' : `g${A}`
    const noise = via === 'blade' ? 0.1 / kScale : OBS_SD_G / gScaleOf(A) // one reading's sd in z units (OBS_SD k 0.1, g 0.15)
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
  const tailGap = learnBest.cv - ru.cv
  const tailFlag = tailGap > 5
  console.log(`  ${tailFlag ? 'FLAG' : 'ok  '}: the risk-neutral choice ${lab(learnBest.n)} has CVaR.9 ${learnBest.cv.toFixed(1)}h vs the runner-up ${lab(ru.n)}'s ${ru.cv.toFixed(1)}h (${tailGap >= 0 ? '+' : ''}${tailGap.toFixed(1)}h; flagged when > +5h)`)

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
    { name: `${lab(ru.n)} first, then the best fixed order`, seq: ol.fits[0].cont.get(ru.n) },
  ]
  const mfRows = mfOrders.map((o) => {
    const lfN = Zs.map((z) => orderTotal(o.seq, worldOf(econ, z, wOpts), S))
    const hf = Zs.slice(0, K).map((z) => orderTotal(o.seq, worldOf(econ, z, wOpts), Sd))
    return { ...o, ...mfmc(hf, lfN.slice(0, K), lfN) }
  })
  console.log(`\nMULTI-FIDELITY CHECK (Peherstorfer et al. 2018) — ${K} draws re-priced on the simulation itself (hackexit called directly, no interpolation) as the high fidelity, the surrogate on all ${DRAWS} as the control variate:`)
  for (const m of mfRows) console.log(`  ${m.name.padEnd(46)} surrogate E[T] ${m.lfMean.toFixed(2)}h   multi-fidelity ${m.est.toFixed(2)}h   surrogate bias ${m.bias >= 0 ? '+' : ''}${m.bias.toFixed(3)} +- ${m.biasSe.toFixed(3)}h (corr ${m.rho.toFixed(4)}, alpha ${m.alpha.toFixed(3)})`)
  const dLF = mfRows[0].lfMean - mfRows[1].lfMean
  const dMF = mfRows[0].est - mfRows[1].est
  console.log(`  robust minus runner-up: surrogate ${dLF.toFixed(2)}h, corrected ${dMF.toFixed(2)}h — the correction ${Math.sign(dLF) === Math.sign(dMF) ? 'does not change' : 'CHANGES'} which is better`)
  tick('adaptive (KG, bound, CVaR, multi-fidelity)', t0)
  adaptOut = { kg: kgRows.map(({ J, J0, ...r }) => r), ir: { openLoop: irOL, kgPolicy: irKG, gap: gapV }, risk: { robustCvar: robustCv, tailFlag, tailGap }, mfmc: mfRows, learnBest: learnBest.n }
}
// ---------------------------------------------------------------------------
// 6. Verdict and cost
// ---------------------------------------------------------------------------
console.log('\nRECOMMENDATION')
console.log(`  next: ${lab(rec.n)}  (lowest expected total ${rec.ET.toFixed(1)}h over ${DRAWS} draws; best in ${pct(rec.pBest).trim()} of draws; regret p90 ${rec.r90.toFixed(1)}h)`)
console.log(`  mid-world optimum: ${lab(fm1[0].n)} (T ${fm1[0].T.toFixed(1)}h); robust fixed order starts ${lab(robust[0].n)}`)
const ru = process.resourceUsage()
console.log(`\nCOST: wall ${((performance.now() - T_START) / 1000).toFixed(1)}s | peak RSS ${(ru.maxRSS / 1024).toFixed(0)}MB | ` + Object.entries(phase).map(([k, v]) => `${k} ${v.toFixed(1)}s`).join(' | '))
console.log(`  per draw: ${(tDraws / Math.max(1, DRAWS)).toFixed(2)}s (table ${T1.C.length.toLocaleString()} clear times over ${T1.F.toLocaleString()} live feature combos + DP over ${L1.size.toLocaleString()} states); mid table ${tTable.toFixed(2)}s, DP ${tDP.toFixed(2)}s`)
console.log(`  surrogate: ${S.meta.curves} hack curves x ${LN_G.length} = ${S.meta.gridPoints} sim points (${bstats.hack.computed} computed this run${bstats.hack.computed ? `, ${(bstats.hack.ms / bstats.hack.computed).toFixed(1)}ms each` : ''}); ${S.meta.bbCells} Bladeburner cells x ${BB_SEEDS} seeds = ${bstats.bb.needed} sims (${bstats.bb.computed} computed this run${bstats.bb.computed ? `, ${(bstats.bb.ms / bstats.bb.computed / 1000).toFixed(2)}s each` : ''}, ${bstats.bb.seeded} seeded from nextnode's cache)`)

if (arg('--json')) {
  fs.writeFileSync(arg('--json'), JSON.stringify({ at: new Date().toISOString(), entry: pairsOf(entry), inProgress: inProg, start: pairsOf(start), recommended: rec.n, midOrder: path1, robustOrder: robust, regret: stats, voi, oat, patterns: patternRows, explore: explore.map(({ id, v, net, m, worth }) => ({ id, evppi: v, net, ...m, worth })), posterior: postSum, gModel: { chosen: gChosen, loo: Object.fromEntries(Object.entries(loo.models).map(([k, v]) => [k, { elpd: v.elpd, rmse: v.rmse, z: v.z }])) }, discrepancy: { ...discFit, residuals: discRes, enabled: !has('--no-disc') }, adaptive: adaptOut }, null, 1))
}
process.exit(0)
