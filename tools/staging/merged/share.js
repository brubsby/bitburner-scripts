// Donates RAM to the faction you are working for, raising reputation gain.
//
//   run share.js -t 600
//
// ns.share() adds this script's threads to a global pool for ~10s at a time.
// Every faction-work reputation formula is multiplied by
// calculateCurrentShareBonus() (src/PersonObjects/formulas/reputation.ts:22),
// which is:
//
//     bonus = 1 + ln(shareThreads) / 25          src/NetworkShare/Share.ts:43
//
// That is steeply concave, which is the whole reason this script takes a thread
// count rather than eating the fleet. At 4GB per thread:
//
//      threads     RAM      bonus
//         100     0.4TB     1.184
//         300     1.2TB     1.228
//         600     2.4TB     1.256     <- roughly 7% of a 36TB fleet
//       1,500     6.0TB     1.293
//       9,000    36.0TB     1.364     <- the entire fleet, for 11% more
//
// So ~600 threads buys about three quarters of the maximum bonus for a
// fifteenth of the RAM. Everything beyond that is far better spent hacking,
// because hacking experience raises the hacking level and reputation gain is
// *linear* in it (reputation.ts:18) — the level channel outruns the share
// channel quickly.
//
// Only worth running while there is a reputation target. It does nothing at all
// if you are not working for a faction.
//
// ---------------------------------------------------------------------------
// Telemetry, and the two things that are different about it here.
//
// This script wrote nothing at all until now, which made it the worst case of
// the C1 failure: 600 threads x 4GB = 2.4TB of fleet RAM whose only externally
// visible effect is a reputation rate nobody measures directly. A dead share.js
// and a healthy one look exactly the same from outside — the RAM simply
// returns to the batcher and the rep rate quietly drops ~25%. It stayed dead
// for hours after the last install for precisely that reason.
//
//   1. EVERY ns reference here is multiplied by the thread count. That is why
//      there is no mirror to home: ns.scp (0.6GB) + ns.getHostname (0.05GB)
//      would cost 0.65 x 600 = 390GB. ns.write, ns.read, ns.atExit and ns.self
//      are all 0GB (RamCostGenerator.ts:601,605,632,634), so everything below
//      is free at any thread count. Nothing costing RAM may be added here.
//
//   2. Because there is no mirror and this normally runs on a rooted server
//      (watchdog.js places it 'anywhere'), /tel/share.txt lands on THAT host,
//      not home, so the daemon does not see it. Read it in-game:
//      `cat /tel/share.txt` on whichever host `ps` shows share.js on. The file
//      still answers the only question that matters — is this alive, and since
//      when — which is more than existed before.
// ---------------------------------------------------------------------------

// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

const STATUS = '/tel/share.txt'

export async function main(ns) {
  ns.disableLog('ALL')

  const started = Date.now()
  const errors = []
  // ns.self() is 0GB (RamCostGenerator.ts:601) and threads are the whole point
  // of this script — the bonus is 1 + ln(threads)/25 — so publishing the count
  // makes "share is running" and "share is running at the size we intended"
  // distinguishable. A watchdog relaunch onto a smaller host silently halves it.
  let threads = null
  let rounds = 0

  const note = reporter(ns, STATUS, () => ({
    threads,
    rounds,
    uptimeSec: Math.round((Date.now() - started) / 1000),
    errors: errors.slice(-5),
  }))

  // The path no try/finally can reach: killed by the watchdog when the last
  // faction drops, caught in a killall, or destroyed by an augmentation install
  // — which is exactly when this matters, because the post-install rebuild is
  // when it stayed dead unnoticed. Explicit id so it can never collide with the
  // 'ui-lock' callback lock.js registers (ns.atExit keys by id,
  // NetscriptFunctions.ts:1395-1398); this script takes no lock, but the id
  // costs nothing and makes that independent of what it imports later.
  ns.atExit(() => {
    note.exit('stopped', {
      detail: 'share.js is no longer sharing — faction reputation gain has lost its share bonus',
    })
  }, 'status')

  try {
    threads = ns.self().threads
  } catch {
    /* ns.self() is 0GB and should not throw, but a missing thread count must
       not stop the script from sharing. */
  }
  note('ok', { detail: `sharing with ${threads ?? '?'} threads` })

  while (true) {
    try {
      await ns.share()
      rounds++
      // ns.share() resolves after roughly 10s of donated time, so this
      // republishes about six times a minute. That cadence is the liveness
      // signal: a file whose `at` has stopped advancing is a share that has
      // stopped sharing, which is otherwise invisible.
      note('ok', { detail: `sharing with ${threads ?? '?'} threads` })
    } catch (err) {
      // ALWAYS surface the failure. Previously there was no try at all, so one
      // throw ended main() and the process vanished with no trace anywhere.
      try {
        const detail = record(errors, err)
        ns.print(`share error: ${detail}`)
        note('error', { detail: describe(err) })
      } catch {
        /* nothing left to try */
      }
      await ns.sleep(5000)
    }
  }
}
