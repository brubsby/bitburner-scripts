// tools/sim/gameplan — the whole-game BitNode order planner.
//
//   GP1 THE SEARCH IS EXACT: on small synthetic lattices, the DP's optimum equals
//       brute force over every order; its path sums to V(start); the best first
//       move's T equals V(start); nextnode's local search is never below it.
//   GP2 THE SURROGATE INTERPOLATES: hacking hours interpolated in ln g against the
//       simulation called directly at off-grid points; max and median error printed.
//   GP3 NEXTNODE REPRODUCED where the models coincide: in nextnode's cal/mid/mid
//       and off/mid/mid cells, the first-move totals of nextnode's own local search
//       (ported onto this planner's clear-time table, direct sims) match
//       /tmp/nextnode-bn6.out (919b8ca) to 0.15h, and the exact DP is <= each.
//       Run in PHASE-1 MODE (no IPvGO model, no gym scale on the opening,
//       HackingSpeedMultiplier at 1): phase 2 moves those numbers on purpose.
//   GP5 THE POSTERIOR LEARNS (posterior.mjs, observe.mjs; pure, no game): the
//       z-grid update equals the conjugate normal answer and recovers a known
//       value from synthetic readings; the hierarchical g update equals the
//       closed-form normal-normal posterior of mu, recovers a known mu, and an
//       observed unplayed node pulls every unplayed node (by exactly
//       vMu/(vMu+tau^2+sd^2) of the surprise) while base-measured nodes stay put;
//       re-observing is a no-op (keys); an empty log is the hand prior bit for bit.
//   GP4 THE IPvGO MODEL IS THE GAME'S: go.mjs's transcriptions against the game
//       source functions (CalculateEffect at GoPower 4 and the SF14 doubling,
//       getMaxRep per SF14 level, the favor award played through endGoGame and
//       its cap, favor <-> rep, BN14's multipliers), the favor life's ordering
//       in SF14, the w0r1d_d43m0n exit shift against exitplan at exitLevel/W,
//       BN14's HackingSpeedMultiplier in the simulation, the gym scale; the
//       hidden opponent's payout played through endGoGame on the bitverse
//       board; the w0 window's regression (w0 = 0 or a fixed 1h = the old model).
//   GP8 THE w0 PRIOR IS DERIVED AND THE WINDOW CONVERGES (pure): the payout's
//       hand cases, its stationary expectation vs a simulated chain, the
//       Monte Carlo reproducing effects.SF_PARAMS.w0 and goplan.W0_PRIOR, a
//       reading moving it, the window's fixed point (bisection = damped map).
//
// CALIBRATION: GP1 is a property of the optimiser (no game quantity). GP2 is a
// numerical check of the surrogate against the simulation it tabulates. GP3 is a
// regression against an earlier model's printed output, NOT a calibration: the
// models' own calibration state is stated in tools/sim/gameplan/*.mjs headers
// (NOT CALIBRATED on unplayed nodes and every ASSUMED SF effect).
//
// GP2/GP3 need the nodechoice game bundle, the live telemetry and the
// Bladeburner sim cache (all gitignored, local only). When one is missing they
// WARN with the reason — "could not check" is never reported as PASS. They run
// in a child process (2GB heap cap) so the suite's process does not hold the
// game bundle.

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Check } from './harness.mjs'
import { makeState, lattice } from '../sim/gameplan/state.mjs'
import { buildTable, solveDP, bestPath, firstMoves, bruteForce, localSearch, evalOrder } from '../sim/gameplan/search.mjs'
import { rng, normal, worldOf } from '../sim/gameplan/params.mjs'
import { scalarPosterior, valueAt, gBase, gUpdate, gSummary, posteriorOf, emptyStore, mergeObs, summarise, scalarSpecs, normaliseObs, loadStore, POSTERIOR_FILE } from '../sim/gameplan/posterior.mjs'
import { obsRecord } from '../../gameplan-obs.js'
import { w0Obs, rateEstimate, W0_PRIOR } from '../../goplan.js'
import { goGameStep, w0PerGame, w0PriorMC, goWindow, goWindowIterate, W0_DIFFICULTY, W0_PRIOR_INPUTS, W0_GAME_H } from '../sim/gameplan/go.mjs'
import { SF_PARAMS } from '../sim/gameplan/effects.mjs'
import os from 'node:os'
import { readingsFromSegments, CLEAR_LEGS, GO_COMBAT_SINCE, baseIn, OBS_SINCE, HACK_LEVEL } from '../sim/gameplan/observe.mjs'
import { nodeSegments, TELEMETRY } from '../sim/nodechoice/measure.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GP = path.join(HERE, '../sim/gameplan')

