/**
 * lifeplan.js — WHAT A LIFE OF EACH LENGTH BUYS, so the plan can choose the
 * life's length (pure: no ns).
 *
 * The exit's cycle model (exitplan.exitHours) multiplies the hacking
 * multiplier by `multGainPerCycle` every `cycleHours`. Both used to be the
 * MEASURED mean life: a constant ln(M) per hour whatever the life's length,
 * and an install that costs nothing. Under that model a shorter life is never
 * worse (live BN1 2026-09-28 03:54: 0.25h lives exit 38.1h, 16h lives 54.9h),
 * which is how one-ticket lives of ~25 minutes looked free. They are not: an
 * install resets every faction's REPUTATION to zero (Faction.ts
 * prestigeAugmentation), and the augmentations worth having need hundreds of
 * thousands of it (Synfibril Muscle 437.5k, Embedded Netburner Module Core V3
 * 1.75m at ~11 rep/s base = 11-44h of work); it banks the life's reputation
 * as FAVOUR, which multiplies every later life's rate by (1 + favor/100)
 * (formulas/reputation.ts) — so a longer life earns more favour; and money
 * resets with the 1.9x-per-purchase escalation (Constants.ts:41
 * MultipleAugMultiplier) restarting from 1.
 *
 * lifeBatch: one life of L hours from a catalogue state. Reputation is earned
 * at base x (1 + favor_f/100) per hour at ONE faction at a time: the hours a
 * set of augmentations needs are, per faction, its largest requirement over
 * that rate. Money: freshMoney(L), the purchases most expensive first at
 * 1.9^j. Greedy by ln(hacking) per unit of the two budgets used; then
 * NeuroFlux levels (price and requirement x1.14 per level, persistent; the
 * requirement against the faction the life worked most) with what is left;
 * the unused hours at the fastest faction (favour for later lives). Returns
 * the batch, its hacking gain, the reputation earned per faction.
 *
 * lifeSequence: lives of length L one after another — the catalogue
 * depleting, favour accruing (favor.addRepToFavor at each install), NeuroFlux
 * levels advancing. cadenceByPurchases: for each candidate L, the mean ln(M)
 * a life of that length buys over the lives in a horizon, handed to the exit
 * (bestExitPolicy with cycleHours L, multGainPerCycle exp(mean)); the soonest
 * exit is the cadence.
 *
 * NOT MODELLED, and named in the result: donations (favour >= 150 buys
 * reputation with money — no faction here is there yet), the player's
 * faction_rep multiplier rising across lives (the rate is today's — a
 * floor), sleeves working factions, joining new factions, the count gate's
 * value of a distinct augmentation (only hacking is valued), augmentations
 * other than hacking-multiplier ones beyond their count.
 * CALIBRATION: the money curve is the exit model's fresh-life income scaled
 * to the earnings ledger's completed lives (moneyScaleOf, printed); the
 * reputation rate is the published one (the formula estimate early in a life).
 */
import { favorToRep, repToFavor } from 'favor.js'
import { levelAt, expRateShape } from 'exitplan.js'
import { planHacknetBatch, hashRate, DOLLARS_PER_HASH } from 'hacknetplan.js'
import { formulaErrorPosterior } from 'bayes.js'
import { capitalOf, capitalGain } from 'traderw.js'
import { drain } from 'coop.js'

/** Hacknet purchase decisions per simulated fresh life (freshLifeMoney). */
export const HACKNET_DECISIONS = 12

const num = (x) => typeof x === 'number' && isFinite(x)
const pos = (x) => num(x) && x > 0

export const PRICE_ESCALATION = 1.9 // Constants.ts:41 MultipleAugMultiplier (SF11 lowers it; not owned)
export const NFG_LEVEL_MULT = 1.14 // Constants.ts:36 NeuroFluxGovernorLevelMult (price AND requirement)
export const NFG = 'NeuroFlux Governor'

/**
 * The catalogue from the snapshots: every augmentation a JOINED faction
 * sells, not owned, with its price, requirement, hacking multiplier and
 * prerequisites. NeuroFlux separately ({price, repReq} at today's level).
 */
