// COMPILED SOURCE — not deployed. tools/compile/build.mjs links this against
// ONE OF two capability modules and writes tools/compile/dist/autobuy.js.
//
//   caps/buy.js  ->  src/caps/buy-sing.js      Singularity callable
//                ->  src/caps/buy-terminal.js  it is not
//
// The singularity arm imports the terminal arm and falls back to it, so this
// file has one route object and no route branch. No build-time constants, no
// minify flags.

// Buys the TOR router and the port-opening programs as soon as they are
// affordable, with no human and at any Source-File level.
//
//   run autobuy.js
//
// Port openers are the best conversion of money into progress in the game:
// rooting is gated on open ports alone, never on hacking level, so each one
// unlocks a whole tier of servers whose RAM the batcher can use immediately.
// relaySMTP once unlocked 688GB for $5m — about $7.3k/GB against the cloud's
// flat $55k/GB.
//
// Buying them is normally a UI job (`ns.singularity.purchaseProgram` needs
// Source-File 4), which meant a human had to notice and click, and so they sat
// unbought for hours at a time. Two routes out, tried in order:
//
//   1. autobuy-sing.js, a separate one-shot holding ns.singularity.purchaseTor
//      and ns.singularity.purchaseProgram, exec'd only when sfgate.js says the
//      Source-File is actually there.
//   2. The terminal's own `buy` command, queued through cmd.js — which works
//      at any Source-File level, because the terminal is not gated.
//
// ---------------------------------------------------------------------------
// WHY THE SINGULARITY CALLS ARE NOT IN THIS FILE.
//
// They used to be, behind `const sing = ns.singularity` and a try/catch. That
// is not a gate: Netscript prices every ns function in a script's import graph
// whether or not the call is reachable (Script/RamCalculations.ts:407), and the
// Singularity ladder charges x16 outside BitNode 4 at Source-File 4 level 1
// (RamCostGenerator.ts:82-96). The billed cost of this file was therefore
// 5.85GB inside BN4 and **65.85GB** at SF4.1 anywhere else — and it is in
// boot.js's STACK and watchdog.js's WATCHED list, so it launches every life at
// a home size that starts at 8, 32 or 128GB (Prestige.ts:242-248). A 65.85GB
// resident does not fit; the watchdog would have reported "no host with NGB
// free" every 30 seconds, forever, in silence.
//
// The try/catch made it worse rather than better, because it made the file look
// safe: the exception it caught never fires, since the RAM is charged before a
// line of it runs.
//
// So the split is the go.js / go-cheat.js pattern from CLAUDE.md: a 1GB
// ns.getResetInfo() probe here, the expensive surface in its own script, paid
// for only while it runs and only on a save that can call it. `exec` returning
// 0 (no RAM for the helper) falls through to the terminal route, which is
// always available — so this file cannot be worse off than before the split.

import { ROUTE, CAN_BUY_TOR, TOR_ADVICE, bridgeBusy, buy } from 'caps/buy.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

const TOR_COST = 200e3
const PROGRAMS = [
  { file: 'BruteSSH.exe', price: 500e3 },
  { file: 'FTPCrack.exe', price: 1.5e6 },
  { file: 'relaySMTP.exe', price: 5e6 },
  { file: 'HTTPWorm.exe', price: 30e6 },
  { file: 'SQLInject.exe', price: 250e6 },
  // Not a port opener — it unlocks ns.formulas, the game's own formula API.
  // Worth every dollar: batch.js plans with inlined ports of the game's math
  // that can silently drift from upstream, and with Formulas.exe present it
  // switches to asking the game directly (0 GB per call, RamCostGenerator
  // 695-706). This is the only in-game way to get exact numbers with no
  // Source-File and no reading of game source.
  { file: 'Formulas.exe', price: 5e9 },
]

