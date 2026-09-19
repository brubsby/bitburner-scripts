// Minimal single-target HGW loop for the opening of a run, when home RAM is
// too small to hold hack.js (10GB+). Prep to min security / max money, then
// hack. Grows into hack.js once home has the headroom.
//
//   run early.js n00dles -t 3
//   run early.js n00dles 0.25 -t 3     hack once money is above 25% of max
//
// The money floor is the real knob here, because this loop hacks with every
// thread it has and so drains the target: the floor *is* the fraction of max
// money taken per cycle. It trades money-per-cycle against hack ops per unit
// time, and a hack op is 1/3.2 of a grow op while paying the same experience
// per thread. When hacking level is the binding constraint — a small fleet —
// low floors win outright; once the fleet is past ~1TB the experience channel
// saturates and money-per-cycle takes over.
//
// Simulated at fixed RAM over 60 minutes (docs/optimizer-log.md sections 5
// and 7), the floor was worth:
//
//        floor   108GB     1.4TB
//          5%   $119.5m   $758m
//         25%   $107.1m   $1.07b
//         50%    $97.3m   $1.46b     <- within a few percent of best at both
//         75%    $83.8m   $1.41b     <- the old value
//
// Hence 0.5: no extreme is safe across the range the fleet will pass through.
// The +5 security slack was swept too and is already optimal (+0 $46.6m,
// +3 $61.7m, +5 $62.4m, +10 $54.4m, +20 $48.7m).

const MONEY_FLOOR = 0.5
const SECURITY_SLACK = 5

// status.js references only ns.write (0GB) and ns.atExit is 0GB, so publishing
// costs this script nothing — the same arithmetic that lets hgw.js publish and
// still price at exactly 2.00GB. One write at startup and one on the way out,
// never per cycle: this runs many-threaded on fleet hosts and every thread
// shares the file.
import { reporter } from 'status.js'

export async function main(ns) {
  const target = ns.args[0] || 'n00dles'
  const floor = Number(ns.args[1]) > 0 ? Number(ns.args[1]) : MONEY_FLOOR
  const moneyThresh = ns.getServerMaxMoney(target) * floor
  const securityThresh = ns.getServerMinSecurityLevel(target) + SECURITY_SLACK

  ns.disableLog('ALL')

  let cycles = 0
  const note = reporter(ns, '/tel/early.txt', () => ({ target, floor, cycles }))
  ns.atExit(() => note.exit('stopped', { detail: `early.js stopped on ${target}` }))
  note('ok', { detail: `early.js working ${target} to a ${floor} money floor` })

  while (true) {
    cycles++
    if (ns.getServerSecurityLevel(target) > securityThresh) {
      await ns.weaken(target)
    } else if (ns.getServerMoneyAvailable(target) < moneyThresh) {
      await ns.grow(target)
    } else {
      await ns.hack(target)
    }
  }
}