export function catalogueOf({ catalog, price, repReq, stats, prereq, owned, joined }) {
  const have = new Set(owned ?? [])
  const byName = new Map()
  for (const f of joined ?? []) {
    for (const name of catalog?.[f] ?? []) {
      if (name === NFG || have.has(name) || !pos(price?.[name]) || !num(repReq?.[name])) continue
      const cur = byName.get(name) ?? { name, price: price[name], repReq: repReq[name], hackMult: pos(stats?.[name]?.hacking) ? stats[name].hacking : 1, prereq: prereq?.[name] ?? [], factions: [] }
      cur.factions.push(f)
      byName.set(name, cur)
    }
  }
  const nfg = pos(price?.[NFG]) && pos(repReq?.[NFG]) ? { price: price[NFG], repReq: repReq[NFG], hackMult: pos(stats?.[NFG]?.hacking) ? stats[NFG].hacking : 1.01, factions: (joined ?? []).filter((f) => (catalog?.[f] ?? []).includes(NFG)) } : null
  return { items: [...byName.values()], nfg }
}

/**
 * THE FACTIONS LATER LIVES BUY FROM: every faction this node's lives have
 * joined (`kept`, the persisted record, same node only) together with the
 * ones joined now. An install resets membership, so right after one the
 * joined set is empty and a catalogue of the JOINED factions is empty too —
 * the purchase model then did not price at all and the cadence fell back to
 * one thin measured life (live BN9 2026-09-29 05:46: x1.025 per 6.63h, the
 * fresh life's exit 272h against the 104h the install was priced on). Later
 * lives re-join the same factions, so their catalogue is the node's.
 * Returns {node, factions, added, why}; `added` is true when the union grew
 * (the caller persists it then).
 */
export function nodeFactionsOf(kept, node, joined) {
  const same = kept && kept.node === node && Array.isArray(kept.factions)
  const before = same ? kept.factions.filter((f) => typeof f === 'string') : []
  const set = new Set(before)
  for (const f of joined ?? []) if (typeof f === 'string') set.add(f)
  const factions = [...set]
  return { node, factions, added: factions.length > before.length || !same, why: same ? `${factions.length} faction(s) joined in this node (${factions.length - (joined ?? []).length} not joined this life)` : `no record for BitNode ${node}: this life's ${factions.length} faction(s)` }
}

/**
 * The same catalogue from progress.js's offers ({name, faction, baseCost,
 * repReq, mults, prereqs, favor}), one row per augmentation with every
 * faction that sells it; favour per faction from the offers.
 */
/**
 * THE PURCHASE MODEL'S LIVES START AFTER THE NEXT INSTALL, so what that
 * install's batch buys is owned in every one of them: its augmentations leave
 * the catalogue and its NeuroFlux levels raise the price the lives start from.
 * Without this the batch was priced twice — once as the first install's gains
 * (exitplan installGains) and again as what every later life buys. Live BN9
 * 2026-09-30: the 6h life bought x1.149 with the 12-augmentation batch still in
 * the catalogue and x1.066 at the same money once 8 of them were owned; the
 * install priced at 19.66h, ~24.7h on the cadence without them.
 * `batch`: names, NeuroFlux once per level. Returns {owned: Set, nfgLevel0}.
 */
export function ownedAfterBatch(owned, batch) {
  const out = new Set(owned ?? [])
  let nfgLevel0 = 0
  for (const b of batch ?? []) {
    if (b === NFG) nfgLevel0++
    else if (typeof b === 'string') out.add(b)
  }
  return { owned: out, nfgLevel0 }
}

export function catalogueFromOffers(offers, owned) {
  const have = owned instanceof Set ? owned : new Set(owned ?? [])
  const byName = new Map()
  const favor = {}
  let nfg = null
  for (const o of offers ?? []) {
    if (!o?.name || !o.faction) continue
    if (num(o.favor)) favor[o.faction] = o.favor
    if (o.name === NFG) {
      if (pos(o.baseCost) && pos(o.repReq)) {
        if (!nfg) nfg = { price: o.baseCost, repReq: o.repReq, hackMult: pos(o.mults?.hacking) ? o.mults.hacking : 1.01, factions: [] }
        nfg.factions.push(o.faction)
      }
      continue
    }
    if (have.has(o.name) || !pos(o.baseCost) || !num(o.repReq)) continue
    const cur = byName.get(o.name) ?? { name: o.name, price: o.baseCost, repReq: o.repReq, hackMult: pos(o.mults?.hacking) ? o.mults.hacking : 1, prereq: o.prereqs ?? [], factions: [] }
    cur.factions.push(o.faction)
    byName.set(o.name, cur)
  }
  return { items: [...byName.values()], nfg, favor }
}

/** Money for a batch: prices most expensive first at 1.9^j. */
export function batchCost(prices) {
  const p = [...prices].sort((a, b) => b - a)
  let c = 0
  for (let j = 0; j < p.length; j++) c += p[j] * Math.pow(PRICE_ESCALATION, j)
  return c
}

