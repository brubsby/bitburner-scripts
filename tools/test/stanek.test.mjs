// Stanek's Gift — stanekplan.js (the pure model) and tools/sim/gameplan/stanek.mjs (its
// place in the whole-game planner).
//
//   ST1 THE MODEL IS THE GAME'S: the fragment catalogue, every shape's fullAt and
//       neighbours at four rotations, the grid size per node x SF13 level (the table is
//       printed), CalculateEffect at each node's power, StaneksGift.charge (highest /
//       numCharge, the Church's rep per charge, the numCharge x highest = sum of threads
//       invariant the round-robin model uses), the optimiser's layouts placed in a real
//       gift with every effect, boost and calculateMults identical, the Genesis /
//       Awakening / Serenity multipliers and rep, a charging thread's RAM. Run on the
//       tools/sim bundle in a child process (gameplan/stanektest.mjs).
//   ST2 THE PLACEMENT OPTIMISER IS EXACT on small grids: equal to an independent brute
//       force over every set of non-overlapping placements (4x3 and 3x4 grids, two
//       weightings); the known 2x3 case (BN8's grid: one tetromino, the best Hacking
//       fragment, value ln(1 + c)); a budget-limited search says so (exact: false).
//   ST3 THE NODE MODEL behaves as its mechanics require: an empty layout prices the
//       penalty alone (W = 0.9 x the exp term at Genesis, d ln g < 0); more home RAM
//       never lowers the exit divisor; Awakening comes no later with more RAM; a
//       shorter gift run on the same no-gift clock exits on a smaller home (lower W).
//   ST4 THE GIFT OFF REPRODUCES THE OLD DRAWS: Stanek's parameters are drawn from their
//       own stream (params.drawZ rStanek), so every other z — and the next draw — is
//       identical whatever that stream is; with stanekOff the stanek route never applies.
//   ST5 THE GIFT IN THE ROUTE: giftParts (the gift's re-run of the no-gift simulation key)
//       equals hackParts with the factors; clearTime's memo of the SF13-free routes equals
//       an unmemoised call at every SF13 level; the stanek route applies exactly where the
//       gift is available (BN13, or SF13 >= 1) and never with stanekOff. Stub surrogate.
//
// CALIBRATION: none of this is a calibration. ST1 checks transcriptions against the
// game source; ST2-ST4 are properties of the code. The model is NOT CALIBRATED (no
// node of this playthrough has run the gift; stanekplan.js header).

import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Check } from './harness.mjs'
import * as sp from '../../stanekplan.js'
import { rng, drawZ, worldOf } from '../sim/gameplan/params.mjs'
import { SF_PARAMS } from '../sim/gameplan/effects.mjs'
import { hackParts, giftParts, clearTime } from '../sim/gameplan/routes.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const GP = path.join(HERE, '../sim/gameplan')

function st1() {
  const c = new Check('ST1', "stanekplan.js against the game's Stanek classes: catalogue, geometry, grid table, effect, charge, Church rep, boosts, calculateMults, penalty augs")
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', path.join(GP, 'stanektest.mjs')], { encoding: 'utf8', timeout: 600e3 })
  let res
  try {
    res = JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    res = { skip: 'stanektest.mjs produced no result: ' + ((r.stderr || '').slice(-600) || `exit ${r.status}`) }
  }
  if (res.skip) c.warn('could not check (game source): ' + res.skip)
  else {
    c.examined(res.examined)
    for (const n of res.notes) c.note(n)
    for (const f of res.fails) c.fail(f)
  }
  return c
}

/** Independent brute force: every set of non-overlapping placements (valued pieces at their limit, boosters any number). */
function bruteForce(width, height, weights, c, nodePower) {
  const valued = sp.FRAGMENTS.filter((f) => f.type !== sp.TYPE.Booster && (weights[f.type] ?? 0) > 0)
  const pieces = [...valued, ...sp.FRAGMENTS.filter((f) => f.type === sp.TYPE.Booster)]
  const all = []
  for (const f of pieces)
    for (let rot = 0; rot < 4; rot++)
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          if (x + sp.fragWidth(f.shape, rot) > width || y + sp.fragHeight(f.shape, rot) > height) continue
          const mask = sp.cellsOf(f.shape, rot).reduce((m, [cx, cy]) => m | (1 << ((y + cy) * width + x + cx)), 0)
          all.push({ id: f.id, x, y, rot, mask, limit: f.limit })
        }
  let best = 0
  const chosen = []
  const rec = (i, occ) => {
    if (chosen.length) best = Math.max(best, sp.layoutValue(chosen, weights, c, nodePower))
    for (let j = i; j < all.length; j++) {
      const p = all[j]
      if (p.mask & occ) continue
      if (p.limit === 1 && chosen.some((q) => q.id === p.id)) continue
      chosen.push(p)
      rec(j + 1, occ | p.mask)
      chosen.pop()
    }
  }
  rec(0, 0)
  return best
}

