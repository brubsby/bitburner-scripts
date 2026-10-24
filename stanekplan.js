// STANEK'S GIFT, PRICED: the fragment catalogue, the grid, the charge and
// effect formulas, a placement optimiser, and the per-node charging model the
// whole-game planner (tools/sim/gameplan) reads. Pure: no ns, no game import —
// importing it costs no RAM, and a live charger can drive the same layout.
//
// SOURCE (every formula here is the game's, file and line in ~/Repos/bitburner/src):
//   catalogue      CotMG/Fragment.ts:93-325 (id, shape, type, power, limit);
//                  shapes CotMG/data/Shapes.ts; types CotMG/FragmentType.ts
//   geometry       Fragment.fullAt / width / height / neighbors (Fragment.ts:22-77);
//                  ActiveFragment.neighbors / collide (ActiveFragment.ts)
//   grid           StaneksGift.baseSize = 9 + node StaneksGiftExtraSize + SF13 level;
//                  width = max(2, min(floor(base/2 + 1), 25)),
//                  height = max(3, min(floor(base/2 + 0.6), 25))   StaneksGift.ts:20-32,
//                  data/Constants.ts (BaseSize 9, MaxSize 25)
//   effect         1 + ln(highestCharge + 1)/60 x ((numCharge + 1)/5)^0.07 x power x boost
//                  x node StaneksGiftPowerMultiplier        CotMG/formulas/effect.ts
//                  boost = product of the DISTINCT adjacent Booster fragments' power (1.1)
//                  StaneksGift.effect (StaneksGift.ts:62-79)
//   charge         threads > highest: numCharge = highest x numCharge / threads + 1,
//                  highest = threads; else numCharge += threads / highest  StaneksGift.ts:34-41
//                  => INVARIANT numCharge x highestCharge = sum of threads charged (this file uses it)
//                  threads = script threads x getCoreBonus(cores) = 1 + (cores-1)/16
//                  (NetscriptFunctions/Stanek.ts:46-53, Server/ServerHelpers.ts:315)
//                  one call takes 1000ms (200ms in bonus time, storedCycles >= 5 — offline
//                  cycles only: process() spends 1 stored cycle per tick)  Stanek.ts:48-50,
//                  StaneksGift.ts:49-60
//   church rep     per charge: faction_rep x threads^0.95 x (favor + 100)/1000   StaneksGift.ts:43-44
//   RAM            1.6 (script base) + 0.4 (chargeFragment) = 2.0 GB per charging thread
//                  Netscript/RamCostGenerator.ts:11,65
//   install        prestigeAugmentation clears every fragment's charge; the layout stays
//                  (StaneksGift.ts:226-228, Prestige.ts:125); a node's end clears the
//                  layout (prestigeSourceFile, Prestige.ts:344)
//   accept         Player.canAccessCotMG (in BN13 or SF13 held, BitNodeUtils.ts:17) and no
//                  augmentation but NeuroFlux installed or queued (CotMG/Helper.tsx
//                  canAcceptStaneksGift); outside BN13 an install with any non-NeuroFlux
//                  aug and no gift BANS the Church for the node (Prestige.ts:184-190) — and
//                  in BN13 installed augs persist, so the same rule binds there: the
//                  decision is per node, at its start: accept, or never.
//   penalty        Genesis x0.9 on hacking/chance/speed/money/grow/exp, combat, charisma,
//                  company/faction rep, crime, hacknet money, work money (x1.1 hacknet
//                  costs); Awakening (1e6 Church rep x AugmentationRepCost) -> x0.95;
//                  Serenity (1e8) -> x1   Augmentation/Augmentations.ts:1593-1705,
//                  AugmentationHelpers.ts:158 (rep cost x AugmentationRepCost). Both cost
//                  $0 and so are bought LAST in a life: the x1.9 queued-aug price step
//                  (AugmentationHelpers.ts:32-37) then costs nothing.
//   fragment -> multiplier  StaneksGift.calculateMults (StaneksGift.ts:121-205)
//
// THE CHARGING MODEL (nodeModel below) — what is source, what is policy, what is assumed:
//   POLICY (stated, priced as is)  one charging script on home with a fraction f of home
//     RAM, cycling the charged fragments round robin (one call per second: so after
//     tau seconds of a life each fragment holds highestCharge = T, numCharge = tau/k);
//     f is CHOSEN per node and world by maximising the exit objective; the layout is
//     chosen once per grid size (optimiseLayout at the mid world's weights) — the live game
//     re-chooses it per life on the live exit model (liveLayout*); the per-life policy's gain is
//     NOT SIMULATED in the gameplan's route (tools/sim/stanekperlife.mjs prices it).
//   MEASURED  home RAM at a hacking-route exit (telemetry history.jsonl, every node
//     played: log2 GB 14..25, median 21) and its shape over the node (log2 RAM rises
//     ~ u^2 in the node's time fraction u: the median node is at 2^11-12 at u = 0.5 and
//     2^16 at 0.75); home cores at the exit (median 7).
//   ASSUMED (lo/mid/hi drawn by the planner, effects.SF_PARAMS st*)  the elasticity of
//     the node's growth g to income and to faction rep; the faction_rep multiplier the
//     player's augmentations reach by the node's end (the Church rep clock); the
//     charger's duty (the share of each life it holds its threads).
//   NOT PRICED  bonus time (offline cycles: 5x charge rate, ^0.07 term only); charging
//     from purchased servers (numCharge and rep only, never highestCharge, which is one
//     script's threads — the in-game allocation, chargeLnOf, does price the fleet placement);
//     sleeves with ZOE (CotMG on sleeves); the Bladeburner route with
//     the gift (bbsim has no Stanek multipliers: a Bladeburner clear never accepts).

// ---------------------------------------------------------------------------
// The catalogue (transcribed; tools/test checks it against the bundle)
// ---------------------------------------------------------------------------
export const STANEK = {
  BaseSize: 9, // data/Constants.ts
  MaxSize: 25,
  chargeMs: 1000, // Stanek.ts:49
  bonusChargeMs: 200,
  ramPerThread: 1.6 + 0.4, // RamCostGenerator.ts: Base 1.6 + StanekCharge 0.4
  repAwakening: 1e6, // Augmentations.ts StaneksGift2 repCost
  repSerenity: 1e8, // StaneksGift3 repCost
}

/** The stat penalty by gift level (1 Genesis, 2 Awakening, 3 Serenity); 0 = not accepted. */
export const PENALTY = [1, 0.9, 0.95, 1]

export const TYPE = {
  HackingSpeed: 3, HackingMoney: 4, HackingGrow: 5, Hacking: 6, Strength: 7, Defense: 8, Dexterity: 9, Agility: 10,
  Charisma: 11, HacknetMoney: 12, HacknetCost: 13, Rep: 14, WorkMoney: 15, Crime: 16, Bladeburner: 17, Booster: 18,
}
export const TYPE_NAME = Object.fromEntries(Object.entries(TYPE).map(([k, v]) => [v, k]))

const _ = false
const X = true
export const SHAPES = {
  O: [[X, X], [X, X]],
  I: [[X, X, X, X]],
  L: [[_, _, X], [X, X, X]],
  J: [[X, _, _], [X, X, X]],
  S: [[_, X, X], [X, X, _]],
  Z: [[X, X, _], [_, X, X]],
  T: [[X, X, X], [_, X, _]],
}

const frag = (id, shape, type, power, limit) => ({ id, shape, type, power, limit })
export const FRAGMENTS = [
  frag(0, SHAPES.S, TYPE.Hacking, 1, 1),
  frag(1, SHAPES.Z, TYPE.Hacking, 1, 1),
  frag(5, SHAPES.T, TYPE.HackingSpeed, 1.3, 1),
  frag(6, SHAPES.I, TYPE.HackingMoney, 2, 1),
  frag(7, SHAPES.J, TYPE.HackingGrow, 0.5, 1),
  frag(10, SHAPES.T, TYPE.Strength, 2, 1),
  frag(12, SHAPES.L, TYPE.Defense, 2, 1),
  frag(14, SHAPES.L, TYPE.Dexterity, 2, 1),
  frag(16, SHAPES.S, TYPE.Agility, 2, 1),
  frag(18, SHAPES.S, TYPE.Charisma, 3, 1),
  frag(20, SHAPES.I, TYPE.HacknetMoney, 1, 1),
  frag(21, SHAPES.O, TYPE.HacknetCost, 2, 1),
  frag(25, SHAPES.J, TYPE.Rep, 0.5, 1),
  frag(27, SHAPES.J, TYPE.WorkMoney, 10, 1),
  frag(28, SHAPES.L, TYPE.Crime, 2, 1),
  frag(30, SHAPES.S, TYPE.Bladeburner, 0.4, 1),
  frag(100, [[_, X, X], [X, X, _], [_, X, _]], TYPE.Booster, 1.1, 99),
  frag(101, [[X, X, X, X], [X, _, _, _]], TYPE.Booster, 1.1, 99),
  frag(102, [[_, X, X, X], [X, X, _, _]], TYPE.Booster, 1.1, 99),
  frag(103, [[X, X, X, _], [_, _, X, X]], TYPE.Booster, 1.1, 99),
  frag(104, [[_, X, X], [_, X, _], [X, X, _]], TYPE.Booster, 1.1, 99),
  frag(105, [[_, _, X], [_, X, X], [X, X, _]], TYPE.Booster, 1.1, 99),
  frag(106, [[X, _, _], [X, X, X], [X, _, _]], TYPE.Booster, 1.1, 99),
  frag(107, [[_, X, _], [X, X, X], [_, X, _]], TYPE.Booster, 1.1, 99),
]
export const fragmentById = (id) => FRAGMENTS.find((f) => f.id === id) ?? null

// ---------------------------------------------------------------------------
// Grid, geometry (Fragment.fullAt transcribed), effect, charge
// ---------------------------------------------------------------------------
/** The gift's grid for a node's StaneksGiftExtraSize and the SF13 level (StaneksGift.ts:20-32). */
export function giftSize(extraSize, sf13) {
  const base = STANEK.BaseSize + extraSize + sf13
  return {
    base,
    width: Math.max(2, Math.min(Math.floor(base / 2 + 1), STANEK.MaxSize)),
    height: Math.max(3, Math.min(Math.floor(base / 2 + 0.6), STANEK.MaxSize)),
  }
}

export const fragWidth = (shape, rot) => (rot % 2 === 0 ? shape[0].length : shape.length)
export const fragHeight = (shape, rot) => (rot % 2 === 0 ? shape.length : shape[0].length)

/** Fragment.fullAt (Fragment.ts:22-40), verbatim in logic. */
export function fullAt(shape, x, y, rot) {
  if (y < 0 || x < 0) return false
  if (y >= fragHeight(shape, rot) || x >= fragWidth(shape, rot)) return false
  let [sx, sy, mx, my] = [0, 0, 1, 1]
  if (rot === 1) [sx, sy, mx, my] = [fragWidth(shape, rot) - 1, 0, -1, 1]
  else if (rot === 2) [sx, sy, mx, my] = [fragWidth(shape, rot) - 1, fragHeight(shape, rot) - 1, -1, -1]
  else if (rot === 3) [sx, sy, mx, my] = [0, fragHeight(shape, rot) - 1, 1, -1]
  let [qx, qy] = [sx + mx * x, sy + my * y]
  if (rot % 2 === 1) [qx, qy] = [qy, qx]
  return shape[qy][qx]
}

/** The filled cells of a shape at a rotation, relative to its root (bounding-box corner). */
export function cellsOf(shape, rot) {
  const out = []
  for (let y = 0; y < fragHeight(shape, rot); y++) for (let x = 0; x < fragWidth(shape, rot); x++) if (fullAt(shape, x, y, rot)) out.push([x, y])
  return out
}

/** Fragment.neighbors (Fragment.ts:52-77): the empty cells 4-adjacent to the shape, relative to its root. */
export function neighborsOf(shape, rot) {
  const out = []
  const seen = new Set()
  const add = (x, y) => {
    if (fullAt(shape, x, y, rot)) return
    const k = `${x},${y}`
    if (seen.has(k)) return
    seen.add(k)
    out.push([x, y])
  }
  for (const [x, y] of cellsOf(shape, rot)) {
    add(x - 1, y)
    add(x + 1, y)
    add(x, y - 1)
    add(x, y + 1)
  }
  return out
}

/** CotMG/formulas/effect.ts CalculateEffect, with the node's StaneksGiftPowerMultiplier passed in. */
export const calculateEffect = (highestCharge, numCharge, power, boost, nodePower) =>
  1 + (Math.log(highestCharge + 1) / 60) * Math.pow((numCharge + 1) / 5, 0.07) * power * boost * nodePower

/** The charge-dependent factor of the effect: ln(h+1)/60 x ((n+1)/5)^0.07 (effect = 1 + c x power x boost x nodePower). */
export const chargeFactor = (highestCharge, numCharge) => (Math.log(highestCharge + 1) / 60) * Math.pow((numCharge + 1) / 5, 0.07)

/** StaneksGift.charge on a plain {highestCharge, numCharge} (mutates and returns it). */
export function chargeOnce(af, threads) {
  if (threads > af.highestCharge) {
    af.numCharge = (af.highestCharge * af.numCharge) / threads + 1
    af.highestCharge = threads
  } else af.numCharge += threads / af.highestCharge
  return af
}

/** Church rep of one charge call (StaneksGift.ts:43-44). */
export const chargeRep = (threads, factionRepMult, favor) => (factionRepMult * Math.pow(threads, 0.95) * (favor + 100)) / 1000

/** getCoreBonus (ServerHelpers.ts:315). */
export const coreBonus = (cores) => 1 + (cores - 1) / 16

/** Charging threads (after the core bonus) of a script holding `ramGB` on a host with `cores`. */
export const threadsOf = (ramGB, cores) => Math.floor(ramGB / STANEK.ramPerThread) * coreBonus(cores)

// ---------------------------------------------------------------------------
// Layouts: placement, boosts, value, and the optimiser
// ---------------------------------------------------------------------------
/** The distinct orientations of a fragment: [{rot, cells, nbrs, w, h, ax, ay}] (ax, ay = first cell in row-major order). */
export function orientations(f) {
  const out = []
  const seen = new Set()
  for (let rot = 0; rot < 4; rot++) {
    const cells = cellsOf(f.shape, rot)
    const key = cells.map(([x, y]) => `${x},${y}`).sort().join(';') + `|${fragWidth(f.shape, rot)}x${fragHeight(f.shape, rot)}`
    if (seen.has(key)) continue
    seen.add(key)
    const first = [...cells].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0]
    out.push({ rot, cells, nbrs: neighborsOf(f.shape, rot), w: fragWidth(f.shape, rot), h: fragHeight(f.shape, rot), ax: first[0], ay: first[1] })
  }
  return out
}

/** Can fragment f sit at root (x, y) with rotation rot on a width x height grid holding `placed`? (StaneksGift.canPlace) */
export function canPlace(placed, width, height, x, y, rot, f) {
  if (x < 0 || y < 0) return false
  if (x + fragWidth(f.shape, rot) > width || y + fragHeight(f.shape, rot) > height) return false
  if (placed.filter((p) => p.id === f.id).length >= f.limit) return false
  const occ = new Set()
  for (const p of placed) for (const [cx, cy] of cellsOf(fragmentById(p.id).shape, p.rot)) occ.add(`${p.x + cx},${p.y + cy}`)
  return cellsOf(f.shape, rot).every(([cx, cy]) => !occ.has(`${x + cx},${y + cy}`))
}

/** The boost of every placed fragment (product of its distinct adjacent boosters' power). placed: [{id, x, y, rot}] */
export function boostsOf(placed) {
  const at = new Map()
  placed.forEach((p, i) => {
    for (const [cx, cy] of cellsOf(fragmentById(p.id).shape, p.rot)) at.set(`${p.x + cx},${p.y + cy}`, i)
  })
  return placed.map((p) => {
    const adj = new Set()
    for (const [nx, ny] of neighborsOf(fragmentById(p.id).shape, p.rot)) {
      const j = at.get(`${p.x + nx},${p.y + ny}`)
      if (j !== undefined && fragmentById(placed[j].id).type === TYPE.Booster) adj.add(j)
    }
    let b = 1
    for (const j of adj) b *= fragmentById(placed[j].id).power
    return b
  })
}

/**
 * A layout's value: sum over charged fragments of w[type] x ln(effect), effect at the
 * charge factor c (chargeFactor) and nodePower. weights: { [type]: w }.
 */
export function layoutValue(placed, weights, c, nodePower = 1) {
  const b = boostsOf(placed)
  let v = 0
  placed.forEach((p, i) => {
    const f = fragmentById(p.id)
    if (f.type === TYPE.Booster) return
    v += (weights[f.type] ?? 0) * Math.log(1 + c * f.power * b[i] * nodePower)
  })
  return v
}

/**
 * The multipliers a layout gives at a charge state (StaneksGift.calculateMults, the
 * player-side keys this repo reads). charge: { highestCharge, numCharge } shared by every
 * charged fragment (the round-robin policy), or a per-fragment array.
 */
export const LAYOUT_MULT_KEYS = ['hacking', 'hacking_exp', 'hacking_speed', 'hacking_money', 'hacking_grow', 'faction_rep', 'company_rep', 'strength', 'strength_exp', 'defense', 'defense_exp', 'dexterity', 'dexterity_exp', 'agility', 'agility_exp', 'charisma', 'charisma_exp', 'crime_success', 'crime_money', 'work_money', 'hacknet_node_money', 'bladeburner_max_stamina', 'bladeburner_stamina_gain', 'bladeburner_analysis', 'bladeburner_success_chance']
export function layoutMults(placed, charge, nodePower = 1) {
  const m = Object.fromEntries(LAYOUT_MULT_KEYS.map((k) => [k, 1]))
  const b = boostsOf(placed)
  placed.forEach((p, i) => {
    const f = fragmentById(p.id)
    if (f.type === TYPE.Booster) return
    const ch = Array.isArray(charge) ? charge[i] : charge
    const e = calculateEffect(ch.highestCharge, ch.numCharge, f.power, b[i], nodePower)
    switch (f.type) {
      case TYPE.Hacking:
        m.hacking *= e
        m.hacking_exp *= e
        break
      case TYPE.HackingSpeed:
        m.hacking_speed *= e
        break
      case TYPE.HackingMoney:
        m.hacking_money *= e
        break
      case TYPE.HackingGrow:
        m.hacking_grow *= e
        break
      case TYPE.Rep:
        m.faction_rep *= e
        m.company_rep *= e
        break
      case TYPE.Strength:
        m.strength *= e
        m.strength_exp *= e
        break
      case TYPE.Defense:
        m.defense *= e
        m.defense_exp *= e
        break
      case TYPE.Dexterity:
        m.dexterity *= e
        m.dexterity_exp *= e
        break
      case TYPE.Agility:
        m.agility *= e
        m.agility_exp *= e
        break
      case TYPE.Charisma:
        m.charisma *= e
        m.charisma_exp *= e
        break
      case TYPE.HacknetMoney:
        m.hacknet_node_money *= e
        break
      case TYPE.WorkMoney:
        m.work_money *= e
        break
      case TYPE.Crime:
        m.crime_success *= e
        m.crime_money *= e
        break
      case TYPE.Bladeburner:
        m.bladeburner_max_stamina *= e
        m.bladeburner_stamina_gain *= e
        m.bladeburner_analysis *= e
        m.bladeburner_success_chance *= e
        break
    }
  })
  return m
}

/**
 * THE PLACEMENT OPTIMISER: maximise layoutValue over every legal placement of the
 * valued fragments (weights > 0, each at its limit) and any number of boosters, on a
 * width x height grid. Exact depth-first branch and bound over the cells in row-major
 * order (each first undecided cell is left empty or is the first cell of a placed
 * orientation), with an admissible bound; `budget` caps the nodes expanded (the result
 * says whether the search completed: exact = true is a proof of optimality).
 * Returns { placed: [{id, x, y, rot}], value, exact, nodes }.
 */