/**
 * Money in hand after L hours of a FRESH life (the balance an install leaves,
 * level 1 again): the exit model's income (income at level 1 x (level + 50) /
 * 51 as exp accrues, the flat rate, the trader's return compounding after its
 * warm-up — exitplan.hoursToMoney's terms) integrated forward, times `scale`
 * (moneyScaleOf). Null when income is unreadable.
 */
export function freshLifeMoney(inputs, L, scale = 1, rec = null, opts = {}) {
  return drain(freshLifeMoneyGen(inputs, L, scale, rec, opts))
}
/** freshLifeMoney as a generator: yields after each hacknet batch decision (the planner's search is the costly part). */
export function* freshLifeMoneyGen(inputs, L, scale = 1, rec = null, { steps = 200, decisions = HACKNET_DECISIONS } = {}) {
  const cash0 = num(inputs?.installCash) && inputs.installCash >= 0 ? inputs.installCash : 1262
  if (!pos(L)) return cash0
  const flat = num(inputs.flatIncomePerSec) && inputs.flatIncomePerSec > 0 ? inputs.flatIncomePerSec : 0
  if (!num(inputs.incomePerSec) || !pos(inputs.hacking) || !pos(inputs.hackingMult)) return null
  const lvlIncome = (Math.max(0, inputs.incomePerSec - flat) * 51) / (inputs.hacking + 50)
  const r = pos(inputs.capitalReturnPerSec) ? inputs.capitalReturnPerSec : 0
  const cap = pos(inputs.capitalCap) ? inputs.capitalCap : Infinity
  const warmH = pos(inputs.capitalWarmupH) ? inputs.capitalWarmupH : 0
  const capC = capitalOf(inputs)
  const xps = pos(inputs.expPerSec) ? inputs.expPerSec : 0
  // The exp rate rising with the level (exitplan.expRateShape), as the exit
  // integrates it, when the inputs say so; else constant.
  const xpsAt = expRateShape(xps, { scales: inputs.expScalesWithLevel === true, ref: inputs.hacking, flat: inputs.expFlatPerSec ?? 0 })
  let money = cash0
  let exp = 0
  const dt = (L * 3600) / steps
  // THE HACKING STREAM FROM THE GAME'S FORMULAS (inputs.freshHackCum
  // [[ageH, $ since the install]], freshlife.js x its error posterior —
  // progress.js exitInputsOf), when supplied: the prep, the re-rooting and the
  // level ramp as the formulas run them. Past its last point it continues at
  // its last slope. Absent: the level-scaled rate below, as before.
  const fh = Array.isArray(inputs.freshHackCum) && inputs.freshHackCum.length >= 2 ? inputs.freshHackCum : null
  const fhAt = (h) => {
    if (h <= fh[0][0]) return fh[0][1]
    for (let i = 1; i < fh.length; i++) if (h <= fh[i][0]) return fh[i - 1][1] + ((fh[i][1] - fh[i - 1][1]) * (h - fh[i - 1][0])) / (fh[i][0] - fh[i - 1][0] || 1)
    const n = fh.length
    return fh[n - 1][1] + ((fh[n - 1][1] - fh[n - 2][1]) / (fh[n - 1][0] - fh[n - 2][0] || 1)) * (h - fh[n - 1][0])
  }
  // THE HACKNET REBUILD (inputs.hacknet {mults, nodeMoney}, hacknet SERVERS
  // only): an install deletes the fleet (PlayerObjectGeneralMethods.ts:130)
  // and, outside node entry, nothing grants one back (Prestige.ts:329 runs in
  // prestigeSourceFile only), so every later life starts at zero servers and
  // re-buys from this life's own money. Every HACKNET_DECISIONS-th step the
  // batch planner buys what adds money by the end of THIS life (its W is the
  // time left, the trader's return on the same balance), paid from the
  // balance; the fleet's hashes are sold. Absent (every node without hacknet
  // servers): exactly the old integration.
  const hn = inputs.hacknet && inputs.hacknet.mults && num(inputs.hacknet.nodeMoney) ? inputs.hacknet : null
  let fleet = []
  let hashPerSec = 0
  const every = Math.max(1, Math.floor(steps / decisions))
  for (let i = 0; i < steps; i++) {
    const h = (i * dt) / 3600
    if (hn && i % every === 0 && L - h > 0 && money > 0) {
      const b = planHacknetBatch({ servers: fleet, mults: hn.mults, nodeMoney: hn.nodeMoney, W: L - h, capital: r > 0 ? { capitalReturnPerSec: r, capitalCap: cap, capitalScaleW: inputs.capitalScaleW ?? null, capitalShape: inputs.capitalShape ?? null, capitalWarmupH: Math.max(0, warmH - h), money } : null, budget: money, maxItems: 60 })
      if (b.items.length) {
        if (rec) rec.push({ h, buy: b.cost })
        money -= b.cost
        fleet = b.servers
        hashPerSec = fleet.reduce((a, x) => a + (hashRate(x.level, 0, x.ram, x.cores, hn.mults.hacknet_node_money, hn.nodeMoney) ?? 0), 0)
      }
      yield
    }
    const lvl = levelAt(exp, inputs.hackingMult)
    // The book's return at its own size (traderw.capitalGain: the curve r(W), or the flat r x min(W, cap)).
    const cg = r > 0 && h >= warmH ? capitalGain(money, dt, capC) : 0
    const hackStep = fh ? Math.max(0, fhAt(h + dt / 3600) - fhAt(h)) : ((lvlIncome * (lvl + 50)) / 51) * dt
    money += hackStep + (flat + hashPerSec * DOLLARS_PER_HASH) * dt + Math.max(0, cg)
    if (rec && hashPerSec > 0) rec.push({ h, dt, earn: hashPerSec * DOLLARS_PER_HASH * dt })
    exp += xpsAt(lvl) * dt
  }
  return cash0 + (money - cash0) * (pos(scale) ? scale : 1)
}

