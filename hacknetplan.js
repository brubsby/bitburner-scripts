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
// Hacknet SERVERS (BN9 / SF9) are a different economy — hashes, not money.
// bestUpgrade/moneyRate are the NODE model and must only be called when
// sfgate.hasHacknetServers is false; the SERVER model is further down
// (hashRate, bestServerUpgrade, ramPolicy), priced in dollars at the
// sell-for-money rate — the floor every hash is worth, because the game
// itself converts overflow hashes to money at exactly that rate
// (HacknetHelpers.tsx processAllHacknetServerEarnings, wastedHashes).

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

/** How fresh the committed plan (/tel/plan.txt) must be to set the install point. */
export const PLAN_FRESH_MS = 20 * 60 * 1000

/**
 * Hours until the COMMITTED install, from the plan's install decision
 * (progress.js publishPlan: /tel/plan.txt decisions.install, or the pass's
 * own planCtx.decisions.install): 0 when it says install now, the time to its
 * `installAt` otherwise. Null when the decision is absent, from another life,
 * stale (`at` older than PLAN_FRESH_MS; pass `at: null` for an in-pass
 * decision) or carries no install time — the caller then falls back, named.
 */
export function committedInstallH(install, { lastAugReset, planLastAugReset, at = null, now = Date.now() } = {}) {
  if (!install || typeof install !== 'object') return null
  if (planLastAugReset !== undefined && planLastAugReset !== lastAugReset) return null
  if (at !== null && !(now - Date.parse(at) < PLAN_FRESH_MS)) return null
  if (install.install === true) return 0
  if (num(install.installAt)) return Math.max(0, (install.installAt - now) / 3600000)
  return null
}

/**
 * The install point every "until the install" pricing uses, in hours: the
 * committed plan first; else the gate's own answer (install now -> 0, hold
 * forever -> null = the final window, a positive best wait); else 0 with the
 * reason. { W, source, why }.
 */
export function installPointH({ gate, planInstall, planOpts } = {}) {
  if (gate?.install === true) return { W: 0, source: 'gate', why: 'the gate installs now' }
  if (gate?.holdForever === true) return { W: null, source: 'gate', why: 'the gate holds to the exit: the final window' }
  const c = committedInstallH(planInstall, planOpts)
  if (c !== null) return { W: c, source: 'plan', why: `the committed plan installs at ${planInstall?.key ?? '?'}` }
  const w = gate?.bestWait?.waitMs
  if (num(w) && w > 0) return { W: w / 3600000, source: 'gate', why: 'the gate best wait' }
  return { W: 0, source: 'fallback', why: 'no committed install time and no gate wait: priced as an install now' }
}

// ===========================================================================
// HACKNET SERVERS (BitNode 9, or any node with Source-File 9)
// ===========================================================================
//
// With hacknet servers (sfgate.hasHacknetServers: canAccessBitNodeFeature(9)
// && !disableHacknetServer, HacknetHelpers.tsx:35) the same ns.hacknet API
// buys a different thing: a SERVER (Hacknet/HacknetServer.ts) that produces
// HASHES, has up to 8TB of RAM scripts can run on, and is destroyed at every
// install like a node (PlayerObjectGeneralMethods.ts:130). Three facts shape
// everything below, all from source:
//
//   1. RUNNING SCRIPTS ON ONE COSTS HASHES. hashRate carries
//      (1 - ramUsed/maxRam) (formulas/HacknetServers.ts:14), and
//      HacknetServer.updateRamUsed re-rates on every launch. A server whose
//      RAM is full produces nothing. Any placer that treats it as free RAM is
//      silently burning the hash economy — see ramPolicy / hacknetHostAllowed.
//   2. A HASH IS WORTH AT LEAST $250k. "Sell for Money" is 4 hashes -> $1e6,
//      flat (HashUpgradesMetadata.tsx:9-22), and hashes stored past capacity
//      are sold at that same rate automatically (HacknetHelpers.tsx:419-428).
//      So $/hash = 250,000 is a FLOOR on a hash's value, never a guess; what
//      a hash buys beyond that is hashplan.js's job, decided by simulated exit.
//   3. ON ENTERING BN9 the game gives one server at level 100, 10 cores,
//      cache 5 (Prestige.ts:329-338, prestigeSourceFile only — NOT after an
//      install, and in other nodes only at SF9.3).

