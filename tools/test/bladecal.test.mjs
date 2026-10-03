// [BC] THE BLADEBURNER EXIT MODEL'S FIRST LIVE CALIBRATION — BN6 2026-10-01.
//
// The published exit (bbplan.bladeExit) moved 23.64h -> 25.56h at 12:17-12:22Z
// with no event (EXIT UNSTABLE) and rose 24.9h -> 26.8h over 1.1h (EXIT NOT
// APPROACHING). Fixture: tools/test/fixture-bn6-bladecal-1322.json — the
// daemon's record at 13:22Z, the save at 13:24Z (the TRUE city populations,
// the game's own success/failure counters), sleeve.txt, the 12:17/12:22/13:37Z
// plan records, the route's exit series since entry and the realised rank to
// 22:15Z. The 11:07Z state is tools/test/fixture-bn6-bladeinstall-1107.json.
//
//   BC1 THE TRUE POPULATION off the shown range (popRatioFromRange): the live 13:22Z numbers, both sides
//   BC2 THE ATTRIBUTION: 11:07 -> 13:22 on the model as shipped, input group by group: the cities'
//       ESTIMATES (Field Analysis correcting Chongqing 1.72e9 -> 1.18e9) carry the move; on the true
//       populations an estimate correction moves nothing
//   BC3 THE FLEET: the route priced five infiltrators while the sleeves did Homicide (bladeFleetOf);
//       sleeve.js prices the fleet on the route's own install basis, never the hacking cadence
//   BC4 STAMINA is a state: the start's stamina is banked or owed rest at the chamber's rate
//   BC5 ATTEMPTS AND SUCCESSES from counters (attemptsOf); the old rule read several completions as one
//   BC6 THE SUCCESS POSTERIOR: prior k = 1, binomial evidence, weight grows with attempts
//   BC7 THE RANK-RATE POSTERIOR: non-overlapping windows of the model's own path, an install closes
//       none, weight grows with hours; on the realised 13:22-22:15Z rank
//   BC8 EVENTS: real state moves raise one; an estimate correction and the model's own drift do not
//   BC9 POLICY: the action at its stamina duty; Cyber's Edge priced (maxStaminaBase); skills saved
//       for the best value per point
//   BC10 OPTIONS OFF BASIS on the 13:37Z record: the hack arm's decisions marked not applicable
//   BC11 WIRING: progress.js / bladeburner.js / sleeve.js use the pieces above

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const BB = await import('bbplan.js')
const P = await import('plan.js')
const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn6-bladecal-1322.json'), 'utf8'))
const F1 = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn6-bladeinstall-1107.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const TEL = F.bladeburner
const TRUE = (tel) => ({ ...tel, cities: tel.cities.map((c) => ({ ...c, pop: F.save.cities[c.name].pop })) })
const EST = (tel) => ({ ...tel, cities: tel.cities.map(({ pop: _p, ...c }) => c) })
const SL5 = { infiltrate: 5, support: 0, fa: 0 }
const H = (tel, person = F.player, sleeves = SL5, extra = {}) => BB.bladeExit({ ...BB.bladeStartOf({ tel, person, sleeves, gymExpPerSec: 30, bnRank: 1 }), ...extra }).hours

