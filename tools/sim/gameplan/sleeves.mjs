// THE SLEEVE COUNT, and what one more sleeve is worth on each route.
//
// THE COUNT (PersonObjects/Sleeve/SleeveCovenantPurchases.tsx:63,
// recalculateNumberOfOwnedSleeves):
//     sleeves = min(3, SF10 level + (in BitNode 10 ? 1 : 0)) + sleevesFromCovenant
// sleevesFromCovenant is at most 5 (getSleeveCost: 10^n x $10t for the
// (n+1)th, Covenant membership, BitNode 10 only) and persists across nodes.
// Held today: SF10.1 + 4 Covenant = 5 (sleeve.txt `sleeves: 5`). SF10.2 and
// SF10.3 add one each (6, 7); inside BN10 itself one more while the node lasts
// (BN10.2 is played at SF10.1: 6; BN10.3 at SF10.2: 7).
//
// WHAT AN EXTRA SLEEVE DOES, per route:
//
//   BLADEBURNER  SIMULATED (bbsim, the game's classes): the surrogate's
//       Bladeburner grid gains a fleet-size axis (surrogate.mjs BB_FLEET_N),
//       each size run under the live fleet rule — sleeve.js's committed mix is
//       bbplan.chooseSleeveConfigGen's "every configuration of
//       sleeveConfigs(n), the fastest kept"; here the fastest is chosen on the
//       game's classes per node (selection seeds disjoint from the evaluation
//       seeds) — and the planner's 5-infiltrator leg is scaled by
//       leg(policy, n) / leg(policy, 5), so 5 sleeves is the old grid exactly
//       and k keeps its one definition (params.BB_PARAMS).
//
//   HACKING  DERIVED here (`node tools/sim/gameplan/sleeves.mjs`; the ASSUMED
//       inputs named below). Under the live policy
//       (sleeveplan.sleeveAssignments) only ONE sleeve may hold a faction
//       (setToFactionWork throws otherwise) and the exit faction already has
//       it, so a 6th/7th sleeve falls through to its best MONEY crime (or,
//       on an 'exp' objective, Algorithms: <= 16 exp/s x sync, and a new
//       sleeve arrives at memory 1 = sync 1 — the exp transfer was priced at
//       0.09% of a BN10 exit for a sleeve at sync 83, 2026-09-22: NOT PRICED
//       here, stated). sleeveExitOf prices money through exitplan's own
//       mechanism: every later life's gain lifted by k^eBudget, k = 1 + the
//       sleeve's money over the life / the life's income (exitplan
//       lifeStreamMultiples, growthTableOf). On hackexit's fresh inputs the
//       life income is the profile's incomeL1 (NOT CALIBRATED: $1e7-5e8/s at
//       level 1 in most nodes) and the lift is ~0 — the derivation prints
//       that. So it applies the same lift to the MEASURED lives of the six
//       played runs (history.jsonl: each life's peak money / its length, x
//       INCOME_OVER_PEAK) with the sleeve's own trajectory (sleeveMoneyPath:
//       a new sleeve, skills 1, shock 100 falling passively, training by its
//       crime), and states the result as the factor on g that carries the
//       same ln-multiplier over the run:   d = sum_lives eBudget ln k / (g T).
//       NOT PRICED: a sleeve on a SECOND faction's reputation (the live
//       policy never assigns one).
//
// THE 5TH COVENANT SLEEVE: getSleeveCost(4) = 10^4 x $10t = $1e17, inside
// BN10 only, with Covenant membership (20 augs, $75b, hacking 850, all combat
// 850) held in the same install window. Priced below (covenant5th) against
// BN10's measured late income; NOT a move the plan searches (the planner's
// state has no Covenant axis), stated.

// PURE at import (effects.mjs reads the count and D10): the game-side modules the trajectory and
// the derivation need are loaded by loadDeps(), after gameresolve's hook (they import by the
// game's bare spelling).
export async function loadDeps() {
  await import('../../test/gameresolve.mjs')
  return { SP: await import('sleeveplan.js'), BP: await import('bodyplan.js'), IG: await import('installgate.js') }
}
/** SleeveCovenantPurchases.tsx: at most 5 from the Covenant (sleeveplan COVENANT.maxSleeves; SL1 checks the copy). */
export const COVENANT_MAX = 5
/** getSleeveCost (sleeveplan covenantSleeveCost; SL1 checks the copy): 10^n x $10t for the (n+1)th. */
export const covenantCost = (bought) => Math.pow(10, bought) * 10e12