/**
 * THE HACKNET OF A FRESH LIFE AS AN INCOME STREAM, [{atH: hours since the
 * install, perSec}] — the fleet freshLifeMoney rebuilds (inputs.hacknet, the
 * servers hacknet.js runs), for the exit's final window (exitplan
 * freshHacknet). Its purchases are charged to its own income: what the fleet
 * earns repays what was spent on it before any of it reaches the balance
 * (a zero-interest loan from the balance, repaid within hours), so the stream
 * is never negative and every server bought is paid for — the one thing not
 * charged is the trader's compounding on the dollars lent. Null with no
 * hacknet model. `L` the life simulated (its purchases stop paying back near
 * its end); past it the last rate holds.
 */
export function freshHacknetFlow(inputs, L = 48, o = {}) {
  return freshHacknetStreams(inputs, L, o)?.flow ?? null
}
/** freshHacknetFlow as a generator (one yield per purchase decision): 46-57ms in one piece blocked the page in 'plan-inputs' step 1. */
export function* freshHacknetFlowGen(inputs, L = 48, o = {}) {
  return (yield* freshHacknetStreamsGen(inputs, L, o))?.flow ?? null
}

/**
 * The same simulated rebuild, both ways it can be spent: `flow` (the money
 * stream freshHacknetFlow returns, net of the fleet's own purchases) and
 * `hashCum` [[atH, cumulative hashes since the install]] — the fleet's GROSS
 * hash production, which is what a hash spent on an upgrade instead of sold
 * comes out of (exitplan contractRep: the final window's generated contracts).
 * Null with no hacknet model.
 */
export function freshHacknetStreams(inputs, L = 48, o = {}) {
  return drain(freshHacknetStreamsGen(inputs, L, o))
}
/** freshHacknetStreams as a generator (freshLifeMoneyGen: a yield per purchase decision). */
export function* freshHacknetStreamsGen(inputs, L = 48, { stepH = 0.125, decideH = 0.25 } = {}) {
  if (!(inputs?.hacknet && inputs.hacknet.mults && num(inputs.hacknet.nodeMoney))) return null
  const rec = []
  // Decided every decideH (hacknet.js re-plans every few minutes; the
  // purchase model's 12 decisions a life are 4h apart over 48h).
  const m = yield* freshLifeMoneyGen(inputs, L, 1, rec, { steps: Math.ceil(L / stepH), decisions: Math.ceil(L / decideH) })
  if (m === null) return null
  const out = []
  const cum = [[0, 0]]
  let hashes = 0
  let owed = 0
  for (const r of rec) {
    if (num(r.buy)) owed += r.buy
    else if (num(r.earn) && r.dt > 0) {
      const pay = Math.min(owed, r.earn)
      owed -= pay
      out.push({ atH: +r.h.toFixed(4), perSec: (r.earn - pay) / r.dt })
      hashes += r.earn / DOLLARS_PER_HASH
      cum.push([+(r.h + r.dt / 3600).toFixed(4), Math.round(hashes)])
    }
  }
  // Consecutive equal rates are one step; the cumulative curve keeps one point per hour.
  const flow = out.filter((x, i) => i === 0 || x.perSec !== out[i - 1].perSec)
  const hashCum = cum.filter((p, i) => i === 0 || i === cum.length - 1 || Math.floor(p[0]) !== Math.floor(cum[i - 1][0]))
  return { flow, hashCum }
}

