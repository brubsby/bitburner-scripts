// BITNODE 8's CALIBRATIONS (2026-10-23): the trader by market age, Stanek's Gift per life, the BN8 exit model.
// Each check goes red when its calibration regresses (tools/mutant.mjs watched each one fail).
//
//   TA1 THE TRADER BY AGE IS THE LEDGER'S FIT: traderw.RW_AGE = rwage.mjs's fit on the frozen ledger
//       (fixture-rwage-bins.json, 1091 bins, 62 market-lives); its money over the fitted range within 10% of the
//       measured per regime, and its mean |rate error| below the fresh-market RW_PRIOR's.
//   TA2 (slow tier) THE AGE TERM EARNS ITS PLACE OUT OF SAMPLE: pre-4S leave-one-node-out mean |rate error| with
//       age below the no-age fit's by >= 0.02/h.
//   TA3 BN8.1's STALL LIFE (CLAUDE.md: $250m -> $57b in 5.8h) through the committed curve x BN8's factor: within
//       10% in ln growth.
//   TA4 THE WIRING (exitplan hoursToMoney / exitHours, traderw.capitalAgeInputsOf, progress.js): absent capitalAge
//       nothing moves; with it a fresh-market leg matches an independent fine integration within 3%; an older market
//       is never slower; an install's leg trades on a fresh market; progress.js applies it only where the trader is
//       the income.
//   GC1 THE GIFT PER LIFE: stanekplan.GIFT_CAL = giftcal.mjs's fit on the frozen lives (fixture-giftcal-lives.json);
//       calibrated rms ln error < the uncalibrated's and <= 0.18; lives past the charger's start within 15% by
//       length bin; a life shorter than the start reads 1.
//   GC2 THE GAMEPLAN USES IT: stanek.mjs's factors at GIFT_CAL, world.giftCal null = the uncalibrated model.
//   B81 / B82 (child: gameplan/bn8test.mjs, the game's catalogue) THE BN8.1 REPLAY within tolerance and the
//       committed BN8_CAL / RW_BN8 = their fits; BN8.2 priced, sane, monotone in the trader.
//   B85 (same child) THE IPvGO FARM IN BN8: goplan.STOCK_GO_WEIGHTS = bn8.mjs goWeightsTable; the farm as played
//       (GO_PLAYED: Daedalus in the final life, the hidden opponent in the climb) beats no farm and the early
//       weights' Illuminati throughout by >= 0.5h; the route's hours are the farm as played.
//   B83 THE ROUTE: with the BN8 model on, BN8 is priced by 'stocks' only (hack/stanek off there); --bn8-hack
//       restores the old routes; other nodes unchanged.
//   B84 THE GIFT IN BN8 LIVE (stanekplan.STOCK_GIFT_PRICED): accept iff the BN8 model says it wins, basis 'hack';
//       an SF13 level without an entry HOLDS the option (the order gate refuses non-NFG); the table = bn8.mjs
//       (B81's child). Was: declined unpriced (BN8 has no Bladeburner route for the L4 chain; entry dry-run 2026-10-24).

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { Check, QUICK } from './harness.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '../..')
const TW = await import('../../traderw.js')
const X = await import('../../exitplan.js')
const SP = await import('../../stanekplan.js')
const RA = await import('../sim/stocks/rwage.mjs')
const GC = await import('../sim/gameplan/giftcal.mjs')

const binsOf = () => JSON.parse(fs.readFileSync(RA.FIXTURE, 'utf8')).rows

