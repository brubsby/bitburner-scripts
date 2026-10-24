// SLEEVE-LITE, the decision (pure: no ns). sleeve-lite.js acts on it; watchdog.js triggers on it.
//
// THE GAP IT FILLS. sleeve.js raises to 49.75GB and needs that free on ONE non-hacknet host, so at a
// 128GB node entry it waits for a 64GB+ host (a 64GB cloud server, or silver-helix's two ports). From
// history.jsonl (2026-10-24, the first such host per node, vs the division join at combat 100):
// BN3.2 3.25h (join 0.39h), BN3.3 1.75h (0.33h), BN3.4 1.00h (0.33h), BN11.3 1.75h (0.95h), BN13.2 0.5h
// (0.66h), BN13.3 0.25h (0.93h) — the fleet reached the Bladeburner 0..2.9h after the join (a LOWER
// bound: the host must then be drained for the block). No run record held sleeve.js's own start until
// telrecord (c1366cf), so these are the placement's precondition, not its observation.
//
// WHAT THE SLEEVES DO MEANWHILE IS THE GAME'S, not nothing: Sleeve.prestige (Sleeve.ts:228-257, every
// node entry) and prestigeAugmentation (PlayerObjectGeneralMethods.ts:120, every install) put each
// sleeve on SHOCK RECOVERY (synchronize at shock 0). On the Bladeburner route shock buys nothing:
// Infiltrate and Support are stat- and shock-independent (SleeveInfiltrateWork.ts, SleeveSupportWork.ts).
//
// AN IDLE SLEEVE BANKS ITS TIME. Sleeve.process (Sleeve.ts:264-276) adds every tick's cycles to
// storedCycles BEFORE it returns on `!this.currentWork`, and a working sleeve spends up to 15 cycles a
// tick against one accrued: an idle span replays at 15x on whatever the sleeve does next. Support spends
// a bank on nothing (its process() is empty); Infiltrate turns it into contract/operation counts.
//
// PRICED (CLAUDE.md "Decisions compare simulated trajectories"): bbsim to the 21st black op, the game's
// Sleeve class, the bank modelled (bbsim o.sleeveBank), tools/sim/bbboot.mjs --levers with SLEEVE_ARMS,
// 60 paired seeds 701-760, d = exit h vs the fleet at the join (i4s4, recovery before):
//                                    BN5.2            BN2.2
//   fleet join +0.5h (recovery)    +0.02 +- 0.03    -0.00 +- 0.04
//   fleet join +1h                 +0.20 +- 0.03    +0.09 +- 0.05
//   fleet join +1.5h               +0.37 +- 0.03    +0.24 +- 0.04
//   fleet join +3h                 +1.13 +- 0.05    +0.82 +- 0.05
//   fleet join +5h                 +2.55 +- 0.05    +2.09 +- 0.06
//   IDLE at entry, fleet at join   -0.03 +- 0.01    -0.00 +- 0.01
//   idle at entry, join +1h        +0.01 +- 0.03    +0.00 +- 0.05
//   idle at entry, join +3h        +0.31 +- 0.06    +0.25 +- 0.06
// NOT CALIBRATED (no live node ran a bank or the lite fleet); the base is bbboot --calib's.
// So: the sleeves go IDLE at entry (the bank, any route: what follows replays it at 15x, so on a hacking
// or gang route it is the game's recovery delayed by at most a fourteenth of the idle span), and the
// Bladeburner fleet is set at the join, from the fleet the route would run (progress.js routeFleet:
// bbplan.chooseSleeveConfigGen for the live count), until sleeve.js runs — which then keeps it as its
// incumbent (sleeveplan.bladeIncumbentOf: a fresh process's incumbent is the running fleet).
import { sleeveTasksOf, sleeveConfigKey } from 'bbplan.js'

/** What sleeve-lite.js last did (this node; re-acted on a new life: the install re-tasks every sleeve). */
export const LITE_FILE = '/tel/sleeve-lite.txt'
/** progress.js re-chooses routeFleet every 30 min (ROUTE_FLEET_MS); older than this it is not acted on. */
export const LITE_FLEET_FRESH_MS = 90 * 60e3
/** The watchdog's sleeve.js reservation record is rewritten every cycle; older than this says nothing. */
export const LITE_RESERVE_FRESH_MS = 10 * 60e3

const t = (x) => Date.parse(x ?? '')

