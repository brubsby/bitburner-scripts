// BITNODE 8's START, PRICED BY THE LIVE EXIT MODEL — and set against the gameplan's (bn8.mjs).
//
//   node tools/sim/entry/dryrun.mjs --chain 8.2 --save S --keep-tel DIR     the live-shaped inputs, made by the game
//   node tools/sim/gameplan/bn8live.mjs --tel DIR/BN8.2/entry [--json F]  the live model on them, vs the gameplan
//
// WHY (backlog 0g, 2026-10-24): the live exit's life-length model (lifeplan.lifeTable -> lifeInputsOf ->
// exitplan.bestExitPolicy, what progress.js runs once a faction is joined) bought every reputation point by
// faction work, where in BitNode 8 (FavorToDonateToFaction 0, BitNode.tsx:776) every faction takes donations
// from favour 0 (donation.ts:16-18, Singularity.ts:921) — so a life bought ~one augmentation and the exit came
// out at ~3-4x the gameplan's. This prints the live model's exit at BN8.2's start beside the gameplan's.
//
// THE LIVE SIDE is this checkout's own code on the dry-run's inputs (exitinputs.txt: the entry pass's exit
// inputs — trader, income, the donation terms `repDonate`), the catalogue from the entry's snapshots at the
// factions the gameplan's lives join (bn8.mjs FACTION_BARS + the city group with the most hacking value: a
// fresh node has joined nothing, and the purchase model prices the node's factions — progress.js
// nodeFactionsOf), favour 0, the cadence posterior from the dry-run's lifetimes.txt with the purchase model's
// prior at the provisional length (progress.js exitInputsGen). Each life length L in LIFE_GRID is priced by
// bestExitPolicy (point inputs, no draws: the plan's decideLifeLength takes the same options with draws).
// THE GAMEPLAN SIDE is bn8.mjs bestPolicy at PLAN_STATES['BN8.2'] (the gift both ways).
// TOLERANCE (stated, the decision it protects — the node order, where BN8.2 is ~1/3 of the hours left): the
// live exit within 25% of the gameplan's best or 5h. The two models are not the same model — the live one
// prices hacking-multiplier growth per life and the exit's legs; the gameplan's Daedalus' 30, the 4S buy and
// the book life by life — so agreement is the check that neither is off by the 3-4x 0g found, not identity.
// NOT CALIBRATED by itself: both sides are models; bn8.mjs carries BN8.1's replay.

import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'

const lp = await import('../../../lifeplan.js')
const { bestExitPolicy, installCadence } = await import('../../../exitplan.js')
const { bitNodeMults } = await import('../../../bitNodeMultipliers.js')
const { countExitAt, paddedLadder, lifeInputs, ticketLadder } = await import('../../../countexit.js')

const argv = process.argv.slice(2)
const argOf = (k) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null
}

/** The live-shaped inputs and snapshots a dry-run kept (--keep-tel DIR/BN8.2/entry). */
export function loadEntry(dir) {
  const rd = (f) => {
    const p = path.join(dir, f)
    return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
  }
  const ei = rd('exitinputs.txt')
  if (!ei?.inputs) throw new Error(`bn8live: no exitinputs.txt inputs in ${dir}`)
  return {
    base: ei.inputs,
    catalog: rd('snap-catalog.txt')?.data?.augs ?? {},
    price: rd('snap-augprice.txt')?.data?.price ?? {},
    repReq: rd('snap-augprice.txt')?.data?.repReq ?? {},
    stats: rd('snap-augstats.txt')?.data?.stats ?? {},
    prereq: rd('snap-prereq.txt')?.data?.prereq ?? {},
    owned: rd('snap-owned.txt')?.data?.owned ?? [],
    lifetimes: rd('lifetimes.txt') ?? [],
    earnings: rd('earnings.txt'),
  }
}

/**
 * The live model's exit at the entry: per L, the life table's row, the posterior's gain and
 * bestExitPolicy's hours and installs. `donate` overrides the inputs' terms (null: the grind — the old model).
 */
