// [BI] THE INSTALL ON THE COMMITTED BLADEBURNER ROUTE — live BN6 2026-10-01.
//
// The plan committed the Bladeburner route (decisions.bladeRoute 'blade',
// exit ~29h by the 21 black ops) while the install decision kept pricing on
// the hacking route: the plan's 'now' 188.3h against its commitment w0.083
// at 236.9h (TWO EXITS AT INSTALL), the gate's exitH 130.1h beside plan.txt's
// exit 29.1h, and the 10:17Z install priced at 155.8h whose next life
// published 29.2h (EXIT JUMP AT INSTALL). An install was timed on a
// trajectory the run was not on.
//
// Fixture: tools/test/fixture-bn6-bladeinstall-1107.json, captured from the
// live game at ~11:07Z (plan.txt, installgate.txt, exitinputs.txt,
// bladeburner.txt, install-last.txt, the save for the player's multipliers,
// snap-augstats for the batch's augmentations, history.jsonl/act-history.txt
// for the 10:27Z gym incident).
//
//   BI1 BEFORE, AS CAPTURED: the install decision and the gate priced the hacking route while the
//       route was 'blade' — two exit families in one plan (the incident, reproduced from the record)
//   BI2 AFTER: on the live state every install option (now / each future's batch / never) is the
//       black-op exit (bbplan.bladeExit of that option's install, through the route's own start);
//       the decision, the gate's exitH and the actor's install-now exit are those numbers
//   BI3 ONE EXIT: the route's blade arm priced on the committed install plan is the install
//       decision's committed option (same trajectory, same noise key, same draws) — equal; TWO EXITS
//       at an elapsed 'now' on this route passes; a hack-priced incumbent is not this decision's
//   BI4 WHAT AN INSTALL DOES ON THIS ROUTE, per the game source: rank/skills/black ops persist (no
//       re-join), combat resets and is retrained, combat and bladeburner_* multipliers move the exit,
//       the Simulacrum runs the gym beside the actions; a life that starts below the bar retrains
//   BI5 THE BLADE'S SIMULACRUM priced on the exit: live — unreachable before the exit (money), with
//       the reputation reach and the no-cost bound stated; affordable — bought when it shortens it
//   BI6 THE GATE on the blade route: the plan's blade decision installs or holds; the Daedalus count
//       and the hacking M do not
//   BI7 THE 10:27Z GYM: bladeburner.js re-reads the claim right before startAction and treats an
//       order batch newer than the claim that starts work as a handoff; act.js re-issues the owner's
//       work when the game shows none (actplan.reissueWorkOf) — on the incident's own records

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const P = await import('plan.js')
const BB = await import('bbplan.js')
const BP = await import('bodyplan.js')
const IG = await import('installgate.js')
const AP = await import('actplan.js')
const { drain } = await import('coop.js')

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn6-bladeinstall-1107.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const p = F.player
// progress.js levelledPerson: BN6 has no combat level multiplier, so the save's mults are the level mults.
const person = { skills: p.skills, exp: p.exp, mults: p.mults, city: p.city, money: p.money }
const gymExpPerSec = BP.gymRate(BP.bestGym(person), 'strength', person, 1)
const SLEEVES = { infiltrate: F.sleeves, support: 0, fa: 0 }
// THE ONE BUILDER (progress.js bladeRouteOf startFor).
const startFor = (spec, extra = {}) => BB.bladeStartOf({ tel: F.bladeburner, person, sleeves: SLEEVES, gymExpPerSec, bnRank: 1, skillCostMult: 1, install: BB.bladeInstallOfSpec(spec), simulacrum: false, policy: BB.POLICY_V1, ...extra }) // the 11:07Z BN6 run played POLICY_V1 (its fixed black-op bar)
const statsOf = (n) => F.augstats[n] ?? null
const content = (names) => {
  const c = BB.bladeContentOf(names, statsOf)
  return { gains: c.gains, simulacrum: c.simulacrum, n: c.n }
}
const NOW = Date.parse(F.plan.at)
const DRAWS = P.makeDraws({ drift: { s: F.posteriorS, nu: 4, a: 2, b: 2 * F.posteriorS * F.posteriorS }, gymSdLn: 0.1 }, P.PLAN.N, P.seedOf(F.plan.lastAugReset, 6))
const INPUTS = F.exitinputs.inputs