/** Hacknet/data/Constants.ts HacknetServerConstants. [HS1] parses the source. */
export const HS = {
  HashesPerLevel: 0.001,
  BaseCost: 50e3,
  RamBaseCost: 200e3,
  CoreBaseCost: 1e6,
  CacheBaseCost: 10e6,
  PurchaseMult: 3.2,
  UpgradeLevelMult: 1.1,
  UpgradeRamMult: 1.4,
  UpgradeCoreMult: 1.55,
  UpgradeCacheMult: 1.85,
  MaxServers: 20,
  MaxLevel: 300,
  MaxRam: 8192,
  MaxCores: 128,
  MaxCache: 15,
}

/** Sell for Money: 4 hashes -> $1e6 (HashUpgradesMetadata.tsx:9-22). */
export const DOLLARS_PER_HASH = 1e6 / 4

/**
 * formulas/HacknetServers.ts:calculateHashGainRate — hashes per second.
 * `mult` is Player.mults.hacknet_node_money, `nodeMoney` the BitNode's
 * HacknetNodeMoney (the SAME node multiplier nodes use: it is 0 in BN8, so
 * SF9 there buys servers that hash nothing).
 */
export function hashRate(level, ramUsed, maxRam, cores, mult, nodeMoney) {
  if (!num(level) || !num(ramUsed) || !num(maxRam) || maxRam <= 0 || !num(cores) || !num(mult) || !num(nodeMoney)) return null
  const base = HS.HashesPerLevel * level
  const ramMult = Math.pow(1.07, Math.log2(maxRam))
  const coreMult = 1 + (cores - 1) / 5
  const ramRatio = 1 - ramUsed / maxRam
  return base * ramMult * coreMult * ramRatio * mult * nodeMoney
}

/** formulas/HacknetServers.ts:calculateLevelUpgradeCost (note: exponent from the CURRENT level). */
export function serverLevelCost(startingLevel, extra = 1, costMult = 1) {
  const n = Math.round(extra)
  if (!num(n) || n < 1) return 0
  if (startingLevel + n > HS.MaxLevel) return Infinity
  let total = 0
  let cur = startingLevel
  for (let i = 0; i < n; i++) {
    total += Math.pow(HS.UpgradeLevelMult, cur)
    cur++
  }
  return 10 * HS.BaseCost * total * costMult
}

/** formulas/HacknetServers.ts:calculateRamUpgradeCost. */
export function serverRamCost(startingRam, extra = 1, costMult = 1) {
  const n = Math.round(extra)
  if (!num(n) || n < 1) return 0
  if (startingRam * Math.pow(2, n) > HS.MaxRam) return Infinity
  let total = 0
  let upgrades = Math.round(Math.log2(startingRam))
  let ram = startingRam
  for (let i = 0; i < n; i++) {
    total += ram * HS.RamBaseCost * Math.pow(HS.UpgradeRamMult, upgrades)
    ram *= 2
    upgrades++
  }
  return total * costMult
}

/** formulas/HacknetServers.ts:calculateCoreUpgradeCost. */
export function serverCoreCost(startingCores, extra = 1, costMult = 1) {
  const n = Math.round(extra)
  if (!num(n) || n < 1) return 0
  if (startingCores + n > HS.MaxCores) return Infinity
  let total = 0
  let cores = startingCores
  for (let i = 0; i < n; i++) {
    total += Math.pow(HS.UpgradeCoreMult, cores - 1)
    cores++
  }
  return total * HS.CoreBaseCost * costMult
}

/** formulas/HacknetServers.ts:calculateCacheUpgradeCost — no player multiplier exists for cache. */
export function cacheCost(startingCache, extra = 1) {
  const n = Math.round(extra)
  if (!num(n) || n < 1) return 0
  if (startingCache + n > HS.MaxCache) return Infinity
  let total = 0
  let c = startingCache
  for (let i = 0; i < n; i++) {
    total += Math.pow(HS.UpgradeCacheMult, c - 1)
    c++
  }
  return total * HS.CacheBaseCost
}

