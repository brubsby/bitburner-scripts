// Finds and solves coding contracts, forever, unattended.
//
//   run ctauto.js            check every 5 minutes
//   run ctauto.js --every 2  check every 2 minutes
//
// ctscan.js and ctsolve.js exist as a pair because reading a contract
// (getContractType 5GB + getData 5GB) and answering it (attempt 10GB) together
// exceed 21.8GB, which did not fit when home was 16GB. Home is far past that
// now, so this does both in one resident script and needs nobody to start it.
//
// Contracts are worth running unattended for two reasons. They pay ~$25m each,
// and — more importantly once money stops being the constraint — they pay
// faction reputation, which is the one thing that cannot be bought and is
// usually the binding constraint on progress.
//
// Solvers come from ctsolvers.js, which contains no ns call and so costs
// nothing to import. Unknown contract types are skipped rather than guessed at:
// a wrong answer burns one of a contract's limited attempts and can destroy it.

import { findAnswer } from 'ctsolvers.js'
// Free to import: status.js references only ns.write (0GB). See its header.
import { reporter, describe, record } from 'status.js'

const STATUS = '/tel/ctauto.txt'

function scanAll(ns) {
  const seen = new Set(['home'])
  const queue = ['home']
  while (queue.length) {
    for (const host of ns.scan(queue.shift())) {
      if (!seen.has(host)) {
        seen.add(host)
        queue.push(host)
      }
    }
  }
  return [...seen]
}

export async function main(ns) {
  const flags = ns.flags([['every', 5]])
  const interval = Math.max(30, flags.every * 60) * 1000

  ns.disableLog('ALL')
  ns.tprint(`ctauto.js: solving contracts every ${flags.every} min`)

  const totals = { solved: 0, wrong: 0, skipped: 0, rewards: [] }

  const errors = []
  // The running totals ride on EVERY write, healthy or not, so the error and
  // exit paths do not blank out the only record of what this has earned.
  // Existing field names are unchanged; `health` and `errors` are additive.
  const note = reporter(ns, STATUS, () => ({ ...totals, errors: errors.slice(-5) }))

  // The path no try/catch can reach: killed by the watchdog, caught in a
  // killall, or destroyed by an augmentation install. ns.atExit costs 0GB and
  // its callbacks run before the worker is torn down
  // (killWorkerScript.ts:64-84), so a synchronous ns.write still lands. It is
  // the only way a dead contract solver says so — and a dead one is invisible,
  // because unsolved contracts sit on their servers producing no signal at all
  // and the money is a rounding error against hacking income. Explicit id, so
  // this can never replace the 'ui-lock' callback lock.js registers.
  ns.atExit(() => {
    note.exit('stopped', { detail: 'ctauto.js is no longer solving contracts' })
  }, 'status')

  while (true) {
    const found = []

    try {
      for (const host of scanAll(ns)) {
        for (const file of ns.ls(host).filter((f) => f.endsWith('.cct'))) {
          try {
            found.push({
              contract: file,
              hostname: host,
              type: ns.codingcontract.getContractType(file, host),
              data: ns.codingcontract.getData(file, host),
            })
          } catch {
            // Contract vanished between listing and reading, or is unreadable.
          }
        }
      }

      for (const c of found) {
        let answer
        try {
          answer = findAnswer(c)
        } catch (err) {
          totals.skipped++
          ns.print(`solver threw on ${c.type}: ${err}`)
          continue
        }
        if (answer === undefined || answer === null) {
          totals.skipped++
          ns.print(`no solver for ${c.type}`)
          continue
        }

        const reward = ns.codingcontract.attempt(answer, c.contract, c.hostname, { returnReward: true })
        if (reward) {
          totals.solved++
          totals.rewards.push(reward)
          if (totals.rewards.length > 30) totals.rewards.shift()
          ns.tprint(`ctauto: solved ${c.contract} @ ${c.hostname} — ${reward}`)
        } else {
          totals.wrong++
          ns.tprint(`ctauto: WRONG on ${c.type} (${c.contract} @ ${c.hostname})`)
        }
        await ns.sleep(50)
      }

      note('ok', { lastScanFound: found.length })
    } catch (err) {
      // Never die: this is meant to run for hours with nobody watching. But
      // "never die" was only half of it — the status write was the last
      // statement of this try, so a throw anywhere above it (a contract
      // destroyed mid-scan, an ns arity change, a bad edit) skipped the one
      // record of what happened and left the file frozen on the last good
      // cycle. That reads as "no contracts about", not as "not looking".
      try {
        const detail = record(errors, err)
        ns.print(`cycle error: ${detail}`)
        note('error', { lastScanFound: found.length, detail: describe(err) })
      } catch {
        /* nothing left to try */
      }
    }

    await ns.sleep(interval)
  }
}