function gp1() {
  const c = new Check('GP1', 'the order search is exact: DP == brute force on synthetic lattices; local search never beats it')
  let worst = 0
  let lsGap = 0
  for (let inst = 0; inst < 12; inst++) {
    const r = rng(1000 + inst)
    // a start with a handful of clears owed across 4-5 nodes (levels near target)
    // (6-9 clears owed: brute force over every distinct order stays < 1s)
    const pairs = [[1, 3], [2, 1 + Math.floor(r() * 2)], [5, 1 + Math.floor(r() * 2)], [6, 2], [9, 2], [11, 1 + Math.floor(r() * 2)], [12, 0]]
    for (const n of [3, 4, 7, 8, 10, 13, 14]) pairs.push([n, 3])
    const start = makeState(pairs)
    const L = lattice(start)
    // a random clear time that depends on every live level, interacting
    const base = new Map(L.dims.map((d) => [d.n, 10 + 50 * r()]))
    const eff = new Map(L.dims.map((d) => [d.n, new Map(L.dims.map((e) => [e.n, 0.25 * r()]))]))
    const inert = new Set(inst % 2 ? [2] : [])
    const clearFn = (n, lv) => {
      let h = base.get(n)
      for (const d of L.dims) if (!inert.has(d.n)) h *= 1 - eff.get(n).get(d.n) * (lv(d.n) - d.lo) / 3
      return h + (inst % 3 === 0 ? 3 * Math.sin(n * lv(n) + lv(5)) : 0)
    }
    const T = buildTable(L, clearFn, (n) => !inert.has(n))
    const V = solveDP(L, T)
    const bf = bruteForce(L, T)
    const path0 = bestPath(L, T, V)
    const sumPath = path0.reduce((a, s) => a + s.h, 0)
    const fm = firstMoves(L, T, V)
    const bestFirst = Math.min(...fm.map((x) => x.T))
    const evPath = evalOrder(L, T, path0.map((s) => s.n)).T
    c.examined(1)
    const err = Math.max(Math.abs(V[0] - bf.T), Math.abs(sumPath - V[0]), Math.abs(bestFirst - V[0]), Math.abs(evPath - V[0]))
    worst = Math.max(worst, err)
    for (const x of fm) {
      const ls = localSearch(L, T, x.n)
      if (ls.T < x.T - 1e-9) c.fail(`instance ${inst}: local search first=BN${x.n} T ${ls.T} below the DP's ${x.T}`)
      lsGap = Math.max(lsGap, ls.T - x.T)
    }
    if (err > 1e-9) c.fail(`instance ${inst}: DP ${V[0].toFixed(4)} vs brute force ${bf.T.toFixed(4)} (path ${sumPath.toFixed(4)}, best first ${bestFirst.toFixed(4)})`, `${L.size} states, ${path0.length} clears`)
    else if (inst < 3) c.note(`instance ${inst}: ${L.size} states, ${path0.length} clears owed, DP = brute force = ${V[0].toFixed(3)}h`)
  }
  c.note(`max |DP - brute force| over 12 instances: ${worst.toExponential(1)}; local search's worst excess over the exact optimum ${lsGap.toFixed(3)}h`)
  return c
}

function child() {
  const c2 = new Check('GP2', 'the surrogate: hacking hours interpolated in ln g vs the simulation called directly (off-grid points)')
  const c3 = new Check('GP3', "nextnode.mjs reproduced where the models coincide (cal/mid/mid, off/mid/mid, phase-1 mode), and the DP <= its local search")
  const c4 = new Check('GP4', "the IPvGO model (go.mjs) against the game's own Go, favor and multiplier functions, and its exit shift against the simulation")
  // the game-source half: the tools/sim bundle, in its own child (not the nodechoice bundle's process)
  {
    const r = spawnSync(process.execPath, ['--max-old-space-size=2048', path.join(GP, 'gotest.mjs')], { encoding: 'utf8', timeout: 600e3 })
    let res
    try {
      res = JSON.parse(r.stdout.trim().split('\n').pop())
    } catch {
      res = { skip: 'gotest.mjs produced no result: ' + ((r.stderr || '').slice(-600) || `exit ${r.status}`) }
    }
    if (res.skip) c4.warn('could not check (game source): ' + res.skip)
    else {
      c4.examined(res.examined)
      for (const n of res.notes) c4.note(n)
      for (const f of res.fails) c4.fail(f)
    }
  }
  const need = [path.join(GP, '../nodechoice/game.bundle.mjs'), path.join(GP, '.cache/bb.json')]
  const missing = need.filter((f) => !fs.existsSync(f))
  if (missing.length) {
    for (const c of [c2, c3, c4]) c.warn('could not check: missing ' + missing.map((f) => path.relative(path.join(HERE, '../..'), f)).join(', '), 'build with: node tools/sim/gameplan/plan.mjs --build-only')
    return [c2, c3, c4]
  }
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', path.join(GP, 'selftest.mjs')], { encoding: 'utf8', timeout: 600e3 })
  let out
  try {
    out = JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    for (const c of [c2, c3, c4]) c.warn('could not check: selftest.mjs produced no result', (r.stderr || '').slice(-800) || `exit ${r.status}`)
    return [c2, c3, c4]
  }
  for (const [c, res] of [[c2, out.gp2], [c3, out.gp3], [c4, out.gp4]]) {
    if (res.skip) {
      c.warn('could not check: ' + res.skip)
      continue
    }
    c.examined(res.examined)
    for (const n of res.notes) c.note(n)
    for (const f of res.fails) c.fail(f)
  }
  return [c2, c3, c4]
}

