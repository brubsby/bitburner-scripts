// [B4] THE BLACK-OP EXIT ON BN4.3 — the forecast that fell 2.5h per hour.
//
// Live BN4.3 2026-10-02/03 the Bladeburner exit (bbplan.bladeExit, the plan's
// committed route) fell 2.35, 6.28 and (life 5's first 1.75h) 6.4h per wall
// hour against the 1 a calibrated forecast falls (exitcal.js: t -2.6, X 3.18,
// PLAN MISCALIBRATED e-process 3.5e11). The model's mechanics were not the
// cause — replayed with the inputs AS THEY RAN it is calibrated (B4-7) — its
// INPUTS and its definitions were (tools/sim/bbcal4.mjs):
//
//   B4-1 AS CAPTURED: the published exit per life; the bb-lite lives fell 2-6h per hour
//   B4-2 THE UNREAD CITIES: bb-lite reads no city and the model priced six at the START's order
//        statistics at any age; now cityPriorOf(the division's age) — the game's start and its
//        random events (bbcityprior.mjs regenerates CITY_PRIOR) — and on the 01:24Z state the
//        prior's exit is the mean exit over cities drawn from the mechanics (the old default was
//        2.5h pessimistic with the fleet)
//   B4-3 OTHER UNREAD INPUTS: an action count bb-lite does not read (Raid) is its start's mean plus
//        its growth since the join (joinedAtOf on the record); bb-lite carries the full daemon's
//        last city reads (dated, aged in expectation) and its success calibration (carriedOf)
//   B4-4 A BLACK OP'S CHANCE IS THE FORMULA'S: the success calibration (measured on city-dependent
//        actions) no longer lifts it — the daemon gates on the shown chance (live 09:59Z: Typhoon
//        0.738 deferred; the model attempted at 0.738 x 1.206 = 0.89)
//   B4-5 THE FLEET OF ANOTHER LIFE: sleeve.txt from before the install prices nobody (Sleeve.prestige
//        stops every sleeve; live 03:08-09:20Z all five idled while the route priced i1s4)
//   B4-6 THE RANK k, ONE DEFINITION (v2): a window counts only on the full daemon, every city read,
//        this life's fleet — the planner applies what it measures (the model's error alone)
//   B4-7 LIFE 5 AS RUN: from the 02:41Z state (life 4) with the 03:08Z install, the fleet as the
//        sleeves ran and bb-lite to its handover, the model's finish is the one it gives from the
//        09:59Z capture to within 1.5h (7.3h apart: -1 h/h)
//   B4-8 THE RECORDER (09:59Z on, the full daemon, the fleet running): this model's revisions fall
//        ~1h per hour and its rank path is the game's to 25% over the next 0.5h
//   B4-9 THE LEAN PHASE: bb-lite's policy (no Raid, pinned levels, one city, team 0) while it acts,
//        the full daemon's after (a {full} step, or leanUntilH)
//   B4-10 WIRING

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const C = await import('../sim/bbcal4.mjs')
const BB = C.BB
const LP = await import('bbliteplan.js')
const { priorRow, rngOf } = await import('../sim/bbcityprior.mjs')
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const H = C.H0124
const G = C.G0241
const L5 = C.L5
const ms = (s) => Date.parse(s)
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))