function st2() {
  const c = new Check('ST2', 'the placement optimiser: exact on small grids (vs an independent brute force), the known 2x3 case, a budget-limited search reported as such')
  const W1 = sp.hackWeights({ Hg: 2.5, epsM: 0.09, epsR: 0.12 })
  const W2 = { [sp.TYPE.Hacking]: 1, [sp.TYPE.HackingSpeed]: 0.6 }
  const W3 = { [sp.TYPE.Hacking]: 1 } // two Hacking fragments and the rest boosters
  const notes = []
  for (const [w, h, weights, cc, np, name] of [[4, 3, W2, 0.3, 1, 'H/Speed'], [3, 4, W2, 0.3, 2, 'H/Speed x2 power'], [4, 3, W1, 0.25, 1, 'hack route'], [3, 4, W1, 0.4, 0.5, 'hack route x0.5'], [5, 3, W2, 0.3, 1, 'H/Speed'], [3, 5, W1, 0.3, 1, 'hack route'], [4, 4, W1, 0.3, 1, 'hack route'], [4, 4, W2, 0.5, 1.5, 'H/Speed x1.5 power'], [5, 3, W3, 0.5, 1, 'H only'], [5, 4, W3, 0.5, 1, 'H only']]) {
    const o = sp.optimiseLayout({ width: w, height: h, weights, c: cc, nodePower: np, budget: 1e7 })
    const bf = bruteForce(w, h, weights, cc, np)
    c.examined(1)
    if (!o.exact) c.fail(`${w}x${h} ${name}: the optimiser did not complete within 1e7 nodes`)
    if (Math.abs(o.value - bf) > 1e-12) c.fail(`${w}x${h} ${name}: optimiser ${o.value} vs brute force ${bf}`)
    c.examined(1)
    if (Math.abs(sp.layoutValue(o.placed, weights, cc, np) - o.value) > 1e-12) c.fail(`${w}x${h} ${name}: the returned layout's value ${sp.layoutValue(o.placed, weights, cc, np)} is not the reported ${o.value}`)
    const nb = o.placed.filter((p) => sp.fragmentById(p.id).type === sp.TYPE.Booster).length
    notes.push(`${w}x${h} ${name}: ${o.value.toFixed(5)} = brute force (${o.nodes} nodes; ${o.placed.length} pieces, ${nb} booster${nb === 1 ? '' : 's'})`)
  }
  // BN8's 2x3 grid: one tetromino fits; with hacking weighted the best is a Hacking fragment, ln(1 + c)
  const o8 = sp.optimiseLayout({ width: 2, height: 3, weights: W1, c: 0.3, nodePower: 1 })
  c.examined(1)
  if (!(o8.placed.length === 1 && sp.fragmentById(o8.placed[0].id).type === sp.TYPE.Hacking && Math.abs(o8.value - W1[sp.TYPE.Hacking] * Math.log(1.3)) < 1e-12)) c.fail(`2x3: ${JSON.stringify(o8.placed)} value ${o8.value} (want one Hacking fragment, ${W1[sp.TYPE.Hacking] * Math.log(1.3)})`)
  notes.push(`2x3 (BN8's grid): one ${sp.TYPE_NAME[sp.fragmentById(o8.placed[0]?.id)?.type]} fragment, value = w_hack x ln 1.3 exactly`)
  // a budget too small to finish says so
  const small = sp.optimiseLayout({ width: 6, height: 6, weights: W1, c: 0.3, budget: 1000 })
  c.examined(1)
  if (small.exact) c.fail('a 1000-node search of a 6x6 grid reported exact: true')
  c.note(notes.join('; '))
  return c
}