/** formulas/HacknetServers.ts:calculateServerCost — the n-th server (1-based); Infinity past MaxServers. */
export function serverCost(n, mult = 1) {
  if (!num(n) || n <= 0) return 0
  if (n - 1 >= HS.MaxServers) return Infinity
  return HS.BaseCost * Math.pow(HS.PurchaseMult, n - 1) * mult
}

/** HacknetServer.updateHashCapacity: 32 x 2^cache. */
export const hashCapacityOf = (cache) => (num(cache) ? 32 * Math.pow(2, cache) : null)

/**
 * The single best next SERVER purchase by payback, in DOLLARS at
 * `dollarsPerHash` (pass DOLLARS_PER_HASH: the floor, see fact 2). Same shape
 * as bestUpgrade, plus `hashGainPerSec`, so hacknet.js, verdict() and
 * progress.js's spend verdict (installgate spendExit.hacknet, which reads
 * best.cost and best.gainPerSec) price it with no change of their own.
 *
 * `servers`: [{level, ram (maxRam), cores, ramUsed}] from getNodeStats. The
 * gain of a RAM doubling includes the ramRatio change at today's ramUsed.
 * Cache is NOT a candidate: it produces no hashes (only capacity), and
 * hacknet.js buys it only when hashplan.js reports a capacity-bound choice.
 */
/**
 * Every single next purchase on a server fleet: [{kind, index, cost,
 * hashGainPerSec, gainPerSec, paybackH}], or {why} when the inputs are
 * unreadable. The one enumeration bestServerUpgrade and planHacknetBatch share.
 */
export function serverCandidates(servers, mults, nodeMoney, dollarsPerHash, o = {}) {
  const bad = multsProblem(mults)
  if (bad) return { why: bad }
  if (!num(nodeMoney) || nodeMoney < 0) return { why: 'HacknetNodeMoney unreadable' }
  if (!num(dollarsPerHash) || dollarsPerHash <= 0) return { why: 'dollars per hash unreadable' }
  if (!Array.isArray(servers)) return { why: 'server list unreadable' }
  if (nodeMoney === 0) return { why: 'HacknetNodeMoney is 0 in this node: hacknet servers hash nothing' }
  const m = mults.hacknet_node_money
  const rate = (s) => hashRate(s.level, num(s.ramUsed) ? s.ramUsed : 0, s.ram, s.cores, m, nodeMoney)
  const candidates = []
  servers.forEach((s, i) => {
    if (!num(s?.level) || !num(s?.ram) || !num(s?.cores)) return
    const base = rate(s)
    if (!num(base)) return
    const push = (kind, cost, after) => {
      if (!isFinite(cost) || !(cost > 0)) return
      const r = rate(after)
      if (!num(r)) return
      candidates.push({ kind, index: i, cost, hashGainPerSec: r - base, gainPerSec: (r - base) * dollarsPerHash })
    }
    push('level', serverLevelCost(s.level, 1, mults.hacknet_node_level_cost), { ...s, level: s.level + 1 })
    push('ram', serverRamCost(s.ram, 1, mults.hacknet_node_ram_cost), { ...s, ram: s.ram * 2 })
    push('core', serverCoreCost(s.cores, 1, mults.hacknet_node_core_cost), { ...s, cores: s.cores + 1 })
  })
  const maxN = num(o.maxNodes) ? Math.min(o.maxNodes, HS.MaxServers) : HS.MaxServers
  if (servers.length < maxN) {
    const sc = serverCost(servers.length + 1, mults.hacknet_node_purchase_cost)
    const r = rate({ level: 1, ram: 1, cores: 1, ramUsed: 0 })
    if (isFinite(sc) && sc > 0 && num(r)) candidates.push({ kind: 'node', index: servers.length, cost: sc, hashGainPerSec: r, gainPerSec: r * dollarsPerHash })
  }
  for (const c of candidates) c.paybackH = c.gainPerSec > 0 ? c.cost / c.gainPerSec / 3600 : Infinity
  return candidates
}

