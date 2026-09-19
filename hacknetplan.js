// Hacknet as a CLAIMANT: what is the best next hacknet purchase worth, and
// does it pay for itself before the next install destroys it? Pure, no ns.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
//
// hacknet.js bought exactly enough capacity for the Netburners invitation and
// stopped. Eight nodes ran, their production was invisible to every forecast,
// and hacknet spending competed with nothing: budget.js's PRIORITY did not
// list it, so it could neither win against augmentations nor lose to them —
// it simply was not in the economy (docs/pricing-gaps.md §4).
//
// ---------------------------------------------------------------------------
// THE MODEL, from Hacknet/formulas/HacknetNodes.ts and Hacknet/data/Constants.ts
//
//   production/s = level x 1.5 x 1.035^(ram-1) x (cores+5)/6
//                  x mults.hacknet_node_money x HacknetNodeMoney
//   level cost   = 500 x sum_{k} 1.04^k over the levels bought x mults.hacknet_node_level_cost
//   ram cost     = 30e3 x sum ram_i x 1.28^(upgrades so far) x mults.hacknet_node_ram_cost
//   core cost    = 500e3 x sum 1.48^(cores-1) x mults.hacknet_node_core_cost
//   node n cost  = 1000 x 1.85^(n-1) x mults.hacknet_node_purchase_cost
//
// hacknetplan.test.mjs [HN1] evaluates these against the game's own formulas.
//
// ---------------------------------------------------------------------------
// THE DECISION
//
// A node is destroyed at the next install, along with its production stream
// and the money it produced (prestigeAugmentation resets both). So the only
// question is whether the purchase RETURNS its cost before that:
//
//     buy  iff  gainPerSec x remainingLifeSec > cost      (paybackH < remainingH)
//
// with `remainingH` the measured install window minus this life's age — the
// same horizon joinplan.js uses. Money that comes back before the install is
// money the augmentation budget gets to spend; money that does not is gone
// either way. The rule therefore lets hacknet LOSE to augmentations exactly
// when it should: the augmentation claim is held by budget.js's reserve and
// this file only ever spends what is left after it. No fixed budget fraction,
// no "buy up to N nodes", no assumption about which BitNode this is.
//
// Hacknet SERVERS (BN9 / SF9) are a different economy — hashes, not money —
// and are refused here: sfgate.hasHacknetServers must be false.

const num = (x) => typeof x === 'number' && isFinite(x)

/** Hacknet/data/Constants.ts:1-17. */
export const HN = {
  MoneyGainPerLevel: 1.5,
  BaseCost: 1000,
  LevelBaseCost: 500,
  RamBaseCost: 30e3,
  CoreBaseCost: 500e3,
  PurchaseNextMult: 1.85,
  UpgradeLevelMult: 1.04,
  UpgradeRamMult: 1.28,
  UpgradeCoreMult: 1.48,
  MaxLevel: 200,
  MaxRam: 64,
  MaxCores: 16,
}

/** HacknetNodes.ts:calculateMoneyGainRate — dollars per second. */
export function moneyRate(level, ram, cores, mult, nodeMoney) {
  if (!num(level) || !num(ram) || !num(cores) || !num(mult) || !num(nodeMoney)) return null
  return level * HN.MoneyGainPerLevel * Math.pow(1.035, ram - 1) * ((cores + 5) / 6) * mult * nodeMoney
}

/** HacknetNodes.ts:calculateLevelUpgradeCost. */
export function levelCost(startingLevel, extra = 1, costMult = 1) {
  const n = Math.round(extra)
  if (!num(n) || n < 1) return 0
  if (startingLevel + n > HN.MaxLevel) return Infinity
  let total = 0
  let cur = startingLevel - 1
  for (let i = 0; i < n; i++) {
    total += Math.pow(HN.UpgradeLevelMult, cur)
    cur++
  }
  return HN.LevelBaseCost * total * costMult
}

/** HacknetNodes.ts:calculateRamUpgradeCost. */
export function ramCost(startingRam, extra = 1, costMult = 1) {
  const n = Math.round(extra)
  if (!num(n) || n < 1) return 0
  if (startingRam * Math.pow(2, n) > HN.MaxRam) return Infinity
  let total = 0
  let upgrades = Math.round(Math.log2(startingRam))
  let ram = startingRam
  for (let i = 0; i < n; i++) {
    total += ram * HN.RamBaseCost * Math.pow(HN.UpgradeRamMult, upgrades)
    ram *= 2
    upgrades++
  }
  return total * costMult
}

