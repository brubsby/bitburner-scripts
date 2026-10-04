// The game-dependent half of tools/test/gameplan.test.mjs (GP2, GP3), run in a
// child process so the suite's own process never loads the game bundle. Prints
// one JSON line: { gp2: {examined, notes, fails}|{skip}, gp3: ... }.
//
// CALIBRATION: this is a test harness, not a model. GP2 checks the surrogate's
// interpolation against the simulation it tabulates; GP3 is a regression
// against nodechoice/nextnode.mjs's printed output (919b8ca, /tmp/nextnode-bn6.out),
// NOT a calibration against the live game — the planner's calibration state
// is in plan.mjs's header and its CHECK lines.
//
//   node tools/sim/gameplan/selftest.mjs [--verbose]

import '../../test/gameresolve.mjs'
import { makeState, lattice, lvl } from './state.mjs'
import { isInert } from './effects.mjs'
import { worldOf, cellZ, rng } from './params.mjs'
import { clearTime } from './routes.mjs'
import { buildTable, solveDP, firstMoves, localSearch } from './search.mjs'

const VERBOSE = process.argv.includes('--verbose')
const out = { gp2: { examined: 0, notes: [], fails: [] }, gp3: { examined: 0, notes: [], fails: [] }, gp4: { examined: 0, notes: [], fails: [] } }
const done = () => {
  console.log(JSON.stringify(out))
  process.exit(0)
}

let econ, loadSurrogate, hackCurvesFor
try {
  ;({ loadSurrogate, hackCurvesFor } = await import('./surrogate.mjs'))
  const { measureEconomy } = await import('./economy.mjs')
  // the OLD constants (--rates const): GP3 is a regression against nextnode's printed numbers,
  // which priced them; GP2's interpolation and GP4's terms do not depend on the profile
  const e = await measureEconomy({ rates: 'const' })
  econ = { ...e, ownG: new Map(e.ownG) }
} catch (err) {
  out.gp2 = out.gp3 = out.gp4 = { skip: `inputs unavailable: ${String(err?.message ?? err).slice(0, 300)}` }
  done()
}

// nextnode.mjs's state after BN6 = this planner's entry state for BN4.3.
const S0 = makeState([[1, 3], [2, 1], [4, 2], [5, 1], [6, 1], [8, 1], [9, 1], [10, 1]], 133)
let Si, Sd
try {
  Si = await loadSurrogate({ start: S0, profile: econ.profile, bbSeeds: 5 })
  Sd = await loadSurrogate({ start: S0, profile: econ.profile, bbSeeds: 5, direct: true })
} catch (err) {
  out.gp2 = out.gp3 = out.gp4 = { skip: String(err?.message ?? err).slice(0, 300) }
  done()
}

