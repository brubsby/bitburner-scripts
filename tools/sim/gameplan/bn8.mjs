// BITNODE 8's EXIT, SIMULATED: the stock trader is the only income, through installs.
//
//   node tools/sim/gameplan/bn8.mjs                    the BN8.1 calibration + replay, then BN8.2 / BN8.3 from the plan's states
//   node tools/sim/gameplan/bn8.mjs --state 1.3,2.1,...   price one entry state
//   node tools/sim/gameplan/bn8.mjs --write-fixture    freeze BN8.1's lives into tools/test/fixture-bn8-lives.json
//
// WHY (docs/postponed-after-reset.md items 7 + 9; routes.mjs 'stocks' was a placeholder): BN8 was
// priced by the hacking route — exitplan's latent growth g (ln of the hacking multiplier per hour)
// with the trader as capital — but in BN8 g is not a latent: ScriptHackMoneyGain is 0, so every
// augmentation is bought with the trader's money, and every install re-initialises the market
// (Prestige.ts:166-170) and resets the balance to $250m (Prestige.ts:158). BN8.1 (2026-09-25..27)
// was money-bound: hacking sat at ~850 from 18h to 33h, the augmentations crawled 27 -> 30, The Red
// Pill went in at 54.2h. The two trajectories this file compares are whole-node ones: each policy
// (life lengths, how many lives before the final one, the gift accepted or never) simulated from
// the node's entry to w0r1d_d43m0n, and the min is the node's hours (CLAUDE.md "Decisions compare
// simulated trajectories").
//
// THE MODEL, a life at a time (dt 0.02h):
//   MONEY     the book W from $250m (BitNode8StartingMoney, Prestige.ts:158) on a FRESH market:
//             dlnW/dt = kappa8(R) x traderw.rwAgeRate(W, age, regime) — the ledger's r(W, age)
//             (tools/sim/stocks/rwage.mjs, every market-life recorded), age = hours since the life's
//             install, regime pre-4S until the 4S data + TIX API are bought ($1b + $25b,
//             StockMarket/data/Constants.ts:9-10, x FourSigmaMarketData*Cost = 1 in BN8; kept across
//             installs, reset only at a node's end: PlayerObjectGeneralMethods.ts:165 prestigeSourceFile).
//             kappa8(R) = KAPPA8 x (R / 256GB)^RHO8: BitNode 8's own trader — shorts allowed
//             (StockMarket.ts), and the whole fleet serves the trader's manipulation (hacking pays
//             nothing) — MEASURED on BN8.1's two clean money endpoints (calibrate below, printed).
//   AUGS      the game's catalogue (Augmentations.ts, Factions[f].augmentations) at BN8's prices
//             (AugmentationMoneyCost / RepCost 1): price x (1.9 x SF11 discount)^queued
//             (AugmentationHelpers.ts getAugCost, getGenericAugmentationPriceMultiplier); NeuroFlux
//             x1.14 per level (price and rep); the rep is DONATED at $1e6 / faction_rep a point
//             (donation.ts: FavorToDonateToFaction 0 in BN8 is a threshold of 0) less the faction
//             work this life earned (reputation.ts getHackingWorkRepGain, 5 cycles/s, focused).
//             POLICY (ASSUMED, not augplan's): at each install the cheapest augmentations first
//             (count, then everything affordable), bought most expensive first, then NeuroFlux levels
//             with what is left, then home RAM with the rest (the install procedure: homeup --reserve 0).
//   FACTIONS  joined as their bars allow (FactionInfo.tsx / servers.ts): CyberSec at hacking 60
//             (CSEC 51-60), NiteSec 220, The Black Hand 365, BitRunners 550 (the backdoor servers'
//             top of range), Tian Di Hui 50, Netburners 80, Slum Snakes and Tetrads from the life's
//             start (combat 30/75, karma -9/-18: minutes of gym and crime, ASSUMED free), one city
//             group a life (Sector-12+Aevum | Chongqing+New Tokyo+Ishima | Volhaven: enemies).
//             NOT MODELLED: megacorps (ECorp joined in BN8.1's 14h life), The Syndicate, The Dark
//             Army, Speakers, Illuminati, The Covenant, grafting (BN8.1 grafted 8 augmentations).
//   EXP       exp/s = EXP_K0 x (R / 512GB)^EXP_B x (L + 50) x hacking_exp x hacking_speed x int bonus
//             (an op's exp is fixed and its time ~ 1/(L + 50), Hacking.ts:30-81) — EXP_K0, EXP_B
//             MEASURED on BN8.1's lives (the batcher's exp in BN8 grows only as RAM^0.15: printed).
//   EXIT      Daedalus: 30 augmentations INSTALLED (DaedalusAugsRequirement), $100b cash, hacking 2500
//             (FactionInfo.tsx:138-146); The Red Pill 2.5m rep x AugmentationRepCost, donated; install;
//             hacking 3000 x WorldDaemonDifficulty from exp 0 (ServerHelpers w0r1d_d43m0n); + EXIT_H.
//   GIFT      (SF13 >= 1) Stanek's Gift accepted at the node's start or never: Genesis x0.9 on every
//             multiplier (Augmentations.ts), the grid 2x3 in BN8 (StaneksGiftExtraSize -99), the
//             gameplan's layout for it (stanek.mjs layoutFor), each life's charge from zero
//             (StaneksGift.prestigeAugmentation) on home x f (f = GIFT_F), the calibrated charger
//             (stanekplan.GIFT_CAL: kappa, the start delay — tools/sim/gameplan/giftcal.mjs) — the
//             hacking fragments' effect on hacking and hacking_exp, the charger's RAM off the exp fleet.
//             Genesis counts toward the 30.
//
// CALIBRATION (printed every run, pass or fail): BN8.1 replayed on its own lives (the install times
// and the augmentations it actually installed, from history.jsonl): the exp model per life, the money
// at the two clean endpoints, and the milestones — 30 installed, hacking 2500, Daedalus joined, The
// Red Pill's money, the exit — each against the measured, with the tolerance next to it. The policy
// search from BN8.1's entry is printed beside the measured clear net of its recorded stalls.
// NOT CALIBRATED: the policy (cheapest-first; the live augplan prices by the exit), the factions not
// modelled (a floor on what a life can buy), sleeves (SF10: their faction rep and exp transfer NOT
// PRICED), the IPvGO farm (Daedalus' faction_rep, Illuminati's speed: NOT PRICED), kappa8 off BN8.1's
// fleet sizes.

import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import g, { setBitNode } from '../nodechoice/game.mjs'
import { sfMults } from '../nodechoice/hackexit.mjs'

const { rwAgeRate, RW_BN8 } = await import('../../../traderw.js')
const { addRepToFavor } = await import('../../../favor.js')
const { ramUpgradeCost } = await import('../../../homecost.js')
const { SF11_DISCOUNT, BASE_PRICE_MULT, NFG_LEVEL_MULT } = await import('../../../augplan.js')
const sp = await import('../../../stanekplan.js')
const { layoutFor } = await import('./stanek.mjs')

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../../..')
export const LIVES_FIXTURE = path.join(ROOT, 'tools/test/fixture-bn8-lives.json')

