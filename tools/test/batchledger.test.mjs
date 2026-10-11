// [BL] AN ORDER BATCH PRICES ITS CASH IN SEQUENCE — and a failed work order
// never idles the claimed slot.
//
// Live BN13.1 2026-10-11 17:02:19Z, a fresh life (~$24m of contract money in
// cash a moment before, the trader's book in cash, equity reading 0):
// progress.js ordered travel Chongqing -> join ($20m) -> travel New Tokyo ->
// join ($20m) -> travel Ishima -> join ($30m) -> travel Sector-12 -> gym
// (defense to 30 for Slum Snakes). Each city join was checked on its own
// against the same cash, and withCashRaise summed the joins' REQUIREMENTS as
// spends ($71m) over ~$24m of cash, so no hold was ordered and the trader
// re-invested the cash before act.js ran. The first fare went through, every
// later one was refused (Player.canAfford), the player sat in Chongqing (no
// gym), the gym order failed, and the 'body' slot sat idle: healthcheck
// ORDER NOT HELD.
//
//   BL1 the batch's cash need is in sequence (a join requirement is held, not
//       spent), and a trader holding its book in cash still holds the batch's
//       cash (the live batch got no raise at all).
//   BL2 the ledger refuses the fare the game refused, at the point the game
//       refused it, and admits the live batch's affordable prefix; and the
//       body plan priced on the ledger's balance in Chongqing is the money
//       crime (cf06cef's credit pricing pays the fare in cash up front).
//   BL3 a failed gym order falls back in the same loop: the flight and the
//       gym when the fare is in cash, else the best money crime; never when
//       the slot is not act.js's to serve.
//   BL4 wiring: progress.js orders through the ledger (city set in sequence,
//       invite-in-place first, the body leg's fare kept; the gym's travel
//       refused -> the priced crime), act.js runs the fallback after a batch.

import './gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { Check } from './harness.mjs'
import { REPO_ROOT } from './gameresolve.mjs'

const NE = await import('nodeecon.js')
const AP = await import('actplan.js')
const BP = await import('bodyplan.js')
const SRC = (f) => fs.readFileSync(path.join(REPO_ROOT, f), 'utf8')

/** /tel/orders.txt as act.js read it at 17:02:19Z (no liquidate was inserted). */
const LIVE = [
  { id: 1, kind: 'travel', args: ['Chongqing'] },
  { id: 2, kind: 'join', args: ['Chongqing'], cost: 20e6 },
  { id: 3, kind: 'travel', args: ['New Tokyo'] },
  { id: 4, kind: 'join', args: ['New Tokyo'], cost: 20e6 },
  { id: 5, kind: 'travel', args: ['Ishima'] },
  { id: 6, kind: 'join', args: ['Ishima'], cost: 30e6 },
  { id: 7, kind: 'travel', args: ['Sector-12'], cost: 200e3 },
  { id: 8, kind: 'gym', args: ['Powerhouse Gym', 'def'], cost: 384909 },
]