function ta1() {
  const c = new Check('TA1', "the trader by market age is the ledger's fit (traderw.RW_AGE = rwage.mjs on the frozen ledger), its money within 10% per regime, better than the fresh-market prior")
  const rows = binsOf()
  const pre = RA.fitRegime('pre-long', rows.filter((b) => b.reg === 'pre-long' && b.group !== 'bn8'), { ageOn: true })
  const s4 = RA.fitRegime('4S-long', rows.filter((b) => b.reg === '4S-long' && b.group !== 'bn8'), { ageOn: pre.p.beta })
  for (const [reg, f] of [['pre-long', pre], ['4S-long', s4]]) {
    const k = TW.RW_AGE[reg]
    c.examined(1)
    c.note(`${reg}: fit r0 ${f.p.r0PerHour.toFixed(3)} W1 ${f.p.W1.toExponential(2)} beta ${f.p.beta.toFixed(3)} | committed r0 ${k.r0PerHour} W1 ${k.W1.toExponential(2)} beta ${k.beta}`)
    if (Math.abs(f.p.r0PerHour / k.r0PerHour - 1) > 0.03 || Math.abs(Math.log(f.p.W1 / k.W1)) > 0.15 || Math.abs(f.p.beta - k.beta) > 0.05) c.fail(`traderw.RW_AGE['${reg}'] is not the ledger's fit`, `fit r0 ${f.p.r0PerHour.toFixed(3)} W1 ${f.p.W1.toExponential(2)} beta ${f.p.beta.toFixed(3)}`)
    const train = rows.filter((b) => b.reg === reg && b.group !== 'bn8' && b.W <= RA.FIT_WMAX)
    const mk = RA.perMarket(train, { committed: (b) => TW.rwAgeRate(b.W, b.age, reg), prior: (b) => TW.RW_PRIOR[reg].r0PerHour * TW.rwShape(b.W, TW.RW_PRIOR[reg].Wstar, TW.RW_PRIOR[reg].shape) })
    const sc = RA.summary(mk, 'committed')
    const sp = RA.summary(mk, 'prior')
    c.note(`${reg} over the fitted range: committed money ${(100 * sc.dollarErr).toFixed(0)}%, mean |rate error| ${sc.rateAbs.toFixed(3)}/h | RW_PRIOR ${(100 * sp.dollarErr).toFixed(0)}%, ${sp.rateAbs.toFixed(3)}/h`)
    if (Math.abs(sc.dollarErr) > 0.1) c.fail(`${reg}: the committed curve's money over the fitted range is ${(100 * sc.dollarErr).toFixed(0)}% off the measured (tolerance 10%)`)
    if (!(sc.rateAbs < sp.rateAbs)) c.fail(`${reg}: the age curve is no better than the fresh-market prior (${sc.rateAbs.toFixed(3)} vs ${sp.rateAbs.toFixed(3)}/h)`)
  }
  return c
}

function ta2() {
  const c = new Check('TA2', 'the age term earns its place out of sample: pre-4S leave-one-node-out mean |rate error| with age below the no-age fit by >= 0.02/h')
  if (QUICK) {
    c.skip(1, 'the leave-one-node-out refits (~1 min)')
    return c
  }
  const rows = binsOf().filter((b) => b.W <= RA.FIT_WMAX)
  const a = RA.lono(rows, 'pre-long', { ageOn: true })
  const n = RA.lono(rows, 'pre-long', { ageOn: false })
  const mk = RA.perMarket(rows.filter((b) => a.has(b)), { age: (b) => a.get(b), noAge: (b) => n.get(b) })
  const sa = RA.summary(mk, 'age')
  const sn = RA.summary(mk, 'noAge')
  c.examined(mk.length)
  c.note(`leave-one-node-out mean |rate error|: age ${sa.rateAbs.toFixed(3)}/h, no age ${sn.rateAbs.toFixed(3)}/h; money age ${(100 * sa.dollarErr).toFixed(0)}%, no age ${(100 * sn.dollarErr).toFixed(0)}%`)
  if (!(sa.rateAbs <= sn.rateAbs - 0.02)) c.fail('the age term does not beat the no-age curve out of sample by 0.02/h')
  return c
}

function ta3() {
  const c = new Check('TA3', "BN8.1's stall life ($250m -> $57b in 5.8h, CLAUDE.md) through the committed curve x BN8's factor within 10% in ln growth")
  const k = TW.rwBn8Kappa(256)
  let W = 2.5e8
  for (let t = 0; t < 5.8 - 1e-9; t += 0.01) W *= Math.exp(k * TW.rwAgeRate(W, t + 0.005, 'pre-long') * 0.01)
  const err = Math.log(W / 2.5e8) / Math.log(57e9 / 2.5e8) - 1
  c.examined(1)
  c.note(`$250m -> $${W.toExponential(2)} in 5.8h at kappa8(256GB) ${k.toFixed(3)} (measured $5.7e10): ${(100 * err).toFixed(1)}% in ln growth`)
  if (Math.abs(err) > 0.1) c.fail(`the stall life reads ${(100 * err).toFixed(1)}% in ln growth (tolerance 10%)`)
  return c
}