// ---------------------------------------------------------------------------
// CONSTANTS — source, measured, assumed (each labelled)
// ---------------------------------------------------------------------------
export const START_MONEY = 250e6 // Prestige.ts:158 BitNode8StartingMoney
export const FOUR_S_COST = 1e9 + 25e9 // StockMarket/data/Constants.ts:9-10 (x FourSigmaMarketData*Cost, 1 in BN8)
/** 4S is bought once the book holds this many times its price (ASSUMED policy; stock.js prices the buy as a trajectory). */
export const FOUR_S_AT = 3
export const DAEDALUS = { augs: 30, money: 100e9, hacking: 2500 } // FactionInfo.tsx:138-146 (x DaedalusAugsRequirement)
export const RED_PILL_REP = 2.5e6 // Augmentations.ts TheRedPill (x AugmentationRepCost)
export const EXIT_LEVEL = 3000 // servers.ts w0r1d_d43m0n requiredHackingSkill (x WorldDaemonDifficulty)
/** After the Red Pill: hack w0r1d_d43m0n + endgame's destroy (ASSUMED 0.1h; BN8.1 lost 1.8h here to a stall since fixed — replayed). */
export const EXIT_H = 0.1
/** Home at the node's entry (MEASURED: BN8.1 opened at 32GB) and the share of each life's opening $250m the stack spends on home (ASSUMED: BN8.1 was at 256GB inside its first hour). */
export const HOME0 = 32
export const HOME_OPEN_SHARE = 0.2
/** The charger's share of home when the gift is accepted (the gameplan's design f, stanek.mjs LAYOUT_F). */
export const GIFT_F = 0.2
/** The faction-work slot's focus (focused: x1; Player.focusPenalty). */
export const FOCUS = 1
/** MEASURED on BN8.1 (calibrate(), printed): the exp model and the trader's BN8 factor. */
export const BN8_CAL = { EXP_K0: 1.822, EXP_B: 0.021, KAPPA8: RW_BN8.kappa, RHO8: RW_BN8.rho, INT_REF: 112, source: 'bn8.mjs 2026-10-23 on BN8.1 (history.jsonl): exp 520 segments, trader the two clean endpoints' }

export const FACTION_BARS = [
  { name: 'CyberSec', hack: 60 },
  { name: 'Tian Di Hui', hack: 50 },
  { name: 'Netburners', hack: 80 },
  { name: 'NiteSec', hack: 220 },
  { name: 'The Black Hand', hack: 365 },
  { name: 'BitRunners', hack: 550 },
  { name: 'Slum Snakes', hack: 0 },
  { name: 'Tetrads', hack: 0 },
]
export const CITY_GROUPS = [['Chongqing', 'New Tokyo', 'Ishima'], ['Sector-12', 'Aevum'], ['Volhaven']]
const NFG = 'NeuroFlux Governor'
const SPECIAL = new Set([NFG, 'The Red Pill', "Stanek's Gift - Genesis", "Stanek's Gift - Awakening", "Stanek's Gift - Serenity"])

// ---------------------------------------------------------------------------
// THE CATALOGUE (game data) and the player's multipliers
// ---------------------------------------------------------------------------
let CAT = null
/** { augs: Map name -> {name, price, rep, mults, prereqs, factions}, byFaction: Map f -> names, nfg: {price, rep}, mults } at BN8. */
export function catalogue(level = 1) {
  if (CAT && CAT.level === level) return CAT
  const m = setBitNode(8, level)
  const augs = new Map()
  const byFaction = new Map()
  const fnames = [...FACTION_BARS.map((f) => f.name), ...CITY_GROUPS.flat()]
  for (const f of fnames) {
    const list = (g.Factions[f]?.augmentations ?? []).filter((a) => !SPECIAL.has(a))
    byFaction.set(f, list)
    for (const a of list) {
      const A = g.Augmentations[a]
      if (!A) throw new Error(`bn8: ${a} (${f}) not in the game's Augmentations`)
      const cur = augs.get(a) ?? { name: a, price: A.baseCost * m.AugmentationMoneyCost, rep: A.baseRepRequirement * m.AugmentationRepCost, mults: { ...A.mults }, prereqs: [...(A.prereqs ?? [])], factions: [] }
      cur.factions.push(f)
      augs.set(a, cur)
    }
  }
  const N = g.Augmentations[NFG]
  CAT = { level, m, augs, byFaction, nfg: { price: N.baseCost * m.AugmentationMoneyCost, rep: N.baseRepRequirement * m.AugmentationRepCost, mults: { ...N.mults } }, genesis: { ...g.Augmentations["Stanek's Gift - Genesis"].mults } }
  return CAT
}

/** The player's multipliers: the Source-Files (applySourceFile), the installed augmentations, NeuroFlux levels, Genesis. */
function multsOf(st) {
  const c = catalogue(st.level)
  const out = { hacking: st.sf.hacking, hacking_exp: st.sf.hacking_exp, hacking_speed: st.sf.hacking_speed, faction_rep: st.sf.faction_rep }
  for (const a of st.owned) {
    const x = c.augs.get(a)?.mults ?? g.Augmentations[a]?.mults
    if (!x) continue
    for (const k of Object.keys(out)) out[k] *= x[k] ?? 1
  }
  const nf = Math.pow(c.nfg.mults.hacking, st.nfg)
  for (const k of Object.keys(out)) out[k] *= nf
  if (st.gift) for (const k of Object.keys(out)) out[k] *= c.genesis[k] ?? 1
  out.hacking *= c.m.HackingLevelMultiplier
  return out
}
/** Installed augmentations as Daedalus counts them: Player.augmentations.length (NeuroFlux once; Genesis counts). */
const installedCount = (st) => st.owned.size + (st.nfg > 0 ? 1 : 0) + (st.gift ? 1 : 0)

const intBonus = (int) => 1 + Math.pow(Math.max(0, int), 0.8) / 600 // intelligence.ts calculateIntelligenceBonus
const levelOf = (exp, mult) => Math.max(1, mult * (32 * Math.log(Math.max(0, exp) + 534.6) - 200)) // skill.ts (continuous)

// ---------------------------------------------------------------------------
// THE GIFT IN BN8 (2x3 grid): each life's hacking factor at t hours in
// ---------------------------------------------------------------------------
let GIFT_LAY = null
function giftFactor(st, t) {
  if (!st.gift) return 1
  const m = catalogue(st.level).m
  if (!GIFT_LAY || GIFT_LAY.l13 !== st.l13) GIFT_LAY = { l13: st.l13, cl: sp.compileLayout(layoutFor(m, st.l13).placed) }
  const cal = sp.GIFT_CAL
  const chH = Math.max(0, t - cal.delayH)
  if (!(chH > 0)) return 1
  const T = sp.threadsOf(st.home * GIFT_F, 1)
  const N = (chH * 3600 * 0.9) / GIFT_LAY.cl.k
  const h = sp.multsAt(GIFT_LAY.cl, sp.chargeFactor(T, N), m.StaneksGiftPowerMultiplier).hacking
  return Math.exp(cal.kappa * Math.log(h))
}

