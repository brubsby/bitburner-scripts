// [BJ] THE BLACK-OP EXIT ACROSS AN INSTALL — live BN6 2026-10-02.
//
// The 10:10:17Z install (20 augs, Bladeburner route) priced the next life at
// 18.65h (plan 'now' mean 18.69h). The new life's 10:18Z pass published 3.41h
// (EXIT JUMP AT INSTALL -15.1h, tolerance 2.8h), 10:23Z 3.48h, then 13.39h
// (10:28Z) and 14.35h (10:33Z, held, no event: EXIT UNSTABLE).
//
// Fixture tools/test/fixture-bn6-exitjump-1010.json (mkfix-bn6-1010.py);
// the replay and the attribution are tools/sim/exitjump/attribute-bn6-1010.mjs.
//
//   BJ1 BEFORE, AS CAPTURED: the jump and the flip are the sleeves' fleet — sleeve.js committed one
//       (4-5 infiltrators) only in the new life's passes whose route basis had no install, and none
//       otherwise; attributed group by group, the fleet carries the jump and nothing else is an hour
//   BJ2 THE ROOT CAUSE: sleeve.js's person had no city or money, so bestGym was null, the gym rate
//       null, and the exit model priced every fleet unfinishable at the basis's install (and a
//       retrain below the bar free). Now: the plan's gym rate, the player's city/money; the model
//       refuses an unpriceable retrain by name
//   BJ3 AFTER — ONE STATE MODEL ACROSS THE INSTALL: the fleet sleeve.js commits on each pass's own
//       start is the same before and after the install, and the install's 'now' and the new life's
//       exits agree to the elapsed time
//   BJ4 THE RETRAIN AS RUN: one gym leg per stat, each at least a pass (POLICY.retrainLegS), the stat
//       training past the bar — against the live 0.38h (10:10 -> 10:33Z); the model used 0.05h
//   BJ5 THE SKILL CLOCK IS THE DAEMON'S: bladeburner.js publishes skillsAt, the model spends on that
//       clock (not at every pass's t = 0), and an install restarts it (spend at once)
//   BJ6 POSTERIORS CARRIED: the rank posterior's windows and the success groups survive the install
//   BJ7 THE HELD MOVE (10:28 -> 10:33Z, one install w1.46): +0.97h published; now inside the check
//   BJ8 THE CADENCE: on the 10:33Z state with the fleet the route will run, an install ~1.4h out is no
//       material gain over never, and the retrain prices each install dearer than the old model did
//   BJ9 WIRING: progress.js publishes the start's gym rate and the basis's batch; sleeve.js reads them,
//       keeps its incumbent fleet on a near tie; healthcheck fails BLADE FLEET UNPRICED

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const A = await import('../sim/exitjump/attribute-bn6-1010.mjs')
const BP = await import('bodyplan.js')
const SP = await import('sleeveplan.js')
const { drain } = await import('coop.js')
const { F, BB } = A
const ms = Date.parse
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const I0 = { infiltrate: 0, support: 0, fa: 0 }
const elapsedH = (i) => (ms(F.passes[i].at) - A.INSTALL_AT) / 3.6e6
const POST = [2, 3, 4, 5, 6] // 10:13 .. 10:33Z
const f2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : String(x))

