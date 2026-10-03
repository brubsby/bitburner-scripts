// [HB] THE NEXT HOME UPGRADE ON THE COMMITTED BLADEBURNER ROUTE — live BN4.3,
// 2026-10-03 ~01:00Z.
//
// Home sat at 64GB for the whole node (10.4h, three lives) while the next
// block cost $31.86m and each life earned $52-62m. plan.txt
// decisions.spends.home was {buy: false, pBuy: null, deltaH: null}: the only
// pricing was exitplan.spendExit on the HACKING exit (perGB x homeRam money
// against the World Daemon), "unpriced: the spend is not affordable by the
// install" — on a route whose exit is the 21 black ops. And had it priced a
// buy, watchdog.js's homeup trigger still held the $100b Daedalus join claim
// on top of it.
//
// Fixture: tools/test/fixture-bn4-homeblade-0100.json, captured live (the
// save's player, /tel/bladeburner.txt from bb-lite, plan.txt's bladeRoute and
// spends, installgate.txt's spendExit and joinClaim, homeup.txt, boot.txt,
// the fleet's host sizes, go.txt's opponent).
//
//   HB1 BEFORE, AS CAPTURED: spends.home unpriced on the blade route. AFTER: on the live state the
//       verdict is a finite deltaH = withH - withoutH on the black-op exit (homeplan.bladeHomeExitGen
//       through the route's own start builder), decided by plan.decideSpend; progress.js wires it into
//       both installgate writes and spendVerdictsOf takes it as the home verdict
//   HB2 BUY: the tier's unlock (the full daemon) is worth more than the augmentations the purchase
//       displaces from the committed install's batch -> buys; both effects show in the breakdown
//   HB3 HOLD: the same displacement with nothing the tier unlocks on this exit (bladeburner.js already
//       the daemon, or no host can hold it; go.js on a non-combat channel) -> holds
//   HB4 THE STEP: the real manifest (boot.js STACK) through the real planner (stack.planStack) at 64GB
//       reproduces the live boot.txt; 64 -> 96GB admits none of the 128GB daemons and is worth exactly
//       nothing on this exit, 64 -> 128GB admits bladeburner.js / go.js / batch.js and shortens it
//   HB5 bladeExit's mid-trajectory steps: a rank step at 0h is the same trajectory as that rank scale
//       from the start; a step past the exit changes nothing
//   HB6 THE MONEY REACHES IT: watchdog's homeup trigger holds no join money for a verdict carrying
//       noJoin (the blade verdict does); act.js re-enters boot.js after the actor's RAM purchase (the
//       tier is what was priced); stock.js holds cash for an approved home; boot.js publishes nextTier

import './gameresolve.mjs'
import { Check } from './harness.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT } from './gameresolve.mjs'

const HP = await import('homeplan.js')
const BB = await import('bbplan.js')
const BN = await import('bitNodeMultipliers.js')
const P = await import('plan.js')
const LP = await import('bbliteplan.js')
const ST = await import('stack.js')
const { drain } = await import('coop.js')

const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn4-homeblade-0100.json'), 'utf8'))
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')
const n4 = BN.bitNodeMults(4)
// progress.js levelledPerson: the node's level multipliers on the save's.
const pm = F.player.mults
const person = {
  skills: F.player.skills,
  exp: F.player.exp,
  mults: { ...pm, strength: pm.strength * n4.StrengthLevelMultiplier, defense: pm.defense * n4.DefenseLevelMultiplier, dexterity: pm.dexterity * n4.DexterityLevelMultiplier, agility: pm.agility * n4.AgilityLevelMultiplier, charisma: pm.charisma * n4.CharismaLevelMultiplier },
}
const NOW = Date.parse(F.captured)
// THE ONE BUILDER (progress.js bladeRouteOf startFor), on the captured state.
const startFor = (spec) => BB.bladeStartOf({ tel: F.bladeburner, person, sleeves: { infiltrate: 0, support: 0, fa: 0 }, gymExpPerSec: F.bladeRoute.start.gymExpPerSec, bnRank: n4.BladeburnerRank, skillCostMult: n4.BladeburnerSkillCost, install: BB.bladeInstallOfSpec(spec), simulacrum: false, rankScale: F.bladeRoute.rankK, successScale: 1, now: NOW })
const COST = F.homeup.next.cost
const fmt = (x) => (typeof x === 'number' ? x.toFixed(3) : String(x))

/** boot.js's STACK, as data (the stage test's parser, condensed). */
function manifest() {
  const src = SRC('boot.js')
  const open = src.indexOf('[', src.indexOf('const STACK = ['))
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') depth++
    else if (src[i] === ']' && --depth === 0) return new Function(`return ${src.slice(open, i + 1)}`)()
  }
  throw new Error('no STACK in boot.js')
}

/** The live tier pair through the real planner, priced by the game's calculator (BN4, SF4.2). */
async function plans(rams) {
  const R = await import('./ram.mjs')
  await R.load()
  R.asSave({ bitNode: 4, sf: { 4: 2, 1: 3 } })
  const costOf = (s) => R.ramOf(s)?.cost ?? 0
  const STACK = manifest()
  let actionRam = 0
  for (const f of fs.readdirSync(REPO_ROOT)) if (/^act-.*\.js$/.test(f)) actionRam = Math.max(actionRam, costOf(f))
  const out = {}
  for (const r of rams) out[r] = ST.planStack(STACK, { homeRam: r, costOf, bootRam: costOf('boot.js'), minOps: ST.MIN_OPS, actionRam })
  return out
}
const bootOf = (now, next, from) => ({ admit: now.admit.map((e) => ({ script: e.script })), nextTier: { fromHomeRam: from, homeRam: next.homeRamFor, admit: next.admit.map((e) => ({ script: e.script, where: e.where, cost: e.cost, ...(e.raisesTo ? { raisesTo: e.raisesTo } : {}) })) } })
const FULL_HOST = (() => {
  const big = F.fleet.filter((h) => h.host !== 'home').sort((a, b) => b.maxRam - a.maxRam)[0]
  return { ok: big.maxRam >= 92.75, why: `${big.host} ${big.maxRam}GB` }
})()