// ---------------------------------------------------------------------------
// THE TRADER and THE EXP FLEET
// ---------------------------------------------------------------------------
/** kappa8's home range: the calibration's two endpoints ran on 256GB and 16TB; past 16TB the factor is held (no extrapolation). */
export const KAPPA_HOME = { min: RW_BN8.homeMin, max: RW_BN8.homeMax }
const kappaOf = (R, cal) => cal.KAPPA8 * Math.pow(Math.min(KAPPA_HOME.max, Math.max(R, 32)) / 256, cal.RHO8)
function expRate(st, L, cal, mu, gf) {
  const R = st.home * (st.gift ? 1 - GIFT_F : 1)
  return cal.EXP_K0 * Math.pow(Math.max(R, 8) / 512, cal.EXP_B) * (L + 50) * mu.hacking_exp * gf * mu.hacking_speed * (intBonus(st.int) / intBonus(cal.INT_REF))
}
/** Faction work rep per second at level L (reputation.ts getHackingWorkRepGain x 5 cycles/s, focused). */
const repRate = (L, int, repMult, favor) => 5 * ((L + int / 3) / 975) * repMult * intBonus(int) * (1 + favor / 100) * FOCUS

// ---------------------------------------------------------------------------
// ONE LIFE
// ---------------------------------------------------------------------------
/**
 * A life of up to T hours (T Infinity: the final life, ended by the Red Pill or maxH).
 * Mutates st (fourS, home). Returns { W, L, exp, workRep, t, joinAt, redPillAt, trace }.
 * final: the life runs the exit's conditions (Daedalus, the Red Pill's money).
 */
export function runLife(st, T, cal, { final = false, maxH = 200, dt = 0.02, onStep = null, augAt = null } = {}) {
  let mu = multsOf(st)
  // augAt [{t, name}]: augmentations installed DURING the life (BN8.1's grafts, GraftingWork: installed on completion)
  const pending = Array.isArray(augAt) ? [...augAt].sort((a, b) => a.t - b.t) : []
  let W = START_MONEY
  // the opening home buys (ASSUMED share of the opening balance)
  let budget = START_MONEY * HOME_OPEN_SHARE
  while (st.home < 2 ** 30) {
    const c = ramUpgradeCost(st.home, catalogue(st.level).m.HomeComputerRamCost)
    if (c > budget) break
    budget -= c
    W -= c
    st.home *= 2
  }
  let exp = 0
  let L = 1
  let workRep = 0
  let joinAt = null
  let daedRep = 0
  let redPillAt = null
  const end = final ? maxH : T
  let t = 0
  const favor = st.workFavor ?? 0
  while (t < end - 1e-9) {
    const h = Math.min(dt, end - t)
    while (pending.length && pending[0].t <= t) {
      st.owned.add(pending.shift().name)
      mu = multsOf(st)
    }
    const gf = giftFactor(st, t + h / 2)
    // the market: age t, the regime this node has bought
    const reg = st.fourS ? '4S-long' : 'pre-long'
    W *= Math.exp(kappaOf(st.home, cal) * rwAgeRate(W, t + h / 2, reg) * h)
    if (!st.fourS && W >= FOUR_S_AT * FOUR_S_COST) {
      W -= FOUR_S_COST
      st.fourS = true
      st.fourSAt = st.clock + t
    }
    exp += expRate(st, L, cal, mu, gf) * h * 3600
    L = levelOf(exp, mu.hacking * gf)
    const rr = repRate(L, st.int, mu.faction_rep, joinAt !== null ? st.daedFavor ?? 0 : favor) * h * 3600
    if (joinAt !== null) daedRep += rr
    else workRep += rr
    t += h
    if (onStep) onStep({ t, W, L, exp })
    if (final) {
      if (joinAt === null && installedCount(st) >= DAEDALUS.augs * catalogue(st.level).m.DaedalusAugsRequirement / 30 && L >= DAEDALUS.hacking && W >= DAEDALUS.money) joinAt = t
      if (joinAt !== null) {
        const need = Math.max(0, RED_PILL_REP * catalogue(st.level).m.AugmentationRepCost - daedRep) * 1e6 / (mu.faction_rep * catalogue(st.level).m.FactionWorkRepGain)
        if (W >= need) {
          redPillAt = t
          W -= need
          break
        }
      }
    }
  }
  return { W, L, exp, workRep, t, joinAt, redPillAt, mu }
}

// ---------------------------------------------------------------------------
// THE INSTALL: buy (cheapest first), NeuroFlux, home
// ---------------------------------------------------------------------------
/** The factions this life can buy from at level L: the bars, and the city group with the most unowned value. */
function factionsAt(st, L) {
  const c = catalogue(st.level)
  const out = FACTION_BARS.filter((f) => L >= f.hack).map((f) => f.name)
  let best = null
  for (const grp of CITY_GROUPS) {
    const n = grp.reduce((a, f) => a + (c.byFaction.get(f) ?? []).filter((x) => !st.owned.has(x)).length, 0)
    if (!best || n > best.n) best = { grp, n }
  }
  return [...out, ...(best?.grp ?? [])]
}

/** Total money of a batch: escalated prices (most expensive first) + the per-faction donation shortfall after `workRep` credited to the costliest faction. */
function batchCost(st, items, repByFaction, workRep, repMult) {
  const esc = BASE_PRICE_MULT * SF11_DISCOUNT[Math.min(3, st.l11)]
  const prices = items.map((x) => x.price).sort((a, b) => b - a)
  let p = 0
  for (let j = 0; j < prices.length; j++) p += prices[j] * Math.pow(esc, j)
  const reps = [...repByFaction.values()].sort((a, b) => b - a)
  if (reps.length) reps[0] = Math.max(0, reps[0] - workRep)
  const don = reps.reduce((a, r) => a + r, 0) * 1e6 / repMult
  return { total: p + don, prices: p, donation: don, esc }
}

/**
 * Spend W at the install: augmentations cheapest first (each faction's donation is its largest
 * requirement in the batch), then NeuroFlux levels, then home RAM. Mutates st. Returns the batch.
 */