// Whether TOR is owned. Use the game's own predicate: ns.hasTorRouter(), which
// costs 0.05GB and needs no Source-File (RamCostGenerator.ts:591). It is
// literally `home.serversOnNetwork.includes('darkweb')`
// (PlayerObjectServerMethods.ts:14-16).
//
// NOT ns.serverExists('darkweb'): the darkweb server is always present in the
// server list, and buying TOR merely *connects* it to home (`getTorRouter()`
// -> connectServers(home, darkweb), ServerHelpers.ts:354-356). serverExists is
// therefore true from the first second of a BitNode, which made autobuy believe
// TOR was owned, never buy it, and queue `buy FTPCrack.exe` every 60s into a
// terminal that answered "You need to be able to connect to the Dark Web".
const hasTor = (ns) => ns.hasTorRouter()

const STATUS = '/tel/autobuy.txt'
// CMD_IN, BUSY, SING_HELPER and queue() all moved into caps/buy-*.js: they are
// route detail, and this file no longer knows which route it got.
const TOR_ITEM = 'tor'
// Two cadences. While anything is still missing this is the critical path —
// every port program unlocks a tier of servers to root, and the fleet cannot
// grow without them — so poll fast. Once everything is owned there is nothing
// to do but notice a new BitNode, so back off.
const INTERVAL_HUNTING = 5000
const INTERVAL_IDLE = 60000