export function liveExit(entry, { joined, donate = entry.base.repDonate ?? null, grid = lp.LIFE_GRID, node = 8 } = {}) {
  const base = entry.base
  const cat = lp.catalogueOf({ catalog: entry.catalog, price: entry.price, repReq: entry.repReq, stats: entry.stats, prereq: entry.prereq, owned: entry.owned, joined })
  const favor = Object.fromEntries(joined.map((f) => [f, 0]))
  const rph = base.repPerSec * 3600
  const ms = lp.moneyScaleOf(entry.earnings, node, base)
  const table = lp.lifeTable({ inputs: base, catalogue: cat, favor, owned: entry.owned, repPerHour0: rph, moneyScale: ms.scale, grid, donate })
  const buying = (table ?? []).filter((r) => r.lnMean > 0)
  if (!buying.length) return { best: null, rows: [], why: 'no life length buys anything' }
  // The provisional length (progress.js provisionalLifeL): nearest the measured cycle among those that buy.
  const target = base.cycleHours > 0 ? base.cycleHours : 6
  const Lc = buying.reduce((a, r) => (Math.abs(Math.log(r.L / target)) < Math.abs(Math.log(a.L / target)) ? r : a), buying[0]).L
  const row0 = table.find((r) => r.L === Lc)
  const covOf = (n) => {
    const m = bitNodeMults(n)
    return m ? Math.log(m.AugmentationMoneyCost * m.AugmentationRepCost) : 0
  }
  const post = installCadence(entry.lifetimes, node, { covOf, modelPrior: { lnPerHour: row0.lnMean / Lc, cycleHours: Lc } })?.posterior ?? null
  const rec = { table, moneyScale: ms.scale, moneyCalibration: ms.why }
  const count = countOf(entry, joined, node)
  const rows = []
  for (const row of table) {
    const x = lp.lifeInputsOf(base, rec, row.L, post)
    const r = x ? bestExitPolicy(x) : null
    const H = r && !r.degenerate ? r.best?.hours ?? null : null
    // THE COUNT-AWARE EXIT (countexit, what the plan's committed trajectory runs while Daedalus' count is
    // short: plan.trajectoryGenOf with ctx.count): n tickets an install at this life length, n searched.
    let cb = null
    if (x && count) {
      // the first install's wait (the install decision's waitH) searched with n: at $250m nothing is affordable at once
      for (const w of WAITS) {
        for (const n of [...new Set([1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, count.short])].filter((k) => k >= 1 && k <= count.short)) {
          // countexit.countExitFixed's body, kept whole so the installs come back with the hours
          const at = countExitAt(bestExitPolicy, lifeInputs(x, row.L), count.short, paddedLadder(count).ladder, Math.min(n, count.short), w, count.nfg ?? null)
          const h = at.hours
          if (Number.isFinite(h) && !at.degenerate && (!cb || h < cb.H)) cb = { H: +h.toFixed(2), n, waitH: w, installs: at.installsFirst, countInstalls: at.countInstalls }
        }
      }
    }
    rows.push({ L: row.L, money: row.money, first: row.first, firstNfg: row.firstNfg, modelGain: row.gain, gain: x ? +x.multGainPerCycle.toFixed(4) : null, H: Number.isFinite(H) ? +H.toFixed(2) : null, installs: r?.best?.installsFirst ?? null, countH: cb?.H ?? null, countN: cb?.n ?? null, countWaitH: cb?.waitH ?? null, countInstalls: cb?.installs ?? null, countPhase: cb?.countInstalls ?? null })
  }
  const best = rows.filter((r) => r.H !== null).reduce((a, r) => (a === null || r.H < a.H ? r : a), null)
  const bestCount = rows.filter((r) => r.countH !== null).reduce((a, r) => (a === null || r.countH < a.countH ? r : a), null)
  return { best, bestCount, rows, Lc, moneyScale: ms.scale, donate, count: count ? { short: count.short, tickets: count.ladder.length } : null }
}

/**
 * The count model (progress.js countModelOf) at the entry: Daedalus' DaedalusAugsRequirement less the distinct
 * installed, the ticket ladder from the joined factions' offers with this life's reputation donated (favour 0,
 * FavorToDonateToFaction 0) and a later life's whole requirement donated, NeuroFlux at its price. Null where
 * the node has no count gate or no donation terms.
 */
export function countOf(entry, joined, node = 8) {
  const m = bitNodeMults(node)
  const d = entry.base.repDonate
  if (!(m?.DaedalusAugsRequirement > 0) || !d) return null
  const short = m.DaedalusAugsRequirement - entry.owned.length
  if (!(short > 0)) return null
  const offers = []
  for (const f of joined) {
    if ((d.no ?? []).includes(f)) continue
    for (const name of entry.catalog[f] ?? []) {
      if (!(entry.price[name] > 0)) continue
      offers.push({ name, faction: f, baseCost: entry.price[name], repReq: entry.repReq[name] ?? 0, mults: entry.stats[name] ?? {}, factionRep: 0, donationCost: (entry.repReq[name] ?? 0) * d.perRep })
    }
  }
  const ladder = ticketLadder(offers, new Set(entry.owned), { laterDonation: (o) => (o.repReq > 0 ? o.repReq * d.perRep : null) })
  const nfg = entry.price['NeuroFlux Governor'] > 0 ? { price: entry.price['NeuroFlux Governor'], level: 0 } : null
  return { short, ladder, nfg }
}

/** The factions the gameplan's lives join (bn8.mjs): the bars, and the city group with the most hacking value unowned. */
export function bn8Joined(entry, FACTION_BARS, CITY_GROUPS) {
  const owned = new Set(entry.owned)
  const value = (f) => (entry.catalog[f] ?? []).filter((a) => !owned.has(a)).reduce((s, a) => s + Math.log(entry.stats[a]?.hacking ?? 1), 0)
  const grp = CITY_GROUPS.reduce((a, g) => (g.reduce((s, f) => s + value(f), 0) > a.reduce((s, f) => s + value(f), 0) ? g : a), CITY_GROUPS[0])
  return [...FACTION_BARS.map((f) => f.name), ...grp]
}