export function buyAndInstall(st, W, L, workRep, mu, { names = null } = {}) {
  const c = catalogue(st.level)
  const repMult = mu.faction_rep * c.m.FactionWorkRepGain
  const facs = factionsAt(st, L)
  const sel = []
  const repBy = new Map()
  if (names) {
    // REPLAY: the batch BN8.1 actually installed (its own factions)
    for (const n of names) {
      if (n === NFG || SPECIAL.has(n)) continue
      const a = c.augs.get(n) ?? { name: n, price: (g.Augmentations[n]?.baseCost ?? 0) * c.m.AugmentationMoneyCost, rep: (g.Augmentations[n]?.baseRepRequirement ?? 0) * c.m.AugmentationRepCost, factions: g.Augmentations[n]?.factions ?? [] }
      sel.push(a)
      const f = a.factions?.[0] ?? '?'
      repBy.set(f, Math.max(repBy.get(f) ?? 0, a.rep))
    }
  } else {
    const avail = new Map()
    for (const f of facs) for (const n of c.byFaction.get(f) ?? []) if (!st.owned.has(n)) avail.set(n, c.augs.get(n))
    for (;;) {
      let best = null
      for (const a of avail.values()) {
        if (sel.includes(a) || a.prereqs.some((p) => !st.owned.has(p) && !sel.some((s) => s.name === p))) continue
        const f = a.factions.filter((x) => facs.includes(x)).sort((x, y) => (repBy.get(y) ?? 0) - (repBy.get(x) ?? 0))[0]
        const rb = new Map(repBy)
        rb.set(f, Math.max(rb.get(f) ?? 0, a.rep))
        const cost = batchCost(st, [...sel, a], rb, workRep, repMult).total
        if (cost <= W && (!best || cost < best.cost)) best = { a, f, cost, rb }
      }
      if (!best) break
      sel.push(best.a)
      for (const [k, v] of best.rb) repBy.set(k, v)
    }
  }
  const bc = batchCost(st, sel, repBy, workRep, repMult)
  let left = W - bc.total
  // NeuroFlux levels: at the faction with the most rep in the batch (any joined one), price and rep x1.14 a level
  let nfgAdd = 0
  if (!names) {
    const nfRep0 = Math.max(0, ...repBy.values())
    for (;;) {
      const lv = st.nfg + nfgAdd
      const price = c.nfg.price * Math.pow(NFG_LEVEL_MULT, lv) * Math.pow(bc.esc, sel.length + nfgAdd)
      const rep = c.nfg.rep * Math.pow(NFG_LEVEL_MULT, lv)
      const don = (Math.max(0, rep - Math.max(nfRep0, workRep)) * 1e6) / repMult
      if (price + don > left) break
      left -= price + don
      nfgAdd++
    }
  } else nfgAdd = names.filter((n) => n === NFG).length
  for (const a of sel) st.owned.add(a.name)
  st.nfg += nfgAdd
  // the rest buys home RAM (survives the install; homeup --reserve 0)
  while (st.home < 2 ** 30) {
    const cost = ramUpgradeCost(st.home, c.m.HomeComputerRamCost)
    if (cost > left) break
    left -= cost
    st.home *= 2
  }
  // favor banked on the worked faction (work + the donations there)
  st.workFavor = addRepToFavor(st.workFavor ?? 0, workRep + Math.max(0, ...repBy.values()))
  return { n: sel.length, nfg: nfgAdd, cost: bc.total, prices: bc.prices, donation: bc.donation, left, names: sel.map((a) => a.name) }
}

// ---------------------------------------------------------------------------
// A WHOLE NODE under a policy
// ---------------------------------------------------------------------------
/** A fresh entry: { sf: [[n, l]...], int, l11, l13, gift, level }. */
export function entryState({ sf, int = 0, level = 1, gift = false }) {
  const s = sfMults(sf)
  const lv = new Map(sf)
  return { sf: s, sfPairs: sf, int, level, l11: lv.get(11) ?? 0, l13: lv.get(13) ?? 0, gift: gift && (lv.get(13) ?? 0) >= 1, owned: new Set(), nfg: 0, home: HOME0, fourS: false, clock: 0, workFavor: 0, daedFavor: 0 }
}

/**
 * Hours from the entry to w0r1d_d43m0n under the policy { lifeH, lives } — `lives` installs at
 * lifeH each, then the final life (Daedalus + The Red Pill), the climb after its install, EXIT_H.
 * Returns { hours, lives, milestones, why } (hours Infinity with why when the policy cannot exit).
 */