export async function run() {
  const checks = []

  // ---- BL1 ------------------------------------------------------------------
  const c1 = new Check('BL1', "the batch's cash need is in sequence, and a book in cash still holds it")
  checks.push(c1)
  {
    c1.examined(4)
    const need = typeof NE.batchCashNeedOf === 'function' ? NE.batchCashNeedOf(LIVE) : null
    c1.note(`live batch: need in sequence $${need}`)
    // 3 fares + Ishima's $30m in hand = $30.6m; then the gym fare and fees.
    if (need !== 600e3 + 30e6 && need !== 30.6e6) c1.fail('the live batch needs $30.6m at its peak (fares spent, joins held)', String(need))
    const out = NE.withCashRaise(LIVE, 24e6, 0, { trader: true })
    const hold = out.find((o) => o.kind === 'liquidate')
    c1.note(`$24m cash, equity 0, trader live: ${hold ? JSON.stringify(hold.args) : 'NO raise/hold'}`)
    if (!hold || hold.args[0] !== 'raise' || !(hold.args[1] <= 24e6)) c1.fail('a trader with its book in cash must hold the cash the batch spends (live: none, the trader re-invested)', JSON.stringify(out[0]))
    if (out.indexOf(hold) !== 0) c1.fail('the hold goes before the first costed order')
    // Covered in sequence (but not as a sum): the ordinary hold, sized to the need.
    const cov = NE.withCashRaise(LIVE, 31.5e6, 0, { trader: true }).find((o) => o.kind === 'liquidate')
    if (!cov || !(cov.args[1] >= 31e6 && cov.args[1] <= 31.5e6)) c1.fail('$31.5m covers the batch in sequence: a hold of its need', JSON.stringify(cov))
    if (NE.withCashRaise(LIVE, 24e6, 0, { trader: false }).some((o) => o.kind === 'liquidate')) c1.fail('no trader, no book: nothing to hold')
  }

  // ---- BL2 ------------------------------------------------------------------
  const c2 = new Check('BL2', 'the ledger refuses the fare the game refuses, where it refuses it; the body plan on that balance is the crime')
  checks.push(c2)
  {
    if (typeof NE.batchLedgerOf !== 'function') c2.fail('nodeecon.batchLedgerOf is missing')
    else {
      c2.examined(6)
      // What act.js met: ~$392k when the first fare was paid (17:02:19Z),
      // $192k after it; income $1.3k/s (Shoplift) over the batch.
      const L = NE.batchLedgerOf({ cash: 392e3, equity: 0, incomePerSec: 1303 })
      const r1 = L.admit('travel')
      const r2 = L.admit('join', 20e6)
      const r3 = L.admit('travel')
      c2.note(`$392k: travel ${r1.ok}, join $20m ${r2.ok} (${r2.why}), travel ${r3.ok} (${r3.why})`)
      if (!r1.ok) c2.fail('the first fare is in cash')
      if (r2.ok) c2.fail('a $20m requirement is not in hand on $192k')
      if (r3.ok) c2.fail('the second fare is not in cash ($192k + seconds of income) — the game refused it')
      // The live batch on ~$24m of cash: Chongqing and New Tokyo fit, Ishima's $30m does not, the gym's fare does.
      const M = NE.batchLedgerOf({ cash: 24e6, equity: 0, incomePerSec: 1303 })
      const fitsCQ = M.fits({ need: 200e3, spend: 200e3 }, { need: 20e6 })
      if (fitsCQ) M.admit('travel'), M.admit('join', 20e6)
      const fitsNT = M.fits({ need: 200e3, spend: 200e3 }, { need: 20e6 })
      if (fitsNT) M.admit('travel'), M.admit('join', 20e6)
      const fitsIS = M.fits({ need: 200e3, spend: 200e3 }, { need: 30e6 })
      const gymFare = M.admit('travel')
      c2.note(`$24m: Chongqing ${fitsCQ}, New Tokyo ${fitsNT}, Ishima ${fitsIS}, gym fare ${gymFare.ok} ($${Math.round(gymFare.balance)} left)`)
      if (!(fitsCQ && fitsNT && !fitsIS && gymFare.ok)) c2.fail('on $24m the batch is Chongqing, New Tokyo and the gym fare — not Ishima')
      // The book counts after the raise's haircut and margin.
      const B = NE.batchLedgerOf({ cash: 0, equity: 1e6 })
      if (!(Math.abs(B.start - NE.batchReach(0, 1e6)) < 1)) c2.fail('the ledger starts at what a raise reaches', String(B.start))
      // cf06cef's credit pricing on the ledger's balance: in Chongqing (no gym)
      // with $192k, the fare cannot be paid — the plan's first step is the crime.
      const person = { skills: { hacking: 13, strength: 30, defense: 10, dexterity: 30, agility: 30, charisma: 1, intelligence: 0 }, exp: { hacking: 0, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 }, mults: { crime_success: 1, crime_money: 1 }, city: 'Chongqing', money: 192e3 }
      for (const s of Object.keys(person.exp)) {
        person.mults[s] = 1
        person.mults[`${s}_exp`] = 1
      }
      const plan = BP.combatBarPlanOf({ defense: 30 }, person, { CrimeSuccessRate: 1, CrimeMoney: 1, CrimeExpGain: 1 }, { cash: 192e3, incomePerSec: 0, holdS: 300 })
      c2.note(`Chongqing, $192k, defense 10 -> 30: ${plan?.best} first ${JSON.stringify(plan?.now)}`)
      if (plan?.now?.kind === 'gym') c2.fail('in Chongqing short of the fare the body plan must not pick a gym', JSON.stringify(plan.now))
    }
  }

  // ---- BL3 ------------------------------------------------------------------
  const c3 = new Check('BL3', 'a failed work order falls back in the same loop: the flight and the gym on the fare, else the money crime')
  checks.push(c3)
  {
    if (typeof AP.failedWorkFallbackOf !== 'function') c3.fail('actplan.failedWorkFallbackOf is missing — a failed work order idles the slot')
    else {
      c3.examined(5)
      const NOW = Date.parse('2026-10-11T17:02:52Z')
      const progress = { at: '2026-10-11T17:02:19.068Z', health: 'ok', slot: { owner: 'body', credit: null } }
      const results = [
        { id: 7, kind: 'travel', args: ['Sector-12'], ok: false },
        { id: 8, kind: 'gym', args: ['Powerhouse Gym', 'def'], ok: false },
      ]
      const GY = BP.GYMS
      const base = { now: NOW, lastAugReset: 1791737234310, progress, results, city: 'Chongqing', gymCostMult: (n) => GY.find((g) => g.name === n)?.costMult ?? null, gymCityOf: (n) => GY.find((g) => g.name === n)?.city ?? null, fundCrime: 'Shoplift' }
      const live = AP.failedWorkFallbackOf({ ...base, cash: 192161 })
      c3.note(`live (Chongqing, $192k): ${JSON.stringify(live?.steps?.map((s) => [s.kind, ...(s.args ?? [])]) ?? live)}`)
      if (!(live?.steps?.length === 1 && live.steps[0].kind === 'crime' && live.steps[0].args[0] === 'Shoplift')) c3.fail('short of the fare: the best money crime holds the slot', JSON.stringify(live))
      const rich = AP.failedWorkFallbackOf({ ...base, cash: 2e6 })
      const kinds = rich?.steps?.map((s) => s.kind).join(',')
      c3.note(`Chongqing, $2m: ${kinds}`)
      if (kinds !== 'travel,gym,crime' || rich.steps[0].args[0] !== 'Sector-12' || rich.steps[1].afterTravel !== true) c3.fail('with the fare and the fee in cash: fly, re-issue the gym, the crime as the last resort', JSON.stringify(rich))
      const ok = AP.failedWorkFallbackOf({ ...base, cash: 2e6, results: [...results, { kind: 'crime', args: ['Mug'], ok: true }] })
      if (ok !== null) c3.fail('a batch whose work started needs no fallback', JSON.stringify(ok))
      const blade = AP.failedWorkFallbackOf({ ...base, cash: 2e6, progress: { ...progress, slot: { owner: 'bladeburner' } } })
      if (!blade?.skip) c3.fail("a Bladeburner claim is its daemon's to serve", JSON.stringify(blade))
      const stale = AP.failedWorkFallbackOf({ ...base, cash: 2e6, now: NOW + 3600e3 })
      if (!stale?.skip) c3.fail('a stale progress.txt claims nothing', JSON.stringify(stale))
    }
  }

  // ---- BL4 ------------------------------------------------------------------
  const c4 = new Check('BL4', 'WIRING: progress.js orders through the ledger; act.js falls back after a failed work order')
  checks.push(c4)
  {
    const pj = SRC('progress.js')
    const aj = SRC('act.js')
    c4.examined(7)
    if (!/const led = ledger\.admit\(kind, cost\)\s*if \(!led\.ok\)[\s\S]{0,160}return false/.test(pj)) c4.fail('order() must refuse what the ledger refuses')
    if (!/const ledger = batchLedgerOf\(\{ cash: ns\.getServerMoneyAvailable\('home'\), equity: stockEquity, incomePerSec:/.test(pj)) c4.fail('the ledger starts from cash + the book + income')
    if (!/ledger\.fits\(\{ need: fare, spend: fare \}, \{ need: moneyReq \}\)/.test(pj)) c4.fail('each chosen city faction must fit the ledger in sequence')
    if (/\(player\.money \?\? 0\) \+ stockEquity >= moneyReq \+ 200e3/.test(pj)) c4.fail('the per-faction check against the same cash is back')
    if (!/cityOf\(a\) === cityAfterOrders \? 0 : 1/.test(pj) || !/ledger\.reserve\(bodyFare\)/.test(pj)) c4.fail('invite-in-place first, and the body leg keeps its fare')
    if (!/combatBarPlanOf\([^\n]*\{ cash: ledger\.balance\(\), incomePerSec/.test(pj)) c4.fail('the body leg must be priced on the balance the batch leaves')
    if (!/const flown = cityAfterOrders === bodyStep\.city \|\| order\('travel'/.test(pj) || !/if \(!flown\) \{/.test(pj)) c4.fail('a gym whose fare the batch cannot pay must not be ordered')
    if (!/const fb = failedWorkFallbackOf\(\{[\s\S]{0,600}results,/.test(aj) || !/if \(st\.afterTravel && flew !== true\) continue/.test(aj)) c4.fail('act.js must run the fallback in the batch loop')
  }
  return checks
}