// ---------------------------------------------------------------- GP2
{
  const c = out.gp2
  const r = rng(42)
  const curves = hackCurvesFor(S0)
  const errs = []
  for (let i = 0; i < 60; i++) {
    const cv = curves[Math.floor(r() * curves.length)]
    const g = Math.exp(Math.log(0.015) + r() * (Math.log(0.4) - Math.log(0.015))) // the band every world draws from
    const a = Si.hackHours(cv.node, cv.level, cv.sf, g)
    const b = Sd.hackHours(cv.node, cv.level, cv.sf, g)
    if (!isFinite(b)) continue
    errs.push({ e: Math.abs(a - b) / b, d: a - b, cv, g, a, b })
  }
  errs.sort((x, y) => x.e - y.e)
  c.examined = errs.length
  const med = errs[Math.floor(errs.length / 2)].e
  const max = errs[errs.length - 1]
  c.notes.push(`${errs.length} off-grid points (g 0.015..0.4/h, random curve): relative error median ${(100 * med).toFixed(2)}%, max ${(100 * max.e).toFixed(2)}% (BN${max.cv.node} ${max.cv.sf} g ${max.g.toFixed(4)}: ${max.a.toFixed(2)}h vs ${max.b.toFixed(2)}h)`)
  c.notes.push('tolerance: median 1%, max 3% — a clear is 15-120h and the decisions compared differ by >= 0.4h over ~1000h, so a 1% per-clear error that is not systematic washes out; a systematic one would show in GP3')
  if (med > 0.01) c.fails.push(`median interpolation error ${(100 * med).toFixed(2)}% > 1%`)
  if (max.e > 0.03) c.fails.push(`max interpolation error ${(100 * max.e).toFixed(2)}% > 3% at BN${max.cv.node} ${max.cv.sf} g ${max.g}`)
  // ...and where it matters: the whole-game optimum and the first-move ranking, interpolated vs direct (mid world)
  const L = lattice(S0)
  const mid = worldOf(econ, {}, { sigmaPlayed: 0 })
  const res = [Si, Sd].map((S) => {
    const T = buildTable(L, (n, lvf) => clearTime(n, lvf, mid, S).h, (n) => !isInert(n))
    const V = solveDP(L, T)
    return { V0: V[0], fm: firstMoves(L, T, V).sort((a, b) => a.T - b.T) }
  })
  const dV = res[0].V0 - res[1].V0
  const dFirst = Math.max(...res[0].fm.map((x) => Math.abs(x.T - res[1].fm.find((y) => y.n === x.n).T)))
  c.examined += 1 + res[0].fm.length
  c.notes.push(`whole game from S0, mid world: optimum ${res[0].V0.toFixed(2)}h interpolated vs ${res[1].V0.toFixed(2)}h direct (${dV >= 0 ? '+' : ''}${dV.toFixed(2)}h); worst first-move total ${dFirst.toFixed(2)}h; best first move ${res[0].fm[0].n === res[1].fm[0].n ? 'the same' : 'DIFFERS'} (BN${res[0].fm[0].n})`)
  if (Math.abs(dV) > 0.5) c.fails.push(`interpolated whole-game optimum off by ${dV.toFixed(2)}h (> 0.5h, larger than the first-move gaps it decides)`)
  if (res[0].fm[0].n !== res[1].fm[0].n) c.fails.push(`the interpolated surrogate picks BN${res[0].fm[0].n} first, the direct sims BN${res[1].fm[0].n}`)
}