export function optimiseLayout({ width, height, weights, c, nodePower = 1, budget = 2e6 }) {
  const N = width * height
  const valued = FRAGMENTS.filter((f) => f.type !== TYPE.Booster && (weights[f.type] ?? 0) > 0)
  if (!valued.length || N < 4) return { placed: [], value: 0, exact: true, nodes: 0 }
  const boosters = FRAGMENTS.filter((f) => f.type === TYPE.Booster)
  const cp = c * nodePower
  const vOf = (f, nb) => weights[f.type] * Math.log(1 + cp * f.power * Math.pow(1.1, nb))
  // pieces in try order: valued by base value (desc), then boosters
  const pieces = [...valued.sort((a, b) => vOf(b, 0) - vOf(a, 0)), ...boosters].map((f) => ({ f, ors: orientations(f), valued: f.type !== TYPE.Booster }))
  const grid = new Int32Array(N).fill(-1) // placed index, -1 undecided-or-empty
  const decided = new Uint8Array(N)
  const placed = [] // {pi, x, y, rot, cells:[idx], nbrs:[idx]}
  const used = new Uint8Array(pieces.length)
  let best = { value: -1, placed: [] }
  let nodes = 0
  let complete = true

  const valueNow = () => {
    let v = 0
    for (const p of placed) {
      if (!pieces[p.pi].valued) continue
      const adj = new Set()
      for (const k of p.nbrs) {
        const j = grid[k]
        if (j >= 0 && !pieces[placed[j].pi].valued) adj.add(j)
      }
      v += vOf(pieces[p.pi].f, adj.size)
    }
    return v
  }
  const bound = (from) => {
    // placed valued: current distinct boosters + every undecided neighbour cell as a new one
    let undecided = 0
    for (let k = from; k < N; k++) if (!decided[k]) undecided++
    let v = 0
    for (const p of placed) {
      if (!pieces[p.pi].valued) continue
      const adj = new Set()
      let open = 0
      for (const k of p.nbrs) {
        const j = grid[k]
        if (j >= 0 && !pieces[placed[j].pi].valued) adj.add(j)
        else if (!decided[k]) open++
      }
      v += vOf(pieces[p.pi].f, adj.size + Math.min(open, Math.floor(undecided / 5)))
    }
    // unplaced valued: 4 cells each, the rest boosters
    let cells = undecided
    for (let i = 0; i < pieces.length; i++) {
      if (!pieces[i].valued || used[i]) continue
      if (cells < 4) break
      cells -= 4
      v += vOf(pieces[i].f, Math.floor(Math.max(0, undecided - 4) / 5))
    }
    return v
  }
  const firstUndecided = (from) => {
    while (from < N && decided[from]) from++
    return from
  }
  const dfs = (from) => {
    if (++nodes > budget) {
      complete = false
      return
    }
    const k = firstUndecided(from)
    if (k >= N) {
      const v = valueNow()
      if (v > best.value + 1e-12) best = { value: v, placed: placed.map((p) => ({ id: pieces[p.pi].f.id, x: p.x, y: p.y, rot: p.rot })) }
      return
    }
    if (bound(k) <= best.value + 1e-12) return
    const x = k % width
    const y = Math.floor(k / width)
    for (let i = 0; i < pieces.length; i++) {
      const pc = pieces[i]
      if (pc.valued && used[i]) continue
      for (const o of pc.ors) {
        const rx = x - o.ax
        const ry = y - o.ay
        if (rx < 0 || ry < 0 || rx + o.w > width || ry + o.h > height) continue
        let ok = true
        const cells = []
        for (const [cx, cy] of o.cells) {
          const kk = (ry + cy) * width + rx + cx
          if (decided[kk]) {
            ok = false
            break
          }
          cells.push(kk)
        }
        if (!ok) continue
        const nbrs = []
        for (const [nx, ny] of o.nbrs) {
          const gx = rx + nx
          const gy = ry + ny
          if (gx >= 0 && gy >= 0 && gx < width && gy < height) nbrs.push(gy * width + gx)
        }
        const idx = placed.length
        placed.push({ pi: i, x: rx, y: ry, rot: o.rot, cells, nbrs })
        for (const kk of cells) {
          decided[kk] = 1
          grid[kk] = idx
        }
        if (pc.valued) used[i] = 1
        dfs(k + 1)
        if (pc.valued) used[i] = 0
        for (const kk of cells) {
          decided[kk] = 0
          grid[kk] = -1
        }
        placed.pop()
        if (nodes > budget) return
      }
    }
    // leave the cell empty
    decided[k] = 1
    dfs(k + 1)
    decided[k] = 0
  }
  dfs(0)
  return { placed: best.placed, value: Math.max(0, best.value), exact: complete, nodes }
}

// ---------------------------------------------------------------------------
// Route weights: what a unit of ln(multiplier) is worth to the exit, per fragment type
// ---------------------------------------------------------------------------
/**
 * The hacking route's exit objective J = ln W + Hg x d ln g (hours saved x g):
 *   W        the exit-level divisor: hacking skill x the exp term (32 ln X / L0)
 *   d ln g   epsM x ln(income factor) + epsR x ln(rep factor)
 *   income   ops/s (speed x skill) x chance x 1/(a/money + (1-a)/grow) x (1 - f)
 * so the per-type weights (d J / d ln mult) are:
 *   Hacking  1 + 2 x 32/L0 (skill and exp, the exit) + Hg epsM (skill -> ops/s)
 *   Speed    32/L0 + Hg epsM;  Money Hg epsM a;  Grow Hg epsM (1-a);  Rep Hg epsR
 * a = the hack threads' share of a batch's RAM (HACK_SHARE).
 */
export function hackWeights({ Hg, epsM, epsR, L0 = 750, a = HACK_SHARE }) {
  const e = 32 / L0
  return {
    [TYPE.Hacking]: 1 + 2 * e + Hg * epsM,
    [TYPE.HackingSpeed]: e + Hg * epsM,
    [TYPE.HackingMoney]: Hg * epsM * a,
    [TYPE.HackingGrow]: Hg * epsM * (1 - a),
    [TYPE.Rep]: Hg * epsR,
  }
}

/**
 * The hack threads' share of an HWGW batch's RAM, 1.98/phi : 6.16/k (batcher.mjs
 * batchIndex): phi = 0.0029 money per hack thread ((100 - 30)/100 x 1/240 at a
 * prepped target of min security 30, Hacking.ts calculatePercentMoneyHacked), k =
 * 0.0026 ln-growth per grow thread (ln 1.0035 x serverGrowth 75/100,
 * calculateServerGrowthLog) -> 683 : 2369 -> 0.22. A representative target, FIXED.
 */
export const HACK_SHARE = 0.22

// ---------------------------------------------------------------------------
// The node model: one node played with the gift accepted, life by life
// ---------------------------------------------------------------------------
/** The home RAM / cores shape over a node (MEASURED, see the header): u in [0, 1]. */
export const HOME = { log2Start: 8, shapeQ: 2, coresEnd: 7 }
export const homeAt = (u, log2End, h = HOME) => ({
  ram: Math.pow(2, h.log2Start + (Math.max(h.log2Start, log2End) - h.log2Start) * Math.pow(u, h.shapeQ)),
  cores: Math.max(1, Math.round(1 + (h.coresEnd - 1) * Math.pow(u, h.shapeQ))),
})

/**
 * A layout compiled for the node model: each charged fragment's type and power x boost
 * (boostsOf once), so an effect is 1 + c x pb x nodePower with c = chargeFactor(T, N).
 */
const COMPILED = new WeakMap()
export function compileLayout(placed) {
  let r = COMPILED.get(placed)
  if (r) return r
  const b = boostsOf(placed)
  const charged = []
  placed.forEach((p, i) => {
    const f = fragmentById(p.id)
    if (f.type !== TYPE.Booster) charged.push({ type: f.type, pb: f.power * b[i] })
  })
  r = { charged, k: Math.max(1, charged.length) }
  COMPILED.set(placed, r)
  return r
}
/** The hacking-route multipliers of a compiled layout at charge factor c (== layoutMults at the same charge). */
export function multsAt(cl, c, nodePower) {
  const m = { hacking: 1, hacking_exp: 1, hacking_speed: 1, hacking_money: 1, hacking_grow: 1, faction_rep: 1 }
  for (const q of cl.charged) {
    const e = 1 + c * q.pb * nodePower
    if (q.type === TYPE.Hacking) {
      m.hacking *= e
      m.hacking_exp *= e
    } else if (q.type === TYPE.HackingSpeed) m.hacking_speed *= e
    else if (q.type === TYPE.HackingMoney) m.hacking_money *= e
    else if (q.type === TYPE.HackingGrow) m.hacking_grow *= e
    else if (q.type === TYPE.Rep) m.faction_rep *= e
  }
  return m
}

const lnIncome = (m, pen, f, a = HACK_SHARE) =>
  Math.log(pen * m.hacking_speed) + Math.log(pen * m.hacking) + Math.log(pen) - Math.log(a / (pen * m.hacking_money) + (1 - a) / (pen * m.hacking_grow)) + Math.log(1 - f)

/**
 * One node with the gift, f of home RAM charging. o:
 *   layout          [{id, x, y, rot}]
 *   nodePower       StaneksGiftPowerMultiplier;  repCost  AugmentationRepCost
 *   hours, cycleH   the node's length WITH the gift and one life's (the lives are hours / cycleH)
 *   ramHours        the time scale of home's RAM curve: the node's length WITHOUT the gift (home
 *                   RAM is a function of hours into the node, MEASURED on no-gift runs, so a
 *                   shorter gift run exits on a smaller home: u = t / ramHours, capped at 1)
 *   f               the charging RAM fraction
 *   p               { stRam (log2 GB at the exit), stEpsM, stEpsR, stFr, stDuty }
 *   Hg, L0          the objective's weight on d ln g, the exit's exp term scale
 *   favorU          the node fraction the Daedalus favor life sits at (0.8)
 * Returns { W, dlng, favorMul, J, lives, giftAt: {2: life|null, 3: life|null}, end: mults at the exit, f }.
 */
/**
 * THE GIFT'S CALIBRATION (tools/sim/gameplan/giftcal.mjs, the per-life hacking factor
 * M(end)/M(start) of every gift life in history.jsonl, BN13.1 + BN10.3, against this model at
 * each life's own home RAM): kappa scales the model's ln effect of every fragment, delayH is the
 * charger's start after an install (no charge before it). nodeModel applies it when o.cal is
 * given (the gameplan, the BN8 model); absent, the model as it was.
 */
export const GIFT_CAL = { kappa: 0.886, delayH: 0.35, source: 'giftcal.mjs 2026-10-23: 43 gift lives (BN13.1 15, BN10.3 28), rms ln error 0.264 -> 0.165' }

export function nodeModel(o) {
  const { layout, nodePower, repCost = 1, hours, cycleH, f, p, Hg, L0 = 750, favorU = 0.8 } = o
  // o.cal { kappa, delayH } (GIFT_CAL): each effect's ln x kappa; a life charges only past delayH
  const calK = o.cal && Number.isFinite(o.cal.kappa) ? o.cal.kappa : 1
  const calD = o.cal && Number.isFinite(o.cal.delayH) && o.cal.delayH > 0 ? o.cal.delayH : 0
  const calOf = (m) => (calK === 1 ? m : Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Math.exp(calK * Math.log(v))])))
  const ramHours = o.ramHours ?? hours
  const duty = Math.min(1, Math.max(0, p.stDuty))
  // THE PER-LIFE LAYOUT (lifePolicyOf): o.layouts[i] is life i's layout (an install keeps the charge at
  // zero, so each life may carry its own); missing entries are o.layout. o.bump {life, type, d} multiplies
  // that life's multipliers of a fragment type by e^d (lifeWeightsOf's finite difference).
  const layouts = Array.isArray(o.layouts) ? o.layouts : null
  const bump = o.bump ?? null
  const trace = o.trace ? [] : null
  const nLives = Math.max(1, Math.ceil(hours / cycleH - 1e-9))
  const tauLife = cycleH * 3600 * duty // charging seconds per life
  let level = o.level0 ?? 1 // gift level: 1 Genesis, 2 Awakening, 3 Serenity (o.level0: installed now)
  let favor = o.favor0 ?? 0
  let sumI = 0
  let sumR = 0
  let wsum = 0
  const giftAt = { 2: null, 3: null }
  let favorMul = 1
  let end = null
  let W = 1
  const quad = [0.125, 0.375, 0.625, 0.875] // the life's charge ramp, midpoint rule
  for (let i = 0; i < nLives; i++) {
    const cl = compileLayout(layouts?.[i] ?? layout)
    const k = cl.k
    const bumpT = bump && bump.life === i ? bump : null
    const mults = (c) => calOf(bumpT ? bumpMults(multsAt(cl, c, nodePower), bumpT.type, bumpT.d) : multsAt(cl, c, nodePower))
    const t0 = i * cycleH
    const len = Math.min(cycleH, hours - t0)
    // the charging share of this life (the calibrated charger starts calD into it)
    const chg = calD > 0 ? Math.max(0, len - calD) / len : 1
    const u = Math.min(1, (t0 + len / 2) / hours) // the node's own time fraction (rep, favor life)
    const uRam = Math.min(1, (t0 + len / 2) / ramHours) // hours into the node on the no-gift clock (RAM, augs)
    const home = homeAt(uRam, p.stRam)
    const T = o.T > 0 ? o.T : threadsOf(home.ram * f, home.cores) // o.T: a measured charger (L3: a decision epoch mid-node)
    const pen = PENALTY[level]
    const frAug = Math.pow(p.stFr, uRam)
    let lnI = 0
    let lnR = 0
    let mMid = null
    if (trace) trace.push({ life: i, u, len, T, k, c: chargeFactor(T, (0.5 * tauLife * (len / cycleH) * chg) / k), level })
    for (const q of quad) {
      const N = (q * tauLife * (len / cycleH) * chg) / k
      const m = mults(chargeFactor(T, N))
      lnI += lnIncome(m, pen, f) / quad.length
      lnR += Math.log(pen * m.faction_rep) / quad.length
      if (q === 0.375) mMid = m
    }
    sumI += lnI * len
    sumR += lnR * len
    wsum += len
    // the Daedalus favor life: rep ~ hacking level x faction_rep
    if (u <= favorU) favorMul = 1 / (pen * mMid.hacking * pen * mMid.faction_rep)
    // the Church: rep this life from charging (one call per second at T threads); the
    // player's faction_rep = the augmentations' part x the gift's (lnR holds the penalty)
    const rep = cl.charged.length ? tauLife * (len / cycleH) * chg * chargeRep(T, frAug * Math.exp(lnR), favor) : 0 // nothing to charge, no rep
    if (i === nLives - 1) {
      // the exit: the end of the final life, home at its exit RAM
      const he = homeAt(Math.min(1, hours / ramHours), p.stRam)
      const Te = o.T > 0 ? o.T : threadsOf(he.ram * f, he.cores)
      const N = (tauLife * (len / cycleH) * chg) / k
      end = mults(chargeFactor(Te, N))
      const lnX = Math.log(pen * end.hacking_exp) + Math.log(pen * end.hacking) + Math.log(pen * end.hacking_speed) + Math.log(1 - f)
      W = pen * end.hacking * Math.max(0.5, 1 + (32 * lnX) / L0)
      end.pen = pen
    } else {
      if (level === 1 && rep >= STANEK.repAwakening * repCost) {
        level = 2
        giftAt[2] = i + 1
      } else if (level === 2 && rep >= STANEK.repSerenity * repCost) {
        level = 3
        giftAt[3] = i + 1
      }
      favor = repToFavorLocal(favorToRepLocal(favor) + rep)
    }
  }
  const dlng = p.stEpsM * (sumI / wsum) + p.stEpsR * (sumR / wsum)
  return { W, dlng, favorMul, J: Math.log(W) + Hg * dlng, lives: nLives, giftAt, end, f, trace }
}

// favor <-> rep (Faction/formulas/favor.ts; the same as favor.js, inlined to keep this module import-free)
const LOG_1_02 = Math.log(1.02)
const favorToRepLocal = (fv) => Math.max(0, 25000 * Math.expm1(LOG_1_02 * fv))
const repToFavorLocal = (r) => Math.min(35331, Math.max(0, Math.log1p(r / 25000) / LOG_1_02))

/** The charging fractions searched (the decision): 0.1% .. 50% of home, geometric. */
export const F_GRID = [0.001, 0.002, 0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.12, 0.2, 0.3, 0.5]

/** nodeModel at the best f (max J). */
export function bestNodeModel(o) {
  let best = null
  for (const f of F_GRID) {
    const r = nodeModel({ ...o, f })
    if (!best || r.J > best.J) best = r
  }
  return best
}

// ===========================================================================
// THE LAYOUT PER LIFE (L1 of the dynamic layout): chosen at every install
// ===========================================================================
// An install clears every fragment's charge and keeps the layout (StaneksGift.ts:226-228), and
// StaneksGift.delete / clearGift remove a fragment WITH its charge (StaneksGift.ts:112): at an
// install the charge is zero anyway, so the next life may carry the layout that is best for
// THAT life at no cost beyond the placement. The life's weights are not hand-assigned: they are
// the MARGINAL EXIT-HOURS per unit ln(multiplier) of each fragment type IN THAT LIFE, measured by
// a finite difference of the trajectory (nodeModel's exit objective J, with only that life's
// multipliers of the type bumped by e^d), the way tools/sim/bbstanek.mjs measured the Bladeburner
// weights on bbsim. What makes lives differ, in the model: the final life carries the exit level
// (hacking skill x the exp term: Hacking and Speed); the Church's rep (faction_rep) moves
// Awakening / Serenity, so the penalty, only in the lives before it lands; each life's own charge
// factor c (the fleet's threads that life). NOT IN THE WEIGHTS: the Daedalus favor life's hours
// (nodeModel favorMul sits outside J), and exp banked in an early life (nodeModel's lives do not
// carry exp forward: the exit level is the final life's) — both would favour Hacking early.
//
// THE DECISION OF RECORD is the live exit model's (liveLayout* below): the node model here is the
// gameplan's (lifePolicyOf, priced by tools/sim/stanekperlife.mjs) and the per-life sequence model.
//
// EXTENSION POINTS (built so the next layers extend, not replace, this):
//   L2 (phase re-layouts within a life)  liveLayoutChoiceOf takes `switchCostH` (the charge a
//      re-lay deletes, 0 at an install) and stanek.js's install window (LIFE_LAYOUT_WINDOW_MIN)
//      becomes a priced epoch; nodeModel's o.layouts per life become per phase.
//   L3 (the layout as a control decision)  lifePolicyOf is a policy over lives (o.layouts) with
//      a mid-node state (o.T, o.level0, o.favor0); a decision epoch compares keep vs switch to the
//      exit with the rest of the policy fixed — the records' dH / incumbentH are that comparison.
//   L4 (the route pin)  the weights are the hacking route's; the route is an input of the model.

/** The hacking-route fragment types a life's weights are measured for, and the multsAt keys each sets (StaneksGift.ts:134-160). */
export const LIFE_TYPES = [TYPE.Hacking, TYPE.HackingSpeed, TYPE.HackingMoney, TYPE.HackingGrow, TYPE.Rep]
const LIFE_TYPE_KEYS = { [TYPE.Hacking]: ['hacking', 'hacking_exp'], [TYPE.HackingSpeed]: ['hacking_speed'], [TYPE.HackingMoney]: ['hacking_money'], [TYPE.HackingGrow]: ['hacking_grow'], [TYPE.Rep]: ['faction_rep'] }
/** m with a fragment type's multipliers x e^d (a copy). */
export function bumpMults(m, type, d) {
  const out = { ...m }
  const e = Math.exp(d)
  for (const k of LIFE_TYPE_KEYS[type] ?? []) out[k] *= e
  return out
}

/** The finite-difference step (ln units) the life weights are measured at. FIXED, stated. */
export const LIFE_DLN = 0.05

/**
 * Life i's weights: for each type, the exit hours saved per unit ln(multiplier) in life i alone,
 * (J(bumped) - J) / d / g (J's unit is ln-growth; g, the node's log growth per hour, makes it
 * hours — stanek.mjs's linearised exit H0 - J/g). o: nodeModel's options (o.layouts the policy the
 * other lives run). Weights never below 0 (a larger multiplier cannot lengthen the exit in the model).
 */
export function lifeWeightsOf(o, i, { d = LIFE_DLN, g = 1 } = {}) {
  const J0 = nodeModel({ ...o, trace: false }).J
  const w = {}
  for (const t of LIFE_TYPES) w[t] = Math.max(0, (nodeModel({ ...o, trace: false, bump: { life: i, type: t, d } }).J - J0) / d / g)
  return w
}

const lifeOptMemo = new Map()
/** optimiseLayout memoised on its inputs (weights and c at 4 significant digits). */
function optimiseMemo({ width, height, weights, c, nodePower, budget }) {
  const r4 = (x) => Number(x).toPrecision(4)
  const key = `${width}x${height}|${nodePower}|${budget}|${r4(c)}|${LIFE_TYPES.map((t) => r4(weights[t] ?? 0)).join(',')}`
  let r = lifeOptMemo.get(key)
  if (!r) {
    r = optimiseLayout({ width, height, weights, c, nodePower, budget })
    if (lifeOptMemo.size > 4096) lifeOptMemo.clear()
    lifeOptMemo.set(key, r)
  }
  return r
}

/** A layout's short key: its charged types and booster count, and a hash of the exact placement. */
export function layoutKeyOf(placed) {
  if (!Array.isArray(placed)) return null
  const charged = placed.filter((p) => fragmentById(p.id)?.type !== TYPE.Booster)
  const txt = charged.map((p) => (TYPE_NAME[fragmentById(p.id)?.type] ?? String(p.id)).replace('Hacking', 'H')).join('-') || 'none'
  let h = 2166136261
  const s = placed.map((p) => `${p.id}@${p.x},${p.y},${p.rot ?? p.rotation}`).sort().join(';')
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return `${txt}+${placed.length - charged.length}b#${h.toString(16).padStart(8, '0').slice(0, 6)}`
}

/**
 * The life's stage in the model: 'final' (the exit life: the exit level's skill and exp terms),
 * 'church' (a life whose Church rep lands Awakening / Serenity at its end), else 'build'. The
 * Daedalus favor life's hours (nodeModel favorMul) sit outside J: NOT in the life weights.
 */
