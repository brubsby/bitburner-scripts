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
 * What one augmentation lifts on the exit's channels: the hacking level
 * multiplier, the hacking exp rate, and faction reputation (exitplan
 * installGains {hacking, exp, rep}). Money multipliers are absent: scripted
 * hacking pays nothing where this model runs (BitNode 8).
 */
export function gainsOf(mults) {
  const g = (k) => (pos(mults?.[k]) ? mults[k] : 1)
  return { hacking: g('hacking'), exp: g('hacking_exp'), rep: g('faction_rep') }
}

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
    const row = { name: o.name, price, laterPrice: num(later) ? o.baseCost + later : o.baseCost, ...gainsOf(o.mults) }
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
  // A `must` ticket (the route being priced, bestCountRoute) is taken first
  // whenever it fits; the rest are the cheapest.
  const cheapest = (ladder ?? []).slice().sort((a, b) => (b.must === true) - (a.must === true) || priceOf(a) - priceOf(b))
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
  let expGain = 1
  let repGain = 1
  for (let i = 0; i < chosen.length; i++) {
    spent += priceOf(chosen[i]) * Math.pow(PRICE_MULT, i)
    gain *= pos(chosen[i].hacking) ? chosen[i].hacking : 1
    expGain *= pos(chosen[i].exp) ? chosen[i].exp : 1
    repGain *= pos(chosen[i].rep) ? chosen[i].rep : 1
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
    expGain *= Math.pow(NFG_HACK, levels)
    repGain *= Math.pow(NFG_HACK, levels)
  }
  return { count: take, cost: spent, gain, expGain, repGain, nfgLevels: levels, chosen: chosen.map((t) => t.name) }
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
  const { short, ladder, n, inputs, firstInstallH = 0, nfg = null, maxInstalls = 60, postInstalls = 40 } = o
  if (!(short > 0)) return { installs: 0, perInstall: [], post: [] }
  let left = short
  let remaining = (ladder ?? []).slice()
  let level = nfg?.level ?? 0
  const per = []
  for (let i = 0; i < maxInstalls && left > 0; i++) {
    const budget =
      i === 0
        ? moneyAfter(inputs.money ?? 0, firstInstallH, inputs)
        : moneyAfter(num(inputs.installCash) ? inputs.installCash : 0, Math.max(0, (inputs.cycleHours ?? 0) - (num(inputs.capitalWarmupH) ? inputs.capitalWarmupH : 0)), inputs) // the trader's warm-up after each install earns nothing
    const b = bankBatch({ budget, ladder: remaining, n: Math.min(n, left), nfg: nfg ? { price: nfg.price * Math.pow(NFG_LEVEL_MULT, level - (nfg.level ?? 0)) } : null, later: i > 0 })
    if (b.count === 0) return { installs: null, why: `install ${i + 1} cannot afford one ticket ($${Math.round(budget)} in hand)`, perInstall: per }
    per.push({ ...b, budget })
    left -= b.count
    level += b.nfgLevels
    const got = new Set(b.chosen)
    remaining = remaining.filter((t) => !got.has(t.name))
  }
  if (left > 0) return { installs: null, why: `the count is still ${left} short after ${maxInstalls} installs`, perInstall: per }
  // AFTER THE COUNT: what each later life's compounded budget buys in
  // NeuroFlux alone — a FLOOR on that install's multiplier gain (real
  // augmentations beyond the ladder are not read here). bestCountExit takes
  // the larger of this and the measured cadence: live 2026-09-25 the cadence
  // was measured over four count-ticket lives (x1.0067 per 4.1h), which says
  // nothing about what a compounded book buys once the count is banked.
  const post = []
  for (let j = 0; j < postInstalls; j++) {
    const budget = moneyAfter(num(inputs.installCash) ? inputs.installCash : 0, Math.max(0, (inputs.cycleHours ?? 0) - (num(inputs.capitalWarmupH) ? inputs.capitalWarmupH : 0)), inputs)
    const b = bankBatch({ budget, ladder: [], n: 0, nfg: nfg ? { price: nfg.price * Math.pow(NFG_LEVEL_MULT, level - (nfg.level ?? 0)) } : null, later: true })
    post.push({ gain: b.gain, nfgLevels: b.nfgLevels, budget })
    level += b.nfgLevels
  }
  return { installs: per.length, perInstall: per, post }
}