// progress.js bladeInstallCompareOf, on the fixture: one simulation per option.
function bladeCompare({ prev = null, now = NOW, redecide = true } = {}) {
  const memo = new Map()
  const keyOf = (spec) => (spec?.kind === 'wait' ? `w${(+(spec.waitH ?? 0)).toFixed(4)}|${JSON.stringify(spec.blade?.gains ?? null)}|${spec.blade?.simulacrum === true}` : 'never')
  function* hoursOf(spec) {
    const k = keyOf(spec)
    if (!memo.has(k)) memo.set(k, (yield* BB.bladeExitGen(startFor(spec))).hours ?? null)
    return memo.get(k)
  }
  const trajOf = (spec) => ({ f: () => drain(hoursOf(spec)), fg: function* () { return yield* hoursOf(spec) }, noiseKey: P.bladeNoiseKeyOf(spec) })
  const nowB = content([...F.gatePlanBuy, ...F.gate.pending])
  const nowH = drain(hoursOf({ kind: 'wait', waitH: 0, blade: nowB }))
  const neverH = drain(hoursOf({ kind: 'never' }))
  const waits = F.gate.futures.filter((f) => !f.holdFor && f.waitMs > 0).map((f) => {
    const blade = content([...f.buy, ...F.gate.pending])
    return { waitH: f.waitMs / 3.6e6, hours: drain(hoursOf({ kind: 'wait', waitH: f.waitMs / 3.6e6, blade })), blade }
  })
  const d = drain(P.decideInstallGen({ inputs: INPUTS, count: null, point: { now: { hours: nowH, blade: nowB }, waits, never: { hours: neverH } }, prev, draws: DRAWS, redecide, budgetMs: 1e9, now, sameLife: true, route: 'blade', trajOf }))
  return { d, nowH, neverH, waits, sims: memo.size, hoursOf: (spec) => drain(hoursOf(spec)) }
}