export function lifeStageOf(trace, i) {
  if (i === trace.length - 1) return 'final'
  return trace[i + 1] && trace[i + 1].level > trace[i].level ? 'church' : 'build'
}

/**
 * THE PER-LIFE POLICY over a node (nodeModel options o; o.layout is the fixed policy's layout):
 * sweep the lives from the exit back, measure each life's weights on the current policy
 * (lifeWeightsOf), optimise that life's layout at its own charge factor (the life's midpoint c),
 * keep it only if the trajectory's J rises — so the policy is never worse than the fixed one in
 * the model. Returns { layouts, J, Jfixed, dJ, lives: [{life, stage, weights, c, T, key, changed}] }.
 */
export function lifePolicyOf(o, { width, height, sweeps = 2, budget = LAYOUT_FALLBACK_BUDGET, g = 1 } = {}) {
  const base = nodeModel({ ...o, layouts: null, trace: true })
  const n = base.lives
  const layouts = Array.from({ length: n }, () => o.layout)
  let J = base.J
  const lives = []
  for (let s = 0; s < sweeps; s++) {
    let moved = false
    for (let i = n - 1; i >= 0; i--) {
      const oo = { ...o, layouts }
      const w = lifeWeightsOf(oo, i, { g })
      const tr = nodeModel({ ...oo, trace: true }).trace[i]
      const cand = optimiseMemo({ width, height, weights: w, c: tr.c, nodePower: o.nodePower, budget }).placed
      let changed = false
      if (cand.length && !sameLayout(cand.map((p) => ({ ...p, rotation: p.rot })), layouts[i])) {
        const trial = layouts.slice()
        trial[i] = cand
        const Jt = nodeModel({ ...o, layouts: trial }).J
        if (Jt > J + 1e-9) {
          layouts[i] = cand
          J = Jt
          changed = moved = true
        }
      }
      lives[i] = { life: i, stage: lifeStageOf(base.trace, i), weights: w, c: tr.c, T: tr.T, key: layoutKeyOf(layouts[i]), changed: changed || lives[i]?.changed || false }
    }
    if (!moved) break
  }
  return { layouts, J, Jfixed: base.J, dJ: J - base.J, lives }
}

// ---------------------------------------------------------------------------
// THE LIFE'S LAYOUT ON THE LIVE EXIT MODEL (progress.js prices it; stanek.js places it)
// ---------------------------------------------------------------------------
// The node model above leaves out a channel the live exit simulator carries: a life's exp
// (hacking_exp, and speed's ops) raises that life's level and so its income and rep. Priced on
// BN7.2's live inputs (tools/sim/stanekperlife.mjs --live, 2026-10-16) the node model's build-life
// layout was 0.53h SLOWER than the tabled one. So the decision of record is the live exit model's:
// the weights are its marginal exit-hours per unit ln(multiplier) — each fragment type's channel
// shift (chargeLnOf's: income, exp, rep, hacking) on the measured inputs, priced by the exit
// simulator — the layout optimised at the life's charge factor, and each option's trajectory
// (layoutInputsOf: the layout held over the lives the exit model repeats) against the incumbent's.
// Two phases so the caller drives the simulator (a generator in progress.js, plain in the tool):
//   liveWeightInputsOf(base)              -> [{type, inputs}]       price each: hours
//   liveLayoutOptionsOf({...}, weights)   -> [{src, placed, key, inputs}]
//   liveLayoutChoiceOf(priced, ...)       -> the decision record
// The exit model has one life shape, so an option is priced as held for every later life; at the
// install that opens the final life the remaining trajectory IS that life (exact there). L2 (below:
// chargeLnSwitchOf / switchInputsOf) prices an in-life re-lay with the charge it deletes and regrows;
// L3 prices keep vs switch at every epoch on the same machinery.

/** The channel shifts of a type's multipliers x e^d on the hacking route (chargeLnOf's channels, at mults 1). */
export function typeChannelsOf(type, d, a = HACK_SHARE) {
  const z = { lnIncome: 0, lnExp: 0, lnRep: 0, lnHack: 0 }
  if (type === TYPE.Hacking) return { lnIncome: d, lnExp: d, lnRep: d, lnHack: d }
  if (type === TYPE.HackingSpeed) return { ...z, lnIncome: d, lnExp: d }
  if (type === TYPE.HackingMoney) return { ...z, lnIncome: -Math.log(a * Math.exp(-d) + 1 - a) }
  if (type === TYPE.HackingGrow) return { ...z, lnIncome: -Math.log(a + (1 - a) * Math.exp(-d)) }
  if (type === TYPE.Rep) return { ...z, lnRep: d }
  return z
}
const ZERO_LN = { lnIncome: 0, lnExp: 0, lnRep: 0, lnHack: 0 }
/** The weight phase: one input set per type, its multipliers x e^LIFE_DLN this life. */
export function liveWeightInputsOf(base, d = LIFE_DLN) {
  return LIFE_TYPES.map((type) => ({ type, inputs: scaleByGift(base, typeChannelsOf(type, d), ZERO_LN) }))
}
/** Weights (exit hours saved per unit ln) from the priced weight phase and the base hours H0. Null if unpriced. */
export function liveWeightsOf(H0, priced, d = LIFE_DLN) {
  if (!(typeof H0 === 'number' && isFinite(H0))) return null
  const w = {}
  for (const p of priced) {
    if (!(typeof p.hours === 'number' && isFinite(p.hours))) return null
    w[p.type] = Math.max(0, (H0 - p.hours) / d)
  }
  return w
}
/** The life's charge factor at mid-life for a layout of k charged fragments (chargeLnOf's placement and rate). */
export function lifeChargeCOf(ctx, f, k) {
  const place = Array.isArray(ctx.hosts) ? chargerPlaceOf(Math.max(0, f) * ctx.fleetGB, ctx.hosts) : chargerPlaceOf(Math.max(0, f) * ctx.homeGB, [{ host: 'home', cores: ctx.cores, capGb: Math.max(0, f) * ctx.homeGB }])
  const rate = place.H > 0 ? place.power / place.H : 0
  const tau = Math.max(0, ctx.cycleH) * 3600 * (ctx.duty ?? ALLOC_DUTY)
  return { c: place.H > 0 ? chargeFactor(place.H, (rate * 0.5 * tau) / Math.max(1, k)) : 0, H: place.H }
}
/**
 * The options phase: the incumbent (placed now), the tabled layout, the layout optimised on the
 * live weights at this life's c, and (when given) a node-model candidate (lifePolicyOf's layout
 * for this life). ctx: the stanek decision's charging context (layout = the placed one, fNow), f
 * the allocation. Each option carries the inputs its trajectory is priced on.
 */
export function liveLayoutOptionsOf({ base, ctx, f, width, height, nodePower, incumbent, nodeCand = null, budget = LAYOUT_FALLBACK_BUDGET }, weights) {
  const fixed = layoutForGrid(width, height, nodePower, 'hack').placed
  const k = Math.max(1, (incumbent ?? fixed).filter((p) => fragmentById(p.id)?.type !== TYPE.Booster).length)
  const { c } = lifeChargeCOf(ctx, f, k)
  const opts = [['incumbent', incumbent], ['tabled', fixed]]
  if (weights && c > 0) opts.push(['live weights', optimiseMemo({ width, height, weights, c, nodePower, budget }).placed])
  if (Array.isArray(nodeCand) && nodeCand.length) opts.push(['node model', nodeCand])
  const seen = new Set()
  const out = []
  for (const [src, placed] of opts) {
    if (!Array.isArray(placed) || !placed.length) continue
    const key = layoutKeyOf(placed)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ src, placed, key, inputs: layoutInputsOf(base, ctx, f, placed) })
  }
  return { options: out, c }
}
/**
 * The choice: the fastest exit; the incumbent kept unless the best beats it by tolH (at an install
 * the re-lay is free, so tolH is only the noise floor). priced: options with hours.
 */
export function liveLayoutChoiceOf(priced, { lifeKey, weights, c, f, H0, tolH = 0.01, switchCostH = 0, notSimulated = null } = {}) {
  const ok = priced.filter((p) => typeof p.hours === 'number' && isFinite(p.hours))
  const inc = ok.find((p) => p.src === 'incumbent') ?? null
  if (!ok.length) return { key: null, placed: null, lifeKey, why: 'no layout option priced (the exit is unpriced)' }
  const best = ok.reduce((b, p) => (p.hours < b.hours ? p : b))
  const take = !inc || (best !== inc && inc.hours - best.hours - switchCostH >= tolH) ? best : inc
  const table = ok.map((p) => `${p.src} ${p.key} ${p.hours.toFixed(3)}h`).join('; ')
  const wTxt = weights ? LIFE_TYPES.map((t) => `${TYPE_NAME[t].replace('Hacking', 'H')} ${weights[t].toPrecision(3)}`).join(', ') : 'unpriced'
  return {
    key: take.key,
    placed: take.placed,
    source: take.src,
    lifeKey,
    hours: +take.hours.toFixed(3),
    incumbentH: inc ? +inc.hours.toFixed(3) : null,
    dH: inc ? +(take.hours - inc.hours).toFixed(3) : null,
    switchCostH,
    f,
    c: +c.toFixed(5),
    baseH: typeof H0 === 'number' ? +H0.toFixed(3) : null,
    weights: weights ? Object.fromEntries(LIFE_TYPES.map((t) => [TYPE_NAME[t], +weights[t].toPrecision(4)])) : null,
    weightsUnit: 'exit hours saved per unit ln(multiplier) this life (the live exit model, finite difference)',
    priced: ok.map((p) => ({ src: p.src, key: p.key, hours: +p.hours.toFixed(3) })),
    why: `${take === inc ? 'kept the incumbent' : `the ${take.src} layout`} ${take.key}${inc && take !== inc ? `: ${(inc.hours - take.hours).toFixed(3)}h faster exit than the incumbent` : best !== take ? ` (the best saves ${(inc.hours - best.hours).toFixed(3)}h < ${tolH}h)` : ''}; weights (h per ln) ${wTxt} — ${table}`.slice(0, 500),
    notSimulated: notSimulated ?? 'the layout held for every later life (the exit model has one life shape); the final life priced as the others until its own install',
  }
}

/** Does `placed` fit a width x height grid legally (every fragment placeable in turn: StaneksGift.canPlace)? */
export function layoutFits(placed, width, height) {
  if (!Array.isArray(placed)) return false
  const done = []
  for (const p of placed) {
    const f = fragmentById(p.id)
    if (!f || !canPlace(done, width, height, p.x, p.y, p.rot, f)) return false
    done.push(p)
  }
  return true
}

/** How young a life must be for the life's layout decision (or a phase plan's early layout) to re-lay unpriced: the charge it deletes is ~0 this early. Later re-lays are only the priced phase switch (phaseStepOf). FIXED, stated. */
export const LIFE_LAYOUT_WINDOW_MIN = 30
/**
 * The plan's layout for THIS life (/tel/plan.txt decisions.stanek.layout, decided by progress.js on
 * the live exit model), or null: the plan of this life (lastAugReset), fresh, its lifeKey this life,
 * and legal on the grid the game reports.
 */
export function planLayoutOf(text, lastAugReset, width, height, now = Date.now(), maxAgeMin = 120) {
  let rec = null
  try {
    rec = JSON.parse(text || 'null')
  } catch {
    return null
  }
  const d = rec?.decisions?.stanek?.layout
  if (!rec || rec.lastAugReset !== lastAugReset || !(now - Date.parse(rec.at ?? '') < maxAgeMin * 60e3)) return null
  if (!d || d.lifeKey !== lastAugReset || !Array.isArray(d.placed) || !d.placed.length) return null
  if (!layoutFits(d.placed, width, height)) return null
  const ph = d.phase && Array.isArray(d.phase.late) && layoutFits(d.phase.late, width, height) ? { early: d.placed, late: d.phase.late, when: d.phase.when, d: d.phase.d ?? null, priced: d.phase.priced ?? null } : null
  return { placed: d.placed, key: d.key, why: String(d.why ?? '').slice(0, 300), weights: d.weights ?? null, decidedAt: d.decidedAt ?? null, source: d.source ?? null, phase: ph }
}

/**
 * THE PHASE PLAN OF THIS LIFE published by progress.js (/tel/plan.txt decisions.stanek.phase — the
 * Bladeburner route's, from BLADE_PHASE_PRICED), or null: fresh, this life, both layouts legal here.
 */
export function planPhaseOf(text, lastAugReset, width, height, now = Date.now(), maxAgeMin = 120) {
  let rec = null
  try {
    rec = JSON.parse(text || 'null')
  } catch {
    return null
  }
  const p = rec?.decisions?.stanek?.phase
  if (!rec || rec.lastAugReset !== lastAugReset || !(now - Date.parse(rec.at ?? '') < maxAgeMin * 60e3)) return null
  if (!p || !p.planned || !layoutFits(p.early, width, height) || !layoutFits(p.late, width, height)) return null
  return { early: p.early, late: p.late, when: p.when, d: p.d ?? null, priced: p.priced ?? null }
}

/** The Bladeburner state a phase condition reads (/tel/bladeburner.txt, this node and life, fresh), or null. */
export function bladePhaseStateOf(text, resetInfo, now = Date.now(), maxAgeMin = 15) {
  let r = null
  try {
    r = JSON.parse(text || 'null')
  } catch {
    return null
  }
  if (!r || r.bitNode !== resetInfo?.currentNode || r.lastAugReset !== resetInfo?.lastAugReset || !(now - Date.parse(r.at ?? '') < maxAgeMin * 60e3)) return null
  if (typeof r.rank !== 'number' || typeof r.blackOps?.done !== 'number') return null
  return { rank: r.rank, blackOps: r.blackOps.done, at: r.at }
}

/**
 * THE PHASE STEP (L2): which of a phase plan's layouts stanek.js places this pass. phase {early, late,
 * when, d}: priced as early from the life's start, re-laid to late once `when` holds (state: {tH hours
 * into the life — the node on the Bladeburner route, which never installs — blackOps, rank}; null = the
 * condition unreadable). The switch is priced only from the trajectory it was priced on, so it fires
 * only while the early layout is the one placed; the early layout is placed only on an empty grid or a
 * young life (youngMin — later it would delete an unpriced charge). Returns { placed (null = no
 * opinion: keep what is placed), record: { earlyKey, lateKey, when, met, metAt, switchPriced, state, why } }.
 */
export function phaseStepOf({ phase, active, state, prevPhase = null, lifeMin, youngMin = LIFE_LAYOUT_WINDOW_MIN, now = Date.now() }) {
  const activePlaced = (active ?? []).map((f) => ({ id: f.id, x: f.x, y: f.y, rot: f.rotation ?? f.rot }))
  const isE = sameLayout(active ?? [], phase.early)
  const isL = sameLayout(active ?? [], phase.late)
  const met = !!state && whenHolds(phase.when, state)
  const earlyKey = layoutKeyOf(phase.early)
  const lateKey = layoutKeyOf(phase.late)
  const metAt = met ? (prevPhase?.met && prevPhase?.lateKey === lateKey && prevPhase?.metAt ? prevPhase.metAt : new Date(now).toISOString()) : null
  const rec = (placed, st, switchPriced, why) => ({ placed, record: { earlyKey, lateKey, when: phase.when, whenText: whenText(phase.when), d: phase.d ?? null, met, metAt, switchPriced, state: st, condition: state ?? null, why: why.slice(0, 300) } })
  const dTxt = typeof phase.d === 'number' ? ` (priced ${phase.d.toFixed(3)}h)` : ''
  if (isL) return rec(phase.late, 'late', met, `switched: the late layout ${lateKey} is placed`)
  if (met && isE) return rec(phase.late, 'switching', true, `${whenText(phase.when)}: re-lay ${earlyKey} -> ${lateKey}${dTxt}`)
  if (met) return rec(null, 'held', false, `${whenText(phase.when)} but the placed layout ${layoutKeyOf(activePlaced)} is not the early ${earlyKey} the switch was priced from: kept`)
  if (isE) return rec(phase.early, 'early', false, `early ${earlyKey} until ${whenText(phase.when)}${state ? '' : ' (the condition is unreadable: no fresh state)'}`)
  if (!activePlaced.length || lifeMin <= youngMin) return rec(phase.early, 'early', false, `placing the early layout ${earlyKey} (${activePlaced.length ? `${lifeMin.toFixed(0)} min into the life` : 'the grid is empty'})`)
  return rec(null, 'held', false, `the early layout ${earlyKey} arrived ${lifeMin.toFixed(0)} min into the life with ${layoutKeyOf(activePlaced)} charged: a re-lay now is not the priced plan, kept`)
}

/**
 * STANEK PHASE SWITCH LATE: a priced switch whose condition passed `lateMin` ago (the first pass that
 * saw it, record metAt) and the placed layout is still not the late one.
 */
export function phaseHealthOf(stanek, now = Date.now(), { lateMin = 15 } = {}) {
  const ph = stanek?.lifeLayout?.phase
  if (!ph || !ph.met || !ph.switchPriced || !ph.metAt) return []
  const placedKey = stanek.layout?.placedKey ?? null
  const age = (now - Date.parse(ph.metAt)) / 60e3
  if (placedKey !== ph.lateKey && age >= lateMin) return [{ key: 'STANEK PHASE SWITCH LATE', problem: 'STANEK PHASE SWITCH LATE', detail: `the priced switch ${ph.earlyKey} -> ${ph.lateKey} (${ph.whenText}) came due ${age.toFixed(0)} min ago and the placed layout is ${placedKey ?? '(none)'}` }]
  return []
}

/**
 * THE LAYOUT stanek.js PLACES THIS PASS, and the life's decision record. basis 'blade': the tabled
 * Bladeburner layout (the route never installs). 'hack': the plan's decision of this life (the live
 * exit model, planLayoutOf) when there is one; else the layout already placed when it is legal on
 * the grid (an install keeps it: nothing to re-lay until the plan decides); else the tabled one
 * (a node's start, the grid empty). Re-lays only when the target differs from the active set.
 * prev: the last /tel/stanek.txt (the life counter). Returns { placed, record }.
 */
export function lifeTargetOf({ basis, width, height, nodePower, active, plan, prev, lastAugReset, lastNodeReset, now = Date.now(), phase = null, phaseState = null, epoch = null }) {
  const sameNode = prev && prev.lastNodeReset === lastNodeReset && prev.node !== undefined
  const prevLife = sameNode ? prev.lifeLayout ?? null : null
  const lifeIndex = !prevLife?.lifeIndex ? (sameNode ? null : 1) : prevLife.lastAugReset === lastAugReset ? prevLife.lifeIndex : prevLife.lifeIndex + 1
  const ageMin = (now - lastAugReset) / 60e3
  const activePlaced = (active ?? []).map((f) => ({ id: f.id, x: f.x, y: f.y, rot: f.rotation ?? f.rot }))
  const tab = layoutForGrid(width, height, nodePower, basis === 'blade' ? 'blade' : 'hack')
  let placed
  let source
  let why
  let decided = true
  // THE PHASE PLAN (L2): the Bladeburner route's (`phase`: progress.js, from BLADE_PHASE_PRICED) or the
  // hacking life's (plan.phase), stepped on the life's age and the condition's state (phaseStepOf)
  const ph = basis === 'blade' ? phase : plan?.phase ?? null
  const prevPhase = prevLife?.lastAugReset === lastAugReset ? prevLife?.phase ?? null : null
  const step = ph ? phaseStepOf({ phase: ph, active, state: basis === 'blade' ? (phaseState ? { tH: ageMin / 60, ...phaseState } : null) : { tH: ageMin / 60 }, prevPhase, lifeMin: ageMin, now }) : null
  // THE EPOCH DECISION (L3, stanekepoch.epochTargetOf: progress.js re-plans keep vs switch on the live
  // state at each epoch): where a fresh one exists it supersedes L2's precomputed phase step
  if (basis === 'blade' && epoch?.placed && layoutFits(epoch.placed, width, height)) {
    placed = epoch.placed
    source = `the epoch decision (L3 ${epoch.state}, ${epoch.decidedAt ?? '?'})`
    why = epoch.why
  } else if (basis === 'blade' && epoch && activePlaced.length && layoutFits(activePlaced, width, height)) {
    placed = activePlaced
    source = `the incumbent (placed): the epoch decision (L3 ${epoch.state}, ${epoch.decidedAt ?? '?'})`
    why = epoch.why
  } else if (basis === 'blade' && step?.placed) {
    placed = step.placed
    source = `the Bladeburner phase plan (${step.record.state}: stanekplan.BLADE_PHASE_PRICED)`
    why = step.record.why
  } else if (basis === 'blade' && step && activePlaced.length && layoutFits(activePlaced, width, height)) {
    placed = activePlaced
    source = 'the incumbent (placed): the phase plan holds it'
    why = step.record.why
  } else if (basis === 'blade') {
    placed = tab.placed
    source = tab.source
    why = "the Bladeburner route's tabled layout (no install on this route; no phase plan priced to win here)"
  } else if (plan && step?.placed && (sameLayout(active, plan.placed) || sameLayout(active, plan.phase.late))) {
    placed = step.placed
    source = `the plan's phase plan (${step.record.state}; ${plan.decidedAt ?? '?'}: the live exit model)`
    why = step.record.why
  } else if (plan && (ageMin <= LIFE_LAYOUT_WINDOW_MIN || sameLayout(active, plan.placed))) {
    placed = plan.placed
    source = `the plan (${plan.decidedAt ?? '?'}: the live exit model)`
    why = plan.why
  } else if (activePlaced.length && layoutFits(activePlaced, width, height)) {
    placed = activePlaced
    source = 'the incumbent (placed)'
    decided = false
    why = plan ? `the plan's layout ${plan.key} arrived ${ageMin.toFixed(0)} min into the life, past the ${LIFE_LAYOUT_WINDOW_MIN} min install window: a re-lay now deletes the life's charge (unpriced in L1: L2's mid-life re-lay)` : 'no decision of this life in /tel/plan.txt decisions.stanek.layout yet: the incumbent kept (an install keeps the layout; re-laid when the plan decides)'
  } else {
    placed = tab.placed
    source = tab.source
    decided = false
    why = 'the grid is empty (a node start): the tabled layout until the plan decides this life'
  }
  const record = { lastAugReset, lifeIndex, key: layoutKeyOf(placed), source, decided, ageMin: +ageMin.toFixed(1), weights: basis === 'blade' ? null : plan?.weights ?? null, why: String(why ?? '').slice(0, 400), at: new Date(now).toISOString(), phase: step?.record ?? null, epoch: epoch ? { kind: epoch.kind, state: epoch.state, key: epoch.key ?? null, decidedAt: epoch.decidedAt ?? null, why: String(epoch.why ?? '').slice(0, 300) } : null }
  return { placed, record }
}