export async function run() {
  const checks = []
  const add = (id, title) => {
    const c = new Check(id, title)
    checks.push(c)
    return c
  }

  // ---- B4-1 ----------------------------------------------------------------
  {
    const c = add('B4-1', 'AS CAPTURED: the published exit fell 2-6h per wall hour on the bb-lite lives of BN4.3')
    const lives = C.publishedRevisions()
    c.examined(lives.length)
    for (const l of lives) c.note(`life ${l.life} ${l.from.slice(11, 16)}-${l.to.slice(11, 16)}Z: ${l.n} samples over ${f2(l.hours)}h, ${f2(l.perH)} h/h`)
    const lite = lives.filter((l) => l.life === 1790968861655 || l.life === 1790985409081)
    const hw = lite.reduce((a, l) => a + l.perH * l.hours, 0) / lite.reduce((a, l) => a + l.hours, 0)
    c.note(`the bb-lite lives, hour-weighted: ${f2(hw)} h/h`)
    if (lite.length !== 2 || !(hw < -2)) c.fail('the fixture does not reproduce the bb-lite lives falling faster than 2h per hour')
  }

  // ---- B4-2 ----------------------------------------------------------------
  {
    const c = add('B4-2', "THE UNREAD CITIES: the division's age, from the game's mechanics (CITY_PRIOR regenerated); the prior prices the mean exit over drawn cities, the start's order statistics did not")
    for (const age of [0, 6, 24]) {
      const row = priorRow(age, 600, 7)
      const tab = BB.cityPriorOf(age)
      c.examined(6)
      tab.forEach((x, k) => {
        if (Math.abs(x.pop / 1e9 / row.pop[k] - 1) > 0.06) c.fail(`CITY_PRIOR at ${age}h rank ${k}: ${f2(x.pop / 1e9)}e9 vs regenerated ${row.pop[k]}e9 (600 seeds)`)
      })
    }
    // At age 0 it is City.ts's start: populations U[1e9, 1.5e9] -> the six order statistics k/7.
    const t0 = BB.cityPriorOf(0).map((x) => x.pop / 1e9)
    c.examined(1)
    if (!t0.every((p, k) => Math.abs(p - (1.5 - (0.5 * (k + 1)) / 7)) < 0.02)) c.fail(`the age-0 prior is not the start's order statistics: ${t0.map(f2)}`)
    // The exit on the prior against the exit over cities drawn from the mechanics, the 01:24Z state (bb-lite, no city read), the fleet that ran.
    const mults = C.levelled(H.player.mults)
    const sleeves = { infiltrate: 2, support: 3, fa: 0 }
    const s = BB.bladeStartOf({ tel: { ...H.bladeburner, joinedAt: C.JOINED_AT }, person: { ...H.player, mults }, sleeves, gymExpPerSec: 14.1, install: null, rankScale: 1, successScale: 1, now: ms(H.bladeburner.at) })
    const ageH = s.divisionAgeH
    const prior = BB.bladeExit(s).hours
    const old = BB.bladeExit({ ...s, cities: BB.cityPriorOf(0) }).hours
    const xs = []
    for (let k = 0; k < 24; k++) {
      const rng = rngOf(1000 + k * 7919)
      const ri = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1))
      const cs = BB.CITY_NAMES.map((name) => ({ name, pop: ri(1e9, 1.5e9), comms: ri(5, 150), chaos: 0 }))
      let t = ri(240, 600)
      let last = 0
      while (t <= ageH * 3600) {
        for (const x of cs) x.chaos = Math.max(0, x.chaos - 0.0001 * (t - last))
        last = t
        BB.drawCityEvent(cs, rng)
        t += ri(240, 600)
      }
      xs.push(BB.bladeExit({ ...s, cities: cs }).hours)
    }
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    c.examined(xs.length + 2)
    c.note(`01:24Z, age ${f2(ageH)}h, fleet i2s3: exit on the prior ${f2(prior)}h; mean over ${xs.length} drawn city sets ${f2(mean)}h (${f2(Math.min(...xs))}-${f2(Math.max(...xs))}); on the start's order statistics (the old default) ${f2(old)}h; on the cities read at 02:41Z ${f2(BB.bladeExit({ ...s, cities: G.bladeburner.cities.map((x) => ({ ...x })) }).hours)}h`)
    if (Math.abs(prior - mean) > 1.5) c.fail(`the prior's exit ${f2(prior)}h is not the mean over drawn cities ${f2(mean)}h (1.5h)`)
    if (!(old - mean > 1.5)) c.fail(`the old default is no longer the pessimistic one (${f2(old)}h vs ${f2(mean)}h): the incident is not reproduced`)
  }

  // ---- B4-3 ----------------------------------------------------------------
  {
    const c = add('B4-3', "OTHER UNREAD INPUTS: a count bb-lite does not read grows from the join; the division's age and the full daemon's reads ride on the record")
    c.note('Raid unread at 01:24Z: the start\'s mean (75.5) before; its mean plus growth since the join now; the full daemon read 218.4 at 02:41Z')
    const s = BB.bladeStartOf({ tel: { ...H.bladeburner, joinedAt: C.JOINED_AT }, person: { ...H.player, mults: C.levelled(H.player.mults) }, sleeves: {}, gymExpPerSec: 14.1, now: ms(H.bladeburner.at) })
    const r = BB.bladeExit({ ...s, snapAtS: 0, maxH: 0.1 })
    const raid = r.snap?.st?.counts?.Raid
    const want = (1 + 150) / 2 + (2.1 / 480) * s.divisionAgeH * 3600
    c.examined(2)
    if (H.bladeburner.counts.Raid !== undefined) c.fail('the bb-lite record reads Raid: the incident is not reproduced')
    // (the start's owed rest, before the first step, grows it a little more: <= 0.3h at 15.75/h)
    if (!(raid >= want - 1e-6 && raid - want < 5)) c.fail(`Raid's unread count ${f2(raid)} is not its start's mean + growth over ${f2(s.divisionAgeH)}h (${f2(want)}); the live count at 02:41Z was ${G.bladeburner.counts.Raid}`)
    // joinedAtOf: kept from the record before (same node), started by the first joined record, never from another node.
    const node = 4
    const t = '2026-10-02T19:57:00.000Z'
    c.examined(4)
    if (BB.joinedAtOf({ bitNode: 4, joinedAt: t }, node, true, 'x') !== t) c.fail('joinedAtOf does not keep the record before')
    if (BB.joinedAtOf({ bitNode: 6, joinedAt: t }, node, true, 'now') !== 'now') c.fail("joinedAtOf keeps another node's join")
    if (BB.joinedAtOf(null, node, false, 'now') !== null) c.fail('joinedAtOf dates a division not joined')
    if (BB.bladeStartOf({ tel: { ...G.bladeburner, joinedAt: t }, person: { ...G.player, mults: C.levelled(H.player.mults) }, now: ms(G.bladeburner.at) }).divisionAgeH.toFixed(2) !== ((ms(G.bladeburner.at) - ms(t)) / 3.6e6).toFixed(2)) c.fail('bladeStartOf does not read the age off joinedAt')
    // carriedOf: the full daemon's cities (dated) and calibration survive bb-lite's record.
    const full = { ...G.bladeburner, calibration: { success: { k: 1.2, groups: [{ p: 0.4, n: 10, s: 6 }] } } }
    const car = LP.carriedOf(full, { currentNode: 4 })
    const rec = LP.liteRecordOf({ info: { currentNode: 4, lastAugReset: 1 }, host: 'h', result: 'acting', joined: true, carried: car })
    c.examined(3)
    if (!car || car.cities !== full.cities || car.citiesAt !== full.at || car.calibration?.success?.k !== 1.2) c.fail('carriedOf does not carry the cities (dated at the full record) and the success calibration', JSON.stringify(car)?.slice(0, 200))
    if (LP.carriedOf(full, { currentNode: 6 }) !== null) c.fail("carriedOf carries another node's reads")
    if (rec.cities !== full.cities || rec.calibration?.success?.k !== 1.2) c.fail("bb-lite's record does not publish what it carries")
    // Carried cities are aged in expectation: the same cities an hour old price a (weakly) different, deterministic start.
    const a = BB.bladeStartOf({ tel: { ...G.bladeburner, citiesAt: G.bladeburner.at }, person: { ...G.player, mults: C.levelled(H.player.mults) }, now: ms(G.bladeburner.at) })
    const b = BB.bladeStartOf({ tel: { ...G.bladeburner, citiesAt: new Date(ms(G.bladeburner.at) - 3 * 3.6e6).toISOString() }, person: { ...G.player, mults: C.levelled(H.player.mults) }, now: ms(G.bladeburner.at) })
    c.examined(1)
    if (!(Math.abs(b.citiesAgeH - 3) < 1e-9 && a.citiesAgeH === 0)) c.fail('bladeStartOf does not read the cities\' age off citiesAt', `${a.citiesAgeH} ${b.citiesAgeH}`)
  }

  // ---- B4-4 ----------------------------------------------------------------
  {
    const c = add('B4-4', "A BLACK OP'S CHANCE IS THE FORMULA'S: the success calibration does not lift it (the daemon gates on the shown chance)")
    const cap = L5.captures[0]
    const s = C.startAt(BB, cap, { definition: 'new' })
    const at = []
    BB.bladeExit({ ...s, actTrace: at, maxH: 0.05 })
    const bo = BB.BLACK_OPS[cap.tel.blackOps.done]
    // The model's view of the next black op at the start: its chance at the formula (successScale out).
    const shown = cap.tel.blackOps.formulaChance
    const rr = BB.bladeExit({ ...s, snapAtS: 0, maxH: 0.01 })
    c.examined(2)
    c.note(`09:59Z: ${bo.name} shown ${shown} (daemon: ${cap.tel.blackOps.chance}), the success calibration ${s.successScale}; the model's first step: ${at[0]?.name} (${at[0]?.why?.slice(0, 80)})`)
    if (!(s.successScale > 1.1)) c.fail('the capture carries no success calibration above 1: the incident is not reproduced')
    if (at[0]?.name === bo.name && shown < BB.POLICY.blackThr) c.fail(`the model attempts ${bo.name} at a shown ${shown} < blackThr ${BB.POLICY.blackThr}`)
    if (!rr) c.fail('no snapshot')
  }

  // ---- B4-5 ----------------------------------------------------------------
  {
    const c = add('B4-5', "THE FLEET OF ANOTHER LIFE: sleeve.txt from before this life's install prices nobody")
    const life = 1790996897734
    const rec = { at: '2026-10-03T02:55:00.000Z', bitNode: 4, blade: { config: { infiltrate: 1, support: 4, fa: 0 }, why: 'x' } }
    const stale = BB.bladeFleetOf(rec, { lifeStart: life })
    const fresh = BB.bladeFleetOf({ ...rec, at: '2026-10-03T09:21:00.000Z' }, { lifeStart: life })
    const legacy = BB.bladeFleetOf(rec)
    c.examined(3)
    if (stale.source !== 'stale' || stale.sleeves.infiltrate + stale.sleeves.support + stale.sleeves.fa !== 0) c.fail('a record from before the install still prices a fleet', JSON.stringify(stale))
    if (fresh.source !== 'committed' || fresh.sleeves.support !== 4) c.fail("this life's committed fleet is not priced", JSON.stringify(fresh))
    if (legacy.source !== 'committed') c.fail('without a life start the record is read as before')
    // What it was worth live: the 09:59Z state priced with the stale fleet against none.
    const cap = L5.captures[0]
    const none = BB.bladeExit(C.startAt(BB, cap, { definition: 'new', extra: { sleeves: { infiltrate: 0, support: 0, fa: 0 } } })).hours
    const i1s4 = BB.bladeExit(C.startAt(BB, cap, { definition: 'new', extra: { sleeves: { infiltrate: 1, support: 4, fa: 0 } } })).hours
    c.examined(2)
    c.note(`09:59Z state: no fleet ${f2(none)}h, the stale i1s4 ${f2(i1s4)}h — the six hours 03:08-09:20Z were priced ${f2(none - i1s4)}h short`)
  }

  // ---- B4-6 ----------------------------------------------------------------
  {
    const c = add('B4-6', 'THE RANK k, ONE DEFINITION (v2): a window only where the model\'s own trajectory runs; v1 windows are dropped')
    const ok = BB.rankWindowOkOf({ tel: G.bladeburner, fleetSource: 'committed' })
    const lite = BB.rankWindowOkOf({ tel: H.bladeburner, fleetSource: 'committed' })
    const unread = BB.rankWindowOkOf({ tel: { ...G.bladeburner, cities: G.bladeburner.cities.map((x, k) => (k ? x : { ...x, pop: null })) }, fleetSource: 'committed' })
    const stale = BB.rankWindowOkOf({ tel: G.bladeburner, fleetSource: 'stale' })
    c.examined(4)
    if (!ok.ok || lite.ok || unread.ok || stale.ok) c.fail('rankWindowOkOf: the full daemon on read cities and a live fleet only', JSON.stringify({ ok, lite, unread, stale }))
    // The live windows (plan.txt calibration.rank.samples, v1): every one dropped, k back to the prior.
    const cap = L5.captures.at(-1)
    const v1 = cap.plan.calibration.rank.samples ?? []
    const post = BB.rankRatePosterior(v1)
    c.examined(v1.length)
    c.note(`the ${v1.length} live v1 windows (realised/model ${v1.map((x) => Math.exp(x.lnK).toFixed(2)).join(' ')}) applied k ${cap.plan.calibration.rank.applied}; under v2: ${post.why}`)
    if (v1.length && post.n !== 0) c.fail('v1 windows still enter the posterior')
  }

  // ---- B4-7 ----------------------------------------------------------------
  {
    const c = add('B4-7', 'LIFE 5 AS RUN: from 02:41Z (life 4) through the 03:08Z install, the fleet and the daemon as they ran, the finish is the one the 09:59Z capture gives (-1h per hour)')
    const m4 = C.levelled(H.player.mults)
    const cap = L5.captures[0]
    const m5 = C.levelled(cap.player.mults)
    const gains = {}
    for (const k of BB.BLADE_GAIN_KEYS) if (m5[k] / m4[k] !== 1) gains[k] = m5[k] / m4[k]
    const T0 = ms(G.bladeburner.at)
    const instH = (ms(L5.installAt) - T0) / 3.6e6
    const person = { skills: G.player.skills, exp: G.player.exp, mults: m4, city: 'Sector-12', money: 1e9 }
    const gym = C.gymRateOf(person)
    const s = BB.bladeStartOf({ tel: { ...G.bladeburner, joinedAt: C.JOINED_AT }, person, sleeves: { infiltrate: 2, support: 3, fa: 0 }, gymExpPerSec: gym, install: { firstH: instH, gains }, rankScale: 1, successScale: 1, policy: BB.POLICY_V1, now: T0 }) // BN4.3 ran POLICY_V1
    const SL = (i, sup) => ({ infiltrate: i, support: sup, fa: 0 })
    const asRun = { ...s, lean: { untilH: instH + C.LIFE5_LEAN_H, city: null }, steps: [{ atH: instH, sleeves: SL(0, 0) }, { atH: (ms(C.SLEEVES_BACK_AT) - T0) / 3.6e6, sleeves: SL(3, 2) }] }
    const r0 = BB.bladeExit(asRun)
    const finish0 = T0 + r0.hours * 3.6e6
    const r1 = BB.bladeExit(C.startAt(BB, cap, { definition: 'new', extra: { successScale: 1 } }))
    const finish1 = ms(cap.tel.at) + r1.hours * 3.6e6
    const dH = (ms(cap.tel.at) - T0) / 3.6e6
    const rev = (finish1 - finish0) / 3.6e6 // a calibrated forecast: 0 (the finish does not move)
    c.examined(2)
    c.note(`from 02:41Z as run: finish ${new Date(finish0).toISOString().slice(5, 16)}Z; from the 09:59Z capture: ${new Date(finish1).toISOString().slice(5, 16)}Z — the finish moved ${f2(rev)}h over ${f2(dH)}h (${f2(-1 + rev / dH)} h/h)`)
    // The same replay on the full daemon throughout and no fleet (the inputs the old pipeline would have assumed): the drift it read.
    const naive = BB.bladeExit({ ...s, sleeves: SL(0, 0) })
    c.note(`  the same start with the sleeves idle throughout and the full daemon from the install: finish ${new Date(T0 + naive.hours * 3.6e6).toISOString().slice(5, 16)}Z`)
    if (Math.abs(rev) > 1.5) c.fail(`the finish moved ${f2(rev)}h over ${f2(dH)}h on the inputs as they ran (1.5h)`)
  }

  // ---- B4-8 ----------------------------------------------------------------
  {
    const c = add('B4-8', 'THE RECORDER (09:59Z on, the full daemon, the fleet running): this model falls ~1h per hour and its rank path is the game\'s')
    const ln = C.life5(BB, { definition: 'new' })
    c.examined(ln.rows.length)
    c.note(`${ln.rows.length} captures ${ln.rows[0].at.slice(11, 16)}-${ln.rows.at(-1).at.slice(11, 16)}Z: exits ${ln.rows.map((r) => f2(r.y)).join(' ')}; ${f2(ln.perH)} h/h (published ${f2(ln.pubPerH)})`)
    if (!(ln.perH > -1.8 && ln.perH < -0.3)) c.fail(`the revision is ${f2(ln.perH)} h per hour`)
    const rs = ln.ratios
    c.examined(rs.length)
    if (rs.length) {
      const mean = rs.reduce((a, r) => a + r.ratio, 0) / rs.length
      c.note(`realised / model rank gain over ~${f2(rs[0].h)}h: ${rs.map((r) => r.ratio.toFixed(2)).join(' ')} (mean ${mean.toFixed(3)})`)
      if (!(mean > 0.8 && mean < 1.25)) c.fail(`the rank path is off by ${mean.toFixed(2)}`)
    }
  }

  // ---- B4-9 ----------------------------------------------------------------
  {
    const c = add('B4-9', "THE LEAN PHASE: bb-lite's policy while it acts (no Raid, pinned levels, one city, team 0); a {full} step ends it")
    const s = BB.bladeStartOf({ tel: { ...G.bladeburner, joinedAt: C.JOINED_AT }, person: { ...G.player, mults: C.levelled(H.player.mults) }, sleeves: { infiltrate: 0, support: 3, fa: 0 }, gymExpPerSec: 14.1, now: ms(G.bladeburner.at) })
    const at = []
    const lean = BB.bladeExit({ ...s, lean: { untilH: Infinity, city: null }, actTrace: at })
    const full = BB.bladeExit(s)
    const stepped = BB.bladeExit({ ...s, lean: { untilH: Infinity, city: null }, steps: [{ atH: 0, full: true }] })
    const ops = at.filter((x) => x.level !== null)
    c.examined(ops.length + 2)
    if (at.some((x) => x.name === 'Raid')) c.fail('the lean phase raided')
    if (!(lean.hours > full.hours)) c.fail(`the lean policy is not slower (${f2(lean.hours)} vs ${f2(full.hours)}h)`)
    if (Math.abs(stepped.hours - full.hours) > 1e-9) c.fail(`a {full} step at 0h is not the full daemon from the start (${stepped.hours} vs ${full.hours})`)
    c.note(`02:41Z, support 3: lean throughout ${f2(lean.hours)}h, full ${f2(full.hours)}h`)
    // bb-lite's own start: the record says who acts.
    const st = BB.bladeStartOf({ tel: H.bladeburner, person: { ...H.player, mults: C.levelled(H.player.mults) }, leanUntilH: 0.8, now: ms(H.bladeburner.at) })
    c.examined(1)
    if (st.lean?.untilH !== 0.8) c.fail('bladeStartOf does not put the lean phase in a bb-lite start')
  }

  // ---- B4-10 ---------------------------------------------------------------
  {
    const c = add('B4-10', 'WIRING: the route prices the fleet of this life, the lean phase and only v2 windows; the daemons date the division and bb-lite carries the full reads')
    const pr = SRC('progress.js')
    const need = [
      [pr, /bladeFleetOf\(ours \? fleet : null, \{ lifeStart: info\.lastAugReset \}\)/, 'progress.js: no fleet from before the install'],
      [pr, /leanUntilOf\(tel, /, 'progress.js: the lean phase'],
      [pr, /rankWindowOkOf\(\{ tel, fleetSource: fl\.source \}\)/, 'progress.js: v2 rank windows'],
      [SRC('bladeburner.js'), /joinedAt: \(joinedAt \?\?= joinedAtOf\(prevRec, info\.currentNode, true\)\)/, 'bladeburner.js: the division dated'],
      [SRC('bb-lite.js'), /joinedAt: \(joinedAt \?\?= joinedAtOf\(prevRec, info\.currentNode, true\)\)/, 'bb-lite.js: the division dated'],
      [SRC('bb-lite.js'), /const carried = carriedOf\(prevRec, info\)/, 'bb-lite.js: the full reads carried'],
      [SRC('homeplan.js'), /rankStep = \{ atH: buyAtH, full: true \}/, 'homeplan.js: the full daemon as a policy step on a lean start'],
    ]
    for (const [src, re, what] of need) {
      c.examined(1)
      if (!re.test(src)) c.fail(`missing: ${what}`)
    }
  }
  return checks
}