export async function run() {
  const checks = []

  {
    const c = new Check('BC1', 'THE TRUE POPULATION off the shown range: a black op has no city term, so its range is [p r, p] or [p, p r]')
    checks.push(c)
    // Live 13:22Z: Operation Typhoon [0.0363, 0.0370] in Chongqing; the save: pop 1157976236, popEst 1178427898.
    // The formula's chance from first principles (stats, skills, int, stamina, no city term) names the end.
    const sm = BB.skillMultsOf(TEL.levels)
    const pF = BB.successChance(BB.dataOf('Operation Typhoon'), 1, F.player, sm, { int: F.player.skills.intelligence, stamina: TEL.stamina, maxStamina: TEL.maxStamina, teamCount: 0, augMult: F.player.mults.bladeburner_success_chance ?? 1 })
    const r = BB.popRatioFromRange(0.0363, 0.037, pF)
    const truth = F.save.cities.Chongqing.pop / F.save.cities.Chongqing.popEst
    c.note(`live Typhoon range [0.0363, 0.0370], the formula's chance ${pF.toFixed(5)} (the high end: the formula IS the game's) -> r ${r.toFixed(4)}; the save's pop/popEst ${truth.toFixed(4)} (the range is published to 4 places)`)
    if (!(Math.abs(pF - 0.037) < 0.0005)) c.fail(`the success formula ${pF} vs the game's 0.0370`)
    if (!(Math.abs(r - truth) < 0.005)) c.fail(`r ${r} vs the save's ${truth}`)
    for (const [p, rr] of [[0.01, 0.6], [0.2, 1.4], [0.05, 1], [0.3, 0.97], [0.002, 2.1]]) {
      const lo = rr < 1 ? p * rr : p
      const hi = rr < 1 ? p : p * rr
      const got = BB.popRatioFromRange(lo, hi, p * 1.003) // the formula's p within rounding
      if (!(Math.abs(got - rr) < 1e-9)) c.fail(`p ${p} r ${rr}: recovered ${got}`)
      c.examined(1)
    }
    if (BB.popRatioFromRange(0.5, 1, 0.5) !== null) c.fail('a range clamped at 1 cannot say r: must be null')
    if (BB.popRatioFromRange(0, 0.01, 0.01) !== null) c.fail('a range clamped at 0 cannot say r: must be null')
    c.examined(3)
  }

  {
    const c = new Check('BC2', "THE ATTRIBUTION 11:07 -> 13:22Z, one input group at a time: the cities' estimates carry the exit's rise; on true populations an estimate correction moves nothing")
    checks.push(c)
    const A = { ...F1.bladeburner }
    const pA = { skills: F1.player.skills, exp: F1.player.exp, mults: F1.player.mults }
    const B = EST(TEL)
    const a = H(A, pA)
    const b = H(B)
    const groups = { rank: ['rank', 'skillPoints', 'levels'], counts: ['counts'], maxLevels: ['maxLevels'], cities: ['cities'] }
    const parts = {}
    for (const [g, keys] of Object.entries(groups)) {
      const t = { ...A }
      for (const k of keys) t[k] = B[k]
      parts[g] = H(t, pA) - a
    }
    parts.person = H(A, F.player) - a
    c.note(`11:07 ${a.toFixed(2)}h -> 13:22 ${b.toFixed(2)}h (2.25h passed; a held plan expects ${(a - 2.25).toFixed(2)}h); one group at a time: ${Object.entries(parts).map(([k, v]) => `${k} ${v >= 0 ? '+' : ''}${v.toFixed(2)}h`).join(', ')}`)
    c.note(`cities 11:07 ${A.cities.map((x) => `${x.name} ${(x.popEst / 1e9).toFixed(2)}`).join(' ')}; 13:22 est/true ${TEL.cities.map((x) => `${x.name} ${(x.popEst / 1e9).toFixed(2)}/${(F.save.cities[x.name].pop / 1e9).toFixed(2)}`).join(' ')}`)
    c.examined(6)
    const top = Object.entries(parts).sort((x, y) => y[1] - x[1])[0]
    if (top[0] !== 'cities' || !(parts.cities > 1.5)) c.fail(`the cities' estimates must be the largest upward move (> 1.5h): ${JSON.stringify(parts)}`)
    // On the TRUE populations, Field Analysis changing the estimate is not an input at all.
    const t0 = TRUE(TEL)
    const moved = { ...t0, cities: t0.cities.map((x) => (x.name === 'Chongqing' ? { ...x, popEst: 1.72e9 } : x)) }
    const h0 = H(t0)
    const h1 = H(moved)
    c.note(`true populations: Chongqing's estimate 1.18e9 -> 1.72e9 moves the exit ${(h1 - h0).toFixed(3)}h (on estimates it moved ${(H({ ...B, cities: B.cities.map((x) => (x.name === 'Chongqing' ? { ...x, popEst: 1.72e9 } : x)) }) - b).toFixed(2)}h)`)
    if (h1 !== h0) c.fail(`an estimate correction moved the exit priced on true populations by ${h1 - h0}h`)
    // The 12:17 -> 12:22 records themselves: the route's exit moved +1.92h with no event while the Simulacrum bound did not.
    const s1 = F.plan1217.bladeRoute.simulacrum
    const s2 = F.plan1222.bladeRoute.simulacrum
    c.note(`12:17 -> 12:22Z: route ${F.plan1217.exit.meanH}h -> ${F.plan1222.exit.meanH}h, rank ${F.plan1217.bladeRoute.rank} -> ${F.plan1222.bladeRoute.rank}; ${F.plan1222.exitStability.why.slice(0, 160)}`)
    c.note(`  the no-install-cost Simulacrum bound on the same inputs ${s1.boundH}h -> ${s2.boundH}h: the move is not in rank, counts or levels (which the bound shares) — the model's response to the estimates is discontinuous (one city's estimate 1.30e9 -> 1.18e9 alone: +1.8h on the 13:22 state)`)
    c.examined(3)
  }

  {
    const c = new Check('BC3', "THE FLEET AS IT RUNS: five infiltrators priced while the sleeves did Homicide; sleeve.js prices on the route's own install basis")
    checks.push(c)
    const fl = BB.bladeFleetOf(F.sleeve)
    c.note(`sleeve.txt 13:22Z: tasks ${F.sleeve.assigned.map((a) => a.task).join(', ')}; blade.on ${F.sleeve.blade.on} (${F.sleeve.blade.why}; installEveryH ${F.sleeve.blade.installEveryH}); route priced ${JSON.stringify(F.plan1222.bladeRoute.sleeves)}`)
    c.note(`bladeFleetOf -> ${JSON.stringify(fl.sleeves)} (${fl.source}): ${fl.why}`)
    if (fl.source !== 'assigned' || fl.sleeves.infiltrate + fl.sleeves.support + fl.sleeves.fa !== 0) c.fail(`the sleeves did Homicide: no Bladeburner sleeve, got ${JSON.stringify(fl)}`)
    const com = BB.bladeFleetOf({ ...F.sleeve, blade: { config: { infiltrate: 1, support: 0, fa: 4 }, why: 'x' } })
    if (com.source !== 'committed' || com.sleeves.fa !== 4) c.fail('a committed fleet is the fleet')
    const asg = BB.bladeFleetOf({ assigned: [{ task: 'INFILTRATE' }, { task: 'SUPPORT' }, { task: 'BLADEBURNER' }, { task: 'CRIME' }] })
    if (JSON.stringify(asg.sleeves) !== JSON.stringify({ infiltrate: 1, support: 1, fa: 1 })) c.fail(`assigned tasks: ${JSON.stringify(asg.sleeves)}`)
    const h5 = H(TRUE(TEL))
    const h0 = H(TRUE(TEL), F.player, fl.sleeves)
    c.note(`13:22Z on true populations: five infiltrators ${h5.toFixed(2)}h, the sleeves as they ran ${h0.toFixed(2)}h (+${(h0 - h5).toFixed(1)}h the published exit did not carry)`)
    if (!(h0 - h5 > 8)) c.fail(`the fleet nobody ran should be worth hours: ${h5} vs ${h0}`)
    // sleeve.js: the route's basis, not the hacking cadence.
    const none = BB.bladeInstallOfBasis({ kind: 'none' })
    const w = BB.bladeInstallOfBasis({ kind: 'wait', waitH: 3, installAt: Date.parse('2026-10-01T15:00:00Z') }, Date.parse('2026-10-01T13:00:00Z'))
    if (none !== null || !(Math.abs(w.firstH - 2) < 1e-9)) c.fail(`bladeInstallOfBasis: none -> ${JSON.stringify(none)}, wait -> ${JSON.stringify(w)}`)
    const old = { ...BB.bladeStartOf({ tel: TRUE(TEL), person: F.player, sleeves: SL5, gymExpPerSec: 30, bnRank: 1 }), install: { everyH: 8, firstH: 0.25, combatGain: 1 } }
    const hOld = BB.bladeExit(old).hours
    c.note(`sleeve.js's old start (installs every cycleHours = 8h): ${hOld === null ? 'unfinished in 400h' : hOld.toFixed(1) + 'h'} — why every fleet was refused`)
    const sj = SRC('sleeve.js')
    if (!/bladeInstallOfBasis\(basis/.test(sj) || /everyH: cyc/.test(sj)) c.fail("sleeve.js must price the fleet on decisions.bladeRoute.installBasis (bladeInstallOfBasis), not the hacking cycleHours")
    c.examined(7)
  }

  {
    const c = new Check('BC4', "STAMINA IS A STATE: the start is banked or owed rest at the chamber's rate, not a full bar")
    checks.push(c)
    const t = TRUE(TEL)
    const s = (st) => BB.bladeExit({ ...BB.bladeStartOf({ tel: { ...t, stamina: st }, person: F.player, sleeves: SL5, gymExpPerSec: 30, bnRank: 1 }), maxH: 0.5, pathEveryS: 300 })
    const low = s(0.55 * TEL.maxStamina)
    const high = s(0.95 * TEL.maxStamina)
    const v0 = BB.staminaGainOf(F.player, BB.skillMultsOf(TEL.levels), TEL.maxStamina)
    const h0 = (TEL.maxStamina * 0.01) / 60
    const expect = (0.4 * TEL.maxStamina) / (v0 + h0) / 3600
    const got = high.staminaOffsetH - low.staminaOffsetH
    c.note(`stamina 55% vs 95% of ${TEL.maxStamina}: offsets ${low.staminaOffsetH}h / ${high.staminaOffsetH}h, difference ${got.toFixed(3)}h; the chamber's rate says ${expect.toFixed(3)}h (passive ${(v0 * 60).toFixed(2)}/min + chamber ${(h0 * 60).toFixed(2)}/min; the logs: 2.06/min)`)
    if (!(Math.abs(got - expect) < 0.1 * expect)) c.fail(`banked stamina ${got}h vs ${expect}h`)
    if (!(low.path[1].rank <= high.path[1].rank)) c.fail('owed rest must not earn rank sooner than banked stamina')
    c.examined(3)
  }

  {
    const c = new Check('BC5', 'ATTEMPTS AND SUCCESSES from the counters (attemptsOf): the growth twin is the clock, the rank says how many succeeded')
    checks.push(c)
    const d = BB.dataOf('Retirement')
    const g = BB.rankGainOf(d, 12, 1)
    // Three completions in one read (a throttled tab): 2 successes, 1 failure; the twin grew 0.31, the count fell 3 - 0.30.
    const a = BB.attemptsOf({ d, level: 12, count0: 150, count1: 150 - 3 + 0.3, twin0: 220, twin1: 220.31, rank0: 500, rank1: 500 + g * 0.93 + g * 1.08 })
    c.note(`3 completions in one read: attemptsOf -> ${JSON.stringify(a)}; the old rule ("the rank moved by half a success") -> one success`)
    if (a.n !== 3 || a.s !== 2) c.fail(`expected 3 attempts, 2 successes: ${JSON.stringify(a)}`)
    const op = BB.dataOf('Undercover Operation')
    const go = BB.rankGainOf(op, 3, 1)
    const lo = BB.rankLossOf(op, 3)
    const b = BB.attemptsOf({ d: op, level: 3, count0: 50, count1: 48.1, twin0: 60, twin1: 60.1, rank0: 900, rank1: 900 + go * 1.05 - lo * 0.95 })
    if (b.n !== 2 || b.s !== 1) c.fail(`an operation's loss: expected 2/1, got ${JSON.stringify(b)}`)
    const x = BB.attemptsOf({ d, level: 12, count0: 150, count1: 149, twin0: 220, twin1: 220.5, rank0: 500, rank1: 501 })
    if (x.n !== null) c.fail(`a non-integer attempt count must be refused: ${JSON.stringify(x)}`)
    const y = BB.attemptsOf({ d, level: 12, count0: 150, count1: 149, twin0: 220, twin1: 220, rank0: 500, rank1: 500 + 5 * g })
    if (y.n !== null) c.fail(`rank no attempt explains must be refused: ${JSON.stringify(y)}`)
    // The game's own counters, the 43 minutes of the 13:22 console: Retirement 21 of 36, Tracking 24 of 25;
    // the daemon's record of the same hour: 20 of 20 'ok'.
    c.note(`the game 12:40-13:23Z: Retirement ${F.save.console.Retirement.ok}/${F.save.console.Retirement.ok + F.save.console.Retirement.fail}, Tracking ${F.save.console.Tracking.ok}/${F.save.console.Tracking.ok + F.save.console.Tracking.fail}; lifetime Retirement ${F.save.actions.Retirement.successes}/${F.save.actions.Retirement.successes + F.save.actions.Retirement.failures}; the daemon published observed ${TEL.outcomes.observed} of ${TEL.outcomes.n} vs expected ${TEL.outcomes.expected.toFixed(2)}`)
    if (!(TEL.outcomes.observed === 1)) c.fail('fixture: the captured record must show the broken 20/20')
    c.examined(5)
  }

  {
    const c = new Check('BC6', "THE SUCCESS POSTERIOR: prior k = 1 (the game's formula), exact binomial evidence, the weight grows with the attempts")
    checks.push(c)
    const none = BB.successPosterior([])
    const small = BB.successPosterior([{ p: 0.55, n: 20, s: 8 }])
    const big = BB.successPosterior([{ p: 0.55, n: 2000, s: 800 }])
    const fair = BB.successPosterior([{ p: 0.6, n: 1000, s: 601 }, { p: 0.85, n: 500, s: 424 }])
    // The live window (the formula's p from the low end at ~0.97 of the real one): Retirement 21/36 at ~0.56, Tracking 24/25 at ~0.90.
    const live = BB.successPosterior([{ p: 0.56, n: 36, s: 21 }, { p: 0.9, n: 25, s: 24 }])
    c.note(`none: k ${none.k}; 8/20 at 0.55: k ${small.k} sd ${small.sdLn}; 800/2000: k ${big.k} sd ${big.sdLn}; on the formula: k ${fair.k}; live 12:40-13:23Z: ${live.why}`)
    if (none.k !== 1) c.fail('no evidence: the formula')
    if (!(small.k > 0.85 && small.k < 1)) c.fail(`20 attempts move k a little toward 0.73, not to it: ${small.k}`)
    if (!(Math.abs(big.k - 0.8 / 0.55 / 2) < 0.1 || Math.abs(big.k - 0.4 / 0.55) < 0.03)) c.fail(`2000 attempts pin k at 0.727: ${big.k}`)
    if (!(big.sdLn < small.sdLn)) c.fail('the weight must grow with the evidence')
    if (!(Math.abs(fair.k - 1) < 0.04)) c.fail(`outcomes on the formula: k 1, got ${fair.k}`)
    c.examined(5)
  }

  {
    const c = new Check('BC7', "THE RANK-RATE POSTERIOR on the model's own path: non-overlapping windows, none across an install, weight by hours; the realised 13:22-22:15Z rank")
    checks.push(c)
    const path = [{ h: 0, rank: 100 }, { h: 1, rank: 150 }, { h: 2, rank: 220 }]
    let led = BB.rankCalStep(null, { at: '2026-10-01T10:00:00Z', lastAugReset: 1, rank: 100, path })
    led = BB.rankCalStep(led, { at: '2026-10-01T10:30:00Z', lastAugReset: 1, rank: 120, path: [{ h: 0, rank: 120 }] })
    if (led.closed || led.pending.at !== '2026-10-01T10:00:00Z') c.fail('a window under an hour stays open, and no second window opens over it')
    led = BB.rankCalStep(led, { at: '2026-10-01T11:00:00Z', lastAugReset: 1, rank: 140, path: [{ h: 0, rank: 140 }, { h: 1, rank: 200 }] })
    if (!led.closed || Math.abs(led.closed.lnK - Math.log(40 / 50)) > 1e-3 || led.pending?.at !== '2026-10-01T11:00:00Z') c.fail(`the hour closes at ln(40/50) and the next opens: ${JSON.stringify(led.closed)}`)
    const inst = BB.rankCalStep(led, { at: '2026-10-01T12:05:00Z', lastAugReset: 2, rank: 10, path: null })
    if (inst.closed || inst.pending) c.fail('an install closes nothing and opens nothing without a path')
    const V = BB.RANK_CAL.v
    const post1 = BB.rankRatePosterior([{ lnK: Math.log(0.8), h: 1, v: V }])
    const post9 = BB.rankRatePosterior(Array.from({ length: 9 }, () => ({ lnK: Math.log(0.8), h: 1, v: V })))
    // A window of the old definition (any daemon, any inputs) measures nothing now.
    const old = BB.rankRatePosterior(Array.from({ length: 9 }, () => ({ lnK: Math.log(0.8), h: 1 })))
    if (old.n !== 0 || old.k !== 1) c.fail(`windows without the definition's version are dropped: ${old.why}`)
    if (led.closed?.v !== V) c.fail('a closed window carries the definition version')
    // Not the model's trajectory (the lean daemon, an unread city, a stale fleet): no window opens, an open one is dropped.
    const lean = BB.rankCalStep(null, { at: '2026-10-01T10:00:00Z', lastAugReset: 1, rank: 100, full: false, path })
    const dropped = BB.rankCalStep(led, { at: '2026-10-01T11:30:00Z', lastAugReset: 1, rank: 150, full: false, path })
    if (lean.pending || dropped.pending || dropped.closed) c.fail('a window opens and closes only on the full daemon from complete inputs')
    c.note(`one hour at 0.8: ${post1.why}`)
    c.note(`nine hours at 0.8: k ${post9.k} x/÷ ${Math.exp(1.2816 * post9.sdLn).toFixed(2)} (weight ${post9.measuredWeight})`)
    if (!(post1.k > 0.8 && post1.k < 0.95 && post9.k < post1.k && post9.sdLn < post1.sdLn)) c.fail('k moves toward the measured ratio as the hours grow')
    // The realised rank against the model's path from 13:22Z: the windows the plan would have kept.
    const s0 = { ...BB.bladeStartOf({ tel: TRUE(TEL), person: F.player, sleeves: BB.bladeFleetOf(F.sleeve).sleeves, gymExpPerSec: 30, bnRank: 1 }), pathEveryS: 900, maxH: 10 }
    const mp = BB.bladeExit(s0).path
    const T0 = Date.parse(TEL.at)
    const realAt = (h) => {
      const rows = F.realised.map((r) => ({ h: (Date.parse(r.at) - T0) / 3.6e6, rank: r.rank }))
      return BB.rankOnPath(rows, h)
    }
    const hrs = [1, 2, 4, 6, 8]
    c.note(`from 13:22Z, the sleeves as they ran, true populations (the NEW policy, which the live daemon did not run): model ${hrs.map((h) => `${h}h ${BB.rankOnPath(mp, h).toFixed(0)}`).join(', ')}; realised ${hrs.map((h) => `${h}h ${realAt(h).toFixed(0)}`).join(', ')}`)
    c.examined(6)
  }

  {
    const c = new Check('BC8', "EVENTS: the fleet, a black op, a random event in the best city, a calibration move raise one; an estimate correction and the model's own drift do not")
    checks.push(c)
    const base = BB.bladeStateOf({ tel: TRUE(TEL), sleeves: SL5, cal: { rank: { lnK: 0, sdLn: 0.3 }, success: { lnK: 0, sdLn: 0.15 } } })
    const same = (tel, sleeves = SL5, cal = { rank: { lnK: 0, sdLn: 0.3 }, success: { lnK: 0, sdLn: 0.15 } }) => BB.bladeEventsOf(base, BB.bladeStateOf({ tel, sleeves, cal }))
    const fa = same({ ...TRUE(TEL), cities: TRUE(TEL).cities.map((x) => ({ ...x, popEst: x.popEst * 0.9 })) })
    const drift = same({ ...TRUE(TEL), rank: TEL.rank + 30, counts: { ...TEL.counts, Tracking: 0 }, stamina: 20 })
    const fleet = same(TRUE(TEL), { infiltrate: 0, support: 0, fa: 0 })
    const best = base.best.name
    const ev = same({ ...TRUE(TEL), cities: TRUE(TEL).cities.map((x) => (x.name === best ? { ...x, pop: x.pop * 1.12 } : x)) })
    const other = same({ ...TRUE(TEL), cities: TRUE(TEL).cities.map((x) => (x.name === 'Ishima' ? { ...x, pop: x.pop * 0.85 } : x)) })
    const bo = same({ ...TRUE(TEL), blackOps: { ...TEL.blackOps, done: 1 } })
    const cal = same(TRUE(TEL), SL5, { rank: { lnK: -0.2, sdLn: 0.2 }, success: { lnK: 0, sdLn: 0.15 } })
    c.note(`best city ${best}; estimates -10%: [${fa}]; drift: [${drift}]; fleet: [${fleet}]; best +12%: [${ev}]; Ishima -15%: [${other}]; black op: [${bo}]; rank k: [${cal}]`)
    if (fa.length || drift.length || other.length) c.fail('an estimate correction, the model\'s own drift or a city the policy does not use is no event')
    if (fleet.length !== 1 || ev.length !== 1 || bo.length !== 1 || cal.length !== 1) c.fail('each real state move is one event')
    c.examined(7)
  }

  {
    const c = new Check('BC9', "POLICY: the action at its stamina duty; Cyber's Edge priced; skills saved for the best value per point")
    checks.push(c)
    const sm = BB.skillMultsOf(TEL.levels)
    const env = { int: F.player.skills.intelligence, stamina: TEL.maxStamina, maxStamina: TEL.maxStamina, pop: 1e9, chaos: 0, teamCount: 0, augMult: 1 }
    const view = {
      person: F.player, sm, levels: TEL.levels, bnRank: 1, rank: TEL.rank, stamina: TEL.maxStamina, maxStamina: TEL.maxStamina,
      staminaGain: BB.staminaGainOf(F.player, sm, TEL.maxStamina), maxStaminaBase: true, staminaBonus: 0, resting: false,
      ref: { pop: 1e9, chaos: 0 }, cities: [{ name: 'Chongqing', pop: F.save.cities.Chongqing.pop, chaos: 1.65, comms: 104 }], city: 'Chongqing',
      actions: BB.LEVELED.map((d) => ({ d, count: d.name === 'Tracking' ? 50 : TEL.counts[d.name], maxLevel: TEL.maxLevels[d.name], K: BB.envOf(d, env), width: 0 })),
      blackOp: null,
    }
    const pick = BB.chooseAction(view)
    const g = view.staminaGain
    const rows = view.actions.map((a) => BB.bestLevel(a, view)).filter(Boolean).map((b) => ({ name: b.a.d.name, ev: b.ev, wall: b.ev * BB.dutyOf(BB.staminaCostOf(b.a.d, b.L), b.t, g, view.maxStamina) }))
    const byWall = [...rows].sort((x, y) => y.wall - x.wall)
    c.note(`13:22Z, Tracking available: ${pick.why}; per wall second ${byWall.slice(0, 3).map((x) => `${x.name} ${x.wall.toFixed(4)} (acting ${x.ev.toFixed(4)})`).join(', ')}`)
    if (pick.name !== byWall[0].name) c.fail(`the pick must be the best per wall second (${byWall[0].name}), got ${pick.name}`)
    // An action that drains more stamina loses its acting lead: a synthetic Tracking that costs 3x the stamina.
    const heavy = rows.find((x) => x.name === 'Tracking')
    if (heavy && !(heavy.wall / heavy.ev < rows.find((x) => x.name === 'Retirement').wall / rows.find((x) => x.name === 'Retirement').ev)) c.fail('Tracking drains faster: its duty must be the lower')
    const buy = BB.planSkills(view, 1)
    const buyNoBase = BB.planSkills({ ...view, maxStaminaBase: false }, 1)
    c.note(`one point: maxStaminaBase ${JSON.stringify(buy)}; without it (the daemon before) ${JSON.stringify(buyNoBase)}`)
    if (!buy.some((b) => b.name === "Cyber's Edge")) c.fail("Cyber's Edge (cost 1, +2% stamina where stamina binds) must be the point's best use")
    // Saving: with points below the best's price, nothing worse is bought.
    const v2 = { ...view, levels: { ...TEL.levels, "Cyber's Edge": 30 } }
    const p3 = BB.planSkills(v2, 3)
    const p40 = BB.planSkills(v2, 40)
    c.note(`3 points: ${JSON.stringify(p3.map((b) => b.name))}; 40 points: ${JSON.stringify(p40.map((b) => `${b.name} x${b.count}`))}`)
    if (p40.length && p3.length && p3[0].name !== p40[0].name) c.fail('with too few points for the best value, buy nothing (save) rather than a worse skill')
    if (!/maxStaminaBase: true, staminaBonus: staminaBonusOf\(/.test(SRC('bladeburner.js'))) c.fail('bladeburner.js must price stamina skills (maxStaminaBase true, the bonus read back)')
    c.examined(5)
  }

  {
    const c = new Check('BC10', "OPTIONS OFF BASIS on the 13:37Z record: the hack arm's decisions (grafts, life length, 4S, batch) are marked not applicable on the Bladeburner route, and skipped by name")
    checks.push(c)
    const before = P.optionsBasisOf(F.plan1337)
    const marked = P.markBladeMoot(F.plan1337.decisions)
    const after = P.optionsBasisOf({ ...F.plan1337, decisions: marked })
    c.note(`as captured: ${before.why.slice(0, 200)}`)
    c.note(`marked: ${after.why.slice(0, 300)}`)
    if (before.ok !== false) c.fail('fixture: the 13:37Z record must fail OPTIONS OFF BASIS')
    if (after.ok === false) c.fail(`marked, the record must not fail: ${after.why}`)
    if (!after.skipped?.some((s) => /grafts: not applicable/.test(s))) c.fail('the skipped graft decision must be named with its reason')
    for (const k of ['grafts', 'lifeLength', 'fourS', 'batch']) if (marked[k] && marked[k].applicable !== false) c.fail(`${k} must be marked`)
    // Off the route: the marks go, and the graft cross-check runs again.
    const hack = P.markBladeMoot({ ...marked, bladeRoute: { ...marked.bladeRoute, key: 'hack' }, install: { ...marked.install, route: undefined } })
    if (['grafts', 'lifeLength', 'fourS', 'batch'].some((k) => hack[k] && 'applicable' in hack[k])) c.fail('off the Bladeburner route the marks must be removed')
    if (P.optionsBasisOf({ ...F.plan1337, decisions: hack }).ok !== false) c.fail('off the route the graft options are on the wrong basis again and must fail')
    // A within-decision fault still fails on a marked decision.
    const bad = { ...marked, grafts: { ...marked.grafts, options: marked.grafts.options.map((o, i) => (i === 0 ? { ...o, pricedAt: '2026-10-01T00:00:00Z' } : o)) } }
    if (P.optionsBasisOf({ ...F.plan1337, decisions: bad }).ok !== false) c.fail("a marked decision's own rows are still checked")
    if (!/decisions: markBladeMoot\(\{/.test(SRC('progress.js'))) c.fail('progress.js must publish its decisions through markBladeMoot')
    c.examined(7)
  }

  {
    const c = new Check('BC11', 'WIRING: the route prices the fleet as it runs, the calibration and the events; the daemon reads the true population and counts attempts')
    checks.push(c)
    const pr = SRC('progress.js')
    const bj = SRC('bladeburner.js')
    const need = [
      [pr, /const fl = bladeFleetOf\(ours \? fleet : null, \{ lifeStart: info\.lastAugReset \}\)/, 'progress.js: the fleet as it runs (none from before the install)'],
      [pr, /rankWindowOkOf\(\{ tel, fleetSource: fl\.source \}\)/, 'progress.js: only the model\'s own trajectory is a rank window'],
      [pr, /rankScale, successScale, leanUntilH \}\)/, 'progress.js: the calibration (and the lean phase) into the one builder'],
      [pr, /bladeEventsOf\(pc\.prev\?\.decisions\?\.bladeRoute\?\.state/, 'progress.js: the state events before the decision'],
      [pr, /rankCalStep\(prevCal/, 'progress.js: the rank ledger'],
      [bj, /popRatioFromRanges\(lo, hi, cl, ch\)/, 'bladeburner.js: the true population of every city (the side from an action\'s own range)'],
      [bj, /attemptsOf\(\{/, 'bladeburner.js: attempts from the counters'],
      [bj, /successPosterior\(calGroups\)/, 'bladeburner.js: the success posterior'],
    ]
    for (const [src, re, what] of need) {
      c.examined(1)
      if (!re.test(src)) c.fail(`missing: ${what}`)
    }
    if (/ok: dr >= 0\.5 \* pending\.gain/.test(bj)) c.fail('the old one-completion outcome rule is back')
  }
  return checks
}