/**
 * STANEK LAYOUT STALE (tools/healthcheck.mjs via stanekHealthOf): the placed layout must match the
 * life's decided layout within `staleMin` of the install, and a hacking-route life must HAVE a
 * decision of the live exit model within `decideMin` (else the per-life choice silently never runs).
 */
export function lifeLayoutHealthOf(stanek, now = Date.now(), { staleMin = 15, decideMin = 60 } = {}) {
  const L = stanek?.lifeLayout
  const g = stanek?.gift ?? {}
  if (!g.accepted || !L || L.lastAugReset !== stanek.lastAugReset) return g.accepted && stanek?.layout ? [{ key: 'STANEK LAYOUT STALE', problem: 'STANEK LAYOUT STALE', detail: `${STANEK_FILE} has no life layout record of this life (lifeLayout) — stanek.js predates the per-life layout or failed before deciding` }] : []
  const age = (now - stanek.lastAugReset) / 60e3
  const placedKey = stanek.layout?.placedKey ?? null
  if (age >= staleMin && placedKey !== L.key) return [{ key: 'STANEK LAYOUT STALE', problem: 'STANEK LAYOUT STALE', detail: `${age.toFixed(0)} min into the life the placed layout ${placedKey ?? '(none)'} is not the decided ${L.key} (${L.source})` }]
  if (g.basis !== 'blade' && !L.decided && age >= decideMin) return [{ key: 'STANEK LAYOUT STALE', problem: 'STANEK LAYOUT STALE', detail: `${age.toFixed(0)} min into the life and no decision of this life's layout: ${L.why}` }]
  return []
}

// ===========================================================================
// THE GIFT ON THE BLADEBURNER ROUTE (combat / Bladeburner fragments)
// ===========================================================================
/**
 * THE BLADEBURNER NODE'S CHARGER (the model tools/sim/bbstanek.mjs and the gameplan's
 * 'bladeStanek' route run bbsim with). The route never installs (bbsim g 0, no install),
 * so the charge accumulates over the WHOLE node. Charging POLICY (stated, and what
 * stanek.js runs on a blade-gift node, bladeChargeFOf): one charge.js holding the biggest
 * rooted host, cycling the k charged fragments round robin, one call per second
 * (Stanek.ts:48-50) — highestCharge = that script's threads x core bonus (it dominates the
 * effect through ln), numCharge = (sum of threads charged)/highest (the invariant above).
 * Other hosts would add numCharge only (^0.07): not modelled, not run.
 *   the biggest host's GB over the node: log-linear from g0 at t 0 to gbMax at rampH, flat after.
 *   MEASURED (telemetry history.jsonl, the Bladeburner-route nodes BN6.1..BN10.2, 2026-10-01..14):
 *     the largest of home / purchased servers at ~4h into the node: 128 (BN7.1, BN14.2/3),
 *     256 (BN6.2, BN6.3, BN9.3), 4096 (BN10.2), all 1 core; home starts at 32-128GB.
 *   SOURCE (Server/data/servers.ts maxRamExponent): rooted world hosts at 5 ports add
 *     fulcrumtech 2^7..2^11, blade/omnitek/run4theh111z 2^5..2^9 (drawn per save).
 *   ASSUMED: gbMax lo 256 / mid 512 / hi 4096; rampH 4; duty 0.9 (ALLOC_DUTY: restarts, exec gaps).
 *   NOT PRICED: the batcher's money on that host (bbsim's money is not binding on this route).
 */
//   MEASURED LIVE (L3, 2026-10-16, BN7.2 16.6h in, /tel/stanek.txt): the charger holds helios, 256GB at
//     9 cores: 128 threads x coreBonus(9) 1.5 = highestCharge 192 (every fragment), against the ramp's
//     mid 512GB x 1 core = 256 (+33%: the cores were assumed 1 and the GB doubled; ln(257)/ln(193) =
//     the gift's increment ~5% too big). numCharge 8991 vs duty x age / k 8968 (-0.3%), duty 0.902.
//     `measured` is that charger (bladeThrAt({gbMax: 256, cores: 9}) plateaus at 192); the L3 epoch
//     decision charges at the LIVE threads x cores (stanekepoch.giftPathOf), never at the ramp; the L2
//     tables below were priced on `mid` before the measurement (stated there).
export const BLADE_HOST = { g0: 128, rampH: 4, gbMax: { lo: 256, mid: 512, hi: 4096 }, cores: 1, duty: 0.9, measured: { gb: 256, cores: 9, H: 192, duty: 0.902, at: 'BN7.2 2026-10-16T13:28Z helios' } }

/** The charger's host GB at tH hours into the node (BLADE_HOST's log-linear ramp). */
export function bladeHostGbAt(tH, { g0 = BLADE_HOST.g0, rampH = BLADE_HOST.rampH, gbMax } = {}) {
  const top = Math.max(g0, gbMax)
  return g0 * Math.pow(top / g0, Math.min(1, Math.max(0, tH) / rampH))
}

/**
 * chargeAt(tSec) -> { highestCharge, numCharge } of every charged fragment on the
 * Bladeburner route's charger (BLADE_HOST policy): k charged fragments round robin, the
 * mass integrated in 60s steps (memoised; tSec non-decreasing is the cheap path).
 */
export function bladeChargeAt({ gbMax, k, g0 = BLADE_HOST.g0, rampH = BLADE_HOST.rampH, cores = BLADE_HOST.cores, duty = BLADE_HOST.duty }) {
  const kk = Math.max(1, k)
  const thr = (tS) => threadsOf(bladeHostGbAt(tS / 3600, { g0, rampH, gbMax }), cores)
  const STEP = 60
  const mass = [0]
  return (tSec) => {
    const i = Math.floor(Math.max(0, tSec) / STEP)
    while (mass.length <= i) {
      const j = mass.length - 1
      mass.push(mass[j] + (duty * thr(j * STEP) * STEP) / kk)
    }
    const H = thr(i * STEP)
    const m = mass[i]
    return H > 0 && m > 0 ? { highestCharge: H, numCharge: m / H } : { highestCharge: 0, numCharge: 0 }
  }
}
/** The Bladeburner charger's threads (after the core bonus) at tSec: bladeChargeAt's host ramp, for chargeTrackOf. */
export const bladeThrAt = ({ gbMax, g0 = BLADE_HOST.g0, rampH = BLADE_HOST.rampH, cores = BLADE_HOST.cores }) => (tS) => threadsOf(bladeHostGbAt(tS / 3600, { g0, rampH, gbMax }), cores)
/**
 * THE BLADEBURNER ROUTE'S CHARGER OVER THE NODE — ONE MODEL for the route decision's Bladeburner arm with
 * the gift, before the accept (stanekepoch.routeGiftChainOptionsOf) and after it (progress.js routeGiftOf),
 * so the accept is re-priced on the trajectory it was taken on (live BN5.2 dry-run 2026-10-24: the chain on
 * this ramp 13.3h, the accepted pass on the live charger's H held — 0 at the accept, nothing charging — 19.7h
 * vs 17.9h declining). threads(tS) = the BLADE_HOST ramp at the node's age ageH + tS (bladeThrAt, gbMax mid),
 * floored at the live charger's power H (threads x core bonus; it never has less than it has now).
 */
export const bladeChargerThrOf = ({ ageH = 0, H = 0, gbMax = BLADE_HOST.gbMax.mid } = {}) => {
  const ramp = bladeThrAt({ gbMax })
  const a = Number.isFinite(ageH) && ageH > 0 ? ageH * 3600 : 0
  const h = Number.isFinite(H) && H > 0 ? H : 0
  return (tS) => Math.max(h, ramp(a + tS))
}

// ===========================================================================
// L2: THE RE-LAY WITHIN A LIFE — what it deletes, how the charge regrows, its price
// ===========================================================================
// The game deletes a fragment WITH its charge (StaneksGift.delete, StaneksGift.ts:112: the
// ActiveFragment is spliced out; clearGift drops every one) and a newly placed fragment starts at
// highestCharge 0, numCharge 0. An UNCHANGED fragment (same id, root, rotation) keeps its charge
// when only the others move, so stanek.js removes and places the difference (relayDiffOf), never
// clearGift. After a re-lay a new fragment's effect (CotMG/formulas/effect.ts:3:
// 1 + ln(h+1)/60 x ((n+1)/5)^0.07 x power x boost x nodePower) has its ln(h+1) back on the first
// full-size charge call (h = that call's threads), and its numCharge regrows by threads/h per call,
// one call per second (Stanek.ts:48-50), round robin over the k charged fragments (charge.js): about
// duty/k per second each. The cost is the ^0.07 term regrowing (and the round robin's k changing for
// every fragment), simulated in both simulators below, never assumed away.

/** A fragment's identity across a re-lay (StaneksGift.delete is by root; same id+root+rotation keeps its charge). */
export const fragKeyOf = (p) => `${p.id}@${p.x},${p.y},${p.rot ?? p.rotation}`
/** The re-lay from `active` to `target`: {keep, remove, place} (unchanged fragments kept with their charge). */
export function relayDiffOf(active, target) {
  const a = (active ?? []).map((p) => ({ id: p.id, x: p.x, y: p.y, rot: p.rot ?? p.rotation }))
  const t = target ?? []
  const tk = new Set(t.map(fragKeyOf))
  const ak = new Set(a.map(fragKeyOf))
  return { keep: a.filter((p) => tk.has(fragKeyOf(p))), remove: a.filter((p) => !tk.has(fragKeyOf(p))), place: t.filter((p) => !ak.has(fragKeyOf(p))) }
}

/**
 * THE PER-FRAGMENT CHARGE OVER A LAYOUT SCHEDULE (the simulators' charger): thrAt(tSec) threads (after
 * the core bonus) at `duty`, round robin over the charged fragments placed now. Per fragment its mass
 * (threads charged in total = highestCharge x numCharge, StaneksGift.charge's invariant), integrated in
 * `step`-second steps. relay(placed, t): an unchanged fragment keeps its mass, a changed or new one
 * starts at 0. clear(t): every mass 0 (an install). at(t): per placed fragment {highestCharge,
 * numCharge} ({0,0} for boosters and for none charged yet) — layoutMults' charge array. One layout
 * from t 0 is bladeChargeAt exactly (SG13).
 */
export function chargeTrackOf({ thrAt, duty = 1, step = 60 }) {
  let placed = []
  let st = []
  let i0 = 0
  const advance = (i) => {
    while (i0 < i) {
      const T = thrAt(i0 * step)
      const k = st.reduce((n, s) => n + (s ? 1 : 0), 0)
      if (k > 0 && T > 0) for (const s of st) if (s) s.mass += (duty * T * step) / k
      i0++
    }
  }
  const idx = (tSec) => Math.floor(Math.max(0, tSec) / step)
  return {
    relay(next, tSec) {
      advance(idx(tSec))
      const old = new Map(placed.map((p, j) => [fragKeyOf(p), st[j]]))
      placed = next.slice()
      st = placed.map((p) => (fragmentById(p.id)?.type === TYPE.Booster ? null : old.get(fragKeyOf(p)) ?? { mass: 0 }))
      return this
    },
    clear(tSec) {
      advance(idx(tSec))
      for (const s of st) if (s) s.mass = 0
      return this
    },
    /** L3: start from a LIVE charge state — masses[j] (highestCharge x numCharge of placed[j], 0 for a booster) at the track's current time. */
    seed(masses) {
      st.forEach((s, j) => {
        if (s) s.mass = Math.max(0, Number(masses?.[j]) || 0)
      })
      return this
    },
    masses: () => st.map((s) => (s ? s.mass : 0)),
    at(tSec) {
      const i = idx(tSec)
      advance(i)
      const H = thrAt(i * step)
      return st.map((s) => (s && s.mass > 0 && H > 0 ? { highestCharge: H, numCharge: s.mass / H } : { highestCharge: 0, numCharge: 0 }))
    },
    placed: () => placed,
  }
}

/** A phase boundary: {h} hours in (the node on the Bladeburner route, the life on the hacking route), {blackOps} done, {rank} reached. */
export function whenHolds(w, { tH = 0, blackOps = 0, rank = 0 } = {}) {
  if (!w) return false
  if (typeof w.h === 'number') return tH >= w.h
  if (typeof w.blackOps === 'number') return blackOps >= w.blackOps
  if (typeof w.rank === 'number') return rank >= w.rank
  return false
}
export const whenText = (w) => (!w ? 'never' : typeof w.h === 'number' ? `${w.h}h in` : typeof w.blackOps === 'number' ? `${w.blackOps} black ops done` : typeof w.rank === 'number' ? `rank ${w.rank}` : JSON.stringify(w))

/**
 * chargeLnOf with a RE-LAY tsH hours into the life (the hacking route's phase plan): `layout` from the
 * life's start, `layoutB` from tsH — B's fragments unchanged from `layout` keep their charge, the others
 * regrow from 0; the round robin over A's k, then B's. The switch is priced as a DIFFERENCE on one fine
 * rule (8-point midpoint per segment): chargeLnOf(A held) + [fine(A -> B) - fine(A -> A)], so a re-lay
 * that changes nothing is exactly chargeLnOf and the quadrature's own error cannot read as a price.
 * No layoutB, or tsH >= cycleH: chargeLnOf.
 */
export function chargeLnSwitchOf(o) {
  const { layout, layoutB, tsH, nodePower, homeGB, cores, fleetGB, hosts = null, f, cycleH, duty = ALLOC_DUTY, a = HACK_SHARE } = o
  if (!Array.isArray(layoutB) || !(tsH < cycleH)) return chargeLnOf(o)
  const held = chargeLnOf(o)
  const ts = Math.max(0, tsH)
  const ff = Math.max(0, f)
  const place = Array.isArray(hosts) ? chargerPlaceOf(ff * fleetGB, hosts) : chargerPlaceOf(ff * homeGB, [{ host: 'home', cores, capGb: ff * homeGB }])
  const rate = place.H > 0 ? place.power / place.H : 0
  const kA = compileLayout(layout).k
  const ch = (n) => ({ highestCharge: place.H, numCharge: n })
  const quad = Array.from({ length: 8 }, (_, i) => (i + 0.5) / 8)
  const tsS = ts * 3600 * duty
  const fine = (B) => {
    const kB = compileLayout(B).k
    const kept = new Set(relayDiffOf(layout, B).keep.map(fragKeyOf))
    const out = { inc: 0, exp: 0, rep: 0, lnH: 0, kept: kept.size, kB }
    for (const [s, e, isB] of [[0, ts, false], [ts, cycleH, true]]) {
      if (!(e > s)) continue
      const wq = (e - s) / cycleH / quad.length
      for (const q of quad) {
        const t = (s + q * (e - s)) * 3600 * duty
        const m = !isB ? layoutMults(layout, ch((rate * t) / kA), nodePower) : layoutMults(B, B.map((p) => ch(kept.has(fragKeyOf(p)) ? rate * (tsS / kA + (t - tsS) / kB) : (rate * (t - tsS)) / kB)), nodePower)
        out.inc += wq * (Math.log(m.hacking_speed) + Math.log(m.hacking) - Math.log(a / m.hacking_money + (1 - a) / m.hacking_grow))
        out.exp += wq * (Math.log(m.hacking_exp) + Math.log(m.hacking_speed))
        out.rep += wq * (Math.log(m.faction_rep) + Math.log(m.hacking))
        out.lnH += wq * Math.log(m.hacking)
      }
    }
    return out
  }
  const sw = fine(layoutB)
  const ref = fine(layout)
  return { ...held, lnIncome: held.lnIncome + sw.inc - ref.inc, lnExp: held.lnExp + sw.exp - ref.exp, lnRep: held.lnRep + sw.rep - ref.rep, lnHack: held.lnHack + sw.lnH - ref.lnH, relay: { tsH: ts, kept: sw.kept, kA, kB: sw.kB } }
}

/** The exit inputs of the phase plan "layoutA (default the placed ctx.layout) until tsH into each life, then layoutB" at f, from inputs measured on ctx.layout at ctx.fNow. */
export function switchInputsOf(base, ctx, f, layoutB, tsH, layoutA = ctx.layout) {
  return scaleByGift(base, chargeLnSwitchOf({ ...ctx, layout: layoutA, f, layoutB, tsH }), chargeLnOf({ ...ctx, f: ctx.fNow ?? 0 }))
}
/** The hacking route's in-life switch points priced (fractions of the life). FIXED, stated. */
export const HACK_PHASE_FRACS = [0.25, 0.5, 0.75]

/**
 * THE BLADEBURNER LAYOUT'S WEIGHTS: w[type] = -d ln(Bladeburner exit hours) / d ln(the
 * fragment's effect), MEASURED on bbsim (tools/sim/bbstanek.mjs --elastic: each fragment
 * type's calculateMults keys x1.5 and /1.5 from t 0, mean ln hours over 15 common seeds, BN11 SF6.3 SF7.1, the 5-infiltrator
 * fleet and the Go farm), central differences in ln. A type at 0 is not placed.
 */
export const BLADE_WEIGHTS = { [TYPE.Hacking]: 0.002, [TYPE.Strength]: 0.0722, [TYPE.Defense]: 0.0722, [TYPE.Dexterity]: 0.1943, [TYPE.Agility]: 0.3445, [TYPE.Charisma]: 0.0016, [TYPE.Bladeburner]: 0.8935 }
/**
 * THE BLADEBURNER ROUTE'S CHARGER IN THE GAME (BLADE_HOST's policy): the fraction of the
 * fleet's RAM that holds the biggest rooted host's room for the charger (chargerPlaceOf fills
 * the biggest host first), capped at BLADE_F_MAX so the actors and the batcher keep the rest.
 */
export const BLADE_F_MAX = 0.5
export function bladeChargeFOf(fleet) {
  const gb = (fleet ?? []).reduce((s, h) => s + (h.maxRam ?? 0), 0)
  // the host chargerPlaceOf fills first (most chargeable power: GB x core bonus), its room in GB
  const top = (fleet ?? []).reduce((b, h) => ((h.capGb ?? 0) * coreBonus(h.cores ?? 1) > (b?.capGb ?? 0) * coreBonus(b?.cores ?? 1) ? h : b), null)
  return gb > 0 && top ? Math.min(BLADE_F_MAX, (top.capGb ?? 0) / gb) : 0
}
/** The charge factor c the layout is optimised at: chargeFactor at gbMax mid, 10h in, k 5 (bbstanek.mjs designC). FIXED, stated. */
export const BLADE_DESIGN_C = 0.1505701248669863

/**
 * THE BLADEBURNER LAYOUTS SHIPPED: optimiseLayout(BLADE_WEIGHTS, BLADE_DESIGN_C) per grid,
 * keyed like LAYOUTS (`${width}x${height}|${nodePower}`); tools/sim/bbstanek.mjs --layout prints
 * them, SG9 re-derives and places them.
 */