function gp5() {
  const c = new Check('GP5', 'the posterior: conjugate-exact scalar and hierarchical updates, recovery of known parameters, the hierarchical pull, idempotent observation, hand prior reproduced on an empty log')
  const close = (a, b, tol, what) => {
    c.examined(1)
    if (!(Math.abs(a - b) <= tol)) c.fail(`${what}: ${a} vs ${b} (tol ${tol})`)
  }
  // (1) scalar, conjugate: prior N(0,1) (lo/mid/hi = -1.2816/0/1.2816 is the identity), readings y_i ~ N(theta, s^2) in lin space
  {
    const spec = { lo: -1.2816, mid: 0, hi: 1.2816 }
    const obs = [0.9, 1.4, 0.6].map((value) => ({ value, sd: 0.5, space: 'lin' }))
    const post = scalarPosterior(spec, obs)
    const prec = 1 + obs.length / 0.25
    const mean = obs.reduce((a, o) => a + o.value / 0.25, 0) / prec
    const sd = Math.sqrt(1 / prec)
    for (const z of [-1.2816, 0, 1.2816]) close(valueAt(spec, post.map(z)), mean + z * sd, 2e-3, `conjugate normal: posterior quantile at z ${z}`)
    c.note(`scalar conjugate check: posterior N(${mean.toFixed(4)}, ${sd.toFixed(4)}^2) reproduced at p10/p50/p90 to 2e-3`)
  }
  // (2) scalar recovery: a k-like split-normal prior, 60 log-normal readings of a true 1.05 (sd 0.1)
  {
    const spec = { lo: 0.8, mid: 0.916, hi: 1.15, min: 0.3 }
    const r = rng(77)
    const truth = 1.05
    const obs = Array.from({ length: 60 }, () => ({ value: truth * Math.exp(0.1 * normal(r)), sd: 0.1, space: 'log' }))
    const post = scalarPosterior(spec, obs)
    const [p10, p50, p90] = [-1.2816, 0, 1.2816].map((z) => valueAt(spec, post.map(z)))
    c.examined(1)
    if (!(p10 < truth && truth < p90) || Math.abs(p50 / truth - 1) > 0.03) c.fail(`scalar recovery: truth ${truth} vs posterior ${p10.toFixed(3)}/${p50.toFixed(3)}/${p90.toFixed(3)}`)
    if (!(p90 - p10 < 0.06)) c.fail(`scalar recovery: 60 readings at sd 0.1 left the p10-p90 width at ${(p90 - p10).toFixed(3)}`)
    c.note(`scalar recovery: truth ${truth}, 60 readings -> p10/p50/p90 ${p10.toFixed(3)}/${p50.toFixed(3)}/${p90.toFixed(3)} (prior 0.800/0.916/1.150)`)
    // a clipped prior (w0-like: mass at 0) read at 0 in lin space: finite, and the median goes to the clip
    const w = { lo: 0, mid: 200, hi: 1000, min: 0 }
    const pw = scalarPosterior(w, [{ value: 0, sd: 20, space: 'lin' }])
    close(valueAt(w, pw.map(0)), 0, 1e-9, 'w0 read at 0 (lin): posterior median at the clip')
  }
  // a synthetic economy: 14 nodes, AMC 2 on four of them, BN1 and BN9 measured in the base
  const econ = (own) => ({
    gScen: { lo: 0.04, mid: 0.065, hi: 0.13 },
    gamma: 0.6,
    amc: Object.fromEntries([...Array(14)].map((_, i) => [i + 1, [3, 5, 11, 13].includes(i + 1) ? 2 : 1])),
    ownG: new Map(own),
    profile: { cycleHours: 2 },
    runs: [],
  })
  // (3) hierarchical: closed form, the pull, recovery
  {
    const e = econ([[1, 0.05], [9, 0.05]])
    const G = gBase(e)
    const vMu = G.P[0][0]
    const tau2 = G.tau2
    const m0 = G.m[0]
    const sd = 0.15
    // closed form for mu after k unplayed nodes each read once: precision 1/vMu + k/(tau2 + sd^2)
    const reads = [[3, Math.log(0.09)], [6, Math.log(0.11)], [12, Math.log(0.08)]]
    const G2 = gBase(e)
    for (const [n, y] of reads) gUpdate(G2, n, y + e.gamma * Math.log(e.amc[n]), sd * sd)
    const w = 1 / (tau2 + sd * sd)
    const precMu = 1 / vMu + reads.length * w
    const muCF = (m0 / vMu + reads.reduce((a, [n, y]) => a + w * (y + e.gamma * Math.log(e.amc[n])), 0)) / precMu
    close(G2.m[0], muCF, 1e-9, 'hierarchical: mu posterior mean vs the closed form')
    close(G2.P[0][0], 1 / precMu, 1e-12, 'hierarchical: mu posterior variance vs the closed form')
    // the pull: one unplayed node read 0.5 high moves every other unplayed node by vMu/(vMu+tau2+sd^2) x 0.5
    const G3 = gBase(e)
    gUpdate(G3, 6, m0 + 0.5, sd * sd)
    const shift = (vMu / (vMu + tau2 + sd * sd)) * 0.5
    for (const n of [2, 7, 14]) close(G3.m[n] - m0, shift, 1e-9, `hierarchical pull on unplayed BN${n}`)
    close(G3.m[1], G.m[1], 0, 'a base-measured node is not moved by another node')
    close(G3.m[9], G.m[9], 0, 'a base-measured node is not moved by another node')
    const sum3 = gSummary(G3)
    c.examined(1)
    if (!(sum3.rho < 0.5 && sum3.gScale < 1)) c.fail(`one reading must shrink the common share and the spread: rho ${sum3.rho}, scale ${sum3.gScale}`)
    c.note(`hierarchical pull: BN6 read +0.50 in ln g -> mu and every other unplayed node +${shift.toFixed(3)}, BN6 itself +${(G3.m[6] - m0).toFixed(3)}; common share 0.5 -> ${sum3.rho.toFixed(3)}, spread x${sum3.gScale.toFixed(3)}`)
    // recovery of a known population: 12 unplayed nodes drawn around mu* = ln 0.1 (prior centre ln 0.065)
    const r = rng(5)
    const muT = Math.log(0.1)
    const G4 = gBase(econ([]))
    for (let n = 1; n <= 12; n++) {
      const x = muT + Math.sqrt(G4.tau2) * normal(r)
      for (let k = 0; k < 3; k++) gUpdate(G4, n, x + sd * normal(r), sd * sd)
    }
    const z = (G4.m[0] - muT) / Math.sqrt(G4.P[0][0])
    c.examined(1)
    if (Math.abs(z) > 2.5) c.fail(`hierarchical recovery: mu ${G4.m[0].toFixed(3)} vs truth ${muT.toFixed(3)} (${z.toFixed(1)} sd)`)
    c.note(`hierarchical recovery: 12 nodes x 3 readings -> population g ${Math.exp(G4.m[0]).toFixed(4)} (truth 0.1000, ${z.toFixed(2)} posterior sd off; prior centre 0.0650)`)
  }
  // (4) the store: an empty log is the hand prior bit for bit; observation is idempotent
  {
    const e = econ([[1, 0.05], [9, 0.05]])
    const p0 = posteriorOf(emptyStore(), e)
    const zs = { g3: 0.7, g6: -1.1, k: 0.4, open: -0.3, w0: 1.5, eps14: -2, z9: 0.9 }
    const a = worldOf(e, zs)
    const b = worldOf(p0.applied, zs)
    for (const n of [1, 3, 6, 9, 14]) close(b.g(n), a.g(n), 0, `empty log: g(${n}) equals the hand prior`)
    close(b.k, a.k, 0, 'empty log: k')
    close(b.open, a.open, 0, 'empty log: open')
    for (const k of ['w0', 'eps14', 'z9']) close(b.sf[k], a.sf[k], 0, `empty log: ${k}`)
    // readings from synthetic segments: a base hacking clear, a new one, a Bladeburner clear, a Bladeburner node in progress
    const segs = [
      { bitNode: 1, startedAt: '2026-09-27T20:50:00Z', endedAt: '2026-09-28T18:38:00Z', hours: 21.8, sfOnEntry: [[1, 2]], maxLevel: 7000, bbJoinH: null, combat100H: 0.4 },
      { bitNode: 11, startedAt: '2026-10-05T00:00:00Z', endedAt: '2026-10-07T00:00:00Z', hours: 40, sfOnEntry: [[1, 3]], maxLevel: 6000, bbJoinH: null, combat100H: 1 },
      { bitNode: 7, startedAt: '2026-10-07T00:00:10Z', endedAt: '2026-10-08T12:00:00Z', hours: 30, sfOnEntry: [[6, 1]], maxLevel: 300, bbJoinH: 4, combat100H: 3 },
      { bitNode: 3, startedAt: '2026-10-08T12:00:30Z', endedAt: '2026-10-08T15:00:00Z', hours: 3, sfOnEntry: [[6, 1]], maxLevel: 200, bbJoinH: 2.5, combat100H: 2.2 },
    ]
    const fns = { gOf: (bn, sf, T) => 2 / T, bbLeg: () => 25, gymDiff: (bn) => (bn === 7 ? 0.5 : 0), earlyOf: () => 0, base: [{ param: 'g', bn: 1, start: '2026-09-27T20:50' }], clearLegs: { 'BN7.1': { go: null } } }
    const R = readingsFromSegments(segs, fns)
    const ids = R.map((o) => `${o.param}:${o.clear}${o.inBase ? '(base)' : ''}`).join(' ')
    const want = 'g1:BN1.3(base) g11:BN11.1 open:BN7.1 k:BN7.1 open:BN3.1'
    c.examined(1)
    if (ids !== want) c.fail(`readings from segments: ${ids}`, `expected ${want}`)
    close(R.find((o) => o.param === 'k')?.value, (30 - 3) / 25, 1e-12, 'k reading = (hours - opening) / leg')
    close(R.find((o) => o.param === 'open' && o.node === 7)?.value, 2.5, 1e-12, 'open reading = combat 100 - gym scale')
    const st = emptyStore()
    const m1 = mergeObs(st, R)
    const s1 = JSON.stringify(summarise(posteriorOf(st, e), e))
    const m2 = mergeObs(st, readingsFromSegments(segs, fns))
    const s2 = JSON.stringify(summarise(posteriorOf(st, e), e))
    c.examined(1)
    if (m1.added !== R.length || m2.added !== 0 || m2.dup !== R.length || s1 !== s2) c.fail(`idempotency: first merge +${m1.added}, second +${m2.added} (dup ${m2.dup}); posterior ${s1 === s2 ? 'unchanged' : 'CHANGED'}`)
    const p1 = posteriorOf(st, e)
    c.examined(1)
    if (p1.nObs !== R.length - 1) c.fail(`the in-base reading must not be applied: ${p1.nObs} applied of ${R.length}`)
    if (!(p1.applied.ownG.has(11) && p1.applied.ownG.get(1) === 0.05)) c.fail('BN11 must become an own-g node, BN1 (in base) must keep its measured g')
    c.note(`idempotency: ${R.length} readings from 4 synthetic segments (${ids}); re-observing added ${m2.added}, the posterior unchanged; the in-base BN1 reading logged, not applied`)
  }
  // (5) the channel: gameplan-obs.js (the game's writer) and normaliseObs (the reader) agree on the schema;
  //     the committed posterior.json loads, its keys are unique and every logged reading still validates
  {
    const specs = scalarSpecs()
    for (const param of [...Object.keys(specs), 'g11']) {
      const rec = obsRecord({ param, value: 1.5, sd: 0.2, source: 'test', node: 4 }, '2026-10-03T00:00:00Z')
      const [o, why] = normaliseObs(JSON.parse(JSON.stringify(rec)), specs)
      c.examined(1)
      if (!o) c.fail(`gameplan-obs.js writes a ${param} reading observe rejects: ${why}`)
    }
    let threw = 0
    for (const bad of [{ param: 'nope', value: 1, sd: 1, source: 's' }, { param: 'k', value: 0, sd: 0.1, source: 's' }, { param: 'k', value: 1, sd: 0, source: 's' }]) {
      try {
        obsRecord(bad)
      } catch {
        threw++
      }
    }
    c.examined(1)
    if (threw !== 3) c.fail(`gameplan-obs.js accepted ${3 - threw} malformed readings`)
    const ok = obsRecord({ param: 'w0', value: 0, sd: 0, source: 's' })
    c.examined(1)
    if (!normaliseObs(ok, specs)[0]) c.fail('a w0 reading of 0 (lin by default, sd 0 floored) must be accepted')
    // go.js's own writer (goplan.w0Obs): cumulative re-estimates every 20 games -> one stream, only the latest applied
    const games = (n, power) => Array.from({ length: n }, (_, i) => ({ power: power * (1 + 0.3 * Math.sin(i)), hours: 0.25, won: i % 3 === 0 }))
    const o20 = w0Obs(rateEstimate(games(20, 30)), '2026-10-04T10:00:00Z')
    const o40 = w0Obs(rateEstimate(games(40, 30)), '2026-10-04T15:00:00Z')
    const zero = w0Obs(rateEstimate(games(20, 0)), '2026-10-05T10:00:00Z', 'go.js node 12')
    const st = emptyStore()
    const mg = mergeObs(st, [o20, o40, zero])
    const e = econ([[1, 0.05]])
    const pg = posteriorOf(st, e)
    const streams = new Set(st.observations.map((o) => o.stream))
    c.examined(1)
    if (mg.added !== 3 || mg.rejected.length) c.fail(`go.js w0 readings: ${mg.added} added, rejected: ${mg.rejected.join('; ')}`)
    if (streams.size !== 2 || pg.nObs !== 2) c.fail(`go.js w0 readings: ${streams.size} streams (want 2: go.js, go.js node 12), ${pg.nObs} applied (want 2: the latest of each)`)
    const w0spec = specs.w0
    const med = valueAt(w0spec, pg.scalar.w0.map(0))
    c.note(`go.js w0 stream: readings ${o20.value}/h (sd ${o20.sd}, n 20) then ${o40.value}/h (n 40) -> one stream, latest applied; with a 0-power stream beside it the w0 median ${med.toFixed(1)}/h (derived prior ${w0spec.mid})`)
    if (!fs.existsSync(POSTERIOR_FILE)) c.fail(`no committed ${path.basename(POSTERIOR_FILE)}`)
    else {
      const st = loadStore()
      const keys = st.observations.map((o) => o.key)
      c.examined(keys.length)
      if (new Set(keys).size !== keys.length) c.fail('posterior.json: duplicate observation keys')
      for (const o of st.observations) if (!normaliseObs(o, specs)[0]) c.fail(`posterior.json: logged reading ${o.key} no longer validates: ${normaliseObs(o, specs)[1]}`)
      c.note(`posterior.json: version ${st.version}, ${keys.length} logged readings (${st.observations.filter((o) => !o.inBase).length} applied), updated ${st.updatedAt}`)
    }
  }
  return c
}