export function bestServerUpgrade(servers, mults, nodeMoney, dollarsPerHash, o = {}) {
  const candidates = serverCandidates(servers, mults, nodeMoney, dollarsPerHash, o)
  if (!Array.isArray(candidates)) return { best: null, why: candidates.why }
  if (!candidates.length) return { best: null, why: 'every server is maxed and no more can be bought' }
  candidates.sort((a, b) => a.paybackH - b.paybackH)
  return { best: candidates[0], considered: candidates.length }
}

/** The fleet after one purchase (pure). */
export function applyServerPurchase(servers, c) {
  if (c.kind === 'node') return [...servers, { level: 1, ram: 1, cores: 1, ramUsed: 0, cache: 1 }]
  return servers.map((s, i) => (i !== c.index ? s : { ...s, level: s.level + (c.kind === 'level' ? 1 : 0), ram: c.kind === 'ram' ? s.ram * 2 : s.ram, cores: s.cores + (c.kind === 'core' ? 1 : 0), cache: (s.cache ?? 1) + (c.kind === 'cache' ? 1 : 0) }))
}

/**
 * What $1 now, and $1/s from now, are worth at W hours with the trader's book
 * compounding at r = capitalReturnPerSec on min(balance, capitalCap)
 * (exitplan.hoursToMoney's capital term) from `money`, after capitalWarmupH:
 *   lump    the factor on a dollar held from now to W
 *   stream  seconds-equivalent of $1/s reinvested as it arrives, now to W
 * The book compounds only until it reaches the cap (a dollar above it earns
 * nothing). r = 0: lump 1, stream W x 3600. exitplan.capitalFutureValue is
 * this function (one implementation, so the batch and the verdict agree).
 */
export function capitalFV(capital, W) {
  const T = Math.max(0, num(W) ? W : 0) * 3600
  const r = num(capital?.capitalReturnPerSec) && capital.capitalReturnPerSec > 0 ? capital.capitalReturnPerSec : 0
  if (!(r > 0) || !(T > 0)) return { lump: 1, stream: T }
  const warm = Math.min(T, num(capital.capitalWarmupH) && capital.capitalWarmupH > 0 ? capital.capitalWarmupH * 3600 : 0)
  const m = num(capital.money) && capital.money > 0 ? capital.money : 0
  const cap = num(capital.capitalCap) && capital.capitalCap > 0 ? capital.capitalCap : Infinity
  const toCap = m > 0 && isFinite(cap) ? (m >= cap ? 0 : Math.log(cap / m) / r) : Infinity
  const end = Math.min(T, warm + toCap)
  const span = Math.max(0, end - warm)
  const lump = Math.exp(r * span)
  const stream = warm * lump + (span > 0 ? Math.expm1(r * span) / r : 0) + Math.max(0, T - end)
  return { lump, stream }
}

/**
 * THE PURCHASE BATCH, by marginal return per dollar (a generator: one step
 * per purchase chosen, so coop.makePacer can slice it off the page thread).
 *
 * Every candidate is valued in the currency the exit decides in: the money it
 * adds at the install point W, `gainPerSec x stream - cost x lump`, with the
 * trader's book compounding on both sides (capitalFV; with no trader, lump 1
 * and stream W x 3600, i.e. `gain x W - cost`). A purchase is in the batch iff
 * that is positive (money-dominant — plan.decideSpend's rule); the batch takes
 * them in order of that value PER DOLLAR, greedily, re-enumerating after each
 * (a level makes the next level the candidate). `order: 'payback'` takes them
 * by payback instead — kept only so the replay can show where they differ.
 *
 * A new server hashes almost nothing at level 1: its value is the cheap
 * upgrades it opens. It is therefore priced as a BUNDLE (the server plus the
 * greedy run of its own upgrades that each add money at W), and taken when
 * the bundle's value per dollar beats the best single step.
 *
 * Bounded: `maxItems` purchases, `budget` dollars. Returns {items, cost,
 * gainPerSec, hashGainPerSec, netAtW, servers, stoppedBy}.
 */
