// THE DAEDALUS COUNT GATE IN THE EXIT SIMULATION — tickets vs NeuroFlux vs
// waiting, as trajectories.
//
// Pure: no ns surface; progress.js and the tests import it.
//
// Daedalus admits only with DaedalusAugsRequirement distinct INSTALLED
// augmentations (30 in BitNode 8; FactionInfo.tsx haveAugmentations reads
// Player.augmentations), and The Red Pill is sold only by Daedalus. So while
// the count is short the exit is unreachable without installs that bank
// distinct augmentations — "never install" is not a policy, it is the end of
// the run. exitplan.exitHours did not know this: it priced the exit's money,
// reputation and climb legs and nothing else, so a comparison could say
// "never install" while the gate stood (the 912cd3e veto rested on that).
//
// WHAT THIS MODELS, per install of the count phase:
//   budget   the money in hand when that install happens — now (or after a
//            wait) for the first, and the node's opening balance compounded
//            over one life (cycleHours) for every later one: in BitNode 8 the
//            trader's return on $250m, since an install resets the book
//            (Prestige.ts:158, :166-170)
//   batch    n tickets — the n cheapest distinct unowned augmentations, bought
//            most-expensive-first so the 1.9^k escalation lands on the cheap
//            ones (AugmentationHelpers.ts:133-138, CLAUDE.md) — then NeuroFlux
//            levels with what is left: base x 1.14^L x 1.9^(queued)
//   gain     the batch's hacking multiplier: each ticket's own `hacking` mult
//            times 1.01 per NeuroFlux level (+1% to every multiplier)
//   count    n distinct augmentations toward the requirement
// `n` — tickets per install — is THE COMPOSITION DECISION, searched: every
// install buys min(n, affordable) tickets and spends the rest on NeuroFlux.
// Once the count is met, installs revert to the measured (or prior) cadence.
//
// Each composition is handed to exitplan.bestExitPolicy as per-install
// multiplier lifts (perCycleExtra.byInstall) with minInstalls = the installs
// the count needs, so every policy it can return meets the gate first.
//
// NOT SIMULATED, named: faction membership and reputation per life (a later
// life's ticket is priced with its WHOLE reputation bought by donation where
// its faction accepts donations, else as its base price only — optimistic
// when a faction must be re-joined or re-ground); augmentation prerequisites.
// NOT CALIBRATED: the per-life budget is the trader's measured return
// compounded, the same model the exit's money legs use.

const num = (x) => typeof x === 'number' && isFinite(x)
const pos = (x) => num(x) && x > 0

export const PRICE_MULT = 1.9 // MultipleAugMultiplier
export const NFG_LEVEL_MULT = 1.14 // AugmentationHelpers NeuroFlux level multiplier
export const NFG_HACK = 1.01 // NeuroFlux Governor: +1% to every multiplier per level

/**
 * The ticket ladder: distinct unowned augmentations (not NeuroFlux), each with
 * its money price this life (`price`: base + donation for the reputation short
 * now) and in a later life (`laterPrice`: base + the whole requirement bought,
 * null when that cannot be bought), and its hacking multiplier. Sorted by
 * this-life price ascending.
 */
export function ticketLadder(offers, owned, { nfgName = 'NeuroFlux Governor', laterDonation = null } = {}) {
  const have = owned instanceof Set ? owned : new Set(owned ?? [])
  const byName = new Map()
  for (const o of offers ?? []) {
    if (!o || o.name === nfgName || have.has(o.name) || !pos(o.baseCost)) continue
    const short = Math.max(0, (o.repReq ?? 0) - (o.factionRep ?? 0))
    const price = short > 0 ? (num(o.donationCost) ? o.baseCost + o.donationCost : null) : o.baseCost
    if (price === null) continue
    const later = typeof laterDonation === 'function' ? laterDonation(o) : null
    const row = { name: o.name, price, laterPrice: num(later) ? o.baseCost + later : o.baseCost, hacking: pos(o.mults?.hacking) ? o.mults.hacking : 1 }
    const cur = byName.get(o.name)
    if (!cur || row.price < cur.price) byName.set(o.name, row)
  }
  return [...byName.values()].sort((a, b) => a.price - b.price)
}