/**
 * THE MONEY MODEL'S CALIBRATION, a posterior: the node's completed lives in
 * tel.js's earnings ledger (/tel/earnings.txt), each y = ln(earned at its end
 * / modelled at that age), update a scale that starts at 1 (the model as it
 * stands) — bayes.formulaErrorPosterior (kind 'count', Student-t), each life
 * weighing by its hours. It was the median of the last four lives' ratios:
 * one life stood in for the model outright (live BN9: x1.056 from one). The
 * `recent` window is kept (lives from an older catalogue say less). {scale,
 * sd, lives, weight, ratios, why}.
 */
export function moneyScaleOf(earnings, node, inputs, opts = {}) {
  return drain(moneyScaleOfGen(earnings, node, inputs, opts))
}
/** moneyScaleOf as a generator: each life's modelled money in slices (with a hacknet model, ~20ms in one piece). */
export function* moneyScaleOfGen(earnings, node, inputs, { recent = 4 } = {}) {
  const lives = Object.entries(earnings?.lives ?? {})
    .filter(([, L]) => L?.node === node && L.complete === true && Array.isArray(L.samples) && L.samples.length >= 2)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(-recent)
  const ratios = []
  const res = []
  for (const [k, L] of lives) {
    const [h, earned] = L.samples[L.samples.length - 1]
    const m = yield* freshLifeMoneyGen(inputs, h, 1)
    yield
    const cash0 = num(inputs?.installCash) ? inputs.installCash : 1262
    if (pos(h) && pos(earned) && pos(m - cash0)) {
      ratios.push(earned / (m - cash0))
      res.push({ ln: Math.log(earned / (m - cash0)), hours: h, node, life: k })
    }
  }
  const post = formulaErrorPosterior(res, 'count', { node })
  const scale = Math.exp(post.mean)
  if (!ratios.length) return { scale: 1, sd: post.sd, lives: 0, weight: 0, ratios, why: `no completed life in the earnings ledger yet: the money model as it stands (x/÷ ${Math.exp(1.2816 * post.sd).toFixed(1)} at 80%, stated)` }
  return { scale, sd: post.sd, lives: ratios.length, weight: post.weight, ratios: ratios.map((x) => +x.toFixed(3)), why: `money model x${scale.toFixed(3)}: ${ratios.length} completed li${ratios.length === 1 ? 'fe' : 'ves'} (earned/modelled ${ratios.map((x) => x.toFixed(2)).join(', ')}) carry ${Math.round(100 * post.weight)}% of the scale` }
}

/**
 * ONE LIFE of L hours: what it buys. `state` {owned: Set, favor: {f: n},
 * nfgLevel: 0-based levels bought since the catalogue's NeuroFlux price}.
 * `repPerHour0` the base rate (favour 0). Returns {chosen, gain, lnGain,
 * nfgLevels, hours: {f: h}, rep: {f: r}, cost, money}.
 */