function gp8() {
  const c = new Check('GP8', "the w0 prior is DERIVED (the payout x its inputs reproduces effects.SF_PARAMS.w0 and goplan's W0_PRIOR), a measured w0 still moves it, and the w0r1d_d43m0n window's fixed point converges")
  // (a) the payout transcription on hand cases (the game itself plays the same rules in GP4 (7))
  const HAND = [
    // [streak before, won, black score, power, streak after]
    [0, false, 60, 60 * 2.5 * 0.5, -1],
    [-1, false, 30, 30 * 2.5 * 0.5, -2],
    [-2, true, 150, 150 * 2.5 * 2, 1], // breaks a 2-loss dry streak: 1 + 0.5 x 2
    [-11, true, 140, 140 * 2.5 * 5, 1], // a dry streak past 8 caps at x5
    [1, true, 160, 160 * 2.5 * 1.5, 2],
    [8, true, 200, 200 * 2.5 * 3, 9], // a streak past 8 caps at x3
    [0, true, 139, 139 * 2.5 * 1.25, 1],
  ]
  for (const [s0, won, b, want, s1] of HAND) {
    const r = goGameStep(s0, won, b)
    c.examined(1)
    if (Math.abs(r.power - want) > 1e-9 || r.streak !== s1) c.fail(`goGameStep(${s0}, ${won}, ${b}) = ${r.power}/${r.streak}, want ${want}/${s1}`)
  }
  c.note(`payout hand cases (endGoGame x getWinstreakMultiplier x komi 9.5 -> x${W0_DIFFICULTY}): ${HAND.map(([s0, w, b, p]) => `${b}${w ? 'W' : 'L'}@${s0}=${p}`).join(' ')}`)
  // (b) the stationary expectation against a long simulated chain of the same steps
  const r = rng(77)
  for (const [p, sW, sL] of [[0.05, 150, 40], [0.19, 165, 67], [0.6, 180, 110]]) {
    let st = 0
    let tot = 0
    const N = 400000
    for (let i = 0; i < N; i++) {
      const won = r() < p
      const x = goGameStep(st, won, won ? sW : sL)
      tot += x.power
      st = x.streak
    }
    const model = w0PerGame(p, sW, sL)
    c.examined(1)
    if (Math.abs(tot / N / model - 1) > 0.01) c.fail(`w0PerGame(${p}) ${model.toFixed(2)} vs a simulated chain ${(tot / N).toFixed(2)}`)
    if (p === 0.19) c.note(`stationary power/game at p 0.19, black 165 on a win / 67 on a loss: ${model.toFixed(1)} (a ${N}-game chain ${(tot / N).toFixed(1)})`)
  }
  // (c) the Monte Carlo reproduces the constants that replaced the hand prior
  const mc = w0PriorMC()
  const P = SF_PARAMS.w0
  for (const [k, q] of [['lo', mc.q10], ['mid', mc.q50], ['hi', mc.q90]]) {
    c.examined(1)
    if (Math.abs(P[k] / q - 1) > 0.03) c.fail(`SF_PARAMS.w0.${k} ${P[k]} vs the derivation's ${q.toFixed(0)} (re-derive: go.mjs w0PriorMC)`)
  }
  const mc2 = w0PriorMC({ seed: 99 })
  c.examined(1)
  if (Math.abs(mc2.q50 / mc.q50 - 1) > 0.03) c.fail(`the derivation is seed-dependent: median ${mc.q50.toFixed(0)} vs ${mc2.q50.toFixed(0)}`)
  // goplan.js (the live Go bot) starts the hidden opponent from the same number: P.mid and the
  // win-rate mean are copied into goplan.W0_PRIOR whenever the derivation changes (2026-10-07: the
  // KataGo walls engine, 12550/h at refP 0.951). A drift is a failure.
  const [a, b] = W0_PRIOR_INPUTS.pWin.beta
  c.examined(1)
  if (W0_PRIOR.powerPerHour !== P.mid || Math.abs(W0_PRIOR.refP - a / (a + b)) > 0.005)
    c.fail(`goplan.W0_PRIOR ${W0_PRIOR.powerPerHour}/h at refP ${W0_PRIOR.refP} differs from the gameplan's derived w0 median ${P.mid}/h at refP ${(a / (a + b)).toFixed(3)} — copy both into goplan.W0_PRIOR`)
  c.note(`w0 DERIVED: p10/p50/p90 ${mc.q10.toFixed(0)}/${mc.q50.toFixed(0)}/${mc.q90.toFixed(0)}/h (seed 99: ${mc2.q10.toFixed(0)}/${mc2.q50.toFixed(0)}/${mc2.q90.toFixed(0)}) = SF_PARAMS.w0 ${P.lo}/${P.mid}/${P.hi} = goplan W0_PRIOR ${W0_PRIOR.powerPerHour}/h at refP ${W0_PRIOR.refP}; rank corr ${Object.entries(mc.rank).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}`)
  // (d) a measured w0 still moves it (the gameplan-obs channel, lin space)
  {
    const specs = scalarSpecs()
    const st = emptyStore()
    mergeObs(st, [{ param: 'w0', value: 300, sd: 30, at: '2026-10-06T10:00:00Z', source: 'GP6 synthetic' }])
    const pg = posteriorOf(st, { gScen: { lo: 0.04, mid: 0.065, hi: 0.13 }, gamma: 0.6, amc: Object.fromEntries([...Array(14)].map((_, i) => [i + 1, 1])), ownG: new Map([[1, 0.05]]), profile: { cycleHours: 2 }, runs: [] })
    const med = valueAt(specs.w0, pg.scalar.w0.map(0))
    c.examined(1)
    if (!(Math.abs(med - 300) < 60)) c.fail(`a w0 reading of 300 +- 30 left the median at ${med.toFixed(0)} (prior ${P.mid})`)
    c.note(`a reading of 300 +- 30/h moves the w0 median ${P.mid} -> ${med.toFixed(0)}/h`)
  }
  // (e) the window. Continuous limit (tau 0): the bisection root solves L = T(u0/W(w0 L)) and the
  // damped map converges to it. Per finished game (tau = one game, the default): the first-passage
  // scan converges to that root as tau -> 0, never runs past the climb, does not lengthen as w0
  // grows, and a window shorter than one game banks nothing. w0 = 0 leaves the climb (W = 1).
  let worst = 0
  let worstIt = 0
  let worstTau = 0
  let n = 0
  const rows = []
  for (const L0 of [0.3, 1.2, 3])
    for (const u0 of [150, 400, 900])
      for (const w0 of [100, 1200, 5000])
        for (const s of [1, 2, 4, 8]) {
          const f = goWindow({ L0, u0, w0, s, tau: 0 })
          const it = goWindowIterate({ L0, u0, w0, s })
          c.examined(1)
          n++
          if (!it.converged) c.fail(`the fixed-point map did not converge: L0 ${L0} u0 ${u0} w0 ${w0} s ${s}`)
          worst = Math.max(worst, Math.abs(f.hours - it.hours))
          worstIt = Math.max(worstIt, it.iters)
          if (!(f.hours > 0 && f.hours <= L0 + 1e-12 && f.W > 1)) c.fail(`window out of range: L0 ${L0} -> ${f.hours} W ${f.W}`)
          if (!(goWindow({ L0, u0, w0: w0 * 2, s, tau: 0 }).hours < f.hours)) c.fail(`the continuous window does not shorten with w0 (L0 ${L0} u0 ${u0} w0 ${w0} s ${s})`)
          // per game: tau -> 0 converges on the continuous root
          const fine = goWindow({ L0, u0, w0, s, tau: 1e-5 })
          worstTau = Math.max(worstTau, Math.abs(fine.hours - f.hours))
          const d = goWindow({ L0, u0, w0, s })
          const d2 = goWindow({ L0, u0, w0: w0 * 2, s })
          if (!(d.hours <= L0 + 1e-12 && d2.hours <= d.hours + 1e-12 && d2.W >= 1)) c.fail(`per-game window: L0 ${L0} u0 ${u0} w0 ${w0} s ${s}: ${d.hours}h W ${d.W}, at 2 w0 ${d2.hours}h`)
          if (L0 < W0_GAME_H && (d.hours !== L0 || d.W !== 1)) c.fail(`a climb shorter than one game (${L0}h < ${W0_GAME_H.toFixed(3)}h) must bank nothing: ${d.hours}h W ${d.W}`)
          if (L0 === 1.2 && w0 === 1200 && u0 === 400) rows.push(`s${s}: ${f.hours.toFixed(3)}h x${f.W.toFixed(3)} | per game ${d.hours.toFixed(3)}h x${d.W.toFixed(3)} (${d.games} game${d.games === 1 ? '' : 's'})`)
        }
  if (worst > 1e-6) c.fail(`bisection vs the damped map: worst |diff| ${worst}h`)
  if (worstTau > 1e-3) c.fail(`the per-game window does not converge on the continuous root as tau -> 0: worst |diff| ${worstTau}h at tau 1e-5`)
  const z = goWindow({ L0: 1.2, u0: 400, w0: 0, s: 4 })
  c.examined(1)
  if (z.hours !== 1.2 || z.W !== 1) c.fail(`w0 = 0 must leave the climb and W = 1, got ${z.hours} / ${z.W}`)
  c.note(`window: ${n} cases; continuous root (bisection) = the damped map to ${worst.toExponential(1)}h (map <= ${worstIt} iterations); the per-game first passage -> that root as tau -> 0 (${worstTau.toExponential(1)}h at tau 1e-5h); L0 1.2h, u0 400, w0 1200/h -> ${rows.join(', ')}`)
  return c
}

