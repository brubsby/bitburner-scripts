// THE HACKING EXIT OF A NODE WE ARE ABOUT TO ENTER, from a fresh entry.
//
// nodeplan.nodeHours projects the CURRENT life's multiplier into a candidate
// node, which is the flaw its own header names (prestigeSourceFile strips every
// augmentation). This builds the ARRIVING state instead — hacking 1, exp 0,
// the multiplier the Source-Files alone give (the game's applySourceFile, run
// on a fresh PlayerObject), times the node's HackingLevelMultiplier — and hands
// it to exitplan.bestExitPolicy, the same simulation that decides installs in
// the live game, with the node's own gates:
//   exit level   3000 x WorldDaemonDifficulty (ServerHelpers.ts:423)
//   join money   $100b (Daedalus)
//   Red Pill     2.5m rep x AugmentationRepCost, DONATED at favor
//                150 x FavorToDonateToFaction (donation.ts:8,17), i.e. the
//                favor banked in an earlier life of the node, as the live
//                planner does
//   capital      the stock trader's measured return on the balance, capped
//                (nodeecon.fitCapital -> /tel/exitinputs.txt), where WSE+TIX
//                are free (SF8.1: every node from here on; BN8 itself)
//
// THE ONE LATENT: `g`, the growth of ln(hacking multiplier) per hour across the
// node's install cycles. It is what install cycles buy — money and reputation
// turned into augmentations — and no multiplier table predicts it: measured,
// BitNode 2 (a native gang) ran at ~0.13/h and BitNode 8 (no hacking money) at
// ~0.02/h. calibrate.mjs backs it out of every measured node through this very
// function and reports the leave-one-out error of predicting a node's hours
// from the other nodes' g. That error is the projection error; it is printed,
// never folded in.
//
// NOT MODELLED (stated, per CLAUDE.md): the Daedalus augmentation-count gate
// (absorbed in g — every measured node had it); growth-rate and security
// differences in the batcher (nodeplan's own caveat); the gang (SF2.1 makes one
// available everywhere after a -54k karma grind — absorbed in g where it ran).

import '../../test/gameresolve.mjs'
import g from './game.mjs'

const ep = await import('exitplan.js')

const num = (x) => typeof x === 'number' && isFinite(x)

/** The multipliers a set of Source-Files gives a fresh player: the game's applySourceFile on a new PlayerObject. */
export function sfMults(sf) {
  g.initSourceFiles()
  const saved = g.Player
  const P = new g.PlayerObject()
  g.setPlayer(P)
  try {
    P.sourceFiles = new Map(sf)
    P.resetMultipliers()
    P.reapplyAllSourceFiles()
    return { ...P.mults }
  } finally {
    if (saved) g.setPlayer(saved)
  }
}

export const nodeMults = (node, level = 1) => g.getBitNodeMultipliers(node, level)

/**
 * The profile every node is projected from. Each number is a measurement or is
 * labelled as not one.
 */
export function defaultProfile(meas = {}) {
  return {
    // Mean life length (hours) over the measured nodes of the current stack.
    cycleHours: meas.cycleHours ?? 2.0,
    // Hacking exp/s in the final climb, per unit HackExpGain: BitNode 10's
    // last hours (history.jsonl, median sample) — a rich node's fleet.
    expRich: meas.expRich ?? 1.3e9,
    // ... and BitNode 8's, where scripted hacking pays nothing and the fleet
    // stays small (ScriptHackMoneyGain 0).
    expPoor: meas.expPoor ?? 3.7e4,
    // NOT CALIBRATED: level-1 hacking income per unit (ScriptHackMoney x
    // ServerMaxMoney). Only the $100b join and the Red Pill donation ride on
    // it, and both are minutes at an exit-level fleet in every node that
    // hacks for money; BN8-like nodes run on the trader instead.
    incomeL1: 4e8,
    // The trader, pre-4S: /tel/exitinputs.txt capitalReturnPerSec and capitalCap
    // (live BN8, 2026-09-26), inside the 70-100%/h the user measured.
    capitalReturnPerSec: meas.capitalReturnPerSec ?? 1.57e-4,
    capitalCap: meas.capitalCap ?? 5.76e12,
  }
}

/**
 * exitplan inputs for a fresh entry into `node` holding Source-Files `sf`.
 * `trader`: whether WSE+TIX are free (SF8 held or node 8).
 */
export function freshInputs({ node, level = 1, sf, g: growth, profile, trader = null }) {
  const m = nodeMults(node, level)
  const s = sfMults(sf)
  const hasTrader = trader ?? (node === 8 || (new Map(sf).get(8) ?? 0) > 0)
  const poor = m.ScriptHackMoneyGain === 0
  const moneyFactor = m.ScriptHackMoney * m.ServerMaxMoney * m.ScriptHackMoneyGain
  const fr = s.faction_rep
  return {
    money: node === 8 ? 250e6 : 1262,
    installCash: node === 8 ? 250e6 : 1262, // Prestige.ts:158 in BN8; PlayerObjectGeneralMethods.ts:102 elsewhere
    incomePerSec: poor ? 0 : profile.incomeL1 * moneyFactor * s.hacking_money,
    hacking: 1,
    hackingExp: 0,
    hackingMult: s.hacking * m.HackingLevelMultiplier, // Person.ts:59-62 (exitplan.effectiveHackingMultOf)
    expPerSec: (poor ? profile.expPoor : profile.expRich * m.HackExpGain) * s.hacking_exp,
    cycleHours: profile.cycleHours,
    multGainPerCycle: Math.exp(growth * profile.cycleHours),
    exitLevel: 3000 * m.WorldDaemonDifficulty,
    joinMoney: 100e9,
    terminalRep: 2.5e6 * m.AugmentationRepCost,
    donationCost: (2.5e6 * m.AugmentationRepCost * 1e6) / (fr * m.FactionWorkRepGain),
    favorToDonate: 150 * m.FavorToDonateToFaction,
    exitFavor: 150 * m.FavorToDonateToFaction,
    capitalReturnPerSec: hasTrader ? profile.capitalReturnPerSec : 0,
    capitalCap: hasTrader ? profile.capitalCap : null,
  }
}

/** Hours to the hacking exit from a fresh entry (exitplan.bestExitPolicy's best policy). */
export function hackExitHours(o) {
  const inp = freshInputs(o)
  const p = ep.bestExitPolicy(inp, o.maxInstalls ?? 400)
  if (!p.best || !num(p.best.hours)) return { hours: null, why: p.why ?? 'no policy priced', inputs: inp }
  return { hours: p.best.hours, installs: p.best.installsFirst, finalMult: p.best.mult, legs: p.best.legs, edge: !!p.atSearchEdge, degenerate: !!p.degenerate, inputs: inp }
}

/** The g at which a node's projected hours equal `hours` (bisection in ln g; hours fall as g rises). */
export function backOutG(o, hours) {
  let lo = Math.log(1e-3)
  let hi = Math.log(2)
  const at = (lg) => hackExitHours({ ...o, g: Math.exp(lg) }).hours
  const hLo = at(lo)
  const hHi = at(hi)
  if (!num(hLo) || !num(hHi) || hours > hLo || hours < hHi) return { g: null, why: `measured ${hours.toFixed(1)}h outside [${num(hHi) ? hHi.toFixed(1) : '?'}, ${num(hLo) ? hLo.toFixed(1) : '?'}]h` }
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    const h = at(mid)
    if (!num(h) || h > hours) lo = mid
    else hi = mid
  }
  return { g: Math.exp((lo + hi) / 2), why: null }
}