export async function run() {
  const checks = []
  const inst0 = F.plan.decisions.install
  const br0 = F.plan.decisions.bladeRoute

  // ---- BI1 ------------------------------------------------------------------
  const c1 = new Check('BI1', "BEFORE, AS CAPTURED: the route committed 'blade' while the install decision and the gate priced the hacking exit")
  checks.push(c1)
  c1.examined(4)
  c1.note(`route ${br0.key}: blade ${br0.bladeH}h vs hack ${br0.hackH}h; plan exit ${F.plan.exit.q50}h (${F.plan.exit.source})`)
  c1.note(`install decision '${inst0.key}' (no route): mean ${inst0.meanH}h, point ${inst0.pointH}h; commitment ${inst0.commitment.key} ${inst0.commitment.meanH}h; gate exitH ${F.gate.exitH}h (${F.gate.exitSource}); gate: ${String(F.gate.why).slice(0, 120)}`)
  c1.note(`install-last ${F.installLast.at}: priced 'now' ${F.installLast.exits.planH}h (actor ${F.installLast.exits.actorH}h) — the next life published ${F.plan.exit.q50}h`)
  if (!(br0.key === 'blade' && inst0.route === undefined && inst0.meanH > 4 * br0.meanH && F.gate.exitH > 4 * F.plan.exit.q50)) c1.fail('fixture: the captured plan must show the two exit families (blade route ~29h, install/gate on the hacking route >100h) — it no longer records the incident')
  if (!/TWO EXITS AT INSTALL/.test(F.plan.consistency?.why ?? '')) c1.fail('fixture: the captured plan must carry TWO EXITS AT INSTALL')

  // The second install, 11:32:10Z, the same shape (captured after the 11:07 state).
  const il2 = F.installLast1132
  c1.examined(1)
  const b2 = content(il2.batch)
  const now2 = BB.bladeExit(startFor({ kind: 'wait', waitH: 0, blade: b2 })).hours
  const never2 = BB.bladeExit(startFor(null)).hours
  c1.note(`install ${il2.at} (${il2.batch.join(', ')}): priced ${il2.exits.actorH}h / 'now' ${il2.exits.planH}h on the hacking route (${String(il2.exits.why).slice(0, 90)}); on the black-op exit from the 11:07 state: install now ${now2.toFixed(2)}h vs never ${never2.toFixed(2)}h`)
  if (!(il2.exits.ok === false && il2.exits.planH > 4 * F.plan.exit.q50)) c1.fail('fixture: the 11:32Z install must record the hack-priced TWO EXITS')
  // On the black-op exit the 11:32Z batch (NutriGen's x1.2 combat exp against the reset) is
  // within the model's own resolution of never installing (bladecal: ~0.4h step jitter) — the
  // incident is the 137h hacking price, not the sign of a sub-hour difference.
  if (!(Math.abs(now2 - never2) < 1.5 && Math.max(now2, never2) < il2.exits.actorH / 4)) c1.fail(`the 11:32Z batch on the black-op exit must be near never installing and far from its hacking price (${now2} vs ${never2}; hack ${il2.exits.actorH}h)`)

  // ---- BI2 ------------------------------------------------------------------
  const c2 = new Check('BI2', 'AFTER: every install option is the black-op exit of its own install; the decision, the gate exitH and the actor exit are those numbers')
  checks.push(c2)
  const t0 = Date.now()
  const A = bladeCompare()
  const ms = Date.now() - t0
  const d = A.d
  c2.examined(A.waits.length + 2)
  c2.note(`blade-priced: now ${A.nowH.toFixed(2)}h, never ${A.neverH.toFixed(2)}h, waits ${A.waits.map((w) => `${w.waitH.toFixed(2)}h->${w.hours.toFixed(2)}`).join(', ')} (${A.sims} simulations, ${ms}ms)`)
  c2.note(`decision: ${d.key} (route ${d.route}) mean ${d.meanH}h q50 ${d.q50}h [${d.q10}-${d.q90}] — ${String(d.why).slice(0, 200)}`)
  if (d.route !== 'blade') c2.fail(`the decision record must carry route 'blade' (got ${d.route})`)
  for (const o of d.options ?? []) {
    const spec = o.key === 'never' ? { kind: 'never' } : o.key === 'now' ? { kind: 'wait', waitH: 0, blade: content([...F.gatePlanBuy, ...F.gate.pending]) } : (() => {
      const w = A.waits.find((x) => `w${x.waitH}` === o.key)
      return w ? { kind: 'wait', waitH: w.waitH, blade: w.blade } : null
    })()
    if (!spec) continue
    const ref = BB.bladeExit(startFor(spec)).hours
    if (!(Math.abs(o.pointH - ref) < 1e-3)) c2.fail(`option ${o.key}: point ${o.pointH}h is not the black-op exit of its install (${ref}h)`)
    if (!(o.noiseKey ?? '').startsWith('bladeburner')) c2.fail(`option ${o.key}: noise key '${o.noiseKey}' is not a Bladeburner trajectory's`)
  }
  // The live economy: the batch is NeuroFlux (x1.0303 combat): an install resets combat for ~1% — never installing wins.
  // The decision is the plan's rule on these blade-priced options (no committed option: the least
  // expected exit); a wait whose future batch beats never is the model's answer, not a fault.
  const best = [...(d.options ?? [])].sort((x, y) => x.meanH - y.meanH)[0]
  if (!d.held && best && d.key !== best.key) c2.fail(`with no committed option the plan takes the least expected exit (${best.key} ${best.meanH}h), chose ${d.key}`)
  if (!(A.nowH > A.neverH)) c2.fail(`installing the NeuroFlux batch now (${A.nowH}h) must cost the retrain against never (${A.neverH}h)`)
  // The exit families: every blade number within the route's, none near the hacking route's.
  for (const [n, h] of [['now', A.nowH], ['never', A.neverH], ['decision q50', d.q50]]) if (!(h < br0.hackH / 2)) c2.fail(`${n} ${h}h is not on the Bladeburner exit (hack ${br0.hackH}h)`)
  // The gate obeys the blade decision, its exitH is the decision's q50, and the actor's exit is nowH.
  const bayes = { install: d.install === true, key: d.key, route: 'blade', waitMs: typeof d.waitH === 'number' ? d.waitH * 3.6e6 : null, H: d.meanH, q10: d.q10, q50: d.q50, q90: d.q90, held: false, why: d.why }
  const ex = { route: 'blade', nowH: A.nowH, neverH: A.neverH, waits: A.waits.map((w) => ({ waitMs: w.waitH * 3.6e6, H: w.hours })), bayes }
  const gate = IG.shouldInstall({ exitCompare: ex, bladeRoute: true, ageMs: NOW - F.plan.lastAugReset, M: F.gate.M, queued: 3, countShort: 28, countGain: 0, countReachableLater: true, futures: [], plan: { buy: [] } })
  c2.note(`gate: install ${gate.install}, exitNowH ${gate.exitNowH}, why: ${String(gate.why).slice(0, 200)}`)
  if (gate.install !== false || gate.countStalls === undefined) c2.fail(`the gate must hold with the plan's 'never' (install ${gate.install})`)
  if (gate.exitNowH !== A.nowH) c2.fail(`the gate's (and the install actor's) exit installing now must be the blade nowH ${A.nowH} (got ${gate.exitNowH})`)
  if (!/Bladeburner/.test(gate.why)) c2.fail('the gate must say it decided on the Bladeburner route', gate.why)
  // CPU: one simulation per distinct option (the draws move only the noise).
  if (A.sims > A.waits.length + 3) c2.fail(`${A.sims} simulations for ${A.waits.length + 2} options — the options must be simulated once each`)

  // ---- BI3 ------------------------------------------------------------------
  const c3 = new Check('BI3', "ONE EXIT: the route's blade arm on the committed install plan IS the install decision's committed option; TWO EXITS holds; a hack-priced incumbent is not this decision's")
  checks.push(c3)
  c3.examined(3)
  // The next pass: the decision above is the incumbent (route 'blade'); the route's arm is priced on it.
  const rec = { ...d, decidedAt: new Date(NOW).toISOString() }
  const basis = P.basisOf(rec, NOW + 5 * 60e3)
  const route = drain(P.decideBladeRouteGen({ base: INPUTS, traj: P.trajectoryOf(null), basis: null, bladeStart: startFor(basis), bladeNoiseKey: P.bladeNoiseKeyOf(basis), prev: null, draws: DRAWS, redecide: true, budgetMs: 1e9 }))
  const B = bladeCompare({ prev: rec, now: NOW + 5 * 60e3, redecide: false })
  c3.note(`next pass: route blade arm q50 ${route.q50}h (point ${route.bladeH}h, key ${route.options?.find((o) => o.key === 'blade')?.noiseKey}); install decision held ${B.d.key} q50 ${B.d.q50}h (point ${B.d.pointH}h, key ${B.d.noiseKey})`)
  if (!(route.key === 'blade')) c3.fail(`the route must stay 'blade' (${route.key}: blade ${route.bladeH} vs hack ${route.hackH})`)
  if (!(Math.abs(route.q50 - B.d.q50) < 1e-6 && Math.abs(route.meanH - B.d.meanH) < 1e-6)) c3.fail(`two exits on one route: the route's blade arm ${route.q50}/${route.meanH}h vs the install decision's ${B.d.q50}/${B.d.meanH}h`)
  // TWO EXITS at an elapsed install on this route: commit 'now' (a combat batch that pays), then install.
  const big = { gains: { strength: 2, defense: 2, dexterity: 2, agility: 2, strength_exp: 2, defense_exp: 2, dexterity_exp: 2, agility_exp: 2 }, simulacrum: false, n: 4 }
  const C = (() => {
    const memo = new Map()
    function* h(spec) {
      const k = spec?.kind === 'wait' ? `${spec.waitH}|${JSON.stringify(spec.blade)}` : 'never'
      if (!memo.has(k)) memo.set(k, (yield* BB.bladeExitGen(startFor(spec))).hours)
      return memo.get(k)
    }
    const trajOf = (spec) => ({ f: () => drain(h(spec)), fg: function* () { return yield* h(spec) }, noiseKey: P.bladeNoiseKeyOf(spec) })
    const nowH = drain(h({ kind: 'wait', waitH: 0, blade: big }))
    const neverH = drain(h({ kind: 'never' }))
    const d1 = drain(P.decideInstallGen({ inputs: INPUTS, point: { now: { hours: nowH, blade: big }, never: { hours: neverH } }, draws: DRAWS, budgetMs: 1e9, now: NOW, route: 'blade', trajOf }))
    const ie = P.installExitsOf(d1, { actorH: nowH, now: NOW + 60e3, si: 0.02 })
    return { d1, ie, nowH, neverH }
  })()
  c3.note(`a x2-combat batch: now ${C.nowH.toFixed(2)}h vs never ${C.neverH.toFixed(2)}h -> ${C.d1.key}; ${C.ie.why}`)
  if (C.d1.key !== 'now') c3.fail(`a batch that doubles combat must install now on this route (${C.d1.key})`)
  if (C.ie.ok !== true) c3.fail('installing it must pass TWO EXITS AT INSTALL (the actor exit is the decision point)', C.ie.why)
  // The captured hack-priced incumbent ('now', no route) is not the blade decision's: it re-decides.
  const D = bladeCompare({ prev: { ...inst0 }, redecide: false })
  c3.note(`hack-priced incumbent '${inst0.key}' -> ${D.d.key} (held ${D.d.held}): ${String(D.d.why).slice(0, 120)}`)
  if (D.d.held === true || D.d.key === 'now') c3.fail(`a commitment priced on the hacking route must not be held as the Bladeburner decision's incumbent (got ${D.d.key}, held ${D.d.held})`)

  // ---- BI4 ------------------------------------------------------------------
  const c4 = new Check('BI4', 'what an install does on this route (game source): persistence, the reset and retrain, the multipliers, the Simulacrum, a life that starts below the bar')
  checks.push(c4)
  c4.examined(5)
  const never = BB.bladeExit(startFor(null))
  const nowNfg = BB.bladeExit(startFor({ kind: 'wait', waitH: 0, blade: content(F.gatePlanBuy) }))
  const nowPlain = BB.bladeExit(startFor({ kind: 'wait', waitH: 0, blade: { gains: {} } }))
  const nowBig = BB.bladeExit(startFor({ kind: 'wait', waitH: 0, blade: big }))
  const nowSim = BB.bladeExit(startFor({ kind: 'wait', waitH: 0, blade: { gains: {}, simulacrum: true } }))
  c4.note(`never ${never.hours.toFixed(2)}h; install now: plain ${nowPlain.hours.toFixed(2)}h, NeuroFlux x3 ${nowNfg.hours.toFixed(2)}h, x2 combat ${nowBig.hours.toFixed(2)}h, Simulacrum ${nowSim.hours.toFixed(2)}h`)
  // Persistence: the install keeps rank and black ops (Prestige.ts:152-155) — an install at 0 costs only the retrain, never the division.
  if (!(nowPlain.hours - never.hours > 0 && nowPlain.hours - never.hours < 2)) c4.fail(`a plain install must cost the retrain only (${(nowPlain.hours - never.hours).toFixed(2)}h) — a re-join or a lost rank would cost far more`)
  // A x1.03 batch moves the exit by less than the model resolves (the skill greedy's path,
  // bladecal [BC2]); a x2 batch must show: multipliers shorten the exit, and never lengthen it by
  // more than that resolution.
  if (!(nowNfg.hours < nowPlain.hours + 0.25)) c4.fail(`the batch's combat multipliers must not lengthen the exit against a plain install (${nowNfg.hours} vs ${nowPlain.hours})`)
  if (!(nowBig.hours < nowPlain.hours - 2)) c4.fail(`a x2 combat batch must shorten the exit by hours (${nowBig.hours} vs ${nowPlain.hours})`)
  if (!(nowBig.hours < never.hours)) c4.fail(`x2 combat must beat never installing (${nowBig.hours} vs ${never.hours})`)
  if (!(nowSim.hours < nowPlain.hours)) c4.fail(`the Simulacrum's parallel gym must beat the blocking retrain (${nowSim.hours} vs ${nowPlain.hours})`)
  // A life that begins below the bar (just after an install): the start retrains first — the same exit as 'install now'.
  const reset = { ...person, skills: { ...person.skills, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1 }, exp: { ...person.exp, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 } }
  const after = BB.bladeExit(BB.bladeStartOf({ tel: F.bladeburner, person: reset, sleeves: SLEEVES, gymExpPerSec, bnRank: 1, skillCostMult: 1, policy: BB.POLICY_V1 }))
  c4.note(`the next life's own start (stats reset, joined): ${after.hours.toFixed(2)}h (retrain ${after.joinH.toFixed(2)}h) vs the install's 'now' ${nowPlain.hours.toFixed(2)}h`)
  if (!(Math.abs(after.hours - nowPlain.hours) < 0.05 * nowPlain.hours)) c4.fail(`EXIT JUMP on this route: the life after the install prices ${after.hours}h, the install priced ${nowPlain.hours}h`)

  // ---- BI5 ------------------------------------------------------------------
  const c5 = new Check('BI5', "THE BLADE'S SIMULACRUM, priced on the exit: unreachable live (money), bought where it shortens the exit")
  checks.push(c5)
  c5.examined(2)
  const repPerRank = 2 * p.mults.faction_rep * (1 + p.bladeburnersFaction.favor / 100)
  const live = BB.simulacrumVerdict({ s0: startFor(null), withoutH: never.hours, cost: 150e9, repReq: 1250, wealth: p.money + F.equity, moneyPerH: F.lifePerSec * 3600, rep: p.bladeburnersFaction.playerReputation, repPerRank, rankPerH: F.bladeburner.rankPerHour })
  c5.note(`live: ${live.why}`)
  c5.note(`live numbers: money ${live.moneyH}h, reputation ${live.repH}h, bound (installed now, free) ${live.boundH}h = ${live.boundGainH}h sooner`)
  if (live.buy !== false || !(live.moneyH > never.hours)) c5.fail('live: $150b at the measured income is beyond the exit — not a purchase')
  if (!(live.boundGainH > 0)) c5.fail(`the Simulacrum installed now must shorten the exit (bound ${live.boundGainH}h)`)
  const rich = BB.simulacrumVerdict({ s0: startFor(null), withoutH: never.hours, cost: 150e9, repReq: 1250, wealth: 200e9, moneyPerH: 1e9, rep: 2000, repPerRank, rankPerH: 20 })
  c5.note(`affordable now: ${rich.why}`)
  if (rich.buy !== true || !(rich.gainH > 0) || rich.reachH !== 0) c5.fail('with the money and reputation there, a Simulacrum that shortens the exit must be bought', rich.why)

  // ---- BI6 ------------------------------------------------------------------
  const c6 = new Check('BI6', "THE GATE on the blade route: the plan's blade decision installs or holds; the Daedalus count and the hacking M do not")
  checks.push(c6)
  c6.examined(2)
  const bInst = { install: true, key: 'now', route: 'blade', waitMs: 0, H: C.nowH, q50: C.nowH, held: false, why: 'x2 combat' }
  const g1 = IG.shouldInstall({ exitCompare: { route: 'blade', nowH: C.nowH, neverH: C.neverH, waits: [], bayes: bInst }, bladeRoute: true, ageMs: 3.6e6, M: 1.0, queued: 4, countShort: 28, countGain: 0, countReachableLater: true, futures: [], plan: { buy: [] } })
  c6.note(`blade 'now' with M=1 and 28 short for Daedalus: install ${g1.install} — ${String(g1.why).slice(0, 160)}`)
  if (g1.install !== true) c6.fail("the blade decision 'now' must install whatever M and the Daedalus count say")
  const g2 = IG.shouldInstall({ exitCompare: { route: 'blade', nowH: C.nowH, neverH: C.neverH, waits: [], bayes: bInst }, bladeRoute: false, ageMs: 3.6e6, M: 1.0, queued: 4, countShort: 28, countGain: 0, countReachableLater: true, futures: [], plan: { buy: [] } })
  c6.note(`control (no bladeRoute flag): install ${g2.install} — ${String(g2.why).slice(0, 120)}`)
  if (g2.install !== false) c6.fail('control: without the route flag the hacking gates must still hold this batch (the flag is what the test exercises)')

  // ---- BI7 ------------------------------------------------------------------
  const c7 = new Check('BI7', 'THE 10:27Z GYM: no startAction on a claim being handed off; the claimed slot is refilled when the game shows no work')
  checks.push(c7)
  const BJ = await import('bladeburner.js')
  const fakeNs = (files) => ({ scp: () => true, read: (f) => files[f] ?? '' })
  const info = { lastAugReset: F.plan.lastAugReset }
  const at = (iso) => iso
  const prog = (owner, t) => JSON.stringify({ at: at(t), slot: { owner } })
  const ord = (t, kinds) => JSON.stringify({ at: t, lastAugReset: info.lastAugReset, orders: kinds.map((k, i) => ({ id: i + 1, kind: k })) })
  const tNow = new Date(Date.now() - 60e3).toISOString()
  const tOld = new Date(Date.now() - 120e3).toISOString()
  const cases = [
    ['claim fresh, its own batch (gym written before the claim)', prog('bladeburner', tNow), ord(tOld, ['gym']), true],
    ['claim, then a newer batch that starts the gym (a pass that flushed orders and kept the old claim)', prog('bladeburner', tOld), ord(tNow, ['liquidate', 'gym']), false],
    ['claim, then a newer batch with no work order', prog('bladeburner', tOld), ord(tNow, ['buyaug']), true],
    ['body owns the slot', prog('body', tNow), ord(tOld, ['gym']), false],
  ]
  for (const [name, pr, ob, want] of cases) {
    c7.examined(1)
    const r = BJ.slotClaim(fakeNs({ '/tel/progress.txt': pr, '/tel/orders.txt': ob }), 'home', info)
    if (r.ours !== want) c7.fail(`slotClaim, ${name}: ours ${r.ours}, expected ${want}`, r.why)
  }
  // The claim is re-read immediately before startAction (source guard: between the 'same' check and the call).
  const bsrc = SRC('bladeburner.js')
  const i0 = bsrc.indexOf('const same = current && current.type === pick.type')
  const i1 = bsrc.indexOf('started = bb.startAction(pick.type, pick.name)')
  const seg = i0 >= 0 && i1 > i0 ? bsrc.slice(i0, i1) : ''
  c7.examined(1)
  if (!/slotClaim\(ns, host, info\)/.test(seg) || !/!recheck\.ours/.test(seg)) c7.fail('bladeburner.js must re-read the claim (slotClaim) between deciding to start and startAction, and not start unless it is ours')
  // The incident's records: the def gym ran at 10:27:25Z and was gone by 10:27:56Z; nothing until the 10:32Z batch.
  const h = F.incident.history
  const ran = h.find((x) => x.at.startsWith('2026-10-01T10:27:26'))
  const gone = h.filter((x) => x.at > '2026-10-01T10:27:30' && x.at < '2026-10-01T10:32:00')
  c7.note(`history: ${ran?.at} ${ran?.work}; then ${gone.length} samples with work ${[...new Set(gone.map((x) => x.work))].join('/')} until the 10:32Z batch; stamina rose steadily (no Bladeburner action ran): ${F.bladeburner.samples.filter((s) => s.at > '2026-10-01T10:26' && s.at < '2026-10-01T10:33').map((s) => s.stamina).join(', ')}`)
  if (!(ran?.work === 'ClassWork' && gone.length >= 6 && gone.every((x) => x.work === null))) c7.fail('fixture: the incident (gym at 10:27:26Z, nothing until 10:32Z) is not in the records')
  // act.js re-issues it: the slot is body's, the last order of the current batch is that gym, the snapshot shows no work.
  const batchAt = '2026-10-01T10:27:03.215Z'
  const lastWork = { kind: 'gym', args: ['Powerhouse Gym', 'def'], at: '2026-10-01T10:27:25.498Z', batchAt }
  const base = { now: Date.parse('2026-10-01T10:28:40Z'), progress: { at: '2026-10-01T10:27:03.521Z', slot: { owner: 'body' } }, lastWork, batchAt, work: null, workAt: '2026-10-01T10:28:31Z', cash: 2.0e6, gymCostMult: (n) => BP.GYMS.find((g) => g.name === n)?.costMult ?? null, reissued: { n: 0, at: 0 } }
  const rcases = [
    ['the incident', base, 'gym'],
    ['cash below the fee floor', { ...base, cash: 100e3 }, 'skip'],
    ['the snapshot predates the order', { ...base, workAt: '2026-10-01T10:27:20Z' }, null],
    ['the game shows work', { ...base, work: { type: 'CLASS' } }, null],
    ['bladeburner owns the slot', { ...base, progress: { ...base.progress, slot: { owner: 'bladeburner' } } }, null],
    ['another batch is current', { ...base, batchAt: '2026-10-01T10:32:02.932Z' }, null],
    ['re-issued 30s ago', { ...base, reissued: { n: 1, at: base.now - 30e3 } }, 'skip'],
    ['re-issued 3 times', { ...base, reissued: { n: 3, at: 0 } }, 'skip'],
  ]
  for (const [name, s, want] of rcases) {
    c7.examined(1)
    const r = AP.reissueWorkOf(s)
    const got = r?.kind ?? (r?.skip ? 'skip' : null)
    if (got !== want) c7.fail(`reissueWorkOf, ${name}: ${got} (expected ${want})`, JSON.stringify(r))
    if (name === 'the incident') c7.note(`incident: ${r?.why ?? r?.skip}`)
  }
  if (!/reissueWorkOf\(/.test(SRC('act.js'))) c7.fail('act.js must run actplan.reissueWorkOf')
  return checks
}