/**
 * The ladder the count phase draws from: the known tickets plus, where the
 * catalogue is shorter than the gate, `padded` unread ones priced at the
 * dearest known ticket's later price (a stated extrapolation, see
 * bestCountExit).
 */
export function paddedLadder(count) {
  const known = count?.ladder ?? []
  if (!known.length) return { ladder: [], padded: 0 }
  // THE CATALOGUE IS SHORTER THAN THE GATE. The ladder holds what the joined
  // factions sell now; the rest of the 30 come from factions joined in later
  // lives, whose prices are not read yet. They are priced at the dearest known
  // ticket (no multiplier) and COUNTED in `padded` — a stated extrapolation,
  // not a measurement, and the verdict says so.
  const dear = known.reduce((a, t) => (t.laterPrice > a.laterPrice ? t : a), known[0])
  const padded = Math.max(0, count.short - known.length)
  return { ladder: [...known, ...Array.from({ length: padded }, (_, i) => ({ name: `unread-${i + 1}`, price: Infinity, laterPrice: dear.laterPrice, hacking: 1 }))], padded }
}

/** Inputs for a candidate life length L: the per-cycle gain rescaled at the inputs' ln(M) per hour. */
export function lifeInputs(inputs, L) {
  const c0 = pos(inputs.cycleHours) ? inputs.cycleHours : null
  if (L === null || L === undefined || c0 === null || L === c0) return inputs
  const g = pos(inputs.multGainPerCycle) ? inputs.multGainPerCycle : 1
  return { ...inputs, cycleHours: L, multGainPerCycle: Math.pow(g, L / c0) }
}

/**
 * ONE count-phase policy — composition `n` on `inp` (already at its life
 * length) — through the policy search. The body bestCountExit loops over, and
 * the entry point the Monte Carlo (plan.js) calls once per parameter draw.
 * Returns {hours, installsFirst, countInstalls, firstBatch, degenerate, why}
 * or {hours: null, phaseWhy} when the count phase cannot complete.
 */
export function countExitAt(bestExitPolicy, inp, short, ladder, n, firstInstallH, nfg) {
  const ph = countPhase({ short, ladder, n, inputs: inp, firstInstallH, nfg })
  if (ph.installs === null) return { hours: null, phaseWhy: ph.why }
  const gL = pos(inp.multGainPerCycle) ? inp.multGainPerCycle : 1
  // Install j of the count phase multiplies by its batch's own gain: the
  // first through installGains.hacking (exitHours' firstGain), later ones
  // as byInstall lifts over the cadence's per-cycle gain they replace.
  const byInstall = [...ph.perInstall.map((b, j) => (j === 0 ? 1 : b.gain / gL)), ...(ph.post ?? []).map((b) => Math.max(1, b.gain / gL))]
  const r = bestExitPolicy(
    { ...inp, firstInstallH, installGains: { hacking: Math.max(1, ph.perInstall[0].gain), exp: Math.max(1, ph.perInstall[0].expGain ?? 1), rep: Math.max(1, ph.perInstall[0].repGain ?? 1) }, nextInstallGain: null, perCycleExtra: { byInstall } },
    400,
    ph.installs,
  )
  return { hours: r.best?.hours ?? null, installsFirst: r.best?.installsFirst ?? null, countInstalls: ph.installs, firstBatch: ph.perInstall[0], degenerate: r.degenerate === true, why: r.why ?? null }
}

/**
 * A FIXED count policy {n, lifeH} priced on `inputs` (one parameter draw) —
 * no search over n or the life length: the Monte Carlo evaluates the policy
 * the point estimate chose, it does not re-optimise per draw. With the count
 * met, the ordinary policy search from `firstInstallH`. Returns hours or null.
 */