export function* planHacknetBatchGen({ servers, mults, nodeMoney, dollarsPerHash = DOLLARS_PER_HASH, W, capital = null, budget = Infinity, maxItems = 400, order = 'value', maxNodes } = {}) {
  const out = { items: [], cost: 0, gainPerSec: 0, hashGainPerSec: 0, netAtW: 0, servers, stoppedBy: null }
  if (!num(W) || !(W > 0)) return { ...out, stoppedBy: 'no install horizon' }
  const fv = capitalFV(capital, W)
  const net = (c) => c.gainPerSec * fv.stream - c.cost * fv.lump
  let fleet = servers
  let left = num(budget) ? budget : Infinity
  const bundleMemo = new Map()
  while (out.items.length < maxItems) {
    const cands = serverCandidates(fleet, mults, nodeMoney, dollarsPerHash, { maxNodes })
    if (!Array.isArray(cands)) return { ...out, stoppedBy: cands.why }
    let best = null
    let bestKey = -Infinity
    for (const c of cands) {
      if (c.cost > left) continue
      let v = net(c)
      let cost = c.cost
      if (c.kind === 'node' && bundleMemo.has(fleet.length) && bundleMemo.get(fleet.length).cost <= left) {
        // Same fleet size, same price, same horizon: the same bundle.
        v = bundleMemo.get(fleet.length).v
        cost = bundleMemo.get(fleet.length).cost
      } else if (c.kind === 'node') {
        // The bundle: the new server, then its own upgrades while each adds
        // money — enumerated on that server alone (its upgrades do not depend
        // on the rest of the fleet), so the lookahead costs one server's
        // candidates per step, not the fleet's.
        let one = [{ level: 1, ram: 1, cores: 1, ramUsed: 0 }]
        for (let k = 0; k < 60; k++) {
          const own = serverCandidates(one, mults, nodeMoney, dollarsPerHash, { maxNodes: 1 })
          if (!Array.isArray(own)) break
          let b = null
          for (const u of own) if (net(u) > 0 && (!b || net(u) / u.cost > net(b) / b.cost)) b = u
          if (!b || cost + b.cost > left) break
          v += net(b)
          cost += b.cost
          one = applyServerPurchase(one, b)
        }
        bundleMemo.set(fleet.length, { v, cost })
      }
      if (!(v > 0)) continue
      const key = order === 'payback' ? -c.paybackH : v / cost
      if (key > bestKey) {
        bestKey = key
        best = c
      }
    }
    if (!best) return { ...out, servers: fleet, stoppedBy: out.items.length ? 'nothing else adds money at the install' : 'no purchase adds money at the install' }
    const v1 = net(best)
    out.items.push({ ...best, netAtW: v1 })
    out.cost += best.cost
    out.gainPerSec += best.gainPerSec
    out.hashGainPerSec += best.hashGainPerSec
    out.netAtW += v1
    left -= best.cost
    fleet = applyServerPurchase(fleet, best)
    out.servers = fleet
    yield out.items.length
  }
  return { ...out, stoppedBy: `maxItems ${maxItems}` }
}

/** planHacknetBatchGen run to completion synchronously; one step per purchase, so maxItems caps it. */
export function planHacknetBatch(o) {
  const g = planHacknetBatchGen(o)
  const cap = (num(o?.maxItems) ? o.maxItems : 400) + 1
  for (let steps = 0; steps <= cap; steps++) {
    const r = g.next()
    if (r.done) return r.value
  }
  throw new Error(`planHacknetBatch: the generator ran past maxItems (${cap} steps)`)
}

/**
 * The Netburners invitation with SERVERS (FactionInfo.tsx:675: hacking 80,
 * total hacknet RAM 8, cores 4, levels 100; FactionJoinCondition.ts
 * iterateHacknet sums maxRam/cores/level over servers exactly as over nodes).
 * The cheapest purchase per unit of a still-short requirement it closes
 * (capped at the shortfall), or null when every requirement is met.
 * A server bought at level 1 / 1GB / 1 core moves all three at once.
 */
