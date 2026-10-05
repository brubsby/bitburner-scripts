// [BL] THE BLADE ARM UNDER THE 128GB TIER: the route's own home purchase,
// never bb-lite forever — live BN14.2, 2026-10-05 23:11Z.
//
// Home had just reached 64GB; bb-lite had joined the division (rank 23,
// combat ~250, Go Tetrads x2.46). decisions.bladeRoute priced 'blade' at
// pFeasible 0 — every draw and all six members unpriced — and took 'hack'
// at a 999h mean (q50 447h); progress.js then held the work slot for nobody.
// The cause: bbliteplan.leanUntilOf -> Infinity (bb-lite on the record,
// home under FULL_TIER, installgate spendExit.home not approved — it was
// "unpriced: the spend is not affordable by the install", priced on the
// HACKING exit), so the blade start ran bb-lite's lean policy (no Raid, team
// 0, one city) for the whole horizon: rank 1634 of Typhoon's 2500 in 400h,
// 0/21 black ops. The full daemon from the same start: ~56h. The 128GB block
// cost $31.86m against ~$13m of wealth and ~$25m/h of income. And the one
// verdict that could approve the block (progress.js bladeHomeVerdictOf) runs
// only on the blade route, with a without-arm that is that same unpriced
// lean-forever trajectory: no route without the purchase, no purchase
// without the route.
//
// Fixture: tools/test/fixture-bn14-bladelean-2311.json, captured live
// (/tel/bladeburner.txt from bb-lite, the save's skills and exp, plan.txt's
// bladeRoute incl. the 23:11Z record, installgate spendExit.home, homeup.txt,
// boot.txt, progress.txt income, the fleet's large hosts).
//
//   BL1 BEFORE, AS CAPTURED: leanUntilOf -> Infinity, and the blade start on it does not finish
//       inside the horizon in any member (the published pFeasible 0)
//   BL2 AFTER: homeplan.routeFullAtOf prices the route's own purchase — the 64 -> 128GB block at
//       homecost's price (homeup.txt's $31.86m), bought when wealth + income reach it — and every
//       member of the blade start on it finishes, the mean far under the hack arm's published point
//   BL3 THE ROUTE'S HOME VERDICT: the without-arm (bb-lite forever) is censored at the horizon, not
//       unpriced, so the verdict on the route's start is a finite deltaH that buys the tier
//   BL4 routeFullAtOf's edges: at the tier -> the placement; never affordable -> Infinity (as before)
//   BL5 WIRING: progress.js replaces an Infinity lean phase with routeFullAtOf on the route's money,
//       and publishes it on decisions.bladeRoute.lean

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const HP = await import('homeplan.js')
const BB = await import('bbplan.js')
const BN = await import('bitNodeMultipliers.js')
const LP = await import('bbliteplan.js')
const HC = await import('homecost.js')
const P = await import('plan.js')
const { drain } = await import('coop.js')

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn14-bladelean-2311.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const fin = (x) => typeof x === 'number' && isFinite(x)
const f2 = (x) => (fin(x) ? x.toFixed(2) : String(x))
const n14 = BN.bitNodeMults(14)
const NOW = Date.parse(F.captured)
// The player's total LEVEL multipliers solved from (level, exp) — the save
// digest carries no mults (tools/sim/bb14.mjs solvedMults): the middle of
// the interval floor() leaves. Exp multipliers 1 (no augmentation installed
// this node; Source-File exp bonuses not in the digest — named).
const LV = ['hacking', 'strength', 'defense', 'dexterity', 'agility', 'charisma']
const mults = Object.fromEntries(LV.map((s) => [s, (F.player.skills[s] + 0.5) / (32 * Math.log((F.player.exp[s] ?? 0) + 534.6) - 200)]))
const person = { skills: { ...F.player.skills }, exp: { ...F.player.exp }, mults }
const cal = F.bladeRoute.calibration
const go = F.bladeRoute.start.goCombat
// THE ONE BUILDER as progress.js bladeRouteOf calls it, at a given lean phase.
const startAt = (leanUntilH, spec = null) =>
  BB.bladeStartOf({ tel: F.bladeburner, person, sleeves: F.bladeRoute.sleeves, gymExpPerSec: F.bladeRoute.start.gymExpPerSec, bnRank: n14.BladeburnerRank, skillCostMult: n14.BladeburnerSkillCost, install: BB.bladeInstallOfSpec(spec), simulacrum: false, rankScale: cal.rank.k, successScale: cal.success.k, rankSdLn: cal.rank.sdLn, successSdLn: cal.success.sdLn, leanUntilH, goCombat: { effect: go.effect, nodes: go.nodes, perHour: go.perHour, goPower: go.goPower, sf14: go.sf14 }, now: NOW })