export function countExitFixed(bestExitPolicy, inputs, count, { firstInstallH = 0, n = 1, lifeH = null } = {}) {
  if (!(count?.short > 0)) return bestExitPolicy({ ...inputs, firstInstallH }, 400, 1).best?.hours ?? null
  const { ladder } = paddedLadder(count)
  if (!ladder.length) return null
  const at = countExitAt(bestExitPolicy, lifeInputs(inputs, lifeH), count.short, ladder, Math.min(n, count.short), firstInstallH, count.nfg ?? null)
  return num(at.hours) && !at.degenerate ? at.hours : null
}

/**
 * ONE ROUTE at a fixed life length on `inputs`: bestCountRoute's pricing of
 * that route (forced into the first batch, first install no earlier than its
 * detour), without the search. `detourH` may be a drawn value. Returns hours
 * or null (unaffordable in the first batch, or unpriced).
 */
export function routeExitFixed(bestExitPolicy, inputs, count, route, { firstInstallH = 0, lifeH = null, detourH = null } = {}) {
  if (!(count?.short > 0) || !route) return null
  const d = num(detourH) && detourH >= 0 ? detourH : route.detourH
  const { ladder } = paddedLadder({ ...count, ladder: [{ ...route, must: true }, ...(count.ladder ?? []).filter((t) => t.name !== route.name)] })
  const at = countExitAt(bestExitPolicy, lifeInputs(inputs, lifeH), count.short, ladder, 1, Math.max(firstInstallH, d), count.nfg ?? null)
  if (!num(at.hours) || at.degenerate || !at.firstBatch?.chosen?.includes(route.name)) return null
  return at.hours
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
  const { ladder, padded } = paddedLadder(count)
  const ns = compositions ?? [...new Set([1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, short])].filter((x) => x >= 1 && x <= short)
  const tried = []
  let best = null
  // THE LIFE LENGTH IS SEARCHED TOO. Where money is capital a longer life buys
  // a bigger batch (the book compounds) and a shorter one pays the trader's
  // warm-up more often; the measured cadence is only one candidate. The
  // per-cycle gain after the count phase is rescaled to the candidate length
  // at the measured ln(M) per hour, so no candidate is credited more growth
  // per hour than was measured.
  const c0 = pos(inputs.cycleHours) ? inputs.cycleHours : null
  const lifeHs = c0 === null ? [null] : [...new Set([c0, 1, 2, 4, 6, 8, 12, 18, 24, 36, 48].map((x) => Math.round(x * 100) / 100))].filter((x) => x > 0)
  for (const L of lifeHs) {
    const inp = lifeInputs(inputs, L)
    for (const n of ns) {
      const at = countExitAt(bestExitPolicy, inp, short, ladder, n, firstInstallH, count.nfg ?? null)
      if (at.phaseWhy) {
        tried.push({ n, lifeH: L, hours: null, why: at.phaseWhy })
        continue
      }
      const h = at.hours
      tried.push({ n, lifeH: L, hours: h, installs: at.installsFirst, countInstalls: at.countInstalls, first: { count: at.firstBatch.count, nfgLevels: at.firstBatch.nfgLevels, cost: Math.round(at.firstBatch.cost) }, why: at.why, degenerate: at.degenerate || undefined })
      if (num(h) && !at.degenerate && (!best || h < best.hours - 1 / 60)) best = { hours: h, installsFirst: at.installsFirst, n, lifeH: L, countInstalls: at.countInstalls, firstBatch: at.firstBatch }
    }
  }
  return best ? { best: { ...best, padded }, tried, never: null, padded } : { best: null, tried, never: null, padded, why: `no composition reaches the count: ${tried.map((t) => `n=${t.n}: ${t.why}`).join('; ')}` }
}