function ta4() {
  const c = new Check('TA4', 'the age-aware knee in the exit: absent nothing moves; a fresh leg = a fine integration (3%); older markets never slower; installs trade on a fresh market; progress.js only where the trader is the income')
  const ci = TW.capitalAgeInputsOf({ regime: 'pre-long', ageNowH: 0, homeGB: 1024 })
  const base = { money0: 2.5e8, incomeAtLevel1: 0, mult: 2, exp0: 0, expPerSec: 1000, capitalReturnPerSec: ci.capitalReturnPerSec, capitalCap: 1e15, capitalScaleW: ci.capitalScaleW, capitalShape: ci.capitalShape }
  // (a) absent: identical to the call without the field
  const h0 = X.hoursToMoney(1e12, base)
  const h0b = X.hoursToMoney(1e12, { ...base, capitalAge: undefined })
  c.examined(1)
  if (h0 !== h0b) c.fail(`capitalAge absent moved the leg: ${h0} vs ${h0b}`)
  // (b) a fresh market, the knee by age, against a fine independent integration
  const hA = X.hoursToMoney(1e12, { ...base, capitalAge: { ...ci.capitalAge, ageH0: 0 } })
  let W = 2.5e8
  let t = 0
  const r0 = ci.capitalReturnPerSec * 3600
  const sh = ci.capitalShape
  while (W < 1e12 && t < 200) {
    const a = t + 0.0005
    W *= Math.exp(r0 * TW.rwShape(W, ci.capitalAge.W1 * Math.pow(Math.max(a, ci.capitalAge.aMin), ci.capitalAge.beta), sh) * 0.001)
    t += 0.001
  }
  c.examined(1)
  c.note(`$250m -> $1e12 on a fresh market at kappa8(1TB) ${ci.capitalAge.kappa.toFixed(3)}: exitplan ${hA.toFixed(3)}h, fine integration ${t.toFixed(3)}h (${(100 * (hA / t - 1)).toFixed(1)}%); one knee at the start's age (the old leg) ${h0.toFixed(2)}h`)
  if (!(Math.abs(hA / t - 1) <= 0.03)) c.fail(`the age-aware leg is ${(100 * (hA / t - 1)).toFixed(1)}% off a fine integration (tolerance 3%)`)
  // (c) an older market is never slower
  const hOld = X.hoursToMoney(1e12, { ...base, capitalAge: { ...ci.capitalAge, ageH0: 12 } })
  c.examined(1)
  if (!(hOld <= hA)) c.fail(`a 12h-old market reached $1e12 slower (${hOld.toFixed(2)}h) than a fresh one (${hA.toFixed(2)}h)`)
  // (d) the exit: a final window opened by an install trades on a fresh market (ageNow irrelevant), holding on today's (ageNow counts)
  const inp = { money: 3e8, incomePerSec: 0, hacking: 3000, hackingExp: X.expForLevel(3000, 8), hackingMult: 8, expPerSec: 2e4, repPerSec: 50, exitRep: 0, exitFavor: 0, exitLevel: 3000, joinMoney: 100e9, terminalRep: 2.5e6, donationCost: 1e12, favorToDonate: 0, installCash: 250e6, cycleHours: 5, multGainPerCycle: 1.3, workWhileDonating: true, capitalReturnPerSec: ci.capitalReturnPerSec, capitalScaleW: ci.capitalScaleW, capitalShape: ci.capitalShape }
  const young = X.exitHours({ ...inp, capitalAge: { ...ci.capitalAge, ageNowH: 0 } }, 0, true).hours
  const old = X.exitHours({ ...inp, capitalAge: { ...ci.capitalAge, ageNowH: 20 } }, 0, true).hours
  const youngI = X.exitHours({ ...inp, capitalAge: { ...ci.capitalAge, ageNowH: 0 } }, 1, true).hours
  const oldI = X.exitHours({ ...inp, capitalAge: { ...ci.capitalAge, ageNowH: 20 } }, 1, true).hours
  c.examined(4)
  c.note(`exitHours hold-to-exit: market age 0h ${young?.toFixed(2)}h, 20h ${old?.toFixed(2)}h; one install first: ${youngI?.toFixed(2)}h / ${oldI?.toFixed(2)}h`)
  if (!(old < young)) c.fail('holding on a 20h-old market is not faster than on a fresh one')
  if (!(Math.abs(youngI - oldI) < 1e-6)) c.fail(`after an install the market age still moved the exit (${youngI} vs ${oldI}): the window must trade on a fresh market`)
  // (e) capitalAgeInputsOf and progress.js
  const k = TW.rwBn8Kappa(1024)
  c.examined(2)
  if (Math.abs(ci.capitalReturnPerSec * 3600 - k * TW.RW_AGE['pre-long'].r0PerHour) > 1e-12 || Math.abs(ci.capitalScaleW - TW.rwAgeKnee(0, 'pre-long')) > 1) c.fail('capitalAgeInputsOf is not kappa8 x RW_AGE r0 with the knee at today\'s age')
  const src = fs.readFileSync(path.join(ROOT, 'progress.js'), 'utf8')
  const fn = src.slice(src.indexOf('function capitalAgeOverrideOf'), src.indexOf('function traderBeliefNow'))
  if (!/ScriptHackMoneyGain !== 0\) return \{\}/.test(fn) || !/capitalAgeInputsOf\(/.test(fn)) c.fail('progress.js capitalAgeOverrideOf must return {} unless ScriptHackMoneyGain is 0, and build from traderw.capitalAgeInputsOf')
  if (!/\.\.\.capitalAgeOverrideOf\(ns, info\)/.test(src.slice(src.indexOf('function exitInputsOf')))) c.fail('exitInputsOf does not carry capitalAgeOverrideOf')
  return c
}