export function lifeBatch({ items, nfg, state, L, money, repPerHour0 }) {
  const rate = (f) => repPerHour0 * (1 + (state.favor?.[f] ?? 0) / 100)
  const owned = state.owned
  const chosen = []
  const hours = {}
  const usedH = () => Object.values(hours).reduce((a, b) => a + b, 0)
  const prices = []
  const hoursFor = (it) => {
    // The cheapest faction (in hours) that sells it, given what this life already works there.
    let best = null
    for (const f of it.factions) {
      const need = it.repReq / rate(f)
      const extra = Math.max(0, need - (hours[f] ?? 0))
      if (!best || extra < best.extra) best = { f, extra, need }
    }
    return best
  }
  const prereqOk = (it) => (it.prereq ?? []).every((p) => owned.has(p) || chosen.some((c) => c.name === p))
  for (let guard = 0; guard < 200; guard++) {
    let pick = null
    const baseCost = batchCost(prices)
    for (const it of items) {
      if (owned.has(it.name) || chosen.some((c) => c.name === it.name) || !(it.hackMult > 1) || !prereqOk(it)) continue
      const h = hoursFor(it)
      if (!h || usedH() + h.extra > L + 1e-9) continue
      const cost = batchCost([...prices, it.price])
      if (cost > money) continue
      const use = h.extra / L + (cost - baseCost) / money
      const score = Math.log(it.hackMult) / Math.max(1e-9, use)
      if (!pick || score > pick.score) pick = { it, h, cost, score }
    }
    if (!pick) break
    chosen.push(pick.it)
    prices.push(pick.it.price)
    hours[pick.h.f] = Math.max(hours[pick.h.f] ?? 0, pick.h.need)
  }
  // The unused hours at the fastest NeuroFlux faction (favour for later
  // lives, and NeuroFlux's own requirement).
  const nfgFactions = nfg?.factions?.length ? nfg.factions : Object.keys(state.favor ?? {})
  let fastest = null
  for (const f of nfgFactions) if (!fastest || rate(f) > rate(fastest)) fastest = f
  const spare = Math.max(0, L - usedH())
  if (fastest && spare > 0) hours[fastest] = (hours[fastest] ?? 0) + spare
  const rep = Object.fromEntries(Object.entries(hours).map(([f, h]) => [f, h * rate(f)]))
  const repBest = Math.max(0, ...nfgFactions.map((f) => rep[f] ?? 0))
  let levels = 0
  if (nfg && pos(nfg.price)) {
    for (;;) {
      const k = state.nfgLevel + levels
      const p = nfg.price * Math.pow(NFG_LEVEL_MULT, k)
      const rq = nfg.repReq * Math.pow(NFG_LEVEL_MULT, k)
      if (rq > repBest || batchCost([...prices, p]) > money || levels > 200) break
      prices.push(p)
      levels++
    }
  }
  const gain = chosen.reduce((g, it) => g * it.hackMult, 1) * Math.pow(nfg?.hackMult ?? 1.01, levels)
  return { chosen: chosen.map((c) => c.name), gain, lnGain: Math.log(gain), nfgLevels: levels, hours, rep, cost: batchCost(prices), money }
}

/**
 * Lives of length L in a row: the catalogue depleting, favour accruing.
 * `nfgLevel0`: NeuroFlux levels bought before the first of these lives and
 * not in the catalogue's price (the next install's batch: the lives start
 * after it).
 */
export function lifeSequence({ items, nfg, favor, owned, L, lives, moneyAt, repPerHour0, nfgLevel0 = 0 }) {
  const state = { owned: new Set(owned ?? []), favor: { ...(favor ?? {}) }, nfgLevel: Number.isInteger(nfgLevel0) && nfgLevel0 > 0 ? nfgLevel0 : 0 }
  const out = []
  const money = moneyAt(L)
  for (let i = 0; i < lives; i++) {
    const b = lifeBatch({ items, nfg, state, L, money, repPerHour0 })
    out.push({ lnGain: b.lnGain, chosen: b.chosen, nfgLevels: b.nfgLevels })
    for (const n of b.chosen) state.owned.add(n)
    state.nfgLevel += b.nfgLevels
    for (const [f, r] of Object.entries(b.rep)) state.favor[f] = repToFavor(favorToRep(state.favor[f] ?? 0) + r)
  }
  return out
}

/**
 * THE CADENCE THE EXIT CHOOSES. For each life length L in `grid`: the lives
 * of length L in the horizon (at most `maxLives`), their mean ln(M) per life
 * (lifeSequence), priced as the exit's cycle (bestExitPolicy, cycleHours L,
 * multGainPerCycle exp(mean)). Returns {cycleHours, multGainPerCycle, exitH,
 * table, why} or null (no life length prices).
 */
export function cadenceByPurchases(o = {}) {
  return drain(cadenceByPurchasesGen(o))
}
/**
 * cadenceByPurchases as a GENERATOR (the same search, the same result):
 * yields after each life length's money and purchase sequence, and inside
 * each exit simulation when `bestExitPolicyGen` is given (exitplan's: one
 * yield per policy) — so progress.js builds the exit inputs in coop.js
 * slices. Priced in one step it was the first exit inputs of every pass:
 * live BN9 2026-09-29 21:12Z, 201.8ms in 'plan-grafts' step 1 (the ten
 * lengths' exits on inputs carrying 21 grafts; ~50ms warm, ~220ms cold on
 * the dev machine), PLAN BLOCKED THE PAGE.
 */