/**
 * WHICH DISTINCT AUGMENTATION FINISHES THE COUNT — chosen by the node's exit,
 * not by price. Each route is one candidate augmentation with what it costs to
 * reach: `price` (base, plus a donation for the reputation where that is the
 * route), `laterPrice`, its gains (gainsOf), and `detourH` — hours before it
 * can be bought (a join's gym/crime legs, a reputation grind). Each is priced
 * by bestCountExit with that augmentation forced into the first batch
 * (`must`) and the first install no earlier than the detour; the rest of the
 * count comes from the ordinary ladder. The soonest exit wins. A pricier
 * augmentation that lifts hacking (or exp, or reputation) can exit sooner
 * than the cheapest ticket plus its detour; the cheapest ticket is only a
 * candidate. Returns {best: {name, hours, route, result}, tried: [...]} or
 * {best: null, why}.
 */
export function bestCountRoute(bestExitPolicy, inputs, count, routes, { firstInstallH = 0 } = {}) {
  if (!count || !(count.short > 0)) return { best: null, tried: [], why: 'the count is met' }
  if (!Array.isArray(routes) || !routes.length) return { best: null, tried: [], why: 'no route to a distinct augmentation' }
  const tried = []
  let best = null
  for (const route of routes) {
    if (!pos(route?.price) || !num(route?.detourH) || route.detourH < 0) {
      tried.push({ name: route?.name ?? null, via: route?.via ?? null, hours: null, why: 'unpriced route (price or detour unreadable)' })
      continue
    }
    const ladder = [{ ...route, must: true }, ...(count.ladder ?? []).filter((t) => t.name !== route.name)]
    const r = bestCountExit(bestExitPolicy, inputs, { ...count, ladder }, { firstInstallH: Math.max(firstInstallH, route.detourH), compositions: [1] })
    const took = r.best?.firstBatch?.chosen?.includes(route.name) === true
    const hours = r.best && took ? r.best.hours : null
    tried.push({ name: route.name, faction: route.faction ?? null, via: route.via ?? null, lifeH: r.best?.lifeH ?? null, price: Math.round(route.price), detourH: +route.detourH.toFixed(3), hacking: route.hacking, exp: route.exp, rep: route.rep, hours: hours === null ? null : +hours.toFixed(3), why: hours !== null ? null : r.best ? 'not affordable in the first batch' : r.why ?? 'unpriced' })
    if (hours !== null && (!best || hours < best.hours)) best = { name: route.name, hours, route, result: r.best }
  }
  tried.sort((a, b) => (a.hours ?? Infinity) - (b.hours ?? Infinity))
  return best ? { best, tried } : { best: null, tried, why: 'no route prices' }
}

/**
 * THE CANDIDATE ROUTES to the next distinct augmentation, for bestCountRoute.
 * Every unowned distinct augmentation whose prerequisites are owned, sold by a
 * joined faction (`offers`) or a joinable one (`candidates`, with `joinH`, the
 * join forecast's hours — gym, crime, money legs). Each rep-short augmentation
 * yields up to two routes: 'work' (detour = join + the grind at `repPerSec`,
 * the base rate before favour) and 'donation' (detour = join; the reputation
 * bought, `donation(faction, rep)` dollars or null where the faction takes
 * none). Returns [{name, faction, via, price, laterPrice, detourH, hacking,
 * exp, rep}].
 */
