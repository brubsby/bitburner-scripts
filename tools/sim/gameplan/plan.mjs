// THE WHOLE-GAME PLAN: which BitNode next, and the full order of every clear
// still owed, minimising the total hours to finish the game (every SF to 3,
// SF12 once, BN15 excluded by the user).
//
//   node tools/sim/gameplan/plan.mjs                     state + node in progress from telemetry
//   node tools/sim/gameplan/plan.mjs --state 1.3,2.1,4.2,5.1,6.1,8.1,9.1,10.1 --in-progress 4
//   node tools/sim/gameplan/plan.mjs --draws 200 --seed 7 --bb-seeds 5 --jobs 1
//   node tools/sim/gameplan/plan.mjs --build-only        build / extend the surrogate cache and stop
//   flags: --in-progress none | --no-sens | --json out.json | --telemetry DIR
//          --sigma-played 0.15 | --rho 0.5 | --direct (mid world on direct sims)
//
// NOT CALIBRATED as a decision model. What is and is not:
//   CALIBRATED   each played node's g (backed out of its measured hours; the
//                CHECK below re-runs the sim at that g and prints the error);
//                the Bladeburner k = 0.916 (live BN6 leg / model, bbcal6.mjs).
//   NOT CALIBRATED  g on every unplayed node (the latent, lo/mid/hi over the
//                measured runs); k's spread (one node); every ASSUMED
//                Source-File effect (effects.mjs); the node-special routes
//                (BN14's is MODELLED from source + the measured BN9 Go farm
//                with two ASSUMED inputs, eps14 and w0 — go.mjs; BN3/8/13's
//                are placeholders that price nothing: routes.mjs); the draw's
//                correlation structure (params.mjs RHO, SIGMA_PLAYED).
// So the output is a decision UNDER those assumptions, with the regret and the
// value-of-information tables saying how much each one could move it.
//
// PIPELINE: economy.mjs (telemetry -> g) -> surrogate.mjs (sims -> cached grid)
// -> routes.mjs (C = min over routes) -> search.mjs (exact DP over the SF
// lattice) -> draws (params.mjs) -> regret, robust plan, sensitivity.

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
const { BB_PARAMS, RHO, SIGMA_PLAYED, rng, drawZ, worldOf, paramIds } = await import('./params.mjs')
const { ROUTES, clearTime, hackParts, favorHours, favorRef } = await import('./routes.mjs')
const { buildTable, solveDP, bestPath, firstMoves, localSearch, prefixTotal } = await import('./search.mjs')
const { GO_MEASURED, goScale, goMaxRep, w0rldDiv } = await import('./go.mjs')
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

const live_ = (n) => !isInert(n)
const tableFor = (L, world) => buildTable(L, (n, lv) => clearTime(n, lv, world, S).h, live_)
const lvOf = (s) => (n) => lvl(s, n)

// ---------------------------------------------------------------------------
// 3. The mid world: exact optimum, and nextnode's question from the entry
// ---------------------------------------------------------------------------
// --phase1: price as phase 1 did (no IPvGO model, no gym scale, BN14 speed 1) — the before/after comparison
const wOpts = { sigmaPlayed: SIGMA_P, phase1: has('--phase1') }
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
console.log(`    g(node) unplayed: ln g split-normal through the latent lo/mid/hi x AMC^-gamma, common-factor share ${RHO_}; played: measured x exp(${SIGMA_P} z)`)
console.log('ROUTES (routes.mjs):')
for (const r of ROUTES) console.log(`  ${r.id.padEnd(7)}${r.node ? `BN${r.node} `.padEnd(6) : 'all   '}${r.status}`)

console.log(`\nTHE NEXT CLEAR, every candidate from ${sig(start)} (mid world): own hours by route, and T = own + the best continuation`)
console.log('  clear     hack   blade  special   via     own     T total   dT')
const fm1 = firstMoves(L1, T1, V1).sort((a, b) => a.T - b.T)
for (const x of fm1) {
  const c = clearTime(x.n, lvOf(start), mid, S)
  const sp = ROUTES.filter((r) => r.node === x.n).map((r) => `${r.id}:${c.by[r.id] === undefined || c.by[r.id] === null ? '-' : c.by[r.id].toFixed(1)}`).join(' ')
  console.log(`  ${clearLabel(x.n, start).padEnd(7)} ${f1(c.by.hack)} ${f1(c.by.blade)}  ${sp.padEnd(9)} ${String(c.via).padEnd(6)} ${f1(x.own)}  ${f1(x.T)}  +${(x.T - fm1[0].T).toFixed(1)}`)
}

// ---------------------------------------------------------------------------
// The IPvGO model (go.mjs): BN14 term by term, and SF14's effect on every node
// ---------------------------------------------------------------------------
const lvWith = (s, n, l) => (m) => (m === n ? l : lvl(s, m))
{
  const w = mid
  console.log(`\nTHE IPvGO MODEL (go.mjs), mid world — MEASURED: Daedalus ${GO_MEASURED.powerPerH}/h x goP ${w.sf.goP}, win ${GO_MEASURED.pWin}, ${GO_MEASURED.gamesPerH} games/h, rep ${w.sf.rep14}/h per level at level ${w.sf.lvl14}; abar (the measured runs' mean Daedalus bonus over a ${econ.profile.cycleHours.toFixed(2)}h window) ${w.go.abar.toFixed(3)}; ASSUMED eps14 ${w.sf.eps14}, w0 ${w.sf.w0}/h`)
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
  console.log(`  W (w0r1d_d43m0n at the exit, ${w.sf.w0}/h for 1h): GoPower 1: x${w0rldDiv(1, w.sf.w0).toFixed(3)} (SF14.1+ x${w0rldDiv(2, w.sf.w0).toFixed(3)}); BN14: x${w0rldDiv(4, w.sf.w0).toFixed(3)} (with SF14.1+ x${w0rldDiv(8, w.sf.w0).toFixed(3)})`)
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
const moves = L1.dims.map((d) => d.n)
const Ts = [] // [draw][move index]
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
  const z = drawZ(r, nodes, econ, { rho: RHO_ })
  const w = worldOf(econ, z, wOpts)
  const T = tableFor(L1, w)
  const V = solveDP(L1, T)
  const fm = firstMoves(L1, T, V)
  Ts.push(moves.map((n) => fm.find((x) => x.n === n).T))
  Ps.push(patterns.map((pt) => prefixTotal(L1, T, V, pt.seq)))
  Zs.push(z)
  Vstart.push(V[0])
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
const ids = paramIds(nodes)
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
  fs.writeFileSync(arg('--json'), JSON.stringify({ at: new Date().toISOString(), entry: pairsOf(entry), inProgress: inProg, start: pairsOf(start), recommended: rec.n, midOrder: path1, robustOrder: robust, regret: stats, voi, oat, patterns: patternRows }, null, 1))
}
process.exit(0)
