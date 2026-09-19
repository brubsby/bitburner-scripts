// The 2.00GB worker: a hack/grow/weaken loop that reads NO server state.
//
//   run hgw.js n00dles -t 4
//   run hgw.js n00dles 0.5 -t 4      hack down to 50% of max money, then regrow
//
// WHY IT EXISTS, given that early.js already does this better.
//
// A BitNode entered with neither SF1 nor SF9.2 starts home at 8GB
// (Prestige.ts:242-248). Four concurrent operations is one complete HGW batch
// and is the floor below which the pipeline the whole collection is built
// around does not exist. early.js is 2.40GB, so four threads of it is 9.60GB
// and does not fit — by 1.60GB. There is no arrangement of early.js that earns
// anything at a virgin entry.
//
// The RAM is not negotiable and the arithmetic is short:
//
//     base script                        1.60
//     ns.hack                            0.10
//     ns.grow                            0.15
//     ns.weaken                          0.15
//                                        ----
//                                        2.00   x4 threads = 8.00GB, exactly 8GB
//
// Every one of those four is required to be an HGW loop at all. So **any**
// self-threaded worker that fits four ops in 8GB has exactly 0.00GB left for
// reading server state, and early.js reads four things
// (getServerMaxMoney, getServerMinSecurityLevel, getServerSecurityLevel,
// getServerMoneyAvailable, 0.10 each). That is the whole design constraint.
//
// HOW IT DECIDES WITHOUT READING ANYTHING
//
// The three operations return their own effect, and those returns are free:
//
//   ns.weaken -> the security actually removed. Exactly 0 once the server is at
//                minimum security (NetscriptFunctions.ts:359-376 returns
//                securityBeforeWeaken - securityAfterWeaken).
//   ns.grow   -> moneyAfter / moneyBefore. Exactly 1 once the server is at max
//                money, because calculateGrowMoney clamps and
//                processSingleServerGrowth then returns the unchanged ratio
//                (Server/ServerHelpers.ts:204-223). A grow that changes nothing
//                also fortifies nothing — the fortify is inside the
//                `oldMoneyAvailable !== moneyAvailable` branch — so the probe is
//                free of security cost.
//   ns.hack   -> the money stolen, 0 on a failed roll
//                (Netscript/NetscriptHelpers.tsx:648-677). A FAILED hack does
//                not fortify either; the `server.fortify` call is in the
//                success branch only.
//
// Money stolen is `money * percentHacked * threads`, and percentHacked barely
// moves over one drain cycle — so **the yield of a hack is proportional to the
// money on the server**. Comparing this hack's yield with the first hack's
// yield after a full grow is therefore a direct measurement of the money
// fraction, with no call to getServerMoneyAvailable and no knowledge of
// moneyMax. That is how the `floor` argument keeps working here.
//
// WHAT THE TRADE COSTS, named rather than hidden (CLAUDE.md "Fidelity"):
//
//   * One weaken and one grow per cycle are spent DISCOVERING that the server is
//     already at minimum security / maximum money. That is the price of not
//     paying 0.10GB for getServerSecurityLevel, and a weaken is the slowest of
//     the three ops. On a short opening cycle it is roughly 5-10% of throughput.
//   * It drives to minimum security every cycle rather than to a +5 slack band.
//     early.js's slack of +5 was swept and is worth a few percent
//     (+0 $46.6m, +5 $62.4m, +20 $48.7m over 60 simulated minutes).
//   * It cannot retarget. seed.js does that from outside by killing and
//     replacing it, which is also how early.js is retargeted.
//
// Net: this is a worse worker than early.js and is meant to be. It is used at
// exactly one tier — a home under 32GB — where the alternative is not early.js
// but nothing at all. boot.js retires it at 32GB.
//
// NOT CALIBRATED against the live game: the floor-vs-yield proxy above is
// derived from game source but has never been measured in a running BitNode,
// because this save has always had SF1 and has never seen an 8GB home. What IS
// checked every run is its RAM, by [B2] in `npm test`, against the game's own
// calculateRam.

// status.js references exactly one ns function, ns.write, which costs 0GB — so
// importing it here does not move the 2.00GB above by a hundredth. ns.atExit is
// 0GB too (RamCostGenerator.ts:605). Invariant C1 therefore costs this worker
// nothing, which is the only reason it is here: at four threads on an 8GB home
// there is no budget for observability that is not free.
import { reporter } from 'status.js'

const MONEY_FLOOR = 0.5
/** Give up on a target that keeps failing the hack roll; grow/weaken still earn exp. */
const MAX_MISSES = 30

export async function main(ns) {
  const target = ns.args[0] || 'n00dles'
  const floor = Number(ns.args[1]) > 0 ? Number(ns.args[1]) : MONEY_FLOOR

  ns.disableLog('ALL')

  // One write at startup and one on the way out — NOT one per cycle. This runs
  // at four threads on the smallest home and in the hundreds on a fleet host,
  // and every thread writes the same file; a per-cycle write would be the
  // dominant cost of the cheapest script in the collection.
  let cycles = 0
  let earned = 0
  const note = reporter(ns, '/tel/hgw.txt', () => ({ target, floor, cycles, earned }))
  ns.atExit(() => note.exit('stopped', { detail: `hgw.js stopped on ${target}` }))
  note('ok', { detail: `hgw.js hacking ${target} to a floor of ${floor}` })

  while (true) {
    // Down to minimum security. The zero return IS the threshold test.
    while ((await ns.weaken(target)) > 0) {
      /* still above minimum */
    }

    // Up to maximum money. The ratio of exactly 1 IS the threshold test.
    while ((await ns.grow(target)) > 1) {
      /* still below maximum */
    }

    // Drain to the floor. `top` is the yield at full money, so `take < top *
    // floor` means the server has fallen to `floor` of its maximum — the same
    // decision early.js makes with getServerMoneyAvailable, made from the
    // return value instead.
    let top = 0
    let misses = 0
    while (true) {
      let take = 0
      try {
        take = await ns.hack(target)
      } catch {
        // Hacking level too low for this target (netscriptCanHack,
        // Hacking/netscriptCanHack.ts:39). grow and weaken have no level
        // requirement and still pay hacking experience, so fall back to the
        // prep loop rather than exiting — levelling up is how this resolves.
        break
      }
      if (take <= 0) {
        // A failed roll costs no security, so retrying is free.
        if (++misses > MAX_MISSES) break
        continue
      }
      misses = 0
      earned += take
      if (top === 0) top = take
      if (take < top * floor) break
    }
    cycles++
  }
}