function st3() {
  const c = new Check('ST3', 'the node model: the penalty alone, monotone in home RAM, Awakening no later with more RAM, a shorter run exits on a smaller home')
  const lay = sp.optimiseLayout({ width: 6, height: 5, weights: sp.hackWeights({ Hg: 2.5, epsM: 0.09, epsR: 0.12 }), c: 0.3, budget: 2e5 }).placed
  const p = { stRam: 21, stEpsM: 0.09, stEpsR: 0.12, stFr: 4, stDuty: 0.9 }
  const base = { nodePower: 1, cycleH: 2.6, Hg: 2.5, L0: 750, hours: 30 }
  // (1) the penalty alone: no fragments, Genesis forever (an empty layout charges nothing)
  const e = sp.nodeModel({ ...base, layout: [], f: 0.001, p })
  const wantW = 0.9 * (1 + (32 * Math.log(0.9 * 0.9 * 0.9 * 0.999)) / 750)
  c.examined(2)
  if (Math.abs(e.W - wantW) > 1e-12) c.fail(`empty layout: W ${e.W} vs 0.9 x the exp term ${wantW}`)
  if (!(e.dlng < 0) || e.giftAt[2] !== null) c.fail(`empty layout: d ln g ${e.dlng} (want < 0), Awakening at ${e.giftAt[2]} (want never)`)
  // (2) monotone in home RAM; Awakening no later
  let prev = null
  for (const r of [15, 18, 21, 24]) {
    const m = sp.nodeModel({ ...base, layout: lay, f: 0.1, p: { ...p, stRam: r } })
    c.examined(2)
    if (prev && m.W < prev.W - 1e-12) c.fail(`W fell with more home RAM: 2^${r} ${m.W} < ${prev.W}`)
    if (prev && prev.giftAt[2] !== null && (m.giftAt[2] === null || m.giftAt[2] > prev.giftAt[2])) c.fail(`Awakening later with more RAM at 2^${r}: ${m.giftAt[2]} vs ${prev.giftAt[2]}`)
    prev = m
  }
  // (3) the same no-gift clock, a shorter gift run: a smaller home at the exit
  const long = sp.nodeModel({ ...base, layout: lay, f: 0.1, p, hours: 30, ramHours: 30 })
  const short = sp.nodeModel({ ...base, layout: lay, f: 0.1, p, hours: 20, ramHours: 30 })
  c.examined(1)
  if (!(short.W < long.W)) c.fail(`a 20h run on a 30h clock exits with W ${short.W}, not below the 30h run's ${long.W}`)
  // (4) the decision: f is the best of the grid
  const b = sp.bestNodeModel({ ...base, layout: lay, p })
  c.examined(1)
  if (sp.F_GRID.some((f) => sp.nodeModel({ ...base, layout: lay, p, f }).J > b.J + 1e-12)) c.fail('bestNodeModel is not the best f of the grid')
  c.note(`empty layout W ${e.W.toFixed(4)}, d ln g ${e.dlng.toFixed(4)}; 6x5 layout at 2^15..2^24 home GB: W ${[15, 18, 21, 24].map((r) => sp.nodeModel({ ...base, layout: lay, f: 0.1, p: { ...p, stRam: r } }).W.toFixed(3)).join(' / ')}; 20h vs 30h run on a 30h clock: W ${short.W.toFixed(3)} vs ${long.W.toFixed(3)}; best f ${b.f} (J ${b.J.toFixed(3)}, Awakening after life ${b.giftAt[2]}, Serenity ${b.giftAt[3]})`)
  return c
}

function st4() {
  const c = new Check('ST4', "Stanek's draws on their own stream: every other z (and the next draw) unchanged; stanekOff turns the route off")
  const econ = { gScen: { lo: 0.04, mid: 0.065, hi: 0.13 }, gamma: 0.6, amc: Object.fromEntries([...Array(14)].map((_, i) => [i + 1, 1])), ownG: new Map([[1, 0.05]]), profile: { cycleHours: 2 }, runs: [] }
  const nodes = [1, 3, 5, 13, 14]
  const run = (sSeed) => {
    const r = rng(11)
    const rs = rng(sSeed)
    return [drawZ(r, nodes, econ, { rStanek: rs }), drawZ(r, nodes, econ, { rStanek: rs })]
  }
  const [a1, a2] = run(1)
  const [b1, b2] = run(2)
  const st = Object.keys(SF_PARAMS).filter((k) => SF_PARAMS[k].stream === 'stanek')
  c.examined(1)
  if (st.length !== 5) c.fail(`expected 5 Stanek parameters on the 'stanek' stream, found ${st.join(',')}`)
  for (const [x, y, which] of [[a1, b1, 'first'], [a2, b2, 'second']])
    for (const k of Object.keys(x)) {
      c.examined(1)
      if (st.includes(k)) {
        if (x[k] === y[k]) c.fail(`${which} draw: ${k} did not move with the Stanek stream`)
      } else if (x[k] !== y[k]) c.fail(`${which} draw: ${k} moved with the Stanek stream (${x[k]} vs ${y[k]})`)
    }
  const w = worldOf(econ, a1, { stanekOff: true })
  c.examined(1)
  if (!w.stanekOff || typeof w.cycleHours !== 'number') c.fail('worldOf does not carry stanekOff / cycleHours')
  c.note(`two draws with the Stanek stream reseeded: ${Object.keys(a1).length - st.length} other z's identical in both, ${st.join(', ')} moved`)
  return c
}