/**
 * One install's batch from `budget`: up to `n` tickets (the n cheapest), bought
 * most expensive first, then NeuroFlux levels. `nfg` {price (next level's
 * current base, no queue multiplier), level}. Returns {count, cost, gain,
 * nfgLevels, spent}.
 */
export function bankBatch({ budget, ladder, n, nfg = null, later = false }) {
  const priceOf = (t) => (later ? t.laterPrice : t.price)
  const cheapest = (ladder ?? []).slice().sort((a, b) => priceOf(a) - priceOf(b))
  let take = 0
  let chosen = []
  // The largest k <= n whose most-expensive-first cost fits the budget.
  for (let k = Math.min(n, cheapest.length); k >= 1; k--) {
    const pick = cheapest.slice(0, k).sort((a, b) => priceOf(b) - priceOf(a))
    let c = 0
    for (let i = 0; i < pick.length; i++) c += priceOf(pick[i]) * Math.pow(PRICE_MULT, i)
    if (c <= budget) {
      take = k
      chosen = pick
      break
    }
  }
  let spent = 0
  let gain = 1
  for (let i = 0; i < chosen.length; i++) {
    spent += priceOf(chosen[i]) * Math.pow(PRICE_MULT, i)
    gain *= chosen[i].hacking
  }
  let levels = 0
  if (nfg && pos(nfg.price)) {
    for (;;) {
      const p = nfg.price * Math.pow(NFG_LEVEL_MULT, levels) * Math.pow(PRICE_MULT, take + levels)
      if (spent + p > budget || levels > 200) break
      spent += p
      levels++
    }
    gain *= Math.pow(NFG_HACK, levels)
  }
  return { count: take, cost: spent, gain, nfgLevels: levels, chosen: chosen.map((t) => t.name) }
}

/** Money in hand after `hours` from `money0`: capital r x min(money, cap) compounding plus a flat rate. */
export function moneyAfter(money0, hours, { capitalReturnPerSec = 0, capitalCap = Infinity, flatPerSec = 0 } = {}) {
  const T = Math.max(0, hours) * 3600
  let m = Math.max(0, money0)
  const r = pos(capitalReturnPerSec) ? capitalReturnPerSec : 0
  const cap = pos(capitalCap) ? capitalCap : Infinity
  if (r > 0) {
    if (m >= cap) m += r * cap * T
    else {
      const tCap = m > 0 ? Math.log(cap / m) / r : Infinity
      m = T <= tCap ? m * Math.exp(r * T) : cap + r * cap * (T - tCap)
    }
  }
  return m + (pos(flatPerSec) ? flatPerSec * T : 0)
}

/**
 * The count phase for one composition `n`: install by install until the
 * requirement is banked. Returns {installs, perInstall: [{count, gain, ...}]}
 * or {installs: null, why} when some install banks nothing (unreachable).
 */
export function countPhase(o) {
  const { short, ladder, n, inputs, firstInstallH = 0, nfg = null, maxInstalls = 60 } = o
  if (!(short > 0)) return { installs: 0, perInstall: [] }
  let left = short
  let remaining = (ladder ?? []).slice()
  let level = nfg?.level ?? 0
  const per = []
  for (let i = 0; i < maxInstalls && left > 0; i++) {
    const budget =
      i === 0
        ? moneyAfter(inputs.money ?? 0, firstInstallH, inputs)
        : moneyAfter(num(inputs.installCash) ? inputs.installCash : 0, inputs.cycleHours ?? 0, inputs)
    const b = bankBatch({ budget, ladder: remaining, n: Math.min(n, left), nfg: nfg ? { price: nfg.price * Math.pow(NFG_LEVEL_MULT, level - (nfg.level ?? 0)) } : null, later: i > 0 })
    if (b.count === 0) return { installs: null, why: `install ${i + 1} cannot afford one ticket ($${Math.round(budget)} in hand)`, perInstall: per }
    per.push({ ...b, budget })
    left -= b.count
    level += b.nfgLevels
    const got = new Set(b.chosen)
    remaining = remaining.filter((t) => !got.has(t.name))
  }
  if (left > 0) return { installs: null, why: `the count is still ${left} short after ${maxInstalls} installs`, perInstall: per }
  return { installs: per.length, perInstall: per }
}