export function netburnersServerStep(servers, need, mults) {
  if (!Array.isArray(servers) || multsProblem(mults)) return null
  const tot = { levels: 0, ram: 0, cores: 0 }
  for (const s of servers) {
    tot.levels += s.level ?? 0
    tot.ram += s.ram ?? 0
    tot.cores += s.cores ?? 0
  }
  const short = { levels: Math.max(0, need.levels - tot.levels), ram: Math.max(0, need.ram - tot.ram), cores: Math.max(0, need.cores - tot.cores) }
  if (!short.levels && !short.ram && !short.cores) return null
  const cands = []
  const add = (kind, index, cost, d) => {
    const closes = Math.min(short.levels, d.levels ?? 0) + Math.min(short.ram, d.ram ?? 0) + Math.min(short.cores, d.cores ?? 0)
    if (closes > 0 && isFinite(cost) && cost > 0) cands.push({ kind, index, cost, closes, perUnit: cost / closes })
  }
  servers.forEach((s, i) => {
    if (short.levels) add('level', i, serverLevelCost(s.level, 1, mults.hacknet_node_level_cost), { levels: 1 })
    if (short.ram) add('ram', i, serverRamCost(s.ram, 1, mults.hacknet_node_ram_cost), { ram: s.ram })
    if (short.cores) add('core', i, serverCoreCost(s.cores, 1, mults.hacknet_node_core_cost), { cores: 1 })
  })
  if (servers.length < HS.MaxServers) add('node', servers.length, serverCost(servers.length + 1, mults.hacknet_node_purchase_cost), { levels: 1, ram: 1, cores: 1 })
  if (!cands.length) return { best: null, short, why: 'no purchase closes the shortfall' }
  cands.sort((a, b) => a.perUnit - b.perUnit)
  return { best: cands[0], short }
}

/**
 * Is a hostname a hacknet SERVER? PlayerObjectServerMethods.ts:48 names them
 * `hacknet-server-<n>` (and nodes are not servers at all), so the name is the
 * game's own marker — read without ns.getServer's 2GB.
 */
export const isHacknetServerHost = (host) => typeof host === 'string' && /^hacknet-server-\d+$/.test(host)

/**
 * Should a batcher/seeder use this hacknet server's RAM? Both sides are
 * income that lasts until the next install, so on the exit trajectory they
 * differ only in the money at the install point — and money at a fixed point
 * is linear in the rate, so comparing the two RATES is the trajectory
 * comparison (exitplan.spendExit's m0 - cost + gain x W, with no cost):
 *
 *   batch   batchPerGBs    the batcher's $/s per GB (ram.total against its
 *                          own earnings — the linear response of a RAM-bound
 *                          batcher, as progress.js prices home RAM)
 *   hashes  fullRate/maxRam x $/hash — every GB used takes that share of the
 *                          server's production (hashRate's ramRatio term)
 *
 * The hash side uses the SELL floor, so if hashplan.js is buying upgrades
 * worth more than selling, this understates the hashes and leans toward
 * using the RAM — stated, not hidden. Unreadable batch income => false (a
 * server's hashes are never given away on an unknown). The core bonus a
 * 10+-core hacknet host gives grow/weaken is left out: a floor on the batch
 * side, the conservative direction.
 */
export function ramPolicy(servers, mults, nodeMoney, batchPerGBs, dollarsPerHash = DOLLARS_PER_HASH) {
  const out = {}
  if (!Array.isArray(servers)) return out
  for (const s of servers) {
    if (!s?.name) continue
    const full = hashRate(s.level, 0, s.ram, s.cores, mults?.hacknet_node_money, nodeMoney)
    const hashPerGBs = num(full) && s.ram > 0 ? (full / s.ram) * dollarsPerHash : null
    const batchOk = num(batchPerGBs) && batchPerGBs > 0
    const allow = batchOk && num(hashPerGBs) && batchPerGBs > hashPerGBs
    out[s.name] = {
      allow,
      maxRam: s.ram,
      hashPerGBs,
      batchPerGBs: batchOk ? batchPerGBs : null,
      why: !batchOk ? 'batch income per GB unreadable: hashes kept' : !num(hashPerGBs) ? 'hash rate unreadable: hashes kept' : allow ? `batch $${batchPerGBs.toPrecision(3)}/GB/s beats hashes $${hashPerGBs.toPrecision(3)}/GB/s` : `hashes $${hashPerGBs.toPrecision(3)}/GB/s beat batch $${batchPerGBs.toPrecision(3)}/GB/s`,
    }
  }
  return out
}

/** How fresh hacknet.js's ramPolicy must be to be trusted (it republishes every pass, <= 30s). */
export const RAM_POLICY_FRESH_MS = 5 * 60 * 1000