export function runNode(entry, policy, cal = BN8_CAL, { maxFinalH = 120, trace = false } = {}) {
  const st = { ...entry, owned: new Set(entry.owned), clock: 0 }
  const ms = { thirty: null, hack2500: null, join: null, redPill: null, exit: null, fourS: null }
  const lives = []
  for (let i = 0; i < policy.lives; i++) {
    const r = runLife(st, policy.lifeH, cal)
    const b = buyAndInstall(st, r.W, r.L, r.workRep, r.mu)
    st.clock += r.t
    if (ms.thirty === null && installedCount(st) >= DAEDALUS.augs) ms.thirty = st.clock
    if (trace) lives.push({ at: st.clock, len: r.t, W: r.W, L: r.L, bought: b.n, nfg: b.nfg, installed: installedCount(st), home: st.home, fourS: st.fourS })
  }
  if (installedCount(st) < DAEDALUS.augs) return { hours: Infinity, why: `${installedCount(st)} installed after ${policy.lives} lives (Daedalus needs ${DAEDALUS.augs})`, lives, milestones: ms }
  let h2500 = null
  const r = runLife(st, Infinity, cal, { final: true, maxH: maxFinalH, onStep: (s) => (h2500 === null && s.L >= DAEDALUS.hacking ? (h2500 = s.t) : null) })
  if (r.redPillAt === null) return { hours: Infinity, why: `final life: ${r.joinAt === null ? `no Daedalus join in ${maxFinalH}h (level ${r.L.toFixed(0)}, $${r.W.toExponential(2)})` : `the Red Pill's money not reached in ${maxFinalH}h`}`, lives, milestones: ms }
  ms.hack2500 = h2500 !== null ? st.clock + h2500 : null
  ms.join = st.clock + r.joinAt
  ms.redPill = st.clock + r.redPillAt
  ms.fourS = st.fourSAt ?? null
  st.clock += r.redPillAt
  // the Red Pill installed: exp 0, the final multiplier (the gift's charge restarts too)
  st.owned.add('The Red Pill')
  const mu = multsOf(st)
  let exp = 0
  let L = 1
  let t = 0
  const need = EXIT_LEVEL * catalogue(st.level).m.WorldDaemonDifficulty
  while (L < need && t < 50) {
    const gf = giftFactor(st, t + 0.005)
    exp += expRate(st, L, cal, mu, gf) * 0.01 * 3600
    L = levelOf(exp, mu.hacking * gf)
    t += 0.01
  }
  const exitH = policy.exitH ?? EXIT_H
  ms.exit = st.clock + t + exitH
  if (trace) lives.push({ at: ms.redPill, len: r.redPillAt, W: r.W, L: r.L, final: true, joinAt: r.joinAt, climbH: t })
  return { hours: ms.exit, lives, milestones: ms, climbH: t, finalLifeH: r.redPillAt, installed: installedCount(st), home: st.home }
}

/** The best policy over the grid (life length x lives before the final), the gift both ways when SF13 >= 1. */
export const LIFE_GRID = [1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12]
export function bestPolicy(entryArgs, cal = BN8_CAL, { lifeGrid = LIFE_GRID, maxLives = 12, giftWays = null } = {}) {
  const ways = giftWays ?? ((new Map(entryArgs.sf).get(13) ?? 0) >= 1 ? [false, true] : [false])
  const out = { byGift: {} }
  for (const gift of ways) {
    let best = null
    const tried = []
    for (const lifeH of lifeGrid) {
      let lastH = Infinity
      for (let lives = 1; lives <= maxLives; lives++) {
        const r = runNode(entryState({ ...entryArgs, gift }), { lifeH, lives }, cal)
        tried.push({ lifeH, lives, hours: r.hours })
        if (isFinite(r.hours) && (!best || r.hours < best.hours)) best = { ...r, policy: { lifeH, lives }, gift }
        // past the count, more lives only help while they shorten the node
        if (isFinite(r.hours) && isFinite(lastH) && r.hours > lastH + 2) break
        if (isFinite(r.hours)) lastH = r.hours
      }
    }
    out.byGift[gift ? 'accept' : 'never'] = best
  }
  const opts = Object.values(out.byGift).filter(Boolean)
  out.best = opts.reduce((a, b) => (!a || b.hours < a.hours ? b : a), null)
  return out
}


// ---------------------------------------------------------------------------
// BN8.1: the lives as played (history.jsonl), the calibration and the replay
// ---------------------------------------------------------------------------
/**
 * BN8.1's lives from history.jsonl: { sf, int, lives: [{ start, len, home, homeEnd, augsBefore, added, cashMax,
 * M (the median hacking skill multiplier its levels read), Lend, exp: [{t, L, r, home, int}], factions }],
 * milestones: { thirty, hack2500, join, redPill, exit } } (node hours).
 */
export async function bn8Lives(histPath) {
  const rl = readline.createInterface({ input: fs.createReadStream(histPath) })
  const rows = []
  for await (const l of rl) if (l.includes('"bitNode":8')) rows.push(JSON.parse(l))
  rl.close()
  if (!rows.length) return null
  const t0 = rows[0].totalPlaytime
  const lives = []
  let cur = null
  for (const j of rows) {
    const ps = j.playtimeSinceLastAug / 3.6e6
    if (!cur || ps < cur.lastPs - 0.005) {
      cur = { start: (j.totalPlaytime - j.playtimeSinceLastAug - t0) / 3.6e6, rows: [] }
      lives.push(cur)
    }
    cur.lastPs = ps
    cur.rows.push(j)
  }
  const ms = { thirty: null, hack2500: null, join: null, redPill: null, exit: (rows.at(-1).totalPlaytime - t0) / 3.6e6 }
  const out = []
  for (let i = 0; i < lives.length; i++) {
    const L = lives[i]
    const r0 = L.rows[0]
    const r1 = L.rows.at(-1)
    const next = lives[i + 1]?.rows[0]
    const pts = []
    for (let k = 0; k + 10 < L.rows.length; k += 10) {
      const a = L.rows[k]
      const b = L.rows[k + 10]
      const dt = (b.playtimeSinceLastAug - a.playtimeSinceLastAug) / 1e3
      if (dt > 0) pts.push({ t: +(a.playtimeSinceLastAug / 3.6e6).toFixed(4), L: (a.skills.hacking + b.skills.hacking) / 2, r: +(((b.exp?.hacking ?? 0) - (a.exp?.hacking ?? 0)) / dt).toPrecision(5), home: a.home.ram, int: a.skills.intelligence })
    }
    // augmentations that appear DURING the life (grafts install on completion; an install starts a new life)
    const midAdds = []
    for (let k = 1; k < L.rows.length; k++) for (const a of L.rows[k].augmentations) if (!L.rows[k - 1].augmentations.includes(a)) midAdds.push({ t: +(L.rows[k].playtimeSinceLastAug / 3.6e6).toFixed(4), name: a })
    // the faction worked most this life and its favor at the life's start (history.jsonl factionRep)
    const worked = new Map()
    for (const j of L.rows) if (j.currentWork?.type === 'FactionWork' && j.currentWork.faction) worked.set(j.currentWork.faction, (worked.get(j.currentWork.faction) ?? 0) + 1)
    const topF = [...worked.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const workFavor = topF ? r0.factionRep?.[topF]?.favor ?? 0 : 0
    const firstAdd = midAdds.length ? midAdds[0].t : Infinity
    const Ms = L.rows.filter((j) => j.playtimeSinceLastAug / 3.6e6 < firstAdd && j.skills.hacking > 30 && (j.exp?.hacking ?? 0) > 0).map((j) => j.skills.hacking / (32 * Math.log(j.exp.hacking + 534.6) - 200)).sort((a, b) => a - b)
    for (const j of L.rows) {
      const tt = (j.totalPlaytime - t0) / 3.6e6
      if (ms.thirty === null && j.augmentations.length >= 30) ms.thirty = tt
      if (ms.hack2500 === null && j.skills.hacking >= 2500) ms.hack2500 = tt
      if (ms.join === null && j.factions.includes('Daedalus')) ms.join = tt
    }
    if (ms.redPill === null && r0.augmentations.includes('The Red Pill')) ms.redPill = L.start
    out.push({
      start: +L.start.toFixed(4),
      len: +(r1.playtimeSinceLastAug / 3.6e6).toFixed(4),
      home: r0.home.ram,
      homeEnd: r1.home.ram,
      augsBefore: r0.augmentations,
      midAdds,
      workFaction: topF,
      workFavor: +workFavor.toFixed(2),
      added: next ? next.augmentations.filter((a) => !r1.augmentations.includes(a)) : [],
      cashMax: Math.max(...L.rows.map((j) => j.money)),
      M: Ms.length ? Ms[Math.floor(Ms.length / 2)] : null,
      Lend: r1.skills.hacking,
      exp: pts,
      int: r1.skills.intelligence,
      factions: r1.factions,
    })
  }
  return { sf: rows[0].sourceFiles?.data ?? [], int: rows[0].skills.intelligence, lives: out, milestones: ms }
}

/** BN8.1's NeuroFlux levels per life, from the multiplier its levels read over the one its augmentations give (history lists NFG once): monotone, >= 0. */
export function nfgLevels(b81) {
  let prev = 0
  return b81.lives.map((life) => {
    const st = { ...entryState({ sf: b81.sf, int: life.int }), owned: new Set(life.augsBefore.filter((a) => !SPECIAL.has(a))) }
    const m0 = multsOf(st).hacking
    const n = life.M && life.augsBefore.includes(NFG) ? Math.max(prev, Math.round(Math.log(life.M / m0) / Math.log(catalogue().nfg.mults.hacking))) : prev
    prev = n
    return n
  })
}

/**
 * THE EXP MODEL ON BN8.1 (in sample): ln(r / ((L + 50) x hacking_exp x hacking_speed x int bonus)) = ln K0 + B ln(home/512),
 * least squares over each life's 10-row exp segments past its first 0.3h at level > 50 — the Red Pill's life
 * (the stack winding down) and the 25-30h stall (no hacking scripts: < 1e6 exp/h) excluded and counted.
 */
export function calibrateExp(b81) {
  const nfg = nfgLevels(b81)
  const pts = []
  let stall = 0
  b81.lives.forEach((life, i) => {
    if (life.augsBefore.includes('The Red Pill')) return
    const st = { ...entryState({ sf: b81.sf, int: life.int }), owned: new Set(life.augsBefore.filter((a) => !SPECIAL.has(a))), nfg: nfg[i] }
    for (const p of life.exp) {
      if (p.t < 0.3 || p.L < 50 || !(p.r > 0)) continue
      // the multipliers at the segment: the life's grafts landed by then
      for (const x of life.midAdds ?? []) if (x.t <= p.t && !SPECIAL.has(x.name)) st.owned.add(x.name)
      const mu = multsOf(st)
      if (p.r * 3600 < 1e6) {
        stall++
        continue
      }
      pts.push({ y: Math.log(p.r / ((p.L + 50) * mu.hacking_exp * mu.hacking_speed * (intBonus(p.int) / intBonus(BN8_CAL.INT_REF)))), x: Math.log(p.home / 512), life: i })
    }
  })
  const n = pts.length
  const mx = pts.reduce((a, p) => a + p.x, 0) / n
  const my = pts.reduce((a, p) => a + p.y, 0) / n
  const sxx = pts.reduce((a, p) => a + (p.x - mx) ** 2, 0)
  const sxy = pts.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0)
  const B = sxx > 0 ? sxy / sxx : 0
  const A = my - B * mx
  const sd = Math.sqrt(pts.reduce((s, p) => s + (p.y - A - B * p.x) ** 2, 0) / Math.max(1, n - 2))
  return { EXP_K0: Math.exp(A), EXP_B: B, sdLn: sd, n, stall }
}

/** The book after `hours` from W0 on a fresh market under kappa x the ledger curve (regime), 0.01h steps. */
export function bookAfter(W0, hours, kappa, reg) {
  let W = W0
  for (let t = 0; t < hours - 1e-9; t += 0.01) W *= Math.exp(kappa * rwAgeRate(W, t + 0.005, reg) * Math.min(0.01, hours - t))
  return W
}
/** kappa such that bookAfter(W0, hours, kappa, reg) = target (bisection in ln kappa). */
export function kappaFor(W0, hours, target, reg) {
  let lo = Math.log(0.05)
  let hi = Math.log(20)
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (bookAfter(W0, hours, Math.exp(mid), reg) < target) lo = mid
    else hi = mid
  }
  return Math.exp((lo + hi) / 2)
}