export async function run() {
  const checks = []
  const pl = await plans([64, 96, 128])
  pl[96].homeRamFor = 96
  pl[128].homeRamFor = 128
  const unlocks128 = HP.tierUnlocksOf(bootOf(pl[64], pl[128], 64), 64)
  const unlocks96 = HP.tierUnlocksOf(bootOf(pl[64], pl[96], 64), 64)

  // ---- HB1 -----------------------------------------------------------------
  {
    const c = new Check('HB1', 'the next home upgrade is priced on the committed Bladeburner route (live BN4.3)')
    c.examined(1)
    const was = F.spendsHome
    if (!(F.bladeRoute.key === 'blade' && was && was.deltaH === null && was.pBuy === null)) c.fail('HB1 the fixture does not reproduce the incident', JSON.stringify(was))
    else c.note(`as captured: route ${F.bladeRoute.key} (exit ${F.bladeRoute.bladeH}h), spends.home ${JSON.stringify(was)} — "${F.spendExitHome?.why}"`)
    const moneyAt = (h) => F.wealth + F.incomePerSec * h * 3600
    const buy = HP.homeBuyAtOf({ cost: COST, moneyAt, installAtH: Infinity, post: null, maxH: F.bladeRoute.bladeH })
    if (!(buy.atH > 0 && buy.atH < F.bladeRoute.bladeH)) c.fail('HB1 the purchase hour on the live stream is not inside the exit', JSON.stringify(buy))
    const v = drain(HP.bladeHomeExitGen({ startFor, spec: null, cost: COST, buy, unlocks: unlocks128, daemonNow: F.bladeburner.daemon === 'bladeburner.js' ? 'bladeburner.js' : 'bb-lite', fullHost: FULL_HOST, go: { opponent: F.go.opponent, goPower: n4.GoPower ?? 1 }, maxH: 80 }))
    if (typeof v.deltaH !== 'number' || !isFinite(v.deltaH)) c.fail('HB1 the blade route still produces no deltaH', v.why)
    else {
      if (Math.abs(v.deltaH - (v.withH - v.withoutH)) > 1e-9) c.fail('HB1 the verdict is not withH - withoutH', `${v.deltaH} vs ${v.withH} - ${v.withoutH}`)
      const pd = P.decideSpend({ deltaH: v.deltaH, withoutH: v.withoutH, si: null })
      if (!pd || typeof pd.pBuy !== 'number') c.fail('HB1 plan.decideSpend did not decide it', JSON.stringify(pd))
      c.note(`live: buy at ${buy.atH.toFixed(2)}h ($${(COST / 1e6).toFixed(2)}m on $${(F.wealth / 1e6).toFixed(2)}m + $${((F.incomePerSec * 3600) / 1e6).toFixed(2)}m/h); exit ${fmt(v.withH)}h with vs ${fmt(v.withoutH)}h without -> deltaH ${fmt(v.deltaH)}h; plan: ${pd?.why}`)
      c.note(`  effects alone: ${v.effects.map((e) => `${e.name} ${e.deltaH}h`).join('; ')}; conservative (lean/full ${LP.LITE_OVER_FULL.hi}): ${v.conservative?.deltaH}h`)
      c.note(`  credited: ${v.credited.map((x) => x.script).join(', ')}; not: ${v.notCredited.map((x) => `${x.script} (${x.why})`).join('; ')}`)
    }
    // The wiring: both installgate writes price it and hand it to the spend verdicts.
    const src = SRC('progress.js')
    const calls = src.match(/await bladeHomeVerdictOf\(/g)?.length ?? 0
    if (calls !== 2) c.fail(`HB1 progress.js prices the blade home verdict at ${calls} installgate write(s), not both`, 'the planned and the unplanned paths each publish spendExit')
    if (!/offers, homeBlade0\)/.test(src) || !/offers, homeBlade1,/.test(src)) c.fail('HB1 a spendVerdictsOf call does not take the blade home verdict', 'homeBlade0 / homeBlade1')
    if (!/if \(homeOverride\) out\.home = /.test(src)) c.fail('HB1 spendVerdictsOf does not use the override as the home verdict')
    if (!/winLeft === null && !homeBlade0/.test(src)) c.fail('HB1 the unplanned path drops the blade verdict when no hacking window is measured')
    checks.push(c)
  }

  // ---- HB2 / HB3 -----------------------------------------------------------
  {
    const spec = { kind: 'wait', waitH: 8, blade: { gains: {}, simulacrum: false } }
    // A batch that exists at $50m and is gone at $18m: the purchase displaces it.
    const batchAt = (m) => (m >= 40e6 ? { gains: { strength: 1.08, defense: 1.08, dexterity: 1.08, agility: 1.08, bladeburner_success_chance: 1.05 }, simulacrum: false } : { gains: {}, simulacrum: false })
    const common = { startFor, spec, cost: COST, buy: { atH: 2, life: 'this' }, unlocks: unlocks128, batchAt, moneyAtInstall: 50e6, gainPerSec: 0, maxH: 80 }
    const c2 = new Check('HB2', 'the tier is worth more than the augmentations it displaces -> buy')
    c2.examined(1)
    const v = drain(HP.bladeHomeExitGen({ ...common, daemonNow: 'bb-lite', fullHost: { ok: true, why: 'fixture' }, go: { opponent: 'Daedalus' } }))
    const pd = v.deltaH === null ? null : P.decideSpend({ deltaH: v.deltaH, withoutH: v.withoutH, si: 0.02 })
    const disp = v.effects?.find((e) => e.name === 'displaced augmentations')
    const full = v.effects?.find((e) => e.name.startsWith('full daemon'))
    if (!(disp?.deltaH > 0)) c2.fail('HB2 the displaced batch does not lengthen the exit on its own', JSON.stringify(v.effects ?? v.why))
    if (!(full?.deltaH < 0)) c2.fail('HB2 the full daemon does not shorten the exit on its own', JSON.stringify(v.effects ?? v.why))
    if (!(pd?.buy === true)) c2.fail('HB2 not bought', `deltaH ${fmt(v.deltaH)}: ${pd?.why ?? v.why}`)
    c2.note(`with ${fmt(v.withH)}h vs without ${fmt(v.withoutH)}h (${fmt(v.deltaH)}h): displaced +${disp?.deltaH}h, full daemon ${full?.deltaH}h — ${pd?.why}`)
    checks.push(c2)

    const c3 = new Check('HB3', 'nothing the tier unlocks is on this exit, the displacement stands -> hold')
    for (const [label, o] of [
      ['bladeburner.js already the daemon', { daemonNow: 'bladeburner.js', fullHost: { ok: true, why: 'fixture' }, go: { opponent: 'Daedalus' } }],
      ['no host holds bladeburner.js', { daemonNow: 'bb-lite', fullHost: { ok: false, why: 'largest 64GB' }, go: { opponent: 'TheBlackHand' } }],
    ]) {
      c3.examined(1)
      const h = drain(HP.bladeHomeExitGen({ ...common, ...o }))
      const d = h.deltaH === null ? null : P.decideSpend({ deltaH: h.deltaH, withoutH: h.withoutH, si: 0.02 })
      if (!(h.deltaH > 0) || d?.buy !== false) c3.fail(`HB3 ${label}: not a hold`, `deltaH ${fmt(h.deltaH)}: ${d?.why ?? h.why}`)
      if (!h.notCredited?.some((x) => x.script === 'bladeburner.js')) c3.fail(`HB3 ${label}: the full daemon is not named as not credited`)
      c3.note(`${label}: deltaH ${fmt(h.deltaH)}h — ${d?.why}`)
    }
    checks.push(c3)
  }

  // ---- HB4 -----------------------------------------------------------------
  {
    const c = new Check('HB4', 'a tier is a step: the real manifest through the real planner, 64 -> 96 vs 64 -> 128GB')
    const live = new Set(F.boot.admit.map((e) => e.script))
    const planned = new Set(pl[64].admit.map((e) => e.script))
    const miss = [...live].filter((s) => !planned.has(s))
    const extra = [...planned].filter((s) => !live.has(s))
    c.examined(planned.size)
    if (miss.length || extra.length) c.fail('HB4 the 64GB plan does not reproduce the live boot.txt admit list', `missing ${miss.join(', ')}; extra ${extra.join(', ')}`)
    else c.note(`the 64GB plan reproduces the live boot.txt (${planned.size} admitted)`)
    const u128 = unlocks128.unlocked.map((u) => u.script)
    for (const s of ['bladeburner.js', 'go.js', 'batch.js']) if (!u128.includes(s)) c.fail(`HB4 ${s} is not admitted at 128GB`, u128.join(', '))
    const u96 = unlocks96.unlocked.map((u) => u.script)
    for (const s of ['bladeburner.js', 'go.js', 'batch.js']) if (u96.includes(s)) c.fail(`HB4 ${s} admitted at 96GB, below its tier`, u96.join(', '))
    c.note(`64->128 admits: ${u128.join(', ')} (retires ${unlocks128.retired.join(', ') || 'none'}); 64->96 admits: ${u96.join(', ') || 'nothing'}`)
    const base = { startFor, spec: null, cost: COST, buy: { atH: 3, life: 'this' }, daemonNow: 'bb-lite', fullHost: FULL_HOST, go: { opponent: 'Daedalus' }, maxH: 80 }
    const below = drain(HP.bladeHomeExitGen({ ...base, unlocks: unlocks96 }))
    const at = drain(HP.bladeHomeExitGen({ ...base, unlocks: unlocks128 }))
    if (below.deltaH !== 0) c.fail('HB4 a block below the tier moves the black-op exit', `${below.deltaH}`)
    if (!(at.deltaH < -1)) c.fail('HB4 crossing the tier does not shorten the exit', `${at.deltaH} (${at.why ?? ''})`)
    c.note(`deltaH below the boundary ${fmt(below.deltaH)}h, across it ${fmt(at.deltaH)}h`)
    if (HP.tierUnlocksOf({ admit: [], nextTier: { fromHomeRam: 32, homeRam: 64, admit: [] } }, 64) !== null) c.fail('HB4 a next-tier plan made for another home size is read')
    checks.push(c)
  }

  // ---- HB5 -----------------------------------------------------------------
  {
    const c = new Check('HB5', "bladeExit's mid-trajectory steps are the trajectory they claim")
    c.examined(3)
    const s0 = startFor(null)
    const k = 1.6
    const a = BB.bladeExit({ ...s0, steps: [{ atH: 0, rankScaleMult: k }] }).hours
    const b = BB.bladeExit({ ...s0, rankScale: s0.rankScale * k }).hours
    const none = BB.bladeExit(s0).hours
    const late = BB.bladeExit({ ...s0, steps: [{ atH: 999, rankScaleMult: k }] }).hours
    if (!(Math.abs(a - b) < 0.05)) c.fail('HB5 a rank step at 0h is not the scaled trajectory', `${a} vs ${b}`)
    if (late !== none) c.fail('HB5 a step past the exit changed it', `${late} vs ${none}`)
    const g = BB.bladeExit({ ...s0, steps: [{ atH: 0, gains: { strength: 1.2, defense: 1.2, dexterity: 1.2, agility: 1.2 } }] }).hours
    if (!(g < none)) c.fail('HB5 a combat multiplier step does not shorten the exit', `${g} vs ${none}`)
    c.note(`rank x${k}: step ${fmt(a)}h / scaled ${fmt(b)}h / none ${fmt(none)}h; combat x1.2 step ${fmt(g)}h`)
    checks.push(c)
  }

  // ---- HB6 -----------------------------------------------------------------
  {
    const c = new Check('HB6', 'an approved home buy reaches the money and the tier')
    c.examined(4)
    const wd = SRC('watchdog.js')
    if (!/const join = typeof v\.noJoin === 'string' && v\.noJoin \? 0 : joinClaim\(claimSrc, claimLife\)/.test(wd)) c.fail("HB6 watchdog's homeup trigger still holds the join claim against a verdict with no join on its trajectory", `live: joinClaim $${(F.joinClaim / 1e9).toFixed(0)}b against a $${(COST / 1e6).toFixed(2)}m block`)
    if (!/noJoin: "the committed exit is the 21 black ops/.test(SRC('progress.js'))) c.fail('HB6 the blade home verdict does not carry noJoin')
    const act = SRC('act.js')
    const hu = act.slice(act.indexOf('async function homeUpgradeIfBlocked'), act.indexOf('async function homeUpgradeIfBlocked') + 1400)
    if (!/ns\.exec\('boot\.js', 'home', 1\)/.test(hu)) c.fail('HB6 act.js buys the RAM block and never re-enters boot.js', 'the 128GB daemons the purchase was priced for would not be admitted')
    if (!/spendExit\?\.home/.test(SRC('stock.js'))) c.fail('HB6 stock.js no longer holds cash for an approved home')
    if (!/nextTier: \{\s*fromHomeRam: homeRam,\s*homeRam: homeRam \* 2/.test(SRC('boot.js'))) c.fail('HB6 boot.js does not publish the next tier plan')
    checks.push(c)
  }

  // ---- HB7 -----------------------------------------------------------------
  {
    const c = new Check('HB7', "go.js credited by the opponent it will choose on the black-op exit's own weights (live BN4.3)")
    const GW = await import('goweights.js')
    const gw = drain(GW.bladeGoWeightsGen({ startFor, spec: null, maxH: 80, batchMoneyPerSec: F.incomePerSec }))
    c.examined(1)
    if (!(gw.weights?.combat > 0)) c.fail('HB7 the combat channel weighs nothing on the black-op exit', JSON.stringify(gw).slice(0, 300))
    const pick = HP.goOpponentOnBlade({ opponent: F.go.opponent, weights: gw.weights, windowH: gw.windowH, goPower: n4.GoPower ?? 1 })
    c.examined(1)
    if (pick.opponent !== 'Tetrads') c.fail(`HB7 the farm does not choose Tetrads on the blade weights (live go.txt: ${F.go.opponent})`, pick.why)
    const moneyAt = (h) => F.wealth + F.incomePerSec * h * 3600
    const buy = HP.homeBuyAtOf({ cost: COST, moneyAt, installAtH: Infinity, post: null, maxH: F.bladeRoute.bladeH })
    const base = { startFor, spec: null, cost: COST, buy, unlocks: unlocks128, daemonNow: 'bb-lite', fullHost: FULL_HOST, maxH: 80 }
    const old = drain(HP.bladeHomeExitGen({ ...base, go: { opponent: F.go.opponent, goPower: n4.GoPower ?? 1 } }))
    const v = drain(HP.bladeHomeExitGen({ ...base, go: { opponent: F.go.opponent, goPower: n4.GoPower ?? 1, weights: gw.weights, windowH: gw.windowH } }))
    c.examined(2)
    const goAlone = v.effects?.find((e) => e.name.startsWith('Go farm'))
    if (!v.credited?.some((x) => x.script === 'go.js')) c.fail('HB7 go.js is not credited on the blade weights', JSON.stringify(v.notCredited))
    if (!(goAlone?.deltaH < 0)) c.fail('HB7 the Go farm alone does not shorten the black-op exit', JSON.stringify(v.effects))
    if (!(v.deltaH < old.deltaH)) c.fail('HB7 crediting go.js does not improve the verdict', `${v.deltaH} vs ${old.deltaH}`)
    // Without the weights, the fallback is go.txt's opponent, as before.
    if (old.credited?.some((x) => x.script === 'go.js')) c.fail('HB7 go.js credited with no weights on a non-combat go.txt opponent')
    c.note(`blade weights: combat ${gw.weights?.combat?.toFixed(2)} h/ln (curve ${JSON.stringify(gw.detail?.combatCurve)}), money/rep ${gw.detail?.batch ?? ''}`)
    c.note(`pick: ${pick.why.slice(0, 160)}`)
    c.note(`home 64->128GB: deltaH ${fmt(old.deltaH)}h without go.js credited -> ${fmt(v.deltaH)}h with (Go farm alone ${goAlone?.deltaH}h; full daemon alone ${v.effects?.find((e) => e.name.startsWith('full'))?.deltaH}h; conservative ${v.conservative?.deltaH}h)`)
    // The wiring: progress.js publishes the blade weights as the gate's
    // goWeights and hands them to the home verdict; go.js reads their window.
    const src = SRC('progress.js')
    c.examined(3)
    if ((src.match(/await bladeGoWeightsOf\(/g)?.length ?? 0) !== 2) c.fail('HB7 progress.js does not price the blade Go weights at both installgate writes')
    if (!/if \(goBlade0\) weightsMeta = \{ \.\.\.weightsMeta, goWeights: goBlade0 \}/.test(src) || !/if \(goBlade1\) weightsMeta = \{ \.\.\.weightsMeta, goWeights: goBlade1 \}/.test(src)) c.fail('HB7 the blade Go weights are not published as objective.goWeights')
    if (!/goWeights: goBlade0 \}\)/.test(src) || !/goWeights: goBlade1 \}\)/.test(src)) c.fail('HB7 the home verdict does not take the blade Go weights')
    if (!/windowH: gw\?\.windowH \?\? gate\?\.objective\?\.windowH/.test(SRC('go.js'))) c.fail("HB7 go.js does not read the blade weights' own window")
    checks.push(c)
  }

  // ---- HB8 -----------------------------------------------------------------
  {
    const c = new Check('HB8', "the blade Go weights' batch channels: through the committed install's batch, refused when it cannot be re-planned; the hacking route still skips Tetrads by name")
    const GW = await import('goweights.js')
    const GP = await import('goplan.js')
    const spec = { kind: 'wait', waitH: 8, blade: { gains: {}, simulacrum: false } }
    const batchAt = (m) => (m >= 40e6 ? { gains: { strength: 1.08, defense: 1.08, dexterity: 1.08, agility: 1.08, bladeburner_success_chance: 1.05 }, simulacrum: false } : { gains: {}, simulacrum: false })
    const o = { startFor, spec, maxH: 80, batchAt, moneyAtInstall: 30e6, batchMoneyPerSec: 2000, hackShare: 0.3 }
    const w = drain(GW.bladeGoWeightsGen(o))
    c.examined(4)
    if (!w.weights) c.fail('HB8 refused with a re-plannable batch', w.why)
    else {
      if (!(w.weights.hacking_money > 0 && w.weights.hacking_speed > w.weights.hacking_money)) c.fail('HB8 the money channels do not reach the exit through the batch', JSON.stringify(w.weights))
      // A bonus that dies at the 8h install is priced by the model, whatever it says (a number, never null).
      if (!(typeof w.weights.combat === 'number' && w.weights.combat >= 0) || w.detail?.combatCurve?.length !== GW.BLADE_D_GRID.length) c.fail('HB8 the combat bonus up to the install is unpriced', JSON.stringify(w.detail?.combatCurve))
      if (w.windowH !== 8) c.fail(`HB8 the window is not the committed install (${w.windowH})`)
      c.note(`install at 8h: ${JSON.stringify(w.weights)}; combat curve ${JSON.stringify(w.detail?.combatCurve)} vs ${w.detail?.exitH}h; plateau ${JSON.stringify(w.detail?.plateau)}`)
    }
    const zero = drain(GW.bladeGoWeightsGen({ ...o, batchMoneyPerSec: 0 }))
    if (zero.weights?.hacking_money !== 0) c.fail('HB8 no hack() income: hacking_money must be exactly 0', JSON.stringify(zero.weights))
    const noPlan = drain(GW.bladeGoWeightsGen({ ...o, batchAt: null }))
    if (noPlan.weights !== null || !/re-planned/.test(noPlan.why ?? '')) c.fail('HB8 a committed install with no batch re-plan is not refused by name', JSON.stringify(noPlan))
    // The hacking route's weights carry no combat key: Tetrads skipped by name, not scored 0.
    c.examined(1)
    const hack = GP.chooseOpponent({ weights: { faction_rep: 1, hacking_speed: 1, hacking_money: 1 }, windowH: 2, incumbent: 'Daedalus', nodePower: Object.fromEntries(Object.keys(GP.OPPONENTS).map((k) => [k, 0])) })
    if (!/Tetrads \(combat: objective carries no weight this pass\)/.test(hack.why)) c.fail('HB8 the hacking route does not skip Tetrads by name', hack.why)
    checks.push(c)
  }

  // ---- HB9 -----------------------------------------------------------------
  // LIVE 02:37Z (tools/test/fixture-bn4-gymless-0237.json): the player stood in
  // Ishima (no gym) with $23.7k, under the $200k flight, so bestGym answered
  // null, bladeRoute.start.gymExpPerSec was null, and every blade arm holding
  // an install was unpriced ("the retrain has no gym rate") — the route's
  // compare read -1.7e14h and objective.goWeights refused ("the black-op exit
  // is unpriced from this start"), so go.js stayed on Daedalus.
  {
    const c = new Check('HB9', 'a player with no gym in town and no fare still prices the retrain: the blade exit and the Go weights price with an install committed (live 02:37Z)')
    const L = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn4-gymless-0237.json'), 'utf8'))
    const BP = await import('bodyplan.js')
    const GW = await import('goweights.js')
    const lp = { ...L.player, mults: person.mults }
    c.examined(2)
    if (L.bladeRoute.start.gymExpPerSec !== null || L.goWeights.weights !== null) c.fail('HB9 the fixture does not reproduce the incident', JSON.stringify({ start: L.bladeRoute.start, gw: L.goWeights }))
    if (BP.bestGym(lp) !== null) c.fail('HB9 bestGym answers for the live person — the incident is not reproduced')
    const rg = BP.retrainGymOf(lp)
    const rate = rg.gym ? BP.gymRate(rg.gym, 'strength', lp, L.bladeRoute.start.trainingMult) : null
    c.examined(1)
    if (!(rate > 0) || !rg.why) c.fail('HB9 retrainGymOf gives no rate (or does not say why it travelled)', JSON.stringify(rg))
    const sf = (g) => (sp) => BB.bladeStartOf({ tel: L.bladeburner, person: lp, sleeves: L.bladeRoute.sleeves, gymExpPerSec: g, bnRank: n4.BladeburnerRank, skillCostMult: n4.BladeburnerSkillCost, install: BB.bladeInstallOfSpec(sp), simulacrum: false, rankScale: L.bladeRoute.calibration.rank, successScale: L.bladeRoute.calibration.success, now: Date.parse(L.captured) })
    const spec = { kind: 'wait', waitH: 2, blade: { gains: {}, simulacrum: false } }
    const before = BB.bladeExit({ ...sf(null)(spec), maxH: 200 })
    const after = BB.bladeExit({ ...sf(rate)(spec), maxH: 200 })
    c.examined(2)
    if (before.hours !== null) c.fail('HB9 with no gym rate the install arm priced — the incident is not reproduced', String(before.hours))
    if (!(after.hours > 0)) c.fail('HB9 the install arm is still unpriced with the retrain gym', after.why)
    const batchAt = (m) => (m >= 60e6 ? { gains: { strength: 1.1, defense: 1.1, dexterity: 1.1, agility: 1.1, bladeburner_success_chance: 1.1 } } : m >= 25e6 ? { gains: { strength: 1.05, defense: 1.05, dexterity: 1.05, agility: 1.05 } } : { gains: {} })
    const gw = drain(GW.bladeGoWeightsGen({ startFor: sf(rate), spec, maxH: 200, batchAt, moneyAtInstall: 30e6, batchMoneyPerSec: 3000, hackShare: 0.3 }))
    c.examined(1)
    if (!gw.weights) c.fail('HB9 the Go weights still refuse', gw.why)
    else {
      const pick = HP.goOpponentOnBlade({ weights: gw.weights, windowH: gw.windowH })
      c.note(`retrain gym: ${rg.why}; install arm ${before.hours} -> ${after.hours?.toFixed(3)}h; Go weights (install at 2h, stub batch): ${JSON.stringify(gw.weights)}; combat curve ${JSON.stringify(gw.detail?.combatCurve)} vs ${gw.detail?.exitH}h; pick ${pick.opponent}`)
    }
    const src = SRC('progress.js')
    c.examined(2)
    if (!/const \{ gym, why: gymWhy \} = retrainGymOf\(person\)/.test(src)) c.fail('HB9 progress.js bladeRouteOf does not price the retrain with retrainGymOf')
    if (!/const gym = retrainGymOf\(person\)\.gym/.test(SRC('sleeve.js'))) c.fail("HB9 sleeve.js's Bladeburner fleet does not price the retrain with retrainGymOf")
    checks.push(c)
  }

  // ---- HB10 ----------------------------------------------------------------
  // LIVE 2026-10-03 10:53Z: "PLAN BLOCKED THE PAGE: a 91.1ms synchronous block
  // against 50ms — longest step 89ms in 'goweights-blade' (step 9058 of
  // 10564)". The plateau search's batchAt calls (progress.js: a planPurchases
  // re-plan each, several ms) ran back to back inside one generator step — up
  // to 18 of them. Each call out is now its own step.
  //
  // BEFORE is the same source with the bare yields stripped from
  // bladeGoWeightsGen (written beside the OS temp dir, bbplan.js shared), so
  // the comparison survives any change to the exit model: the yields are
  // pacing only, and the results must be identical on the HB7/HB8/HB9 inputs.
  // THE BUDGET is counted in calls out per step (load-independent: at most
  // one startFor or batchAt a step, and BEFORE must break it, so the check is
  // seen to fail), then timed under the real pacer with batchAt costing
  // BATCH_MS — a planPurchases on this node's batch scale (2-8ms on the
  // fixture-augs catalogue at $10m-$1b) — every step under PLAN.maxBlockMs.
  {
    const c = new Check('HB10', "the blade Go weights yield between calls out: no 'goweights-blade' step holds the page past the block limit, and the weights are identical (live 10:53Z)")
    const GW = await import('goweights.js')
    const CO = await import('coop.js')
    const os = await import('node:os')
    const src = SRC('goweights.js')
    const at = src.indexOf('export function* bladeGoWeightsGen(')
    const end = src.indexOf('\n}\n', at)
    const body = src.slice(at, end)
    const nYield = (body.match(/^\s*yield\s*$/gm) ?? []).length
    c.examined(1)
    if (nYield < 4) c.fail(`HB10 bladeGoWeightsGen carries ${nYield} bare yields (startFor, b0, and both plateau ladders each need one)`)
    const beforeFile = path.join(os.tmpdir(), `goweights-noyield-${process.pid}.mjs`)
    fs.writeFileSync(beforeFile, src.slice(0, at) + body.replace(/^\s*yield\s*$/gm, '') + src.slice(end))
    const BEFORE = await import(beforeFile)
    fs.rmSync(beforeFile, { force: true })
    const L = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'tools/test/fixture-bn4-gymless-0237.json'), 'utf8'))
    const BP = await import('bodyplan.js')
    const lp = { ...L.player, mults: person.mults }
    const rate = BP.gymRate(BP.retrainGymOf(lp).gym, 'strength', lp, L.bladeRoute.start.trainingMult)
    const sf9 = (sp) => BB.bladeStartOf({ tel: L.bladeburner, person: lp, sleeves: L.bladeRoute.sleeves, gymExpPerSec: rate, bnRank: n4.BladeburnerRank, skillCostMult: n4.BladeburnerSkillCost, install: BB.bladeInstallOfSpec(sp), simulacrum: false, rankScale: L.bladeRoute.calibration.rank, successScale: L.bladeRoute.calibration.success, now: Date.parse(L.captured) })
    const ba8 = (m) => (m >= 40e6 ? { gains: { strength: 1.08, defense: 1.08, dexterity: 1.08, agility: 1.08, bladeburner_success_chance: 1.05 }, simulacrum: false } : { gains: {}, simulacrum: false })
    const ba9 = (m) => (m >= 60e6 ? { gains: { strength: 1.1, defense: 1.1, dexterity: 1.1, agility: 1.1, bladeburner_success_chance: 1.1 } } : m >= 25e6 ? { gains: { strength: 1.05, defense: 1.05, dexterity: 1.05, agility: 1.05 } } : { gains: {} })
    const spec8 = { kind: 'wait', waitH: 8, blade: { gains: {}, simulacrum: false } }
    const cases = {
      HB7: { startFor, spec: null, maxH: 80, batchMoneyPerSec: F.incomePerSec },
      HB8: { startFor, spec: spec8, maxH: 80, batchAt: ba8, moneyAtInstall: 30e6, batchMoneyPerSec: 2000, hackShare: 0.3 },
      'HB8+rep': { startFor, spec: spec8, maxH: 80, batchAt: ba8, moneyAtInstall: 45e6, batchMoneyPerSec: 2000, hackShare: 0.3, eRep: 0.4, ageH: 3 },
      HB9: { startFor: sf9, spec: { kind: 'wait', waitH: 2, blade: { gains: {}, simulacrum: false } }, maxH: 200, batchAt: ba9, moneyAtInstall: 30e6, batchMoneyPerSec: 3000, hackShare: 0.3 },
    }
    for (const [k, o] of Object.entries(cases)) {
      const a = JSON.stringify(drain(BEFORE.bladeGoWeightsGen(o)))
      const b = JSON.stringify(drain(GW.bladeGoWeightsGen(o)))
      c.examined(1)
      if (a !== b) c.fail(`HB10 ${k}: the weights differ with the yields`, `before ${a.slice(0, 200)} / after ${b.slice(0, 200)}`)
      else c.note(`${k}: identical — ${JSON.stringify(JSON.parse(b).weights)}`)
    }
    // Calls out per step (work units, not wall time).
    const callsPerStep = (mod, o) => {
      let calls = 0
      const counted = { ...o, startFor: (sp) => (calls++, o.startFor(sp)), batchAt: (m) => (calls++, o.batchAt(m)) }
      const g = mod.bladeGoWeightsGen(counted)
      let worst = 0
      for (let r = { done: false }; !r.done; ) {
        calls = 0
        r = g.next()
        worst = Math.max(worst, calls)
      }
      return worst
    }
    const after8 = callsPerStep(GW, cases.HB8)
    const before8 = callsPerStep(BEFORE, cases.HB8)
    c.examined(2)
    if (after8 > 1) c.fail(`HB10 a step makes ${after8} calls out (startFor/batchAt): each must be its own step`)
    if (!(before8 > 1)) c.fail(`HB10 the stripped version makes at most ${before8} call a step — the count cannot see the live defect`)
    // Timed under the pacer, the live block limit.
    const BATCH_MS = 6
    const spin = (ms) => {
      const t = performance.now()
      while (performance.now() - t < ms);
    }
    const costed = { ...cases.HB8, batchAt: (m) => (spin(BATCH_MS), ba8(m)) }
    const paced = async (mod) => {
      const pacer = CO.makePacer({ sliceMs: P.PLAN.sliceMs, yieldFn: () => new Promise((r) => setImmediate(r)), memory: new Map() })
      const r = await pacer.slices(mod.bladeGoWeightsGen(costed), 'goweights-blade')
      return { r, sec: pacer.stats.sections['goweights-blade'], block: pacer.stats.maxBlockMs }
    }
    const now = await paced(GW)
    const was = await paced(BEFORE)
    c.examined(1)
    if (JSON.stringify(now.r) !== JSON.stringify(drain(GW.bladeGoWeightsGen(cases.HB8)))) c.fail('HB10 the paced run is not the drained one')
    if (!(now.sec.maxStepMs < P.PLAN.maxBlockMs)) c.fail(`HB10 a ${now.sec.maxStepMs.toFixed(1)}ms step in 'goweights-blade' (step ${now.sec.maxStepAt} of ${now.sec.steps}) against the ${P.PLAN.maxBlockMs}ms block limit`)
    c.note(`calls out per step: ${before8} before -> ${after8} after; batchAt at ${BATCH_MS}ms: longest step ${was.sec.maxStepMs.toFixed(1)}ms (step ${was.sec.maxStepAt} of ${was.sec.steps}) before -> ${now.sec.maxStepMs.toFixed(1)}ms (step ${now.sec.maxStepAt} of ${now.sec.steps}) after; longest block ${was.block.toFixed(1)} -> ${now.block.toFixed(1)}ms (limit ${P.PLAN.maxBlockMs}ms)`)
    // The Bladeburner home verdict re-plans twice in a row too: one call a step.
    const hp = SRC('homeplan.js')
    c.examined(1)
    if (!/const b0 = batchAt\(moneyAtInstall\)\n\s*yield[^\n]*\n\s*const b1 = batchAt\(Math\.max\(0, after\)\)\n\s*yield\n/.test(hp)) c.fail('HB10 homeplan.bladeHomeExitGen re-plans both batches in one step')
    checks.push(c)
  }

  // ---- HB11 ----------------------------------------------------------------
  {
    const c = new Check('HB11', "bb-lite's lean phase in the start: the full daemon is the model's own policy from the purchase, not a rank ratio over a trajectory that already priced it (2026-10-03)")
    // bb-lite at 64GB: the full daemon comes only with the upgrade (bbliteplan.leanUntilOf -> Infinity).
    const untilH = LP.leanUntilOf(F.bladeburner, 64)
    c.examined(1)
    if (untilH !== Infinity || LP.leanUntilOf(F.bladeburner, 128) !== LP.LEAN_PLACE_H || LP.leanUntilOf({ ...F.bladeburner, daemon: 'bladeburner.js' }, 64) !== null) c.fail('HB11 leanUntilOf: bb-lite under the tier -> Infinity, at the tier -> the placement, the full daemon -> none')
    // An approved purchase of the tier (installgate spendExit.home, this life): the handover is its hour plus the placement.
    const appr = { buy: true, buyAtH: 2, tier: { homeRam: 128 }, at: new Date(NOW - 1800e3).toISOString(), lastAugReset: F.bladeburner.lastAugReset }
    const hAppr = LP.leanUntilOf(F.bladeburner, 64, { spendHome: appr, lastAugReset: F.bladeburner.lastAugReset, now: NOW })
    const hOther = LP.leanUntilOf(F.bladeburner, 64, { spendHome: { ...appr, lastAugReset: 1 }, lastAugReset: F.bladeburner.lastAugReset, now: NOW })
    const hSmall = LP.leanUntilOf(F.bladeburner, 64, { spendHome: { ...appr, tier: { homeRam: 96 } }, lastAugReset: F.bladeburner.lastAugReset, now: NOW })
    c.examined(3)
    if (Math.abs(hAppr - (1.5 + LP.LEAN_PLACE_H)) > 1e-9 || hOther !== Infinity || hSmall !== Infinity) c.fail('HB11 an approved tier purchase ends the lean phase at its hour (this life, a tier that admits the full daemon)', JSON.stringify({ hAppr, hOther, hSmall }))
    const startLean = (spec) => ({ ...startFor(spec), ...BB.bladeStartOf({ tel: F.bladeburner, person, sleeves: { infiltrate: 0, support: 0, fa: 0 }, gymExpPerSec: F.bladeRoute.start.gymExpPerSec, bnRank: n4.BladeburnerRank, skillCostMult: n4.BladeburnerSkillCost, install: BB.bladeInstallOfSpec(spec), simulacrum: false, rankScale: 1, successScale: 1, leanUntilH: untilH, now: NOW }) })
    const moneyAt = (h) => F.wealth + F.incomePerSec * h * 3600
    const buy = HP.homeBuyAtOf({ cost: COST, moneyAt, installAtH: Infinity, post: null, maxH: F.bladeRoute.bladeH })
    const v = drain(HP.bladeHomeExitGen({ startFor: startLean, spec: null, cost: COST, buy, unlocks: unlocks128, daemonNow: 'bb-lite', fullHost: FULL_HOST, go: null, maxH: 120 }))
    c.examined(3)
    const step = v.credited?.find((x) => x.script === 'bladeburner.js')
    if (!step || !/policy/.test(step.why)) c.fail('HB11 the full daemon is not credited as its policy from the purchase', JSON.stringify(v.credited))
    if (!(v.deltaH < 0)) c.fail('HB11 the tier that admits the full daemon does not shorten the lean exit', JSON.stringify({ withH: v.withH, withoutH: v.withoutH }))
    if (v.conservative) c.fail('HB11 the lean/full ratio bound is published where no ratio was applied')
    // The lean exit is the lean policy: slower than the full daemon's from the same start (bbliteplan's lean surface gives up cities, levels, Raid, the team).
    const full = BB.bladeExit({ ...startFor(null), rankScale: 1 }).hours
    const leanOnly = BB.bladeExit(startLean(null)).hours
    c.examined(1)
    if (!(leanOnly > full)) c.fail('HB11 the lean policy is not slower than the full one', `${leanOnly} vs ${full}`)
    c.note(`bb-lite at 64GB: exit ${fmt(leanOnly)}h lean throughout vs ${fmt(full)}h full from now; the 128GB tier bought at ${fmt(buy.atH)}h -> ${fmt(v.withH)}h (deltaH ${fmt(v.deltaH)}h; the ratio form gave the full-daemon trajectory x1/${LP.LITE_OVER_FULL.mid} on top of k ${F.bladeRoute.rankK})`)
    if (!/leanUntilOf\(tel, /.test(SRC('progress.js'))) c.fail('HB11 progress.js does not put the lean phase in the route\'s start')
    checks.push(c)
  }
  return checks
}