/**
 * Has sleeve.js taken the fleet in this life? Its /tel/sleeve.txt from this node, assigned, dated in it
 * (staleSince: a record carried through a refused raise is as of then — bbplan.bladeFleetOf).
 */
export function sleeveJsActedOf(sleeveTel, { node, lifeStart }) {
  if (!sleeveTel || sleeveTel.bitNode !== node || sleeveTel.result !== 'assigned') return false
  const at = t(sleeveTel.staleSince ?? sleeveTel.at)
  return Number.isFinite(at) && Number.isFinite(lifeStart) && at >= lifeStart
}

/**
 * The lite's step: {act: 'idle' | 'fleet' | null, key, tasks?, why}.
 *   node, lifeStart   getResetInfo().currentNode / lastAugReset
 *   rec               /tel/sleeve-lite.txt
 *   plan              /tel/plan.txt (decisions.bladeRoute.key, .routeFleet)
 *   blade             /tel/bladeburner.txt (joined, bitNode)
 *   sleeveTel         /tel/sleeve.txt
 *   reserve           /tel/reserve-sleeve.txt (the watchdog's own sleeve.js record: action 'running')
 *   n                 the sleeve count (the actor's getNumSleeves; the trigger passes the record's)
 */
export function liteStepOf({ node, lifeStart, rec = null, plan = null, blade = null, sleeveTel = null, reserve = null, n = null, now = Date.now() }) {
  const running = reserve?.action === 'running' && reserve.lastAugReset === lifeStart && now - t(reserve.at) <= LITE_RESERVE_FRESH_MS
  if (running) return { act: null, key: null, why: 'sleeve.js is running: the fleet is its' }
  if (sleeveJsActedOf(sleeveTel, { node, lifeStart })) return { act: null, key: null, why: `sleeve.js assigned the sleeves in this life (${sleeveTel.staleSince ?? sleeveTel.at}): its tasks stand` }
  const ours = !!rec && rec.bitNode === node && rec.lastAugReset === lifeStart
  const route = plan && plan.node === node ? plan.decisions?.bladeRoute?.key ?? null : null
  const joined = !!blade && blade.bitNode === node && blade.joined === true
  const rf = plan && plan.node === node ? plan.decisions?.bladeRoute?.routeFleet ?? null : null
  const rfOk = !!rf?.config && rf.lastAugReset === lifeStart && rf.joined === true && now - t(rf.at) <= LITE_FLEET_FRESH_MS
  if (route === 'blade' && joined && rfOk) {
    const count = Number.isInteger(n) && n > 0 ? n : rf.n
    const key = `fleet:${sleeveConfigKey(rf.config)}:${count}`
    if (ours && rec.key === key) return { act: null, key, why: `the fleet ${sleeveConfigKey(rf.config)} is set (${rec.at})` }
    return { act: 'fleet', key, config: rf.config, tasks: sleeveTasksOf(rf.config, count), why: `the Bladeburner route, joined: the fleet it would run (progress.js routeFleet ${sleeveConfigKey(rf.config)}, ${String(rf.why ?? '').slice(0, 80)}) until sleeve.js runs; members not on a Bladeburner action stay idle (banking)` }
  }
  // Not acting on the route: hold a set fleet while the route still wants it (a stale routeFleet), else bank.
  if (ours && rec.key === 'idle') return { act: null, key: 'idle', why: `idle since ${rec.at}: banking for sleeve.js or the fleet` }
  if (ours && String(rec.key ?? '').startsWith('fleet:') && route === 'blade' && joined) return { act: null, key: rec.key, why: `holding ${rec.key}: no fresh routeFleet to re-set it from` }
  return { act: 'idle', key: 'idle', why: route === 'blade' && !joined ? 'the Bladeburner route before the join: idle banks the span for Infiltrate at 15x (Sleeve.ts:264-276)' : `no Bladeburner fleet to set (route ${route ?? 'undecided'}${route === 'blade' ? `, ${rfOk ? 'joined' : 'no fresh routeFleet'}` : ''}): idle banks the span for whatever sleeve.js assigns (Sleeve.ts:264-276), where the game's recovery would spend it` }
}

/** The sleeve count sleeve-lite.js read in this node (its record), else 0: progress.js's routeFleet before sleeve.js runs. */
export function liteSleevesOf(rec, node) {
  return rec && rec.bitNode === node && Number.isInteger(rec.n) && rec.n > 0 ? rec.n : 0
}
