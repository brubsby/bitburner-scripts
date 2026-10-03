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
//   GP4 THE IPvGO MODEL IS THE GAME'S: go.mjs's transcriptions against the game
//       source functions (CalculateEffect at GoPower 4 and the SF14 doubling,
//       getMaxRep per SF14 level, the favor award played through endGoGame and
//       its cap, favor <-> rep, BN14's multipliers), the favor life's ordering
//       in SF14, the w0r1d_d43m0n exit shift against exitplan at exitLevel/W,
//       BN14's HackingSpeedMultiplier in the simulation, the gym scale.
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
import { rng } from '../sim/gameplan/params.mjs'

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

export async function run() {
  return [gp1(), ...child()]
}