function gc1() {
  const c = new Check('GC1', "Stanek's Gift per life: stanekplan.GIFT_CAL = giftcal.mjs's fit on the frozen lives; calibrated rms < uncalibrated and <= 0.18; past the start within 15% by length; short lives read 1")
  const lives = JSON.parse(fs.readFileSync(GC.FIXTURE, 'utf8')).lives.filter((l) => !l.why)
  const fit = GC.fitGiftCal(lives)
  c.examined(lives.length)
  c.note(`fit kappa ${fit.kappa.toFixed(3)} delay ${fit.delayH}h | committed kappa ${SP.GIFT_CAL.kappa} delay ${SP.GIFT_CAL.delayH}h over ${lives.length} lives`)
  if (Math.abs(fit.kappa - SP.GIFT_CAL.kappa) > 0.03 || Math.abs(fit.delayH - SP.GIFT_CAL.delayH) > 0.051) c.fail('GIFT_CAL is not the fit on the lives', `fit kappa ${fit.kappa.toFixed(3)} delay ${fit.delayH}`)
  const rms = (f) => Math.sqrt(lives.reduce((a, l) => a + Math.log(f(l) / l.h) ** 2, 0) / lives.length)
  const rc = rms((l) => GC.modelH(l, { cal: SP.GIFT_CAL }))
  const ru = rms((l) => GC.modelH(l))
  c.note(`rms ln error: calibrated ${rc.toFixed(3)}, uncalibrated ${ru.toFixed(3)}`)
  if (!(rc < ru && rc <= 0.18)) c.fail(`the calibrated gift is not better (rms ${rc.toFixed(3)} vs ${ru.toFixed(3)}, ceiling 0.18)`)
  for (const [lo, hi] of [[0.5, 1], [1, 2], [2, 99]]) {
    const sel = lives.filter((l) => l.L > lo && l.L <= hi)
    if (!sel.length) continue
    const gm = (f) => Math.exp(sel.reduce((a, l) => a + Math.log(f(l)), 0) / sel.length)
    const e = gm((l) => GC.modelH(l, { cal: SP.GIFT_CAL })) / gm((l) => l.h) - 1
    c.note(`lives ${lo}-${hi === 99 ? '' : hi}h (${sel.length}): calibrated ${(100 * e).toFixed(0)}% of measured`)
    if (Math.abs(e) > 0.15) c.fail(`lives ${lo}-${hi}h: the calibrated factor is ${(100 * e).toFixed(0)}% off (tolerance 15%)`)
  }
  const short = { ...lives[0], L: SP.GIFT_CAL.delayH * 0.9 }
  if (GC.modelH(short, { cal: SP.GIFT_CAL }) !== 1) c.fail('a life shorter than the charger\'s start must read 1')
  return c
}