/**
 * GP9 A k READING IS A MEASUREMENT OF k, NOT OF A MISSING CONDITION (observe.mjs, measure.mjs stalls).
 * BN14.2's first reading (2026-10-06 14:44Z) logged k 0.282 from a 86.78h leg against a 30.14h node:
 * the leg priced no Go farm (the clear had x8 Tetrads) and the 8.9h bb-lite starvation and the 0.7h
 * planner-infeasibility stretch counted as the route's own slowness.
 *   (1) a leg longer than its whole node is WITHHELD, never logged;
 *   (2) a clear entered after GO_COMBAT_SINCE with no CLEAR_LEGS entry is withheld;
 *   (3) measure.mjs finds an idle stretch (no combat level or exp moves) and an off-route one (crime /
 *       faction work) in a synthetic history, and a CLEAR_LEGS voidStalls entry takes exactly their
 *       hours off; a listed void the history does not show withholds the reading;
 *   (4) the committed posterior.json: no k reading's leg exceeds its whole node, and none
 *       is BN14.2's un-voided first reading;
 *   (5) live history (WARN when absent): every Bladeburner clear outside the hand prior with an idle
 *       stall >= 1h has it voided in CLEAR_LEGS (BN14.2's 8.90h stall, un-voided, FAILS here).
 */