export const BLADE_LAYOUTS = {
  '6x5|1': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 100, x: 2, y: 1, rot: 0}, {id: 12, x: 0, y: 2, rot: 1}, {id: 30, x: 4, y: 2, rot: 1}, {id: 103, x: 1, y: 3, rot: 2}], // best found, value 0.2668
  '6x6|1': [{id: 16, x: 0, y: 0, rot: 1}, {id: 103, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 106, x: 2, y: 1, rot: 0}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 1, y: 3, rot: 1}, {id: 10, x: 3, y: 3, rot: 3}, {id: 12, x: 4, y: 3, rot: 3}], // best found, value 0.2807
  '7x6|1': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 102, x: 3, y: 0, rot: 0}, {id: 30, x: 4, y: 1, rot: 0}, {id: 101, x: 0, y: 2, rot: 3}, {id: 100, x: 1, y: 2, rot: 0}, {id: 103, x: 5, y: 2, rot: 1}, {id: 14, x: 3, y: 3, rot: 2}, {id: 12, x: 2, y: 4, rot: 0}], // best found, value 0.2831
  '3x3|2': [{id: 16, x: 0, y: 0, rot: 1}, {id: 14, x: 1, y: 0, rot: 3}], // exact, value 0.2540
  '4x3|2': [{id: 14, x: 0, y: 0, rot: 1}, {id: 16, x: 1, y: 0, rot: 1}, {id: 12, x: 2, y: 0, rot: 3}], // exact, value 0.2880
  '5x4|0.75': [{id: 16, x: 0, y: 0, rot: 1}, {id: 14, x: 1, y: 0, rot: 3}, {id: 30, x: 3, y: 0, rot: 1}, {id: 10, x: 2, y: 2, rot: 2}], // exact, value 0.1639
  '5x5|0.75': [{id: 16, x: 0, y: 0, rot: 1}, {id: 14, x: 1, y: 0, rot: 3}, {id: 30, x: 3, y: 0, rot: 1}, {id: 12, x: 0, y: 2, rot: 1}, {id: 106, x: 1, y: 2, rot: 2}], // best found, value 0.1789
  '6x5|0.75': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 100, x: 2, y: 1, rot: 0}, {id: 12, x: 0, y: 2, rot: 1}, {id: 30, x: 4, y: 2, rot: 1}, {id: 103, x: 1, y: 3, rot: 2}], // best found, value 0.2059
  '6x5|1.5': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 100, x: 2, y: 1, rot: 0}, {id: 12, x: 0, y: 2, rot: 1}, {id: 30, x: 4, y: 2, rot: 1}, {id: 103, x: 1, y: 3, rot: 2}], // best found, value 0.3795
  '6x6|1.5': [{id: 16, x: 0, y: 0, rot: 1}, {id: 103, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 106, x: 2, y: 1, rot: 0}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 1, y: 3, rot: 1}, {id: 10, x: 3, y: 3, rot: 3}, {id: 12, x: 4, y: 3, rot: 3}], // best found, value 0.3978
  '7x6|1.5': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 102, x: 3, y: 0, rot: 0}, {id: 30, x: 5, y: 1, rot: 1}, {id: 101, x: 0, y: 2, rot: 3}, {id: 102, x: 1, y: 2, rot: 0}, {id: 14, x: 1, y: 3, rot: 0}, {id: 105, x: 4, y: 3, rot: 3}, {id: 12, x: 2, y: 4, rot: 0}], // best found, value 0.4061
  '6x5|1.3': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 100, x: 2, y: 1, rot: 0}, {id: 12, x: 0, y: 2, rot: 1}, {id: 30, x: 4, y: 2, rot: 1}, {id: 103, x: 1, y: 3, rot: 2}], // best found, value 0.3358
  '6x6|1.3': [{id: 16, x: 0, y: 0, rot: 1}, {id: 103, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 106, x: 2, y: 1, rot: 0}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 1, y: 3, rot: 1}, {id: 10, x: 3, y: 3, rot: 3}, {id: 12, x: 4, y: 3, rot: 3}], // best found, value 0.3524
  '7x6|1.3': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 102, x: 3, y: 0, rot: 0}, {id: 30, x: 5, y: 1, rot: 1}, {id: 101, x: 0, y: 2, rot: 3}, {id: 102, x: 1, y: 2, rot: 0}, {id: 14, x: 1, y: 3, rot: 0}, {id: 105, x: 4, y: 3, rot: 3}, {id: 12, x: 2, y: 4, rot: 0}], // best found, value 0.3596
  '7x6|0.5': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 30, x: 4, y: 0, rot: 1}, {id: 12, x: 5, y: 0, rot: 3}, {id: 100, x: 2, y: 1, rot: 1}, {id: 101, x: 0, y: 2, rot: 3}, {id: 14, x: 1, y: 3, rot: 3}, {id: 102, x: 3, y: 3, rot: 2}, {id: 101, x: 3, y: 4, rot: 2}], // best found, value 0.1505
  '7x7|0.5': [{id: 16, x: 0, y: 0, rot: 1}, {id: 14, x: 1, y: 0, rot: 3}, {id: 100, x: 3, y: 0, rot: 3}, {id: 12, x: 5, y: 0, rot: 3}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 3, y: 2, rot: 1}, {id: 102, x: 5, y: 2, rot: 1}, {id: 105, x: 1, y: 3, rot: 3}, {id: 106, x: 4, y: 4, rot: 3}, {id: 10, x: 1, y: 5, rot: 2}], // best found, value 0.1540
  '8x7|0.5': [{id: 16, x: 0, y: 0, rot: 1}, {id: 14, x: 1, y: 0, rot: 3}, {id: 10, x: 3, y: 0, rot: 0}, {id: 100, x: 5, y: 0, rot: 1}, {id: 100, x: 3, y: 1, rot: 3}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 6, y: 2, rot: 1}, {id: 101, x: 1, y: 3, rot: 1}, {id: 12, x: 3, y: 3, rot: 1}, {id: 100, x: 4, y: 3, rot: 1}, {id: 101, x: 4, y: 5, rot: 2}], // best found, value 0.1552
  '5x5|0.9': [{id: 16, x: 0, y: 0, rot: 1}, {id: 14, x: 1, y: 0, rot: 3}, {id: 10, x: 3, y: 0, rot: 1}, {id: 12, x: 0, y: 2, rot: 1}, {id: 30, x: 3, y: 2, rot: 1}, {id: 1, x: 1, y: 3, rot: 0}], // best found, value 0.2113
  '6x5|0.9': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 100, x: 2, y: 1, rot: 0}, {id: 12, x: 0, y: 2, rot: 1}, {id: 30, x: 4, y: 2, rot: 1}, {id: 103, x: 1, y: 3, rot: 2}], // best found, value 0.2428
  '6x6|0.9': [{id: 16, x: 0, y: 0, rot: 1}, {id: 103, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 106, x: 2, y: 1, rot: 0}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 1, y: 3, rot: 1}, {id: 10, x: 3, y: 3, rot: 3}, {id: 12, x: 4, y: 3, rot: 3}], // best found, value 0.2557
  '4x4|0.75': [{id: 16, x: 0, y: 0, rot: 1}, {id: 30, x: 2, y: 0, rot: 1}, {id: 14, x: 0, y: 2, rot: 0}], // exact, value 0.1492
  '6x6|1.02': [{id: 16, x: 0, y: 0, rot: 1}, {id: 103, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 106, x: 2, y: 1, rot: 0}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 1, y: 3, rot: 1}, {id: 10, x: 3, y: 3, rot: 3}, {id: 12, x: 4, y: 3, rot: 3}], // best found, value 0.2856
  '7x6|1.02': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 102, x: 3, y: 0, rot: 0}, {id: 30, x: 4, y: 1, rot: 0}, {id: 101, x: 0, y: 2, rot: 3}, {id: 100, x: 1, y: 2, rot: 0}, {id: 103, x: 5, y: 2, rot: 1}, {id: 14, x: 3, y: 3, rot: 2}, {id: 12, x: 2, y: 4, rot: 0}], // best found, value 0.2881
  '7x7|1.02': [{id: 16, x: 0, y: 0, rot: 1}, {id: 14, x: 1, y: 0, rot: 3}, {id: 100, x: 3, y: 0, rot: 3}, {id: 12, x: 5, y: 0, rot: 3}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 3, y: 2, rot: 1}, {id: 102, x: 5, y: 2, rot: 1}, {id: 105, x: 1, y: 3, rot: 3}, {id: 106, x: 4, y: 4, rot: 3}, {id: 10, x: 1, y: 5, rot: 2}], // best found, value 0.2948
  '6x6|2': [{id: 16, x: 0, y: 0, rot: 1}, {id: 103, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 106, x: 2, y: 1, rot: 0}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 1, y: 3, rot: 1}, {id: 10, x: 3, y: 3, rot: 3}, {id: 12, x: 4, y: 3, rot: 3}], // best found, value 0.5041
  '7x6|2': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 102, x: 3, y: 0, rot: 0}, {id: 30, x: 5, y: 1, rot: 1}, {id: 101, x: 0, y: 2, rot: 3}, {id: 102, x: 1, y: 2, rot: 0}, {id: 14, x: 1, y: 3, rot: 0}, {id: 105, x: 4, y: 3, rot: 3}, {id: 12, x: 2, y: 4, rot: 0}], // best found, value 0.5149
  '7x7|2': [{id: 16, x: 0, y: 0, rot: 1}, {id: 14, x: 1, y: 0, rot: 3}, {id: 100, x: 3, y: 0, rot: 3}, {id: 12, x: 5, y: 0, rot: 3}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 3, y: 2, rot: 1}, {id: 102, x: 5, y: 2, rot: 1}, {id: 105, x: 1, y: 3, rot: 3}, {id: 106, x: 4, y: 4, rot: 3}, {id: 10, x: 1, y: 5, rot: 2}], // best found, value 0.5221
  '5x5|0.5': [{id: 16, x: 0, y: 0, rot: 1}, {id: 14, x: 1, y: 0, rot: 3}, {id: 30, x: 3, y: 0, rot: 1}, {id: 12, x: 0, y: 2, rot: 1}, {id: 106, x: 1, y: 2, rot: 2}], // best found, value 0.1228
  '6x5|0.5': [{id: 16, x: 0, y: 0, rot: 1}, {id: 10, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 100, x: 2, y: 1, rot: 0}, {id: 12, x: 0, y: 2, rot: 1}, {id: 30, x: 4, y: 2, rot: 1}, {id: 103, x: 1, y: 3, rot: 2}], // best found, value 0.1415
  '6x6|0.5': [{id: 16, x: 0, y: 0, rot: 1}, {id: 103, x: 1, y: 0, rot: 0}, {id: 14, x: 4, y: 0, rot: 3}, {id: 106, x: 2, y: 1, rot: 0}, {id: 101, x: 0, y: 2, rot: 3}, {id: 30, x: 1, y: 3, rot: 1}, {id: 10, x: 3, y: 3, rot: 3}, {id: 12, x: 4, y: 3, rot: 3}], // best found, value 0.1496
}

// ===========================================================================
// THE IN-GAME SURFACE: what stanek.js (accept, place, launch the charger),
// charge.js (the 2.0GB worker), act.js (the purchase gate), progress.js (the
// charging allocation, priced by the exit), batch.js (the home hold) and
// tools/healthcheck.mjs read. Still pure: no ns.
// ===========================================================================
export const STANEK_FILE = '/tel/stanek.txt'
export const CHARGE_FILE = '/tel/charge.txt'
export const NFG = 'NeuroFlux Governor'
export const GENESIS = "Stanek's Gift - Genesis" // Augmentation/Enums.ts (sfgate.STANEKS_GIFT)

/**
 * WHERE THE STACK ACCEPTS THE GIFT (policy, stated): BitNode 13 — the user's
 * choice (2026-10-10, BN13 after BN7.1) and the gameplan's 'stanek' route there
 * (hacking route + gift, tools/sim/gameplan/routes.mjs). Elsewhere with SF13 the
 * gameplan prices the gift per node and nothing in-game reads that pricing yet:
 * stanek.js publishes `want: false` with that reason and never accepts there.
 */
export const GIFT_NODES = new Set([13])
/**
 * THE GIFT WHERE THERE IS NO BLADEBURNER ROUTE TO CHAIN IT TO, PRICED (BitNode 8: BladeburnerRank 0,
 * so the L4 route+gift chain never runs and the gift used to be declined unpriced — the entry dry-run,
 * tools/sim/entry, 2026-10-24). tools/sim/gameplan/bn8.mjs giftTable(): per `${node}|${SF13}` BN8's whole
 * exit [withoutH, withH] — the stock-only model's policy search never accepting vs accepting at the
 * node's start (Genesis x0.9 on every multiplier, the 2x3 grid's layout charged on home x f, each life's
 * charge from zero after its install, the charger calibrated on 43 measured gift lives: GIFT_CAL), from
 * the plan's BN8.2 entry. NOT CALIBRATED in BN8 (no BN8 life has run the gift). Pure data, no RAM;
 * tools/test/bn8cal.test.mjs B84 holds it to bn8.mjs. A node in STOCK_GIFT_NODES without an entry for
 * its SF13 level HOLDS the option (pending): never a silent decline.
 */
export const STOCK_GIFT_NODES = new Set([8])
export const STOCK_GIFT_PRICED = { '8|1': [31.68, 30.44], '8|2': [31.68, 30.44], '8|3': [31.68, 30.44] }
/**
 * THE MANUAL PRICING HOLD (reversible, stated): nodes where the option is held open
 * by hand while something is priced — act.js refuses every non-NeuroFlux buyaug /
 * graft / install while the gift is unaccepted, and stanek.js does NOT accept.
 * Empty: BN11's hold (2026-10-15) is now the priced decision below.
 */
export const GIFT_HOLD_NODES = new Set([]) // BN10.3's hold (2026-10-18) is now the priced chain: hack + gift priced (hackChainGiftInputsOf), the mandate's combat leg (sleeveplan.covenantCombatLegOf), an unpriced chain HOLDS (giftWantOf)

/**
 * THE GIFT ON THE BLADEBURNER ROUTE, PRICED (tools/sim/bbstanek.mjs --table -> tools/sim/
 * gameplan/.cache/bbstanek.json; tools/sim/gameplan/bladestanek.mjs): per `${node}|${SF13}|${SF7}`
 * (SF6 3) the Bladeburner exit WITHOUT the gift and WITH it accepted at the node's start —
 * bbsim, both arms on 9 shared seeds, the planner's 5-infiltrator fleet and Go farm, the
 * layout BLADE_LAYOUTS, the charger BLADE_HOST at gbMax mid — [withoutH, withH] in simulated
 * hours (the live leg is k x the leg). NOT CALIBRATED: no Bladeburner node has run with the
 * gift. Pure data so the decision costs no RAM; SG9 checks it against the gameplan's table.
 */
export const BLADE_GIFT_PRICED = {
  '1|1|1': [11.579, 9.83], '1|1|2': [11.578, 9.648], '1|1|3': [9.716, 8.305], '1|2|1': [11.579, 9.764], '1|2|2': [11.578, 9.622], '1|2|3': [9.716, 8.286], '1|3|1': [11.579, 9.769], '1|3|2': [11.578, 9.45], '1|3|3': [9.716, 8.102],
  '2|1|1': [11.579, 9.786], '2|1|2': [11.575, 9.627], '2|1|3': [9.716, 8.487], '2|2|1': [11.579, 9.786], '2|2|2': [11.575, 9.627], '2|2|3': [9.716, 8.487], '2|3|1': [11.579, 9.384], '2|3|2': [11.575, 8.983], '2|3|3': [9.716, 8.367],
  '3|1|1': [11.579, 10.759], '3|1|2': [11.575, 10.32], '3|1|3': [9.716, 9.044], '3|2|1': [11.579, 10.56], '3|2|2': [11.575, 10.243], '3|2|3': [9.716, 8.932], '3|3|1': [11.579, 10.321], '3|3|2': [11.575, 9.988], '3|3|3': [9.716, 8.822],
  '4|1|1': [11.579, 9.092], '4|1|2': [11.578, 8.697], '4|1|3': [9.716, 7.524], '4|2|1': [11.579, 8.703], '4|2|2': [11.578, 8.488], '4|2|3': [9.716, 7.388], '4|3|1': [11.579, 8.664], '4|3|2': [11.578, 8.517], '4|3|3': [9.716, 7.326],
  '5|1|1': [11.579, 9.059], '5|1|2': [11.578, 9.1], '5|1|3': [9.716, 7.523], '5|2|1': [11.579, 9.047], '5|2|2': [11.578, 9.053], '5|2|3': [9.716, 7.729], '5|3|1': [11.579, 9.179], '5|3|2': [11.578, 9.081], '5|3|3': [9.716, 7.993],
  '6|1|1': [11.579, 11.217], '6|1|2': [11.575, 10.586], '6|1|3': [9.716, 8.999], '6|2|1': [11.579, 10.598], '6|2|2': [11.575, 10.728], '6|2|3': [9.716, 9.226], '6|3|1': [11.579, 10.706], '6|3|2': [11.575, 10.845], '6|3|3': [9.716, 9.126],
  '7|1|1': [21.505, 19.96], '7|1|2': [21.429, 19.727], '7|1|3': [18.844, 16.508], '7|2|1': [21.505, 19.881], '7|2|2': [21.429, 18.245], '7|2|3': [18.844, 16.302], '7|3|1': [21.505, 18.781], '7|3|2': [21.429, 18.758], '7|3|3': [18.844, 15.715],
  '9|1|1': [22.137, 21.313], '9|1|2': [21.28, 19.348], '9|1|3': [18.727, 17.44], '9|2|1': [22.137, 20.652], '9|2|2': [21.28, 19.607], '9|2|3': [18.727, 16.952], '9|3|1': [22.137, 20.151], '9|3|2': [21.28, 18.694], '9|3|3': [18.727, 16.948],
  '10|1|1': [21.914, 20.711], '10|1|2': [21.864, 19.396], '10|1|3': [19.26, 17.862], '10|2|1': [21.914, 20.192], '10|2|2': [21.864, 19.928], '10|2|3': [19.26, 17.668], '10|3|1': [21.914, 20.123], '10|3|2': [21.864, 19.348], '10|3|3': [19.26, 17.772],
  '11|1|1': [11.579, 9.83], '11|1|2': [11.575, 9.659], '11|1|3': [9.716, 8.305], '11|2|1': [11.579, 9.764], '11|2|2': [11.575, 9.622], '11|2|3': [9.716, 8.288], '11|3|1': [11.579, 9.769], '11|3|2': [11.575, 9.45], '11|3|3': [9.716, 8.114],
  '12|1|1': [12.25, 9.998], '12|1|2': [11.438, 9.321], '12|1|3': [10.142, 8.703], '12|2|1': [12.25, 10.099], '12|2|2': [11.438, 9.717], '12|2|3': [10.142, 8.097], '12|3|1': [12.25, 9.982], '12|3|2': [11.438, 9.409], '12|3|3': [10.142, 8.099],
  '13|0|1': [36.927, 21.992], '13|0|2': [34.296, 22.383], '13|0|3': [29.563, 20.292], '13|1|1': [36.927, 22.658], '13|1|2': [34.296, 21.355], '13|1|3': [29.563, 20.217], '13|2|1': [36.927, 22.183], '13|2|2': [34.296, 21.02], '13|2|3': [29.563, 19.182], '13|3|1': [36.927, 23.727], '13|3|2': [34.296, 21.269], '13|3|3': [29.563, 18.52],
  '14|1|1': [18.99, 18.739], '14|1|2': [18.025, 17.222], '14|1|3': [16.244, 16.242], '14|2|1': [18.99, 17.673], '14|2|2': [18.025, 16.515], '14|2|3': [16.244, 15.255], '14|3|1': [18.99, 18.13], '14|3|2': [18.025, 16.394], '14|3|3': [16.244, 15.037],
}

/**
 * THE BLADEBURNER ROUTE'S PHASE PLANS (L2), PRICED BY bbsim (tools/sim/stanekphase.mjs --blade, then
 * --refine on fresh seeds): per node|SF13|SF7 cell (the levels HELD on entry), the early layout from
 * the node's start, the late layout and the condition it is re-laid at, and the exit with the switch
 * vs the exit on the early layout held (the incumbent BLADE_LAYOUTS: the same trajectory until the
 * switch, so the pairing is tight) — mean paired d over `n` seeds and its standard error. The re-lay
 * keeps the unchanged fragments' charge; the rest regrow (chargeTrackOf). Listed only where d + 2se < 0
 * on the refining seeds (two standard errors below zero, stated: several candidates are tried per cell,
 * so one SE let noise through — BN7.2's optimised early layout read -0.26 +- 0.15h and the same layout
 * +0.47 +- 0.13h in BN7.3). NOT CALIBRATED: no node has re-laid. Priced on BLADE_HOST mid (highestCharge
 * +33% vs the measured charger) and bbSpec's start (the Go farm at 21.6k/h vs 35.1k/h live, 5 infiltrators):
 * L3 (stanekepoch.js) supersedes this table on the live state wherever a fresh epoch decision exists;
 * the table is then a candidate source and the fallback.
 * Pure data so the decision costs no RAM.
 */
