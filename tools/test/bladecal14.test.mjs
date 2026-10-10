// [B14] THE BLACK-OP EXIT ON BN14.1 — a forecast far noisier than its intervals.
//
// Live BN14.1 2026-10-04 (the life since 01:32Z, the Bladeburner route):
// exitcal read STRUCTURAL ERROR, X 16.7, the recalibration at its bound
// (x10, applied x8.6) and the PLAN MISCALIBRATED e-process at ~1e17. EXIT
// UNSTABLE 38.16 -> 47.18h in 5 min with no event (08:27Z); TWO EXITS AT
// INSTALL 43.76h vs the commitment's 36.99h priced 15 min earlier (09:13Z);
// 12 install deferrals with promised exits swinging -7 to -33h. Replayed pass
// by pass from the recorder (tools/sim/bbcal14.mjs on
// fixture-bn14-bladecal-passes.json):
//
//   B14-1 AS CAPTURED: the single exit is ROUGH in every input the pass moves — the skill clock,
//         the stamina, the person, k, the cities each move it hours, none of them alone (the policy
//         is discrete and the rank-compounding end amplifies a 1-3% lead into hours); sleeve.js
//         re-priced every pass (its memo keyed on a 'now' install's installAt) and flipped the
//         fleet each time (an event every pass); citiesAt carried from 02:49Z aged fresh reads
//   B14-2 THE MEMBERS: the exit is the mean over Q fixed members (the skill clock's phase, the rank
//         and success calibrations at their posterior quantiles); a start with no clock and no
//         posterior sd is its own member (every older test unchanged); pass to pass the mean moves
//         a fraction of the single exit
//   B14-3 THE PREDICTIVE: the point's own Monte Carlo error (seH) is published and exitcal adds it
//         to a revision's predictive (and to X, and to the lag-1 correlation it expects); on the
//         replayed passes the members with their se score mean z^2 ~1 where the single exit scored
//         ~1000; a sample with no seH is scored exactly as before (BN4's fit)
//   B14-4 THE RANK POSTERIOR: the windows' own scatter (sd 0.44 live) pooled into the observation
//         sd, so k moves by its evidence's real weight; the 03:37Z window (k 0.71 -> 0.99, the exit
//         -24h) is a move inside the posterior the members span
//   B14-5 THE CITIES DATED BY THEIR READ: a full bladeburner.js record dates its cities at its own
//         `at`, never the carried date
//   B14-6 THE FLEET: the members' means and their se decide; the incumbent stands inside z se of
//         the challenger; the re-price key is not a held 'now' install's installAt
//   B14-7 THE CHECKS: TWO EXITS AT INSTALL and EXIT UNSTABLE read the point's se (the 09:13Z pair
//         is one exit at its error); the install guard's scatter is the saving's se
//   B14-8 WIRING

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const T = await import('../sim/bbcal14.mjs')
const BB = T.BB
const EC = await import('exitcal.js')
const P = await import('plan.js')
const SP = await import('sleeveplan.js')
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const FX = JSON.parse(fs.readFileSync(T.FIXTURE, 'utf8'))
const PASSES = T.passesOfFixture(FX).filter((p) => p.plan?.decisions?.bladeRoute?.samples?.length)
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))
const HELD = { infiltrate: 4, support: 1, fa: 0 }