/**
 * May a script be placed on `host`? true for every host that is not a hacknet
 * server. For a hacknet server, only on a FRESH ramPolicy from hacknet.js
 * (`/tel/hacknet.txt`, passed as its text) that allows it. Missing, stale or
 * unreadable => false: the fail-closed direction, because the cost of a wrong
 * true is the node's hash production and the cost of a wrong false is a few GB.
 */
export function hacknetHostAllowed(host, policyText, now = Date.now()) {
  if (!isHacknetServerHost(host)) return true
  let d
  try {
    d = typeof policyText === 'string' ? JSON.parse(policyText || 'null') : policyText
  } catch {
    return false
  }
  if (!d || !(now - Date.parse(d.at) < RAM_POLICY_FRESH_MS)) return false
  return d.ramPolicy?.[host]?.allow === true
}

/** Sort key: hacknet servers last, for placers that fall back to them only when nothing else fits. */
export const hacknetLast = (a, b) => (isHacknetServerHost(a) ? 1 : 0) - (isHacknetServerHost(b) ? 1 : 0)

/**
 * Hours left in this life, from two witnesses that the caller has already
 * checked for freshness and life-stamp (pass null for a stale or foreign one):
 *
 *   ledger — the planner's window from the lifetimes ledger (factionplan.txt):
 *            { windowH, lifeAgeH, ageMs }. A MEDIAN of past lives.
 *   gate   — the install gate's own decision (installgate.txt):
 *            { install, waitMs, ageMs, passMs }. passMs is the planner's job
 *            interval: a holding planner cannot install before it runs again,
 *            so the hold is at least that long from the gate's stamp — without
 *            it a 3-minute hold read on a 10-minute pass cadence left the
 *            claimant blind for the 7 minutes in between.
 *
 * The failure this prevents (2026-09-19, BN2 second life): the ledger window
 * was 0.56h, the life was 1h old, and the gate was holding — "waiting 0.1h
 * buys M=1.52". The ledger alone read "0.0min left" and every purchase was
 * refused for the rest of the life. A gate that is holding has said it will
 * not install before its wait elapses, so that wait is a floor on what is
 * left; the ledger's window is the other witness; the larger of the two is
 * the horizon. A gate that says install means 0. Neither readable means null,
 * and verdict() refuses on null.
 */
export function remainingLife({ ledger, gate, plan } = {}) {
  // THE COMMITTED PLAN IS THE AUTHORITY (plan: {hours}, from committedInstallH
  // below). The ledger window is a median of PAST lives and the gate's hold is
  // a floor; neither is when this life ends once the plan has committed an
  // install time. Live in BitNode 9 on 2026-09-28 the plan held w20.99 while
  // this read the ledger's 0.07h: every hacknet purchase — a 3-minute payback
  // among them — was refused as outliving a life with 21 hours left.
  if (plan && num(plan.hours) && plan.hours >= 0) return { hours: plan.hours, why: null, source: 'plan' }
  if (gate && gate.install === true) return { hours: 0, why: 'the install gate says install', source: 'gate' }
  const ledgerH = ledger && num(ledger.windowH) && ledger.windowH > 0 ? Math.max(0, ledger.windowH - (num(ledger.lifeAgeH) ? ledger.lifeAgeH : 0) - (num(ledger.ageMs) ? ledger.ageMs : 0) / 3600000) : null
  const holdMs = gate && gate.install === false ? Math.max(num(gate.waitMs) && gate.waitMs > 0 ? gate.waitMs : 0, num(gate.passMs) && gate.passMs > 0 ? gate.passMs : 0) : 0
  const gateH = holdMs > 0 ? Math.max(0, (holdMs - (num(gate.ageMs) ? gate.ageMs : 0)) / 3600000) : null
  if (ledgerH === null && gateH === null) return { hours: null, why: 'neither the ledger window nor the install gate is readable', source: null }
  if (gateH === null) return { hours: ledgerH, why: null, source: 'ledger' }
  if (ledgerH === null) return { hours: gateH, why: null, source: 'gate' }
  return gateH > ledgerH ? { hours: gateH, why: null, source: 'gate' } : { hours: ledgerH, why: null, source: 'ledger' }
}