/**
 * THE TRADER'S BN8 FACTOR (in sample, two endpoints, printed): kappa8(R) = K x (R/256)^RHO through
 *   E1  the life 1.93 -> 8.08h (256GB, pre-4S: the book never reached 3 x the 4S price before it): the planner
 *       bought nothing for 6.1h (CLAUDE.md, the 5.8h stall) and the install liquidated the book — cash peaked at
 *       $6.4e10, the book's value at the end;
 *   E2  the Red Pill's life 49.17 -> 54.20h (16TB, 4S held — bought in the 14h life whose cash reached $4.6e11):
 *       the donation it raised, the life's cash peak ($7.3e11), reached by its end (5.03h).
 * Both are lower bounds on the book (a peak cash sample), so kappa8 is a floor on BN8.1's trader.
 */
export function calibrateTrader(b81) {
  const e1 = b81.lives.find((l) => Math.abs(l.start - 1.93) < 0.05)
  const e2 = b81.lives.find((l) => l.augsBefore.length && l.added.includes('The Red Pill'))
  if (!e1 || !e2) return null
  const k1 = kappaFor(START_MONEY, e1.len, e1.cashMax, 'pre-long')
  const k2 = kappaFor(START_MONEY, e2.len, e2.cashMax, '4S-long')
  const RHO8 = Math.log(k2 / k1) / Math.log(e2.home / e1.home)
  const KAPPA8 = k1 / Math.pow(e1.home / 256, RHO8)
  return { KAPPA8, RHO8, e1: { len: e1.len, home: e1.home, cash: e1.cashMax, kappa: k1 }, e2: { len: e2.len, home: e2.home, cash: e2.cashMax, kappa: k2 } }
}

/** Hours from exp 0 to the exit level at the state's multipliers (the life after the Red Pill). */
export function runClimb(st, cal) {
  const mu = multsOf(st)
  const need = EXIT_LEVEL * catalogue(st.level).m.WorldDaemonDifficulty
  let exp = 0
  let L = 1
  let t = 0
  while (L < need && t < 50) {
    const gf = giftFactor(st, t + 0.005)
    exp += expRate(st, L, cal, mu, gf) * 0.01 * 3600
    L = levelOf(exp, mu.hacking * gf)
    t += 0.01
  }
  return t
}

/**
 * THE REPLAY: BN8.1's own lives (install times, the augmentations and NeuroFlux levels it installed, its home RAM)
 * through this model's money and exp, and the milestones the model then puts where the game put them:
 *   hack2500  the exp model's level crossing 2500 inside the life it happened in;
 *   join      the first moment of a life with 30 installed, level >= 2500 and the book >= $100b;
 *   redPill   the Red Pill's life: the moment the book covers the donation (its Daedalus work counted);
 *   exit      the Red Pill's install + the model's climb to 3000 + what BN8.1 took after its own climb (the stall, replayed).
 * Returns { rows (per life), ms (model), meas (BN8.1) }.
 */
export function replay(b81, cal) {
  const nfg = nfgLevels(b81)
  const rows = []
  const ms = { thirty: b81.milestones.thirty, hack2500: null, join: null, redPill: null, exit: null }
  let fourS = false
  b81.lives.forEach((life, i) => {
    const st = { ...entryState({ sf: b81.sf, int: life.int }), owned: new Set(life.augsBefore.filter((a) => !SPECIAL.has(a))), nfg: nfg[i], home: life.home, fourS, workFavor: life.workFavor ?? 0 }
    const isRP = life.added.includes('The Red Pill')
    const after = life.augsBefore.includes('The Red Pill')
    if (after) {
      const climb = runClimb(st, cal)
      const p = life.exp.find((q) => q.L >= EXIT_LEVEL)
      const measClimb = p ? p.t : null
      ms.exit = (ms.redPill ?? life.start) + climb + (b81.milestones.exit - life.start - (measClimb ?? 0))
      rows.push({ i, start: life.start, len: life.len, home: life.home, after: true, climb, measClimb })
      return
    }
    let h2500 = null
    let joinT = null
    const r = runLife(st, isRP ? 50 : life.len, cal, {
      final: isRP,
      maxH: 50,
      augAt: (life.midAdds ?? []).filter((x) => !SPECIAL.has(x.name)),
      onStep: (s) => {
        if (h2500 === null && s.L >= DAEDALUS.hacking) h2500 = s.t
        if (joinT === null && installedCount(st) >= DAEDALUS.augs && s.L >= DAEDALUS.hacking && s.W >= DAEDALUS.money) joinT = s.t
      },
    })
    fourS = st.fourS
    // THE MONEY CHECK (out of sample for every life but E1/E2): what the batch BN8.1 installed at this life's end cost
    // at the model's own donation (each faction's largest requirement, less the life's work rep) + the home RAM it
    // bought — a lower bound on the book at the install (the stack may have held money idle: bf7ff66, $317b in the final window)
    let spend = null
    const batch = life.added.filter((a) => !SPECIAL.has(a) && a !== NFG)
    if (!isRP && (batch.length || life.added.includes(NFG))) {
      const c = catalogue()
      const items = batch.map((n) => ({ price: (g.Augmentations[n]?.baseCost ?? 0) * c.m.AugmentationMoneyCost, rep: (g.Augmentations[n]?.baseRepRequirement ?? 0) * c.m.AugmentationRepCost, f: (g.Augmentations[n]?.factions ?? [])[0] ?? '?' }))
      const repBy = new Map()
      for (const x of items) repBy.set(x.f, Math.max(repBy.get(x.f) ?? 0, x.rep))
      const bc = batchCost(st, items, repBy, r.workRep, r.mu.faction_rep)
      const next = b81.lives[i + 1]
      let home = 0
      for (let gb = life.homeEnd; next && gb < next.home; gb *= 2) home += ramUpgradeCost(gb, c.m.HomeComputerRamCost)
      spend = { total: bc.total + home, prices: bc.prices, donation: bc.donation, home }
    }
    if (ms.hack2500 === null && h2500 !== null) ms.hack2500 = life.start + h2500
    if (ms.join === null && joinT !== null) ms.join = life.start + joinT
    if (isRP && r.redPillAt !== null) ms.redPill = life.start + r.redPillAt
    rows.push({ i, start: life.start, len: life.len, home: life.home, fourS: st.fourS, W: r.W, cashMax: life.cashMax, spend, Lmodel: r.L, Lmeas: life.Lend, redPillAt: r.redPillAt, joinAt: r.joinAt, nfg: nfg[i], installed: installedCount(st) })
  })
  return { rows, ms, meas: b81.milestones }
}

