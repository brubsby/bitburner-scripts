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
//     chosen once per grid size (optimiseLayout at the mid world's weights).
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
//     script's threads); sleeves with ZOE (CotMG on sleeves); the Bladeburner route with
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
export function layoutMults(placed, charge, nodePower = 1) {
  const m = { hacking: 1, hacking_exp: 1, hacking_speed: 1, hacking_money: 1, hacking_grow: 1, faction_rep: 1, company_rep: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, bladeburner_success_chance: 1 }
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
        break
      case TYPE.Defense:
        m.defense *= e
        break
      case TYPE.Dexterity:
        m.dexterity *= e
        break
      case TYPE.Agility:
        m.agility *= e
        break
      case TYPE.Bladeburner:
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
export function nodeModel(o) {
  const { layout, nodePower, repCost = 1, hours, cycleH, f, p, Hg, L0 = 750, favorU = 0.8 } = o
  const ramHours = o.ramHours ?? hours
  const duty = Math.min(1, Math.max(0, p.stDuty))
  const cl = compileLayout(layout)
  const k = cl.k
  const nLives = Math.max(1, Math.ceil(hours / cycleH - 1e-9))
  const tauLife = cycleH * 3600 * duty // charging seconds per life
  let level = 1 // gift level: 1 Genesis, 2 Awakening, 3 Serenity
  let favor = 0
  let sumI = 0
  let sumR = 0
  let wsum = 0
  const giftAt = { 2: null, 3: null }
  let favorMul = 1
  let end = null
  let W = 1
  const quad = [0.125, 0.375, 0.625, 0.875] // the life's charge ramp, midpoint rule
  for (let i = 0; i < nLives; i++) {
    const t0 = i * cycleH
    const len = Math.min(cycleH, hours - t0)
    const u = Math.min(1, (t0 + len / 2) / hours) // the node's own time fraction (rep, favor life)
    const uRam = Math.min(1, (t0 + len / 2) / ramHours) // hours into the node on the no-gift clock (RAM, augs)
    const home = homeAt(uRam, p.stRam)
    const T = threadsOf(home.ram * f, home.cores)
    const pen = PENALTY[level]
    const frAug = Math.pow(p.stFr, uRam)
    let lnI = 0
    let lnR = 0
    let mMid = null
    for (const q of quad) {
      const N = (q * tauLife * (len / cycleH)) / k
      const m = multsAt(cl, chargeFactor(T, N), nodePower)
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
    const rep = cl.charged.length ? tauLife * (len / cycleH) * chargeRep(T, frAug * Math.exp(lnR), favor) : 0 // nothing to charge, no rep
    if (i === nLives - 1) {
      // the exit: the end of the final life, home at its exit RAM
      const he = homeAt(Math.min(1, hours / ramHours), p.stRam)
      const Te = threadsOf(he.ram * f, he.cores)
      const N = (tauLife * (len / cycleH)) / k
      end = multsAt(cl, chargeFactor(Te, N), nodePower)
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
  return { W, dlng, favorMul, J: Math.log(W) + Hg * dlng, lives: nLives, giftAt, end, f }
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
export function giftStateOf(resetInfo, available) {
  // The capability rule lives in sfgate.js (canAccessCotMG); the caller passes it. A
  // missing answer throws: "could not tell" must never read as "no Church here".
  if (typeof available !== 'boolean') throw new Error('giftStateOf(resetInfo, available): pass sfgate.canAccessCotMG(resetInfo)')
  const node = resetInfo?.currentNode ?? null
  const names = namesOf(resetInfo?.ownedAugs)
  const accepted = names.includes(GENESIS)
  const blocking = accepted ? [] : names.filter((n) => n !== NFG)
  const want = available && GIFT_NODES.has(node)
  return {
    node,
    available,
    want,
    accepted,
    forfeited: !accepted && blocking.length > 0,
    blocking,
    why: !available
      ? 'no access to the Church (not BitNode 13, no Source-File 13)'
      : !want
        ? `BitNode ${node} is not one the stack accepts the gift in (stanekplan.GIFT_NODES: ${[...GIFT_NODES].join(', ')}) — the gameplan prices it per node and nothing in-game reads that yet`
        : accepted
          ? `accepted (${GENESIS} installed)`
          : blocking.length
            ? `FORFEITED: ${blocking.length} non-NeuroFlux augmentation(s) installed (${blocking.slice(0, 3).join(', ')}) — canAcceptStaneksGift can never pass in this node`
            : 'not accepted yet — acceptable (nothing but NeuroFlux installed)',
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
  if (!state?.want || state.accepted) return { allow: true, why: null, forfeited: false }
  if (state.forfeited) return { allow: true, forfeited: true, why: `GIFT FORFEITED (${state.why}) — the ${kind} order is not blocked: the gift can no longer be accepted in this node` }
  const aug = kind === 'buyaug' ? String(order?.args?.[1] ?? '') : kind === 'graft' ? String(order?.args?.[0] ?? '') : null
  if (kind === 'buyaug' && aug === NFG) return { allow: true, why: 'NeuroFlux Governor never blocks the gift', forfeited: false }
  return {
    allow: false,
    forfeited: false,
    why: `STANEK GATE: Stanek's Gift is not accepted yet in BitNode ${state.node} — ${kind}${aug ? ` '${aug}'` : ''} refused: ${kind === 'install' ? 'an install before the accept forfeits the gift for the node (or buys nothing)' : 'a non-NeuroFlux augmentation queued or grafted blocks acceptGift (canAcceptStaneksGift) and, installed, forfeits it for the node'}; stanek.js accepts it (${STANEK_FILE})`,
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
export function layoutForGrid(width, height, nodePower) {
  const key = `${width}x${height}|${nodePower}`
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
// THE CHARGING ALLOCATION, PRICED BY THE EXIT (progress.js stanekDecisionOf)
// ---------------------------------------------------------------------------
/**
 * The two trajectories of each comparison: the exit with the charger holding a
 * fraction f of home RAM vs the exit at another f (f = 0: no charging) — each the
 * SAME exit inputs (progress.js exitInputsOf) scaled by what f does to them, then the
 * exit simulator (plan.trajectoryGenOf). What f does, per life (charges clear at every
 * install and regrow, so every life repeats it):
 *   the gift   life-average multipliers at T = threadsOf(f x homeGB, cores) threads and
 *              numCharge growing tau/k per fragment (round robin, one 1s call each) over
 *              the life's quadrature (nodeModel's), duty ALLOC_DUTY
 *   the RAM    the batcher loses f x homeGB of fleetGB: income and exp x (1 - f homeGB/fleetGB)
 *   channels   income x speed x hacking (chance) / (a/money + (1-a)/grow);  exp x hacking_exp
 *              x speed;  rep x faction_rep x hacking (hacking work rep is linear in the
 *              level, reputation.ts);  hackingMult x hacking (the exit level)
 * Relative to the f the inputs were MEASURED under (fNow), so the option f = fNow
 * prices the measured inputs exactly.
 * NOT SIMULATED (stated, published): home RAM growing within the node (more threads
 * later: favours charging), the Church's rep -> Awakening/Serenity (favours charging),
 * bonus time, the batcher's income not being linear in its RAM.
 */
export const ALLOC_GRID = [0, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5]
/** The charger's duty in the live pricing (stated: restarts and the first minutes of a life). */
export const ALLOC_DUTY = 0.9

export function chargeLnOf({ layout, nodePower, homeGB, cores, fleetGB, f, cycleH, duty = ALLOC_DUTY, a = HACK_SHARE }) {
  const cl = compileLayout(layout)
  const ff = Math.max(0, f)
  const T = threadsOf(ff * homeGB, cores)
  const tau = Math.max(0, cycleH) * 3600 * duty
  const batchLoss = fleetGB > 0 ? Math.min(0.99, (ff * homeGB) / fleetGB) : 0
  const quad = [0.125, 0.375, 0.625, 0.875]
  let inc = 0
  let exp = 0
  let rep = 0
  let lnH = 0
  for (const q of quad) {
    const m = multsAt(cl, chargeFactor(T, (q * tau) / cl.k), nodePower)
    inc += (Math.log(m.hacking_speed) + Math.log(m.hacking) - Math.log(a / m.hacking_money + (1 - a) / m.hacking_grow)) / quad.length
    exp += (Math.log(m.hacking_exp) + Math.log(m.hacking_speed)) / quad.length
    rep += (Math.log(m.faction_rep) + Math.log(m.hacking)) / quad.length
    lnH += Math.log(m.hacking) / quad.length
  }
  const lnRam = Math.log(1 - batchLoss)
  return { threads: T, gb: Math.floor((ff * homeGB) / STANEK.ramPerThread) * STANEK.ramPerThread, batchLoss, lnIncome: inc + lnRam, lnExp: exp + lnRam, lnRep: rep, lnHack: lnH }
}

/** The exit inputs at charging fraction f, from inputs measured at ctx.fNow (see above). */
export function chargeInputsOf(base, ctx, f) {
  const at = chargeLnOf({ ...ctx, f })
  const now = chargeLnOf({ ...ctx, f: ctx.fNow ?? 0 })
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

/** The options a home can hold: f x homeGB within what is left after the reserve (f = 0 always). */
export const allocOptionsOf = (homeGB, reserveGb, grid = ALLOC_GRID) => grid.filter((f) => f === 0 || f * homeGB <= Math.max(0, homeGB - reserveGb))

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

/** The fraction used while no priced decision of this life exists (the layout's design point, LAYOUT_F; stated). */
export const DEFAULT_F = 0.2

/** The plan's allocation for this life (/tel/plan.txt decisions.stanek), or null. */
export function planAllocOf(text, lastAugReset, now = Date.now(), maxAgeMin = 45) {
  let rec = null
  try {
    rec = JSON.parse(text || 'null')
  } catch {
    return null
  }
  const d = rec?.decisions?.stanek
  if (!rec || rec.lastAugReset !== lastAugReset || !(now - Date.parse(rec.at ?? '') < maxAgeMin * 60e3)) return null
  if (typeof d?.f !== 'number' || !isFinite(d.f) || d.f < 0 || d.f > 1) return null
  return { f: d.f, why: String(d.why ?? '').slice(0, 240), at: rec.at }
}

/** progress.js's Singularity block on home — batch.js SETTINGS.homeReserve (SG5 keeps this copy honest). */
export const progressBlockGb = (singMult) => 13 + 6.25 * singMult

/**
 * The charger's thread count: f x homeMax, within what home has free beyond the
 * reserve (the running charger's own RAM counts as free: it is replaced).
 * Returns { want, can, threads, short }.
 */
export function chargerThreadsOf({ f, homeMax, homeUsed, reserveGb, runningGb = 0 }) {
  const want = Math.floor((Math.max(0, f) * homeMax) / STANEK.ramPerThread)
  const free = Math.max(0, homeMax - homeUsed + runningGb - reserveGb)
  const can = Math.floor(free / STANEK.ramPerThread)
  const threads = Math.min(want, can)
  return { want, can, threads, short: Math.max(0, want - threads) }
}

/**
 * The block batch.js keeps free on home for the charger: the wanted GB not yet held,
 * from a fresh record of this life. Unknown or stale: 0 (the charger takes what is
 * free and the shortfall is published as charger.short).
 */
export function stanekHoldGb(rec, lastAugReset, now = Date.now(), maxAgeMs = 15 * 60e3) {
  if (!rec || rec.lastAugReset !== lastAugReset || !(now - Date.parse(rec.at ?? '') < maxAgeMs)) return 0
  const c = rec.charger
  if (!c || typeof c.wantGb !== 'number' || typeof c.gb !== 'number') return 0
  return Math.max(0, c.wantGb - c.gb)
}

/**
 * The gift's health from /tel/stanek.txt and /tel/charge.txt (tools/healthcheck.mjs).
 * Returns [{ key, problem, detail }]:
 *   GIFT NOT ACCEPTED       wanted and not accepted past `graceMin` into the node, or
 *                           forfeited / refused at all
 *   FRAGMENTS NOT CHARGING  accepted with a layout placed, and the charger wanted but
 *                           not running, its heartbeat stale/absent, or erroring
 *   STANEK STALE            the record is old (stanek.js is not being run)
 */
export function stanekHealthOf({ stanek, charge, now = Date.now(), nodeStartMs = null, graceMin = 15, staleMin = 12 }) {
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
    const c = charge && charge.lastAugReset === stanek.lastAugReset ? charge : null
    const cAge = c ? (now - Date.parse(c.at ?? '')) / 60e3 : null
    const want = stanek.charger?.want ?? 0
    if (want > 0 && !((stanek.charger?.threads ?? 0) > 0)) out.push({ key: 'FRAGMENTS NOT CHARGING', problem: 'FRAGMENTS NOT CHARGING', detail: `charger not running: ${stanek.charger?.why ?? 'no threads'}` })
    else if (want > 0 && !(cAge !== null && cAge < 5)) out.push({ key: 'FRAGMENTS NOT CHARGING', problem: 'FRAGMENTS NOT CHARGING', detail: c ? `${CHARGE_FILE} heartbeat ${cAge.toFixed(1)} min old` : `${CHARGE_FILE} missing or from another life` })
    else if (c?.error) out.push({ key: 'FRAGMENTS NOT CHARGING', problem: 'FRAGMENTS NOT CHARGING', detail: `charge.js: ${c.error}` })
  }
  return out
}