const meanOf = (s0) => drain(BB.bladeExitMeanGen(s0, { Q: BB.BLADE_ENSEMBLE.Q }))
const homeRam = Math.max(F.homeup.homeRam ?? 0, F.boot.homeRam ?? 0)
const routeOf = () => HP.routeFullAtOf({ homeRam, tier: LP.FULL_TIER, nodeRamCost: n14.HomeComputerRamCost, wealth: F.wealth, perSec: F.income.lifePerSec, placeH: LP.LEAN_PLACE_H })

export async function run() {
  const checks = []
  const pub = F.bladeRoute.published2311
  const hackPub = pub.options.find((o) => o.key === 'hack')

  // ---- BL1 ----------------------------------------------------------------
  {
    const c = new Check('BL1', 'before, as captured: bb-lite forever under the tier — the blade start finishes in no member (published pFeasible 0)')
    const lean = LP.leanUntilOf(F.bladeburner, homeRam, { spendHome: { ...F.spendExitHome, at: F.captured, lastAugReset: F.spendExitLastAugReset }, lastAugReset: F.bladeburner.lastAugReset, now: NOW })
    c.examined(2)
    if (pub.options.find((o) => o.key === 'blade')?.pFeasible !== 0) c.fail('fixture: the 23:11Z blade option must be the pFeasible-0 record it was captured for')
    if (lean !== Infinity) c.fail(`leanUntilOf on the captured state is ${lean}, not Infinity — the fixture no longer reproduces the live shape`)
    const m = meanOf(startAt(lean))
    c.examined(m.members.length)
    c.note(`bb-lite forever: members ${JSON.stringify(m.members)} (${m.unfinished} of ${m.members.length} unfinished); one member: ${BB.bladeExit(startAt(lean)).why}`)
    if (m.hours !== null || m.unfinished !== m.members.length) c.fail('the lean-forever start now finishes — the live failure is not reproduced', JSON.stringify(m.members))
    checks.push(c)
  }

  // ---- BL2 ----------------------------------------------------------------
  {
    const c = new Check('BL2', "after: the blade arm carries the route's own 128GB purchase, and every member finishes far under the hack arm")
    const r = routeOf()
    c.examined(3)
    c.note(r.why)
    if (Math.abs(r.cost / F.homeup.nextCost - 1) > 1e-3) c.fail(`the route's block price $${f2(r.cost / 1e6)}m is not homeup's next RAM block $${f2(F.homeup.nextCost / 1e6)}m`)
    const expect = (F.homeup.nextCost - F.wealth) / F.income.lifePerSec / 3600
    if (!(Math.abs(r.buyAtH - expect) < 1e-3)) c.fail(`buyAtH ${f2(r.buyAtH)}h is not (cost - wealth) / income = ${f2(expect)}h`)
    if (!(Math.abs(r.untilH - (r.buyAtH + LP.LEAN_PLACE_H)) < 1e-9)) c.fail('the lean phase does not end at the purchase plus the placement')
    const m = meanOf(startAt(r.untilH))
    const full = meanOf(startAt(null))
    c.examined(m.members.length + 1)
    c.note(`blade members ${JSON.stringify(m.members.map((h) => (fin(h) ? +h.toFixed(2) : h)))} -> mean ${f2(m.hours)}h (sd ${f2(m.sdH)}h); the full daemon from now ${f2(full.hours)}h; the hack arm as published: point ${hackPub.pointH}h, mean ${hackPub.meanH}h, q10 ${hackPub.q10}h, q50 ${hackPub.q50}h`)
    if (m.unfinished) c.fail(`${m.unfinished} member(s) still unfinished with the route's purchase`, JSON.stringify(m.members))
    if (!(m.hours >= full.hours)) c.fail("the arm with bb-lite until the purchase is faster than the full daemon from now — the lean phase is not in it")
    if (!(m.hours < hackPub.q10)) c.fail(`the blade mean ${f2(m.hours)}h is not under even the hack arm's published q10 ${hackPub.q10}h`)
    checks.push(c)
  }

  // ---- BL3 ----------------------------------------------------------------
  {
    const c = new Check('BL3', "the route's home verdict: bb-lite forever is censored at the horizon, so the tier is priced and bought")
    const r = routeOf()
    const unlocks = HP.tierUnlocksOf(F.boot, homeRam)
    c.examined(1)
    if (!unlocks?.unlocked?.some((u) => u.script === 'bladeburner.js')) c.fail("fixture: boot.txt's next tier does not admit bladeburner.js", JSON.stringify(unlocks))
    const big = F.hosts.find((h) => h.host !== 'home')
    const fullHost = { ok: big.maxRam >= LP.FULL_GB, why: `${big.host} ${big.maxRam}GB` }
    const buy = HP.homeBuyAtOf({ cost: F.homeup.nextCost, moneyAt: (h) => F.wealth + F.income.lifePerSec * 3600 * h, installAtH: Infinity, post: null, maxH: 400 })
    const v = drain(HP.bladeHomeExitGen({ startFor: () => startAt(r.untilH), spec: null, cost: F.homeup.nextCost, buy, unlocks, daemonNow: 'bb-lite', fullHost, go: null, maxH: 400 }))
    c.examined(3)
    c.note(`verdict: withH ${f2(v.withH)}h, withoutH ${f2(v.withoutH)}h, deltaH ${f2(v.deltaH)}h${v.censored ? ` — ${v.censored.why}` : ''}${v.why ? ` (${v.why})` : ''}`)
    if (!fin(v.deltaH)) c.fail('the verdict is unpriced — the purchase the route depends on can never be approved', v.why)
    else {
      if (!v.censored) c.fail('the without-arm (bb-lite forever) finished — the censoring is untested here')
      if (!(v.deltaH < 0)) c.fail('the tier does not shorten the exit')
      const pd = P.decideSpend({ deltaH: v.deltaH, withoutH: v.withoutH, si: null })
      c.examined(1)
      c.note(`decideSpend: ${pd?.why}`)
      if (!pd?.buy) c.fail('decideSpend holds the tier the blade arm is priced on')
    }
    checks.push(c)
  }

  // ---- BL4 ----------------------------------------------------------------
  {
    const c = new Check('BL4', "routeFullAtOf's edges: at the tier the placement; unaffordable inside the horizon -> Infinity; two blocks summed")
    const at = HP.routeFullAtOf({ homeRam: 128, tier: 128, nodeRamCost: 1, wealth: 0, perSec: 0, placeH: 0.25 })
    const never = HP.routeFullAtOf({ homeRam: 64, tier: 128, nodeRamCost: 1, wealth: 0, perSec: 0, placeH: 0.25 })
    const two = HP.routeFullAtOf({ homeRam: 32, tier: 128, nodeRamCost: 1, wealth: 1e12, perSec: 0, placeH: 0.25 })
    const unread = HP.routeFullAtOf({ homeRam: undefined, tier: 128, wealth: 1e12, perSec: 1, placeH: 0.25 })
    c.examined(4)
    if (at.untilH !== 0.25) c.fail('at the tier: not the placement', JSON.stringify(at))
    if (never.untilH !== Infinity) c.fail('no money and no income: the lean phase must never end', JSON.stringify(never))
    if (Math.abs(two.cost - (HC.ramUpgradeCost(32, 1) + HC.ramUpgradeCost(64, 1))) > 1e-6 || two.buyAtH !== 0) c.fail('32 -> 128GB is not the two blocks, bought now', JSON.stringify(two))
    if (unread.untilH !== Infinity) c.fail('home RAM unread: must not invent a purchase', JSON.stringify(unread))
    checks.push(c)
  }

  // ---- BL5 ----------------------------------------------------------------
  {
    const c = new Check('BL5', "wiring: progress.js puts the route's own purchase in the blade start where no purchase is approved, and publishes it")
    const pr = SRC('progress.js')
    c.examined(3)
    if (!/leanUntilH === Infinity \? routeFullAtOf\(\{ homeRam: homeRamNow, tier: FULL_TIER, nodeRamCost: mults\.HomeComputerRamCost, wealth, perSec: moneyPerSec, placeH: LEAN_PLACE_H \}\)/.test(pr)) c.fail('progress.js bladeRouteOf does not replace an Infinity lean phase with routeFullAtOf on the route\'s money')
    if (!/if \(leanRoute\) leanUntilH = leanRoute\.untilH/.test(pr)) c.fail('progress.js computes the route purchase but the start does not use it')
    if (!/lean: \{ untilH: leanUntilH === Infinity/.test(pr)) c.fail('decisions.bladeRoute does not publish the lean phase')
    checks.push(c)
  }
  return checks
}