// ---------------------------------------------------------------- GP3
{
  const c = out.gp3
  // PHASE-1 MODE (worldOf phase1, hackHours speed1): the IPvGO model, the
  // Bladeburner opening's gym scale and BN14's HackingSpeedMultiplier are
  // phase-2 changes MEANT to move these numbers, so the regression runs the
  // phase-1 pricing they reproduce; the phase-2 terms are checked by GP4.
  // /tmp/nextnode-bn6.out (nextnode.mjs at 919b8ca, run 2026-10-02): printed to 0.1h.
  const HACK_NOW = { 2: 21.7, 3: 49.9, 4: 34.6, 5: 32.0, 6: 47.2, 7: 69.3, 8: 54.6, 9: 56.2, 10: 82.1, 11: 43.3, 12: 22.1, 13: 58.9, 14: 67.4 }
  const BB_LEG = { // SF6.1/7.0, SF6.3/7.0, SF6.1/7.3, SF6.3/7.3 medians
    2: [27.4, 27.5, 24.5, 25.6], 6: [27.3, 27.4, 24.3, 24.5], 7: [77.2, 77.2, 72.2, 66.1], 9: [54.0, 60.8, 52.7, 48.4], 10: [55.6, 54.9, 53.7, 45.7],
    11: [27.3, 27.4, 24.3, 24.5], 12: [29.3, 29.5, 25.5, 23.5], 13: [125.6, 105.9, 115.2, 103.8], 14: [127.2, 115.0, 115.4, 97.5], 4: [27.4, 27.4, 25.3, 24.3],
  }
  const RANKED = {
    cal: { 6: 1060.1, 11: 1060.4, 7: 1061.7, 4: 1064.5, 9: 1065.6, 12: 1066.2, 3: 1066.6, 2: 1068.3, 8: 1068.6, 14: 1070.5, 10: 1072.0, 5: 1073.2, 13: 1076.1 },
    off: { 11: 1258.4, 9: 1260.5, 5: 1260.6, 8: 1261.6, 4: 1261.8, 14: 1264.1, 2: 1264.8, 12: 1265.2, 10: 1267.2, 6: 1267.4, 3: 1267.9, 7: 1269.2, 13: 1272.5 },
  }
  const TOL = 0.15
  const nodes = Object.keys(HACK_NOW).map(Number)
  const lv = (n) => lvl(S0, n)
  // (a) the hacking route's own hours from S0, mid world, before early-game savings
  const mid = worldOf(econ, {}, { sigmaPlayed: 0, phase1: true })
  let worstA = 0
  for (const n of nodes) {
    const { gFactorOf, hackSfOf, sfKeyStr } = await import('./effects.mjs')
    const h = Sd.hackHours(n, 1, sfKeyStr(hackSfOf(lv)), mid.g(n) * gFactorOf(lv, mid.sf, { node: n, mults: Sd.mults(n), phase1: true }), { speed1: true })
    worstA = Math.max(worstA, Math.abs(h - HACK_NOW[n]))
    c.examined++
    if (Math.abs(h - HACK_NOW[n]) > 0.051 + 1e-9) c.fails.push(`hacking hours BN${n} from S0: ${h.toFixed(2)}h vs nextnode ${HACK_NOW[n]}h`)
  }
  c.notes.push(`(a) hacking exit hours from S0 (mid g, mid SF effects), 13 nodes: worst |this - nextnode| ${worstA.toFixed(3)}h (printed to 0.1h)`)
  // (b) the Bladeburner legs
  let worstB = 0
  const bbDiff = []
  for (const [n, row] of Object.entries(BB_LEG)) {
    const cells = [[1, 0], [3, 0], [1, 3], [3, 3]].map(([a, b]) => Sd.bbLeg(Number(n), a, b)?.median)
    cells.forEach((m, i) => {
      c.examined++
      const d = Math.abs(m - row[i])
      worstB = Math.max(worstB, d)
      if (d > 0.051) bbDiff.push(`BN${n}[${i}] ${m?.toFixed(2)} vs ${row[i]}`)
    })
  }
  c.notes.push(`(b) Bladeburner leg medians, 10 nodes x 4 (SF6,SF7) cells: worst |this - nextnode| ${worstB.toFixed(2)}h${bbDiff.length ? ` — ${bbDiff.length} differ: ${bbDiff.slice(0, 6).join('; ')}` : ''}`)
  if (bbDiff.length) c.fails.push(`${bbDiff.length} Bladeburner leg medians differ from nextnode's by > 0.05h (the sims are seeded: same code, same numbers)`)
  // (c) the whole-game totals per first move, nextnode's local search on this planner's table (direct sims)
  const L = lattice(S0)
  for (const bb of ['cal', 'off']) {
    const w0 = worldOf(econ, cellZ({ bb, sc: 'mid', sa: 'mid' }, nodes, econ), { sigmaPlayed: 0, bbOff: bb === 'off', phase1: true })
    // nextnode at 919b8ca priced its cal cell at k 0.916 (bbcal6's as-run
    // ratio); the base is 1.223 since 2026-10-03 (params.BB_PARAMS: one
    // definition). The regression reproduces the printed run, so it prices
    // that run's k; the clear formula and the tables are what it checks.
    const w = bb === 'cal' ? { ...w0, k: 0.916 } : w0
    const T = buildTable(L, (n, lvf) => clearTime(n, lvf, w, Sd).h, (n) => !isInert(n))
    const V = solveDP(L, T)
    const fm = firstMoves(L, T, V)
    let worst = 0
    let below = 0
    const rows = []
    for (const x of fm) {
      const ls = localSearch(L, T, x.n)
      const want = RANKED[bb][x.n]
      c.examined++
      worst = Math.max(worst, Math.abs(ls.T - want))
      if (Math.abs(ls.T - want) > TOL) c.fails.push(`${bb}/mid/mid first BN${x.n}: local search on this table ${ls.T.toFixed(2)}h vs nextnode ${want}h`)
      if (x.T > ls.T + 1e-6) below++
      rows.push(`BN${x.n} ${ls.T.toFixed(1)}/${want}/${x.T.toFixed(1)}`)
    }
    if (below) c.fails.push(`${bb}: the DP is above the local search for ${below} first move(s) — the DP is not exact`)
    const bestLS = Math.min(...Object.values(RANKED[bb]))
    c.notes.push(`(c) ${bb}/mid/mid: local search vs nextnode, 13 first moves: worst |diff| ${worst.toFixed(2)}h (tol ${TOL}h); exact DP optimum ${V[0].toFixed(1)}h vs nextnode's best ${bestLS}h (DP <= LS for all: ${below ? 'NO' : 'yes'})`)
    if (VERBOSE) c.notes.push('    first LS/nextnode/DP: ' + rows.join('  '))
  }
}
// ---------------------------------------------------------------- GP4 (the simulation half)
{
  const c = out.gp4
  const { hackExitHours } = await import('../nodechoice/hackexit.mjs')
  const { exitShift } = await import('./go.mjs')
  const sf = [[1, 3], [5, 1], [8, 1]]
  // (a) the w0r1d_d43m0n exit divisor: H(g, E/W) ~= H(g, E) - ln(W)/g, against the simulation run at E/W
  // Tolerance: the simulation's hours move in whole install cycles (the policy
  // is an integer count), the shift is smooth, so a point may be off by up to
  // one cycle; what would bias the plan is a SYSTEMATIC error: the mean signed
  // error must stay under 0.3h.
  let worst = { e: 0 }
  const signed = []
  const cyc = econ.profile.cycleHours
  for (const node of [1, 11, 13, 14])
    for (const gg of [0.03, 0.045, 0.06, 0.09, 0.12])
      for (const W of [1.1, 1.2, 1.5, 2]) {
        const h = hackExitHours({ node, sf, profile: econ.profile, g: gg }).hours
        const d = hackExitHours({ node, sf, profile: econ.profile, g: gg, exitDiv: W }).hours
        const a = exitShift(h, gg, W)
        const e = Math.abs(a - d)
        signed.push(a - d)
        c.examined++
        if (e > worst.e) worst = { e, node, gg, W, a, d }
        if (e > cyc + 0.2) c.fails.push(`exitShift BN${node} g ${gg} W ${W}: ${a.toFixed(2)}h vs the sim at exit/W ${d.toFixed(2)}h (more than one install cycle)`)
      }
  const bias = signed.reduce((x, y) => x + y, 0) / signed.length
  if (Math.abs(bias) > 0.3) c.fails.push(`exitShift is biased: mean signed error ${bias.toFixed(2)}h over ${signed.length} points`)
  c.notes.push(`(a) the exit-level divisor W (w0r1d_d43m0n) as a shift ln(W)/g, vs exitplan run at exitLevel/W: BN1/11/13/14 x 5 g x W 1.1-2, mean signed error ${bias >= 0 ? '+' : ''}${bias.toFixed(2)}h (tol 0.3h), worst ${worst.e.toFixed(2)}h (BN${worst.node} g ${worst.gg} W ${worst.W}: ${worst.a.toFixed(2)} vs ${worst.d.toFixed(2)}h; tol one cycle ${cyc.toFixed(2)}h + 0.2h)`)
  // (b) BN14's HackingSpeedMultiplier reaches the simulation (and nothing else moves: GP3's CHECKs are the measured nodes)
  const g14 = 0.06
  const h03 = hackExitHours({ node: 14, sf, profile: econ.profile, g: g14 }).hours
  const h1 = hackExitHours({ node: 14, sf, profile: econ.profile, g: g14, speedMult: 1 }).hours
  const h1b = hackExitHours({ node: 1, sf, profile: econ.profile, g: g14 }).hours
  const h1c = hackExitHours({ node: 1, sf, profile: econ.profile, g: g14, speedMult: 1 }).hours
  c.examined += 2
  if (!(h03 > h1)) c.fails.push(`BN14 at HackingSpeed 0.3 (${h03}h) is not slower than at 1 (${h1}h)`)
  if (h1b !== h1c) c.fails.push(`BN1's hours moved with the speed term (${h1b} vs ${h1c}) — its multiplier is 1`)
  c.notes.push(`(b) BN14 at g ${g14}: ${h03.toFixed(2)}h with HackingSpeedMultiplier 0.3 vs ${h1.toFixed(2)}h at 1 (phase 1); BN1 unchanged ${h1b.toFixed(2)}h`)
  // (c) the Bladeburner opening's gym scale: bbsim's time to combat 100, BN14 (x0.5 combat levels) vs BN6
  const j6 = Si.bbJoin(6, 1, 0)
  const j14 = Si.bbJoin(14, 1, 0)
  c.examined++
  if (!(j14 > j6)) c.fails.push(`bbsim's gym to combat 100 is not longer in BN14 (${j14}h) than BN6 (${j6}h)`)
  c.notes.push(`(c) gym to combat 100 (bbsim joinH, SF6.1): BN6 ${j6?.toFixed(2)}h, BN14 ${j14?.toFixed(2)}h -> BN14's opening +${(j14 - j6).toFixed(2)}h over the measured 2.5h`)
  // (d) REGRESSION: the w0r1d_d43m0n window. w0 = 0 prices every clear exactly as the old
  // fixed 1h window did (W = 1 in both), and a fixed 1h window reproduces the old W =
  // effect(w0 x 1h) — so the old numbers are this model at (w0 0) or (window 1h).
  const { hackParts } = await import('./routes.mjs')
  const { w0rldDiv, goScale } = await import('./go.mjs')
  const lv0 = (n) => lvl(S0, n)
  const nodes = lattice(S0).dims.map((d) => d.n)
  let nd = 0
  let worstW = 0
  const rowsD = []
  for (const w0 of [0, 200, 1500]) {
    const wc = worldOf(econ, {}, { sigmaPlayed: 0 })
    const wf = worldOf(econ, {}, { sigmaPlayed: 0, w0Window: 1 })
    wc.sf.w0 = w0
    wf.sf.w0 = w0
    for (const n of nodes) {
      const a = hackParts({ node: n, lv: lv0, world: wc, S: Si })
      const b = hackParts({ node: n, lv: lv0, world: wf, S: Si })
      if (!a || !b) continue
      c.examined++
      if (w0 === 0 && (a.h !== b.h || a.W !== 1 || b.W !== 1)) c.fails.push(`w0 = 0: BN${n} prices ${a.h}h with the climb window vs ${b.h}h with the fixed 1h (W ${a.W}/${b.W}) — must be identical`)
      const want = w0rldDiv(goScale(Si.mults(n).GoPower, lv0(14)), w0, 1)
      worstW = Math.max(worstW, Math.abs(b.W - want))
      if (Math.abs(b.W - want) > 1e-12) c.fails.push(`fixed 1h window, w0 ${w0}: BN${n} W ${b.W} vs the old effect(w0 x 1h) ${want}`)
      if (w0 > 0 && !(a.win.hours <= a.win.L0 + 1e-12)) c.fails.push(`BN${n} w0 ${w0}: the window ${a.win.hours}h exceeds the climb ${a.win.L0}h`)
      if (w0 === 1500 && nd < 8) {
        nd++
        rowsD.push(`    BN${n} w0 1500: climb ${a.win.L0.toFixed(2)}h -> window ${a.win.hours.toFixed(2)}h, W x${a.W.toFixed(3)} (fixed 1h: x${b.W.toFixed(3)}); hours ${a.h.toFixed(1)} vs ${b.h.toFixed(1)}`)
      }
    }
  }
  c.notes.push(`(d) regression: w0 = 0 prices BN${nodes.join('/')} identically with the climb window and the old fixed 1h; the fixed 1h reproduces the old W = effect(w0 x 1h) at w0 200/1500 (worst |dW| ${worstW.toExponential(1)})`)
  c.notes.push(...rowsD)
}
done()