export async function run() {
  const checks = []
  const add = (id, title) => {
    const c = new Check(id, title)
    checks.push(c)
    return c
  }
  const Q = BB.BLADE_ENSEMBLE.Q
  const inputs = PASSES.map((p) => T.inputsOf(p))

  // ---- B14-1 -----------------------------------------------------------------
  {
    const c = add('B14-1', 'AS CAPTURED: the single exit is rough in every input a pass moves; the fleet flipped every pass; the cities aged from a carried date')
    // The published samples of the life: exitcal's own verdict on them.
    const rep = EC.martingaleTestOf(EC.revisionsOf(FX.exitSamples))
    c.examined(FX.exitSamples.length)
    c.note(`published: ${FX.exitSamples.length} samples, X ${rep.X}, verdict ${rep.verdict} (${rep.reasons.join('; ').slice(0, 160)})`)
    if (!(rep.X > 2) || rep.verdict === 'calibrated') c.fail(`the captured life should read as STRUCTURAL (X > 2): X ${rep.X}, ${rep.verdict}`)
    // One state, the inputs that drift between passes, one at a time.
    const s0 = T.startOf({ ...inputs[0], sleeves: HELD })
    const span = (xs) => Math.max(...xs) - Math.min(...xs)
    const clock = [0, 600, 1200, 1800, 2400, 3000].map((d) => T.hoursOf({ ...s0, skillSinceS: (s0.skillSinceS + d) % 3600 }))
    const kS = [0, 1, 2, 3, 4, 5].map((i) => T.hoursOf({ ...s0, successScale: s0.successScale * (1 + 0.002 * i) }))
    const stam = [-4, -2, 0, 2, 4].map((d) => T.hoursOf({ ...s0, stamina: s0.stamina + d }))
    c.examined(clock.length + kS.length + stam.length)
    c.note(`one state (${inputs[0].at.slice(11, 16)}Z): skill clock 0-50 min ${clock.map(f2).join(' ')} (span ${f2(span(clock))}h); success k +0..1% ${kS.map(f2).join(' ')} (span ${f2(span(kS))}h); stamina +-4 ${stam.map(f2).join(' ')} (span ${f2(span(stam))}h)`)
    if (!(span(clock) > 1.5 && span(kS) > 1)) c.fail('the single exit should move hours on the clock and on a 1% move of k (the roughness this replay is about)')
    // The fleet as published: a change on (nearly) every pass.
    const fleets = PASSES.map((p) => JSON.stringify(p.plan.decisions.bladeRoute.sleeves))
    const changes = fleets.filter((f, i) => i && f !== fleets[i - 1]).length
    c.examined(fleets.length)
    c.note(`the published fleet changed on ${changes} of ${fleets.length - 1} passes: ${fleets.map((f) => JSON.parse(f)).map((x) => `i${x.infiltrate}s${x.support}f${x.fa}`).join(' ')}`)
    if (!(changes >= Math.floor((fleets.length - 1) / 2))) c.fail('the captured fleet should flip on most passes (sleeve.js re-priced every pass)')
    const ages = inputs.map((I) => (Date.parse(I.at) - Date.parse(I.tel.citiesAt)) / 3.6e6)
    c.examined(ages.length)
    c.note(`citiesAt as published ${inputs[0].tel.citiesAt}: the full daemon's fresh reads aged ${f2(Math.min(...ages))}-${f2(Math.max(...ages))}h in the exit`)
    if (!(Math.min(...ages) > 4)) c.fail('the captured records should carry the stale 02:49Z citiesAt')
  }

  // ---- B14-2 -----------------------------------------------------------------
  {
    const c = add('B14-2', `THE MEMBERS: Q ${Q} fixed strata of the clock's phase and the calibrations' posteriors; a start with neither is its own member; the mean moves a fraction of one exit`)
    // The design: every margin a permutation of the Q strata.
    const d = Array.from({ length: Q }, (_, m) => BB.bladeMemberDesign(m, Q))
    const strata = (xs) => [...xs].map((x) => +x.toFixed(6)).sort((a, b) => a - b).join(',')
    const us = Array.from({ length: Q }, (_, m) => (m + 0.5) / Q)
    const zs = us.map((u) => BB.normQuantile(u))
    c.examined(Q * 3)
    if (strata(d.map((x) => x.u)) !== strata(us) || strata(d.map((x) => x.zRank)) !== strata(zs) || strata(d.map((x) => x.zSuccess)) !== strata(zs)) c.fail('each input must take every stratum once (a Latin hypercube)')
    if (d.every((x, m) => x.zRank === d[m].zSuccess)) c.fail('the two calibrations must not be aligned')
    // No clock, no sd: the member is the start (the old single exit, exactly).
    const bare = { ...T.startOf({ ...inputs[0], sleeves: HELD }), skillSinceS: undefined, rankSdLn: 0, successSdLn: 0 }
    const same = Array.from({ length: Q }, (_, m) => BB.bladeMemberOf(bare, m, Q)).every((x) => x.rankScale === bare.rankScale && x.successScale === bare.successScale && x.skillSinceS === undefined)
    c.examined(Q)
    if (!same) c.fail('a start with no skill clock and no posterior sd must be every member (the older fixtures price unchanged)')
    // Pass to pass, the held fleet: the revision of the mean against the single exit's.
    const one = inputs.map((I) => T.priceOf(I, [0], { Q: 1, fleet: HELD }).point)
    const mean = inputs.map((I) => T.priceOf(I, [0], { Q, fleet: HELD }))
    const rev = (xs) => xs.slice(1).map((x, i) => x - (xs[i] - (Date.parse(inputs[i + 1].at) - Date.parse(inputs[i].at)) / 3.6e6))
    const rms = (xs) => Math.sqrt(xs.reduce((a, b) => a + b * b, 0) / xs.length)
    const r1 = rms(rev(one))
    const rQ = rms(rev(mean.map((x) => x.point)))
    c.examined(inputs.length * (Q + 1))
    c.note(`${inputs.length} passes, fleet held i4s1f0: single ${one.map(f2).join(' ')} (revision rms ${f2(r1)}h); mean of ${Q} ${mean.map((x) => f2(x.point)).join(' ')} (rms ${f2(rQ)}h, se ${mean.map((x) => f2(x.seH)).join(' ')})`)
    if (!(rQ < 0.6 * r1)) c.fail(`the members' mean should move well under the single exit pass to pass: ${f2(rQ)}h vs ${f2(r1)}h`)
  }

  // ---- B14-3 -----------------------------------------------------------------
  {
    const c = add('B14-3', "THE PREDICTIVE: the point's se in the revision's predictive; the replayed passes score ~1 with it, ~1000 as published; no seH, no change")
    const rows = (q) => inputs.map((I, i) => ({ at: I.at, ...T.priceOf(I, T.zOf(PASSES[i]), { Q: q, fleet: HELD }) }))
    const old = T.exitcalOf(rows(1))
    const neu = T.exitcalOf(rows(Q))
    c.examined(old.n + neu.n)
    c.note(`replayed revisions (5 min, fleet held): one exit mean z^2 ${f2(old.meanZ2)} (80% cover ${(100 * old.cover80).toFixed(0)}%) -> members with their se ${f2(neu.meanZ2)} (cover ${(100 * neu.cover80).toFixed(0)}%), run X ${neu.X}, rho1 ${neu.rho1}`)
    if (!(old.meanZ2 > 50)) c.fail(`the single exit should be far outside its martingale predictive: mean z^2 ${f2(old.meanZ2)}`)
    if (!(neu.meanZ2 > 0.2 && neu.meanZ2 < 3)) c.fail(`the members with their se should score near 1: mean z^2 ${f2(neu.meanZ2)}`)
    // A sample with no seH: the old predictive exactly.
    const rv = { sdA: 4, a: 40, dh: 0.25, u: 1 }
    const sd0 = EC.martingaleSdOf(rv)
    const sd1 = EC.martingaleSdOf({ ...rv, seA: 0, seB: 0 })
    const sd2 = EC.martingaleSdOf({ ...rv, seA: 2, seB: 2 })
    c.examined(3)
    if (!(Math.abs(sd0 - 4 * Math.sqrt(0.25 / 40)) < 1e-12 && sd1 === sd0)) c.fail('no published error must leave the martingale sd as it was (BN4)')
    if (!(Math.abs(sd2 - Math.sqrt(16 * 0.25 / 40 + 8)) < 1e-12)) c.fail('the endpoints\' errors must add in quadrature')
    const revs = EC.revisionsOf([{ at: '2026-10-04T09:00:00Z', exitH: 40, q10: 35, q90: 45, seH: 2, life: 1, ver: 'v', boot: 'b' }, { at: '2026-10-04T09:15:00Z', exitH: 41, q10: 36, q90: 46, life: 1, ver: 'v', boot: 'b' }])
    c.examined(1)
    if (!(revs[0].seA === 2 && revs[0].seB === 0)) c.fail('revisionsOf must carry each end\'s seH (0 where none)')
  }

  // ---- B14-4 -----------------------------------------------------------------
  {
    const c = add('B14-4', "THE RANK POSTERIOR: the windows' own scatter is the observation sd; the 03:37Z move is inside the posterior")
    const W = FX.rankWindows
    // The fixture's windows are v2 (one path from the opening state): the pooled-scatter arithmetic is the same under v3.
    const steps = W.map((_, i) => BB.rankRatePosterior(W.slice(0, i + 1), { v: 2 }))
    c.examined(W.length)
    c.note(`windows ${W.map((w) => w.lnK.toFixed(2)).join(' ')}: k ${steps.map((s) => s.k).join(' ')}, sdLn ${steps.map((s) => s.sdLn).join(' ')}, window sd ${steps.map((s) => s.obsSdLn).join(' ')}`)
    if (!steps.every((s) => s.obsSdLn >= 0.3 - 1e-9)) c.fail('the observation sd is never below the stated one')
    if (!(steps.at(-1).obsSdLn > 0.35)) c.fail(`the live windows' scatter (sd ~0.44) should widen the observation sd: ${steps.at(-1).obsSdLn}`)
    const move = Math.abs(steps[1].lnK - steps[0].lnK) / steps[0].sdLn
    c.note(`the 03:37Z window moved ln k by ${f2(move)} of the posterior sd before it`)
    if (!(move < 2)) c.fail('the second window should move k inside its posterior (< 2 sd)')
    // The members span it: k at the n=1 posterior's member quantiles reaches the n=2 point.
    const lo = Math.exp(steps[0].lnK + steps[0].sdLn * Math.min(...Array.from({ length: Q }, (_, m) => BB.bladeMemberDesign(m, Q).zRank)))
    const hi = Math.exp(steps[0].lnK + steps[0].sdLn * Math.max(...Array.from({ length: Q }, (_, m) => BB.bladeMemberDesign(m, Q).zRank)))
    c.examined(1)
    c.note(`the n=1 members span k ${f2(lo)}-${f2(hi)}; the n=2 point ${steps[1].k}`)
    if (!(steps[1].k >= lo && steps[1].k <= hi * 1.05)) c.fail('the members of the n=1 posterior should reach the n=2 point')
  }

  // ---- B14-5 -----------------------------------------------------------------
  {
    const c = add('B14-5', "THE CITIES DATED BY THEIR READ: a full bladeburner.js record's cities are dated at its `at`")
    const rec = { ...PASSES.at(-1).tel, bitNode: 14, joined: true, daemon: 'bladeburner.js' }
    const carried = BB.divisionCarryOf(rec, 14)
    const stale = BB.divisionCarryOf({ ...rec, staleSince: '2026-10-04T05:00:00Z', citiesAt: undefined }, 14)
    const lite = BB.divisionCarryOf({ ...rec, daemon: 'bb-lite' }, 14)
    c.examined(3)
    c.note(`full record at ${rec.at} carrying citiesAt ${rec.citiesAt}: dated ${carried.citiesAt}`)
    if (carried.citiesAt !== rec.at) c.fail(`a full read must date its cities at its own at: ${carried.citiesAt}`)
    if (stale.citiesAt !== '2026-10-04T05:00:00Z') c.fail('a stale record dates its cities at staleSince')
    if (lite.citiesAt !== rec.citiesAt) c.fail("another daemon's record keeps the carried date")
    if (!/citiesAt: new Date\(now\)\.toISOString\(\)/.test(SRC('bladeburner.js'))) c.fail('bladeburner.js must publish citiesAt with every full read')
    // The model: a fresh read is not aged.
    const s = T.startOf({ ...inputs.at(-1), tel: { ...inputs.at(-1).tel, citiesAt: inputs.at(-1).at } })
    c.examined(1)
    if (!(s.citiesAgeH < 0.1)) c.fail(`a fresh read must price at age ~0: ${s.citiesAgeH}`)
  }

  // ---- B14-6 -----------------------------------------------------------------
  {
    const c = add('B14-6', "THE FLEET: members' means decide, the incumbent stands inside z se; the re-price key is not a 'now' install's installAt")
    // Two sleeves (6 configurations x Q members): cheap enough for the suite.
    const s0 = T.startOf(inputs.at(-1))
    const runs = []
    for (const inc of [null, { infiltrate: 0, support: 2, fa: 0 }, { infiltrate: 0, support: 0, fa: 2 }]) runs.push(await Promise.resolve(drainGen(SP.bladeFleetGen(s0, 2, inc, { Q }))))
    const [free] = runs
    c.examined(runs.length)
    c.note(`2 sleeves, members: ${free.byConfig.map((x) => `i${x.infiltrate}s${x.support}f${x.fa} ${x.hours}h (se ${x.seH})`).join(', ')}; picked ${JSON.stringify(free.config)}`)
    if (!free.byConfig.every((x) => Number.isFinite(x.seH))) c.fail('every configuration must carry its se')
    for (const [i, inc] of [[1, { infiltrate: 0, support: 2, fa: 0 }], [2, { infiltrate: 0, support: 0, fa: 2 }]]) {
      const r = runs[i]
      const row = free.byConfig.find((x) => x.infiltrate === inc.infiltrate && x.support === inc.support && x.fa === inc.fa)
      const best = free.byConfig[0]
      if (!row) continue
      const tol = Math.max(SP.FLEET_KEEP.h, SP.FLEET_KEEP.rel * best.hours, SP.FLEET_KEEP.z * Math.hypot(row.seH, best.seH))
      const keep = row.hours - best.hours <= tol + 0.02
      c.examined(1)
      c.note(`incumbent i${inc.infiltrate}s${inc.support}f${inc.fa} ${row.hours}h vs best ${best.hours}h (tolerance ${f2(tol)}h): ${JSON.stringify(r.config)}`)
      const kept = r.config.infiltrate === inc.infiltrate && r.config.support === inc.support && r.config.fa === inc.fa
      if (keep !== kept) c.fail(`the incumbent should ${keep ? 'stand' : 'yield'} at a lead of ${f2(row.hours - best.hours)}h against ${f2(tol)}h`)
    }
    const sl = SRC('sleeve.js')
    c.examined(2)
    if (/Math\.round\(basis\.installAt \/ 900e3\)/.test(sl)) c.fail("sleeve.js's memo key still reads the install's installAt (a held 'now' changes it every pass)")
    if (!/bladeFleetGen\(s0, n, incumbent\.config, \{ Q: BLADE_ENSEMBLE\.Q \}\)/.test(sl)) c.fail('sleeve.js must choose the fleet on the members')
  }

  // ---- B14-7 -----------------------------------------------------------------
  {
    const c = add('B14-7', "THE CHECKS read the point's se: TWO EXITS AT INSTALL (09:13Z), EXIT UNSTABLE, the install guard")
    // 09:13Z live: 'now' 43.755h against the commitment w0.083 36.986h priced 15 min earlier.
    const base = { key: 'now', meanH: 43.755, pointH: 43.963, n: 24, commitment: { key: 'w0.083', meanH: 36.986, pointH: 36.977, at: '2026-10-04T08:57:22.534Z' } }
    const now = Date.parse('2026-10-04T09:12:22.609Z')
    const before = P.installExitsOf(base, { now })
    // The point's se as the members give it on the 09:12Z pass (the install 'now', i0s0f5 as published).
    const se = +T.priceOf(inputs[0], [0], { Q, spec: { firstH: 0, gains: PASSES[0].plan.decisions.bladeRoute.installBasis?.blade?.gains ?? null } }).seH.toFixed(3)
    const after = P.installExitsOf({ ...base, pointSeH: se, commitment: { ...base.commitment, pointSeH: se } }, { now })
    c.examined(2)
    c.note(`as published (no se): ${before.why.slice(0, 140)}; with the points' se ${se}h each: ${after.why.slice(0, 140)}`)
    if (before.ok !== false) c.fail('the captured pair should read TWO EXITS AT INSTALL without the se')
    if (after.ok !== true) c.fail(`two prices of one trajectory 7h apart are one exit at a point se of ${se}h each (tolerance 4 x hypot)`)
    const pr = SRC('progress.js')
    const pl = SRC('plan.js')
    const ig = SRC('installgate.js')
    c.examined(3)
    if (!/withPoint\(seOf\(px, prev\.decisions\?\.install\), prev\.decisions\?\.install\)/.test(pl)) c.fail("EXIT UNSTABLE must read the point's se")
    if (!/1\.645 \* Math\.hypot\(seNow, seNever\)/.test(pr)) c.fail("the install guard's scatter must be the saving's se with members")
    if (!/the points' own error/.test(ig)) c.fail("the guard's margin must say what it is")
  }

  // ---- B14-8 -----------------------------------------------------------------
  {
    const c = add('B14-8', 'WIRING: the route and the install decision price members per draw; the samples carry seH; the start carries the posteriors; the calibration state restarts on the new predictive')
    const pr = SRC('progress.js')
    const pl = SRC('plan.js')
    const need = [
      [pl, /bladeExitGen\(bladeMemberOf\(bladeStart \?\? bladeStartAt\(/, 'plan.decideBladeRouteGen: each draw on its member'],
      [pl, /bladeExitMeanGen\(null, \{ Q, hoursOfMember: \(m\) => bladeH\(base\?\.cycleHours, m\) \}\)/, "plan.decideBladeRouteGen: the point is the members' mean"],
      [pr, /bladeExitGen\(bladeMemberOf\(bc\.startFor\(spec\), m, Q\)\)/, 'progress.bladeInstallCompareOf: each option on the members'],
      [pr, /fg: function\* \(inp, d\) \{ return yield\* hoursOf\(spec, memberOfDraw\(d\)\) \}/, 'progress.bladeInstallCompareOf: draw i on member i mod Q'],
      [pr, /rankSdLn: rankPost0\.sdLn, successSdLn: sCal\.sdLn/, 'progress.bladeRouteOf: the posteriors into the start'],
      [pr, /seH: b\.pointSeH/, "progress.js: the install decision's sample carries its se"],
      [pl, /pointSeH = typeof o\.seOf === 'function' \? o\.seOf\(\) : null/, "plan.decideInstallGen: the record and its commitment carry the point's se"],
    ]
    for (const [src, re, what] of need) {
      c.examined(1)
      if (!re.test(src)) c.fail(`missing: ${what}`)
    }
    c.examined(1)
    if (!(EC.EXITCAL.stateVersion >= 2)) c.fail('the calibration state must restart on the new predictive (stateVersion 2)')
  }
  return checks
}

function drainGen(g) {
  let r = g.next()
  while (!r.done) r = g.next()
  return r.value
}