export const BLADE_PHASE_PRICED = {
  // 2026-10-16, 200 fresh seeds (101..300) each: the incumbent until the black op, then the late layout.
  // 7|1|2 = BN7.3 (SF7.2 held); 11|1|3 = BN11.2 after BN7.3 (SF7.3 held); 11|1|1 = BN11 with SF7.1.
  // BN7.2 (7|1|1): no plan won by 2se (best incumbent -> late at 9 black ops -0.021 +- 0.034h): not listed.
  '11|1|3': { early: [{id: 16, x: 0, y: 0, rot: 1},{id: 10, x: 1, y: 0, rot: 0},{id: 14, x: 4, y: 0, rot: 3},{id: 100, x: 2, y: 1, rot: 0},{id: 12, x: 0, y: 2, rot: 1},{id: 30, x: 4, y: 2, rot: 1},{id: 103, x: 1, y: 3, rot: 2}], late: [{id: 101, x: 0, y: 0, rot: 0},{id: 14, x: 4, y: 0, rot: 3},{id: 16, x: 1, y: 1, rot: 1},{id: 105, x: 2, y: 1, rot: 3},{id: 30, x: 0, y: 2, rot: 1},{id: 101, x: 2, y: 3, rot: 2}], when: {blackOps: 6}, withoutH: 8.278, withH: 8.242, d: -0.036, se: 0.009, n: 200 },
  '11|1|1': { early: [{id: 16, x: 0, y: 0, rot: 1},{id: 10, x: 1, y: 0, rot: 0},{id: 14, x: 4, y: 0, rot: 3},{id: 100, x: 2, y: 1, rot: 0},{id: 12, x: 0, y: 2, rot: 1},{id: 30, x: 4, y: 2, rot: 1},{id: 103, x: 1, y: 3, rot: 2}], late: [{id: 101, x: 0, y: 0, rot: 0},{id: 14, x: 4, y: 0, rot: 3},{id: 16, x: 1, y: 1, rot: 1},{id: 105, x: 2, y: 1, rot: 3},{id: 30, x: 0, y: 2, rot: 1},{id: 101, x: 2, y: 3, rot: 2}], when: {blackOps: 9}, withoutH: 9.807, withH: 9.784, d: -0.0225, se: 0.0084, n: 200 },
  '7|1|2': { early: [{id: 16, x: 0, y: 0, rot: 1},{id: 14, x: 1, y: 0, rot: 3},{id: 10, x: 3, y: 0, rot: 1},{id: 12, x: 0, y: 2, rot: 1},{id: 30, x: 3, y: 2, rot: 1},{id: 1, x: 1, y: 3, rot: 0}], late: [{id: 105, x: 0, y: 0, rot: 2},{id: 16, x: 3, y: 0, rot: 1},{id: 100, x: 1, y: 1, rot: 1},{id: 14, x: 0, y: 3, rot: 2},{id: 101, x: 1, y: 3, rot: 2}], when: {blackOps: 6}, withoutH: 19.175, withH: 19.104, d: -0.0707, se: 0.0194, n: 200 },
}
/** The cell's phase plan where it is priced to win and legal on this grid, else null. */
export function bladePhasePlanOf({ node, l13, l7, width, height }) {
  const key = `${node}|${l13}|${Math.max(1, Math.min(3, l7 ?? 1))}`
  const e = BLADE_PHASE_PRICED[key]
  if (!e || !(e.d + 2 * (e.se ?? Infinity) < 0)) return null
  if (typeof width === 'number' && (!layoutFits(e.early, width, height) || !layoutFits(e.late, width, height))) return null
  return { planned: true, key, early: e.early, late: e.late, when: e.when, whenText: whenText(e.when), d: e.d, se: e.se, n: e.n, withH: e.withH, withoutH: e.withoutH, earlyKey: layoutKeyOf(e.early), lateKey: layoutKeyOf(e.late) }
}

/** Fresh enough to act on: /tel/progress.txt's route, this node and life (progress.js routeOut). */
export const PROGRESS_FILE = '/tel/progress.txt'
export function routeOfProgress(text, resetInfo, now = Date.now(), maxAgeMin = 30) {
  let rec = null
  try {
    rec = JSON.parse(text || 'null')
  } catch {
    return null
  }
  const r = rec?.route
  if (!r || r.node !== resetInfo?.currentNode || r.lastAugReset !== resetInfo?.lastAugReset) return null
  if (!(now - Date.parse(rec.at ?? '') < maxAgeMin * 60e3)) return null
  return r.route === 'blade' || r.route === 'hack' ? r.route : null
}

/**
 * THE ROUTE DECISION'S GIFT VERDICT (L4 chain): /tel/progress.txt route.gift.accept of this node and life,
 * fresh — {accept, why} — or null (none published: the table decides, giftWantOf).
 */
export function giftVerdictOfProgress(text, resetInfo, now = Date.now(), maxAgeMin = 30) {
  let rec = null
  try {
    rec = JSON.parse(text || 'null')
  } catch {
    return null
  }
  const r = rec?.route
  if (!r || r.node !== resetInfo?.currentNode || r.lastAugReset !== resetInfo?.lastAugReset) return null
  if (!(now - Date.parse(rec.at ?? '') < maxAgeMin * 60e3)) return null
  const g = r.gift
  // a chain published with accept null (the route decision unpriced) is a verdict too: HOLD, never a decline
  return g && g.chain === true && (typeof g.accept === 'boolean' || g.accept === null) ? { accept: g.accept, chain: true, why: g.why ?? null } : null
}

/**
 * WHETHER THE STACK WANTS THE GIFT HERE (the per-node decision, at its start):
 *   BitNode 13 (GIFT_NODES)        the hacking route + gift (the gameplan's 'stanek' route) — basis 'hack'
 *   BitNode 8 (STOCK_GIFT_NODES)   STOCK_GIFT_PRICED (bn8.mjs): accept iff withH < withoutH — basis 'hack';
 *                                  no entry for the SF13 level: HOLD (pending)
 *   the Bladeburner route (route)  BLADE_GIFT_PRICED: accept iff withH < withoutH — basis 'blade'
 *   route unknown (no fresh progress.txt of this node and life) and the Bladeburner gift wins here:
 *                                  HOLD (pending) — never accept on an unknown route, keep the option
 *   otherwise                      no (the hacking route's gift outside BN13 is not priced in-game)
 * Returns { want, pending, basis, priced: {withoutH, withH, d} | null, why }.
 */
export function giftWantOf({ node, l13, l7, route, verdict = null }) {
  if (GIFT_NODES.has(node)) return { want: true, pending: false, basis: 'hack', priced: null, why: `BitNode ${node}: the stack accepts the gift (GIFT_NODES, the hacking route + gift)` }
  if (STOCK_GIFT_NODES.has(node)) {
    const s = STOCK_GIFT_PRICED[`${node}|${l13}`] ?? null
    if (!s) return { want: false, pending: true, basis: 'hack', priced: null, why: `BitNode ${node}: the gift is not priced at SF13.${l13} (stanekplan.STOCK_GIFT_PRICED, tools/sim/gameplan/bn8.mjs --gift-table): HELD open, not accepted` }
    const p = { withoutH: s[0], withH: s[1], d: +(s[1] - s[0]).toFixed(4) }
    const win = p.d < 0
    return { want: win, pending: false, basis: win ? 'hack' : null, priced: p, why: `BitNode ${node}: the exit ${p.withoutH}h never accepting vs ${p.withH}h accepting at the start (bn8.mjs, the stock-only model, STOCK_GIFT_PRICED) — ${win ? 'accept' : 'never'}` }
  }
  const e = BLADE_GIFT_PRICED[`${node}|${l13}|${Math.max(1, Math.min(3, l7 ?? 1))}`] ?? null
  const priced = e ? { withoutH: e[0], withH: e[1], d: +(e[1] - e[0]).toFixed(4) } : null
  const wins = !!priced && priced.d < 0
  const txt = priced ? `the Bladeburner exit ${priced.withoutH}h without the gift vs ${priced.withH}h with it (bbsim, shared seeds, NOT CALIBRATED; stanekplan.BLADE_GIFT_PRICED)` : 'the Bladeburner route with the gift is not priced for this node/SF13/SF7'
  // THE CHAIN (L4, the route decision prices blade+gift, blade without and hack as one decision): where
  // progress.js's route record of this node and life carries its verdict, the accept follows the chosen arm
  if (verdict && verdict.chain === true && verdict.accept === null) return { want: false, pending: true, basis: null, priced, chained: true, why: `the chained route decision has not priced the gift (an arm unpriced): HELD open, not accepted (${String(verdict.why ?? '').slice(0, 200)})` }
  if (verdict && (route === 'blade' || route === 'hack') && typeof verdict.accept === 'boolean') {
    const vw = `the route decision priced the gift with the route (${String(verdict.why ?? '').slice(0, 200)})`
    return { want: verdict.accept, pending: false, basis: verdict.accept ? route : null, priced, chained: true, why: verdict.accept ? `the '${route}' route with the gift: accept — ${vw}` : `the '${route}' route without the gift: never — ${vw}` }
  }
  if (route === 'blade') return { want: wins, pending: false, basis: 'blade', priced, why: wins ? `the Bladeburner route: accept — ${txt}` : `the Bladeburner route: never — ${txt}` }
  if (route == null && wins) return { want: false, pending: true, basis: 'blade', priced, why: `route unknown (no fresh /tel/progress.txt route of this node and life): HELD open, not accepted — on the Bladeburner route ${txt}` }
  return { want: false, pending: false, basis: null, priced, why: route === 'hack' ? `the hacking route outside BitNode 13: the gift is not priced in-game there (GIFT_NODES ${[...GIFT_NODES].join(', ')})` : `not wanted: ${txt}` }
}

const namesOf = (owned) => (owned == null ? [] : typeof owned.keys === 'function' ? [...owned.keys()] : Array.isArray(owned) ? owned.map((x) => x?.name ?? x) : Object.keys(owned))

/**
 * The gift's state from ns.getResetInfo() (ownedAugs = the INSTALLED set; acceptGift
 * applies Genesis as installed at once — NetscriptFunctions/Stanek.ts acceptGift ->
 * applyAugmentation — so a fresh getResetInfo after the accept reads it).
 *   available  Player.canAccessCotMG: in BN13 or SF13 held (BitNodeUtils.ts:17) — the caller
 *              passes sfgate.canAccessCotMG(resetInfo)
 *   want       available AND this node is one the stack accepts in (GIFT_NODES)
 *   accepted   Genesis installed
 *   forfeited  not accepted and a non-NeuroFlux augmentation INSTALLED: canAcceptStaneksGift
 *              (CotMG/Helper.tsx) can never pass again in this node. A QUEUED non-NFG aug
 *              blocks it too — invisible here (getResetInfo has no queue); stanek.js reads
 *              it from acceptGift's refusal.
 */
export function giftStateOf(resetInfo, available, route = null, verdict = null) {
  // The capability rule lives in sfgate.js (canAccessCotMG); the caller passes it. A
  // missing answer throws: "could not tell" must never read as "no Church here".
  if (typeof available !== 'boolean') throw new Error('giftStateOf(resetInfo, available, route): pass sfgate.canAccessCotMG(resetInfo)')
  const node = resetInfo?.currentNode ?? null
  const names = namesOf(resetInfo?.ownedAugs)
  const accepted = names.includes(GENESIS)
  const blocking = accepted ? [] : names.filter((n) => n !== NFG)
  const sf = (n) => (typeof resetInfo?.ownedSF?.get === 'function' ? resetInfo.ownedSF.get(n) ?? 0 : 0)
  const w = available ? giftWantOf({ node, l13: sf(13), l7: sf(7), route, verdict }) : { want: false, pending: false, basis: null, priced: null, why: null }
  const want = available && w.want
  const hold = available && !accepted && !want && (w.pending || GIFT_HOLD_NODES.has(node))
  // the basis the gift serves. ACCEPTED: the route the stack acts on (L4, 2026-10-16: the gift is an input
  // to the priced route decision, never a pin — so a route switch moves the layout decision with it:
  // 'blade' -> the L3 epoch, 'hack' -> L1's per-life layout and the f allocation); no route known yet:
  // BN13's is the hacking route's, anywhere else only the Bladeburner route accepts.
  const basis = !available ? null : (accepted || (want && w.chained)) && (route === 'hack' || route === 'blade') ? route : GIFT_NODES.has(node) || STOCK_GIFT_NODES.has(node) ? 'hack' : accepted || want || hold ? 'blade' : null
  return {
    node,
    l13: sf(13),
    l7: sf(7),
    available,
    want,
    hold,
    basis,
    route,
    priced: w.priced,
    wantWhy: w.why,
    accepted,
    forfeited: !accepted && blocking.length > 0,
    blocking,
    why: !available
      ? 'no access to the Church (not BitNode 13, no Source-File 13)'
      : !want && !accepted
        ? hold
          ? `BitNode ${node}: ${w.pending ? w.why : 'held by hand (stanekplan.GIFT_HOLD_NODES)'} — non-NeuroFlux augmentation orders are held so the option stays open`
          : `BitNode ${node}: ${w.why}`
        : accepted
          ? `accepted (${GENESIS} installed)`
          : blocking.length
            ? `FORFEITED: ${blocking.length} non-NeuroFlux augmentation(s) installed (${blocking.slice(0, 3).join(', ')}) — canAcceptStaneksGift can never pass in this node`
            : `not accepted yet — acceptable (nothing but NeuroFlux installed); wanted: ${w.why}`,
  }
}

/**
 * THE PURCHASE GATE (act.js runs it on every buyaug / graft / install order). In a
 * node the stack accepts the gift in, while the gift is not accepted and can still
 * be, every order that would put a non-NeuroFlux augmentation into the installed or
 * queued set is REFUSED: a queued one blocks acceptGift (canAcceptStaneksGift reads
 * installed + queued), an installed one forfeits it for the node, a graft installs
 * at once. The install is refused too: with nothing but NFG queued it buys nothing
 * the accept could not wait for; with anything else queued it IS the forfeit.
 * Forfeited already: NOT blocked (a block can no longer save the gift and would
 * stall the node) but flagged — act.js publishes it and the health check fails.
 * Returns { allow, why, forfeited }.
 */
export function giftOrderGate(state, order) {
  const kind = order?.kind
  if (!['buyaug', 'graft', 'install'].includes(kind)) return { allow: true, why: null, forfeited: false }
  if (!(state?.want || state?.hold) || state.accepted) return { allow: true, why: null, forfeited: false }
  if (state.forfeited) return { allow: true, forfeited: true, why: `GIFT FORFEITED (${state.why}) — the ${kind} order is not blocked: the gift can no longer be accepted in this node` }
  const aug = kind === 'buyaug' ? String(order?.args?.[1] ?? '') : kind === 'graft' ? String(order?.args?.[0] ?? '') : null
  if (kind === 'buyaug' && aug === NFG) return { allow: true, why: 'NeuroFlux Governor never blocks the gift', forfeited: false }
  return {
    allow: false,
    forfeited: false,
    why: `STANEK GATE${state.want ? '' : ' (PRICING HOLD)'}: Stanek's Gift is not accepted yet in BitNode ${state.node} — ${kind}${aug ? ` '${aug}'` : ''} refused: ${kind === 'install' ? 'an install before the accept forfeits the gift for the node (or buys nothing)' : 'a non-NeuroFlux augmentation queued or grafted blocks acceptGift (canAcceptStaneksGift) and, installed, forfeits it for the node'}; ${state.want ? `stanek.js accepts it (${STANEK_FILE})` : 'the option is held open while the gift is priced here'}`,
  }
}

/**
 * THE LAYOUTS SHIPPED: optimiseLayout at the gameplan's design point (stanek.mjs
 * layoutFor: LAYOUT_HG 2.5, LAYOUT_F 0.2, LAYOUT_N 1000, mid world, budget 4e5 — best
 * found, not proved optimal past 5x5), keyed `${width}x${height}|${nodePower}`.
 * Precomputed because the search takes ~0.5s, which in-game would block the page.
 * BitNode 13 (extra size 1, power 2) at SF13 0..3. tools/test/stanekgame.test.mjs
 * (SG2) re-derives every entry from layoutFor and places each legally.
 */
export const LAYOUTS = {
  '6x5|2': [{ id: 5, x: 0, y: 0, rot: 0 }, { id: 105, x: 2, y: 0, rot: 2 }, { id: 1, x: 4, y: 0, rot: 1 }, { id: 0, x: 0, y: 1, rot: 1 }, { id: 107, x: 2, y: 2, rot: 0 }, { id: 25, x: 4, y: 2, rot: 3 }, { id: 7, x: 0, y: 3, rot: 0 }],
  '6x6|2': [{ id: 0, x: 0, y: 0, rot: 1 }, { id: 103, x: 1, y: 0, rot: 2 }, { id: 25, x: 3, y: 0, rot: 2 }, { id: 100, x: 0, y: 2, rot: 3 }, { id: 1, x: 2, y: 2, rot: 0 }, { id: 101, x: 4, y: 2, rot: 1 }, { id: 7, x: 0, y: 4, rot: 0 }, { id: 5, x: 2, y: 4, rot: 0 }],
  '7x6|2': [{ id: 0, x: 0, y: 0, rot: 1 }, { id: 1, x: 1, y: 0, rot: 0 }, { id: 103, x: 3, y: 0, rot: 0 }, { id: 5, x: 3, y: 1, rot: 1 }, { id: 101, x: 0, y: 2, rot: 3 }, { id: 105, x: 2, y: 2, rot: 1 }, { id: 25, x: 5, y: 2, rot: 1 }, { id: 105, x: 1, y: 3, rot: 1 }, { id: 7, x: 5, y: 3, rot: 3 }],
  '7x7|2': [{ id: 0, x: 0, y: 0, rot: 1 }, { id: 5, x: 1, y: 0, rot: 0 }, { id: 25, x: 4, y: 0, rot: 2 }, { id: 102, x: 2, y: 1, rot: 0 }, { id: 100, x: 0, y: 2, rot: 3 }, { id: 1, x: 3, y: 2, rot: 1 }, { id: 101, x: 5, y: 2, rot: 1 }, { id: 101, x: 5, y: 3, rot: 3 }, { id: 105, x: 0, y: 4, rot: 0 }, { id: 105, x: 2, y: 4, rot: 0 }],
}
/** The design point (stanek.mjs layoutFor at the mid world): weights' inputs and the charge factor c. FIXED, stated. */
export const LAYOUT_DESIGN = { Hg: 2.5, epsM: 0.09, epsR: 0.12, c: 0.30363672076297643 }
/** In-game fallback search budget for a grid not tabled (~20ms; the result says best-found). */
export const LAYOUT_FALLBACK_BUDGET = 2e4

/** The layout for a grid: the shipped table, else a bounded search (`source` says which). */
export function layoutForGrid(width, height, nodePower, basis = 'hack') {
  const key = `${width}x${height}|${nodePower}`
  if (basis === 'blade') {
    if (BLADE_LAYOUTS[key]) return { placed: BLADE_LAYOUTS[key], key, source: 'tabled (stanekplan.BLADE_LAYOUTS: the Bladeburner route)' }
    const o = optimiseLayout({ width, height, weights: BLADE_WEIGHTS, c: BLADE_DESIGN_C, nodePower, budget: LAYOUT_FALLBACK_BUDGET })
    return { placed: o.placed, key, source: `searched in-game for the Bladeburner route (${o.nodes} nodes, ${o.exact ? 'exact' : 'best found within the budget'}) — not tabled` }
  }
  if (LAYOUTS[key]) return { placed: LAYOUTS[key], key, source: 'tabled (stanekplan.LAYOUTS)' }
  const o = optimiseLayout({ width, height, weights: hackWeights(LAYOUT_DESIGN), c: LAYOUT_DESIGN.c, nodePower, budget: LAYOUT_FALLBACK_BUDGET })
  return { placed: o.placed, key, source: `searched in-game (${o.nodes} nodes, ${o.exact ? 'exact' : 'best found within the budget'}) — not tabled` }
}

/** Is the gift's active set exactly this layout? active: ns.stanek.activeFragments() ({id, x, y, rotation}). */
export function sameLayout(active, placed) {
  if (!Array.isArray(active) || active.length !== placed.length) return false
  const k = (id, x, y, r) => `${id}@${x},${y},${r}`
  const a = new Set(active.map((f) => k(f.id, f.x, f.y, f.rotation ?? f.rot)))
  return placed.every((p) => a.has(k(p.id, p.x, p.y, p.rot)))
}

/** The fragments the charger charges: every placed non-booster's root [x, y]. */
export const chargeRootsOf = (placed) => placed.filter((p) => fragmentById(p.id)?.type !== TYPE.Booster).map((p) => [p.x, p.y])

// ---------------------------------------------------------------------------
// WHERE THE CHARGER RUNS: THE FLEET (stanek.js places it, batch.js holds it)
// ---------------------------------------------------------------------------
/**
 * chargeFragment works from ANY server: the gift is global, and the call charges at
 * the calling script's threads x getCoreBonus(cpuCores of the server it RUNS ON)
 * (NetscriptFunctions/Stanek.ts chargeFragment). So the charger's RAM is a share of
 * the FLEET, never of home alone — home-only starved it at every node's start (BN13.1
 * 2026-10-11 00:14Z: 128GB 1-core home full of residents + progress.js's block, every
 * fragment at 0 charge while rooted 32GB hosts ran batch workers).
 *
 * Per call (StaneksGift.charge) at power p: p > highestCharge H -> H = p and numCharge
 * rescaled so H x numCharge grows by p; else numCharge += p / H. The effect is
 * ln(H+1) x ((n+1)/5)^0.07, so H — ONE script's power — dominates and every further
 * instance only adds numCharge (power/H per round robin). The placement therefore
 * CONCENTRATES: the host with the most chargeable power (GB x core bonus) first.
 *
 * hosts: [{ host, cores, capGb }], capGb = what the charger can hold there once the
 * batcher's h/g/w (FREEABLE) have finished: max - non-worker use - reserves, the
 * charger's own RAM counted free. Returns { gb, threads, H, power, hosts: [{host, cores, threads}] }.
 */