export const LIFE_GRID = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24]
export function* cadenceByPurchasesGen({ inputs, catalogue, favor, owned, repPerHour0, moneyScale = 1, bestExitPolicy, bestExitPolicyGen = null, grid = LIFE_GRID, horizonH = 48, maxLives = 100, nfgLevel0 = 0 }) {
  if (!catalogue || !pos(repPerHour0) || (typeof bestExitPolicy !== 'function' && typeof bestExitPolicyGen !== 'function')) return null
  // eslint-disable-next-line require-yield
  const policyGen = typeof bestExitPolicyGen === 'function' ? bestExitPolicyGen : function* (x) {
    return bestExitPolicy(x)
  }
  const rows = yield* lifeTableGen({ inputs, catalogue, favor, owned, repPerHour0, moneyScale, grid, horizonH, maxLives, nfgLevel0 })
  if (!rows) return null
  const table = []
  let best = null
  for (const row of rows) {
    const { L, lnMean: mean } = row
    const g = Math.exp(mean)
    // ON THE EXIT'S OWN INPUTS: only the later lives' length and gain vary.
    // The next install's batch (installGains / nextInstallGain) is THIS
    // life's, whatever length later lives run; nulling it (as this did) gave
    // the first install the L-length life's gain too, which favours long
    // lives — live BN9 2026-09-29 it chose 16h (table 99.0h) where the full
    // exit on the same inputs is 98.6h at 6h against 107.6h at 16h.
    const r = g > 1 ? yield* policyGen({ ...inputs, cycleHours: L, multGainPerCycle: g }) : null
    const H = r && !r.degenerate ? r.best?.hours ?? null : null
    const { lnMean, ...shown } = row
    void lnMean
    table.push({ ...shown, H: num(H) ? +H.toFixed(2) : null })
    if (num(H) && (!best || H < best.H)) best = { L, g, H, mean }
  }
  if (!best) return null
  return {
    cycleHours: best.L,
    multGainPerCycle: best.g,
    exitH: best.H,
    table,
    why: `life length chosen by the exit over what each length buys: ${best.L}h lives (x${best.g.toFixed(3)} a life, ${(best.mean / best.L).toFixed(4)} ln(M)/h) exit ${best.H.toFixed(1)}h — reputation reset at every install (base ${(repPerHour0 / 3600).toFixed(2)}/s x (1 + favor/100)), favour banked, 1.9x money escalation (money x${moneyScale.toFixed(2)} calibrated); not modelled: donations, rising faction_rep, sleeves, new joins, the count's value`,
  }
}

/**
 * WHAT A LIFE OF EACH LENGTH BUYS, without choosing one: per L in `grid`, the
 * lives of length L in the horizon, their money and the mean ln(M) their
 * purchase sequence buys (lifeSequence). No exit is priced here — the length
 * is the PLAN's decision (plan.decideLifeLengthGen: each length priced as the
 * committed trajectory, grafts and streams carried, on the shared draws). The
 * chooser this came out of (cadenceByPurchases) priced each length on the
 * default policy with its own first install at L and took the argmin every
 * pass: live BN9 2026-09-30 it flipped 0.5h / 3h / 6h / 8h between passes
 * that re-decided nothing (07:04Z, 08:35Z, 09:20Z EXIT UNSTABLE).
 * Returns [{L, lives, money, gain, lnMean, perHour, first, firstNfg}] or null.
 */
export function lifeTable(o = {}) {
  return drain(lifeTableGen(o))
}
export function* lifeTableGen({ inputs, catalogue, favor, owned, repPerHour0, moneyScale = 1, grid = LIFE_GRID, horizonH = 48, maxLives = 100, nfgLevel0 = 0 }) {
  if (!catalogue || !pos(repPerHour0)) return null
  // Memoised per length: lifeSequence and the table row both ask, and with a
  // hacknet rebuild each answer is a small simulation.
  const moneyMemo = new Map()
  const moneyAt = (L) => {
    if (!moneyMemo.has(L)) moneyMemo.set(L, freshLifeMoney(inputs, L, moneyScale) ?? 0)
    return moneyMemo.get(L)
  }
  const rows = []
  for (const L of grid) {
    const n = Math.max(1, Math.min(maxLives, Math.round(horizonH / L)))
    if (!moneyMemo.has(L)) moneyMemo.set(L, (yield* freshLifeMoneyGen(inputs, L, moneyScale)) ?? 0)
    yield
    const seq = lifeSequence({ items: catalogue.items, nfg: catalogue.nfg, favor, owned, L, lives: n, moneyAt, repPerHour0, nfgLevel0 })
    yield
    const mean = seq.reduce((a, s) => a + s.lnGain, 0) / seq.length
    rows.push({ L, lives: n, money: Math.round(moneyAt(L)), gain: +Math.exp(mean).toFixed(4), lnMean: mean, perHour: +(mean / L).toFixed(4), first: seq[0]?.chosen?.length ?? 0, firstNfg: seq[0]?.nfgLevels ?? 0 })
  }
  return rows
}