/** The first install's waits searched (hours from the entry). */
export const WAITS = [0, 0.5, 1, 2, 3, 4, 6, 8, 12]
export const AGREE_TOL = { rel: 0.25, absH: 5 }

async function main() {
  const dir = argOf('tel')
  if (!dir) {
    console.error('usage: node tools/sim/gameplan/bn8live.mjs --tel <dry-run keep-tel>/BN8.2/entry [--json F]')
    process.exit(2)
  }
  const entry = loadEntry(dir)
  const bn8 = await import('./bn8.mjs')
  const joined = bn8Joined(entry, bn8.FACTION_BARS, bn8.CITY_GROUPS)
  const fmtRows = (rows) => rows.map((r) => `    L ${String(r.L).padStart(4)}h  money $${(r.money ?? 0).toExponential(2)}  first life ${r.first} augs + ${r.firstNfg} NFG  model x${r.modelGain}  posterior x${r.gain ?? '-'}  exit ${r.H ?? '-'}h on ${r.installs ?? '-'} installs  count-aware ${r.countH ?? '-'}h (${r.countInstalls ?? '-'} installs, ${r.countPhase ?? '-'} to the count, n ${r.countN ?? '-'}, the first at ${r.countWaitH ?? '-'}h)`).join('\n')
  const live = liveExit(entry, { joined })
  const grind = liveExit(entry, { joined, donate: null })
  console.log(`BN8.2's START — the live exit model (lifeplan + exitplan) on the dry-run's inputs (${dir})`)
  console.log(`  factions priced: ${joined.join(', ')}; donation terms ${JSON.stringify(entry.base.repDonate ?? null)}`)
  console.log(`  REPUTATION GROUND (no donations — the model before 0g):\n${fmtRows(grind.rows)}`)
  console.log(`  REPUTATION DONATED where open (the live model):\n${fmtRows(live.rows)}`)
  const gp = bn8.bestPolicy({ sf: bn8.PLAN_STATES['BN8.2'].split(',').map((t) => t.split('.').map(Number)), int: Number(argOf('int') ?? 156), level: 2 })
  const g = gp.best
  console.log(`  GAMEPLAN (bn8.mjs bestPolicy, ${bn8.PLAN_STATES['BN8.2']}): ${g ? `${g.hours.toFixed(1)}h, ${g.policy.lives} lives of ${g.policy.lifeH}h then the final life (gift ${g.gift ? 'accepted' : 'never'})` : 'no policy exits'}`)
  const lb = live.best
  const gb = grind.best
  const cnt = (b) => (b ? `; count-aware ${b.countH}h: the first install at ${b.countWaitH}h, then ${b.countInstalls - 1} lives of ${b.L}h (${b.countPhase} installs to the count, up to ${b.countN} tickets each), then the final window` : '; count-aware unpriced')
  console.log(`  LIVE, ground:  ${gb ? `${gb.H}h, ${gb.installs} installs of ${gb.L}h lives` : 'unpriced'}${cnt(grind.bestCount)}`)
  console.log(`  LIVE, donated: ${lb ? `${lb.H}h, ${lb.installs} installs of ${lb.L}h lives` : 'unpriced'}${cnt(live.bestCount)}  (count short ${live.count?.short ?? '-'}, ${live.count?.tickets ?? '-'} tickets)`)
  // LIKE FOR LIKE: the live inputs carry no gift (not accepted at the entry), so the gameplan's never-accepting
  // arm; its best (the gift accepted) printed beside it. The live exit is the count-aware one: the plan's
  // committed trajectory while Daedalus' count is short (plan.trajectoryGenOf, ctx.count).
  const never = gp.byGift?.never ?? null
  const ref = never?.hours ?? g?.hours ?? null
  const lc = live.bestCount
  let ok = null
  if (lc && ref !== null) {
    const err = lc.countH - ref
    ok = Math.abs(err) <= Math.max(AGREE_TOL.absH, AGREE_TOL.rel * ref)
    console.log(`  CHECK live (count-aware) ${lc.countH}h vs gameplan ${ref.toFixed(1)}h (gift never${g ? `; best ${g.hours.toFixed(1)}h gift ${g.gift ? 'accepted' : 'never'}` : ''}): ${err >= 0 ? '+' : ''}${err.toFixed(1)}h (${((100 * err) / ref).toFixed(0)}%), tolerance ${100 * AGREE_TOL.rel}% or ${AGREE_TOL.absH}h: ${ok ? 'PASS' : 'FAIL'}`)
  } else console.log(`  CHECK live vs gameplan: NOT RUN (${lc ? 'the gameplan does not exit' : 'the count-aware live exit is unpriced'})`)
  if (argOf('json')) fs.writeFileSync(argOf('json'), JSON.stringify({ at: new Date().toISOString(), dir, joined, live, grind, gameplan: g ? { hours: g.hours, policy: g.policy, gift: g.gift, never: never ? { hours: never.hours, policy: never.policy } : null } : null, ok }, null, 1))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
  process.exit(0)
}