async function gc2() {
  const c = new Check('GC2', "the gameplan's gift runs on GIFT_CAL (stanek.mjs giftBaseOf), world.giftCal null = the uncalibrated model")
  const ST = await import('../sim/gameplan/stanek.mjs')
  const { worldOf } = await import('../sim/gameplan/params.mjs')
  const { measureEconomy } = await import('../sim/gameplan/economy.mjs').catch(() => ({}))
  void measureEconomy
  const m = (await import('../../bitNodeMultipliers.js')).bitNodeMults(13)
  const w = { sf: { stRam: 21, stEpsM: 0.09, stEpsR: 0.12, stFr: 4, stDuty: 0.9 }, cycleHours: 2.63, profile: null }
  void worldOf
  const cal = ST.giftBaseOf(13, 2, { ...w }, m, { H0: 40, g: 0.05 }).base.cal
  const unc = ST.giftBaseOf(13, 2, { ...w, giftCal: null }, m, { H0: 40, g: 0.05 }).base.cal
  c.examined(2)
  if (cal !== SP.GIFT_CAL) c.fail('stanek.mjs giftBaseOf does not carry GIFT_CAL by default')
  if (unc !== null) c.fail('world.giftCal null must price the uncalibrated model')
  const Wc = ST.stanekFactors(13, 2, { ...w, _stanek: undefined }, m, { H0: 40, g: 0.05 }).W
  const Wu = ST.stanekFactors(13, 2, { ...w, giftCal: null, _stanek: undefined }, m, { H0: 40, g: 0.05 }).W
  c.note(`BN13 at SF13.2, a 40h node at g 0.05: the exit divisor W calibrated ${Wc.toFixed(3)}, uncalibrated ${Wu.toFixed(3)}`)
  if (!(Wc < Wu)) c.fail('the calibrated gift (kappa < 1, a start delay) must not price a larger W than the uncalibrated model')
  return c
}

function b8x() {
  const c = new Check('B81', "BN8's exit model on the game's catalogue (child gameplan/bn8test.mjs): BN8.1's replay within tolerance, BN8_CAL / RW_BN8 = their fits; BN8.2 priced, sane, monotone in the trader (B82); the IPvGO farm's table and hours (B85)")
  const r = spawnSync(process.execPath, ['--max-old-space-size=2048', path.join(ROOT, 'tools/sim/gameplan/bn8test.mjs')], { encoding: 'utf8', timeout: 900e3 })
  let res
  try {
    res = JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    res = { skip: 'bn8test.mjs produced no result: ' + ((r.stderr || '').slice(-600) || `exit ${r.status}`) }
  }
  if (res.skip) c.fail('could not run: ' + res.skip)
  else {
    c.examined(res.examined)
    for (const n of res.notes) c.note(n)
    for (const f of res.fails) c.fail(f)
  }
  return c
}