export async function main(ns) {
  ns.disableLog('ALL')

  // One 1GB probe for the whole life. Source-File level cannot change without a
  // BitNode reset, and a reset kills every running script, so re-reading this
  // per tick would buy nothing.
  // COMPILED: no 1GB ns.getResetInfo() probe. ROUTE is a string imported from
  // whichever caps/buy module the build linked, so "which route am I on" is
  // answered by the link, not by asking the game.
  ns.tprint(`autobuy.js: watching for affordable port programs (${ROUTE} route)`)

  const bought = []
  let warnedTor = false
  // file -> ms when we last asked for it. A purchase is not instant: the bridge
  // must take the global lock, open the Terminal and type, and only then does
  // ns.fileExists see the program. Without this the 5s hunting tick re-queued
  // the same `buy` on every pass until the file finally appeared — `buy
  // Formulas.exe` went out a dozen times for one purchase. The timeout means a
  // genuinely lost command is still retried rather than blocking forever.
  //
  // The singularity route needs it just as much: exec is asynchronous, so the
  // helper has not run yet when this loop comes round again 5s later.
  const inFlight = new Map()
  const RETRY_MS = 45000

  const errors = []
  // `recent` rides on every write, so the error and exit paths still say what
  // this had managed before it stopped. Existing field names are unchanged;
  // `health` and `errors` are additive.
  const note = reporter(ns, STATUS, () => ({ recent: bought.slice(-10), errors: errors.slice(-5) }))

  // The path no try/catch can reach: killed by the watchdog, caught in a
  // killall, or destroyed by an augmentation install — and an install is
  // exactly when this matters, because it clears serversOnNetwork, TOR goes
  // with it and every port program has to be re-bought from scratch. ns.atExit
  // costs 0GB and runs before the worker is torn down
  // (killWorkerScript.ts:64-84), so the write still lands. Explicit id so it
  // can never replace the 'ui-lock' callback lock.js registers.
  ns.atExit(() => {
    note.exit('stopped', { detail: 'autobuy.js is no longer buying port programs — the fleet stops growing' })
  }, 'status')

  while (true) {
    try {
      // Backpressure: never stack a second request on top of one the bridge
      // has not finished. This signal already existed and autobuy ignored it.
      if (bridgeBusy(ns)) {
        await ns.sleep(2000)
        continue
      }

      const money = ns.getServerMoneyAvailable('home')
      const tor = hasTor(ns)
      const now = Date.now()
      // ONE shopping list. The original kept two — `sing` for the helper's argv
      // and `wanted` for terminal `buy` lines — with exactly one of them ever
      // non-empty, because the route was a runtime branch. The route is now a
      // link-time fact, so there is one list and one call.
      const wanted = []
      let wantTor = false

      // Keep a little headroom so this never spends the last dollar out from
      // under something else mid-purchase.
      if (!tor && money > TOR_COST * 1.5) {
        const asked = inFlight.get(TOR_ITEM)
        if (asked === undefined || now - asked >= RETRY_MS) {
          // NOT compiled away, and deliberately so: this is a two-line inline
          // branch, not a module boundary, and both arms cost 0GB (ns.tprint is
          // free). Eliminating it would buy nothing and would need
          // --minify-syntax, which is the flag this design exists to avoid.
          // See NOTES-compile.md, "where module substitution runs out".
          if (CAN_BUY_TOR) {
            inFlight.set(TOR_ITEM, now)
            wanted.push(TOR_ITEM)
            wantTor = true
          } else if (!warnedTor) {
            // Without Source-File 4 there is no way to buy TOR from a script at
            // all: the terminal's `buy` command requires the darkweb, which
            // requires TOR. Retrying just floods the terminal with the same
            // error every tick — it did exactly that for half an hour. Say it
            // once and leave it to a human (or to torbuy.js, which drives the
            // Alpha Enterprises button directly).
            warnedTor = true
            ns.tprint(TOR_ADVICE)
          }
        }
      }

      if (tor) {
        // Queue EVERY program we can afford in one batch, cheapest first.
        //
        // This used to buy one per tick with a comment about re-reading the
        // balance between purchases. That made sense when a single program was
        // a meaningful fraction of net worth; at trillions per second it just
        // meant six programs took six minutes, and the fleet sat un-rooted the
        // whole time. Affordability is checked against the *cumulative* cost
        // instead, which is the thing the old code was really protecting
        // against, and it stays correct when money is tight.
        let budget = money
        for (const { file, price } of PROGRAMS) {
          if (ns.fileExists(file, 'home')) {
            inFlight.delete(file)
            continue
          }
          // Already asked for recently and still not here: let it land.
          const asked = inFlight.get(file)
          if (asked !== undefined && now - asked < RETRY_MS) continue
          if (budget < price * 1.5) continue
          budget -= price
          inFlight.set(file, now)
          wanted.push(file)
        }
      }

      if (wanted.length) {
        // One call. Which of exec-the-helper / queue-a-terminal-command this
        // turns into, and the fallback from the first to the second, is
        // caps/buy.js's business.
        const outcome = buy(ns, wanted)
        bought.push(`${outcome.route}: ${outcome.requested.join(', ')}`)
        // Anything the route could not take — TOR on a terminal fallback — is
        // un-marked, so the next pass asks again instead of waiting out
        // RETRY_MS for a request that was never made. The original dropped it
        // silently and relied on the timeout.
        for (const item of outcome.deferred) inFlight.delete(item)
      }

      const owned = PROGRAMS.filter((p) => ns.fileExists(p.file, 'home')).map((p) => p.file)
      note('ok', {
        tor,
        route: ROUTE,
        torRequested: wantTor,
        owned,
        missing: PROGRAMS.length - owned.length,
      })
    } catch (err) {
      // ALWAYS surface the failure. The status write was the last statement of
      // this try, so a throw anywhere above it skipped the only record of what
      // went wrong: the process stayed alive on its 5s sleep and the file
      // simply froze on the last good tick, which reads as "nothing affordable
      // yet" rather than "not looking". Nothing in here reads the game, so the
      // report cannot become the failure.
      try {
        const detail = record(errors, err)
        ns.print(`autobuy error: ${detail}`)
        note('error', { detail: describe(err) })
      } catch {
        /* nothing left to try */
      }
    }

    const missing = PROGRAMS.filter((p) => !ns.fileExists(p.file, 'home')).length
    await ns.sleep(missing > 0 ? INTERVAL_HUNTING : INTERVAL_IDLE)
  }
}