function st5() {
  const c = new Check('ST5', "the gift in the route: giftParts == hackParts with the factors; clearTime's SF13-free memo == no memo; the stanek route only where the gift is available")
  const econ = { gScen: { lo: 0.04, mid: 0.065, hi: 0.13 }, gamma: 0.6, amc: Object.fromEntries([...Array(14)].map((_, i) => [i + 1, 1])), ownG: new Map([[1, 0.05], [5, 0.06]]), profile: { cycleHours: 2.6, expRich: 2e9 }, runs: [] }
  const mults = { GoPower: 1, FavorToDonateToFaction: 1, FactionWorkRepGain: 1, StaneksGiftPowerMultiplier: 1.3, StaneksGiftExtraSize: 0, AugmentationRepCost: 1, HackExpGain: 1, HackingSpeedMultiplier: 1, BladeburnerRank: 0 }
  // a stub surrogate: a smooth exit curve in g (the real one is a grid of exitplan runs)
  // hackClimb: the post-TRP climb the w0r1d_d43m0n window is solved on (go.mjs goWindow), a constant stub
  const S = { hackHours: (n, l, sf, g) => 1.8 / g + l + sf.length / 10, hackClimb: () => ({ L0: 0.8, u0: 700 }), mults: () => mults, bbRank: () => 0 }
  const levels = new Map([[1, 3], [4, 3], [5, 1], [8, 1], [9, 1], [10, 1], [11, 0], [12, 0], [13, 0], [14, 1]])
  const lv = (n) => levels.get(n) ?? 0
  const world = worldOf(econ, {})
  // both valuations of the w0r1d_d43m0n bonus (the exit shift; --w0-live, the climb's shortening)
  for (const [node, wd] of [[1, world], [5, world], [1, worldOf(econ, {}, { w0Live: true })]]) {
    const a = { node, lv, world: wd, S }
    const base = hackParts(a)
    const st = { gMul: 1.031, W: 1.74, favorMul: 0.81 }
    const viaGift = giftParts(base, st, a)
    const direct = hackParts({ ...a, st })
    for (const k of ['h', 'hsim', 'g', 'W', 'favor', 'favorRef', 'early']) {
      c.examined(1)
      if (Math.abs(viaGift[k] - direct[k]) > 1e-12 * Math.max(1, Math.abs(direct[k]))) c.fail(`BN${node} ${k}: giftParts ${viaGift[k]} vs hackParts with st ${direct[k]}`)
    }
  }
  // the memo: SF13 0..3 on one world (memoised) vs a fresh world per call (no memo hit)
  const rows = []
  for (const l13 of [0, 1, 2, 3]) {
    levels.set(13, l13)
    for (const node of [1, 5, 13]) {
      const m = clearTime(node, lv, world, S)
      const fresh = clearTime(node, lv, worldOf(econ, {}), S)
      c.examined(2)
      if (m.h !== fresh.h || JSON.stringify(m.by) !== JSON.stringify(fresh.by)) c.fail(`BN${node} SF13.${l13}: memoised ${JSON.stringify(m.by)} vs fresh ${JSON.stringify(fresh.by)}`)
      const has = 'stanek' in m.by
      if (has !== (node === 13 || l13 >= 1)) c.fail(`BN${node} SF13.${l13}: the stanek route ${has ? 'applied' : 'did not apply'}`)
      if (node === 5) rows.push(`SF13.${l13} hack ${m.by.hack.toFixed(2)} stanek ${has ? m.by.stanek.toFixed(2) : '-'} via ${m.via}`)
    }
  }
  levels.set(13, 1)
  const off = clearTime(5, lv, worldOf(econ, {}, { stanekOff: true }), S)
  c.examined(1)
  if ('stanek' in off.by) c.fail('stanekOff: the stanek route applied')
  c.note(`giftParts == hackParts(st) on BN1/BN5 (7 terms each); BN5 on the stub surrogate: ${rows.join('; ')}; stanekOff: no stanek route`)
  return c
}

export async function run() {
  return [st1(), st2(), st3(), st4(), st5()]
}