/** HacknetNodes.ts:calculateCoreUpgradeCost. */
export function coreCost(startingCores, extra = 1, costMult = 1) {
  const n = Math.round(extra)
  if (!num(n) || n < 1) return 0
  if (startingCores + n > HN.MaxCores) return Infinity
  let total = 0
  let cores = startingCores
  for (let i = 0; i < n; i++) {
    total += HN.CoreBaseCost * Math.pow(HN.UpgradeCoreMult, cores - 1)
    cores++
  }
  return total * costMult
}

/** HacknetNodes.ts:calculateNodeCost — the n-th node (1-based). */
export function nodeCost(n, mult = 1) {
  if (!num(n) || n <= 0) return 0
  return HN.BaseCost * Math.pow(HN.PurchaseNextMult, n - 1) * mult
}

function multsProblem(mults) {
  for (const k of ['hacknet_node_money', 'hacknet_node_purchase_cost', 'hacknet_node_level_cost', 'hacknet_node_ram_cost', 'hacknet_node_core_cost']) {
    if (!num(mults?.[k]) || mults[k] < 0) return `mults.${k} unreadable`
  }
  return null
}

/**
 * The single best next purchase across every node and a new node, ranked by
 * payback: `{ kind: 'level'|'ram'|'core'|'node', index, cost, gainPerSec,
 * paybackH }`, or `{ best: null, why }` when nothing can be bought or the
 * inputs cannot be read. `nodes` is `[{level, ram, cores}]` from
 * ns.hacknet.getNodeStats; `nodeMoney` is the BitNode's HacknetNodeMoney.
 */
export function bestUpgrade(nodes, mults, nodeMoney, o = {}) {
  const bad = multsProblem(mults)
  if (bad) return { best: null, why: bad }
  if (!num(nodeMoney) || nodeMoney < 0) return { best: null, why: 'HacknetNodeMoney unreadable' }
  if (!Array.isArray(nodes)) return { best: null, why: 'node list unreadable' }
  if (nodeMoney === 0) return { best: null, why: 'HacknetNodeMoney is 0 in this node: hacknet earns nothing' }
  const candidates = []
  const rate = (n) => moneyRate(n.level, n.ram, n.cores, mults.hacknet_node_money, nodeMoney)
  nodes.forEach((n, i) => {
    if (!num(n?.level) || !num(n?.ram) || !num(n?.cores)) return
    const base = rate(n)
    const lc = levelCost(n.level, 1, mults.hacknet_node_level_cost)
    if (isFinite(lc) && lc > 0) candidates.push({ kind: 'level', index: i, cost: lc, gainPerSec: rate({ ...n, level: n.level + 1 }) - base })
    const rc = ramCost(n.ram, 1, mults.hacknet_node_ram_cost)
    if (isFinite(rc) && rc > 0) candidates.push({ kind: 'ram', index: i, cost: rc, gainPerSec: rate({ ...n, ram: n.ram * 2 }) - base })
    const cc = coreCost(n.cores, 1, mults.hacknet_node_core_cost)
    if (isFinite(cc) && cc > 0) candidates.push({ kind: 'core', index: i, cost: cc, gainPerSec: rate({ ...n, cores: n.cores + 1 }) - base })
  })
  const maxNodes = num(o.maxNodes) ? o.maxNodes : Infinity
  if (nodes.length < maxNodes) {
    const nc = nodeCost(nodes.length + 1, mults.hacknet_node_purchase_cost)
    if (nc > 0) candidates.push({ kind: 'node', index: nodes.length, cost: nc, gainPerSec: rate({ level: 1, ram: 1, cores: 1 }) })
  }
  if (!candidates.length) return { best: null, why: 'every node is maxed and no more can be bought' }
  for (const c of candidates) c.paybackH = c.gainPerSec > 0 ? c.cost / c.gainPerSec / 3600 : Infinity
  candidates.sort((a, b) => a.paybackH - b.paybackH)
  return { best: candidates[0], considered: candidates.length }
}

/**
 * Buy or not: the purchase must return its cost inside what is left of this
 * life. `remainingH` unreadable means refuse — a node bought against an
 * unknown horizon is a node bought against a guess.
 */
export function verdict(best, remainingH) {
  if (!best) return { buy: false, why: 'nothing to buy' }
  if (!num(remainingH) || remainingH < 0) return { buy: false, why: 'remaining life unmeasured' }
  if (!(best.paybackH < remainingH)) {
    return { buy: false, why: `${best.kind}#${best.index} pays back in ${fmtH(best.paybackH)} but the life has ${fmtH(remainingH)} left` }
  }
  return { buy: true, why: `${best.kind}#${best.index} pays back in ${fmtH(best.paybackH)} of ${fmtH(remainingH)} left` }
}

const fmtH = (h) => (h === Infinity ? 'never' : h < 1 ? `${(h * 60).toFixed(1)}min` : `${h.toFixed(2)}h`)