/**
 * THE CADENCE AT LIFE LENGTH L, ONE BELIEF for the point and the draws: the
 * cadence posterior (bayes.cadencePosterior) whose prior is the purchase
 * model's ln(M)/h AT L and whose evidence is this node's own gaining lives.
 * The update is Gaussian in ln(rate) with a precision that does not depend on
 * L (the model's structural error, the lives' scatter), so the posterior at
 * any L follows exactly from the one computed at `post.modelPrior` (L0):
 *   mean_L = mean_L0 + (1 - w) (ln m_L - ln m_L0),   sd_L = sd_L0
 * (w: the own lives' share of the rate's precision). `row`: the table row at L
 * (lnMean, the model's mean ln gain a life; `gain` where the row is rounded).
 * Returns {L, model (ln(M)/h), mean, sd, r (the median ln(M)/h), gain (the
 * point's per-life gain exp(r L)), weight} or null (nothing bought at L).
 */
export function lifeCadenceAt(row, post) {
  const L = row?.L
  const ln = num(row?.lnMean) ? row.lnMean : pos(row?.gain) ? Math.log(row.gain) : null
  if (!pos(L) || !pos(ln)) return null
  const model = ln / L
  const rate = post?.rate
  const m0 = post?.modelPrior?.lnPerHour
  let mean = Math.log(model)
  let sd = null
  let w = 0
  if (rate && num(rate.mean) && num(rate.sd) && pos(m0)) {
    w = num(rate.weight) ? rate.weight : 0
    mean = rate.mean + (1 - w) * (Math.log(model) - Math.log(m0))
    sd = rate.sd
  }
  const r = Math.exp(mean)
  return { L, model, mean, sd, r, gain: Math.exp(r * L), weight: w }
}

/**
 * THE EXIT INPUTS WITH LATER LIVES OF LENGTH L: the base inputs (grafts,
 * carried streams, the trader's belief, the purchase model's table — the
 * next install's batch owned) with the cycle at L and what the posterior says
 * a life of L buys (lifeCadenceAt). `cadence.post` {mean, sd} is the belief
 * plan.applyDraw draws the per-life gain from (the same z in every option: a
 * paired comparison), its median the point. Every decision prices the
 * COMMITTED L through this one function (progress.js exitInputsGen); the life
 * length decision prices each L through it. `rec`: the purchase model's record
 * {table, moneyScale, moneyCalibration, afterBatch}; `post`: the cadence
 * posterior (installCadence(...).posterior) at its model prior; `lifeLength`:
 * what committed L (descriptive). Returns inputs or null (L not priced).
 */
export function lifeInputsOf(base, rec, L, post, { lifeLength = null, catalogue = null } = {}) {
  const row = (rec?.table ?? []).find((r) => r.L === L)
  const c = row ? lifeCadenceAt(row, post) : null
  if (!c) return null
  const measured = base?.cadence ?? null
  return {
    ...base,
    cycleHours: L,
    // The Go rate bonus on g (base.goCadenceMult, goplan.goExitInputsOf), as on the measured cadence.
    multGainPerCycle: num(base?.goCadenceMult) && base.goCadenceMult > 0 && c.gain > 0 ? Math.exp(Math.log(c.gain) * base.goCadenceMult) : c.gain,
    cadenceFrom: 'purchase model',
    cadenceRateMedian: c.r,
    cadence: {
      ...(measured ?? {}),
      source: 'purchase model',
      model: { lnPerHour: c.model, cycleHours: L, multGainPerCycle: Math.exp(c.model * L) },
      rateMedian: c.r,
      // THE BELIEF THE DRAWS TAKE (plan.applyDraw): ln(ln(M)/h) ~ N(mean, sd).
      post: num(c.sd) ? { mean: c.mean, sd: c.sd, weight: c.weight } : null,
      posterior: post?.why ?? null,
      why: lifeLength ?? `later lives of ${L}h`,
      measured: measured?.why ?? null,
      // lnMean unrounded: a replay of these inputs prices each L exactly.
      table: rec?.table ?? [],
      moneyCalibration: rec?.moneyCalibration ?? null,
      catalogue,
      afterBatch: rec?.afterBatch ?? null,
    },
  }
}