export function chargerPlaceOf(budgetGb, hosts) {
  const rpt = STANEK.ramPerThread
  let left = Math.floor(Math.max(0, budgetGb) / rpt + 1e-9)
  const order = (hosts ?? []).filter((h) => h.capGb >= rpt).sort((a, b) => b.capGb * coreBonus(b.cores) - a.capGb * coreBonus(a.cores) || (a.host < b.host ? -1 : a.host > b.host ? 1 : 0))
  const out = []
  let H = 0
  let power = 0
  let threads = 0
  for (const h of order) {
    if (left <= 0) break
    const t = Math.min(left, Math.floor(h.capGb / rpt + 1e-9))
    if (t <= 0) continue
    left -= t
    threads += t
    const p = t * coreBonus(h.cores)
    power += p
    H = Math.max(H, p)
    out.push({ host: h.host, cores: h.cores, threads: t })
  }
  return { gb: threads * rpt, threads, H, power, hosts: out }
}

/**
 * Each rooted host's room for the charger, from what stanek.js reads:
 * raw [{ host, maxRam, used, cores, workerGb, chargerGb, reserveGb }] (workerGb = the
 * batcher's h/g/w, which finish within a cycle; chargerGb = charge.js already there;
 * reserveGb = progress.js's block on home + the raise daemons' blocks batch.js keeps).
 *   capNow  = max - used + chargerGb - reserve        (launchable this pass)
 *   capGb   = capNow + workerGb                        (once the batcher yields)
 */
export function chargerFleetOf(raw) {
  const r2 = (x) => Math.round(x * 100) / 100
  return (raw ?? []).map((h) => {
    const capNow = Math.max(0, h.maxRam - h.used + (h.chargerGb ?? 0) - (h.reserveGb ?? 0))
    return { host: h.host, cores: h.cores ?? 1, maxRam: h.maxRam, capNow: r2(capNow), capGb: r2(Math.max(0, Math.min(h.maxRam - (h.reserveGb ?? 0), capNow + (h.workerGb ?? 0)))), workerGb: r2(h.workerGb ?? 0), reserveGb: r2(h.reserveGb ?? 0) }
  })
}

/**
 * The charger this pass: f x the fleet's RAM (f = the plan's decision, a fraction of
 * the FLEET), placed by chargerPlaceOf on the room once the batcher yields (the
 * target), launched now within what is free (per host min(target, capNow)). The
 * difference is what batch.js holds per host (stanekHoldsOf). Returns
 * { fleetGB, want, placeable, threads, can, H, Htarget, hosts: [{host, cores, target, now}] }.
 */
export function chargerPlanOf({ f, fleet }) {
  const rpt = STANEK.ramPerThread
  const fleetGB = (fleet ?? []).reduce((s, h) => s + (h.maxRam ?? 0), 0)
  const budget = Math.max(0, f) * fleetGB
  const want = Math.floor(budget / rpt + 1e-9)
  const target = chargerPlaceOf(budget, fleet)
  const byHost = new Map((fleet ?? []).map((h) => [h.host, h]))
  const hosts = target.hosts.map((t) => ({ host: t.host, cores: t.cores, target: t.threads, now: Math.min(t.threads, Math.floor((byHost.get(t.host)?.capNow ?? 0) / rpt + 1e-9)) }))
  const threads = hosts.reduce((s, h) => s + h.now, 0)
  const can = (fleet ?? []).reduce((s, h) => s + Math.floor(h.capNow / rpt + 1e-9), 0)
  const H = hosts.reduce((m, h) => Math.max(m, h.now * coreBonus(h.cores)), 0)
  return { fleetGB, want, placeable: target.threads, threads, can, H, Htarget: target.H, hosts }
}

/**
 * Kill/exec per host to reach plan.hosts' `now` counts. running: [{host, pid, threads,
 * args}] (every charge.js in the fleet). A host keeps its one charger when its args
 * match and its threads are within 10% (a restart costs a few charge seconds, a
 * flip-flop on a few GB is not information); chargers on hosts outside the plan stop.
 */
export function chargerActionsOf(plan, running, rootsArg, life) {
  const stops = []
  const starts = []
  const keep = []
  const want = new Map(plan.hosts.filter((h) => h.now > 0).map((h) => [h.host, h.now]))
  for (const host of new Set([...want.keys(), ...running.map((p) => p.host)])) {
    const procs = running.filter((p) => p.host === host)
    const n = want.get(host) ?? 0
    const have = procs.reduce((s, p) => s + p.threads, 0)
    const same = procs.length === 1 && procs[0].args?.[0] === rootsArg && procs[0].args?.[1] === life
    if (n > 0 && same && Math.abs(have - n) <= Math.max(1, 0.1 * n)) {
      keep.push({ host, threads: have, pid: procs[0].pid })
      continue
    }
    for (const p of procs) stops.push(p.pid)
    if (n > 0) starts.push({ host, threads: n })
  }
  return { stops, starts, keep }
}

/**
 * Why nothing (or less than wanted) is charging — the BINDING cause, named. Null when
 * the charger holds what it wants.
 */
export function chargerWhyOf({ roots, f, plan, fleet, execFails = [] }) {
  if (!roots) return 'no chargeable fragment placed'
  if (plan.want <= 0) return `f=${f}: ${f > 0 ? `${(f * plan.fleetGB).toFixed(1)}GB of the ${plan.fleetGB}GB fleet is under one ${STANEK.ramPerThread}GB thread` : 'no charging'}`
  const fails = execFails.length ? `; exec refused on ${execFails.map((e) => `${e.host} (${e.threads}t${e.why ? ': ' + e.why : ''})`).join(', ')}` : ''
  if (plan.placeable <= 0) {
    const top = [...(fleet ?? [])].sort((a, b) => b.maxRam - a.maxRam).slice(0, 3).map((h) => `${h.host} ${h.maxRam}GB: ${h.capGb}GB room${h.reserveGb ? ` beyond a ${h.reserveGb}GB reserve` : ''}`).join('; ')
    return `no rooted host has a ${STANEK.ramPerThread}GB thread of room even after the batcher yields — residents and reserves fill the fleet (${(fleet ?? []).length} hosts, ${plan.fleetGB}GB: ${top})${fails}`
  }
  if (plan.threads <= 0) {
    const held = plan.hosts.map((h) => `${h.host} ${h.target}t`).join(', ')
    return `waiting on the batcher: the targets (${held}) are full of h/g/w now; batch.js holds that RAM free of new workers (stanekReserve) and it frees within a batch cycle${fails}`
  }
  const parts = []
  if (plan.placeable < plan.want) parts.push(`the fleet has room for ${plan.placeable} of ${plan.want} threads even after the batcher yields`)
  if (plan.threads < plan.placeable) parts.push(`${plan.placeable - plan.threads} threads wait on the batcher's h/g/w (held by batch.js)`)
  if (parts.length) return parts.join('; ') + fails
  return fails ? fails.slice(2) : null
}

/**
 * The gift's own record of charging: the sum over fragments of highestCharge x
 * numCharge, which every charge call raises by its power (StaneksGift.charge, both
 * branches) — so it grows iff something charged. Compared with the previous stanek.js
 * record of the same life: { mass, prevAt, prevMass, gained, minutes, chargerWas, flat }.
 */
/**
 * THE GIFT'S FACTOR ON mults.hacking at the record (/tel/stanek.txt `fragments`):
 * the product of the Hacking fragments' effects (StaneksGift.calculateMults,
 * StaneksGift.ts:150-152 — hacking and hacking_exp x effect), which the player's
 * raw multiplier carries and every install clears. The lifetimes ledger records
 * it beside hackMult so a life's gain is the augmentations' (bayes.ledgerLives).
 * 1 when the record has no Hacking fragment; null when the record is not this
 * life's (or absent): no reading, never a guess.
 */
export function giftHackOf(rec, lastAugReset) {
  if (!rec || !Array.isArray(rec.fragments) || rec.lastAugReset !== lastAugReset) return null
  let p = 1
  for (const f of rec.fragments) {
    if (f?.type !== 'Hacking' && f?.type !== TYPE.Hacking) continue
    if (!(typeof f.effect === 'number' && isFinite(f.effect) && f.effect > 0)) return null
    p *= f.effect
  }
  return p
}
export const chargeMassOf = (frags) => (frags ?? []).reduce((s, f) => s + (f.highestCharge ?? 0) * (f.numCharge ?? 0), 0)
export function chargeProgressOf(prev, frags, lastAugReset, now = Date.now()) {
  const mass = chargeMassOf(frags)
  if (!prev || prev.lastAugReset !== lastAugReset || !Array.isArray(prev.fragments)) return { mass, prevAt: null, prevMass: null, gained: null, minutes: null, chargerWas: null, flat: false }
  const prevMass = chargeMassOf(prev.fragments)
  const minutes = (now - Date.parse(prev.at ?? '')) / 60e3
  const chargerWas = prev.charger?.threads ?? 0
  const gained = mass - prevMass
  return { mass, prevAt: prev.at ?? null, prevMass, gained, minutes: isFinite(minutes) ? +minutes.toFixed(2) : null, chargerWas, flat: chargerWas > 0 && minutes >= 1 && !(gained > 0) }
}

// ---------------------------------------------------------------------------
// THE CHARGING ALLOCATION, PRICED BY THE EXIT (progress.js stanekDecisionOf)
// ---------------------------------------------------------------------------
/**
 * The two trajectories of each comparison: the exit with the charger holding a
 * fraction f of the FLEET's RAM vs the exit at another f (f = 0: no charging) — each
 * the SAME exit inputs (progress.js exitInputsOf) scaled by what f does to them, then
 * the exit simulator (plan.trajectoryGenOf). What f does, per life (charges clear at
 * every install and regrow, so every life repeats it):
 *   the gift   the placement of f x fleetGB on the fleet's room (chargerPlaceOf, the one
 *              stanek.js launches): highestCharge = its largest instance's power H, and
 *              numCharge growing (power/H) x tau/k per fragment (round robin, one 1s call
 *              per instance each) over the life's quadrature (nodeModel's), duty ALLOC_DUTY
 *   the RAM    the batcher loses the placed GB of fleetGB: income and exp x (1 - gb/fleetGB)
 *   channels   income x speed x hacking (chance) / (a/money + (1-a)/grow);  exp x hacking_exp
 *              x speed;  rep x faction_rep x hacking (hacking work rep is linear in the
 *              level, reputation.ts);  hackingMult x hacking (the exit level)
 * Relative to the f the inputs were MEASURED under (fNow), so the option f = fNow
 * prices the measured inputs exactly.
 * Without ctx.hosts (no fleet record) the charger is one script of f x homeGB on home.
 * NOT SIMULATED (stated, published): the fleet growing within the node (more threads
 * later: favours charging), the Church's rep -> Awakening/Serenity (favours charging),
 * bonus time, the batcher's income not being linear in its RAM.
 */
export const ALLOC_GRID = [0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5]
/** The charger's duty in the live pricing (stated: restarts and the first minutes of a life). */
export const ALLOC_DUTY = 0.9

export function chargeLnOf({ layout, nodePower, homeGB, cores, fleetGB, hosts = null, f, cycleH, duty = ALLOC_DUTY, a = HACK_SHARE }) {
  const cl = compileLayout(layout)
  const ff = Math.max(0, f)
  const place = Array.isArray(hosts) ? chargerPlaceOf(ff * fleetGB, hosts) : chargerPlaceOf(ff * homeGB, [{ host: 'home', cores, capGb: ff * homeGB }])
  const rate = place.H > 0 ? place.power / place.H : 0
  const tau = Math.max(0, cycleH) * 3600 * duty
  const batchLoss = fleetGB > 0 ? Math.min(0.99, place.gb / fleetGB) : 0
  const quad = [0.125, 0.375, 0.625, 0.875]
  let inc = 0
  let exp = 0
  let rep = 0
  let lnH = 0
  for (const q of quad) {
    const m = multsAt(cl, chargeFactor(place.H, (rate * q * tau) / cl.k), nodePower)
    inc += (Math.log(m.hacking_speed) + Math.log(m.hacking) - Math.log(a / m.hacking_money + (1 - a) / m.hacking_grow)) / quad.length
    exp += (Math.log(m.hacking_exp) + Math.log(m.hacking_speed)) / quad.length
    rep += (Math.log(m.faction_rep) + Math.log(m.hacking)) / quad.length
    lnH += Math.log(m.hacking) / quad.length
  }
  const lnRam = Math.log(1 - batchLoss)
  return { threads: place.threads, H: place.H, power: place.power, gb: place.gb, batchLoss, lnIncome: inc + lnRam, lnExp: exp + lnRam, lnRep: rep, lnHack: lnH }
}

/** The exit inputs at charging fraction f, from inputs measured at ctx.fNow (see above). */
export function chargeInputsOf(base, ctx, f) {
  return scaleByGift(base, chargeLnOf({ ...ctx, f }), chargeLnOf({ ...ctx, f: ctx.fNow ?? 0 }))
}

/**
 * The exit inputs with `layout` charged at f in place of the layout they were measured under
 * (ctx.layout at ctx.fNow): the live exit model's price of a layout held for the lives it repeats.
 */
export function layoutInputsOf(base, ctx, f, layout) {
  return scaleByGift(base, chargeLnOf({ ...ctx, layout, f }), chargeLnOf({ ...ctx, f: ctx.fNow ?? 0 }))
}

/** `base` with its batcher channels moved from the gift state `now` to `at` (chargeLnOf records). */
function scaleByGift(base, at, now) {
  const fin = (x) => typeof x === 'number' && isFinite(x)
  const sc = (x, d) => (fin(x) ? x * Math.exp(d) : x)
  const dI = at.lnIncome - now.lnIncome
  const dE = at.lnExp - now.lnExp
  const out = {
    ...base,
    incomePerSec: sc(base.incomePerSec, dI),
    expPerSec: sc(base.expPerSec, dE),
    repPerSec: sc(base.repPerSec, at.lnRep - now.lnRep),
    hackingMult: sc(base.hackingMult, at.lnHack - now.lnHack),
  }
  // The flat (non-hacking) parts are not the batcher's: kept as measured.
  if (fin(base.flatIncomePerSec) && base.flatIncomePerSec > 0 && fin(base.incomePerSec)) out.incomePerSec = base.flatIncomePerSec + (base.incomePerSec - base.flatIncomePerSec) * Math.exp(dI)
  if (fin(base.expFlatPerSec) && base.expFlatPerSec > 0 && fin(base.expPerSec)) out.expPerSec = base.expFlatPerSec + (base.expPerSec - base.expFlatPerSec) * Math.exp(dE)
  return out
}

/**
 * THE GIFT OVER A LIFE OF LENGTH L. The charges clear at every install and
 * regrow, so a life's gift multipliers are their AVERAGE over the life
 * (chargeLnOf's quadrature of charge(t) for the charger's placement): a longer
 * life spends more of itself at a higher charge. The life length decision
 * prices each option L on the base inputs moved from the life-average at the
 * length they were measured over (refL: the committed later-lives length —
 * the lives the measured rates came from; the committed option is the
 * measured inputs exactly, as stanek's own decision prices them) to the
 * life-average at L, at the allocation the charger runs (f). Live BN13
 * 2026-10-11 the gift factor was one constant across L0.5..L24: longer lives
 * got no credit for a more-charged gift.
 * `ctx` {layout, nodePower, fleetGB, hosts, f, refL} (giftLifeCtxOf), carried
 * on the exit inputs as `giftLife`; L-independent channels untouched.
 */
export function giftLifeCtxOf(st, { node, f, refL } = {}) {
  if (!st || st.node !== node || !Array.isArray(st.layout?.placed) || !st.layout.placed.length) return null
  const fleetGB = st.fleet?.gb
  const hosts = Array.isArray(st.fleet?.hosts) ? st.fleet.hosts : null
  if (!(fleetGB > 0) || !hosts?.length || !(f > 0) || !(refL > 0)) return null
  return { layout: st.layout.placed, nodePower: st.layout.nodePower, fleetGB, hosts, f, refL }
}
const giftLnMemo = new WeakMap()
/** chargeLnOf at the context's f over a life of L (memoised per context). */
export function giftLifeLnOf(ctx, L) {
  let m = giftLnMemo.get(ctx)
  if (!m) giftLnMemo.set(ctx, (m = new Map()))
  if (!m.has(L)) m.set(L, chargeLnOf({ ...ctx, cycleH: L }))
  return m.get(L)
}
/** The inputs with later lives of L: the gift's life-average at L in place of the one at ctx.refL. */
export function giftLifeInputsOf(base, L) {
  const ctx = base?.giftLife
  if (!ctx || !(L > 0) || !(ctx.refL > 0) || L === ctx.refL) return base
  return scaleByGift(base, giftLifeLnOf(ctx, L), giftLifeLnOf(ctx, ctx.refL))
}

/**
 * L4: THE HACKING ROUTE PRICED WITH THE GIFT ACCEPTED (the route decision's hacking arm). `base`: the live
 * exit inputs, measured under the gift as it is (Genesis's x0.9 is in the player's multipliers; the placed
 * layout at the charger's live fraction fNow of the fleet). The hacking route installs, and every install
 * clears the charge (Prestige.ts:125 -> StaneksGift.ts:226-228), so each life holds `layout` at f from zero:
 * the inputs move from the placed layout at fNow to `layout`'s life-average at f over the life, on the
 * charger over the node (`charger`: hackChargerPathOf, THE SAME MODEL the chain priced the accept on —
 * live BN5.2 dry-run 2026-10-24: the chain's ramp vs this builder's fleet held at entry flipped the
 * accept 13.0h -> 20.4h one pass later; no `charger`: the measured fleet alone, a lower bound), and
 * carry giftLife (the measured fleet) for the life length decision.
 * Returns {inputs, basis, why} — inputs null where /tel/stanek.txt holds no layout and fleet of this node.
 */
export function hackGiftInputsOf(base, st, { node, layout, f = DEFAULT_F, sameLife = true, charger = null } = {}) {
  if (!st || st.node !== node || !Array.isArray(st.layout?.placed) || !st.layout.placed.length) return { inputs: null, basis: null, why: `${STANEK_FILE} has no placed layout of this node` }
  const fleetGB = st.fleet?.gb
  const hosts = Array.isArray(st.fleet?.hosts) ? st.fleet.hosts : null
  const cycleH = base?.cycleHours
  if (!(fleetGB > 0) || !hosts?.length) return { inputs: null, basis: null, why: `${STANEK_FILE} has no fleet: the hacking charger is unpriced` }
  if (!(cycleH > 0)) return { inputs: null, basis: null, why: 'cycleHours unknown in the exit inputs: the life the charge regrows over is unpriced' }
  const fNow = sameLife && st.charger?.gb > 0 ? Math.min(1, st.charger.gb / fleetGB) : 0
  const L = Array.isArray(layout) && layout.length ? layout : st.layout.placed
  const np = st.layout.nodePower
  const home = hosts.find((h) => h.host === 'home')
  const path = hackChargerPathOf(charger ?? { liveGB: fleetGB, liveHome: home ? { ram: home.maxRam, cores: home.cores } : null })
  if (!path.points) return { inputs: null, basis: null, why: path.why }
  const at = hackChargerLnOf(path, { layout: L, nodePower: np, f, cycleH })
  // what the inputs were measured under: the gift's LIVE charge (the player's multipliers carry it now — at the
  // accept, nothing: the chain's zero) and the RAM the charger holds now (fNow of the fleet). The life-average at
  // fNow here read a just-started charger as charged (BN2.2 dry-run 2026-10-24: 19.0h -> 22.4h at the same f).
  const live = sameLife ? liveGiftLnOf(st) : null
  const lnRam = Math.log(1 - Math.min(0.99, fNow))
  const z = live ?? { lnIncome: 0, lnExp: 0, lnRep: 0, lnHack: 0 }
  const now = { lnIncome: z.lnIncome + lnRam, lnExp: z.lnExp + lnRam, lnRep: z.lnRep, lnHack: z.lnHack }
  return { inputs: { ...scaleByGift(base, at, now), giftLife: { layout: L, nodePower: np, fleetGB, hosts, f, refL: cycleH } }, basis: path.basis, why: `${layoutKeyOf(L)} at f ${f}, from the placed ${layoutKeyOf(st.layout.placed)} at its live charge (ln hacking ${z.lnHack.toFixed(4)}) and fNow ${fNow.toFixed(3)}; ${path.why}` }
}

/**
 * The hacking channels of the gift's LIVE charge (/tel/stanek.txt `fragments`: highestCharge, numCharge per
 * placed fragment, through the game's effect, layoutMults -> calculateEffect): {lnIncome, lnExp, lnRep, lnHack}
 * as chargeLnOf composes them (no RAM term). null when the record holds no fragments.
 */