async function gp9() {
  const c = new Check('GP9', 'a k reading is k: a leg longer than its node is withheld, a clear with no stated Go farm is withheld, the infrastructure stalls CLEAR_LEGS names are measured and voided')
  const close = (a, b, tol, what) => {
    c.examined(1)
    if (!(Math.abs(a - b) <= tol)) c.fail(`${what}: ${a} vs ${b} (tol ${tol})`)
  }
  const fns = (leg, clearLegs) => ({ gOf: () => 0, bbLeg: () => leg, gymDiff: () => 0, earlyOf: () => 0, clearLegs })
  const seg = { bitNode: 14, startedAt: '2026-10-05T08:32:35Z', endedAt: '2026-10-06T14:41:01Z', hours: 30.14, sfOnEntry: [[14, 1], [6, 1]], maxLevel: 206, bbJoinH: 15.38, combat100H: 4.96, retrainH: [], stalls: [{ kind: 'idle', at: 5.04, h: 8.9 }, { kind: 'offroute', at: 14.71, h: 0.68 }] }
  const segs = [seg, { bitNode: 14, startedAt: '2026-10-06T14:43:45Z', endedAt: '2026-10-06T15:00:00Z', hours: 0.3, sfOnEntry: [[14, 2]], maxLevel: 7, bbJoinH: null, combat100H: null }]
  // (1) the first BN14.2 reading's shape: no farm, nothing voided, leg 86.78h > 30.14h
  {
    const R = readingsFromSegments(segs, fns(86.78, { 'BN14.2': { go: null } }))
    c.examined(1)
    if (R.some((o) => o.param === 'k')) c.fail(`a 86.78h leg against a 30.14h node was logged as k ${R.find((o) => o.param === 'k').value.toFixed(3)}`)
    if (!R.withheld?.some((w) => /BN14\.2 k: the leg 86\.78h is longer than the whole 30\.14h node/.test(w))) c.fail('the 86.78h leg was not withheld with its reason', JSON.stringify(R.withheld))
  }
  // (2) no CLEAR_LEGS entry after the farm's combat channel existed
  {
    const R = readingsFromSegments(segs, fns(20, {}))
    c.examined(1)
    if (R.some((o) => o.param === 'k') || !R.withheld?.some((w) => /CLEAR_LEGS does not state its farm/.test(w))) c.fail('a post-GO_COMBAT_SINCE clear with no CLEAR_LEGS entry was read (its leg priced with no farm)', JSON.stringify(R.withheld))
  }
  // (3a) the voids: the real BN14.2 entry takes both stalls off; without them the reading is the un-voided one
  {
    const leg = 15
    const R = readingsFromSegments(segs, fns(leg, CLEAR_LEGS))
    const k = R.find((o) => o.param === 'k')
    const R0 = readingsFromSegments(segs, fns(leg, { 'BN14.2': { ...CLEAR_LEGS['BN14.2'], voidStalls: [] } }))
    const k0 = R0.find((o) => o.param === 'k')
    c.examined(1)
    if (!k) c.fail('CLEAR_LEGS BN14.2 gave no k reading on the BN14.2-shaped segment', JSON.stringify(R.withheld))
    else {
      close(k.value, (30.14 - 8.9 - 0.68 - 4.96) / leg, 1e-9, 'BN14.2 k = (hours - idle - offroute - opening) / leg')
      if (!/voided stall\(s\) idle 5\.04h: 8\.90h, offroute 14\.71h: 0\.68h/.test(k.note)) c.fail(`the voided stalls are not in the note: ${k.note}`)
      if (!/\|rev 1$/.test(k.key)) c.fail(`the corrected BN14.2 reading must carry its CLEAR_LEGS rev in its key (it replaces the first one): ${k.key}`)
      if (!(k0 && k0.value > k.value + 0.5)) c.fail(`the un-voided stall must read as a slower route (k ${k0?.value?.toFixed(3)} vs voided ${k.value.toFixed(3)})`)
    }
    const Rm = readingsFromSegments([{ ...seg, stalls: [] }, segs[1]], fns(leg, CLEAR_LEGS))
    c.examined(1)
    if (Rm.some((o) => o.param === 'k') || !Rm.withheld?.some((w) => /history does not show/.test(w))) c.fail('a CLEAR_LEGS void that matches no measured stall must withhold the reading, not void nothing')
  }
  // (3b) measure.mjs finds the stalls in a history
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gp9-'))
    const f = path.join(dir, 'history.jsonl')
    const lines = []
    const t0 = 1e9
    let ex = 0
    for (let i = 0; i <= 120; i++) {
      const h = i * 0.1
      // gym to 100 by 1h; idle 1.0h -> 4.0h; Bladeburner (exp moving) 4.0 -> 6.0; crime 6.0 -> 7.0; Bladeburner after
      const lvl = h < 1 ? Math.round(1 + 99 * h) : h < 4 ? 100 : 100 + Math.round((h - 4) * 20)
      if (!(h >= 1 && h < 4)) ex += 100
      const work = h < 1 ? { type: 'ClassWork' } : h >= 6 && h < 7 ? { type: 'CrimeWork' } : null
      const sk = { hacking: 10, strength: lvl, defense: lvl, dexterity: lvl, agility: lvl }
      lines.push(JSON.stringify({ at: new Date(Date.parse('2026-10-05T00:00:00Z') + h * 3.6e6).toISOString(), bitNode: 14, totalPlaytime: t0 + h * 3.6e6, playtimeSinceLastAug: h * 3.6e6, sourceFiles: { data: [[14, 1]] }, skills: sk, exp: { hacking: 10, strength: ex, defense: ex, dexterity: ex, agility: ex }, currentWork: work, factions: h >= 4.5 ? ['Bladeburners'] : [], augmentations: [] }))
    }
    fs.writeFileSync(f, lines.join('\n') + '\n')
    const [s] = await nodeSegments(f)
    fs.rmSync(dir, { recursive: true, force: true })
    const idle = s.stalls.find((x) => x.kind === 'idle')
    const off = s.stalls.find((x) => x.kind === 'offroute')
    c.examined(1)
    if (!idle || Math.abs(idle.at - 1.0) > 0.11 || Math.abs(idle.h - 3.0) > 0.11) c.fail(`measure.mjs idle stall: expected ~1.0h for 3.0h, got ${JSON.stringify(idle)}`)
    if (!off || Math.abs(off.at - 6.0) > 0.11 || Math.abs(off.h - 1.0) > 0.11) c.fail(`measure.mjs offroute stall: expected ~6.0h for 1.0h, got ${JSON.stringify(off)}`)
    if (s.stalls.length !== 2) c.fail(`measure.mjs found ${s.stalls.length} stalls, expected 2: ${JSON.stringify(s.stalls)}`)
    c.note(`synthetic history: ${s.stalls.map((x) => `${x.kind} ${x.at.toFixed(2)}h +${x.h.toFixed(2)}h`).join(', ')}`)
  }
  // (4) the committed store
  {
    const st = loadStore(POSTERIOR_FILE)
    const ks = st.observations.filter((o) => o.param === 'k' && !o.inBase && typeof o.note === 'string')
    const rows = []
    for (const o of ks) {
      const hm = /^([\d.]+)h(?: - ([\d.]+)h)?/.exec(o.note)
      const lm = /leg ([\d.]+)h/.exec(o.note)
      c.examined(1)
      if (!hm || !lm) {
        c.fail(`${o.key}: note not parseable for hours and leg: ${o.note}`)
        continue
      }
      const counted = +hm[1] - (hm[2] ? +hm[2] : 0)
      rows.push(`${o.clear} k ${o.value.toFixed(3)} (leg ${lm[1]}h / counted ${counted.toFixed(2)}h)`)
      if (+lm[1] > +hm[1]) c.fail(`${o.key}: leg ${lm[1]}h longer than the whole ${hm[1]}h node — a missing condition logged as k ${o.value.toFixed(3)}`)
      if (o.clear === 'BN14.2' && !/voided stall/.test(o.note)) c.fail(`${o.key}: BN14.2's reading does not void its stalls (${o.note})`)
    }
    c.note(`posterior.json k readings outside the hand prior: ${rows.join('; ') || 'none'}`)
  }
  // (5) live history: every un-voided idle stall >= 1h in a Bladeburner clear outside the hand prior
  {
    const file = path.join(TELEMETRY, 'history.jsonl')
    if (!fs.existsSync(file)) c.warn(`no live history at ${file}: the un-voided-stall check could not run`)
    else {
      const { MEASURED_RUNS } = await import('../sim/gameplan/economy.mjs')
      const base = baseIn(MEASURED_RUNS)
      const all = await nodeSegments(file)
      const found = []
      all.forEach((s, i) => {
        if (i === all.length - 1 || !s.startedAt || s.startedAt < OBS_SINCE || s.maxLevel >= HACK_LEVEL || s.bbJoinH === null) return
        const lv = new Map(s.sfOnEntry ?? [])
        const clear = `BN${s.bitNode}.${(lv.get(s.bitNode) ?? 0) + 1}`
        if (base.some((b) => b.param === 'k' && b.bn === s.bitNode && s.startedAt.startsWith(b.start))) return
        const voids = CLEAR_LEGS[clear]?.voidStalls ?? []
        for (const x of s.stalls ?? []) {
          if (x.kind !== 'idle' || x.h < 1) continue
          c.examined(1)
          const ok = voids.some((at) => Math.abs(at - x.at) < 0.1)
          found.push(`${clear} idle ${x.at.toFixed(2)}h +${x.h.toFixed(2)}h ${ok ? 'voided' : 'NOT VOIDED'}`)
          if (!ok) c.fail(`${clear}: an idle stall of ${x.h.toFixed(2)}h at ${x.at.toFixed(2)}h (no combat level or exp moved) counts against k — void it in CLEAR_LEGS with the evidence, or show it was the route's own`)
        }
      })
      c.note(`live history, Bladeburner clears outside the hand prior, idle stalls >= 1h: ${found.join('; ') || 'none'}`)
    }
  }
  return c
}

export async function run() {
  return [gp1(), gp5(), gp8(), await gp9(), ...child()]
}