/** SleeveCovenantPurchases.tsx:63: the SF10 part caps at 3. */
export const SF10_SLEEVE_CAP = 3
/** Covenant sleeves held (sleeve.txt: 5 sleeves at SF10.1 outside BN10 = 1 + 4). MEASURED. */
export const COVENANT_HELD = 4
/** The fleet every measured clear and every surrogate cell before this ran with. */
export const BASE_SLEEVES = 5
/** sleeves = min(3, SF10 + (BN10 ? 1 : 0)) + Covenant (recalculateNumberOfOwnedSleeves). */
export const sleeveCount = (sf10, node, covenant = COVENANT_HELD) => Math.min(SF10_SLEEVE_CAP, sf10 + (node === 10 ? 1 : 0)) + Math.min(COVENANT_MAX, covenant)
/** Sleeves beyond the 5 the g calibration and the k calibration ran with (0..2 here). */
export const extraSleeves = (sf10, node, covenant = COVENANT_HELD) => Math.max(0, sleeveCount(sf10, node, covenant) - BASE_SLEEVES)

// --- the derivation's ASSUMED inputs, each with its reason ---
/** exitplan's eBudget = dln(planM)/dln(budget): one more aug per x1.9 of budget, each ~ln(1.1) of multiplier -> ln(1.1)/ln(1.9) = 0.15. */
export const E_BUDGET = { lo: 0.05, mid: 0.15, hi: 0.3 } // lo: rep-bound lives (money does not bind); hi: the bigger hacking augs (x1.2-1.3) at the margin
/** A life's income over (its peak money / its length), the measured lower bound: money spent inside the life (servers, home, programs) never shows in the peak. */
export const INCOME_OVER_PEAK = { lo: 3, mid: 1.5, hi: 1 } // hi = the bound itself (the most a sleeve can be worth); lo: early lives spend most of their money on the fleet before the augs

/**
 * THE EXTRA SLEEVE'S MONEY, as a trajectory over node hours (the live
 * policy's fall-through, sleeveplan.sleeveAssignments -> bestSleeveCrime
 * 'money'): every step its best money crime at its CURRENT skills; it trains
 * by doing it (SleeveCrimeWork getExp: crime exp x CrimeExpGain x its
 * shockBonus, success 1 / failure 0.25 — Work.ts applySleeveGains) and by the
 * rest of the fleet's work handed to it at their sync x its shockBonus (the
 * fleet: `others` sleeves on the same crime at memory 100 = sync 100,
 * sleeve.txt); shock falls passively from 100 (Sleeve.process,
 * sleeveplan.shockPerSec; BN10 arrives at 25). Money is paid unscaled by shock
 * or sync. Returns [{atH, perSec}] (exitplan's extraIncome shape).
 */
export function sleeveMoneyPath(node, hours, { others = BASE_SLEEVES, shock0 = 100, dtH = 0.25 } = {}, { SP, BP, IG }) {
  const K = ['hacking', 'strength', 'defense', 'dexterity', 'agility', 'charisma']
  const mults = Object.fromEntries(K.flatMap((k) => [[k, 1], [`${k}_exp`, 1]]))
  Object.assign(mults, { crime_money: 1, crime_success: 1 })
  const sl = { sync: 1, shock: shock0, skills: { ...Object.fromEntries(K.map((k) => [k, 1])), intelligence: 0 }, exp: Object.fromEntries(K.map((k) => [k, 0])), mults }
  const out = []
  for (let h = 0; h < hours; h += dtH) {
    const pick = SP.bestSleeveCrime(sl, node, 'money')
    out.push({ atH: h, perSec: pick ? pick.rates.money : 0 })
    if (!pick) continue
    const c = BP.CRIMES[pick.crime]
    const perSec = 1000 / c.time
    const m = pick.rates.chance + 0.25 * (1 - pick.rates.chance)
    const sb = (100 - sl.shock) / 100
    const share = 1 + others * sb // its own gains + the fleet's on the same crime, x its shockBonus
    for (const k of K) sl.exp[k] += (c.exp[k] ?? 0) * node.CrimeExpGain * sb * m * perSec * share * dtH * 3600
    for (const k of K) sl.skills[k] = IG.skillFromExp(sl.exp[k], 1)
    sl.shock = Math.max(0, sl.shock - SP.shockPerSec(0, false) * dtH * 3600)
  }
  return out
}

/** The money a step path pays over [a, b) node hours (dollars). */
export function pathMoney(path, a, b) {
  let s = 0
  for (let i = 0; i < path.length; i++) {
    const lo = Math.max(a, path[i].atH)
    const hi = Math.min(b, i + 1 < path.length ? path[i + 1].atH : Infinity)
    if (hi > lo) s += path[i].perSec * (hi - lo) * 3600
  }
  return s
}