export function liveGiftLnOf(st, a = HACK_SHARE) {
  const fr = Array.isArray(st?.fragments) ? st.fragments.filter((x) => Number.isInteger(x?.id) && fragmentById(x.id)) : []
  if (!fr.length) return null
  const m = layoutMults(fr.map((x) => ({ id: x.id, x: x.x, y: x.y, rot: x.rot ?? 0 })), fr.map((x) => ({ highestCharge: x.highestCharge ?? 0, numCharge: x.numCharge ?? 0 })), st.layout?.nodePower ?? 1)
  return {
    lnIncome: Math.log(m.hacking_speed) + Math.log(m.hacking) - Math.log(a / m.hacking_money + (1 - a) / m.hacking_grow),
    lnExp: Math.log(m.hacking_exp) + Math.log(m.hacking_speed),
    lnRep: Math.log(m.faction_rep) + Math.log(m.hacking),
    lnHack: Math.log(m.hacking),
  }
}

/**
 * THE HACKING CHARGER OVER THE NODE — ONE MODEL for the route's hacking arm with the gift, before the accept
 * (hackChainGiftInputsOf) and after it (hackGiftInputsOf), so the accept is re-priced on the trajectory it
 * was taken on. The charger runs f x the fleet (chargerPlaceOf, concentrated on the biggest host: home);
 * home grows on the gameplan's ramp (homeAt: 2^HOME.log2Start -> 2^log2End, cores 1 -> HOME.coresEnd,
 * shape u^HOME.shapeQ, u = hours into the node / `ramHours`, the node's no-gift hacking length), floored at
 * the measured home and the fleet measured now (`liveGB`; the rest of the fleet held as measured: it only
 * grows). The node's remaining time at the ramp's quadrature points (ageH -> ramHours). `ramHours` unknown:
 * the measured fleet alone (basis 'measured', a LOWER bound). The per-life charge is GIFT_CAL's (calChargeLnOf).
 * CALIBRATED (tools/sim/chargercal.mjs, the home paths of 9 hacking-route nodes in history.jsonl, the gift
 * factor over the node on BN5.2's layout): median node -3.0% (tol 15%); gift nodes BN13.1 +5.0%, BN10.3
 * -23.7% (its home reached 2^24 by 30h: the ramp is LOW there); the spread -24%..+5% printed every run.
 * Returns {points: [{u, fleetGB, hosts}] | null, basis, why}.
 */
export function hackChargerPathOf({ liveGB = 0, liveHome = null, ageH = 0, ramHours = null, log2End = HACK_CHARGER_RAMP.log2End } = {}) {
  const fin = (x) => typeof x === 'number' && isFinite(x)
  const hRam = fin(liveHome?.ram) && liveHome.ram > 0 ? liveHome.ram : 0
  const hCores = fin(liveHome?.cores) && liveHome.cores >= 1 ? liveHome.cores : 1
  const restGB = Math.max(0, (fin(liveGB) ? liveGB : 0) - hRam)
  const ramp = fin(ramHours) && ramHours > 0 && fin(ageH) && ageH >= 0
  const us = ramp ? [0.125, 0.375, 0.625, 0.875].map((q) => Math.min(1, (ageH + q * Math.max(0, ramHours - ageH)) / ramHours)) : [null]
  const points = []
  for (const u of us) {
    const h = u === null ? { ram: 0, cores: 1 } : homeAt(u, log2End)
    const home = { host: 'home', cores: Math.max(hCores, h.cores), maxRam: Math.max(hRam, h.ram) }
    const hosts = [{ ...home, capGb: home.maxRam }, ...(restGB > 0 ? [{ host: 'fleet', cores: 1, maxRam: restGB, capGb: restGB }] : [])]
    const fleetGB = home.maxRam + restGB
    if (!(fleetGB > 0)) return { points: null, basis: null, why: 'no fleet measured and no ramp: the charger is unpriced' }
    points.push({ u, fleetGB, hosts })
  }
  const basis = ramp ? 'ramp' : 'measured'
  const meanGB = points.reduce((s, p) => s + p.fleetGB, 0) / points.length
  return { points, basis, why: `the charger ${ramp ? `on ${HACK_CHARGER_RAMP.source} over the node's ${ramHours.toFixed(1)}h from ${ageH.toFixed(1)}h, floored at the measured ${Math.round(liveGB)}GB` : `on the fleet measured now (${Math.round(liveGB)}GB; no node length to ramp over: a LOWER bound)`} — mean fleet ${Math.round(meanGB)}GB` }
}
/**
 * chargeLnOf on the MEASURED per-life charge (GIFT_CAL, giftcal.mjs: 43 gift lives of BN13.1 + BN10.3 — the
 * same calibration nodeModel takes as o.cal): every fragment's ln effect x kappa, nothing charged for the
 * first delayH of a life (the charging time scaled as nodeModel's chg). The RAM the charger takes is not the
 * gift's: its ln(1 - gb/fleet) is kept whole.
 */
export function calChargeLnOf(o, cal = GIFT_CAL) {
  const k = Number.isFinite(cal?.kappa) ? cal.kappa : 1
  const d = Number.isFinite(cal?.delayH) && cal.delayH > 0 && o.cycleH > 0 ? Math.max(0, o.cycleH - cal.delayH) / o.cycleH : 1
  const r = chargeLnOf({ ...o, duty: (o.duty ?? ALLOC_DUTY) * d })
  const lnRam = Math.log(1 - r.batchLoss)
  return { ...r, lnIncome: k * (r.lnIncome - lnRam) + lnRam, lnExp: k * (r.lnExp - lnRam) + lnRam, lnRep: k * r.lnRep, lnHack: k * r.lnHack }
}
/** `layout` at f from zero each life (the calibrated life-average, calChargeLnOf), averaged over the charger path's points. */
export function hackChargerLnOf(path, { layout, nodePower = 1, f, cycleH }) {
  const acc = { lnIncome: 0, lnExp: 0, lnRep: 0, lnHack: 0 }
  for (const p of path.points) {
    const r = calChargeLnOf({ layout, nodePower, fleetGB: p.fleetGB, hosts: p.hosts, f, cycleH })
    for (const k of Object.keys(acc)) acc[k] += r[k] / path.points.length
  }
  return acc
}

/**
 * THE HACKING ROUTE WITH THE GIFT, BEFORE AN ACCEPT (the chain, 2026-10-18 live BN10.3: hack + gift
 * outside BN13 was not priced, so the chained decision declined the gift on the hacking route the
 * gameplan plays as hacking + Stanek). No charger runs before the accept, so the charger is a MODEL,
 * labelled: the gameplan's BN13 charger ramp (nodeModel's homeAt: home RAM 2^HOME.log2Start ->
 * 2^log2End, cores 1 -> HOME.coresEnd, shape u^HOME.shapeQ over the no-gift node length `ramHours`;
 * log2End = effects.mjs stRam mid, MEASURED p50 of 10 no-gift exits), floored at the fleet measured now
 * (`liveGB`, `liveHome` {ram, cores}: the charger never has less than the live fleet). Every life holds
 * `layout` at f from zero (every install clears the charge: the life-average, chargeLnOf), averaged over
 * the node's remaining time at the ramp's quadrature points; Genesis's x0.9 applies at the accept, at
 * once (acceptGift -> applyAugmentation, Augmentations.ts:1593-1627: every hacking channel, the
 * offline fresh-entry cases' penaltyStepInputsOf 1 -> 0.9). `ramHours` unknown: the measured fleet
 * alone (a LOWER bound: the fleet only grows). Returns {inputs, basis, why} — inputs null when unpriced.
 */
// fallbackH: the node length when no pass has priced it yet (the gameplan's BN10.3 hacking + Stanek clear, ~61h) —
// a default, stated; the live BN10.3 replay moved the hack + gift arm 0.02h between 60h and 300h of it.
export const HACK_CHARGER_RAMP = { log2End: 21, fallbackH: 61, source: 'the gameplan charger ramp (stanekplan.nodeModel homeAt; tools/sim/gameplan/effects.mjs stRam mid 21 = log2 home GB at a no-gift hacking exit, MEASURED p50)' }
export function hackChainGiftInputsOf(base, { layout, nodePower = 1, f = DEFAULT_F, liveGB = 0, liveHome = null, ageH = 0, ramHours = null, log2End = HACK_CHARGER_RAMP.log2End } = {}) {
  const cycleH = base?.cycleHours
  if (!Array.isArray(layout) || !layout.length) return { inputs: null, basis: null, why: 'no hacking layout for this grid' }
  if (!(cycleH > 0)) return { inputs: null, basis: null, why: 'cycleHours unknown in the exit inputs: the life the charge regrows over is unpriced' }
  // the charger over the node: hackChargerPathOf, the one model hackGiftInputsOf re-prices the accept on
  const path = hackChargerPathOf({ liveGB, liveHome, ageH, ramHours, log2End })
  if (!path.points) return { inputs: null, basis: null, why: path.why }
  const acc = hackChargerLnOf(path, { layout, nodePower, f, cycleH })
  const zero = { lnIncome: 0, lnExp: 0, lnRep: 0, lnHack: 0 }
  return {
    inputs: scaleByGift(penaltyStepInputsOf(base, PENALTY[0], PENALTY[1]), acc, zero),
    basis: path.basis,
    why: `${layoutKeyOf(layout)} at f ${f} from zero each life (Genesis x${PENALTY[1]} at the accept); ${path.why}, ln(hacking) ${acc.lnHack >= 0 ? '+' : ''}${acc.lnHack.toFixed(4)}, ln(income) ${acc.lnIncome >= 0 ? '+' : ''}${acc.lnIncome.toFixed(4)}`,
  }
}

/**
 * THE AWAKENING BOUND (published, never folded in): Awakening (1e6 Church rep x AugmentationRepCost) lifts
 * the penalty x0.9 -> x0.95 (Augmentations.ts:1631-1660) only at an INSTALL — so the hacking route can
 * reach it and the Bladeburner route (no install) cannot. The inputs as if it were installed from the
 * start: every hacking channel moved by ln(0.95/0.9) per multiplier in it (income: speed, hacking, money/
 * grow; exp: exp, speed; rep: faction_rep, hacking; hacking) — an UPPER bound on what it is worth.
 */
export const awakeningBoundInputsOf = (base) => penaltyStepInputsOf(base, PENALTY[1], PENALTY[2])
/** The hacking channels of `base` moved from the gift penalty `from` to `to` (PENALTY levels; the offline fresh-entry cases apply Genesis with 1 -> 0.9). */
export function penaltyStepInputsOf(base, from, to) {
  const d = Math.log(to / from)
  const z = { lnIncome: 0, lnExp: 0, lnRep: 0, lnHack: 0 }
  return scaleByGift(base, { lnIncome: 3 * d, lnExp: 2 * d, lnRep: 2 * d, lnHack: d }, z)
}

/**
 * THE GIFT ON A GROWN FLEET: `base` (carrying giftLife, the life-average at
 * ctx.refL on the measured fleet) moved to the same allocation f on a fleet
 * with `addGB` more on `host` (home's next RAM block; a new cloud server with
 * newHost) and `addCores` more cores there. The charger runs f x the FLEET's
 * RAM (chargerPlaceOf), so a bigger fleet charges faster and each life's gift
 * averages higher — the channel a home block or a server buys besides the
 * batcher's money. Returns {inputs, dLn: {income, exp, rep, hack}, f, why};
 * inputs = base (dLn null) when there is no gift context to grow. Pure.
 */
export function giftFleetInputsOf(base, { addGB = 0, addCores = 0, host = 'home', newHost = false } = {}) {
  const ctx = base?.giftLife
  const fin = (x) => typeof x === 'number' && isFinite(x)
  if (!ctx || !Array.isArray(ctx.hosts) || !(ctx.fleetGB > 0) || !(ctx.refL > 0)) return { inputs: base, dLn: null, f: null, why: 'no gift context on the inputs (giftLife): the charger channel is not priced' }
  const gb = fin(addGB) && addGB > 0 ? addGB : 0
  const cores = fin(addCores) && addCores > 0 ? addCores : 0
  if (!(gb > 0 || cores > 0)) return { inputs: base, dLn: { income: 0, exp: 0, rep: 0, hacking: 0 }, f: ctx.f, why: 'nothing added' }
  let hosts = ctx.hosts.map((h) => ({ ...h }))
  if (newHost) hosts.push({ host, cores: 1 + cores, maxRam: gb, capGb: gb, capNow: gb })
  else {
    const h = hosts.find((x) => x.host === host)
    if (!h) hosts.push({ host, cores: 1 + cores, maxRam: gb, capGb: gb, capNow: gb })
    else Object.assign(h, { maxRam: (h.maxRam ?? 0) + gb, capGb: (h.capGb ?? 0) + gb, capNow: (h.capNow ?? 0) + gb, cores: (h.cores ?? 1) + cores })
  }
  const grown = { ...ctx, fleetGB: ctx.fleetGB + gb, hosts }
  const at = giftLifeLnOf(grown, ctx.refL)
  const now = giftLifeLnOf(ctx, ctx.refL)
  const dLn = { income: at.lnIncome - now.lnIncome, exp: at.lnExp - now.lnExp, rep: at.lnRep - now.lnRep, hacking: at.lnHack - now.lnHack }
  return { inputs: { ...scaleByGift(base, at, now), giftLife: grown }, dLn, f: ctx.f, why: `the charger at f=${ctx.f} on ${(ctx.fleetGB + gb).toFixed(0)}GB (+${gb}GB${cores ? `, +${cores} core(s)` : ''} on ${host}): a life's gift ln(hacking) ${dLn.hacking >= 0 ? '+' : ''}${dLn.hacking.toFixed(4)}` }
}

/** The options the fleet can hold: f x fleetGB within its room once the batcher yields (f = 0 always). */
export function allocOptionsOf(fleetGB, hosts, grid = ALLOC_GRID) {
  const rpt = STANEK.ramPerThread
  const room = (hosts ?? []).reduce((s, h) => s + Math.floor(h.capGb / rpt + 1e-9) * rpt, 0)
  return grid.filter((f) => f === 0 || f * fleetGB <= room + rpt)
}

/**
 * Pick among priced options {f, hours}: the fastest exit; the incumbent kept unless
 * the best beats it by at least `tolH` (a charger restart is free, a flip-flop on
 * noise is not information). Returns { f, hours, why }.
 */
export function chooseAlloc(priced, incumbentF = null, tolH = 0.1) {
  const ok = priced.filter((p) => typeof p.hours === 'number' && isFinite(p.hours))
  if (!ok.length) return { f: null, hours: null, why: 'no option priced (the exit is unpriced at every f)' }
  const best = ok.reduce((b, p) => (p.hours < b.hours ? p : b))
  const inc = ok.find((p) => p.f === incumbentF)
  const table = ok.map((p) => `${p.f}:${p.hours.toFixed(2)}h`).join(' ')
  if (inc && inc !== best && inc.hours - best.hours < tolH) return { f: inc.f, hours: inc.hours, why: `incumbent f=${inc.f} kept: the best (f=${best.f}) saves ${(inc.hours - best.hours).toFixed(3)}h < ${tolH}h (${table})` }
  return { f: best.f, hours: best.hours, why: `f=${best.f}: the fastest exit, ${best.hours.toFixed(2)}h (${table})` }
}

/** The fraction (of the FLEET's RAM) used while no priced decision of this life exists (stated, labelled). */
export const DEFAULT_F = 0.2
/** What f is a fraction of: a decision of another basis (the old fraction of home) is not followed. */
export const ALLOC_BASIS = 'fleet'

/** The plan's allocation for this life (/tel/plan.txt decisions.stanek, basis 'fleet'), or null. */
export function planAllocOf(text, lastAugReset, now = Date.now(), maxAgeMin = 45) {
  let rec = null
  try {
    rec = JSON.parse(text || 'null')
  } catch {
    return null
  }
  const d = rec?.decisions?.stanek
  if (!rec || rec.lastAugReset !== lastAugReset || !(now - Date.parse(rec.at ?? '') < maxAgeMin * 60e3)) return null
  if (d?.basis !== ALLOC_BASIS) return null
  if (typeof d?.f !== 'number' || !isFinite(d.f) || d.f < 0 || d.f > 1) return null
  return { f: d.f, why: String(d.why ?? '').slice(0, 240), at: rec.at }
}

/** progress.js's Singularity block on home — batch.js SETTINGS.homeReserve (SG5 keeps this copy honest). */
export const progressBlockGb = (singMult) => 13 + 6.25 * singMult

/**
 * What batch.js keeps free of NEW workers for the charger, per host: the target GB not
 * yet held, from a fresh record of this life ([{host, gb}], raiseplace.heldOn reads it).
 * Unknown or stale: none (the charger takes what is free; the shortfall is published).
 */
export function stanekHoldsOf(rec, lastAugReset, now = Date.now(), maxAgeMs = 15 * 60e3) {
  if (!rec || rec.lastAugReset !== lastAugReset || !(now - Date.parse(rec.at ?? '') < maxAgeMs)) return []
  const hs = rec.charger?.hosts
  if (!Array.isArray(hs)) return []
  return hs.map((h) => ({ host: h.host, gb: Math.max(0, ((h.target ?? 0) - (h.now ?? 0)) * STANEK.ramPerThread) })).filter((h) => typeof h.host === 'string' && h.gb > 0)
}

/**
 * The gift's health from /tel/stanek.txt and /tel/charge.txt (tools/healthcheck.mjs).
 * Returns [{ key, problem, detail }]:
 *   GIFT NOT ACCEPTED       wanted and not accepted past `graceMin` into the node, or
 *                           forfeited / refused at all
 *   FRAGMENTS NOT CHARGING  accepted with a layout placed and the charger wanted, and:
 *                           no charger thread anywhere in the fleet (the detail is the
 *                           binding cause stanek.js named: no room / waiting on the
 *                           batcher past `waitMin` / exec refused / f=0), or charge.js
 *                           running and the gift's own charge mass flat since the last
 *                           pass, or a fresh charge.js error (stanek.js gathers every
 *                           host's heartbeat into /tel/charge.txt)
 *   STANEK STALE            the record is old (stanek.js is not being run)
 *   STANEK LAYOUT STALE     the placed layout is not the life's decided one 15 min after the
 *                           install, or a hacking-route life has no decision after 60 min
 *                           (lifeLayoutHealthOf)
 *   STANEK PHASE SWITCH LATE a priced phase switch came due 15 min ago and has not landed (phaseHealthOf)
 */
export function stanekHealthOf({ stanek, charge, now = Date.now(), nodeStartMs = null, graceMin = 15, staleMin = 12, waitMin = 10 }) {
  const out = []
  if (!stanek) return [{ key: 'STANEK UNREPORTED', problem: 'STANEK UNREPORTED', detail: `${STANEK_FILE} missing — stanek.js has not run in a node with the Church` }]
  const age = (now - Date.parse(stanek.at ?? '')) / 60e3
  if (!(age < staleMin)) out.push({ key: 'STANEK STALE', problem: 'STANEK STALE', detail: `${STANEK_FILE} is ${isFinite(age) ? age.toFixed(0) + ' min' : 'undated'} old — stanek.js is not being run` })
  const g = stanek.gift ?? {}
  if (g.want && !g.accepted) {
    const inNode = typeof nodeStartMs === 'number' ? (now - nodeStartMs) / 60e3 : null
    if (g.forfeited) out.push({ key: 'GIFT FORFEITED', problem: 'GIFT NOT ACCEPTED', detail: g.why })
    else if (stanek.refused) out.push({ key: 'GIFT REFUSED', problem: 'GIFT NOT ACCEPTED', detail: `acceptGift refused: ${stanek.refused}` })
    else if (inNode === null || inNode >= graceMin) out.push({ key: 'GIFT NOT ACCEPTED', problem: 'GIFT NOT ACCEPTED', detail: `BitNode ${g.node}: ${inNode === null ? 'node age unknown' : inNode.toFixed(0) + ' min'} in and the gift is not accepted (${g.why})` })
  }
  if (g.accepted && Array.isArray(stanek.layout?.placed) && stanek.layout.placed.length) {
    const ch = stanek.charger ?? {}
    const want = ch.want ?? 0
    const NC = 'FRAGMENTS NOT CHARGING'
    const life = charge && charge.lastAugReset === stanek.lastAugReset ? charge : null
    const errs = Object.entries(life?.hosts ?? {}).filter(([, r]) => r?.error && !r?.stopped && now - Date.parse(r.at ?? '') < 10 * 60e3)
    const errText = errs.map(([h, r]) => `${h}: ${r.error}`).join('; ')
    if (want > 0 && !((ch.threads ?? 0) > 0)) {
      const waited = ch.waitingSince ? (now - Date.parse(ch.waitingSince)) / 60e3 : null
      if (!(ch.waiting && waited !== null && waited < waitMin)) out.push({ key: NC, problem: NC, detail: `charger not running anywhere in the fleet: ${ch.why ?? 'no threads'}${ch.waiting && waited !== null ? ` (waiting ${waited.toFixed(0)} min)` : ''}` })
    } else if (want > 0 && stanek.progress?.flat) {
      const p = stanek.progress
      out.push({ key: NC, problem: NC, detail: `charge.js held ${p.chargerWas} threads but the gift's charge did not grow in ${p.minutes} min (mass ${p.prevMass} -> ${p.mass})${errText ? ` — ${errText}` : ' — no charge.js error reported'}` })
    } else if (errs.length) out.push({ key: NC, problem: NC, detail: `charge.js: ${errText}` })
  }
  out.push(...lifeLayoutHealthOf(stanek, now))
  out.push(...phaseHealthOf(stanek, now))
  return out
}