export async function run() {
  const checks = []

  // ---- BJ1 --------------------------------------------------------------------
  const c1 = new Check('BJ1', 'BEFORE, AS CAPTURED: the -15.1h jump and the 10:28 flip back are the sleeves\' fleet; no other input group moves the exit an hour')
  checks.push(c1)
  const ej = F.exitjump
  c1.examined(2)
  c1.note(`exitjump: ${String(ej.why).slice(0, 200)}`)
  if (!(ej.ok === false && ej.worst.checks[0].diffH < -15)) c1.fail('fixture: /tel/exitjump.txt must record the -15.1h EXIT JUMP AT INSTALL')
  const fleets = F.passes.map((p) => `${p.at.slice(11, 16)} ${p.bladeRoute.state?.fleet} (${p.bladeRoute.fleet?.source}) ${p.bladeRoute.bladeH}h basis ${p.bladeRoute.installBasis?.kind}`)
  c1.note(`fleet by pass: ${fleets.join(' | ')}`)
  c1.examined(F.passes.length)
  const committed = F.passes.filter((p) => p.bladeRoute.fleet?.source === 'committed').map((p) => p.at.slice(11, 16))
  if (committed.join() !== '10:18,10:23') c1.fail(`fixture: sleeve.js committed a fleet only at 10:18 and 10:23Z (got ${committed.join()})`)
  if (!F.sleeve.blade.byConfig.every((x) => x.hours === null)) c1.fail('fixture: /tel/sleeve.txt 10:33Z must show every fleet unpriced')
  // The attribution, 10:10 install's projection vs the 10:18 pass (the jump's pass).
  const proj = A.projection()
  const at = A.attribute(proj, A.inputsAt(3, { basis: null }))
  c1.examined(at.rows.length)
  for (const r of at.rows) c1.note(`  ${r.group}: proj+group ${r.plus}h, post-group ${r.minus}h`)
  const fl = at.rows.find((r) => r.group === 'fleet (sleeves)')
  if (!(fl.plus < -10 && fl.minus < -10)) c1.fail(`the fleet group must carry the jump (got ${fl.plus} / ${fl.minus})`)
  for (const r of at.rows.filter((x) => x !== fl)) if (!(Math.abs(r.plus) < 1 && Math.abs(r.minus) < 1)) c1.fail(`${r.group} moves the exit ${r.plus} / ${r.minus}h — only the fleet should`)

  // ---- BJ2 --------------------------------------------------------------------
  const c2 = new Check('BJ2', 'THE ROOT CAUSE: sleeve.js\'s gym rate was null (bestGym had no city/money); every fleet unfinishable whenever the basis held an install — now priced on the plan\'s rate, and an unpriceable retrain is refused by name')
  checks.push(c2)
  const x33 = A.inputsAt(6)
  const p = x33.person
  const oldPerson = { skills: p.skills, exp: p.exp, mults: p.mults } // sleeve.js before: no city, no money
  const oldGym = BP.bestGym(oldPerson)
  c2.examined(1)
  if (oldGym !== null) c2.fail(`bestGym without city/money must be null (the incident's input) — got ${oldGym?.name}`)
  const startWith = (gym, extra = {}) => ({ ...BB.bladeStartOf({ tel: { ...x33.tel, maxStamina: undefined, stamina: undefined }, person: p, sleeves: I0, gymExpPerSec: gym, install: BB.bladeInstallOfSpec(x33.install), rankScale: x33.rankScale, now: x33.at }), maxH: 200, ...extra })
  const nullRun = drain(SP.bladeFleetGen(startWith(null), 5))
  c2.examined(nullRun.byConfig.length)
  c2.note(`gym rate null, basis w${x33.install.waitH.toFixed(2)}: ${nullRun.why.slice(0, 200)}`)
  if (nullRun.config !== null) c2.fail('with no gym rate and an install in the basis no fleet can be priced')
  if (!/no gym rate/.test(nullRun.why)) c2.fail(`the refusal must name the gym rate (got: ${nullRun.why.slice(0, 120)})`)
  const rate = BP.gymRate(BP.bestGym({ ...p, city: F.save.player.city, money: 1e9 }), 'strength', p, 1)
  const okRun = drain(SP.bladeFleetGen(startWith(rate), 5))
  c2.examined(1)
  c2.note(`gym rate ${f2(rate)}/s: ${okRun.why.slice(0, 200)}`)
  if (!(okRun.config && okRun.config.infiltrate >= 3 && okRun.hours < 6)) c2.fail(`with the gym rate the fleet search must commit infiltrators (got ${JSON.stringify(okRun.config)} ${okRun.hours}h)`)
  // Below the bar with no rate: refused, not free (the start retrain used to keep the stats it had set).
  const low = { ...p, exp: { ...p.exp, strength: 0 }, skills: { ...p.skills, strength: 1 } }
  const r0 = BB.bladeExit({ ...BB.bladeStartOf({ tel: x33.tel, person: low, sleeves: I0, gymExpPerSec: null, now: x33.at }), maxH: 50 })
  c2.examined(1)
  if (r0.hours !== null || !/no gym rate/.test(r0.why ?? '')) c2.fail(`below the bar with no gym rate the exit must be refused by name (got ${r0.hours}h, ${r0.why})`)

  // ---- BJ3 --------------------------------------------------------------------
  const c3 = new Check('BJ3', 'AFTER — ONE STATE MODEL ACROSS THE INSTALL: the fleet sleeve.js commits is the same before and after; the install\'s \'now\' and the new life\'s exits agree to the elapsed time')
  checks.push(c3)
  const pre = A.inputsAt(A.PRE, { basis: null })
  const prePick = A.fleetPick(pre)
  const nowSpec = { kind: 'wait', waitH: 0, installAt: A.INSTALL_AT, blade: { gains: A.BATCH.gains, simulacrum: false } }
  const nowH = A.hoursOf({ ...pre, sleeves: prePick.sleeves, install: nowSpec })
  c3.examined(1)
  c3.note(`10:10 pre-install: sleeve.js commits ${JSON.stringify(prePick.sleeves)}; install now ${f2(nowH)}h (the record: 18.65h on the sleeves at the gym)`)
  let inc = prePick.committed ? prePick.sleeves : null
  for (const i of [2, 3]) {
    const x = A.inputsAt(i, { basis: null })
    const pick = A.fleetPick(x, inc)
    inc = pick.committed ? pick.sleeves : inc
    const h = A.hoursOf({ ...x, sleeves: pick.sleeves })
    const diff = h - (nowH - elapsedH(i))
    c3.examined(1)
    c3.note(`${F.passes[i].at.slice(11, 19)} (${elapsedH(i).toFixed(2)}h): fleet ${JSON.stringify(pick.sleeves)}, exit ${f2(h)}h vs the install's ${f2(nowH)}h less ${elapsedH(i).toFixed(2)}h: ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}h (was ${(F.passes[i].install.meanH - (F.installLast.exits.planH - elapsedH(i))).toFixed(2)}h)`)
    if (JSON.stringify(pick.sleeves) !== JSON.stringify(prePick.sleeves)) c3.fail(`the fleet must not change across the install (${JSON.stringify(prePick.sleeves)} -> ${JSON.stringify(pick.sleeves)})`)
    if (!(Math.abs(diff) < 0.3)) c3.fail(`the new life's exit must be the install's less the elapsed time within 0.3h (got ${diff.toFixed(2)}h)`)
  }

  // ---- BJ4 --------------------------------------------------------------------
  const c4 = new Check('BJ4', 'THE RETRAIN AS RUN: one gym leg per stat, each at least a pass, the stat past the bar — the live 0.38h, not 0.05h')
  checks.push(c4)
  c4.examined(2)
  c4.note(`the projection's retrain ${proj.retrainH.toFixed(3)}h (POLICY.retrainLegS ${BB.POLICY.retrainLegS}s); stats after: ${['strength', 'defense', 'dexterity', 'agility'].map((s) => `${s} ${proj.person.skills[s]}`).join(', ')}`)
  const classRows = F.history.filter((r) => ms(r.at) > A.INSTALL_AT && r.work === 'ClassWork')
  const live = (ms(F.bladeburner.slot.at) - A.INSTALL_AT) / 3.6e6
  const firstClass = F.history.find((r) => ms(r.at) > A.INSTALL_AT && r.work === 'ClassWork')
  c4.note(`live: install ${F.installLast.at.slice(11, 19)}, crime (cash for the fees) to ~10:13, gym legs to ${classRows.at(-1).at.slice(11, 19)}, slot 'bladeburner' at ${F.bladeburner.slot.at.slice(11, 19)} (${live.toFixed(2)}h); strength ${F.history.find((r) => r.work === 'ClassWork').skills.strength} after its one leg (${firstClass.at.slice(11, 19)})`)
  if (!(proj.retrainH >= 4 * BB.POLICY.retrainLegS / 3600 - 1e-9)) c4.fail(`four stats short must take at least four legs (${proj.retrainH}h)`)
  if (!(Math.abs(proj.retrainH - live) < 0.1)) c4.fail(`the retrain must match the live one within 0.1h (model ${proj.retrainH.toFixed(2)}h vs live ${live.toFixed(2)}h; the cash bootstrap is not modelled)`)
  if (!['strength', 'defense', 'dexterity', 'agility'].every((s) => proj.person.skills[s] > 1.5 * BB.JOIN_COMBAT)) c4.fail('each leg must carry its stat past the bar (one pass of training), as live (strength 247 after its leg)')
  // At an install inside the model, no rate: refused, named.
  const rInst = BB.bladeExit({ ...A.startOf({ ...A.inputsAt(6), sleeves: I0 }), gymExpPerSec: 0, maxH: 50 })
  c4.examined(1)
  if (rInst.hours !== null || !/no gym rate/.test(rInst.why ?? '')) c4.fail(`an install the model cannot retrain from must be refused by name (got ${rInst.hours}h, ${rInst.why})`)

  // ---- BJ5 --------------------------------------------------------------------
  const c5 = new Check('BJ5', 'THE SKILL CLOCK IS THE DAEMON\'S: skillsAt -> skillSinceS; no spend before the daemon\'s hour; an install restarts it')
  checks.push(c5)
  const x13 = A.inputsAt(2, { basis: null })
  const s13 = A.startOf({ ...x13, sleeves: I0 })
  c5.examined(3)
  c5.note(`10:13:21 pass: skillsAt ${x13.tel.skillsAt} -> skillSinceS ${f2(s13.skillSinceS)}s; ${s13.skillPoints} points held`)
  if (!(Math.abs(s13.skillSinceS - (ms(F.passes[2].at) - ms(x13.tel.skillsAt)) / 1000) < 1)) c5.fail('bladeStartOf must read the daemon\'s skillsAt as seconds since its spend')
  // Points enough that any spend buys something (the planner may save a few for a dearer skill).
  const short = (since) => BB.bladeExit({ ...s13, skillPoints: 5000, skillSinceS: since, maxH: 0.5 })
  const held = short(s13.skillSinceS)
  const fresh = short(undefined)
  const spentHeld = Object.keys(held.levels).some((k) => held.levels[k] !== s13.levels[k])
  const spentFresh = Object.keys(fresh.levels).some((k) => fresh.levels[k] !== s13.levels[k])
  c5.note(`first 0.5h: on the daemon's clock spent ${spentHeld}; with no clock spent ${spentFresh}`)
  if (spentHeld) c5.fail('on the daemon\'s clock (its spend 3 min ago) the model must not spend in the next half hour')
  if (!spentFresh) c5.fail('with no clock (a fresh daemon) the model must spend at once')
  const bj = SRC('bladeburner.js')
  if (!/skillsAt: lastSkills > 0 \? new Date\(lastSkills\)\.toISOString\(\) : null/.test(bj)) c5.fail('bladeburner.js must publish skillsAt (its last spend)')
  if (!/lastSkill = t\b/.test(SRC('bbplan.js')) || !/the install restarts the daemon/i.test(SRC('bbplan.js'))) c5.fail('the in-model install must restart the skill clock (spend at once)')

  // ---- BJ6 --------------------------------------------------------------------
  const c6 = new Check('BJ6', 'POSTERIORS CARRIED: the rank posterior\'s windows and the success groups survive the install; the group moves the exit < 0.5h')
  checks.push(c6)
  const preCal = F.passes[A.PRE].bladeRoute.calibration
  const postCal = F.passes[6].bladeRoute.calibration
  c6.examined(2)
  c6.note(`rank: pre k ${preCal.rank.k} (${preCal.rank.n} windows, applied ${preCal.rank.applied}) -> post k ${postCal.rank.k} (${postCal.rank.n}, applied ${postCal.rank.applied}); success: pre n ${preCal.success.n} -> post n ${postCal.success.n} (every chance >= ${BB.SUCCESS_CAL.maxP} or unread: no groups to carry)`)
  if (!(postCal.rank.n >= preCal.rank.n && Math.abs(postCal.rank.k - preCal.rank.k) < 0.05)) c6.fail('the rank posterior must carry its windows across the install')
  if (!/prev\?\.bitNode === info\.currentNode && Array\.isArray\(prev\?\.calibration\?\.success\?\.groups\)/.test(bj)) c6.fail('bladeburner.js must carry its success groups from its own record (same node) across a restart')
  if (!/pc\.prevAny\?\.decisions\?\.bladeRoute\?\.calibration\?\.rank/.test(SRC('progress.js'))) c6.fail('progress.js must carry the rank windows across lives (pc.prevAny)')
  const pg = at.rows.find((r) => r.group.startsWith('posteriors'))
  if (!(Math.abs(pg.plus) < 0.5 && Math.abs(pg.minus) < 0.5)) c6.fail(`the posteriors group moved the exit ${pg.plus} / ${pg.minus}h`)

  // ---- BJ7 --------------------------------------------------------------------
  const c7 = new Check('BJ7', 'THE HELD MOVE (one install w1.46, 10:28 -> 10:33Z, no event): +0.97h published; inside the 5-minute check now')
  checks.push(c7)
  const hp = A.heldPair()
  c7.examined(2)
  for (const [lab, sl] of [['the sleeves as run (none)', I0], ['the fleet sleeve.js now commits (5 infiltrate)', { infiltrate: 5, support: 0, fa: 0 }]]) {
    const a = A.hoursOf({ ...hp.a, sleeves: sl })
    const b = A.hoursOf({ ...hp.b, sleeves: sl })
    const move = b - a + (ms(F.passes[6].at) - ms(F.passes[5].at)) / 3.6e6
    c7.note(`${lab}: ${f2(a)}h -> ${f2(b)}h, against a held plan ${move >= 0 ? '+' : ''}${move.toFixed(2)}h (published ${hp.publishedA}h -> ${hp.publishedB}h)`)
    if (!(Math.abs(move) < 0.3)) c7.fail(`${lab}: the held move must be under 0.3h (got ${move.toFixed(2)}h)`)
  }

  // ---- BJ8 --------------------------------------------------------------------
  const c8 = new Check('BJ8', 'THE CADENCE: with the fleet the route will run, an install ~1.4h out is no material gain over never; the retrain prices each install dearer than the old model')
  checks.push(c8)
  const sl5 = { infiltrate: 5, support: 0, fa: 0 }
  const x = { ...A.inputsAt(6, { basis: null }), sleeves: sl5 }
  const spec = F.passes[5].install.spec
  const w = { kind: 'wait', installAt: spec.installAt, waitH: (spec.installAt - x.at) / 3.6e6, blade: spec.blade }
  const H = (install, pol = BB.POLICY) => BB.bladeExit(A.startOf({ ...x, install }), pol).hours
  const never = H(null)
  const wH = H(w)
  const wOld = H(w, { ...BB.POLICY, retrainLegS: 0 })
  const never0 = A.hoursOf({ ...x, sleeves: I0, install: null })
  const w0 = A.hoursOf({ ...x, sleeves: I0, install: w })
  c8.examined(5)
  c8.note(`fleet i5: never ${f2(never)}h, install at w${w.waitH.toFixed(2)} (${spec.blade.n} augs) ${f2(wH)}h (${(wH - never).toFixed(2)}h); the old retrain (exp to the bar, 0.05h) ${f2(wOld)}h`)
  c8.note(`the sleeves as run (none): never ${f2(never0)}h, w${w.waitH.toFixed(2)} ${f2(w0)}h (${(w0 - never0).toFixed(2)}h) — the installs looked worth hours only on the 10h black-op chance plateau the fleet bug made`)
  if (!(Math.abs(wH - never) < 0.3)) c8.fail(`with the fleet, the 1.4h install must be within 0.3h of never (got ${(wH - never).toFixed(2)}h)`)
  if (!(wH - wOld > 0.05)) c8.fail(`the retrain as run must make the install dearer than the old 0.05h retrain (got ${(wH - wOld).toFixed(2)}h)`)

  // ---- BJ9 --------------------------------------------------------------------
  const c9 = new Check('BJ9', 'WIRING: the plan publishes the start\'s gym rate and the basis\'s batch; sleeve.js reads them and keeps its incumbent on a near tie; healthcheck reads sleeve.txt')
  checks.push(c9)
  const pj = SRC('progress.js')
  const sj = SRC('sleeve.js')
  c9.examined(6)
  if (!/start: \{ gymExpPerSec, gym: gym\?\.name \?\? null/.test(pj)) c9.fail('progress.js must publish decisions.bladeRoute.start.gymExpPerSec')
  if (!/installBasis: bladeBasis \? \{[^\n]*blade: bladeBasis\.blade \?\? null/.test(pj)) c9.fail('progress.js must publish the basis\'s batch content (installBasis.blade)')
  if (!/bladeRoute\?\.start\?\.gymExpPerSec/.test(sj)) c9.fail('sleeve.js must take the plan\'s gym rate')
  if (!/city: p\.city, money: p\.money/.test(sj)) c9.fail('sleeve.js\'s fallback person must carry city and money (bestGym)')
  if (!/bladeMemo\?\.result\?\.config \? \{ config: bladeMemo\.result\.config[\s\S]*bladeFleetGen\(s0, n, incumbent\.config/.test(sj)) c9.fail('sleeve.js must pass its committed fleet as the incumbent')
  if (!/sl: readTel\("sleeve\.txt"\)/.test(SRC('tools/healthcheck.mjs'))) c9.fail('healthcheck.mjs must pass sleeve.txt to bladeburnerHealth (BLADE FLEET UNPRICED)')
  const ib = BB.bladeInstallOfBasis({ kind: 'wait', installAt: Date.now() + 3.6e6, blade: { gains: { strength: 1.5 }, simulacrum: false } })
  c9.examined(1)
  if (ib?.gains?.strength !== 1.5) c9.fail('bladeInstallOfBasis must carry the basis\'s batch gains')
  // The incumbent stands on a near tie, yields to a clear winner.
  const s0 = { ...A.startOf({ ...A.inputsAt(6, { basis: null }), sleeves: I0 }), maxH: 200 }
  const best = drain(SP.bladeFleetGen(s0, 5))
  const near = best.byConfig.find((c) => !(c.infiltrate === best.config.infiltrate && c.support === best.config.support && c.fa === best.config.fa) && c.hours - best.hours <= SP.FLEET_KEEP.h)
  c9.examined(1)
  if (near) {
    const keep = drain(SP.bladeFleetGen(s0, 5, { infiltrate: near.infiltrate, support: near.support, fa: near.fa }))
    c9.note(`best ${JSON.stringify(best.config)} ${best.hours}h; incumbent ${near.infiltrate}/${near.support}/${near.fa} ${near.hours}h kept: ${keep.config.infiltrate === near.infiltrate && keep.config.support === near.support}`)
    if (!(keep.config.infiltrate === near.infiltrate && keep.config.support === near.support && keep.config.fa === near.fa)) c9.fail('a near-tie incumbent must stand')
  } else c9.note(`no configuration within ${SP.FLEET_KEEP.h}h of the best on this state (${JSON.stringify(best.byConfig.slice(0, 3))})`)
  const far = drain(SP.bladeFleetGen(s0, 5, I0))
  if (far.config.infiltrate === 0 && far.config.support === 0 && far.config.fa === 0) c9.fail('the zero fleet (hours worse) must not stand as incumbent')
  return checks
}