async function b83() {
  const c = new Check('B83', "the route: with the BN8 model on, BN8 is 'stocks' only; off (--bn8-hack), the old routes; other nodes unchanged")
  const R = await import('../sim/gameplan/routes.mjs')
  const lv = (n) => ({ 8: 1, 13: 3 })[n] ?? 0
  const on = { bn8: { hoursOf: () => 30 } }
  const off = { bn8: null }
  const ids = (node, world) => R.ROUTES.filter((r) => (!r.node || r.node === node) && r.applies(node, lv, world, { bbRank: () => 0 })).map((r) => r.id)
  const a = ids(8, on)
  const b = ids(8, off)
  const d = ids(5, on)
  const e = ids(5, off)
  c.examined(4)
  c.note(`BN8 on: ${a.join(',')} | off: ${b.join(',')} | BN5 on: ${d.join(',')} | off: ${e.join(',')}`)
  if (a.join() !== 'stocks') c.fail(`BN8 with its model must be priced by 'stocks' alone, got ${a.join(',')}`)
  if (b.includes('stocks') || !b.includes('hack')) c.fail(`BN8 without its model must be the old routes, got ${b.join(',')}`)
  if (d.join() !== e.join()) c.fail('the BN8 model moved another node\'s routes')
  const st = R.ROUTES.find((r) => r.id === 'stocks')
  if (st.hours({ lv, world: on }) !== 30) c.fail("the 'stocks' route does not return the world's BN8 pricer")
  return c
}

function b84() {
  const c = new Check('B84', "the gift in BN8 is a priced decision (stanekplan.STOCK_GIFT_PRICED, bn8.mjs): accept iff it wins, basis 'hack'; no entry HOLDS the option (the order gate refuses non-NFG); the table = bn8.mjs (child, B81)")
  const info = (l13) => ({ currentNode: 8, ownedAugs: new Map(), ownedSF: new Map([[13, l13], [7, 3]]), lastAugReset: 1 })
  const e = SP.STOCK_GIFT_PRICED['8|3']
  const w = SP.giftWantOf({ node: 8, l13: 3, l7: 3, route: null })
  c.examined(6)
  c.note(`BN8 SF13.3: never ${e?.[0]}h vs accept ${e?.[1]}h -> want ${w.want}, basis ${w.basis}: ${w.why}`)
  if (!e) c.fail('no STOCK_GIFT_PRICED entry for BN8 at SF13.3')
  else if (w.want !== e[1] < e[0] || w.pending) c.fail('giftWantOf in BN8 does not follow the priced table')
  if (w.want && w.basis !== 'hack') c.fail("BN8's gift must serve the hacking route (basis 'hack')")
  const st = SP.giftStateOf(info(3), true, null, null)
  if (st.want !== w.want || st.hold || st.basis !== (w.want ? 'hack' : st.basis)) c.fail(`giftStateOf in BN8 at SF13.3: want ${st.want} hold ${st.hold} basis ${st.basis}`)
  const g1 = SP.giftOrderGate(st, { kind: 'buyaug', args: ['CyberSec', 'BitWire'] })
  if (st.want && g1.allow) c.fail('a wanted, unaccepted gift must refuse a non-NFG purchase until stanek.js accepts it')
  // a level with no entry: HELD open, never a silent decline
  const w4 = SP.giftWantOf({ node: 8, l13: 4, l7: 3, route: null })
  const st4 = SP.giftStateOf(info(4), true, null, null)
  const g4 = SP.giftOrderGate(st4, { kind: 'buyaug', args: ['CyberSec', 'BitWire'] })
  const gN = SP.giftOrderGate(st4, { kind: 'buyaug', args: ['CyberSec', 'NeuroFlux Governor'] })
  c.note(`BN8 with no entry: want ${w4.want} pending ${w4.pending} hold ${st4.hold}; a non-NFG order ${g4.allow ? 'ALLOWED' : 'refused'}; NFG ${gN.allow ? 'allowed' : 'refused'}`)
  if (!(w4.pending && !w4.want && st4.hold)) c.fail('an unpriced BN8 gift must be HELD (pending), not declined')
  if (g4.allow || !gN.allow) c.fail('the held option must refuse non-NFG orders and allow NeuroFlux')
  // other nodes unchanged: BN5 on the hacking route still declines (not priced in-game there), BN13 accepts
  if (SP.giftWantOf({ node: 5, l13: 3, l7: 3, route: 'hack' }).want !== false || SP.giftWantOf({ node: 13, l13: 2, l7: 3, route: null }).want !== true) c.fail('the BN8 branch moved another node')
  return c
}

export async function run() {
  return [ta1(), ta2(), ta3(), ta4(), gc1(), await gc2(), b8x(), await b83(), b84()]
}