// ---------------------------------------------------------------------------
// THE GAMEPLAN'S ROUTE: BN8's hours at a lattice state (memoised)
// ---------------------------------------------------------------------------
const ROUTE_MEMO = new Map()
/** BN8 from the state lv (lv(n) = SF level) at intelligence int: { hours, gift, policy, milestones, byGift }. */
export function bn8RouteHours(lv, { int = 0, cal = BN8_CAL, giftWays = null } = {}) {
  const sf = []
  for (let n = 1; n <= 14; n++) if (lv(n) > 0) sf.push([n, lv(n)])
  const key = `${sf.map((p) => p.join('.')).join(',')}|${Math.round(int)}|${cal.KAPPA8}|${cal.RHO8}|${cal.EXP_K0}|${cal.EXP_B}|${giftWays ? giftWays.join('/') : 'auto'}`
  let r = ROUTE_MEMO.get(key)
  if (!r) {
    const level = Math.min(3, lv(8) + 1)
    const b = bestPolicy({ sf, int, level }, cal, { giftWays })
    r = { hours: b.best?.hours ?? Infinity, gift: !!b.best?.gift, policy: b.best?.policy ?? null, milestones: b.best?.milestones ?? null, byGift: Object.fromEntries(Object.entries(b.byGift).map(([k, v]) => [k, v ? { hours: v.hours, policy: v.policy } : null])) }
    ROUTE_MEMO.set(key, r)
  }
  return r
}

// ---------------------------------------------------------------------------
// THE REPORT (CLI)
// ---------------------------------------------------------------------------
/** The milestones' tolerance (the decision it protects: the node order, where BN8's two clears are ~1/3 of the hours left): 15% of the node's elapsed time, at least 2h. */
export const MS_TOL = { rel: 0.15, absH: 2 }
export const msWithin = (model, meas) => model !== null && meas !== null && Math.abs(model - meas) <= Math.max(MS_TOL.absH, MS_TOL.rel * meas)

/** BN8.1's lives: the telemetry's history.jsonl, else the frozen fixture. */
export async function loadBn81({ fixture = false } = {}) {
  if (!fixture) {
    const tel = [process.env.TELEMETRY, path.join(ROOT, '.telemetry'), '/home/tbusby/Repos/bitburner-scripts/.telemetry'].filter(Boolean).find((d) => fs.existsSync(path.join(d, 'history.jsonl')))
    if (tel) {
      const b = await bn8Lives(path.join(tel, 'history.jsonl'))
      if (b) return b
    }
  }
  return JSON.parse(fs.readFileSync(LIVES_FIXTURE, 'utf8'))
}

/** The plan's BN8 entry states (the order BN13.3 -> BN5.2 -> BN5.3 -> BN8.2 -> BN8.3): from today's SFs with BN13.3, BN5.2, BN5.3 done. */
export const PLAN_STATES = {
  'BN8.2': '1.3,2.1,3.3,4.3,5.3,6.3,7.3,8.1,9.3,10.3,11.3,12.1,13.3,14.3',
  'BN8.3': '1.3,2.1,3.3,4.3,5.3,6.3,7.3,8.2,9.3,10.3,11.3,12.1,13.3,14.3',
}
const pairsOfStr = (s) => s.split(',').map((t) => t.split('.').map(Number))

/**
 * THE GIFT IN BN8, PRICED for the live accept (stanekplan.STOCK_GIFT_PRICED): per SF13 level, BN8's exit
 * never accepting vs accepting at the node's start — the same policy search both ways, from the plan's
 * BN8.2 entry with SF13 at that level (every other Source-File as BN8.2's; SF8 does nothing inside BN8).
 * Returns { '8|l13': [withoutH, withH] }.
 */
export function giftTable({ int = 156, cal = BN8_CAL } = {}) {
  const out = {}
  for (const l13 of [1, 2, 3]) {
    const sf = pairsOfStr(PLAN_STATES['BN8.2']).map(([n, l]) => [n, n === 13 ? l13 : l])
    const b = bestPolicy({ sf, int, level: 2 }, cal, { giftWays: [false, true] })
    out[`8|${l13}`] = [+(b.byGift.never?.hours ?? Infinity).toFixed(3), +(b.byGift.accept?.hours ?? Infinity).toFixed(3)]
  }
  return out
}

