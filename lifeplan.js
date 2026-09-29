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
import { levelAt } from 'exitplan.js'
import { planHacknetBatch, hashRate, DOLLARS_PER_HASH } from 'hacknetplan.js'

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
export function freshLifeMoney(inputs, L, scale = 1) {
  const cash0 = num(inputs?.installCash) && inputs.installCash >= 0 ? inputs.installCash : 1262
  if (!pos(L)) return cash0
  const flat = num(inputs.flatIncomePerSec) && inputs.flatIncomePerSec > 0 ? inputs.flatIncomePerSec : 0
  if (!num(inputs.incomePerSec) || !pos(inputs.hacking) || !pos(inputs.hackingMult)) return null
  const lvlIncome = (Math.max(0, inputs.incomePerSec - flat) * 51) / (inputs.hacking + 50)
  const r = pos(inputs.capitalReturnPerSec) ? inputs.capitalReturnPerSec : 0
  const cap = pos(inputs.capitalCap) ? inputs.capitalCap : Infinity
  const warmH = pos(inputs.capitalWarmupH) ? inputs.capitalWarmupH : 0
  const xps = pos(inputs.expPerSec) ? inputs.expPerSec : 0
  let money = cash0
  let exp = 0
  const steps = 200
  const dt = (L * 3600) / steps
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
  const every = Math.max(1, Math.floor(steps / HACKNET_DECISIONS))
  for (let i = 0; i < steps; i++) {
    const h = (i * dt) / 3600
    if (hn && i % every === 0 && L - h > 0 && money > 0) {
      const b = planHacknetBatch({ servers: fleet, mults: hn.mults, nodeMoney: hn.nodeMoney, W: L - h, capital: r > 0 ? { capitalReturnPerSec: r, capitalCap: cap, capitalWarmupH: Math.max(0, warmH - h), money } : null, budget: money, maxItems: 60 })
      if (b.items.length) {
        money -= b.cost
        fleet = b.servers
        hashPerSec = fleet.reduce((a, x) => a + (hashRate(x.level, 0, x.ram, x.cores, hn.mults.hacknet_node_money, hn.nodeMoney) ?? 0), 0)
      }
    }
    const lvl = levelAt(exp, inputs.hackingMult)
    const cg = r > 0 && h >= warmH ? (money < cap ? Math.min(money * Math.expm1(r * dt), cap - money + r * cap * dt) : r * cap * dt) : 0
    money += ((lvlIncome * (lvl + 50)) / 51 + flat + hashPerSec * DOLLARS_PER_HASH) * dt + Math.max(0, cg)
    exp += xps * dt
  }
  return cash0 + (money - cash0) * (pos(scale) ? scale : 1)
}

/**
 * THE MONEY MODEL'S CALIBRATION: earned-at-end over modelled-at-the-same-age
 * for the node's most recent completed lives in tel.js's earnings ledger
 * (/tel/earnings.txt), median. {scale, lives, ratios, why} — scale 1 with a
 * stated reason when nothing is measured.
 */
export function moneyScaleOf(earnings, node, inputs, { recent = 4 } = {}) {
  const lives = Object.entries(earnings?.lives ?? {})
    .filter(([, L]) => L?.node === node && L.complete === true && Array.isArray(L.samples) && L.samples.length >= 2)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .slice(-recent)
  const ratios = []
  for (const [, L] of lives) {
    const [h, earned] = L.samples[L.samples.length - 1]
    const m = freshLifeMoney(inputs, h, 1)
    const cash0 = num(inputs?.installCash) ? inputs.installCash : 1262
    if (pos(h) && pos(earned) && pos(m - cash0)) ratios.push(earned / (m - cash0))
  }
  if (!ratios.length) return { scale: 1, lives: 0, ratios, why: 'UNCALIBRATED: no completed life in the earnings ledger — the exit model\'s fresh-life income taken as it is' }
  const s = [...ratios].sort((a, b) => a - b)
  const scale = s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  return { scale, lives: ratios.length, ratios: ratios.map((x) => +x.toFixed(3)), why: `money model scaled x${scale.toFixed(3)} to the last ${ratios.length} completed lives' earnings (each life earned/modelled: ${ratios.map((x) => x.toFixed(2)).join(', ')})` }
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

/** Lives of length L in a row: the catalogue depleting, favour accruing. */
export function lifeSequence({ items, nfg, favor, owned, L, lives, moneyAt, repPerHour0 }) {
  const state = { owned: new Set(owned ?? []), favor: { ...(favor ?? {}) }, nfgLevel: 0 }
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
export function cadenceByPurchases({ inputs, catalogue, favor, owned, repPerHour0, moneyScale = 1, bestExitPolicy, grid = [0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24], horizonH = 48, maxLives = 100 }) {
  if (!catalogue || !pos(repPerHour0) || typeof bestExitPolicy !== 'function') return null
  // Memoised per length: lifeSequence and the table row both ask, and with a
  // hacknet rebuild each answer is a small simulation.
  const moneyMemo = new Map()
  const moneyAt = (L) => {
    if (!moneyMemo.has(L)) moneyMemo.set(L, freshLifeMoney(inputs, L, moneyScale) ?? 0)
    return moneyMemo.get(L)
  }
  const table = []
  let best = null
  for (const L of grid) {
    const n = Math.max(1, Math.min(maxLives, Math.round(horizonH / L)))
    const seq = lifeSequence({ items: catalogue.items, nfg: catalogue.nfg, favor, owned, L, lives: n, moneyAt, repPerHour0 })
    const mean = seq.reduce((a, s) => a + s.lnGain, 0) / seq.length
    const g = Math.exp(mean)
    // ON THE EXIT'S OWN INPUTS: only the later lives' length and gain vary.
    // The next install's batch (installGains / nextInstallGain) is THIS
    // life's, whatever length later lives run; nulling it (as this did) gave
    // the first install the L-length life's gain too, which favours long
    // lives — live BN9 2026-09-29 it chose 16h (table 99.0h) where the full
    // exit on the same inputs is 98.6h at 6h against 107.6h at 16h.
    const r = g > 1 ? bestExitPolicy({ ...inputs, cycleHours: L, multGainPerCycle: g }) : null
    const H = r && !r.degenerate ? r.best?.hours ?? null : null
    table.push({ L, lives: n, money: Math.round(moneyAt(L)), gain: +g.toFixed(4), perHour: +(mean / L).toFixed(4), first: seq[0]?.chosen?.length ?? 0, firstNfg: seq[0]?.nfgLevels ?? 0, H: num(H) ? +H.toFixed(2) : null })
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