/**
 * sum over the lives of eBudget ln(k), k = 1 + the sleeve's money over the life
 * / (I x the life's seconds): exitplan lifeStreamMultiples + growthTableOf, the
 * lift sleeveExitOf's money objective is priced with. lives: [{startH, endH, I}].
 */
export function liftOf(lives, path, eB, incomeK = 1) {
  let L = 0
  for (const l of lives) {
    const I = l.I * incomeK
    if (!(I > 0) || !(l.endH > l.startH)) continue
    L += eB * Math.log(1 + pathMoney(path, l.startH, l.endH) / (I * (l.endH - l.startH) * 3600))
  }
  return L
}

/** The per-sleeve factor on g that carries the lift over a run of g x T ln-multiplier. */
export const dOf = (lives, path, eB, incomeK, g, T) => liftOf(lives, path, eB, incomeK) / (g * T)

/**
 * d10 — the hacking route's factor on g per extra sleeve PER UNIT of the
 * node's CrimeMoney (the sleeve's money is linear in it, and ln k ~ k - 1 at
 * these sizes): node n's g x (1 + d10 x CrimeMoney(n)) per sleeve past 5.
 * DERIVED by this file's CLI on 2026-10-03 from the five measured runs that
 * pay crime money (BN8 pays none): lo = the smallest run's d at the lo inputs
 * (BN9 0.03%), mid = the median run's at mid (BN4 0.72%; BN2 1.22, BN10 1.29,
 * BN1 0.19, BN9 0.18), hi = the largest run's at hi (BN10 3.8%).
 * Replaces the hand 0 / 1% / 3% node-free (effects.SF_PARAMS.d10 reads it).
 */
export const D10 = { lo: 3.0e-4, mid: 7.2e-3, hi: 3.8e-2 }

/** The 5th Covenant sleeve, DERIVED by the CLI 2026-10-03: its price in hours of the measured BN10's late-life income (the median of its last 5 lives). */
export const COVENANT5 = { cost: 1e17, income: 1.24e12, hours: 22.4 }

/** The 5th Covenant sleeve: its price, and the hours of `incomePerSec` it costs. */
export function covenant5th(incomePerSec) {
  const cost = covenantCost(4)
  return { cost, hours: cost / incomePerSec / 3600 }
}