export function countRoutes({ offers = [], candidates = [], owned = new Set(), repPerSec = null, donation = null, nfgName = 'NeuroFlux Governor' } = {}) {
  const have = owned instanceof Set ? owned : new Set(owned ?? [])
  const out = []
  const add = (faction, a, rep, favor, joinH) => {
    if (!a || a.name === nfgName || have.has(a.name) || !pos(a.baseCost)) return
    if ((a.prereqs ?? []).some((p) => !have.has(p))) return
    const short = Math.max(0, (a.repReq ?? 0) - (rep ?? 0))
    const g = gainsOf(a.mults)
    const base = { name: a.name, faction, laterPrice: a.baseCost, ...g }
    if (short === 0) {
      out.push({ ...base, via: joinH > 0 ? 'join' : 'ready', price: a.baseCost, detourH: joinH, joinH, grindH: 0 })
      return
    }
    const rate = pos(repPerSec) ? repPerSec * (1 + (num(favor) && favor > 0 ? favor : 0) / 100) : null
    if (rate) out.push({ ...base, via: 'work', price: a.baseCost, detourH: joinH + short / rate / 3600, joinH, grindH: short / rate / 3600 })
    const d = typeof donation === 'function' ? donation(faction, short) : null
    if (pos(d)) out.push({ ...base, via: 'donation', price: a.baseCost + d, detourH: joinH, joinH, grindH: 0 })
  }
  for (const o of offers ?? []) add(o.faction, o, o.factionRep, o.favor, 0)
  for (const c of candidates ?? []) {
    if (!num(c?.joinH) || !isFinite(c.joinH) || c.joinH < 0) continue
    for (const a of c.augs ?? []) add(c.name, a, c.rep ?? 0, c.favor ?? 0, c.joinH)
  }
  return out
}

/**
 * ROUTE COMMITMENT, with hysteresis. The ranking is re-run every pass on
 * inputs that move by more than the gaps between routes (live 2026-09-26: the
 * exit forecast's measured error ~8.9h per hour; at 12:12 the route was The
 * Shadow's Simulacrum at The Syndicate, the body step trained strength 1 ->
 * 202 for it, and at 12:17 the ranking flipped to SmartJaw at Bachman and
 * the hour of preparation was dropped). A committed route (this life) keeps
 * its place unless an alternative beats ITS CURRENT exit — priced from the
 * current state, so progress already made toward it is credited as a shorter
 * detour — by more than the forecast can see over the committed route's
 * remaining detour: tolPerH x max(0.25h, detour). It is dropped at once if it
 * no longer prices at all (the tried entry says why).
 * `ranked`: bestCountRoute's result; `routes`: the countRoutes list;
 * `committed`: {name, faction, via} or null. Returns {best: {name, hours,
 * route} | null, stayed, switched, why}.
 */
export function commitRoute(ranked, routes, committed, { tolPerH = 0.5 } = {}) {
  const key = (r) => `${r?.name}|${r?.faction}|${r?.via}`
  const best = ranked?.best ?? null
  if (!best) return { best: null, stayed: false, switched: false, why: ranked?.why ?? 'no route prices' }
  const fresh = { name: best.name, hours: best.hours, route: best.route }
  if (!committed?.name) return { best: fresh, stayed: false, switched: true, why: 'no route committed this life: taking the best' }
  if (key(committed) === key(best.route)) return { best: fresh, stayed: true, switched: false, why: 'the committed route is still the best' }
  const cur = (ranked.tried ?? []).find((t) => key(t) === key(committed))
  if (!cur || !num(cur.hours)) return { best: fresh, stayed: false, switched: true, why: `the committed route (${committed.name} at ${committed.faction} via ${committed.via}) no longer prices: ${cur?.why ?? 'not a candidate any more'}` }
  const route = (routes ?? []).find((r) => key(r) === key(committed))
  if (!route) return { best: fresh, stayed: false, switched: true, why: `the committed route's candidate is gone (${committed.name})` }
  const tol = (pos(tolPerH) ? tolPerH : 0) * Math.max(0.25, num(cur.detourH) ? cur.detourH : 0)
  const gain = cur.hours - best.hours
  if (gain > tol) return { best: fresh, stayed: false, switched: true, why: `${best.name} at ${best.route.faction} exits ${gain.toFixed(2)}h sooner than the committed ${committed.name} (${cur.hours.toFixed(2)}h, ${cur.detourH}h of detour left), beyond the ${tol.toFixed(2)}h the forecast can see` }
  return { best: { name: cur.name, hours: cur.hours, route }, stayed: true, switched: false, why: `kept ${committed.name} at ${committed.faction} (${cur.hours.toFixed(2)}h, ${cur.detourH}h of detour left): ${best.name} is ${gain.toFixed(2)}h sooner, inside the ${tol.toFixed(2)}h forecast tolerance` }
}