/**
 * THE COUNT-AWARE EXIT: for each composition n, the count phase's installs
 * become per-install lifts on the policy search (installs beyond it follow the
 * cadence), with minInstalls = the count phase's length. The soonest exit
 * over n wins. `firstInstallH` is the first install's time (0 = now; a wait
 * otherwise). Returns {best: {hours, installsFirst, n, firstBatch,
 * countInstalls}, tried: [{n, hours, why}], never} or {best: null, why}.
 * `never` is null while the count is short — never installing cannot reach
 * Daedalus at all.
 */
export function bestCountExit(bestExitPolicy, inputs, count, { firstInstallH = 0, compositions = null } = {}) {
  if (typeof bestExitPolicy !== 'function' || !inputs || !count) return { best: null, why: 'no count model inputs' }
  const short = count.short
  if (!(short > 0)) {
    const r = bestExitPolicy({ ...inputs, firstInstallH }, 400, 1)
    return { best: r.best ? { ...r.best, n: 0, countInstalls: 0 } : null, tried: [], never: bestExitPolicy(inputs, 0, 0).best?.hours ?? null, why: r.why ?? null }
  }
  const known = count.ladder ?? []
  if (!known.length) return { best: null, why: 'the count is short and no distinct augmentation can be bought' }
  // THE CATALOGUE IS SHORTER THAN THE GATE. The ladder holds what the joined
  // factions sell now; the rest of the 30 come from factions joined in later
  // lives, whose prices are not read yet. They are priced at the dearest known
  // ticket (no multiplier) and COUNTED in `padded` — a stated extrapolation,
  // not a measurement, and the verdict says so.
  const dear = known.reduce((a, t) => (t.laterPrice > a.laterPrice ? t : a), known[0])
  const padded = Math.max(0, short - known.length)
  const ladder = [...known, ...Array.from({ length: padded }, (_, i) => ({ name: `unread-${i + 1}`, price: Infinity, laterPrice: dear.laterPrice, hacking: 1 }))]
  const g = pos(inputs.multGainPerCycle) ? inputs.multGainPerCycle : 1
  const ns = compositions ?? [...new Set([1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, short])].filter((x) => x >= 1 && x <= short)
  const tried = []
  let best = null
  for (const n of ns) {
    const ph = countPhase({ short, ladder, n, inputs, firstInstallH, nfg: count.nfg ?? null })
    if (ph.installs === null) {
      tried.push({ n, hours: null, why: ph.why })
      continue
    }
    // Install j of the count phase multiplies by its batch's own gain: the
    // first through installGains.hacking (exitHours' firstGain), later ones as
    // byInstall lifts over the cadence's per-cycle gain they replace.
    const byInstall = ph.perInstall.map((b, j) => (j === 0 ? 1 : b.gain / g))
    const r = bestExitPolicy(
      { ...inputs, firstInstallH, installGains: { hacking: Math.max(1, ph.perInstall[0].gain) }, nextInstallGain: null, perCycleExtra: { byInstall } },
      400,
      ph.installs,
    )
    const h = r.best?.hours ?? null
    tried.push({ n, hours: h, installs: r.best?.installsFirst ?? null, countInstalls: ph.installs, first: { count: ph.perInstall[0].count, nfgLevels: ph.perInstall[0].nfgLevels, cost: Math.round(ph.perInstall[0].cost) }, why: r.why ?? null, degenerate: r.degenerate || undefined })
    if (num(h) && !r.degenerate && (!best || h < best.hours - 1 / 60)) best = { hours: h, installsFirst: r.best.installsFirst, n, countInstalls: ph.installs, firstBatch: ph.perInstall[0] }
  }
  return best ? { best: { ...best, padded }, tried, never: null, padded } : { best: null, tried, never: null, padded, why: `no composition reaches the count: ${tried.map((t) => `n=${t.n}: ${t.why}`).join('; ')}` }
}