async function main() {
  const has = (k) => process.argv.includes(`--${k}`)
  const argOf = (k) => {
    const i = process.argv.indexOf(`--${k}`)
    return i > 0 ? process.argv[i + 1] : null
  }
  if (has('gift-table')) {
    console.log(`STOCK_GIFT_PRICED (stanekplan.js) from bn8.mjs giftTable(): ${JSON.stringify(giftTable())}`)
    return
  }
  const b81 = await loadBn81({ fixture: has('fixture') })
  if (has('write-fixture')) {
    fs.writeFileSync(LIVES_FIXTURE, JSON.stringify({ note: `tools/sim/gameplan/bn8.mjs --write-fixture ${new Date().toISOString()}: BN8.1's lives from history.jsonl`, ...b81 }))
    console.log(`wrote ${LIVES_FIXTURE} (${b81.lives.length} lives)`)
  }
  const fmt = (x) => (x === null || x === undefined ? '-' : typeof x === 'number' ? (Math.abs(x) >= 1e4 ? x.toExponential(2) : x.toFixed(2)) : String(x))
  console.log(`BITNODE 8 — the stock-only exit model (tools/sim/gameplan/bn8.mjs). BN8.1: ${b81.lives.length} lives, SF ${b81.sf.map((p) => p.join('.')).join(',')}, int ${b81.int}`)
  // 1. the exp model
  const ex = calibrateExp(b81)
  console.log(`\nEXP MODEL (MEASURED, BN8.1 in sample): exp/s = K0 x (home/512GB)^B x (L+50) x hacking_exp x hacking_speed x int bonus`)
  console.log(`  fit   K0 ${ex.EXP_K0.toFixed(3)}  B ${ex.EXP_B.toFixed(3)}  (${ex.n} segments of 10 rows; sd ${ex.sdLn.toFixed(2)} in ln per segment; ${ex.stall} stall segments excluded)`)
  console.log(`  COMMITTED (BN8_CAL) K0 ${BN8_CAL.EXP_K0}  B ${BN8_CAL.EXP_B}`)
  // 2. the trader
  const tr = calibrateTrader(b81)
  console.log(`\nTHE TRADER IN BN8 (MEASURED, two endpoints, in sample): kappa8(home) = K x (home/256GB)^RHO on traderw.rwAgeRate (the ledger's r(W, age), rwage.mjs)`)
  if (tr) {
    console.log(`  E1 the ${tr.e1.len.toFixed(2)}h life on ${tr.e1.home}GB (pre-4S): $250m -> $${tr.e1.cash.toExponential(2)} needs kappa ${tr.e1.kappa.toFixed(3)}`)
    console.log(`  E2 the Red Pill's ${tr.e2.len.toFixed(2)}h life on ${tr.e2.home}GB (4S): $250m -> $${tr.e2.cash.toExponential(2)} needs kappa ${tr.e2.kappa.toFixed(3)}`)
    console.log(`  fit   K ${tr.KAPPA8.toFixed(3)}  RHO ${tr.RHO8.toFixed(3)}   COMMITTED K ${BN8_CAL.KAPPA8}  RHO ${BN8_CAL.RHO8}`)
  } else console.log('  NOT RUN: the endpoint lives are not in this history')
  // 3. the replay
  const rp = replay(b81, BN8_CAL)
  console.log(`\nTHE REPLAY — BN8.1's own lives (install times, installed augmentations, NeuroFlux, home) through the model's money and exp`)
  console.log('  life start   len    home   NFG  inst  4S   model book at end   cash peak (measured)   its install cost (lower bound)   book/cost   level end model / measured')
  for (const r of rp.rows) {
    if (r.after) console.log(`  ${fmt(r.start).padStart(9)} ${fmt(r.len).padStart(6)} ${String(r.home).padStart(7)}   after The Red Pill: the climb to ${EXIT_LEVEL} model ${r.climb.toFixed(2)}h, measured ${r.measClimb === null ? '-' : r.measClimb.toFixed(2) + 'h (first 10-row segment past it)'}`)
    else console.log(`  ${fmt(r.start).padStart(9)} ${fmt(r.len).padStart(6)} ${String(r.home).padStart(7)} ${String(r.nfg).padStart(5)} ${String(r.installed).padStart(5)}  ${r.fourS ? 'y' : 'n'}   ${fmt(r.W).padStart(16)}   ${fmt(r.cashMax).padStart(18)}   ${r.spend ? fmt(r.spend.total).padStart(26) : '-'.padStart(26)}   ${r.spend ? (r.W / r.spend.total).toFixed(2).padStart(9) : '-'.padStart(9)}        ${r.Lmodel.toFixed(0).padStart(6)} / ${r.Lmeas}${r.redPillAt !== null && r.redPillAt !== undefined ? `   the Red Pill's money at ${r.redPillAt.toFixed(2)}h of ${r.len.toFixed(2)}h` : ''}`)
  }
  const under = rp.rows.filter((r) => r.spend && r.W < r.spend.total)
  console.log(`  MONEY: the model's book covers the cost of every batch BN8.1 installed: ${under.length ? `FAIL — short at ${under.map((r) => `${r.start.toFixed(2)}h (x${(r.W / r.spend.total).toFixed(2)})`).join(', ')}` : 'PASS'} (a lower bound: it says the model is not too poor, not that it is not too rich)`)
  console.log(`  MILESTONES (node hours; tolerance ${100 * MS_TOL.rel}% of the measured time, at least ${MS_TOL.absH}h):`)
  let fails = 0
  for (const k of ['thirty', 'hack2500', 'join', 'redPill', 'exit']) {
    const ok = msWithin(rp.ms[k], rp.meas[k])
    if (!ok) fails++
    console.log(`    ${k.padEnd(9)} measured ${fmt(rp.meas[k]).padStart(6)}h   model ${fmt(rp.ms[k]).padStart(6)}h   ${rp.ms[k] !== null && rp.meas[k] !== null ? `${(rp.ms[k] - rp.meas[k] >= 0 ? '+' : '') + (rp.ms[k] - rp.meas[k]).toFixed(2)}h` : ''}   ${ok ? 'PASS' : 'FAIL'}${k === 'thirty' ? ' (replayed: the installs are BN8.1\'s own)' : ''}`)
  }
  console.log(`  REPLAY ${fails ? `FAIL (${fails})` : 'PASS'}`)
  // 4. the policy from BN8.1's entry
  const p81 = bestPolicy({ sf: b81.sf, int: b81.int, level: 1 }, BN8_CAL)
  const stalls = 5.8 + 5.0 + 1.8
  console.log(`\nTHE POLICY SEARCH FROM BN8.1's ENTRY (life length x lives before the final; cheapest-first purchases): ${fmt(p81.best?.hours)}h at ${p81.best ? `${p81.best.policy.lives} lives of ${p81.best.policy.lifeH}h` : '-'} — BN8.1 measured ${b81.milestones.exit.toFixed(1)}h, ${(b81.milestones.exit - stalls).toFixed(1)}h net of its recorded stalls (5.8h no-purchase life, ~5h frozen exp 25-30h, 1.8h exit): a plausibility line, not a calibration`)
  if (p81.best) console.log(`  milestones: 30 installed ${fmt(p81.best.milestones.thirty)}h, 4S ${fmt(p81.best.milestones.fourS)}h, hacking 2500 ${fmt(p81.best.milestones.hack2500)}h, Daedalus ${fmt(p81.best.milestones.join)}h, The Red Pill ${fmt(p81.best.milestones.redPill)}h, exit ${fmt(p81.best.milestones.exit)}h`)
  // 5. the plan's states
  const states = argOf('state') ? { state: argOf('state') } : PLAN_STATES
  const int = Number(argOf('int') ?? 156)
  for (const [label, s] of Object.entries(states)) {
    const sf = pairsOfStr(s)
    const level = Math.min(3, (new Map(sf).get(8) ?? 0) + 1)
    const b = bestPolicy({ sf, int, level }, BN8_CAL)
    console.log(`\n${label} from ${s} (int ${int}):`)
    if (b.best) {
      const tr = runNode(entryState({ sf, int, level, gift: b.best.gift }), b.best.policy, BN8_CAL, { trace: true })
      console.log(`  the best policy's lives (gift ${b.best.gift ? 'accepted' : 'never'}):`)
      for (const l of tr.lives) console.log(l.final ? `    final life ${l.len.toFixed(2)}h: Daedalus joined at ${l.joinAt.toFixed(2)}h, The Red Pill's money at ${l.len.toFixed(2)}h, level ${l.L.toFixed(0)}; climb ${l.climbH.toFixed(2)}h` : `    life to ${l.at.toFixed(1)}h (${l.len}h): book $${l.W.toExponential(2)}, level ${l.L.toFixed(0)}, bought ${l.bought} + ${l.nfg} NFG -> ${l.installed} installed, home ${l.home >= 1024 ? l.home / 1024 + 'TB' : l.home + 'GB'}, 4S ${l.fourS ? 'y' : 'n'}`)
    }
    for (const [k, v] of Object.entries(b.byGift)) console.log(`  gift ${k.padEnd(6)} ${v ? `${v.hours.toFixed(1)}h: ${v.policy.lives} lives of ${v.policy.lifeH}h, then the final life ${v.finalLifeH.toFixed(1)}h, climb ${v.climbH.toFixed(2)}h; 30 installed ${fmt(v.milestones.thirty)}h, 4S ${fmt(v.milestones.fourS)}h, hacking 2500 ${fmt(v.milestones.hack2500)}h, Daedalus ${fmt(v.milestones.join)}h, The Red Pill ${fmt(v.milestones.redPill)}h` : 'no policy exits'}`)
    // sensitivity: the trader's factor at its two endpoints' spread
    for (const f of [0.8, 1.25]) {
      const bs = bestPolicy({ sf, int, level }, { ...BN8_CAL, KAPPA8: BN8_CAL.KAPPA8 * f })
      console.log(`  kappa8 x${f}: ${fmt(bs.best?.hours)}h`)
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
  process.exit(0)
}