// ---------------------------------------------------------------------------
// THE DERIVATION (CLI): TELEMETRY=<.telemetry> node tools/sim/gameplan/sleeves.mjs
// ---------------------------------------------------------------------------
export async function derive({ log = console.log } = {}) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const readline = await import('node:readline')
  const deps = await loadDeps()
  const { TELEMETRY } = await import('../nodechoice/measure.mjs')
  const { measureEconomy, MEASURED_RUNS } = await import('./economy.mjs')
  const { nodeMults, freshInputs } = await import('../nodechoice/hackexit.mjs')
  const ep = await import('exitplan.js')

  // each life of each measured run: node hours and I = peak money / life seconds
  const rl = readline.createInterface({ input: fs.createReadStream(path.join(TELEMETRY, 'history.jsonl')), crlfDelay: Infinity })
  const byRun = new Map(MEASURED_RUNS.map((r) => [r.name, { t0: null, lives: [] }]))
  let seg = null
  let cur = null
  let run = null
  for await (const line of rl) {
    let d
    try {
      d = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof d.bitNode !== 'number' || typeof d.totalPlaytime !== 'number') continue
    if (!seg || seg.bn !== d.bitNode) {
      seg = { bn: d.bitNode }
      cur = null
      const r = MEASURED_RUNS.find((x) => x.bn === d.bitNode && d.at.startsWith(x.start.slice(0, 13)))
      run = r ? byRun.get(r.name) : null
      if (run) run.t0 = d.totalPlaytime
    }
    if (!run) continue
    const t = d.totalPlaytime
    const life = t - (d.playtimeSinceLastAug ?? 0)
    if (!cur || Math.abs(life - cur.life) > 120e3) {
      cur = { life, start: t, end: t, peak: 0 }
      run.lives.push(cur)
    }
    cur.end = t
    cur.peak = Math.max(cur.peak, d.money ?? 0)
  }
  const econ = await measureEconomy()
  log('THE HACKING ROUTE — one more sleeve on its best money crime (the live fall-through), lifting every measured life')
  const rows = []
  for (const r of econ.runs) {
    const R = byRun.get(r.name)
    const lives = R.lives.filter((l) => l.end - l.start > 10 * 60e3).map((l) => ({ startH: (l.start - R.t0) / 3.6e6, endH: (l.end - R.t0) / 3.6e6, I: l.peak / ((l.end - l.start) / 1e3) }))
    const m = nodeMults(r.bn)
    const p = sleeveMoneyPath(m, r.T + 1, { shock0: r.bn === 10 ? 25 : 100 }, deps)
    const d = Object.fromEntries(['lo', 'mid', 'hi'].map((q) => [q, dOf(lives, p, E_BUDGET[q], INCOME_OVER_PEAK[q], r.g, r.T)]))
    rows.push({ r, lives, d, p })
    const at = (h) => p[Math.min(p.length - 1, Math.floor(h / 0.25))].perSec
    const Is = lives.map((l) => l.I).sort((a, b) => a - b)
    log(`  ${r.name.padEnd(10)} g ${r.g.toFixed(4)} T ${r.T.toFixed(1)}h ${String(lives.length).padStart(2)} lives, income/life p10 $${Is[Math.floor(Is.length / 10)].toExponential(1)}/s p50 $${Is[Math.floor(Is.length / 2)].toExponential(1)}/s | sleeve $${at(1).toFixed(0)}/s at 1h, $${at(r.T / 2).toFixed(0)} at T/2, $${at(r.T).toFixed(0)} at T  -> d per sleeve lo ${(d.lo * 100).toFixed(4)}%  mid ${(d.mid * 100).toFixed(4)}%  hi ${(d.hi * 100).toFixed(4)}%`)
  }
  // per unit of the node's CrimeMoney (the sleeve's money is linear in it; ln k ~ k - 1 at these sizes):
  // a run in a node that pays no crime money (BN8, CrimeMoney 0) says nothing about the others
  const unit = rows.filter((x) => nodeMults(x.r.bn).CrimeMoney > 0).map((x) => Object.fromEntries(['lo', 'mid', 'hi'].map((q) => [q, x.d[q] / nodeMults(x.r.bn).CrimeMoney])))
  const sorted = (q) => unit.map((x) => x[q]).sort((a, b) => a - b)
  const out = { lo: sorted('lo')[0], mid: sorted('mid')[Math.floor((unit.length - 1) / 2)], hi: sorted('hi')[unit.length - 1] }
  log(`  per unit CrimeMoney: ${rows.filter((x) => nodeMults(x.r.bn).CrimeMoney > 0).map((x, i) => `${x.r.name} (x${nodeMults(x.r.bn).CrimeMoney}) mid ${(unit[i].mid * 100).toFixed(3)}%`).join(', ')}`)
  log(`  D10 (per extra sleeve, factor on g per unit CrimeMoney; lo = min run at lo, mid = median run at mid, hi = max run at hi): lo ${out.lo.toExponential(3)}  mid ${out.mid.toExponential(3)}  hi ${out.hi.toExponential(3)}   (the hand prior was 0 / 0.01 / 0.03, node-free)`)

  // the same choice through the exit simulation itself, on hackexit's fresh inputs (the model the plan prices)
  log('  the same choice through exitplan.bestExitPolicy on the fresh-entry inputs (sleeveExitOf money: extraIncome + eBudget hi):')
  for (const { r, p } of rows) {
    const inp = freshInputs({ node: r.bn, sf: r.sfOnEntry, g: r.g, profile: econ.profile })
    const h0 = ep.bestExitPolicy(inp, 400)?.best?.hours
    const h1 = ep.bestExitPolicy({ ...inp, extraIncome: p, eBudget: E_BUDGET.hi }, 400)?.best?.hours
    log(`    ${r.name.padEnd(10)} without ${h0?.toFixed(3)}h  with ${h1?.toFixed(3)}h  saved ${(h0 - h1).toFixed(4)}h  (the model's income at level 1 $${inp.incomePerSec.toExponential(1)}/s, NOT CALIBRATED)`)
  }
  // the 5th Covenant sleeve, against BN10's measured late income
  const bn10 = rows.find((x) => x.r.bn === 10)
  const late = bn10.lives.slice(-5).map((l) => l.I).sort((a, b) => a - b)[2]
  const c5 = covenant5th(late)
  log(`THE 5TH COVENANT SLEEVE: $${c5.cost.toExponential(1)} (getSleeveCost(4) = 10^4 x $10t) = ${c5.hours.toFixed(1)}h of BN10's measured late-life income ($${late.toExponential(2)}/s, the median of its last 5 lives), in BN10 only, inside the install window that holds the Covenant's 850s`)
  return { d10: out, rows, covenant5th: { ...c5, income: late } }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await derive()
  process.exit(0)
}
